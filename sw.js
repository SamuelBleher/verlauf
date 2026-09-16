// App-Shell offline halten. Daten liegen in IndexedDB, nicht hier —
// api.github.com wird bewusst nie zwischengespeichert.

const VERSION = 'verlauf-v6';
const SHELL = [
  './', './index.html', './manifest.webmanifest',
  './css/app.css',
  './js/app.js', './js/db.js', './js/sync.js', './js/github.js', './js/repo.js',
  './js/models.js', './js/markdown.js', './js/images.js', './js/audio.js',
  './js/ui/components.js', './js/ui/timeline.js', './js/ui/entry-edit.js',
  './js/ui/entry-view.js', './js/ui/conditions.js', './js/ui/search.js', './js/ui/settings.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await Promise.allSettled(SHELL.map(u => cache.add(u)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== VERSION) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.hostname === 'api.github.com') return;          // nie cachen
  if (url.pathname.endsWith('/diag.html')) return;        // Diagnose muss immer frisch sein
  if (url.origin !== self.location.origin && !url.hostname.includes('fonts.g')) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try { return await fetch(request); }
      catch { return (await caches.match('./index.html')) || Response.error(); }
    })());
    return;
  }

  event.respondWith((async () => {
    const hit = await caches.match(request, { ignoreSearch: false });
    if (hit) {
      fetch(request).then(res => {
        if (res.ok) caches.open(VERSION).then(c => c.put(request, res.clone()));
      }).catch(() => {});
      return hit;
    }
    try {
      const res = await fetch(request);
      if (res.ok) { const c = await caches.open(VERSION); c.put(request, res.clone()); }
      return res;
    } catch { return Response.error(); }
  })());
});
