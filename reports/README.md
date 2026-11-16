# reports/

Only what is current stays at the top level; everything from a finished, single-use source is filed under `historical/`.

| path | what it is |
|---|---|
| `outstanding_checks.csv` / `.md` | **current work**: every cultivar, originator and number still to be checked. Type a `decision`, then `python scripts/apply_check_decisions.py --write` |
| `submission_import.md` | written by every `import_submissions.py apply` (what was created, held or in conflict) |
| `submission_photos/` | (git-ignored) staging folder for photos of future contributor submissions (`import_submissions.py apply --photos-dir`) |
| `decision_history/` | the record of decisions already made and applied: review files, `applied_checks.csv`, `master_edits.csv`, the database baseline. No script reads these |
| `historical/` | reports of one-off sources, by source: `original_sources_import/` (xlsx + sqlite import flags and summary), `masterlist1963/`, `mvl_supplements/`, `inventory_2004_2022/`, `sports_page/` (AVSA sports page), `submissions/` (the Rivermist batch photos, already in `data/images.csv`), `wordpress_photos/` (paused WordPress photo project: manifest, credit review, decisions) |

The scripts that wrote the historical reports are in `scripts/archive/` and now write into `historical/`.
