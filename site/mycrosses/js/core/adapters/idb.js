// IndexedDB storage (the real one, in the browser). Same interface as adapters/memory.js.
// Every call of tx() is ONE IndexedDB transaction: it is committed when the callback finishes and abandoned if it throws.
import { STORES } from "../schema.js";

export class IdbAdapter {
  /** name: database name; version: bump when the store list changes (the schema_version in the meta store is separate). */
  constructor({ name = "saintpaulia-hybridizer", version = 1, stores = STORES, indexedDB = globalThis.indexedDB } = {}) {
    this.name = name;
    this.version = version;
    this.defs = stores;
    this.idb = indexedDB;
    this.db = null;
  }

  open() {
    if (!this.idb) return Promise.reject(new Error("This browser has no IndexedDB, so the app cannot store anything."));
    return new Promise((resolve, reject) => {
      const req = this.idb.open(this.name, this.version);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const [s, def] of Object.entries(this.defs)) {
          if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: def.keyPath, autoIncrement: !!def.autoIncrement });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        this.db = db;
        db.onversionchange = () => { db.close(); if (this.db === db) this.db = null; };   // another tab upgrading or deleting: let it
        resolve(this);
      };
      req.onerror = () => reject(req.error || new Error("Could not open the database."));
      req.onblocked = () => reject(new Error("The database is open in another tab at an older version. Close the other tabs and reload."));
    });
  }

  close() { if (this.db) { this.db.close(); this.db = null; } }

  static deleteDatabase(name, indexedDB = globalThis.indexedDB) {
    return new Promise((resolve, reject) => {
      const r = indexedDB.deleteDatabase(name);
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
      r.onblocked = () => resolve();
    });
  }

  tx(names, mode, fn) {
    return new Promise((resolve, reject) => {
      if (!this.db) return reject(new Error("The database is not open."));
      let t;
      try { t = this.db.transaction(names, mode === "readwrite" ? "readwrite" : "readonly", mode === "readwrite" ? { durability: "strict" } : undefined); }
      catch (err) { return reject(err); }
      const ask = (make) => new Promise((res, rej) => { const r = make(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
      const os = (s) => t.objectStore(s);
      const api = {
        get: (s, key) => ask(() => os(s).get(key)),
        getAll: (s) => ask(() => os(s).getAll()),
        count: (s) => ask(() => os(s).count()),
        put: (s, value) => ask(() => os(s).put(value)),
        del: (s, key) => ask(() => os(s).delete(key)),
      };
      let result, failed = false;
      t.oncomplete = () => resolve(result);
      t.onabort = () => reject(t.error || new Error("The transaction was cancelled."));
      t.onerror = () => { /* the abort handler reports it */ };
      Promise.resolve().then(() => fn(api)).then((r) => { result = r; }, (err) => {
        failed = true;
        try { t.abort(); } catch (_) { /* already finished */ }
        reject(err);
      });
    });
  }
}
