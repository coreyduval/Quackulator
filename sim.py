"""Batch self-play benchmark for the Quackulator policy.

  python sim.py -n 100                 play 100 games (seeds 0..99), print stats
  python sim.py -n 50 --seed 1000      different seed range
  python sim.py -n 1 --seed 7 -v       one verbose game
  python sim.py -n 60 --tune coin=0.8,1.0,1.2 --tune droplet=0.7,1.0,1.3
                                       grid-search multipliers on the value weights
  python sim.py -n 100 --calibrate     print per-round VP / space curves for data.OPPONENTS
"""

import argparse
import statistics
import sys
import time
from multiprocessing import Pool

import data
from game import play_game


BASE_WEIGHTS = {k: list(v) for k, v in data.WEIGHTS.items()}


def _run(args):
    seed, depth, shop_depth, scale = args
    for k, base in BASE_WEIGHTS.items():
        m = (scale or {}).get(k, 1.0)
        data.WEIGHTS[k] = [w * m for w in base]
    vp, hist, _ = play_game(seed, depth=depth, shop_depth=shop_depth)
    return vp, hist


def run_batch(n, seed0, depth, shop_depth, scale=None, procs=None):
    jobs = [(seed0 + i, depth, shop_depth, scale) for i in range(n)]
    with Pool(procs) as pool:
        return pool.map(_run, jobs)


def summarise(results, label=""):
    vps = [r[0] for r in results]
    n = len(vps)
    mean = statistics.mean(vps)
    sd = statistics.pstdev(vps) if n > 1 else 0.0
    print("%s%d games: mean VP %.1f  sd %.1f  min %d  max %d  (se %.1f)" % (
        label, n, mean, sd, min(vps), max(vps), sd / max(1, n) ** 0.5))
    rounds = len(results[0][1])
    print("round   mean space   explode%   mean VP after")
    for r in range(rounds):
        sp = statistics.mean(h[r]["space"] for _, h in results)
        ex = 100.0 * sum(h[r]["exploded"] for _, h in results) / n
        vp = statistics.mean(h[r]["vp"] for _, h in results)
        print("  %d       %5.1f       %5.1f      %5.1f" % (r + 1, sp, ex, vp))
    return mean


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("-n", type=int, default=20)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--depth", type=int, default=2, help="brew lookahead depth (99 = exact, slow)")
    ap.add_argument("--shop-depth", type=int, default=0)
    ap.add_argument("--procs", type=int, default=None)
    ap.add_argument("-v", action="store_true", help="verbose log of each game")
    ap.add_argument("--tune", action="append", default=[], metavar="WEIGHT=m1,m2,..",
                    help="multipliers to grid-search for a WEIGHTS key (coin/ruby/droplet/orange)")
    ap.add_argument("--calibrate", action="store_true")
    a = ap.parse_args()

    if a.v:
        for i in range(a.n):
            vp, hist, log = play_game(a.seed + i, depth=a.depth, shop_depth=a.shop_depth, verbose=True)
            print("\n".join(log))
            print("FINAL VP: %d\n" % vp)
        return

    if a.tune:
        grids = {}
        for t in a.tune:
            k, vals = t.split("=")
            grids[k] = [float(x) for x in vals.split(",")]
        keys = list(grids)
        import itertools
        best = None
        for combo in itertools.product(*[grids[k] for k in keys]):
            scale = dict(zip(keys, combo))
            t0 = time.time()
            res = run_batch(a.n, a.seed, a.depth, a.shop_depth, scale, a.procs)
            m = statistics.mean(r[0] for r in res)
            print("%-40s mean VP %.2f  (%.0fs)" % (scale, m, time.time() - t0))
            sys.stdout.flush()
            if best is None or m > best[0]:
                best = (m, scale)
        print("best:", best)
        return

    t0 = time.time()
    res = run_batch(a.n, a.seed, a.depth, a.shop_depth, None, a.procs)
    summarise(res)
    print("%.0fs" % (time.time() - t0))
    if a.calibrate:
        n = len(res)
        rounds = len(res[0][1])
        vp_before = [0] + [statistics.mean(h[r]["vp"] for _, h in res) for r in range(rounds - 1)]
        spaces = [statistics.mean(h[r]["space"] for _, h in res) for r in range(rounds)]
        print("suggested OPPONENTS['leader_vp']      =", [0] + [round(v) for v in vp_before])
        print("suggested OPPONENTS['best_space_mean'] =", [0] + [round(s) for s in spaces])


if __name__ == "__main__":
    main()
