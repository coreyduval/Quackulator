//! Fortune-teller cards (24). One is drawn at the start of every round, from a deck shuffled once
//! per game. Blue cards change the rules of the round (wired into the brew solver through `Ctx`,
//! the in-round choices in game.rs and the settlement); purple cards are resolved immediately,
//! with every choice ranked by the seat's own value function.

use std::sync::atomic::{AtomicU8, Ordering};

use crate::data::*;
use crate::game::{nb_bags, round_value, Player, Rng};
use crate::model::{features, Model};
use crate::shop;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Fortune {
    // blue: rule for the round
    BubblingOver, ToilAndTrouble, SecondChances, DoubleDouble, PortentousPotables, PumpkinParty,
    SafetyProcedure, LuckyDevil, FlaskRabbit, CauldronBubble, FireBurn,
    // purple: immediate effect
    ChoicesChoices, DropIt, WheelingAndDealing, Charity, BeginnersLuck, BoomberryCleanse, Infestation,
    LessIsMore, GoodStart, RatATat, DecisionsDecisions, TakeAChance, FleaMarket,
}
use Fortune::*;

pub const ALL: [Fortune; 24] = [
    BubblingOver, ToilAndTrouble, SecondChances, DoubleDouble, PortentousPotables, PumpkinParty,
    SafetyProcedure, LuckyDevil, FlaskRabbit, CauldronBubble, FireBurn,
    ChoicesChoices, DropIt, WheelingAndDealing, Charity, BeginnersLuck, BoomberryCleanse, Infestation,
    LessIsMore, GoodStart, RatATat, DecisionsDecisions, TakeAChance, FleaMarket,
];

impl Fortune {
    pub fn name(self) -> &'static str {
        match self {
            BubblingOver => "Bubbling Over", ToilAndTrouble => "Toil and Trouble", SecondChances => "Second Chances",
            DoubleDouble => "Double Double", PortentousPotables => "Portentous Potables", PumpkinParty => "Pumpkin Party",
            SafetyProcedure => "Safety Procedure", LuckyDevil => "Lucky Devil", FlaskRabbit => "Flask Rabbit",
            CauldronBubble => "Cauldron Bubble", FireBurn => "Fire Burn",
            ChoicesChoices => "Choices, Choices", DropIt => "Drop It", WheelingAndDealing => "Wheeling and Dealing",
            Charity => "Charity", BeginnersLuck => "Beginner's Luck", BoomberryCleanse => "Boomberry Cleanse",
            Infestation => "Infestation", LessIsMore => "Less is More", GoodStart => "Good Start", RatATat => "Rat-a-Tat",
            DecisionsDecisions => "Decisions, Decisions", TakeAChance => "Take a Chance", FleaMarket => "Flea Market",
        }
    }
    /// purple card: resolved at the start of the round, before the rats are placed
    pub fn immediate(self) -> bool { ALL.iter().position(|&c| c == self).unwrap() >= 11 }
    pub fn parse(s: &str) -> Option<Fortune> {
        let key = |t: &str| t.to_lowercase().chars().filter(|c| c.is_alphanumeric()).collect::<String>();
        let k = key(s);
        if k.is_empty() { return None; }
        ALL.iter().copied().find(|c| key(c.name()) == k || key(c.name()).starts_with(&k))
    }
}

/// `--fortune deck` (default: shuffled deck, one card per round), `off` (no cards), or a card name (that card every round)
const MODE_DECK: u8 = 255;
const MODE_OFF: u8 = 254;
pub static MODE: AtomicU8 = AtomicU8::new(MODE_DECK);
pub fn set_mode(s: &str) {
    let t = s.trim().to_lowercase();
    let m = match t.as_str() {
        "deck" | "on" | "" => MODE_DECK,
        "off" | "none" => MODE_OFF,
        _ => { let c = Fortune::parse(&t).unwrap_or_else(|| panic!("unknown fortune card {}", s)); ALL.iter().position(|&x| x == c).unwrap() as u8 }
    };
    MODE.store(m, Ordering::Relaxed);
}
pub fn mode_name() -> String {
    match MODE.load(Ordering::Relaxed) { MODE_DECK => "deck".into(), MODE_OFF => "off".into(), m => ALL[m as usize].name().into() }
}

/// The game's deck: all 24 cards shuffled, one drawn per round.
pub struct Deck(Vec<Fortune>);
impl Deck {
    pub fn new(rng: &mut Rng) -> Deck {
        if MODE.load(Ordering::Relaxed) != MODE_DECK { return Deck(vec![]); }   // leave the random stream untouched
        let mut d = ALL.to_vec();
        for i in (1..d.len()).rev() { let j = rng.below(i as u32 + 1) as usize; d.swap(i, j); }
        Deck(d)
    }
    pub fn draw(&mut self) -> Option<Fortune> {
        match MODE.load(Ordering::Relaxed) { MODE_OFF => None, MODE_DECK => self.0.pop(), m => Some(ALL[m as usize]) }
    }
}

/// The next-higher chip of the same colour (Flea Market), if there is one.
pub fn next_value(i: usize) -> Option<usize> {
    (0..N).filter(|&j| COLOR[j] == COLOR[i] && VALUE[j] > VALUE[i]).min_by_key(|&j| VALUE[j])
}

/// Value of a start-of-round state under the seat's policy, used to rank a card's options:
/// the learned V_rnd (a WIN model folds `vp_gain` into the margin; a VP model adds it), or for the
/// heuristic this round's brew EV from the droplet plus rubies at the round's exchange rate.
#[allow(clippy::too_many_arguments)]
pub fn state_value(model: Option<&Model>, rnd: u32, bag: &Bag, droplet: i32, rubies: i32, flask: bool, margin: i32, vp_gain: i32, my_vp: i32, nb: [f64; 2]) -> f64 {
    match model {
        // V_1 is fitted on identical start states (a constant), so round-1 choices are ranked one round ahead
        Some(m) => { let v = m.value(rnd.max(2), &features(bag, droplet, rubies, flask, margin + vp_gain, nb)); if m.win { v } else { v + vp_gain as f64 } }
        None => shop::heuristic_state_value(bag, droplet, flask, rnd, my_vp + vp_gain) + rubies as f64 * W_RUBY[rnd as usize] + vp_gain as f64,
    }
}

/// Best 2-value chip to receive (Toil and Trouble, valued at the *next* round); None once the game is over or nothing is in stock.
pub fn best_two_token(model: Option<&Model>, p: &Player, rnd_next: u32, margin: i32, stock: &Bag, nb: [f64; 2]) -> Option<usize> {
    if rnd_next > ROUNDS { return None; }
    let mut best: Option<(usize, f64)> = None;
    for i in (0..N).filter(|&i| VALUE[i] == 2 && COLOR[i] != b'W' && stock[i] > 0) {
        let mut b = p.bag; b[i] += 1;
        let v = state_value(model, rnd_next, &b, p.droplet, p.rubies, p.flask, margin, 0, p.vp, nb);
        if best.map_or(true, |(_, bv)| v > bv) { best = Some((i, v)); }
    }
    best.map(|(i, _)| i)
}

fn roll_die(p: &mut Player, stock: &mut Bag, rng: &mut Rng, trace: bool, who: &str) {
    let face = DIE[rng.below(6) as usize];
    match face {
        0 => p.vp += 1, 1 => p.vp += 2, 2 => p.rubies += 1, 3 => p.droplet += 1,
        _ => if stock[I_O] > 0 { stock[I_O] -= 1; p.bag[I_O] += 1; },
    }
    if trace { println!("    {}bonus die: {}", who, ["+1 VP", "+2 VP", "ruby", "droplet", "orange chip"][face as usize]); }
}

fn draw_some(bag: &Bag, k: u32, rng: &mut Rng) -> (Vec<usize>, i32) {
    let mut pool = *bag; let mut out = vec![];
    for _ in 0..k.min(total(bag)) { let j = rng.pick_chip(&pool); pool[j] -= 1; out.push(j); }
    let sum = out.iter().map(|&j| VALUE[j] as i32).sum();
    (out, sum)
}

/// Resolve a purple card at the start of round `rnd` for every seat. `others[i]` = the best other
/// player's VP (margin base and, solo, the leader); `rats[i]` is adjusted in place (Infestation,
/// Good Start, and recomputed after a VP gain). `solo` = the single-player sim, where the
/// table-wide comparisons are settled against the modelled opponents.
#[allow(clippy::too_many_arguments)]
pub fn resolve_immediate(card: Fortune, ps: &mut [Player], seats: &[Option<&Model>], rnd: u32, depth: u8, stock: &mut Bag, others: &[i32],
                         rats: &mut [u32], opps: &[Option<(u32, [f64; 2])>], solo: bool, rngs: &mut [Rng], trace: bool) {
    let n = ps.len();
    let who = |i: usize| if n > 1 { format!("P{} ", i + 1) } else { String::new() };
    match card {
        DropIt => for (i, p) in ps.iter_mut().enumerate() { p.droplet += 1; if trace { println!("    {}droplet +1 -> {}", who(i), p.droplet); } },
        Infestation => for i in 0..n { rats[i] *= 2; if trace { println!("    {}rat tails doubled -> {}", who(i), rats[i]); } },
        Charity => {
            let least = ps.iter().map(|p| p.rubies).min().unwrap();
            for (i, p) in ps.iter_mut().enumerate() {
                let gets = if solo { p.rubies <= 1 } else { p.rubies == least };
                if gets { p.rubies += 1; }
                if trace { println!("    {}{}", who(i), if gets { "fewest rubies: +1 ruby" } else { "not the fewest rubies" }); }
            }
        }
        BeginnersLuck => {
            let least = ps.iter().map(|p| p.vp).min().unwrap();
            for (i, p) in ps.iter_mut().enumerate() {
                let gets = if solo { rnd == 1 || p.vp + 3 < others[i] } else { p.vp == least };
                if gets && stock[4] > 0 { stock[4] -= 1; p.bag[4] += 1; }
                if trace { println!("    {}{}", who(i), if gets { "fewest VP: green 1 added" } else { "not the fewest VP" }); }
            }
        }
        LessIsMore => {
            let sums: Vec<i32> = (0..n).map(|i| draw_some(&ps[i].bag, 5, &mut rngs[i]).1).collect();
            let least = *sums.iter().min().unwrap();
            for i in 0..n {
                let lowest = if solo { sums[i] <= 6 } else { sums[i] == least };
                if lowest { if stock[8] > 0 { stock[8] -= 1; ps[i].bag[8] += 1; } } else { ps[i].rubies += 1; }
                if trace { println!("    {}drew 5 summing {}: {}", who(i), sums[i], if lowest { "lowest, blue 2 added" } else { "+1 ruby" }); }
            }
        }
        TakeAChance => for i in 0..n { let w = who(i); roll_die(&mut ps[i], stock, &mut rngs[i], trace, &w); },
        _ => {
            for i in 0..n {
                let model = seats[i];
                let margin = ps[i].vp - others[i];
                let p0 = Player { bag: ps[i].bag, droplet: ps[i].droplet, rubies: ps[i].rubies, vp: ps[i].vp, flask: ps[i].flask };
                let with = |bag: &Bag, j: usize| { let mut b = *bag; b[j] += 1; b };
                // candidate outcomes: (label, bag, droplet, rubies gained, vp gained)
                let mut cands: Vec<(String, Bag, i32, i32, i32)> = vec![];
                match card {
                    ChoicesChoices => {
                        if stock[I_K] > 0 { cands.push(("black".into(), with(&p0.bag, I_K), p0.droplet, 0, 0)); }
                        for j in (0..N).filter(|&j| VALUE[j] == 2 && COLOR[j] != b'W' && stock[j] > 0) { cands.push((NAMES[j].into(), with(&p0.bag, j), p0.droplet, 0, 0)); }
                        cands.push(("3 rubies".into(), p0.bag, p0.droplet, 3, 0));
                    }
                    WheelingAndDealing => {
                        cands.push(("keep the ruby".into(), p0.bag, p0.droplet, 0, 0));
                        if p0.rubies >= 1 { for j in (0..N).filter(|&j| VALUE[j] == 1 && !matches!(COLOR[j], b'W' | b'P' | b'K') && stock[j] > 0) { cands.push((format!("ruby -> {}", NAMES[j]), with(&p0.bag, j), p0.droplet, -1, 0)); } }
                    }
                    BoomberryCleanse => {
                        cands.push(("+4 VP".into(), p0.bag, p0.droplet, 0, 4));
                        if p0.bag[I_W1] > 0 { let mut b = p0.bag; b[I_W1] -= 1; cands.push(("remove a white 1".into(), b, p0.droplet, 0, 0)); }
                    }
                    RatATat => {
                        for j in (0..N).filter(|&j| VALUE[j] == 4 && stock[j] > 0) { cands.push((NAMES[j].into(), with(&p0.bag, j), p0.droplet, 0, 0)); }
                        cands.push((format!("{} VP (rat tails)", rats[i]), p0.bag, p0.droplet, 0, rats[i] as i32));
                    }
                    DecisionsDecisions => {
                        cands.push(("droplet +2".into(), p0.bag, p0.droplet + 2, 0, 0));
                        if stock[I_P] > 0 { cands.push(("purple".into(), with(&p0.bag, I_P), p0.droplet, 0, 0)); }
                    }
                    FleaMarket => {
                        let (drawn, _) = draw_some(&p0.bag, 4, &mut rngs[i]);
                        let mut seen = vec![];
                        for &j in &drawn {
                            if seen.contains(&j) { continue; } seen.push(j);
                            if let Some(k) = next_value(j) { if stock[k] > 0 { let mut b = p0.bag; b[j] -= 1; b[k] += 1; cands.push((format!("{} -> {}", NAMES[j], NAMES[k]), b, p0.droplet, 0, 0)); } }
                        }
                        if trace { println!("    {}flea market draw: {}", who(i), drawn.iter().map(|&j| NAMES[j]).collect::<Vec<_>>().join(" ")); }
                        if cands.is_empty() { if stock[4] > 0 { cands.push(("no upgrade possible: green 1".into(), with(&p0.bag, 4), p0.droplet, 0, 0)); } }
                        else { cands.push(("no trade".into(), p0.bag, p0.droplet, 0, 0)); }
                    }
                    GoodStart => {
                        // move the rat stone back k spaces for k rubies: value this round's brew from the shorter start
                        let kmax = rats[i].min(3);
                        let mut best = (0u32, f64::NEG_INFINITY);
                        for k in 0..=kmax {
                            let q = Player { bag: p0.bag, droplet: p0.droplet, rubies: p0.rubies + k as i32, vp: p0.vp, flask: p0.flask };
                            let v = round_value(&q, rnd, model, depth, rats[i] - k, margin, stock, opps[i]);
                            if trace { println!("    {}rat stone back {} for {} rubies: {:.3}", who(i), k, k, v); }
                            if v > best.1 { best = (k, v); }
                        }
                        ps[i].rubies += best.0 as i32; rats[i] -= best.0;
                        if trace { println!("    {}good start: back {} -> rats {} rubies {}", who(i), best.0, rats[i], ps[i].rubies); }
                        continue;
                    }
                    _ => unreachable!(),
                }
                if cands.is_empty() { continue; }
                let nb = nb_bags(opps[i], rnd);
                let scored: Vec<f64> = cands.iter().map(|(_, b, d, r, v)| state_value(model, rnd, b, *d, p0.rubies + r, p0.flask, margin, *v, p0.vp, nb)).collect();
                let best = (0..cands.len()).fold(0, |a, k| if scored[k] > scored[a] { k } else { a });
                if trace { println!("    {}{}: {}", who(i), card.name(), cands.iter().zip(&scored).map(|((l, ..), v)| format!("{} {:.3}", l, v)).collect::<Vec<_>>().join(" | ")); }
                let (label, bag, droplet, rub, vp) = cands[best].clone();
                for j in 0..N { if bag[j] > p0.bag[j] { stock[j] -= bag[j] - p0.bag[j]; } }
                let p = &mut ps[i];
                p.bag = bag; p.droplet = droplet; p.rubies += rub; p.vp += vp;
                if trace { println!("    {}-> {}", who(i), label); }
            }
            if matches!(card, BoomberryCleanse | RatATat) {
                // VP moved on the track: the rat tails for this round follow
                let top = ps.iter().map(|p| p.vp).max().unwrap();
                for i in 0..n { let leader = if solo { others[i] } else { top }; rats[i] = if rnd >= 2 { rat_tails(ps[i].vp, leader) } else { 0 }; }
            }
        }
    }
}
