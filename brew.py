"""Exact expectimax solver for one round of brewing (Set 1).

State (all hashable, memoised per solver instance):
  bag    tuple of chip counts still in the bag
  pos    space index of the last chip placed (scoring space = pos + 1)
  white  sum of white chips currently in the pot
  lastw  value of the last chip placed if it was white, else 0 (yellow / flask rule)
  g1,g2  whether the last / next-to-last chip placed is green (spider rubies)
  flask  flask still available this round
Purple and black counts in the pot are derived from the starting bag of the solve.
"""

from collections import namedtuple
from math import comb

from bag import COLOR, VALUE, IDX, NTYPES, remove, add, total
from data import LAST_SPACE

State = namedtuple("State", "bag pos white lastw g1 g2 flask")

I_O = IDX[("O", 1)]
I_P = IDX[("P", 1)]
I_K = IDX[("K", 1)]
I_W = {1: IDX[("W", 1)], 2: IDX[("W", 2)], 3: IDX[("W", 3)]}


class Brew:
    def __init__(self, ctx, start_bag, flask_full=True, depth=2, abstract=None):
        self.ctx = ctx
        self.depth = depth
        self.start_bag = start_bag
        self.n_o = start_bag[I_O]
        self.n_p = start_bag[I_P]
        self.n_k = start_bag[I_K]
        self.flask_full = flask_full
        self.memo = {}
        self.bmemo = {}
        self.abstract = abstract or Abstract(ctx)

    # ------------------------------------------------------------------ state helpers
    def start(self, droplet, rats=0):
        return State(self.start_bag, droplet + rats, 0, 0, False, False, self.flask_full)

    def _term(self, S, exploded):
        greens = int(S.g1) + int(S.g2)
        purples = self.n_p - S.bag[I_P]
        blacks = self.n_k - S.bag[I_K]
        return self.ctx.terminal(S.pos, exploded, greens, purples, blacks, not S.flask)

    def stop_value(self, S):
        return self._term(S, False)

    def explode_prob(self, S):
        n = total(S.bag)
        if n == 0:
            return 0.0
        return sum(S.bag[i] for v, i in I_W.items() if S.white + v > self.ctx.limit) / n

    # ------------------------------------------------------------------ transitions
    def placed(self, S, i, ret_white=False):
        """State after chip i (already removed from S.bag) is placed.

        ret_white: yellow option - return the white chip placed directly before.
        Returns (state, exploded).
        """
        c, v = COLOR[i], VALUE[i]
        bag, pos, white, lastw, g1, g2 = S.bag, S.pos, S.white, S.lastw, S.g1, S.g2
        if ret_white:
            assert c == "Y" and lastw
            bag = add(bag, I_W[lastw])
            pos -= lastw
            white -= lastw
            g1 = g2          # the white is gone; the chip before it is now next-to-last
            g2 = False
        if c == "W":
            white += v
            pos += v
            return State(bag, min(pos, LAST_SPACE), white, v, False, g1, S.flask), white > self.ctx.limit
        if c == "R":
            oranges = self.n_o - bag[I_O]
            v += 2 if oranges >= 3 else (1 if oranges >= 1 else 0)
        pos += v
        return State(bag, min(pos, LAST_SPACE), white, 0, c == "G", g1, S.flask), False

    def use_flask(self, S_before):
        """State after returning the white just drawn: the pre-draw state with the flask spent."""
        return S_before._replace(flask=False)

    # ------------------------------------------------------------------ solver
    def V(self, S, d=None):
        """Value of a state where the player may stop or draw.

        d: remaining draws the full search may look ahead (None = solver default; 99 = exact).
        At the horizon the state is valued by the abstract solver (see Abstract).
        """
        if d is None:
            d = self.depth
        m = self.memo
        key = (S, d)
        if key in m:
            return m[key]
        best = self._term(S, False)
        n = total(S.bag)
        if n and d <= 0:
            best = max(best, self.leaf(S))
        elif n:
            dv = 0.0
            for i in range(NTYPES):
                k = S.bag[i]
                if k:
                    dv += k * self.place(S._replace(bag=remove(S.bag, i)), i, S, d - 1)
            dv /= n
            if dv > best:
                best = dv
        m[key] = best
        return best

    def leaf(self, S):
        """Horizon estimate: exact solve of the abstracted bag from this state."""
        greens = int(S.g1) + int(S.g2)
        return self.abstract.value(S, greens, self.n_p - S.bag[I_P], self.n_k - S.bag[I_K],
                                   self.n_o - S.bag[I_O])

    def draw_value(self, S, d=None):
        if d is None:
            d = self.depth
        n = total(S.bag)
        if not n:
            return None
        dv = 0.0
        for i in range(NTYPES):
            k = S.bag[i]
            if k:
                dv += k * self.place(S._replace(bag=remove(S.bag, i)), i, S, d - 1)
        return dv / n

    def place(self, S, i, S_before, d):
        """Value after drawing chip i (S has it removed), resolving its action optimally."""
        c = COLOR[i]
        S2, boom = self.placed(S, i)
        if c == "W":
            if boom:
                return self._term(S2, True)
            val = self.V(S2, d)
            if S_before.flask:
                val = max(val, self.V(self.use_flask(S_before), d))
            return val
        if c == "Y" and S.lastw:
            S3, _ = self.placed(S, i, ret_white=True)
            return max(self.V(S2, d), self.V(S3, d))
        if c == "B":
            return self.blue(S2, VALUE[i], d)
        return self.V(S2, d)

    def blue(self, S, k, d):
        """Crow skull: draw k chips, place at most one of them, return the rest."""
        key = (S, k, d)
        if key in self.bmemo:
            return self.bmemo[key]
        n = total(S.bag)
        k = min(k, n)
        if k == 0:
            val = self.V(S, d)
        else:
            val = 0.0
            denom = comb(n, k)
            for combo, ways in _combos(S.bag, k):
                best = self.V(S, d)
                for j in combo:
                    best = max(best, self.place(S._replace(bag=remove(S.bag, j)), j, S, d))
                val += ways / denom * best
        self.bmemo[key] = val
        return val

    def blue_pick_values(self, S, combo, d=None):
        """For the advisor: value of placing each chip in `combo` (or none)."""
        if d is None:
            d = self.depth
        out = {None: self.V(S, d)}
        for j in set(combo):
            out[j] = self.place(S._replace(bag=remove(S.bag, j)), j, S, d)
        return out


    # ------------------------------------------------------------------ play-out helpers
    def should_draw(self, S):
        """(draw?, stop_value, draw_value) for the current state."""
        stop = self.stop_value(S)
        draw = self.draw_value(S)
        return (draw is not None and draw > stop), stop, draw

    def play_chip(self, S_before, i, rng, log=None):
        """Resolve chip i drawn from S_before with optimal choices; random sub-draws use rng.

        Returns (state, exploded).
        """
        S = S_before._replace(bag=remove(S_before.bag, i))
        c = COLOR[i]
        S2, boom = self.placed(S, i)
        if c == "W":
            if boom:
                return S2, True
            if S_before.flask and self.V(self.use_flask(S_before)) > self.V(S2):
                if log is not None:
                    log.append("flask: return W%d" % VALUE[i])
                return self.use_flask(S_before), False
            return S2, False
        if c == "Y" and S.lastw:
            S3, _ = self.placed(S, i, ret_white=True)
            if self.V(S3) > self.V(S2):
                if log is not None:
                    log.append("mandrake: return W%d" % S.lastw)
                return S3, False
            return S2, False
        if c == "B":
            k = min(VALUE[i], total(S2.bag))
            pool = [j for j in range(NTYPES) for _ in range(S2.bag[j])]
            combo = tuple(rng.sample(pool, k)) if k else ()
            vals = self.blue_pick_values(S2, combo)
            pick = max(vals, key=vals.get)
            if log is not None:
                log.append("crow skull drew %s -> %s" % (
                    " ".join(_nm(j) for j in combo), _nm(pick) if pick is not None else "none"))
            if pick is None:
                return S2, False
            return self.play_chip(S2, pick, rng, log)
        return S2, False


def _nm(i):
    return "%s%d" % (COLOR[i], VALUE[i])


class Abstract:
    """Fast exact solver on a reduced bag: whites, purples and blacks kept exactly, every other
    chip collapsed to a 'safe' chip of an effective value (draw-time actions approximated as extra
    value, spider rubies as a fixed bonus). Used as the leaf of the depth-limited full solver
    and, on its own, as the fast evaluator for shopping."""

    def __init__(self, ctx):
        self.ctx = ctx
        self.memo = {}

    def effective_value(self, i, oranges):
        c, v = COLOR[i], VALUE[i]
        if c == "R":
            return v + (2 if oranges >= 3 else (1 if oranges >= 1 else 0))
        if c == "B":
            return v + {1: 1, 2: 1, 4: 2}[v]
        if c == "Y":
            return v + 0.6
        if c == "G":
            return v + 0.3 * self.ctx.w_ruby
        return v

    def value(self, S, greens, purples, blacks, oranges):
        w = (S.bag[I_W[1]], S.bag[I_W[2]], S.bag[I_W[3]])
        safe = [0] * 8   # counts by effective value (rounded) 0..7
        for i in range(NTYPES):
            k = S.bag[i]
            if not k or COLOR[i] in "WPK":
                continue
            safe[min(int(round(self.effective_value(i, oranges))), 7)] += k
        fixed = (greens, purples, blacks)
        return self._v(w, tuple(safe), S.bag[I_P], S.bag[I_K], S.pos, S.white, S.flask, fixed)

    def _v(self, w, safe, pr, kr, pos, white, flask, fixed):
        key = (w, safe, pr, kr, pos, white, flask, fixed)
        m = self.memo
        if key in m:
            return m[key]
        ctx = self.ctx
        g, p, b = fixed
        best = ctx.terminal(pos, False, g, p, b, not flask)
        n = sum(w) + sum(safe) + pr + kr
        if n:
            dv = 0.0
            for wi, k in enumerate(w):
                if not k:
                    continue
                v = wi + 1
                nw = white + v
                np_ = min(pos + v, LAST_SPACE)
                if nw > ctx.limit:
                    val = ctx.terminal(np_, True, g, p, b, not flask)
                else:
                    w2 = list(w)
                    w2[wi] -= 1
                    val = self._v(tuple(w2), safe, pr, kr, np_, nw, flask, fixed)
                    if flask:
                        val = max(val, self._v(w, safe, pr, kr, pos, white, False, fixed))
                dv += k * val
            for v, k in enumerate(safe):
                if not k:
                    continue
                s2 = list(safe)
                s2[v] -= 1
                dv += k * self._v(w, tuple(s2), pr, kr, min(pos + v, LAST_SPACE), white, flask, fixed)
            if pr:
                dv += pr * self._v(w, safe, pr - 1, kr, min(pos + 1, LAST_SPACE), white, flask, (g, p + 1, b))
            if kr:
                dv += kr * self._v(w, safe, pr, kr - 1, min(pos + 1, LAST_SPACE), white, flask, (g, p, b + 1))
            dv /= n
            if dv > best:
                best = dv
        m[key] = best
        return best


def _combos(bag, k, start=0):
    """Multiset combinations of size k drawn from `bag`: yields (types, ways)."""
    if k == 0:
        yield (), 1
        return
    for i in range(start, NTYPES):
        c = bag[i]
        if not c:
            continue
        for t in range(1, min(c, k) + 1):
            w = comb(c, t)
            for rest, rw in _combos(bag, k - t, i + 1):
                yield (i,) * t + rest, w * rw
