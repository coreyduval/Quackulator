//! Quackulator engine in Rust: parity check, self-play benchmark, and value-function trainer.
//!
//!   cargo run --release -- parity
//!   cargo run --release -- sim   [--games N] [--weights weights.json] [--depth D] [--threads T]
//!   cargo run --release -- train [--table] [--games N] [--passes K] [--out weights.json] [--init weights.json]
//!   cargo run --release -- table --players v1,weights.json,weights_ORBK.json,v1 [--games N] [--seed S] [--trace]
//!       2-4 players at one table; rat tails, bonus die and black chips settled from the real results
//!   --only B  /  --only O,R  /  --only B2,B4  restricts the shop (sim and train) to those colours/chips
//!                                [--lambda L] [--depth D] [--threads T]

mod data;
mod game;
mod model;
mod shop;
mod solver;
mod table;

use std::sync::Arc;
use std::thread;
use std::time::Instant;

use data::*;
use game::{play_game, GameResult};
use table::{play_table, Seat};
use model::{features_end, Model, IDX_MARGIN, NF};
use solver::*;

fn arg(args: &[String], key: &str) -> Option<String> {
    args.iter().position(|a| a == key).and_then(|i| args.get(i + 1).cloned())
}

fn parity(weights: Option<String>) {
    if let Some(w) = weights {
        let m = Model::from_json(&std::fs::read_to_string(&w).expect("read weights"));
        println!("learned-mode parity (droplet 0, rubies 1, flask full, depth 1):");
        for (r, b) in [(1u32, "W1x4 W2x2 W3 O1 G1"), (5, "W1x5 W2x2 W3 O1x3 G1x2 B1 R1 R2 Y1")] {
            let bag = parse_bag(b);
            let ctx = Ctx::new(r, Terminal::Learned(shop::pay_table(&m, &bag, r, 0, 1, true, 0)));
            let mut brew = Brew::new(&ctx, bag, true, 1);
            let s = brew.start(0, 0);
            let (_, stop, draw) = brew.should_draw(&s);
            let sh = shop::best_shop_learned(&m, &bag, 12, 3, r, 0, true);
            println!("  round {} V={:.4} stop={:.4} draw={:.4}  shop(12 coins,3 rubies)={:?} steps {} refill {} v {:.4}", r, brew.value(&s), stop, draw.unwrap(),
                sh.0.iter().map(|&i| NAMES[i]).collect::<Vec<_>>(), sh.1, sh.2, sh.3);
        }
        return;
    }
    let cases = [
        (1u32, "W1x4 W2x2 W3 O1 G1"),
        (5, "W1x5 W2x2 W3 O1x3 G1x2 B1 R1 R2 Y1"),
        (8, "W1x5 W2x2 W3 O1x4 G1x2 G2 B1 B2 R1 R2 Y1 Y2 P1x2 K1"),
    ];
    println!("round  V(depth2)  stop     draw     p_explode   (compare with python: brew.Brew(RoundCtx(r), bag, depth=2))");
    for (r, b) in cases {
        let ctx = Ctx::new(r, Terminal::Heuristic);
        let t = Instant::now();
        let mut brew = Brew::new(&ctx, parse_bag(b), true, 2);
        let s = brew.start(0, 0);
        let v = brew.value(&s);
        let (_, stop, draw) = brew.should_draw(&s);
        println!("{:<6} {:<10.4} {:<8.4} {:<8.4} {:<10.4} {} ms  {}", r, v, stop, draw.unwrap(), brew.explode_prob(&s), t.elapsed().as_millis(), b);
    }
    // the round-9 playtest state from MAXIMS.md, exact solve
    let ctx = Ctx::new(9, Terminal::Heuristic);
    let mut brew = Brew::new(&ctx, parse_bag("W1x5 W2x2 W3 O1x8 R1x2 R2x2 R4 B1x2 B2 B4 K1x2"), true, 99);
    let s = State { bag: parse_bag("W1 W2x2 O1x4 R1 R2 R4 B1 B2 B4 K1"), pos: 25, white: 7, lastw: 1, g1: false, g2: false, flask: true };
    let (d, stop, draw) = brew.should_draw(&s);
    println!("round-9 playtest state, exact: stop {:.4} draw {:.4} -> {} (python: 10.08 / 10.65 DRAW)", stop, draw.unwrap(), if d { "DRAW" } else { "STOP" });
    let ranked = shop::best_purchase_heuristic(&starting_bag(), 10, 1, 0, true, 2);
    println!("shop parity (start bag, 10 coins, after round 1): {:?}", ranked.iter().take(3).map(|(o, v)| (o.iter().map(|&i| NAMES[i]).collect::<Vec<_>>().join("+"), (v * 1000.0).round() / 1000.0)).collect::<Vec<_>>());
    println!("python gave: K1 9.176, B2 7.871, G2 7.380");
}

fn run_games(n: usize, seed0: u64, model: Option<Arc<Model>>, depth: u8, threads: usize, record: bool, explore: f64) -> Vec<GameResult> {
    let mut handles = vec![];
    let per = (n + threads - 1) / threads;
    for t in 0..threads {
        let lo = t * per; let hi = ((t + 1) * per).min(n);
        if lo >= hi { break; }
        let model = model.clone();
        handles.push(thread::spawn(move || {
            (lo..hi).map(|i| play_game(seed0 + i as u64, model.as_deref(), depth, record, explore, false)).collect::<Vec<_>>()
        }));
    }
    let mut out = vec![];
    for h in handles { out.extend(h.join().unwrap()); }
    out
}

fn summarise(res: &[GameResult]) -> f64 {
    let n = res.len() as f64;
    let mean = res.iter().map(|r| r.vp as f64).sum::<f64>() / n;
    let sd = (res.iter().map(|r| (r.vp as f64 - mean).powi(2)).sum::<f64>() / n).sqrt();
    let (mn, mx) = res.iter().fold((i32::MAX, i32::MIN), |a, r| (a.0.min(r.vp), a.1.max(r.vp)));
    println!("{} games: mean VP {:.2}  sd {:.1}  min {}  max {}  (se {:.2})", res.len(), mean, sd, mn, mx, sd / n.sqrt());
    println!("round   mean space   explode%   bust->coins%   mean VP after");
    for r in 0..9 {
        let sp = res.iter().map(|g| g.spaces[r] as f64).sum::<f64>() / n;
        let nex = res.iter().filter(|g| g.exploded[r]).count();
        let ex = 100.0 * nex as f64 / n;
        let tc = if nex == 0 { 0.0 } else { 100.0 * res.iter().filter(|g| g.took_coins[r]).count() as f64 / nex as f64 };
        let va = res.iter().map(|g| g.vp_after[r] as f64).sum::<f64>() / n;
        println!("  {}       {:5.1}       {:5.1}       {:5.1}          {:5.1}", r + 1, sp, ex, tc, va);
    }
    let mut by_colour: Vec<(char, f64)> = vec![];
    for c in "OGBRYPK".chars() {
        let k: u32 = res.iter().map(|g| (0..N).filter(|&i| COLOR[i] as char == c).map(|i| g.bought[i]).sum::<u32>()).sum();
        by_colour.push((c, k as f64 / n));
    }
    println!("chips bought per game: {}", by_colour.iter().map(|(c, k)| format!("{} {:.2}", c, k)).collect::<Vec<_>>().join("  "));
    let by_chip: Vec<String> = (0..N).filter(|&i| PRICE[i] > 0)
        .map(|i| format!("{} {:.2}", NAMES[i], res.iter().map(|g| g.bought[i]).sum::<u32>() as f64 / n)).collect();
    println!("      by chip:         {}", by_chip.join("  "));
    let fb: Vec<String> = (0..N).map(|i| format!("{} {:.2}", NAMES[i], res.iter().map(|g| g.final_bag[i] as f64).sum::<f64>() / n)).collect();
    println!("mean final bag:        {}", fb.join("  "));
    mean
}


/// "v1"/"heuristic" = the heuristic policy, otherwise a weights file (VP or WIN model).
fn load_seat(s: &str) -> Seat {
    if s == "v1" || s == "heuristic" { None } else { Some(Arc::new(Model::from_json(&std::fs::read_to_string(s).unwrap_or_else(|_| panic!("read weights {}", s))))) }
}

/// Win-objective training at 4-seat tables. Pass 0 plays the best-so-far policy (--init, else v1)
/// in every seat; each later pass seats the newest fit at P1/P3 against the best-so-far at P2/P4,
/// and the fit replaces the best only if its seats win more than half the games.
///
/// The fit is two-stage, so the bag is valued from the low-noise VP signal and only the risk
/// attitude comes from the noisy win indicator:
///   1. VP_r(state, margin) = expected VP still to come (ridge, every seat's samples);
///   2. P(win) = sigmoid(c_r + a_r * x) with x = margin + VP_r - G_r, the projected final margin
///      (G_r = mean VP the other players still gain from round r on), a 2-parameter logistic;
/// composed into one linear logit per round in the ordinary feature vector (format win-v2).
fn train_table(games: usize, passes: usize, seed0: u64, init: Option<Arc<Model>>, out: &str, lambda: f64, explore: f64, depth: u8, threads: usize, fix_vp: bool) {
    // --fix-vp: keep the --init VP model as stage 1 (bag valuation) and fit only the win logistic
    let vp_fixed: Option<Arc<Model>> = if fix_vp { let m = init.clone().expect("--fix-vp needs --init <VP weights>"); assert!(!m.win, "--fix-vp needs a VP-format --init model"); Some(m) } else { None };
    let mut best: Seat = init;
    let mut cand: Option<Arc<Model>> = None;
    // replay buffer: (features at round start, won?, VP still to come, round); round-10 entries hold the projected end margin
    let mut buf: Vec<([f64; NF], f64, f64, u32)> = vec![];
    let mut best_rate = f64::NEG_INFINITY;
    for pass in 0..passes {
        let t = Instant::now();
        let seats: Vec<Seat> = match &cand { None => vec![best.clone(); 4], Some(c) => vec![Some(c.clone()), best.clone(), Some(c.clone()), best.clone()] };
        let seed = seed0 + (pass as u64) * 1_000_000;
        let tables = run_tables(games, seed, Arc::new(seats), depth, threads, true, explore);
        let n = tables.len() as f64;
        // candidate win rate (ties split between the tied seats)
        let mut rate = 0.0;
        for g in &tables {
            let winners = g.iter().filter(|r| r.won).count() as f64;
            rate += (g[0].won as u8 + g[2].won as u8) as f64 / winners;
        }
        rate /= n;
        let mean_of = |idx: &[usize]| tables.iter().map(|g| idx.iter().map(|&i| g[i].vp as f64).sum::<f64>() / idx.len() as f64).sum::<f64>() / n;
        match &cand {
            None => println!("-- pass {} played with {} in every seat in {:.1}s: mean VP {:.2}", pass, if best.is_some() { "the initial policy" } else { "the heuristic" }, t.elapsed().as_secs_f64(), mean_of(&[0, 1, 2, 3])),
            Some(_) => println!("-- pass {} candidate (P1,P3) vs best (P2,P4) in {:.1}s: candidate wins {:.1}%  mean VP {:.2} vs {:.2}",
                                pass, t.elapsed().as_secs_f64(), 100.0 * rate, mean_of(&[0, 2]), mean_of(&[1, 3])),
        }
        // mean VP gained per round across all seats: the opponent-gain projection
        let mut gain = [0.0; 11];
        for g in &tables { for r in g { let mut prev = 0; for k in 0..9 { gain[k + 1] += (r.vp_after[k] - prev) as f64; prev = r.vp_after[k]; } } }
        for k in 1..=9 { gain[k] /= 4.0 * n; }
        let mut g_rest = [0.0; 11];           // G_r = sum of gain[r..=9]
        for r in (1..=9).rev() { g_rest[r] = g_rest[r + 1] + gain[r]; }
        for g in &tables {
            for r in g {
                let y = if r.won { 1.0 } else { 0.0 };
                for s in &r.samples { buf.push((s.x, y, (r.vp - s.vp_before) as f64, s.rnd)); }
                buf.push((features_end(r.vp as f64 - (r.others_r9 as f64 + gain[9])), y, 0.0, 10));
            }
        }
        // stage 1: VP still to come, with the margin feature (ridge)
        let mut vpm = Model::empty();
        match &vp_fixed {
            Some(f) => vpm = (**f).clone(),
            None => for r in 1..=ROUNDS {
                let mut xs: Vec<[f64; NF]> = vec![]; let mut ys: Vec<f64> = vec![];
                for (x, _, v, rr) in &buf { if *rr == r { xs.push(*x); ys.push(*v); } }
                vpm.fit_round(r, &xs, &ys, lambda);
            },
        }
        // stage 2: P(win) from the projected final margin, composed into the win logit
        let mut m = Model::empty_win();
        m.opp_gain = [gain[0], gain[1], gain[2], gain[3], gain[4], gain[5], gain[6], gain[7], gain[8], gain[9]];
        for r in 1..=ROUNDS + 1 {
            let mut xs: Vec<[f64; NF]> = vec![]; let mut ys: Vec<f64> = vec![];
            for (x, y, _, rr) in &buf {
                if *rr != r { continue; }
                xs.push(if r > ROUNDS { *x } else { features_end(x[IDX_MARGIN] + vpm.value(r, x) - g_rest[r as usize]) });
                ys.push(*y);
            }
            let mut lg = Model::empty_win();
            let ll = lg.fit_logistic(r, &xs, &ys, lambda);
            let (c, a) = (lg.coef[r as usize][0], lg.coef[r as usize][IDX_MARGIN]);
            let ru = r as usize;
            if r > ROUNDS {
                m.coef[ru][0] = c; m.coef[ru][IDX_MARGIN] = a;
                println!("   V_{}: end model P(win) = sigmoid({:.3} + {:.3} * final margin), {} samples, log-loss {:.3}", r, c, a, xs.len(), ll);
            } else {
                let w = &vpm.coef[ru];
                for j in 1..IDX_MARGIN { m.coef[ru][j] = a * w[j]; }
                m.coef[ru][0] = c + a * (w[0] - g_rest[ru]);
                m.coef[ru][IDX_MARGIN] = a * (1.0 + w[IDX_MARGIN]);
                let rmse = { let mut e = 0.0; let mut k = 0.0; for (x, _, v, rr) in &buf { if *rr == r { e += (vpm.value(r, x) - v).powi(2); k += 1.0; } } (e / k).sqrt() };
                println!("   V_{}: VP fit rmse {:.2} (margin coef {:+.3}), P(win) = sigmoid({:.3} + {:.3} * projected margin), {} samples, log-loss {:.3}", r, rmse, w[IDX_MARGIN], c, a, xs.len(), ll);
            }
        }
        if let Some(c) = &cand {
            if rate > 0.5 && rate > best_rate {
                best_rate = rate;
                best = Some(c.clone());
                std::fs::write(out, c.to_json(rate, games)).expect("write weights");
                println!("   wrote {} (new best: beat the previous best with {:.1}% of wins)", out, 100.0 * rate);
            }
        }
        let latest = format!("{}.latest.json", out.trim_end_matches(".json"));
        std::fs::write(&latest, m.to_json(f64::NAN, games)).expect("write weights");
        println!("   wrote {} (newest fit, unevaluated)", latest);
        cand = Some(Arc::new(m));
    }
    println!("done. {} holds the best policy{}. Evaluate: quackulator table --players {},weights.json,weights_ORBK.json,v1 --games 4000",
             out, if best_rate.is_finite() { format!(" ({:.1}% of wins vs its predecessor)", 100.0 * best_rate) } else { " (no candidate beat the initial policy; file unchanged)".to_string() }, out);
}

fn run_tables(n: usize, seed0: u64, seats: Arc<Vec<Seat>>, depth: u8, threads: usize, record: bool, explore: f64) -> Vec<Vec<GameResult>> {
    let mut handles = vec![];
    let per = (n + threads - 1) / threads;
    for t in 0..threads {
        let lo = t * per; let hi = ((t + 1) * per).min(n);
        if lo >= hi { break; }
        let seats = seats.clone();
        handles.push(thread::spawn(move || (lo..hi).map(|i| play_table(seed0 + i as u64, &seats, depth, record, explore, false)).collect::<Vec<_>>()));
    }
    let mut out = vec![];
    for h in handles { out.extend(h.join().unwrap()); }
    out
}

fn summarise_table(names: &[String], games: &[Vec<GameResult>]) {
    let n = games.len() as f64;
    println!("{} games, {} seats", games.len(), names.len());
    println!("seat  policy                 mean VP    sd   win%  rats/game  die/game  explode%  bought O/G/B/R/Y/P/K");
    for (i, name) in names.iter().enumerate() {
        let rs: Vec<&GameResult> = games.iter().map(|g| &g[i]).collect();
        let mean = rs.iter().map(|r| r.vp as f64).sum::<f64>() / n;
        let sd = (rs.iter().map(|r| (r.vp as f64 - mean).powi(2)).sum::<f64>() / n).sqrt();
        let win = 100.0 * rs.iter().filter(|r| r.won).count() as f64 / n;
        let rats = rs.iter().map(|r| r.rats as f64).sum::<f64>() / n;
        let die = rs.iter().map(|r| r.die_wins as f64).sum::<f64>() / n;
        let ex = 100.0 * rs.iter().map(|r| r.exploded.iter().filter(|&&e| e).count() as f64).sum::<f64>() / (9.0 * n);
        let bought: Vec<String> = "OGBRYPK".chars().map(|c| format!("{:.1}", rs.iter().map(|r| (0..N).filter(|&i| COLOR[i] as char == c).map(|i| r.bought[i]).sum::<u32>() as f64).sum::<f64>() / n)).collect();
        println!("P{}    {:<22} {:6.2}  {:4.1}  {:5.1}  {:8.2}  {:8.2}  {:8.1}  {}", i + 1, name, mean, sd, win, rats, die, ex, bought.join("/"));
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let cmd = args.get(1).map(|s| s.as_str()).unwrap_or("help");
    let games: usize = arg(&args, "--games").map(|s| s.parse().unwrap()).unwrap_or(200);
    let depth: u8 = arg(&args, "--depth").map(|s| s.parse().unwrap()).unwrap_or(1);
    let threads: usize = arg(&args, "--threads").map(|s| s.parse().unwrap()).unwrap_or_else(|| thread::available_parallelism().map(|n| n.get()).unwrap_or(4));
    let seed0: u64 = arg(&args, "--seed").map(|s| s.parse().unwrap()).unwrap_or(0);
    if let Some(only) = arg(&args, "--only") { shop::set_only(&only); println!("shop restricted to: {}", only); }
    if let Some(mo) = arg(&args, "--max-orange") { shop::MAX_ORANGE.store(mo.parse().unwrap(), std::sync::atomic::Ordering::Relaxed); println!("orange purchases capped at {} in bag", mo); }
    if let Some(mk) = arg(&args, "--max-black") { shop::MAX_BLACK.store(mk.parse().unwrap(), std::sync::atomic::Ordering::Relaxed); println!("black purchases capped at {} in bag", mk); }
    match cmd {
        "parity" => parity(arg(&args, "--weights")),
        "sim" => {
            let model = arg(&args, "--weights").map(|p| Arc::new(Model::from_json(&std::fs::read_to_string(&p).expect("read weights"))));
            println!("mode: {}  depth {}  threads {}", match &model { Some(m) if m.win => "learned (win)", Some(_) => "learned (VP)", None => "heuristic (v1)" }, depth, threads);
            let t = Instant::now();
            if args.iter().any(|a| a == "--trace") {
                for i in 0..games {
                    let r = play_game(seed0 + i as u64, model.as_deref(), depth, false, 0.0, true);
                    println!("\nFINAL VP: {}", r.vp);
                }
                return;
            }
            let res = run_games(games, seed0, model, depth, threads, false, 0.0);
            summarise(&res);
            println!("{:.1}s", t.elapsed().as_secs_f64());
        }
        "table" => {
            let spec = arg(&args, "--players").unwrap_or_else(|| {
                let one = arg(&args, "--weights").unwrap_or_else(|| "v1".to_string());
                vec![one.as_str(); 4].join(",")
            });
            let names: Vec<String> = spec.split(',').map(|s| s.trim().to_string()).collect();
            assert!((2..=4).contains(&names.len()), "--players takes 2 to 4 entries (v1 or a weights file)");
            let seats: Vec<Seat> = names.iter().map(|s| load_seat(s)).collect();
            println!("table: {}  depth {}  threads {}", names.join(" | "), depth, threads);
            let t = Instant::now();
            if args.iter().any(|a| a == "--trace") {
                for i in 0..games {
                    let r = play_table(seed0 + i as u64, &seats, depth, false, 0.0, true);
                    println!("\nFINAL: {}", r.iter().enumerate().map(|(i, g)| format!("P{} {} = {} VP{}", i + 1, names[i], g.vp, if g.won { " (winner)" } else { "" })).collect::<Vec<_>>().join(", "));
                }
                return;
            }
            let res = run_tables(games, seed0, Arc::new(seats), depth, threads, false, 0.0);
            summarise_table(&names, &res);
            println!("{:.1}s", t.elapsed().as_secs_f64());
        }
        "train" => {
            let passes: usize = arg(&args, "--passes").map(|s| s.parse().unwrap()).unwrap_or(4);
            let lambda: f64 = arg(&args, "--lambda").map(|s| s.parse().unwrap()).unwrap_or(10.0);
            let out = arg(&args, "--out").unwrap_or_else(|| "weights.json".to_string());
            let mut model: Option<Arc<Model>> = arg(&args, "--init").map(|p| Arc::new(Model::from_json(&std::fs::read_to_string(&p).expect("read init weights"))));
            let explore: f64 = arg(&args, "--explore").map(|s| s.parse().unwrap()).unwrap_or(0.1);
            // --table: win-objective training at 4-seat tables (see train_table)
            if args.iter().any(|a| a == "--table") {
                println!("training (win objective) at 4-seat tables: {} tables/pass, {} passes, depth {}, lambda {}, explore {}, threads {}", games, passes, depth, lambda, explore, threads);
                train_table(games, passes, seed0, model, &out, lambda, explore, depth, threads, args.iter().any(|a| a == "--fix-vp"));
                return;
            }
            println!("training: {} games/pass, {} passes, depth {}, lambda {}, threads {}", games, passes, depth, lambda, threads);
            let mut best_mean = f64::NEG_INFINITY;
            // replay buffer: samples from every pass so far (keeps the fit from chasing one policy)
            let mut buf: Vec<([f64; NF], f64, u32)> = vec![];
            for pass in 0..passes {
                let t = Instant::now();
                let res = run_games(games, seed0 + (pass as u64) * 1_000_000, model.clone(), depth, threads, true, explore);
                println!("-- pass {} played with {} policy in {:.1}s", pass, if model.is_some() { "learned" } else { "heuristic" }, t.elapsed().as_secs_f64());
                let mean = summarise(&res);
                // fit V_r from return-to-go samples
                let mut m = Model::empty();
                for g in &res { for s in &g.samples { buf.push((s.x, (g.vp - s.vp_before) as f64, s.rnd)); } }
                for r in 1..=ROUNDS {
                    let mut xs: Vec<[f64; NF]> = vec![]; let mut ys: Vec<f64> = vec![];
                    for (x, y, rr) in &buf { if *rr == r { xs.push(*x); ys.push(*y); } }
                    m.fit_round(r, &xs, &ys, lambda);
                    let pred_err = (xs.iter().zip(&ys).map(|(x, &y)| (m.value(r, x) - y).powi(2)).sum::<f64>() / xs.len() as f64).sqrt();
                    println!("   V_{} fitted on {} samples, rmse {:.2}", r, xs.len(), pred_err);
                }
                // keep the best *played* model as the deliverable; the newest fit goes to .latest
                if let Some(played) = &model {
                    if mean > best_mean {
                        best_mean = mean;
                        std::fs::write(&out, played.to_json(mean, games)).expect("write weights");
                        println!("   wrote {} (best so far: this pass's policy scored {:.2})", out, mean);
                    }
                }
                let latest = format!("{}.latest.json", out.trim_end_matches(".json"));
                std::fs::write(&latest, m.to_json(f64::NAN, games)).expect("write weights");
                println!("   wrote {} (newest fit, unevaluated)", latest);
                model = Some(Arc::new(m));
            }
            println!("done. best played policy: {:.2} mean VP -> {}. Evaluate: cargo run --release -- sim --weights {} --games 1000", best_mean, out, out);
        }
        _ => println!("usage: parity | table [--players v1,weights.json,... --games N --seed S --trace] | sim [--games N --weights F --depth D --threads T --seed S --only B2,B4,O --max-orange N --max-black N --trace] | train [--table [--fix-vp] --games N --passes K --out F --init F --lambda L --explore E --depth D --threads T --only ...]"),
    }
}
