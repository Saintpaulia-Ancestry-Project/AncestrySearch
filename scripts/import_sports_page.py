"""Restore descriptions from the saved AVSA "African Violet Sports" page.

Reads source/African Violet Sports - African Violet Society of America.html (a two-column table: original cultivar |
sport, each cell "Name (reg) date (hybridizer) description"), matches every cell to a cultivar in data/cultivars.csv
and writes:
  data/sports_page.csv                       id, description, bloom_description, foliage_description, size_class
                                             (build_db.py applies it: description is set from the page; the three
                                             split fields only where the page text disagrees with them: PAGE WINS)
  reports/review/sports_page_conflicts.csv   log of every difference for later review (page value already applied)
  reports/sports_page_summary.md             counts

Never matches by guessing: registration number + exact normalised name only; the rest is logged as unmatched.
Run after import_excel.py, before build_db.py.  Needs only the standard library.
"""
import collections
import csv
import html
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "source" / "African Violet Sports - African Violet Society of America.html"
DATA = ROOT / "data"
OUT_CSV = DATA / "sports_page.csv"
LOG_CSV = ROOT / "reports" / "review" / "sports_page_conflicts.csv"
SUMMARY = ROOT / "reports" / "sports_page_summary.md"


def key(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def cmp_key(s):  # ignores case, spaces and punctuation
    return re.sub(r"[\W_]+", "", (s or "").lower())


def clean(s):
    return html.unescape(re.sub(r"\s+", " ", s.replace("\xa0", " "))).strip()


CELL_RE = re.compile(r"^(?:\((\d+)\)\s*)?(?:(\d\d/\d\d/\d{4})\s*)?(?:\(([^)]*)\)\s*)?(.*)$", re.S)


def parse_cell(td, known):
    """-> dict(name, reg, date, hybridizer, desc) or None. `known` = set of key(name) of all cultivars."""
    m = re.search(r"<strong>(.*?)</strong>([^\W\d_]*)", td, re.S)  # letters glued to </strong> belong to the name
    strong = clean(re.sub(r"<[^>]+>", "", m.group(1)) + m.group(2)) if m else ""
    text = clean(re.sub(r"<[^>]+>", "", td))
    if not text:
        return None
    if strong and text.startswith(strong) and (key(strong) in known or text[len(strong):].lstrip().startswith("(")):
        name, rest = strong, text[len(strong):].strip()
    else:  # no <strong>: longest leading word run that is a known cultivar name
        words = text.split(" ")
        name, rest = None, ""
        for n in range(min(8, len(words)), 0, -1):
            if key(" ".join(words[:n])) in known:
                name, rest = " ".join(words[:n]), " ".join(words[n:])
                break
        if name is None:
            i = text.find(" (")
            name, rest = (text[:i], text[i + 1:]) if i > 0 else (text, "")
    reg, date, hyb, desc = CELL_RE.match(rest).groups()
    return {"name": name.strip(), "strong": strong, "reg": reg or "", "date": date or "", "hybridizer": hyb or "", "desc": desc.strip()}


def read_page(known):
    t = SRC.read_text(encoding="utf-8")
    pairs = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", t, re.S):
        tds = re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)
        if len(tds) != 2 or "CULTIVAR FROM WHICH" in tds[0]:
            continue
        a, b = parse_cell(tds[0], known), parse_cell(tds[1], known)
        if a and b:
            pairs.append((a, b))
    return pairs


def read(path):
    with open(path, newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


TAG_RE = re.compile(r"\s*\(([^()]*)\)\s*$")  # trailing origin tag such as (Russ/Ukr)


def split_page_desc(desc, sizes):
    """'Bloom. Foliage. Size (tag)' -> (bloom, foliage, size, tag)"""
    tag = ""
    m = TAG_RE.search(desc)
    if m:
        tag, desc = m.group(1), desc[:m.start()]
    desc = desc.strip()
    size = ""
    for s in sorted(sizes, key=len, reverse=True):
        if re.search(r"(^|[\s.])" + re.escape(s) + r"\.?$", desc, re.I):
            size = s
            desc = re.sub(r"[\s.]*" + re.escape(s) + r"\.?$", "", desc, flags=re.I).strip()
            break
    parts = [p.strip() for p in re.split(r"\.\s+", desc.rstrip(".")) if p.strip()]
    bloom = parts[0] if parts else ""
    foliage = ". ".join(parts[1:])
    return bloom, foliage, size, tag


def main():
    if not SRC.exists():
        sys.exit(f"Missing {SRC}")
    cultivars = read(DATA / "cultivars.csv")
    splits = {r["id"]: r for r in read(DATA / "description_split.csv")} if (DATA / "description_split.csv").exists() else {}
    sizes = sorted({c["size_class"] for c in cultivars if c["size_class"]})
    by_key = collections.defaultdict(list)
    for c in cultivars:
        by_key[key(c["name"])].append(c)

    def eff(c, f):  # value as build_db.py will see it (split file only fills empty fields)
        v = (c.get(f) or "").strip()
        if not v and f in ("color", "bloom_description", "foliage_description") and c["id"] in splits:
            v = (splits[c["id"]].get(f) or "").strip()
        return v

    pairs = read_page(set(by_key))
    log = []
    out = {}
    stats = collections.Counter()
    seen_text = {}

    def add_log(kind, cell, c, field, page_v, db_v, note=""):
        log.append({"kind": kind, "id": c["id"] if c else "", "name": cell["name"], "reg_no": cell["reg"],
                    "field": field, "page_value": page_v, "database_value_before": db_v, "note": note,
                    "decision": ""})

    for pair in pairs:
        for side, cell in zip(("original", "sport"), pair):
            stats[side + "_cells"] += 1
            cands = by_key.get(key(cell["name"]), [])
            if side == "sport":
                cands = [c for c in cands if c["sport_of_id"]] or cands
            if cell["reg"]:
                allc = cands
                cands = [c for c in cands if (c["registration_no"] or "") == cell["reg"]] or \
                    [c for c in cands if not c["registration_no"]]
                if not cands and len(allc) == 1:  # one record by this exact name: keep it; the number is logged
                    cands = allc
            if len(cands) > 1 and cell["hybridizer"]:  # same name, several records: the hybridizer decides
                sur = {key(h.split(",")[0].split(".")[-1].split()[-1]) for h in re.split(r"[/;]", cell["hybridizer"]) if h.strip()}
                hy = [c for c in cands if any(s and s in key(c["hybridizer_raw"]) for s in sur)]
                cands = hy or cands
            if len(cands) > 1:  # then: the one whose recorded description already matches the page text
                pj = cmp_key(re.sub(r"\s*\([^()]*\)\s*$", "", cell["desc"]))
                same = [c for c in cands if pj and pj == cmp_key(" ".join(
                    eff(c, f) for f in ("bloom_description", "foliage_description", "size_class") if eff(c, f)))]
                cands = same or cands
            matched_by_reg = False
            if cell["reg"] and not any(key(c["name"]) == key(cell["name"]) for c in cands) and                     not any((c["registration_no"] or "") == cell["reg"] for c in cands):
                # the name candidates do not carry this registration number: the number is exact, so use it
                hits = [c for c in cultivars if (c["registration_no"] or "") == cell["reg"]]
                if len(hits) == 1:
                    cands, matched_by_reg = hits, True
            if len(cands) != 1:
                stats["unmatched" if not cands else "ambiguous"] += 1
                add_log("unmatched" if not cands else "ambiguous", cell, None, "", cell["desc"], "",
                        f"{side}; {len(cands)} candidate records")
                continue
            c = cands[0]
            if matched_by_reg:
                add_log("matched_by_registration", cell, c, "name", cell["name"], c["name"],
                        "page name differs from our record; matched on the registration number")
            if cell["strong"] and key(cell["strong"]) != key(cell["name"]) and not matched_by_reg:
                add_log("page_name_trimmed", cell, c, "name", cell["strong"], c["name"],
                        "bold name on the page is longer than the name matched; check the match")
            if not cell["desc"]:
                stats["page_no_description"] += 1
                continue
            if c["id"] in seen_text:  # same cultivar listed again (an original with several sports)
                if cmp_key(seen_text[c["id"]]) != cmp_key(cell["desc"]):
                    add_log("page_repeat_differs", cell, c, "description", cell["desc"], seen_text[c["id"]],
                            "same cultivar listed twice on the page with different text; first listing used")
                continue
            seen_text[c["id"]] = cell["desc"]
            bloom, foliage, size, tag = split_page_desc(cell["desc"], sizes)
            row = {"id": c["id"], "description": cell["desc"], "bloom_description": "", "foliage_description": "",
                   "size_class": ""}
            if (c["description"] or "").strip() and cmp_key(c["description"]) != cmp_key(cell["desc"]):
                add_log("description_replaced", cell, c, "description", cell["desc"], c["description"])
            page_pieces = {"bloom_description": bloom, "foliage_description": foliage, "size_class": size}
            db_join = " ".join(eff(c, f) for f in ("bloom_description", "foliage_description", "size_class") if eff(c, f))
            page_join = " ".join(v for v in (bloom, foliage, size) if v)
            if cmp_key(db_join) == cmp_key(page_join):
                stats["same_as_database"] += 1
            elif not size and cmp_key(" ".join(eff(c, f) for f in ("bloom_description", "foliage_description"))) == \
                    cmp_key(" ".join([bloom, foliage])):
                stats["page_silent_on_size"] += 1
                add_log("page_silent", cell, c, "size_class", "", eff(c, "size_class"),
                        "page gives no size; database value kept")
            else:
                stats["conflicts"] += 1
                for f, v in page_pieces.items():
                    cur = eff(c, f)
                    if v and cmp_key(v) != cmp_key(cur):
                        row[f] = v
                        add_log("page_wins", cell, c, f, v, cur)
                    elif not v and cur and f != "size_class":
                        add_log("page_lacks_part", cell, c, f, "", cur,
                                "page has no such part; database value kept (page text in description)")
            if tag:
                stats["origin_tag"] += 1
            # informational: registration number and date
            if cell["reg"] and (c["registration_no"] or "") != cell["reg"]:
                add_log("registration_differs", cell, c, "registration_no", cell["reg"], c["registration_no"], "info only; not applied")
            if cell["date"] and c["registered_date"]:
                m = re.match(r"(\d\d)/(\d\d)/(\d{4})", cell["date"])
                iso = f"{m.group(3)}-{m.group(1)}-{m.group(2)}"
                if iso != c["registered_date"]:
                    add_log("date_differs", cell, c, "registered_date", iso, c["registered_date"], "info only; not applied")
            out[c["id"]] = row

    # hand-set splits (reports/review/sports_page_splits.csv): where the automatic Bloom. Foliage. Size split of a page
    # text is wrong, the reviewer gives the three pieces; they replace the automatic ones for that cultivar.
    sp_path = ROOT / "reports" / "review" / "sports_page_splits.csv"
    if sp_path.exists():
        for r in read(sp_path):
            if r["id"] in out:
                for f in ("bloom_description", "foliage_description", "size_class"):
                    out[r["id"]][f] = r[f]
                if (r.get("description") or "").strip():  # e.g. the AVSA First Class text
                    out[r["id"]]["description"] = r["description"].strip()

    with open(OUT_CSV, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["id", "description", "bloom_description", "foliage_description", "size_class"])
        w.writeheader()
        w.writerows(sorted(out.values(), key=lambda r: r["id"]))
    LOG_CSV.parent.mkdir(parents=True, exist_ok=True)
    if LOG_CSV.exists():  # keep the reviewer's decisions across re-runs
        old = {(r["kind"], r["name"], r["field"]): r["decision"] for r in read(LOG_CSV) if r.get("decision")}
        for r in log:
            r["decision"] = old.get((r["kind"], r["name"], r["field"]), "")
    with open(LOG_CSV, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=["kind", "id", "name", "reg_no", "field", "page_value",
                                          "database_value_before", "note", "decision"])
        w.writeheader()
        w.writerows(log)
    kinds = collections.Counter(r["kind"] for r in log)
    lines = ["# Sports page import", "",
             f"- table rows: {len(pairs)}; cells: {stats['original_cells']} original + {stats['sport_cells']} sport",
             f"- cultivars given a description from the page: {len(out)}",
             f"- split fields identical to the page text: {stats['same_as_database']}",
             f"- conflicts (page applied): {stats['conflicts']}",
             f"- page silent on size (database kept): {stats['page_silent_on_size']}",
             f"- unmatched / ambiguous cells: {stats['unmatched']} / {stats['ambiguous']}",
             f"- descriptions carrying an origin tag such as (Russ/Ukr): {stats['origin_tag']}", "",
             "## Log entries by kind (reports/review/sports_page_conflicts.csv)", ""]
    lines += [f"- {k}: {n}" for k, n in sorted(kinds.items())]
    SUMMARY.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
