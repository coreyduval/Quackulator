"""Terminal value of a brewing outcome, in VP-equivalents, plus the opponent model."""

import math

from data import track, WEIGHTS, OPPONENTS, BONUS_DIE, RAT_TAIL_VP, ROUNDS


class RoundCtx:
    """Everything the solver needs to value the end of one round."""

    def __init__(self, rnd, explode_limit=7, n_opp=None, exploded_gets_both=False,
                 vp_if_no_explode=0, opp_black=None, bonus_die=True):
        self.rnd = rnd
        self.limit = explode_limit
        self.n_opp = OPPONENTS["n"] if n_opp is None else n_opp
        self.exploded_gets_both = exploded_gets_both
        self.vp_if_no_explode = vp_if_no_explode
        self.opp_black = OPPONENTS["opp_black"][rnd] if opp_black is None else opp_black
        self.bonus_die = bonus_die
        w = WEIGHTS
        self.w_coin = w["coin"][rnd]
        self.w_ruby = w["ruby"][rnd]
        self.w_drop = w["droplet"][rnd]
        self.w_orange = w["orange"][rnd]
        # A used flask costs 2 rubies to refill; before the last round that is roughly what it is
        # worth (you refill when the rubies have nothing better to do).
        self.w_flask = 0.0 if rnd >= ROUNDS else 1.5 * self.w_ruby
        self.die_ev = self._die_ev()

    def _die_ev(self):
        vals = {"vp1": 1.0, "vp2": 2.0, "ruby": self.w_ruby,
                "droplet": self.w_drop, "orange": self.w_orange}
        return sum(vals[f] for f in BONUS_DIE) / len(BONUS_DIE)

    def black_odds(self, blacks):
        """(P(droplet), P(ruby)) for having `blacks` moths vs opponents with Poisson(opp_black)
        moths each. 2 players: beat the opponent; 3+: beat either / both neighbours."""
        mu = self.opp_black
        p_less = _pois_cdf(blacks - 1, mu)     # opponent has fewer
        p_eq = _pois_pmf(blacks, mu)
        if self.n_opp <= 1:
            return p_less + p_eq, p_less
        return 1 - (1 - p_less) ** 2, p_less ** 2

    def p_win_die(self, space):
        """P(no opponent has a higher non-exploded scoring space)."""
        if not self.bonus_die or self.n_opp == 0:
            return 1.0
        mean = OPPONENTS["best_space_mean"][self.rnd]
        sd = OPPONENTS["best_space_sd"]
        ps = OPPONENTS["p_survive"]
        # Tie -> farthest chips; call it a coin flip.
        p_one_below = (1 - ps) + ps * _phi((space - 0.5 - mean) / sd)
        return p_one_below ** self.n_opp

    # ---------------------------------------------------------------- terminal value
    def terminal(self, pos, exploded, greens, purples, blacks, flask_used):
        """VP-equivalent value of ending the brew with the last chip on `pos`.

        greens: number of green chips among the last two chips placed.
        """
        space = pos + 1
        coins, vp, ruby = track(space)
        rubies = ruby + greens
        extra = 0.0
        # Purple (ghost's breath), Set 1
        if purples >= 3:
            extra += 2 + self.w_drop
        elif purples == 2:
            extra += 1
            rubies += 1
        elif purples == 1:
            extra += 1
        # Black (moth), Set 1: compare with the (modelled) neighbours' black counts
        if blacks > 0:
            p_drop, p_ruby = self.black_odds(blacks)
            extra += p_drop * self.w_drop
            rubies += p_ruby
        extra += rubies * self.w_ruby
        if flask_used:
            extra -= self.w_flask
        if exploded and not self.exploded_gets_both:
            return max(vp, coins * self.w_coin) + extra
        val = vp + coins * self.w_coin + extra
        if not exploded:
            val += self.vp_if_no_explode
            val += self.p_win_die(space) * self.die_ev
        return val


def _pois_pmf(k, mu):
    if k < 0:
        return 0.0
    return math.exp(-mu) * mu ** k / math.factorial(k)


def _pois_cdf(k, mu):
    return sum(_pois_pmf(i, mu) for i in range(k + 1))


def _phi(x):
    return 0.5 * (1.0 + math.erf(x / math.sqrt(2.0)))


def rat_tails(my_vp, leader_vp):
    """Rat tails strictly between my VP and the leader's VP on the scoring track."""
    if leader_vp <= my_vp:
        return 0
    return sum(1 for t in RAT_TAIL_VP if my_vp < t < leader_vp)
