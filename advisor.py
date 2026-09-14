"""Interactive in-game advisor: tell it what you draw, it tells you what to do.

  python advisor.py                       start a new game
  python advisor.py --round 4 --bag "W1x4 W2x2 W3 O1x2 G1 B1" --droplet 1 --vp 6 --rubies 1
                                          resume mid-game (flask assumed full; --no-flask if not)

Chip codes: W1 W2 W3 (white), O1, G1/G2/G4, B1/B2/B4, R1/R2/R4, Y1/Y2/Y4, P1, K1.
"""

import argparse
import random

from bag import parse, fmt, add, remove, name, IDX, NTYPES, total
from data import ROUNDS, ROUND_EXTRA_WHITE, OPPONENTS, COLOR_NAMES, track, PRICES
from brew import Brew
from value import RoundCtx, rat_tails
from shop import best_purchase, spend_rubies, fmt_opt, purchase_options, cost

I_W1 = IDX[("W", 1)]
I_O = IDX[("O", 1)]
I_P = IDX[("P", 1)]
I_K = IDX[("K", 1)]


def ask(prompt, default=None):
    try:
        s = input("%s%s: " % (prompt, (" [%s]" % default) if default is not None else "")).strip()
    except EOFError:
        raise SystemExit("\nbye")
    return s if s else (str(default) if default is not None else "")


def ask_int(prompt, default):
    while True:
        s = ask(prompt, default)
        try:
            return int(s)
        except ValueError:
            print("  number please")


def ask_chip(prompt):
    while True:
        s = ask(prompt).upper()
        if s in ("STOP", "S", ""):
            return None
        try:
            return IDX[(s[0], int(s[1:]))]
        except (KeyError, ValueError, IndexError):
            print("  unknown chip (e.g. W2, O1, B4) or 'stop'")


def fortune_modifiers():
    print("Fortune teller card? enter any of: limit=8 | limit=9 | droplet (droplet +1 this round)"
          " | both (exploded pots get coins AND VP) | novp=N (+N VP if you don't explode) | enter for none")
    mods = {}
    for tok in ask("modifiers", "").replace(",", " ").split():
        t = tok.lower()
        if t.startswith("limit="):
            mods["explode_limit"] = int(t[6:])
        elif t == "droplet":
            mods["droplet_bonus"] = 1
        elif t == "both":
            mods["exploded_gets_both"] = True
        elif t.startswith("novp="):
            mods["vp_if_no_explode"] = int(t[5:])
    return mods


def brew_round(rnd, bag, droplet, flask, vp, rubies, n_opp, depth):
    print("\n=== ROUND %d ===  bag: %s   droplet %d   VP %d   rubies %d   flask %s" % (
        rnd, fmt(bag), droplet, vp, rubies, "full" if flask else "empty"))
    mods = fortune_modifiers()
    leader = ask_int("Leader's VP (for rat tails)", OPPONENTS["leader_vp"][rnd]) if rnd >= 2 else 0
    rats = rat_tails(vp, leader) if rnd >= 2 else 0
    ctx = RoundCtx(rnd, explode_limit=mods.get("explode_limit", 7), n_opp=n_opp,
                   exploded_gets_both=mods.get("exploded_gets_both", False),
                   vp_if_no_explode=mods.get("vp_if_no_explode", 0))
    brew = Brew(ctx, bag, flask_full=flask, depth=depth)
    S = brew.start(droplet + mods.get("droplet_bonus", 0), rats)
    print("rat tails: %d -> chips start after space %d" % (rats, S.pos))
    exploded = False
    while total(S.bag):
        draw, sv, dv = brew.should_draw(S)
        pe = brew.explode_prob(S)
        print("\nspace %d | whites %d/%d | explode next draw %.0f%% | stop %.2f vs draw %.2f  ==> %s" % (
            S.pos + 1, S.white, ctx.limit, 100 * pe, sv, dv, "DRAW" if draw else "STOP"))
        i = ask_chip("chip drawn (or 'stop')")
        if i is None:
            break
        if S.bag[i] == 0:
            print("  that chip isn't in the bag")
            continue
        S, exploded = play_chip_interactive(brew, S, i)
        if exploded:
            print("  BOOM - pot exploded at space %d" % (S.pos + 1))
            break
    return S, exploded, ctx, brew


def play_chip_interactive(brew, S_before, i):
    S = S_before._replace(bag=remove(S_before.bag, i))
    c = name(i)[0]
    S2, boom = brew.placed(S, i)
    if c == "W":
        if boom:
            return S2, True
        if S_before.flask:
            keep, ret = brew.V(S2), brew.V(brew.use_flask(S_before))
            if ret > keep:
                print("  FLASK: return this W%d (keep %.2f vs return %.2f)" % (name(i) and int(name(i)[1:]), keep, ret))
                if ask("use flask? y/n", "y").lower().startswith("y"):
                    return brew.use_flask(S_before), False
            else:
                print("  (flask: keep it, %.2f vs %.2f)" % (keep, ret))
        return S2, False
    if c == "Y" and S.lastw:
        S3, _ = brew.placed(S, i, ret_white=True)
        keep, ret = brew.V(S2), brew.V(S3)
        rec = "RETURN the W%d" % S.lastw if ret > keep else "keep it"
        print("  mandrake: keep %.2f vs return white %.2f ==> %s" % (keep, ret, rec))
        if ask("return the white? y/n", "y" if ret > keep else "n").lower().startswith("y"):
            return S3, False
        return S2, False
    if c == "B":
        k = min(int(name(i)[1:]), total(S2.bag))
        print("  crow skull: draw %d chip(s) and enter them (e.g. 'W1 O1')" % k)
        while True:
            toks = ask("drawn").upper().split()
            try:
                combo = tuple(IDX[(t[0], int(t[1:]))] for t in toks)
            except (KeyError, ValueError, IndexError):
                print("  bad chip code")
                continue
            if len(combo) != k:
                print("  expected %d chips" % k)
                continue
            break
        vals = brew.blue_pick_values(S2, combo)
        best = max(vals, key=vals.get)
        for j, v in sorted(vals.items(), key=lambda kv: -kv[1]):
            print("    place %-4s %.2f" % (name(j) if j is not None else "none", v))
        pick = ask("place which? (chip or 'none')", name(best) if best is not None else "none").upper()
        if pick == "NONE":
            return S2, False
        j = IDX[(pick[0], int(pick[1:]))]
        return play_chip_interactive(brew, S2, j)
    return S2, False


def evaluate(rnd, S, exploded, ctx, brew, droplet, rubies, vp, bag):
    space = S.pos + 1
    coins, vp_gain, ruby = track(space)
    new_rubies = ruby + int(S.g1) + int(S.g2)
    purples = brew.n_p - S.bag[I_P]
    blacks = brew.n_k - S.bag[I_K]
    extra_vp = 0
    print("\nscoring space %d: %d coins, %d VP%s" % (space, coins, vp_gain, ", ruby" if ruby else ""))
    if S.g1 or S.g2:
        print("  spiders in last two chips: +%d ruby" % (int(S.g1) + int(S.g2)))
    if purples:
        if purples >= 3:
            extra_vp += 2
            droplet += 1
            print("  ghost's breath x%d: +2 VP, droplet +1" % purples)
        elif purples == 2:
            extra_vp += 1
            new_rubies += 1
            print("  ghost's breath x2: +1 VP, +1 ruby")
        else:
            extra_vp += 1
            print("  ghost's breath: +1 VP")
    if blacks:
        r = ask("moth x%d: result vs neighbours? (none / droplet / droplet+ruby)" % blacks, "droplet").lower()
        if "droplet" in r:
            droplet += 1
        if "ruby" in r:
            new_rubies += 1
    if exploded and not ctx.exploded_gets_both:
        take_vp = vp_gain >= coins * ctx.w_coin
        print("  exploded: take %s (VP %d vs coins %d worth ~%.1f VP)" % (
            "VP" if take_vp else "COINS", vp_gain, coins, coins * ctx.w_coin))
        if ask("take vp or coins?", "vp" if take_vp else "coins").lower().startswith("v"):
            coins = 0
        else:
            vp_gain = 0
    elif not exploded:
        extra_vp += ctx.vp_if_no_explode
        print("  bonus die chance ~%.0f%%" % (100 * ctx.p_win_die(space)))
        face = ask("bonus die result? (none / vp1 / vp2 / ruby / droplet / orange)", "none").lower()
        if face == "vp1":
            extra_vp += 1
        elif face == "vp2":
            extra_vp += 2
        elif face == "ruby":
            new_rubies += 1
        elif face == "droplet":
            droplet += 1
        elif face == "orange":
            bag = add(bag, I_O)
    vp += vp_gain + extra_vp
    rubies += new_rubies
    print("  => VP %d, rubies %d, %d coins to spend" % (vp, rubies, coins))
    return coins, droplet, rubies, vp, bag


def shop_phase(rnd, bag, coins, droplet, flask, vp, rubies, shop_depth):
    opt, ev, ranked = best_purchase(bag, coins, rnd, droplet, flask, vp, depth=shop_depth)
    print("\nshop (%d coins). best buys:" % coins)
    for o, v in ranked[:6]:
        print("   %-12s %2d coins   EV %.2f" % (fmt_opt(o), cost(o), v))
    print("  ==> buy %s" % fmt_opt(opt))
    s = ask("bought (chips, or 'none')", fmt_opt(opt).replace(" + ", " "))
    if s.lower() not in ("nothing", "none"):
        bag = tuple(a + b for a, b in zip(bag, parse(s)))
    d2, f2, r2, acts = spend_rubies(bag, rubies, rnd, droplet, flask, vp, depth=shop_depth)
    if rubies >= 2:
        print("  rubies (%d): recommend %s" % (rubies, ", ".join(acts) if acts else "hold"))
        n_drop = ask_int("droplet steps bought", sum(1 for a in acts if a.startswith("droplet")))
        droplet += n_drop
        rubies -= 2 * n_drop
        if not flask and rubies >= 2:
            if ask("refill flask? y/n", "y" if f2 else "n").lower().startswith("y"):
                flask = True
                rubies -= 2
    return bag, droplet, flask, rubies


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--round", type=int, default=1)
    ap.add_argument("--bag", default=None, help='e.g. "W1x4 W2x2 W3 O1 G1"')
    ap.add_argument("--droplet", type=int, default=0)
    ap.add_argument("--vp", type=int, default=0)
    ap.add_argument("--rubies", type=int, default=0)
    ap.add_argument("--no-flask", action="store_true")
    ap.add_argument("--opponents", type=int, default=OPPONENTS["n"])
    ap.add_argument("--depth", type=int, default=2)
    ap.add_argument("--shop-depth", type=int, default=0)
    a = ap.parse_args()

    bag = parse(a.bag) if a.bag else parse("W1x4 W2x2 W3 O1 G1")
    droplet, vp, rubies, flask = a.droplet, a.vp, a.rubies, not a.no_flask
    for rnd in range(a.round, ROUNDS + 1):
        if rnd == ROUND_EXTRA_WHITE and (rnd > a.round or a.bag is None):
            bag = add(bag, I_W1)
            print("(round 6: white 1-chip added to the bag)")
        S, exploded, ctx, brew = brew_round(rnd, bag, droplet, flask, vp, rubies, a.opponents, a.depth)
        flask = S.flask
        coins, droplet, rubies, vp, bag = evaluate(rnd, S, exploded, ctx, brew, droplet, rubies, vp, bag)
        if rnd < ROUNDS:
            bag, droplet, flask, rubies = shop_phase(rnd, bag, coins, droplet, flask, vp, rubies, a.shop_depth)
        else:
            bonus = coins // 5 + rubies // 2
            print("\nfinal: %d coins -> %d VP, %d rubies -> %d VP" % (coins, coins // 5, rubies, rubies // 2))
            vp += bonus
            print("FINAL SCORE: %d VP" % vp)
    print("\nbag at end: %s" % fmt(bag))


if __name__ == "__main__":
    main()
