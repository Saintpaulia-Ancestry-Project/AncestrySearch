/* Quick add (route #/quick): one cultivar from an AVSA-style list entry, plus one optional photo.
 * See notes/quick-add-plan.md. The page builds ONE row with the same columns as #/submit and sends it through the same
 * receiver (SUBMIT_URL), so the Sheet, review and import are unchanged. The only new column is listing_text.
 *
 * Part 1, parseListing(): pure functions, no DOM, no database (tested by site/tests/quickadd-test.html).
 * Part 2, the page: uses helpers from submit.js (clean, q, lookupExact, resizeToJpeg, stem, toCsv, CSV_COLS, SUBMIT_URL,
 * makeSid) and app.js (q, q1, esc, $, renderProse), which are loaded first.
 */
"use strict";

/* ------------------------------------------------------------------ Part 1: the parser */
const QUICK_SIZES = ["Semiminiature trailer", "Miniature trailer", "Standard trailer", "Small standard", "Semiminiature",
  "Microminiature", "Miniature", "Standard", "Large", "Trailer"];
const QUICK_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
  "November", "December"];
const QUICK_ORG_RE = /nurser|universit|greenhouse|society|college|farm|garden|laborator|institute|\bclub\b|\bsons\b|\bbros\b/i;
const QUICK_PARTICLES = /^(de|del|della|di|da|van|von|der|den|la|le|du|ten|ter|mac|mc)$/i;
// month/day/year (US order, as the AVSA prints it), or ISO year-month-day
const QUICK_DATE_SRC = String.raw`\d{1,2}[/-]\d{1,2}[/-]\d{4}|\d{4}-\d{2}-\d{2}`;

/** "08/12/1982" -> { iso, words } or { warning }. US order only: the first number is the month. */
function parseQuickDate(text) {
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text), y, mo, d;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else {
    m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
    if (!m) return { warning: `The date "${text}" was not understood. Use month/day/year, for example 08/12/1982.` };
    mo = +m[1]; d = +m[2]; y = +m[3];
  }
  if (mo < 1 || mo > 12) {
    return { warning: `The date "${text}" was left out: dates are month/day/year (US order), and ${mo} is not a month.` };
  }
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return { warning: `The date "${text}" does not exist (month ${mo}, day ${d}). It was left out.` };
  }
  return { iso: `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`, words: `${QUICK_MONTHS[mo - 1]} ${d}, ${y}` };
}

/** "J. Brownlie" -> "Brownlie, J."; "A. Smith & B. Jones" -> "Smith, A.; Jones, B."; organizations and "Surname, Given" stay. */
function quickHybridizers(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  if (QUICK_ORG_RE.test(t)) return t;
  return t.split(/\s*(?:&|\band\b|\/|;)\s*/i).map((p) => {
    p = p.trim();
    if (!p || p.includes(",")) return p;
    const w = p.split(" ");
    if (w.length < 2) return p;
    let k = w.length - 1;
    while (k > 1 && QUICK_PARTICLES.test(w[k - 1])) k--;     // van der Berg, de la Cruz
    return `${w.slice(k).join(" ")}, ${w.slice(0, k).join(" ")}`;
  }).filter(Boolean).join("; ");
}

/**
 * Read ONE AVSA-style entry:  NAME (REG) DATE (HYBRIDIZER) DESCRIPTION. FOLIAGE. SIZE (SOURCE, YEAR)
 * Every part but the name is optional. Returns { name, reg, date, dateWords, hyb, size, desc, notes, warnings[] };
 * whatever cannot be placed stays in desc.
 */
function parseListing(text, sizes) {
  const out = { name: "", reg: "", date: "", dateWords: "", hyb: "", size: "", desc: "", notes: "", warnings: [] };
  let t = String(text || "").replace(/[   ]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return out;
  const sizeList = (sizes && sizes.length ? sizes : QUICK_SIZES).slice().sort((a, b) => b.length - a.length);
  let rest;

  // 1. the name ends before "(digits)", else before the date, else before the first "("
  let m = /^(.+?)\s*\((\d{1,6})\)(?=\s|$|\()/.exec(t);
  if (m) { out.name = m[1]; out.reg = m[2]; rest = t.slice(m[0].length).trim(); }
  else {
    const dm = new RegExp(String.raw`(?:^|\s)(${QUICK_DATE_SRC})(?=\s|\(|$)`).exec(t);
    const pi = t.indexOf(" (");
    if (dm && dm.index > 0 && (pi < 0 || dm.index < pi)) { out.name = t.slice(0, dm.index); rest = t.slice(dm.index).trim(); }
    else if (pi > 0) { out.name = t.slice(0, pi); rest = t.slice(pi).trim(); }
    else if (t.length <= 80 && !/[.]/.test(t)) { out.name = t; rest = ""; }
    else { out.name = ""; rest = t; out.warnings.push("Could not tell where the name ends. Type the name in the Name box."); }
  }
  out.name = out.name.trim().replace(/[,;:-]+$/, "").replace(/[‘’`´]/g, "'").trim();   // curly quotes only in the name; the description stays as typed

  // 2. the date straight after the name / number
  m = new RegExp(String.raw`^(${QUICK_DATE_SRC})(?=\s|\(|$)`).exec(rest);
  if (m) {
    const d = parseQuickDate(m[1]);
    if (d.iso) { out.date = d.iso; out.dateWords = d.words; } else out.warnings.push(d.warning);
    rest = rest.slice(m[0].length).trim();
  }

  // 3. the hybridizer: a parenthesis straight after that
  m = /^\(([^()]*)\)\s*/.exec(rest);
  if (m) { out.hyb = quickHybridizers(m[1]); rest = rest.slice(m[0].length).trim(); }
  if (out.hyb.includes(";")) out.warnings.push(`More than one hybridizer was read: ${out.hyb}. Check that they are right.`);

  // 4. a closing parenthesis at the very end is the printed source reference, kept as a note
  m = /^(.+?)\s*\(([^()]*)\)\.?$/.exec(rest);
  if (m && m[2].trim()) { out.notes = `Printed as: ${m[2].trim()}`; rest = m[1].trim(); }
  else if (/^\(([^()]*)\)\.?$/.test(rest)) { out.notes = `Printed as: ${rest.replace(/^\(|\)\.?$/g, "").trim()}`; rest = ""; }

  // 5. the size class: the last word(s) of what is left
  const bare = rest.replace(/[.\s]+$/, "");
  for (const s of sizeList) {
    const sm = new RegExp(String.raw`(^|[\s.,;])${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i").exec(bare);
    if (sm) { out.size = s; rest = bare.slice(0, sm.index + sm[1].length).replace(/[\s,;]+$/, ""); break; }
  }
  out.desc = rest.trim();
  return out;
}

/* ------------------------------------------------------------------ Part 2: the page */
const QUICK_KEY = "av_quick_draft_v1";
const QUICK_FIELDS = ["name", "reg", "date", "hyb", "size", "desc", "notes"];
const quick = {
  sid: "", text: "", f: { name: "", reg: "", date: "", hyb: "", size: "", desc: "", notes: "" }, words: "", warnings: [],
  touched: new Set(), existing_id: "", existing_name: "", about: { name: "", contact: "", license: false },
  photo: null, photoUrl: "", credit: "", photoOk: false, sending: false, msg: null, ready: false,
};

function quickSave() {
  try {
    localStorage.setItem(QUICK_KEY, JSON.stringify({ sid: quick.sid, text: quick.text, f: quick.f, touched: [...quick.touched],
      existing_id: quick.existing_id, about: quick.about, credit: quick.credit }));
  } catch (_) { /* storage blocked: the page still works */ }
}
function quickLoad() {
  try {
    const d = JSON.parse(localStorage.getItem(QUICK_KEY) || "null");
    if (d) {
      quick.sid = d.sid || ""; quick.text = d.text || ""; quick.f = { ...quick.f, ...d.f };
      quick.touched = new Set(d.touched || []); quick.existing_id = d.existing_id || "";
      quick.about = { ...quick.about, ...d.about }; quick.credit = d.credit || "";
    }
    if (!quick.about.name) {   // share the name and contact with the full form's draft
      const full = JSON.parse(localStorage.getItem(DRAFT_KEY) || "null");
      if (full && full.about) { quick.about.name = full.about.name || ""; quick.about.contact = full.about.contact || ""; }
    }
  } catch (_) { /* damaged draft: ignore */ }
}

let quickSizeCache = null;
function quickSizes() {
  if (!quickSizeCache) {
    let db = [];
    try { db = q("SELECT size_class AS s FROM cultivars WHERE size_class <> '' GROUP BY size_class HAVING count(*) >= 5").map((r) => r.s); } catch (_) { /* no database yet */ }
    quickSizeCache = [...new Set([...QUICK_SIZES, ...db])];
  }
  return quickSizeCache;
}

function quickReparse() {
  const p = parseListing(quick.text, quickSizes());
  for (const k of QUICK_FIELDS) if (!quick.touched.has(k)) quick.f[k] = p[k === "date" ? "date" : k];
  quick.words = quick.touched.has("date") ? "" : p.dateWords;
  quick.warnings = p.warnings;
}

function quickChecks() {
  const f = quick.f, name = clean(f.name);
  const sameName = name && !quick.existing_id ? lookupExact(name) : [];
  const regOwner = /^\d+$/.test(clean(f.reg)) ? q1("SELECT id, name FROM cultivars WHERE registration_no = :r LIMIT 1", { r: clean(f.reg) }) : null;
  const regSame = regOwner && quick.existing_id && regOwner.id === quick.existing_id;
  let person = null;
  if (clean(f.hyb) && !clean(f.hyb).includes(";")) {
    const h = clean(f.hyb);
    person = q1("SELECT id, name FROM people WHERE name = :h COLLATE NOCASE OR aliases LIKE :a LIMIT 1", { h, a: "%" + h.replace(/[%_]/g, "") + "%" });
  }
  return { sameName, regOwner: regSame ? null : regOwner, person };
}

function quickValidate(c) {
  const f = quick.f, errors = [];
  if (!clean(f.name)) errors.push("Enter the cultivar name.");
  if (clean(f.reg) && !/^\d+$/.test(clean(f.reg))) errors.push("The AVSA registration number must be digits only.");
  if (c.regOwner) errors.push(`Registration number ${clean(f.reg)} already belongs to ${c.regOwner.name}. If you are correcting that cultivar, use the full form.`);
  if (!clean(quick.about.name)) errors.push("Enter your name under About you (it is used as the credit).");
  if (!quick.about.license) errors.push("Tick the agreement box under About you.");
  if (quick.photo && !quick.photoOk) errors.push("Confirm that you took the photo or have permission to share it, or remove the photo.");
  if (quick.photo && !clean(quick.credit || quick.about.name)) errors.push("The photo needs a credit.");
  return errors;
}

function quickRow(photoName) {
  const f = quick.f, r = Object.fromEntries(CSV_COLS.map((k) => [k, ""]));
  return Object.assign(r, {
    submission_id: quick.sid, entry_no: "1", submitter_name: clean(quick.about.name), contact: clean(quick.about.contact),
    agreed_license: quick.about.license ? "yes" : "no", action: quick.existing_id ? "update" : "new", existing_id: quick.existing_id,
    name: clean(f.name), kind: "cultivar", hybridizers: String(f.hyb || "").split(";").map(clean).filter(Boolean).join("; "),
    registration_no: clean(f.reg), registered_date: clean(f.date), size_class: clean(f.size), description: clean(f.desc),
    notes: clean(f.notes), listing_text: clean(quick.text),
    photo_files: photoName || "", photo_credits: photoName ? pipeSafe(quick.credit || quick.about.name) : "",
    photo_permission: photoName && quick.photoOk ? "yes" : "",
  });
}

const qfield = (label, inner, hint) => `<div class="fld"><label><span>${label}</span>${inner}</label>${hint ? `<span class="hint">${hint}</span>` : ""}</div>`;
const qin = (k, attrs = "") => `<input data-q="${k}" value="${esc(quick.f[k])}" ${attrs}>`;

function renderQuick(app) {
  if (!quick.ready) { quickLoad(); quick.ready = true; }
  if (!quick.sid) quick.sid = makeSid();
  const pg = q1("SELECT title, body FROM pages WHERE slug = 'quick'");
  app.innerHTML = `<h1>Quick add: one cultivar</h1>
    <div class="prose">${pg ? renderProse(pg.body) : "<p>Paste one cultivar entry in the AVSA list format and add one photo.</p>"}</div>
    <datalist id="dl-qsize">${quickSizes().map((s) => `<option value="${esc(s)}">`).join("")}</datalist>
    <form id="qform" novalidate onsubmit="return false">
      <section class="panel"><h2>The entry</h2>
        <div class="fld"><label><span>Paste or type the entry as the AVSA prints it</span>
          <textarea id="q-text" rows="4" placeholder="Aca's Lady Jane (5037) 08/12/1982 (J. Brownlie) Semidouble pink. Plain, quilted. Semiminiature (CA 288, 1983)">${esc(quick.text)}</textarea></label>
          <span class="hint">Name, then (registration number) and date as month/day/year, (hybridizer), description and size. Only the name is required.</span></div>
        <h3>What we understood</h3>
        <p class="hint">Change anything that is wrong.</p>
        <div id="q-warn"></div>
        <div class="two">${qfield("Cultivar name <span class=req>(required)</span>", qin("name", 'autocomplete="off"'))}
          ${qfield("AVSA registration number", qin("reg", 'inputmode="numeric"'), "Leave empty if not registered.")}</div>
        <div id="q-name-check"></div><div id="q-reg-check"></div>
        <div class="two">${qfield("Date registered", qin("date", 'type="date"'), `<span id="q-date-words"></span>`)}
          ${qfield("Hybridizer", qin("hyb", 'autocomplete="off"'), `<span id="q-hyb-hint">Surname, Given. Separate several with a semicolon.</span>`)}</div>
        <div class="two">${qfield("Size class", qin("size", 'list="dl-qsize"'))}
          ${qfield("Notes", qin("notes"))}</div>
        ${qfield("Description", `<textarea data-q="desc" rows="3">${esc(quick.f.desc)}</textarea>`, "Bloom, color and foliage as printed. A reviewer splits them into separate fields.")}
      </section>
      <section class="panel"><h2>Photo (optional, one)</h2>
        <p class="hint">JPEG, PNG or WebP. It is shrunk on your device (1600 pixels on the longest side) and camera data such as the location is removed before it is sent.</p>
        <p><label class="btn secondary small">Choose a photo<input type="file" id="q-photo" accept="image/*" hidden></label>
          <button type="button" class="secondary small" id="q-photo-rm" hidden>Remove the photo</button></p>
        <div id="q-photo-box"></div>
      </section>
      <section class="panel"><h2>About you</h2>
        <div class="two">${qfield("Your name (shown as the credit) <span class=req>(required)</span>", `<input data-qa="name" value="${esc(quick.about.name)}" autocomplete="name">`)}
          ${qfield("Contact (email or other, optional)", `<input data-qa="contact" value="${esc(quick.about.contact)}" autocomplete="email">`, "Only the reviewer sees this. It is never published.")}</div>
        <label class="check"><input type="checkbox" data-qa="license"${quick.about.license ? " checked" : ""}><span>I agree that this information and any photo may be published under the
          <a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" rel="noopener">CC BY-NC-SA 4.0</a> license (attribution, non-commercial, share-alike) with credit.</span></label>
      </section>
      <section id="q-review" class="panel"></section>
    </form>`;
  wireQuick(app);
  refreshQuick();
}

function refreshQuick() {
  const c = quickChecks(), errors = quickValidate(c), f = quick.f;
  const set = (id, html) => { const el = $("#" + id); if (el) el.innerHTML = html; };
  set("q-warn", quick.warnings.length ? `<div class="note-box"><ul class="plain">${quick.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>` : "");
  set("q-date-words", f.date ? esc(dateWordsOf(f.date)) + ` <span class="muted">(stored as ${esc(f.date)})</span>` : "");
  set("q-name-check", clean(f.name) && quick.existing_id
    ? `<div class="note-box">This will be added to the existing record <a href="#/c/${encodeURIComponent(quick.existing_id)}" target="_blank" rel="noopener">${esc(quick.existing_id)}</a>. <button type="button" class="secondary small" data-act="undup">Make it a separate cultivar</button></div>`
    : c.sameName.length ? `<div class="note-box">A cultivar named <strong>${esc(clean(f.name))}</strong> is already in the database:
        <ul class="plain">${c.sameName.map((d) => `<li><a href="#/c/${encodeURIComponent(d.id)}" target="_blank" rel="noopener">${esc(d.name)}</a> <span class="muted">${esc(d.hyb || "")}</span>
          <button type="button" class="secondary small" data-act="samedup" data-id="${esc(d.id)}">Add my details to this one</button></li>`).join("")}</ul>
        If yours is a different cultivar with the same name, just carry on.</div>` : "");
  set("q-reg-check", c.regOwner ? `<div class="error">Registration number ${esc(clean(f.reg))} already belongs to <a href="#/c/${encodeURIComponent(c.regOwner.id)}" target="_blank" rel="noopener">${esc(c.regOwner.name)}</a>. To correct that cultivar use the <a href="#/submit">full form</a>.</div>` : "");
  set("q-hyb-hint", !clean(f.hyb) ? "Surname, Given. Separate several with a semicolon."
    : c.person ? `In the database as <a href="#/p/${encodeURIComponent(c.person.id)}" target="_blank" rel="noopener">${esc(c.person.name)}</a>.`
    : clean(f.hyb).includes(";") ? "Several hybridizers." : "Not in the database yet: a reviewer adds this person.");
  const box = $("#q-photo-box");
  if (box) {
    box.innerHTML = quick.photo ? `<img src="${quick.photoUrl}" alt="Your photo" style="max-width:260px;max-height:260px;border-radius:8px">
      ${qfield("Photo credit (the photographer)", `<input data-qa="credit" value="${esc(quick.credit)}" placeholder="${esc(clean(quick.about.name) || "photographer")}">`)}
      <label class="check"><input type="checkbox" data-qa="photoOk"${quick.photoOk ? " checked" : ""}><span>I took this photo or have permission to share it, and agree it may be published with the credit above.</span></label>` : "";
    const rm = $("#q-photo-rm"); if (rm) rm.hidden = !quick.photo;
  }
  const m = quick.msg;
  set("q-review", `<h2>Send</h2>
    ${errors.length ? `<div class="error"><strong>Please fix before sending:</strong><ul>${errors.map((e) => `<li>${esc(e)}</li>`).join("")}</ul></div>` : `<p class="ok">Everything required is filled in.</p>`}
    ${SUBMIT_URL ? `<p><button type="button" id="q-send"${errors.length || quick.sending ? " disabled" : ""}>${quick.sending ? "Sending…" : "Send my cultivar"}</button></p>` : ""}
    <div id="q-msg" role="status" aria-live="polite">${m ? `<div class="${m.ok ? "note-box" : "error"}">${esc(m.text)}</div>` : ""}</div>
    ${m && m.ok ? `<p><button type="button" id="q-another">Add another cultivar</button></p>` : ""}
    <p><button type="button" id="q-csv" class="${SUBMIT_URL ? "secondary" : ""}"${errors.length ? " disabled" : ""}>Download a copy (.csv)</button></p>
    ${quick.photo ? `<p class="hint">If you download instead of sending, also email the photo file (${esc(quick.photo.name)}).</p>` : ""}
    <p class="hint">This cultivar has parents to record? <button type="button" class="linklike" id="q-full">Continue in the full form</button> (your photo must be chosen again there).
      <button type="button" class="linklike" id="q-clear">Start over</button></p>
    <div class="hp" aria-hidden="true"><label>Leave this empty<input tabindex="-1" autocomplete="off" id="q-hp"></label></div>`);
}
function dateWordsOf(iso) {
  const p = parseQuickDate(iso);
  return p.words || "";
}

function wireQuick(app) {
  const form = $("#qform", app);
  const text = $("#q-text", app);
  text.addEventListener("paste", () => { quick.touched.clear(); quick.existing_id = ""; });
  text.addEventListener("input", () => {
    if (!text.value.trim()) { quick.touched.clear(); quick.existing_id = ""; }
    quick.text = text.value; quickReparse();
    if (quick.existing_id && clean(quick.f.name) !== clean(quick.existing_name)) quick.existing_id = ""; syncQuickInputs(); quickSave(); refreshQuick();
  });
  form.addEventListener("input", (ev) => {
    const t = ev.target;
    if (t.dataset.q) {
      quick.f[t.dataset.q] = t.value; quick.touched.add(t.dataset.q);
      if (t.dataset.q === "name" && clean(quick.f.name) !== clean(quick.existing_name)) quick.existing_id = "";
      if (t.dataset.q === "date") quick.words = "";
    } else if (t.dataset.qa) {
      const k = t.dataset.qa, v = t.type === "checkbox" ? t.checked : t.value;
      if (k === "credit" || k === "photoOk") quick[k] = v; else quick.about[k] = v;
    } else return;
    quickSave(); refreshQuick();
  });
  $("#q-photo", app).addEventListener("change", (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    if (quick.photoUrl) URL.revokeObjectURL(quick.photoUrl);
    quick.photo = file; quick.photoUrl = URL.createObjectURL(file); quick.photoOk = false; refreshQuick();
  });
  form.addEventListener("click", (ev) => {
    const t = ev.target;
    if (t.id === "q-photo-rm") { if (quick.photoUrl) URL.revokeObjectURL(quick.photoUrl); quick.photo = null; quick.photoUrl = ""; quick.photoOk = false; refreshQuick(); }
    else if (t.id === "q-send") quickSend();
    else if (t.id === "q-another") quickReset(false);
    else if (t.id === "q-csv") quickDownload();
    else if (t.id === "q-full") quickToFullForm();
    else if (t.id === "q-clear") { if (confirm("Clear everything on this page?")) quickReset(true); }
    else if (t.dataset.act === "samedup") { quick.existing_id = t.dataset.id; quick.existing_name = quick.f.name; quickSave(); refreshQuick(); }
    else if (t.dataset.act === "undup") { quick.existing_id = ""; quickSave(); refreshQuick(); }
  });
}
function syncQuickInputs() {
  for (const k of QUICK_FIELDS) {
    const el = document.querySelector(`[data-q="${k}"]`);
    if (el && el.value !== quick.f[k]) el.value = quick.f[k];
  }
}
function quickReset(clearAbout) {
  if (quick.photoUrl) URL.revokeObjectURL(quick.photoUrl);
  Object.assign(quick, { sid: makeSid(), text: "", words: "", warnings: [], existing_id: "", photo: null, photoUrl: "", credit: "", photoOk: false, msg: null, sending: false });
  quick.f = { name: "", reg: "", date: "", hyb: "", size: "", desc: "", notes: "" }; quick.touched = new Set();
  if (clearAbout) quick.about = { name: "", contact: "", license: false };
  quickSave(); renderQuick($("#app"));
}

function quickDownload() {
  if (quickValidate(quickChecks()).length) { refreshQuick(); return; }
  const blob = new Blob(["﻿" + toCsv([quickRow(quick.photo ? "1-1-" + stem(quick.photo.name) + ".jpg" : "")], CSV_COLS)], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `submission-${quick.sid}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Hand the parsed fields to the full form as a new entry (for a cultivar that has parents to record). */
function quickToFullForm() {
  if (!sub.entries.length) loadDraft();
  if (!sub.sid) sub.sid = makeSid();
  const f = quick.f, e = Object.assign(newEntry(), {
    name: clean(f.name), reg: clean(f.reg), regdate: clean(f.date), hyb: String(f.hyb || ""), size: clean(f.size),
    desc: clean(f.desc), notes: clean(f.notes), existing_id: quick.existing_id,
  });
  if (clean(quick.about.name) && !clean(sub.about.name)) sub.about.name = quick.about.name;
  if (clean(quick.about.contact) && !clean(sub.about.contact)) sub.about.contact = quick.about.contact;
  sub.entries = sub.entries.filter((x) => clean(x.name) || clean(x.desc)).concat([e]);
  sub.open = new Set([e.uid]);
  saveDraft();
  location.hash = "#/submit";
}

async function quickSend() {
  if (quick.sending) return;
  if (quickValidate(quickChecks()).length) { refreshQuick(); return; }
  quick.sending = true; quick.msg = null; refreshQuick();
  try {
    const photos = []; let photoName = "";
    if (quick.photo) {
      let data;
      try { data = await resizeToJpeg(quick.photo); } catch (err) { throw new Error("The photo could not be read as an image. Use a JPEG, PNG or WebP file."); }
      photoName = `1-1-${stem(quick.photo.name)}.jpg`;
      photos.push({ name: photoName, data });
    }
    const hp = $("#q-hp");
    const payload = { v: 1, sid: quick.sid, hp: hp ? hp.value : "", rows: [quickRow(photoName)], photos };
    let res;
    try { res = await fetch(SUBMIT_URL, { method: "POST", body: JSON.stringify(payload) }); }
    catch (err) { throw new Error("Could not read the receiver's answer. Your entry may still have arrived, so check with the project before sending it again. You can also download the file and email it."); }
    let data;
    try { data = await res.json(); } catch (err) { throw new Error("The receiver gave an unexpected answer. Please download the file and email it instead."); }
    if (!data.ok) throw new Error((data.error || "The receiver rejected the submission.") + (data.detail ? " (" + data.detail + ")" : ""));
    quick.msg = { ok: true, text: `Thank you! Your cultivar${data.photos ? " and photo were" : " was"} received. Your reference is ${quick.sid}. A reviewer will check it before anything is added.` };
  } catch (err) {
    quick.msg = { ok: false, text: err.message };
  }
  quick.sending = false;
  refreshQuick();
}
