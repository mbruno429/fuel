// Service worker: lets the app open with no connection.
//
// Strategy: try the network first so an update you push to GitHub shows up on
// the next launch, and fall back to the saved copy when offline or slow.
// Requests skip the browser's own short-term cache (GitHub Pages lets browsers
// keep files for 10 minutes), so a new version is never mixed with an old one.
// Bump VERSION if you ever need to force every saved file to be thrown away.

const VERSION = 'fuel-v2';
const TIMEOUT_MS = 3000;

const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/allergens.js',
  './js/app.js',
  './js/chart.js',
  './js/config.js',
  './js/core.js',
  './js/foods.js',
  './js/grocery.js',
  './js/meals.js',
  './js/store.js',
  './data/groceries.json',
  './fonts/ArchivoBlack-Regular.ttf',
  './icons/favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(FILES.map((file) => new Request(file, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name !== VERSION).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

function fetchWithTimeout(request) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS);
    // 'no-cache' asks GitHub whether the file changed; an unchanged file costs a tiny reply.
    fetch(request, { cache: 'no-cache' }).then(
      (response) => {
        clearTimeout(timer);
        resolve(response);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  // The calendar file goes straight to the network so the phone's own
  // "add to calendar" handling sees an ordinary download.
  if (url.pathname.endsWith('.ics')) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(VERSION);
      try {
        const response = await fetchWithTimeout(request);
        if (response.ok) cache.put(request, response.clone());
        return response;
      } catch (error) {
        const saved = (await cache.match(request, { ignoreSearch: true }))
          || (request.mode === 'navigate' ? await cache.match('./index.html') : null);
        if (saved) return saved;
        throw error;
      }
    })(),
  );
});
