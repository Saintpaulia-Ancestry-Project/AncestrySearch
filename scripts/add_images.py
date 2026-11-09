"""Add photos to the project.

Takes a folder of photos, matches each file to a cultivar by its filename, resizes it into the
separate images repository, and records it (with its photographer credit) in data/images.csv.
Then rebuild the database with scripts/build_db.py.

    python scripts/add_images.py FOLDER --credit "Photographer name"
    python scripts/add_images.py FOLDER --images-repo C:\\path\\to\\AncestrySearch-images --dry-run

Filenames: the cultivar's name, e.g. "Rob's Lucky Penny.jpg". Extra photos of the same cultivar can
end in a number: "Rob's Lucky Penny 2.jpg". Case, spaces and punctuation do not matter. A file that
does not match a cultivar exactly is reported with the closest names and is NOT added: rename it
and run again. Files that were already added (same content) are skipped, so re-running is safe.

Per-photo credits or captions: put a credits.csv in the folder with columns
    file,credit,caption,source_url
(file is the original filename; credit overrides --credit; caption and source_url are optional).

Every photo needs a credit. Photos are saved as WebP: full size (longest side 1600 px) in photos/
and a thumbnail (longest side 400 px) in thumbs/. Camera metadata, including GPS location, is
removed. Needs Pillow (see requirements.txt).
"""
import argparse
import csv
import datetime
import difflib
import hashlib
import os
import re
import sys
import unicodedata
from pathlib import Path

from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
IMAGES_CSV = DATA / "images.csv"
COLUMNS = ["file", "cultivar_id", "caption", "credit", "sort_order", "width", "height", "source_url", "added_at",
           "original_sha1"]
SUPPORTED = {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff", ".bmp"}
FULL_SIZE, THUMB_SIZE = 1600, 400


def norm(s):
    t = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "", t) or re.sub(r"\W+", "", str(s).casefold())


def load_cultivars():
    with open(DATA / "cultivars.csv", newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    by_key = {}
    for r in rows:
        by_key.setdefault(norm(r["name"]), r)
        by_key.setdefault(norm(r["id"]), r)
    return rows, by_key


def read_images():
    if not IMAGES_CSV.exists():
        return []
    with open(IMAGES_CSV, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def write_images(rows):
    rows = sorted(rows, key=lambda r: (r["cultivar_id"], int(r["sort_order"] or 1), r["file"]))
    tmp = IMAGES_CSV.with_suffix(".tmp")
    with open(tmp, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    os.replace(tmp, IMAGES_CSV)


def match(stem, by_key):
    """Match a filename stem to a cultivar. The whole stem is tried first (some cultivar names end in
    a number), then the stem without a trailing sequence number."""
    r = by_key.get(norm(stem))
    if r:
        return r, 1
    m = re.match(r"^(.*?)[\s_\-]*\(?(\d{1,2})\)?$", stem)
    if m and m.group(1).strip():
        r = by_key.get(norm(m.group(1)))
        if r:
            return r, int(m.group(2))
    return None, 0


def save_webp(im, path, longest, quality):
    im = im.copy()
    im.thumbnail((longest, longest), Image.LANCZOS)  # never upscales
    im.save(path, "WEBP", quality=quality, method=4)  # no metadata is written
    return im.size


def to_rgb(im):
    im = ImageOps.exif_transpose(im)  # apply the camera's rotation before the metadata is dropped
    if im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info):
        im = im.convert("RGBA")
        bg = Image.new("RGB", im.size, (255, 255, 255))
        bg.paste(im, mask=im.getchannel("A"))
        return bg
    return im.convert("RGB")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("folder", help="folder of photos to add")
    ap.add_argument("--credit", default="", help="photographer credit for every photo without its own in credits.csv")
    ap.add_argument("--images-repo", default=os.environ.get("AV_IMAGES_REPO", str(ROOT.parent / "AncestrySearch-images")),
                    help="local clone of the images repository (default: AncestrySearch-images next to this project)")
    ap.add_argument("--dry-run", action="store_true", help="show what would happen; write nothing")
    args = ap.parse_args()

    folder = Path(args.folder)
    if not folder.is_dir():
        sys.exit(f"Not a folder: {folder}")
    repo = Path(args.images_repo)
    if not args.dry_run and not repo.is_dir():
        sys.exit(f"Images repository not found at {repo}\n"
                 "Create the images repository on GitHub, clone it there, or pass --images-repo PATH.")

    per_file = {}
    cred_path = folder / "credits.csv"
    if cred_path.exists():
        with open(cred_path, newline="", encoding="utf-8-sig") as f:
            for r in csv.DictReader(f):
                per_file[r["file"].strip().lower()] = r

    _, by_key = load_cultivars()
    existing = read_images()
    seen_sha = {r["original_sha1"] for r in existing if r.get("original_sha1")}
    next_n = {}
    for r in existing:
        next_n[r["cultivar_id"]] = max(next_n.get(r["cultivar_id"], 0), int(r["sort_order"] or 0))

    # process each cultivar's photos in their intended order: "Name.jpg" first, then "Name 2.jpg", ...
    def sort_key(path):
        cult, hint = match(path.stem, by_key)
        return (cult["id"] if cult else "~", hint, path.name.lower())

    files = sorted((p for p in folder.iterdir() if p.is_file()), key=sort_key)
    added, skipped, unmatched, problems, ignored = [], [], [], [], []
    for path in files:
        if not path.is_file() or path.name.lower() == "credits.csv":
            continue
        if path.suffix.lower() not in SUPPORTED:
            ignored.append(path.name)
            continue
        cult, _ = match(path.stem, by_key)
        if not cult:
            keys = list(by_key)
            near = difflib.get_close_matches(norm(path.stem), keys, n=3, cutoff=0.75)
            names = list(dict.fromkeys(by_key[k]["name"] for k in near))
            unmatched.append((path.name, names))
            continue
        meta = per_file.get(path.name.lower(), {})
        credit = (meta.get("credit") or args.credit or "").strip()
        if not credit:
            problems.append((path.name, "no credit: give --credit or add the file to credits.csv"))
            continue
        data = path.read_bytes()
        sha = hashlib.sha1(data).hexdigest()
        if sha in seen_sha:
            skipped.append(path.name)
            continue
        try:
            with Image.open(path) as im:
                im = to_rgb(im)
        except Exception as e:  # unreadable or corrupt image
            problems.append((path.name, f"cannot read image: {e}"))
            continue
        n = next_n.get(cult["id"], 0) + 1
        fname = f"{cult['id']}-{n}.webp"
        if not args.dry_run:
            (repo / "photos").mkdir(exist_ok=True)
            (repo / "thumbs").mkdir(exist_ok=True)
            w, h = save_webp(im, repo / "photos" / fname, FULL_SIZE, 82)
            save_webp(im, repo / "thumbs" / fname, THUMB_SIZE, 78)
        else:
            w, h = im.size
        next_n[cult["id"]] = n
        seen_sha.add(sha)
        row = {"file": fname, "cultivar_id": cult["id"], "caption": (meta.get("caption") or "").strip(),
               "credit": credit, "sort_order": n, "width": w, "height": h,
               "source_url": (meta.get("source_url") or "").strip(),
               "added_at": datetime.date.today().isoformat(), "original_sha1": sha}
        existing.append(row)
        added.append((path.name, cult["name"], fname, credit))

    if added and not args.dry_run:
        write_images(existing)

    tag = "WOULD ADD" if args.dry_run else "ADDED"
    print(f"\n{tag} {len(added)}:")
    for src, name, fname, credit in added:
        print(f"  {src}  ->  {name}  [{fname}]  credit: {credit}")
    if skipped:
        print(f"\nALREADY ADDED (same content), skipped {len(skipped)}: " + ", ".join(skipped))
    if unmatched:
        print(f"\nNOT MATCHED to a cultivar ({len(unmatched)}). Rename the file to the cultivar's name and run again:")
        for src, names in unmatched:
            print(f"  {src}" + (f"   closest: {' | '.join(names)}" if names else "   (no close name found)"))
    if problems:
        print(f"\nPROBLEMS ({len(problems)}):")
        for src, why in problems:
            print(f"  {src}: {why}")
    if ignored:
        print(f"\nIGNORED (not a supported image type) {len(ignored)}: " + ", ".join(ignored))
    if added and not args.dry_run:
        print(f"\nNext: commit and push the new files in {repo}, then run scripts/build_db.py "
              "and commit data/images.csv and the rebuilt database.")
    sys.exit(1 if (unmatched or problems) else 0)


if __name__ == "__main__":
    main()
