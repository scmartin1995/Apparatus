// ── APPARATUS SERVICE WORKER ───────────────────────────────
// No manual path config needed. Paths auto-derived from SW scope.
const CACHE_NAME = 'apparatus-v27';

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

// Fonts ship with the app (fonts/), so they're cached with the shell and
// nothing is ever requested from Google.
const FONT_FILES = [
  'fonts/fonts.css',
  'fonts/inter-latin.woff2', 'fonts/inter-latin-ext.woff2',
  'fonts/inter-cyrillic.woff2', 'fonts/inter-cyrillic-ext.woff2',
  'fonts/inter-greek.woff2', 'fonts/inter-greek-ext.woff2',
  'fonts/inter-vietnamese.woff2',
  'fonts/lexend-latin.woff2', 'fonts/lexend-latin-ext.woff2', 'fonts/lexend-vietnamese.woff2',
  'fonts/material-symbols-outlined.woff2',
];

// Small files this version can't run without (see install). The font files
// themselves are not required: if one misses, the fetch handler below caches
// it the next time the app is online, as Google's fonts were before.
const REQUIRED = ['', 'index.html', 'fonts/fonts.css'];

// Longest wait for one shell file. The icon font is about 1.1 MB.
const DOWNLOAD_LIMIT_MS = 120000;

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
        base + 'favicon.svg',
        base + 'favicon-32.png',
        base + 'apple-touch-icon.png',
        ...FONT_FILES.map(f => base + f),
      ];
      // A cache of this name from before (sw.js changed without a CACHE_NAME
      // bump) may be the live one, so a failed install must leave it alone.
      const existed = await caches.has(CACHE_NAME);
      const cache = await caches.open(CACHE_NAME);
      const fresh = new Set();
      // Cache individually — don't let one missing icon abort install
      // Fetch past the HTTP cache so a new worker never stores the old shell.
      // Each file is bounded (download and cache write together) so a stalled
      // download can't hold up an update. The abort stops a timed-out download
      // from finishing later and writing into this cache.
      await Promise.allSettled(shell.map(async url => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), DOWNLOAD_LIMIT_MS);
        try {
          const res = await fetch(url, { cache: 'no-cache', signal: ctrl.signal });
          if (res.ok) { await cache.put(url, res); fresh.add(url); }
        } finally {
          clearTimeout(timer);
        }
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
      // These must be this version's own copies: an older index.html (or font
      // stylesheet) paired with this version's fonts would leave the icons
      // broken offline. If one couldn't be downloaded, fail the install so the
      // current version stays in charge; the next update check tries again.
      // A half-filled new cache is removed so the old version never reads it.
      for (const url of REQUIRED.map(f => base + f)) {
        if (!fresh.has(url)) {
          if (!existed) await caches.delete(CACHE_NAME).catch(() => {});
          throw new Error('update incomplete: ' + url);
        }
      }
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
