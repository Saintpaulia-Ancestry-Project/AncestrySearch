"""Create the site icons in site/ from the illustration in source/.

One bloom is cropped from the illustration, the white background and the neighbouring leaves
are made transparent, and the result is written at the sizes browsers and phones ask for.
Needs Pillow (development only; the site itself does not):  .venv\\Scripts\\pip install pillow
Usage:  .venv\\Scripts\\python scripts\\make_icons.py
"""
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "source" / "lf3h_chlv_161216.jpg"
OUT = ROOT / "site"
ICONS = OUT / "icons"

# Crop box around the top-left bloom, as fractions of the 5244 x 4195 original.
BOX = (341 / 5244, 105 / 4195, 2594 / 5244, 2358 / 4195)


def largest_shape(mask):
    """Keep only the biggest connected opaque region of an 'L' mask (4-connected flood fill)."""
    w, h = mask.size
    px = mask.load()
    label = [[0] * w for _ in range(h)]
    best, best_n, n_labels = 0, 0, 0
    for sy in range(h):
        for sx in range(w):
            if px[sx, sy] <= 128 or label[sy][sx]:
                continue
            n_labels += 1
            stack, size = [(sx, sy)], 0
            label[sy][sx] = n_labels
            while stack:
                x, y = stack.pop()
                size += 1
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= nx < w and 0 <= ny < h and not label[ny][nx] and px[nx, ny] > 128:
                        label[ny][nx] = n_labels
                        stack.append((nx, ny))
            if size > best_n:
                best, best_n = n_labels, size
    out = Image.new("L", (w, h), 0)
    op = out.load()
    for y in range(h):
        row = label[y]
        for x in range(w):
            if row[x] == best:
                op[x, y] = 255
    return out


def bloom():
    im = Image.open(SRC).convert("RGB")
    w, h = im.size
    box = tuple(round(v * s) for v, s in zip(BOX, (w, h, w, h)))
    im = im.crop(box).resize((1024, 1024), Image.LANCZOS)
    px = im.load()
    alpha = Image.new("L", im.size, 255)
    ap = alpha.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b = px[x, y]
            white = r > 232 and g > 232 and b > 232
            green = g > r + 8 and g > b + 8       # leaves nearby are green, the bloom is purple/yellow
            if white or green:
                ap[x, y] = 0
    alpha = alpha.filter(ImageFilter.MinFilter(5))  # drop the pale fringe
    alpha = largest_shape(alpha).filter(ImageFilter.GaussianBlur(1.2))  # drop pieces of neighbouring flowers
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
    master = b.resize((512, 512), Image.LANCZOS)
    master.save(ICONS / "icon-512.png")
    b.resize((192, 192), Image.LANCZOS).save(ICONS / "icon-192.png")
    b.resize((64, 64), Image.LANCZOS).save(ICONS / "logo.png")      # header logo (shown at 32px)
    # iOS home-screen icons cannot be transparent: place the bloom on the page background
    tile = Image.new("RGBA", (180, 180), (251, 249, 252, 255))
    small = b.resize((144, 144), Image.LANCZOS)
    tile.paste(small, (18, 18), small)
    tile.convert("RGB").save(ICONS / "apple-touch-icon.png")
    sizes = [(16, 16), (32, 32), (48, 48), (64, 64)]
    b.resize((64, 64), Image.LANCZOS).save(OUT / "favicon.ico", sizes=sizes)
    print("wrote", ", ".join(sorted(p.name for p in ICONS.iterdir())), "and favicon.ico")


if __name__ == "__main__":
    main()
