# Project history

African violets (Saintpaulia) have been hybridized for well over a century, and what is known about where a named cultivar came from is scattered across registrations, society publications and hybridizers' own records. This site brings that information together in one searchable place. It has two purposes:

- **Heritage search.** Follow a cultivar's ancestry back through its seed and pollen parents and its sports, and see which cultivars descend from it.
- **Cultivar descriptions.** Look up a cultivar's size, color, bloom and foliage, its hybridizer, and its AVSA registration details.

## How the project began

The site grew out of the Saintpaulia Ancestry Project, a volunteer-built spreadsheet recording the parentage of African violet cultivars, let by Hector Wong. It was first placed online in 2013 so that anyone could read and share the information. That spreadsheet is the source of the ancestry data here. This project turns it into a searchable database with lineage graphs, and combines it with registration and description data from the African Violet Society of America ([AVSA](https://www.avsa.org)), the international registrar of African violet cultivars.

## Where the data comes from

- **Ancestry:** the Saintpaulia Ancestry spreadsheet, which records each cultivar's seed parent, pollen parent, hybridizer and notes.
- **Descriptions and registrations:** a database of cultivar records, including sports, AVSA registration numbers and dates, size classes, and bloom and foliage descriptions, together with the AVSA Master List supplements.
- **Older cultivars:** the names, originators, registered flags and descriptions from the AVSA's 1963 Master List, which covers cultivars from 1935 to 1963. The book was read twice, once from the library's text and once from the page images, and a description is shown only where the two readings agree. A link on each cultivar page opens the scanned page.
- **Supplements 1964–2003:** the cultivars, descriptions and registration data printed in the AVSA Master List supplements in the [African Violet Magazine](https://www.biodiversitylibrary.org/bibliography/146187), whose digitized issues are curated by the Biodiversity Heritage Library. The printed lists were read by OCR; names, registration numbers and dates were checked, and entries without a description are not included. The color, bloom and foliage fields were derived from the printed descriptions. For 1969, 1975, 1976, 1981, 1983 and 1985 no supplement was printed, so those lists were rebuilt from the registration reports in the magazine; they carry no written description, and the description shown is decoded from the printed registration code.

Records from the first two sources are matched by cultivar name. The 1963 Master List reuses many names for different plants, so each entry there is kept as its own record and joins another record only when the originator agrees. Spelling variants and duplicate entries were reviewed by hand, and corrections continue. Where the sources disagree about the parent of a sport, the registry database is used and the spreadsheet's value is kept in the cultivar's notes.

## Searching

Type any part of a cultivar name, a hybridizer, a color or a description. Words match from the start, so `rob sticky` finds Rob's Sticky Wicket. Enter an AVSA registration number to go straight to that cultivar. You can narrow results by size, show only sports, or show only cultivars that have ancestry or a description.

## Reading a cultivar page

Each cultivar page shows its description, its parentage, the cultivars that came from it, its sport family, and a lineage graph. Small badges in the lists show what is known: **description**, **ancestry**, **sport** and the AVSA registration number.

A name marked **parent only** appears as a parent in someone's records but has no record of its own here: no description and no known parents. These are real plants. We just do not know more about them yet.

## Reading the lineage graph

Arrows run from parent to offspring. The style of the line shows the parent's role:

- **Solid violet:** seed parent.
- **Dashed pink:** pollen parent.
- **Dotted teal:** the cultivar is a sport of this parent.
- **Solid grey:** a parent whose role as seed or pollen was not recorded.

The outline around a parent's name matches the line drawn from it to its offspring. Pale italic names are parent-only names. You can choose how many generations of ancestors and descendants to show, and clicking any name opens that cultivar. A popular parent shows its first few children followed by "+N more"; the full list is on the cultivar page.

## What to keep in mind

- Not every cultivar has both ancestry and a description. Many have only one.
- Parentage is what hybridizers recorded. Some is uncertain, some records do not say which parent was seed and which was pollen, and some parents are unknown. These are shown as recorded and are not guessed.
- A parent recorded as "X Sport" is kept exactly as written. It is not assumed to be any particular registered sport of X.
- Cultivars from the 1963 Master List are marked **1963 list** and usually have only a name, an originator (as printed, often just a surname or a firm), a short description of the leaves and flowers, and whether they were registered. A few descriptions are missing because the two readings of the book disagreed and they are waiting to be checked against the page.
- Cultivars from the 1964–2002 supplements that were never registered are hidden from the default search results (untick the *Exclude old unregistered names* box; names found only in the 1963 Master List have their own *Exclude* box to see them). Names marked "spelling not checked" could not be confirmed against the Master Variety List.
- The information is the work of volunteers and published registries, and errors are possible. Please treat it as a reference and not as a guarantee.

## Using the data yourself

The site is a single web page plus one database file, and needs no server. The whole project is on GitHub at [Saintpaulia-Ancestry-Project/AncestrySearch](https://github.com/Saintpaulia-Ancestry-Project/AncestrySearch). To run your own copy:

- On the GitHub page, choose **Code**, then **Download ZIP**, and unzip it.
- Install Python 3 if you do not have it.
- In the unzipped folder, run `python scripts/serve.py`. Your browser opens on the site.

The cleaned data is in the `data` folder as plain CSV files, so you can open it in a spreadsheet. Adding your own hybridizing projects to a local copy is planned but not available yet.

## Contributing

Corrections and additions are welcome. If you spot a mistake or have information to add, open an [issue on GitHub](https://github.com/Saintpaulia-Ancestry-Project/AncestrySearch/issues) saying which cultivar and what should change. If you are comfortable with GitHub, you can send a pull request instead. A simpler way to send a whole hybridizing record, by exporting it as a CSV file, is planned.
