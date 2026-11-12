# Master Variety List supplements 1964-2002: plan for importing and publishing

Written 2026-11-12. Status: PLAN, nothing imported yet.

## Decisions (user, 2026-11-12)
1. Names not in MLV.xls (~3,458): import with the supplement's spelling, flag `spelling_unchecked`.
2. Default search view: registered supplement-only cultivars are shown; unregistered supplement-only names are hidden behind a
   checkbox (like "Exclude names found only in the 1963 Master List"; needs a new view column and URL parameter).
3. Cross references: written into the target cultivar's notes ("Also listed as X (1972 supplement)"); no schema change. Unresolved targets
   (59) go to a review file.
4. Hybridizers: exact "I. Surname" == "Surname, I." matches are auto-linked to the existing person; all else becomes a new person as
   printed, listed in the mapping CSV for review.

## The source
`source/MVL_Supplements_cultivars.xlsx` (OCR of the supplements printed in the African Violet Magazine; read-only).
- `cultivars`: 15,341 rows from 30 lists (1964, 1965, 1967, 1968, 1970-74, 1977-80, 1982, 1984, 1986-89, 1991, 1992, 1994-2002).
  15,278 cultivar rows, 59 species, 4 erratum notes. Same row_id = `year-sequence` is stable and is our provenance key.
- `cross_references` (976 "X See Y" aliases), `supplements` (catalogue; 2003-2009 and the years with no supplement are not in it, the
  2004+ updates moved to the AVSA website), `marker_legends`, `qa_flag_definitions`, `code_key` (1986-87 color/leaf/flower/size codes),
  `hybridizer_key_1964`, `hybridizer_variants` (96 spelling variants, decision column empty).
- Useful columns: `name`, `name_normalised`, `full_name` (+ `series_prefix`), `is_registered`, `reg_no`, `reg_date_iso`, `hybridizer`
  (= `hybridizer_normalised`, 1964 codes expanded), `description` (abbreviations expanded) vs `description_original` (as printed) vs
  `description_ocr_raw`, `review_status`, `qa_flags`.
- The OCR is clean: no replacement characters (U+FFFD) in names or descriptions; apostrophes are real curly quotes. The terminal only displays
  them as "?".

## What is in it (measured against site/avancestry.sqlite and MLV.xls)
| | count |
|---|---|
| distinct cultivar names (full_name, normalised) | 13,005 |
| already in the database (by name) | 3,425 |
| NOT in the database | 9,580 |
| ...of which found in MLV.xls | 6,122 |
| ...of which NOT in MLV.xls (spelling cannot be double checked) | 3,458 (about 390 are near-misses of an MLV name, e.g. Arctic/Artic, Aquarius/Aquarious) |
| rows listed in more than one supplement | 15,278 rows for 13,006 names; 1,933 names have different descriptions in different lists |
| names used by more than one hybridizer | 1,063 (some real homonyms like Ablaze Burton / Ablaze Baker's, mostly one cultivar whose hybridizer is printed differently) |
| rows with no description | 1 (Richter's Carmelita Supreme, 1967): not imported. Short but real ones ("Double red.") are kept |
| registered flag set | 5,882 rows; reg_no present on 5,393 |
| 1964-1968 lists | `*` = registered but NO number printed (the number comes from MLV: 455 of 491 such rows are found there) |
| unregistered entries | 9,459 rows (introduced/described, never registered) |
| series members | 846 rows have a prefix (Optimara, Ness', Rob's, Rhapsodie, Ultra Violet, ACA's ...): the cultivar name is `full_name`, not `name` |
| 1986-87 AVSA codes | 299 rows (decoded color/leaf/flower/size) |
| species | 59 rows |

Registration numbers vs MLV.xls (rows whose name is in MLV): 4,719 agree, 221 disagree. Many disagreements are the magazine's own
off-by-one print error in 1971 (After Five printed 2145, MLV 2146). Six differ from the number already in the database
(Granger's Polaris, Honeybee, Unpredictable, Forever Blue, Hot Foot).

## Ground rules (from the user)
1. No description -> not imported (1 row; also drop the 4 erratum notes, but apply them: Matecumbe duplicate, Moonstruck date 12/15/77,
   Small World description change, Springtime duplicate of Granger's Springtime).
2. MLV.xls is the primary check of spelling, registration number (and I propose also registration date, hybridizer and size class). The
   supplement supplies the content; MLV corrects OCR. Where MLV and the supplement disagree on a number, MLV wins and the difference is logged.
3. Split the description into color / bloom_description / foliage_description.
4. review_status `unreviewed` = AI satisfied, no human yet. Treat it as normal; no extra gate. (`corrected`, `verified`, `added` are fine too.)

## Pipeline (same shape as the 1963 book and the 2010-2019 supplements)
1. **`scripts/prep_mvl_supplements.py`** (new, read-only on source). Reads the xlsx and MLV.xls (in `source/Hector Wong Archive...`; the MLV
   file stays a double check only: nothing is imported from MLV rows that are not in a supplement). Writes `data/mvl_supplements.csv`
   (one row per list entry that survives) and review files in `reports/review/`. Needs xlrd for the .xls (install in .venv; ask first).
   Steps inside:
   a. Drop empty descriptions, erratum notes, apply the 4 errata. Species rows -> kind=species (the 1963 rule), `species_ref` kept in notes.
   b. Name = `full_name` when present, else `name_normalised`; strip the (R) mark from the name and keep "Optimara" etc. as part of the name.
   c. **Spelling against MLV** (compare on a letters-and-digits key). Exact key match: take MLV's spelling and capitalization (also fixes
      title-casing of caps-lock names). Near-miss (similarity >= .88, same hybridizer or number): NEVER auto-applied; listed in
      `reports/review/mvl_spelling.csv` with the MLV candidate, decision column (`mlv` / `keep` / `different`). Approved ones go to the
      existing `name_corrections.csv` mechanism (old spelling stays searchable in the notes). No MLV match: imported with the supplement's
      spelling and flagged `spelling_unchecked`.
   d. **Registration**: number and date from MLV when the name+hybridizer matches; supplement value used only when MLV has none (2001-02
      lists postdate MLV). Disagreements -> `reports/review/mvl_regno.csv`. Printed numbers shared by two cultivars in one list
      (68 qa-flagged) must not break the unique constraint: first resolved by MLV, rest to review.
   e. **Merge repeats**: one record per plant across the lists. Same name AND compatible hybridizer (surname equal, or same reg number) =
      one plant; the LATEST list wins per field (same rule as the 2010-2019 supplements; `**`-marked entries are corrections), earlier
      descriptions kept in a `source_note` ("also listed 1964, 1972"). Different hybridizers and different descriptions = separate plants
      (id gets the originator, as for the 1963 list). Uncertain pairs -> `reports/review/mvl_matches.csv` (decision `join`/`separate`).
   f. **Size class** from MLV `TYPE` (same vocabulary as the database) and, when MLV lacks it, the trailing size word of the description
      (Standard, Large, Semiminiature, Miniature, Small standard, Trailer; about 12,000 rows have one) or the 1986-87 code.
   g. **Description split** (see below).
2. **`import_excel.py`** gets `load_mvl_supplements()` next to `load_supplements()`/`load_masterlist()`. Tag `sources` with `mvl_supplement`,
   `supplement_year` = latest list year, `source_note` = lists + provenance. Matching to existing records: automatic only when name AND
   hybridizer (or reg number) agree; every other name match goes to the review CSV (never fuzzy auto-merge). Existing richer values win:
   the supplement fills EMPTY fields only (2,174 matched records have no description today), conflicts are logged
   (`supplement_conflict`, as now). Needs a `--no-mvl` guard? (not needed: the data is cleared for publishing once this plan is approved).
3. `build_db.py` -> checks -> `export_ancestry_xlsx.py` (usual deploy rule applies). The new description fields load from the split file the way
   `description_split.csv` does today.

## Description split
`data/description_split.csv` came from a deleted script, so write `scripts/split_mvl_descriptions.py` (kept this time) producing the same columns
(`id, color, bloom_description, foliage_description, split_status`). The supplement text has two patterns:
- bloom sentence(s) then foliage sentence(s) then size: "Double deep pink round blossoms. Dark tailored foliage."
- 1964-79 lists sometimes foliage first: "Heavy quilted serrated edged foliage... Full double frilly purple blossom."
Rules: split into sentences; classify each as foliage (foliage/leaf/leaves/variegated/quilted/serrated/girl/plain/tailored/pointed/glossy/
reverse/back/heart-shaped...) or bloom; the trailing size word is removed from both parts and goes to size_class (`description` itself is
kept unchanged); `color` = the leading color phrase of the bloom part (lavender, dark blue, blue/white, orchid-pink/white...) following the
vocabulary already used in description_split.csv. About 5,200 descriptions never say "foliage" or "leaf", so the classifier needs the
vocabulary above. Statuses: `ok`, `bloom only`, `foliage only`, `needs review`. Only `needs review` rows (expect a few %) go to a human; a
sample of ~100 `ok` rows is checked before publishing and any systematic error fixed in the rules, not row by row.

## Hybridizers
- `hybridizer_normalised` is "I. Surname", "Surname" or an organization; the database holds "Surname, I.". 1,157 distinct strings, 369 rows
  have none (stays empty, not "unknown"; "Unknown" and similar placeholders = none).
- Keep the string as `hybridizer_raw`; create people exactly as for the 1963 originators, linked to an existing person only via a decision
  in a mapping CSV (`reports/review/mvl_hybridizer_mapping.csv`), pre-filled with proposals (exact "I. Surname" == "Surname, I." match to
  an existing person). The 96 `hybridizer_variants` become pre-filled rows (Lebetskaia-style spelling variants flagged, as for the xlsx).
  whether proposals may be auto-linked.

## Cross references (976 "X See Y")
Alias and old names (e.g. CARMELITA -> Richter's Carmelita). how to publish them. 59 targets are not found in the lists.

## Publishing
- Shown on the cultivar page as "Listed in the AVSA Master List supplements 1964, 1972" with registration number/date, description parts,
  hybridizer; credit "AVSA Master Variety List supplements, African Violet Magazine" in the source line and on the Project history/About page.
- `registered` flag = `is_registered` (or MLV number). Unregistered entries are published like the unregistered 1963 entries.
- Default visibility: the search checkbox "Exclude names found only in the 1963 Master List" is ON by default; 9,580 new
  names would add about 50% to the 18,591 records.
- Reports: `reports/mvl_supplements_import.md` (counts, how many matched/new/corrected from MLV, the unchecked spellings), flags in
  `reports/import_flags.csv`.
- Photos are unaffected. Provenance: the 2010-2019 supplements are already published the same way. AVSA has never answered the 2014
  bylaws question (see memory); the project keeps citing AVSA as the source, as for the 2010-2019 lists.

## Review load (what a human has to look at)
mvl_spelling.csv (~390 near-misses), mvl_regno.csv (~230), mvl_matches.csv (unclear same-name pairs, perhaps 100-300),
hybridizer mapping (~1,150 strings, only the link decisions), the `needs review` descriptions, and the ~3,450 `spelling_unchecked`
names (a list only; no per-row decision needed unless a misspelling is reported later via name_corrections.csv).

## Order of work
1. Answer the points. 2. prep script + reports; user reviews the CSVs. 3. split script + sample check. 4. importer changes;
dry run with counts. 5. build, checks, site spot check (search, cultivar page, hybridizer page). 6. commit data + rebuilt sqlite/xlsx
(approval needed), push only on request.
