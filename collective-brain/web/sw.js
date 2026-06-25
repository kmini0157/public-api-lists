// Minimal service worker: cache the app shell so the PWA opens instantly and
// works offline for capture UI. API/capture calls always go to the network.
const CACHE = "voice-inbox-v1";
const SHELL = ["/", "/index.html", "/app.js", "/style.css", "/manifest.webmanifest", "/icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return; // never cache POST/PATCH/DELETE
  if (/^\/(api|capture|ingest|telegram)\b/.test(url.pathname)) return; // network-only
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
