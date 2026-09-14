//! One-round brew solver: exact expectimax to a fixed depth with an abstract-bag leaf.
//! Mirrors ../brew.py and ../value.py. Two terminal modes: the v1 heuristic exchange rates,
//! or a learned whole-game value function via a precomputed shop table (see shop.rs).

use std::collections::HashMap;
use std::hash::{BuildHasherDefault, Hasher};

use crate::data::*;

// ----------------------------------------------------------------------------- fast hasher
#[derive(Default)]
pub struct FxHasher(u64);
impl Hasher for FxHasher {
    fn finish(&self) -> u64 { self.0 }
    fn write(&mut self, bytes: &[u8]) { for &b in bytes { self.0 = (self.0.rotate_left(5) ^ b as u64).wrapping_mul(0x517cc1b727220a95); } }
    fn write_u64(&mut self, i: u64) { self.0 = (self.0.rotate_left(5) ^ i).wrapping_mul(0x517cc1b727220a95); }
    fn write_u128(&mut self, i: u128) { self.write_u64(i as u64); self.write_u64((i >> 64) as u64); }
}
pub type FxMap<K, V> = HashMap<K, V, BuildHasherDefault<FxHasher>>;

// ----------------------------------------------------------------------------- math
fn phi(x: f64) -> f64 {
    // Abramowitz-Stegun 26.2.17 (same as the JS app); Python uses erf — agree to ~1e-7
    let t = 1.0 / (1.0 + 0.2316419 * x.abs());
    let d = 0.3989423 * (-x * x / 2.0).exp();
    let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    if x > 0.0 { 1.0 - p } else { p }
}
fn pois_pmf(k: i32, mu: f64) -> f64 {
    if k < 0 { return 0.0; }
    let mut f = 1.0; for i in 2..=k { f *= i as f64; }
    (-mu).exp() * mu.powi(k) / f
}
fn pois_cdf(k: i32, mu: f64) -> f64 { (0..=k).map(|i| pois_pmf(i, mu)).sum() }

// ----------------------------------------------------------------------------- terminal
/// Precomputed "what the round's payout is worth from here" table for the learned mode.
/// Index: [coins 0..=35][rubies gained 0..=RUBMAX][droplet steps gained 0..=DDMAX][flask used 0/1]
pub const RUBMAX: usize = 6;
pub const DDMAX: usize = 2;
#[derive(Clone)]
pub struct PayTable {
    pub g: Vec<f64>,
    /// value of one extra orange chip in the bag (bonus die face)
    pub d_orange: f64,
    /// WIN model: entries of `g` are logits; P(win) = sigmoid(g + a * (m0 + VP gained this round))
    pub win: bool,
    /// margin coefficient of next round's model
    pub a: f64,
    /// margin at the start of this round minus the mean VP the other players gain in it
    pub m0: f64,
}
impl PayTable {
    #[inline]
    pub fn get(&self, coins: i32, rub: i32, dd: i32, fu: bool) -> f64 {
        let c = coins.clamp(0, 35) as usize;
        let r = (rub.max(0) as usize).min(RUBMAX);
        let d = (dd.max(0) as usize).min(DDMAX);
        self.g[((c * (RUBMAX + 1) + r) * (DDMAX + 1) + d) * 2 + fu as usize]
    }
    pub fn index(c: usize, r: usize, d: usize, fu: usize) -> usize { ((c * (RUBMAX + 1) + r) * (DDMAX + 1) + d) * 2 + fu }
    pub fn len() -> usize { 36 * (RUBMAX + 1) * (DDMAX + 1) * 2 }
}

pub enum Terminal {
    Heuristic,
    Learned(PayTable),
}

pub struct Ctx {
    pub rnd: u32,
    pub limit: i32,
    pub n_opp: u32,
    pub both: bool,
    pub novp: f64,
    pub opp_black: f64,
    pub w_coin: f64,
    pub w_ruby: f64,
    pub w_drop: f64,
    pub w_orange: f64,
    pub w_flask: f64,
    pub die_ev: f64,
    pub term: Terminal,
    die_cache: Vec<f64>,
}

impl Ctx {
    pub fn new(rnd: u32, term: Terminal) -> Ctx {
        let r = rnd as usize;
        let w_ruby = W_RUBY[r];
        let w_drop = W_DROP[r];
        let w_orange = W_ORANGE[r];
        let die_ev = (1.0 + 1.0 + 2.0 + w_ruby + w_drop + w_orange) / 6.0;
        let mut c = Ctx {
            rnd, limit: EXPLODE_LIMIT, n_opp: OPP.n, both: false, novp: 0.0, opp_black: OPP.opp_black[r],
            w_coin: W_COIN[r], w_ruby, w_drop, w_orange, w_flask: if rnd >= ROUNDS { 0.0 } else { 1.5 * w_ruby },
            die_ev, term, die_cache: vec![-1.0; 64],
        };
        for s in 0..64 { c.die_cache[s] = c.calc_p_win_die(s); }
        c
    }
    pub fn black_odds(&self, blacks: i32) -> (f64, f64) {
        let mu = self.opp_black;
        let pl = pois_cdf(blacks - 1, mu);
        let pe = pois_pmf(blacks, mu);
        if self.n_opp <= 1 { (pl + pe, pl) } else { (1.0 - (1.0 - pl).powi(2), pl.powi(2)) }
    }
    fn calc_p_win_die(&self, space: usize) -> f64 {
        if self.n_opp == 0 { return 1.0; }
        let m = OPP.best_space_mean[self.rnd as usize];
        let p = (1.0 - OPP.p_survive) + OPP.p_survive * phi((space as f64 - 0.5 - m) / OPP.best_space_sd);
        p.powi(self.n_opp as i32)
    }
    #[inline]
    pub fn p_win_die(&self, space: usize) -> f64 { self.die_cache[space.min(63)] }

    pub fn terminal(&self, pos: usize, exploded: bool, greens: i32, purples: i32, blacks: i32, flask_used: bool) -> f64 {
        match &self.term {
            Terminal::Heuristic => self.terminal_heuristic(pos, exploded, greens, purples, blacks, flask_used),
            Terminal::Learned(t) => self.terminal_learned(t, pos, exploded, greens, purples, blacks, flask_used),
        }
    }

    fn terminal_heuristic(&self, pos: usize, exploded: bool, greens: i32, purples: i32, blacks: i32, flask_used: bool) -> f64 {
        let space = pos + 1;
        let (coins, vp, ruby) = track(space);
        let mut rubies = ruby + greens as f64;
        let mut extra = 0.0;
        if purples >= 3 { extra += 2.0 + self.w_drop; } else if purples == 2 { extra += 1.0; rubies += 1.0; } else if purples == 1 { extra += 1.0; }
        if blacks > 0 { let (pd, pr) = self.black_odds(blacks); extra += pd * self.w_drop; rubies += pr; }
        extra += rubies * self.w_ruby;
        if flask_used { extra -= self.w_flask; }
        if exploded && !self.both { return vp.max(coins * self.w_coin) + extra; }
        let mut val = vp + coins * self.w_coin + extra;
        if !exploded { val += self.novp + self.p_win_die(space) * self.die_ev; }
        val
    }

    fn terminal_learned(&self, t: &PayTable, pos: usize, exploded: bool, greens: i32, purples: i32, blacks: i32, flask_used: bool) -> f64 {
        let space = pos + 1;
        let (coins, vp, ruby) = track_i(space);
        let mut rub = ruby + greens;
        let mut vp_now = 0;          // VP from chip effects, kept even when exploded
        let mut dd = 0;
        if purples >= 3 { vp_now += 2; dd += 1; } else if purples == 2 { vp_now += 1; rub += 1; } else if purples == 1 { vp_now += 1; }
        let (pd, pr) = if blacks > 0 { self.black_odds(blacks) } else { (0.0, 0.0) };
        if !t.win {
            // VP model: value = VP gained this round + V_{r+1}(best shop), expected over the black-chip outcome
            let g = |c: i32, r: i32, d: i32| -> f64 {
                (1.0 - pd) * t.get(c, r, d, flask_used) + (pd - pr) * t.get(c, r, d + 1, flask_used) + pr * t.get(c, r + 1, d + 1, flask_used)
            };
            if exploded && !self.both {
                let keep_vp = vp as f64 + g(0, rub, dd);
                let keep_coins = g(coins, rub, dd);
                return vp_now as f64 + keep_vp.max(keep_coins);
            }
            let base = g(coins, rub, dd);
            let mut val = (vp + vp_now) as f64 + base;
            if !exploded {
                let die = (1.0 + 1.0 + 2.0 + (g(coins, rub + 1, dd) - base) + (g(coins, rub, dd + 1) - base) + t.d_orange) / 6.0;
                val += self.novp + self.p_win_die(space) * die;
            }
            return val;
        }
        // WIN model: value = P(win) = sigmoid(logit of best shop + a * (projected margin + VP gained this round)),
        // expected over the black-chip outcome (none / droplet / droplet+ruby). `dz` shifts the logit (extra orange).
        let h = |c: i32, r: i32, d: i32, vpg: f64, dz: f64| -> f64 {
            let s = |z: f64| crate::model::sigmoid(z + dz + t.a * (t.m0 + vpg));
            (1.0 - pd) * s(t.get(c, r, d, flask_used)) + (pd - pr) * s(t.get(c, r, d + 1, flask_used)) + pr * s(t.get(c, r + 1, d + 1, flask_used))
        };
        if exploded && !self.both {
            let keep_vp = h(0, rub, dd, (vp + vp_now) as f64, 0.0);
            let keep_coins = h(coins, rub, dd, vp_now as f64, 0.0);
            return keep_vp.max(keep_coins);
        }
        let vpg = (vp + vp_now) as f64 + if exploded { 0.0 } else { self.novp };
        let base = h(coins, rub, dd, vpg, 0.0);
        if exploded { return base; }
        // bonus die faces: +1, +1, +2 VP, ruby, droplet, orange chip
        let die = (2.0 * h(coins, rub, dd, vpg + 1.0, 0.0) + h(coins, rub, dd, vpg + 2.0, 0.0)
                   + h(coins, rub + 1, dd, vpg, 0.0) + h(coins, rub, dd + 1, vpg, 0.0) + h(coins, rub, dd, vpg, t.d_orange)) / 6.0;
        let p = self.p_win_die(space);
        base + p * (die - base)
    }
}

// ----------------------------------------------------------------------------- state
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
pub struct State {
    pub bag: Bag,
    pub pos: u8,
    pub white: u8,
    pub lastw: u8,
    pub g1: bool,
    pub g2: bool,
    pub flask: bool,
}
impl State {
    #[inline]
    fn key(&self, d: u8) -> u128 {
        let mut k: u128 = 0;
        for i in 0..N { k = (k << 4) | (self.bag[i] as u128 & 15); }
        k = (k << 6) | self.pos as u128;
        k = (k << 4) | self.white as u128;
        k = (k << 2) | self.lastw as u128;
        k = (k << 1) | self.g1 as u128;
        k = (k << 1) | self.g2 as u128;
        k = (k << 1) | self.flask as u128;
        (k << 7) | d as u128
    }
    #[inline]
    pub fn without(&self, i: usize) -> State { let mut s = *self; s.bag[i] -= 1; s }
}

// ----------------------------------------------------------------------------- abstract solver
pub struct Abstract {
    memo: FxMap<u128, f64>,
}
impl Abstract {
    pub fn new() -> Abstract { Abstract { memo: FxMap::default() } }
    fn eff(ctx: &Ctx, i: usize, oranges: i32) -> f64 {
        let v = VALUE[i] as f64;
        match COLOR[i] {
            b'R' => v + if oranges >= 3 { 2.0 } else if oranges >= 1 { 1.0 } else { 0.0 },
            b'B' => v + match VALUE[i] { 1 => 1.0, 2 => 1.0, _ => 2.0 },
            b'Y' => v + 0.6,
            b'G' => v + 0.3 * ctx.w_ruby,
            _ => v,
        }
    }
    pub fn value(&mut self, ctx: &Ctx, s: &State, greens: i32, purples: i32, blacks: i32, oranges: i32) -> f64 {
        let w = [s.bag[I_W1], s.bag[I_W2], s.bag[I_W3]];
        let mut safe = [0u8; 8];
        for i in 0..N {
            let k = s.bag[i];
            if k == 0 || matches!(COLOR[i], b'W' | b'P' | b'K') { continue; }
            let v = (Self::eff(ctx, i, oranges).round() as usize).min(7);
            safe[v] += k;
        }
        self.v(ctx, w, safe, s.bag[I_P], s.bag[I_K], s.pos, s.white, s.flask, greens as u8, purples as u8, blacks as u8)
    }
    #[allow(clippy::too_many_arguments)]
    fn v(&mut self, ctx: &Ctx, w: [u8; 3], safe: [u8; 8], pr: u8, kr: u8, pos: u8, white: u8, flask: bool, g: u8, p: u8, b: u8) -> f64 {
        let mut key: u128 = 0;
        for x in w { key = (key << 4) | x as u128; }
        for x in safe { key = (key << 5) | x as u128; }
        key = (key << 4) | pr as u128; key = (key << 4) | kr as u128;
        key = (key << 6) | pos as u128; key = (key << 4) | white as u128; key = (key << 1) | flask as u128;
        key = (key << 2) | g as u128; key = (key << 3) | p as u128; key = (key << 3) | b as u128;
        if let Some(&v) = self.memo.get(&key) { return v; }
        let mut best = ctx.terminal(pos as usize, false, g as i32, p as i32, b as i32, !flask);
        let n = w.iter().map(|&x| x as u32).sum::<u32>() + safe.iter().map(|&x| x as u32).sum::<u32>() + pr as u32 + kr as u32;
        if n > 0 {
            let mut dv = 0.0;
            for wi in 0..3 {
                let k = w[wi]; if k == 0 { continue; }
                let v = wi as u8 + 1; let nw = white + v; let np = (pos + v).min(LAST as u8);
                let val = if nw as i32 > ctx.limit {
                    ctx.terminal(np as usize, true, g as i32, p as i32, b as i32, !flask)
                } else {
                    let mut w2 = w; w2[wi] -= 1;
                    let mut val = self.v(ctx, w2, safe, pr, kr, np, nw, flask, g, p, b);
                    if flask { val = val.max(self.v(ctx, w, safe, pr, kr, pos, white, false, g, p, b)); }
                    val
                };
                dv += k as f64 * val;
            }
            for v in 0..8 {
                let k = safe[v]; if k == 0 { continue; }
                let mut s2 = safe; s2[v] -= 1;
                dv += k as f64 * self.v(ctx, w, s2, pr, kr, (pos + v as u8).min(LAST as u8), white, flask, g, p, b);
            }
            if pr > 0 { dv += pr as f64 * self.v(ctx, w, safe, pr - 1, kr, (pos + 1).min(LAST as u8), white, flask, g, p + 1, b); }
            if kr > 0 { dv += kr as f64 * self.v(ctx, w, safe, pr, kr - 1, (pos + 1).min(LAST as u8), white, flask, g, p, b + 1); }
            dv /= n as f64;
            if dv > best { best = dv; }
        }
        self.memo.insert(key, best);
        best
    }
}

// ----------------------------------------------------------------------------- full solver
pub struct Brew<'a> {
    pub ctx: &'a Ctx,
    pub start_bag: Bag,
    pub n_o: i32,
    pub n_p: i32,
    pub n_k: i32,
    pub flask_full: bool,
    pub depth: u8,
    memo: FxMap<u128, f64>,
    bmemo: FxMap<(u128, u8), f64>,
    pub abs: Abstract,
}

fn comb(n: u32, k: u32) -> f64 {
    if k > n { return 0.0; }
    let mut r = 1.0;
    for i in 1..=k { r = r * (n - k + i) as f64 / i as f64; }
    r.round()
}

/// multiset combinations of size k from bag: (types, ways)
fn combos(bag: &Bag, k: u32, start: usize, cur: &mut Vec<usize>, ways: f64, out: &mut Vec<(Vec<usize>, f64)>) {
    if k == 0 { out.push((cur.clone(), ways)); return; }
    for i in start..N {
        let c = bag[i] as u32;
        if c == 0 { continue; }
        for t in 1..=c.min(k) {
            let w = comb(c, t);
            for _ in 0..t { cur.push(i); }
            combos(bag, k - t, i + 1, cur, ways * w, out);
            for _ in 0..t { cur.pop(); }
        }
    }
}

impl<'a> Brew<'a> {
    pub fn new(ctx: &'a Ctx, start_bag: Bag, flask_full: bool, depth: u8) -> Brew<'a> {
        Brew { ctx, start_bag, n_o: start_bag[I_O] as i32, n_p: start_bag[I_P] as i32, n_k: start_bag[I_K] as i32,
               flask_full, depth, memo: FxMap::default(), bmemo: FxMap::default(), abs: Abstract::new() }
    }
    pub fn start(&self, droplet: i32, rats: u32) -> State {
        State { bag: self.start_bag, pos: (droplet as u32 + rats).min(LAST as u32) as u8, white: 0, lastw: 0, g1: false, g2: false, flask: self.flask_full }
    }
    #[inline]
    fn term(&self, s: &State, exploded: bool) -> f64 {
        self.ctx.terminal(s.pos as usize, exploded, s.g1 as i32 + s.g2 as i32, self.n_p - s.bag[I_P] as i32, self.n_k - s.bag[I_K] as i32, !s.flask)
    }
    pub fn stop_value(&self, s: &State) -> f64 { self.term(s, false) }
    pub fn explode_prob(&self, s: &State) -> f64 {
        let n = total(&s.bag); if n == 0 { return 0.0; }
        let mut c = 0u32;
        for v in 1..=3 { if s.white as i32 + v > self.ctx.limit { c += s.bag[I_W[v as usize]] as u32; } }
        c as f64 / n as f64
    }
    /// chip i already removed from s.bag. Returns (state, exploded).
    pub fn placed(&self, s: &State, i: usize, ret_white: bool) -> (State, bool) {
        let c = COLOR[i];
        let mut v = VALUE[i] as i32;
        let (mut bag, mut pos, mut white, mut g1, mut g2) = (s.bag, s.pos as i32, s.white as i32, s.g1, s.g2);
        if ret_white {
            bag[I_W[s.lastw as usize]] += 1; pos -= s.lastw as i32; white -= s.lastw as i32; g1 = g2; g2 = false;
        }
        if c == b'W' {
            white += v; pos += v;
            return (State { bag, pos: pos.min(LAST as i32) as u8, white: white as u8, lastw: v as u8, g1: false, g2: g1, flask: s.flask }, white > self.ctx.limit);
        }
        if c == b'R' { let o = self.n_o - bag[I_O] as i32; v += if o >= 3 { 2 } else if o >= 1 { 1 } else { 0 }; }
        pos += v;
        (State { bag, pos: pos.min(LAST as i32) as u8, white: white as u8, lastw: 0, g1: c == b'G', g2: g1, flask: s.flask }, false)
    }
    #[inline]
    pub fn use_flask(sb: &State) -> State { let mut s = *sb; s.flask = false; s }

    pub fn v(&mut self, s: &State, d: u8) -> f64 {
        let key = s.key(d);
        if let Some(&v) = self.memo.get(&key) { return v; }
        let mut best = self.term(s, false);
        let n = total(&s.bag);
        if n > 0 && d == 0 {
            best = best.max(self.leaf(s));
        } else if n > 0 {
            let mut dv = 0.0;
            for i in 0..N {
                let k = s.bag[i];
                if k > 0 { dv += k as f64 * self.place(&s.without(i), i, s, d - 1); }
            }
            dv /= n as f64;
            if dv > best { best = dv; }
        }
        self.memo.insert(key, best);
        best
    }
    pub fn value(&mut self, s: &State) -> f64 { let d = self.depth; self.v(s, d) }
    fn leaf(&mut self, s: &State) -> f64 {
        let greens = s.g1 as i32 + s.g2 as i32;
        self.abs.value(self.ctx, s, greens, self.n_p - s.bag[I_P] as i32, self.n_k - s.bag[I_K] as i32, self.n_o - s.bag[I_O] as i32)
    }
    pub fn draw_value(&mut self, s: &State) -> Option<f64> {
        let n = total(&s.bag); if n == 0 { return None; }
        let d = self.depth;
        let mut dv = 0.0;
        for i in 0..N { let k = s.bag[i]; if k > 0 { dv += k as f64 * self.place(&s.without(i), i, s, d.saturating_sub(1)); } }
        Some(dv / n as f64)
    }
    pub fn place(&mut self, s: &State, i: usize, sb: &State, d: u8) -> f64 {
        let c = COLOR[i];
        let (s2, boom) = self.placed(s, i, false);
        if c == b'W' {
            if boom { return self.term(&s2, true); }
            let mut val = self.v(&s2, d);
            if sb.flask { val = val.max(self.v(&Self::use_flask(sb), d)); }
            return val;
        }
        if c == b'Y' && s.lastw > 0 {
            let (s3, _) = self.placed(s, i, true);
            return self.v(&s2, d).max(self.v(&s3, d));
        }
        if c == b'B' { return self.blue(&s2, VALUE[i] as u32, d); }
        self.v(&s2, d)
    }
    fn blue(&mut self, s: &State, k: u32, d: u8) -> f64 {
        let key = (s.key(d), k as u8);
        if let Some(&v) = self.bmemo.get(&key) { return v; }
        let n = total(&s.bag);
        let k = k.min(n);
        let val = if k == 0 { self.v(s, d) } else {
            let mut out = vec![]; let mut cur = vec![];
            combos(&s.bag, k, 0, &mut cur, 1.0, &mut out);
            let den = comb(n, k);
            let mut val = 0.0;
            for (combo, ways) in out {
                let mut best = self.v(s, d);
                for &j in &combo { best = best.max(self.place(&s.without(j), j, s, d)); }
                val += ways / den * best;
            }
            val
        };
        self.bmemo.insert(key, val);
        val
    }
    /// For a crow-skull reveal: value of placing each revealed chip (or None = nothing).
    pub fn blue_pick_values(&mut self, s: &State, combo: &[usize]) -> Vec<(Option<usize>, f64)> {
        let d = self.depth;
        let mut out = vec![(None, self.v(s, d))];
        let mut seen = vec![];
        for &j in combo { if !seen.contains(&j) { seen.push(j); out.push((Some(j), self.place(&s.without(j), j, s, d))); } }
        out
    }
    pub fn should_draw(&mut self, s: &State) -> (bool, f64, Option<f64>) {
        let stop = self.stop_value(s);
        let draw = self.draw_value(s);
        (matches!(draw, Some(dv) if dv > stop), stop, draw)
    }
}
