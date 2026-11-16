"""Apply the decisions typed in reports/outstanding_checks.csv to the MASTER data (notes/freeze-plan.md, phase 2).

Every change to the master goes through scripts/master_edit.py (logged to reports/decision_history/master_edits.csv). Each applied row
is appended to reports/decision_history/applied_checks.csv and removed from outstanding_checks.csv. Rows without a decision, and rows whose
decision cannot be applied (the reason is printed), stay in the file.

Columns that matter: record_id = the cultivar's id in the master (empty for a HELD supplement plant that is not in the master yet);
plant_key = the frozen MVL plant (data/mvl_supplements.csv); target_key = the other record of a pair (an id; for name pairs a name).

Decisions by check_type (case-insensitive). `set:<field>=<value>` works on any row that has a record_id.
  spelling near-miss of an MLV name   (held plant)   mlv | keep | different
                                      mlv = the supplement entry is the MLV spelling: imported under `mlv_name` with number `mlv_reg`,
                                      or merged into the record of that name; keep / different = imported under the supplement spelling
  same name as another plant, no hybridizer  (held)  release | separate  (import as its own record)  |  join:<record id>
  description split needs review      (held)         accept             (import with the split as it is)
  same name, hybridizer differs or unknown            join  (merge record_id into target_key)  |  separate (nothing changes)
  registration number shared by several plants        rename:<Name>  (rename record_id, or merge it into the record of that name)  |
                                                      different | keep (nothing changes)
  source row disagrees with record                    record (keep)  |  source (value in `proposal`)  |  set:<field>=<value>
  possible duplicate or misspelled name               merge:<correct name>  |  separate
  book entry vs existing record (1963)                join  (merge record_id into target_key)  |  separate
  OCR review (1963)                                   drop (delete record_id)  |  keep  |  set:<field>=<value>
After a run no import step is needed: build_db.py -> export_ancestry_xlsx.py.
Usage: python scripts/apply_check_decisions.py [--write] [--root DIR]     (default: a dry run that only reports)
"""
import argparse
import datetime
import re
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import master_edit as me  # noqa: E402
from names_lib import cname, norm  # noqa: E402

CHECK_COLS = ["check_id", "group_id", "source", "check_type", "tier", "name", "hybridizer", "lists_or_year", "record_id", "plant_key",
              "reg_no", "reg_date", "mlv_name", "mlv_hybridizer", "mlv_reg", "mlv_date", "description", "detail", "proposal",
              "target_key", "first_class_name", "first_class_hybridizer", "first_class_reg_date", "decision", "note"]
SEEDLING = re.compile(r"^\d{1,2}-\d{1,3}-\d{1,3}$|^seedling\b", re.I)


def rd(path):
    return pd.read_csv(path, dtype=str, keep_default_na=False, encoding="utf-8-sig")


class Applier:
    def __init__(self, root):
        self.root = Path(root)
        self.m = me.Master(root)
        d = self.root / "data"
        self.plants = rd(d / "mvl_supplements.csv") if (d / "mvl_supplements.csv").exists() else pd.DataFrame()
        self.split = rd(d / "mvl_description_split.csv") if (d / "mvl_description_split.csv").exists() else pd.DataFrame()
        self.xrefs = rd(d / "mvl_crossrefs.csv") if (d / "mvl_crossrefs.csv").exists() else pd.DataFrame()
        self.released = set()

    # ---------------------------------------------------------------- held MVL plants -> master
    def plant(self, key):
        p = self.plants[self.plants.plant_key == key]
        if p.empty:
            raise me.EditError(f"plant {key!r} is not in data/mvl_supplements.csv")
        s = self.split[self.split.plant_key == key]
        return dict(p.iloc[0]), (dict(s.iloc[0]) if len(s) else {})

    def import_plant(self, key, name=None, reg=None, join_id=None):
        """put a held supplement plant into the master: as a new record, or filling the EMPTY fields of record join_id"""
        P, S = self.plant(key)
        m = self.m
        name = cname(name or P["name"])
        reg = P["registration_no"] if reg is None else reg
        if reg and any(r["registration_no"] == reg and r["id"] != join_id for r in m.cultivars.rows):
            holder = next(r for r in m.cultivars.rows if r["registration_no"] == reg and r["id"] != join_id)
            note_reg = f"Registration number {reg} is listed for {holder['name']}; not set here."
            reg = ""
        else:
            note_reg = ""
        lists = [y for y in P["lists"].split(";") if y]
        listing = "AVSA Master List supplement" + ("s " if len(lists) > 1 else " ") + ", ".join(lists)
        if P["spelling"] == "spelling_unchecked":
            listing += "; spelling not checked against the AVSA Master Variety List"
        xr = [f"Also listed as {cname(r['alias'])} in the {r['list_year']} Master List supplement."
              for _, r in self.xrefs[self.xrefs.target_plant_key == key].iterrows()] if len(self.xrefs) else []
        if P["supplement_spelling"] and norm(P["supplement_spelling"]) != norm(name):
            xr.append(f"Also listed as {cname(P['supplement_spelling'])} in the {lists[-1] if lists else ''} Master List supplement.")
        if join_id:
            d = m._one(join_id)
            if not d["description"] and P["description"]:
                d["description"] = P["description"]
                for f in ("color", "bloom_description", "foliage_description"):
                    if not d[f] and S.get(f):
                        d[f] = S[f]
            if not d["size_class"] and P["size_class"]:
                d["size_class"] = P["size_class"]
            if reg and not d["registration_no"]:
                d["registration_no"] = reg
                if P["registered_date"] and not d["registered_date"]:
                    d["registered_date"] = P["registered_date"]
                    d["registered_year"] = P["registered_date"][:4]
            if not d["hybridizer_raw"] and P["hybridizer"]:
                d["hybridizer_raw"] = P["hybridizer"]
            if P["registered"] == "yes":
                d["registered_mvl"] = "1"
            d["sources"] = "+".join(dict.fromkeys(t for t in (d["sources"] + "+mvl_supp").split("+") if t))
            d["mvl_lists"] = ", ".join(dict.fromkeys(t.strip() for t in (d["mvl_lists"] + "," + ", ".join(lists)).split(",") if t.strip()))
            d["source_note"] = "; ".join(dict.fromkeys(x for x in (d["source_note"], listing) if x))
            d["notes"] = " ".join(x for x in [d["notes"]] + xr + ([note_reg] if note_reg else []) if x)
            if d["kind"] == "stub":
                d["kind"] = "cultivar"
            cid = join_id
            m._log("import_plant", cid, d["name"], "plant", key, "joined", "released from the held supplement plants")
        else:
            kind = "species" if P["kind"] == "species" else ("seedling" if SEEDLING.match(name) else "cultivar")
            fields = dict(kind=kind, size_class=P["size_class"], registration_no=reg,
                          registered_date=P["registered_date"] if reg else "",
                          registered_year=(P["registered_date"][:4] if reg and P["registered_date"] else ""),
                          description=P["description"], hybridizer_raw=P["hybridizer"], sources="mvl_supp", source_note=listing,
                          mvl_lists=", ".join(lists), registered_mvl="1" if P["registered"] == "yes" else "",
                          notes=" ".join(xr + ([note_reg] if note_reg else [])))
            if P["description"]:
                fields.update(color=S.get("color", ""), bloom_description=S.get("bloom_description", ""),
                              foliage_description=S.get("foliage_description", ""))
            cid = m.add(name, "released from the held supplement plants", **fields)
        self.released.add(key)
        return cid

    # ---------------------------------------------------------------- helpers
    def rec(self, c):
        rid = c["record_id"]
        if not rid or rid not in self.m.by_id:
            raise me.EditError(f"{c['name']}: no record id in the master (record_id={rid!r})")
        return rid

    def same_name(self, name, exclude=()):
        return [i for i in self.m.select(name) if i not in exclude]

    def rename_or_merge(self, rid, new_name, reason):
        twins = self.same_name(new_name, exclude=(rid,))
        if twins:
            self.m.merge(twins[0], rid, reason)
            return f"merged into {self.m.by_id[twins[0]]['name']} [{twins[0]}]"
        self.m.rename(rid, new_name, reason)
        return f"renamed to {new_name}"

    # ---------------------------------------------------------------- one decision
    def apply(self, c):
        d, low, t = c["decision"].strip(), c["decision"].strip().lower(), c["check_type"]
        reason = "User confirmed against the First Class database" + (f" ({c['note']})" if c["note"] else "")
        m = self.m
        if low.startswith("set:") and c["record_id"]:
            fld, _, val = d[4:].partition("=")
            m.set_field(self.rec(c), fld.strip(), val.strip(), reason)
            return f"{c['name']}: {fld.strip()} set"
        if t == "spelling near-miss of an MLV name":
            if low == "mlv":
                target = self.same_name(c["mlv_name"])
                if target:
                    cid = self.import_plant(c["plant_key"], join_id=target[0], reg=c["mlv_reg"])
                    return f"{c['name']} -> joined {m.by_id[cid]['name']} [{cid}]"
                cid = self.import_plant(c["plant_key"], name=c["mlv_name"], reg=c["mlv_reg"])
                return f"{c['name']} -> imported as {c['mlv_name']} [{cid}] (number {c['mlv_reg'] or 'none'})"
            if low in ("keep", "different"):
                cid = self.import_plant(c["plant_key"])
                return f"{c['name']} -> imported as printed [{cid}]"
        elif t == "same name as another plant, no hybridizer":
            if low in ("release", "separate"):
                cid = self.import_plant(c["plant_key"])
                return f"{c['name']} -> imported as its own record [{cid}]"
            if low.startswith("join:"):
                cid = self.import_plant(c["plant_key"], join_id=d.split(":", 1)[1].strip())
                return f"{c['name']} -> joined [{cid}]"
        elif t == "description split needs review":
            if low == "accept":
                cid = self.import_plant(c["plant_key"])
                return f"{c['name']} -> imported [{cid}]"
        elif t in ("same name, hybridizer differs or unknown", "book entry vs existing record"):
            if low == "join":
                if not c["target_key"] or c["target_key"] not in m.by_id:
                    raise me.EditError(f"{c['name']}: no target record id")
                m.merge(c["target_key"], self.rec(c), reason)
                return f"{c['name']}: merged into {m.by_id[c['target_key']]['name']} [{c['target_key']}]"
            if low == "separate":
                return f"{c['name']}: kept separate"
        elif t == "registration number shared by several plants":
            if low.startswith("rename:"):
                return f"{c['name']}: {self.rename_or_merge(self.rec(c), d.split(':', 1)[1].strip(), reason)}"
            if low in ("different", "keep"):
                return f"{c['name']}: closed (no change)"
        elif t == "source row disagrees with record":
            if low in ("record", "keep"):
                return f"{c['name']}: record value kept"
            if low == "source":
                fld, _, val = c["proposal"].partition("=")
                if not (fld and val):
                    raise me.EditError(f"{c['name']}: no proposed value; use set:<field>=<value>")
                m.set_field(self.rec(c), fld, val, reason)
                return f"{c['name']}: {fld} -> {val}"
        elif t == "possible duplicate or misspelled name":
            if low == "separate":
                return f"{c['name']} / {c['target_key']}: kept separate"
            if low.startswith("merge:"):
                canon = d.split(":", 1)[1].strip()
                ids = {n: self.same_name(n) for n in (c["name"], c["target_key"])}
                for n, v in ids.items():
                    if len(v) != 1:
                        raise me.EditError(f"{n!r}: {len(v)} records with that name; merge by id with master_edit.py")
                keep_name = c["name"] if norm(c["name"]) == norm(canon) else c["target_key"]
                drop_name = c["target_key"] if keep_name == c["name"] else c["name"]
                if norm(keep_name) != norm(canon):
                    m.rename(ids[keep_name][0], canon, reason)
                m.merge(ids[keep_name][0], ids[drop_name][0], reason)
                return f"{c['name']} / {c['target_key']}: merged into {canon}"
        elif t == "OCR review":
            if low == "keep":
                return f"{c['name']}: kept"
            if low == "drop":
                m.delete(self.rec(c), reason)
                return f"{c['name']}: record deleted"
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--root", default=str(Path(__file__).resolve().parents[1]))
    a = ap.parse_args()
    root = Path(a.root)
    rep = root / "reports"
    checks = rd(rep / "outstanding_checks.csv")
    ap_ = Applier(root)
    applied, kept, msgs = [], [], []
    for _, c in checks.iterrows():
        c = dict(c)
        if not c["decision"].strip():
            kept.append(c)
            continue
        try:
            res = ap_.apply(c)
        except me.EditError as e:
            res, err = None, str(e)
        else:
            err = "decision not recognised for this check type"
        if res is None:
            kept.append(c)
            msgs.append(f"NOT APPLIED {c['check_id']} {c['check_type']}: {c['name']} -> {c['decision']!r}: {err}")
        else:
            applied.append((c, res))
            msgs.append(f"{c['check_id']} {res}")
    print("\n".join(msgs) or "no decisions to apply")
    print(f"{len(applied)} applied, {len(kept)} rows stay in outstanding_checks.csv")
    if not a.write:
        print("(dry run: nothing written; use --write)")
        return
    errs = ap_.m.validate()
    if errs:
        print("master would be inconsistent, nothing written:", *errs[:5], sep="\n  ")
        return 1
    ap_.m.save()
    if ap_.released:
        d = root / "data"
        ap_.plants[~ap_.plants.plant_key.isin(ap_.released)].to_csv(d / "mvl_supplements.csv", index=False, encoding="utf-8")
        if len(ap_.split):
            ap_.split[~ap_.split.plant_key.isin(ap_.released)].to_csv(d / "mvl_description_split.csv", index=False, encoding="utf-8")
        if len(ap_.xrefs):
            ap_.xrefs[~ap_.xrefs.target_plant_key.isin(ap_.released)].to_csv(d / "mvl_crossrefs.csv", index=False, encoding="utf-8")
    if applied:
        hist = rep / "decision_history" / "applied_checks.csv"
        hist.parent.mkdir(parents=True, exist_ok=True)
        rows = [dict(c, applied=datetime.date.today().isoformat(), result=r) for c, r in applied]
        old = rd(hist) if hist.exists() and hist.stat().st_size else pd.DataFrame()
        pd.concat([old, pd.DataFrame(rows)], ignore_index=True).to_csv(hist, index=False, encoding="utf-8-sig")
    pd.DataFrame(kept, columns=CHECK_COLS).to_csv(rep / "outstanding_checks.csv", index=False, encoding="utf-8-sig")


if __name__ == "__main__":
    sys.exit(main())
