const CACHE_NAME = "panshi-v4-study-2026-07-21-4";
const SHELL_PATHS = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/study-release.json",
  "/icons/panshi-world-192.png",
  "/icons/panshi-world-512.png",
  "/art/v4/layers/opening-hall-empty-v1.webp",
  "/art/v4/layers/resident-atlas-alpha-v1.webp",
];

async function cacheApplicationShell() {
  const cache = await caches.open(CACHE_NAME);
  await cache.addAll(SHELL_PATHS);

  const indexResponse = await fetch("/index.html", { cache: "no-store" });
  const indexText = await indexResponse.text();
  const entryPaths = [...indexText.matchAll(/(?:src|href)="(\/[^\"]+)"/g)].map((match) => match[1]);
  await cache.addAll(entryPaths);
}

self.addEventListener("install", (event) => {
  event.waitUntil(cacheApplicationShell());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request, { cache: "no-store" })
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE_NAME).then((cache) => cache.put("/index.html", copy));
          }
          return response;
        })
        .catch(async () => (await caches.match("/index.html")) ?? Response.error()),
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => Response.error());
    }),
  );
});
