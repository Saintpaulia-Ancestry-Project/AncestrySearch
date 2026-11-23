// The official (Ancestry) database, read only, for the parent picker. The user's records are NEVER written into it and it is never
// written into their records except for a small snapshot (name, hybridizer, size, short description) kept for offline display.
//
// Two files: avancestry.sqlite (everything except the names hidden by default) and avancestry-old.sqlite (1963-only and old
// supplement-only names, none with parents or children). The second one is loaded only when the user asks to search the older names.
// This class takes sql.js and the file bytes, so Node tests can run it on the real files; the browser loader is below.

export const searchWords = (text) => (String(text).match(/[\p{L}\p{N}]+/gu) || []).slice(0, 8);
/** FTS4 prefix terms limited to the name column: name:baby* name:pink*  (words are letters and digits only, so nothing can be injected). */
export const nameQuery = (words) => words.map((w) => `name:${w}*`).join(" ");

const COLS = "l.id, l.name, l.kind, l.size_class, l.registration_no, l.registered_year, l.hybridizers, l.has_ancestry, l.has_descendants, l.photo";

export class OfficialDb {
  constructor(SQL, mainBytes) { this.SQL = SQL; this.main = new SQL.Database(mainBytes); this.old = null; this.builtAt = this._meta(this.main, "built_at"); this.imageBase = this._meta(this.main, "image_base_url"); }

  _meta(db, key) { const st = db.prepare("SELECT value FROM meta WHERE key = :k"); try { st.bind({ ":k": key }); return st.step() ? st.getAsObject().value : null; } finally { st.free(); } }
  _all(db, sql, bind) { const st = db.prepare(sql), out = []; try { if (bind) st.bind(bind); while (st.step()) out.push(st.getAsObject()); } finally { st.free(); } return out; }

  get hasOld() { return !!this.old; }
  addOld(bytes) { this.old = new this.SQL.Database(bytes); }

  /** Names that contain every word (prefix match), best first: exact name, then names that start with the text, then alphabetical. */
  search(text, { limit = 30 } = {}) {
    const words = searchWords(text);
    if (!words.length) return [];
    const m = nameQuery(words), plain = words.join(" ").toLowerCase();
    const sql = `SELECT ${COLS}, CASE WHEN lower(l.name) = :plain THEN 0 WHEN lower(l.name) LIKE :start THEN 1 ELSE 2 END AS rank
                 FROM cultivars_fts JOIN cultivar_list l ON l.rid = cultivars_fts.docid
                 WHERE cultivars_fts MATCH :m AND l.kind != 'seedling'
                 ORDER BY rank, l.name COLLATE NOCASE, l.id LIMIT :limit`;
    const bind = { ":m": m, ":plain": plain, ":start": plain.replace(/[%_\\]/g, " ") + "%", ":limit": limit };
    const rows = [];
    for (const db of [this.main, this.old]) if (db) for (const r of this._all(db, sql, bind)) rows.push({ ...r, in_old: db === this.old });
    rows.sort((a, b) => a.rank - b.rank || (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : a.id < b.id ? -1 : 1));
    return rows.slice(0, limit);
  }

  /** One cultivar by id, following a rename or merge (id_redirects). Returns null when the id is unknown. */
  get(id) {
    const first = id;
    for (let hop = 0; hop < 3; hop++) {
      for (const db of [this.main, this.old]) {
        if (!db) continue;
        const r = this._all(db, `SELECT ${COLS}, c.description FROM cultivar_list l JOIN cultivars c ON c.id = l.id WHERE l.id = :id`, { ":id": id })[0];
        if (r) return { ...r, requested_id: first, redirected: first !== r.id };
      }
      const red = this._all(this.main, "SELECT new_id FROM id_redirects WHERE old_id = :id", { ":id": id })[0];
      if (!red) return null;
      id = red.new_id;
    }
    return null;
  }

  close() { this.main.close(); if (this.old) this.old.close(); }
}

/** What the app keeps in the user's database about a chosen official cultivar (for offline display). */
export const snapshotOf = (r, imageBase = null) => ({ id: r.id, name: r.name, hybridizer: r.hybridizers || null, size_class: r.size_class || null, description: r.description || null, registration_no: r.registration_no ?? null, photo: r.photo || null, image_base: r.photo ? imageBase : null });

/** The only place official photos may come from (the same address the security policy allows). Anything else is ignored. */
export const IMAGE_HOST = "https://cdn.jsdelivr.net/gh/Saintpaulia-Ancestry-Project/";
export function thumbUrlOf(snap) {
  if (!snap || !snap.photo || typeof snap.image_base !== "string" || !snap.image_base.startsWith(IMAGE_HOST)) return null;
  return snap.image_base + "thumbs/" + encodeURIComponent(snap.photo);
}

/** One line to show in a list: "Baby Pink - Rienhardt - Standard - reg. 1234 (1997)". */
export function describeCultivar(r) {
  const bits = [r.hybridizers || r.hybridizer, r.size_class, r.registration_no ? `reg. ${r.registration_no}${r.registered_year ? " (" + r.registered_year + ")" : ""}` : null].filter(Boolean);
  return bits.join(" · ");
}

// ---------------------------------------------------------------- browser loader (not used by the Node tests)
let loading = null;
function loadScript(src) {
  return new Promise((resolve, reject) => { const s = document.createElement("script"); s.src = src; s.onload = resolve; s.onerror = () => reject(new Error("Could not load " + src)); document.head.append(s); });
}
async function fetchBytes(url, onProgress, guess) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load ${url} (HTTP ${res.status})`);
  if (!res.body || !res.body.getReader) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader(), chunks = []; let got = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); got += value.length; onProgress && onProgress(got, guess); }
  const out = new Uint8Array(got); let at = 0; for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

/** Loads the official database once (shared by every picker). onProgress(bytesSoFar, approxTotal). Rejects when offline; the caller keeps working without it. */
export function loadOfficial(onProgress) {
  if (!loading) {
    loading = (async () => {
      if (!window.initSqlJs) await loadScript("../vendor/sql-wasm.js");
      const SQL = await window.initSqlJs({ locateFile: (f) => "../vendor/" + f });
      const bytes = await fetchBytes("../avancestry.sqlite", (g, t) => loading && listeners.forEach((l) => l(g, t)), 11300000);
      await new Promise((r) => setTimeout(r, 0));
      return new OfficialDb(SQL, bytes);
    })();
    loading.catch(() => { loading = null; });                  // a failed attempt (offline) may be tried again
  }
  const l = onProgress; if (l) listeners.add(l);
  return loading.finally(() => l && listeners.delete(l));
}
const listeners = new Set();

let loadingOld = null;
export function loadOfficialOld(official, onProgress) {
  if (official.hasOld) return Promise.resolve();
  if (!loadingOld) {
    loadingOld = (async () => {
      const bytes = await fetchBytes("../avancestry-old.sqlite?v=" + encodeURIComponent(official.builtAt || ""), onProgress, 11500000);
      await new Promise((r) => setTimeout(r, 0));
      official.addOld(bytes);
    })();
    loadingOld.catch(() => { loadingOld = null; });
  }
  return loadingOld;
}
