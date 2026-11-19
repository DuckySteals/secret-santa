// Keeps the app shell available offline; everything else goes straight to the network.
const SHELL = ['/', '/app.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open('shell').then(c => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', e => e.waitUntil(clients.claim()));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/api/')) return;
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok && SHELL.includes(u.pathname)) { const copy = r.clone(); caches.open('shell').then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
