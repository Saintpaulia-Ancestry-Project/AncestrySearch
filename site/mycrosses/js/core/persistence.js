// "Will the browser keep my data?" The app asks for persistent storage once and shows the answer in plain words.
// Stage 1 found that navigator.storage.persist() can wait forever on some setups and that a fresh site is usually NOT granted it
// (browsers decide by use: an installed Home Screen app, a bookmark, regular visits). So: ask with a time limit, never block the app,
// and keep the backup reminder whatever the answer is.

const withTimeout = (promise, ms, fallback) => Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(fallback), ms))]);

/** Returns { supported, persisted, asked, timed_out, usage, quota, checked_at }. Never throws. */
export async function requestPersistence({ storage = globalThis.navigator && globalThis.navigator.storage, now = () => Date.now(), timeoutMs = 3000 } = {}) {
  const out = { supported: !!(storage && typeof storage.persist === "function"), persisted: false, asked: false, timed_out: false, usage: null, quota: null, checked_at: new Date(now()).toISOString() };
  if (!out.supported) return out;
  try {
    out.persisted = typeof storage.persisted === "function" ? !!(await withTimeout(storage.persisted(), timeoutMs, false)) : false;
    if (!out.persisted) {
      out.asked = true;
      const answer = await withTimeout(storage.persist(), timeoutMs, "timeout");
      if (answer === "timeout") out.timed_out = true; else out.persisted = !!answer;
    }
  } catch (_) { /* leave the defaults: not persisted */ }
  try {
    if (typeof storage.estimate === "function") { const e = await withTimeout(storage.estimate(), timeoutMs, null); if (e) { out.usage = e.usage ?? null; out.quota = e.quota ?? null; } }
  } catch (_) { /* optional */ }
  return out;
}

/** One or two plain sentences for the status area. */
export function describePersistence(p) {
  if (!p || !p.supported) return "This browser cannot promise to keep your data. Make a backup file often.";
  if (p.persisted) return "This browser has promised to keep your data on this device. Backups are still a good idea.";
  if (p.timed_out) return "The browser did not answer whether it will keep your data. Treat it as not guaranteed and make backup files.";
  return "The browser may clear this data if the device runs low on space or you do not visit for a long time (on iPhone, add the app to the Home Screen). Make backup files often.";
}
