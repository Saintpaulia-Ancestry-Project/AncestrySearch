// Validation of the table's own fields. Used before every local write and (stage 3) for every record that arrives in a sync file.
import { TABLES } from "./schema.js";
import { isLocalId } from "./ids.js";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HEX64_RE = /^[0-9a-f]{64}$/;
const CONTROL_ONE_LINE_RE = /[\r\n\u0000-\u0008\u000b\u000c\u000e-\u001f]/;
const CONTROL_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/;

export function isRealDate(s) {
  if (typeof s !== "string" || !DATE_RE.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Returns an error text for one value, or null when it is fine. null/undefined is fine unless the field is required. */
export function checkValue(spec, v) {
  if (v === null || v === undefined) return spec.required ? "is required" : null;
  switch (spec.kind) {
    case "str":
      if (typeof v !== "string") return "must be text";
      if (CONTROL_ONE_LINE_RE.test(v)) return "must be one line without control characters";
      if (spec.required && v.trim() === "") return "is required";
      return v.length > spec.max ? `is longer than ${spec.max} characters` : null;
    case "text":
      if (typeof v !== "string") return "must be text";
      if (CONTROL_RE.test(v)) return "contains control characters";
      return v.length > spec.max ? `is longer than ${spec.max} characters` : null;
    case "date": return isRealDate(v) ? null : "must be a real date written YYYY-MM-DD";
    case "int":
      if (!Number.isInteger(v)) return "must be a whole number";
      return v < spec.min || v > spec.max ? `must be between ${spec.min} and ${spec.max}` : null;
    case "bool3": return v === 0 || v === 1 ? null : "must be 0, 1 or empty";
    case "enum": return spec.values.includes(v) ? null : `must be one of ${spec.values.join(", ")}`;
    case "uuid": return isLocalId(v) ? null : "must be a record id";
    case "ref": return typeof v === "string" && v.length > 0 && v.length <= 200 && !/[\s\u0000-\u001f]/.test(v) ? null : "must be an id without spaces";
    case "hex64": return HEX64_RE.test(v) ? null : "must be a SHA-256 in hex";
    default: return "has an unknown kind";
  }
}

/**
 * Validate fields of a table. partial = true checks only the fields present (an update); false also requires the required ones.
 * Unknown field names are errors. Returns [{ field, message }].
 */
export function validateFields(table, fields, { partial = false } = {}) {
  const spec = TABLES[table];
  if (!spec) return [{ field: "(table)", message: `unknown table ${table}` }];
  const errors = [];
  for (const k of Object.keys(fields)) if (!(k in spec.fields)) errors.push({ field: k, message: "is not a field of " + table });
  for (const [k, s] of Object.entries(spec.fields)) {
    if (partial && !(k in fields)) continue;
    const msg = checkValue(s, fields[k]);
    if (msg) errors.push({ field: k, message: msg });
  }
  return errors;
}

/** Date order of a cross (made, harvested, sown; stored from, to) on a COMPLETE record. Kept apart so a single-cell edit can be checked against the whole row. */
export function crossDateErrors(f) {
  const errors = [];
  for (const [a, b] of [["date_made", "date_harvested"], ["date_harvested", "date_sown"], ["stored_from", "stored_to"]]) {
    if (f[a] && f[b] && f[a] > f[b]) errors.push({ field: b, message: `is before ${a.replace(/_/g, " ")}` });
  }
  return errors;
}

export class ValidationError extends Error {
  constructor(table, errors) {
    super(`${table}: ` + errors.map((e) => `${e.field} ${e.message}`).join("; "));
    this.name = "ValidationError";
    this.table = table;
    this.errors = errors;
  }
}
