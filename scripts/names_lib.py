"""Name, date and people helpers shared by the scripts that stay in the routine pipeline (submissions, checks, master edits).

They used to live in import_excel.py (now a bootstrap tool: notes/freeze-plan.md, phase 2). import_excel.py imports them from here,
so there is one definition. `K(name)` follows the aliases in data/name_aliases.csv (variant spellings that reach the same record).
"""
import csv
import datetime
import re
import unicodedata
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
REPORTS = ROOT / "reports"

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


def parse_date(v, on_bad=None):
    """m/d/yyyy (and a few other forms) -> ISO; "" when empty or unreadable (on_bad(text) is called for unreadable text)"""
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
    if on_bad:
        on_bad(s)
    return ""


# ------------------------------------------------------------------ people
ORG_RE = re.compile(r"nurser|universit|greenhouse|society|college|farm|garden|laborator|institute|\bclub\b|racks|\bbros\b", re.I)
COUNTRIES = {"Germany", "Hungary", "Russia", "Ukraine", "Japan", "Canada", "Australia", "England", "Netherlands",
             "Poland", "Latvia", "Lithuania", "Belarus", "Sweden", "Denmark", "France", "Italy", "New Zealand",
             "Brazil", "Czech Republic", "Finland", "Norway", "Taiwan", "China", "Korea"}


def pkey(p):
    m = re.match(r"^([^,]+),\s*([A-Za-z])", p)
    return (norm(m.group(1)), m.group(2).lower()) if m else (norm(p), "")


# ------------------------------------------------------------------ parents
PLACEHOLDER = re.compile(
    r"^(?:[\s?\-—–.]*|n/?a|none|lost|\(?record lost\)?|unknown.*|\?.*lost.*|\(?unreadable.*|\(?not listed\)?|"
    r"unreadable record|diverse pollent parent|mixed .*seeds?|seeds? from .*|open pollinated)$", re.I)
SELF_RE = re.compile(r"\s*\(?\bx\s+self\)?\s*$", re.I)


def stub_kind(name):
    if re.match(r"^(S\.|Saintpaulia)\s", name):
        return "species"
    if re.search(r"seedling", name, re.I) or re.search(r"\sx\s", name, re.I) or name.startswith("["):
        return "seedling"
    return "stub"


# ------------------------------------------------------------------ aliases
ALIAS_FILE = DATA / "name_aliases.csv"
_ALIASES = None


def aliases():
    """{normalised variant: normalised canonical name} from data/name_aliases.csv (alias_key, canonical_key)"""
    global _ALIASES
    if _ALIASES is None:
        _ALIASES = {}
        if ALIAS_FILE.exists():
            with open(ALIAS_FILE, newline="", encoding="utf-8-sig") as f:
                for r in csv.DictReader(f):
                    _ALIASES[r["alias_key"]] = r["canonical_key"]
    return _ALIASES


def K(name):
    """the key a name resolves to: normalised, then variant spellings followed to their canonical spelling"""
    al = aliases()
    n = norm(name)
    for _ in range(5):
        m = al.get(n)
        if m is None or m == n:
            break
        n = m
    return n
