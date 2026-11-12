# Australian / New Zealand catalogue: plan for adding it (WAITING FOR PERMISSION)

**Status: do NOT import or publish anything from this catalogue until the Gesneriad Council of Australia and New Zealand (GCANZ) has given
final permission to post it.** When permission arrives, follow "Steps" below. Written 2026-11-12.

## Why it matters
Australia and New Zealand keep their own local registry of African violets and gesneriads (register numbers like `ANZ:659`). Many cultivars were
registered only there and never with the AVSA, so they are missing from the database and cannot be found in the AVSA lists.

## The source
`source/AV-Australian catalogue.csv` (read-only, untracked). 725 rows, all Country = Australia. Columns: Name, seed parent, pollen parent,
sport parent, Hybridiser, Variety (size class), Year last confirmed in Australia, Country of Origin, Colour, Bloom shape, Foliage, rego (`ANZ:nnn`,
716 rows), date (registration year, 1960s to 2020s), AVSA (filled for 5 rows only).
Profile (2026-11-12): 520 names are not in the database; 205 are. Of the 205: hybridiser agrees for 135, differs for 44 (probably the same name
used for a different plant, e.g. Blue Velvet, Calypso, Bella Vista), blank in the database for 21; the database has no size class for 142 and no
description for 94 of them. Parents are given for only 19 rows, a sport parent for 23. 193 rows have the hybridiser "Hams" (the Colonial series).

## Design decisions (proposed; confirm when starting)
1. **Guard first.** The importer must ignore the catalogue unless it is explicitly switched on (for example an `--include-anz` option or an
   approval file `reports/review/anz_approved.txt`). That way a normal pipeline run can never publish it before permission.
2. **Loader.** Add `load_anz()` to `scripts/import_excel.py`, modelled on `load_supplements()` (the yearly supplements use the same kind of
   columns). Tag records `sources = anz`.
3. **Field mapping.**
   - Name -> name (the catalogue shouts some names in CAPITALS: use the normal name style of the database).
   - Hybridiser -> `hybridizer_raw` and people (new strings are appended to `reports/review/hybridizer_mapping.csv` for review; decide what
     "Hams" is: a person row for the organisation).
   - Variety -> `size_class` (normalise `Semi-miniature trailer` to `Semiminiature trailer`).
   - Colour, Bloom shape, Foliage -> `color`, `bloom_description`, `foliage_description`.
   - `rego` + `date` -> the source note, written like the 2010-2019 supplements: `ANZ 659, 2009`. The date is a year only (store
     `registered_year`, not a full date). The ANZ number is NOT an AVSA number: never put it in `registration_no`.
   - AVSA column -> `registration_no` (5 rows).
   - Year last confirmed in Australia -> notes ("Last confirmed in Australia: 2026") or leave out; decide.
   - seed/pollen/sport parent -> parentage rows (the same rules as the other sources: placeholders are no parent).
4. **Matching.** Exact name match AND the hybridiser agrees -> the same cultivar: fill EMPTY fields only (size, description, hybridiser, ANZ
   note), never overwrite. Name match with a different hybridiser -> a separate record (the id gets the hybridiser as a disambiguator, as for
   the 1963 list). Near spellings are flagged for review, never auto-merged (project rule).
5. **Credit and wording.** Ask GCANZ how they want to be credited; show "ANZ register" as the source on the cultivar page and on a project page.
6. **Photos.** Afterwards import the waiting AVAAU photos of catalogue cultivars (Kimba, Wyuna, Kunama, Rose Bay, Richmond, Biara, Milang Voodoo,
   RD's Dorothy, Colonial Mount Remarkable, Colonial Port Fairy, Colonial Roseworthy, Jay's Blue Pacific, Jay's Frosted Burgundy; `Pow Wow` is
   ambiguous). They are listed in the private repo's `reports/avaau_import_plan.csv`.

## Steps once permission is given
1. Record the permission (who, when, how to credit) in the private permissions log and in this file.
2. Implement the loader and the guard (design 1-4); add tests of the counts below.
3. Run `import_excel.py` -> `import_submissions.py apply` -> `build_db.py` -> `export_ancestry_xlsx.py`.
4. Expect about +520 cultivars (about 19,100 in total), about 205 existing records enriched, and about 44 same-name records kept separate. Check
   the new flags and the hybridizer review rows; resolve them with the user.
5. Import the photos, then commit and push (images repo first, then this repo).

## Not done yet
Everything above; only the profile exists (private repo: `hector-archive/australian-catalogue-profile.md`).
