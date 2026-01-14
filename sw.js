const CACHE_NAME = "jshalom-app";
const CORE = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/favicon.ico",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/favicon-32x32.png",
  "/icons/apple-touch-icon.png",
  "/memorize/",
  "/memorize/index.html",
  "/memorize/app.js",
  "/memorize/data.json",
  "/bible-read/",
  "/bible-read/index.html",
  "/bible-read/app.js",
  "/bible-read/data.json",
  "/js/confetti.browser.min.js",
  "/js/site.js",
  "/data/bible_db.json"
];

const IS_LOCAL =
  self.location.hostname === "localhost" ||
  self.location.hostname === "127.0.0.1";

/* install */
self.addEventListener("install", (e) => {
  if (IS_LOCAL) return;
  e.waitUntil(
    caches.open(CACHE_NAME).then((c) => c.addAll(CORE))
      .then(() => self.skipWaiting())
  );
});

/* activate */
self.addEventListener("activate", (e) => {
  if (IS_LOCAL) return;
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => (k === CACHE_NAME ? null : caches.delete(k))))
    ).then(() => self.clients.claim())
  );
});

/* fetch */
self.addEventListener("fetch", (e) => {
  if (IS_LOCAL) return; // 🔑 localhost는 완전 패스

  const req = e.request;

  // HTML / JS / JSON → network-first
  if (
    req.mode === "navigate" ||
    req.destination === "script" ||
    req.destination === "document" ||
    req.destination === "style" ||
    req.url.endsWith(".json")
  ) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // 나머지(이미지 등) → cache-first
  e.respondWith(
    caches.match(req).then(cached =>
      cached || fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(req, copy));
        return res;
      })
    )
  );
});
