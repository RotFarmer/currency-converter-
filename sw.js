// Service worker: makes the app open instantly and work offline.
// Bump VERSION whenever app files change so phones pick up the new version.

const VERSION = 'v2';
const APP_CACHE = `app-${VERSION}`;
const OCR_CACHE = 'ocr-tesseract-7.0.0';

const APP_FILES = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/currencies.js',
  './js/format.js',
  './js/language.js',
  './js/layout.js',
  './js/ocr.js',
  './js/price-parser.js',
  './js/rates.js',
  './js/scan.js',
  './js/storage.js',
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
  event.waitUntil(caches.open(APP_CACHE).then((cache) => cache.addAll(APP_FILES)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([APP_CACHE, OCR_CACHE]);
      for (const key of await caches.keys()) if (!keep.has(key)) await caches.delete(key);
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request));
  } else if (OCR_FILES.test(request.url)) {
    event.respondWith(cacheFirst(request));
  }
  // Everything else (exchange rates, translation) goes straight to the network.
});

// Serve the cached copy straight away and refresh it in the background.
async function staleWhileRevalidate(request) {
  const cache = await caches.open(APP_CACHE);
  const cached = await cache.match(request, { ignoreSearch: request.mode === 'navigate' });
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached || (request.mode === 'navigate' ? cache.match('./index.html') : Response.error()));
  return cached || network;
}

async function cacheFirst(request) {
  const cache = await caches.open(OCR_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
  return response;
}
