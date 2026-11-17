# Link-out to the AVSA Photo Gallery (plan, 2026-11-16; FINISHED 2026-11-17: 185 open review rows were left undecided on purpose, files in reports/historical/avsa_gallery/)

ONE-OFF (decided with the user): we link to photos on https://africanvioletsocietyofamerica.org/look/photo-gallery/ ; we never copy
the images, thumbnails or the AVSA captions. Once the links are in the database, the matching script, the review/unmatched reports
and the saved HTML pages are NOT kept (scratch only, deleted at the end). The only thing that stays is data/external_photos.csv,
because the database is built from the CSVs in data/ (it is the master for these links, hand-maintained from then on).

## What the saved pages hold
- 476 pages, 3,327 distinct photos. Caption format: `Name mm/dd/yyyy (Hybridizer) description. Size (codes)`; ~2,160 have a date; no
  registration numbers. Titles can carry a suffix like `_0`; 6 titles repeat.
- No page per photo; each has an anchor `id="envira-gallery-item-<id>"` on a paginated letter page
  `/look/photo-gallery/<letter>/?envira_id=<gallery id>&page=<n>` (page 1 = `/<letter>/`). Page numbers shift when the AVSA adds photos:
  fallback is the letter page.

## Step 1 result (tested live 2026-11-16)
`https://africanvioletsocietyofamerica.org/look/photo-gallery/b/2/#envira-gallery-item-9297` works WITHOUT the envira_id parameter: the
page loads (the site redirects `?page=2` to `/b/2/`) and the browser scrolls to the photo (Baby Pink). Use this URL form
(`/<letter>/` for page 1, `/<letter>/<n>/` otherwise, plus `#envira-gallery-item-<id>`).

## Site
- data/external_photos.csv: cultivar_id, url, source (avsa-gallery), gallery_title, item_id, matched_by, checked_at.
- build_db.py loads it into table external_photos (checks: cultivar exists, no duplicate cultivar+url).
- Cultivar page, Photo section: under our own gallery (or alone when we have none): "Photo at the AVSA Photo Gallery (submitted by AVSA
  members)", link opens in a new tab (rel noopener). "Has photo" filter stays for photos we host; separate marker/filter for link-outs (open question).

## Matching (temporary script in the scratchpad)
1. Parse title/caption/item id/page from each saved page; drop duplicate items.
2. Match the name via names_lib (normalising, aliases). Tiers: auto-exact (one record, hybridizer/date agree or empty); auto-same-name
   (hybridizer/date/description picks one of several); review (ambiguous or contradicting hybridizer/date); no match. Never auto-merge fuzzy matches.
3. Review file with a `decision` column (link | link:<id> | skip); unmatched gallery names reported (may reveal missing/misspelled cultivars).
4. Auto tiers + reviewed rows -> data/external_photos.csv.

## Order
1 test one anchor URL; 2 parse + match, report tier counts; 3 user decides review rows; 4 table + cultivar-page block; 5 build + export;
6 screenshots, commit; 7 delete scratch (468 MB) and the temporary script/reports.
