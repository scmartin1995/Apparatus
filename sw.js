// ── APPARATUS SERVICE WORKER ───────────────────────────────
// No manual path config needed. Paths auto-derived from SW scope.
const CACHE_NAME = 'apparatus-v18';

// Gives up on a network request after ms, so a dead or crawling connection
// can't stall the app (or a service worker update) indefinitely.
function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}
// Cache writes are best-effort; a full disk must not surface as an error.
function put(request, response) {
  return caches.open(CACHE_NAME).then(cache => cache.put(request, response)).catch(() => {});
}

// The icon and text fonts come from Google. Without them cached, every icon
// renders as its text name offline.
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

// Reads the stylesheet links out of index.html (so they are listed in one
// place) and caches each stylesheet plus the font files it points to.
async function cacheFonts(cache, base) {
  const html = await (await fetch(base + 'index.html', { cache: 'no-cache' })).text();
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
      // Carry the fonts over from the previous version first, so a slow
      // download below can't leave the icons missing offline after an update.
      try {
        for (const key of await caches.keys()) {
          if (key === CACHE_NAME || !key.startsWith('apparatus-')) continue;
          const old = await caches.open(key);
          for (const req of await old.keys()) {
            if (!FONT_HOSTS.includes(new URL(req.url).hostname)) continue;
            const res = await old.match(req);
            if (res) await cache.put(req, res);
          }
        }
      } catch (e) {}
      // Cache individually — don't let one missing icon abort install
      // Fetch past the HTTP cache so a new worker never stores the old shell.
      await Promise.allSettled(shell.map(async url => {
        const res = await fetch(url, { cache: 'no-cache' });
        if (res.ok) await cache.put(url, res);
      }));
      // A file that failed to download keeps the previous version's copy,
      // so the app still opens offline after an update on a bad connection.
      try {
        const olds = (await caches.keys()).filter(k => k !== CACHE_NAME && k.startsWith('apparatus-'));
        for (const url of shell) {
          if (await cache.match(url)) continue;
          for (const key of olds) {
            const prev = await (await caches.open(key)).match(url);
            if (prev && prev.ok) { await cache.put(url, prev); break; }
          }
        }
      } catch (e) {}
      // Bounded: if Google Fonts hangs, install still finishes, so the new
      // version activates instead of leaving people stuck on the old one.
      try { await withTimeout(cacheFonts(cache, base), 10000); } catch (e) {}
      await self.skipWaiting();
    })()
  );
});

// ── ACTIVATE ───────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME && k.startsWith('apparatus-')).map(k => caches.delete(k))
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
          if (res.ok || res.type === 'opaque') put(request, res.clone());
          return res;
        });
      })
    );
    return;
  }

  // Skip any other cross-origin request
  if (url.origin !== self.location.origin) return;

  // Navigation requests (home screen launch, page reload)
  // Network first so a new version shows up on the next launch, but only
  // good responses are cached, and with a cached copy on hand a slow
  // connection (gym Wi-Fi, one bar) falls back to it after 4 seconds
  // instead of leaving a blank screen.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const base = new URL('./', self.location).pathname;
      const cached = async () =>
        await caches.match(request, { ignoreSearch: true }) ||
        await caches.match(base + 'index.html') ||
        await caches.match(base);
      // no-cache: revalidate with the server so GitHub Pages' 10-minute
      // HTTP cache can't hand back yesterday's index.html.
      let saved = Promise.resolve();
      const network = fetch(request, { cache: 'no-cache' }).then(res => {
        if (res.ok) saved = put(request, res.clone());
        return res;
      });
      // Keep the worker alive until the fresh copy is saved, even when the
      // cached copy was already served after the 4-second fallback.
      // (Registered here, before the first await, while the event is active.)
      event.waitUntil(network.then(() => saved, () => {}));
      const fallback = await cached();
      try {
        const res = await (fallback ? withTimeout(network, 4000) : network);
        return (res.ok || !fallback) ? res : fallback;
      } catch (e) {
        network.catch(() => {});
        return fallback || Response.error();
      }
    })());
    return;
  }

  // All other same-origin requests — cache-first
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(res => {
        if (res.ok) put(request, res.clone());
        return res;
      });
    })
  );
});
