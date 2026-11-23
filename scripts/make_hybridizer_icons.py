"""Create the icons of the Saintpaulia Hybridizer app (site/mycrosses/) from a pink bloom illustration in source/.

One bloom is cropped, the white background and the neighbouring leaf are made transparent, and the result is written at the sizes
browsers and phones ask for (same method as make_icons.py, which makes the main site's icons).
Needs Pillow (development only):  python scripts/make_hybridizer_icons.py
"""
from pathlib import Path

from PIL import Image, ImageFilter

from make_icons import largest_shape

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "source" / "428ebd7b-3e8e-48ea-b015-42f6a301159c (pink).png"
APP = ROOT / "site" / "mycrosses"
ICONS = APP / "icons"

BOX = (90, 25, 695, 620)      # the top-left bloom in the 1402 x 1122 original (a leaf tip is inside the box and is removed below)


def bloom():
    im = Image.open(SRC).convert("RGB").crop(BOX).resize((1024, 1024), Image.LANCZOS)
    px = im.load()
    alpha = Image.new("L", im.size, 255)
    ap = alpha.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b = px[x, y]
            white = r > 238 and g > 238 and b > 238
            green = g > r + 12 and g > b + 12                 # the leaf is green, the bloom pink and yellow
            if white or green:
                ap[x, y] = 0
    alpha = alpha.filter(ImageFilter.MinFilter(5))          # drop the pale fringe
    alpha = largest_shape(alpha).filter(ImageFilter.GaussianBlur(1.2))
    im.putalpha(alpha)
    bbox = im.getchannel("A").point(lambda a: 255 if a > 20 else 0).getbbox()
    im = im.crop(bbox)
    side = max(im.size)
    sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    sq.paste(im, ((side - im.width) // 2, (side - im.height) // 2))
    pad = round(side * 0.04)
    out = Image.new("RGBA", (side + 2 * pad, side + 2 * pad), (0, 0, 0, 0))
    out.paste(sq, (pad, pad))
    return out


def main():
    ICONS.mkdir(parents=True, exist_ok=True)
    b = bloom()
    b.resize((512, 512), Image.LANCZOS).save(ICONS / "icon-512.png")
    b.resize((192, 192), Image.LANCZOS).save(ICONS / "icon-192.png")
    b.resize((96, 96), Image.LANCZOS).save(ICONS / "logo.png")          # header logo (shown at 32 px) and Home page (64 px)
    tile = Image.new("RGBA", (180, 180), (253, 247, 250, 255))          # iOS home-screen icons cannot be transparent
    small = b.resize((144, 144), Image.LANCZOS)
    tile.paste(small, (18, 18), small)
    tile.convert("RGB").save(ICONS / "apple-touch-icon.png")
    b.resize((64, 64), Image.LANCZOS).save(APP / "favicon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
    print("wrote", ", ".join(sorted(p.name for p in ICONS.iterdir())), "and favicon.ico in", APP)


if __name__ == "__main__":
    main()
