# Contributor submission form: plan

Decided with the user: custom form on the site (`#/submit`) -> Google Apps Script receiver -> private Google Sheet
as the review inbox. Review happens in the Sheet. Approved rows are downloaded as CSV and imported by
`scripts/import_submissions.py`. Assumptions to confirm: corrections to existing cultivars are in v1;
contributed data and photos are CC BY 4.0.

Exception to the "no server-side write infrastructure" rule: the Apps Script receiver (free, third party,
append-only). Nothing else on the hosted site writes anything.

## Flow

1. Hybridizer fills in `#/submit` (several cultivars per batch; drafts autosave in localStorage).
2. "Send" POSTs the batch to the Apps Script web app. Fallback: "Download CSV" (same columns) for sending by email.
3. Apps Script appends one row per cultivar to the Sheet tab `Inbox` and saves photos to a Drive folder
   `submissions/<submission_id>/`.
4. Admin reviews in the Sheet (decision columns). `scripts/check_submissions.py` writes a flags CSV
   (name matches, parent resolution, cycles, registration clashes) to paste into the flag columns.
5. Admin downloads the reviewed tab as CSV into `submissions/inbox/` (git-ignored: contains contact details).
6. `import_submissions.py` strips private columns, applies decisions, writes `data/submissions/<submission_id>.csv`
   (tracked). Photos: download the Drive folder, then `add_images.py` (credit required).
7. Pipeline: import_excel.py -> import_submissions.py -> build_db.py -> export_ancestry_xlsx.py; the user commits.

## Column spec (one row per cultivar; form CSV and Sheet use the same names)

Submission (copied from "About you"):
- `submission_id` (generated in the browser, e.g. `s-20261110-ab12`), `entry_no`, `received_at` (added by receiver)
- `submitter_name` (public credit), `contact` (PRIVATE, never tracked), `agreed_license` (must be `yes`)

Cultivar:
- `action`: `new` | `update`; `existing_id` (required for update)
- `name` (required), `kind` (cultivar | seedling | species; default cultivar)
- `hybridizers`: `;`-separated person names, as typed or picked
- `year_introduced`
- `seed_parent`, `pollen_parent`: names (picked from DB or typed), `parent_certainty` known | assumed | unsure
- `sport_of`: replaces seed/pollen when set
- `parentage_note`: free text for complex crosses, kept as raw_text
- `registration_no`, `registered_date` (ISO)
- `size_class`, `color`, `bloom_description`, `foliage_description`, `description`, `notes`
- `links`: `|`-separated URLs
- `photo_files`: `|`-separated filenames; `photo_captions`, `photo_credits` (same order, `|`-separated);
  `photo_permission` (`yes` required if any photo)

Admin (filled in the Sheet, never from the form):
- `decision`: accept | join | different | reject | hold; `join_id` (when decision = join)
- `overwrite_fields`: `;`-separated fields an update may overwrite (text fields, kind, registration_no,
  registered_date, parents, sport_of, hybridizers); without it a differing existing value is kept and reported
- `corrected_*` for any field above; `admin_note`; `reply_note` (message back to the submitter)
- flag columns pasted from the check script: `flag_name_match`, `flag_parents`, `flag_other`

## Scripts (built)

- `scripts/submissions_lib.py`: shared checks; reuses import_excel.py normalisation.
- `check_submissions.py EXPORT.csv` -> `EXPORT.flags.csv` (paste flag_* columns into the Sheet).
- `import_submissions.py ingest EXPORT.csv` -> `data/submissions/<id>.csv` (decisions applied, private columns removed).
- `import_submissions.py apply [--photos-dir DIR]` -> adds all data/submissions/*.csv to data/*.csv, writes
  reports/submission_import.md, stages permitted photos with a credits.csv for add_images.py.
- Parent cells accept `id:<slug>` to settle an ambiguous name (many names repeat: check output lists the options).
- Notes on updates are appended, not treated as conflicts. Year introduced goes into notes (no schema column yet).
- A name that is only a stub (seen as a parent) is filled in automatically; any other existing name is HELD until
  the reviewer chooses join or different.

## Import rules (import_submissions.py)

- Only `accept`, `join`, `different` rows are imported; `different` forces a new record with a disambiguated slug.
- Reuse the import_excel.py normalisation, slug, stub-creation and people-matching code (share it, don't copy it).
- Placeholders ("?", "unknown", blank) produce no parentage row. Unknown parent names become stubs.
- `update` / `join`: fill only fields that are empty or that carry a `corrected_*` value; never overwrite silently;
  conflicts go to reports/submission_import.md.
- `sources` gains `submission`; record `submission_id` and credit on the cultivar. Contact details are never written.
- Idempotent: import_excel.py regenerates data/*.csv, then every file in data/submissions/ is re-applied.
- Validation: the existing build_db.py checks (FKs, cycles, unique registration_no) must pass.

## Form behavior (front end)

- "About you" once; autocomplete for hybridizers, parents and sport parent from the loaded sql.js DB.
- Only `name` is required. Warn on existing name (different cultivar | correction to that one).
- List of entries: Add another, Duplicate (copies hybridizer and parents), Delete; grid view for bulk entry.
- Photos resized in the browser (longest side 1600, JPEG/WebP) before sending; per-photo credit and permission.
- Checks: duplicate names in the batch, self-parent, missing credit, license box.
- Re-import of a downloaded CSV for editing.
- Spam control: hidden honeypot field, size limit, admin review is the real gate. Back up the Sheet automatically.

## Build order

1. This spec + CLAUDE.md note (done).
2. `import_submissions.py` and `check_submissions.py`, tested with a hand-made sample CSV.
3. `#/submit` form (front end) with CSV download.
4. Apps Script receiver + Sheet template (decision dropdowns), then wire the Send button.
5. Docs page for hybridizers (data/pages/) and a contributor guide for the admin review.

## Status (2026-11-10)

Built: import and check scripts; #/submit form with CSV download and Send; apps_script/Code.gs (receiver, Inbox tab
setup, Help tab) with README. Next: deploy (apps_script/README.md), set SUBMIT_URL, run a live test, then write the
admin guide into the Sheet's Help tab flow with a real submission, and the contributing text on the site.
