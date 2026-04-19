// ── APPARATUS SERVICE WORKER ───────────────────────────────
// NOTE: Update REPO_PATH to match your GitHub Pages repo name
// e.g. if deployed at github.com/user/MyApp → '/MyApp'
const REPO_PATH  = '/YOUR-REPO-NAME';
const CACHE_NAME = 'apparatus-v1';

const SHELL = [
  REPO_PATH + '/',
  REPO_PATH + '/index.html',
  REPO_PATH + '/manifest.json',
  REPO_PATH + '/icon-192.png',
  REPO_PATH + '/icon-512.png',
];

const NETWORK_FIRST = [
  REPO_PATH + '/index.html',
  REPO_PATH + '/',
];

// ── INSTALL ────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE ───────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH ──────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  const isShell = NETWORK_FIRST.some(p => url.pathname === p || url.pathname === p.replace(/\/$/, ''));

  if (isShell) {
    // Network-first: always try to pull fresh shell, fall back to cache
    event.respondWith(
      fetch(event.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
  } else {
    // Cache-first for assets (icons, fonts, etc.)
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          }
          return res;
        });
      })
    );
  }
});
