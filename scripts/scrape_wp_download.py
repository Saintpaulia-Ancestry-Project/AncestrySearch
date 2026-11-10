"""Download the photos the manifest marks as included (reports/manifest.csv, final_decision == include).

Stage 2 of the WordPress blog import. Stage 1 (scrape_wp_manifest.py) decides which photos and who gets credit;
this script only fetches those originals, politely, into source/WordPressPhotos/ (git-ignored), named by
cultivar id ("<cultivar-id> <n>.jpg") and writes credits.csv there. Then:

    python scripts/add_images.py source/WordPressPhotos --dry-run
    python scripts/add_images.py source/WordPressPhotos

add_images.py resizes, strips metadata, skips content it already has, and records each photo in
data/images.csv with the credit from credits.csv.

    python scripts/scrape_wp_download.py [--limit N] [--ids id1,id2] [--contact EMAIL]

Re-runs never download a file twice. 1.5 s pause between requests.
"""
import argparse
import csv
import re
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "reports" / "manifest.csv"
OUT = ROOT / "source" / "WordPressPhotos"
DELAY = 1.5
DEFAULT_CONTACT = "saintpauliaancestry@gmail.com"      # project address, approved for the User-Agent
EXTS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--limit", type=int, default=0, help="download at most N photos (for testing)")
    ap.add_argument("--ids", default="", help="comma-separated cultivar ids: only these")
    ap.add_argument("--contact", default=DEFAULT_CONTACT, help="contact for the User-Agent")
    ap.add_argument("--out", default=str(OUT))
    ap.add_argument("--dry-run", action="store_true", help="list what would be downloaded")
    a = ap.parse_args()
    out = Path(a.out)

    with open(MANIFEST, newline="", encoding="utf-8-sig") as f:
        rows = [r for r in csv.DictReader(f) if r["final_decision"] == "include" and r["match_ids"].strip()]
    want = {x.strip() for x in a.ids.split(",") if x.strip()}
    plan, count = [], {}
    for r in rows:
        ids = [x.strip() for x in r["match_ids"].split(";") if x.strip()]
        if len(ids) != 1:
            print(f"SKIP (not exactly one cultivar): {r['image_full_url']} -> {ids}")
            continue
        cid = ids[0]
        if want and cid not in want:
            continue
        count[cid] = count.get(cid, 0) + 1
        ext = Path(re.sub(r"[?#].*$", "", r["image_full_url"])).suffix.lower()
        if ext not in EXTS:
            print(f"SKIP (unexpected file type '{ext}'): {r['image_full_url']}")
            continue
        n = count[cid]
        name = f"{cid} {n}{ext}" if n > 1 else f"{cid}{ext}"
        plan.append(dict(file=name, cultivar_id=cid, credit=r["final_credit"], caption="", source_url=r["post_url"],
                         url=r["image_full_url"]))
        if a.limit and len(plan) >= a.limit:
            break
    missing = [p for p in plan if not p["credit"]]
    if missing:
        sys.exit(f"{len(missing)} included photos have no credit; fix the manifest first.")
    print(f"{len(plan)} photos for {len({p['cultivar_id'] for p in plan})} cultivars")
    if a.dry_run:
        for p in plan:
            print(f"  {p['file']}  <-  {p['url']}   credit: {p['credit']}")
        return

    out.mkdir(parents=True, exist_ok=True)
    ua = f"Saintpaulia Ancestry Project image import (contact: {a.contact})"
    last, got, have, bad = 0.0, 0, 0, []
    for p in plan:
        dest = out / p["file"]
        if dest.exists() and dest.stat().st_size > 0:
            have += 1
            continue
        wait = DELAY - (time.time() - last)
        if wait > 0:
            time.sleep(wait)
        try:
            req = urllib.request.Request(p["url"], headers={"User-Agent": ua})
            with urllib.request.urlopen(req, timeout=60) as resp:
                ctype = resp.headers.get("Content-Type", "")
                data = resp.read()
            last = time.time()
            if not ctype.startswith("image/") or not data:
                bad.append((p["url"], f"not an image ({ctype}, {len(data)} bytes)"))
                continue
            dest.write_bytes(data)
            got += 1
        except Exception as e:
            last = time.time()
            bad.append((p["url"], str(e)))
    # credits.csv covers every planned file that exists
    with open(out / "credits.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=["file", "credit", "caption", "source_url", "cultivar_id"], extrasaction="ignore")
        w.writeheader()
        w.writerows(p for p in plan if (out / p["file"]).exists())
    print(f"downloaded {got}, already present {have}, failed {len(bad)}")
    for u, why in bad:
        print(f"  FAILED {u}: {why}")
    print(f"Next: python scripts/add_images.py \"{out}\" --dry-run")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
