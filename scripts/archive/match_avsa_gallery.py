"""ARCHIVED (one-off, 2026-11-15/16): matched the photos of the AVSA Photo Gallery (saved letter pages, git-ignored/not kept)
to our cultivars and wrote the match and review files; the result is data/external_photos.csv (2,757 AVSA links). Usage was
`python match_avsa_gallery.py <folder of saved gallery pages> <output csv>`. The saved pages are no longer on this machine, so it
cannot run as is. Never copy AVSA images or captions (see notes/avsa-gallery-plan.md)."""
import re, glob, html, csv, sys, collections, difflib, os
sys.path.insert(0, r"C:\source\AVAncestry\scripts")
import pandas as pd
from names_lib import K, norm, cname
SRC = sys.argv[1]; OUT = sys.argv[2]
D = r"C:\source\AVAncestry\data"
cv = pd.read_csv(D + r"\cultivars.csv", dtype=str).fillna("")
pp = pd.read_csv(D + r"\people.csv", dtype=str).fillna("").set_index("id")
ch = pd.read_csv(D + r"\cultivar_hybridizers.csv", dtype=str).fillna("")

def sur(s):
    s = re.sub(r"\(.*?\)", " ", s)
    out = set()
    for part in re.split(r"/|&|\band\b|;", s):
        part = part.strip()
        if not part: continue
        if "," in part: t = part.split(",")[0]
        else:
            w = [x for x in re.split(r"\s+", part) if not re.fullmatch(r"[A-Za-z]\.?(-?[A-Za-z]\.?)?", x)]
            t = w[-1] if w else part
        n = norm(t)
        if n: out.add(n)
    return out
hyb = collections.defaultdict(set)
for r in ch.itertuples():
    if r.person_id in pp.index: hyb[r.cultivar_id] |= sur(pp.loc[r.person_id, "name"])
for r in cv.itertuples():
    if r.hybridizer_raw: hyb[r.id] |= sur(r.hybridizer_raw)
byk = collections.defaultdict(list)
for r in cv.itertuples(): byk[K(r.name)].append(r)

def isodate(m):
    return f"{m.group(3)}-{m.group(1)}-{m.group(2)}"
items = {}
files = glob.glob(SRC + "/*.html")
def pk(f):
    m = re.match(r"(.+)_(\d+)\.html", os.path.basename(f)); return (m.group(1), int(m.group(2)))
for f in sorted(files, key=pk):
    L, pg = pk(f)
    s = open(f, encoding="utf-8", errors="replace").read()
    for m in re.finditer(r'<a class="envira-gallery-\d+ envira-gallery-link[^>]*?title="([^"]*)" data-caption="([^"]*)" data-envira-item-id="(\d+)"', s):
        iid = m.group(3)
        if iid in items: continue
        items[iid] = dict(item_id=iid, title=html.unescape(m.group(1)), cap=html.unescape(m.group(2)), letter=L, page=pg)
rows = []
for it in items.values():
    name = re.sub(r"_\d+$", "", it["title"]).strip()
    cap = it["cap"]
    dm = re.search(r"\b(\d{1,2})/(\d{1,2})/(\d{4})\b", cap)
    gdate = isodate(dm) if dm else ""
    gdate = "-".join(p.zfill(2) if i else p for i, p in enumerate(gdate.split("-"))) if gdate else ""
    hm = re.search(r"\(([^()]*)\)", cap[len(name):] if cap.lower().startswith(name.lower()) else cap)
    ghyb = sur(hm.group(1)) if hm and not re.match(r"\s*(DAVS|ANZ|TX|\d)", hm.group(1)) else set()
    url = f"https://africanvioletsocietyofamerica.org/look/photo-gallery/{it['letter']}/" + (f"{it['page']}/" if it["page"] > 1 else "") + f"#envira-gallery-item-{it['item_id']}"
    cands = byk.get(K(name), [])
    ev = []
    for c in cands:
        h = "unknown"
        if ghyb and hyb[c.id]:
            blob = norm(c.hybridizer_raw) + "".join(hyb[c.id])
            h = "agree" if (ghyb & hyb[c.id]) or any(len(g) >= 4 and g in blob for g in ghyb) or any(len(x) >= 4 and x in "".join(ghyb) for x in hyb[c.id]) else "differ"
        d = "unknown"
        if gdate and c.registered_date: d = "agree" if c.registered_date[:10] == gdate else "differ"
        ev.append((c, h, d))
    tier = "no match"; pick = ""; detail = ""
    if ev:
        viable = [e for e in ev if "differ" not in (e[1], e[2])]
        pos = [e for e in viable if "agree" in (e[1], e[2])]
        if len(ev) == 1 and viable:
            tier = "auto-exact"; pick = ev[0][0].id
        elif len(ev) == 1 and ev[0][2] == "agree":
            tier = "auto-exact"; pick = ev[0][0].id; detail = "hybridizer text differs, registration date agrees"
        elif len(ev) == 1:
            tier = "review"; detail = "hybridizer/date differ"
        elif sum(1 for e in ev if e[2] == "agree") == 1 and not any(e[2] == "unknown" and e[1] != "differ" for e in ev if e[2] != "agree"):
            pick = [e for e in ev if e[2] == "agree"][0][0].id; tier = "auto-same-name"; detail = "date picks one"
        elif len(pos) == 1 and len(viable) == len(pos):
            tier = "auto-same-name"; pick = pos[0][0].id
        elif len(pos) == 1:
            tier = "review"; detail = "several records, one agrees but others not excluded"
        else:
            tier = "review"; detail = "several records, not decidable"
    near = ""
    if not ev:
        m = difflib.get_close_matches(K(name), list(byk), n=2, cutoff=0.88)
        near = "; ".join(byk[x][0].name + " [" + byk[x][0].id + "]" for x in m)
    rows.append(dict(tier=tier, item_id=it["item_id"], gallery_name=name, gallery_hyb="/".join(sorted(ghyb)), gallery_date=gdate, url=url,
        record_id=pick, candidates="; ".join(f"{c.id} (hyb {h}, date {d})" for c, h, d in ev), detail=detail, near_miss=near, caption=cap))
pd.DataFrame(rows).to_csv(OUT, index=False, encoding="utf-8-sig")
print(len(items)); print(pd.DataFrame(rows).tier.value_counts())
print("cultivars with >1 gallery photo auto:", sum(1 for k, v in collections.Counter(r["record_id"] for r in rows if r["record_id"]).items() if v > 1))
