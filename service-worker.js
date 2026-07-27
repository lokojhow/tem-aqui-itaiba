/* Tem Aqui Itaíba — Service Worker V1 estável */
const CACHE = 'tem-aqui-itaiba-v1-2026-07-27';
const CORE = [
  './',
  './index.html',
  './manifest.json',
  './logo.svg',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './cidade-itaiba.svg',
  './itaiba-feed-1.svg',
  './itaiba-feed-2.svg',
  './itaiba-feed-3.svg',
  './itaiba-feed-4.svg',
  './supabase-config.js',
  './online.js?v=1.0',
  './cart.js?v=1.0',
  './heic2any.min.js',
  './categoria-beleza.webp',
  './categoria-carnes.webp',
  './categoria-casa.webp',
  './categoria-eletronicos.webp',
  './categoria-farmacia.webp',
  './categoria-food.webp',
  './categoria-lojas.webp',
  './categoria-moda.webp',
  './categoria-supermercado.webp'
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(CORE.map(async asset => {
      const response = await fetch(asset, { cache: 'no-store' });
      if (response.ok) await cache.put(asset, response);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name !== CACHE).map(name => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(request, { cache: 'no-store' });
        if (fresh.ok) {
          const cache = await caches.open(CACHE);
          await cache.put('./index.html', fresh.clone());
        }
        return fresh;
      } catch (_) {
        return (await caches.match('./index.html')) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cached = await caches.match(request);
    const network = fetch(request).then(async response => {
      if (response.ok) {
        const cache = await caches.open(CACHE);
        await cache.put(request, response.clone());
      }
      return response;
    }).catch(() => null);
    return cached || (await network) || Response.error();
  })());
});
