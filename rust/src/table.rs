//! Table mode: 2-4 players at one table, each brewing with its own policy. Rat tails, the bonus
//! die and the black-chip comparison are settled from the players' *actual* results instead of
//! the modelled opponents in data::OPP. (Each player's in-round solver still uses OPP to price
//! the die and the black chip while brewing, since those outcomes are unknown until all pots stop.)

use std::sync::Arc;

use crate::data::*;
use crate::game::*;
use crate::model::{features, Model};

/// One seat's policy: None = v1 heuristic, Some = learned weights.
pub type Seat = Option<Arc<Model>>;

/// Play one game at a table of `seats.len()` players (seated in order, so seats i-1 and i+1 are
/// the neighbours). Returns one result per seat; `won` is set for the highest final VP (ties: all).
pub fn play_table(seed: u64, seats: &[Seat], depth: u8, record: bool, explore: f64, trace: bool) -> Vec<GameResult> {
    let n = seats.len();
    let mut rngs: Vec<Rng> = (0..n).map(|i| Rng::new(seed * 4 + i as u64)).collect();
    let mut ps: Vec<Player> = (0..n).map(|_| new_player()).collect();
    let mut res: Vec<GameResult> = (0..n).map(|_| new_result()).collect();
    for rnd in 1..=ROUNDS {
        // rat tails from the real leader; margin = my VP - best other seat's VP
        let leader = ps.iter().map(|p| p.vp).max().unwrap();
        let mut brewed = Vec::with_capacity(n);
        for i in 0..n {
            if rnd == EXTRA_WHITE_ROUND { ps[i].bag[I_W1] += 1; }
            let others = (0..n).filter(|&j| j != i).map(|j| ps[j].vp).max().unwrap();
            let margin = ps[i].vp - others;
            if rnd == ROUNDS { res[i].others_r9 = others; }
            if record { let p = &ps[i]; res[i].samples.push(Sample { rnd, x: features(&p.bag, p.droplet, p.rubies, p.flask, margin), vp_before: p.vp }); }
            let rats = if rnd >= 2 { rat_tails(ps[i].vp, leader) } else { 0 };
            res[i].rats += rats;
            if trace { trace_round_header(&format!("P{} ", i + 1), rnd, &ps[i], rats, margin); }
            brewed.push(brew_phase(&ps[i], rnd, seats[i].as_deref(), depth, rats, margin, &mut rngs[i], trace));
        }
        // bonus die: furthest non-exploded pot(s)
        let best = brewed.iter().filter(|b| !b.exploded).map(|b| b.space).max();
        for i in 0..n {
            let b = &brewed[i];
            // black chip: more than both neighbours -> droplet + ruby; more than one -> droplet.
            // (2 players: one neighbour, a tie still gives the droplet, as in the OPP model.)
            let black = if b.blacks == 0 { (false, false) } else if n == 2 {
                let o = brewed[1 - i].blacks;
                (b.blacks >= o, b.blacks > o)
            } else {
                let beaten = [brewed[(i + n - 1) % n].blacks, brewed[(i + 1) % n].blacks].iter().filter(|&&o| b.blacks > o).count();
                (beaten >= 1, beaten == 2)
            };
            let won_die = !b.exploded && Some(b.space) == best;
            if trace { println!("--- P{} round {} settle: space {}{} blacks {} -> black ({}), die {}", i + 1, rnd, b.space, if b.exploded { " (exploded)" } else { "" }, b.blacks,
                                match black { (true, true) => "droplet+ruby", (true, false) => "droplet", _ => "nothing" }, if won_die { "ROLLS" } else { "no" }); }
            let coins = settle_phase(&mut ps[i], b, black, won_die, &mut rngs[i], trace, &mut res[i]);
            shop_phase(&mut ps[i], rnd, seats[i].as_deref(), coins, &mut rngs[i], explore, trace, &mut res[i]);
        }
    }
    let top = ps.iter().map(|p| p.vp).max().unwrap();
    for i in 0..n {
        res[i].vp = ps[i].vp;
        res[i].final_bag = ps[i].bag;
        res[i].won = ps[i].vp == top;
    }
    res
}
