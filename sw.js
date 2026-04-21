// ── APPARATUS SERVICE WORKER ───────────────────────────────
// No manual path config needed. Paths auto-derived from SW scope.
const CACHE_NAME = 'apparatus-v1';

// ── INSTALL ────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    (async () => {
      const base  = new URL('./', self.location).pathname; // e.g. /MyRepo/
      const shell = [
        base,
        base + 'index.html',
        base + 'manifest.json',
        base + 'icon-192.png',
        base + 'icon-512.png',
      ];
      const cache = await caches.open(CACHE_NAME);
      // Cache individually — don't let one missing icon abort install
      await Promise.allSettled(shell.map(url => cache.add(url)));
      await self.skipWaiting();
    })()
  );
});

// ── ACTIVATE ───────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── FETCH ──────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin (fonts, CDN, etc.)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  // Navigation requests (home screen launch, page reload)
  // Critical fix: always try network first, fall back to cached index.html
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          return res;
        })
        .catch(async () => {
          const base = new URL('./', self.location).pathname;
          return (
            await caches.match(request) ||
            await caches.match(base + 'index.html') ||
            await caches.match(base) ||
            Response.error()
          );
        })
    );
    return;
  }

  // All other same-origin requests — cache-first
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        }
        return res;
      });
    })
  );
});
