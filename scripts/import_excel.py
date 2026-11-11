"""Build the cleaned CSVs in data/ from the three source families in source/.

Sources (all read-only):
  AfricanVioletAncestry.xlsx    sheet `Name`  -> ancestry (seed/pollen), hybridizer, notes
  AfricanVioletAncestry.sqlite  Varieties     -> sports, registration, size, descriptions (wins on conflict)
  AV-MasterLIstSupplements/20*/AVML*.xlsx     -> more cultivars + descriptions/registration
Not imported (deferred): MasterListBook OCR, the Excel `Sports` sheet.

Human decisions (reports/review/):
  sqlite_duplicates.csv   - which duplicate SQLite rows to drop ("delete <NameID>")
  hybridizer_mapping.csv  - `final_person(s)` column is authoritative; new strings are appended
  name_near_misses.csv    - written on first run if absent; put `merge` in `decision` to
                            fold a variant spelling into its target, then re-run.

Outputs: data/*.csv, reports/import_flags.csv, reports/import_summary.md
Usage:  .venv\\Scripts\\python scripts\\import_excel.py
"""
import collections
import datetime
import difflib
import re
import sqlite3
import unicodedata
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "source"
DATA = ROOT / "data"
REPORTS = ROOT / "reports"
REVIEW = REPORTS / "review"
for p in (DATA, REPORTS, REVIEW):
    p.mkdir(parents=True, exist_ok=True)

XLSX = SRC / "AfricanVioletAncestry.xlsx"
SQLITE = SRC / "AfricanVioletAncestry.sqlite"
SUPP = SRC / "AV-MasterLIstSupplements"

flags = []


def flag(category, cultivar, detail):
    flags.append({"category": category, "cultivar": cultivar, "detail": detail})


# ------------------------------------------------------------------ helpers
QUOTES = str.maketrans({"‘": "'", "’": "'", "‚": "'", "‛": "'", "`": "'",
                        "“": '"', "”": '"', "´": "'"})


def clean(s):
    if s is None or (isinstance(s, float) and pd.isna(s)):
        return ""
    return re.sub(r"\s+", " ", str(s).replace("\xa0", " ")).strip()


def cname(s):
    """Normalised display form: whitespace trimmed, curly quotes made straight."""
    return clean(s).translate(QUOTES)


def norm(s):
    t = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().lower()
    t = re.sub(r"[^a-z0-9]+", "", t)
    return t or re.sub(r"\W+", "", str(s).casefold())


def slugify(s):
    t = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().lower()
    t = re.sub(r"[^a-z0-9]+", "-", t).strip("-")
    return t or "x"


def read_review_csv(path):
    for enc in ("utf-8-sig", "cp1252"):
        try:
            return pd.read_csv(path, dtype=str, encoding=enc, keep_default_na=False)
        except UnicodeDecodeError:
            continue
    raise


def parse_date(v):
    if v is None or (isinstance(v, float) and pd.isna(v)) or clean(v) == "":
        return ""
    if isinstance(v, (datetime.datetime, pd.Timestamp)):
        return v.date().isoformat()
    s = clean(v)
    for fmt in ("%m/%d/%Y", "%m/%d/%y", "%Y-%m-%d", "%Y-%m-%d %H:%M:%S"):
        try:
            return datetime.datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            pass
    flag("bad_date", "", s)
    return ""


def parse_reg(v):
    if isinstance(v, (datetime.datetime, pd.Timestamp)):
        # the 2010 workbook stored some registration numbers in date-formatted cells
        return str((pd.Timestamp(v).to_pydatetime().replace(tzinfo=None) - datetime.datetime(1899, 12, 30)).days)
    s = clean(v)
    if not s:
        return ""
    m = re.fullmatch(r"(\d+)(?:\.0+)?", s)
    if m:
        return str(int(m.group(1)))
    flag("bad_registration", "", s)
    return ""


def ts_iso(v):
    if isinstance(v, (int, float)) and not pd.isna(v):
        return (datetime.datetime(1899, 12, 30) + datetime.timedelta(days=float(v))).replace(microsecond=0).isoformat(sep=" ")
    if isinstance(v, (datetime.datetime, pd.Timestamp)):
        return v.replace(microsecond=0).isoformat(sep=" ")
    return clean(v)


# ------------------------------------------------------------------ review inputs
def load_sqlite_drops():
    path = REVIEW / "sqlite_duplicates.csv"
    drops = set()
    if path.exists():
        for _, r in read_review_csv(path).iterrows():
            for m in re.finditer(r"delete\s+(\d+)", r.get("decision", ""), re.I):
                drops.add(int(m.group(1)))
    return drops


NEAR_MISS_COLS = ["variant", "target", "variant_kind", "target_kind", "variant_sources", "target_sources",
                  "variant_parent_uses", "target_parent_uses", "similarity", "decision", "import_status"]

# Decisions deliberately not applied, pending the reviewer's confirmation (keyed by variant text).
HELD = {}


def load_aliases():
    """name_near_misses.csv decisions.

    Returns (alias {key: canonical key}, canon {canonical key: display name}).
    Understood decision forms: "merge, X is the correct form", "merge, X is the registered variety",
    "merge, update both to X", plain "merge" (target is canonical), "keep separate ...".
    Writes an `import_status` column back to the file saying what was done with each row.
    """
    path = REVIEW / "name_near_misses.csv"
    alias, canon = {}, {}
    if not path.exists():
        return alias, canon
    df = read_review_csv(path)
    if "decision" not in df.columns:  # header cell was overwritten while editing: restore it
        extra = [c for c in df.columns if c not in NEAR_MISS_COLS]
        df = df.rename(columns={extra[-1]: "decision"})
    if "import_status" not in df.columns:
        df["import_status"] = ""
    for i, r in df.iterrows():
        d = r["decision"].strip()
        low = d.lower()
        status = ""
        if not d:
            status = "no decision"
        elif low.startswith("keep"):
            status = "kept separate"
        elif low.startswith("merge"):
            m = re.search(r"update both to\s+(.+?)\.?\s*$", d, re.I)
            both = bool(m)
            m = m or re.match(r"merge,?\s*(.+?)\s+is the (?:correct form|registered variety)", d, re.I)
            can = cname(m.group(1)).rstrip(".") if m else cname(r["target"])
            vk, tk, ck = norm(r["variant"]), norm(r["target"]), norm(can)
            sim = max(difflib.SequenceMatcher(None, ck, vk).ratio(), difflib.SequenceMatcher(None, ck, tk).ratio())
            if r["variant"] in HELD:
                status = HELD[r["variant"]]
            elif ck not in (vk, tk) and not both and sim < 0.85:
                status = f"held: named correct form {can!r} is unrelated to either spelling; please re-check"
            else:
                for k_ in (vk, tk):
                    if k_ != ck:
                        alias[k_] = ck
                canon[ck] = can
                status = f"merged -> {can}"
        else:
            status = "unrecognised decision text; not applied"
        df.at[i, "import_status"] = status
        if status.startswith(("held", "unrecognised")):
            flag("near_miss_decision_unapplied", f"{r['variant']} / {r['target']}", status)
    df = df[[c for c in NEAR_MISS_COLS if c in df.columns]]
    df.to_csv(path, index=False, encoding="utf-8-sig")
    return alias, canon


ALIAS, CANON = load_aliases()

CORRECTABLE = {"registration_no", "registered_date", "size_class", "color", "bloom_description",
               "foliage_description", "hybridizer_raw", "description", "notes"}


def load_corrections():
    """reports/review/data_corrections.csv (cultivar, field, value, reason): reviewer overrides of
    individual values, applied after the sources are merged. Keyed by cultivar name."""
    path = REVIEW / "data_corrections.csv"
    out = collections.defaultdict(dict)
    if path.exists():
        for _, r in read_review_csv(path).iterrows():
            if r["field"] in CORRECTABLE:
                out[norm(r["cultivar"])][r["field"]] = (r["value"], r["reason"])
            else:
                flag("correction_unsupported_field", r["cultivar"], r["field"])
    return out


CORRECTIONS = load_corrections()


def load_parent_corrections():
    """reports/review/parent_corrections.csv (cultivar, role, value, reason): reviewer overrides of a parent
    cell of the xlsx `Name` sheet. role is `seed` or `pollen`; value is the cell text to use instead (a cell
    is parsed exactly like a source cell, so it may be a name, "Name (Originator)", "Sport of ..." or a
    placeholder). Applied before the parentage is built, so the raw text, the parent record and the edge all
    follow the correction. Keyed by cultivar name."""
    path = REVIEW / "parent_corrections.csv"
    out = collections.defaultdict(dict)
    if path.exists():
        for _, r in read_review_csv(path).iterrows():
            role = r["role"].strip().lower()
            if role in ("seed", "pollen") and r["value"].strip():
                out[norm(r["cultivar"])][role] = (r["value"].strip(), r["reason"].strip())
            else:
                flag("parent_correction_unsupported", r["cultivar"], f"role={r['role']!r} value={r['value']!r}")
    return out


PARENT_CORRECTIONS = load_parent_corrections()


def K(name):
    n = norm(name)
    for _ in range(5):
        m = ALIAS.get(n)
        if m is None or m == n:
            break
        n = m
    return n


# ------------------------------------------------------------------ hybridizer mapping
ORG_RE = re.compile(r"nurser|universit|greenhouse|society|college|farm|garden|laborator|institute|\bclub\b|racks|\bbros\b", re.I)
COUNTRIES = {"Germany", "Hungary", "Russia", "Ukraine", "Japan", "Canada", "Australia", "England", "Netherlands",
             "Poland", "Latvia", "Lithuania", "Belarus", "Sweden", "Denmark", "France", "Italy", "New Zealand",
             "Brazil", "Czech Republic", "Finland", "Norway", "Taiwan", "China", "Korea"}

# Hand-applied reviewer decisions that differ from the proposal (hybridizer_mapping.csv `decision`)
OVERRIDES = {
    "Dibley's Nursery": "Dibleys Nurseries",
    "Stork, J.": "Stork, Joyce",
    "Tinari, F.": "Tinari, Frank",
}


def split_people(s):
    parts = re.split(r"\s*[/;]\s*", s.strip().rstrip(","))
    return [p.strip().rstrip(",").strip() for p in parts if p.strip().rstrip(",").strip()]


def pkey(p):
    m = re.match(r"^([^,]+),\s*([A-Za-z])", p)
    return (norm(m.group(1)), m.group(2).lower()) if m else (norm(p), "")


def load_mapping(needed):
    """Return {source_value: [person,...]}, extending the review file with new strings."""
    path = REVIEW / "hybridizer_mapping.csv"
    m = read_review_csv(path)
    if "final_person(s)" not in m.columns:
        m["final_person(s)"] = ""
    xl_people = {}
    for _, r in m.iterrows():
        if r["source"] == "xlsx":
            for p in split_people(r["source_value"]):
                xl_people.setdefault(pkey(p), set()).add(p)
    canon = {k: max(v, key=len) for k, v in xl_people.items()}
    for i, r in m.iterrows():
        sv = cname(r["source_value"])
        if not r["final_person(s)"].strip():
            m.at[i, "final_person(s)"] = OVERRIDES.get(sv, r["proposed_person(s)"])
    have = {cname(v) for v in m["source_value"]}
    new_rows = []
    for sv, (src, n) in sorted(needed.items()):
        if sv in have:
            continue
        proposed = [canon.get(pkey(p), p) for p in split_people(sv)]
        status = "map" if any(canon.get(pkey(p), p) != p for p in split_people(sv)) else "new"
        new_rows.append({"source": src, "source_value": sv, "uses": n, "proposed_person(s)": " ; ".join(proposed),
                         "action": status, "notes": "added by import_excel.py", "decision": "",
                         "final_person(s)": OVERRIDES.get(sv, " ; ".join(proposed))})
    if new_rows:
        m = pd.concat([m, pd.DataFrame(new_rows)], ignore_index=True)
    # per-person overrides also apply inside multi-person strings (idempotent)
    m["final_person(s)"] = m["final_person(s)"].map(
        lambda f: " ; ".join(OVERRIDES.get(p.strip(), p.strip()) for p in f.split(";") if p.strip()))
    m.to_csv(path, index=False, encoding="utf-8-sig")
    out = {}
    for _, r in m.iterrows():
        out.setdefault(cname(r["source_value"]), [p.strip() for p in r["final_person(s)"].split(";") if p.strip()])
    return out, len(new_rows)


# ------------------------------------------------------------------ parents
PLACEHOLDER = re.compile(
    r"^(?:[\s?\-—–.]*|n/?a|none|lost|unknown.*|\?.*lost.*|\(?unreadable.*|\(?not listed\)?|"
    r"unreadable record|diverse pollent parent|mixed .*seeds?|seeds? from .*|open pollinated)$", re.I)
SPORT_MARK = re.compile(r"\(\s*(?:sport|spot)(?:\s+of)?\s*\)", re.I)
SELF_RE = re.compile(r"\s*\(?\bx\s+self\)?\s*$", re.I)
SEEDLING_CODE = re.compile(r"^\d{1,2}-\d{1,3}-\d{1,3}$")


ORIG_TAIL = re.compile(r"^(.+?)\s*\(([A-Z][A-Za-z.'& \-]{1,30})\)$")


def looks_like_originator(text):
    """A bracketed capitalised word or two (Pittman, Lyons, Armacost & Royston), not a cross or a note."""
    return bool(text) and " x " not in text.lower() and not re.search(r"\d", text)


def parse_cell(raw):
    t = cname(raw)
    r = {"name": "", "orig": "", "sport": False, "self": False, "placeholder": False, "raw": clean(raw)}
    if not t:
        return r
    if re.fullmatch(r"sport of", t, re.I):
        r["sport"] = True
        return r
    m = re.match(r"^sport of\s*'?(.+?)'?\s*(\(.*\))?$", t, re.I)
    if m:
        r["sport"] = True
        t = m.group(1).strip()
        inner = (m.group(2) or "").strip("() ")
        if looks_like_originator(inner) and re.match(r"[A-Z]", inner):
            r["orig"] = inner  # Sport of 'Bellissima' (Tinari): the bracket names the parent's originator
    if SPORT_MARK.search(t):
        r["sport"] = True
        t = SPORT_MARK.sub("", t).strip()
    if SELF_RE.search(t):
        r["self"] = True
        t = SELF_RE.sub("", t).strip()
    if not t or PLACEHOLDER.match(t):
        r["placeholder"] = not r["sport"] and not r["self"] and bool(t)
        return r
    m = ORIG_TAIL.match(t)
    if m and looks_like_originator(m.group(2)) and not r["orig"]:
        t, r["orig"] = m.group(1).strip(), m.group(2).strip()
    r["name"] = t
    return r


def stub_kind(name):
    if re.match(r"^(S\.|Saintpaulia)\s", name):
        return "species"
    if re.search(r"seedling", name, re.I) or re.search(r"\sx\s", name, re.I) or name.startswith("["):
        return "seedling"
    return "stub"


# ------------------------------------------------------------------ load sources
def load_xlsx():
    df = pd.read_excel(XLSX, sheet_name="Name", usecols=range(7), dtype=object, keep_default_na=False)
    # column G has no header: it holds a short blossom description on a few rows (e.g. the 8E cultivars)
    df.columns = ["Timestamp", "Plant Name", "Seed Parent", "Pollen Parent", "Hybridizer", "Notes", "Extra"]
    df["_row"] = df.index + 2
    nonblank = (df.drop(columns="_row").astype(str).apply(lambda s: s.str.strip()) != "").any(axis=1)
    return df[nonblank].reset_index(drop=True)


def load_sqlite(drops):
    con = sqlite3.connect(f"file:{SQLITE}?mode=ro", uri=True)
    v = pd.read_sql("select * from Varieties", con)
    con.close()
    before = len(v)
    v = v[~v["NameID"].isin(drops)]
    return v[v["Name"].notna()].reset_index(drop=True), before - len(v)


def load_supplements():
    frames = []
    for p in sorted(SUPP.glob("20*/AVML*.xlsx")):
        d = pd.read_excel(p, dtype=object)
        d["_year"] = int(p.parent.name)
        d["_file"] = p.name
        frames.append(d)
    a = pd.concat(frames, ignore_index=True)
    # a few rows have the provenance note shifted into the registration/date columns
    for col in ("AVSA Registration", "Date registered"):
        shifted = a[col].map(lambda v: isinstance(v, str) and "supplement to the AV Master List" in v)
        a.loc[shifted, "Notes"] = a.loc[shifted, col]
        a.loc[shifted, col] = None
    return a[a["Name"].notna() & (a["Name"].astype(str).str.strip() != "")].reset_index(drop=True)


# ------------------------------------------------------------------ build
# ------------------------------------------------------------------ 1963 Master List
# data/masterlist1963.csv (from scripts/parse_masterlist1963.py): names, originators and the registered
# flag. Each distinct name + originator is its own record, because the book reuses names (nine different
# "Stardust" varieties). An entry joins an existing record automatically only when the originators agree;
# every other name match is listed in reports/review/masterlist_matches.csv for a human decision.
ML_STOP = {"greenhouse", "greenhouses", "gardens", "garden", "nursery", "nurseries", "violets", "violet", "african",
           "the", "and", "inc", "farm", "farms", "plants", "plant", "company"}
ML_SECTION = {"main": "main list", "1960": "1960 section", "1961": "1961 section", "1962": "1962 section",
              "nodesc": "names without descriptions"}
ML_REVIEW = REVIEW / "masterlist_matches.csv"


def otokens(s):
    s = str(s).replace("A&R", "Armacost Royston")   # A&R is the business Armacost & Royston
    t = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().lower()
    return {w for w in re.findall(r"[a-z]+", t) if len(w) >= 3 and w not in ML_STOP}


def load_masterlist():
    path = DATA / "masterlist1963.csv"
    if not path.exists():
        return []
    # One record per plant. The same name + originator listed twice (the main list and a year section) is one
    # plant when the descriptions agree; with different descriptions the book is describing different plants.
    by_base = collections.OrderedDict()
    for r in pd.read_csv(path, dtype=str, keep_default_na=False).to_dict("records"):
        negated = bool(re.match(r"(?i)^not\b", r["originator"]))
        orig = "" if negated else r["originator"]
        base = (norm(r["name"]), norm(orig))
        desc = r.get("description", "")
        g = None
        for cand in by_base.setdefault(base, []):
            same = (not desc or not cand["description"] or norm(desc) == norm(cand["description"])
                    or difflib.SequenceMatcher(None, norm(desc), norm(cand["description"])).ratio() >= 0.9)
            if same:
                g = cand
                break
        if g is None:
            g = {"key": base + (len(by_base[base]),), "name": r["name"], "originator": orig, "registered": 0,
                 "entries": [], "xref": [], "negated": "", "description": "", "kind": "cultivar"}
            by_base[base].append(g)
        g["registered"] = max(g["registered"], int(r["registered"] or 0))
        g["entries"].append((r["section"], r["printed_page"]))
        if desc and not g["description"]:
            g["description"] = desc
        if r.get("kind") == "species":
            g["kind"] = "species"
        if r["xref"]:
            g["xref"].append(r["xref"])
        if negated:
            g["negated"] = r["originator"]
    return [g for lst in by_base.values() for g in lst]


def load_ml_decisions():
    out = {}
    if ML_REVIEW.exists():
        for _, r in read_review_csv(ML_REVIEW).iterrows():
            out[(norm(r["book_name"]), norm(r["book_originator"]), norm(r["existing_name"]))] = r["decision"].strip().lower()
    return out


def listing_text(g):
    seen = []
    for sec, pg in g["entries"]:
        t = f"{ML_SECTION[sec]} p. {pg}"
        if t not in seen:
            seen.append(t)
    return "; ".join(seen)


def join_masterlist(d, g):
    d["sources"] = d["sources"] if "masterlist1963" in d["sources"] else d["sources"] + "+masterlist1963"
    d["registered_1963"] = max(int(d.get("registered_1963") or 0), g["registered"])
    d["masterlist_1963"] = listing_text(g)
    if g["description"] and not d["description"]:
        d["description"] = g["description"]  # the 1963 description (modern records keep their bloom/foliage text)
    # a cross-reference is part of the description when there is one; only a bare name needs a note
    extra = "" if g["description"] else " ".join(f"1963 Master List: {x}" for x in dict.fromkeys(g["xref"]))
    if g["negated"]:
        extra = (extra + " " if extra else "") + f"1963 Master List gives the originator as \"{g['negated']}\"."
    if extra:
        d["notes"] = (d["notes"] + " " if d["notes"] else "") + extra
    if not d["hybridizer_raw"] and g["originator"]:
        d["hybridizer_raw"] = g["originator"]
        d["_text_hyb"] = True  # an originator as printed in 1963 (often a surname or firm): kept as text, not a person
    if d["kind"] == "stub":
        d["kind"] = "cultivar"  # a name that was only a parent now has a record of its own


def attach_masterlist(allrec):
    groups = load_masterlist()
    if not groups:
        return {"groups": 0, "joined_auto": 0, "joined_decision": 0, "new": 0, "review": 0}
    decisions = load_ml_decisions()
    by_name = collections.defaultdict(list)
    for k, d in allrec.items():
        by_name[K(d["name"])].append((k, d))
    stats = collections.Counter()
    review = []
    seen_pairs = set()
    for g in groups:
        cands = by_name.get(K(g["name"]), [])
        agree = [(k, d) for k, d in cands if g["originator"] and otokens(g["originator"]) & otokens(d["hybridizer_raw"])]
        target, how = None, ""
        if len(agree) == 1:
            target, how = agree[0], "joined_auto"
        else:
            for k, d in cands:
                if decisions.get((g["key"][0], g["key"][1], norm(d["name"])), "").startswith("join"):
                    target, how = (k, d), "joined_decision"
                    break
        if target:
            join_masterlist(target[1], g)
            stats[how] += 1
        else:
            rec = {"id": "", "name": g["name"], "kind": g["kind"], "sport_of": "", "sport_xlsx": "", "size_class": "",
                   "color": "", "bloom_description": "", "foliage_description": "", "registration_no": "",
                   "registered_date": "", "description": "", "notes": "", "sources": "masterlist1963", "source_row": "",
                   "added_at": "", "seed_parent_raw": "", "pollen_parent_raw": "", "hybridizer_raw": "",
                   "source_note": "", "supplement_year": "", "_q": None, "_x": None, "uses": 0}
            rec["_key"] = "ml63|" + "|".join(str(x) for x in g["key"])
            join_masterlist(rec, g)
            rec["hybridizer_raw"] = g["originator"]
            rec["_text_hyb"] = True
            allrec[rec["_key"]] = rec
            stats["new"] += 1
        for k, d in cands:
            if target and target[0] == k:
                continue
            if len(agree) > 1 and (k, d) in agree:
                why = "originator matches several existing records"
            elif not g["originator"]:
                why = "book entry gives no originator"
            elif not d["hybridizer_raw"]:
                why = "existing record has no known hybridizer"
            else:
                why = "originators differ"
            pair_key = (g["key"][0], g["key"][1], norm(d["name"]))
            if pair_key in seen_pairs:   # several plants with this name and originator: one review row is enough
                continue
            seen_pairs.add(pair_key)
            review.append({"book_name": g["name"], "book_originator": g["originator"], "book_listing": listing_text(g),
                           "book_description": g["description"],
                           "existing_name": d["name"], "existing_kind": d["kind"],
                           "existing_hybridizer": d["hybridizer_raw"], "existing_sources": d["sources"], "reason": why,
                           "decision": decisions.get(pair_key, "")})
    order = {"existing record has no known hybridizer": 0, "book entry gives no originator": 1,
             "originator matches several existing records": 2, "originators differ": 3}
    review.sort(key=lambda r: (order[r["reason"]], r["book_name"].lower()))
    pd.DataFrame(review, columns=["book_name", "book_originator", "book_listing", "book_description", "existing_name",
                                  "existing_kind", "existing_hybridizer", "existing_sources", "reason", "decision"]).to_csv(
        ML_REVIEW, index=False, encoding="utf-8-sig")
    stats["groups"], stats["review"] = len(groups), len(review)
    return dict(stats)


# ------------------------------------------------------------------ originators given as text
PO_REVIEW = REVIEW / "parent_originator_matches.csv"
OM_REVIEW = REVIEW / "originator_mapping.csv"
ORIG_SPLIT = re.compile(r"\s+(?:&|and)\s+|\s*[/;]\s*")   # "A & B" and "A and B" split; "A&R" does not


def load_po_decisions():
    out = {}
    if PO_REVIEW.exists():
        for _, r in read_review_csv(PO_REVIEW).iterrows():
            out[(norm(r["name"]), norm(r["originator"]))] = r["decision"].strip()
    return out


def own_names(text):
    """The people an originator string names: split 'A & B', drop a trailing full stop."""
    return [x.strip().rstrip(".").strip() for x in ORIG_SPLIT.split(text) if x.strip().rstrip(".").strip()]


def load_originator_mapping(needed, base_people):
    """reports/review/originator_mapping.csv: every originator written only as text, with a proposed link to an
    existing person where the surname matches exactly one. NOTHING is linked unless `decision` says `link`,
    because a 1960s originator and a modern hybridizer can share a surname. A decision may also be the person's
    name(s) typed out ("Lyon, Lyndon"; separate several with ;). Otherwise the originator becomes a person
    exactly as printed."""
    sur = collections.defaultdict(list)
    for nm_ in base_people:
        sur[norm(nm_.split(",")[0])].append(nm_)
    old = {}
    if OM_REVIEW.exists():
        for _, r in read_review_csv(OM_REVIEW).iterrows():
            old[r["originator"]] = r
    rows, mapping, kinds, linked_n = [], {}, {}, 0
    existing_norm = {norm(nm_) for nm_ in base_people}
    for orig, uses in sorted(needed.items(), key=lambda kv: (-kv[1], kv[0])):
        parts = [orig.strip().rstrip(".")] if norm(orig) in existing_norm else own_names(orig)
        cands = sur.get(norm(parts[0]), []) if len(parts) == 1 else []
        proposed = " | ".join(cands)
        dec = old[orig]["decision"].strip() if orig in old else ""
        if dec.lower() in ("link", "yes", "y", "join") and len(cands) == 1:
            final = [cands[0]]
            linked_n += 1
        elif dec and dec.lower() not in ("link", "yes", "y", "join", "keep", "no", "n", "text"):
            final = [x.strip() for x in dec.split(";") if x.strip()]
            linked_n += 1
        else:
            final = parts
        mapping[orig] = final
        guess = "organization" if ORG_RE.search(orig) else "person"
        kind = old[orig]["kind"].strip() if orig in old and old[orig]["kind"].strip() else guess
        if kind in ("person", "organization") and final == parts:
            for nm_ in final:
                kinds[nm_] = kind
        rows.append({"originator": orig, "uses": uses, "kind": kind,
                     "proposed_link": proposed, "decision": dec, "final_person(s)": " ; ".join(final)})
    pd.DataFrame(rows, columns=["originator", "uses", "kind", "proposed_link", "decision", "final_person(s)"]).to_csv(
        OM_REVIEW, index=False, encoding="utf-8-sig")
    return mapping, kinds, {"originators": len(rows), "with a proposed link": sum(1 for r in rows if r["proposed_link"]),
                     "linked by decision": linked_n}


FIELD_MAP = [("Variety", "size_class"), ("Colour", "color"), ("Bloom", "bloom_description"),
             ("Foliage", "foliage_description")]


def build():
    xl = load_xlsx()
    drops = load_sqlite_drops()
    sq, dropped = load_sqlite(drops)
    sp = load_supplements()

    recs = collections.OrderedDict()   # key -> record

    def rec(key, name):
        if key not in recs:
            recs[key] = {"names": {}, "sources": [], "x": None, "q": None, "s": [], "kind": "cultivar",
                         "uses": 0, "stub": False}
        recs[key]["names"].setdefault(name, 0)
        recs[key]["names"][name] += 1
        return recs[key]

    # --- xlsx (group exact/near-exact repeats)
    seen = {}
    for _, r in xl.iterrows():
        name = cname(r["Plant Name"])
        k = K(name)
        rr = rec(k, name)
        row = {c: clean(r[c]) for c in ("Seed Parent", "Pollen Parent", "Hybridizer", "Notes", "Extra")}
        row.update(row_no=int(r["_row"]), ts=ts_iso(r["Timestamp"]))
        content = tuple(row[c] for c in ("Seed Parent", "Pollen Parent", "Hybridizer", "Notes", "Extra"))
        if rr["x"] is None:
            rr["x"] = row
            seen[k] = content
            if "xlsx" not in rr["sources"]:
                rr["sources"].append("xlsx")
        elif content != seen[k]:
            flag("xlsx_conflicting_duplicate", name,
                 f"row {row['row_no']} differs from kept row {rr['x']['row_no']}: "
                 f"seed={content[0]!r} pollen={content[1]!r} hybridizer={content[2]!r}")
    # --- sqlite
    for _, r in sq.iterrows():
        name = cname(r["Name"])
        k = K(name)
        rr = rec(k, name)
        if rr["q"] is not None:
            flag("sqlite_unresolved_duplicate", name, f"NameID {r['NameID']} ignored; kept {rr['q']['NameID']}")
            continue
        rr["q"] = {"NameID": int(r["NameID"]), "sport": cname(r["Sport Parent"]), "hyb": clean(r["Hybridiser"]),
                   "reg": parse_reg(r["AVSA Registration"]), "date": parse_date(r["Date registered"]),
                   **{t: clean(r[s_]) for s_, t in FIELD_MAP}}
        rr["sources"].append("sqlite")
    # --- supplements (latest year wins per field)
    for _, r in sp.sort_values("_year", ascending=False, kind="stable").iterrows():
        name = cname(r["Name"])
        k = K(name)
        rr = rec(k, name)
        note = re.sub(r"\s*From the \d{4} supplement to the AV Master List\.?", "", clean(r["Notes"])).strip()
        item = {"year": int(r["_year"]), "hyb": clean(r["Hybridiser"]), "reg": parse_reg(r["AVSA Registration"]),
                "date": parse_date(r["Date registered"]), "note": note,
                **{t: clean(r[s_]) for s_, t in FIELD_MAP}}
        if rr["s"]:
            top = rr["s"][0]
            for f in ("reg", "bloom_description", "foliage_description", "hyb"):
                if item[f] and top[f] and item[f] != top[f]:
                    flag("supplement_conflict", name,
                         f"{f}: {top['year']}={top[f]!r} vs {item['year']}={item[f]!r} (kept {top['year']})")
        rr["s"].append(item)
        if "supplement" not in rr["sources"]:
            rr["sources"].append("supplement")
    n_named = len(recs)

    # --- final field resolution per cultivar
    out = {}
    for k, rr in recs.items():
        q, s_list, x = rr["q"], rr["s"], rr["x"]
        name = (q and next(n for n in rr["names"] if True)) or max(rr["names"], key=rr["names"].get)
        # display name: prefer sqlite spelling, then supplement, then xlsx
        order = []
        if q:
            order.append(cname(sq.loc[sq["NameID"] == q["NameID"], "Name"].iloc[0]))
        order += [cname(sp.loc[(sp["_year"] == i["year"]) & (sp["Name"].map(K) == k), "Name"].iloc[0]) for i in s_list[:1]
                  if not sp.loc[(sp["_year"] == i["year"]) & (sp["Name"].map(K) == k)].empty]
        order += list(rr["names"])
        name = CANON.get(k, order[0])
        d = {"id": "", "name": name, "kind": "seedling" if (SEEDLING_CODE.match(name) or re.match(r"^seedling\b", name, re.I)) else "cultivar",
             "sport_of": "", "sport_xlsx": "", "size_class": "", "color": "", "bloom_description": "",
             "foliage_description": "", "registration_no": "", "registered_date": "", "description": "", "notes": "",
             "sources": "+".join(rr["sources"]), "source_row": "", "added_at": "", "seed_parent_raw": "",
             "pollen_parent_raw": "", "hybridizer_raw": "", "source_note": "", "supplement_year": ""}
        cands = ([q] if q else []) + list(s_list)
        for f in ("size_class", "color", "bloom_description", "foliage_description", "registration_no", "registered_date"):
            src_f = {"registration_no": "reg", "registered_date": "date"}.get(f, f)
            for c in cands:
                if c.get(src_f):
                    d[f] = c[src_f]
                    break
        for c in cands:
            if c.get("hyb"):
                d["hybridizer_raw"] = c["hyb"]
                break
        if not d["hybridizer_raw"] and x:
            d["hybridizer_raw"] = x["Hybridizer"]
        if s_list:
            d["supplement_year"] = str(s_list[0]["year"])
            d["source_note"] = "; ".join(dict.fromkeys(i["note"] for i in s_list if i["note"]))
        if x:
            d.update(source_row=x["row_no"], added_at=x["ts"], seed_parent_raw=x["Seed Parent"],
                     pollen_parent_raw=x["Pollen Parent"], notes=x["Notes"])
            # unheaded column G: kept entirely as a blossom description (user decision; a stray "sport of" is ignored)
            if x["Extra"] and x["Extra"].strip().lower() != "sport of":
                d["description"] = d["description"] or x["Extra"]
                d["bloom_description"] = d["bloom_description"] or x["Extra"]
        d["_q"], d["_x"], d["_key"] = q, x, k
        out[k] = d

    # --- reviewer corrections
    n_corr = 0
    for k, d in out.items():
        for fld, (val, why) in CORRECTIONS.get(norm(d["name"]), {}).items():
            if d[fld] != val:
                d["notes"] = (d["notes"] + " " if d["notes"] else "") + f"[{fld} corrected from {d[fld] or 'blank'}: {why}]" \
                    if fld != "notes" else d["notes"]
                d[fld] = val
                n_corr += 1
    # --- reviewer corrections of parent cells (parent_corrections.csv)
    n_pcorr, used_pcorr = 0, set()
    for k, d in out.items():
        for role, (val, why) in PARENT_CORRECTIONS.get(norm(d["name"]), {}).items():
            col = "Seed Parent" if role == "seed" else "Pollen Parent"
            if not d["_x"]:
                continue  # reported below as unused
            old = d["_x"][col]
            if old != val:
                d["_x"][col] = val
                d[f"{role}_parent_raw"] = val
                d["notes"] = (d["notes"] + " " if d["notes"] else "") + f"[{role} parent corrected from {old or 'blank'}: {why}]"
                n_pcorr += 1
            used_pcorr.add((norm(d["name"]), role))
    for nk, roles in PARENT_CORRECTIONS.items():
        for role in roles:
            if (nk, role) not in used_pcorr:
                flag("parent_correction_unused", nk, f"{role}: no xlsx row found for this cultivar")
    # --- registration uniqueness
    byreg = collections.defaultdict(list)
    for k, d in out.items():
        if d["registration_no"]:
            byreg[d["registration_no"]].append(k)
    for reg, ks in byreg.items():
        if len(ks) > 1:
            flag("registration_shared", "; ".join(out[k]["name"] for k in ks), f"AVSA #{reg} on {len(ks)} cultivars; kept on first only")
            for k in ks[1:]:
                out[k]["notes"] = (out[k]["notes"] + " " if out[k]["notes"] else "") + f"[AVSA #{reg} also listed on another record]"
                out[k]["registration_no"] = ""
                out[k]["registered_date"] = ""

    stubs = {}
    po_decisions = load_po_decisions()
    po_review, po_stats = [], collections.Counter()

    # names cited as a parent WITHOUT an originator: a "Name (Originator)" citation may be the same plant
    plain_keys = set()
    for d_ in out.values():
        if d_["_x"]:
            for col in ("Seed Parent", "Pollen Parent"):
                c_ = parse_cell(d_["_x"][col])
                if c_["name"] and not c_["orig"]:
                    plain_keys.add(K(c_["name"]))
        if d_["_q"] and d_["_q"]["sport"]:
            plain_keys.add(K(d_["_q"]["sport"]))

    def new_stub(k, name, kind_hint=None):
        stubs[k] = {"id": "", "name": CANON.get(K(name), cname(name)), "kind": kind_hint or stub_kind(name), "sport_of": "",
                    "sport_xlsx": "", "size_class": "", "color": "", "bloom_description": "",
                    "foliage_description": "", "registration_no": "", "registered_date": "", "description": "",
                    "notes": "", "sources": "parent", "source_row": "", "added_at": "", "seed_parent_raw": "",
                    "pollen_parent_raw": "", "hybridizer_raw": "", "source_note": "", "supplement_year": "",
                    "_q": None, "_x": None, "_key": k, "uses": 0}

    def resolve(name, kind_hint=None, orig="", cell_text=""):
        k = K(name)
        if orig:
            # "Name (Originator)": the same plant as an existing record only when the originators agree
            existing_hyb = out[k]["hybridizer_raw"] if k in out else ""
            if k in out and existing_hyb and otokens(orig) & otokens(existing_hyb):
                out[k]["uses"] = out[k].get("uses", 0) + 1
                po_stats["joined: originator agrees"] += 1
                return k
            if k in out or k in plain_keys:
                dec = po_decisions.get((norm(name), norm(orig)), "")
                po_review.append({"parent_text": cell_text or f"{name} ({orig})", "name": cname(name), "originator": orig,
                                  "existing_name": out[k]["name"] if k in out else cname(name),
                                  "existing_hybridizer": existing_hyb,
                                  "reason": "originators differ" if existing_hyb else "existing record has no known hybridizer",
                                  "decision": dec})
                if dec.lower().startswith("join"):
                    if k not in out:
                        if k not in stubs:
                            new_stub(k, name, kind_hint)
                        if not stubs[k]["hybridizer_raw"]:
                            stubs[k]["hybridizer_raw"], stubs[k]["_text_hyb"] = orig, True
                        stubs[k]["uses"] += 1
                    else:
                        out[k]["uses"] = out[k].get("uses", 0) + 1
                    po_stats["joined: by decision"] += 1
                    return k
            sk = f"{k}|{norm(orig)}"
            if sk not in stubs:
                new_stub(sk, name, kind_hint)
                stubs[sk]["hybridizer_raw"], stubs[sk]["_text_hyb"] = orig, True
                po_stats["separate record with its originator"] += 1
            stubs[sk]["uses"] += 1
            return sk
        if k in out:
            out[k]["uses"] = out[k].get("uses", 0) + 1
            return k
        if k not in stubs:
            new_stub(k, name, kind_hint)
        stubs[k]["uses"] += 1
        return k

    parentage = []
    sport_fk = {}
    # --- sports (SQLite wins), parentage (xlsx)
    for k, d in out.items():
        q, x = d["_q"], d["_x"]
        sport_parent_key = None
        xlsx_sport = ""
        xlsx_sport_orig, xlsx_sport_cell = "", ""
        if x:
            S, P = parse_cell(x["Seed Parent"]), parse_cell(x["Pollen Parent"])
            note = x["Notes"]
            cert = "unsure" if re.search(r"unsure|maybe|unlikel|not sure|uncertain|probabl", note, re.I) else \
                   ("assumed" if re.search(r"assum", note, re.I) else "known")
            unordered = bool(re.search(r"without specif", note, re.I))
            if S["sport"] or P["sport"]:
                par = S["name"] or P["name"]
                if S["name"] and P["name"] and K(S["name"]) != K(P["name"]):
                    flag("sport_two_parents", d["name"], f"seed={S['name']!r} pollen={P['name']!r}; used seed")
                if par:
                    xlsx_sport = par
                    xlsx_sport_orig = S["orig"] if S["name"] else P["orig"]
                    xlsx_sport_cell = x["Seed Parent"] if S["name"] else x["Pollen Parent"]
                else:
                    flag("sport_without_parent", d["name"], f"{x['Seed Parent']!r} / {x['Pollen Parent']!r}")
            else:
                sn, pn = S["name"], P["name"]
                if (S["self"] or P["self"]) and not (sn and pn):
                    sn = sn or pn
                    pn = sn
                for role, nm_, cell in (("seed", sn, S), ("pollen", pn, P)):
                    if cell["placeholder"]:
                        flag("placeholder_parent", d["name"], f"{role}: {cell['raw']!r}")
                    if nm_:
                        o_ = cell["orig"] if cell["name"] else (S["orig"] or P["orig"])
                        pk = resolve(nm_, orig=o_, cell_text=cell["raw"])
                        if pk == k:
                            # a cultivar cannot be its own ancestor: keep the raw cell text, drop the edge
                            flag("parent_is_self", d["name"],
                                 f"{role} parent equals the cultivar ({cell['raw']!r}); edge dropped, raw text kept")
                            continue
                        parentage.append({"child_id": k, "parent_id": pk, "role": "unordered" if unordered else role,
                                          "certainty": cert, "raw_text": cell["raw"] if role == "seed" else cell["raw"]})
        d["sport_xlsx"] = xlsx_sport
        if q and q["sport"]:
            sport_parent_key = resolve(q["sport"])
            if xlsx_sport and K(xlsx_sport) != sport_parent_key:
                flag("sport_conflict_sqlite_wins", d["name"], f"SQLite={q['sport']!r} xlsx={xlsx_sport!r}")
                d["notes"] = (d["notes"] + " " if d["notes"] else "") + f"[xlsx sport parent: {xlsx_sport}]"
        elif xlsx_sport:
            sport_parent_key = resolve(xlsx_sport, orig=xlsx_sport_orig, cell_text=xlsx_sport_cell)
        if sport_parent_key:
            sport_fk[k] = sport_parent_key

    # duplicates in parentage (same child/parent/role) -> keep first
    seen_p, par2 = set(), []
    for r in parentage:
        t = (r["child_id"], r["parent_id"], r["role"])
        if t not in seen_p:
            seen_p.add(t)
            par2.append(r)
    parentage = par2

    allrec = collections.OrderedDict(list(out.items()) + list(stubs.items()))
    ml_stats = attach_masterlist(allrec)
    # ids
    used = {}
    same_name = collections.Counter(norm(d["name"]) for d in allrec.values())
    for k, d in allrec.items():
        base = slugify(d["name"])
        if "|" in k and same_name[norm(d["name"])] > 1:
            # a name used by several plants: records are told apart by their originator
            base = f"{base}-{slugify(d['hybridizer_raw']) if d['hybridizer_raw'] else '1963'}"
        sid, n = base, 2
        while sid in used and used[sid] != k:
            sid = f"{base}-{n}"
            n += 1
        used[sid] = k
        d["id"] = sid
    for k, d in allrec.items():
        d["sport_of"] = allrec[sport_fk[k]]["id"] if k in sport_fk else ""
    for r in parentage:
        r["child_id"] = allrec[r["child_id"]]["id"]
        r["parent_id"] = allrec[r["parent_id"]]["id"]

    # --- hybridizers / people
    needed = {}
    for d in allrec.values():
        h = cname(d["hybridizer_raw"])
        if h and not d.get("_text_hyb"):
            src = "sqlite" if d["_q"] and d["_q"]["hyb"] else ("supplement" if "supplement" in d["sources"] else "xlsx")
            needed.setdefault(h, [src, 0])[1] += 1
    mapping, n_new = load_mapping({k: tuple(v) for k, v in needed.items()})
    people = collections.OrderedDict()
    links = []
    kind_override = {}   # kinds the reviewer set in originator_mapping.csv

    def person(pname):
        pname = pname.strip()
        country = ""
        m = re.match(r"^(.*?)\s*\(([^)]+)\)\s*$", pname)
        if m and m.group(2) in COUNTRIES:
            pname, country = m.group(1), m.group(2)
        pid = slugify(pname)
        if pid not in people:
            kind = kind_override.get(pname) or ("species" if pname == "Species" else ("organization" if ORG_RE.search(pname) else "person"))
            people[pid] = {"id": pid, "name": pname, "kind": kind, "country": country, "aliases": set()}
        elif country and not people[pid]["country"]:
            people[pid]["country"] = country
        return pid

    for k, d in allrec.items():
        h = cname(d["hybridizer_raw"])
        if not h or d.get("_text_hyb"):
            continue
        names = mapping.get(h)
        if names is None:
            flag("hybridizer_unmapped", d["name"], h)
            continue
        linked = set()
        for pn in names:
            pid = person(pn)
            if pid in linked:
                flag("hybridizer_listed_twice", d["name"], f"{h!r} resolves to {pn!r} more than once; one link kept")
                continue
            linked.add(pid)
            links.append({"cultivar_id": d["id"], "person_id": pid, "position": len(linked)})
    for sv, names in mapping.items():
        if len(names) == 1:
            pid = person(names[0])
            if sv != people[pid]["name"]:
                people[pid]["aliases"].add(sv)

    # originators given only as text (the 1963 Master List, "Name (Originator)" parents): each becomes a person
    # as printed. They are linked to an existing person only where the review file says so (eras differ).
    text_needed = collections.Counter(cname(d["hybridizer_raw"]) for d in allrec.values()
                                      if d.get("_text_hyb") and cname(d["hybridizer_raw"]))
    omap, o_kinds, o_stats = load_originator_mapping(text_needed, [p_["name"] for p_ in people.values()])
    kind_override.update(o_kinds)
    for p_ in people.values():
        if p_["name"] in o_kinds:
            p_["kind"] = o_kinds[p_["name"]]
    for k, d in allrec.items():
        h = cname(d["hybridizer_raw"])
        if not h or not d.get("_text_hyb"):
            continue
        linked = set()
        for pn in omap.get(h, []):
            pid = person(pn)
            if pid not in linked:
                linked.add(pid)
                links.append({"cultivar_id": d["id"], "person_id": pid, "position": len(linked)})
    for orig_, names_ in omap.items():
        if len(names_) == 1:
            pid_ = slugify(names_[0])
            if pid_ in people and orig_ != people[pid_]["name"]:
                people[pid_]["aliases"].add(orig_)
    # the review file for "Name (Originator)" parents that might be an existing plant
    seen_po, rows_po = set(), []
    for r_ in po_review:
        kk = (norm(r_["name"]), norm(r_["originator"]))
        if kk not in seen_po:
            seen_po.add(kk)
            rows_po.append(r_)
    pd.DataFrame(rows_po, columns=["parent_text", "name", "originator", "existing_name", "existing_hybridizer",
                                   "reason", "decision"]).to_csv(REVIEW / "parent_originator_matches.csv",
                                                                 index=False, encoding="utf-8-sig")

    # --- links from notes
    cl = []
    for d in allrec.values():
        for u in dict.fromkeys(re.findall(r"https?://[^\s\"')>]+", d["notes"])):
            u = u.rstrip(".,;")
            cl.append({"cultivar_id": d["id"], "url": u,
                       "kind": "photos" if "drive.google.com" in u else "web"})

    return dict(n_corr=n_corr, n_pcorr=n_pcorr, allrec=allrec, parentage=parentage, people=people, hyb=links, links=cl, n_named=n_named,
                dropped=dropped, n_new_map=n_new, sq=sq, xl=xl, sp=sp, stubs=stubs, out=out, ml=ml_stats,
                po=dict(po_stats, review=len(rows_po)), om=o_stats)


# ------------------------------------------------------------------ near-miss review file
def write_near_misses(res):
    path = REVIEW / "name_near_misses.csv"
    if path.exists():
        return None
    allrec = res["allrec"]
    par_uses = collections.Counter()
    for r in res["parentage"]:
        par_uses[r["parent_id"]] += 1
    ids = {d["id"]: d for d in allrec.values()}
    items = [(d["id"], d["name"]) for d in allrec.values()]
    buckets = collections.defaultdict(list)
    for i, n in items:
        buckets[norm(n)[:2]].append((i, n, norm(n)))
    rows = []
    for b in buckets.values():
        for ai in range(len(b)):
            for bi in range(ai + 1, len(b)):
                (ia, na, ka), (ib, nb, kb) = b[ai], b[bi]
                if len(ka) < 6 or abs(len(ka) - len(kb)) > 2 or ka == kb:
                    continue
                if SEEDLING_CODE.match(na) or SEEDLING_CODE.match(nb):
                    continue
                if re.search(r"\d", na + nb) and not (ids[ia]["kind"] == ids[ib]["kind"] == "cultivar"):
                    continue
                ratio = difflib.SequenceMatcher(None, ka, kb).ratio()
                if ratio < 0.92:
                    continue
                da, db = ids[ia], ids[ib]

                def score(d):
                    return (d["kind"] == "cultivar", d["sources"] != "parent", par_uses[d["id"]])
                target, variant = (da, db) if score(da) >= score(db) else (db, da)
                rows.append({"variant": variant["name"], "target": target["name"],
                             "variant_kind": variant["kind"], "target_kind": target["kind"],
                             "variant_sources": variant["sources"], "target_sources": target["sources"],
                             "variant_parent_uses": par_uses[variant["id"]], "target_parent_uses": par_uses[target["id"]],
                             "similarity": round(ratio, 3), "decision": ""})
    rows.sort(key=lambda r: (-r["similarity"], r["variant"]))
    pd.DataFrame(rows).to_csv(path, index=False, encoding="utf-8-sig")
    return len(rows)


# ------------------------------------------------------------------ write
def write_all(res):
    allrec = res["allrec"]
    cols = ["id", "name", "kind", "sport_of_id", "size_class", "color", "bloom_description", "foliage_description",
            "registration_no", "registered_year", "registered_date", "description", "notes", "sources", "source_row",
            "added_at", "seed_parent_raw", "pollen_parent_raw", "hybridizer_raw", "source_note", "supplement_year",
            "registered_1963", "masterlist_1963"]
    rows = []
    for d in allrec.values():
        r = {c: d.get(c, "") for c in cols}
        r["sport_of_id"] = d["sport_of"]
        r["registered_year"] = d["registered_date"][:4] if d["registered_date"] else ""
        rows.append(r)
    pd.DataFrame(rows, columns=cols).to_csv(DATA / "cultivars.csv", index=False, encoding="utf-8")
    pd.DataFrame(res["parentage"], columns=["child_id", "parent_id", "role", "certainty", "raw_text"]).to_csv(
        DATA / "parentage.csv", index=False, encoding="utf-8")
    people = [{**p, "aliases": " | ".join(sorted(p["aliases"]))} for p in res["people"].values()]
    pd.DataFrame(people, columns=["id", "name", "kind", "country", "aliases"]).to_csv(
        DATA / "people.csv", index=False, encoding="utf-8")
    pd.DataFrame(res["hyb"], columns=["cultivar_id", "person_id", "position"]).to_csv(
        DATA / "cultivar_hybridizers.csv", index=False, encoding="utf-8")
    pd.DataFrame(res["links"], columns=["cultivar_id", "url", "kind"]).to_csv(
        DATA / "cultivar_links.csv", index=False, encoding="utf-8")
    pd.DataFrame(flags, columns=["category", "cultivar", "detail"]).to_csv(
        REPORTS / "import_flags.csv", index=False, encoding="utf-8-sig")


def main():
    res = build()
    nm = write_near_misses(res)
    write_all(res)
    allrec = res["allrec"]
    kinds = collections.Counter(d["kind"] for d in allrec.values())
    srcs = collections.Counter(d["sources"] for d in allrec.values())
    fl = collections.Counter(f["category"] for f in flags)
    lines = ["# Import summary", "",
             f"- cultivars.csv: {len(allrec)} rows (named from sources: {res['n_named']}; stubs from parents: {len(res['stubs'])})",
             f"- kinds: {dict(kinds)}", f"- sources: {dict(srcs)}",
             f"- parentage.csv: {len(res['parentage'])}; people.csv: {len(res['people'])}; "
             f"cultivar_hybridizers.csv: {len(res['hyb'])}; cultivar_links.csv: {len(res['links'])}",
             f"- SQLite rows dropped by review decisions: {res['dropped']}",
             f"- new hybridizer strings appended to hybridizer_mapping.csv: {res['n_new_map']}",
             f"- reviewer corrections applied (data_corrections.csv): {res['n_corr']}",
             f"- parent corrections applied (parent_corrections.csv): {res['n_pcorr']}",
             f"- 1963 Master List: {res['ml']}",
             f"- parents written 'Name (Originator)': {res['po']}",
             f"- originators written as text, now people: {res['om']}",
             f"- sports linked: {sum(1 for d in allrec.values() if d['sport_of'])}",
             f"- with registration no.: {sum(1 for d in allrec.values() if d['registration_no'])}",
             f"- name near-miss candidates written for review: {nm if nm is not None else '(file exists; decisions applied: ' + str(len(ALIAS)) + ')'}",
             "", "## Flags by category", ""] + [f"- {k}: {v}" for k, v in fl.most_common()]
    (REPORTS / "import_summary.md").write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
