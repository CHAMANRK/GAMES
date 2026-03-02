// ══════════════════════════════════════
//   Money Manager v3.0 — Service Worker
// ══════════════════════════════════════

const CACHE_NAME = 'money-manager-v3';
const STATIC_CACHE = 'mm-static-v3';

// Files to cache on install
const PRECACHE_URLS = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json',
  './logo.svg',
  'https://fonts.googleapis.com/icon?family=Material+Icons+Round',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js'
];

// ── Install: Precache static assets ──
self.addEventListener('install', function(event) {
  console.log('[SW] Installing Money Manager Service Worker...');
  event.waitUntil(
    caches.open(STATIC_CACHE).then(function(cache) {
      console.log('[SW] Precaching static files');
      // Cache local files strictly, external ones with ignoreSearch
      return Promise.allSettled(
        PRECACHE_URLS.map(url => cache.add(url).catch(err => {
          console.warn('[SW] Failed to cache:', url, err.message);
        }))
      );
    }).then(function() {
      console.log('[SW] ✅ Install complete');
      return self.skipWaiting();
    })
  );
});

// ── Activate: Clean old caches ──
self.addEventListener('activate', function(event) {
  console.log('[SW] Activating...');
  event.waitUntil(
    caches.keys().then(function(cacheNames) {
      return Promise.all(
        cacheNames
          .filter(name => name !== STATIC_CACHE && name !== CACHE_NAME)
          .map(name => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(function() {
      console.log('[SW] ✅ Activated & old caches cleared');
      return self.clients.claim();
    })
  );
});

// ── Fetch: Cache-first for static, network-first for API ──
self.addEventListener('fetch', function(event) {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip Firebase / Google Auth requests — always network
  if (
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('firebase.googleapis.com') ||
    url.hostname.includes('identitytoolkit.googleapis.com') ||
    url.hostname.includes('securetoken.googleapis.com') ||
    url.hostname.includes('firebaseapp.com')
  ) {
    return;
  }

  // Strategy: Cache-first, then network fallback
  event.respondWith(
    caches.match(event.request).then(function(cachedResponse) {
      if (cachedResponse) {
        // Serve from cache & update in background
        const fetchPromise = fetch(event.request)
          .then(function(networkResponse) {
            if (networkResponse && networkResponse.status === 200) {
              const responseToCache = networkResponse.clone();
              caches.open(STATIC_CACHE).then(cache => {
                cache.put(event.request, responseToCache);
              });
            }
            return networkResponse;
          })
          .catch(() => {}); // Silent fail — we already have cache
        
        return cachedResponse;
      }

      // Not in cache — fetch from network & cache it
      return fetch(event.request)
        .then(function(response) {
          if (!response || response.status !== 200 || response.type === 'opaque') {
            return response;
          }
          const responseToCache = response.clone();
          caches.open(STATIC_CACHE).then(function(cache) {
            cache.put(event.request, responseToCache);
          });
          return response;
        })
        .catch(function() {
          // Offline fallback for HTML pages
          if (event.request.destination === 'document') {
            return caches.match('./index.html');
          }
        });
    })
  );
});

// ── Push Notifications (budget alerts etc.) ──
self.addEventListener('push', function(event) {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch(e) {
    data = { title: 'Money Manager', body: event.data ? event.data.text() : 'New notification' };
  }

  const options = {
    body: data.body || 'Aapka budget alert hai!',
    icon: './logo-192.png',
    badge: './logo-192.png',
    vibrate: [200, 100, 200],
    data: data.url ? { url: data.url } : {},
    actions: [
      { action: 'open', title: '📊 Open App', icon: './logo-192.png' },
      { action: 'dismiss', title: '✕ Dismiss' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title || '💰 Money Manager', options)
  );
});

// ── Notification click handler ──
self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  if (event.action === 'dismiss') return;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (const client of clientList) {
        if (client.url.includes('index.html') && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow('./index.html');
      }
    })
  );
});

// ── Background Sync (optional, for offline transactions) ──
self.addEventListener('sync', function(event) {
  if (event.tag === 'sync-transactions') {
    console.log('[SW] Background sync: transactions');
    // Firebase real-time db handles this automatically
    // This is a placeholder for future offline queue support
  }
});

console.log('[SW] 💰 Money Manager Service Worker loaded ✅');
