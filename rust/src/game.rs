//! Full 9-round self-play (mirrors ../game.py), in heuristic or learned mode.

use crate::data::*;
use crate::model::{features, Model, NF};
use crate::shop::*;
use crate::solver::*;

pub struct Rng(u64);
impl Rng {
    pub fn new(seed: u64) -> Rng { Rng(seed.wrapping_mul(0x9E3779B97F4A7C15).wrapping_add(0xD1B54A32D192ED03) | 1) }
    pub fn next_u64(&mut self) -> u64 { let mut x = self.0; x ^= x << 13; x ^= x >> 7; x ^= x << 17; self.0 = x; x.wrapping_mul(0x2545F4914F6CDD1D) }
    pub fn f64(&mut self) -> f64 { (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64 }
    pub fn below(&mut self, n: u32) -> u32 { (self.f64() * n as f64) as u32 }
    pub fn pick_chip(&mut self, bag: &Bag) -> usize {
        let n = total(bag); let mut r = self.below(n);
        for i in 0..N { if r < bag[i] as u32 { return i; } r -= bag[i] as u32; }
        N - 1
    }
}

pub struct Sample { pub rnd: u32, pub x: [f64; NF], pub vp_before: i32 }

pub struct GameResult {
    pub vp: i32,
    pub spaces: [u8; 9],
    pub exploded: [bool; 9],
    pub samples: Vec<Sample>,
    pub bought: [u32; N],
    pub vp_after: [i32; 9],
    pub took_coins: [bool; 9],
    pub final_bag: Bag,
    /// rat tails received over the game, bonus-die rolls, and (table mode) whether this seat won
    pub rats: u32,
    pub die_wins: u32,
    pub won: bool,
    /// best other player's VP at the start of round 9 (table mode; OPP curve when solo)
    pub others_r9: i32,
}

pub struct Player { pub bag: Bag, pub droplet: i32, pub rubies: i32, pub vp: i32, pub flask: bool }

/// Draw chips with optimal in-round choices until stop/explode. Returns (state, exploded).
pub fn brew_round(brew: &mut Brew, mut s: State, rng: &mut Rng, trace: bool) -> (State, bool) {
    while total(&s.bag) > 0 {
        let (draw, stop, dv) = brew.should_draw(&s);
        if trace {
            println!("    pos {:2} white {}  p_explode {:.0}%  stop {:.2} vs draw {:.2} -> {}", s.pos, s.white,
                     100.0 * brew.explode_prob(&s), stop, dv.unwrap_or(0.0), if draw { "DRAW" } else { "STOP" });
        }
        if !draw { return (s, false); }
        let i = rng.pick_chip(&s.bag);
        let (s2, boom) = play_chip(brew, &s, i, rng, trace, "");
        s = s2;
        if boom { return (s, true); }
    }
    (s, false)
}

pub fn play_chip(brew: &mut Brew, sb: &State, i: usize, rng: &mut Rng, trace: bool, via: &str) -> (State, bool) {
    let s = sb.without(i);
    let c = COLOR[i];
    let (s2, boom) = brew.placed(&s, i, false);
    if trace { println!("      drew {}{} -> pos {} (white {}){}", NAMES[i], via, s2.pos, s2.white, if boom { "  EXPLODED" } else { "" }); }
    if c == b'W' {
        if boom { return (s2, true); }
        if sb.flask {
            let f = Brew::use_flask(sb);
            let d = brew.depth;
            let (vf, vk) = (brew.v(&f, d), brew.v(&s2, d));
            if vf > vk {
                if trace { println!("      flask: return {} (keep {:.2} vs flask {:.2})", NAMES[i], vk, vf); }
                return (f, false);
            }
        }
        return (s2, false);
    }
    if c == b'Y' && s.lastw > 0 {
        let (s3, _) = brew.placed(&s, i, true);
        let d = brew.depth;
        if brew.v(&s3, d) > brew.v(&s2, d) {
            if trace { println!("      mandrake: return W{} -> pos {} (white {})", s.lastw, s3.pos, s3.white); }
            return (s3, false);
        }
        return (s2, false);
    }
    if c == b'B' {
        let k = (VALUE[i] as u32).min(total(&s2.bag));
        let mut pool = s2.bag;
        let mut combo = vec![];
        for _ in 0..k { let j = rng.pick_chip(&pool); pool[j] -= 1; combo.push(j); }
        let vals = brew.blue_pick_values(&s2, &combo);
        let (pick, _) = vals.iter().fold((None, f64::NEG_INFINITY), |acc, &(p, v)| if v > acc.1 { (p, v) } else { acc });
        if trace {
            let shown: Vec<String> = combo.iter().map(|&j| NAMES[j].to_string()).collect();
            let opts: Vec<String> = vals.iter().map(|(p, v)| format!("{}={:.2}", p.map(|j| NAMES[j]).unwrap_or("none"), v)).collect();
            println!("      crow skull reveals [{}]: {} -> {}", shown.join(" "), opts.join(" "), pick.map(|j| NAMES[j]).unwrap_or("place none"));
        }
        return match pick { None => (s2, false), Some(j) => play_chip(brew, &s2, j, rng, trace, " (via crow skull)") };
    }
    (s2, false)
}

/// Everything a brew produced that the end-of-round phase needs. Nothing has been applied to the player yet.
pub struct Brewed {
    pub ctx: Ctx,
    pub space: usize,
    pub exploded: bool,
    pub coins: i32,
    pub vp: i32,
    pub ruby: i32,
    pub greens: i32,
    pub purples: i32,
    pub blacks: i32,
    pub flask: bool,
}

/// Brew one round with optimal in-round choices. `rats` is the rat-tail head start.
pub fn brew_phase(p: &Player, rnd: u32, model: Option<&Model>, depth: u8, rats: u32, margin: i32, rng: &mut Rng, trace: bool) -> Brewed {
    let term = match model { Some(m) => Terminal::Learned(pay_table(m, &p.bag, rnd, p.droplet, p.rubies, p.flask, margin)), None => Terminal::Heuristic };
    let ctx = Ctx::new(rnd, term);
    let (s, exploded, n_p, n_k) = {
        let mut brew = Brew::new(&ctx, p.bag, p.flask, depth);
        let s0 = brew.start(p.droplet, rats);
        let (s, exploded) = brew_round(&mut brew, s0, rng, trace);
        (s, exploded, brew.n_p, brew.n_k)
    };
    let space = s.pos as usize + 1;
    let (coins, vp, ruby) = track_i(space);
    let b = Brewed { ctx, space, exploded, coins, vp, ruby, greens: s.g1 as i32 + s.g2 as i32, purples: n_p - s.bag[I_P] as i32, blacks: n_k - s.bag[I_K] as i32, flask: s.flask };
    if trace {
        println!("    -> space {} ({}): {} coins, {} VP{}; purples {} blacks {} greens-in-last-two {}", space, if exploded { "EXPLODED" } else { "stopped" },
                 coins, vp, if ruby > 0 { ", ruby" } else { "" }, b.purples, b.blacks, b.greens);
    }
    b
}

/// Black-chip outcome against the modelled opponents (single-player sim): (droplet, ruby).
pub fn black_vs_model(b: &Brewed, rng: &mut Rng) -> (bool, bool) {
    if b.blacks == 0 { return (false, false); }
    let (pd, pr) = b.ctx.black_odds(b.blacks);
    let r = rng.f64();
    (r < pd, r < pr)
}

/// Apply a brewed round to the player: chip effects, the black outcome, keep-VP-or-coins on an
/// explosion, the bonus die if `won_die`. Returns the coins available for the shop.
pub fn settle_phase(p: &mut Player, b: &Brewed, black: (bool, bool), won_die: bool, rng: &mut Rng, trace: bool, res: &mut GameResult) -> i32 {
    let rnd = b.ctx.rnd;
    let (mut coins, mut vp) = (b.coins, b.vp);
    let mut rubies = b.ruby + b.greens;
    let mut extra = 0;
    if b.purples >= 3 { extra += 2; p.droplet += 1; } else if b.purples == 2 { extra += 1; rubies += 1; } else if b.purples == 1 { extra += 1; }
    if black.0 { p.droplet += 1; }
    if black.1 { rubies += 1; }
    let mut bag_after = p.bag;
    if b.exploded {
        // keep VP or coins: decide with the same valuation the solver used
        let take_vp = match &b.ctx.term {
            Terminal::Heuristic => vp as f64 >= coins as f64 * b.ctx.w_coin,
            // WIN model: sigmoid(g0 + a*(m0+vp)) >= sigmoid(gc + a*m0)  <=>  a*vp + g0 >= gc
            Terminal::Learned(t) => (if t.win { t.a } else { 1.0 }) * vp as f64 + t.get(0, rubies, 0, !b.flask) >= t.get(coins, rubies, 0, !b.flask),
        };
        if take_vp { coins = 0; } else { vp = 0; res.took_coins[rnd as usize - 1] = true; }
        if trace { println!("    exploded: keep {}", if take_vp { "VP" } else { "COINS" }); }
    } else if won_die {
        let face = DIE[rng.below(6) as usize];
        match face {
            0 => extra += 1, 1 => extra += 2, 2 => rubies += 1, 3 => p.droplet += 1, _ => bag_after[I_O] += 1,
        }
        res.die_wins += 1;
        if trace { println!("    bonus die: {}", ["+1 VP", "+2 VP", "ruby", "droplet", "orange chip"][face as usize]); }
    } else if trace { println!("    bonus die: not won"); }
    if trace { println!("    round gain: {} VP (+{} from chips/die), {} rubies -> VP {}", vp, extra, rubies, p.vp + vp + extra); }
    p.vp += vp + extra;
    p.rubies += rubies;
    p.flask = b.flask;
    p.bag = bag_after;
    res.spaces[rnd as usize - 1] = b.space as u8;
    res.exploded[rnd as usize - 1] = b.exploded;
    coins
}

/// Shop (rounds 1-8) or cash out (round 9).
pub fn shop_phase(p: &mut Player, rnd: u32, model: Option<&Model>, coins: i32, rng: &mut Rng, explore: f64, trace: bool, res: &mut GameResult) {
    if rnd < ROUNDS {
        match model {
            Some(m) => {
                let (mut opt, steps, refill, _) = best_shop_learned(m, &p.bag, coins, p.rubies, rnd, p.droplet, p.flask);
                if explore > 0.0 && rng.f64() < explore {
                    // exploration: a random affordable purchase, so the value fit sees every colour
                    let opts = purchase_options(&p.bag, coins, rnd);
                    opt = opts[rng.below(opts.len() as u32) as usize].clone();
                }
                if trace {
                    let (ranked, _, _, _) = best_shop_learned(m, &p.bag, coins, p.rubies, rnd, p.droplet, p.flask);
                    let names: Vec<&str> = opt.iter().map(|&i| NAMES[i]).collect();
                    println!("    shop ({} coins, {} rubies): buy [{}]{}; droplet +{} refill {}", coins, p.rubies, names.join(" "),
                             if ranked != opt { " (exploration)" } else { "" }, steps, refill);
                }
                for &i in &opt { p.bag[i] += 1; res.bought[i] += 1; }
                p.droplet += steps; p.rubies -= 2 * steps; if refill { p.rubies -= 2; p.flask = true; }
            }
            None => {
                let ranked = best_purchase_heuristic(&p.bag, coins, rnd, p.droplet, p.flask, p.vp);
                let pick = if explore > 0.0 && rng.f64() < explore { rng.below(ranked.len() as u32) as usize } else { 0 };
                for &i in &ranked[pick].0 { p.bag[i] += 1; res.bought[i] += 1; }
                let (d, f, r) = spend_rubies_heuristic(&p.bag, p.rubies, rnd, p.droplet, p.flask, p.vp);
                if trace {
                    let names: Vec<&str> = ranked[pick].0.iter().map(|&i| NAMES[i]).collect();
                    println!("    shop ({} coins, {} rubies): buy [{}]; droplet +{} refill {}", coins, p.rubies, names.join(" "), d - p.droplet, f && !p.flask);
                }
                p.droplet = d; p.flask = f; p.rubies = r;
            }
        }
    } else {
        if trace { println!("    final: {} coins -> {} VP, {} rubies -> {} VP", coins, coins / 5, p.rubies, p.rubies / 2); }
        p.vp += coins / 5 + p.rubies / 2;
        p.rubies %= 2;
    }
    res.vp_after[rnd as usize - 1] = p.vp;
}

pub fn new_player() -> Player { Player { bag: starting_bag(), droplet: 0, rubies: 0, vp: 0, flask: true } }
pub fn new_result() -> GameResult {
    GameResult { vp: 0, spaces: [0; 9], exploded: [false; 9], samples: vec![], bought: [0; N], vp_after: [0; 9], took_coins: [false; 9], final_bag: [0; N], rats: 0, die_wins: 0, won: false, others_r9: 0 }
}

pub fn trace_round_header(who: &str, rnd: u32, p: &Player, rats: u32, margin: i32) {
    println!("\n=== {}round {}  VP {} (margin {:+})  droplet {}  rats +{}  rubies {}  flask {}  bag: {}", who, rnd, p.vp, margin, p.droplet, rats, p.rubies, if p.flask { "full" } else { "empty" }, fmt_bag(&p.bag));
}

/// Single-player game against the modelled opponents (rat tails, bonus die, black chips all from data::OPP).
pub fn play_game(seed: u64, model: Option<&Model>, depth: u8, record: bool, explore: f64, trace: bool) -> GameResult {
    let mut rng = Rng::new(seed);
    let mut p = new_player();
    let mut res = new_result();
    for rnd in 1..=ROUNDS {
        if rnd == EXTRA_WHITE_ROUND { p.bag[I_W1] += 1; }
        // solo samples carry no margin (VP objective); the OPP leader curve stands in for the table
        if record { res.samples.push(Sample { rnd, x: features(&p.bag, p.droplet, p.rubies, p.flask, 0), vp_before: p.vp }); }
        let leader = OPP.leader_vp[rnd as usize];
        let rats = if rnd >= 2 { rat_tails(p.vp, leader) } else { 0 };
        let margin = p.vp - leader;
        if rnd == ROUNDS { res.others_r9 = leader; }
        res.rats += rats;
        if trace { trace_round_header("", rnd, &p, rats, margin); }
        let b = brew_phase(&p, rnd, model, depth, rats, margin, &mut rng, trace);
        let black = black_vs_model(&b, &mut rng);
        let won_die = !b.exploded && rng.f64() < b.ctx.p_win_die(b.space);
        let coins = settle_phase(&mut p, &b, black, won_die, &mut rng, trace, &mut res);
        shop_phase(&mut p, rnd, model, coins, &mut rng, explore, trace, &mut res);
    }
    res.vp = p.vp;
    res.final_bag = p.bag;
    res
}
