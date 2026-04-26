/* ═══════════════════════════════════════════
   Ludo Classic Edition — Service Worker v1
   Cache naam badlo jab bhi game update karo
═══════════════════════════════════════════ */
const CACHE_NAME = 'ludo-classic-v1';

const PRECACHE_URLS = [
  './',
  './ludo_v8_fixed.html',
  './ludo_manifest.json',
  './ludo_icon.svg',
  // Google Fonts
  'https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700;900&family=Share+Tech+Mono&family=Tiro+Devanagari+Hindi:ital@0;1&family=Cinzel+Decorative:wght@700&family=Poppins:wght@400;600;700;800;900&display=swap',
  // Tone.js (audio library)
  'https://cdnjs.cloudflare.com/ajax/libs/tone/14.8.49/Tone.js',
];

const CACHE_FIRST_ORIGINS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdnjs.cloudflare.com',
];

/* ─── Install ─── */
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        // Har URL alag try karo — ek fail ho to baki cache ho jaye
        return Promise.allSettled(
          PRECACHE_URLS.map(url => cache.add(url).catch(e => console.warn('Cache miss:', url, e)))
        );
      })
      .then(() => self.skipWaiting())
  );
});

/* ─── Activate ─── */
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* ─── Fetch ─── */
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Firebase real-time DB — kabhi cache mat karo (live multiplayer data)
  if (url.hostname.includes('firebaseio.com') || url.hostname.includes('firebase')) {
    return; // network pe hi jaane do
  }

  // Baaki sab: cache-first
  const shouldCache =
    url.origin === self.location.origin ||
    CACHE_FIRST_ORIGINS.some(origin => url.hostname.includes(origin));

  if (shouldCache) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;

        return fetch(event.request).then(response => {
          if (!response || response.status !== 200 || response.type === 'opaque') {
            return response;
          }
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        }).catch(() => caches.match('./ludo_v8_fixed.html'));
      })
    );
  }
});
