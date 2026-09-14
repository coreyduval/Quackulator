"""Sanity checks: python test_quackulator.py"""
from bag import parse, starting_bag, fmt, IDX
from brew import Brew, State
from value import RoundCtx, rat_tails
from data import track, LAST_SPACE, TRACK


def test_track():
    assert len(TRACK) == 54 and track(LAST_SPACE) == (35, 15, 0)
    assert track(23) == (19, 5, 0) and track(30) == (22, 7, 1)   # rulebook: "23 with 7 VP" is the 1st 23 (idx 31)
    assert track(31) == (23, 7, 0)
    assert sum(r for _, _, r in TRACK) == 15


def test_parse():
    assert parse("W1x4 W2x2 W3 O1 G1") == starting_bag()
    assert fmt(starting_bag()) == "W1x4 W2x2 W3 O1 G1"


def test_explosion():
    ctx = RoundCtx(1)
    b = Brew(ctx, starting_bag())
    S = b.start(0)
    S2, boom = b.placed(S._replace(bag=parse("W1x4 W2x2")), IDX[("W", 3)])   # W3 first: white 3
    assert not boom and S2.white == 3 and S2.pos == 3
    S3 = S2._replace(white=7)
    _, boom = b.placed(S3._replace(bag=parse("W1x3")), IDX[("W", 1)])
    assert boom


def test_red_bonus():
    ctx = RoundCtx(3)
    bag = parse("W1x4 W2x2 W3 O1x3 R1")
    b = Brew(ctx, bag)
    S = b.start(0)
    S = S._replace(bag=parse("W1x4 W2x2 W3 R1"))       # all 3 oranges in the pot
    S2, _ = b.placed(S._replace(bag=parse("W1x4 W2x2 W3")), IDX[("R", 1)])
    assert S2.pos == 3                                  # 1 + 2 bonus


def test_solver_monotone():
    ctx = RoundCtx(1)
    b = Brew(ctx, starting_bag())
    S = b.start(0)
    v0 = b.V(S)
    v1 = b.V(b.start(1))
    assert v1 > v0 > b.stop_value(S)


def test_rats():
    assert rat_tails(5, 5) == 0 and rat_tails(0, 4) == 2


if __name__ == "__main__":
    for k, f in list(globals().items()):
        if k.startswith("test_"):
            f()
            print("ok", k)
