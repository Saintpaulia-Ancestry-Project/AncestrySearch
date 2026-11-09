"""Parse the OCR text of the AVSA "Master List of African Violets" (1935 to 1963) into data/masterlist1963.csv.

Input:  source/AV-MasterLIstSupplements/MasterListBook/*.txt  (OCR page text; raw, not tracked in git)
Output: data/masterlist1963.csv         one row per listed name
        reports/masterlist1963_report.md   counts, samples and everything that was skipped

What is taken from the book: the name, the originator in parentheses, the registered flag ("REG."),
the section it is listed in (the main A-Z list, the 1960, 1961 and 1962 sections, or the "No
Description Available" lists) and the printed page. DESCRIPTIONS ARE NOT IMPORTED: about one in ten
is scrambled by the OCR's column handling, so they wait for a better OCR. Cross-references such as
"See Parker's Calcutta." are kept in the xref column.

Usage:  .venv\\Scripts\\python scripts\\parse_masterlist1963.py
"""
import collections
import csv
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BOOK = ROOT / "source" / "AV-MasterLIstSupplements" / "MasterListBook"
OUT = ROOT / "data" / "masterlist1963.csv"
REPORT = ROOT / "reports" / "masterlist1963_report.md"

# (section, first file, last file). Printed page number = file number - 2.
SECTIONS = [("main", 5, 131), ("1960", 132, 144), ("1961", 145, 161), ("1962", 162, 175), ("nodesc", 176, 178)]
HEADER_WORDS = {"THE", "MASTER", "LIST", "OF", "AFRICAN", "VIOLETS", "VIOLET"}
DASH = "⟂"  # marker kept for a stray dash line
COLUMNS = ["entry_id", "section", "printed_page", "name", "name_printed", "originator", "registered", "xref", "note"]

skipped = []  # (kind, page, text)


def page_lines(n):
    txt = (BOOK / f"{n:08d}.txt").read_text(encoding="utf-8", errors="replace")
    out = []
    for ln in txt.splitlines():
        s = ln.strip()
        if not s:
            continue
        if re.fullmatch(r"\d{1,3}", s):  # printed page number
            continue
        if s in ("The Master List of African Violets", "NAMES AND DESCRIPTIONS COMPILED FROM ALL", "AVAILABLE SOURCES"):
            continue
        words = re.findall(r"[A-Za-z]+", s)
        if words and all(w.upper() in HEADER_WORDS for w in words) and s.upper() == s:  # running page header
            continue
        if re.fullmatch(r"[\-–—―·•\.\s_~=]*", s):  # OCR artefacts
            if "-" in s or "―" in s:
                out.append((n, DASH))
            continue
        s = re.sub(r"\s*[·•]\s*", " ", s).strip()  # stray dots between words
        out.append((n, s))
    return out


def join_list(lines):
    """Join lines of a name list. A line-end hyphen is a word wrap when the next line starts in lower
    case (Sun-/rise); before a capital it is part of the name (Bi-/Tone)."""
    out = ""
    for ln in lines:
        if ln == DASH:
            continue
        if out.endswith("-") and out[-2:-1].isalpha():
            out = (out[:-1] + ln) if ln[:1].islower() else (out + ln)
        else:
            out = (out + " " + ln) if out else ln
    return out.strip()


def vocabulary(all_lines):
    c = collections.Counter()
    for _, ln in all_lines:
        for w in re.findall(r"[a-z]+", ln):
            c[w] += 1
    return c


def join(lines, vocab):
    """Join wrapped lines; remove a line-end hyphen only when the joined word occurs elsewhere in the book."""
    out = ""
    for ln in lines:
        if ln == DASH:
            continue
        if out.endswith("-") and out[-2:-1].isalpha():
            left = re.search(r"([A-Za-z]+)-$", out)
            right = re.match(r"[A-Za-z]+", ln)
            if left and right and vocab.get((left.group(1) + right.group(0)).lower(), 0) >= 2:
                out = out[:-1] + ln
            else:
                out += ln
            continue
        out = (out + " " + ln) if out else ln
    return out.strip()


# A name is a run of capitals, digits and punctuation. "#" (BLUE #2), and a possessive written 's after
# a capital or digit (GAY 90's) are allowed.
NAME_CHAR = r"(?:[A-Z0-9#&.!\-/ ]|['’][Ss]?(?![a-z]))"
ENTRY_START = re.compile(r"^([A-Z]" + NAME_CHAR + r"*(?:[A-Z0-9.#]|['’][Ss]?))(?=\s|$|\(|,)")


def is_entry_start(line):
    if line == DASH or re.match(r"^REG\b", line):  # "REG." starting a line continues the previous entry
        return False
    m = ENTRY_START.match(line)
    return bool(m and len(re.sub(r"[^A-Za-z]", "", m.group(1))) >= 2)


HEAD = re.compile(
    r"^([A-Z0-9]" + NAME_CHAR + r"*?)(?=\s*\(|,\s|\s+REG\.?(?:\s|$)|\s+-(?:\s|(?=[A-Za-z]))|\s+[A-Z]?[a-z]|\s*$)")

SMALL = {"of", "the", "and", "a", "an", "in", "on", "to", "for", "with", "at", "by", "de", "la", "le", "du", "von", "van"}


def smart_title(name):
    words = name.split(" ")
    out = []
    for i, w in enumerate(words):
        if re.fullmatch(r"[IVX]+\.?", w) or re.fullmatch(r"[A-Z]\.", w) or re.fullmatch(r"[A-Z]&[A-Z]", w):
            out.append(w)
            continue
        if i > 0 and w.lower() in SMALL:
            out.append(w.lower())
            continue
        parts = re.split(r"([\-/])", w)
        fixed = []
        for p in parts:
            if p in ("-", "/") or not p:
                fixed.append(p)
                continue
            p = p.lower()
            if p[:1] in ("'", "’") and len(p) > 1:  # a word opening with an apostrophe: 'Onna
                p = p[0] + p[1].upper() + p[2:]
            else:
                p = p[:1].upper() + p[1:]
            p = re.sub(r"^(Mc)([a-z])", lambda m: m.group(1) + m.group(2).upper(), p)
            p = re.sub(r"^(O['’])([a-z])", lambda m: m.group(1) + m.group(2).upper(), p)
            fixed.append(p)
        out.append("".join(fixed))
    return " ".join(out)


def parse_head(text):
    m = HEAD.match(text)
    if not m:
        return None
    name = m.group(1).strip(" -.")
    rest = text[m.end():].strip()
    originator = ""
    hm = re.match(r"^\(([^)]*)\)\s*", rest)
    if hm:
        originator, rest = re.sub(r"\s+", " ", hm.group(1)).strip(), rest[hm.end():]
    reg = 0
    rm = re.match(r"^\(?REG\.?\)?(?=\s|$|-)", rest)
    if rm:
        reg, rest = 1, rest[rm.end():].strip()
    rest = re.sub(r"^[,\-–—]\s*", "", rest).strip()
    return name, originator, reg, rest


def parse_main(section, files, vocab):
    lines = []
    for n in files:
        lines += page_lines(n)
    entries, cur = [], None
    for page, ln in lines:
        if is_entry_start(ln):
            cur = {"page": page, "lines": [ln]}
            entries.append(cur)
        elif cur is not None:
            cur["lines"].append(ln)
    rows = []
    for e in entries:
        text = join(e["lines"], vocab)
        series = re.match(r"^([A-Z0-9'’ .&\-]+? SERIES)\b", text)
        ph = parse_head(text)
        rest = ph[3] if ph else ""
        if ph and ph[0] == "END OF SERIES":
            skipped.append(("end-of-series marker", e["page"] - 2, text[:90]))
            continue
        listing = text.split(":", 1)[1] if series and ":" in text else (text if ph and rest.count(",") >= 5 and not re.search(
            r"\b(leaves|foliage|single|double)\b", rest[:60], re.I) else None)
        if series or (listing is not None and not series):
            # a series heading or a continuation of a series list: the listed names are real cultivars
            who = smart_title(series.group(1)) if series else "a series list"
            members = 0
            for item in split_outside_parens(listing or ""):
                im = re.match(r"^(.*?)(?:\s*\(([^)]*)\))?$", item)
                # cut at a sentence end (a word of 3+ letters, then ". Capital"), not at initials like "C. P."
                nm = re.split(r"(?<=[a-z]{2})\.\s+(?=[A-Z])", re.sub(r"\s+", " ", im.group(1)).strip())[0].strip(" .")
                if not nm or not (nm[0].isupper() or nm[0].isdigit()) or len(nm) > 45 or re.search(r"\b(prefix|because|listed|following|plants)\b", nm, re.I):
                    continue
                members += 1
                rows.append({"section": section, "printed_page": e["page"] - 2, "name": nm, "name_printed": nm,
                             "originator": (im.group(2) or "").strip(), "registered": 0, "xref": "",
                             "note": f"from {who}"})
            kind = "series list (names extracted)" if members else "series heading (no names)"
            skipped.append((kind, e["page"] - 2, f"{who}: {members} names" if members else text[:90]))
            continue
        if not ph:
            skipped.append(("unparsed", e["page"] - 2, text[:90]))
            continue
        name, originator, reg, rest = ph
        xref = rest if re.match(r"^(See|Same as|Probably|Syn\.?|Renamed|Now)\b", rest) and len(rest) < 100 else ""
        note = "originator is a negation (not the named firm)" if re.match(r"(?i)^not\b", originator) else ""
        rows.append({"section": section, "printed_page": e["page"] - 2, "name": smart_title(name), "name_printed": name,
                     "originator": originator, "registered": reg, "xref": xref, "note": note})
    return rows


def split_outside_parens(s):
    items, depth, cur = [], 0, ""
    for ch in s:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth = max(0, depth - 1)
        if ch == "," and depth == 0:
            items.append(cur.strip())
            cur = ""
        else:
            cur += ch
    if cur.strip():
        items.append(cur.strip())
    return items


def parse_nodesc(files, vocab):
    lines = []
    for n in files:
        lines += page_lines(n)
    # drop the introduction (up to "...in the 1963 Supplement.")
    start = next(i for i, (_, ln) in enumerate(lines) if ln.startswith("A Abbey") or re.match(r"^A [A-Z][a-z]", ln))
    lines = lines[start:]
    blocks, cur = [], []
    for page, ln in lines:
        if ln == DASH:
            if cur:
                blocks.append(cur)
            cur = []
        else:
            cur.append((page, ln))
    if cur:
        blocks.append(cur)
    rows = []
    prev_letter = "A"
    for blk in blocks:
        page = blk[0][0]
        text = join_list([ln for _, ln in blk])
        m = re.match(r"^([A-Z]) (?=[A-Z])", text)
        if m and m.group(1) >= prev_letter:  # the letter heading of the block, e.g. "B Ballet Queen, ..."
            prev_letter = m.group(1)
            text = text[m.end():]
        text = text.rstrip(". ").strip()
        for item in split_outside_parens(text):
            im = re.match(r"^(.*?)(?:\s*\(([^)]*)\))?\.?$", item)
            name = re.sub(r"\s+", " ", im.group(1)).strip(" .")
            if not name:
                continue
            rows.append({"section": "nodesc", "printed_page": page - 2, "name": name, "name_printed": name,
                         "originator": (im.group(2) or "").strip(), "registered": 0, "xref": "", "note": ""})
    return rows


def main():
    all_lines = []
    for _, a, b in SECTIONS:
        for n in range(a, b + 1):
            all_lines += page_lines(n)
    vocab = vocabulary(all_lines)
    rows = []
    for section, a, b in SECTIONS:
        files = range(a, b + 1)
        rows += parse_nodesc(files, vocab) if section == "nodesc" else parse_main(section, files, vocab)
    for i, r in enumerate(rows, 1):
        r["entry_id"] = f"ML63-{i:05d}"
    OUT.parent.mkdir(exist_ok=True)
    with open(OUT, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=COLUMNS, lineterminator="\n")
        w.writeheader()
        w.writerows(rows)

    # ------------------------------------------------------------ report
    by_sec = collections.Counter(r["section"] for r in rows)
    keys = collections.Counter((r["name"].lower(), r["originator"].lower()) for r in rows)
    lines = ["# 1963 Master List: parse report", "",
             f"{len(rows)} names written to data/masterlist1963.csv.", "",
             "| section | names |", "|---|---|"] + [f"| {s} | {by_sec[s]} |" for s, _, _ in SECTIONS]
    lines += ["", f"- with an originator: {sum(1 for r in rows if r['originator'])}",
              f"- flagged registered (REG.): {sum(r['registered'] for r in rows)}",
              f"- cross-references kept in xref: {sum(1 for r in rows if r['xref'])}",
              f"- distinct name + originator: {len(keys)}; repeated name + originator: {sum(1 for v in keys.values() if v > 1)}",
              "", "## Skipped", ""]
    for kind, n in collections.Counter(k for k, _, _ in skipped).most_common():
        lines.append(f"- {kind}: {n}")
    lines += ["", "| kind | printed page | text |", "|---|---|---|"] + [f"| {k} | {p} | {t.replace('|', '/')} |" for k, p, t in skipped]
    REPORT.write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines[:14]))


if __name__ == "__main__":
    main()
