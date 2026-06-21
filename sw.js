const CACHE = 'word-learner-v33';
const MEDIA_CACHE = 'word-learner-media'; // 圖片/音檔（跨版本保留，不隨程式更新清掉）
const V = '?v=33';
const ASSETS = [
  './index.html',
  './style.css' + V,
  './app.js' + V,
  './db.js' + V,
  './fsrs-engine.js' + V,
  './ai.js' + V,
  './coins.js' + V,
  './patches.js' + V,
  './dev.js' + V,
  './monster.js' + V,
  './games/memory.js' + V,
  './games/listen.js' + V,
  './games/fillblank.js' + V,
  './games/spelling.js' + V,
  './games/speak.js' + V,
  './games/bubble.js' + V,
  './games/echo.js' + V,
  './games/flashlight.js' + V,
  './games/detective.js' + V,
  './games/match.js' + V,
  './games/cloze.js' + V,
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
      return Promise.all(keys.filter(function(k) {
        // 保留目前版本的程式快取 + 媒體快取，其餘舊版清掉
        return k !== CACHE && k !== MEDIA_CACHE;
      }).map(function(k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', function(e) {
  var url = new URL(e.request.url);

  // 跳過非 GET 請求（Firebase POST 等）
  if (e.request.method !== 'GET') return;

  // 跳過 chrome-extension 和 Firebase API（讀寫資料庫）請求
  if (url.protocol === 'chrome-extension:') return;
  if (url.hostname.includes('firebaseio.com') ||
      url.hostname.includes('firestore.googleapis.com') ||
      url.hostname.includes('identitytoolkit.googleapis.com')) return;

  // Firebase Storage 圖片/音檔：快取優先（離線可用、重複秒開）
  // 第一次讀 → 下載並存快取；之後 → 直接給快取，背景更新
  var isStorageAsset = url.hostname.includes('firebasestorage.googleapis.com') ||
                       url.hostname.includes('storage.googleapis.com');
  if (isStorageAsset) {
    e.respondWith(
      caches.open(MEDIA_CACHE).then(function(c) {
        return c.match(e.request).then(function(cached) {
          var network = fetch(e.request).then(function(res) {
            if (res && res.status === 200) c.put(e.request, res.clone());
            return res;
          }).catch(function() { return cached; });
          return cached || network;
        });
      })
    );
    return;
  }

  // 其它外部資源（如 Pixabay 預覽）：網路優先，失敗回退快取
  if (url.origin !== location.origin) {
    e.respondWith(
      fetch(e.request).then(function(res) {
        var clone = res.clone();
        caches.open(MEDIA_CACHE).then(function(c) { c.put(e.request, clone); });
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

// ===== 與頁面溝通：清除媒體快取、回報版本 =====
self.addEventListener('message', function(e) {
  var data = e.data || {};
  if (data.type === 'CLEAR_MEDIA_CACHE') {
    caches.delete(MEDIA_CACHE).then(function() {
      // 重新建立空的媒體快取
      return caches.open(MEDIA_CACHE);
    }).then(function() {
      if (e.source) e.source.postMessage({ type: 'MEDIA_CACHE_CLEARED' });
    });
  } else if (data.type === 'GET_VERSION') {
    if (e.source) e.source.postMessage({ type: 'VERSION', version: CACHE });
  } else if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
