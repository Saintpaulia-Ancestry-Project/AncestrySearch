"""The one tool that edits the master data (notes/freeze-plan.md, phase 2).

Master files (data/): cultivars.csv, parentage.csv, people.csv, cultivar_hybridizers.csv, cultivar_links.csv, images.csv.
Every edit made here is logged to reports/decision_history/master_edits.csv (date, op, ids, field, old, new, reason).
A merge also records old id -> kept id in data/id_redirects.csv.

Python:   m = Master(); m.set_field("Reed's Jackpot", "hybridizer_raw", "J. Reed", reason); m.merge(keep, drop, reason); m.save()
Command:  python scripts/master_edit.py set --name "Reed's Jackpot" --field hybridizer_raw --value "J. Reed" --reason "..."
          python scripts/master_edit.py rename --id imp-s-shiny-seashell --new-name "Imp's Shiny Seashells" --reason "..."
          python scripts/master_edit.py merge --keep persephone --drop persephone-hi-hill-2 --reason "..."
          python scripts/master_edit.py delete --id some-id --reason "..."
          python scripts/master_edit.py validate
Add --root DIR to work on a copy (tests) and --dry-run to check without writing.
"""
import argparse
import csv
import datetime
import re
import sys
import unicodedata
from pathlib import Path

ROOT_DEFAULT = Path(__file__).resolve().parents[1]
HISTORY_COLS = ["date", "op", "cultivar_id", "name", "field", "old_value", "new_value", "reason"]
REDIRECT_COLS = ["old_id", "new_id", "reason", "date"]
KINDS = {"cultivar", "stub", "seedling", "species", "unknown"}
FILL_FIELDS = ["sport_of_id", "size_class", "color", "bloom_description", "foliage_description", "registration_no",
               "registered_year", "registered_date", "description", "source_row", "added_at", "seed_parent_raw",
               "pollen_parent_raw", "hybridizer_raw", "source_note", "supplement_year"]


class EditError(Exception):
    pass


def norm(s):
    return re.sub(r"[^a-z0-9]", "", str(s).lower().replace("’", "'"))


def slugify(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-") or "x"


class Table:
    """a CSV file read and written back byte-for-byte the way it was written (line ending, columns, order)"""

    def __init__(self, path, required=True):
        self.path = Path(path)
        self.rows, self.cols, self.eol = [], [], "\r\n"
        if self.path.exists():
            raw = self.path.read_bytes()
            self.eol = "\r\n" if b"\r\n" in raw else "\n"
            self.bom = raw[:3] == b"\xef\xbb\xbf"
            with open(self.path, newline="", encoding="utf-8-sig") as f:
                r = csv.DictReader(f)
                self.cols = list(r.fieldnames or [])
                self.rows = [dict(x) for x in r]
        elif required:
            raise EditError(f"missing {self.path}")
        else:
            self.bom = False

    def save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with open(self.path, "w", newline="", encoding="utf-8-sig" if getattr(self, "bom", False) else "utf-8") as f:
            w = csv.DictWriter(f, fieldnames=self.cols, lineterminator=self.eol, extrasaction="ignore")
            w.writeheader()
            w.writerows(self.rows)


class Master:
    def __init__(self, root=None):
        self.root = Path(root) if root else ROOT_DEFAULT
        d = self.root / "data"
        self.cultivars = Table(d / "cultivars.csv")
        self.parentage = Table(d / "parentage.csv")
        self.people = Table(d / "people.csv")
        self.hyb = Table(d / "cultivar_hybridizers.csv")
        self.links = Table(d / "cultivar_links.csv")
        self.images = Table(d / "images.csv", required=False)
        self.redirects = Table(d / "id_redirects.csv", required=False)
        self.aliases = Table(d / "name_aliases.csv", required=False)
        if not self.aliases.cols:
            self.aliases.cols, self.aliases.eol = ["alias_key", "canonical_key"], "\r\n"
        if not self.redirects.cols:
            self.redirects.cols, self.redirects.eol = REDIRECT_COLS, "\n"
        self.hist_path = self.root / "reports" / "decision_history" / "master_edits.csv"
        self.log = []
        self.reindex()

    # ---------------------------------------------------------------- lookup
    def reindex(self):
        self.by_id = {r["id"]: r for r in self.cultivars.rows}
        if len(self.by_id) != len(self.cultivars.rows):
            raise EditError("duplicate cultivar ids")

    def select(self, name):
        """ids of every record whose name matches (normalised), like the old data_corrections rows"""
        k = norm(name)
        return [r["id"] for r in self.cultivars.rows if norm(r["name"]) == k]

    def _one(self, cid):
        if cid not in self.by_id:
            raise EditError(f"no record with id {cid!r}")
        return self.by_id[cid]

    def add_alias(self, old_name, new_name):
        """both spellings keep reaching the same record (data/name_aliases.csv, used by names_lib.K for submissions)"""
        a, c = norm(old_name), norm(new_name)
        if a == c:
            return
        self.aliases.rows = [r for r in self.aliases.rows if not (r["alias_key"] == c and r["canonical_key"] == a)]
        if not any(r["alias_key"] == a for r in self.aliases.rows):
            self.aliases.rows.append({"alias_key": a, "canonical_key": c})

    def _log(self, op, cid, name, field="", old="", new="", reason=""):
        self.log.append({"date": datetime.date.today().isoformat(), "op": op, "cultivar_id": cid, "name": name,
                         "field": field, "old_value": old, "new_value": new, "reason": reason})

    # ---------------------------------------------------------------- operations
    def set_field(self, target, field, value, reason, note=True):
        """target: a cultivar id, or a name (every record with that name). The old value goes into the notes unless
        note=False or the field is `notes`."""
        if field not in self.cultivars.cols or field == "id":
            raise EditError(f"cannot set {field!r}")
        ids = [target] if target in self.by_id else self.select(target)
        if not ids:
            raise EditError(f"nothing matches {target!r}")
        n = 0
        for cid in ids:
            r = self.by_id[cid]
            old = r[field]
            if old == value:
                continue
            if field == "registration_no" and value:
                other = next((x for x in self.cultivars.rows if x["registration_no"] == value and x["id"] != cid), None)
                if other:
                    raise EditError(f"registration number {value} already belongs to {other['name']} [{other['id']}]")
            r[field] = value
            if field == "registration_no":
                r["registered_year"] = (r["registered_date"] or "")[:4] or r["registered_year"]
            if field == "registered_date":
                r["registered_year"] = value[:4] if value else r["registered_year"]
            if note and field != "notes":
                r["notes"] = (r["notes"] + " " if r["notes"] else "") + f"[{field} corrected from {old or 'blank'}: {reason}]"
            self._log("set", cid, r["name"], field, old, value, reason)
            n += 1
        return n

    def rename(self, cid, new_name, reason):
        r = self._one(cid)
        old = r["name"]
        if old == new_name:
            return False
        r["name"] = new_name
        self.add_alias(old, new_name)
        r["notes"] = (r["notes"] + " " if r["notes"] else "") + f"[name corrected from {old}" + (f": {reason}" if reason else "") + "]"
        self._log("rename", cid, new_name, "name", old, new_name, reason)
        return True

    def merge(self, keep_id, drop_id, reason, force=False):
        """fold record drop_id into keep_id (empty fields are filled, relations re-pointed, the dropped id redirects)"""
        import copy
        k, d = self._one(keep_id), self._one(drop_id)
        tables = (self.cultivars, self.parentage, self.hyb, self.links, self.images, self.redirects, self.aliases)
        backup = [copy.deepcopy(t.rows) for t in tables]
        try:
            self._merge(k, d, keep_id, drop_id, reason, force)
        except EditError:
            for t, rows in zip(tables, backup):
                t.rows = rows
            self.reindex()
            raise

    def _merge(self, k, d, keep_id, drop_id, reason, force):
        if keep_id == drop_id:
            raise EditError("cannot merge a record into itself")
        if k["registration_no"] and d["registration_no"] and k["registration_no"] != d["registration_no"] and not force:
            raise EditError(f"different registration numbers {k['registration_no']} / {d['registration_no']}")
        for f in FILL_FIELDS:
            if not k.get(f) and d.get(f):
                k[f] = d[f]
        if k["kind"] in ("stub", "unknown") and d["kind"] not in ("stub", "unknown"):
            k["kind"] = d["kind"]
        for f in ("notes", "source_note"):
            parts = [x for x in (k[f], d[f]) if x]
            k[f] = " ".join(dict.fromkeys(parts)) if f == "notes" else "; ".join(dict.fromkeys(parts))
        k["sources"] = "+".join(dict.fromkeys(t for t in (k["sources"] + "+" + d["sources"]).split("+") if t))
        if "mvl_lists" in k:
            k["mvl_lists"] = ", ".join(dict.fromkeys(t.strip() for t in (k["mvl_lists"] + "," + d["mvl_lists"]).split(",") if t.strip()))
        for f in ("registered_1963", "registered_mvl"):
            if f in k and d.get(f) and not k.get(f):
                k[f] = d[f]
        if d.get("masterlist_1963") and not k.get("masterlist_1963"):
            k["masterlist_1963"] = d["masterlist_1963"]
        # relations
        for r in self.cultivars.rows:
            if r["sport_of_id"] == drop_id:
                r["sport_of_id"] = keep_id
        seen, newpar = set(), []
        for p in self.parentage.rows:
            c, pa = (keep_id if p["child_id"] == drop_id else p["child_id"]), (keep_id if p["parent_id"] == drop_id else p["parent_id"])
            if c == pa:
                continue                           # a record cannot be its own parent
            key = (c, pa, p["role"])
            if key in seen:
                continue
            seen.add(key)
            newpar.append(dict(p, child_id=c, parent_id=pa))
        self.parentage.rows = newpar
        by_c = {}
        for h in self.hyb.rows:
            c = keep_id if h["cultivar_id"] == drop_id else h["cultivar_id"]
            by_c.setdefault(c, [])
            if h["person_id"] not in [x["person_id"] for x in by_c[c]]:
                by_c[c].append(dict(h, cultivar_id=c))
        self.hyb.rows = [dict(h, position=str(i)) for c, hs in by_c.items() for i, h in enumerate(hs, 1)]
        seen_l, links = set(), []
        for lk in self.links.rows:
            c = keep_id if lk["cultivar_id"] == drop_id else lk["cultivar_id"]
            if (c, lk["url"]) not in seen_l:
                seen_l.add((c, lk["url"]))
                links.append(dict(lk, cultivar_id=c))
        self.links.rows = links
        for im in self.images.rows:
            if im["cultivar_id"] == drop_id:
                im["cultivar_id"] = keep_id
        self.cultivars.rows = [r for r in self.cultivars.rows if r["id"] != drop_id]
        self.add_alias(d["name"], k["name"])
        self.redirects.rows.append({"old_id": drop_id, "new_id": keep_id, "reason": reason, "date": datetime.date.today().isoformat()})
        for rd in self.redirects.rows:               # earlier redirects to the dropped id now point at the kept one
            if rd["new_id"] == drop_id:
                rd["new_id"] = keep_id
        self.reindex()
        self._check_cycles()
        self._log("merge", keep_id, k["name"], "id", drop_id, keep_id, reason)

    def delete(self, cid, reason, force=False):
        r = self._one(cid)
        kids = [p for p in self.parentage.rows if p["parent_id"] == cid]
        if kids and not force:
            raise EditError(f"{r['name']} is a parent of {len(kids)} record(s); delete with force or merge instead")
        self.parentage.rows = [p for p in self.parentage.rows if cid not in (p["child_id"], p["parent_id"])]
        self.hyb.rows = [h for h in self.hyb.rows if h["cultivar_id"] != cid]
        self.links.rows = [x for x in self.links.rows if x["cultivar_id"] != cid]
        for im in self.images.rows:
            if im["cultivar_id"] == cid:
                raise EditError(f"{r['name']} has photos; move them first")
        for x in self.cultivars.rows:
            if x["sport_of_id"] == cid:
                x["sport_of_id"] = ""
        self.cultivars.rows = [x for x in self.cultivars.rows if x["id"] != cid]
        self.reindex()
        self._log("delete", cid, r["name"], "", "", "", reason)

    def add(self, name, reason, **fields):
        base = slugify(name)
        cid, n = base, 1
        while cid in self.by_id:
            n += 1
            cid = f"{base}-{n}"
        row = {c: "" for c in self.cultivars.cols}
        row.update(fields)
        row.update(id=cid, name=name)
        row["kind"] = row["kind"] or "cultivar"
        self.cultivars.rows.append(row)
        self.reindex()
        self._log("add", cid, name, "", "", "", reason)
        return cid

    # ---------------------------------------------------------------- people
    def _person(self, spec, create_kind="person"):
        """a person id from an id or an exact name; created when the name is new"""
        by_id = {p["id"]: p for p in self.people.rows}
        if spec in by_id:
            return spec
        hits = [p for p in self.people.rows if p["name"] == spec]
        if len(hits) == 1:
            return hits[0]["id"]
        if len(hits) > 1:
            raise EditError(f"{len(hits)} people are named {spec!r}; use the id")
        base = slugify(spec)
        pid, n = base, 1
        while pid in by_id:
            n += 1
            pid = f"{base}-{n}"
        self.people.rows.append({"id": pid, "name": spec, "kind": create_kind, "country": "", "aliases": ""})
        self._log("add_person", pid, spec, "", "", "", "created while relinking")
        return pid

    def find_person(self, spec):
        by_id = {p["id"]: p for p in self.people.rows}
        if spec in by_id:
            return spec
        hits = [p["id"] for p in self.people.rows if p["name"] == spec]
        return hits[0] if len(hits) == 1 else None

    def relink_originator(self, text, current_names, new_specs, reason):
        """Cultivars whose printed hybridizer text is `text` and whose hybridizer rows are exactly the people named in
        `current_names` get the people in `new_specs` instead (ids or exact names; a new name creates a person). People left
        with no cultivar are deleted, and when the cultivars move to ONE person the old name is kept in that person's aliases.
        Returns the number of cultivars changed."""
        key = norm(text)
        cur = sorted(current_names)
        by_pid = {p["id"]: p["name"] for p in self.people.rows}
        rows_of = {}
        for h in self.hyb.rows:
            rows_of.setdefault(h["cultivar_id"], []).append(h)
        todo = [c["id"] for c in self.cultivars.rows
                if norm(c["hybridizer_raw"]) == key and sorted(by_pid.get(h["person_id"], "") for h in rows_of.get(c["id"], [])) == cur]
        if not todo:
            raise EditError(f"no cultivar printed as {text!r} is linked to exactly {current_names}")
        new_ids = [self._person(x) for x in new_specs]
        old_ids = {h["person_id"] for cid in todo for h in rows_of.get(cid, [])}
        done = set(todo)
        self.hyb.rows = [h for h in self.hyb.rows if h["cultivar_id"] not in done]
        for cid in todo:
            for i, pid in enumerate(new_ids, 1):
                self.hyb.rows.append({"cultivar_id": cid, "person_id": pid, "position": str(i)})
        still = {h["person_id"] for h in self.hyb.rows}
        gone = [pid for pid in old_ids if pid not in still and pid not in new_ids]
        if len(new_ids) == 1 and gone:
            newp = next(p for p in self.people.rows if p["id"] == new_ids[0])
            names = [x for x in newp["aliases"].split(" | ") if x] + [by_pid[g] for g in gone if by_pid[g] != newp["name"]]
            newp["aliases"] = " | ".join(dict.fromkeys(names))
        self.people.rows = [p for p in self.people.rows if p["id"] not in gone]
        self._log("relink_originator", ",".join(new_ids), text, "hybridizer", "; ".join(current_names), "; ".join(new_specs), reason)
        return len(todo)

    def set_person_kind(self, spec, kind, reason):
        pid = self.find_person(spec)
        if pid is None:
            raise EditError(f"no unique person {spec!r}")
        if kind not in ("person", "organization", "species"):
            raise EditError(f"kind {kind!r}")
        p = next(x for x in self.people.rows if x["id"] == pid)
        old, p["kind"] = p["kind"], kind
        self._log("set_person_kind", pid, p["name"], "kind", old, kind, reason)

    # ---------------------------------------------------------------- checks
    def _check_cycles(self):
        par = {}
        for p in self.parentage.rows:
            par.setdefault(p["child_id"], []).append(p["parent_id"])
        state = {}

        def visit(n):
            state[n] = 1
            for q in par.get(n, []):
                if state.get(q) == 1:
                    raise EditError(f"parentage cycle through {n} -> {q}")
                if q not in state:
                    visit(q)
            state[n] = 2

        sys.setrecursionlimit(10000)
        for n in list(par):
            if n not in state:
                visit(n)

    def validate(self):
        errs = []
        ids = self.by_id
        pe = {p["id"] for p in self.people.rows}
        if len(pe) != len(self.people.rows):
            errs.append("duplicate person ids")
        for p in self.parentage.rows:
            if p["child_id"] not in ids or p["parent_id"] not in ids:
                errs.append(f"parentage {p['child_id']} -> {p['parent_id']} has an unknown record")
        for h in self.hyb.rows:
            if h["cultivar_id"] not in ids or h["person_id"] not in pe:
                errs.append(f"hybridizer row {h['cultivar_id']} / {h['person_id']} is dangling")
        for x in self.links.rows:
            if x["cultivar_id"] not in ids:
                errs.append(f"link of unknown record {x['cultivar_id']}")
        for im in self.images.rows:
            if im["cultivar_id"] not in ids:
                errs.append(f"image {im['file']} of unknown record {im['cultivar_id']}")
        regs = {}
        for r in self.cultivars.rows:
            if r["kind"] not in KINDS:
                errs.append(f"{r['id']}: kind {r['kind']!r}")
            if r["sport_of_id"] and r["sport_of_id"] not in ids:
                errs.append(f"{r['id']}: sport_of_id {r['sport_of_id']!r} unknown")
            if r["registration_no"]:
                if r["registration_no"] in regs:
                    errs.append(f"registration number {r['registration_no']} on {regs[r['registration_no']]} and {r['id']}")
                regs[r["registration_no"]] = r["id"]
        try:
            self._check_cycles()
        except EditError as e:
            errs.append(str(e))
        return errs

    # ---------------------------------------------------------------- write
    def save(self):
        errs = self.validate()
        if errs:
            raise EditError("not saved, the master would be inconsistent:\n  " + "\n  ".join(errs[:10]))
        for t in (self.cultivars, self.parentage, self.people, self.hyb, self.links):
            t.save()
        if self.images.cols:
            self.images.save()
        if self.redirects.rows:
            self.redirects.save()
        self.aliases.save()
        if self.log:
            hist = Table(self.hist_path, required=False)
            if not hist.cols:
                hist.cols, hist.eol = HISTORY_COLS, "\r\n"
            hist.rows += self.log
            hist.save()
            self.log = []


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("op", choices=["set", "rename", "merge", "delete", "validate"])
    ap.add_argument("--root")
    ap.add_argument("--name")
    ap.add_argument("--id")
    ap.add_argument("--field")
    ap.add_argument("--value")
    ap.add_argument("--new-name")
    ap.add_argument("--keep")
    ap.add_argument("--drop")
    ap.add_argument("--reason", default="")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    m = Master(a.root)
    try:
        if a.op == "validate":
            errs = m.validate()
            print("\n".join(errs) if errs else "master is consistent")
            return 1 if errs else 0
        if not a.reason:
            ap.error("--reason is required")
        if a.op == "set":
            print(m.set_field(a.id or a.name, a.field, a.value or "", a.reason), "record(s) changed")
        elif a.op == "rename":
            m.rename(a.id, a.new_name, a.reason)
        elif a.op == "merge":
            m.merge(a.keep, a.drop, a.reason, a.force)
        elif a.op == "delete":
            m.delete(a.id, a.reason, a.force)
        if a.dry_run:
            print("(dry run: nothing written)", *[f"{x['op']} {x['cultivar_id']} {x['field']}" for x in m.log])
            print("\n".join(m.validate()) or "consistent")
        else:
            m.save()
    except EditError as e:
        print("ERROR:", e)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
