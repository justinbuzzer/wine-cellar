// Service worker: lets the installed app open without a connection.
// Generated into dist/sw.js at build time (see vite.config.ts), which fills in
// the version and the list of built files. Only the app's own files and its
// fonts are cached here; your workbook data is never touched by this file
// (the app keeps its own offline copy, see src/offline.ts).

const VERSION = "__VERSION__";
const PRECACHE = __PRECACHE__;
const CACHE = `wine-cellar-${VERSION}`;
const FONTS = "wine-cellar-fonts";
const BASE = new URL("./", self.location).pathname; // "/wine-cellar/"
const SHELL = new URL("./", self.location).href;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(["./", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png", ...PRECACHE]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("wine-cellar-") && k !== CACHE && k !== FONTS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === "https://fonts.googleapis.com" || url.origin === "https://fonts.gstatic.com") {
    event.respondWith(staleWhileRevalidate(req, FONTS));
    return;
  }
  // Everything else outside the app (Microsoft sign-in, Graph) goes straight to the network.
  if (url.origin !== self.location.origin || !url.pathname.startsWith(BASE)) return;

  if (req.mode === "navigate") {
    event.respondWith(page(req));
    return;
  }
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && url.pathname.startsWith(`${BASE}assets/`)) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});

/** The app page: fresh from the network when possible, otherwise the saved copy. */
async function page(req) {
  try {
    const res = await Promise.race([
      fetch(req),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 4000)),
    ]);
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(SHELL, copy));
    }
    return res;
  } catch {
    return (await caches.match(SHELL)) || Response.error();
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const fresh = fetch(req)
    .then((res) => {
      if (res.ok || res.type === "opaque") cache.put(req, res.clone());
      return res;
    })
    .catch(() => hit);
  return hit || fresh;
}
