/* Service worker : fonctionnement hors ligne + résumé du matin. */
importScripts('./shared.js');

const CACHE = 'echeances-v5';
const ASSETS = [
  './', './index.html', './styles.css', './app.js', './shared.js', './sync.js', './firebase-config.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/badge-96.png',
  './icons/shortcut-expense.png', './icons/shortcut-task.png',
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
  // `no-cache` : toujours demander au serveur s'il y a du nouveau (GitHub Pages fait sinon
  // garder les fichiers 10 min, et une mise à jour n'arrivait pas tout de suite).
  const fresh = req.mode === 'navigate' ? fetch(req.url, { cache: 'no-cache' }) : fetch(req, { cache: 'no-cache' });
  event.respondWith(
    fresh
      .then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('./index.html')))
  );
});

// `remote` = résumé construit en ligne par GitHub (données à jour, y compris celles du PC).
// Sans lui, on le construit avec les données de l'appareil.
async function showSummary(remote) {
  let title, body;
  if (remote && remote.title) ({ title, body } = remote);
  else ({ title, body } = E.buildSummary((await E.kvGet('state')) || {}));
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

self.addEventListener('push', (event) => {
  let remote = null;
  try { remote = event.data ? event.data.json() : null; } catch (e) { remote = null; }
  event.waitUntil(showSummary(remote));
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
