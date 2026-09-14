# Quackulator

An optimal-strategy calculator and self-playing simulator for **The Quacks of Quedlinburg**
(ingredient Set 1). Python 3.10+, standard library only, no install.

Like the other sims in this collection, the player accounts for *theoretical* opponents (rat
tails, the bonus die, moth comparisons) but never interacts with them.

## Use it during a game

```
python advisor.py
```

Each round it asks for the fortune-teller modifier (if any) and the leader's VP, then for every
chip you draw it prints the explosion odds and the stop-vs-draw values and tells you **DRAW** or
**STOP**. It also tells you when to use the flask, when a mandrake should return a white, which
chip to keep from a crow-skull draw, whether to take VP or coins after an explosion, what to buy,
and how to spend rubies. Resume mid-game with `--round`, `--bag`, `--droplet`, `--vp`,
`--rubies`, `--no-flask`.

Chip codes: `W1 W2 W3` white, `O1` orange, `G1/G2/G4` green, `B1/B2/B4` blue, `R1/R2/R4` red,
`Y1/Y2/Y4` yellow, `P1` purple, `K1` black. Bags are written like `W1x4 W2x2 W3 O1 G1`.

## Benchmark the strategy

```
python sim.py -n 100             # 100 self-played games, score stats and per-round curves
python sim.py -n 1 --seed 3 -v   # watch one game with every decision explained
python sim.py -n 60 --tune coin=0.8,1,1.2   # grid-search a value weight
python sim.py -n 100 --calibrate # per-round curves to paste into data.OPPONENTS
```

Windows: `quackulator.bat` (advisor) and `sim.bat` (benchmark).

## v3: playing to win (Rust)

The current app policy (`rust/weights_win.json`) maximises the probability of finishing first at
a four-player table rather than expected score. `rust/` adds a `table` mode that seats 2–4
policies at one table (rat tails, bonus die and black chips settled from the real results) and
`train --table`, which fits a win-probability model on top of the learned score model. It wins
34 % of four-player games against three copies of the v2 policy (25 % = equal). The reasoning is
written up in `MAXIMS.md` / `MAXIMS.pdf`; commands are in `rust/README.md`.

## v2: whole-game learning (Rust)

`rust/` holds a ~100× faster port of the solver plus a self-play trainer that learns a
whole-game value function and exports it as `weights.json`; `python rust/install_weights.py`
drops it into the app, which then shops and values every round by expected points for the rest
of the game instead of the fixed exchange rates below. See `rust/README.md` for the commands.

## How it decides

- **Brewing** is solved by exact expectimax over the remaining bag: at every state the value of
  stopping is compared with the expected value of drawing, with the flask, mandrake and crow-skull
  choices as max-nodes inside the tree. The full-detail search runs `--depth` draws ahead
  (default 2); beyond that the state is valued by an exact solver on an abstracted bag (whites,
  purples and blacks exact; other chips as safe movers). `--depth 99` is the fully exact solve
  (slow late in the game).
- **The value of a round outcome** is VP plus VP-equivalents for coins, rubies, droplet steps and
  the bonus-die chance, with per-round weights in `data.WEIGHTS` (round 9 is exact: 5 coins or
  2 rubies = 1 VP). Those weights are the only heuristic layer and are tuned by self-play.
- **Shopping** enumerates every legal purchase and picks the one that maximises the expected
  value of next round's brew; rubies are spent the same way.

All game data (pot track, prices, starting bag, die faces, opponent curves, rat-tail positions)
lives in `data.py`. See `quackulator_spec.md` for the rules model and design.

## Files

```
data.py      tables and tunable weights
bag.py       chip types, bag parsing/formatting
value.py     round-outcome valuation, opponent model
brew.py      brewing solver (full + abstract)
shop.py      purchase / ruby optimiser
game.py      one autoplayed game
sim.py       batch benchmark, tuning, calibration
advisor.py   interactive in-game advisor
```

## Contributors

Corey D. — design, rules model, engines, experiments. Claude (Anthropic) — contributor (table mode, win-objective trainer, app port of the win model).
