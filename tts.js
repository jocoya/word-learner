// ===== 語音播放（Sulafat 音檔優先，沒有就用瀏覽器語音）=====
// 音檔由電腦端 tools/tts/generate.js 產生，再用「開發者模式 → 🎙️ 匯入語音包」上傳到 Storage：
//   tts/manifest.json      ：{ voice, items: { key: {text, kind, bytes} } }
//   tts/audio/<key>.mp3    ：key = sha1(正規化文字) 前 16 碼（與 generate.js 相同算法）
// 啟動時讀一次 manifest（之後由 Service Worker 快取，離線也能播）。
// 所有發音都走 speakWord()，所以遊戲程式不用改。

var TTS_STORAGE_DIR = 'tts';
var ttsManifest = null;         // { voice, items }
var ttsReady = false;
var ttsAudioBase = null;        // Storage 下載網址前綴（取得一次即可組出所有 mp3 網址）
var _ttsCurrent = null;         // 正在播放的 Audio
var _ttsSeq = 0;                // 每次 speak 遞增：新的一次會中斷舊的
var _ttsUrlCache = {};          // key → 下載網址

// 與 generate.js 完全相同的正規化
function ttsNormalize(text) {
  return String(text || '').replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();
}

// SHA-1 → 前 16 碼 hex（瀏覽器 SubtleCrypto；結果和 Node crypto 一致）
async function ttsKey(text) {
  var data = new TextEncoder().encode(ttsNormalize(text));
  var buf = await crypto.subtle.digest('SHA-1', data);
  return Array.from(new Uint8Array(buf)).map(function(b) { return b.toString(16).padStart(2, '0'); }).join('').slice(0, 16);
}

// 讀取 manifest（失敗就維持瀏覽器語音，不影響使用）
async function loadTtsManifest() {
  if (typeof storage === 'undefined') return;
  try {
    var url = await storage.ref(TTS_STORAGE_DIR + '/manifest.json').getDownloadURL();
    var res = await fetch(url);
    if (!res.ok) return;
    ttsManifest = await res.json();
    ttsReady = !!(ttsManifest && ttsManifest.items);
  } catch (e) {
    // 還沒上傳語音包是正常情況
    ttsReady = false;
  }
}

async function ttsAudioUrl(key) {
  if (_ttsUrlCache[key]) return _ttsUrlCache[key];
  var url = await storage.ref(TTS_STORAGE_DIR + '/audio/' + key + '.mp3').getDownloadURL();
  _ttsUrlCache[key] = url;
  return url;
}

// 停止所有發音（音檔 + 瀏覽器語音）
function stopSpeaking() {
  _ttsSeq++;
  if (_ttsCurrent) { try { _ttsCurrent.pause(); } catch (e) {} _ttsCurrent = null; }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

// 瀏覽器語音（備援）
function speakBrowser(text, rate, onDone) {
  if (!('speechSynthesis' in window)) { if (onDone) onDone(); return; }
  var u = new SpeechSynthesisUtterance(text);
  u.lang = 'en-US';
  u.rate = rate;
  if (onDone) { u.onend = onDone; u.onerror = onDone; }
  speechSynthesis.speak(u);
}

// 主入口：念一段英文
//   rate：原本給瀏覽器語音的速度（0.4–1.0）。音檔以 0.9 倍速產生，這裡換算成播放速度，
//         讓遊戲原本「慢慢念」的設定仍然有效（例如 0.5 → 較慢播放）
//   onDone：念完（或失敗）時呼叫，睡前故事連續朗讀會用到
function speakText(text, rate, onDone) {
  rate = rate || 0.8;
  var seq = ++_ttsSeq;
  if (_ttsCurrent) { try { _ttsCurrent.pause(); } catch (e) {} _ttsCurrent = null; }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  if (!ttsReady || !text) { speakBrowser(text, rate, onDone); return; }

  ttsKey(text).then(function(key) {
    if (seq !== _ttsSeq) return;                         // 已經有新的發音要求
    if (!ttsManifest.items[key]) { speakBrowser(text, rate, onDone); return; }
    return ttsAudioUrl(key).then(function(url) {
      if (seq !== _ttsSeq) return;
      var a = new Audio(url);
      // 瀏覽器語音 0.8 ≈ 正常；音檔本身已是 0.9 倍速，所以 0.8 → 1.0 播放
      a.playbackRate = Math.max(0.5, Math.min(1.3, rate / 0.8));
      a.preservesPitch = true;
      _ttsCurrent = a;
      var finished = false;
      var done = function() { if (finished) return; finished = true; if (_ttsCurrent === a) _ttsCurrent = null; if (onDone) onDone(); };
      a.onended = done;
      a.onerror = function() { if (seq === _ttsSeq) { finished = true; speakBrowser(text, rate, onDone); } };
      var p = a.play();
      if (p && p.catch) p.catch(function() { if (seq === _ttsSeq && !finished) { finished = true; speakBrowser(text, rate, onDone); } });
    });
  }).catch(function() {
    if (seq === _ttsSeq) speakBrowser(text, rate, onDone);
  });
}

// 取代 app.js 原本的 speakWord（所有遊戲都呼叫它）
function speakWord(word, rate) {
  speakText(word, rate === undefined ? 0.8 : rate);
}

// ---------- 開發者模式：匯入語音包 ----------
// 直接選 tools/tts/output「資料夾」（會一併讀到 manifest.json 與 audio/*.mp3）
// 只上傳 Storage 上還沒有的檔案；最後合併並上傳 manifest
async function devImportTtsPack() {
  var input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  // 選資料夾：Chrome / Edge / 平板 Chrome 都支援；不支援的瀏覽器會退回一般多選
  input.webkitdirectory = true;
  input.setAttribute('webkitdirectory', '');
  input.onchange = async function() {
    var files = Array.from(input.files || []);
    var manifestFile = files.find(function(f) { return f.name === 'manifest.json'; });
    var mp3s = files.filter(function(f) { return /\.mp3$/i.test(f.name); });
    if (!manifestFile) { devOut('❌ 找不到 manifest.json。請選 tools\\tts\\output 這個資料夾（不是裡面的 audio 資料夾）。'); return; }
    if (!mp3s.length) { devOut('❌ 資料夾裡沒有 mp3。請先在電腦執行產生程式。'); return; }
    var local;
    try { local = JSON.parse(await manifestFile.text()); } catch (e) { devOut('❌ manifest.json 讀取失敗'); return; }
    // 合併雲端已有的 manifest（分批上傳時不會蓋掉前面的）
    await loadTtsManifest();
    var merged = { voice: local.voice, items: Object.assign({}, (ttsManifest && ttsManifest.items) || {}) };
    if (ttsManifest && ttsManifest.voice && ttsManifest.voice !== local.voice) {
      if (!confirm('雲端語音包是 ' + ttsManifest.voice + '，這次是 ' + local.voice + '。\n繼續會混用兩種聲音，確定嗎？')) return;
    }
    var todo = mp3s.filter(function(f) {
      var key = f.name.replace(/\.mp3$/i, '');
      return local.items[key] && !merged.items[key];
    });
    devOut('上傳中 0 / ' + todo.length + '（已在雲端的會跳過）');
    var done = 0, fail = 0, firstErr = '';
    // 同時 4 個上傳，平板網路也不會卡太久
    var queue = todo.slice();
    async function worker() {
      while (queue.length) {
        var f = queue.shift();
        var key = f.name.replace(/\.mp3$/i, '');
        try {
          await storage.ref(TTS_STORAGE_DIR + '/audio/' + key + '.mp3').put(f, { contentType: 'audio/mpeg', cacheControl: 'public,max-age=31536000' });
          merged.items[key] = local.items[key];
          done++;
        } catch (e) {
          fail++;
          if (!firstErr) firstErr = e && (e.code || e.message);
        }
        devOut('上傳中 ' + (done + fail) + ' / ' + todo.length + (fail ? '（失敗 ' + fail + '）' : ''));
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()]);
    if (done === 0 && fail > 0) {
      devOut('❌ 全部上傳失敗（' + esc(String(firstErr)) + '）。<br>若是 storage/unauthorized，代表 Firebase Storage 規則不允許寫入 tts/ 資料夾，需要調整規則。');
      return;
    }
    var blob = new Blob([JSON.stringify(merged)], { type: 'application/json' });
    await storage.ref(TTS_STORAGE_DIR + '/manifest.json').put(blob, { contentType: 'application/json', cacheControl: 'no-cache' });
    ttsManifest = merged;
    ttsReady = true;
    devOut('✅ 上傳完成：新增 ' + done + ' 個音檔' + (fail ? '，失敗 ' + fail + ' 個（再匯入一次會補傳）' : '') +
      '。雲端共 ' + Object.keys(merged.items).length + ' 個語音。');
  };
  input.click();
}

// 開發者模式：語音包狀態（有多少單字/例句已有 Sulafat 音檔）
async function devTtsStatus() {
  await loadTtsManifest();
  if (!ttsReady) { devOut('還沒有語音包，目前全部用瀏覽器語音。'); return; }
  var words = await dbGetAll('words');
  var w = 0, wHave = 0, s = 0, sHave = 0;
  for (var i = 0; i < words.length; i++) {
    w++;
    if (ttsManifest.items[await ttsKey(words[i].word)]) wHave++;
    var sens = words[i].sentences || [];
    for (var j = 0; j < sens.length; j++) {
      if (!sens[j]) continue;
      s++;
      if (ttsManifest.items[await ttsKey(sens[j])]) sHave++;
    }
  }
  devOut('🎙️ 聲音：' + esc(ttsManifest.voice || '') +
    '<br>單字：' + wHave + ' / ' + w + '　例句：' + sHave + ' / ' + s +
    '<br><small>沒有音檔的會自動用瀏覽器語音。新增單字後，再跑一次產生工具並匯入即可補上。</small>');
}

// 啟動時載入（DB/Storage 就緒後）
if (typeof window !== 'undefined') {
  window.addEventListener('load', function() { setTimeout(loadTtsManifest, 800); });
}
