// Main-thread polyfills for the node test environment. Zustand `persist` stores
// read localStorage at creation; provide an in-memory stand-in.
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

// Node 24 ships a built-in `localStorage` global, but it throws (and zustand's
// persist middleware then disables itself) unless the process was started with
// `--localstorage-file`. Probing it is the only way to tell the two apart, so
// install the in-memory stand-in whenever the real one can't be written to.
function localStorageWorks() {
  try {
    const ls = globalThis.localStorage;
    if (!ls) return false;
    ls.setItem("__probe__", "1");
    ls.removeItem("__probe__");
    return true;
  } catch {
    return false;
  }
}

if (!localStorageWorks()) {
  Object.defineProperty(globalThis, "localStorage", {
    value: new MemStorage(),
    configurable: true,
    writable: true,
  });
}
