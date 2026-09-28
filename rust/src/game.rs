//! Full 9-round self-play (mirrors ../game.py), in heuristic or learned mode.

use crate::data::*;
use crate::fortune::{self, Deck, Fortune};
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
    /// black-chip outcomes over the game, and chips drawn / bag size summed over the 9 brews
    pub black_drop: u32,
    pub black_ruby: u32,
    pub drawn: u32,
    pub bagsize: u32,
    /// black chips in the pot each round (opponent-model calibration)
    pub blacks_pot: [u8; 9],
}

pub struct Player { pub bag: Bag, pub droplet: i32, pub rubies: i32, pub vp: i32, pub flask: bool }

/// Draw chips with optimal in-round choices until stop/explode. Returns (state, exploded).
/// With Second Chances out, a 5th chip that did not explode is the once-only moment to start the round over.
pub fn brew_round(brew: &mut Brew, s0: State, rng: &mut Rng, trace: bool) -> (State, bool) {
    let mut s = s0;
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
        if s.mull && total(&s.bag) <= brew.mull_n {
            let restart = brew.restart_value();
            s.mull = false;
            let cont = { let d = brew.depth; brew.v(&s, d) };
            let again = restart > cont;
            if trace { println!("      second chances: continue {:.2} vs start over {:.2} -> {}", cont, restart, if again { "START OVER" } else { "continue" }); }
            if again { s = s0; s.mull = false; continue; }
        }
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
        let d = brew.depth;
        if sb.cb {
            // Cauldron Bubble: the first white may go back into the bag for free
            let mut keep = s2; keep.cb = false;
            let mut ret = *sb; ret.cb = false;
            let (vk, vr) = (brew.v(&keep, d), brew.v(&ret, d));
            if vr > vk {
                if trace { println!("      cauldron bubble: return {} (keep {:.2} vs return {:.2})", NAMES[i], vk, vr); }
                return (ret, false);
            }
            return (keep, false);
        }
        if sb.flask {
            let f = Brew::use_flask(sb);
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
    pub white: i32,
    pub drawn: u32,
    pub bagsize: u32,
}

/// Black chips in each neighbour's bag, from the neighbour model: the real bags in table mode, the
/// OPP schedule (expected blacks in a pot / the share of a bag a brew draws) when solo.
pub fn nb_bags(opps: Option<(u32, [f64; 2])>, rnd: u32) -> [f64; 2] {
    match opps {
        Some((_, mu)) => [mu[0] / crate::table::DRAW_SHARE, mu[1] / crate::table::DRAW_SHARE],
        None => [OPP.opp_black[rnd as usize] / crate::table::DRAW_SHARE; 2],
    }
}

/// The brewing context for round `rnd`: the seat's terminal (learned pay table or v1 rates), the
/// neighbour model, and the fortune card's rule if it is a blue card.
fn make_ctx(p: &Player, rnd: u32, model: Option<&Model>, margin: i32, stock: &Bag, opps: Option<(u32, [f64; 2])>, card: Option<Fortune>) -> Ctx {
    let term = match model { Some(m) => Terminal::Learned(pay_table(m, &p.bag, rnd, p.droplet, p.rubies, p.flask, margin, stock, nb_bags(opps, rnd))), None => Terminal::Heuristic };
    let mut ctx = match opps { Some((n, nb)) => Ctx::with_opps(rnd, term, n, Some(nb)), None => Ctx::new(rnd, term) };
    if let Some(c) = card { ctx.apply_fortune(c); }
    ctx
}

/// Value of brewing round `rnd` from `rats` spaces past the droplet, before any chip is drawn
/// (Good Start prices moving the rat stone back with this).
pub fn round_value(p: &Player, rnd: u32, model: Option<&Model>, depth: u8, rats: u32, margin: i32, stock: &Bag, opps: Option<(u32, [f64; 2])>) -> f64 {
    let ctx = make_ctx(p, rnd, model, margin, stock, opps, None);
    let mut brew = Brew::new(&ctx, p.bag, p.flask, depth);
    let s0 = brew.start(p.droplet, rats);
    brew.value(&s0)
}

/// Brew one round with optimal in-round choices. `rats` is the rat-tail head start.
/// `opps` = (number of neighbours, expected blacks in each neighbour's pot); None = the OPP model.
#[allow(clippy::too_many_arguments)]
pub fn brew_phase(p: &Player, rnd: u32, model: Option<&Model>, depth: u8, rats: u32, margin: i32, stock: &Bag, opps: Option<(u32, [f64; 2])>, card: Option<Fortune>, rng: &mut Rng, trace: bool) -> Brewed {
    let ctx = make_ctx(p, rnd, model, margin, stock, opps, card);
    let (s, exploded, n_p, n_k) = {
        let mut brew = Brew::new(&ctx, p.bag, p.flask, depth);
        let s0 = brew.start(p.droplet, rats);
        let (mut s, exploded) = brew_round(&mut brew, s0, rng, trace);
        if ctx.safety && !exploded && total(&s.bag) > 0 {
            // Safety Procedure: stopped without exploding -> reveal up to 5 chips, place the best one or none
            let k = total(&s.bag).min(5);
            let mut pool = s.bag; let mut revealed = vec![];
            for _ in 0..k { let j = rng.pick_chip(&pool); pool[j] -= 1; revealed.push(j); }
            let (pick, v) = brew.safety_pick(&s, &revealed);
            if trace {
                let shown: Vec<&str> = revealed.iter().map(|&j| NAMES[j]).collect();
                println!("    safety procedure reveals [{}] -> {} ({:.2})", shown.join(" "), pick.map(|j| NAMES[j]).unwrap_or("place none"), v);
            }
            if let Some(j) = pick { s = brew.placed(&s.without(j), j, false).0; }
        }
        (s, exploded, brew.n_p, brew.n_k)
    };
    let space = s.pos as usize + 1;
    let (coins, vp, ruby) = track_i(space);
    let b = Brewed { ctx, space, exploded, coins, vp, ruby, greens: s.g1 as i32 + s.g2 as i32, purples: n_p - s.bag[I_P] as i32, blacks: n_k - s.bag[I_K] as i32, flask: s.flask,
                     white: s.white as i32, drawn: total(&p.bag) - total(&s.bag), bagsize: total(&p.bag) };
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
/// explosion, the bonus die if `won_die`, and the round's blue fortune card. Returns the coins available for the shop.
pub fn settle_phase(p: &mut Player, b: &Brewed, black: (bool, bool), won_die: bool, stock: &mut Bag, rng: &mut Rng, trace: bool, res: &mut GameResult) -> i32 {
    let rnd = b.ctx.rnd;
    let (mut coins, mut vp) = (b.coins, b.vp);
    let mut rubies = b.ruby + b.greens + if b.ctx.fire_ruby { b.ruby } else { 0 };
    let mut extra = b.ctx.lucky_vp * b.ruby;
    if trace && b.ruby > 0 && (b.ctx.fire_ruby || b.ctx.lucky_vp > 0) { println!("    ruby space: {}", if b.ctx.fire_ruby { "fire burn, extra ruby" } else { "lucky devil, +2 VP" }); }
    if b.purples >= 3 { extra += 2; p.droplet += 1; } else if b.purples == 2 { extra += 1; rubies += 1; } else if b.purples == 1 { extra += 1; }
    if black.0 { p.droplet += 1; res.black_drop += 1; }
    if black.1 { rubies += 1; res.black_ruby += 1; }
    if !b.exploded && b.ctx.white7_drop && b.white == 7 { p.droplet += 1; if trace { println!("    bubbling over: exactly 7 whites -> droplet +1"); } }
    res.drawn += b.drawn; res.bagsize += b.bagsize;
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
        for _ in 0..(if b.ctx.die_twice { 2 } else { 1 }) {
            let face = DIE[rng.below(6) as usize];
            match face {
                0 => extra += 1, 1 => extra += 2, 2 => rubies += 1, 3 => p.droplet += 1,
                _ => if stock[I_O] > 0 { stock[I_O] -= 1; bag_after[I_O] += 1; },
            }
            if trace { println!("    bonus die: {}", ["+1 VP", "+2 VP", "ruby", "droplet", "orange chip"][face as usize]); }
        }
        res.die_wins += 1;
    } else if trace { println!("    bonus die: not won"); }
    if trace { println!("    round gain: {} VP (+{} from chips/die), {} rubies -> VP {}", vp, extra, rubies, p.vp + vp + extra); }
    p.vp += vp + extra;
    p.rubies += rubies;
    p.flask = b.flask || b.ctx.flask_free;
    if trace && b.ctx.flask_free && !b.flask { println!("    flask rabbit: flask refilled for free"); }
    p.bag = bag_after;
    res.spaces[rnd as usize - 1] = b.space as u8;
    res.exploded[rnd as usize - 1] = b.exploded;
    res.blacks_pot[rnd as usize - 1] = b.blacks as u8;
    coins
}

/// Shop (rounds 1-8) or cash out (round 9).
/// `black` is the black-chip preference from the seat's BlackRule (0 = the policy decides); `nb` = blacks in the neighbours' bags.
#[allow(clippy::too_many_arguments)]
pub fn shop_phase(p: &mut Player, rnd: u32, model: Option<&Model>, coins: i32, stock: &mut Bag, rng: &mut Rng, explore: f64, trace: bool, res: &mut GameResult, black: i8, nb: [f64; 2]) {
    if rnd < ROUNDS {
        match model {
            Some(m) => {
                let (mut opt, mut steps, mut refill, _) = best_shop_learned(m, &p.bag, coins, p.rubies, rnd, p.droplet, p.flask, stock, black, nb);
                let explored = explore > 0.0 && rng.f64() < explore;
                if explored {
                    // exploration: a random affordable purchase and a random ruby spend, so the value
                    // fit sees every colour and both flask states (otherwise the flask is never refilled
                    // and its coefficient collapses to zero)
                    let mut opts = purchase_options(&p.bag, coins, rnd, stock);
                    filter_black(&mut opts, black, coins, stock);
                    opt = opts[rng.below(opts.len() as u32) as usize].clone();
                    steps = rng.below((p.rubies / 2 + 1) as u32) as i32;
                    refill = !p.flask && p.rubies - 2 * steps >= 2 && rng.f64() < 0.5;
                }
                if trace {
                    let names: Vec<&str> = opt.iter().map(|&i| NAMES[i]).collect();
                    println!("    shop ({} coins, {} rubies): buy [{}]{}; droplet +{} refill {}", coins, p.rubies, names.join(" "),
                             if explored { " (exploration)" } else { "" }, steps, refill);
                }
                for &i in &opt { p.bag[i] += 1; res.bought[i] += 1; stock[i] -= 1; }
                p.droplet += steps; p.rubies -= 2 * steps; if refill { p.rubies -= 2; p.flask = true; }
            }
            None => {
                let ranked = best_purchase_heuristic(&p.bag, coins, rnd, p.droplet, p.flask, p.vp, stock, black);
                let pick = if explore > 0.0 && rng.f64() < explore { rng.below(ranked.len() as u32) as usize } else { 0 };
                for &i in &ranked[pick].0 { p.bag[i] += 1; res.bought[i] += 1; stock[i] -= 1; }
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

pub fn new_player() -> Player { Player { bag: starting_bag(), droplet: 0, rubies: START_RUBIES, vp: 0, flask: true } }
pub fn new_result() -> GameResult {
    GameResult { vp: 0, spaces: [0; 9], exploded: [false; 9], samples: vec![], bought: [0; N], vp_after: [0; 9], took_coins: [false; 9], final_bag: [0; N], rats: 0, die_wins: 0, won: false, others_r9: 0,
                 black_drop: 0, black_ruby: 0, drawn: 0, bagsize: 0, blacks_pot: [0; 9] }
}

pub fn trace_round_header(who: &str, rnd: u32, p: &Player, rats: u32, margin: i32) {
    println!("\n=== {}round {}  VP {} (margin {:+})  droplet {}  rats +{}  rubies {}  flask {}  bag: {}", who, rnd, p.vp, margin, p.droplet, rats, p.rubies, if p.flask { "full" } else { "empty" }, fmt_bag(&p.bag));
}

/// Single-player game against the modelled opponents (rat tails, bonus die, black chips all from data::OPP).
pub fn play_game(seed: u64, model: Option<&Model>, depth: u8, record: bool, explore: f64, trace: bool) -> GameResult {
    let mut rng = Rng::new(seed);
    let mut p = new_player();
    let mut res = new_result();
    // the modelled opponents buy nothing, so only this player's purchases deplete the supply
    let mut stock = initial_stock(OPP.n + 1);
    let mut deck = Deck::new(&mut rng);
    for rnd in 1..=ROUNDS {
        if rnd == EXTRA_WHITE_ROUND { p.bag[I_W1] += 1; }
        let leader = OPP.leader_vp[rnd as usize];
        let mut rats = if rnd >= 2 { rat_tails(p.vp, leader) } else { 0 };
        if trace { trace_round_header("", rnd, &p, rats, p.vp - leader); }
        // fortune-teller card: a purple card resolves now (the solo sim settles "fewest" comparisons against the modelled table)
        let card = deck.draw();
        if let Some(c) = card {
            if trace { println!("    fortune: {}", c.name()); }
            if c.immediate() {
                fortune::resolve_immediate(c, std::slice::from_mut(&mut p), &[model], rnd, depth, &mut stock, &[leader], std::slice::from_mut(&mut rats), &[None], true, std::slice::from_mut(&mut rng), trace);
            }
        }
        // solo samples carry no margin (VP objective); the OPP leader curve stands in for the table
        if record { res.samples.push(Sample { rnd, x: features(&p.bag, p.droplet, p.rubies, p.flask, 0, nb_bags(None, rnd)), vp_before: p.vp }); }
        let margin = p.vp - leader;
        if rnd == ROUNDS { res.others_r9 = leader; }
        res.rats += rats;
        let b = brew_phase(&p, rnd, model, depth, rats, margin, &stock, None, card, &mut rng, trace);
        let black = black_vs_model(&b, &mut rng);
        let won_die = !b.exploded && rng.f64() < b.ctx.p_win_die(b.space);
        let coins = settle_phase(&mut p, &b, black, won_die, &mut stock, &mut rng, trace, &mut res);
        // Toil and Trouble: the modelled neighbour on my right explodes with 1 - p_survive and hands me a 2-value chip
        if card == Some(Fortune::ToilAndTrouble) && rng.f64() < 1.0 - OPP.p_survive {
            if let Some(j) = fortune::best_two_token(model, &p, rnd + 1, p.vp - leader, &stock, nb_bags(None, rnd)) {
                p.bag[j] += 1; stock[j] -= 1;
                if trace { println!("    toil and trouble: right neighbour exploded -> {} added", NAMES[j]); }
            }
        }
        shop_phase(&mut p, rnd, model, coins, &mut stock, &mut rng, explore, trace, &mut res, 0, nb_bags(None, rnd));
    }
    res.vp = p.vp;
    res.final_bag = p.bag;
    res
}
