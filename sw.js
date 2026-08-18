self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  return self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // Dejamos que pase la red normalmente para las llamadas a la API y Supabase
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});