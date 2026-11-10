"""Shared code for contributor submissions (see notes/submission-form-plan.md).

Used by check_submissions.py (flags for the review Sheet) and import_submissions.py (ingest + apply).
Reuses the name/placeholder/people helpers of import_excel.py so submissions are normalised exactly like the
original sources.
"""
import csv
import datetime
import difflib
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import import_excel as ie  # noqa: E402  (importing it re-reads the review files; harmless and idempotent)

ROOT = ie.ROOT
DATA = ie.DATA
SUBDIR = DATA / "submissions"
INBOX = ROOT / "submissions" / "inbox"          # git-ignored: raw Sheet exports (contact details)

# Fields the submitter may give (column names are shared by the form CSV, the Sheet and data/submissions/*.csv)
TEXT_FIELDS = ["size_class", "color", "bloom_description", "foliage_description", "description", "notes"]
FIELDS = ["action", "existing_id", "name", "kind", "hybridizers", "year_introduced", "seed_parent", "pollen_parent",
          "parent_certainty", "sport_of", "parentage_note", "registration_no", "registered_date"] + TEXT_FIELDS + [
    "links", "photo_files", "photo_captions", "photo_credits", "photo_permission"]
SUBMISSION_COLS = ["submission_id", "entry_no", "received_at", "submitter_name", "contact", "agreed_license"]
ADMIN_COLS = ["decision", "join_id", "overwrite_fields", "admin_note", "reply_note",
              "flag_name_match", "flag_parents", "flag_other"]
CORRECTED_COLS = ["corrected_" + f for f in FIELDS if f not in ("action", "existing_id")]
SHEET_COLUMNS = SUBMISSION_COLS + FIELDS + ADMIN_COLS + CORRECTED_COLS
# Written to data/submissions/<id>.csv (tracked). No contact, no admin notes.
PUBLIC_COLS = ["submission_id", "entry_no", "received_at", "submitter_name", "force_new", "overwrite_fields"] + FIELDS
KINDS = {"cultivar", "seedling", "species"}
CERTAINTY = {"known", "assumed", "unsure"}
IMPORT_DECISIONS = {"accept", "join", "different"}
SID_RE = re.compile(r"^[A-Za-z0-9_-]{3,60}$")
OVERWRITABLE = set(TEXT_FIELDS) | {"kind", "registration_no", "registered_date", "parents", "sport_of", "hybridizers"}


def read_csv(path):
    for enc in ("utf-8-sig", "cp1252"):
        try:
            with open(path, newline="", encoding=enc) as f:
                return list(csv.DictReader(f))
        except UnicodeDecodeError:
            continue
    raise ValueError(f"cannot decode {path}")


def write_csv(path, rows, cols, bom=False):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8-sig" if bom else "utf-8") as f:
        w = csv.DictWriter(f, fieldnames=cols, lineterminator="\r\n", extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)


def split_list(s, sep):
    return [x.strip() for x in str(s or "").split(sep) if x.strip()]


def effective(row):
    """Row with the admin's corrected_* values applied over the submitted ones."""
    out = dict(row)
    for f in FIELDS:
        c = ie.clean(row.get("corrected_" + f, "")) if "corrected_" + f in row else ""
        if c:
            out[f] = c
    for f in FIELDS:
        out[f] = ie.cname(out.get(f, "")) if f not in ("description", "notes") else ie.clean(out.get(f, ""))
    out["action"] = (out.get("action") or "new").lower()
    return out


# ------------------------------------------------------------------ database view
class Base:
    """The current data/*.csv, indexed for name lookups. New records can be added while processing."""

    def __init__(self):
        self.cultivars = {r["id"]: r for r in read_csv(DATA / "cultivars.csv")}
        self.parentage = read_csv(DATA / "parentage.csv")
        self.people = {r["id"]: r for r in read_csv(DATA / "people.csv")}
        self.hyb = read_csv(DATA / "cultivar_hybridizers.csv")
        self.links = read_csv(DATA / "cultivar_links.csv")
        self.by_key = {}
        for r in self.cultivars.values():
            self.index(r)
        self.person_by_key = {}
        for p in self.people.values():
            for n in [p["name"]] + split_list(p.get("aliases", ""), "|"):
                self.person_by_key.setdefault(ie.norm(n), p["id"])
        self.reg = {r["registration_no"]: r["id"] for r in self.cultivars.values() if r["registration_no"]}

    def index(self, r):
        self.by_key.setdefault(ie.K(r["name"]), []).append(r["id"])

    def find(self, name):
        """-> list of cultivar ids whose normalised name matches."""
        return list(self.by_key.get(ie.K(name), []))

    def resolve(self, text):
        """A name or 'id:<slug>' -> (status, ids). status: id | one | many | none."""
        text = ie.cname(text)
        if text.lower().startswith("id:"):
            i = text[3:].strip()
            return ("id", [i]) if i in self.cultivars else ("none", [])
        ids = self.find(text)
        return ("one" if len(ids) == 1 else "many" if ids else "none", ids)

    def near(self, name, limit=3, cutoff=0.88):
        k = ie.norm(name)
        if not k:
            return []
        scored = []
        for key, ids in self.by_key.items():
            kk = ie.norm(key)
            if kk != k and abs(len(kk) - len(k)) <= 3:
                s = difflib.SequenceMatcher(None, k, kk).ratio()
                if s >= cutoff:
                    scored.append((s, ids[0]))
        return [self.cultivars[i]["name"] + f" [{i}]" for _, i in sorted(scored, reverse=True)[:limit]]

    def parents_of(self):
        m = {}
        for r in self.parentage:
            m.setdefault(r["child_id"], set()).add(r["parent_id"])
        for r in self.cultivars.values():
            if r["sport_of_id"]:
                m.setdefault(r["id"], set()).add(r["sport_of_id"])
        return m

    def person_near(self, name):
        key = ie.pkey(name)
        return [p["name"] for p in self.people.values() if ie.pkey(p["name"]) == key and ie.norm(p["name"]) != ie.norm(name)][:3]


def has_cycle(parents_of, child, parent_ids):
    """Would linking `child` to `parent_ids` make `child` its own ancestor?"""
    seen, stack = set(), list(parent_ids)
    while stack:
        x = stack.pop()
        if x == child:
            return True
        if x in seen:
            continue
        seen.add(x)
        stack.extend(parents_of.get(x, ()))
    return False


def is_placeholder(text):
    t = ie.cname(text)
    return (not t) or bool(ie.PLACEHOLDER.match(t))


def check_row(row, base, batch_names=None):
    """Problems and notes for one effective row -> dict(name_match, parents, other) of text lists."""
    r = effective(row)
    nm, pa, ot = [], [], []
    name = r["name"]
    if not name:
        ot.append("no name")
        return {"name_match": nm, "parents": pa, "other": ot}
    if r["action"] == "update":
        if not r["existing_id"] or r["existing_id"] not in base.cultivars:
            ot.append("update needs a valid existing_id")
    else:
        ids = base.find(name)
        if len(ids) == 1:
            c = base.cultivars[ids[0]]
            if c["kind"] == "stub":
                nm.append(f"matches stub {ids[0]} (named as a parent only): accepting fills it in")
            else:
                nm.append(f"EXISTS: {ids[0]} ({c['kind']}, {c['hybridizer_raw'] or 'no hybridizer'}): "
                          "decide join (same cultivar) or different (new cultivar with the same name)")
        elif ids:
            nm.append("EXISTS several times: " + ", ".join(ids) + ": decide join (with join_id) or different")
        else:
            near = base.near(name)
            if near:
                nm.append("similar names: " + "; ".join(near))
    if batch_names is not None:
        if batch_names.count(ie.K(name)) > 1:
            ot.append("name appears more than once in this submission")
    if r["kind"] and r["kind"].lower() not in KINDS:
        ot.append(f"kind {r['kind']!r} not one of {sorted(KINDS)}")
    if r["parent_certainty"] and r["parent_certainty"].lower() not in CERTAINTY:
        ot.append(f"parent_certainty {r['parent_certainty']!r} not one of {sorted(CERTAINTY)}")
    new_id = r["existing_id"] if r["action"] == "update" else None
    parent_ids = []
    if r["sport_of"] and (r["seed_parent"] or r["pollen_parent"]):
        pa.append("sport_of given together with seed/pollen parent: seed/pollen will be ignored")
    cells = [("sport of", r["sport_of"])] if r["sport_of"] else [("seed", r["seed_parent"]), ("pollen", r["pollen_parent"])]
    for role, cell in cells:
        if is_placeholder(cell):
            continue
        status, ids = base.resolve(cell)
        if ie.K(cell) == ie.K(name):
            pa.append(f"{role}: {cell!r} is the cultivar itself")
        elif status == "none" and batch_names is not None and ie.K(cell) in batch_names:
            pa.append(f"{role}: {cell!r} -> another entry in this submission")
        elif status in ("id", "one"):
            parent_ids.append(ids[0])
            pa.append(f"{role}: {cell} -> {ids[0]}")
        elif status == "many":
            opts = ", ".join(f"{i} ({base.cultivars[i]['hybridizer_raw'] or base.cultivars[i]['kind']})" for i in ids[:6])
            pa.append(f"{role}: {cell!r} AMBIGUOUS: {opts}: type id:<slug> in the parent cell")
        else:
            near = base.near(cell)
            pa.append(f"{role}: {cell!r} not in the database: will become a stub"
                      + (f"; similar: {'; '.join(near)}" if near else ""))
    if new_id and has_cycle(base.parents_of(), new_id, parent_ids):
        pa.append("CYCLE: these parents would make the cultivar its own ancestor")
    reg = r["registration_no"]
    if reg:
        m = re.fullmatch(r"(\d+)(?:\.0+)?", reg)
        if not m:
            ot.append(f"registration_no {reg!r} is not a number")
        else:
            owner = base.reg.get(str(int(m.group(1))))
            if owner and owner != (r["existing_id"] if r["action"] == "update" else None) and not (
                    owner in base.find(name) and r["action"] != "update"):
                ot.append(f"registration no. {reg} already belongs to {owner}")
    if r["registered_date"] and not ie.parse_date(r["registered_date"]):
        ot.append(f"registered_date {r['registered_date']!r} not understood (use YYYY-MM-DD)")
    for h in split_list(r["hybridizers"], ";"):
        if ie.norm(h) not in base.person_by_key:
            if not ie.ORG_RE.search(h) and "," not in h and h != "Species":
                ot.append(f"hybridizer {h!r} is new and not in 'Surname, Given' form")
            near = base.person_near(h)
            if near:
                ot.append(f"hybridizer {h!r} is new; similar existing: {'; '.join(near)}")
    files = split_list(r["photo_files"], "|")
    if files:
        if r["photo_permission"].lower() != "yes":
            ot.append("photos listed without photo_permission=yes: photos will not be used")
        creds = split_list(r["photo_credits"], "|")
        if not creds and not r["photo_credits"]:
            ot.append("photos without credit (the submitter name will be used)")
    if not (r["description"] or r["seed_parent"] or r["pollen_parent"] or r["sport_of"] or r["parentage_note"]
            or any(r[f] for f in TEXT_FIELDS)):
        ot.append("entry has no description and no parentage")
    return {"name_match": nm, "parents": pa, "other": ot}
