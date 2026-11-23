// The parent picker's database layer, run on the real committed database files (sql.js in Node).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { OfficialDb, searchWords, nameQuery, snapshotOf, describeCultivar, thumbUrlOf, IMAGE_HOST } from "../js/app/official.js";

const site = (p) => fileURLToPath(new URL("../../" + p, import.meta.url));
const require = createRequire(import.meta.url);
const initSqlJs = require(site("vendor/sql-wasm.js"));
const SQL = await initSqlJs({ locateFile: (f) => site("vendor/" + f) });
const db = new OfficialDb(SQL, readFileSync(site("avancestry.sqlite")));

test("words and the FTS query are built from letters and digits only", () => {
  assert.deepEqual(searchWords("Rob's  Baby-Pink\" OR 1=1"), ["Rob", "s", "Baby", "Pink", "OR", "1", "1"]);
  assert.equal(nameQuery(["baby", "pink"]), "name:baby* name:pink*");
  assert.deepEqual(searchWords("   "), []);
});

test("search: exact name first, every word must match, any order", () => {
  const r = db.search("baby pink");
  assert.ok(r.length > 0);
  assert.ok(r.every((x) => /baby/i.test(x.name) && /pink/i.test(x.name)));
  assert.equal(r[0].rank, Math.min(...r.map((x) => x.rank)));
  const swapped = db.search("pink baby").map((x) => x.id).sort();
  assert.deepEqual(swapped, r.map((x) => x.id).sort());
  assert.ok(r.length <= 30);
});

test("search: a prefix finds names, nothing for nonsense, injection text is harmless", () => {
  assert.ok(db.search("rob").length > 5);
  assert.equal(db.search("zzzzqqqq").length, 0);
  assert.deepEqual(db.search("*** \" ) OR"), db.search("OR"));
  assert.equal(db.search("").length, 0);
});

test("get: returns the record with its facts, null for an unknown id", () => {
  const first = db.search("baby pink")[0];
  const one = db.get(first.id);
  assert.equal(one.id, first.id); assert.equal(one.name, first.name); assert.equal(one.redirected, false);
  assert.equal(db.get("no-such-cultivar-id"), null);
  const snap = snapshotOf(one, db.imageBase);
  assert.deepEqual(Object.keys(snap), ["id", "name", "hybridizer", "size_class", "description", "registration_no", "photo", "image_base"]);
  assert.equal(typeof describeCultivar(one), "string");
});

test("get follows id_redirects to the current id", () => {
  const red = db._all(db.main, "SELECT old_id, new_id FROM id_redirects LIMIT 1")[0];
  assert.ok(red, "the database has redirects");
  const r = db.get(red.old_id);
  assert.equal(r.id, red.new_id); assert.equal(r.redirected, true); assert.equal(r.requested_id, red.old_id);
});

test("older names are a second file searched only after it is added", () => {
  const oldBytes = readFileSync(site("avancestry-old.sqlite"));
  const probe = db._all(new SQL.Database(oldBytes), "SELECT name FROM cultivar_list WHERE kind = 'cultivar' LIMIT 1")[0].name;
  assert.equal(db.search(probe).some((x) => x.in_old), false);
  db.addOld(oldBytes);
  const r = db.search(probe);
  assert.ok(r.some((x) => x.in_old && x.name === probe), "found in the old file");
  assert.ok(db.get(r.find((x) => x.in_old).id), "get also looks in the old file");
});

test("thumbnail address: built from the snapshot, only for the project's image host", () => {
  assert.ok(db.imageBase.startsWith(IMAGE_HOST), "the database's image base is inside the allowed host");
  const withPhoto = db._all(db.main, "SELECT id FROM cultivar_list WHERE photo IS NOT NULL LIMIT 1")[0];
  const snap = snapshotOf(db.get(withPhoto.id), db.imageBase);
  assert.ok(snap.photo);
  assert.equal(thumbUrlOf(snap), db.imageBase + "thumbs/" + encodeURIComponent(snap.photo));
  assert.equal(thumbUrlOf({ ...snap, image_base: "https://evil.example/" }), null);
  assert.equal(thumbUrlOf({ ...snap, photo: null }), null);
  assert.equal(thumbUrlOf(undefined), null);
  assert.equal(thumbUrlOf({ photo: "a.webp" }), null);
});
