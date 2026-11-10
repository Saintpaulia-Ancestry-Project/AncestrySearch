# 1963 Master List: merge of the two OCRs

- final entries written to data/masterlist1963.csv: **12809** (11754 with a description)
- OCR 2 entries: 11746; paired with an OCR 1 entry: 11640 (11584 by exact name, 56 by a close name on the same page)

## How each entry's text was decided (final state)

| ocr_check | entries |
|---|---|
| verified | 10313 |
| name list (no description in the book) | 1055 |
| ocr1 incomplete | 732 |
| ocr1 had neighbour text | 428 |
| image-checked | 156 |
| ocr2 only | 101 |
| reviewed | 24 |

Disagreements found while merging (before the review file's corrections):

| finding | count |
|---|---|
| verified | 10313 |
| name list (no description in the book) | 1055 |
| ocr1 incomplete | 732 |
| ocr1 had neighbour text | 431 |
| unresolved | 168 |
| ocr2 only | 102 |
| ocr2 only, name found on the OCR 1 page | 100 |
| entry only in OCR 1 | 74 |
| originator differs | 69 |
| name differs | 56 |
| registered flag differs | 18 |
| originator spelling settled | 17 |
| stray tail removed | 9 |

Review file: 387 rows in reports/review/masterlist_ocr_review.csv

| check_status | rows |
|---|---|
| claude:image agrees with OCR 2 | 220 |
| claude:resolved by rule (not image-checked) | 71 |
| claude:image agrees with OCR 1 | 59 |
| human:reviewed by the user (reports/masterlist | 37 |


| issue | rows |
|---|---|
| description unresolved | 168 |
| entry only in OCR 1 | 74 |
| originator differs | 69 |
| name differs | 56 |
| registered flag differs | 18 |
| entry only in OCR 2 | 2 |