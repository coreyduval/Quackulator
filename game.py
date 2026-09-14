"""Full 9-round autoplay of one game with the optimal-policy solver."""

import random

from bag import starting_bag, add, IDX, NTYPES, fmt, name, total
from data import ROUNDS, ROUND_EXTRA_WHITE, OPPONENTS, BONUS_DIE, track
from brew import Brew, Abstract
from value import RoundCtx, rat_tails
from shop import best_purchase, spend_rubies, fmt_opt

I_W1 = IDX[("W", 1)]
I_O = IDX[("O", 1)]
I_P = IDX[("P", 1)]
I_K = IDX[("K", 1)]


class Player:
    def __init__(self):
        self.bag = starting_bag()
        self.droplet = 0
        self.rubies = 0
        self.vp = 0
        self.flask = True


def play_game(seed=None, depth=2, shop_depth=0, verbose=False, n_opp=None):
    rng = random.Random(seed)
    p = Player()
    log = []
    say = log.append if verbose else (lambda s: None)
    history = []
    for rnd in range(1, ROUNDS + 1):
        if rnd == ROUND_EXTRA_WHITE:
            p.bag = add(p.bag, I_W1)
        rats = rat_tails(p.vp, OPPONENTS["leader_vp"][rnd]) if rnd >= 2 else 0
        ctx = RoundCtx(rnd, n_opp=n_opp)
        brew = Brew(ctx, p.bag, flask_full=p.flask, depth=depth)
        S = brew.start(p.droplet, rats)
        say("-- round %d  bag: %s  droplet %d  rats %d  rubies %d  VP %d" % (
            rnd, fmt(p.bag), p.droplet, rats, p.rubies, p.vp))
        exploded = False
        draws = []
        while total(S.bag):
            draw, sv, dv = brew.should_draw(S)
            if not draw:
                say("   stop at space %d (stop %.2f vs draw %.2f)" % (S.pos + 1, sv, dv))
                break
            pool = [j for j in range(NTYPES) for _ in range(S.bag[j])]
            i = rng.choice(pool)
            sub = []
            S, exploded = brew.play_chip(S, i, rng, sub)
            draws.append(name(i))
            say("   drew %s -> space %d, whites %d%s" % (name(i), S.pos + 1, S.white,
                                                        ("; " + "; ".join(sub)) if sub else ""))
            if exploded:
                say("   BOOM at space %d" % (S.pos + 1))
                break
        # ---- evaluation
        space = S.pos + 1
        coins, vp, ruby = track(space)
        rubies = ruby + int(S.g1) + int(S.g2)
        purples = brew.n_p - S.bag[I_P]
        blacks = brew.n_k - S.bag[I_K]
        extra_vp = 0
        if purples >= 3:
            extra_vp += 2
            p.droplet += 1
        elif purples == 2:
            extra_vp += 1
            rubies += 1
        elif purples == 1:
            extra_vp += 1
        if blacks:
            p_drop, p_ruby = ctx.black_odds(blacks)
            r = rng.random()
            if r < p_ruby:
                p.droplet += 1
                rubies += 1
            elif r < p_drop:
                p.droplet += 1
        if exploded:
            if vp >= coins * ctx.w_coin:
                coins = 0
            else:
                vp = 0
        else:
            if rng.random() < ctx.p_win_die(space):
                face = rng.choice(BONUS_DIE)
                say("   bonus die: %s" % face)
                if face == "vp1":
                    extra_vp += 1
                elif face == "vp2":
                    extra_vp += 2
                elif face == "ruby":
                    rubies += 1
                elif face == "droplet":
                    p.droplet += 1
                elif face == "orange":
                    p.bag = add(p.bag, I_O)
        p.vp += vp + extra_vp
        p.rubies += rubies
        p.flask = S.flask
        say("   space %d: %s%d VP, %d coins, +%d rubies" % (
            space, "EXPLODED " if exploded else "", vp + extra_vp, coins, rubies))
        # ---- shop / end
        if rnd < ROUNDS:
            opt, ev, _ = best_purchase(p.bag, coins, rnd, p.droplet, p.flask, p.vp, depth=shop_depth)
            for i in opt:
                p.bag = add(p.bag, i)
            say("   buy %s (%d coins, next-round EV %.2f)" % (fmt_opt(opt), coins, ev))
            p.droplet, p.flask, p.rubies, acts = spend_rubies(
                p.bag, p.rubies, rnd, p.droplet, p.flask, p.vp, depth=shop_depth)
            for a in acts:
                say("   rubies: %s" % a)
        else:
            bonus = coins // 5 + p.rubies // 2
            say("   final: %d coins + %d rubies -> +%d VP" % (coins, p.rubies, bonus))
            p.vp += bonus
            p.rubies = p.rubies % 2
        history.append({"round": rnd, "space": space, "exploded": exploded, "vp": p.vp,
                        "draws": draws})
    return p.vp, history, log


if __name__ == "__main__":
    import sys
    seed = int(sys.argv[1]) if len(sys.argv) > 1 else 1
    vp, hist, log = play_game(seed, verbose=True)
    print("\n".join(log))
    print("FINAL VP:", vp)
