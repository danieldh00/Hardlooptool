// App-shell-cache: de app zelf werkt daarmee volledig offline. /api/* wordt
// nooit gecachet; data en synchronisatie regelt js/storage.js + js/api.js.
// __CACHE_VERSION__ vervangt de server door een hash van de app-shell
// (zie server.js), zodat elke deploy automatisch een nieuwe cache oplevert.
const CACHE_NAME = 'hardlopen-shell-__CACHE_VERSION__';
const SHELL_FILES = [
  './',
  './index.html',
  './css/style.css',
  './js/workout.js',
  './js/storage.js',
  './js/api.js',
  './js/audio.js',
  './js/runner.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './icons/favicon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Netwerk eerst (zodat een update meteen doorkomt), cache als terugval
// zodra er geen bereik is.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.includes('/api/')) return;
  event.respondWith(
    fetch(event.request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(event.request, { ignoreSearch: true }).then((hit) => hit || (event.request.mode === 'navigate' ? caches.match('./index.html') : undefined))
      )
  );
});
