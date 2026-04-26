/* ═══════════════════════════════════════════
   देसी खेल — Service Worker v3 (Fixed)
═══════════════════════════════════════════ */
const CACHE_NAME = 'desi-khel-v3';

// Sirf ye 3 files guaranteed hain — inhe hi precache karo
const PRECACHE_URLS = [
  './desi_games.html',
  './manifest.json',
  './icon.svg',
];

const FONT_ORIGINS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

/* ─── Install ───────────────────────────────
   PROBLEM THI: cache.addAll() mein agar ek bhi
   URL fail ho (font timeout etc.) to poora SW
   install fail ho jaata tha.
   FIX: Har URL ko alag try karo with catch
──────────────────────────────────────────── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.all(
        PRECACHE_URLS.map(url =>
          cache.add(url).catch(err => {
            console.warn('[SW] Precache miss:', url, err);
          })
        )
      )
    ).then(() => {
      console.log('[SW] Install done, skipping wait');
      return self.skipWaiting();
    })
  );
});

/* ─── Activate ─── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => {
          console.log('[SW] Deleting old cache:', k);
          return caches.delete(k);
        })
      )
    ).then(() => self.clients.claim())
  );
});

/* ─── Fetch ──────────────────────────────────
   Strategy:
   - Game files (same origin) → Cache First
   - Google Fonts CSS + gstatic font files → Cache First
   - Baaki sab → Normal network (intercept mat karo)
──────────────────────────────────────────── */
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  const hostname = url.hostname;

  const isSameOrigin = url.origin === self.location.origin;
  const isFont = FONT_ORIGINS.some(origin => hostname.includes(origin));

  if (!isSameOrigin && !isFont) return;

  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) {
        return cached;
      }

      return fetch(event.request.clone()).then(response => {
        if (!response || response.status !== 200) {
          return response;
        }
        const toCache = response.clone();
        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, toCache);
        });
        return response;
      }).catch(() => {
        return caches.match('./desi_games.html');
      });
    })
  );
});
