# Saintpaulia Hybridizer: Stage 1 report (storage and transfer tests)

Date: 2026-11-17. Raw evidence and day-by-day notes: notes/my-crosses-plan.md (sections "Stage 1 storage tests", "Android ...", "Direct link ...").
Test page: site/spike-hybridizer/ (temporary; remove after the open items below are closed).
Devices: Windows 10 PC (Edge 157 headless and Chrome 157), Android 10 phone (Chrome 157, 4 GB RAM), a laptop and an iPad (direct-link tests only). Synthetic data (1,200 seedlings, 1,200 photos) plus real camera photos.

## Verdict
The plan stands: **local-first PWA, IndexedDB for user records and photos, the official database in the same in-memory sql.js engine, sync through a zip file.**
Nothing found blocks Stage 2. Four things are NOT yet proven (see "Open items"): storage lifetime (canary), iPhone/Safari, persistent storage after install, and the Android phone sending over the direct link.

## What is proven

| Question | Result |
|---|---|
| IndexedDB holds 1,200 photos plus records | PC 4.2 s, Android 132 s (JPEG encoding dominated); quota 10 GB on both; records write 117 to 238 ms, read 21 to 29 ms |
| Real storage need | Real camera photos shrink to 45 to 91 KB (full, 1000 px) and 15 to 31 KB (thumbnail): 1,200 photos is about 90 MB, thumbnails about 17 MB |
| Sync zip build (streamed, photos stored) | Thumbnails 17 MB in 1.4 s (PC) / 4.8 s (Android); all photos in 5.9 s / 7.8 s; heap peak 53 MB on PC |
| Zip read-back | Needs the **central-directory reader** (fflate's streaming Unzip corrupted 2 to 4 of 1,200 stored JPEGs, both devices). The reader verified 1,200/1,200, detected a flipped byte, refused truncated, non-zip, `../`, absolute, backslash names and oversized entries |
| Official DB and user data in ONE sql.js engine | Works on both. Join through `id_redirects` 1 to 3 ms, recursive ancestors across both data sets 26 to 55 ms, FTS search 8 to 21 ms, extra heap about 42 MB. The 36.7 MB download took 17.8 s on the phone's connection: cache it in the browser (Cache Storage + `meta.built_at` check) |
| Photo pipeline | EXIF/GPS/XMP/IPTC removed on 10 of 10 real photos and the synthetic test; portraits upright; 120 to 290 ms each |
| Picking photos on Android | Works for gallery, file browser and camera **if the file is copied into memory in the `change` event**. Reading it later fails (NotReadableError) |
| Saving a sync file on Android | **Save...** (showSaveFilePicker) works and reaches Drive; **Download** works |
| Sharing a zip on Android | Refused as `.zip`; **works as `<name>.zip.txt` typed text/plain**. The importer must accept both (it checks content, not the name) |
| PC remembers a folder | **Works** in Chrome across browser restarts (directory handle in IndexedDB). The phone also has showDirectoryPicker |

## Transfer routes (decided)
- **A, main: Google Drive folder.** Phone saves its own file (`my-hybridizer-<device>.zip`) with Save...; the PC reads the newest file of each other device from a remembered folder. Needs no pairing and no good Wi-Fi.
- **B, optional: direct link over the home Wi-Fi** (WebRTC data channel, no server, no STUN). **KEPT.**
  - Pairing that works: PC shows a QR code; the phone scans it with its camera; the phone's answer goes back as text (share to WhatsApp, or paste); the PC connects by itself. The PC needs microphone permission once (nothing recorded) or Chrome hides its address behind a `.local` name that phones often cannot resolve.
  - Speed: **laptop to iPad 1.8 to 4.2 MB/s (20 MB in 3.8 s = 5.3 MB/s)**. The same Wi-Fi with the Android 10 phone: 0.2 to 0.55 MB/s regardless of message size, buffer, USB port, router channel or PC. So the Android phone is the slow end. Usable (thumbnail sync about 17 MB: 4 s on a fast device, 30 to 90 s on this phone; all photos about 90 MB: about 20 s versus 3 to 8 min).
  - Sender rules: 64 KB messages, keep `bufferedAmount` at or below 4 MB (256 KB messages with a 16 MB buffer failed with "send queue is full" at 14 MB), progress and cancel, expect up to about 12 s to connect.
  - Not built: an 8-digit pairing code (needs a small rendezvous service such as PeerJS or our own Cloudflare Worker). Decide in a later stage.
- **C, QR streams:** dropped as a receiving route (no PC camera); QR is used only for pairing.
- **Not chosen:** data hidden in an image, copy and paste through a messenger, e-mail. A USB cable stays a documented offline fallback.

## Design consequences for Stage 2
1. Copy chosen files into memory at the `change` event; offer camera and file browser first; the gallery picker works only with that rule.
2. Sync file reader: central-directory reader with the limits tested (20,000 entries, 60 MB per entry, 2 GB total, no zip64, refuse unsafe names); verify the sha256 of each photo.
3. Buttons: **Save...** main, **Share...** only where a zip is accepted (name it `.zip.txt` on Android; hide after the first NotAllowedError), **Download** always.
4. `navigator.storage.persist()` was not granted on a fresh site: ask again after Home Screen install, explain in plain words, show a "last backup" age on the home screen, and treat backups as essential.
5. Cache the official database (Cache Storage, version check) and show download progress: "Online only" means once per update, not once per visit.
6. Version the app's files (service worker with a version number or hashed names): GitHub Pages serves pages with `max-age=600`, so a new tab can show a 10-minute-old copy. Show the build number in the app.
7. Direct link: microphone-permission step before the offer, QR pairing, 64 KB messages, buffer cap 4 MB, progress, cancel.
8. Photo sizes: 1000 px full and 300 px thumbnails are small enough; "large sync" is about 90 MB per 1,200 photos.

## Environment notes (your network)
- Office PC: TP-Link Wireless Nano USB adapter (802.11n, 2.4 GHz only), 59% signal, 20 MHz after the router change to channel 6; internet download 1.8 to 2.1 MB/s, ping to the router 1 to 3 ms. It is not the cause of the slow direct link.
- Windows marks the home network "Public" (blocks incoming connections by default). WebRTC is unaffected; a plain local web server would be. No firewall rule was added; the speed test server was stopped.

## Open items (not blocking Stage 2)
1. **Canary:** open the test page again after several days; did the stored data survive? Mandatory on iPhone.
2. **iPhone / Safari:** storage limits, eviction rules, share behavior. The iPad received over the direct link fine, but a real storage test is still missing.
3. **Persistent storage after Home Screen install:** is `persist()` granted then?
4. **Android phone to PC over the direct link** on a good network (the direction users will use).
5. **Short pairing code** (rendezvous service): decide later.
6. **Housekeeping after the open items:** delete `site/spike-hybridizer/`; keep this report and the plan. (The page is public and temporary; it holds only synthetic test data.)
7. Still waiting on the user: sending the draft message to the Gesneriad Reference Web editors (see notes/gesneriads-species-photos-plan.md).

## Next: Stage 2
Local schema and IndexedDB layer in `site/mycrosses/`, the sync-file format with dry-run and one-transaction import, Node tests for the zip reader and the merge rules, and `docs/sync-format.md` (see the plan, "Stages").
