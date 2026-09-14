"""Purchase and ruby-spend optimiser.

Every legal purchase (0, 1 or 2 chips of different colours within budget) is scored by the
expected value of the *next* round's brew with the resulting bag, using the abstract solver
(shared memo across candidates). Ruby spending is scored the same way.
"""

from itertools import combinations

from bag import BUYABLE, COLOR, VALUE, add, name
from data import PRICES, UNLOCK_ROUND, ROUNDS, WEIGHTS, OPPONENTS
from brew import Brew, Abstract
from value import RoundCtx, rat_tails


def next_round_ev(bag, droplet, flask, ctx, abstract, my_vp, depth=0):
    rats = rat_tails(my_vp, OPPONENTS["leader_vp"][ctx.rnd]) if ctx.rnd >= 2 else 0
    b = Brew(ctx, bag, flask_full=flask, depth=depth, abstract=abstract)
    return b.V(b.start(droplet, rats))


def purchase_options(coins, rnd):
    """All legal purchases for the shop after round `rnd`, as lists of chip indices."""
    avail = [i for i in BUYABLE if UNLOCK_ROUND[COLOR[i]] <= rnd + 1 and PRICES[(COLOR[i], VALUE[i])] <= coins]
    opts = [()]
    for i in avail:
        opts.append((i,))
    for i, j in combinations(avail, 2):
        if COLOR[i] != COLOR[j] and PRICES[(COLOR[i], VALUE[i])] + PRICES[(COLOR[j], VALUE[j])] <= coins:
            opts.append((i, j))
    return opts


def cost(opt):
    return sum(PRICES[(COLOR[i], VALUE[i])] for i in opt)


def best_purchase(bag, coins, rnd, droplet, flask, my_vp, top_singles=5, depth=0):
    """Return (chips, ev, ranked) where ranked is [(chips, ev), ...] best first."""
    nxt = rnd + 1
    ctx = RoundCtx(nxt)
    A = Abstract(ctx)
    opts = purchase_options(coins, rnd)
    singles = [o for o in opts if len(o) == 1]
    scored = {}
    for o in [()] + singles:
        scored[o] = next_round_ev(_apply(bag, o), droplet, flask, ctx, A, my_vp, depth)
    # pairs: only among the most promising singles (keeps late-game shops fast)
    good = sorted(singles, key=lambda o: -scored[o])[:top_singles]
    good_set = set(i for (i,) in good)
    for o in opts:
        if len(o) == 2 and o[0] in good_set and o[1] in good_set:
            scored[o] = next_round_ev(_apply(bag, o), droplet, flask, ctx, A, my_vp, depth)
    ranked = sorted(scored.items(), key=lambda kv: -kv[1])
    return ranked[0][0], ranked[0][1], ranked


def _apply(bag, opt):
    for i in opt:
        bag = add(bag, i)
    return bag


def spend_rubies(bag, rubies, rnd, droplet, flask, my_vp, depth=0):
    """Decide how to spend rubies after round `rnd`. Returns (droplet, flask, rubies, actions)."""
    actions = []
    if rnd >= ROUNDS:
        return droplet, flask, rubies, actions
    nxt = rnd + 1
    ctx = RoundCtx(nxt)
    A = Abstract(ctx)
    rounds_left = ROUNDS - rnd
    hold_value = 2 * WEIGHTS["ruby"][nxt]
    while rubies >= 2:
        base = next_round_ev(bag, droplet, flask, ctx, A, my_vp, depth)
        gain_drop = (next_round_ev(bag, droplet + 1, flask, ctx, A, my_vp, depth) - base) * rounds_left
        gain_flask = 0.0
        if not flask:
            gain_flask = next_round_ev(bag, droplet, True, ctx, A, my_vp, depth) - base
        best = max(gain_drop, gain_flask, hold_value)
        if best == hold_value:
            break
        rubies -= 2
        if best == gain_drop:
            droplet += 1
            actions.append("droplet -> %d" % droplet)
        else:
            flask = True
            actions.append("refill flask")
    return droplet, flask, rubies, actions


def fmt_opt(opt):
    return " + ".join(name(i) for i in opt) if opt else "nothing"
