/* Tem Aqui — Service Worker V61, sem páginas administrativas embutidas */
const CACHE = "tem-aqui-itaiba-v61-2026-07-28";
const CORE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.json?v=61.0",
  "./logo.svg",
  "./icon.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./supabase-config.js",
  "./access-control.js?v=61.0",
  "./online.js?v=61.0",
  "./cart.js?v=2.0"
];
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(CORE_ASSETS.map(asset => fetch(asset, {cache:'no-store'}).then(r => r.ok ? cache.put(asset, r) : null)));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request, {cache:'no-store'});
    if (response && response.ok) await cache.put(request, response.clone());
    return response;
  } catch (_) {
    return (await cache.match(request)) || (request.mode === 'navigate' ? await cache.match('./index.html') : null) || new Response('Arquivo indisponível.', {status:503});
  }
}
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(networkFirst(event.request));
});
