"""Embed a trained weights.json into the web app (and the Android asset copy).

    python rust/install_weights.py weights.json
"""
import json, re, sys, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
w = json.load(open(sys.argv[1]))
win = w.get("format") == "quackulator-win-v2"
assert win or w.get("format") == "quackulator-value-v1", "unknown weights format"
assert len(w["rounds"]) == (10 if win else 9)
emb = {"rounds": w["rounds"], "games": w.get("games")}
if win:
    emb.update(win=True, opp_gain=w["opp_gain"], win_rate=w.get("win_rate"))
else:
    emb["mean_vp"] = w.get("mean_vp")
line = "const VMODEL=" + json.dumps(emb, separators=(",", ":")) + ";"
app = root / "app" / "index.html"
html = app.read_text()
html2, n = re.subn(r"^const VMODEL=.*;$", line, html, count=1, flags=re.M)
assert n == 1, "VMODEL line not found in app/index.html"
app.write_text(html2)
asset = root / "android" / "app" / "src" / "main" / "assets" / "index.html"
if asset.exists():
    asset.write_text('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
                     + html2.split("\n", 1)[0] + "</head><body>" + html2.split("\n", 1)[1] + "</body></html>")
print("installed %s weights (%s over %s games) into app/index.html%s" % ("WIN" if win else "VP",
      ("win rate %.3f" % w.get("win_rate", 0)) if win else ("mean VP %.2f" % w.get("mean_vp", 0)), w.get("games"), " and android asset" if asset.exists() else ""))
