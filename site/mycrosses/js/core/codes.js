// Small pure helpers: cross codes, seedling labels, sorting. No storage here, so they are easy to test.

/** Initials for cross codes: letters and digits, upper case, at most 6. Returns "" when nothing usable is left. */
export function cleanInitials(s) {
  return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

/** Default initials from a person's name ("Grace Goode" -> "GG"). */
export function initialsFromName(name) {
  return cleanInitials(String(name || "").split(/[\s,.-]+/).filter(Boolean).map((w) => w[0]).join(""));
}

/**
 * The next free cross code: INITIALS-YY-NNN (GG-26-014). codes = every code in use (live and in the Trash).
 * Another device may pick the same number: duplicates are detected later and flagged, never overwritten.
 */
export function nextCrossCode(codes, initials, year) {
  const ini = cleanInitials(initials) || "X";
  const yy = String(year % 100).padStart(2, "0");
  const prefix = `${ini}-${yy}-`;
  let max = 0;
  for (const c of codes) {
    if (typeof c === "string" && c.startsWith(prefix)) {
      const n = /^\d+$/.test(c.slice(prefix.length)) ? parseInt(c.slice(prefix.length), 10) : 0;
      if (n > max) max = n;
    }
  }
  return prefix + String(max + 1).padStart(3, "0");
}

/** The next seedling label in a cross: one more than the highest purely numeric label (labels like "12b" are ignored). */
export function nextLabel(labels) {
  let max = 0;
  for (const l of labels) if (/^\d+$/.test(String(l))) max = Math.max(max, parseInt(l, 10));
  return String(max + 1);
}

/** Natural order for labels: 2 before 10, 12 before 12b. Usable as an Array.sort comparator. */
export function compareLabels(a, b) {
  return String(a).localeCompare(String(b), "en", { numeric: true, sensitivity: "base" });
}

/** Groups of records that share one value of a key (and are more than one). Used for label and code collisions. */
export function findDuplicates(records, keyFn) {
  const groups = new Map();
  for (const r of records) {
    const k = keyFn(r);
    if (k === null || k === undefined || k === "") continue;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  return [...groups.entries()].filter(([, v]) => v.length > 1).map(([key, items]) => ({ key, items }));
}
