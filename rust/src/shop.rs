//! Shopping and ruby spending. Two modes:
//!  * heuristic (v1): score each purchase by next round's abstract-solver EV (mirrors shop.py)
//!  * learned: score by the whole-game value function V_{r+1}; also builds the PayTable that
//!    lets the brew solver value coins/rubies/droplet steps through the same V.

use std::sync::atomic::{AtomicU32, Ordering};

use crate::data::*;
use crate::model::Model;
use crate::solver::*;

/// Bitmask of chip types the shop may buy (`--only`); default: everything.
pub static ALLOW: AtomicU32 = AtomicU32::new(u32::MAX);
/// `--max-orange N`: no orange purchases once the bag holds N oranges (die oranges still count).
pub static MAX_ORANGE: AtomicU32 = AtomicU32::new(u32::MAX);
/// `--max-black N`: no black purchases once the bag holds N blacks.
pub static MAX_BLACK: AtomicU32 = AtomicU32::new(u32::MAX);
/// Black-chip buying rule layered over a seat's shop policy (table experiments, `--black`):
///   model    the value function decides (default)
///   none     never buys black
///   setN     buys a black whenever the bag holds fewer than N (`one` = set1)
///   arms     buys a black whenever a neighbour has at least as many as me (stay strictly ahead)
///   nb       buys a black only when it would beat a neighbour I currently tie with
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum BlackRule { Model, Never, Set(u8), Arms, Neighbour }
pub fn parse_black_rule(s: &str) -> BlackRule {
    let t = s.trim().to_lowercase();
    match t.as_str() {
        "model" | "" => BlackRule::Model,
        "none" | "never" => BlackRule::Never,
        "one" => BlackRule::Set(1),
        "arms" => BlackRule::Arms,
        "nb" | "neighbour" | "neighbor" => BlackRule::Neighbour,
        _ if t.starts_with("set") => BlackRule::Set(t[3..].parse().unwrap_or_else(|_| panic!("bad black rule {}", s))),
        _ => panic!("unknown black rule {} (model|none|setN|one|arms|nb)", s),
    }
}
pub fn black_rule_name(r: BlackRule) -> String {
    match r { BlackRule::Model => "model".into(), BlackRule::Never => "none".into(), BlackRule::Set(n) => format!("set{}", n), BlackRule::Arms => "arms".into(), BlackRule::Neighbour => "nb".into() }
}
/// +1 = this shop's buy must include a black (when affordable and in stock), -1 = no black, 0 = free choice
pub fn black_pref(rule: BlackRule, mine: u8, nb: &[u8]) -> i8 {
    match rule {
        BlackRule::Model => 0,
        BlackRule::Never => -1,
        BlackRule::Set(n) => if mine < n { 1 } else { -1 },
        BlackRule::Arms => if nb.iter().any(|&k| k >= mine) { 1 } else { -1 },
        BlackRule::Neighbour => if nb.iter().any(|&k| k == mine) { 1 } else { -1 },
    }
}
/// Drop the buys a black preference rules out (a forced black only applies when one is affordable).
pub fn filter_black(opts: &mut Vec<Vec<usize>>, pref: i8, coins: i32, stock: &Bag) {
    if pref < 0 { opts.retain(|o| !o.contains(&I_K)); }
    else if pref > 0 && coins >= PRICE[I_K] && stock[I_K] > 0 { opts.retain(|o| o.contains(&I_K)); }
}

/// `--only B` (colours) or `--only B2,B4,O` (chip names and/or colours), comma separated.
pub fn set_only(spec: &str) {
    let mut m = 0u32;
    for tok in spec.to_uppercase().split(',').map(|t| t.trim()).filter(|t| !t.is_empty()) {
        for i in 0..N {
            if tok == NAMES[i] || (tok.len() == 1 && tok.as_bytes()[0] == COLOR[i]) { m |= 1 << i; }
        }
    }
    ALLOW.store(m, Ordering::Relaxed);
}

/// Every legal buy: 0, 1 or 2 chips of different colours, affordable, unlocked, and still in `stock`.
pub fn purchase_options(bag: &Bag, coins: i32, rnd: u32, stock: &Bag) -> Vec<Vec<usize>> {
    let mut allow = ALLOW.load(Ordering::Relaxed);
    if bag[I_O] as u32 >= MAX_ORANGE.load(Ordering::Relaxed) { allow &= !(1 << I_O); }
    if bag[I_K] as u32 >= MAX_BLACK.load(Ordering::Relaxed) { allow &= !(1 << I_K); }
    let avail: Vec<usize> = (0..N).filter(|&i| PRICE[i] > 0 && stock[i] > 0 && (allow >> i) & 1 == 1 && unlock_round(COLOR[i]) <= rnd + 1 && PRICE[i] <= coins).collect();
    let mut opts = vec![vec![]];
    for &i in &avail { opts.push(vec![i]); }
    for a in 0..avail.len() { for b in a + 1..avail.len() {
        let (i, j) = (avail[a], avail[b]);
        if COLOR[i] != COLOR[j] && PRICE[i] + PRICE[j] <= coins { opts.push(vec![i, j]); }
    } }
    opts
}
pub fn cost(opt: &[usize]) -> i32 { opt.iter().map(|&i| PRICE[i]).sum() }
fn apply(bag: &Bag, opt: &[usize]) -> Bag { let mut b = *bag; for &i in opt { b[i] += 1; } b }

// ------------------------------------------------------------------ heuristic (v1) mode
fn next_round_ev(bag: &Bag, droplet: i32, flask: bool, ctx: &Ctx, abs: &mut Abstract, my_vp: i32) -> f64 {
    let rats = if ctx.rnd >= 2 { rat_tails(my_vp, OPP.leader_vp[ctx.rnd as usize]) } else { 0 };
    let mut b = Brew::new(ctx, *bag, flask, 0);
    std::mem::swap(&mut b.abs, abs);
    let s = b.start(droplet, rats);
    let v = b.value(&s);
    std::mem::swap(&mut b.abs, abs);
    v
}

/// Value of brewing round `rnd` at the v1 rates from the droplet (with the round's rat tails):
/// the heuristic's state value when a fortune card offers a choice.
pub fn heuristic_state_value(bag: &Bag, droplet: i32, flask: bool, rnd: u32, my_vp: i32) -> f64 {
    let ctx = Ctx::new(rnd, Terminal::Heuristic);
    let mut abs = Abstract::new();
    next_round_ev(bag, droplet, flask, &ctx, &mut abs, my_vp)
}

/// (purchase, ev) ranked best first — v1 method
pub fn best_purchase_heuristic(bag: &Bag, coins: i32, rnd: u32, droplet: i32, flask: bool, my_vp: i32, stock: &Bag, black: i8) -> Vec<(Vec<usize>, f64)> {
    let ctx = Ctx::new(rnd + 1, Terminal::Heuristic);
    let mut abs = Abstract::new();
    let mut opts = purchase_options(bag, coins, rnd, stock);
    filter_black(&mut opts, black, coins, stock);
    let mut scored: Vec<(Vec<usize>, f64)> = vec![];
    for o in opts.iter().filter(|o| o.len() <= 1) {
        scored.push((o.clone(), next_round_ev(&apply(bag, o), droplet, flask, &ctx, &mut abs, my_vp)));
    }
    let mut singles: Vec<&(Vec<usize>, f64)> = scored.iter().filter(|(o, _)| o.len() == 1).collect();
    singles.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
    let good: Vec<usize> = singles.iter().take(5).map(|(o, _)| o[0]).collect();
    for o in opts.iter().filter(|o| o.len() == 2 && good.contains(&o[0]) && good.contains(&o[1])) {
        scored.push((o.clone(), next_round_ev(&apply(bag, o), droplet, flask, &ctx, &mut abs, my_vp)));
    }
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
    scored
}

/// v1 ruby spending: returns (droplet, flask, rubies)
pub fn spend_rubies_heuristic(bag: &Bag, mut rubies: i32, rnd: u32, mut droplet: i32, mut flask: bool, my_vp: i32) -> (i32, bool, i32) {
    if rnd >= ROUNDS { return (droplet, flask, rubies); }
    let ctx = Ctx::new(rnd + 1, Terminal::Heuristic);
    let mut abs = Abstract::new();
    let left = (ROUNDS - rnd) as f64;
    let hold = 2.0 * W_RUBY[rnd as usize + 1];
    while rubies >= 2 {
        let base = next_round_ev(bag, droplet, flask, &ctx, &mut abs, my_vp);
        let gd = (next_round_ev(bag, droplet + 1, flask, &ctx, &mut abs, my_vp) - base) * left;
        let gf = if flask { 0.0 } else { next_round_ev(bag, droplet, true, &ctx, &mut abs, my_vp) - base };
        let best = gd.max(gf).max(hold);
        if best == hold { break; }
        rubies -= 2;
        if best == gd { droplet += 1; } else { flask = true; }
    }
    (droplet, flask, rubies)
}

// ------------------------------------------------------------------ learned mode
/// Best use of `coins` and `rubies` after round `rnd`, scored by V_{rnd+1}.
/// Returns (purchase, droplet steps bought, refill flask, value).
#[allow(clippy::too_many_arguments)]
pub fn best_shop_learned(model: &Model, bag: &Bag, coins: i32, rubies: i32, rnd: u32, droplet: i32, flask: bool, stock: &Bag, black: i8, nb: [f64; 2]) -> (Vec<usize>, i32, bool, f64) {
    if rnd >= ROUNDS {
        // game over: coins and rubies convert to VP (WIN model: the game-end logit without the margin term)
        let cash = (coins / 5 + rubies / 2) as f64;
        let v = if model.win { model.coef[10][0] + model.margin_coef(10) * cash } else { cash };
        return (vec![], 0, false, v);
    }
    let next = rnd + 1;
    let mut opts = purchase_options(bag, coins, rnd, stock);
    filter_black(&mut opts, black, coins, stock);
    let mut best = (vec![], 0, false, f64::NEG_INFINITY);
    for o in &opts {
        let b = apply(bag, o);
        let max_steps = rubies / 2;
        for steps in 0..=max_steps {
            for refill in [false, true] {
                if refill && (flask || rubies - 2 * steps < 2) { continue; }
                let left = rubies - 2 * steps - if refill { 2 } else { 0 };
                let v = model.value_state(next, &b, droplet + steps, left, flask || refill, nb);
                if v > best.3 { best = (o.clone(), steps, refill, v); }
            }
        }
    }
    best
}

/// PayTable for brewing round `rnd` with the learned model: for each (coins, rubies gained,
/// droplet steps gained, flask used) the value of the best shop + ruby spend from that outcome.
#[allow(clippy::too_many_arguments)]
pub fn pay_table(model: &Model, bag: &Bag, rnd: u32, droplet: i32, rubies: i32, flask_full: bool, margin: i32, stock: &Bag, nb: [f64; 2]) -> PayTable {
    let mut g = vec![0.0; PayTable::len()];
    for c in 0..36usize {
        for r in 0..=RUBMAX {
            for d in 0..=DDMAX {
                for fu in 0..2usize {
                    let flask_now = flask_full && fu == 0;
                    let (_, _, _, v) = best_shop_learned(model, bag, c as i32, rubies + r as i32, rnd, droplet + d as i32, flask_now, stock, 0, nb);
                    g[PayTable::index(c, r, d, fu)] = v;
                }
            }
        }
    }
    let d_orange = if rnd >= ROUNDS { 0.0 } else {
        let mut b2 = *bag; b2[I_O] += 1;
        model.value_state(rnd + 1, &b2, droplet, rubies, flask_full, nb) - model.value_state(rnd + 1, bag, droplet, rubies, flask_full, nb)
    };
    let (a, m0) = if model.win { (model.margin_coef(rnd + 1), margin as f64 - model.opp_gain[rnd as usize]) } else { (0.0, 0.0) };
    PayTable { g, d_orange, win: model.win, a, m0 }
}
