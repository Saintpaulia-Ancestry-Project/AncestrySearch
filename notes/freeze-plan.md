# Freeze decided data: draft plan (MVL supplements first)

Status: PHASE 1 DONE (MVL supplements frozen; see CLAUDE.md). Phase 2 not started.

## Principle (user)

Once content has been imported into the site database and decided on, it is not imported again. The import only looks at
the work still to have decisions made. Decisions already made become the historical record of the project
(`reports/decision_history/`). The historical AVML supplements are a one-off source: AVM has not released a supplement since 2019.

## Today (why it is slow and fragile)

`data/cultivars.csv` and its siblings are OUTPUTS. Every run recomputes every cultivar from the original sources:

    sources + review files -> prep_mvl_supplements.py -> data/mvl_supplements.csv (~145 s)
                           -> split_mvl_descriptions.py -> import_excel.py (~38 s) -> build_db.py -> export

So a decision (join, spelling, row rename, correction) is kept as a live input forever; deleting it undoes the work, and a
bug in how a decision file is rewritten loses it (this happened to 18 `join` decisions in mvl_matches.csv, now fixed).

## Phase 1: MVL supplements (this draft)

### 1. Freeze
- `data/mvl_supplements.csv`, `data/mvl_crossrefs.csv` and `data/mvl_description_split.csv` become hand-maintained data (same
  precedent as `data/description_split.csv`). They already contain every decision made so far (names, numbers, dates, merged
  plants, split fields). Nothing regenerates them.
- `scripts/prep_mvl_supplements.py` and `split_mvl_descriptions.py` leave the routine pipeline (the prep script is local-only
  because it reads MLV.xls; keep a copy in the private repo as the archived tool that made the file).
- Pipeline becomes: `import_excel.py -> import_submissions.py apply -> build_db.py -> export_ancestry_xlsx.py` (saves ~2.5 min).
- Check: after the change `data/cultivars.csv`, `parentage.csv`, `people.csv` must be byte-identical to the snapshot taken before.

### 2. One file for everything still to check: `reports/outstanding_checks.csv`
One row per cultivar entry that still needs a person's decision; rows of one question share a `group_id`.
Covers all supplement data, the 1963 book and the AVM content:

| source | what goes in |
|---|---|
| MVL supplements 1964-2002 | the 418 undecided spelling near-misses (`mvl_spelling.csv`), the held-back plants (`mvl_held_back.csv`: same name without hybridizer; split reviews), the First Class worksheet's "Check against First Class" rows |
| MVL supplements | shared registration numbers: same name apart (52 groups), similar names tier C (23), different names tier C-like leftovers (`mvl_regno.csv`) |
| MVL supplements | name matches with a different hybridizer awaiting a decision (`mvl_join_matches.csv`, `mvl_matches.csv`) |
| 1963 book | `masterlist_matches.csv` (426 undecided), `masterlist_ocr_review.csv` (313 without `use`) |
| AVM registration reports / lists, AVML 2010-2019 | anything undecided (inventory in step 2 of the migration) |

Columns: `check_id, group_id, source, check_type, tier, name, hybridizer, lists_or_year, reg_no, reg_date, mlv_name,
mlv_hybridizer, mlv_reg, mlv_date, description, proposal, first_class_name, first_class_hybridizer, first_class_reg_date,
decision, note`. `decision` vocabulary per `check_type` (e.g. spelling: `mlv | keep | different`; shared number: `rename | join |
different`). The public file holds no MLV description text (MLV.xls is private); the private First Class worksheet
(`AVAncestry-private/AVM/MVL_extracts/spelling_check/`) is generated FROM this file and adds the MLV description.
`reports/outstanding_checks.md` summarises counts per source and type.

Decided in this plan: `mvl_recent_conflicts.csv` uses the MLV dates (the 6 undecided get `mlv`) and drops out of the check file.

### 3. Apply decisions: `scripts/apply_check_decisions.py`
Reads `decision` in `outstanding_checks.csv`, edits the frozen CSVs with a small fixed set of operations
(rename a printed row, merge plants, set number/date from MLV or First Class, release a held plant), appends each applied
decision to `reports/decision_history/`, removes the row from the outstanding file. Then `import_excel.py` ... as above.
It never rebuilds anything that was already decided.

### 4. Decision history: `reports/decision_history/`
Moved here (read-only record; no script reads them):
`mvl_spelling_decided.csv` (112 + 1), `mvl_matches_joined.csv` (the 12 joins), `mvl_row_names.csv` (112 renames),
`mvl_recent_conflicts_decided.csv` (131 + the 6 MLV ones), `mvl_regno_log.csv` ("differs (MLV used)" rows),
`mvl_join_matches_decided.csv`, `mvl_split_review` accepted rows, `name_corrections.csv` alias rows (the former
`name_near_misses` merges). Each file keeps its reasons and the "User confirmed against the First Class database" notes.
The review files in `reports/review/` that only held decisions for the frozen supplements are deleted afterwards.

### 5. Migration steps and verification
1. Snapshot `data/*.csv` and `site/avancestry.sqlite`.
2. Apply the 6 recent conflicts (`mlv`), then run the prep script ONE LAST TIME so the frozen CSV holds the last decisions.
3. Generate `outstanding_checks.csv` (+ the .md summary and the private worksheet) from the current review files.
4. Move decided rows into `decision_history/`; stop reading the review files (edit `import_excel.py`: `attach_mvl` already
   reads only the frozen CSV; remove its dependence on `mvl_held_back.csv` / `mvl_join_matches*.csv` by storing the hold in the
   CSV as a `hold_reason` column, which already exists).
5. Run the pipeline: `cultivars.csv` etc. identical to the snapshot; the sqlite differs only by build time.
6. Update CLAUDE.md (pipeline order, "MVL supplements" section, review files), notes/mvl-supplements-plan.md.

## Phase 2: freeze the whole baseline (DRAFT, nothing done yet)

User decision: `source/AfricanVioletAncestry.sqlite` and `.xlsx` are historical and never change. The AVML supplements 1964-2019,
the 1963 book and the magazine registration reports are one-off sources too. Whatever has been decided and imported from them is
never imported again.

### What `import_excel.py` still does on every run (the thing to remove)
Reads, in one pass, and rebuilds `data/cultivars.csv`, `parentage.csv`, `people.csv`, `cultivar_hybridizers.csv`,
`cultivar_links.csv` (about 38 s; `import_submissions.py apply` then adds the contributor submissions on top):

| input | kind |
|---|---|
| `source/AfricanVioletAncestry.xlsx` (Name sheet), `.sqlite` (Varieties) | historical source |
| `source/AV-MasterLIstSupplements/2010..2019/AVML-*.xlsx` | historical source (2010-2019 To Do) |
| `data/registration_reports.csv`, `registration_lists.csv` | historical source (magazine) |
| `data/masterlist1963.csv` (made by `merge_masterlist1963.py` from the two OCRs) | historical source |
| `data/mvl_supplements.csv`, `mvl_description_split.csv`, `mvl_crossrefs.csv` | already frozen in phase 1, but still joined on every run |
| `reports/review/`: `sqlite_duplicates`, `data_corrections`, `parent_corrections`, `name_corrections`, `hybridizer_mapping`, `outstanding_originator_mapping`, `parent_originator_matches`, `masterlist_matches` | decisions re-applied every run |
| `data/submissions/*.csv` (apply step) | live (new contributions); already idempotent ("already applied: skipped") |

`build_db.py` also reads `data/description_split.csv`, `sports_page.csv`, `images.csv` and `data/pages/`: these are already
hand-maintained data and stay as they are.

### Target
1. **Master data.** `cultivars.csv`, `parentage.csv`, `people.csv`, `cultivar_hybridizers.csv`, `cultivar_links.csv` become
   hand-maintained master files (same precedent as `description_split.csv`). Nothing regenerates them. The sources above stay in
   `source/` for audit but no routine script reads them.
2. **Pipeline:** `apply_check_decisions.py` (when there are decisions) -> `import_submissions.py apply` -> `build_db.py` ->
   `export_ancestry_xlsx.py`. About 10 seconds.
3. **`import_excel.py` and the scripts that feed it** (`merge_masterlist1963.py`, `parse_masterlist1963.py`, `inspect_excel.py`,
   `propose_review.py`) move to `scripts/archive/` with a README line: "bootstrap tools; they reproduce the master from the
   sources for an audit and are not part of the routine pipeline". The review files they read move to `reports/decision_history/`
   (read by no script). Deleted from `reports/review/`: `sqlite_duplicates`, `data_corrections`, `parent_corrections`,
   `name_corrections`, `hybridizer_mapping`, `parent_originator_matches`, `masterlist_matches`.
4. **Edits to the master go through one tool, `scripts/master_edit.py`** (not by hand, so every change is logged to
   `reports/decision_history/master_edits.csv` with who/why/when). Operations: set a field (`data_corrections` becomes this),
   rename (id stays; the old spelling goes to the notes, as `name_corrections` does today), merge record B into A (rewrites
   `parentage`, `cultivar_hybridizers`, `cultivar_links`, `images.csv`; B's id is kept as a redirect row so old links and
   bookmarks still work), add/delete a record, link an originator to a person, set a parent cell. `apply_check_decisions.py`
   calls it, so the MVL, 1963-book and 2003-2022 checks all end in the master directly. After this the phase-1 frozen
   `mvl_*.csv` files are history too (their plants are in the master; check rows then point at master ids).
5. **Contributor submissions** stay live and stay incremental: they are applied to the master, then recorded in
   `decision_history/applied_submissions.csv` so a file is never re-applied.
6. **Provenance is kept** in the master's `sources`, `source_note`, `notes`, `mvl_lists` columns (already there), so nothing is
   lost when the importer is retired.

### Migration (one commit per step, each verified)
1. Snapshot `data/*.csv` and `site/avancestry.sqlite`; the snapshot after every step must give an identical `avancestry.sqlite`
   (table-by-table dump compare, not file bytes).
2. Write `master_edit.py` with tests for each operation (known cases: Spinnaker/Reed's Jackpot merge and rename, a hybridizer
   correction, a name alias merge, an originator link).
3. Move the review-file rows into `decision_history/`, switch `apply_check_decisions.py` from the phase-1 CSVs to the master,
   convert the live `outstanding_checks.csv` target keys (`mvl` plant keys) to master record ids.
4. Archive the import scripts; update `.github` workflow if it calls any of them (today it runs `build_db.py` and the export only);
   rewrite the Status / Pipeline / Source data sections of CLAUDE.md.
5. Run the full pipeline and compare: the master CSVs unchanged from step 1, the sqlite identical.

### Progress
- Step 1 DONE: baseline fingerprint of the database (`reports/decision_history/phase2_baseline_fingerprint.json`, made by
  `scripts/db_fingerprint.py`; compare after every step), `scripts/master_edit.py` + `scripts/test_master_edit.py` (round trip of the
  six master files is byte-identical; set / rename / merge / delete / validate tested; a refused merge leaves nothing half-done).
- Shared helpers step DONE: `scripts/names_lib.py` now holds `clean, cname, norm, slugify, parse_date, ORG_RE, COUNTRIES, pkey, PLACEHOLDER,
  SELF_RE, stub_kind` and `K()`; `import_excel.py` imports them from there, `submissions_lib.py` no longer imports `import_excel` at all.
  `K()` follows `data/name_aliases.csv` (89 alias rows, generated once from the importer's alias map; `names_lib.K` equals
  `import_excel.K` for every name and alias). `master_edit.py` keeps that file current (rename / merge add an alias). Checked: the five
  master CSVs and the database fingerprint are identical after `import_excel.py` + `import_submissions.py apply` + `build_db.py`.
- Step 3 DONE (re-scoped): `apply_check_decisions.py` now works on the master through `master_edit.py` (rewritten; 8 decision types;
  `scripts/test_apply_check_decisions.py` passes). `reports/outstanding_checks.csv` has `record_id` / `plant_key` columns (made by
  `scripts/convert_outstanding_to_master.py` from a key map of one last importer run). A held supplement plant is imported into the
  master when its decision is made. The routine pipeline no longer runs `import_excel.py`: `import_submissions.py apply` (83 rows
  skipped as already applied) -> `build_db.py` -> export; master byte-identical and database fingerprint identical. The seven review
  files stay where they are until step 4 (archive), because `import_excel.py` still reads them.
- Step 4 DONE: `import_excel.py`, `merge_masterlist1963.py`, `parse_masterlist1963.py`, `inspect_excel.py`, `propose_review.py` and the two one-time
  migration scripts are in `scripts/archive/` (README there; `import_excel.py` refuses to run without `AV_ALLOW_BOOTSTRAP=1`). Nine decided
  review files moved to `reports/decision_history/`. Checked: the archived importer run on a COPY of the repository plus
  `import_submissions.py apply` reproduces the five master CSVs byte for byte; the routine pipeline and the database fingerprint
  are unchanged. Left in `reports/review/`: the WordPress photo review files and the AVSA sports-page review files (their own imports).
- Decision (user): ids that are no longer in the site database are NOT a concern (the live site is new and little known, the data is still
  being worked on). No redirect support in the front end for now; `master_edit.py` still records every merge in
  `data/id_redirects.csv` (old id -> kept id) so the front end could use it later, when the site is widely linked.
- Originator linking DONE (user decision: build it as a check type): the 1,714 undecided rows of the originator mapping are in
  `outstanding_checks.csv` (type `originator text vs person`; the old file is `decision_history/originator_mapping.csv`);
  `master_edit.relink_originator` / `set_person_kind` and the apply handler are tested.
- DATA HIERARCHY (user decision): First Class > MLV.xls > the supplement, field by field. For a held spelling near-miss decided `mlv`,
  `outstanding_checks.csv` has `mlv_date` / `mlv_size` (one-time local read of MLV.xls: MLV row found for all 429; 276 with a date, 414 with
  a size) and the MLV only fills what First Class does not give. What the user types from First Class (`first_class_name`,
  `first_class_hybridizer`, `first_class_reg_date` as "6616 05/25/1987", `first_class_size`) always wins, also over the values of an existing
  record the plant is merged into. For `keep` / `different` (not the MLV cultivar) the MLV is not used at all.
- Still to do (old list, partly done): step 2 (originally merged with step 1: the id redirect is only recorded in `data/id_redirects.csv`; the site does
  not use it yet), step 3 (switch `apply_check_decisions.py` to the master), step 4 (archive), step 5 (full compare).

### Risks and what stays outside
- A correction to a source now means a logged edit to the master; the sources can no longer be re-read to "start over".
  (`git` history of the master files and the archived bootstrap tools are the way back.)
- The Pages workflow and `build_db.py` already build from the committed CSVs, so the site is unaffected.
- Local mode (`mydata.sqlite`), the submission form and the images repo are unaffected.
- People mapping (`outstanding_originator_mapping.csv`, `hybridizer_mapping.csv`) keep their own outstanding file: unlinked
  originators are not cultivars, but linking one becomes a `master_edit.py` operation.
- Effort: step 2 (the merge operation across five tables and `images.csv`) is the real work; the rest is moving files.

## Not in scope / open questions
- People mapping files (`outstanding_originator_mapping.csv` 1,716 undecided, `hybridizer_mapping.csv`) are not cultivar checks; keep them
  as they are unless you want them in the same file.
- The 2003-2022 sources were inventoried (reports/inventory_2004_2022_sources.md; their checks are in outstanding_checks.csv).
- Names in `outstanding_checks.csv` that First Class does not list: record as `not in First Class` in `note` (as done for
  Tennessee Mist, Alamo Bewitchin' Jeannie).
- Risk: operations in step 3 re-implement part of the prep script's clustering rules on frozen rows; each operation gets a
  test against a known case (Spinnaker, Reed's Jackpot, Rhapsodie Marilyn II).
