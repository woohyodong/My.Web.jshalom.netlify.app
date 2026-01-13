const CACHE_NAME = "jshalom-app-v260113.37";
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
  "/data/bible_db.json"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.map(k => (k === CACHE_NAME ? null : caches.delete(k)))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE_NAME).then((c) => c.put(e.request, copy));
      return res;
    }))
  );
});
