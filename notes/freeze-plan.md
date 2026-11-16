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

## Phase 2 (later, only if wanted): freeze the whole baseline
Make `data/cultivars.csv`, `parentage.csv`, `cultivar_hybridizers.csv`, `people.csv` the master and retire `import_excel.py` from
the routine run (bootstrap tool only); `data_corrections`, `parent_corrections`, `name_corrections` become one-time edits plus
history. Needs its own plan: how a new source or a correction merges into a master that has been edited.

## Not in scope / open questions
- People mapping files (`outstanding_originator_mapping.csv` 1,716 undecided, `hybridizer_mapping.csv`) are not cultivar checks; keep them
  as they are unless you want them in the same file.
- Whether the 2010-2019 supplements and the AVM registration lists/reports have undecided items is unknown until the inventory.
- Names in `outstanding_checks.csv` that First Class does not list: record as `not in First Class` in `note` (as done for
  Tennessee Mist, Alamo Bewitchin' Jeannie).
- Risk: operations in step 3 re-implement part of the prep script's clustering rules on frozen rows; each operation gets a
  test against a known case (Spinnaker, Reed's Jackpot, Rhapsodie Marilyn II).
