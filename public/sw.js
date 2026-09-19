/**
 * renasce — PWA Service Worker & Push Notification Handler
 * Provides offline shell support, receives FCM / Web Push notifications,
 * and handles notification clicks to bring the app to focus.
 */

const CACHE_NAME = 'skin-streak-v1';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/badge-96.png'
];

// Install: Cache essential app shell assets and activate immediately
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS).catch((err) => {
        console.warn('[SW] Pre-caching partial failure:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// Activate: Clean up older cache versions and claim clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch: Stale-while-revalidate for static shell assets, network-first for others
self.addEventListener('fetch', (event) => {
  // Only handle GET requests and skip Supabase API or auth calls
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // If offline and requesting navigation, return cached index
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
          return cachedResponse;
        });

      return cachedResponse || fetchPromise;
    })
  );
});

// Push: Receive incoming real push notifications from FCM / Web Push
self.addEventListener('push', (event) => {
  console.log('[SW] Push event received.');
  let payload = {};

  if (event.data) {
    try {
      payload = event.data.json();
    } catch (e) {
      payload = {
        title: 'renasce ✨',
        body: event.data.text()
      };
    }
  }

  // Handle FCM notification payload structure or flat payload
  const title = payload.title || payload.notification?.title || 'renasce ✨';
  const body = payload.body || payload.notification?.body || 'Time for your skincare check-in!';
  const icon = payload.icon || payload.notification?.icon || '/icons/icon-192.png';
  const badge = payload.badge || '/icons/badge-96.png';
  const tag = payload.tag || 'renasce-nudge';
  const data = payload.data || { url: '/' };

  const options = {
    body,
    icon,
    badge,
    tag,
    renotify: true,
    data,
    vibrate: [100, 50, 100],
    actions: [
      { action: 'open', title: 'Open Log' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// Message event: Allow client to request showing a local test notification
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const { title = 'renasce ✨', body = 'Test notification' } = event.data.payload || {};
    self.registration.showNotification(title, {
      body,
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      tag: 'renasce-test',
      data: { url: '/' },
      vibrate: [100, 50, 100]
    });
  }
});

// Notification Click: Focus existing client or open new tab
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

