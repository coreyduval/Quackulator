# Quackulator — Engine Spec

Optimal-strategy calculator and self-playing simulator for **The Quacks of Quedlinburg**
(Set 1 ingredient books). Python 3.10+, standard library only.

Design rule (shared with Corey's other sims): the player accounts for *theoretical* opponents
(they matter for rat tails, the bonus die, and black-chip comparisons) but never interacts
with them or reacts to their actual moves. All opponent effects come from a parametric model
or from numbers the user types in advisor mode.

## 1. Rules model (Set 1)

### Round flow (9 rounds)

1. **Fortune teller card** — one of the 24 cards, drawn from a deck shuffled per game (see §4).
2. **Rats** (round 2+) — every player behind the leader counts the rat tails between their VP
   and the leader's VP on the scoring track; the rat stone goes that many spaces past the droplet
   and the first chip is placed from there.
3. **Brew** — draw chips one at a time. A chip of value `v` is placed `v` spaces after the previous
   chip (or after the droplet/rat stone). The **scoring space** is the space *after* the last chip
   (`pos + 1`). If the sum of white chips drawn exceeds **7**, the pot explodes; the exploding chip
   still counts for position. You may stop before any draw.
4. **Evaluation**
   - A. **Bonus die** — highest non-exploded scoring space (ties: farthest chips) rolls the die.
     Faces: 1 VP, 1 VP, 2 VP, 1 ruby, droplet +1, orange 1-chip (six faces; one repeated — verify).
   - B. **Chip actions** for green / purple / black (end-of-round effects).
   - C. **Rubies** — 1 ruby if the scoring space shows a ruby (exploded or not).
   - D. **Victory points** on the scoring space. If exploded: choose **either** VP **or** coins.
   - E. **Shop** — coins = scoring-space coin number. Buy 1 or 2 chips of **different** colours.
     Unused coins are lost. Yellow purchasable from round 2, purple from round 3.
   - F. **Rubies** — only now, any number of times: 2 rubies → droplet +1 (permanent), or
     2 rubies → refill flask. Unspent rubies carry over (2 = 1 VP after round 9).
5. **Round 6**: add one white 1-chip to the bag.
6. **Round 9**: after the round, buy VP at 5 coins or 2 rubies each, repeatable. Coins
   cannot be spent on chips usefully; the engine converts `coins // 5` and `rubies // 2` into VP.

### Flask

Once per refill: after drawing a white chip that did **not** explode the pot, you may put it
back in the bag (position and white-sum revert). Refill costs 2 rubies at end of round.

### Starting bag and resources

4× white 1, 2× white 2, 1× white 3, 1× orange 1, 1× green 1. Every player also starts with
**1 ruby**, a full flask and the droplet on space 0.

### Chip supply

The box holds 215 chips and the supply is shared by the table; a sold-out chip may not be
bought (`data.rs: STOCK`, `app: STOCK`): white 20/8/4, orange 20, green 15/10/13,
blue 14/10/10, red 12/8/10, yellow 13/6/10, purple 15, black 18 (1/2/4-chips). The sim keeps
one supply per table (solo mode: per player, since the modelled opponents buy nothing); the app
keeps a supply counter that the player's own buys reduce and that the user can edit for the other
players' purchases.

### Set 1 ingredient effects

| Colour | Name | Price 1/2/4 | Effect |
|---|---|---|---|
| Orange | Pumpkin | 3 (1-chip only) | none |
| Green | Garden spider | 4 / 8 / 14 | End of round: 1 ruby for each green chip that is the last or next-to-last chip placed |
| Blue | Crow skull | 5 / 10 / 19 | On draw: draw 1/2/4 extra chips, place **one** of them (or none), return the rest |
| Red | Toadstool | 6 / 10 / 16 | On draw: +1 space if 1–2 oranges already in pot, +2 if 3+ |
| Yellow | Mandrake | 8 / 12 / 18 | On draw: if the chip placed directly before is white, may return that white to the bag (yellow takes its spot) |
| Purple | Ghost's breath | 9 (1-chip only) | End of round: 1 purple = 1 VP; 2 = 1 VP + 1 ruby; 3+ = 2 VP + droplet +1 |
| Black | Death's-head moth | 10 (1-chip only) | End of round: vs opponents' black count — equal → droplet +1; more → droplet +1 and 1 ruby |

A chip placed via a blue chip resolves its own effect (white counts toward explosion, red gets
the pumpkin bonus, another blue chains, yellow may return a white).

## 2. Pot track (`data.py: TRACK`)

Transcribed from the physical board (photo, spiral read from the centre outward). The pot has
**54 spaces** (index 0–53); coin values 15–33 each appear on two consecutive spaces, and the last
space is 35 coins / 15 VP. Coins = big number, VP = small number, R = ruby.

```
idx:   0  1  2  3  4  5R 6  7  8  9R 10 11 12 13R 14 15 16R 17 18 19 20R 21 22 23 24R 25 26
coins: 0  1  2  3  4  5  6  7  8  9  10 11 12 13  14 15 15  16 16 17 17  18 18 19 19  20 20
VP:    0  0  0  0  0  0  1  1  1  1  2  2  2  2   3  3  3   3  4  4  4   4  5  5  5   5  6

idx:   27 28R 29 30R 31 32 33 34R 35 36R 37 38 39 40R 41 42R 43 44 45 46R 47 48 49 50R 51 52R 53
coins: 21 21  22 22  23 23 24 24  25 25  26 26 27 27  28 28  29 29 30 30  31 31 32 32  33 33 35
VP:    6  6   7  7   7  8  8  8   9  9   9  10 10 10  11 11  11 12 12 12  12 13 13 13  14 14 15
```

Rat tails on the VP track (`RAT_TAIL_VP`) are also data — reconstructed, verify. The app shows
the computed count with the assumed tail positions and lets the user correct it, and draws the
rat stone on its board so the physical pot and the model can be compared before the first draw.

## 3. Solver

### Brew decision (expectimax)

Expectimax over the *remaining bag* (multiset), memoised on
`(bag counts, pos, white_sum, last_white_value, last_two_green_flags, flask_available)`;
oranges/purples/blacks in the pot are derived from the bag.

The full-detail search looks `depth` draws ahead (default 2); at the horizon the state is
valued by a second exact solver on an **abstracted bag** (`brew.Abstract`): whites, purples and
blacks kept exactly, every other chip collapsed to a safe mover of an effective value (red +
pumpkin bonus, blue + best-of-k bonus, yellow +0.6, green + ruby chance). `depth=99` is the
fully exact solve; it agrees with depth 2 to within ~0.1 VP-eq on mid-game bags and is 30-100×
slower. The abstract solver alone (depth 0, shared memo) scores shop candidates.

At each state the options are:

- **stop** → terminal value `V_round(pos, exploded=False, ...)`
- **draw** → expectation over chip types with probability `count/total`; blue chips expand into
  hypergeometric draws of 1/2/4 chips with a max over "place chip X / place nothing"; yellow and
  flask decisions are max nodes.

Terminal value of a round outcome (`value.py`):

```
V = VP(space)                                   (if exploded: max(VP, coin_value·coins))
  + coin_value[round] · coins(space)            (worth of the shop, VP-equivalent)
  + ruby_value[round] · rubies
  + P(bonus die | space, round) · die_EV[round]
  + end-of-round chip effects (green rubies, purple VP/ruby/droplet, black vs opponent model)
```

`coin_value`, `ruby_value`, `droplet_value` are per-round weights (VP-equivalents) — this is the
only heuristic layer. Round 9 weights are exact (5 coins = 1 VP, 2 rubies = 1 VP). Earlier rounds
are tuned by self-play (`sim.py --tune`).

### Shop decision

Enumerate every legal purchase (0, 1, or 2 chips of different colours within budget, respecting
unlock rounds). Score each candidate bag by the exact expected value of the *next* round's brew
from the current droplet (same solver), plus the value of leftover rubies actions. Pick the max.
Ruby spending (droplet vs flask refill vs hold) is chosen the same way.

### Opponent model (`data.py: OPPONENTS`)

- `leader_vp[round]`: expected VP of the leader after each round → rat tails for our player.
- `best_space_mean[round]`, `best_space_sd`: distribution of the best non-exploded opponent
  scoring space → `P(we win the bonus die | our space)`.
- `opp_black[round]`: mean moths per opponent (Poisson) for the black-chip comparison — 2 players:
  beat the opponent; 3+: beat either / both neighbours.
- `n_opponents`.

All of these are measured, not hand-set: `quackulator table --calibrate` prints them for the
policy at the table. Last measured 2026-09-26 (v32 win model, four seats, fortune deck): the
opponents' non-exploded spaces run 9.7 / 15.1 / 27.7 / 45.9 in rounds 1 / 3 / 6 / 9 with sd 4.3,
survival 0.65, the leader enters round 9 on 46 VP. The value function also sees the neighbours'
black chips (four features), so the shop can weigh a moth against what the neighbours hold.

Advisor mode lets the user override the leader's VP and the number of opponents each round.

## 4. Fortune-teller cards (`Fortune.txt`, `rust/src/fortune.rs`, app `FORTUNE`)

24 cards, one drawn at the start of every round (before the rats) from a deck shuffled once per
game, so a card comes up at most once. The Rust sim draws them by default (`--fortune deck`;
`off` or a card name to force one); the app asks which card came up after the round prompt.

**Blue (11) = a rule for the round**, carried in the solver context (`Ctx`) so the expectimax
values it: Portentous Potables (limit 9), Pumpkin Party (orange +1), Bubbling Over (exactly 7
whites at a stop = droplet step), Lucky Devil (+2 VP on a ruby space, even exploded), Fire Burn
(extra ruby on a ruby space), Flask Rabbit (flask use is free), Double Double (die value ×2,
both rolls count — assumption), Safety Procedure (the stop value is the expected best of a
5-chip reveal, reveals treated as independent; at the table the actual reveal is ranked),
Second Chances (state flag `mull`; when the 5th chip is in the pot the value is
max(continue, restart) with restart = the round's value without the option; an exploding 5th
chip ends the round, no restart), Cauldron Bubble (state flag `cb`; the first white may go back
for free, so the flask is never spent on it), Toil and Trouble (no effect on the brew; at the
table an exploded pot hands the left neighbour a 2-chip picked by that seat's value function).

**Purple (13) = immediate**, resolved by ranking every option with the seat's value function
V_r (the WIN model folds VP gains into the margin; round 1 ranks with V_2 because V_1 is a
constant): Choices (black / any 2-chip / 3 rubies), Wheeling and Dealing (ruby → 1-chip or keep),
Boomberry Cleanse (+4 VP or a white 1 out), Rat-a-Tat (any 4-chip or 1 VP per rat tail),
Decisions (droplet +2 or purple), Flea Market (4 drawn chips, upgrade one to the next value of
its colour, else green 1), Good Start (rat stone back k for k rubies, priced by re-solving the
brew from the shorter start with the extra rubies). No decision: Drop It, Infestation (rats ×2),
Charity, Beginner's Luck, Less is More, Take a Chance — settled from the real table in `table`
mode; the solo sim uses fixed stand-ins (fewest rubies if ≤1, fewest VP if 3+ behind, lowest
5-chip sum if ≤6). VP gained by a purple card recomputes the rat tails.

## 5. Files

```
data.py      tables: track, prices, starting bag, die, opponent model, weights
bag.py       Chip type enumeration, Bag multiset helpers
brew.py      exact expectimax brew solver (draw/stop/flask/blue/yellow)
value.py     round terminal value, end-of-round chip effects, opponent probabilities
shop.py      purchase + ruby-spend optimiser
game.py      full 9-round autoplay of one game
sim.py       CLI: batch simulation, stats, weight tuning
advisor.py   CLI: interactive in-game advisor
```
