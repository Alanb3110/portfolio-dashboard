const CACHE_PREFIX = 'portfolio-dashboard-';
const CACHE_VERSION = '__PORTFOLIO_CACHE_VERSION__';
const CACHE = `${CACHE_PREFIX}${CACHE_VERSION}`;
const BASE_URL = new URL('./', self.location.href);
const BASE = BASE_URL.pathname;
const PRECACHE_RELATIVE = /*__PORTFOLIO_PRECACHE__*/ [];
const APP_SHELL = PRECACHE_RELATIVE.map((relativePath) => new URL(relativePath || './', BASE_URL).toString());
const APP_SHELL_SET = new Set(APP_SHELL);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const requests = APP_SHELL.map((url) => new Request(url, { cache: 'reload' }));
    await cache.addAll(requests);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE)
        .map((key) => caches.delete(key)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch {
        const cache = await caches.open(CACHE);
        return (await cache.match(BASE)) ?? Response.error();
      }
    })());
    return;
  }

  if (APP_SHELL_SET.has(url.toString())) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      return fetch(request);
    })());
    return;
  }

  event.respondWith((async () => {
    try {
      return await fetch(request);
    } catch {
      const cache = await caches.open(CACHE);
      return (await cache.match(request)) ?? Response.error();
    }
  })());
});
