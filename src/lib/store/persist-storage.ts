import { createJSONStorage } from "zustand/middleware";
import type { PersistStorage } from "zustand/middleware";

/**
 * `persist`'s localStorage backing, resolved through `globalThis` rather than
 * `window`.
 *
 * Zustand's default is `createJSONStorage(() => window.localStorage)`, which is
 * identical in the browser but finds no `window` at all under `node --test` —
 * where `createJSONStorage` swallows the error and silently disables
 * persistence. A store configured with this instead is therefore the only kind
 * whose rehydrate round trip the offline suite can exercise for real (see
 * `test/polyfill.mjs`, which installs the in-memory stand-in on `globalThis`).
 *
 * Returns `undefined` when there is no usable storage at all — server-side
 * rendering, mainly — which `persist` degrades on gracefully rather than
 * throwing out of a `set`.
 */
export function localStoragePersist<T>(): PersistStorage<T> | undefined {
  return createJSONStorage<T>(() => globalThis.localStorage);
}
