// Ids. Local records get a UUID v4 generated on the device (crypto.randomUUID needs https or localhost).
// Official cultivar ids are slugs ("baby-pink") and never look like a UUID, so a *_ref can be told apart without a separate flag.

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function newId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") return globalThis.crypto.randomUUID();
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const isLocalId = (s) => typeof s === "string" && UUID_RE.test(s);

/** "local" (a seedling of this app), "official" (a cultivar of the Ancestry database) or null (unknown parent). */
export function refKind(ref) {
  if (ref === null || ref === undefined || ref === "") return null;
  return isLocalId(ref) ? "local" : "official";
}

/** Short label for showing a device id to people ("3f2a9c1e"). */
export const shortId = (id) => String(id || "").slice(0, 8);
