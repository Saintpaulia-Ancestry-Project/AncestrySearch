# Reviewing contributor submissions: administrator guide

For the person who runs the project. Contributors use the Contribute page (`#/submit`); everything below happens on
your side. Design background: `notes/submission-form-plan.md`. Receiver setup: `apps_script/README.md`.

## What arrives and where

- Each Send adds **one row per cultivar** to the private Google Sheet `AV Submissions`, tab **Inbox**, and emails you.
- Photos go to Google Drive: `AV Submissions photos/<submission_id>/`.
- Rows with the same `submission_id` came from one contributor in one send. Contact details are in the `contact`
  column. They stay in the Sheet and in `submissions/inbox/` (git-ignored). They must never be committed.
- Column colors: purple = sent by the contributor; yellow = yours; green (grouped, click + above the headings) =
  corrected values.
- People who cannot use Send email a `.csv` copy. Paste its rows into the Inbox (same columns), or put the file in
  `submissions/inbox/` and treat it as an export (step 3 onward).

## The review, step by step

Work from the repository root with the project Python: `.venv/Scripts/python.exe`.

1. **Download the Inbox.** In the Sheet: File > Download > CSV (current sheet). Save it as
   `submissions/inbox/<date>.csv`.
2. **Run the checker.**
   `python scripts/check_submissions.py submissions/inbox/<date>.csv`
   It writes `<date>.flags.csv`. Open it and paste the three columns `flag_name_match`, `flag_parents` and
   `flag_other` back into the matching columns of the Inbox. The flags tell you:
   - **name:** `EXISTS` (the name is already a cultivar), `matches stub` (it was only seen as a parent; it will be
     filled in), `similar names` (possible typo or duplicate);
   - **parents:** where each parent resolves, `AMBIGUOUS` (several cultivars share the name), `will become a stub`,
     `CYCLE` (the parents would make the cultivar its own ancestor);
   - **other:** registration number already used, unparseable dates, hybridizer not in Surname, Given form,
     photos without permission or credit, an entry with no description and no parentage.
3. **Decide each row** in the `decision` column:

   | decision | meaning |
   |---|---|
   | `accept` | add as a new cultivar (or fill in a stub of the same name) |
   | `join` | same cultivar as an existing one; also fill `join_id` with its id (the slug in its URL, `#/c/<id>`) |
   | `different` | a new cultivar although the name already exists (it gets a distinct id) |
   | `reject` | not imported |
   | `hold` (or blank) | not imported yet; stays in the Inbox for next time |

   A correction to an existing cultivar arrives with `action` = update and `existing_id` filled in; set `accept`.
4. **Correct values** by typing in the matching `corrected_*` column (name, parents, description and so on). A
   corrected value wins over the submitted one. The submitted value stays visible for the record.
   - A parent name shared by several cultivars: write `id:<slug>` in `corrected_seed_parent`,
     `corrected_pollen_parent` or `corrected_sport_of`. The flag lists the options with hybridizers.
   - Updates and joins fill empty fields only. To replace a differing existing value, list the field in
     `overwrite_fields` (for example `description; parents`). Otherwise the old value is kept and the difference is
     reported in step 6.
5. **Check the contents.** Descriptions come from the contributor: look for copied catalog text, and check that a
   photo credit is a person and not "internet". Do not publish anything you are unsure about; set it to `hold`
   and write to the contributor. Put the message in `reply_note` and your own notes in `admin_note`. Contact the
   person using the address in `contact`. The site does not send replies itself.
6. **Download the Inbox again** (now with decisions) as `submissions/inbox/<date>-reviewed.csv`, then run:

   ```
   python scripts/import_submissions.py ingest submissions/inbox/<date>-reviewed.csv
   python scripts/import_excel.py
   python scripts/import_submissions.py apply
   python scripts/build_db.py
   python scripts/export_ancestry_xlsx.py
   ```

   - `ingest` keeps only accept/join/different rows with `agreed_license=yes`, removes contact and admin columns,
     and writes `data/submissions/<submission_id>.csv`. These files are tracked.
   - `import_excel.py` regenerates `data/*.csv`; `apply` then adds every file in `data/submissions/`. Applying is
     repeatable: each applied entry is tagged `(submission <id>, entry <n>)` in `source_note`, so nothing is added
     twice.
   - Read `reports/submission_import.md`: it lists what was created, filled in, held and what conflicted.
     Held rows (ambiguous parent, existing name with no decision) are fixed in the Sheet and the steps repeated.
   - `build_db.py` must end with "All checks passed." (foreign keys, cycles, unique registration numbers).
7. **Photos.** Download the contributor's Drive folder, then:

   ```
   python scripts/import_submissions.py apply --photos-dir <downloaded folder>
   python scripts/add_images.py reports/submission_photos/<submission_id> 
   ```

   `apply --photos-dir` stages only photos with permission, renamed for their cultivar, with a `credits.csv`.
   Then `add_images.py` resizes them, writes `data/images.csv` and prepares the files for the separate images
   repository (see the Photos section of `CLAUDE.md`). Commit and push that repository too.
8. **Commit.** Commit `data/submissions/*.csv`, the changed `data/*.csv`, `site/avancestry.sqlite` and
   `site/downloads/AfricanVioletAncestry.xlsx`. Push only when you are ready (the deploy rule in `CLAUDE.md`).
9. **Tidy the Sheet.** Mark finished rows in `admin_note` (for example `imported 2027-01-05`), or move them to a
   tab `Done`. Leave `hold` rows in the Inbox. Delete raw exports from `submissions/inbox/` when you no longer need
   them.

## Rules of thumb

- Only the name is required, so many submissions will have only a description or only parentage. That is fine.
- Never merge by guesswork. A name match is not proof of the same cultivar: many names repeat. Use `join` only
  when the hybridizer, year or parents agree.
- A name used as a parent but never described is a stub. Accepting a submission with that name fills the stub in and
  all existing links stay.
- Unknown parent names become stub cultivars. If a contributor misspelled a parent, correct it in
  `corrected_seed_parent` rather than letting a stub be created.
- Sports are recorded with `sport_of` only, not seed and pollen parents.
- Registration numbers are unique. If a number already belongs to another cultivar, find out which is right before
  importing either.

## Handling problems

- **Contributor wants to withdraw or correct:** set the row to `reject` (before import) or edit the record via a new
  correction submission (after import). Removing something already published means editing `data/submissions/<id>.csv`
  and re-running steps 6 and 8, so the removal must be deliberate.
- **Spam or abuse:** set `reject`. The form has a hidden bot trap, size limits and a daily cap of 300 rows.
  Nothing reaches the database without your decision.
- **Receiver errors:** Apps Script editor > Executions. Edit the script, then Deploy > Manage deployments >
  New version (the URL stays the same). Keep `COLUMNS` in `apps_script/Code.gs` identical to `SHEET_COLUMNS` in
  `scripts/submissions_lib.py`.
- **Sheet backup:** the Sheet is the only copy of un-imported submissions. Use File > Make a copy now and then, or
  keep the downloaded exports until the data is committed.
- **Removing a test submission:** delete the Inbox row and the Drive folder `AV Submissions photos/<id>`.
