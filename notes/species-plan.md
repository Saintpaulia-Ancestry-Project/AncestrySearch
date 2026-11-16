# Species update plan (DRAFT: waiting for the user's decisions)

## Sources (both in source/, read-only)
1. **Saintpaulia_Gesneriads2018Q1.pdf**: W. Goretsky, "Saintpaulia, the NEW Streptocarpus", *Gesneriads* 68(1), 2018, pp. 5-8.
   - Saintpaulia is now Streptocarpus sect. Saintpaulia (Nishii et al. 2015).
   - A two-column table of **79 accession lines** (21 codes: 1, 2, 3, 4, 5, 5a-5i, 6, 7, 8, 9, 10): column 1 = the AVSA abbreviated name
     (2009/2017, e.g. `S. 5c2. cl. diplotricha Parker`), column 2 = the Nishii name with the Latin gender corrected for
     Streptocarpus (`S. 5c2. cl. diplotrichus Parker`, ionantha -> ionanthus, pendula -> pendulus, velutina -> velutinus,
     rupicola -> rupicolus, goetzeana -> goetzeanus, nitida -> nitidus, brevipilosa -> brevipilosus, grandifolia -> grandifolius).
   - Flags: "not in cultivation" (1 inconspicuus, 2 afroviola [was pusilla], 5d mafiensis, 8 ulugurensis, 10 watkinsii).
2. **Species Booklet.pdf**: K. Barbi, *African Violet Species Identification Guide* (MAAVS memo addendum, Jan 2019), 44 pages.
   - One entry per accession with (a) a species-level description from J. Smith (the Gesneriad Council of Australia/NZ list) and
     (b) for ~25 accessions the older First Class description with its authority and year (`(B. Burtt - 1958) Single blue-violet...`).
     Entries marked "Description pending" have only the clone relationship (`Clone of S. ionanthus subsp. grotei`).
   - Photos of show winners and a scale-of-points / identification guide (pp. 3-4, 39-43). The photos are NOT imported (copyright).

## What the site has now (60 records of kind=species)
- 10 from the 1963 book (S. Amaniensis ... S. Tongwensis, one per species, no authority).
- 33 from the supplements (`mvl_supp`): the older First Class-style descriptions (`S. grandifolia #237`, `S. diplotricha Punter #0`).
- 17 from parent cells of cultivars (stubs: `S. grotei`, `S. shumensis`, ..., plus 5 junk names, see below).
- Same species exist 2-3 times (e.g. S. grotei: 1963 + supplement + parent; S. ionantha: 1963 + supplement).
- Hybridizer links removed on 2026-11-16 (species have no hybridizer; the authority text stays in `hybridizer_raw`).
- Preliminary match against the 79 table lines: about 39 lines have a record, about 40 do not. Missing: the clones with Uppsala,
  Mather, Cornell, Amazon, Parker numbers; subspecies rows 5d/5e/5h; S. 8 ulugurensis, S. 10 watkinsii; 2. afroviola name.
- Not species at all: `S. magungensis var. minima and several standard pink trailers`, `S. grotei, Tiny Rose, Hello Dolly, Pink Angel`,
  `S. magungensis x S. velutina`, `S. ionantha ssp. grotei cl. Mather No. 21` (cell text containing several plants/a cross).

## Plan (steps, each ends with build_db.py "All checks passed.", tests, commit when asked)
1. **Parse both PDFs to one working table** (private worksheet, not committed): code, AVSA name, Nishii name, status
   (not in cultivation), description A (Smith/Barbi, species level), description B (older First Class text), authority, year.
   Barbi's two-column layout needs a manual pass for clone entries.
2. **Match each table line to the site records** (exact name after gender-normalising; every miss listed). Output: matched /
   missing / duplicate records of one species / records not in the table (the 10 junk or cross names).
3. **Decisions you make on the worksheet** (see questions): names, one record per accession, duplicates to merge.
4. **Merge duplicate records** of the same species (master_edit.merge keeps parentage; 22 cultivars use species as parents),
   adding the old spellings to `name_aliases.csv` so every old name still finds the record.
5. **Update existing records**: accepted name, code, status ("not in cultivation"), species-level description, authority/year as text
   (e.g. "Described by B. Burtt, 1958"), taxonomy note (Streptocarpus sect. Saintpaulia), source citation in notes.
6. **Add the missing accessions** as kind=species records (no parents, no hybridizer) with the same fields.
7. **Fix the 4-5 non-species parent records** (turn into stub/unknown or split into their real parents, with your decision).
8. **Front end**: species list/filter and a "Species" page grouped by code (S. 5, 5a...5i); species page shows code, accepted name,
   old names, authority. Needs new columns (below) in cultivars.csv and build_db.py.
9. **Record decisions** in reports/decision_history/ and log edits through master_edit.py.

## Decisions (user, 2026-11-16)
1. The corrected (Nishii) name is the record name, e.g. `S. 5c2. cl. diplotrichus Parker`; the old spelling stays reachable as an alias
   (data/name_aliases.csv) and is listed in the notes ("Formerly listed as ...").
2. One record per table line: 81 lines (species, subspecies, variety and clone lines, with the 5c1/5c2 variety lines).
3. Descriptions are merged: the species-level text (J. Smith, via the booklet) first, then the original authority text
   ("Original description (B. Burtt, 1958): ..."), then the 1963 Master List text. Light grammar clean-up only.
4. S. 1. inconspicuus and S. 2. afroviola are in cultivation (no note). S. 5d mafiensis, S. 8 ulugurensis and S. 10 watkinsii are added with
   "Not in cultivation." in their notes.
5. The non-species parent names become: `S. magungensis var. minima and several standard pink trailers` -> S. 5b. cl. magungensis var. minima;
   `S. grotei, Tiny Rose, Hello Dolly, Pink Angel` -> S. 5b. cl. grotei; `S. ionantha ssp. grotei cl. Mather No. 21` -> S. 5b. cl. grotei
   Mather No. 21; `S. magungensis x S. velutina` is renamed `S. 5b. cl. magungensis x S. 5i. cl. velutinus` (a hybrid of two species).
6. The sources are quoted in the notes under CC BY-NC-SA 4.0.
No new columns: the code and rank are in the name itself.

## Working table (private, local)
AVAncestry-private/AVM/MVL_extracts/species/species_update_plan.xlsx (and .csv): one row per accession line with action
(update / merge / add), the record that survives, the records merged into it, the old names, the proposed description and notes.
Result: 22 updates, 16 merges of two records, 43 additions (35 clones, 4 subspecies, 3 species, 1 variety).
