//! Table mode: 2-4 players at one table, each brewing with its own policy. Rat tails, the bonus
//! die and the black-chip comparison are settled from the players' *actual* results instead of
//! the modelled opponents in data::OPP. (Each player's in-round solver still uses OPP to price
//! the die and the black chip while brewing, since those outcomes are unknown until all pots stop.)
//! One fortune-teller deck per table: the round's card applies to every seat.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use crate::data::*;
use crate::fortune::{self, Deck, Fortune};
use crate::game::*;
use crate::model::{features, Model};
use crate::shop::{black_pref, BlackRule};

/// One seat's policy: None = v1 heuristic, Some = learned weights.
pub type Seat = Option<Arc<Model>>;

/// While brewing, price the black chip against the neighbours' real bags (their blacks x the share
/// of a bag that a brew typically draws) instead of the data::OPP schedule. `--opp-black schedule` turns it off.
pub static NB_ACTUAL: AtomicBool = AtomicBool::new(true);
/// Share of a bag drawn in a typical brew (measured: `drawn` column of `table`).
pub const DRAW_SHARE: f64 = 0.63;

/// Play one game at a table of `seats.len()` players (seated in order, so seats i-1 and i+1 are
/// the neighbours). Returns one result per seat; `won` is set for the highest final VP (ties: all).
pub fn play_table(seed: u64, seats: &[Seat], rules: &[BlackRule], depth: u8, record: bool, explore: f64, trace: bool) -> Vec<GameResult> {
    let n = seats.len();
    let nb_of = |ps: &Vec<Player>, i: usize| [ps[(i + n - 1) % n].bag[I_K], ps[(i + 1) % n].bag[I_K]];
    let opps_of = |ps: &Vec<Player>, i: usize| if NB_ACTUAL.load(Ordering::Relaxed) { let k = nb_of(ps, i); Some(((n - 1) as u32, [k[0] as f64 * DRAW_SHARE, k[1] as f64 * DRAW_SHARE])) } else { None };
    let others_of = |ps: &Vec<Player>, i: usize| (0..n).filter(|&j| j != i).map(|j| ps[j].vp).max().unwrap();
    let models: Vec<Option<&Model>> = seats.iter().map(|s| s.as_deref()).collect();
    let mut rngs: Vec<Rng> = (0..n).map(|i| Rng::new(seed * 4 + i as u64)).collect();
    let mut ps: Vec<Player> = (0..n).map(|_| new_player()).collect();
    let mut res: Vec<GameResult> = (0..n).map(|_| new_result()).collect();
    // one box of chips for the table; sold-out types leave the shop for everyone
    let mut stock = initial_stock(n as u32);
    let mut deck = Deck::new(&mut rngs[0]);
    for rnd in 1..=ROUNDS {
        for p in ps.iter_mut() { if rnd == EXTRA_WHITE_ROUND { p.bag[I_W1] += 1; } }
        // rat tails from the real leader; margin = my VP - best other seat's VP
        let leader = ps.iter().map(|p| p.vp).max().unwrap();
        let mut rats: Vec<u32> = (0..n).map(|i| if rnd >= 2 { rat_tails(ps[i].vp, leader) } else { 0 }).collect();
        // the round's fortune card: a purple card resolves for every seat before the rats are placed
        let card = deck.draw();
        if let Some(c) = card {
            if trace { println!("\n### round {} fortune: {}", rnd, c.name()); }
            if c.immediate() {
                let others: Vec<i32> = (0..n).map(|i| others_of(&ps, i)).collect();
                let opps: Vec<Option<(u32, [f64; 2])>> = (0..n).map(|i| opps_of(&ps, i)).collect();
                fortune::resolve_immediate(c, &mut ps, &models, rnd, depth, &mut stock, &others, &mut rats, &opps, false, &mut rngs, trace);
            }
        }
        let mut brewed = Vec::with_capacity(n);
        for i in 0..n {
            let others = others_of(&ps, i);
            let margin = ps[i].vp - others;
            if rnd == ROUNDS { res[i].others_r9 = others; }
            if record { let p = &ps[i]; let k = nb_of(&ps, i); res[i].samples.push(Sample { rnd, x: features(&p.bag, p.droplet, p.rubies, p.flask, margin, [k[0] as f64, k[1] as f64]), vp_before: p.vp }); }
            res[i].rats += rats[i];
            if trace { trace_round_header(&format!("P{} ", i + 1), rnd, &ps[i], rats[i], margin); }
            let opps = opps_of(&ps, i);
            brewed.push(brew_phase(&ps[i], rnd, models[i], depth, rats[i], margin, &stock, opps, card, &mut rngs[i], trace));
        }
        // everyone shops at once: black rules look at the bags as they were before this round's shopping
        let nbs: Vec<[u8; 2]> = (0..n).map(|i| nb_of(&ps, i)).collect();
        let mine: Vec<u8> = ps.iter().map(|p| p.bag[I_K]).collect();
        // bonus die: furthest non-exploded pot(s)
        let best = brewed.iter().filter(|b| !b.exploded).map(|b| b.space).max();
        let mut coins = vec![0; n];
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
            coins[i] = settle_phase(&mut ps[i], b, black, won_die, &mut stock, &mut rngs[i], trace, &mut res[i]);
        }
        // Toil and Trouble: an exploded pot hands the player to the left any 2-value chip (their policy picks it)
        if card == Some(Fortune::ToilAndTrouble) {
            for i in 0..n {
                if !brewed[i].exploded { continue; }
                let l = (i + n - 1) % n;
                let k = nb_of(&ps, l);
                if let Some(j) = fortune::best_two_token(models[l], &ps[l], rnd + 1, ps[l].vp - others_of(&ps, l), &stock, [k[0] as f64, k[1] as f64]) {
                    ps[l].bag[j] += 1; stock[j] -= 1;
                    if trace { println!("--- P{} exploded: toil and trouble gives P{} a {}", i + 1, l + 1, NAMES[j]); }
                }
            }
        }
        for i in 0..n {
            let pref = black_pref(rules[i], mine[i], if n == 2 { &nbs[i][..1] } else { &nbs[i][..] });
            shop_phase(&mut ps[i], rnd, models[i], coins[i], &mut stock, &mut rngs[i], explore, trace, &mut res[i], pref, [nbs[i][0] as f64, nbs[i][1] as f64]);
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
