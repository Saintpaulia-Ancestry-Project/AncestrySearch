// Tiny DOM helper. Everything that comes from the user's records goes in as text (textContent), never as HTML, so a note
// containing "<script>" is just shown as those characters.

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === false || v == null) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "value") el.value = v;
    else if (k === "checked" || k === "disabled" || k === "hidden" || k === "selected" || k === "required" || k === "multiple") { if (v) el[k] = true; }
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

/** Plain-language date for display: 2026-11-23 -> 23 Nov 2026 (the stored value stays YYYY-MM-DD). */
export function showDate(d) {
  if (!d) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d); if (!m) return String(d);
  return `${parseInt(m[3], 10)} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][parseInt(m[2], 10) - 1]} ${m[1]}`;
}

export function daysAgo(iso, now = Date.now()) {
  const ms = Date.parse(iso); if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.floor((now - ms) / 86400000));
}

/** Object URLs for photo files; revoked when the screen changes so a long session does not pile up memory. */
const urls = new Set();
export function blobUrl(bytes, type = "image/jpeg") { const u = URL.createObjectURL(new Blob([bytes], { type })); urls.add(u); return u; }
// Revoked a little later, not at once: an image that was just given its address may not have started loading yet (the browser would log an error).
export function revokeUrls() { const old = [...urls]; urls.clear(); setTimeout(() => { for (const u of old) URL.revokeObjectURL(u); }, 4000); }
