// Hybrid logical clock (HLC) for per-field timestamps.
//
// A stamp is a string that sorts correctly as text:  <ISO time, ms, UTC>-<counter, 4 hex>-<device id>
//   2026-11-23T10:15:30.123Z-0004-3f2a9c1e-...
// It is the later of this device's clock and the highest stamp seen so far, plus a counter, so a device with a wrong clock can never
// make its edits look older than something it has already received, and two edits in the same millisecond still order. Ties between devices
// are broken by the device id (text order), so every device reaches the same winner.

export const HLC_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)-([0-9a-f]{4})-([0-9a-f-]{8,64})$/;

export function parseStamp(s) {
  const m = HLC_RE.exec(String(s));
  if (!m) return null;
  return { ms: Date.parse(m[1]), counter: parseInt(m[2], 16), device: m[3], iso: m[1] };
}

export function formatStamp(ms, counter, deviceId) {
  return new Date(ms).toISOString() + "-" + counter.toString(16).padStart(4, "0") + "-" + deviceId;
}

/** Plain state object {ms, counter}; pure functions so the caller decides where it is stored. */
export function newClockState() { return { ms: 0, counter: 0 }; }

/** Next stamp for a local edit. Returns [stamp, newState]. */
export function tick(state, nowMs, deviceId) {
  let ms = state.ms, counter = state.counter;
  if (nowMs > ms) { ms = nowMs; counter = 0; } else { counter += 1; }
  if (counter > 0xffff) { ms += 1; counter = 0; }
  return [formatStamp(ms, counter, deviceId), { ms, counter }];
}

/** Take a stamp seen on another device into account (call for every stamp that arrives in an import). */
export function observe(state, stamp, nowMs) {
  const p = parseStamp(stamp);
  if (!p) return state;
  const top = Math.max(state.ms, p.ms, nowMs);
  let counter;
  if (top === state.ms && top === p.ms) counter = Math.max(state.counter, p.counter);
  else if (top === state.ms) counter = state.counter;
  else if (top === p.ms) counter = p.counter;
  else counter = 0;
  return { ms: top, counter };
}

/** Text comparison is the order. Returns -1, 0 or 1. */
export function compareStamps(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

/** The ISO time part of a stamp (what the record's updated_at shows). */
export function stampTime(stamp) { const p = parseStamp(stamp); return p ? p.iso : null; }
