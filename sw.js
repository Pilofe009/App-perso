/* Service worker : fonctionnement hors ligne + résumé du matin. */
importScripts('./shared.js');

const CACHE = 'echeances-v3';
const ASSETS = [
  './', './index.html', './styles.css', './app.js', './shared.js', './sync.js', './firebase-config.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/badge-96.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Bibliothèque Firebase (version fixe) : depuis le cache, pour démarrer même hors ligne.
const FIREBASE_LIB = 'https://www.gstatic.com/firebasejs/';

// Réseau d'abord (pour recevoir les mises à jour), cache si hors ligne.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method === 'GET' && req.url.startsWith(FIREBASE_LIB)) {
    event.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    })));
    return;
  }
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./index.html')))
  );
});

async function showSummary() {
  const state = (await E.kvGet('state')) || {};
  const { title, body } = E.buildSummary(state);
  await E.kvSet('lastSummary', E.todayStr());
  return self.registration.showNotification(title, {
    body,
    icon: './icons/icon-192.png',
    badge: './icons/badge-96.png',
    tag: 'resume-quotidien',
    renotify: true,
    data: { url: './' },
  });
}

// Le « réveil » envoyé par GitHub Actions ne contient aucune donnée :
// le résumé est construit ici, à partir des données stockées sur le téléphone.
self.addEventListener('push', (event) => {
  event.waitUntil(showSummary());
});

self.addEventListener('message', (event) => {
  if (event.data === 'test-summary') event.waitUntil(showSummary());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if ('focus' in c) return c.focus();
      return self.clients.openWindow('./');
    })
  );
});
