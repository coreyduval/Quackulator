//! Learned whole-game value function, one model per round, fitted from self-play. Two kinds:
//!
//!   VP  (format quackulator-value-v1): V_r(bag, droplet, rubies, flask) = expected VP still to
//!       come from the start of round r. Ridge regression on return-to-go. Solo `train`.
//!   WIN (format quackulator-win-v2):   V_r(bag, droplet, rubies, flask, margin) = P(win the game)
//!       from the start of round r, where margin = my VP - best other player's VP. Logistic
//!       regression on the win indicator from 4-seat tables (`train --table`). Round 10 is the
//!       game-end model in the margin alone. `opp_gain[r]` is the mean VP a seat gains in round r,
//!       used to project the margin one round ahead while brewing.

use crate::data::*;

pub const NF: usize = 1 + N + N + 8 + 1;
/// index of the margin feature (last)
pub const IDX_MARGIN: usize = NF - 1;
pub const MARGIN_CLAMP: f64 = 30.0;

#[inline]
pub fn sigmoid(z: f64) -> f64 { 1.0 / (1.0 + (-z).exp()) }

pub fn features(bag: &Bag, droplet: i32, rubies: i32, flask: bool, margin: i32) -> [f64; NF] {
    let mut f = [0.0; NF];
    f[0] = 1.0;
    f[IDX_MARGIN] = (margin as f64).clamp(-MARGIN_CLAMP, MARGIN_CLAMP);
    let mut k = 1;
    for i in 0..N { f[k] = bag[i] as f64; k += 1; }
    for i in 0..N { f[k] = (bag[i] as f64).powi(2); k += 1; }
    let d = droplet as f64;
    let wsum = (bag[I_W1] as f64) + 2.0 * (bag[I_W2] as f64) + 3.0 * (bag[I_W3] as f64);
    let tot = total(bag) as f64;
    let whites = (bag[I_W1] + bag[I_W2] + bag[I_W3]) as f64;
    let reds = (bag[10] + bag[11] + bag[12]) as f64;
    f[k] = d; f[k + 1] = d * d; f[k + 2] = rubies as f64; f[k + 3] = if flask { 1.0 } else { 0.0 };
    f[k + 4] = wsum; f[k + 5] = tot - whites; f[k + 6] = (bag[I_O] as f64) * reds; f[k + 7] = whites / tot.max(1.0);
    f
}

pub fn feature_names() -> Vec<String> {
    let mut v = vec!["const".to_string()];
    for i in 0..N { v.push(NAMES[i].to_string()); }
    for i in 0..N { v.push(format!("{}^2", NAMES[i])); }
    for s in ["droplet", "droplet^2", "rubies", "flask", "white_value", "coloured_chips", "orange_x_red", "white_fraction", "margin"] { v.push(s.to_string()); }
    v
}

/// Game-end features for the WIN model's round 10: constant and margin only.
pub fn features_end(margin: f64) -> [f64; NF] {
    let mut f = [0.0; NF];
    f[0] = 1.0;
    f[IDX_MARGIN] = margin.clamp(-MARGIN_CLAMP, MARGIN_CLAMP);
    f
}

#[derive(Clone)]
pub struct Model {
    /// coefficients for rounds 1..=9 (index 0 unused); round 10 is zero for VP models and the
    /// game-end model (constant + margin) for WIN models
    pub coef: Vec<[f64; NF]>,
    pub trained: bool,
    /// true = WIN model (value is a logit of P(win)); false = VP model (value is VP)
    pub win: bool,
    /// mean VP gained by a seat in round r (WIN models), for projecting the margin one round ahead
    pub opp_gain: [f64; 10],
}

impl Model {
    pub fn empty() -> Model { Model { coef: vec![[0.0; NF]; 11], trained: false, win: false, opp_gain: [0.0; 10] } }
    pub fn empty_win() -> Model { let mut m = Model::empty(); m.win = true; m }

    /// The linear part of the value at the start of round `rnd` (1..=10): VP still to come for a
    /// VP model, the logit of P(win) for a WIN model.
    #[inline]
    pub fn value(&self, rnd: u32, f: &[f64; NF]) -> f64 {
        if rnd > ROUNDS + 1 { return 0.0; }
        let c = &self.coef[rnd as usize];
        let mut s = 0.0;
        for i in 0..NF { s += c[i] * f[i]; }
        s
    }

    /// Value of a bag state with the margin term left out (margin = 0). The shop ranks purchases
    /// with this; the brewing terminal adds `margin_coef(rnd) * margin` itself (WIN models).
    pub fn value_state(&self, rnd: u32, bag: &Bag, droplet: i32, rubies: i32, flask: bool) -> f64 {
        if rnd > ROUNDS { return 0.0; }
        self.value(rnd, &features(bag, droplet, rubies, flask, 0))
    }

    /// Coefficient of the margin feature at the start of round `rnd` (1..=10); 0 for VP models.
    pub fn margin_coef(&self, rnd: u32) -> f64 { self.coef[(rnd as usize).min(10)][IDX_MARGIN] }

    /// Ridge regression fit for one round from (features, return-to-go) samples.
    pub fn fit_round(&mut self, rnd: u32, xs: &[[f64; NF]], ys: &[f64], lambda: f64) {
        let n = NF;
        let mut a = vec![vec![0.0; n + 1]; n];
        for (x, &y) in xs.iter().zip(ys) {
            for i in 0..n {
                let xi = x[i];
                if xi == 0.0 { continue; }
                let row = &mut a[i];
                for j in 0..n { row[j] += xi * x[j]; }
                row[n] += xi * y;
            }
        }
        for i in 1..n { a[i][i] += lambda; }   // don't shrink the constant
        self.coef[rnd as usize] = solve(a);
        self.trained = true;
    }

    /// Ridge-penalised logistic regression for one round from (features, won 0/1) samples,
    /// by damped Newton (IRLS). Returns the final mean log-loss.
    pub fn fit_logistic(&mut self, rnd: u32, xs: &[[f64; NF]], ys: &[f64], lambda: f64) -> f64 {
        let n = NF;
        let mut w = [0.0; NF];
        let loss = |w: &[f64; NF]| -> f64 {
            let mut l = 0.0;
            for (x, &y) in xs.iter().zip(ys) {
                let z: f64 = (0..n).map(|i| w[i] * x[i]).sum();
                // -log p(y|z), numerically stable
                l += z.max(0.0) - z * y + (1.0 + (-z.abs()).exp()).ln();
            }
            for i in 1..n { l += 0.5 * lambda * w[i] * w[i]; }
            l
        };
        let mut cur = loss(&w);
        for _ in 0..25 {
            // gradient and Hessian of the penalised negative log-likelihood
            let mut a = vec![vec![0.0; n + 1]; n];
            for (x, &y) in xs.iter().zip(ys) {
                let z: f64 = (0..n).map(|i| w[i] * x[i]).sum();
                let p = sigmoid(z);
                let wt = p * (1.0 - p);
                let g = y - p;
                for i in 0..n {
                    let xi = x[i];
                    if xi == 0.0 { continue; }
                    let row = &mut a[i];
                    for j in 0..n { row[j] += wt * xi * x[j]; }
                    row[n] += xi * g;
                }
            }
            for i in 1..n { a[i][i] += lambda; a[i][n] -= lambda * w[i]; }
            a[0][0] += 1e-9;
            let step = solve(a);
            // damped step: halve until the loss does not increase
            let mut t = 1.0;
            let mut improved = false;
            for _ in 0..12 {
                let mut w2 = w;
                for i in 0..n { w2[i] += t * step[i]; }
                let l2 = loss(&w2);
                if l2 <= cur { w = w2; improved = l2 < cur - 1e-9 * cur.abs().max(1.0); cur = l2; break; }
                t *= 0.5;
            }
            if !improved { break; }
        }
        self.coef[rnd as usize] = w;
        self.trained = true;
        cur / xs.len().max(1) as f64
    }

    // ------------------------------------------------------------ json i/o (no deps)
    pub fn to_json(&self, score: f64, games: usize) -> String {
        let names = feature_names();
        let mut s = String::from(if self.win { "{\n  \"format\": \"quackulator-win-v2\",\n" } else { "{\n  \"format\": \"quackulator-value-v1\",\n" });
        s += &format!("  \"{}\": {:.3},\n  \"games\": {},\n", if self.win { "win_rate" } else { "mean_vp" }, score, games);
        if self.win {
            s += "  \"opp_gain\": [";
            s += &(1..=ROUNDS as usize).map(|r| format!("{:.3}", self.opp_gain[r])).collect::<Vec<_>>().join(", ");
            s += "],\n";
        }
        s += "  \"features\": [";
        s += &names.iter().map(|n| format!("\"{}\"", n)).collect::<Vec<_>>().join(", ");
        s += "],\n  \"rounds\": [\n";
        let last = if self.win { ROUNDS as usize + 1 } else { ROUNDS as usize };
        for r in 1..=last {
            s += "    [";
            s += &self.coef[r].iter().map(|c| format!("{:.6}", c)).collect::<Vec<_>>().join(", ");
            s += if r == last { "]\n" } else { "],\n" };
        }
        s += "  ]\n}\n";
        s
    }

    pub fn from_json(text: &str) -> Model {
        let win = text.contains("quackulator-win-v2");
        let mut m = if win { Model::empty_win() } else { Model::empty() };
        if win {
            let i = text.find("\"opp_gain\"").expect("weights.json: win model without opp_gain");
            let open = text[i..].find('[').unwrap() + i;
            let close = text[open..].find(']').unwrap() + open;
            for (k, t) in text[open + 1..close].split(',').enumerate() { m.opp_gain[k + 1] = t.trim().parse().unwrap(); }
        }
        // find "rounds", then read the bracketed number lists (9 for VP models, 10 for WIN models)
        let idx = text.find("\"rounds\"").expect("weights.json: no \"rounds\" key");
        let rest = &text[idx..];
        let mut pos = rest.find('[').unwrap() + 1;
        let last = if win { ROUNDS as usize + 1 } else { ROUNDS as usize };
        for r in 1..=last {
            let open = rest[pos..].find('[').unwrap() + pos;
            let close = rest[open..].find(']').unwrap() + open;
            let nums: Vec<f64> = rest[open + 1..close].split(',').map(|t| t.trim().parse::<f64>().unwrap()).collect();
            // VP models written before the margin feature existed have NF-1 coefficients
            assert!(nums.len() == NF || (!win && nums.len() == NF - 1), "weights.json: round {} has {} coefficients, expected {}", r, nums.len(), NF);
            for i in 0..nums.len() { m.coef[r][i] = nums[i]; }
            pos = close + 1;
        }
        m.trained = true;
        m
    }
}

/// Solve the augmented system [A | b] (n rows, n+1 columns) by Gaussian elimination with partial pivoting.
fn solve(mut a: Vec<Vec<f64>>) -> [f64; NF] {
    let n = NF;
    {
        for col in 0..n {
            let mut piv = col;
            for r in col + 1..n { if a[r][col].abs() > a[piv][col].abs() { piv = r; } }
            a.swap(col, piv);
            let p = a[col][col];
            if p.abs() < 1e-12 { continue; }
            for r in 0..n {
                if r == col { continue; }
                let fct = a[r][col] / p;
                if fct == 0.0 { continue; }
                for c in col..=n { a[r][c] -= fct * a[col][c]; }
            }
        }
    }
    let mut c = [0.0; NF];
    for i in 0..n { c[i] = if a[i][i].abs() < 1e-12 { 0.0 } else { a[i][n] / a[i][i] }; }
    c
}
