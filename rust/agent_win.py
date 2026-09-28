"""Unattended win-rate improvement loop.

    python agent_win.py [--until "2026-09-27 11:00"] [--start weights_win_v32.json] [--first-candidate weights_win_v33.json]

Each cycle: train a candidate from the current best at 4-seat tables with the fortune deck
(`train --table`, varied exploration / ridge strength / seed), then play it against the best in
alternating seats on a fresh seed. The candidate is promoted only if its two seats take more than
PROMOTE of the wins. Everything is logged to agent.log; the best policy is always in
weights_win_best.json (history in agent_best_N.json). Nothing starts that could not finish by --until.
"""
import argparse, datetime as dt, os, re, shutil, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
EXE = os.path.join(HERE, "target", "release", "quackulator.exe")
LOG = os.path.join(HERE, "agent.log")
BEST = "weights_win_best.json"
PROMOTE = 0.52            # candidate's share of wins needed (2000 tables: s.e. ~1.1 %)
TABLES = 2000
THREADS = 28
TRAIN_MIN, EVAL_MIN = 85, 22   # wall-clock budgets (3 passes x 4000 tables with cards; 2000-table eval)
SCHEDULE = [               # (explore, lambda, passes, games) cycled through
    (0.25, 10.0, 3, 4000), (0.15, 10.0, 3, 4000), (0.35, 10.0, 3, 4000), (0.25, 5.0, 3, 4000),
    (0.25, 20.0, 3, 4000), (0.20, 10.0, 4, 3000), (0.30, 10.0, 3, 5000),
]


def log(msg):
    line = "%s  %s" % (dt.datetime.now().strftime("%H:%M:%S"), msg)
    print(line, flush=True)
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def run(args, out):
    with open(out, "w", encoding="utf-8") as f:
        subprocess.run([EXE] + args, cwd=HERE, stdout=f, stderr=subprocess.STDOUT)
    return open(out, encoding="utf-8").read()


def head_to_head(cand, best, seed, tag):
    """(candidate share of wins, candidate mean VP, best mean VP)"""
    txt = run(["table", "--players", ",".join([cand, best, cand, best]), "--games", str(TABLES), "--seed", str(seed),
               "--threads", str(THREADS), "--fortune", "deck"], os.path.join(HERE, "agent_eval_%s.txt" % tag))
    rows = re.findall(r"^P(\d)\s+\S+(?:\s+\[[^\]]*\])?\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)", txt, re.M)
    if len(rows) != 4:
        log("eval %s: could not parse table output" % tag)
        return None
    win = [float(r[3]) for r in rows]
    vp = [float(r[1]) for r in rows]
    share = (win[0] + win[2]) / max(1e-9, sum(win))
    return share, (vp[0] + vp[2]) / 2, (vp[1] + vp[3]) / 2


def train(init, out, seed, explore, lam, passes, games):
    txt = run(["train", "--table", "--games", str(games), "--passes", str(passes), "--explore", str(explore), "--lambda", str(lam),
               "--init", init, "--out", out, "--seed", str(seed), "--threads", str(THREADS)], os.path.join(HERE, out.replace(".json", ".log")))
    passes_done = re.findall(r"^-- pass (\d) .*?(?:candidate wins ([\d.]+)%|mean VP ([\d.]+))", txt, re.M)
    return ("wrote %s (new best" % out) in txt, passes_done


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--until", default="2026-09-27 11:00")
    ap.add_argument("--start", default="weights_win_v32.json")
    ap.add_argument("--first-candidate", default=None)
    ap.add_argument("--wait-log", default=None, help="a training log to wait for ('done') before starting")
    a = ap.parse_args()
    end = dt.datetime.strptime(a.until, "%Y-%m-%d %H:%M")
    left = lambda: (end - dt.datetime.now()).total_seconds() / 60

    log("agent start: best <- %s, until %s" % (a.start, end))
    if a.wait_log:
        while True:
            txt = open(os.path.join(HERE, a.wait_log), encoding="utf-8").read() if os.path.exists(os.path.join(HERE, a.wait_log)) else ""
            if re.search(r"^done", txt, re.M) or "panicked" in txt:
                break
            time.sleep(30)
        log("waited for %s" % a.wait_log)
    shutil.copy(os.path.join(HERE, a.start), os.path.join(HERE, BEST))
    promoted = 0
    cand = a.first_candidate if a.first_candidate and os.path.exists(os.path.join(HERE, a.first_candidate)) else None
    seed = 1000
    cycle = 0
    while True:
        if cand:
            if left() < EVAL_MIN:
                log("not enough time for an evaluation of %s; stopping" % cand)
                break
            seed += 1
            r = head_to_head(cand, BEST, seed, "%02d" % cycle)
            if r:
                share, vpc, vpb = r
                log("eval %s vs best (seed %d): candidate %.1f%% of wins, %.2f vs %.2f VP -> %s" % (cand, seed, 100 * share, vpc, vpb, "PROMOTE" if share > PROMOTE else "reject"))
                if share > PROMOTE:
                    promoted += 1
                    shutil.copy(os.path.join(HERE, cand), os.path.join(HERE, "agent_best_%d.json" % promoted))
                    shutil.copy(os.path.join(HERE, cand), os.path.join(HERE, BEST))
                    log("best <- %s (promotion %d)" % (cand, promoted))
            cand = None
        if left() < TRAIN_MIN + EVAL_MIN:
            log("not enough time for another train + eval cycle (%.0f min left); stopping" % left())
            break
        explore, lam, passes, games = SCHEDULE[cycle % len(SCHEDULE)]
        out = "agent_cand_%02d.json" % cycle
        seed += 1
        log("cycle %d: train from best (explore %.2f lambda %g passes %d games %d seed %d) -> %s" % (cycle, explore, lam, passes, games, seed, out))
        t0 = time.time()
        ok, passes_done = train(BEST, out, seed, explore, lam, passes, games)
        log("cycle %d: training took %.0f min; passes %s; %s" % (cycle, (time.time() - t0) / 60, passes_done, "candidate written" if ok else "no candidate beat the best in the trainer's own test"))
        cand = out if ok else None
        cycle += 1
    log("agent done: %d promotion(s); best policy in %s" % (promoted, BEST))


if __name__ == "__main__":
    main()
