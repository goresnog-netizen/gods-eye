/*
 * God's Eye View — service worker.
 *
 * The globe cannot work offline: its imagery and terrain are tiles from a
 * provider, and pretending otherwise would show an empty planet. What CAN work
 * offline is the shell and the local layer, so that is exactly what is cached:
 *
 *   - the application shell, so the app opens without a network
 *   - the /api/godseye/* answers, which are computed on this machine anyway
 *   - same-origin static assets, refreshed in the background
 *
 * Every cross-origin request (tiles, imagery, any provider) is passed straight
 * through and never cached, so a stale tile can never be served as current.
 */

const VERSION = 'gev-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const LOCAL_CACHE = `${VERSION}-local`;

const SHELL_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // One missing icon must not fail the whole install.
      Promise.all(
        SHELL_FILES.map((file) =>
          cache.add(file).catch(() => undefined),
        ),
      ),
    ),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !key.startsWith(VERSION))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

/** Network first, cache as the fallback: local answers stay current online. */
async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

/** Cache first, then refresh in the background: assets are content-hashed. */
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);
  return cached || network || fetch(request);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // A tile from a provider is never served from here.
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/godseye/')) {
    event.respondWith(networkFirst(request, LOCAL_CACHE));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      networkFirst(request, SHELL_CACHE).catch(async () => {
        const cache = await caches.open(SHELL_CACHE);
        return (await cache.match('./index.html')) || (await cache.match('./'));
      }),
    );
    return;
  }

  if (['script', 'style', 'image', 'font', 'worker'].includes(request.destination)) {
    event.respondWith(staleWhileRevalidate(request, SHELL_CACHE));
  }
});
