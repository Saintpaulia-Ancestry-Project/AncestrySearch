# WordPress image manifest: summary

Source: https://saintpauliaancestry.wordpress.com/ via the WordPress.com public API (posts, with categories and content). robots.txt allows it. Responses are cached in `cache/wp_scrape/` (git-ignored). **No images were downloaded.**

## Counts

- posts: 141 (85 contain images)
- image occurrences: 649; unique full-size URLs (manifest rows): 637; in more than one post: 5
- final decision (after credit review): include 260, exclude 377: no database match (excluded for now) 278, photo of an unnamed cross (no cultivar to attach to) 98, no credit information 51, category excluded (hybridizer_credit_names.csv) 42, reviewer: exclude (credit_decisions.csv) 16, magazine page scan 5
- keep: yes 119, review 518
- label role: other 397, cross 123, unlabelled 91, seed_parent 13, pollen_parent 13
- label source: alt 266, line-after 200, none 91, line-before 48, line-before (inherited) 32
- credit basis: category-default 547, caption 79, none 11
- label role by post type (unique images): cross post: other 124, cross 123, pollen_parent 13, unlabelled 13, seed_parent 12; other post: other 97, unlabelled 10; photos of a hybridizer's cultivars: other 176, unlabelled 68, seed_parent 1

## Matching against the database

- exact: 242
- policy-link: 11
- reviewed-link: 8
- exact-ambiguous: 0
- near-miss: 7
- unmatched: 176
- cross-unnamed: 98
- no-label: 95

`exact` = one record whose normalised name equals the label (import_excel normalisation: case, accents, punctuation, curly quotes ignored). `exact-ambiguous` = several records share the name (never chosen; see near_misses.csv). `cross-unnamed` = a 'seedlings' style photo of the cross itself, which has no cultivar name; `cross_offspring_in_db` lists cultivars whose seed and pollen parents equal the title's parents. Nothing is guessed.

Near-miss rules that produced candidates (all suggestions only):

- name contained in label (or label contained in name): 11 candidates
- similar spelling: 1 candidates

## Flags

- posts with more than one hybridizer category: 3 (confusa Mather #5 x Optimara Hawaii 2 by Hector Wo; AN Rio Rita x self; Kelso, Nathan -Edinburgh, United Kingdom)
- posts with no hybridizer category: 11 (9 images)
- credit_review.csv rows: 135 across 32 posts; by reason: post carries a 'watermarked photos by .. 65, image links to an external page (www.eba 21, non-Saintpaulia post (Gesneriad category 12, post has several hybridizer categories 9, no credit 8, post has several hybridizer categories 5, no hybridizer category (only 4, no hybridizer category (only 4
- hybridizer_mismatch.csv rows: 9 (parent photos naturally differ; filter on label_role)
- hybridizer categories: 58 map to exactly one people row, 0 ambiguous, 11 unmapped (see hybridizer_category_map.csv)

## Method notes and assumptions to review

- Label position varies by post. The script detects per post whether names come **before** images (colon labels such as 'seedlings:') or **after** them (captions, e.g. Hancock, Baker, Trigg posts) and records the choice in `label_source`; images without their own line inherit a neighbour's label and are marked `(inherited)`, keep=review.
- Role from the title: first parent of 'A x B' is taken as the seed parent, second as pollen parent, unless the label itself says otherwise. 'x self' makes both parents the same name.
- Full-size URL = the link around the thumbnail when it points to an image file. 61 wrappers point to an attachment page or eBay instead; for those `data-orig-file` (or src without the query) is used (`full_url_source`).
- Credit lines placed before the first image, or ending in ':' ('photos by Joan Baker:'), are treated as headers that apply to the images that follow (`credit_scope`). A watermark notice ('photos by Blue Mountain Violets are copyrighted') is **not** read as a credit; those images get the category default and a review flag.
- Posts in the Gesneriad categories (Sinningia, Streptocarpus) are non-Saintpaulia: kept in the manifest with keep=review.
- Name aliases from name_near_misses.csv are not applied here; matching uses the final names in data/cultivars.csv.
- The User-Agent names the project; no contact address was supplied, so none was sent (pass `--contact` if the cache is cleared).
