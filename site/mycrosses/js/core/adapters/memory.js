// In-memory storage with the same interface as the IndexedDB adapter. Used by the Node tests (Node has no IndexedDB) and as the
// reference for what a transaction must do: all of its writes happen, or none of them.
//
// Interface (both adapters):
//   await adapter.open()
//   await adapter.tx(storeNames, "readonly" | "readwrite", async (t) => result)
//     t.get(store, key) -> value | undefined      t.getAll(store) -> array      t.put(store, value) -> key
//     t.del(store, key)                           t.count(store) -> number
//   If the callback throws, nothing it wrote is kept. Inside the callback await ONLY t.* calls (IndexedDB ends a transaction at the
//   first wait on anything else).
import { STORES } from "../schema.js";

const clone = (v) => (v === undefined ? undefined : structuredClone(v));

export class MemoryAdapter {
  constructor(stores = STORES) {
    this.defs = stores;
    this.data = new Map(Object.keys(stores).map((s) => [s, new Map()]));
    this.counters = new Map(Object.keys(stores).map((s) => [s, 0]));
    this._queue = Promise.resolve();
  }

  async open() { return this; }
  async close() { /* nothing to release */ }

  tx(names, mode, fn) {
    const run = async () => {
      for (const n of names) if (!this.data.has(n)) throw new Error("unknown store " + n);
      const writable = mode === "readwrite";
      const saved = writable ? names.map((n) => [n, new Map([...this.data.get(n)].map(([k, v]) => [k, clone(v)])), this.counters.get(n)]) : null;
      const check = (s) => { if (!names.includes(s)) throw new Error(`store ${s} is not part of this transaction`); return this.data.get(s); };
      const t = {
        get: async (s, key) => clone(check(s).get(key)),
        getAll: async (s) => [...check(s).values()].map(clone),
        count: async (s) => check(s).size,
        put: async (s, value) => {
          if (!writable) throw new Error("read-only transaction");
          const def = this.defs[s];
          const m = check(s);
          let v = clone(value);
          if (def.autoIncrement && v[def.keyPath] === undefined) { const n = this.counters.get(s) + 1; this.counters.set(s, n); v[def.keyPath] = n; }
          if (v[def.keyPath] === undefined) throw new Error(`missing key ${def.keyPath} for store ${s}`);
          m.set(v[def.keyPath], v);
          return v[def.keyPath];
        },
        del: async (s, key) => { if (!writable) throw new Error("read-only transaction"); check(s).delete(key); },
      };
      try {
        return await fn(t);
      } catch (err) {
        if (saved) for (const [n, snap, counter] of saved) { this.data.set(n, snap); this.counters.set(n, counter); }
        throw err;
      }
    };
    const p = this._queue.then(run, run);
    this._queue = p.catch(() => {});
    return p;
  }
}
