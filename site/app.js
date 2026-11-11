/* Saintpaulia Ancestry: read-only front end. SQLite runs in the browser via sql.js.
 * Routes (hash based, shareable):
 *   #/                      search + browse         (#/?q=rob&size=Miniature&page=2)
 *   #/c/<cultivar id>       cultivar page + lineage graph
 *   #/p/<person id>         hybridizer page
 *   #/about                 project history
 *   #/downloads             downloadable files (list: DOWNLOADS below)
 *   #/submit                contributor form (submit.js)
 */
"use strict";

const DB_URL = "avancestry.sqlite";
// Files offered on #/downloads. To add one: put the file under site/downloads/ (or generate it in the
// deploy workflow) and add an entry here. An entry whose file is missing is listed as "not available".
const DOWNLOADS = [
  {
    title: "Ancestry data (Excel)",
    file: "downloads/AfricanVioletAncestry.xlsx",
    format: "Excel workbook (.xlsx)",
    text: "Every cultivar with at least one recorded parent, with its seed parent, pollen parent and hybridizer, " +
      "on the Ancestry sheet. The Sports sheet lists each sport with the cultivar it is a sport of. " +
      "The About sheet explains the columns.",
  },
];
const PAGE_SIZE = 40;
const MAX_GRAPH_NODES = 220;
const MAX_FAN = 8;  // most children drawn under one parent; the full list is on the page

let db = null;
let IMG_BASE = ""; // where photo files are served from (database meta: image_base_url)
let cy = null;

/* ------------------------------------------------------------------ helpers */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = (n) => Number(n).toLocaleString("en-US");

/** Run a query; params is a plain object like {id: "x"} (":" prefix added for sql.js). */
function q(sql, params = {}) {
  const stmt = db.prepare(sql);
  const bound = {};
  for (const [k, v] of Object.entries(params)) bound[":" + k] = v;
  stmt.bind(bound);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}
const q1 = (sql, params) => q(sql, params)[0] ?? null;

function parseHash() {
  const raw = location.hash.replace(/^#/, "") || "/";
  const [path, query = ""] = raw.split("?");
  return { parts: path.split("/").filter(Boolean), params: new URLSearchParams(query) };
}
function hashFor(path, params) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) if (v !== "" && v != null && v !== false) p.set(k, v === true ? "1" : v);
  const s = p.toString();
  return "#" + path + (s ? "?" + s : "");
}

// The last search (filters, query, page), so "Search" links on cultivar and hybridizer pages return to it.
let lastSearch = "#/";
try { lastSearch = sessionStorage.getItem("lastSearch") || "#/"; } catch (e) { /* storage may be blocked */ }
const searchHref = () => lastSearch;

/* ------------------------------------------------------------------ boot */
async function boot() {
  const app = $("#app");
  try {
    const SQL = await initSqlJs({ locateFile: (f) => "vendor/" + f });
    const res = await fetch(DB_URL, { cache: "no-cache" });
    if (!res.ok) throw new Error("Could not load " + DB_URL + " (HTTP " + res.status + ")");
    db = new SQL.Database(new Uint8Array(await res.arrayBuffer()));
  } catch (err) {
    const file = location.protocol === "file:";
    app.innerHTML = `<div class="error" role="alert"><strong>The database could not be loaded.</strong><br>
      ${esc(err.message || err)}<br>
      ${file ? "This page was opened as a file. Browsers block loading the database that way. Run <code>python scripts/serve.py</code> and open the address it prints." : ""}</div>`;
    return;
  }
  const ib = q1("SELECT value FROM meta WHERE key='image_base_url'");
  IMG_BASE = ib ? ib.value : "";
  const built = q1("SELECT value FROM meta WHERE key='built_at'");
  if (built) $("#footer").insertAdjacentHTML("beforeend", ` <span class="muted">Database built ${esc(built.value)}.</span>`);
  window.addEventListener("hashchange", route);
  route();
}

function route() {
  const { parts, params } = parseHash();
  const app = $("#app");
  if (cy) { cy.destroy(); cy = null; }
  const lb = $("#lightbox");
  if (lb && lb.open) lb.close();
  try {
    if (parts[0] === "c" && parts[1]) renderCultivar(app, decodeURIComponent(parts[1]));
    else if (parts[0] === "p" && parts[1]) renderPerson(app, decodeURIComponent(parts[1]), params);
    else if (parts[0] === "about") renderAbout(app);
    else if (parts[0] === "downloads") renderDownloads(app);
    else if (parts[0] === "submit") renderSubmit(app);   // submit.js
    else renderSearch(app, params);
  } catch (err) {
    console.error(err);
    app.innerHTML = `<div class="error" role="alert">Something went wrong showing this page: ${esc(err.message)}</div>`;
  }
  document.title = ($("h1", app)?.textContent ? $("h1", app).textContent + " – " : "") + "Saintpaulia Ancestry";
  if (!route.first) route.first = true; else window.scrollTo(0, 0);
}

/* ------------------------------------------------------------------ shared bits */
// `kind` is an internal data label: never show it raw. "stub" = a name that appears only as a parent.
const KIND_LABEL = { stub: "parent only", seedling: "seedling", species: "species", unknown: "unknown" };
const kindLabel = (k) => KIND_LABEL[k] || k;
function badges(r) {
  const b = [];
  if (r.kind && r.kind !== "cultivar") b.push(`<span class="badge kind">${esc(kindLabel(r.kind))}</span>`);
  if (r.is_sport) b.push(`<span class="badge">sport</span>`);
  if (r.has_description) b.push(`<span class="badge">description</span>`);
  if (r.has_photo) b.push(`<span class="badge">photo</span>`);
  if (r.in_masterlist_1963) b.push(`<span class="badge">1963 list</span>`);
  if (r.has_ancestry) b.push(`<span class="badge">ancestry</span>`);
  if (r.registration_no) b.push(`<span class="badge">AVSA #${esc(r.registration_no)}</span>`);
  else if (r.registered_1963) b.push(`<span class="badge">registered by 1963</span>`);
  return b.length ? `<div class="badges">${b.join("")}</div>` : "";
}
/** Link to the page of the HathiTrust scan of the 1963 book (scan sequence = printed page + 2). */
function scanLink(listing) {
  const m = /p\. (\d+)/.exec(listing || "");
  return m ? ` &middot; <a href="https://babel.hathitrust.org/cgi/pt?id=coo.31924019134067&amp;seq=${parseInt(m[1], 10) + 2}" rel="noopener" target="_blank">view the page</a>` : "";
}
const photoUrl = (f) => IMG_BASE + "photos/" + encodeURIComponent(f);
const thumbUrl = (f) => IMG_BASE + "thumbs/" + encodeURIComponent(f);
function card(r) {
  const meta = [r.hybridizers, r.size_class, r.color, r.registered_year ? "registered " + r.registered_year : ""].filter(Boolean);
  const thumb = r.photo ? `<img class="thumb" src="${esc(thumbUrl(r.photo))}" alt="" loading="lazy" width="72" height="72" onerror="this.remove()">` : "";
  return `<li class="card${thumb ? " has-thumb" : ""}">${thumb}<div class="card-body">
    <a class="title" href="#/c/${encodeURIComponent(r.id)}">${esc(r.name)}</a>
    ${meta.length ? `<div class="meta">${meta.map((m) => `<span>${esc(m)}</span>`).join("")}</div>` : ""}
    ${badges(r)}</div></li>`;
}
function linkCultivar(id, name) { return `<a href="#/c/${encodeURIComponent(id)}">${esc(name)}</a>`; }

/** Words in the user's text (letters/digits only, so nothing can break the FTS query syntax). */
function searchWords(text) {
  return (text.match(/[\p{L}\p{N}]+/gu) || []).slice(0, 12);
}
/** FTS4 query: every word is a quoted prefix term (quoting keeps AND/OR/NOT typed by a user literal). */
const ftsQuery = (words) => words.map((w) => `"${w}*"`).join(" ");

/* ------------------------------------------------------------------ search page */
function renderSearch(app, params) {
  lastSearch = location.hash && location.hash !== "#" ? location.hash : "#/";
  try { sessionStorage.setItem("lastSearch", lastSearch); } catch (e) { /* ignore */ }
  const state = {
    q: (params.get("q") || "").trim(),
    size: params.get("size") || "",
    all: params.get("all") === "1",
    sport: params.get("sport") === "1",
    anc: params.get("anc") === "1",
    desc: params.get("desc") === "1",
    photo: params.get("photo") === "1",
    old: params.get("old") === "1", // include names found only in the 1963 Master List (hidden by default)
    page: Math.max(1, parseInt(params.get("page") || "1", 10) || 1),
  };
  const where = [];
  const bind = {};
  if (!state.all) where.push("l.kind = 'cultivar'");
  if (state.size) { where.push("l.size_class = :size"); bind.size = state.size; }
  if (state.sport) where.push("l.is_sport = 1");
  if (state.anc) where.push("l.has_ancestry = 1");
  if (state.desc) where.push("l.has_description = 1");
  if (state.photo) where.push("l.has_photo = 1");
  if (!state.old) where.push("l.only_1963 = 0");

  let from, order, orderBind = {};
  const words = searchWords(state.q);
  const ftsq = ftsQuery(words);
  const reg = /^\d{3,6}$/.test(state.q) ? parseInt(state.q, 10) : null;
  if (reg) {
    from = "v_cultivar_list l"; where.push("l.registration_no = :reg"); bind.reg = reg; order = "l.name COLLATE NOCASE";
  } else if (ftsq) {
    from = "cultivars_fts f JOIN v_cultivar_list l ON l.id = f.id";
    where.push("cultivars_fts MATCH :m"); bind.m = ftsq;
    // FTS4 has no relevance ranking: put names starting with / containing the first word first
    const rankBind = { first: words[0] };
    order = "CASE WHEN l.name LIKE :first || '%' THEN 0 WHEN l.name LIKE '%' || :first || '%' THEN 1 ELSE 2 END, l.name COLLATE NOCASE";
    orderBind = rankBind;
  } else {
    from = "v_cultivar_list l"; order = "l.name COLLATE NOCASE";
  }
  const w = where.length ? "WHERE " + where.join(" AND ") : "";
  const total = q1(`SELECT count(*) AS n FROM ${from} ${w}`, bind).n;
  const rows = q(`SELECT l.* FROM ${from} ${w} ORDER BY ${order} LIMIT ${PAGE_SIZE} OFFSET ${(state.page - 1) * PAGE_SIZE}`, { ...bind, ...orderBind });
  // names that appear only as parents (stubs, seedlings, species) are hidden by default: say so
  let hidden = 0;
  if (!state.all && (ftsq || reg)) {
    const w2 = where.filter((x) => x !== "l.kind = 'cultivar'");
    hidden = q1(`SELECT count(*) AS n FROM ${from} ${w2.length ? "WHERE " + w2.join(" AND ") : ""}`, bind).n - total;
  }
  // names found only in the 1963 Master List are hidden by default: say how many matches that hides
  let hidden63 = 0;
  if (!state.old && (ftsq || reg)) {
    const w3 = where.filter((x) => x !== "l.only_1963 = 0");
    hidden63 = q1(`SELECT count(*) AS n FROM ${from} ${w3.length ? "WHERE " + w3.join(" AND ") : ""}`, bind).n - total;
  }
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const sizes = q("SELECT DISTINCT size_class AS s FROM cultivars WHERE size_class IS NOT NULL ORDER BY 1").map((r) => r.s);
  const st = q1(`SELECT (SELECT count(*) FROM v_cultivar_list WHERE kind='cultivar' AND only_1963 = 0) AS n,
                        (SELECT count(*) FROM v_cultivar_list WHERE only_1963 = 1) AS old,
                        (SELECT count(*) FROM v_cultivar_list WHERE kind='cultivar' AND only_1963 = 0 AND has_ancestry) AS a,
                        (SELECT count(*) FROM v_cultivar_list WHERE kind='cultivar' AND only_1963 = 0 AND has_description) AS d`);

  const link = (page) => hashFor("/", { q: state.q, size: state.size, all: state.all, sport: state.sport, anc: state.anc, desc: state.desc, photo: state.photo, old: state.old, page: page > 1 ? page : "" });
  app.innerHTML = `
    <h1>African violet cultivars</h1>
    <p class="lede">${num(st.n)} cultivars${st.old ? ` and ${num(st.old)} older names from the 1963 Master List` : ""} &middot; ${num(st.a)} with ancestry &middot; ${num(st.d)} with descriptions.
      Search by name, hybridizer, color or description, or enter an AVSA registration number.</p>
    <form class="search-form" id="sform" role="search">
      <div class="search-row">
        <input type="search" id="sq" name="q" value="${esc(state.q)}" placeholder="e.g. Rob's, Ness, pink ruffled, 10627" aria-label="Search cultivars" autocomplete="off">
        <button type="submit">Search</button>
      </div>
      <div class="filters">
        <label>Size <select name="size"><option value="">Any</option>${sizes.map((s) => `<option${s === state.size ? " selected" : ""}>${esc(s)}</option>`).join("")}</select></label>
        <label><input type="checkbox" name="sport"${state.sport ? " checked" : ""}> Sports only</label>
        <label><input type="checkbox" name="anc"${state.anc ? " checked" : ""}> Has ancestry</label>
        <label><input type="checkbox" name="desc"${state.desc ? " checked" : ""}> Has description</label>
        <label><input type="checkbox" name="photo"${state.photo ? " checked" : ""}> Has photo</label>
        <label><input type="checkbox" name="excl63"${state.old ? "" : " checked"}> Exclude names found only in the 1963 Master List</label>
        <label><input type="checkbox" name="all"${state.all ? " checked" : ""}> Include seedlings, species &amp; unlisted parents</label>
      </div>
    </form>
    <p class="stats" role="status">${num(total)} ${total === 1 ? "result" : "results"}${state.q ? ` for “${esc(state.q)}”` : ""}${total > PAGE_SIZE ? ` &middot; page ${state.page} of ${pages}` : ""}</p>
    ${hidden > 0 ? `<p class="note-box">${num(hidden)} more ${hidden === 1 ? "match is a name that appears only as a parent, seedling or species." : "matches are names that appear only as parents, seedlings or species."}
        <a href="${hashFor("/", { q: state.q, size: state.size, sport: state.sport, anc: state.anc, desc: state.desc, photo: state.photo, old: state.old, all: true })}">Include ${hidden === 1 ? "it" : "them"}</a></p>` : ""}
    ${hidden63 > 0 ? `<p class="note-box">${num(hidden63)} more ${hidden63 === 1 ? "match is a name" : "matches are names"} found only in the 1963 Master List.
        <a href="${hashFor("/", { q: state.q, size: state.size, sport: state.sport, anc: state.anc, desc: state.desc, photo: state.photo, all: state.all, old: true })}">Include ${hidden63 === 1 ? "it" : "them"}</a></p>` : ""}
    ${rows.length ? `<ul class="results">${rows.map(card).join("")}</ul>` : `<p>No cultivars match. Try fewer words or clear a filter.</p>`}
    ${pages > 1 ? `<div class="pager">
        <a class="btn secondary" ${state.page > 1 ? `href="${link(state.page - 1)}"` : 'aria-disabled="true" style="visibility:hidden"'}>&larr; Previous</a>
        <span class="muted">Page ${state.page} of ${pages}</span>
        <a class="btn secondary" ${state.page < pages ? `href="${link(state.page + 1)}"` : 'aria-disabled="true" style="visibility:hidden"'}>Next &rarr;</a></div>` : ""}`;

  $("#sform").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    location.hash = hashFor("/", { q: (f.get("q") || "").trim(), size: f.get("size"), sport: !!f.get("sport"), anc: !!f.get("anc"), desc: !!f.get("desc"), photo: !!f.get("photo"), all: !!f.get("all"), old: f.get("excl63") ? "" : "1" });
  });
  $("#sform").addEventListener("change", (e) => { if (e.target.type !== "search") $("#sform").requestSubmit(); });
}

/* ------------------------------------------------------------------ photos */
const captionHtml = (p) => `${p.caption ? esc(p.caption) + " " : ""}<span class="credit">Photo: ${esc(p.credit)}</span>`;
const photoAlt = (c, p) => c.name + (p.caption ? ": " + p.caption : "");

function renderGallery(c, photos) {
  if (!photos.length) return "";
  const p = photos[0];
  return `<section class="gallery" aria-label="Photos of ${esc(c.name)}">
    <figure class="gallery-main">
      <button type="button" class="photo-btn" id="photo-main" aria-label="Enlarge photo">
        <img id="photo-main-img" src="${esc(photoUrl(p.file))}" alt="${esc(photoAlt(c, p))}"${p.width ? ` width="${p.width}" height="${p.height}"` : ""}>
      </button>
      <figcaption id="photo-main-cap">${captionHtml(p)}</figcaption>
    </figure>
    ${photos.length > 1 ? `<div class="gallery-strip">${photos.map((ph, i) => `<button type="button" class="strip-btn${i === 0 ? " current" : ""}" data-i="${i}" aria-label="Show photo ${i + 1} of ${photos.length}"><img src="${esc(thumbUrl(ph.file))}" alt="" loading="lazy"></button>`).join("")}</div>` : ""}
  </section>`;
}

function wireGallery(c, photos) {
  if (!photos.length) return;
  let cur = 0;
  const dlg = $("#lightbox");
  const fillLightbox = () => {
    const p = photos[cur];
    $("#lb-img").src = photoUrl(p.file);
    $("#lb-img").alt = photoAlt(c, p);
    $("#lb-cap").innerHTML = captionHtml(p);
    $("#lb-prev").hidden = $("#lb-next").hidden = photos.length < 2;
  };
  const show = (i) => {
    cur = (i + photos.length) % photos.length;
    const p = photos[cur], img = $("#photo-main-img");
    img.src = photoUrl(p.file);
    img.alt = photoAlt(c, p);
    if (p.width) { img.width = p.width; img.height = p.height; }
    $("#photo-main-cap").innerHTML = captionHtml(p);
    document.querySelectorAll(".strip-btn").forEach((b, k) => b.classList.toggle("current", k === cur));
    if (dlg.open) fillLightbox();
  };
  document.querySelectorAll(".strip-btn").forEach((b) => b.addEventListener("click", () => show(parseInt(b.dataset.i, 10))));
  $("#photo-main-img").addEventListener("error", (e) => {
    e.target.closest("figure").insertAdjacentHTML("afterbegin", `<p class="muted">This photo could not be loaded.</p>`);
    e.target.closest("button").remove();
  });
  // handlers on the shared dialog are assigned (not added), so they never stack up across pages
  $("#photo-main").addEventListener("click", () => { fillLightbox(); dlg.showModal(); });
  $("#lb-close").onclick = () => dlg.close();
  $("#lb-prev").onclick = () => show(cur - 1);
  $("#lb-next").onclick = () => show(cur + 1);
  dlg.onclick = (e) => { if (e.target === dlg) dlg.close(); };
  dlg.onkeydown = (e) => {
    if (e.key === "ArrowLeft") { e.preventDefault(); show(cur - 1); }
    if (e.key === "ArrowRight") { e.preventDefault(); show(cur + 1); }
  };
}

/* ------------------------------------------------------------------ cultivar page */
function renderCultivar(app, id) {
  const c = q1(`SELECT c.*, h.hybridizers FROM cultivars c LEFT JOIN cultivar_hybridizer_names h ON h.cultivar_id = c.id WHERE c.id = :id`, { id });
  if (!c) { app.innerHTML = `<h1>Not found</h1><p>There is no cultivar with the id “${esc(id)}”. <a href="${searchHref()}">Back to search</a></p>`; return; }

  const people = q(`SELECT p.id, p.name, p.kind, p.country FROM cultivar_hybridizers ch JOIN people p ON p.id = ch.person_id WHERE ch.cultivar_id = :id ORDER BY ch.position`, { id });
  const parents = q(`SELECT * FROM v_parents WHERE child_id = :id ORDER BY CASE role WHEN 'seed' THEN 1 WHEN 'pollen' THEN 2 WHEN 'sport' THEN 0 ELSE 3 END, parent_name`, { id });
  const children = q(`SELECT * FROM v_children WHERE parent_id = :id AND role <> 'sport' ORDER BY child_name`, { id });
  const sports = q(`SELECT id, name FROM cultivars WHERE sport_of_id = :id ORDER BY name`, { id });
  const links = q(`SELECT url, kind FROM cultivar_links WHERE cultivar_id = :id`, { id });
  const photos = q(`SELECT * FROM images WHERE cultivar_id = :id ORDER BY sort_order, id`, { id });
  const family = q(`
    WITH RECURSIVE up(id) AS (SELECT :id UNION SELECT c.sport_of_id FROM cultivars c JOIN up ON c.id = up.id WHERE c.sport_of_id IS NOT NULL),
    fam(id, depth) AS (SELECT c.id, 0 FROM up JOIN cultivars c ON c.id = up.id WHERE c.sport_of_id IS NULL
                       UNION SELECT c.id, fam.depth + 1 FROM cultivars c JOIN fam ON c.sport_of_id = fam.id)
    SELECT c.id, c.name, fam.depth FROM fam JOIN cultivars c ON c.id = fam.id ORDER BY fam.depth, c.name`, { id });

  const facts = [
    ["Type", c.kind === "cultivar" ? "" : ({ stub: "Appears only as a parent in other records; no record of its own", seedling: "Seedling / unnamed", species: "Species" }[c.kind] || c.kind)],
    ["Hybridizer", people.length ? people.map((p) => `<a href="#/p/${encodeURIComponent(p.id)}">${esc(p.name)}</a>${p.country ? ` <span class="muted">(${esc(p.country)})</span>` : ""}`).join(" / ")
      : (c.hybridizer_raw ? `${esc(c.hybridizer_raw)}${c.masterlist_1963 ? ` <span class="muted">(as printed in the 1963 Master List)</span>` : ""}` : "")],
    ["Size", esc(c.size_class)],
    ["Color", esc(c.color)],
    ["Bloom", esc(c.bloom_description)],
    ["Foliage", esc(c.foliage_description)],
    ["Description", c.description ? `${esc(c.description)}${c.masterlist_1963 ? ` <span class="muted">(1963 Master List)</span>` : ""}` : ""],
    ["AVSA registration", c.registration_no ? `#${esc(c.registration_no)}${c.registered_date ? `, registered ${esc(c.registered_date)}` : ""}`
      : (c.registered_1963 ? "Registered before 1964 (marked REG. in the 1963 Master List, which gives no number)" : "")],
    ["1963 Master List", c.masterlist_1963 ? `Listed in the 1963 Master List: ${esc(c.masterlist_1963)}${scanLink(c.masterlist_1963)}` : ""],
  ].filter(([, v]) => v);

  const parentLine = (p) => `<li>${linkCultivar(p.parent_id, p.parent_name)}${p.parent_kind !== "cultivar" ? ` <span class="role">${esc(kindLabel(p.parent_kind))}</span>` : ""}
      <span class="role${p.certainty !== "known" ? " unsure" : ""}">${esc({ seed: "seed parent", pollen: "pollen parent", unordered: "parent (seed/pollen not stated)", sport: "sport of" }[p.role])}${p.certainty !== "known" ? `, ${esc(p.certainty)}` : ""}</span></li>`;

  const rawSeed = c.seed_parent_raw, rawPollen = c.pollen_parent_raw;
  const hasSeed = parents.some((p) => p.role === "seed" || p.role === "unordered");
  const hasPollen = parents.some((p) => p.role === "pollen" || p.role === "unordered");
  const unknownNotes = [];
  if (!c.sport_of_id) {
    if (rawSeed && !hasSeed) unknownNotes.push(`seed parent recorded as “${esc(rawSeed)}”`);
    if (rawPollen && !hasPollen) unknownNotes.push(`pollen parent recorded as “${esc(rawPollen)}”`);
  }

  const showAll = (arr, render, n = 25) => arr.length <= n ? `<ul class="plain">${arr.map(render).join("")}</ul>`
    : `<ul class="plain">${arr.slice(0, n).map(render).join("")}</ul><details><summary>Show all ${arr.length}</summary><ul class="plain">${arr.slice(n).map(render).join("")}</ul></details>`;

  const SOURCE_LABEL = { xlsx: "Saintpaulia Ancestry spreadsheet", sqlite: "AVSA registry database", supplement: "AVSA Master List supplements",
    masterlist1963: "1963 Master List", submission: "contributed by a hybridizer", parent: "named as a parent in other records" };
  const sourceText = (c.sources || "").split("+").map((x) => SOURCE_LABEL[x] || x).join(", ");
  const sources = [c.sources && `Sources: ${esc(sourceText)}`, c.supplement_year && `AVSA Master List supplement ${esc(c.supplement_year)}`, c.source_note && esc(c.source_note)].filter(Boolean);

  app.innerHTML = `
    <div class="crumbs"><a href="${searchHref()}">&larr; Search</a></div>
    <h1>${esc(c.name)}</h1>
    ${badges({ kind: c.kind, is_sport: !!c.sport_of_id, registration_no: null })}
    ${renderGallery(c, photos)}
    <div class="grid2" style="margin-top:16px">
      <section class="panel" aria-labelledby="h-desc"><h2 id="h-desc">Description</h2>
        ${facts.length ? `<dl class="facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>` : `<p class="muted">No description recorded.</p>`}
        ${c.notes ? `<p class="note-box">${esc(c.notes)}</p>` : ""}
        ${links.length ? `<p class="small">${links.map((l) => `<a href="${esc(l.url)}" rel="noopener" target="_blank">${l.kind === "photos" ? "Photos" : "Link"}</a>`).join(" &middot; ")}</p>` : ""}
        ${sources.length ? `<p class="muted small">${sources.join(" &middot; ")}</p>` : ""}
      </section>
      <section class="panel" aria-labelledby="h-anc"><h2 id="h-anc">Parentage</h2>
        ${parents.length ? `<ul class="plain">${parents.map(parentLine).join("")}</ul>` : `<p class="muted">No parentage recorded.</p>`}
        ${unknownNotes.length ? `<p class="note-box">${unknownNotes.join("; ")}.</p>` : ""}
        ${sports.length ? `<h2>Sports of this cultivar</h2>${showAll(sports, (s) => `<li>${linkCultivar(s.id, s.name)}</li>`)}` : ""}
        ${children.length ? `<h2>Used as a parent of (${children.length})</h2>${showAll(children, (ch) => `<li>${linkCultivar(ch.child_id, ch.child_name)}<span class="role">${esc({ seed: "as seed parent", pollen: "as pollen parent", unordered: "as parent" }[ch.role])}</span></li>`)}` : ""}
      </section>
    </div>
    ${family.length > 1 ? `<section class="panel" style="margin-top:16px" aria-labelledby="h-fam"><h2 id="h-fam">Sport family</h2>
      <ul class="plain">${family.map((f) => `<li style="padding-left:${f.depth * 20}px">${f.id === c.id ? `<strong>${esc(f.name)}</strong>` : linkCultivar(f.id, f.name)}</li>`).join("")}</ul></section>` : ""}
    <h2 id="h-graph">Lineage</h2>
    <div class="lin-tabs" role="tablist" aria-label="Lineage direction">
      <button type="button" role="tab" id="tab-anc" aria-selected="true">Ancestors</button>
      <button type="button" role="tab" id="tab-dec" aria-selected="false">Descendants</button>
      <button type="button" role="tab" id="tab-both" aria-selected="false">Both</button>
    </div>
    <div class="graph-tools">
      <label id="anc-label">Ancestors <select id="anc-depth"></select><span class="gen-word"> generations</span></label>
      <label id="dec-label">Descendants <select id="dec-depth"></select><span class="gen-word"> generations</span></label>
      <span class="seg" role="group" aria-label="Lineage display">
        <button type="button" id="v-list" aria-pressed="false">Outline</button>
        <button type="button" id="v-graph" aria-pressed="true">Graph</button>
      </span>
      <button type="button" class="secondary" id="fit">Fit to view</button>
    </div>
    <div id="graph" role="img" aria-label="Lineage graph for ${esc(c.name)}"></div>
    <div id="outline" hidden></div>
    <div class="legend" aria-hidden="true"><span class="seed">seed parent</span><span class="pollen">pollen parent</span><span class="sport">sport of</span><span class="unordered">parent, role not stated</span></div>
    <p class="graph-msg" id="graph-msg" role="status"></p>
    <p class="muted small" id="lin-help"></p>`;

  wireGallery(c, photos);
  const DEPTHS = { anc: [1, 2, 3, 4, 5, 6, 8, 12, 0], dec: [1, 2, 3, 4, 6, 8, 0] };   // 0 = all generations
  const st = { dir: "anc", view: isNarrow() ? "list" : "graph", depth: { anc: 4, dec: 1 } };
  for (const k of ["anc", "dec"]) {
    $("#" + k + "-depth").innerHTML = DEPTHS[k].map((n) => `<option value="${n}"${n === st.depth[k] ? " selected" : ""}>${n || "All"}</option>`).join("");
    $("#" + k + "-depth").addEventListener("change", (e) => { st.depth[k] = parseInt(e.target.value, 10); draw(); });
  }
  const draw = () => {
    const both = st.dir === "both";
    const upN = st.dir === "dec" ? 0 : (st.depth.anc || 40), downN = st.dir === "anc" ? 0 : (st.depth.dec || 40);
    for (const k of ["anc", "dec", "both"]) $("#tab-" + k).setAttribute("aria-selected", st.dir === k);
    $("#anc-label").hidden = st.dir === "dec";
    $("#dec-label").hidden = st.dir === "anc";
    $$(".gen-word").forEach((w) => { w.hidden = both; });
    $("#v-list").setAttribute("aria-pressed", st.view === "list");
    $("#v-graph").setAttribute("aria-pressed", st.view === "graph");
    $("#graph").hidden = st.view !== "graph";
    $("#outline").hidden = st.view !== "list";
    $("#fit").hidden = st.view !== "graph";
    $(".legend").hidden = st.view !== "graph";
    $("#graph-msg").textContent = "";
    $("#lin-help").textContent = st.view === "graph"
      ? "Tap any cultivar in the graph to open it. The outline around a parent's name matches the line drawn from it to its offspring. Pale italic names appear only as parents."
      : "Tap an arrow to open or close a branch; tap a name to open that cultivar. Every generation is in the outline.";
    if (st.view === "graph") drawGraph(id, upN, downN);
    else {
      if (cy) { cy.destroy(); cy = null; }
      const out = $("#outline");
      out.innerHTML = "";
      for (const [dir, n] of [["anc", upN], ["dec", downN]]) {
        if (!n) continue;
        const sec = document.createElement("section");
        sec.className = "ol-section";
        if (both) sec.innerHTML = `<h3>${dir === "anc" ? "Ancestors" : "Descendants"}</h3>`;
        out.appendChild(sec);
        drawOutline(id, dir, n, sec);
      }
    }
  };
  for (const k of ["anc", "dec", "both"]) $("#tab-" + k).addEventListener("click", () => { st.dir = k; draw(); });
  $("#v-list").addEventListener("click", () => { st.view = "list"; draw(); });
  $("#v-graph").addEventListener("click", () => { st.view = "graph"; draw(); });
  $("#fit").addEventListener("click", () => fitGraph(id));
  draw();
}

/* ------------------------------------------------------------------ lineage outline */
const ROLE_LABEL = { seed: "seed", pollen: "pollen", unordered: "parent", sport: "sport of" };
const ROLE_ORDER = { seed: 0, pollen: 1, unordered: 2, sport: 3 };

/** Indented, collapsible tree. "anc": rows are the parents of the row above. "dec": rows are its children.
 *  Every generation is included; branches below the first levels are drawn only when opened. */
function drawOutline(id, dir, maxDepth, box) {
  const edges = edgeSet(id, dir === "anc" ? "up" : "down", maxDepth);
  if (!edges.length) { box.insertAdjacentHTML("beforeend", `<p class="muted" style="padding:8px 0">No recorded ${dir === "anc" ? "ancestry" : "descendants"} for this cultivar.</p>`); return; }
  const ids = new Set([id]);
  edges.forEach((e) => { ids.add(e.child_id); ids.add(e.parent_id); });
  const info = new Map();
  const all = [...ids];
  for (let i = 0; i < all.length; i += 400) {
    const part = all.slice(i, i + 400);
    const stmt = db.prepare(`SELECT id, name, kind FROM cultivars WHERE id IN (${part.map(() => "?").join(",")})`);
    stmt.bind(part);
    while (stmt.step()) { const r = stmt.getAsObject(); info.set(r.id, r); }
    stmt.free();
  }
  // node -> [{id, role, certainty}]: its parents ("anc") or its children ("dec")
  const next = new Map();
  for (const e of edges) {
    const from = dir === "anc" ? e.child_id : e.parent_id, to = dir === "anc" ? e.parent_id : e.child_id;
    if (!next.has(from)) next.set(from, []);
    next.get(from).push({ id: to, role: e.role, certainty: e.certainty });
  }
  const nm = (x) => (info.get(x.id) ? info.get(x.id).name : "");
  for (const list of next.values()) list.sort((a, b) => (ROLE_ORDER[a.role] - ROLE_ORDER[b.role]) || nm(a).localeCompare(nm(b), undefined, { sensitivity: "base" }));
  // descendants: show the other parent of each child ("x Rob's Twist")
  const others = new Map();
  if (dir === "dec") {
    const kids = [...new Set(edges.map((e) => e.child_id))];
    for (let i = 0; i < kids.length; i += 400) {
      const part = kids.slice(i, i + 400);
      const stmt = db.prepare(`SELECT e.child_id, e.parent_id, c.name FROM edges e JOIN cultivars c ON c.id = e.parent_id WHERE e.child_id IN (${part.map(() => "?").join(",")})`);
      stmt.bind(part);
      while (stmt.step()) { const r = stmt.getAsObject(); if (!others.has(r.child_id)) others.set(r.child_id, []); others.get(r.child_id).push(r); }
      stmt.free();
    }
  }
  const expanded = new Set();   // cultivars whose branch is already drawn; later copies link back instead of repeating it
  const openLevels = dir === "anc" ? 3 : 1;
  const noun = (n) => dir === "anc" ? (n === 1 ? "parent" : "parents") : (n === 1 ? "child" : "children");

  function row(nid, via, parentId, level, path) {
    const n = info.get(nid) || { name: nid, kind: "stub" };
    const kids = (next.get(nid) || []).filter((k) => !path.has(k.id));
    const cls = n.kind === "stub" ? " stub" : n.kind === "seedling" ? " seedling" : "";
    let tag = "";
    if (via) {
      const unsure = via.certainty !== "known";
      tag = `<span class="ol-role ${via.role}${unsure ? " unsure" : ""}">${esc(ROLE_LABEL[via.role] || via.role)}${unsure ? " (" + esc(via.certainty) + ")" : ""}</span>`;
      if (dir === "dec") {
        const o = (others.get(nid) || []).filter((x) => x.parent_id !== parentId);
        if (o.length) tag += `<span class="ol-other">&times; ${o.map((x) => esc(x.name)).join(", ")}</span>`;
      }
    }
    const nameHtml = nid === id ? `<strong>${esc(n.name)}</strong>` : linkCultivar(nid, n.name);
    const repeat = kids.length && expanded.has(nid);
    if (!kids.length || repeat) {
      return `<div class="ol-row leaf${cls}" data-cid="${esc(nid)}">${tag}${nameHtml}${repeat ? ` <a class="ol-again" href="#" data-goto="${esc(nid)}">branch shown above</a>` : ""}</div>`;
    }
    expanded.add(nid);
    const open = level < openLevels;
    const sub = new Set(path); sub.add(nid);
    return `<details class="ol-node${cls}" data-cid="${esc(nid)}" data-level="${level}"${open ? " open data-filled=\"1\"" : ""}>
      <summary>${tag}${nameHtml}<span class="ol-count">${kids.length} ${noun(kids.length)}</span></summary>
      <div class="ol-kids">${open ? kids.map((k) => row(k.id, k, nid, level + 1, sub)).join("") : ""}</div></details>`;
  }

  box.insertAdjacentHTML("beforeend", `<div class="ol-tools"><button type="button" class="secondary ol-open">Open all</button> <button type="button" class="secondary ol-close">Close all</button></div>
    <div class="ol-root">${row(id, null, null, 0, new Set())}</div>`);

  function fill(det) {
    if (det.dataset.filled) return;
    det.dataset.filled = "1";
    const path = new Set([id]);   // the cultivars above this row, to avoid loops
    for (let p = det.parentElement; p && p !== box; p = p.parentElement) if (p.dataset && p.dataset.cid) path.add(p.dataset.cid);
    const kids = (next.get(det.dataset.cid) || []).filter((k) => !path.has(k.id));
    det.querySelector(":scope > .ol-kids").innerHTML = kids.map((k) => row(k.id, k, det.dataset.cid, parseInt(det.dataset.level, 10) + 1, path)).join("");
  }
  // "toggle" does not bubble, so listen in the capture phase
  box.addEventListener("toggle", (e) => { if (e.target.open && e.target.matches("details.ol-node")) fill(e.target); }, true);
  box.addEventListener("click", (e) => {
    const a = e.target.closest("[data-goto]");
    if (!a) return;
    e.preventDefault();
    const target = box.querySelector(`details[data-cid="${CSS.escape(a.dataset.goto)}"]`);
    if (!target) return;
    for (let p = target.parentElement; p; p = p.parentElement) if (p.tagName === "DETAILS") p.open = true;
    target.open = true;
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    target.classList.add("flash"); setTimeout(() => target.classList.remove("flash"), 1600);
  });
  $(".ol-open", box).addEventListener("click", () => {
    if (edges.length > 250 && !confirm(`This lineage has ${num(edges.length)} links. Opening every branch may be slow. Continue?`)) return;
    for (let guard = 0; guard < 60; guard++) {
      const closed = [...box.querySelectorAll("details.ol-node:not([open])")];
      if (!closed.length) break;
      closed.forEach((d) => { d.open = true; fill(d); });
    }
  });
  $(".ol-close", box).addEventListener("click", () => {
    box.querySelectorAll("details.ol-node").forEach((d, i) => { if (i) d.open = false; });
  });
}

/** True when the primary input is a mouse: only then is the wheel gated behind a click (touch keeps pinch-zoom). */
const WHEEL_GATED = window.matchMedia("(pointer: fine)").matches;

function isNarrow() { return window.matchMedia("(max-width: 700px)").matches; }

/** On a phone, fitting the whole graph makes the names unreadable. Fit to width, keep a readable minimum zoom,
 *  and start at the focus cultivar; the rest is a pan away. */
function fitGraph(id) {
  if (!cy) return;
  cy.fit(undefined, 20);
  if (!isNarrow()) return;
  const MIN = 0.55;
  if (cy.zoom() < MIN) {
    cy.zoom({ level: MIN, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
    const f = cy.getElementById(id);
    if (f.length) cy.center(f);
  }
}

/* ------------------------------------------------------------------ lineage graph */
function edgeSet(id, dir, maxDepth) {
  if (maxDepth <= 0) return [];
  const col = dir === "up" ? "child_id" : "parent_id";
  const nxt = dir === "up" ? "parent_id" : "child_id";
  return q(`
    WITH RECURSIVE t(child_id, parent_id, role, certainty, depth) AS (
      SELECT child_id, parent_id, role, certainty, 1 FROM edges WHERE ${col} = :id
      UNION
      SELECT e.child_id, e.parent_id, e.role, e.certainty, t.depth + 1
      FROM edges e JOIN t ON e.${col} = t.${nxt} WHERE t.depth < :max
    ) SELECT child_id, parent_id, role, certainty, MIN(depth) AS depth FROM t GROUP BY child_id, parent_id, role`, { id, max: maxDepth });
}

/** Limit how many children one parent fans out to so a popular parent does not draw as one unreadable row.
 *  Keeps the children that have descendants of their own first. Adds a "+N more" placeholder node. */
function fanCap(focus, edges, msgEl) {
  const byParent = new Map();
  for (const e of edges) { if (!byParent.has(e.parent_id)) byParent.set(e.parent_id, []); byParent.get(e.parent_id).push(e); }
  const kids = (cid) => (byParent.get(cid) || []).length;
  const drop = new Set(), extra = [], notes = [];
  for (const [pid, list] of byParent) {
    if (list.length <= MAX_FAN) continue;
    const ranked = [...list].sort((a, b) => kids(b.child_id) - kids(a.child_id) || a.child_id.localeCompare(b.child_id));
    ranked.slice(MAX_FAN).forEach((e) => drop.add(e));
    const n = list.length - MAX_FAN;
    extra.push({ child_id: "more:" + pid, parent_id: pid, role: "unordered", certainty: "known", depth: list[0].depth, more: n });
    const nm = q1("SELECT name FROM cultivars WHERE id = :id", { id: pid });
    notes.push(`${nm ? nm.name : pid}: showing ${MAX_FAN} of ${list.length} children`);
  }
  if (!drop.size) return edges;
  // keep only edges still connected to the focus after pruning
  const kept = edges.filter((e) => !drop.has(e)).concat(extra);
  const adj = new Map();
  for (const e of kept) {
    for (const [a, b] of [[e.parent_id, e.child_id], [e.child_id, e.parent_id]]) { if (!adj.has(a)) adj.set(a, []); adj.get(a).push(b); }
  }
  const seen = new Set([focus]); const stack = [focus];
  while (stack.length) for (const n of adj.get(stack.pop()) || []) if (!seen.has(n)) { seen.add(n); stack.push(n); }
  if (msgEl) msgEl.textContent = notes.join(". ") + ". The full list is shown above.";
  return kept.filter((e) => seen.has(e.parent_id) && seen.has(e.child_id));
}

function drawGraph(id, up, down) {
  const msg = $("#graph-msg");
  msg.textContent = "";
  let edges = edgeSet(id, "up", up).concat(fanCap(id, edgeSet(id, "down", down), msg));
  let ids = new Set([id]);
  edges.forEach((e) => { ids.add(e.child_id); ids.add(e.parent_id); });
  if (ids.size > MAX_GRAPH_NODES) {
    // too many nodes to draw legibly: keep the nearest generations only
    const keep = edges.filter((e) => e.depth <= 2);
    const k = new Set([id]); keep.forEach((e) => { k.add(e.child_id); k.add(e.parent_id); });
    msg.textContent = `This lineage has ${num(ids.size)} cultivars, too many to draw clearly. Showing two generations each way; lower the generations above to simplify further.`;
    edges = keep; ids = k;
  }
  if (cy) { cy.destroy(); cy = null; }
  const container = $("#graph");
  if (ids.size === 1) {
    container.innerHTML = `<p class="muted" style="padding:16px">No recorded ancestry or descendants to draw for this cultivar.</p>`;
    return;
  }
  container.innerHTML = "";
  const moreNodes = edges.filter((e) => e.more).map((e) => ({ id: e.child_id, n: e.more }));
  const list = [...ids].filter((x) => !x.startsWith("more:"));
  const stmt = db.prepare(`SELECT id, name, kind FROM cultivars WHERE id IN (${list.map(() => "?").join(",")})`);
  stmt.bind(list);
  const info = [];
  while (stmt.step()) info.push(stmt.getAsObject());
  stmt.free();

  const css = getComputedStyle(document.documentElement);
  const v = (n) => css.getPropertyValue(n).trim();
  const color = { seed: v("--seed"), pollen: v("--pollen"), sport: v("--sport"), unordered: v("--unordered") };
  // A parent's outline takes the role of the line leaving it (nearest to the focus if it has several).
  const parentRole = new Map(), parentDepth = new Map();
  for (const e of edges) {
    if (e.parent_id === id || e.more) continue;
    if (!parentRole.has(e.parent_id) || e.depth < parentDepth.get(e.parent_id)) { parentRole.set(e.parent_id, e.role); parentDepth.set(e.parent_id, e.depth); }
  }
  const els = [
    ...info.map((n) => ({ data: { id: n.id, label: n.name, kind: n.kind, focus: n.id === id ? 1 : 0, prole: parentRole.get(n.id) || "" } })),
    ...moreNodes.map((m) => ({ data: { id: m.id, label: `+${m.n} more`, kind: "more", focus: 0 } })),
    ...edges.map((e) => ({ data: { id: `${e.parent_id}>${e.child_id}:${e.role}`, source: e.parent_id, target: e.child_id, role: e.role, certainty: e.certainty } })),
  ];
  if (typeof cytoscapeDagre === "function") { try { cytoscape.use(cytoscapeDagre); } catch (e) { /* already registered */ } }
  const useDagre = typeof window.dagre !== "undefined";
  cy = cytoscape({
    container, elements: els, wheelSensitivity: 0.3, userZoomingEnabled: !WHEEL_GATED, minZoom: 0.15, maxZoom: 2.5,
    layout: useDagre ? { name: "dagre", rankDir: "TB", nodeSep: isNarrow() ? 10 : 18, rankSep: isNarrow() ? 36 : 48, padding: 20 } : { name: "breadthfirst", directed: true, padding: 20, spacingFactor: 1.1 },
    style: [
      { selector: "node", style: {
          label: "data(label)", "font-size": 12, color: v("--text"), "text-valign": "center", "text-halign": "center",
          "text-wrap": "wrap", "text-max-width": isNarrow() ? 84 : 110, shape: "round-rectangle", width: "label", height: "label", padding: "8px",
          "background-color": v("--node-cultivar"), "border-width": 1, "border-color": v("--node-border") } },
      { selector: 'node[kind="stub"]', style: { "background-color": v("--node-stub"), color: v("--muted"), "font-style": "italic" } },
      { selector: 'node[kind="seedling"]', style: { "background-color": v("--node-seedling") } },
      { selector: 'node[kind="more"]', style: { "background-opacity": 0, "border-width": 0, color: v("--muted") } },
      { selector: 'node[kind="species"]', style: { "background-color": v("--node-species") } },
      { selector: 'node[prole="seed"]', style: { "border-style": "solid", "border-width": 3, "border-color": color.seed } },
      { selector: 'node[prole="pollen"]', style: { "border-style": "dashed", "border-width": 3, "border-color": color.pollen } },
      { selector: 'node[prole="sport"]', style: { "border-style": "dotted", "border-width": 3, "border-color": color.sport } },
      { selector: 'node[prole="unordered"]', style: { "border-style": "solid", "border-width": 2, "border-color": color.unordered } },
      { selector: "node[focus = 1]", style: { "border-width": 3, "border-color": v("--accent"), "font-weight": "bold" } },
      { selector: "edge", style: { width: 2, "curve-style": "bezier", "target-arrow-shape": "triangle", "arrow-scale": 0.9,
          "line-color": color.unordered, "target-arrow-color": color.unordered } },
      { selector: 'edge[role="seed"]', style: { "line-style": "solid", width: 3, "line-color": color.seed, "target-arrow-color": color.seed } },
      { selector: 'edge[role="pollen"]', style: { "line-color": color.pollen, "target-arrow-color": color.pollen, "line-style": "dashed", width: 3 } },
      { selector: 'edge[role="sport"]', style: { "line-color": color.sport, "target-arrow-color": color.sport, "line-style": "dotted", width: 3 } },
      { selector: 'edge[role="unordered"]', style: { "line-style": "solid", width: 2, "line-color": color.unordered, "target-arrow-color": color.unordered } },
      { selector: 'edge[certainty != "known"]', style: { opacity: 0.55 } },
    ],
  });
  if (isNarrow()) {   // dagre lays out synchronously, so the layout is already done here
    fitGraph(id);
    requestAnimationFrame(() => { if (cy) { cy.resize(); fitGraph(id); } });   // again once the canvas has its final size
  }
  cy.on("tap", "node", (evt) => { const nid = evt.target.id(); if (nid !== id && !nid.startsWith("more:")) location.hash = "#/c/" + encodeURIComponent(nid); });
  if (WHEEL_GATED) {
    // With a mouse, the wheel scrolls the page until the graph is clicked; leaving the graph (or Esc) hands it back.
    const hint = document.createElement("div");
    hint.className = "graph-hint";
    hint.textContent = "Click the graph to zoom with the mouse wheel";
    container.appendChild(hint);
    const setZoom = (on) => { if (!cy) return; cy.userZoomingEnabled(on); hint.hidden = on; };
    cy.on("tap", (evt) => { if (evt.target === cy) setZoom(true); });
    cy.on("tap", "node", () => setZoom(true));
    container.addEventListener("mouseleave", () => setZoom(false));
    document.addEventListener("keydown", function esc(e) {
      if (!cy || !container.isConnected) { document.removeEventListener("keydown", esc); return; }
      if (e.key === "Escape") setZoom(false);
    });
  }
  cy.on("mouseover", "node", () => { container.style.cursor = "pointer"; });
  cy.on("mouseout", "node", () => { container.style.cursor = ""; });
}

/* ------------------------------------------------------------------ person page */
function renderPerson(app, id, params) {
  const p = q1("SELECT * FROM people WHERE id = :id", { id });
  if (!p) { app.innerHTML = `<h1>Not found</h1><p><a href="${searchHref()}">Back to search</a></p>`; return; }
  const page = Math.max(1, parseInt(params.get("page") || "1", 10) || 1);
  const total = q1(`SELECT count(*) AS n FROM cultivar_hybridizers ch JOIN cultivars c ON c.id = ch.cultivar_id WHERE ch.person_id = :id AND c.kind = 'cultivar'`, { id }).n;
  const rows = q(`SELECT l.* FROM cultivar_hybridizers ch JOIN v_cultivar_list l ON l.id = ch.cultivar_id
                  WHERE ch.person_id = :id AND l.kind = 'cultivar' ORDER BY l.name COLLATE NOCASE LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`, { id });
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const link = (n) => hashFor("/p/" + encodeURIComponent(id), { page: n > 1 ? n : "" });
  const aliases = p.aliases ? p.aliases.split(" | ") : [];
  app.innerHTML = `
    <div class="crumbs"><a href="${searchHref()}">&larr; Search</a></div>
    <h1>${esc(p.name)}</h1>
    <p class="lede">${esc({ person: "Hybridizer", organization: "Organization", species: "Species" }[p.kind])}${p.country ? `, ${esc(p.country)}` : ""}
      &middot; ${num(total)} ${total === 1 ? "cultivar" : "cultivars"}${aliases.length ? ` &middot; also written as ${aliases.map(esc).join(", ")}` : ""}</p>
    ${rows.length ? `<ul class="results">${rows.map(card).join("")}</ul>` : `<p class="muted">No cultivars recorded.</p>`}
    ${pages > 1 ? `<div class="pager">
        <a class="btn secondary" ${page > 1 ? `href="${link(page - 1)}"` : 'style="visibility:hidden"'}>&larr; Previous</a>
        <span class="muted">Page ${page} of ${pages}</span>
        <a class="btn secondary" ${page < pages ? `href="${link(page + 1)}"` : 'style="visibility:hidden"'}>Next &rarr;</a></div>` : ""}`;
}

/* ------------------------------------------------------------------ about page */
function renderProse(text) {
  const inline = (s) => {
    let out = "", last = 0;
    const re = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\*\*([^*]+)\*\*|`([^`]+)`|(https?:\/\/[^\s<]+)|(\bwww\.[^\s<]+)/g;
    for (let m; (m = re.exec(s));) {
      out += esc(s.slice(last, m.index));
      if (m[3]) out += `<strong>${esc(m[3])}</strong>`;
      else if (m[4]) out += `<code>${esc(m[4])}</code>`;
      else {
        const url = m[2] || m[5] || "https://" + m[6];
        const label = m[1] || m[5] || m[6];
        out += `<a href="${esc(url)}" rel="noopener" target="_blank">${esc(label)}</a>`;
      }
      last = m.index + m[0].length;
    }
    return out + esc(s.slice(last));
  };
  return text.split(/\n{2,}/).map((blk) => {
    const lines = blk.split("\n");
    if (lines.length === 1 && lines[0].startsWith("## ")) return `<h2>${inline(lines[0].slice(3))}</h2>`;
    if (lines.every((l) => l.startsWith("- "))) return `<ul>${lines.map((l) => `<li>${inline(l.slice(2))}</li>`).join("")}</ul>`;
    return `<p>${lines.map(inline).join("<br>")}</p>`;
  }).join("");
}

function renderAbout(app) {
  const pg = q1("SELECT title, body FROM pages WHERE slug = 'about'");
  app.innerHTML = `<h1>${esc(pg ? pg.title : "Project history")}</h1>
    <div class="prose">${pg ? renderProse(pg.body) : "<p>No project history is available.</p>"}</div>`;
}

function renderDownloads(app) {
  const pg = q1("SELECT title, body FROM pages WHERE slug = 'downloads'");
  app.innerHTML = `<h1>${esc(pg ? pg.title : "Downloads")}</h1>
    ${pg ? `<div class="prose">${renderProse(pg.body)}</div>` : ""}
    <ul class="downloads">${DOWNLOADS.map((d, i) => `<li class="card" id="dl-${i}">
      <h2>${esc(d.title)}</h2><p>${esc(d.text)}</p>
      <p class="muted">${esc(d.format)} <span class="dl-size"></span></p>
      <a class="btn" href="${esc(d.file)}" download hidden>Download</a>
      <span class="muted dl-missing" hidden>Not available in this copy of the site. Run the export script (see the README).</span>
    </li>`).join("")}</ul>`;
  DOWNLOADS.forEach((d, i) => {
    const li = $("#dl-" + i, app);
    fetch(d.file, { method: "HEAD" }).then((r) => {
      if (!r.ok) throw new Error(r.status);
      const n = Number(r.headers.get("content-length"));
      if (n) $(".dl-size", li).textContent = "· " + (n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.round(n / 1024) + " KB");
      $(".btn", li).hidden = false;
    }).catch(() => { $(".dl-missing", li).hidden = false; });
  });
}

boot();
