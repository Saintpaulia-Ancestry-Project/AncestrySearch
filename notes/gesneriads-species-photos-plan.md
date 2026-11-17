# Species photos from the Gesneriad Reference Web: link out now, host after permission (plan, 2026-11-17; NOT yet implemented)

Source: https://gesneriads.info/articles/streptocarpus-2/subgeneric-and-sectional-classification/subgenus-streptocarpella/section-saintpaulia/
(Gesneriad Reference Web, a project of the Gesneriad Society). Same principle as the AVSA Photo Gallery (notes/avsa-gallery-plan.md):
we LINK ONLY until the Site Editors confirm in writing that we may host resized copies (see "Hosting copies" below); we never copy their captions.

## What the site offers (read 2026-11-17)
- The section page lists 19 taxa; 18 have their own page under /genera/ (subsp. mafiensis has none: no photos).
- Each taxon page has 1-9 photos (a feature photo plus "click here" links to more; some pages show clone photos too).
  Total about 70 photos. Pages: afroviola (8), brevipilosus (1 shown + 3 linked), goetzeanus (1 + 3), inconspicuus (2), ionanthus var. ionanthus (9),
  var. diplotrichus (4), grandifolius (4), grotei (6), occidentalis (1), orbicularis (3), pendulus (3), rupicolus (4), velutinus (5), nitidus (2),
  shumensis (6), teitensis (5), ulugurensis (5 incl. a painting), watkinsii (5 incl. a painting).
- Credits: the feature photo usually has "Photographer: X / Grown by: Y"; most further photos have only a caption (the photographer is sometimes
  in the file name). Per the site's copyright page, where no photographer is named it is Ronald Myhr.
- Licensing (https://gesneriads.info/copyright): photos belong to their photographers or institutions; non-commercial reuse is allowed with the
  photographer credited, the source named "the Gesneriad Reference Web, a project of the Gesneriad Society" and a link to www.gesneriads.info;
  photos under a Creative Commons license state it on the image page (found: afroviola Heinrich Human CC BY-NC 4.0; ulugurensis and watkinsii
  Sadie Barber / RBGE CC BY-NC 3.0). Footer: "(c) The Gesneriad Society 2026. All rights reserved." Linking needs no permission, but we show
  the source and the credit with every link, which also meets their conditions if anyone follows it.

## Hosting copies instead of links (asked 2026-11-17)
Their license (https://gesneriads.info/copyright): photos belong to their photographers/institutions; non-commercial reuse is allowed with the
photographer credited, the source named and a link to www.gesneriads.info; photos with an explicit Creative Commons license follow that license.
Footer: "All rights reserved". The Society may not be able to grant reuse on behalf of every photographer, and our images repo is public (anyone
downloading it inherits the non-commercial condition), so:
- DECIDED approach: ask the Site Editors for written confirmation first (message below). Until the answer is recorded, LINK ONLY (this plan).
- Only the photos whose page states a license may be hosted without asking: afroviola feature photo (Heinrich Human, CC BY-NC 4.0), ulugurensis and
  watkinsii feature photos (Sadie Barber / RBGE, CC BY-NC 3.0). Photos whose file name merely contains "BY-NC" are NOT enough: check the image page.
- Hosting steps once permitted: scripts/add_images.py (credit REQUIRED; strips EXIF; photos/ + thumbs/ in the images repo), add a `license` column
  to data/images.csv, credit + license + "Source: Gesneriad Reference Web" link under each photo on the cultivar page, About text says the images are
  hosted with permission of the Gesneriad Society and their photographers. Photographer unknown on the page = ask, never infer from file names.
  The site and the images repo must stay non-commercial; the images repo README says each photo keeps its own license/credit.
- If the Editors decline or only some photographers agree: keep the link-outs for those.

### Draft message to the Site Editors (send via https://gesneriads.info Contact page; the user fills in the bracketed parts)
Subject: Request to host resized photos of Saintpaulia species with credit (Saintpaulia Ancestry)

Dear Gesneriad Reference Web editors,

I am writing for the Saintpaulia Ancestry Project, a free, non-commercial, volunteer-run online database of African violet cultivars and their ancestry
(https://saintpaulia-ancestry-project.github.io/AncestrySearch/). It includes a page of the wild Saintpaulia species
(now Streptocarpus section Saintpaulia), with names and descriptions following Barbi (2019) and Smith and Goretsky (2018).

Your pages for the species in section Saintpaulia (https://gesneriads.info/articles/streptocarpus-2/subgeneric-and-sectional-classification/subgenus-streptocarpella/section-saintpaulia/
and the 18 taxon pages linked from it) have the best photos of these plants that we have seen. We would like to show up to three of them for each
species, subspecies, variety or clone on its page in our database.

Your copyright page allows non-commercial use with the photographer credited, the source named and a link to www.gesneriads.info. Before we host any copies,
could you confirm that this covers our use, and tell us if any photos should be left out?

What we would do:
- Show resized copies (longest side 1600 px, with a smaller thumbnail), with EXIF and location data removed.
- Show under every photo: the photographer's name as given on your page (or as you tell us), the license where one is stated (for example CC BY-NC),
  and "Source: the Gesneriad Reference Web, a project of the Gesneriad Society" linking to the taxon page on gesneriads.info.
- Keep the project non-commercial, with no advertising, and take down any photo within a few days if you or the photographer ask.
- Where a photographer is not named on your page, we would ask you rather than guess.

The images would be stored in a public repository and delivered through a content delivery network, so people who download our project could also
receive the photos. We would state in that repository that each photo keeps its own credit and license. If you prefer that we only link to your pages, we
will keep doing that, which is what we do for now.

Thank you for the reference web, and for any guidance you can give.

Kind regards,
[name], on behalf of the Saintpaulia Ancestry Project
[contact email]

### When the answer comes
Record the answer (date, who, what was agreed, any excluded photos or photographers) in this note and in the CLAUDE.md To Do before importing anything.

## Mapping to our records (82 kind=species records, AVSA codes)
Taxon page -> record(s). A photo of a named clone goes to that clone's record when we have one, else to the taxon's record.
- afroviola -> S. 2. afroviola; brevipilosus -> S. 6. brevipilosus / cl. brevipilosus (Mather No. 10, Grusell...); goetzeanus -> S. 9. goetzeanus;
  inconspicuus -> S. 1. inconspicuus; nitidus -> S. 7. nitidus; shumensis -> S. 3. shumensis / cl. shumensis (Mather EE);
  teitensis -> S. 4. teitensis; ulugurensis -> S. 8. ulugurensis; watkinsii -> S. 10. watkinsii.
- ionanthus: var. ionanthus -> 5c1 (clones House of Amani, tongwensis, Pangani Falls, Sigi Falls); var. diplotrichus -> 5c2 (Parker, Punter 0, Punter 7);
  grandifolius -> 5a (cl. 237); grotei -> 5b (confusa, difficilis, magungensis, magungensis var. minima, Silvert); mafiensis -> 5d (no page);
  occidentalis -> 5e; orbicularis -> 5f (var. purpurea); pendulus -> 5g (var. kizarae); rupicolus -> 5h (Cha Simba, Mather No. 5, Kacharoroni);
  velutinus -> 5i.
- Final mapping is a small hand-checked table (taxon page URL -> record id), reviewed by the user. Clones we have no record for stay on the taxon record.
- Page quirks to keep: brevipilosus URL slug "saintpaulia-brevipilosus", velutinus "streptocapus-..." (typo on their side): copy URLs exactly.

## Selection: up to 3 links per record
Order of preference: (1) whole plant in flower, cultivated; (2) flower close-up; (3) habitat/in-situ or leaf. Paintings and seed pods are skipped.
Nothing is invented: a record with no suitable photo gets none. The 3-link cap is enforced by build_db.py (error if exceeded).

## What a link is
Open question for the user (recommendation first):
A. (recommended) one link per photo to the TAXON PAGE with the photographer and a short description as the link text ("Photo 1: whole plant,
   Ron Myhr"), plus one line "Photos at the Gesneriad Reference Web". Page URLs are stable, file names are not.
B. direct link to the image file (opens just the picture; the file name may change when they re-upload, as the 2026/01 uploads suggest).
Either way the link opens in a new tab with rel="noopener". We also check each URL with a HEAD request at build time of the CSV and store checked_at.

## Data
Reuse data/external_photos.csv and the external_photos table (currently cultivar_id, url, source, gallery_title). Add columns: `credit` (photographer
only where the page states it, else empty), `description` (our own short words, not their caption), `page_url`, `sort_order`;
`source` = gesneriads-reference-web. build_db.py: cultivar exists, no duplicate cultivar+url, max 3 per cultivar+source. The existing 2,757 AVSA rows keep working
(new columns empty). data/external_photos.csv stays the hand-maintained master; the one-off script and the page text we read are scratch only.

## Site
- Cultivar page photo block (already lists AVSA links): add a second heading "Photos at the Gesneriad Reference Web (Gesneriad Society)",
  each link with credit, and the line "Credit the photographer and the Gesneriad Reference Web if you reuse a photo; see their copyright page."
- Species page (#/species): a camera marker next to species that have links.
- "Has photo" filter stays for photos we host.

## About page (draft text, add after the "Photo links" bullet)
- **Species photo links:** pages of species, subspecies, varieties and clones of *Saintpaulia* (now *Streptocarpus* section *Saintpaulia*) link to up to
  three photos of the same plant on the [Gesneriad Reference Web](https://gesneriads.info), a project of the Gesneriad Society. We only link to those
  photos; the images stay on that site and belong to their photographers and institutions, who are named where the Reference Web names them. Some are
  shared under Creative Commons licenses (stated on the image page). If you want to reuse one, follow the terms on their
  [copyright page](https://gesneriads.info/copyright).

## Order of work
0 user sends the message above (links only until answered); 1 user decides A or B and the mapping table; 2 fetch each page's HTML once and list photo, caption, credit, license per taxon (scratch);
3 user reviews the proposed (record, 3 photos) list; 4 write rows into data/external_photos.csv; 5 schema columns + cultivar page block + About text;
6 build (All checks passed.), export xlsx, screenshots, commit; 7 delete scratch. Optional courtesy: tell the Site Editors via their Contact page.
