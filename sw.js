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

// Fonts ship with the app (fonts/), so nothing is ever requested from Google.
// Each font file name carries a hash of its contents (tools/check-fonts.js
// enforces it), so a file with the same name is the same font in every version.
// That lets an update keep the fonts it already has instead of downloading
// them again. Keep this list in step with fonts/fonts.css.
const FONT_FILES = [
  'fonts/fonts.css',
  'fonts/inter-latin.3100e775.woff2', 'fonts/inter-latin-ext.34b9c504.woff2',
  'fonts/inter-cyrillic.71d5ee93.woff2', 'fonts/inter-cyrillic-ext.ca157063.woff2',
  'fonts/inter-greek.1be3448e.woff2', 'fonts/inter-greek-ext.6e9e020a.woff2',
  'fonts/inter-vietnamese.5c66f9e0.woff2',
  'fonts/lexend-latin.b7e7538f.woff2', 'fonts/lexend-latin-ext.b5d815d4.woff2',
  'fonts/lexend-vietnamese.aab0b318.woff2',
  'fonts/material-symbols-outlined.6cc81722.woff2',
];
const ICON_FONT = FONT_FILES.find(f => f.startsWith('fonts/material-symbols-outlined.'));

// Files an update can't run without (see install). The page and the font
// stylesheet must match each other, and without the icon font every icon shows
// as its text name offline. The text fonts are optional: if one misses, the
// fetch handler below caches it the next time the app is online.
const REQUIRED = ['index.html', 'fonts/fonts.css', ICON_FONT];

// Longest wait for one download. The icon font is about 1.1 MB, and the first
// update downloads it alongside the rest of the app.
const DOWNLOAD_LIMIT_MS = 240000;

// Install collects files here and copies them into CACHE_NAME only once every
// required file is in, so a failed update never half-fills a version's cache.
// Hashed font files a failed attempt finished are kept here for the next
// attempt, so a slow connection resumes instead of starting over.
const STAGING = CACHE_NAME + '-staging';

// A font file that is safe to reuse from another cache: hashed, so the name
// fixes the contents. fonts.css is not hashed and is always downloaded fresh.
const isHashedFont = path => /\/fonts\/(?:[^/]+\/)*[^/]+\.[0-9a-f]{8}\.woff2$/.test(path);

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
      const pathOf = req => new URL(req.url).pathname;
      const staging = await caches.open(STAGING);
      const ready = new Set();
      // Keep only hashed font files from an earlier attempt of this version.
      for (const req of await staging.keys()) {
        if (isHashedFont(pathOf(req)) && shell.includes(pathOf(req))) ready.add(pathOf(req));
        else await staging.delete(req);
      }
      // Reuse hashed font files any earlier version already has. Best effort:
      // anything not reused is downloaded below.
      const olds = (await caches.keys()).filter(k => k !== CACHE_NAME && k !== STAGING && k.startsWith('apparatus-'));
      try {
        for (const url of shell) {
          if (!isHashedFont(url) || ready.has(url)) continue;
          for (const key of olds) {
            const prev = await (await caches.open(key)).match(url);
            if (prev && prev.ok) { await staging.put(url, prev); ready.add(url); break; }
          }
        }
      } catch (e) {}
      // Download the rest. Fetch past the HTTP cache so a new worker never
      // stores the old shell. Each download is bounded, and a timed-out one is
      // aborted so it can't finish later. One failure doesn't stop the others.
      await Promise.allSettled(shell.filter(url => !ready.has(url)).map(async url => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), DOWNLOAD_LIMIT_MS);
        try {
          const res = await fetch(url, { cache: 'no-cache', signal: ctrl.signal });
          if (res.ok) { await staging.put(url, res); ready.add(url); }
        } finally {
          clearTimeout(timer);
        }
      }));
      // On a first install there is no earlier version to fall back to, so
      // keep whatever arrived, even if storage fills up partway; the fetch
      // handler fills gaps when online.
      const updating = !!self.registration.active;
      let created = false;
      try {
        // An update must have this version's own copies of these. If one is
        // missing, fail the install so the current version stays in charge;
        // the next update check tries again.
        if (updating) {
          for (const url of REQUIRED.map(f => base + f)) {
            if (!ready.has(url)) throw new Error('update incomplete: ' + url);
          }
        }
        // The bare folder address opens the same page as index.html.
        if (!ready.has(base)) {
          const page = await staging.match(base + 'index.html');
          if (page) await staging.put(base, page);
        }
        // An icon or manifest that failed to download keeps the previous
        // version's copy. fonts.css is never carried over: an older stylesheet
        // could name font files this version doesn't have.
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
        if (!updating) {
          // First install: keep what was copied and finish installing.
          await caches.delete(STAGING).catch(() => {});
          await self.skipWaiting();
          return;
        }
        // A copy cut short (storage full) must not leave a half-filled cache.
        if (created) await caches.delete(CACHE_NAME).catch(() => {});
        // Keep only the finished hashed font files for the next attempt.
        try {
          for (const req of await staging.keys()) {
            if (!isHashedFont(pathOf(req))) await staging.delete(req);
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
      // Only this version's cache: an update in progress keeps its new files
      // in the staging cache, and those must not reach a page yet.
      const cached = async () => {
        try {
          const cache = await caches.open(CACHE_NAME);
          return await cache.match(request, { ignoreSearch: true }) ||
            await cache.match(base + 'index.html') ||
            await cache.match(base);
        } catch (e) {
          return undefined;
        }
      };
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

  // All other same-origin requests — cache-first, from this version's own
  // cache only, so files another version left behind are never mixed in.
  event.respondWith(
    caches.open(CACHE_NAME).then(cache => cache.match(request)).catch(() => undefined).then(cached => {
      if (cached) return cached;
      return fetch(request).then(res => {
        if (res.ok) put(request, res.clone());
        return res;
      });
    })
  );
});
