const CACHE = 'word-learner-v74';
const MEDIA_CACHE = 'word-learner-media'; // 圖片/音檔（跨版本保留，不隨程式更新清掉）
const V = '?v=74';
const ASSETS = [
  './index.html',
  './style.css' + V,
  './app.js' + V,
  './db.js' + V,
  './fsrs-engine.js' + V,
  './ai.js' + V,
  './imagegen.js' + V,
  './coins.js' + V,
  './patches.js' + V,
  './dev.js' + V,
  './cloud.js' + V,
  './monster.js' + V,
  './tts.js' + V,
  './stories.js' + V,
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
  './games/learn.js' + V,
  './games/atlas.js' + V,
  './games/write.js' + V,
  './games/hunt.js' + V,
  './games/phonics.js' + V,
  './games/pattern.js' + V,
  './games/dictation.js' + V,
  './games/minimal.js' + V,
  './data/moe-wordlist.js' + V,
  './curriculum.js' + V,
  './images/lion.png',
  './images/map.png',
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

  // Firebase Storage 圖片/音檔：快取優先，存在平板上（離線可用、重複秒開）
  // 網址帶有檔案 token，同一個網址內容不會變 → 有快取就直接用，不再背景重抓
  // 注意：<img>/<audio> 發出的是 no-cors 請求（回應是 opaque、status 0），
  //       <audio> 還會帶 Range（回 206）；這兩種都存不進快取。
  //       所以這裡改用 CORS 抓「完整檔案」存起來，再依 Range 切片回給 <audio>。
  var isStorageAsset = url.hostname.includes('firebasestorage.googleapis.com') ||
                       url.hostname.includes('storage.googleapis.com');
  if (isStorageAsset) {
    e.respondWith(serveMedia(e.request));
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

  // 本地資源：快取優先；沒有的（例如版本參數不同）抓下來後也存進目前版本的快取
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      if (cached) return cached;
      return fetch(e.request).then(function(res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var clone = res.clone();
          caches.open(CACHE).then(function(c) { c.put(e.request, clone); });
        }
        return res;
      });
    })
  );
});

// ===== 媒體快取：完整檔案存起來，依 Range 回應 =====
async function serveMedia(req) {
  var c = await caches.open(MEDIA_CACHE);
  var key = req.url;
  var cached = await c.match(key);
  if (cached) return withRange(req, cached);

  var res;
  try {
    // 不帶 Range、用 CORS 抓完整檔案 → status 200，可以存
    res = await fetch(key, { mode: 'cors', credentials: 'omit' });
  } catch (err) {
    // 不支援 CORS 的外部圖片：退回原本的請求（opaque，只能給圖片用）
    try {
      res = await fetch(req);
      if (res && res.type === 'opaque' && !req.headers.get('range')) c.put(key, res.clone()).catch(function() {});
      return res;
    } catch (err2) {
      return new Response('', { status: 504, statusText: 'offline' });
    }
  }
  if (res && res.status === 200) {
    try { await c.put(key, res.clone()); } catch (err) { /* 空間不足：這次不存 */ }
  }
  return withRange(req, res);
}

// <audio> 會要求 bytes=0- 這類片段（Safari 一定要 206 才能播）
async function withRange(req, res) {
  var range = req.headers.get('range');
  if (!range || !res || res.status !== 200) return res;
  var m = /bytes=(\d*)-(\d*)/.exec(range);
  if (!m) return res;
  var buf = await res.arrayBuffer();
  var size = buf.byteLength;
  var start, end;
  if (m[1] === '' && m[2] !== '') {          // bytes=-500：最後 500 bytes
    start = Math.max(0, size - Number(m[2])); end = size - 1;
  } else {
    start = Number(m[1] || 0);
    end = m[2] !== '' ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
  }
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': res.headers.get('Content-Type') || 'audio/mpeg',
      'Content-Range': 'bytes ' + start + '-' + end + '/' + size,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes'
    }
  });
}

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
