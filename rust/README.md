# Quackulator v2 engine (Rust) — whole-game learning

The v1 engine valued a round's coins and rubies with hand-set per-round exchange rates and
shopped one round ahead. This crate replaces that with a **learned whole-game value function**

    V_r(bag, droplet, rubies, flask) = expected VP still to come from the start of round r

fitted by self-play. With it, a brew outcome is worth `VP + V_{r+1}(bag after the best purchase)`,
so "bust on purpose for 17 coins in round 2" is scored by what those coins turn into over the
remaining rounds, and the orange→red engine, early blacks, etc. price themselves.

The in-round solver (draw/stop, flask, mandrake, crow skull) is the same exact expectimax as
v1 — verified to four decimals against the Python (`parity`) — just ~100× faster.

## Build

Rust toolchain (https://rustup.rs). Then, from this folder:

    cargo build --release

Binary: `target/release/quackulator` (`quackulator.exe` on Windows). No dependencies.

## Commands

    cargo run --release -- parity
        Prints solver values for fixed test bags next to the Python numbers. Should match.

    cargo run --release -- sim --games 1000 [--weights weights.json] [--depth 1] [--threads 28]
        Self-play benchmark. Without --weights it plays the v1 heuristic policy (baseline);
        with --weights it plays the learned policy. Prints mean VP, per-round explosion rate,
        and chips bought per game by colour.

    cargo run --release -- table --players v1,weights.json,weights_ORBK.json,weights_ORBP.json --games 2000 [--seed S] [--trace]
        2-4 players at one table (seat order = neighbours). Each seat brews with its own policy
        (v1 = heuristic, otherwise a weights file). Rat tails, the bonus die (furthest
        non-exploded pot, ties all roll) and the black-chip comparison (vs. the two neighbours)
        are settled from the seats' actual results instead of the data::OPP opponent model.
        The in-round solver still prices the die and black chip with OPP while brewing, since
        those outcomes are unknown until every pot has stopped. Prints per-seat mean VP, win%,
        rat tails and die rolls per game.

    table ... --calibrate
        Also prints the data::OPP opponent model as measured at these tables (leader VP per round,
        non-exploded scoring-space mean/sd, survival, blacks per pot, share of the bag drawn), ready
        to paste into data.rs and the app. The constants were last measured on 2026-09-26 at 2000
        four-seat tables of the v32 win model with the deck.

    --fortune deck | off | <card name>      (sim, table and train)
        Fortune-teller cards: a 24-card deck shuffled per game with one card drawn each round (the
        default), none, or one card forced every round (e.g. --fortune "Second Chances", handy with
        --trace). Blue cards are valued inside the brew solver; purple cards are resolved at the
        start of the round with every choice ranked by the seat's value function (src/fortune.rs).

    cargo run --release -- train --table --games 5000 --passes 4 --explore 0.2 --init weights_win.json --out weights_win_v31.json
        WIN-objective training at 4-seat tables. The value function becomes P(win the game) from
        the start of each round (logistic regression, format quackulator-win-v2) with one extra
        feature, margin = my VP - best other player's VP, and a round-10 game-end model in the
        margin alone. Pass 0 plays the --init policy (else v1) in every seat; each later pass seats
        the newest fit at P1/P3 against the best-so-far at P2/P4 and keeps the fit only if its seats
        win more than half the games (ties split). weights_win.json = best policy so far,
        weights_win.latest.json = newest fit. Solo `sim`/`table` and the app accept both formats;
        the solo sim measures the margin against the data::OPP leader curve. While brewing, a WIN
        model values an outcome as sigmoid(logit of best shop + a * (margin - opp_gain[r] + VP
        gained)), so it takes risks when behind and banks points when ahead. The fit is two-stage:
        a ridge VP-to-come model (with the margin feature) values the bag, and a 2-parameter
        logistic per round maps the projected final margin to P(win); `--fix-vp` keeps the --init
        VP model as the bag valuation and fits only the logistic.

    cargo run --release -- train --games 10000 --passes 6 --out weights.json [--threads 28]
        Self-play training (see below). Writes:
          weights.json          the best-scoring policy so far (this is the deliverable)
          weights.latest.json   the newest fit, not yet evaluated
        Options: --lambda 10 (ridge strength), --explore 0.1 (random-purchase rate during
        training), --depth 1 (solver lookahead; 2 is slower and barely better), --init F
        (start from an existing weights file), --seed S.

Then put the weights into the app (VP or WIN format; the app shows a **v2** or **win** badge):

    python rust/install_weights.py rust/weights.json

which rewrites the `const VMODEL=…` line in `app/index.html` (and the Android asset copy). The
app shows a **v2** badge when a model is loaded, ranks purchases by whole-game value, and
values every brew outcome through it. `sim`/`parity` in Rust and the JS in the app agree to
four decimals on the learned mode too.

## Recommended first run (your 14700K, 28 threads)

    cargo build --release
    cargo run --release -- parity
    cargo run --release -- sim --games 2000                          # v1 baseline, ~10 s
    cargo run --release -- train --games 10000 --passes 6 --out weights.json   # ~5-10 min
    cargo run --release -- sim --games 2000 --weights weights.json   # learned policy
    python ../rust/install_weights.py weights.json                   # (from repo root: python rust/install_weights.py rust/weights.json)

Judge success by the `sim` mean VP with weights vs. without, and by the purchase mix
(v1 never buys red; v2 should).

## How training works

1. Play N games with the current policy (pass 0: the v1 heuristic). At the start of every
   round record the state features and, at the end, the VP gained from that round onward
   (return-to-go).
2. Fit one ridge-regression model per round on all samples collected so far (a replay
   buffer across passes keeps the fit from chasing a single policy).
3. Play the next pass with the fitted V as the terminal value (brewing) and the shop scorer.
   Repeat. The file `weights.json` always holds the policy that *played* best.

Features (50 per round): constant, chip counts and their squares, droplet and droplet²,
rubies, flask, total white value, coloured-chip count, orange×red count, white fraction, the
margin (WIN models), and the black-chip standing against the two neighbours (my blacks minus the
weaker and the stronger neighbour's, clamped to ±3, plus two beats-them indicators; the app asks
for the neighbours' black counts in the round prompt). Older weight files load with zeros there.
The model is deliberately small so it exports as plain JSON and runs in the phone app in
microseconds.

Exploration (`--explore`, default 10 % of shops random) is there so the value fit sees
colours the current policy would never buy — and, since 2026-09-15, random ruby spends too:
the first win model never refilled the flask, so every sample after round 1 had an empty flask
and the flask coefficient collapsed to exactly 0, which made refilling look worthless forever.
The chip supply is limited as in the box (`data::STOCK`, one supply per table, a sold-out chip
leaves the shop) and every player starts with 1 ruby; without it the first learned pass can collapse
(seen in a 400-game smoke test: 38 → 27 → 37 → 38 VP over four passes). With 10k games per
pass this is much less of an issue, but if a pass scores badly, just run more passes — the
best policy is kept.

## Files

    src/data.rs     tables (same numbers as ../data.py)
    src/fortune.rs  the 24 fortune-teller cards: deck, purple-card resolution, option ranking
    src/solver.rs   Ctx (heuristic or learned terminal), Abstract and full Brew solvers
    src/shop.rs     v1 shop, learned shop, PayTable builder
    src/model.rs    features, ridge fit, weights.json read/write
    src/game.rs     one self-played game (mirrors ../game.py), sampling
    src/main.rs     parity / sim / train
    install_weights.py   embeds weights.json into the app

## What the app does differently with weights loaded

* Brewing terminal: `VP + best_shop_value(coins, rubies gained, droplet steps gained, flask used)`
  from a table precomputed once per round (36 × 7 × 3 × 2 shop optimisations, ~20 ms).
* Explosion VP-or-coins: whichever leads to the higher `V_{r+1}`.
* Bonus-die faces are valued through V too (ruby, droplet, orange chip).
* Shop: every legal purchase ranked by `max over ruby spends of V_{r+1}`; ruby advice from the
  same maximisation.
* The "score to beat" mode in round 9 is unchanged (it already uses exact final-round values).

The Python engine stays as the v1 reference and benchmark; it does not consume weights.
