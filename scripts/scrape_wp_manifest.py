"""Build an image manifest from saintpauliaancestry.wordpress.com (WordPress.com public API).

Stage 1 only: manifest + review reports in reports/. NO images are downloaded.
Fetching is done (and cached on disk) by scrape_wp_fetch.py; this script re-reads that cache.

Usage:  python scripts/scrape_wp_manifest.py [--contact EMAIL_OR_URL]
Name normalisation (clean / cname / norm / pkey) is copied from import_excel.py, which cannot be imported
without side effects (it rewrites review files at import time). Keep the two in sync.
"""
import argparse, collections, csv, difflib, html, re, sys, unicodedata
from pathlib import Path

import pandas as pd
from bs4 import BeautifulSoup, NavigableString, Comment

sys.path.insert(0, str(Path(__file__).resolve().parent))
from scrape_wp_fetch import fetch_all  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = ROOT / "reports"
HYBRIDIZERS_ID = 64587011          # parent category of every hybridizer category
GESNERIAD_ROOT = 120908736         # "Other Gesneriads" (Sinningia, Streptocarpus): not Saintpaulia

# ---- normalisation (copied from import_excel.py) ----
QUOTES = str.maketrans({"‘": "'", "’": "'", "‚": "'", "‛": "'", "`": "'", "“": '"', "”": '"', "´": "'"})


def clean(s):
    if s is None:
        return ""
    return re.sub(r"\s+", " ", str(s).replace("\xa0", " ")).strip()


def cname(s):
    return clean(s).translate(QUOTES)


def norm(s):
    t = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().lower()
    t = re.sub(r"[^a-z0-9]+", "", t)
    return t or re.sub(r"\W+", "", str(s).casefold())


def pkey(p):
    m = re.match(r"^([^,]+),\s*([A-Za-z])", p)
    return (norm(m.group(1)), m.group(2).lower()) if m else (norm(p), "")


# ---------------------------------------------------------------- database
def load_db():
    cult = pd.read_csv(DATA / "cultivars.csv", dtype=str, keep_default_na=False,
                       usecols=["id", "name", "kind", "hybridizer_raw"])
    people = pd.read_csv(DATA / "people.csv", dtype=str, keep_default_na=False)
    ch = pd.read_csv(DATA / "cultivar_hybridizers.csv", dtype=str, keep_default_na=False)
    par = pd.read_csv(DATA / "parentage.csv", dtype=str, keep_default_na=False)
    by_key = collections.defaultdict(list)
    for r in cult.itertuples():
        by_key[norm(r.name)].append(r.id)
    cinfo = {r.id: r for r in cult.itertuples()}
    pname = dict(zip(people["id"], people["name"]))
    hyb = collections.defaultdict(list)
    for r in ch.itertuples():
        hyb[r.cultivar_id].append(r.person_id)
    pkeys = collections.defaultdict(set)      # (surname, initial) -> person ids; ("", ) variants via surname only
    psur = collections.defaultdict(set)       # surname key -> person ids
    for r in people.itertuples():
        names = [r.name] + [a for a in re.split(r"\s*;\s*", r.aliases) if a]
        for n in names:
            k = pkey(n)
            pkeys[k].add(r.id)
            psur[k[0]].add(r.id)
    children = collections.defaultdict(lambda: collections.defaultdict(set))   # child -> role -> parents
    for r in par.itertuples():
        children[r.child_id][r.role].add(r.parent_id)
    return dict(by_key=by_key, cinfo=cinfo, pname=pname, hyb=hyb, pkeys=pkeys, psur=psur, parents=children,
                cult=cult)


# ---------------------------------------------------------------- HTML -> token stream
BLOCK = {"p", "div", "li", "ul", "ol", "tr", "td", "th", "table", "figure", "figcaption", "h1", "h2", "h3", "h4",
         "h5", "h6", "blockquote", "br", "hr", "tbody", "thead", "section"}
IMG_EXT = re.compile(r"\.(jpe?g|png|gif|webp|tiff?|bmp)(?:$|\?)", re.I)


def tokens(content):
    """Ordered list of ('text', str) and ('img', dict) from post HTML."""
    soup = BeautifulSoup(content, "html.parser")
    out, buf = [], []

    def flush():
        t = cname(html.unescape("".join(buf)))
        buf.clear()
        if t:
            out.append(("text", t))

    def walk(node):
        for ch in node.children:
            if isinstance(ch, Comment):
                continue
            if isinstance(ch, NavigableString):
                buf.append(str(ch))
            elif ch.name == "img":
                flush()
                a = ch.find_parent("a")
                out.append(("img", dict(href=(a.get("href") or "") if a else "", src=ch.get("src") or "",
                                        orig=ch.get("data-orig-file") or "", alt=cname(html.unescape(ch.get("alt") or "")),
                                        caption=cname(html.unescape(ch.get("data-image-caption") or "")),
                                        size=ch.get("data-orig-size") or "")))
            elif ch.name in ("script", "style"):
                continue
            elif ch.name in BLOCK:
                flush()
                walk(ch)
                flush()
            else:
                walk(ch)

    walk(soup)
    flush()
    return out


def strip_q(u):
    return re.sub(r"[?#].*$", "", u)


def full_url(img):
    """Full-size URL: the href around the thumbnail when it is an image file, else data-orig-file, else src."""
    h = img["href"]
    if h and IMG_EXT.search(h):
        return strip_q(h), "href"
    if img["orig"]:
        return strip_q(img["orig"]), "data-orig-file"
    return strip_q(img["src"]), "src"


# ---------------------------------------------------------------- line classification
CREDIT_RE = re.compile(r"(?:\(|\[|\b)\s*(?:watermarked\s+)?(?:photos?|pictures?|images?)(?:\s+credits?)?\s*(?:by|:|courtesy of)\s*:?\s*"
                       r"((?:[A-Z][\w'’\-]*\.?\s*){1,4}?)\s*(?=[.,:;)\]]|\s[a-z]|\s*$)", re.I)
CREDIT_NAME = re.compile(r"((?:[A-Z][\w'’\-]*\.?[ ]?){1,4})")
WATERMARK_RE = re.compile(r"copyright|watermark", re.I)


def credit_in(line):
    """Return (name, whole_line_is_credit) for 'photo(s) by X' / 'Photo credit(s): X' in a line, else (None, False)."""
    m = re.search(r"\b(?:photos?|pictures?|images?)(?:\s+credits?)?\s*(?:by\b|:)\s*:?\s*(.*)$", line, re.I)
    if not m:
        return None, False
    rest = m.group(1)
    nm = CREDIT_NAME.match(rest.strip())
    name = re.sub(r"\s+", " ", nm.group(1)).strip(" .") if nm else ""
    name = re.split(r"(?<=[a-z])\.\s|\s-|\s*-$", name)[0].strip(" .-")     # 'Dale Martens. Senk's Vespa' -> 'Dale Martens'
    name = " ".join(name.split()[:3])
    # the name is the leading capitalised words; stop at 'Back row' style text
    name = re.sub(r"\s+(Back|Front|Top|Bottom|Left|Right)\b.*$", "", name)
    if not name:
        return None, False
    whole = len(line) - len(m.group(0)) <= 3 and len(rest) - len(nm.group(0)) <= 6
    return name, whole


def is_label_line(t):
    if re.fullmatch(r"\([^()]*\)", t) and not re.search(r"\sx\s", t, re.I):
        return False                      # '(hover on the photos for the titles)'
    return len(t) <= 110 and len(t.split()) <= 14 and not WATERMARK_RE.search(t) and not re.match(
        r"(hybridizer|seed from|photo)", t, re.I) and not re.search(r"\b(says|said|wrote)\b", t)


FILE_LIKE = re.compile(r"^(?:img|dsc|pic|image|photo)?[_\- ]*\d[\w\-\. ]*$|resized|\bimg_\d|\d{6,}|^[a-z0-9_\-]+\.(jpe?g|png)$", re.I)
GENERIC_RE = re.compile(r"^(?:.{0,40}?\bseedlings?\b|(?:the\s+)?(?:offspring|progeny|babies|cross\b|first generation|f1\b|siblings?|"
                        r"first\s+bloom|\d+(?:st|nd|rd|th)?\s+(?:bloom|generation)))", re.I)
OTHER_ALT = re.compile(r"\b(poster|portrait|group|family|scan|article|chart|screenshot|logo|banner|download)\b", re.I)


NOISE = re.compile(r"\b(?:FB_)?(?:IMG|DSC|PXL|MVIMG)[_\- ]?\d+\w*|\b\d{5,}\w*|_resized(?:_\d+)?|\.jpe?g|\.png", re.I)


SLUG_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)+$")     # file-name slugs such as pink-umbrella


def clean_alt(alt):
    """Alt text with camera-file noise removed and a trailing 'by Photographer' dropped."""
    a = NOISE.sub(" ", alt)
    a = re.sub(r"\s+by\s+[A-Z][\w'’\-]+(?:\s[A-Z][\w'’\-]+)?\s*$", "", a)
    return clean(a)


def split_final_paren(s):
    """('name', 'inner') when s ends with a balanced (...) / [...]; else (s, '')."""
    s = s.rstrip()
    if not s or s[-1] not in ")]":
        return s, ""
    close, opener = s[-1], "(" if s[-1] == ")" else "["
    depth = 0
    for i in range(len(s) - 1, -1, -1):
        if s[i] in ")]":
            depth += 1
        elif s[i] in "([":
            depth -= 1
            if depth == 0:
                return s[:i].rstrip(), s[i + 1:-1].strip()
    return s, ""


def role_from_marker(s):
    """Strip role markers; return (cleaned, role|None)."""
    role = None
    t = s

    def setrole(txt):
        nonlocal role
        txt = txt.lower()
        if re.search(r"seed|mother|\bmom\b|female", txt):
            role = "seed_parent"
        elif re.search(r"pollen|father|\bdad\b|male", txt):
            role = "pollen_parent"

    m = re.search(r"\(\s*((?:seed|pollen|mother|father)[^)]*|mom|dad)\)\s*:?\s*$", t, re.I)
    if m:
        setrole(m.group(1)); t = t[:m.start()]
    m = re.match(r"^\s*((?:seed|pollen)\s*par\w*(?:\s*\([^)]*\))?)\s*[:–—-]\s*", t, re.I)
    if m:
        setrole(m.group(1)); t = t[m.end():]
    m = re.search(r"\s*[-–—]\s*(mom|dad|seed parent|pollen parent|mother|father)\s*:?\s*$", t, re.I)
    if m:
        setrole(m.group(1)); t = t[:m.start()]
    return t.strip(" :-–—\t"), role


def parse_label(raw):
    """Decompose a label/alt string. Returns dict(name, full, role, generic, parentage, note, originator)."""
    s = cname(raw)
    s = re.sub(r"^\d+[a-z]?\s+(?=[A-Za-z])", "", s)          # '01a Feather -mom'
    s, role = role_from_marker(s)
    s = s.strip(" :")
    m = re.search(r"\s+-\s*([a-z][^-]*)$", s)             # '-flower', '-seed pod', '-1st flowering'
    descriptor = m.group(1) if m else ""
    if m:
        s = s[:m.start()].rstrip()
    originator = ""
    m = re.search(r"(?<=[)\]])\s+([A-Z][\w'’\-]+,\s*[A-Z][\w.]+(?:\s[A-Z][\w.]+)?)$", s)   # 'Rebel's X (a x b) Bann, Ruth'
    if m:
        originator = m.group(1); s = s[:m.start()]
    base, inner = split_final_paren(s)
    parentage, note = None, ""
    name = s
    if inner and re.search(r"\sx\s|\s×\s|\sх\s", inner, re.I):
        parts = re.split(r"\s+[x×х]\s+", inner, maxsplit=1, flags=re.I)
        parentage = (parts[0].strip(), parts[1].strip()); name = base
    elif inner:
        note = inner; name = base
    name = name.strip(" :-–—")
    generic = bool(GENERIC_RE.match(name))
    return dict(name=name, full=s, role=role, generic=generic, parentage=parentage, note=note or descriptor,
                originator=originator)


# ---------------------------------------------------------------- titles / categories
def parse_title(title):
    t = cname(html.unescape(title))
    by = ""
    m = re.search(r"\s+by\s+(?!.*\sby\s)(.+)$", t, re.I)
    if m:
        by = m.group(1).strip(); t = t[:m.start()].strip()
    seed = pollen = ""
    parts = re.split(r"\s+[xX×х]\s+", t)
    if len(parts) == 2:
        seed, pollen = parts[0].strip(), parts[1].strip()
        if re.fullmatch(r"self", pollen, re.I):
            pollen = seed
    return dict(cross=t, by=by, seed=seed, pollen=pollen)


def by_people(by):
    out = []
    for p in re.split(r"\s*(?:/|&|\band\b|,\s*(?=[A-Z][a-z]+ [A-Z]))\s*", by):
        p = p.strip()
        if p:
            out.append(p)
    return out


def map_category(cat, db):
    """Hybridizer category name ('Wong H', 'Armacost & Royston') -> sorted person ids (possibly several)."""
    name = html.unescape(cat)
    m = re.match(r"^(.+?)\s+([A-Z]{1,2})$", name)
    if m:
        k = (norm(m.group(1)), m.group(2)[0].lower())
        ids = set(db["pkeys"].get(k, ()))
        return sorted(ids), "surname+initial"
    ids = {i for i, n in db["pname"].items() if norm(n) == norm(name)}
    if ids:
        return sorted(ids), "full name"
    ids = db["psur"].get(norm(name), set())
    return sorted(ids), "surname only"


# ---------------------------------------------------------------- matching
def species_candidates(name, db):
    toks = name.split()
    ep = []
    for t in toks:
        if t.islower() and t.isalpha():
            ep.append(norm(t))
        else:
            break
    if not ep:
        return []
    return [i for i, r in db["cinfo"].items() if r.kind == "species" and all(e in norm(r.name) for e in ep)]


def match(cands, db, allkeys):
    """cands: list of name strings (best first). Returns (status, exact_ids, near_list[(id, rule, score)])."""
    seen = []
    for c in cands:
        k = norm(c)
        if not k or k in seen:
            continue
        seen.append(k)
        ids = db["by_key"].get(k)
        if ids:
            return ("exact" if len(ids) == 1 else "exact-ambiguous"), list(ids), c, []
    near, used = [], set()

    def add(i, rule, score=""):
        if i not in used:
            used.add(i); near.append((i, rule, score))

    name = cands[0] if cands else ""
    if re.search(r"\s*#\s*\w+$", name):                     # clone number
        base = re.sub(r"\s*#\s*\w+$", "", name)
        for i in db["by_key"].get(norm(base), []):
            add(i, "strip clone suffix '#n'")
    for i in species_candidates(name, db):
        add(i, "species epithets (leading lowercase words)")
    for c in cands[:1]:
        k = norm(c)
        if len(k) < 4:
            continue
        for kk in difflib.get_close_matches(k, allkeys, n=4, cutoff=0.88):
            for i in db["by_key"][kk]:
                add(i, "similar spelling", round(difflib.SequenceMatcher(None, k, kk).ratio(), 3))
        if len(near) < 8:
            cont = [kk for kk in allkeys if len(kk) >= 9 and (kk in k or (len(k) >= 9 and k in kk)) and kk != k and " x " not in " " + name.lower() + " "]
            cont.sort(key=lambda kk: -len(kk))
            for kk in cont[:4]:
                for i in db["by_key"][kk]:
                    add(i, "name contained in label (or label contained in name)")
    return ("near-miss" if near else "unmatched"), [], "", near[:8]


# ---------------------------------------------------------------- per-post processing
def process_post(post, cat_by_id, db, allkeys):
    cats = post["categories"]
    catnames = [html.unescape(n) for n in cats]
    hyb_cats = [html.unescape(n) for n, v in cats.items() if v["parent"] == HYBRIDIZERS_ID]
    gesn = any(v["parent"] == GESNERIAD_ROOT or cat_by_id.get(v["parent"], {}).get("parent") == GESNERIAD_ROOT
               or n in ("Sinningia", "Streptocarpus", "Other Gesneriads") for n, v in cats.items())
    title = parse_title(post["title"])
    toks = tokens(post["content"])
    img_idx = [i for i, t in enumerate(toks) if t[0] == "img"]
    p = dict(post_url=post["URL"], post_title=cname(html.unescape(post["title"])), post_date=post["date"][:10],
             categories=" ; ".join(catnames), hybridizer_categories=" ; ".join(hyb_cats), title=title,
             n_images=len(img_idx), hyb_cats=hyb_cats, gesneriad=gesn,
             post_type=("cross post" if title["seed"] else "photos of a hybridizer's cultivars" if re.search(r"\bphotos?\b", post["title"], re.I) else "other post"))
    if not img_idx:
        return p, []

    # gaps: gap[g] = lines between image g-1 and image g (gap[0] before first, gap[n] after last)
    gaps = [[] for _ in range(len(img_idx) + 1)]
    g = 0
    for t in toks:
        if t[0] == "img":
            g += 1
        else:
            gaps[g].append(t[1])

    # credits
    gap_labels = []                      # per gap: label-like lines; credit lines are pulled out
    img_credit = {}                      # image index -> (name, scope)
    header_credit = [None] * len(img_idx)   # propagated header credits
    watermark = False
    cur_header = None
    pending_headers = {}
    for gi, lines in enumerate(gaps):
        keep_lines = []
        for ln in lines:
            if WATERMARK_RE.search(ln) and re.search(r"photo", ln, re.I):
                watermark = True
                continue
            # a long line that starts with a credit: split at the first sentence end
            nm, whole = credit_in(ln)
            if nm:
                if whole or len(ln) <= 90:
                    if gi == 0 or ln.rstrip().endswith(":"):
                        pending_headers[gi] = nm                      # applies to the images that follow
                    else:
                        img_credit[gi - 1] = (nm, "caption-line")
                    continue
                pending_headers[gi] = nm                             # credit mentioned inside prose: post/header
                continue
            keep_lines.append(ln)
        gap_labels.append(keep_lines)
    for i in range(len(img_idx)):
        for gi in sorted(pending_headers):
            if gi <= i:
                cur_header = pending_headers[gi]
        header_credit[i] = cur_header

    # layout: do labels come after or before images?
    first_pre = [l for l in gap_labels[0] if is_label_line(l)]
    first_post = [l for l in gap_labels[1] if is_label_line(l)] if len(gap_labels) > 1 else []
    colon_pre = any(l.endswith(":") for gl in gap_labels for l in gl if is_label_line(l))
    layout = "after" if (not first_pre and first_post and not colon_pre) else "before"

    rows = []
    prev_label = None
    for i, ti in enumerate(img_idx):
        img = toks[ti][1]
        url, url_src = full_url(img)
        pre = [l for l in gap_labels[i] if is_label_line(l)]
        post_lines = [l for l in gap_labels[i + 1] if is_label_line(l)]
        cands_txt = " | ".join(dict.fromkeys(pre + post_lines))
        raw, source, inherited = "", "none", False
        if layout == "before":
            if pre:
                raw, source = pre[-1], "line-before"
            elif prev_label and i > 0 and not gap_labels[i]:
                raw, source, inherited = prev_label[0], prev_label[1], True
        else:
            if post_lines:
                raw, source = post_lines[0], "line-after"
            elif i + 1 < len(img_idx) and not gap_labels[i + 1]:
                # run of images followed by one caption: borrow the next caption
                j = i + 1
                while j < len(img_idx) and not gap_labels[j]:
                    j += 1
                nxt = [l for l in gap_labels[j] if is_label_line(l)] if j <= len(img_idx) else []
                if nxt:
                    raw, source, inherited = nxt[0], "line-after", True
        alt_for_credit = img["alt"]
        alt = clean_alt(img["alt"])
        alt_ok = bool(re.search(r"[A-Za-z]{3,}", alt)) and len(alt) <= 90 and not SLUG_RE.match(alt)
        if not raw and alt_ok:
            raw, source = alt, "alt"
        elif raw and alt_ok and source.startswith("line"):
            li = parse_label(raw)
            # alt text is the better label when the line is only inherited or is a section heading
            if inherited or (raw.endswith(":") and not li["role"] and not li["generic"]):
                raw, source, inherited = alt, "alt", False
        info = parse_label(raw) if raw else None
        prev_label = (raw, source) if raw and source.startswith("line") else prev_label
        wl = img["href"] if img["href"] and not IMG_EXT.search(img["href"]) and "wp-content" not in img["href"]             and not re.search(r"saintpauliaancestry\.wordpress\.com/\d{4}/", img["href"]) else ""
        rows.append(dict(i=i, wrapper_link=wl, img=img, url=url, url_src=url_src, raw=raw, source=source, inherited=inherited,
                         info=info, cands_txt=cands_txt, alt=alt, credit_alt=alt_for_credit))

    # roles
    seed, pollen = title["seed"], title["pollen"]
    nseed, npoll = norm(seed) if seed else None, norm(pollen) if pollen else None
    ncross = norm(title["cross"])
    for r in rows:
        info = r["info"]
        role, basis = "unlabelled", ""
        if info:
            n = norm(info["name"])
            par = info["parentage"]
            if info["role"]:
                role, basis = info["role"], "marker"
            elif info["generic"]:
                role, basis = "cross", "generic seedlings label"
            elif n == ncross:
                role, basis = "cross", "label equals title"
            elif par and nseed and norm(par[0]) == nseed and npoll and norm(par[1]) == npoll:
                role, basis = "cross", "label parentage equals title cross"
            elif nseed and n == nseed:
                role, basis = "seed_parent", "label equals title seed parent"
            elif npoll and n == npoll:
                role, basis = "pollen_parent", "label equals title pollen parent"
            elif OTHER_ALT.search(info["name"]):
                role, basis = "other", "descriptive text"
            else:
                role, basis = "other", ""
        r["role"], r["role_basis"] = role, basis
    return p, rows


# ---------------------------------------------------------------- main
def initials_expand(credit, by_full):
    """'A Maxwell' -> 'Alcie Maxwell' if the post title's byline contains that person; else None."""
    m = re.match(r"^([A-Z])\.?\s+([A-Z][\w'’\-]+)$", credit)
    if not m:
        return None
    for full in by_full:
        parts = full.split()
        if len(parts) >= 2 and norm(parts[-1]) == norm(m.group(2)) and parts[0][0].upper() == m.group(1):
            return full
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--contact", default="", help="project contact email/URL put in the User-Agent (used only if the cache is empty)")
    a = ap.parse_args()
    cats, posts = fetch_all(a.contact)
    cat_by_id = {c["ID"]: c for c in cats}
    db = load_db()
    allkeys = list(db["by_key"])
    OUT.mkdir(parents=True, exist_ok=True)

    # hybridizer category -> people
    catmap = {}
    for c in cats:
        if c["parent"] == HYBRIDIZERS_ID:
            n = html.unescape(c["name"])
            ids, how = map_category(n, db)
            catmap[n] = (ids, how, c["post_count"])

    return finish(posts, cats, cat_by_id, db, allkeys, catmap, a)


def finish(posts, cats, cat_by_id, db, allkeys, catmap, args):
    # re-run per post with credits resolved
    all_occ = []
    posts_info = []
    for post in posts:
        p, rows = process_post(post, cat_by_id, db, allkeys)
        posts_info.append(p)
        if not rows:
            continue
        toks = tokens(post["content"])
        # recompute credits for this post (same gap logic as process_post)
        gaps = [[] for _ in range(p["n_images"] + 1)]
        g = 0
        for t in toks:
            if t[0] == "img":
                g += 1
            else:
                gaps[g].append(t[1])
        img_credit, pending, watermark = {}, {}, False
        for gi, lines in enumerate(gaps):
            for ln in lines:
                if WATERMARK_RE.search(ln) and re.search(r"photo", ln, re.I):
                    watermark = True
                    continue
                nm, whole = credit_in(ln)
                if nm:
                    if (whole or len(ln) <= 90) and gi >= 1 and not ln.rstrip().endswith(":"):
                        img_credit[gi - 1] = nm
                    else:
                        pending[gi] = nm
        cur, hdr = None, []
        for i in range(p["n_images"]):
            for gi in sorted(pending):
                if gi <= i:
                    cur = pending[gi]
            hdr.append(cur)
        by_full = by_people(p["title"]["by"])
        ids_by_cat = {c: catmap.get(c, ([], "", 0))[0] for c in p["hyb_cats"]}
        for r in rows:
            alt = r["credit_alt"]
            m = re.search(r"\bphotos?\s+by\s+(.+)$", alt, re.I)
            cred_raw, scope = "", ""
            if r["i"] in img_credit:
                cred_raw, scope = img_credit[r["i"]], "caption line after image"
            elif m:
                cred_raw, scope = (credit_in(alt)[0] or cname(m.group(1))), "alt text"
            elif hdr[r["i"]]:
                cred_raw, scope = hdr[r["i"]], "credit line above (applies to following images)"
            r.update(post=p, by_full=by_full, ids_by_cat=ids_by_cat, cred_raw=cred_raw, cred_scope=scope,
                     watermark=watermark)
            all_occ.append(r)

    return build_outputs(all_occ, posts_info, db, allkeys, catmap, cats)


def person_names(ids, db):
    return " ; ".join(db["pname"].get(i, i) for i in ids)


def final_credit(decs, e):
    """Combine reviewer decisions for one image with the automatic credit."""
    if not decs:
        return dict(review_decision="", final_credit=e["cred_name"], final_credit_basis=e["cred_basis"])
    kinds = {d["decision"].strip().lower() for d in decs}
    credits = {d["credit_as"].strip() for d in decs if d["credit_as"].strip()}
    decision = "exclude" if "exclude" in kinds else ("use" if kinds == {"use"} else "conflict: " + "/".join(sorted(kinds)))
    if len(credits) > 1:
        return dict(review_decision=decision, final_credit="", final_credit_basis="CONFLICT: " + " / ".join(sorted(credits)))
    if credits:
        return dict(review_decision=decision, final_credit=next(iter(credits)), final_credit_basis="reviewed")
    return dict(review_decision=decision, final_credit=e["cred_name"], final_credit_basis=e["cred_basis"])


def load_credit_names():
    """reports/review/hybridizer_credit_names.csv: category -> (credit name, exclude rule). Blank credit_name = accept suggestion."""
    path = ROOT / "reports" / "review" / "hybridizer_credit_names.csv"
    if not path.exists():
        return {}
    d = pd.read_csv(path, dtype=str, keep_default_na=False, encoding="utf-8-sig")
    out = {}
    for r in d.to_dict("records"):
        if r["category"].strip():
            out[r["category"].strip()] = (r["credit_name"].strip() or r["suggested_credit_name"].strip(),
                                          r.get("exclude", "").strip().lower())
    return out


SCAN_RE = re.compile(r"scanned by|original \d+ article|magazine page", re.I)


def finalize(row, names):
    """Reviewed category credit names, then the exclusion rules. Mutates row."""
    cats = [c for c in row["hybridizer_categories"].split(" ; ") if c]
    cat_rule = ""
    if len(cats) == 1 and cats[0] in names:
        cname_, cat_rule = names[cats[0]]
        if row["final_credit_basis"] == "category-default":
            row["final_credit"] = cname_
            row["final_credit_basis"] = "category-default (reviewed name)" if cname_ else "category-default"
    why = []
    if row["review_decision"] == "exclude":
        why.append("reviewer: exclude (credit_decisions.csv)")
    if cat_rule == "all":
        why.append("category excluded (hybridizer_credit_names.csv)")
    elif cat_rule == "magazine scans" and SCAN_RE.search(row["alt_text"] + " " + row["label_raw"]):
        why.append("magazine page scan")
    if not row["final_credit"] or row["final_credit_basis"].startswith("CONFLICT"):
        why.append("no credit information")
    if row["match_status"] == "cross-unnamed":
        why.append("photo of an unnamed cross (no cultivar to attach to)")
    if row["match_status"] in ("unmatched", "no-label", "near-miss"):
        why.append("no database match (excluded for now)")
    row["final_decision"] = "exclude" if why else "include"
    row["exclude_reason"] = " ; ".join(why)


def load_decisions():
    """reports/review/credit_decisions.csv (filled in by the user): per (image, reason) decision use|exclude + credit_as."""
    path = ROOT / "reports" / "review" / "credit_decisions.csv"
    if not path.exists():
        return {}, {}
    d = pd.read_csv(path, dtype=str, keep_default_na=False, encoding="utf-8-sig")
    by_key, by_img = {}, collections.defaultdict(list)
    for r in d.to_dict("records"):
        by_key[(r["image_full_url"], r["reason"])] = r
        if r["decision"].strip():
            by_img[r["image_full_url"]].append(r)
    return by_key, by_img


def build_outputs(all_occ, posts_info, db, allkeys, catmap, cats):
    dec_by_key, dec_by_img = load_decisions()
    credit_names = load_credit_names()
    mp = ROOT / "reports" / "review" / "wp_match_decisions.csv"
    match_dec = {r["searched_as"]: r for r in pd.read_csv(mp, dtype=str, keep_default_na=False, encoding="utf-8-sig").to_dict("records")} if mp.exists() else {}
    # ---- per-occurrence evaluation
    evaluated = []
    for r in all_occ:
        p, info, title = r["post"], r["info"], r["post"]["title"]
        hyb = p["hyb_cats"]
        reasons = []
        # credit
        cred_name, basis, expanded = "", "none", ""
        if r["cred_raw"]:
            basis = "caption"
            cred_name = r["cred_raw"]
            ex = initials_expand(cred_name, r["by_full"])
            if re.match(r"^[A-Z]\.?\s+[A-Z]", cred_name) and ex is None and re.match(r"^[A-Z]\.?\s", cred_name):
                reasons.append(f"initials not expandable: '{cred_name}'")
                cred_name = ""
            elif ex:
                expanded = cred_name; cred_name = ex
        if basis == "none" or not cred_name and basis == "caption":
            pass
        if not cred_name and len(hyb) == 1 and basis != "caption":
            cred_name, basis = hyb[0], "category-default"
        elif not cred_name and len(hyb) == 1 and basis == "caption":
            cred_name = hyb[0] + " (initials unresolved; category default)"
        if len(hyb) > 1:
            reasons.append("post has several hybridizer categories: " + " ; ".join(hyb))
            if not r["cred_raw"]:
                cred_name, basis = "", "none"
        if not hyb:
            reasons.append("no hybridizer category (only: " + p["categories"] + ")")
        if not cred_name and not any("several" in x for x in reasons) and hyb:
            reasons.append("no credit")
        if not cred_name and not hyb:
            reasons.append("no credit")
        if r["wrapper_link"] and "wordpress.com" not in r["wrapper_link"]:
            reasons.append("image links to an external page (" + re.sub(r"^https?://", "", r["wrapper_link"])[:60] + "): photo may belong to someone else, confirm permission")
        if r["watermark"]:
            reasons.append("post carries a 'watermarked photos by ... are copyrighted' notice: confirm credit/permission")
        if p["gesneriad"]:
            reasons.append("non-Saintpaulia post (Gesneriad category)")

        # matching
        status, exact_ids, matched_as, near, target = "", [], "", [], ""
        cross_cands = []
        if info and r["role"] == "cross" and (info["generic"] or r["role_basis"].startswith("label equals title")
                                               or re.search(r"seedling", info["name"], re.I)):
            info = dict(info, generic=True)
        if info and not info["generic"] and info["name"]:
            c = [info["name"]]
            if info["full"] and info["full"] != info["name"]:
                c.append(info["full"])
            first = re.split(r"\s+-\s*", info["name"])[0]
            if first != info["name"]:
                c.append(first)
            target = info["name"]
            status, exact_ids, matched_as, near = match(c, db, allkeys)
            if status in ("exact-ambiguous", "near-miss"):
                dec = match_dec.get(target)
                catids = set()
                for cc in p["hyb_cats"]:
                    catids |= set(catmap.get(cc, ([], "", 0))[0])
                if dec and dec["decision"] == "link" and dec["candidate_id"] in db["cinfo"]:
                    status, exact_ids, near = "reviewed-link", [dec["candidate_id"]], []
                elif dec:
                    status, exact_ids, near = "unmatched", [], []
                elif status == "exact-ambiguous":
                    # reviewed policy: link when exactly one candidate has a hybridizer equal to the post's category hybridizer
                    same = [i for i in exact_ids if set(db["hyb"].get(i, [])) & catids]
                    if len(same) == 1:
                        status, exact_ids = "policy-link", same
        elif info and info["generic"]:
            status, target = "cross-unnamed", title["cross"]
            ids = []
            for nm in (title["seed"], title["pollen"]):
                ids.append(set(db["by_key"].get(norm(nm), [])) if nm else set())
            if all(ids):
                for ch, roles in db["parents"].items():
                    if (roles.get("seed", set()) & ids[0]) and (roles.get("pollen", set()) & ids[1]):
                        cross_cands.append(ch)
        else:
            status = "no-label"

        # keep rule
        reliable = r["source"] in ("line-before", "line-after") and not r["inherited"] or r["source"] == "alt" and r["role"] in ("seed_parent", "pollen_parent", "cross")
        if r["role"] in ("cross", "seed_parent", "pollen_parent") and reliable and not p["gesneriad"]:
            keep, keep_why = "yes", f"{r['role']} ({r['role_basis']})"
        else:
            keep = "review"
            keep_why = ("non-Saintpaulia post" if p["gesneriad"] else
                        "unlabelled" if r["role"] == "unlabelled" else
                        "label inherited from a neighbouring image" if r["inherited"] else
                        "role 'other': not the cross or its parents" if r["role"] == "other" else "label source weak")
        evaluated.append(dict(r=r, p=p, cred_name=cred_name, cred_basis=basis, cred_expanded=expanded, reasons=reasons,
                              status=status, exact_ids=exact_ids, matched_as=matched_as, near=near, target=target,
                              cross_cands=cross_cands, keep=keep, keep_why=keep_why))

    # ---- dedupe by full-size URL (case-insensitive host)
    def key(u):
        return re.sub(r"^https?://", "", u.lower())

    groups = collections.OrderedDict()
    for e in evaluated:
        groups.setdefault(key(e["r"]["url"]), []).append(e)
    cname_of = lambda ids: " ; ".join(f"{db['cinfo'][i].name} [{i}]" for i in ids)

    def hyb_of(cid):
        ids = db["hyb"].get(cid, [])
        return person_names(ids, db) or db["cinfo"][cid].hybridizer_raw

    manifest, unmatched, nearm, credit_rev, mism = [], [], [], [], []
    for k, grp in groups.items():
        rank = {"yes": 0, "review": 1}
        grp.sort(key=lambda e: (rank[e["keep"]], e["p"]["post_date"]))
        e = grp[0]
        r, p = e["r"], e["p"]
        occs = " || ".join(f"{x['p']['post_url']} :: {x['r']['info']['name'] if x['r']['info'] else ''} :: {x['r']['role']}"
                           for x in grp)
        conflicts = []
        if len({norm(x['r']['info']['name']) if x['r']['info'] else '' for x in grp}) > 1:
            conflicts.append("different labels in different posts")
        if len({x['cred_name'] for x in grp}) > 1:
            conflicts.append("different credits in different posts")
        reasons = list(dict.fromkeys(sum((x["reasons"] for x in grp), [])))
        if conflicts:
            reasons += conflicts
        row = dict(
            post_url=p["post_url"], post_title=p["post_title"], post_date=p["post_date"], post_type=p["post_type"],
            categories=p["categories"],
            hybridizer_categories=p["hybridizer_categories"], image_full_url=r["url"], full_url_source=r["url_src"],
            orig_size=r["img"]["size"], wrapper_link=r["wrapper_link"], alt_text=r["alt"], label_text=r["info"]["name"] if r["info"] else "",
            label_raw=r["raw"], label_source=r["source"] + (" (inherited)" if r["inherited"] else ""),
            label_role=r["role"], label_role_basis=r["role_basis"],
            label_parentage=(" x ".join(r["info"]["parentage"]) if r["info"] and r["info"]["parentage"] else ""),
            label_note=(r["info"]["note"] or r["info"]["originator"]) if r["info"] else "",
            nearby_lines=r["cands_txt"], keep=e["keep"], keep_reason=e["keep_why"],
            credit_text=r["cred_raw"], credit_scope=r["cred_scope"], credit_name=e["cred_name"],
            credit_basis=e["cred_basis"], credit_initials_expanded_from=e["cred_expanded"],
            match_status=e["status"], match_name=e["matched_as"] or e["target"],
            match_ids=" ; ".join(e["exact_ids"]), match_names=cname_of(e["exact_ids"]),
            cross_offspring_in_db=cname_of(e["cross_cands"]),
            **final_credit(dec_by_img.get(r["url"], []), e),
            review_flags=" | ".join(reasons), n_posts=len({x["p"]["post_url"] for x in grp}), occurrences=occs)
        finalize(row, credit_names)
        manifest.append(row)
        base = dict(post_url=p["post_url"], post_title=p["post_title"], image_full_url=r["url"],
                    label_text=row["label_text"], label_role=r["role"], nearby_lines=row["nearby_lines"])
        if e["status"] == "unmatched":
            unmatched.append({**base, "category_hybridizer": p["hybridizer_categories"], "alt_text": r["alt"]})
        if e["status"] in ("near-miss", "exact-ambiguous"):
            cands = e["near"] if e["status"] == "near-miss" else [(i, "same name, several records", "") for i in e["exact_ids"]]
            for n, (cid, rule, score) in enumerate(cands, 1):
                ci = db["cinfo"][cid]
                nearm.append({**base, "match_type": e["status"], "searched_as": row["match_name"], "rank": n,
                              "candidate_id": cid, "candidate_name": ci.name, "candidate_kind": ci.kind,
                              "candidate_hybridizer": hyb_of(cid), "category_hybridizer": p["hybridizer_categories"],
                              "rule": rule, "score": score})
        if reasons:
            for why in reasons:
                credit_rev.append(dict(post_url=p["post_url"], post_title=p["post_title"], image_full_url=r["url"],
                                       alt_text=r["alt"], credit_text=r["cred_raw"], credit_name=e["cred_name"],
                                       credit_basis=e["cred_basis"], categories=p["categories"],
                                       hybridizer_categories=p["hybridizer_categories"], reason=why,
                                       **{c: dec_by_key.get((r["url"], why), {}).get(c, "") for c in ("decision", "credit_as", "note")}))
        # hybridizer mismatch (matched, DB has a hybridizer, category maps to people that do not include it)
        if e["status"] in ("exact", "policy-link", "reviewed-link") and p["hyb_cats"]:
            cid = e["exact_ids"][0]
            dbh = set(db["hyb"].get(cid, []))
            if dbh:
                catids = set()
                for x in grp:
                    for c in x["p"]["hyb_cats"]:
                        catids |= set(catmap.get(c, ([], "", 0))[0])
                if not catids:
                    mism.append(dict(post_url=p["post_url"], image_full_url=r["url"], label_text=row["label_text"],
                                     label_role=r["role"], cultivar_id=cid, cultivar_name=db["cinfo"][cid].name,
                                     db_hybridizer=hyb_of(cid), category_hybridizer=p["hybridizer_categories"],
                                     issue="category does not map to any people row"))
                elif not (dbh & catids):
                    mism.append(dict(post_url=p["post_url"], image_full_url=r["url"], label_text=row["label_text"],
                                     label_role=r["role"], cultivar_id=cid, cultivar_name=db["cinfo"][cid].name,
                                     db_hybridizer=hyb_of(cid), category_hybridizer=p["hybridizer_categories"],
                                     issue="category hybridizer differs from database hybridizer"
                                     + (" (expected for a parent photo)" if r["role"] in ("seed_parent", "pollen_parent") else "")))

    def write(name, rows, cols=None):
        path = OUT / name
        cols = cols or (list(rows[0]) if rows else ["(none)"])
        with open(path, "w", newline="", encoding="utf-8-sig") as f:
            w = csv.DictWriter(f, fieldnames=cols)
            w.writeheader()
            w.writerows(rows)

    write("manifest.csv", manifest)
    write("unmatched.csv", unmatched, ["post_url", "post_title", "image_full_url", "label_text", "label_role",
                                       "nearby_lines", "category_hybridizer", "alt_text"])
    write("near_misses.csv", nearm)
    write("credit_review.csv", credit_rev)
    write("hybridizer_mismatch.csv", mism)
    cm = [dict(category=c, post_count=v[2], mapped_by=v[1], people_ids=" ; ".join(v[0]),
               people_names=person_names(v[0], db), status=("unique" if len(v[0]) == 1 else "ambiguous" if v[0] else "UNMAPPED"))
          for c, v in sorted(catmap.items())]
    write("hybridizer_category_map.csv", cm)
    write_summary(manifest, posts_info, evaluated, unmatched, nearm, credit_rev, mism, cm, groups)
    print("manifest rows (unique images):", len(manifest), "| from", len(evaluated), "occurrences in", len(posts_info), "posts")


def write_summary(manifest, posts_info, evaluated, unmatched, nearm, credit_rev, mism, cm, groups):
    C = collections.Counter
    st = C(m["match_status"] for m in manifest)
    keep = C(m["keep"] for m in manifest)
    role = C(m["label_role"] for m in manifest)
    basis = C(m["credit_basis"] for m in manifest)
    src = C(m["label_source"] for m in manifest)
    flagged_posts = {c["post_url"] for c in credit_rev}
    multi = [p for p in posts_info if len(p["hyb_cats"]) > 1]
    nonh = [p for p in posts_info if not p["hyb_cats"]]
    rules = C(n["rule"] for n in nearm)
    L = []
    A = L.append
    A("# WordPress image manifest: summary\n")
    A("Source: https://saintpauliaancestry.wordpress.com/ via the WordPress.com public API (posts, with categories and "
      "content). robots.txt allows it. Responses are cached in `cache/wp_scrape/` (git-ignored). **No images were downloaded.**\n")
    A("## Counts\n")
    A(f"- posts: {len(posts_info)} ({sum(1 for p in posts_info if p['n_images'])} contain images)")
    A(f"- image occurrences: {len(evaluated)}; unique full-size URLs (manifest rows): {len(manifest)}; "
      f"in more than one post: {sum(1 for m in manifest if m['n_posts'] > 1)}")
    fd = C(m["final_decision"] for m in manifest)
    A(f"- final decision (after credit review): include {fd['include']}, exclude {fd['exclude']}: " + ", ".join(f"{k} {v}" for k, v in C(w.strip() for m in manifest for w in m["exclude_reason"].split(";") if w.strip()).most_common()))
    A(f"- keep: yes {keep['yes']}, review {keep['review']}")
    A(f"- label role: " + ", ".join(f"{k} {v}" for k, v in role.most_common()))
    A(f"- label source: " + ", ".join(f"{k} {v}" for k, v in src.most_common()))
    A(f"- credit basis: " + ", ".join(f"{k} {v}" for k, v in basis.most_common()))
    A("- label role by post type (unique images): " + "; ".join(
        f"{t}: " + ", ".join(f"{k} {v}" for k, v in C(m['label_role'] for m in manifest if m['post_type'] == t).most_common())
        for t in sorted({m['post_type'] for m in manifest})))
    A("\n## Matching against the database\n")
    for k in ("exact", "policy-link", "reviewed-link", "exact-ambiguous", "near-miss", "unmatched", "cross-unnamed", "no-label"):
        A(f"- {k}: {st[k]}")
    A("\n`exact` = one record whose normalised name equals the label (import_excel normalisation: case, accents, "
      "punctuation, curly quotes ignored). `exact-ambiguous` = several records share the name (never chosen; see "
      "near_misses.csv). `cross-unnamed` = a 'seedlings' style photo of the cross itself, which has no cultivar name; "
      "`cross_offspring_in_db` lists cultivars whose seed and pollen parents equal the title's parents. Nothing is guessed.\n")
    A("Near-miss rules that produced candidates (all suggestions only):\n")
    for k, v in rules.most_common():
        A(f"- {k}: {v} candidates")
    A("\n## Flags\n")
    A(f"- posts with more than one hybridizer category: {len(multi)} (" + "; ".join(p['post_title'][:50] for p in multi) + ")")
    A(f"- posts with no hybridizer category: {len(nonh)} ({sum(p['n_images'] for p in nonh)} images)")
    A(f"- credit_review.csv rows: {len(credit_rev)} across {len(flagged_posts)} posts; by reason: " +
      ", ".join(f"{k.split(':')[0][:40]} {v}" for k, v in C(c['reason'] for c in credit_rev).most_common(8)))
    A(f"- hybridizer_mismatch.csv rows: {len(mism)} (parent photos naturally differ; filter on label_role)")
    A(f"- hybridizer categories: {sum(1 for c in cm if c['status']=='unique')} map to exactly one people row, "
      f"{sum(1 for c in cm if c['status']=='ambiguous')} ambiguous, {sum(1 for c in cm if c['status']=='UNMAPPED')} unmapped "
      "(see hybridizer_category_map.csv)")
    A("\n## Method notes and assumptions to review\n")
    A("- Label position varies by post. The script detects per post whether names come **before** images (colon "
      "labels such as 'seedlings:') or **after** them (captions, e.g. Hancock, Baker, Trigg posts) and records the "
      "choice in `label_source`; images without their own line inherit a neighbour's label and are marked `(inherited)`, keep=review.")
    A("- Role from the title: first parent of 'A x B' is taken as the seed parent, second as pollen parent, unless "
      "the label itself says otherwise. 'x self' makes both parents the same name.")
    A("- Full-size URL = the link around the thumbnail when it points to an image file. 61 wrappers point to an "
      "attachment page or eBay instead; for those `data-orig-file` (or src without the query) is used (`full_url_source`).")
    A("- Credit lines placed before the first image, or ending in ':' ('photos by Joan Baker:'), are treated as headers "
      "that apply to the images that follow (`credit_scope`). A watermark notice ('photos by Blue Mountain Violets are "
      "copyrighted') is **not** read as a credit; those images get the category default and a review flag.")
    A("- Posts in the Gesneriad categories (Sinningia, Streptocarpus) are non-Saintpaulia: kept in the manifest with keep=review.")
    A("- Name aliases from name_near_misses.csv are not applied here; matching uses the final names in data/cultivars.csv.")
    A("- The User-Agent names the project; no contact address was supplied, so none was sent (pass `--contact` if the cache is cleared).")
    (OUT / "summary.md").write_text("\n".join(L) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
