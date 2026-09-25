'use strict';
const ASSETS = ["./app-config.js", "./app-runtime.js", "./app.css", "./assets/image-2654e9a5ca837084.jpg", "./assets/image-3110ecdd94c95c5a.jpg", "./assets/image-3ce18f33a4d56653.jpg", "./assets/image-4d7a8ae9ef298d1e.jpg", "./assets/image-5b696b84e0353ced.jpg", "./assets/image-65a005139f06da87.jpg", "./assets/image-79c29d2f1f1ea316.webp", "./assets/image-9d4de02ab9709bf6.webp", "./assets/image-a8ea88a71894cc41.jpg", "./assets/image-e07c02e6963602b6.jpg", "./assets/image-f2126a69d5e3c3ec.jpg", "./assets/image-f90aea4de23c6c67.jpg", "./assets/image-fbdf9a00a12f9045.webp", "./icons/apple-touch-icon.png", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/icon-maskable-512.png", "./index.html", "./manifest.webmanifest", "./online-map.css", "./online-map.js", "./vendor/leaflet/images/layers-2x.png", "./vendor/leaflet/images/layers.png", "./vendor/leaflet/images/marker-icon-2x.png", "./vendor/leaflet/images/marker-icon.png", "./vendor/leaflet/images/marker-shadow.png", "./vendor/leaflet/leaflet.css", "./vendor/leaflet/leaflet.js", "./weather-service.js"];
const PREFIX = 'zls-app-shell-' + encodeURIComponent(new URL(self.registration.scope).pathname) + ':';
const CACHE = PREFIX + '20260925-dfeb387b9bf4';
const base = new URL(self.registration.scope);
const assetURLs = new Set(ASSETS.map(path => new URL(path, base).href));
self.addEventListener('install', event => {
  // A new shell must not reuse the browser's still-fresh HTTP copy of an older page.
  // Only bundled same-origin files are refreshed; external map/weather requests stay untouched.
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(ASSETS.map(path => new Request(new URL(path, base).href, {cache:'reload'})));
    // Activate only after the complete shell is ready. Existing pages keep their
    // loaded code; reopening the same QR URL receives the new coherent shell.
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'ACTIVATE_UPDATE') event.waitUntil(self.skipWaiting());
});
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== base.origin || request.headers.has('Authorization') || request.headers.has('Range')) return;
  url.search = ''; url.hash = '';
  if (url.pathname === base.pathname && request.mode === 'navigate') url.pathname += 'index.html';
  if (!assetURLs.has(url.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const stored = await cache.match(url.href);
    if (stored) return stored;
    return fetch(request);
  })());
});
