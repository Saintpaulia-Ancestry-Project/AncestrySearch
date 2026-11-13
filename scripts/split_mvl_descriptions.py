"""Split the MVL-supplement descriptions into color / bloom_description / foliage_description.

Input : data/mvl_supplements.csv (scripts/prep_mvl_supplements.py)
Output: data/mvl_description_split.csv   plant_key, color, bloom_description, foliage_description, split_status
        reports/review/mvl_split_review.csv   the rows needing a human (status `needs review`), with the proposal
Plants whose description was decoded from the printed AVSA registration code (desc_source = code; 1969-1985 lists, see
notes/mvl-supplements-recent-plan.md) are NOT split by sentence: color / bloom / foliage are built from the code columns
(code_color, code_flower, code_leaf) in short plain English (status `code`, no review needed). Where a plant has a written
description AND a code, the prose wins and the code only fills a part the prose split left empty (status `ok+code`).
Rules (rule-based, no guessing):
  * `description` itself is never changed; the three parts are cut out of it, except that a trailing size word
    (Standard, Large, ...) is dropped from the parts (it is the size class) and a "(no mention of foliage)" remark too.
  * Each sentence is classified as foliage or bloom from word cues. A sentence with strong cues for both, or with no
    usable cue, makes the whole description `needs review` (those are held back from the live site until reviewed).
  * Statuses: ok | bloom only | foliage only | needs review | species (not split) | human (from the review file).
  * Review file (re-runnable): fill corrected_color / corrected_bloom / corrected_foliage (any may stay empty = no part),
    or decision `use` to accept the proposal as is; the row then gets status `human` and is released.
    Claude's reviewed proposals sit in claude_color / claude_bloom / claude_foliage (decision `proposed_correction`, still held);
    set decision `accept` to release a row with those values; `delete` = never import this plant (status `deleted`).
Usage: .venv\\Scripts\\python scripts\\split_mvl_descriptions.py
"""
import csv
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
REVIEW = ROOT / "reports" / "review" / "mvl_split_review.csv"

SIZE_WORDS = r"(?:small standard|semi-?miniature|miniature|standard|large|trailer|trailing)(?:\s+(?:trailer|trailing|standard|miniature))?"
SIZE_TAIL = re.compile(r"(?i)(?:^|[.;,]\s*|\s)(" + SIZE_WORDS + r")\s*\.?\s*$")
NO_FOLIAGE = re.compile(r"(?i)\s*\((?:no|not)\s+(?:mention|description)[^)]*\)\.?")

STRONG_F = re.compile(r"(?i)\b(foliage|foilage|leaf|leaves|leaved|longifolia|variegated|variegation|reverse|red backs?|red backed)\b")
CORE_F = re.compile(r"(?i)\b(quilted|serrated|tailored|pointed|glossy|scalloped|spooned|girl|boy|heart-shaped|ovate|pebbled)\b")
STRONG_B = re.compile(r"(?i)\b(blossoms?|blooms?|bloomer|flowers?|flowered|petals?|singles?|doubles?|semi-?doubles?|stars?|pansy|"
                      r"pansies|fantasy|chimera|sticktite|stick-tite|corolla|stripes?|striped|blossomed)\b")
WEAK_F = re.compile(r"(?i)\b(quilted|serrated|tailored|plain|pointed|girl|boy|glossy|spooned|scalloped|hairy|heart-shaped|ovate|"
                    r"pebbled|crinkled|rippled|wavy|bustle|mosaic|supreme|thick|fleshy|bronze|green|round|waxy|dentate|"
                    r"crenate|plush|plushy|lanceolate|notched|curled|cupped|veined|bumpy|crested)\b")
WEAK_B = re.compile(r"(?i)\b(fringed|frilled|ruffled|edge|edged|eye|center|centre|two-?tone|bicolor|bi-color|shaded|splashed|"
                    r"markings?|rays?|sport|blushed|picotee|overlay|streaked|speckled|dotted|ruffle)\b")

COLORS = ("white pink blue red purple lavender orchid violet lilac fuchsia wine rose magenta plum mauve cerise coral peach "
          "salmon burgundy maroon amethyst wisteria heliotrope raspberry cranberry cherry garnet orange yellow cream ivory "
          "black brown lemon chartreuse periwinkle navy cobalt sky royal cerulean grape strawberry apricot tan gold "
          "pastel slate silver gray grey rust bronze copper amber wedgwood").split()
COLOR_RE = re.compile(r"(?i)^(?:(?:" + "|".join(COLORS) + r")(?:ish)?|redviolet|bluish|pinkish|purplish|whitish|reddish)$")
COLOR_MOD = {"light", "dark", "deep", "pale", "medium", "bright", "soft", "hot", "pastel", "rich", "vivid", "true", "clear",
             "intense", "electric", "lightest", "darkest", "very", "pure", "dusty", "warm", "cool", "baby"}
FORM = {"single", "singles", "double", "doubles", "semidouble", "semi-double", "full", "huge", "large", "giant", "ruffled",
        "fringed", "frilled", "wavy", "heavily", "heavy", "big", "small", "tiny", "extra", "very", "many", "and", "to", "or",
        "semi", "variable", "medium", "light", "dark", "deep", "pale", "bright", "soft", "hot", "rich", "pastel", "a", "an",
        "the", "with", "of", "fluted", "round", "star", "flat", "crisp", "lightly", "slightly", "bold"}


SIZE_REMARK = re.compile(r"(?i)^(?:(?:very|medium|small|large|standard|miniature|micro-?miniature|semi-?miniature|big|tiny)[\s-]*)+"
                         r"(?:(?:size|sized|grower|growing|plant|trailer|trailing|growth|habit)[\s-]*)*[.]?$")
DESC_WORDS = (set(FORM) | COLOR_MOD | set(COLORS) | {"plain", "quilted", "serrated", "tailored", "pointed", "girl", "boy", "glossy",
              "variegated", "scalloped", "thick", "shiny", "hairy", "dark", "red", "green"})
DESC_RE = re.compile(r"(?:" + "|".join(sorted(DESC_WORDS, key=len, reverse=True)) + r")$")


GROWS = re.compile(r"(?i)^(?:grows?|growing|regular|average|normal|a)\s+(?:\w+\s+){0,2}(?:size|sized|large|small|standard|miniature|grower|plant)\W*$")


SIZE_VOCAB = {"very", "medium", "small", "large", "standard", "miniature", "micro", "microminiature", "semiminiature", "semi",
              "big", "tiny", "to", "and", "or", "size", "sized", "grower", "growing", "grows", "plant", "trailer", "trailing",
              "growth", "habit", "compact", "regular", "average", "normal", "a", "is", "plants", "type", "sized", "variety"}


def size_only(sent):
    words = re.findall(r"[a-z]+", sent.lower().replace("-", ""))
    return bool(words) and all(w in SIZE_VOCAB for w in words)


def split_sentences(t):
    t = re.sub(r"\b(Mrs|Mr|Dr|St|vs|approx|var|sp|ca)\.\s", lambda m: m.group(1) + "\u0001 ", t)
    parts = re.split(r"(?<=[.!?])\s+(?=[A-Z(“\"'])", t)
    out = []
    for p in parts:
        # OCR style "Double deep red, Plain, pointed foliage": a capital after a comma that starts a descriptor
        pieces = re.split(r",\s+(?=[A-Z][a-z-]*\b)", p)
        cur = pieces[0]
        for nxt in pieces[1:]:
            w = re.match(r"[A-Za-z-]+", nxt).group(0).lower()
            if DESC_RE.match(w):
                out.append(cur + ".")
                cur = nxt
            else:
                cur += ", " + nxt
        out.append(cur)
    return [p.replace("\u0001", ".").strip() for p in out if p.strip()]


FOL_TAIL = re.compile(r"^(.*?)(?:[,;]|\s+(?:on|with|and|over))\s+((?:[\w'-]+\s+){0,6}?(?:foliage|leaves|leaf|variegation))\W*$", re.I)
FOL_HEAD = re.compile(r"^((?:[\w'-]+\s+){0,6}?(?:foliage|leaves|leaf))\s*[,;]?\s+(.+)$", re.I)


def split_mixed(s):
    """'Deep pink stars on plain quilted foliage' -> (bloom part, foliage part); None when it is not that simple"""
    m = FOL_TAIL.match(s)
    if m and classify(m.group(1)) == "B":
        return m.group(1).strip(" ,;") + ".", m.group(2).strip().capitalize() + "."
    m = FOL_HEAD.match(s)
    if m and classify(m.group(2)) == "B" and not STRONG_F.search(m.group(2)):
        return m.group(2).strip(), m.group(1).strip().capitalize() + "."
    # "Dark orchid two-tone single, quilted": trailing comma clauses made only of leaf words
    clauses = [c.strip() for c in re.split(r"\s*[,;]\s*", s.strip(" .")) if c.strip()]
    for k in range(1, len(clauses)):
        tail = clauses[k:]
        if all(pure_foliage(c) for c in tail) and not any(pure_foliage(c) or classify(c) == "F" for c in clauses[:k]):
            head = ", ".join(clauses[:k])
            if classify(head) == "B":
                return head + ".", (", ".join(tail)).capitalize() + "."
    return None


def pure_foliage(c):
    return bool((CORE_F.search(c) or STRONG_F.search(c)) and not STRONG_B.search(c) and not WEAK_B.search(c)
                and not re.search(r"(?i)(?<![A-Za-z])(white|pink|blue|red|purple|lavender|orchid|violet|rose|wine|fuchsia|lilac|orange|yellow|peach|coral|salmon)(?![A-Za-z])", c))


def strip_size(t):
    t = NO_FOLIAGE.sub("", t).strip()
    m = SIZE_TAIL.search(t)
    if m and (m.start() > 0 or True):
        head = t[: m.start(1)].rstrip(" ,;")
        if head:
            t = head
            if not t.endswith("."):
                t += "."
    return t


def classify(s):
    f_strong, b_strong = len(STRONG_F.findall(s)), len(STRONG_B.findall(s))
    f_weak, b_weak = len(WEAK_F.findall(s)), len(WEAK_B.findall(s))
    words = re.findall(r"[A-Za-z]+(?:-[A-Za-z]+)*", s)
    b_weak += sum(1 for w in words if COLOR_RE.match(w.split("-")[0]) and w.lower() not in ("green", "bronze"))
    f_weak -= sum(1 for w in words if w.lower() == "green" and False)
    if f_strong and b_strong:
        return "mixed"
    if f_strong:
        # a "foliage" sentence that also names a non-green color before any foliage word is probably mixed
        return "F"
    if b_strong:
        return "mixed" if CORE_F.search(s) else "B"
    if f_weak > b_weak:
        return "F"
    if b_weak > f_weak:
        return "mixed" if CORE_F.search(s) else "B"
    return "?"


COLOR_STOP = {"with", "edge", "edged", "center", "centre", "eye", "tips", "tipped", "throughout", "on", "in", "trimmed", "margin",
              "band", "stripe", "overlay"}
GREENISH = re.compile(r"(?i)^(lime|green|sea|foam|olive|chartreuse)$")


def find_color(bloom):
    toks = re.findall(r"[A-Za-z]+(?:-[A-Za-z]+)*|[/,;.]", bloom)
    out, started, i = [], False, 0
    first_clause_end = None
    while i < len(toks):
        w = toks[i]
        wl = w.lower()
        base = wl.split("-")
        is_color = all(COLOR_RE.match(b) or b in COLOR_MOD or GREENISH.match(b) for b in base) and any(COLOR_RE.match(b) or GREENISH.match(b) for b in base)
        if is_color:
            out.append(w)
            started = True
        elif started and all(b in COLOR_MOD for b in base):
            break
        elif started and wl in ("/",) and i + 1 < len(toks) and (COLOR_RE.match(toks[i + 1].lower().split("-")[0]) or toks[i + 1].lower() in COLOR_MOD):
            out.append("/")
        elif started and wl == "and" and i + 1 < len(toks) and (COLOR_RE.match(toks[i + 1].lower().split("-")[0]) or toks[i + 1].lower() in COLOR_MOD):
            out.append("/")
        elif not started and all(b in COLOR_MOD for b in base):
            out.append(w)       # leading modifier, kept only if a color follows
            pending = True
        elif started:
            break
        else:
            if wl in (",", ";", ".") or wl in COLOR_STOP:
                break
            if wl not in FORM and wl not in COLOR_MOD:
                if out:
                    out = []
                # unknown word before any color: keep scanning a little (e.g. "Heavily fringed white")
            else:
                out = []
        i += 1
    # a leading modifier without any color word is not a color
    if not any(COLOR_RE.match(x.lower().split("-")[0]) or GREENISH.match(x.lower().split("-")[0]) for x in out if x != "/"):
        return ""
    txt = ""
    for x in out:
        txt += x if x == "/" else (("" if txt.endswith("/") or not txt else " ") + x)
    txt = txt.strip()
    return txt[:1].upper() + txt[1:].lower() if txt else ""


TRAIL = re.compile(r"(?i)[,;]?\s*(?:grows?\s+(?:\w+\s+)?(?:large|standard|small|miniature)|(?:very\s+)?(?:small|large|medium)\s+grower|"
                   r"window sill size)\W*$")


def trim_size(t):
    t2 = TRAIL.sub("", t).rstrip(" ,;")
    if t2 != t and t2 and not t2.endswith("."):
        t2 += "."
    return t2 if t2 else t


def split_one(desc, kind):
    if kind == "species":
        return "", "", "", "species (not split)", ""
    text = strip_size(desc)
    sents = split_sentences(text)
    sents = [x for x in sents if not (SIZE_REMARK.match(x.strip(" ,")) or GROWS.match(x.strip(" ,")) or size_only(x))]
    cls = [classify(s) for s in sents]
    new_s, new_c = [], []
    for s_, c_ in zip(sents, cls):
        if c_ == "mixed":
            sp = split_mixed(s_)
            if sp:
                new_s += [sp[0], sp[1]]
                new_c += ["B", "F"]
                continue
        new_s.append(s_)
        new_c.append(c_)
    sents, cls = new_s, new_c
    reason = ""
    if "mixed" in cls:
        reason = "a sentence mixes bloom and foliage words"
    elif "?" in cls:
        if len(sents) == 1 and re.search(r"(?i)\b(" + "|".join(COLORS) + r")\b", sents[0]):
            cls = ["B"]
        else:
            reason = "a sentence has no usable cue"
    bloom = trim_size(" ".join(s for s, c in zip(sents, cls) if c == "B"))
    foliage = trim_size(" ".join(s for s, c in zip(sents, cls) if c == "F"))
    color = find_color(bloom) if bloom else ""
    if reason:
        return color, bloom, foliage, "needs review", reason
    if bloom and foliage:
        return color, bloom, foliage, "ok", ""
    if bloom:
        return color, bloom, "", "bloom only", ""
    if foliage:
        bloom_color = re.search(r"(?i)(?<![A-Za-z])(white|pink|blue|red|purple|lavender|orchid|violet|rose|wine|fuchsia|lilac|orange|yellow|peach|coral|salmon)(?![A-Za-z])", foliage)
        if bloom_color:
            return "", "", foliage, "needs review", "foliage only but names a bloom color"
        return "", "", foliage, "foliage only", ""
    return "", "", "", "needs review", "nothing left after removing the size"


# ---- decoded AVSA code -> short plain English (user decision 2026-11-13)
FAMILY = {"blue": "blue", "fuchsia": "fuchsia", "green": "green", "yellow": "yellow", "orchid/mauve/lavender": "orchid",
          "pink/rose/coral/peach": "pink", "red/maroon/plum/burgundy/wine": "red", "violet/purple": "purple",
          "white/cream/blush": "white", "multicolor (2 or more colors)": "multicolor",
          "two-tone (2 hues of the same color)": "two-tone"}
MODIFIERS = {"dark", "light", "medium"}
LEAF = {"plain/tailored": "plain", "quilted": "quilted", "pointed": "pointed", "variegated": "variegated", "supreme": "supreme",
        "girl/semigirl": "girl", "ruffled/fringed/wavy/fluted": "ruffled/wavy", "spooned/ovate/cupped up": "spooned/ovate",
        "longifolia/spider": "longifolia", "compound/piggyback": "piggyback"}
FLOWER = {"star shape": "star-shaped", "bell shape": "bell-shaped"}


def _color_word(t):
    """one colour token, possibly joined by 'and'/'or' (a '&' in the printed code): 'pink/... and blue' -> 'pink and blue'"""
    t = t.replace("multicolor (2 or more colors)", "multicolor").replace("two-tone (2 hues of the same color)", "two-tone")
    for k, v in sorted(FAMILY.items(), key=lambda kv: -len(kv[0])):
        t = t.replace(k, v)
    return t


def code_color_text(code):
    """'dark + red + white + edge' -> 'Dark red, white edge'. A dark/light/medium letter belongs to the colour after it (to the edge
    when it comes right before `edge` with no colour of its own). `multicolor` (C) is shown as a remark."""
    parts = [p.strip() for p in code.split(" + ") if p.strip()]
    if not parts:
        return ""
    items, pend, edge, multi, twotone = [], "", False, False, False
    for p in parts:
        w = _color_word(p)
        if p in MODIFIERS:
            pend = p
        elif p == "edge":
            edge = True
            if pend:                       # modifier with no colour of its own, e.g. P-D-E: a dark edge
                items.append((pend, ""))
                pend = ""
        elif w.startswith("multicolor"):
            multi = True
        elif w.startswith("two-tone"):
            twotone = True
        else:
            items.append((pend, w))
            pend = ""
    words = [f"{m} {c}".strip() for m, c in items]
    if edge and len(words) >= 2:
        base = words[0] if items[0][1] else ""
        text = (base + ", " if base else "") + " and ".join(words[1:]) + " edge"
    elif edge and len(words) == 1:
        text = words[0] + " edge"
    elif len(words) > 1:
        text = "/".join(words) if not any(" and " in w or " or " in w for w in words) else ", ".join(words)
    else:
        text = words[0] if words else ""
    if twotone:
        text = (text + " two-tone").strip()
    if multi:
        text = f"{text}, multicolor" if edge else (f"multicolor ({', '.join(words)})" if words else "multicolor")
    return (text[:1].upper() + text[1:]) if text else ""


def color_needs_check(text):
    """composite colours from a '&' in the printed code that read oddly (white and white, white and dark ...)"""
    words = re.findall(r"[a-z]+", text.lower())
    for k in range(len(words) - 2):
        if words[k + 1] in ("and", "or") and (words[k] == words[k + 2] or words[k + 2] in MODIFIERS):
            return True
    return "or" in words



def code_bloom_text(code):
    parts = [p.strip() for p in code.split(",") if p.strip()]
    parts = [FLOWER.get(p, p) for p in parts]
    parts.sort(key=lambda p: 0 if re.match(r"(single|double|semidouble)", p) else 1)      # petal count first
    return (", ".join(parts)[:1].upper() + ", ".join(parts)[1:] + ".") if parts else ""


def code_foliage_text(code):
    parts = [LEAF.get(p.strip(), p.strip()) for p in code.split(",") if p.strip()]
    if not parts:
        return ""
    t = ", ".join(parts)
    return t[:1].upper() + t[1:] + " foliage."


def from_code(r):
    return (code_color_text(r.get("code_color", "")), code_bloom_text(r.get("code_flower", "")),
            code_foliage_text(r.get("code_leaf", "")))


def main():
    rows = list(csv.DictReader(open(DATA / "mvl_supplements.csv", encoding="utf-8", newline="")))
    human = {}
    if REVIEW.exists():
        for r in csv.DictReader(open(REVIEW, encoding="utf-8-sig", newline="")):
            human[r["plant_key"]] = r
    out, review, counts = [], [], {}
    for r in rows:
        if r.get("desc_source") == "code" and r["kind"] != "species":
            color, bloom, foliage = from_code(r)
            status = "code" if (color and bloom and foliage) else ("code (partial)" if (color or bloom or foliage) else "needs review")
            if status == "code" and color_needs_check(color):
                status = "code (check color)"
            reason = "" if status != "needs review" else "decoded code gave no color, bloom or foliage"
        else:
            color, bloom, foliage, status, reason = split_one(r["description"], r["kind"])
            if r.get("code") and status in ("ok", "bloom only", "foliage only"):
                cc, cb, cf = from_code(r)
                filled = [(not color and cc), (not bloom and cb), (not foliage and cf)]
                if any(filled):
                    color, bloom, foliage = color or cc, bloom or cb, foliage or cf
                    status = "ok+code"
            elif r.get("code") and status == "needs review":
                cc, cb, cf = from_code(r)
                color, bloom, foliage = color or cc, bloom or cb, foliage or cf     # proposals only; the row stays held
        h = human.get(r["plant_key"])
        if h and status == "needs review":
            c = [h.get("corrected_color", "").strip(), h.get("corrected_bloom", "").strip(), h.get("corrected_foliage", "").strip()]
            if h.get("decision", "").strip().lower() == "delete":
                color = bloom = foliage = ""   # reviewer: do not add this cultivar to the database
                status = "deleted"
            elif any(c):
                color, bloom, foliage, status = c[0], c[1], c[2], "human"
            elif h.get("decision", "").strip().lower() == "use":
                status = "human"
            elif h.get("decision", "").strip().lower() == "accept":     # take the proposed_correction (claude_*) as written
                c = [h.get("claude_color", "").strip(), h.get("claude_bloom", "").strip(), h.get("claude_foliage", "").strip()]
                if any(c):
                    color, bloom, foliage, status = c[0], c[1], c[2], "human"
        decided = bool(h) and status in ("human", "deleted")
        counts[status] = counts.get(status, 0) + 1
        out.append({"plant_key": r["plant_key"], "color": color, "bloom_description": bloom, "foliage_description": foliage,
                    "split_status": status})
        if decided:                  # keep decided rows in the file, otherwise the next run would forget the decision
            review.append({**{k: h.get(k, "") for k in ("plant_key", "name", "hybridizer", "lists", "row_ids", "description", "reason",
                              "proposed_color", "proposed_bloom", "proposed_foliage", "corrected_color", "corrected_bloom",
                              "corrected_foliage", "decision", "claude_color", "claude_bloom", "claude_foliage", "claude_note")},
                           "name": r["name"], "hybridizer": r["hybridizer"], "lists": r["lists"], "row_ids": r["row_ids"],
                           "description": r["description"]})
        elif status == "needs review":
            review.append({"plant_key": r["plant_key"], "name": r["name"], "hybridizer": r["hybridizer"],
                           "lists": r["lists"], "row_ids": r["row_ids"], "description": r["description"], "reason": reason,
                           "proposed_color": color, "proposed_bloom": bloom, "proposed_foliage": foliage,
                           "corrected_color": "", "corrected_bloom": "", "corrected_foliage": "",
                           "decision": (h or {}).get("decision", ""), "claude_color": (h or {}).get("claude_color", ""),
                           "claude_bloom": (h or {}).get("claude_bloom", ""), "claude_foliage": (h or {}).get("claude_foliage", ""),
                           "claude_note": (h or {}).get("claude_note", "")})
    for path, data, cols in (
        (DATA / "mvl_description_split.csv", out, ["plant_key", "color", "bloom_description", "foliage_description", "split_status"]),
        (REVIEW, review, ["plant_key", "name", "hybridizer", "lists", "row_ids", "description", "reason", "proposed_color", "proposed_bloom", "proposed_foliage",
                          "corrected_color", "corrected_bloom", "corrected_foliage", "decision", "claude_color", "claude_bloom",
                          "claude_foliage", "claude_note"])):
        with open(path, "w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=cols)
            w.writeheader()
            w.writerows(data)
    print(counts)


if __name__ == "__main__":
    main()
