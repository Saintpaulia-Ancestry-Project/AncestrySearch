"""Build data/masterlist1963.csv by combining two independent OCRs of the 1963 AVSA Master List.

  OCR 2 (primary):     source/AVML1963_import.csv  - re-read from the page images; one row per entry with its
                       name, originator, registered flag, description, section and page.
  OCR 1 (cross-check): the HathiTrust page text, parsed by parse_masterlist1963.py. Its descriptions are
                       often scrambled, truncated or contaminated by a neighbouring entry, so it is used to
                       confirm OCR 2, not as the text itself. It also supplies what OCR 2 does not cover:
                       the "No Description Available" name lists and the names inside the book's series lists.

How a description is decided (column ocr_check):
  verified                  both OCRs have the same words (identical, or only the line order differs)
  reviewed                  a person corrected it in the review file (the source file's own ocr_reviewed
                            flag was set by a Claude session and is NOT treated as a human check)
  ocr1 incomplete           OCR 1 holds only part of OCR 2's words (it truncated the entry)
  ocr1 had neighbour text   OCR 1 has extra words that belong to the adjacent entry; OCR 2 is clean
  unresolved                the OCRs genuinely disagree. The description is WITHHELD until a person has looked
                            at the page image (see the review file); everything else about the entry is kept.

Disagreements about names, originators or the registered flag, entries found in only one OCR, and the
unresolved descriptions go to reports/review/masterlist_ocr_review.csv with a link to the page scan.
Fill in a corrected_* column (or put drop in `use`) and re-run to apply your decisions.

Usage:  .venv\\Scripts\\python scripts\\merge_masterlist1963.py
"""
import collections
import csv
import difflib
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import parse_masterlist1963 as p1  # noqa: E402

NEW = ROOT / "source" / "AVML1963_import.csv"
OUT = ROOT / "data" / "masterlist1963.csv"
REVIEW = ROOT / "reports" / "review" / "masterlist_ocr_review.csv"
REPORT = ROOT / "reports" / "masterlist1963_ocr_merge.md"
SCAN = "https://babel.hathitrust.org/cgi/pt?id=coo.31924019134067&seq={seq}"  # scan sequence = printed page + 2

SECTION = {"Master List": "main", "1960 List": "1960", "1961 List": "1961", "1962 List": "1962"}
COLUMNS = ["entry_id", "section", "printed_page", "name", "name_printed", "originator", "registered", "xref", "note",
           "description", "kind", "ocr_check"]
REVIEW_COLUMNS = ["row_id", "issue", "printed_page", "scan_url", "name_ocr2", "name_ocr1", "originator_ocr2", "originator_ocr1",
                  "registered_ocr2", "registered_ocr1", "description_ocr2", "description_ocr1",
                  "corrected_name", "corrected_originator", "corrected_description", "corrected_registered", "use",
                  "check_status", "notes"]


def norm(s):
    t = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "", t)


def words(s):
    t = unicodedata.normalize("NFKD", str(s)).encode("ascii", "ignore").decode().lower()
    return re.findall(r"[a-z0-9]+", t)


def clean_description(text):
    t = re.sub(r"(^|\s)[_|~*°+]+(?=\s|$)", " ", text)     # stray marks the OCR read as characters
    t = re.sub(r"\s+", " ", t).strip()
    t = re.sub(r"(?<=[A-Za-z0-9)])[.:;,]+$", ".", t)            # "double.:" / "white.." -> one full stop
    t = re.sub(r"^\(?REG\.?\)?\s*[-–—]?\s*", "", t)  # a REG. flag that leaked into the text
    t = re.sub(r"(\w)- (?=[A-Z])", r"\1-", t)                  # "Semi- Supreme" -> "Semi-Supreme"
    return t


def frag(w, pool):
    """w is a piece (3+ letters) of a longer word in pool: a word that was cut across a line break."""
    return len(w) >= 3 and any(x != w and (x.startswith(w) or x.endswith(w)) for x in pool)


def relation(a, b, neighbours):
    """Classify OCR 1's text (a) against OCR 2's (b). neighbours = words of the adjacent OCR 2 entries."""
    # OCR 1 text after a series bullet is a series heading, and a trailing "fo-" is a line-break stub
    a = re.split("[" + chr(0x25cf) + chr(0x2192) + chr(0x2022) + "]", a)[0]
    a = re.sub(r"(^|" + chr(92) + "s)" + chr(92) + "w{1,6}-" + chr(92) + "s*$", " ", a)
    wa, wb = words(a), words(b)
    if not wa:
        return "ocr1 incomplete"
    if sorted(wa) == sorted(wb) or norm(a) == norm(b):
        return "verified"
    ca, cb = collections.Counter(wa), collections.Counter(wb)
    # single letters are debris (the dropped initial of a neighbouring entry), not words; a word that is an
    # OCR typo of an OCR 2 word (Ichid / Orchid) is covered too
    uncovered = [w for w in (ca - cb).elements() if len(w) > 1 and not frag(w, set(wb))
                 and not any(difflib.SequenceMatcher(None, w, x).ratio() >= 0.8 for x in set(wb))]
    if not uncovered:
        return "ocr1 incomplete"                      # OCR 1 holds only pieces of OCR 2's text
    nb = set(neighbours)
    missing = [w for w in (cb - ca).elements() if not frag(w, set(wa))]
    if len(missing) <= 1 and all(w in nb or frag(w, nb) for w in uncovered):
        return "ocr1 had neighbour text"              # the extras belong to the next entry
    if difflib.SequenceMatcher(None, norm(a), norm(b)).ratio() >= 0.93:
        return "verified"                             # a one- or two-character OCR difference
    return "unresolved"


LOOKALIKE = str.maketrans({"I": "l", "i": "l", "1": "l", "|": "l", "L": "l", "0": "o", "O": "o"})


def same_originator(a, b):
    """Equal, or equal once letters the OCR confuses (I, l, 1, i) are treated as the same."""
    return norm(a) == norm(b) or norm(a).translate(LOOKALIKE) == norm(b).translate(LOOKALIKE)


STRAY_TAIL = re.compile("(?<=[.])" + chr(92) + "s+[A-Za-z]{1,2}$")
HEADING_IN_TEXT = re.compile(chr(92) + "([A-Za-z][^)]{2,30}" + chr(92) + ")" + chr(92) + "s*[-" + chr(0x2013) + chr(0x2014) + "+]" + chr(92) + "s")


def load_review():
    out = {}
    if REVIEW.exists():
        with open(REVIEW, newline="", encoding="utf-8-sig") as f:
            for r in csv.DictReader(f):
                out[(r["issue"], r["row_id"])] = r
    return out


def main():
    old = p1.parse_all()
    pagewords = {}
    for n in range(5, 179):  # every word OCR 1 has on each printed page (file number = printed page + 2)
        c = collections.Counter()
        for _, ln in p1.page_lines(n):
            c.update(words(ln))
        pagewords[n - 2] = c
    with open(NEW, newline="", encoding="utf-8-sig") as f:
        new = list(csv.DictReader(f))
    decisions = load_review()

    # ---- pair OCR 2 entries with OCR 1 entries: exact (page, name) first, then close names on the same page
    old_main = [r for r in old if r["section"] != "nodesc" and not r["note"].startswith("from ")]
    old_extra = [r for r in old if r["section"] == "nodesc" or r["note"].startswith("from ")]  # names only
    bucket = collections.defaultdict(list)
    for i, r in enumerate(old_main):
        bucket[(str(r["printed_page"]), norm(r["name_printed"]))].append(i)
    used_old, pair = set(), {}
    for j, r in enumerate(new):
        lst = [i for i in bucket.get((str(int(r["printed_page"])), norm(r["name"])), []) if i not in used_old]
        if lst:
            pair[j] = lst[0]
            used_old.add(lst[0])
    by_page_old = collections.defaultdict(list)
    for i, r in enumerate(old_main):
        if i not in used_old:
            by_page_old[str(r["printed_page"])].append(i)
    fuzzy = {}
    for j, r in enumerate(new):
        if j in pair:
            continue
        best, score = None, 0.0
        for i in by_page_old.get(str(int(r["printed_page"])), []):
            if i in used_old:
                continue
            sc = difflib.SequenceMatcher(None, norm(r["name"]), norm(old_main[i]["name_printed"])).ratio()
            if sc > score:
                best, score = i, sc
        if best is not None and score >= 0.8:
            pair[j] = best
            used_old.add(best)
            fuzzy[j] = old_main[best]["name_printed"]

    # ---- build the final rows
    by_page_new = collections.defaultdict(list)
    for j, r in enumerate(new):
        by_page_new[r["printed_page"]].append(j)
    rows, review = [], []
    stat = collections.Counter()

    def add_review(issue, j=None, i=None, note=""):
        rn, ro = (new[j] if j is not None else None), (old_main[i] if i is not None else None)
        page = (rn["printed_page"] if rn else str(ro["printed_page"]))
        review.append({
            "row_id": f"n{j}" if j is not None else f"o{i}",
            "issue": issue, "printed_page": page, "scan_url": SCAN.format(seq=int(page) + 2),
            "name_ocr2": rn["name"] if rn else "", "name_ocr1": ro["name_printed"] if ro else "",
            "originator_ocr2": rn["hybridiser"] if rn else "", "originator_ocr1": ro["originator"] if ro else "",
            "registered_ocr2": ("1" if rn["registered"] == "Y" else "0") if rn else "",
            "registered_ocr1": str(ro["registered"]) if ro else "",
            "description_ocr2": rn["description"] if rn else "", "description_ocr1": ro["_desc"] if ro else "",
            "corrected_name": "", "corrected_originator": "", "corrected_description": "", "corrected_registered": "", "use": "",
            "check_status": "", "notes": note})

    for j, r in enumerate(new):
        i = pair.get(j)
        o = old_main[i] if i is not None else None
        neighbours = set()
        pg = by_page_new[r["printed_page"]]
        k = pg.index(j)
        for jj in pg:  # every other entry on the page: OCR 1's stray text can come from any of them
            if jj != j:
                neighbours |= set(words(new[jj]["description"])) | set(words(new[jj]["name"]))
        desc = clean_description(r["description"])
        tail = STRAY_TAIL.search(desc)
        if tail:  # a stray mark read as a letter after the last sentence ("single. oO")
            desc = desc[:tail.start()]
            stat["stray tail removed"] += 1
        registered = 1 if r["registered"] == "Y" else 0
        if re.match(r"^\(?REG\.?\)?(\s|$)", r["description"].strip()):
            registered = 1
        # The source file's ocr_reviewed flag was set by a Claude session, not a person, so it earns no shortcut:
        # these rows get the same cross-check as every other entry.
        if o is None:
            check = "ocr2 only"
        else:
            check = relation(o["_desc"], desc, neighbours)
        if check not in ("verified", "reviewed"):
            # a word OCR 1 never saw anywhere on the page, or another entry's heading inside the text, means
            # OCR 2 mis-read this one too: do not publish it without a person checking the image
            seen = pagewords.get(int(r["printed_page"]), {})
            if any(seen.get(w, 0) == 0 for w in set(words(desc))) or HEADING_IN_TEXT.search(desc):
                check = "unresolved"
        name_printed = r["name"].strip().rstrip(".").strip() if r["name"].rstrip().endswith(".") and not r["name"].rstrip().endswith("..") else r["name"].strip()
        name_printed = re.sub(r"\s+", " ", name_printed).strip('" ')
        original = r["hybridiser"].strip()
        row = {"section": SECTION[r["list_section"]], "printed_page": int(r["printed_page"]),
               "name": p1.smart_title(name_printed), "name_printed": name_printed, "originator": original,
               "registered": registered, "xref": r["cross_ref"].strip(), "note": "", "description": desc,
               "kind": r["kind"], "ocr_check": check}
        if re.match(r"(?i)^not\b", original):
            row["note"], row["originator"] = "originator is a negation (not the named firm)", original

        # --- disagreements that need a person
        if o is not None:
            if j in fuzzy:
                add_review("name differs", j, i, f"OCR 2 reads \"{r['name']}\", OCR 1 reads \"{fuzzy[j]}\"")
                stat["name differs"] += 1
            if norm(original) != norm(o["originator"]) and same_originator(original, o["originator"]):
                row["originator"] = o["originator"]  # OCR 2 mis-read a letter (Vlk read as VIk)
                stat["originator spelling settled"] += 1
            elif not same_originator(original, o["originator"]):
                add_review("originator differs", j, i)
                stat["originator differs"] += 1
            if registered != int(o["registered"]):
                add_review("registered flag differs", j, i)
                stat["registered flag differs"] += 1
        if check == "unresolved":
            add_review("description unresolved", j, i)
        elif check == "ocr2 only":
            seen_page = pagewords.get(int(r["printed_page"]), {})
            if all(seen_page.get(w, 0) > 0 for w in words(r["name"])):
                stat["ocr2 only, name found on the OCR 1 page"] += 1
            else:
                add_review("entry only in OCR 2", j, None, "OCR 1 has no matching entry; check the page")
        stat[check] += 1

        # --- apply decisions from the review file (a person's, or an image check by Claude: see check_status)
        for issue in ("name differs", "originator differs", "registered flag differs", "description unresolved",
                      "entry only in OCR 2"):
            d = decisions.get((issue, f"n{j}"))
            if not d:
                continue
            if d["use"].strip().lower() == "drop":
                row = None
                break
            by_person = not d["check_status"].lower().startswith("claude")
            how = "reviewed" if by_person else "image-checked"
            if d["corrected_name"].strip():
                row["name_printed"] = d["corrected_name"].strip()
                row["name"] = p1.smart_title(row["name_printed"])
            if d["corrected_originator"].strip() or (issue == "originator differs" and d["corrected_originator"] == "" and d["check_status"]):
                row["originator"] = d["corrected_originator"].strip()
            if d["corrected_registered"].strip() in ("0", "1"):
                row["registered"] = int(d["corrected_registered"])
            if d["corrected_description"].strip():
                row["description"] = clean_description(d["corrected_description"])
                row["ocr_check"] = how if "please check" not in d["check_status"].lower() else "image-transcribed (please check)"
            elif d["check_status"] and issue == "description unresolved" and row["ocr_check"] == "unresolved":
                pass
        if row is None:
            stat["dropped by review"] += 1
            continue
        if row["ocr_check"] == "unresolved":
            row["description"] = ""        # withheld until a person has checked the page image
        rows.append(row)

    # ---- entries found only in OCR 1 (main/year sections): kept out until confirmed
    for i, r in enumerate(old_main):
        if i not in used_old:
            add_review("entry only in OCR 1", None, i, "OCR 2 has no matching entry; not imported unless you set use = keep")
            stat["entry only in OCR 1"] += 1
            d = decisions.get(("entry only in OCR 1", f"o{i}"))
            if d and d["use"].strip().lower() == "keep":
                nm = d["corrected_name"].strip() or r["name_printed"]
                rows.append({"section": r["section"], "printed_page": r["printed_page"], "name": p1.smart_title(nm),
                             "name_printed": nm,
                             "originator": d["corrected_originator"].strip() if d["corrected_originator"].strip() else r["originator"],
                             "registered": int(d["corrected_registered"]) if d["corrected_registered"].strip() in ("0", "1") else r["registered"],
                             "xref": r["xref"], "note": r["note"], "description": clean_description(d["corrected_description"]),
                             "kind": "entry",
                             "ocr_check": ("series member (name only)" if not d["corrected_description"].strip()
                                           and "please check" in d["check_status"].lower() and "series" in d["notes"].lower()
                                           else "image-transcribed (please check)" if "please check" in d["check_status"].lower()
                                           else ("reviewed" if not d["check_status"].lower().startswith("claude") else "image-checked"))})
    # ---- name lists that OCR 2 does not cover (no descriptions in the book for these)
    for r in old_extra:
        rows.append({"section": r["section"], "printed_page": r["printed_page"], "name": r["name"],
                     "name_printed": r["name_printed"], "originator": r["originator"], "registered": 0,
                     "xref": r["xref"], "note": r["note"], "description": "", "kind": "entry",
                     "ocr_check": "name list (no description in the book)"})
        stat["name list (no description in the book)"] += 1

    rows.sort(key=lambda r: (int(r["printed_page"])))
    for n, r in enumerate(rows, 1):
        r["entry_id"] = f"ML63-{n:05d}"
    with open(OUT, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)
    order = {"description unresolved": 0, "originator differs": 1, "name differs": 2, "registered flag differs": 3,
             "entry only in OCR 2": 4, "entry only in OCR 1": 5}
    review.sort(key=lambda r: (order[r["issue"]], int(r["printed_page"]), r["name_ocr2"] or r["name_ocr1"]))
    # carry earlier decisions forward
    for r in review:
        d = decisions.get((r["issue"], r["row_id"]))
        if d:
            for c in ("corrected_name", "corrected_originator", "corrected_description", "corrected_registered",
                      "use", "check_status", "notes"):
                if d.get(c):
                    r[c] = d[c]
    REVIEW.parent.mkdir(parents=True, exist_ok=True)
    with open(REVIEW, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=REVIEW_COLUMNS, lineterminator="\n")
        w.writeheader()
        w.writerows(review)

    todo = [r for r in review if "please check" in r["check_status"].lower() or not r["check_status"]]
    md = ["# 1963 Master List: rows that still need a person", "",
          "Rows where the page image was read but my transcription matches neither OCR, or that have no decision yet. "
          "Open the scan, then correct the row in reports/review/masterlist_ocr_review.csv (corrected_* columns) "
          "and re-run the merge.", "", "| page | issue | name | what I read | OCR 1 | OCR 2 | scan |", "|---|---|---|---|---|---|---|"]
    for r in sorted(todo, key=lambda r: (int(r["printed_page"]), r["name_ocr2"] or r["name_ocr1"])):
        read = r["corrected_description"] or r["corrected_name"] or r["corrected_originator"] or (
            "registered: " + r["corrected_registered"] if r["corrected_registered"] else "") or "(none)"
        o1 = (r["description_ocr1"] or r["originator_ocr1"] or r["name_ocr1"])[:45]
        o2 = (r["description_ocr2"] or r["originator_ocr2"] or r["name_ocr2"])[:45]
        md.append(f"| {r['printed_page']} | {r['issue']} | {(r['name_ocr2'] or r['name_ocr1'])[:30]} | {read[:55]} | {o1} | {o2} | "
                  f"[page]({r['scan_url']}) |".replace("|  |", "| |"))
    (ROOT / "reports" / "masterlist1963_needs_human.md").write_text(chr(10).join(md), encoding="utf-8")
    n_desc = sum(1 for r in rows if r["description"])
    status = collections.Counter(r["check_status"].split(":")[0] + ":" + r["check_status"].split(":")[-1].strip()[:40]
                                 if r["check_status"] else "(no decision yet)" for r in review)
    final_check = collections.Counter(r["ocr_check"] for r in rows)
    lines = ["# 1963 Master List: merge of the two OCRs", "",
             f"- final entries written to data/masterlist1963.csv: **{len(rows)}** ({n_desc} with a description)",
             f"- OCR 2 entries: {len(new)}; paired with an OCR 1 entry: {len(pair)} "
             f"({len(pair) - len(fuzzy)} by exact name, {len(fuzzy)} by a close name on the same page)", "",
             "## How each entry's text was decided (final state)", "", "| ocr_check | entries |", "|---|---|"]
    lines += [f"| {k} | {v} |" for k, v in final_check.most_common()]
    lines += ["", "Disagreements found while merging (before the review file's corrections):", "",
              "| finding | count |", "|---|---|"]
    lines += [f"| {k} | {v} |" for k, v in stat.most_common()]
    lines += ["", f"Review file: {len(review)} rows in reports/review/masterlist_ocr_review.csv", "",
              "| check_status | rows |", "|---|---|"] + [f"| {k} | {v} |" for k, v in status.most_common()] + [""]
    lines += ["",
              "| issue | rows |", "|---|---|"]
    lines += [f"| {k} | {v} |" for k, v in collections.Counter(r["issue"] for r in review).most_common()]
    REPORT.write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
