"""Chip types and bag (multiset) helpers."""

from data import PRICES, STARTING_BAG

# Fixed ordering of every chip type that can exist in a bag.
CHIP_TYPES = [
    ("W", 1), ("W", 2), ("W", 3),
    ("O", 1),
    ("G", 1), ("G", 2), ("G", 4),
    ("B", 1), ("B", 2), ("B", 4),
    ("R", 1), ("R", 2), ("R", 4),
    ("Y", 1), ("Y", 2), ("Y", 4),
    ("P", 1),
    ("K", 1),
]
IDX = {ct: i for i, ct in enumerate(CHIP_TYPES)}
NTYPES = len(CHIP_TYPES)
COLOR = [c for c, _ in CHIP_TYPES]
VALUE = [v for _, v in CHIP_TYPES]
BUYABLE = [IDX[ct] for ct in PRICES]


def empty():
    return (0,) * NTYPES


def from_dict(d):
    counts = [0] * NTYPES
    for ct, n in d.items():
        counts[IDX[ct]] += n
    return tuple(counts)


def starting_bag():
    return from_dict(STARTING_BAG)


def add(bag, i, n=1):
    b = list(bag)
    b[i] += n
    return tuple(b)


def remove(bag, i, n=1):
    b = list(bag)
    b[i] -= n
    assert b[i] >= 0
    return tuple(b)


def total(bag):
    return sum(bag)


def parse(text):
    """Parse 'W1x4 W2x2 W3 O1 G1' (or 'w1*4', 'w1:4') into a bag tuple."""
    counts = [0] * NTYPES
    for tok in text.replace(",", " ").split():
        tok = tok.upper()
        n = 1
        for sep in ("X", "*", ":"):
            if sep in tok[2:]:
                base, cnt = tok.split(sep, 1)
                tok, n = base, int(cnt)
                break
        ct = (tok[0], int(tok[1:]))
        if ct not in IDX:
            raise ValueError("unknown chip %r" % tok)
        counts[IDX[ct]] += n
    return tuple(counts)


def fmt(bag):
    parts = []
    for i, n in enumerate(bag):
        if n:
            c, v = CHIP_TYPES[i]
            parts.append("%s%d" % (c, v) + ("x%d" % n if n > 1 else ""))
    return " ".join(parts) or "(empty)"


def name(i):
    c, v = CHIP_TYPES[i]
    return "%s%d" % (c, v)
