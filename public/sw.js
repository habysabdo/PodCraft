/* PodCraft service worker — makes the web app installable (PWA) so it can ask
 * "Download the app?" on open. It caches ONLY hashed Vite assets (/assets/*);
 * HTML, the manifest, icons and API calls always go to the network, so a new
 * deploy is never shadowed by a stale cache. */
const CACHE = 'podcraft-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  // Hashed Vite assets: cache-first.
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE);
        const hit = await cache.match(event.request);
        if (hit) return hit;
        const res = await fetch(event.request);
        if (res.ok) cache.put(event.request, res.clone());
        return res;
      })(),
    );
    return;
  }
  // Everything else (HTML, manifest, icons, API): network, no caching.
  event.respondWith(fetch(event.request));
});
