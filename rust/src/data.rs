//! Static game data (Set 1) — mirrors ../data.py.

pub const TRACK: [(u8, u8, u8); 54] = [
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
];
pub const LAST: usize = 53;
#[inline]
pub fn track(space: usize) -> (f64, f64, f64) {
    let (c, v, r) = TRACK[space.min(LAST)];
    (c as f64, v as f64, r as f64)
}
#[inline]
pub fn track_i(space: usize) -> (i32, i32, i32) {
    let (c, v, r) = TRACK[space.min(LAST)];
    (c as i32, v as i32, r as i32)
}

/// Chip types, same order as bag.py: W1 W2 W3 O1 G1 G2 G4 B1 B2 B4 R1 R2 R4 Y1 Y2 Y4 P1 K1
pub const N: usize = 18;
pub const COLOR: [u8; N] = *b"WWWOGGGBBBRRRYYYPK";
pub const VALUE: [u8; N] = [1, 2, 3, 1, 1, 2, 4, 1, 2, 4, 1, 2, 4, 1, 2, 4, 1, 1];
pub const NAMES: [&str; N] = ["W1", "W2", "W3", "O1", "G1", "G2", "G4", "B1", "B2", "B4", "R1", "R2", "R4", "Y1", "Y2", "Y4", "P1", "K1"];
pub const I_W1: usize = 0;
pub const I_W2: usize = 1;
pub const I_W3: usize = 2;
pub const I_O: usize = 3;
pub const I_P: usize = 16;
pub const I_K: usize = 17;
pub const I_W: [usize; 4] = [usize::MAX, 0, 1, 2];

/// price per chip type (0 = not buyable)
pub const PRICE: [i32; N] = [0, 0, 0, 3, 4, 8, 14, 5, 10, 19, 6, 10, 16, 8, 12, 18, 9, 10];
pub fn unlock_round(color: u8) -> u32 {
    match color { b'Y' => 2, b'P' => 3, _ => 1 }
}

pub type Bag = [u8; N];
pub fn starting_bag() -> Bag {
    let mut b = [0u8; N];
    b[I_W1] = 4; b[I_W2] = 2; b[I_W3] = 1; b[I_O] = 1; b[4] = 1;
    b
}
pub fn parse_bag(s: &str) -> Bag {
    let mut b = [0u8; N];
    for tok in s.split_whitespace() {
        let t = tok.to_uppercase();
        let (name, n) = match t.find(|c| c == 'X' || c == '*' || c == ':') {
            Some(p) if p >= 2 => (&t[..p], t[p + 1..].parse::<u8>().unwrap_or(1)),
            _ => (&t[..], 1),
        };
        let i = NAMES.iter().position(|x| *x == name).unwrap_or_else(|| panic!("unknown chip {}", name));
        b[i] += n;
    }
    b
}
pub fn fmt_bag(b: &Bag) -> String {
    let mut v = vec![];
    for i in 0..N { if b[i] > 0 { v.push(if b[i] > 1 { format!("{}x{}", NAMES[i], b[i]) } else { NAMES[i].to_string() }); } }
    v.join(" ")
}
pub fn total(b: &Bag) -> u32 { b.iter().map(|&x| x as u32).sum() }

pub const ROUNDS: u32 = 9;
pub const EXTRA_WHITE_ROUND: u32 = 6;
pub const EXPLODE_LIMIT: i32 = 7;

/// Bonus die faces: 0=vp1 1=vp1 2=vp2 3=ruby 4=droplet 5=orange
pub const DIE: [u8; 6] = [0, 0, 1, 2, 3, 4];

pub struct Opponents {
    pub n: u32,
    pub leader_vp: [i32; 10],
    pub best_space_mean: [f64; 10],
    pub best_space_sd: f64,
    pub p_survive: f64,
    pub opp_black: [f64; 10],
}
pub const OPP: Opponents = Opponents {
    n: 2,
    leader_vp: [0, 0, 1, 2, 4, 6, 10, 15, 21, 30],
    best_space_mean: [0.0, 9.0, 11.0, 13.0, 15.0, 18.0, 21.0, 26.0, 31.0, 36.0],
    best_space_sd: 5.0,
    p_survive: 0.75,
    opp_black: [0.0, 0.0, 0.1, 0.3, 0.5, 0.7, 0.9, 1.1, 1.3, 1.5],
};
pub const RAT_TAIL_VP: [i32; 25] = [1, 3, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46, 48, 50];
pub fn rat_tails(my: i32, leader: i32) -> u32 {
    if leader <= my { return 0; }
    RAT_TAIL_VP.iter().filter(|&&t| my < t && t < leader).count() as u32
}

/// Heuristic exchange rates (v1), by round 1..9.
pub const W_COIN: [f64; 10] = [0.0, 0.55, 0.52, 0.48, 0.44, 0.40, 0.35, 0.30, 0.25, 0.20];
pub const W_RUBY: [f64; 10] = [0.0, 1.20, 1.15, 1.10, 1.05, 1.00, 0.90, 0.80, 0.65, 0.50];
pub const W_DROP: [f64; 10] = [0.0, 3.00, 2.70, 2.40, 2.10, 1.80, 1.50, 1.10, 0.70, 0.00];
pub const W_ORANGE: [f64; 10] = [0.0, 1.60, 1.45, 1.30, 1.15, 1.00, 0.80, 0.60, 0.35, 0.00];
