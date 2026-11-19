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

// Files this version can't run without (see install). The page and the font
// stylesheet must match each other, and without the icon font every icon shows
// as its text name offline. The text fonts are optional: if one misses, the
// fetch handler below caches it the next time the app is online.
const REQUIRED = ['index.html', 'fonts/fonts.css', 'fonts/material-symbols-outlined.woff2'];

// Longest wait for one file. The icon font is about 1.1 MB, which takes about
// 150 s at 60 kbit/s.
const DOWNLOAD_LIMIT_MS = 240000;

// Install downloads into this cache first and copies into CACHE_NAME only once
// every required file arrived, so a failed or interrupted install never leaves
// a mixed set of files where any version can read them. Font files that a
// failed attempt finished downloading are kept here for the next attempt, so a
// slow connection gets closer each time instead of starting over.
const STAGING = CACHE_NAME + '-staging';

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
      const staging = await caches.open(STAGING);
      const fresh = new Set();
      // Keep only the font files from an earlier attempt of this version (they
      // change only with a CACHE_NAME bump); everything else is fetched again.
      for (const req of await staging.keys()) {
        if (new URL(req.url).pathname.startsWith(base + 'fonts/') && (await staging.match(req))) {
          fresh.add(new URL(req.url).pathname);
        } else {
          await staging.delete(req);
        }
      }
      // Cache individually — don't let one missing icon abort install
      // Fetch past the HTTP cache so a new worker never stores the old shell.
      // Each file is bounded (download and cache write together), and a
      // timed-out download is aborted so it can't finish later.
      await Promise.allSettled(shell.filter(url => !fresh.has(url)).map(async url => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), DOWNLOAD_LIMIT_MS);
        try {
          const res = await fetch(url, { cache: 'no-cache', signal: ctrl.signal });
          if (res.ok) { await staging.put(url, res); fresh.add(url); }
        } finally {
          clearTimeout(timer);
        }
      }));
      let created = false;
      try {
        // These must be this version's own copies. If one couldn't be
        // downloaded, fail the install so the current version stays in
        // charge; the next update check tries again.
        for (const url of REQUIRED.map(f => base + f)) {
          if (!fresh.has(url)) throw new Error('update incomplete: ' + url);
        }
        // The bare folder address opens the same page as index.html.
        if (!fresh.has(base)) await staging.put(base, await staging.match(base + 'index.html'));
        // An icon or manifest that failed to download keeps the previous
        // version's copy. Fonts are never carried over: an older font file
        // with this version's stylesheet could lack new icons.
        const olds = (await caches.keys()).filter(k => k !== CACHE_NAME && k !== STAGING && k.startsWith('apparatus-'));
        for (const url of shell) {
          if (url.startsWith(base + 'fonts/') || await staging.match(url)) continue;
          for (const key of olds) {
            const prev = await (await caches.open(key)).match(url);
            if (prev && prev.ok) { await staging.put(url, prev); break; }
          }
        }
        created = !(await caches.has(CACHE_NAME));
        const cache = await caches.open(CACHE_NAME);
        for (const req of await staging.keys()) await cache.put(req, await staging.match(req));
      } catch (e) {
        // A copy cut short (storage full) must not leave a half-filled cache.
        if (created) await caches.delete(CACHE_NAME).catch(() => {});
        // Keep only the finished font files for the next attempt.
        try {
          for (const req of await staging.keys()) {
            if (!new URL(req.url).pathname.startsWith(base + 'fonts/')) await staging.delete(req);
          }
        } catch (e2) {}
        throw e;
      }
      await caches.delete(STAGING).catch(() => {});
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
