# MVL supplements, recent additions (1969, 1975, 1976, 1981, 1983, 1985, 1990, 1993, 2003): plan

Written 2026-11-13. Status: PLAN, nothing imported yet. Extends notes/mvl-supplements-plan.md (same pipeline, same ground rules).

## The source
`source/MVL_Supplements_recent.xlsx` (read-only). Same 40-column schema and sheet layout as `MVL_Supplements_cultivars.xlsx`; row_ids do not
overlap with it (0 shared). 4,292 rows, 339 cross references. The README says 1969, 1975 and 2003 are still being rebuilt and "will be added
to this file", so the importer must read the file again later without breaking decisions already made (decision files are keyed by plant_key).

| list | rows | kind | prose description | printed code | reg no |
|---|---|---|---|---|---|
| 1969 | 151 | reconstructed from registration reports | no | yes | all |
| 1975 | 163 | reconstructed | no | yes | all |
| 1976 | 146 | reconstructed | no | yes | all |
| 1981 | 1,728 | reconstructed (Mar list + 5 reports) | no | yes | all |
| 1983 | 929 | reconstructed | no | yes | all |
| 1985 | 493 | reconstructed | no | yes | all |
| 1990 | 243 | reconstructed, but WITH prose | yes | no | all |
| 1993 | 417 | the real supplement | yes | no | 174 (registered), 243 unregistered |
| 2003 | 22 | partial rebuild | yes | no | all (reg 9144-9165, 2002-03) |

* **3,607 rows (84%) have no prose.** `description` is machine text decoded from the printed AVSA code ("Colour: dark + red/maroon/plum/burgundy/wine +
  white/cream/blush + edge; Leaf: plain/tailored, quilted; Flower: double, fringed/ruffled; Size: standard (over 8")"). The four parts are also in
  separate columns (`code_color`, `code_leaf`, `code_flower`, `code_size`), so color/bloom/foliage/size need no sentence splitting for these rows.
  Three rows have no code at all (Genessee Silhouette, Coy, Dollfry): nothing to import beyond name/number/hybridizer.
* **685 rows have prose** (1990, 1993, 2003, +3 stray). The existing `split_mvl_descriptions.py` already classifies them: 656 ok, 7 bloom only,
  19 needs review (tested, nothing written). 1993 is telegraphic ("Dark green, plain, quilted, scalloped. Standard"), which the classifier handles.
* Names: 4,292 rows = 3,728 distinct names. 2,344 are already in the database, 2,029 already in the 1964-2002 supplements, 1,336 are new to both
  (1,186 of those are in MLV.xls). 443 rows are flagged `duplicate_of` (the same registration printed in the March list and in a per-issue report).
* Registration: 4,049 registered. Against MLV.xls (rows whose name is there, 4,085 of 4,292): number agrees 3,765, differs 82; date agrees 3,691,
  differs 155. The differences are NOT random MLV-is-right cases: eight 1981 cultivars (Her Choice 3803, Her Dream 3804, ... My Eye 3811, all
  registered 1979-11-19) are exactly 519 lower in the magazine than in MLV (4322...4330) while the dates agree, and MLV's 4322 would fall in
  1981, so MLV looks wrong there. 27 differ by -8 (probably a systematic print/OCR slip), a few swap pairs (Utz Monique/Utz Tiffany), and
  several look like MLV matching a different, older plant of the same name (Mindy 1964, Curtain Call 1967, Mimi 1976). 2003 is not in MLV at all.
* Hybridizer: 1,186 rows have the hybridizer inferred from the sequence of applicant headings in the registration report
  (`hybridizer_from_report_sequence`); 1990 uses the applicant heading as hybridizer. 1993 has hyphenation damage ("Chap- ter", "Was- mund").
  623 distinct strings, 10 rows none.
* Cross references: 339 (alias -> target), resolved by row_id.

## What we do (same shape as before)
1. `prep_mvl_supplements.py`: read BOTH xlsx files (list of sources), so repeats across the 39 lists merge into one plant as before
   (same name AND compatible hybridizer or reg no; uncertain pairs go to mvl_matches.csv). Collapse the 443 `duplicate_of` rows first.
   Fix 1993 line-break hyphens in names/hybridizers. Spelling and number/date checks against MLV.xls as before; near-misses to mvl_spelling.csv;
   not-in-MLV names (about 200 here, all of 2003) imported flagged `spelling_unchecked`.
2. New column `desc_source` (`prose` | `code`) and keep the printed `code` in the notes ("AVSA registration code: D-RW-E 23 df S").
3. `split_mvl_descriptions.py`: for `code` rows build color / bloom_description / foliage_description from the four code columns (deterministic,
   no review file); for `prose` rows use the existing classifier and review file. Size class comes from `code_size` / the trailing size word.
4. `import_excel.py attach_mvl()` unchanged in principle: existing records are joined only when name AND hybridizer/reg no agree; fills EMPTY
   fields only; source token `mvl_supp`; `registered_mvl`, `mvl_lists` extended with the new years. About 2,174 matched records have no
   description, so many get their first color/bloom/foliage here.
5. build_db -> export (usual deploy rule). Report `reports/mvl_supplements_import.md` gets a section per list.

## Decisions (user, 2026-11-13)
1. Code-only rows: `description` = the decoded text ("Colour: ...; Leaf: ...; Flower: ...; Size: ..."), as in the workbook. The `desc_source`
   column (`code`) and the printed code in the notes mark it as decoded, not written prose. (Check the UI: label such a description
   "decoded from the AVSA registration code" on the cultivar page so it is not mistaken for a hybridizer's words.)
2. color / bloom / foliage in short plain English from the code (e.g. "Dark red, white edge", "Double, fringed", "Plain, quilted"). The
   letter-to-word rules live in the split script; family names shortened to the first word (red, pink, orchid, white...).
3. Number/date disagreements with MLV.xls (APPROVED WITH A CHANGE): the whole cultivar is NOT imported until a decision is recorded in
   reports/review/mvl_recent_conflicts.csv (`decision` = mlv | supplement | custom with final_reg / final_date). Applies to plants that
   have rows in the recent file; older-only plants keep the earlier rule (MLV wins, logged in mvl_regno.csv).
4. Prose beats code: a written description from any list is never replaced by a decoded code; the code only fills color/bloom/foliage still
   empty after the prose split, and stays in the notes. (Prose vs prose: latest list wins, as before.)

## Open points I will handle with the defaults above unless you object
* Hybridizer inferred from the registration-report heading sequence (1,186 rows) is imported as `hybridizer_raw` and the rows are flagged;
  people are created/linked through the same mapping CSV as before. 1993 line-break hyphens are repaired automatically.
* Cross references (339) go into the target's notes, as before.
* Unregistered 1993 entries (243) follow the "Exclude old unregistered names" checkbox.
* The rebuilt 1969/1975/2003 sets are still coming: the importer reads the file again whenever it changes.

## Status (2026-11-13): prep script done
`scripts/prep_mvl_supplements.py` now reads both xlsx files; `import_excel.py load_mvl()` holds plants with `hold_reason` (listed in
reports/review/mvl_held_back.csv). Not yet done: split script for code/prose rows, importer changes beyond the hold, build.
Results: 15,660 plants (was 13,823); 1,868 new plant keys; earlier plant keys are kept (11,910 unchanged; 31 old Reed/House of Violets-type pairs
merged into one plant because a recent row shares their registration number). 133 plants held for number/date conflicts (89 date, 44 number).
Correction to the first analysis: the eight "Her/His ..." cultivars (3803-3811 vs MLV 4322-4330) are NOT conflicts: the same lists print 4322
elsewhere (one March-list printing is the odd one out), so MLV is confirmed. Recent-only plants: 1,866 (1,389 code, 477 prose; 1,691 registered).
The 3 rows without a code and the 1 without a description are dropped (ground rule: no description, not imported).

## Status (2026-11-13, later): split script done
`scripts/split_mvl_descriptions.py` builds color / bloom / foliage from the code columns for `desc_source = code` plants (status `code`; `code (partial)` when
a part is missing in the printed code; `code (check color)` for 4 odd '&' colors: dark-spark, foxfire-house-of, white-heritage,
zeta-avsa-chapter-county-union). Prose plants keep the sentence split; a code only fills a part the prose left empty (`ok+code`).
Wording: "Dark red, white edge", "Pink two-tone", "Multicolor (white, pink)", bloom "Double, fringed/ruffled.", foliage "Plain, quilted foliage.".
Results: 1,371 code, 14 partial, 4 check-color, 66 ok+code; needs review 545 (was 507; 16 of the new prose rows + earlier plants re-split by newer lists).
Next: import_excel.py run + build (see order in CLAUDE.md), then resolve reports/review/mvl_recent_conflicts.csv (133 held plants).
