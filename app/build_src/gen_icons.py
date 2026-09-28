"""Make the Android launcher icons and splash bitmap from duck_1024.png (transparent render of duck.svg)."""
import pathlib
from PIL import Image, ImageDraw
here = pathlib.Path(__file__).parent
res = pathlib.Path(r"C:\Users\Corey's Computer\Desktop\Quackulator\android\app\src\main\res")
duck = Image.open(here / "duck_1024.png").convert("RGBA")
PLUM = (58, 35, 80, 255)

def fit(img, size):
    return img.resize((size, size), Image.LANCZOS)

def rounded_bg(size, radius_frac=0.2):
    bg = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(bg).rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * radius_frac), fill=PLUM)
    return bg

def circle_bg(size):
    bg = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(bg).ellipse([0, 0, size - 1, size - 1], fill=PLUM)
    return bg

def paste_center(bg, fg):
    off = ((bg.width - fg.width) // 2, (bg.height - fg.height) // 2)
    bg.alpha_composite(fg, off)
    return bg

DENS = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
for d, k in DENS.items():
    folder = res / f"mipmap-{d}"
    folder.mkdir(exist_ok=True)
    # adaptive foreground: 108dp canvas, art inside the 72dp safe zone
    s = int(108 * k); art = int(74 * k)
    fg = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    paste_center(fg, fit(duck, art)).save(folder / "ic_launcher_foreground.png")
    # legacy icons: 48dp
    s = int(48 * k); art = int(42 * k)
    paste_center(rounded_bg(s), fit(duck, art)).save(folder / "ic_launcher.png")
    paste_center(circle_bg(s), fit(duck, art)).save(folder / "ic_launcher_round.png")

(res / "mipmap-anydpi-v26").mkdir(exist_ok=True)
for name in ("ic_launcher", "ic_launcher_round"):
    (res / "mipmap-anydpi-v26" / f"{name}.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
        '    <background android:drawable="@color/ic_launcher_background"/>\n'
        '    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n</adaptive-icon>\n', encoding="utf-8")
(res / "values" / "colors.xml").write_text(
    '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#3A2350</color>\n    <color name="splash_background">#3A2350</color>\n</resources>\n', encoding="utf-8")
# splash bitmap for the pre-Android-12 window background (xxhdpi, 240dp)
(res / "drawable-xxhdpi").mkdir(exist_ok=True)
fit(duck, 720).save(res / "drawable-xxhdpi" / "splash_duck.png")
(res / "drawable").mkdir(exist_ok=True)
(res / "drawable" / "splash_bg.xml").write_text(
    '<?xml version="1.0" encoding="utf-8"?>\n<layer-list xmlns:android="http://schemas.android.com/apk/res/android">\n'
    '    <item android:drawable="@color/splash_background"/>\n'
    '    <item android:gravity="center"><bitmap android:src="@drawable/splash_duck" android:gravity="center"/></item>\n</layer-list>\n', encoding="utf-8")
print("icons written")
