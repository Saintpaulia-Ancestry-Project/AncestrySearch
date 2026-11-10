"""Fetch posts + categories of saintpauliaancestry.wordpress.com via the public WordPress.com API.

Every response is cached on disk (cache/wp_scrape/), so re-runs never hit the site again.
Usage: python scripts/scrape_wp_fetch.py [--contact EMAIL_OR_URL]
Produces no images; downloads JSON only.
"""
import argparse, hashlib, json, time, urllib.request, urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "cache" / "wp_scrape"
SITE = "saintpauliaancestry.wordpress.com"
API = f"https://public-api.wordpress.com/rest/v1.1/sites/{SITE}"
DELAY = 1.5
_last = [0.0]
UA = ["Saintpaulia Ancestry Project scraper"]


def get(url):
    CACHE.mkdir(parents=True, exist_ok=True)
    f = CACHE / (hashlib.sha1(url.encode()).hexdigest()[:16] + ".json")
    if f.exists():
        return json.loads(f.read_text(encoding="utf-8"))
    wait = DELAY - (time.time() - _last[0])
    if wait > 0:
        time.sleep(wait)
    req = urllib.request.Request(url, headers={"User-Agent": UA[0]})
    with urllib.request.urlopen(req, timeout=60) as r:
        body = r.read().decode("utf-8")
    _last[0] = time.time()
    f.write_text(body, encoding="utf-8")
    return json.loads(body)


def fetch_all(contact=""):
    if contact:
        UA[0] += f" (contact: {contact})"
    cats = get(f"{API}/categories?number=500&fields=ID,name,slug,parent,post_count")["categories"]
    posts, offset = [], 0
    while True:
        q = urllib.parse.urlencode({"number": 20, "offset": offset, "order_by": "date", "order": "ASC",
                                    "fields": "ID,URL,title,date,content,categories"})
        d = get(f"{API}/posts/?{q}")
        if not d["posts"]:
            break
        posts += d["posts"]
        offset += len(d["posts"])
        if offset >= d["found"]:
            break
    return cats, posts


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--contact", default="", help="project contact email/URL for the User-Agent")
    a = ap.parse_args()
    c, p = fetch_all(a.contact)
    print(len(c), "categories,", len(p), "posts (cached in", CACHE, ")")
