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

## The phone app (`app/index.html`, Android wrapper in `android/`)

The top half of the screen is a cartoon of the pot: the 54 spaces as a snake with coins, VP
and ruby marks, the droplet, the rat stone, every chip placed this round on its space and the
scoring space highlighted, so the real pot and the model can be checked against each other at
a glance. Rule moments that need attention are popups: **STOP** when a crow skull is drawn (pull
the extra chips before anything else), **BOOM** on an explosion, the flask and mandrake choices,
the fortune-teller card of the round with its decision (or its rule, at the moment it applies),
a round checklist (rat stone placement, the round-6 white chip, new shop colours) and an
"at the table" checklist after each shop (chips to take, rubies to pay, droplet to move, flask to
flip). The shop ranks every legal buy, shows what is left in the box, drops sold-out chips (the
supply is shared; knock off the other players' purchases in the supply panel) and a ruby coach
says exactly how to spend rubies: 2 for a permanent droplet step, 2 to refill the flask, or hold
them for 1 VP per pair at the end. Games start with 1 ruby, as in the rules.

## Fortune-teller cards

All 24 fortune-teller cards (`Fortune.txt`) are in the sim and the app. The sim draws one per
round from a deck shuffled once per game (`--fortune deck`, the default; `off` for none, or a
card name to force it every round). The 11 blue round rules are wired into the brew solver
(explosion limit 9, oranges +1, exactly-7-whites droplet, ruby-space VP or ruby, free flask,
double die, the Safety Procedure reveal, the Second Chances restart and the Cauldron Bubble
free return are all valued inside the expectimax, and the restart/return/reveal choices are made
by the same values), and the 13 purple cards are resolved at the start of the round with every
choice ranked by the seat's value function (which 2-chip, black or 3 rubies; 4 VP or a white
out; rat stone back for rubies, priced by re-solving the brew from the shorter start; and so on).
The app asks for the card right after the round prompt: purple cards open a ranked choice or a
yes/no, blue cards show as a rule banner and pop up at the moment they matter (first white,
fifth chip, stopping, scoring).

## v3: playing to win (Rust)

The current app policy (`rust/weights_win_v33.json`) maximises the probability of finishing first
at a four-player table rather than expected score. v33 (2026-09-27) adds four features for the
black-chip standing against the two neighbours and an opponent model re-measured on card tables
(`table --calibrate`); against v32 in alternating seats it takes 57 % of the wins (57.7 VP vs
56.1). An overnight loop (`rust/agent_win.py`: train from the best, promote only on a fresh-seed
head-to-head above 52 % of wins) found no further improvement in eight cycles, so v33 sits at the
plateau of this feature set. v32 (2026-09-26) was the first retrain with the fortune-teller deck
in play (4 passes of 4000 tables, 25 % exploration, from the v31 weights): against
`weights_win_v31.json` in alternating seats it wins 31 % of seats to 23 % (58.1 VP vs 57.2) and
rolls the bonus die more often. v31 (2026-09-15) added the box's chip supply, the
starting ruby and random ruby spends during exploration (the earlier model had never refilled its
flask, so it could not value one); it won 33 % of seats against 21 % for `weights_win.json`. `rust/` adds a `table` mode that seats 2–4
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
