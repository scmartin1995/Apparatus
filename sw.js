// ── APPARATUS SERVICE WORKER ───────────────────────────────
// No manual path config needed. Paths auto-derived from SW scope.
const CACHE_NAME = 'apparatus-v11';

// The icon and text fonts come from Google. Without them cached, every icon
// renders as its text name offline.
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

// Reads the stylesheet links out of index.html (so they are listed in one
// place) and caches each stylesheet plus the font files it points to.
async function cacheFonts(cache, base) {
  const html = await (await fetch(base + 'index.html')).text();
  const sheets = (html.match(/https:\/\/fonts\.googleapis\.com\/[^"']+/g) || [])
    .map(u => u.replace(/&amp;/g, '&'));
  await Promise.allSettled(sheets.map(async sheet => {
    const res = await fetch(sheet);
    if (!res.ok) return;
    const css = await res.clone().text();
    await cache.put(sheet, res);
    const files = [...new Set(css.match(/https:\/\/fonts\.gstatic\.com\/[^)'"\s]+/g) || [])];
    await Promise.allSettled(files.map(u => cache.add(u)));
  }));
}

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
      try { await cacheFonts(cache, base); } catch (e) {}
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

  if (request.method !== 'GET') return;

  // Fonts — cache-first, and keep whatever the page ends up fetching
  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.match(request, { ignoreVary: true }).then(cached => {
        if (cached) return cached;
        return fetch(request).then(res => {
          if (res.ok || res.type === 'opaque') {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          }
          return res;
        });
      })
    );
    return;
  }

  // Skip any other cross-origin request
  if (url.origin !== self.location.origin) return;

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
