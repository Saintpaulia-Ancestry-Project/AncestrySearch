# Quick add: one cultivar from an AVSA-style list entry (plan; BUILT 2026-11-23, see Status at the end)

Goal: a very simple contribution path for a cultivar with no ancestry. The contributor pastes ONE entry in the format
the AVSA prints in its Master List supplements and registration lists, adds ONE photo, ticks the license box, and sends.
Example entry:

    Aca's Lady Jane (5037) 08/12/1982 (J. Brownlie) Semidouble pink. Plain, quilted. Semiminiature (CA 288, 1983)

Everything after the send is the existing pipeline: same receiver, same Sheet tab, same review, same import. Nothing new
server-side. Ancestry can be added later through the full form (`#/submit`, action `update`).

## What the entry contains (grammar)

    NAME (REG_NO) DATE (HYBRIDIZER) DESCRIPTION. FOLIAGE. SIZE (SOURCE REF, YEAR)

| Part | Example | Goes to |
|---|---|---|
| name | Aca's Lady Jane | `name` (normalised like every other name: NBSP, curly quotes, spaces) |
| `(digits)` right after the name | (5037) | `registration_no` |
| date | 08/12/1982 | `registered_date` as ISO 1982-08-12 (US month/day/year; see questions) |
| `( ... )` after the date | (J. Brownlie) | `hybridizers` (person; "J. Brownlie" becomes "Brownlie, J.", matched to existing people, else new) |
| first sentence(s) | Semidouble pink. | `description` (whole text) and, at ingest, `bloom_description` + `color` |
| foliage sentence | Plain, quilted. | `foliage_description` at ingest |
| size word | Semiminiature | `size_class` (matched against the sizes already in the database) |
| last `( ... )` | (CA 288, 1983) | `notes` as "Printed as: CA 288, 1983" (meaning of the code is not guessed) |

Every part except the name is optional: unregistered cultivars have no number or date, many entries have no hybridizer.
Anything the parser cannot place stays in `description`; nothing is dropped.

## Page: `#/quick` ("Add a cultivar from a list entry")

1. One large text box: "Paste or type the entry the way the AVSA prints it". Example shown under it.
2. Live "What we understood" table under the box: name, registration number, date, hybridizer, size, description. Each
   cell is an editable field, so a wrong guess is fixed by typing, never by re-pasting.
3. Checks, reusing the full form's code (`lookupExact`, parent/people autocomplete data from the loaded DB):
   - name already in the database: show it and offer "different cultivar with the same name" or "add to this one";
   - registration number already in the database: show that cultivar and stop (a number is unique); offer "open in the
     full form to correct it";
   - hybridizer matched to an existing person (shown), or "new person".
4. One photo: file picker, preview, credit (default = contributor name), the existing "I may share it" confirmation. The
   browser resizes it (1600 px, JPEG, EXIF dropped) with the existing function. Photo optional.
5. About you (name = public credit, contact private, license checkbox with the CC BY-NC-SA 4.0 text; the photo has its own
   confirmation, decision 2) and Send, with
   the "Download a copy (.csv)" fallback, both reusing `submit.js`.
6. Link at the top of `#/submit` ("Just have a list entry? Use quick add") and a button on `#/quick` ("This cultivar has
   ancestry: use the full form") that carries the parsed fields over.

## Data path (no change to the pipeline)

- The page builds ONE row with the existing columns (`action=new`, `kind=cultivar`, parents empty, one photo) and sends it
  through the same `SUBMIT_URL` receiver. The Sheet, `check_submissions.py`, `import_submissions.py` and `build_db.py` work as
  they are.
- ONE new column, `listing_text` (the pasted line exactly as typed), added to `FIELDS` in `submissions_lib.py`, `CSV_COLS`
  in `submit.js` and the header list in `Code.gs`. Reason: the reviewer sees what the contributor typed next to what was
  parsed, and a parsing bug can be re-run later. A non-empty `listing_text` also tells us the row came from quick add.
  The Sheet header gets the new column when `Code.gs`'s setup is re-run (it matches by header name, so old rows are fine).
- `data/submissions/<id>.csv` is tracked, so `listing_text` is public: it is the contributor's own text, no contact data.
- Colour/bloom/foliage split (the one part that is not in the browser): `import_submissions.py ingest` fills `color`,
  `bloom_description`, `foliage_description` from `description` only when those are empty and the sentence rule is
  confident (foliage words: foliage, plain, quilted, ruffled, wavy, variegated, girl, boy, tailored, glossy, ...; colour
  words taken from the existing `data/description_split.csv` vocabulary). When unsure it leaves the three fields empty and
  writes a `flag_other` note, so the reviewer fixes it with `corrected_*`. `description` itself is never changed.
- Hybridizer text: `names_lib.pkey` and the existing people matching are reused; no new matching rules.

## Parser (browser, `site/quickadd.js`)

- Pure functions, no DOM: `parseListing(text) -> {name, reg, date, hybridizer, rest, size, trailing, warnings}`.
- Order of work: trailing `( ... )` first (the source reference), then the first `(digits)` after the name, then a date
  `m/d/yyyy` (also `m-d-yyyy`, `yyyy-mm-dd`), then the next `( ... )` as hybridizer, the size word at the end of the
  remainder, and the rest is the description. A name that itself contains parentheses (rare) is handled by requiring the
  registration number to be digits only.
- Warnings, shown beside the table, not blocking: impossible date or first number above 12 (13/45/1982), two possible
  hybridizers, size word not recognised. A missing registration number is not a warning (see decision 6).

## Tests

- Python/JS fixture file `site/tests/quickadd_cases.json` (input line -> expected fields): the example above, no number, no
  date, no hybridizer, two hybridizers (`A & B`), name with an apostrophe and with parentheses, day-first date (13/08/1982)
  warned, a long description.
- Round-trip check against real data: format ~200 records of `data/cultivars.csv` that have a number, date and hybridizer as
  AVSA-style lines and parse them back; every field must come back equal. Run in headless Edge like the other front end tests.
- Python test for the colour/bloom/foliage splitter, using rows of `data/description_split.csv` as expected output.
- Manual: a live Send of a test entry with a photo, then ingest and build (`All checks passed.`).

## Build order (about a day)

1. `quickadd.js` parser + fixtures + round-trip test.
2. `#/quick` page: textbox, understood table, checks, About you, Send/Download (reuse functions from `submit.js`;
   move the shared ones to a small `submit-common.js` rather than copy them).
3. `listing_text` column in `submissions_lib.py`, `submit.js`, `Code.gs`; splitter in `import_submissions.py ingest`.
4. Text: `data/pages/contribute.md` section "Quick add", help text on the page, `notes/admin-submissions-guide.md` line.
5. Rebuild, test live, commit (deploy rule applies: data/pages change means rebuild both sqlite files and the xlsx).

## Decisions (user, 2026-11-23)

1. **Date order:** US month/day/year only. To protect contributors from other countries, the understood table writes the date
   out in words next to the field ("August 12, 1982, stored as 1982-08-12"), so a day/month mix-up is visible before sending.
   No guessing from the numbers; a first number above 12 gets a warning ("not a US month").
2. **Permission:** the AVSA registration number and this style of description are public information (the magazines the
   database already uses are CC BY-NC-SA 4.0), and the style is common for unregistered cultivars too. So the text needs only
   the normal license checkbox (CC BY-NC-SA 4.0). The one real permission is the PHOTO: its checkbox says the contributor took
   it or has the photographer's permission, and the credit is required.
3. **Separate page** `#/quick` (not a tab in `#/submit`).
4. **One entry per send.** One text box, one photo, no batch. (Several lines can be reconsidered later; the parser is per line.)
5. **`(CA 288, 1983)`-style trailing text:** kept as a note only ("Printed as: ...").
6. **No registration number is normal** (more hybridizers register only their best plants): accepted as an ordinary
   `kind=cultivar` with no warning beyond a quiet "no registration number" line in the understood table.

## Status (2026-11-23): built, not committed, not yet live-tested

Built: `site/quickadd.js` (parser + page, route `#/quick`), `data/pages/quick.md`, a Quick add line in `contribute.md`,
`listing_text` column (`submissions_lib.py` FIELDS, `submit.js` CSV_COLS, `apps_script/Code.gs` COLUMNS), the description
splitter `split_description()` in `submissions_lib.py` used by `import_submissions.py ingest` (quick rows only) and shown as a flag by
`check_submissions.py`, admin guide paragraph. Shared helpers are used straight from `submit.js` (loaded first); no
`submit-common.js` was needed. Tests (all pass): `scripts/test_submissions_quick.py` (Python),
`site/tests/quickadd-test.html` (parser, 923 checks incl. 150 real records from `scripts/make_quickadd_fixtures.py`) and
`site/tests/quick-page-test.html` (the real page, 25 checks), the last two run by `scripts/run_browser_test.py tests/<page>`.
STILL TO DO: re-publish `Code.gs` (new `listing_text` column; re-run `setupSheet`), a live Send with a photo, then commit.

LIVE SEND (2026-11-23): works (thank-you message received). The earlier CORS error was a stale strict `decision` dropdown on Sheet column
AE (listing_text); see CLAUDE.md. Still not tried live: a photo (the receiver code for photos is unchanged and tested earlier).
