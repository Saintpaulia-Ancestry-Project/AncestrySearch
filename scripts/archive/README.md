# Archived bootstrap tools

These scripts made the master data (`data/cultivars.csv`, `parentage.csv`, `people.csv`, `cultivar_hybridizers.csv`,
`cultivar_links.csv`) from the original sources. The sources are historical and the master is now edited only through
`scripts/master_edit.py`, `scripts/apply_check_decisions.py` and `scripts/import_submissions.py` (notes/freeze-plan.md, phase 2).
They are kept so the project can be audited and the master reproduced; they are NOT part of the routine pipeline.

| script | what it did |
|---|---|
| `import_excel.py` | read the xlsx, the sqlite, the AVML supplements 1964-2019, the magazine reports, the 1963 book and all review files; wrote the master. **It overwrites the master**: it refuses to run unless `AV_ALLOW_BOOTSTRAP=1` and should only be run on a COPY of the repository |
| `merge_masterlist1963.py`, `parse_masterlist1963.py` | made `data/masterlist1963.csv` from the two OCRs of the 1963 book |
| `inspect_excel.py`, `propose_review.py` | first inspection of the sources and the first review proposals |
| `freeze_mvl_supplements.py` | one-time: froze the MVL supplements and built `reports/outstanding_checks.csv` (phase 1) |
| `convert_originators_to_checks.py` | one-time: moved the undecided originator-mapping rows into `reports/outstanding_checks.csv` |
| `convert_outstanding_to_master.py` | one-time: gave every outstanding check its master record id (phase 2, step 3) |

The decisions these tools read are in `reports/decision_history/` (sqlite_duplicates, data_corrections, parent_corrections,
name_corrections, hybridizer_mapping, parent_originator_matches, masterlist_matches, masterlist_ocr_review, registration_changes,
the MVL decision files, applied_checks, master_edits). `reports/review/` keeps only what is still open or used by another import
(the WordPress photo review files, the AVSA sports-page review files; the originator mapping became a check type, see `reports/outstanding_checks.csv`).
Checked at the move: `import_excel.py` run on a copy of the repository, followed by `import_submissions.py apply`, reproduced the
five master CSVs byte for byte.
The MVL preparation scripts (`prep_mvl_supplements.py`, `split_mvl_descriptions.py`; they read the private MLV.xls) are in
`AVAncestry-private/AVM/MVL_extracts/frozen_pipeline_tools/`.

Added with the reports clean-up: `scrape_wp_download.py`, `scrape_wp_fetch.py`, `scrape_wp_manifest.py` (the paused WordPress photo project;
they read and write `reports/historical/wordpress_photos/`) and `import_sports_page.py` (the AVSA sports page import; its source HTML is not
on this machine; it writes `reports/historical/sports_page/`; `build_db.py` still applies `data/sports_page.csv`). Reports written by the
other archived scripts now go to `reports/historical/<source>/`.

Added with the AVSA gallery wrap-up (2026-11-17): `match_avsa_gallery.py` (matched the saved AVSA Photo Gallery pages to cultivars; its
review files are in `reports/historical/avsa_gallery/`, git-ignored because they hold AVSA captions; the result is `data/external_photos.csv`).
