// Service worker: makes the app open instantly and work offline.
// Bump VERSION (and APP_VERSION in js/app.js) whenever app files change.

const VERSION = 'v22';
const APP_CACHE = `app-${VERSION}`;
const OCR_CACHE = 'ocr-tesseract-7.0.0';

const APP_FILES = [
  './',
  './index.html',
  './css/styles.css',
  './css/skins.css',
  './js/app.js',
  './js/camera.js',
  './js/currencies.js',
  './js/format.js',
  './js/language.js',
  './js/location.js',
  './js/timezones.js',
  './js/layout.js',
  './js/ocr.js',
  './js/price-parser.js',
  './js/rates.js',
  './js/scan.js',
  './js/storage.js',
  './js/theme.js',
  './js/translate.js',
  './fonts/share-tech-mono.woff2',
  './fonts/chakra-petch-600.woff2',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './icons/icon-maskable-512.png',
];

// The text reader files are versioned, so once downloaded they never change.
const OCR_FILES = /^https:\/\/cdn\.jsdelivr\.net\/npm\/(tesseract\.js@|tesseract\.js-core@|@tesseract\.js-data\/)/;

self.addEventListener('install', (event) => {
  // cache: 'reload' skips the browser's HTTP cache, so the saved copy is really the new version.
  const requests = APP_FILES.map((url) => new Request(url, { cache: 'reload' }));
  event.waitUntil(caches.open(APP_CACHE).then((cache) => cache.addAll(requests)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([APP_CACHE, OCR_CACHE]);
      const keys = await caches.keys();
      const upgrading = keys.some((key) => key.startsWith('app-') && !keep.has(key));
      for (const key of keys) if (!keep.has(key)) await caches.delete(key);
      await self.clients.claim();
      // An older version is open: reload it so the new one is used straight away.
      if (upgrading) {
        for (const client of await self.clients.matchAll({ type: 'window' })) client.navigate(client.url).catch(() => {});
      }
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
  } else if (OCR_FILES.test(request.url)) {
    event.respondWith(cacheFirst(request));
  }
  // Everything else (exchange rates, translation) goes straight to the network.
});

// Always try the network first (checking with the server, so a new version shows up straight
// away) and fall back to the saved copy when offline or when the connection is very slow.
async function networkFirst(request) {
  const cache = await caches.open(APP_CACHE);
  try {
    const response = await Promise.race([
      fetch(request, { cache: 'no-cache' }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000)),
    ]);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
    return cached || (request.mode === 'navigate' ? cache.match('./index.html') : Response.error());
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(OCR_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
  return response;
}
