const CACHE_PREFIX = 'chronos-ai-shell-';
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const APP_SHELL = [
  './',
  './index.html',
  './offline.html',
  './styles.css',
  './script.js',
  './manifest.webmanifest',
  './assets/chronos-web-logo.png',
  './assets/pwa/icon-192.png',
  './assets/pwa/icon-512.png',
  './assets/pwa/icon-512-maskable.png',
  './assets/pwa/apple-touch-icon.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(
        names
          .filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
          .map(name => caches.delete(name)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const requestUrl = new URL(request.url);
  const scopeUrl = new URL(self.registration.scope);
  if (requestUrl.origin !== scopeUrl.origin || !requestUrl.pathname.startsWith(scopeUrl.pathname)) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(request, scopeUrl));
    return;
  }

  if (requestUrl.search || !isAppShellAsset(requestUrl, scopeUrl)) return;
  event.respondWith(networkFirstAsset(request));
});

async function networkFirstNavigation(request, scopeUrl) {
  let response;
  try {
    response = await fetch(request);
  } catch {
    const cache = await caches.open(CACHE_NAME);
    const cachedPage = await cache.match(request);
    if (cachedPage) return cachedPage;

    const cachedHome = await cache.match(new URL('./', scopeUrl).href);
    if (cachedHome) return cachedHome;
    return (await cache.match(new URL('./offline.html', scopeUrl).href))
      || Response.error();
  }

  const requestUrl = new URL(request.url);
  const isAppPage = requestUrl.pathname === scopeUrl.pathname
    || requestUrl.pathname === new URL('./index.html', scopeUrl).pathname;
  if (response.ok && response.type === 'basic' && isAppPage && !requestUrl.search) {
    const cache = await caches.open(CACHE_NAME);
    try {
      await cache.put(request, response.clone());
    } catch (error) {
      console.warn('Chronos app page could not be cached.', error);
    }
  }
  return response;
}

async function networkFirstAsset(request) {
  let response;
  try {
    response = await fetch(request);
  } catch {
    const cache = await caches.open(CACHE_NAME);
    return (await cache.match(request)) || Response.error();
  }

  if (response.ok && response.type === 'basic') {
    const cache = await caches.open(CACHE_NAME);
    try {
      await cache.put(request, response.clone());
    } catch (error) {
      console.warn('Chronos app asset could not be cached.', error);
    }
  }
  return response;
}

function isAppShellAsset(requestUrl, scopeUrl) {
  const pathname = requestUrl.pathname.slice(scopeUrl.pathname.length);
  return APP_SHELL.some(asset => {
    const assetUrl = new URL(asset, scopeUrl);
    return assetUrl.pathname === requestUrl.pathname;
  }) || pathname === 'index.html';
}
