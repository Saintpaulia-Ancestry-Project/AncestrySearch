/* Contributor submission form (route #/submit). See notes/submission-form-plan.md.
 * Nothing is sent anywhere by this page: it builds a CSV in the browser that the contributor downloads and sends
 * to the project. A "Send" button for the Apps Script receiver comes later (SUBMIT_URL).
 * Uses helpers and the open database from app.js (q, q1, esc, $, renderProse).
 */
"use strict";

const SUBMIT_URL = "https://script.google.com/macros/s/AKfycbwGg_E_NSpjUvGGAHeOTWSzQ4Z9Zn_G1e--JeSSDlBx3cz0Fktfybo4DFwzdjPfty-q/exec";                       // Apps Script web app address; empty = download only
const SUBMIT_EMAIL = "";                     // where to send the downloaded file; shown when set
const DRAFT_KEY = "av_submission_draft_v1";
// Same column names as scripts/submissions_lib.py (SUBMISSION_COLS + FIELDS)
const CSV_COLS = ["submission_id", "entry_no", "received_at", "submitter_name", "contact", "agreed_license",
  "action", "existing_id", "name", "kind", "hybridizers", "year_introduced", "seed_parent", "pollen_parent",
  "parent_certainty", "sport_of", "parentage_note", "registration_no", "registered_date", "size_class", "color",
  "bloom_description", "foliage_description", "description", "notes", "links", "photo_files", "photo_captions",
  "photo_credits", "photo_permission"];

/* ------------------------------------------------------------------ state */
const sub = { sid: "", sendMsg: null, sending: false, about: { name: "", contact: "", hybridizer: "", license: false }, entries: [], open: new Set(), files: {} };
let uidCounter = 0;

const blankRef = () => ({ text: "", id: "" });
function newEntry(from) {
  const e = {
    uid: "e" + (++uidCounter), name: "", kind: "cultivar", hyb: sub.about.hybridizer, year: "", origin: "cross",
    seed: blankRef(), pollen: blankRef(), sport: blankRef(), certainty: "known", pnote: "", reg: "", regdate: "",
    size: "", color: "", bloom: "", foliage: "", desc: "", notes: "", links: "", photos: [], photoOk: false, existing_id: "",
  };
  if (from) {   // Duplicate: keep who and how it was made, not the name-specific details
    Object.assign(e, { kind: from.kind, hyb: from.hyb, year: from.year, origin: from.origin, certainty: from.certainty,
      seed: { ...from.seed }, pollen: { ...from.pollen }, sport: { ...from.sport }, size: from.size });
  }
  return e;
}
const makeSid = () => {
  const d = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `s-${d}-${Math.random().toString(36).slice(2, 6)}`;
};

function saveDraft() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ sid: sub.sid, about: sub.about, entries: sub.entries }));
  } catch (_) { /* private window or storage blocked: the form still works */ }
}
function loadDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
    if (d && Array.isArray(d.entries)) {
      sub.sid = d.sid || makeSid();
      sub.about = { ...sub.about, ...d.about };
      sub.entries = d.entries.map((e) => ({ ...newEntry(), ...e, uid: "e" + (++uidCounter) }));
      return true;
    }
  } catch (_) { /* ignore a damaged draft */ }
  return false;
}
function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch (_) { /* ignore */ } }

/* ------------------------------------------------------------------ CSV */
function csvCell(v) {
  const s = String(v ?? "");
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function toCsv(rows, cols) {
  return [cols.join(",")].concat(rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))).join("\r\n") + "\r\n";
}
function parseCsv(text) {
  text = text.replace(/^﻿/, "");
  const rows = [];
  let row = [], cell = "", inq = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inq) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inq = false; } else cell += c;
    } else if (c === '"') inq = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = ""; rows.push(row); row = [];
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  const head = rows.shift() || [];
  return rows.filter((r) => r.some((x) => x !== "")).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

/** A parent field as it goes into the CSV: the id when the name is shared by several cultivars. */
function refOut(ref) { return ref.id && ref.ambiguous ? "id:" + ref.id : ref.text.trim(); }
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const pipeSafe = (s) => clean(s).replace(/\|/g, "/");

function entryRow(e, i, photoNames) {
  const photos = e.photos.filter((p) => clean(p.file));
  const sport = e.origin === "sport", cross = e.origin === "cross";
  return {
    submission_id: sub.sid, entry_no: String(i + 1), received_at: "", submitter_name: clean(sub.about.name),
    contact: clean(sub.about.contact), agreed_license: sub.about.license ? "yes" : "no",
    action: e.existing_id ? "update" : "new", existing_id: e.existing_id, name: clean(e.name), kind: e.kind,
    hybridizers: e.hyb.split(";").map(clean).filter(Boolean).join("; "), year_introduced: clean(e.year),
    seed_parent: cross ? refOut(e.seed) : "", pollen_parent: cross ? refOut(e.pollen) : "",
    parent_certainty: cross || sport ? e.certainty : "", sport_of: sport ? refOut(e.sport) : "",
    parentage_note: clean(e.pnote), registration_no: clean(e.reg), registered_date: e.regdate,
    size_class: clean(e.size), color: clean(e.color), bloom_description: clean(e.bloom),
    foliage_description: clean(e.foliage), description: clean(e.desc), notes: clean(e.notes),
    links: e.links.split(/\s+/).filter((u) => /^https?:\/\//i.test(u)).join("|"),
    photo_files: photos.map((p, k) => pipeSafe(photoNames ? photoNames[k] : p.file)).join("|"),
    photo_captions: photos.some((p) => clean(p.caption)) ? photos.map((p) => pipeSafe(p.caption)).join("|") : "",
    photo_credits: photos.map((p) => pipeSafe(p.credit || sub.about.name)).join("|"),
    photo_permission: photos.length && e.photoOk ? "yes" : "",
  };
}
const buildCsv = () => toCsv(sub.entries.map(entryRow), CSV_COLS);

/** Rebuild the form state from a CSV this page produced (or a reviewed Sheet export). */
function entriesFromRows(rows) {
  const first = rows[0] || {};
  sub.sid = first.submission_id || makeSid();
  sub.about = { name: first.submitter_name || "", contact: first.contact || "", hybridizer: "", license: first.agreed_license === "yes" };
  sub.entries = rows.map((r) => {
    const e = newEntry();
    const ref = (t) => (t.startsWith("id:") ? { text: t.slice(3), id: t.slice(3), ambiguous: true } : { text: t, id: "" });
    const files = (r.photo_files || "").split("|").filter(Boolean), caps = (r.photo_captions || "").split("|"), creds = (r.photo_credits || "").split("|");
    return Object.assign(e, {
      name: r.name || "", kind: r.kind || "cultivar", hyb: r.hybridizers || "", year: r.year_introduced || "",
      origin: r.sport_of ? "sport" : (r.seed_parent || r.pollen_parent ? "cross" : "unknown"),
      seed: ref(r.seed_parent || ""), pollen: ref(r.pollen_parent || ""), sport: ref(r.sport_of || ""),
      certainty: r.parent_certainty || "known", pnote: r.parentage_note || "", reg: r.registration_no || "",
      regdate: r.registered_date || "", size: r.size_class || "", color: r.color || "", bloom: r.bloom_description || "",
      foliage: r.foliage_description || "", desc: r.description || "", notes: r.notes || "",
      links: (r.links || "").split("|").join("\n"), existing_id: r.existing_id || "",
      photos: files.map((f, k) => ({ file: f, caption: caps[k] || "", credit: creds[k] || "" })), photoOk: r.photo_permission === "yes",
    });
  });
}

/* ------------------------------------------------------------------ checks */
function lookupExact(name) {
  const n = clean(name).replace(/[‘’]/g, "'");
  if (!n) return [];
  return q("SELECT id, name, kind, hybridizer_raw AS hyb FROM cultivars WHERE name = :n COLLATE NOCASE LIMIT 8", { n });
}
function validate() {
  const errors = [], warnings = [];
  const E = (i, m) => errors.push({ i, m }), W = (i, m) => warnings.push({ i, m });
  if (!clean(sub.about.name)) E(-1, "Enter your name under About you (it is used as the credit).");
  if (!sub.about.license) E(-1, "Tick the agreement box under About you.");
  if (!sub.entries.length) E(-1, "Add at least one cultivar.");
  const seen = new Map();
  sub.entries.forEach((e, i) => {
    const label = clean(e.name) || `Cultivar ${i + 1}`;
    if (!clean(e.name)) E(i, `${label}: the name is required.`);
    else {
      const k = clean(e.name).toLowerCase();
      if (seen.has(k)) E(i, `${label}: the same name is already entry ${seen.get(k) + 1} in this submission.`);
      seen.set(k, i);
    }
    const refs = e.origin === "cross" ? [["seed parent", e.seed], ["pollen parent", e.pollen]] : e.origin === "sport" ? [["sport parent", e.sport]] : [];
    refs.forEach(([role, r]) => {
      if (clean(e.name) && clean(r.text).toLowerCase() === clean(e.name).toLowerCase()) E(i, `${label}: the ${role} cannot be the cultivar itself.`);
      if (clean(r.text) && !r.id && parentCount(r.text) > 1) W(i, `${label}: "${r.text}" matches several cultivars. Pick the one you mean from the suggestions.`);
    });
    if (e.origin === "sport" && !clean(e.sport.text)) E(i, `${label}: enter the cultivar it is a sport of, or choose another origin.`);
    if (clean(e.reg) && !/^\d+$/.test(clean(e.reg))) E(i, `${label}: the AVSA registration number must be digits only.`);
    const ph = e.photos.filter((p) => clean(p.file));
    if (ph.length && !e.photoOk) E(i, `${label}: confirm you have the right to share the photos, or remove them.`);
    if (ph.some((p) => !clean(p.credit || sub.about.name))) E(i, `${label}: every photo needs a credit.`);
    if (e.links.split(/\s+/).some((u) => u && !/^https?:\/\//i.test(u))) W(i, `${label}: a link does not start with http:// or https:// and will be left out.`);
    if (!e.existing_id && clean(e.name)) {
      const m = lookupExact(e.name);
      if (m.length) W(i, `${label}: a cultivar with this name is already in the database. The reviewer will check whether it is the same one.`);
    }
    if (!clean(e.desc) && e.origin === "unknown" && !clean(e.color) && !clean(e.bloom) && !clean(e.foliage)) W(i, `${label}: no description and no parentage. Add one or the other.`);
  });
  return { errors, warnings };
}
function parentCount(name) {
  const r = q1("SELECT count(*) AS n FROM cultivars WHERE name = :n COLLATE NOCASE", { n: clean(name).replace(/[‘’]/g, "'") });
  return r ? r.n : 0;
}

/* ------------------------------------------------------------------ rendering */
let sizeOptions = null;
function sizeList() {
  if (!sizeOptions) sizeOptions = q("SELECT size_class AS s FROM cultivars WHERE size_class <> '' GROUP BY size_class HAVING count(*) >= 5 ORDER BY count(*) DESC LIMIT 12").map((r) => r.s);
  return sizeOptions;
}
const field = (label, inner, hint) => `<div class="fld"><label><span>${label}</span>${inner}</label>${hint ? `<span class="hint">${hint}</span>` : ""}</div>`;
const inp = (e, f, attrs = "") => `<input data-e="${e.uid}" data-f="${f}" value="${esc(getPath(e, f))}" ${attrs}>`;
const txt = (e, f, rows = 3) => `<textarea data-e="${e.uid}" data-f="${f}" rows="${rows}">${esc(getPath(e, f))}</textarea>`;
const refInput = (e, f, kind) => `<input data-e="${e.uid}" data-f="${f}.text" data-ac="${kind}" list="dl-${e.uid}-${f}" autocomplete="off" value="${esc(getPath(e, f + ".text"))}"><datalist id="dl-${e.uid}-${f}"></datalist><span class="hint ref-hint" data-hint="${e.uid}.${f}">${refHint(e[f])}</span>`;
function refHint(r) {
  if (!clean(r.text)) return "";
  if (r.id) return `Selected: <a href="#/c/${encodeURIComponent(r.id)}" target="_blank" rel="noopener">${esc(r.label || r.text)}</a>`;
  const n = parentCount(r.text);
  return n === 1 ? "In the database." : n > 1 ? `${n} cultivars have this name: pick one from the list.` : "Not in the database yet: it will be added as a parent-only name.";
}
function getPath(o, p) { return p.split(".").reduce((a, k) => (a == null ? "" : a[k]), o) ?? ""; }
function setPath(o, p, v) { const k = p.split("."); const last = k.pop(); k.reduce((a, x) => a[x], o)[last] = v; }

function entryHtml(e, i) {
  const open = sub.open.has(e.uid) ? " open" : "";
  const dups = e.existing_id ? "" : lookupExact(e.name);
  const dupHtml = clean(e.name) && (dups.length || e.existing_id) ? `<div class="note-box" data-dup="${e.uid}">
      ${e.existing_id ? `This will be added to the existing record <a href="#/c/${encodeURIComponent(e.existing_id)}" target="_blank" rel="noopener">${esc(e.existing_id)}</a>. <button type="button" class="secondary small" data-act="undup" data-e="${e.uid}">Make it a separate cultivar</button>`
      : `A cultivar named <strong>${esc(clean(e.name))}</strong> is already in the database:
      <ul class="plain">${dups.map((d) => `<li><a href="#/c/${encodeURIComponent(d.id)}" target="_blank" rel="noopener">${esc(d.name)}</a> <span class="muted">${esc(d.hyb || kindLabel(d.kind))}</span>
        <button type="button" class="secondary small" data-act="samedup" data-e="${e.uid}" data-id="${esc(d.id)}">Add my details to this one</button></li>`).join("")}</ul>
      If yours is a different cultivar with the same name, just carry on.`}</div>` : "";
  const parentage = e.origin === "cross" ? `<div class="two">
      ${field("Seed parent (the mother)", refInput(e, "seed", "cult"))}
      ${field("Pollen parent (the father)", refInput(e, "pollen", "cult"))}</div>`
    : e.origin === "sport" ? field("Sport of", refInput(e, "sport", "cult"), "The cultivar it appeared on.") : "";
  const certainty = e.origin === "unknown" ? "" : field("How sure are you of the parentage?", `<select data-e="${e.uid}" data-f="certainty">
      ${[["known", "Known (my own records)"], ["assumed", "Assumed"], ["unsure", "Unsure"]].map(([v, l]) => `<option value="${v}"${e.certainty === v ? " selected" : ""}>${l}</option>`).join("")}</select>`);
  const photos = e.photos.map((p, k) => `<div class="photo-row"><input data-e="${e.uid}" data-f="photos.${k}.file" value="${esc(p.file)}" aria-label="Photo file name" placeholder="file name">
      <input data-e="${e.uid}" data-f="photos.${k}.caption" value="${esc(p.caption)}" aria-label="Caption" placeholder="caption (optional)">
      <input data-e="${e.uid}" data-f="photos.${k}.credit" value="${esc(p.credit)}" aria-label="Credit" placeholder="credit (${esc(clean(sub.about.name) || "photographer")})">
      <button type="button" class="secondary small" data-act="rmphoto" data-e="${e.uid}" data-k="${k}" aria-label="Remove photo">&times;</button></div>`).join("");
  return `<details class="entry" data-uid="${e.uid}"${open}>
    <summary><span class="sname">${esc(clean(e.name) || "New cultivar")}</span> <span class="muted small">entry ${i + 1}</span></summary>
    <div class="entry-body">
      ${field("Cultivar name <span class=req>(required)</span>", inp(e, "name", 'autocomplete="off"'))}
      ${dupHtml}
      <div class="two">
        ${field("Type", `<select data-e="${e.uid}" data-f="kind">${[["cultivar", "Cultivar"], ["seedling", "Seedling (not named)"], ["species", "Species"]].map(([v, l]) => `<option value="${v}"${e.kind === v ? " selected" : ""}>${l}</option>`).join("")}</select>`)}
        ${field("Year introduced", inp(e, "year", 'inputmode="numeric" maxlength="4"'))}</div>
      ${field("Hybridizer(s)", `<input data-e="${e.uid}" data-f="hyb" data-ac="ppl" list="dl-${e.uid}-hyb" autocomplete="off" value="${esc(e.hyb)}"><datalist id="dl-${e.uid}-hyb"></datalist>`, "Write Surname, Given. Separate co-hybridizers with a semicolon.")}
      <fieldset><legend>Parentage</legend>
        <div class="radios">${[["cross", "A cross (seed parent x pollen parent)"], ["sport", "A sport of another cultivar"], ["unknown", "Parentage not known or not entered"]].map(([v, l]) =>
          `<label><input type="radio" name="o-${e.uid}" data-e="${e.uid}" data-f="origin" value="${v}"${e.origin === v ? " checked" : ""}> ${l}</label>`).join("")}</div>
        ${parentage}${certainty}
        ${e.origin === "unknown" ? "" : field("Notes on the parentage", txt(e, "pnote", 2), "For example a complex or multi-step cross.")}
      </fieldset>
      <fieldset><legend>Registration</legend><div class="two">
        ${field("AVSA registration number", inp(e, "reg", 'inputmode="numeric"'))}
        ${field("Date registered", inp(e, "regdate", 'type="date"'))}</div></fieldset>
      <fieldset><legend>Description</legend>
        ${field("Size class", `<input data-e="${e.uid}" data-f="size" list="dl-size" value="${esc(e.size)}">`)}
        <div class="two">${field("Blossom color", inp(e, "color"))}${field("Blossom description", inp(e, "bloom"), "Single or double, ruffled, fringed, ...")}</div>
        ${field("Foliage", inp(e, "foliage"), "Girl, variegated, quilted, ...")}
        ${field("Description", txt(e, "desc", 4))}${field("Other notes", txt(e, "notes", 2))}
      </fieldset>
      <fieldset><legend>Links</legend>
        ${field("Web pages or photo albums (one per line)", txt(e, "links", 2))}</fieldset>
      <fieldset><legend>Photos</legend>
        <p class="hint">Photos are sent separately. List the file names here so we can match them. Choose files to fill in the names.</p>
        ${photos}
        <div class="photo-add"><label class="btn secondary small">Choose photo files<input type="file" accept="image/*" multiple data-act="pickphotos" data-e="${e.uid}" hidden></label>
          <button type="button" class="secondary small" data-act="addphoto" data-e="${e.uid}">Add a name by hand</button></div>
        ${e.photos.length ? `<label class="check"><input type="checkbox" data-e="${e.uid}" data-f="photoOk"${e.photoOk ? " checked" : ""}><span>I took these photos or have permission to share them, and agree they may be published with the credit above.</span></label>` : ""}
      </fieldset>
      <div class="entry-actions">
        <button type="button" class="secondary" data-act="dup" data-e="${e.uid}">Duplicate this entry</button>
        <button type="button" class="secondary" data-act="del" data-e="${e.uid}">Delete this entry</button>
      </div>
    </div></details>`;
}

function sendHtml(blocked) {
  if (!SUBMIT_URL) return "";
  const m = sub.sendMsg;
  return `<p><button type="button" id="send-btn"${blocked || sub.sending ? " disabled" : ""}>${sub.sending ? "Sending…" : "Send my submission"}</button></p>
    <div id="send-msg" role="status" aria-live="polite">${m ? `<div class="${m.ok ? "note-box" : "error"}">${esc(m.text)}</div>` : ""}</div>
    <div class="hp" aria-hidden="true"><label>Leave this empty<input tabindex="-1" autocomplete="off" id="hp"></label></div>`;
}
function reviewHtml() {
  const { errors, warnings } = validate();
  const li = (x) => `<li>${esc(x.m)}</li>`;
  const files = sub.entries.flatMap((e) => e.photos.filter((p) => clean(p.file)).map((p) => `${p.file} (${clean(e.name) || "unnamed"})`));
  return `<h2>Review and download</h2>
    ${errors.length ? `<div class="error"><strong>Please fix before downloading:</strong><ul>${errors.map(li).join("")}</ul></div>` : `<p class="ok">Everything required is filled in.</p>`}
    ${warnings.length ? `<div class="note-box"><strong>Worth a look (you can still send):</strong><ul>${warnings.map(li).join("")}</ul></div>` : ""}
    <p>${sub.entries.length} ${sub.entries.length === 1 ? "cultivar" : "cultivars"} in this submission.</p>
    ${sendHtml(errors.length)}
    <p><button type="button" id="dl-csv" class="${SUBMIT_URL ? "secondary" : ""}"${errors.length ? " disabled" : ""}>Download a copy (.csv)</button></p>
    ${files.length ? `<p class="hint">Also send these photo files with it: ${esc(files.join("; "))}.</p>` : ""}
    <p class="hint">${SUBMIT_URL ? "Sending delivers your cultivars and photos to the reviewer. Keep the downloaded copy for your records." : SUBMIT_EMAIL ? `Email the file to <strong>${esc(SUBMIT_EMAIL)}</strong>.` : "Send the downloaded file to the project, as described on the contributing page."}
      You can come back to this page and the draft will still be here; <button type="button" class="linklike" data-act="startover">start over</button> clears it.</p>`;
}

function renderSubmit(app) {
  if (!sub.entries.length && !loadDraft()) {
    sub.sid = makeSid();
    sub.entries = [newEntry()];
  }
  sub.entries.forEach((e) => { if (sub.entries.length === 1) sub.open.add(e.uid); });
  const pg = q1("SELECT title, body FROM pages WHERE slug = 'contribute'");
  app.innerHTML = `<h1>Contribute cultivars</h1>
    <div class="prose">${pg ? renderProse(pg.body) : `<p>Add your own cultivars, with parentage, descriptions and photos. Nothing is sent from this page:
      you download a file and send it to the project, and a reviewer checks it before anything is added. Add as many cultivars as you like first.
      Your work is saved in this browser as you type.</p>`}</div>
    <datalist id="dl-size">${sizeList().map((s) => `<option value="${esc(s)}">`).join("")}</datalist>
    <form id="sform" novalidate onsubmit="return false">
      <section class="panel"><h2>About you</h2>
        <div class="two">${field("Your name (shown as the credit) <span class=req>(required)</span>", `<input data-about="name" value="${esc(sub.about.name)}" autocomplete="name">`)}
        ${field("Contact (email or other, optional)", `<input data-about="contact" value="${esc(sub.about.contact)}" autocomplete="email">`, "Only the reviewer sees this. It is never published.")}</div>
        ${field("Your usual hybridizer name", `<input data-about="hybridizer" data-ac="ppl" list="dl-about-hyb" autocomplete="off" value="${esc(sub.about.hybridizer)}"><datalist id="dl-about-hyb"></datalist>`, "Surname, Given. New entries start with this hybridizer; change it per cultivar if needed.")}
        <label class="check"><input type="checkbox" data-about="license"${sub.about.license ? " checked" : ""}><span>I am the hybridizer, or have the hybridizer's permission, and I agree that this information and any photos may be published under the
        <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a> license with credit.</span></label>
      </section>
      <h2>Your cultivars</h2>
      <div id="entries">${sub.entries.map(entryHtml).join("")}</div>
      <p class="entry-tools"><button type="button" data-act="add">Add another cultivar</button>
        <label class="btn secondary">Open a saved submission<input type="file" accept=".csv,text/csv" id="open-csv" hidden></label></p>
      <section id="review" class="panel">${reviewHtml()}</section>
    </form>`;
  wireSubmit(app);
}

/* ------------------------------------------------------------------ behavior */
function refreshReview() { const r = $("#review"); if (r) r.innerHTML = reviewHtml(); }
function rerender() { renderSubmit($("#app")); }
const byUid = (u) => sub.entries.find((e) => e.uid === u);

function suggestCultivars(text) {
  const t = clean(text).replace(/[‘’]/g, "'").replace(/[%_]/g, "");
  if (t.length < 2) return [];
  const sql = (pat) => q(`SELECT c.id, c.name, c.kind, c.hybridizer_raw AS h, (SELECT count(*) FROM cultivars d WHERE d.name = c.name) AS n
      FROM cultivars c WHERE c.name LIKE :p ORDER BY (c.kind = 'cultivar') DESC, c.name LIMIT 20`, { p: pat });
  let rows = sql(t + "%");
  if (rows.length < 6) rows = rows.concat(sql("% " + t + "%").filter((r) => !rows.some((x) => x.id === r.id)));
  return rows;
}
const labelTail = (r) => r.h || (r.kind === "cultivar" ? "hybridizer unknown" : kindLabel(r.kind));
/** Datalist text for a suggestion: the bare name, or name, hybridizer and id when several cultivars share the name. */
const optLabel = (r) => (r.n > 1 ? `${r.name} — ${labelTail(r)} [${r.id}]` : r.name);
function suggestPeople(text) {
  const parts = text.split(";");
  const last = clean(parts.pop());
  if (last.length < 2) return [];
  const prefix = parts.map(clean).filter(Boolean).join("; ");
  const t = last.replace(/[%_]/g, "");
  return q("SELECT name FROM people WHERE name LIKE :p OR aliases LIKE :a ORDER BY name LIMIT 15", { p: t + "%", a: "%" + t + "%" })
    .map((r) => ({ value: (prefix ? prefix + "; " : "") + r.name }));
}

function wireSubmit(app) {
  const form = $("#sform", app);
  form.addEventListener("toggle", (ev) => {
    const d = ev.target;
    if (d.matches && d.matches("details.entry")) { d.open ? sub.open.add(d.dataset.uid) : sub.open.delete(d.dataset.uid); }
  }, true);

  form.addEventListener("input", (ev) => {
    const t = ev.target;
    if (t.dataset.about) {
      sub.about[t.dataset.about] = t.type === "checkbox" ? t.checked : t.value;
    } else if (t.dataset.e && t.dataset.f) {
      const e = byUid(t.dataset.e);
      const v = t.type === "checkbox" ? t.checked : t.value;
      setPath(e, t.dataset.f, v);
      if (t.dataset.f === "name") {
        $(`details[data-uid="${e.uid}"] .sname`).textContent = clean(v) || "New cultivar";
      }
    } else return;
    if (t.dataset.ac === "ppl") {
      const dl = t.list;
      if (dl) dl.innerHTML = suggestPeople(t.value).map((s) => `<option value="${esc(s.value)}">`).join("");
    } else if (t.dataset.ac === "cult") {
      const e = byUid(t.dataset.e), key = t.dataset.f.split(".")[0], dl = t.list;
      const picked = (t._rows || []).find((r) => optLabel(r) === t.value);   // a suggestion was chosen
      if (picked) {
        e[key] = { text: picked.name, id: picked.id, ambiguous: picked.n > 1, label: picked.n > 1 ? `${picked.name} (${labelTail(picked)})` : picked.name };
        t.value = picked.name;
      } else {
        const rows = suggestCultivars(t.value);
        t._rows = rows;
        dl.innerHTML = rows.map((r) => `<option value="${esc(optLabel(r))}">`).join("");
        const one = rows.find((r) => r.n === 1 && r.name === t.value);
        e[key] = one ? { text: one.name, id: one.id, ambiguous: false, label: one.name } : { text: t.value, id: "" };
      }
      const hint = $(`[data-hint="${e.uid}.${key}"]`);
      if (hint) hint.innerHTML = refHint(e[key]);
    }
    saveDraft();
    refreshReview();
  });

  form.addEventListener("change", (ev) => {
    const t = ev.target;
    if (t.dataset.act === "pickphotos") {
      const e = byUid(t.dataset.e);
      for (const f of t.files) { e.photos.push({ file: f.name, caption: "", credit: "" }); sub.files[f.name] = f; }
      saveDraft(); sub.open.add(e.uid); rerender();
    } else if (t.dataset.f === "origin" || t.dataset.f === "name") {
      saveDraft(); rerender();   // origin shows other fields; a new name may match an existing cultivar
    } else if (t.id === "open-csv" && t.files[0]) {
      t.files[0].text().then((txt) => {
        const rows = parseCsv(txt).filter((r) => r.name !== undefined);
        if (!rows.length) { alert("That file has no cultivars in the expected format."); return; }
        entriesFromRows(rows); sub.open = new Set(sub.entries.length === 1 ? [sub.entries[0].uid] : []);
        saveDraft(); rerender();
      });
    }
  });

  form.addEventListener("click", (ev) => {
    if (ev.target.id === "dl-csv") { downloadCsv(); return; }
    if (ev.target.id === "send-btn") { sendSubmission(); return; }
    const b = ev.target.closest("[data-act]");
    if (!b || b.type === "file" || b.tagName === "LABEL") return;
    const act = b.dataset.act, e = byUid(b.dataset.e);
    if (act === "add") { const n = newEntry(); sub.entries.push(n); sub.open = new Set([n.uid]); }
    else if (act === "dup") { const n = newEntry(e); sub.entries.splice(sub.entries.indexOf(e) + 1, 0, n); sub.open = new Set([n.uid]); }
    else if (act === "del") {
      if (clean(e.name) && !confirm(`Delete the entry for ${clean(e.name)}?`)) return;
      sub.entries.splice(sub.entries.indexOf(e), 1);
      if (!sub.entries.length) sub.entries.push(newEntry());
    }
    else if (act === "addphoto") { e.photos.push({ file: "", caption: "", credit: "" }); sub.open.add(e.uid); }
    else if (act === "rmphoto") e.photos.splice(Number(b.dataset.k), 1);
    else if (act === "samedup") { e.existing_id = b.dataset.id; }
    else if (act === "undup") { e.existing_id = ""; }
    else if (act === "startover") {
      if (!confirm("Clear everything on this form?")) return;
      clearDraft(); sub.entries = []; sub.sid = ""; sub.open = new Set(); sub.files = {};
      sub.about = { ...sub.about, name: "", contact: "", license: false };
      rerender(); return;
    }
    else return;
    saveDraft(); rerender();
  });
}

function downloadCsv() {
  const { errors } = validate();
  if (errors.length) { refreshReview(); return; }
  const blob = new Blob(["﻿" + buildCsv()], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `submission-${sub.sid}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ------------------------------------------------------------------ sending (Apps Script receiver) */
const MAX_PHOTO_SIDE = 1600, MAX_SEND_BYTES = 15 * 1024 * 1024;

/** Resize an image file to a JPEG no larger than MAX_PHOTO_SIDE; resolves to base64 (no prefix). */
async function resizeToJpeg(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, MAX_PHOTO_SIDE / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(bmp.width * scale)); c.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);   // transparent PNGs become white, not black
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  if (bmp.close) bmp.close();
  return c.toDataURL("image/jpeg", 0.85).split(",")[1];            // re-encoding also drops camera metadata (GPS)
}
const stem = (f) => f.replace(/\.[^.]*$/, "").replace(/[^A-Za-z0-9 _-]+/g, "_").slice(0, 60) || "photo";

/** Build the JSON the receiver expects. Throws an Error with a message for the contributor on a problem. */
async function buildPayload() {
  const photos = [], rows = [];
  let total = 0;
  for (let i = 0; i < sub.entries.length; i++) {
    const e = sub.entries[i];
    const named = e.photos.filter((p) => clean(p.file));
    const names = [];
    for (let k = 0; k < named.length; k++) {
      const file = sub.files[named[k].file];
      if (!file) throw new Error(`The photo "${named[k].file}" for ${clean(e.name) || "entry " + (i + 1)} must be chosen again (browsers do not keep files between visits). Use "Choose photo files".`);
      let data;
      try { data = await resizeToJpeg(file); } catch (err) { throw new Error(`The photo "${named[k].file}" could not be read as an image. Use a JPEG, PNG or WebP file.`); }
      total += data.length;
      if (total > MAX_SEND_BYTES) throw new Error("The photos are too large to send together. Remove some, or download the file and send the photos separately.");
      const name = `${i + 1}-${k + 1}-${stem(named[k].file)}.jpg`;
      names.push(name);
      photos.push({ name, data });
    }
    rows.push(entryRow(e, i, names));
  }
  const hp = $("#hp");
  return { v: 1, sid: sub.sid, hp: hp ? hp.value : "", rows, photos };
}

async function sendSubmission() {
  if (sub.sending) return;
  const { errors } = validate();
  if (errors.length) { refreshReview(); return; }
  sub.sending = true; sub.sendMsg = null; refreshReview();
  try {
    const payload = await buildPayload();
    let res;
    try {
      res = await fetch(SUBMIT_URL, { method: "POST", body: JSON.stringify(payload) });   // text/plain: no preflight
    } catch (err) { throw new Error("Could not reach the receiver. Check your connection, or download the file and email it."); }
    let data;
    try { data = await res.json(); } catch (err) { throw new Error("The receiver gave an unexpected answer. Please download the file and email it instead."); }
    if (!data.ok) throw new Error(data.error || "The receiver rejected the submission.");
    sub.sendMsg = { ok: true, text: `Thank you! ${data.received + (data.kept || 0)} ${data.received + (data.kept || 0) === 1 ? "cultivar" : "cultivars"} received${data.photos ? ` with ${data.photos} ${data.photos === 1 ? "photo" : "photos"}` : ""}. Your reference is ${sub.sid}. A reviewer will check them before anything is added. You can still edit and send again.` };
  } catch (err) {
    sub.sendMsg = { ok: false, text: err.message };
  }
  sub.sending = false;
  refreshReview();
}
