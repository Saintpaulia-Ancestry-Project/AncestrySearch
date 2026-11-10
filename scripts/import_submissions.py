"""Import contributor submissions (see notes/submission-form-plan.md).

Two steps, so private data never reaches Git:

  1. ingest  - read the reviewed Sheet export (submissions/inbox/*.csv, git-ignored, has contact details),
               keep the rows whose decision is accept / join / different, apply the corrected_* values, drop the
               private and admin columns, and write data/submissions/<submission_id>.csv (tracked).
                   python scripts/import_submissions.py ingest submissions/inbox/export.csv
  2. apply   - add every data/submissions/*.csv to data/*.csv. Run it after import_excel.py and before build_db.py
               (import_excel.py regenerates data/, so applying is repeatable; re-running without it is also safe).
                   python scripts/import_submissions.py apply [--photos-dir FOLDER]

Rules: only the name is required. A new name that already exists is HELD until the reviewer decides join or
different (a stub, i.e. a name only seen as a parent, is filled in automatically). Ambiguous parents are held; an
unknown parent becomes a stub. Updates fill empty fields; a differing existing value is reported and left alone
unless the field is listed in overwrite_fields. Writes reports/submission_import.md.
--photos-dir: copies each permitted photo from FOLDER into reports/submission_photos/<id>/ named for its cultivar,
with a credits.csv, ready for: python scripts/add_images.py <that folder> (credit comes from credits.csv).
"""
import argparse
import datetime
import re
import shutil
from pathlib import Path

import submissions_lib as sl
from submissions_lib import ie

REPORT = ie.REPORTS / "submission_import.md"
PHOTO_DIR = ie.REPORTS / "submission_photos"


# ------------------------------------------------------------------ ingest
def ingest(path):
    rows = sl.read_csv(path)
    kept, notes = {}, []
    for i, raw in enumerate(rows, start=2):
        sid = (raw.get("submission_id") or "").strip()
        label = f"row {i} ({raw.get('name', '')!r}, {sid})"
        dec = (raw.get("decision") or "").strip().lower()
        if dec not in sl.IMPORT_DECISIONS:
            notes.append(f"skipped {label}: decision {dec or '(blank)'!r}")
            continue
        if not sl.SID_RE.match(sid):
            notes.append(f"REFUSED {label}: bad submission_id")
            continue
        if (raw.get("agreed_license") or "").strip().lower() != "yes":
            notes.append(f"REFUSED {label}: license not agreed")
            continue
        r = sl.effective(raw)
        if not r["name"]:
            notes.append(f"REFUSED {label}: no name")
            continue
        join_id = ie.clean(raw.get("join_id", ""))
        if dec == "join":
            if not join_id:
                notes.append(f"REFUSED {label}: decision join needs join_id")
                continue
            r["action"], r["existing_id"] = "update", join_id
        if r["action"] == "update" and not r["existing_id"]:
            notes.append(f"REFUSED {label}: update needs existing_id")
            continue
        ow = [x.strip() for x in re.split(r"[;,]", raw.get("overwrite_fields", "")) if x.strip()]
        bad = [x for x in ow if x not in sl.OVERWRITABLE]
        if bad:
            notes.append(f"REFUSED {label}: overwrite_fields not understood: {bad}")
            continue
        pub = {c: r.get(c, "") for c in sl.PUBLIC_COLS}
        pub.update(submission_id=sid, entry_no=ie.clean(raw.get("entry_no", "")) or str(i),
                   received_at=ie.clean(raw.get("received_at", "")), submitter_name=ie.cname(raw.get("submitter_name", "")),
                   force_new="1" if dec == "different" else "", overwrite_fields=";".join(ow))
        kept.setdefault(sid, []).append(pub)
    for sid, new in kept.items():
        dest = sl.SUBDIR / f"{sid}.csv"
        old = {r["entry_no"]: r for r in sl.read_csv(dest)} if dest.exists() else {}
        old.update({r["entry_no"]: r for r in new})
        merged = sorted(old.values(), key=lambda r: (int(r["entry_no"]) if r["entry_no"].isdigit() else 10**9, r["entry_no"]))
        sl.write_csv(dest, merged, sl.PUBLIC_COLS)
        print(f"wrote {dest.relative_to(sl.ROOT)} ({len(merged)} rows, {len(new)} from this export)")
    for n in notes:
        print(n)
    print(f"{sum(len(v) for v in kept.values())} rows accepted, {len(notes)} skipped or refused.")


# ------------------------------------------------------------------ apply
def safe_filename(s):
    return re.sub(r'[<>:"/\\|?*]+', "", s).strip() or "cultivar"


class Applier:
    def __init__(self):
        self.base = sl.Base()
        self.cols = list(next(iter(self.base.cultivars.values())).keys())
        self.tags = {m.group(0) for r in self.base.cultivars.values()
                     for m in re.finditer(r"\(submission [^,)]+, entry [^)]+\)", r["source_note"])}
        self.log = {"created": [], "promoted": [], "updated": [], "held": [], "conflicts": [], "stubs": [],
                    "people": [], "skipped": [], "notes": [], "photos": []}
        self.stamp = datetime.date.today().isoformat()

    # --- ids
    def new_id(self, name, first_hybridizer=""):
        base_id = ie.slugify(name)
        cands = [base_id] + ([f"{base_id}-{ie.slugify(first_hybridizer)}"] if first_hybridizer else [])
        for c in cands:
            if c not in self.base.cultivars:
                return c
        n = 2
        while f"{base_id}-{n}" in self.base.cultivars:
            n += 1
        return f"{base_id}-{n}"

    def add_cultivar(self, **kw):
        rec = {c: "" for c in self.cols}
        rec.update(kw)
        self.base.cultivars[rec["id"]] = rec
        self.base.index(rec)
        return rec

    def person(self, name):
        name = ie.cname(name)
        m = re.match(r"^(.*?)\s*\(([^)]+)\)\s*$", name)
        country = ""
        if m and m.group(2) in ie.COUNTRIES:
            name, country = m.group(1), m.group(2)
        pid = self.base.person_by_key.get(ie.norm(name))
        if pid:
            return pid
        base_id = ie.slugify(name)
        pid, n = base_id, 2
        while pid in self.base.people:
            pid = f"{base_id}-{n}"
            n += 1
        kind = "species" if name == "Species" else ("organization" if ie.ORG_RE.search(name) else "person")
        self.base.people[pid] = {"id": pid, "name": name, "kind": kind, "country": country, "aliases": ""}
        self.base.person_by_key[ie.norm(name)] = pid
        self.log["people"].append(f"{name} ({pid}, {kind})")
        return pid

    def parent_id(self, cell, who):
        """Resolve a parent cell to a cultivar id, creating a stub if unknown. None for placeholders."""
        if sl.is_placeholder(cell):
            return None
        status, ids = self.base.resolve(cell)
        if status in ("id", "one"):
            return ids[0]
        if status == "many":
            return None
        name = ie.cname(cell)
        rec = self.add_cultivar(id=self.new_id(name), name=name, kind=ie.stub_kind(name), sources="submission",
                                added_at=self.stamp)
        self.log["stubs"].append(f"{name} ({rec['id']}) for {who}")
        return rec["id"]

    # --- field filling
    def fill(self, rec, field, val, overwrite, who):
        if not val:
            return False
        cur = rec.get(field, "")
        if cur == val:
            return False
        if not cur or field in overwrite:
            rec[field] = val
            return True
        self.log["conflicts"].append(f"{rec['name']} [{rec['id']}] {field}: kept {cur!r}, submission has {val!r} ({who})")
        return False

    # --- one row
    def target(self, r, tag):
        """-> (mode, record) or (None, reason). mode: create | promote | update."""
        name = r["name"]
        if r["action"] == "update":
            rec = self.base.cultivars.get(r["existing_id"])
            if not rec:
                return None, f"existing_id {r['existing_id']!r} not found"
            return ("promote" if rec["kind"] == "stub" else "update"), rec
        if not r["force_new"]:
            ids = self.base.find(name)
            if len(ids) == 1 and self.base.cultivars[ids[0]]["kind"] == "stub":
                return "promote", self.base.cultivars[ids[0]]
            if ids:
                return None, f"name already exists ({', '.join(ids[:5])}): set decision join (with join_id) or different"
        return "create", None

    def apply_file(self, path):
        rows = sl.read_csv(path)
        rows.sort(key=lambda r: int(r["entry_no"]) if r["entry_no"].isdigit() else 10**9)
        todo = []
        # pass 1: decide and create the records, so parents can refer to cultivars of the same submission
        for r in rows:
            sid = r["submission_id"]
            tag = f"(submission {sid}, entry {r['entry_no']})"
            who = f"{r['name']} {tag}"
            if tag in self.tags:
                self.log["skipped"].append(f"{who}: already applied")
                continue
            if not sl.SID_RE.match(sid) or not r["name"]:
                self.log["held"].append(f"{who}: bad submission_id or no name")
                continue
            mode, rec = self.target(r, tag)
            if mode is None:
                self.log["held"].append(f"{who}: {rec}")
                continue
            cells = [r["sport_of"]] if r["sport_of"] else [r["seed_parent"], r["pollen_parent"]]
            amb = [c for c in cells if not sl.is_placeholder(c) and self.base.resolve(c)[0] == "many"]
            if amb:
                self.log["held"].append(f"{who}: ambiguous parent {amb}: write id:<slug> in the parent cell")
                continue
            kind = (r["kind"] or "cultivar").lower()
            if mode == "create":
                hyb = sl.split_list(r["hybridizers"], ";")
                rec = self.add_cultivar(id=self.new_id(r["name"], hyb[0] if hyb else ""), name=r["name"], kind=kind,
                                        sources="submission", added_at=(r["received_at"] or self.stamp)[:10])
                self.log["created"].append(f"{r['name']} ({rec['id']})")
            elif mode == "promote":
                rec["kind"] = kind
                self.log["promoted"].append(f"{r['name']} ({rec['id']}) was a stub")
            todo.append((mode, rec, r, tag, who))
        # pass 2: fill in the records
        for mode, rec, r, tag, who in todo:
            self.fill_record(mode, rec, r, tag, who)

    def fill_record(self, mode, rec, r, tag, who):
        ow = set(sl.split_list(r["overwrite_fields"], ";"))
        changed = mode != "update"
        cid, b = rec["id"], self.base
        # sources / credit
        srcs = rec["sources"].split("+") if rec["sources"] else []
        if "parent" in srcs and mode == "promote":
            srcs.remove("parent")
        if "submission" not in srcs:
            srcs.append("submission")
        rec["sources"] = "+".join(srcs)
        credit = f"Contributed by {r['submitter_name'] or 'a contributor'} {tag}" if mode != "update" else \
                 f"Additions by {r['submitter_name'] or 'a contributor'} {tag}"
        rec["source_note"] = f"{rec['source_note']}; {credit}" if rec["source_note"] else credit
        if mode == "update" and r["kind"] and r["kind"].lower() != rec["kind"]:
            changed |= self.fill(rec, "kind", r["kind"].lower(), ow, who)
        # text fields
        for f in sl.TEXT_FIELDS:
            if f == "notes":
                continue
            changed |= self.fill(rec, f, r[f], ow, who)
        # notes: appended (never conflict), with year and parentage note kept as text
        parts = [r["notes"]]
        if r["year_introduced"]:
            parts.append(f"Year introduced: {r['year_introduced']}.")
        if r["parentage_note"]:
            parts.append(f"Parentage note: {r['parentage_note']}")
        add = " ".join(p for p in parts if p)
        if add and add not in rec["notes"]:
            rec["notes"] = f"{rec['notes']} | {add}" if rec["notes"] else add
            changed = True
        # registration
        m = re.fullmatch(r"(\d+)(?:\.0+)?", r["registration_no"] or "")
        if r["registration_no"] and not m:
            self.log["conflicts"].append(f"{who}: registration_no {r['registration_no']!r} is not a number; ignored")
        elif m:
            reg = str(int(m.group(1)))
            owner = b.reg.get(reg)
            if owner and owner != cid:
                self.log["conflicts"].append(f"{who}: registration no. {reg} already belongs to {owner}; ignored")
            elif self.fill(rec, "registration_no", reg, ow, who):
                b.reg[reg] = cid
                changed = True
        d = ie.parse_date(r["registered_date"])
        if d and self.fill(rec, "registered_date", d, ow, who):
            rec["registered_year"] = d[:4]
            changed = True
        # hybridizers
        names = sl.split_list(r["hybridizers"], ";")
        if names:
            pids = list(dict.fromkeys(self.person(n) for n in names))
            have = [h for h in b.hyb if h["cultivar_id"] == cid]
            if not have or "hybridizers" in ow:
                if have:
                    b.hyb[:] = [h for h in b.hyb if h["cultivar_id"] != cid]
                for k, pid in enumerate(pids, start=1):
                    b.hyb.append({"cultivar_id": cid, "person_id": pid, "position": str(k)})
                rec["hybridizer_raw"] = " / ".join(names)
                changed = True
            elif {h["person_id"] for h in have} != set(pids):
                self.log["conflicts"].append(f"{rec['name']} [{cid}] hybridizers differ from {rec['hybridizer_raw']!r}: "
                                             f"submission has {names} ({who})")
        # parentage
        changed |= self.parents(rec, r, ow, who)
        # links
        for u in dict.fromkeys(sl.split_list(r["links"], "|")):
            if not re.match(r"^https?://\S+$", u):
                self.log["conflicts"].append(f"{who}: link {u!r} is not an http(s) URL; ignored")
            elif not any(l["cultivar_id"] == cid and l["url"] == u for l in b.links):
                b.links.append({"cultivar_id": cid, "url": u, "kind": "photos" if re.search(
                    r"drive\.google|photos\.google|flickr|photos\.app", u) else "web"})
                changed = True
        # photos: manifest only (add_images.py does the work)
        files = sl.split_list(r["photo_files"], "|")
        if files and r["photo_permission"].lower() == "yes":
            caps, creds = sl.split_list(r["photo_captions"], "|"), sl.split_list(r["photo_credits"], "|")
            for k, fn in enumerate(files):
                self.log["photos"].append({"sid": r["submission_id"], "file": fn, "cultivar": rec["name"], "id": cid,
                                           "caption": caps[k] if k < len(caps) else "",
                                           "credit": creds[k] if k < len(creds) else (creds[0] if len(creds) == 1 else r["submitter_name"]),
                                           "n": k + 1})
        elif files:
            self.log["conflicts"].append(f"{who}: photos listed without permission; not used")
        if mode == "update" and changed:
            self.log["updated"].append(f"{rec['name']} ({cid})")

    def parents(self, rec, r, ow, who):
        b, cid = self.base, rec["id"]
        existing = [p for p in b.parentage if p["child_id"] == cid]
        if r["sport_of"]:
            if not r["sport_of"] or sl.is_placeholder(r["sport_of"]):
                return False
            pid = self.parent_id(r["sport_of"], who)
            if pid is None:
                return False
            if pid == cid or sl.has_cycle(b.parents_of(), cid, [pid]):
                self.log["conflicts"].append(f"{who}: sport parent {r['sport_of']!r} would make a cycle; ignored")
                return False
            if rec["sport_of_id"] and rec["sport_of_id"] != pid and "sport_of" not in ow:
                self.log["conflicts"].append(f"{rec['name']} [{cid}] sport_of: kept {rec['sport_of_id']}, submission has {pid} ({who})")
                return False
            rec["sport_of_id"] = pid
            return True
        cells = [("seed", r["seed_parent"]), ("pollen", r["pollen_parent"])]
        if all(sl.is_placeholder(c) for _, c in cells):
            return False
        cert = (r["parent_certainty"] or "known").lower()
        cert = cert if cert in sl.CERTAINTY else "known"
        new = []
        for role, cell in cells:
            if sl.is_placeholder(cell):
                continue
            if ie.K(cell) == ie.K(rec["name"]) or ie.SELF_RE.search(cell):
                self.log["conflicts"].append(f"{who}: {role} parent {cell!r} is the cultivar itself; ignored")
                continue
            pid = self.parent_id(cell, who)
            if pid is None or pid == cid:
                continue
            text = b.cultivars[pid]["name"] if ie.cname(cell).lower().startswith("id:") else ie.cname(cell)
            new.append({"child_id": cid, "parent_id": pid, "role": role, "certainty": cert, "raw_text": text})
            rec[f"{role}_parent_raw"] = rec[f"{role}_parent_raw"] or text
        if not new:
            return False
        if existing and "parents" not in ow:
            if {(p["parent_id"], p["role"]) for p in existing} != {(p["parent_id"], p["role"]) for p in new}:
                self.log["conflicts"].append(f"{rec['name']} [{cid}] parents: kept existing "
                                             f"{[(p['parent_id'], p['role']) for p in existing]}, submission has "
                                             f"{[(p['parent_id'], p['role']) for p in new]} ({who})")
            return False
        if sl.has_cycle(b.parents_of(), cid, [p["parent_id"] for p in new]):
            self.log["conflicts"].append(f"{who}: parents would make a cycle; ignored")
            return False
        if existing:
            b.parentage[:] = [p for p in b.parentage if p["child_id"] != cid]
        b.parentage.extend(new)
        return True

    # --- output
    def write(self):
        b = self.base
        sl.write_csv(sl.DATA / "cultivars.csv", list(b.cultivars.values()), self.cols)
        sl.write_csv(sl.DATA / "parentage.csv", b.parentage, ["child_id", "parent_id", "role", "certainty", "raw_text"])
        sl.write_csv(sl.DATA / "people.csv", list(b.people.values()), ["id", "name", "kind", "country", "aliases"])
        sl.write_csv(sl.DATA / "cultivar_hybridizers.csv", b.hyb, ["cultivar_id", "person_id", "position"])
        sl.write_csv(sl.DATA / "cultivar_links.csv", b.links, ["cultivar_id", "url", "kind"])

    def report(self, files):
        L = self.log
        lines = ["# Submission import", "", f"- files applied: {len(files)}",
                 f"- new cultivars: {len(L['created'])}; stubs filled in: {len(L['promoted'])}; existing records updated: {len(L['updated'])}",
                 f"- parent stubs created: {len(L['stubs'])}; new people: {len(L['people'])}",
                 f"- already applied (skipped): {len(L['skipped'])}; HELD: {len(L['held'])}; conflicts/ignored values: {len(L['conflicts'])}",
                 f"- photos to import: {len(L['photos'])} (add_images.py; see --photos-dir)", ""]
        for title, key in (("HELD rows (not imported; fix in the Sheet and ingest again)", "held"),
                           ("Conflicts and ignored values (existing data kept)", "conflicts"),
                           ("Parent stubs created", "stubs"), ("New people", "people"),
                           ("Stubs filled in", "promoted"), ("Existing records updated", "updated"),
                           ("New cultivars", "created")):
            if L[key]:
                lines += [f"## {title}", ""] + [f"- {x}" for x in L[key]] + [""]
        if L["photos"]:
            lines += ["## Photos", ""] + [f"- {p['file']} -> {p['cultivar']} ({p['id']}), credit: {p['credit']}" for p in L["photos"]] + [""]
        REPORT.write_text("\n".join(lines), encoding="utf-8")
        print("\n".join(lines[:9]))
        print(f"Report: {REPORT}")

    def stage_photos(self, folder):
        folder = Path(folder)
        index = {}
        for p in folder.rglob("*"):
            if p.is_file():
                index.setdefault(p.name.lower(), p)
        out, missing = {}, []
        for ph in self.log["photos"]:
            src = index.get(ph["file"].lower())
            if not src:
                missing.append(ph["file"])
                continue
            dest_dir = PHOTO_DIR / ph["sid"]
            dest_dir.mkdir(parents=True, exist_ok=True)
            fname = safe_filename(ph["cultivar"]) + ("" if ph["n"] == 1 else f" {ph['n']}") + src.suffix.lower()
            shutil.copy2(src, dest_dir / fname)
            out.setdefault(ph["sid"], []).append({"file": fname, "credit": ph["credit"], "caption": ph["caption"], "source_url": ""})
        for sid, rows in out.items():
            sl.write_csv(PHOTO_DIR / sid / "credits.csv", rows, ["file", "credit", "caption", "source_url"])
            print(f"staged {len(rows)} photos in {PHOTO_DIR / sid}; next: python scripts/add_images.py \"{PHOTO_DIR / sid}\"")
        if missing:
            print("photo files not found in the folder:", ", ".join(missing))


def apply(photos_dir=None):
    files = sorted(sl.SUBDIR.glob("*.csv")) if sl.SUBDIR.exists() else []
    if not files:
        print("No files in data/submissions/; nothing to apply.")
        return
    a = Applier()
    for f in files:
        a.apply_file(f)
    a.write()
    a.report(files)
    if photos_dir:
        a.stage_photos(photos_dir)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p1 = sub.add_parser("ingest")
    p1.add_argument("csv", type=Path)
    p2 = sub.add_parser("apply")
    p2.add_argument("--photos-dir", type=Path)
    args = ap.parse_args()
    ingest(args.csv) if args.cmd == "ingest" else apply(args.photos_dir)


if __name__ == "__main__":
    main()
