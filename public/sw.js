/* TradingView Free — minimal offline shell service worker.
 *
 * Strategy:
 *  - On install, pre-cache the app shell (`/`, manifest, logo).
 *  - On fetch:
 *      • Network-first for navigations and same-origin static assets.
 *        Falls back to the cached shell when offline.
 *      • Never cache API routes (they need fresh data).
 *  - Skip caching POST/non-GET requests and cross-origin requests.
 */
const CACHE = "tvf-shell-v2";
const SHELL = ["/", "/manifest.webmanifest", "/logo.svg", "/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL).catch(() => {})),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Never cache API responses.
  if (url.pathname.startsWith("/api/")) return;

  event.respondWith(
    (async () => {
      try {
        const fresh = await fetch(req);
        if (fresh.ok && req.mode === "navigate") {
          const cache = await caches.open(CACHE);
          cache.put(req, fresh.clone()).catch(() => {});
        }
        return fresh;
      } catch {
        const cached = await caches.match(req);
        if (cached) return cached;
        if (req.mode === "navigate") {
          const shell = await caches.match("/");
          if (shell) return shell;
        }
        throw new Error("Offline and not cached");
      }
    })(),
  );
});
