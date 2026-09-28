"""Assemble app/index.html = head.html (+ the duck) + <script> DUCK_SVG + engine.js + ui.js </script>, and the Android asset copy."""
import pathlib
here=pathlib.Path(__file__).parent
root=pathlib.Path(r"C:\Users\Corey's Computer\Desktop\Quackulator")
head=(here/"head.html").read_text(encoding="utf-8").rstrip("\n")
engine=(here/"engine.js").read_text(encoding="utf-8").rstrip("\n")
ui=(here/"ui.js").read_text(encoding="utf-8").rstrip("\n")
duck=(here/"duck.svg").read_text(encoding="utf-8").strip()
assert "`" not in duck and "${" not in duck
head=head.replace("<!--DUCK-->",duck.replace("<svg ",'<svg class="duck bob chomp" ',1))
ui="const DUCK_SVG=`"+duck+"`;\n"+ui
html=head+"\n\n<script>\n"+engine+"\n\n"+ui+"\n</script>\n"
(root/"app"/"index.html").write_text(html,encoding="utf-8")
asset=root/"android"/"app"/"src"/"main"/"assets"/"index.html"
first,rest=html.split("\n",1)
asset.write_text('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'+first+"</head><body>"+rest+"</body></html>",encoding="utf-8")
print("wrote",len(html),"chars")
