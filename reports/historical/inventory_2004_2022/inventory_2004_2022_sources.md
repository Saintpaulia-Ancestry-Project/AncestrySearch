# Inventory: supplement and magazine sources 2003-2022

One-off check (not a pipeline output). Sources: AVML 2010-2019 (source/AV-MasterLIstSupplements), data/registration_reports.csv (magazine registration reports 2004-2009, 2020-2022). 2003 is part of the frozen MVL supplements.

## Rows per source

- AVML 2010: 460
- AVML 2011: 139
- AVML 2012: 167
- AVML 2013: 83
- AVML 2014: 104
- AVML 2015: 116
- AVML 2016: 76
- AVML 2017: 95
- AVML 2018: 202
- AVML 2019: 142
- magazine report: 433

Total 2017 rows. All matched a record by name except 6 OCR-typo names already handled by name_corrections.csv.

## Where the 2010-2019 / magazine rows came from in the database

Records with a supplement source and registered 2003-2022: 1,615; 732 of them exist ONLY through the supplements/magazine reports (no sqlite or xlsx record). So the supplements were NOT all in source/AfricanVioletAncestry.sqlite.

## Disagreements between a source row and the record (existing sqlite/xlsx values win): 28 rows

- size class: 20 (e.g. Allegro Wee Whimsy: AVML standard vs record semiminiature)
- hybridizer: 2 (Candlelit Delight; Jersey Starlight Trail: Kuzynski vs Kurzynski)
- number: Milk in Wonderland 10886 vs 10888 (already decided: official 10888); Mermaid 2013 (a date misread as a number); 4 OCR-typo names (9ight, 9u'er, LE-Adzhio) already corrected
- AVML xlsx registration numbers come through as dates in Excel (10218 = 1927-12-22); the importer converts them back, so these are not conflicts

Detail: reports/inventory_2004_2022_source_conflicts.csv

## Disagreements between supplement years (import_flags.csv supplement_conflict): 185

- bloom 91, foliage 77, hybridizer 17 (the later year wins)

## Possible duplicate or misspelled names (similarity >= 0.92), at least one side from these sources: 32

Detail: reports/inventory_2004_2022_name_near_misses.csv. Many are real pairs (Optimara X / X II, Blue Haven / Blue Heaven, Queen of Pink / Pinks); some are misspellings of an existing name (Mac's Galactic Gandeur, Countr Doll, Windsome).
