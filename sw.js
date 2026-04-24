const CACHE = 'word-learner-v8';
const ASSETS = [
  './index.html',
  './style.css',
  './app.js',
  './db.js',
  './coins.js',
  './patches.js',
  './games/memory.js',
  './games/listen.js',
  './games/fillblank.js',
  './games/spelling.js',
  './games/speak.js',
  './games/bubble.js',
  './games/echo.js',
  './games/flashlight.js',
  './images/lion.png',
  './manifest.json',
  './icon.svg'
];

self.addEventListener('install', function(e) {
  e.waitUntil(caches.open(CACHE).then(function(c) { return c.addAll(ASSETS); }));
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k) { return k !== CACHE; }).map(function(k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(e) {
  var url = new URL(e.request.url);

  // 跳過非 GET 請求（Firebase POST 等）
  if (e.request.method !== 'GET') return;

  // 跳過 chrome-extension 和 Firebase 請求
  if (url.protocol === 'chrome-extension:') return;
  if (url.hostname.includes('firebaseio.com') ||
      url.hostname.includes('googleapis.com') ||
      url.hostname.includes('firestore.googleapis.com')) return;

  // 外部圖片：網路優先
  if (url.origin !== location.origin) {
    e.respondWith(
      fetch(e.request).then(function(res) {
        var clone = res.clone();
        caches.open(CACHE).then(function(c) { c.put(e.request, clone); });
        return res;
      }).catch(function() { return caches.match(e.request); })
    );
    return;
  }

  // 本地資源：快取優先
  e.respondWith(
    caches.match(e.request).then(function(cached) { return cached || fetch(e.request); })
  );
});
