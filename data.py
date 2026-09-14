"""Static game data for The Quacks of Quedlinburg (Set 1) and the opponent model.

Everything tunable lives here. No game logic.
"""

# --------------------------------------------------------------------------- pot track
# (coins, vp, ruby) per space index, transcribed from the physical board.
# Coin values 15..33 appear on two consecutive spaces; the last space is 35 coins / 15 VP.
TRACK = [
    (0, 0, 0), (1, 0, 0), (2, 0, 0), (3, 0, 0), (4, 0, 0), (5, 0, 1),
    (6, 1, 0), (7, 1, 0), (8, 1, 0), (9, 1, 1),
    (10, 2, 0), (11, 2, 0), (12, 2, 0), (13, 2, 1),
    (14, 3, 0), (15, 3, 0), (15, 3, 1), (16, 3, 0),
    (16, 4, 0), (17, 4, 0), (17, 4, 1), (18, 4, 0),
    (18, 5, 0), (19, 5, 0), (19, 5, 1), (20, 5, 0),
    (20, 6, 0), (21, 6, 0), (21, 6, 1),
    (22, 7, 0), (22, 7, 1), (23, 7, 0),
    (23, 8, 0), (24, 8, 0), (24, 8, 1),
    (25, 9, 0), (25, 9, 1), (26, 9, 0),
    (26, 10, 0), (27, 10, 0), (27, 10, 1),
    (28, 11, 0), (28, 11, 1), (29, 11, 0),
    (29, 12, 0), (30, 12, 0), (30, 12, 1), (31, 12, 0),
    (31, 13, 0), (32, 13, 0), (32, 13, 1),
    (33, 14, 0), (33, 14, 1), (35, 15, 0),
]
LAST_SPACE = len(TRACK) - 1  # 53


def track(space):
    """(coins, vp, ruby) for a space index, clamped to the last space."""
    return TRACK[min(space, LAST_SPACE)]


# --------------------------------------------------------------------------- chips
# Chip type = (colour, value). Colours: W white, O orange, G green, B blue, R red, Y yellow, P purple, K black.
COLORS = "WOGBRYPK"
COLOR_NAMES = {
    "W": "white (cherry bomb)", "O": "orange (pumpkin)", "G": "green (spider)",
    "B": "blue (crow skull)", "R": "red (toadstool)", "Y": "yellow (mandrake)",
    "P": "purple (ghost's breath)", "K": "black (moth)",
}

# Set 1 prices per (colour, value). Colours absent for a value cannot be bought.
PRICES = {
    ("O", 1): 3,
    ("G", 1): 4, ("G", 2): 8, ("G", 4): 14,
    ("B", 1): 5, ("B", 2): 10, ("B", 4): 19,
    ("R", 1): 6, ("R", 2): 10, ("R", 4): 16,
    ("Y", 1): 8, ("Y", 2): 12, ("Y", 4): 18,
    ("P", 1): 9,
    ("K", 1): 10,
}
# First round in which a colour may be bought.
UNLOCK_ROUND = {"O": 1, "G": 1, "B": 1, "R": 1, "Y": 2, "P": 3, "K": 1}

STARTING_BAG = {("W", 1): 4, ("W", 2): 2, ("W", 3): 1, ("O", 1): 1, ("G", 1): 1}

EXPLODE_LIMIT = 7          # white sum > limit explodes
ROUNDS = 9
ROUND_EXTRA_WHITE = 6      # add a white 1-chip at the start of this round

# Bonus die faces. The rulebook lists five outcomes for a six-sided die; the repeated face is
# assumed to be "1 VP" — edit if your die differs.
BONUS_DIE = ["vp1", "vp1", "vp2", "ruby", "droplet", "orange"]

# --------------------------------------------------------------------------- opponent model
# Theoretical opponents: they never act, but their expected state feeds rat tails, the bonus
# die and the black-chip comparison. All indexed by round (1..9); index 0 unused.
OPPONENTS = {
    "n": 2,
    # Leader's VP total *before* each round (used for rat tails).
    "leader_vp": [0, 0, 1, 2, 4, 6, 10, 15, 21, 30],
    # Best non-exploded opponent scoring space this round: mean and sd of a normal.
    "best_space_mean": [0, 9, 11, 13, 15, 18, 21, 26, 31, 36],
    "best_space_sd": 5.0,
    # Probability each opponent does not explode.
    "p_survive": 0.75,
    # Mean black chips per opponent in their pot this round (Poisson; moth comparison).
    "opp_black": [0, 0.0, 0.1, 0.3, 0.5, 0.7, 0.9, 1.1, 1.3, 1.5],
}

# Rat tails on the VP scoring track (0..50). A player counts the tails strictly between their
# VP and the leader's VP. Reconstructed — verify against the board.
RAT_TAIL_VP = [1, 3, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46, 48, 50]

# --------------------------------------------------------------------------- value weights
# VP-equivalent worth of one coin / one ruby / one droplet step / one orange chip, by round.
# Round 9 values are exact (5 coins = 1 VP, 2 rubies = 1 VP, droplet worthless after round 9).
# Earlier rounds are heuristics tuned by self-play (sim.py --tune).
WEIGHTS = {
    "coin":    [0, 0.55, 0.52, 0.48, 0.44, 0.40, 0.35, 0.30, 0.25, 0.20],
    "ruby":    [0, 1.20, 1.15, 1.10, 1.05, 1.00, 0.90, 0.80, 0.65, 0.50],
    "droplet": [0, 3.00, 2.70, 2.40, 2.10, 1.80, 1.50, 1.10, 0.70, 0.00],
    "orange":  [0, 1.60, 1.45, 1.30, 1.15, 1.00, 0.80, 0.60, 0.35, 0.00],
}
