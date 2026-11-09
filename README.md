# Saintpaulia Ancestry

A searchable database of African violet (*Saintpaulia*) cultivars: heritage search with lineage
graphs, plus cultivar descriptions and AVSA registration details.

**Live site:** https://saintpaulia-ancestry-project.github.io/AncestrySearch/

The site is a static web page. The database (SQLite) runs in the browser with
[sql.js](https://github.com/sql-js/sql.js), so there is no server. Lineage graphs use
[Cytoscape.js](https://js.cytoscape.org/). All libraries are included in `site/vendor/`, so the site
also works offline.

## Run it on your own computer

You need Python 3 (no extra packages).

```
python scripts/serve.py
```

This serves the `site/` folder and opens it in your browser. (Opening `site/index.html` directly will
not work, because browsers block loading the database from a plain file.)

## How the data is built

```
source/  (original spreadsheet, SQLite and supplement workbooks; read-only)
   |  scripts/import_excel.py       needs pandas and openpyxl
   v
data/    (cleaned CSV files: cultivars, parentage, people, ...)
   |  scripts/build_db.py           standard library only
   v
site/avancestry.sqlite
```

```
pip install -r requirements.txt
python scripts/import_excel.py     # source/ -> data/ and reports/
python scripts/build_db.py         # data/ -> site/avancestry.sqlite
```

Human decisions that shape the import (which duplicates to drop, hybridizer name mapping, spelling
variants to merge, individual value corrections) are in `reports/review/`. `reports/import_flags.csv`
lists everything the import found unusual. `data/pages/*.md` holds the site's text pages.
`CLAUDE.md` records the design decisions in detail.

## Deployment

Every push to `main` rebuilds and validates the database, then publishes `site/` to GitHub Pages
(`.github/workflows/pages.yml`).

## Sources and credits

- The Saintpaulia Ancestry Project, a volunteer-built spreadsheet of African violet parentage
  started by Hector Wong.
- African Violet Society of America ([AVSA](https://www.avsa.org)) registration data and Master List
  supplements, 2010 to 2019.
- Site icon: illustration by brgfx (Magnific free vectors).

## License

The code is released under the MIT License (see `LICENSE`). The cultivar data is compiled from the
sources above and may carry its own terms.
