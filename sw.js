// This service worker unregisters itself and clears all old caches.
// The app works fine without it — Vercel serves fresh files on every load.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', async () => {
  const keys = await caches.keys();
  await Promise.all(keys.map(k => caches.delete(k)));
  await self.clients.claim();
});
