/* ═══════════════════════════════════════════
   देसी खेल — Service Worker v2
   Version badlane pe CACHE_NAME update karo
═══════════════════════════════════════════ */
const CACHE_NAME = 'desi-khel-v2';

const PRECACHE_URLS = [
  './',
  './desi_games.html',
  './manifest.json',
  './icon.svg',
  'https://fonts.googleapis.com/css2?family=Tiro+Devanagari+Hindi&family=Baloo+2:wght@400;600;700;800&display=swap',
];

const FONT_ORIGINS = ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'];

/* ─── Install: sab kuch cache karo ─── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(PRECACHE_URLS);
    }).then(() => self.skipWaiting())
  );
});

/* ─── Activate: purana cache saaf karo ─── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

/* ─── Fetch: cache-first strategy ─── */
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const isFont = FONT_ORIGINS.some(origin => url.origin === new URL(origin).origin);

  if (isFont || url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;

        return fetch(event.request).then(response => {
          if (!response || response.status !== 200) return response;
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        }).catch(() => caches.match('./desi_games.html'));
      })
    );
  }
});
