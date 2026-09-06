// Main-thread polyfills for the node test environment.
//
// Zustand `persist` stores read localStorage at creation, so the suite needs a
// stand-in — an in-memory one specifically: `--test-isolation=none` runs every
// test file in one process, so a file-backed store (Node's own built-in, which
// needs `--localstorage-file`) would leak state between runs as well as
// between files. Node 24 defines a `localStorage` global regardless, and it
// throws on every operation unless that flag was passed, so this overwrites it
// rather than filling a gap.
//
// Only stores whose `storage:` resolves through `globalThis` see this — see
// `src/lib/store/persist-storage.ts`. Zustand's `window.localStorage` default
// finds nothing here and silently disables itself.
class MemStorage {
  #m = new Map();
  getItem(k) {
    return this.#m.has(k) ? this.#m.get(k) : null;
  }
  setItem(k, v) {
    this.#m.set(k, String(v));
  }
  removeItem(k) {
    this.#m.delete(k);
  }
  clear() {
    this.#m.clear();
  }
  key(i) {
    return [...this.#m.keys()][i] ?? null;
  }
  get length() {
    return this.#m.size;
  }
}

Object.defineProperty(globalThis, "localStorage", {
  value: new MemStorage(),
  configurable: true,
  writable: true,
});
