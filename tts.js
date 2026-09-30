// ===== 語音播放（雲端音檔優先，沒有就用瀏覽器語音）=====
// 支援多個聲音包，每個聲音一個資料夾：
//   Storage  tts/<聲音>/<key>.mp3          ：key = sha1(正規化文字) 前 16 碼（與 tools/tts/generate.js 相同算法）
//            （舊版 v69 的 Sulafat 在 tts/audio/<key>.mp3，仍然可以播放）
//   settings ttsManifest = {
//     voices: { Sulafat: { folder:'audio', items:{ key:'w'|'s' } }, Achird: { folder:'Achird', items:{...} } },
//     wordVoice: 'Achird',        // 念單字用哪個聲音
//     sentenceVoice: 'Achird'     // 念例句 / 句子用哪個聲音（可和單字不同，增加豐富性）
//   }
// 選的聲音沒有這句 → 退回其他有這句的聲音 → 最後才用瀏覽器語音。
// 所有發音都走 speakWord()，所以遊戲程式不用改。

var TTS_STORAGE_DIR = 'tts';
var TTS_SETTINGS_KEY = 'ttsManifest';
var ttsManifest = null;
var ttsReady = false;
var _ttsCurrent = null;         // 正在播放的 Audio
var _ttsSeq = 0;                // 每次 speak 遞增：新的一次會中斷舊的
var _ttsUrlCache = {};          // 'Voice/key' → 下載網址

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

// en-US-Chirp3-HD-Achird → Achird
function ttsVoiceShort(voice) {
  var m = String(voice || '').match(/([A-Za-z]+)$/);
  return m ? m[1] : 'voice';
}

// 舊格式（v69/v70：{ voice, items }）→ 新格式（多聲音）
function ttsUpgradeManifest(s) {
  if (!s) return null;
  if (s.voices) return s;
  if (!s.items) return null;
  var name = ttsVoiceShort(s.voice || 'Sulafat');
  var voices = {};
  voices[name] = { folder: 'audio', items: s.items };   // 舊版音檔放在 tts/audio/
  return { key: TTS_SETTINGS_KEY, voices: voices, wordVoice: name, sentenceVoice: name, updatedAt: s.updatedAt || Date.now() };
}

// 語音清單存在 settings（跟著 IndexedDB + Firestore 同步，離線可讀，不受 Storage CORS 限制）
// 有網路：以雲端為準（雲端函式會自動加入新單字的音檔）；離線：用本機快取
async function loadTtsManifest() {
  try {
    var s = null;
    if (typeof firestore !== 'undefined' && navigator.onLine) {
      try {
        var doc = await firestore.collection('settings').doc(TTS_SETTINGS_KEY).get();
        if (doc.exists) {
          s = doc.data();
          if (typeof dbPutLocal === 'function') await dbPutLocal('settings', s);
        }
      } catch (e) { s = null; }
    }
    if (!s && typeof dbGet === 'function') s = await dbGet('settings', TTS_SETTINGS_KEY);
    ttsManifest = ttsUpgradeManifest(s);
    ttsReady = !!ttsManifest && Object.keys(ttsManifest.voices).some(function(v) {
      return Object.keys(ttsManifest.voices[v].items || {}).length > 0;
    });
  } catch (e) {
    ttsReady = false;
  }
  return ttsReady;
}

// 儲存前先合併雲端最新的清單：雲端函式可能剛自動加了新音檔，不能被這份舊清單整份蓋掉
async function saveTtsManifest(m) {
  m.key = TTS_SETTINGS_KEY;
  m.updatedAt = Date.now();
  var remote = await ttsFetchRemoteManifest();
  if (remote && remote.voices) {
    Object.keys(remote.voices).forEach(function(v) {
      var rv = remote.voices[v];
      if (!m.voices[v]) {
        // 雲端有、這份沒有：除非是這次刻意刪除的聲音，否則保留
        if (!(m._deleted && m._deleted.indexOf(v) !== -1)) m.voices[v] = rv;
        return;
      }
      m.voices[v].items = Object.assign({}, rv.items || {}, m.voices[v].items || {});
    });
  }
  delete m._deleted;
  await dbPut('settings', m);
  ttsManifest = m;
  ttsReady = Object.keys(m.voices).some(function(v) { return Object.keys(m.voices[v].items || {}).length > 0; });
}

async function ttsFetchRemoteManifest() {
  if (typeof firestore === 'undefined' || !navigator.onLine) return null;
  try {
    var doc = await firestore.collection('settings').doc(TTS_SETTINGS_KEY).get();
    return doc.exists ? ttsUpgradeManifest(doc.data()) : null;
  } catch (e) { return null; }
}

// 是句子還是單字：依清單記錄的種類（ice cream 是單字，不能用「有沒有空白」判斷）
// 清單裡都沒有這句（例如睡前故事的新句子）→ 用字數判斷
function ttsIsSentence(key, text) {
  var vs = ttsManifest ? ttsManifest.voices : {};
  for (var n in vs) { var k = vs[n].items && vs[n].items[key]; if (k) return k === 's'; }
  return String(text).trim().split(/\s+/).length > 2;
}

// 找這段文字要用哪個聲音：偏好的聲音有就用，沒有就找其他有這句的聲音
function ttsPickVoice(key, isSentence) {
  if (!ttsManifest) return null;
  var prefer = isSentence ? ttsManifest.sentenceVoice : ttsManifest.wordVoice;
  var order = [prefer].concat(Object.keys(ttsManifest.voices).filter(function(v) { return v !== prefer; }));
  for (var i = 0; i < order.length; i++) {
    var v = ttsManifest.voices[order[i]];
    if (v && v.items && v.items[key]) return order[i];
  }
  return null;
}

// 音檔網址：getDownloadURL（含存取 token，不受 Storage 規則與 CORS 影響）
// 取得過的網址存在 localStorage，下次開 App 不用再問、離線也能交給 Service Worker 快取播放
var TTS_URL_LS = 'ttsUrlCache2';
try { _ttsUrlCache = JSON.parse(localStorage.getItem(TTS_URL_LS) || '{}'); } catch (e) { _ttsUrlCache = {}; }
function saveTtsUrlCache() {
  try { localStorage.setItem(TTS_URL_LS, JSON.stringify(_ttsUrlCache)); } catch (e) {}
}
async function ttsAudioUrl(voice, key) {
  var ck = voice + '/' + key;
  if (_ttsUrlCache[ck]) return _ttsUrlCache[ck];
  var folder = (ttsManifest.voices[voice] && ttsManifest.voices[voice].folder) || voice;
  var url = await storage.ref(TTS_STORAGE_DIR + '/' + folder + '/' + key + '.mp3').getDownloadURL();
  _ttsUrlCache[ck] = url;
  saveTtsUrlCache();
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
    var voice = ttsPickVoice(key, ttsIsSentence(key, text));
    if (!voice) { speakBrowser(text, rate, onDone); return; }
    return ttsAudioUrl(voice, key).then(function(url) {
      if (seq !== _ttsSeq) return;
      var a = new Audio(url);
      // 瀏覽器語音 0.8 ≈ 正常；音檔本身已是 0.9 倍速，所以 0.8 → 1.0 播放
      a.playbackRate = Math.max(0.5, Math.min(1.3, rate / 0.8));
      a.preservesPitch = true;
      _ttsCurrent = a;
      var finished = false;
      var done = function() { if (finished) return; finished = true; if (_ttsCurrent === a) _ttsCurrent = null; if (onDone) onDone(); };
      a.onended = done;
      a.onerror = function() {
        // 網址失效（例如檔案重傳後 token 改變）→ 清掉這筆，下次重新取得；這次先用瀏覽器語音
        delete _ttsUrlCache[voice + '/' + key]; saveTtsUrlCache();
        if (seq === _ttsSeq) { finished = true; speakBrowser(text, rate, onDone); }
      };
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

// 清單只存種類，縮小 Firestore 文件（1 MB 上限；每筆約 25 bytes）
function ttsShortItem(item) {
  return item && item.kind === 'sentence' ? 's' : 'w';
}

// 列出 Storage 上某個資料夾已有的 mp3（listAll 是 Storage API，不受 CORS 影響）
async function ttsFilesInStorage(folder) {
  var map = {};
  try {
    var res = await storage.ref(TTS_STORAGE_DIR + '/' + folder).listAll();
    res.items.forEach(function(it) { map[it.name.replace(/\.mp3$/i, '')] = true; });
  } catch (e) { /* 列不到就全部重傳 */ }
  return map;
}

function ttsEmptyManifest() {
  return { key: TTS_SETTINGS_KEY, voices: {}, wordVoice: '', sentenceVoice: '' };
}

// ---------- 開發者模式：匯入語音包 ----------
// 選 tools/tts/output/<聲音名> 資料夾（會一併讀到 manifest.json 與 audio/*.mp3）
// 上傳到 tts/<聲音名>/；已在雲端的跳過。第一次匯入的聲音會自動設為目前使用的聲音。
async function devImportTtsPack() {
  var input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.webkitdirectory = true;
  input.setAttribute('webkitdirectory', '');
  input.onchange = async function() {
    var files = Array.from(input.files || []);
    var manifestFile = files.find(function(f) { return f.name === 'manifest.json'; });
    var mp3s = files.filter(function(f) { return /\.mp3$/i.test(f.name); });
    if (!manifestFile) { devOut('❌ 找不到 manifest.json。請選 tools\\tts\\output 裡面「聲音名稱」的資料夾（例如 Achird）。'); return; }
    if (!mp3s.length) { devOut('❌ 資料夾裡沒有 mp3。請先在電腦執行產生程式。'); return; }
    var local;
    try { local = JSON.parse(await manifestFile.text()); } catch (e) { devOut('❌ manifest.json 讀取失敗'); return; }
    var name = ttsVoiceShort(local.voice);

    await loadTtsManifest();
    var m = ttsManifest || ttsEmptyManifest();
    var isNew = !m.voices[name];
    var vEntry = m.voices[name] || { folder: name, items: {} };
    m.voices[name] = vEntry;

    var todo = mp3s.filter(function(f) {
      var key = f.name.replace(/\.mp3$/i, '');
      return local.items[key] && !vEntry.items[key];
    });
    devOut('檢查雲端已有的 ' + esc(name) + ' 音檔…');
    var already = await ttsFilesInStorage(vEntry.folder);
    var needUpload = todo.filter(function(f) {
      var key = f.name.replace(/\.mp3$/i, '');
      if (already[key]) { vEntry.items[key] = ttsShortItem(local.items[key]); return false; }
      return true;
    });
    var restored = todo.length - needUpload.length;
    todo = needUpload;
    devOut('上傳 ' + esc(name) + ' 中 0 / ' + todo.length + '（已在雲端的會跳過）');
    var done = 0, fail = 0, firstErr = '';
    var queue = todo.slice();
    async function worker() {
      while (queue.length) {
        var f = queue.shift();
        var key = f.name.replace(/\.mp3$/i, '');
        try {
          await storage.ref(TTS_STORAGE_DIR + '/' + vEntry.folder + '/' + key + '.mp3').put(f, { contentType: 'audio/mpeg', cacheControl: 'public,max-age=31536000' });
          vEntry.items[key] = ttsShortItem(local.items[key]);
          done++;
        } catch (e) {
          fail++;
          if (!firstErr) firstErr = e && (e.code || e.message);
        }
        devOut('上傳 ' + esc(name) + ' 中 ' + (done + fail) + ' / ' + todo.length + (fail ? '（失敗 ' + fail + '）' : ''));
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()]);
    if (done === 0 && restored === 0 && fail > 0) {
      devOut('❌ 全部上傳失敗（' + esc(String(firstErr)) + '）。<br>若是 storage/unauthorized，代表 Firebase Storage 規則不允許寫入 tts/ 資料夾，需要調整規則。');
      return;
    }
    // 第一次匯入這個聲音 → 自動改用它（取代原本的聲音）
    if (isNew || !m.wordVoice) { m.wordVoice = name; m.sentenceVoice = name; }
    await saveTtsManifest(m);
    devOut('✅ ' + esc(name) + '：新上傳 ' + done + ' 個' + (restored ? '、補登已在雲端的 ' + restored + ' 個' : '') +
      (fail ? '，失敗 ' + fail + ' 個（再匯入一次會補傳）' : '') +
      '。<br>目前單字用 <b>' + esc(m.wordVoice) + '</b>、句子用 <b>' + esc(m.sentenceVoice) + '</b>。可按「🎚️ 選擇聲音」調整。');
  };
  input.click();
}

// ---------- 開發者模式：選擇聲音（單字 / 句子可以不同）----------
async function devChooseTtsVoice() {
  await loadTtsManifest();
  if (!ttsManifest || !Object.keys(ttsManifest.voices).length) { devOut('還沒有語音包。'); return; }
  var names = Object.keys(ttsManifest.voices);
  function opts(sel) {
    return names.map(function(n) {
      var c = Object.keys(ttsManifest.voices[n].items || {}).length;
      return '<option value="' + esc(n) + '"' + (n === sel ? ' selected' : '') + '>' + esc(n) + '（' + c + ' 個）</option>';
    }).join('');
  }
  // 自動產生：預設 = 目前單字 + 句子用的聲音
  var auto = Array.isArray(ttsManifest.autoVoices) && ttsManifest.autoVoices.length
    ? ttsManifest.autoVoices : [ttsManifest.wordVoice, ttsManifest.sentenceVoice];
  var autoOn = ttsManifest.autoEnabled !== false;
  var checks = names.map(function(n) {
    return '<label class="tts-auto-item"><input type="checkbox" class="tts-auto-cb" value="' + esc(n) + '"' +
      (auto.indexOf(n) !== -1 ? ' checked' : '') + '> ' + esc(n) + '</label>';
  }).join('');
  devOut('<div class="tts-voice-pick">' +
    '<label>念單字：<select id="ttsWordVoice">' + opts(ttsManifest.wordVoice) + '</select></label>' +
    '<label>念句子：<select id="ttsSentenceVoice">' + opts(ttsManifest.sentenceVoice) + '</select></label>' +
    '<div class="tts-voice-btns">' +
      '<button class="dev-btn" onclick="devTtsPreview(\'ttsWordVoice\',\'apple\')">🔊 試聽單字</button>' +
      '<button class="dev-btn" onclick="devTtsPreview(\'ttsSentenceVoice\',\'\')">🔊 試聽句子</button>' +
    '</div>' +
    '<div class="tts-auto">' +
      '<label class="tts-auto-item"><input type="checkbox" id="ttsAutoOn"' + (autoOn ? ' checked' : '') + '> <b>新增/修改單字時自動產生音檔</b></label>' +
      '<div class="tts-auto-list">自動產生這些聲音：' + checks + '</div>' +
      '<small>雲端每月最多自動產生 20 萬字元（約 20 個聲音的全部單字），超過會停，不會多花錢。勾越多聲音，每個新字用的字元越多。</small>' +
    '</div>' +
    '<div class="tts-voice-btns"><button class="dev-btn" onclick="devSaveTtsVoice()">💾 儲存</button></div>' +
    '<small>單字和句子用不同聲音，孩子會聽到兩種人的發音。某個聲音沒有的字，會自動用其他聲音補上。</small>' +
  '</div>');
}

async function devSaveTtsVoice() {
  var w = document.getElementById('ttsWordVoice').value;
  var s = document.getElementById('ttsSentenceVoice').value;
  var auto = Array.from(document.querySelectorAll('.tts-auto-cb:checked')).map(function(c) { return c.value; });
  ttsManifest.wordVoice = w;
  ttsManifest.sentenceVoice = s;
  ttsManifest.autoVoices = auto;
  ttsManifest.autoEnabled = document.getElementById('ttsAutoOn').checked;
  await saveTtsManifest(ttsManifest);
  devOut('✅ 已儲存：單字用 <b>' + esc(w) + '</b>、句子用 <b>' + esc(s) + '</b>。' +
    '<br>自動產生：' + (ttsManifest.autoEnabled ? (auto.length ? esc(auto.join('、')) : '（沒勾聲音，不會產生）') : '已關閉') +
    '。平板重新打開 App 就會套用。');
}

// 試聽：用選單裡的聲音念一個這個聲音「有的」單字或例句
async function devTtsPreview(selectId, _) {
  var voice = document.getElementById(selectId).value;
  var v = ttsManifest.voices[voice];
  if (!v) return;
  var wantSentence = selectId === 'ttsSentenceVoice';
  var words = await dbGetAll('words');
  for (var i = 0; i < words.length; i++) {
    var cands = wantSentence ? (words[i].sentences || []) : [words[i].word];
    for (var j = 0; j < cands.length; j++) {
      if (!cands[j]) continue;
      var key = await ttsKey(cands[j]);
      if (v.items[key]) {
        var url = await ttsAudioUrl(voice, key);
        stopSpeaking();
        _ttsCurrent = new Audio(url);
        _ttsCurrent.play();
        return;
      }
    }
  }
  devOut('這個聲音還沒有' + (wantSentence ? '例句' : '單字') + '的音檔。');
}

// ---------- 開發者模式：重建語音清單（不用重傳）----------
// 列出 Storage 上每個聲音資料夾的 mp3，寫回清單
async function devRebuildTtsManifest() {
  devOut('列出雲端音檔中…');
  await loadTtsManifest();
  var m = ttsManifest || ttsEmptyManifest();
  // 資料夾：清單上已知的 + Storage 上 tts/ 底下所有子資料夾
  var folders = {};
  Object.keys(m.voices).forEach(function(n) { folders[m.voices[n].folder] = n; });
  try {
    var root = await storage.ref(TTS_STORAGE_DIR).listAll();
    root.prefixes.forEach(function(p) {
      if (!folders[p.name]) folders[p.name] = p.name === 'audio' ? 'Sulafat' : p.name;
    });
  } catch (e) { /* 列不到就只用已知的 */ }

  var kinds = {};
  var words = await dbGetAll('words');
  for (var i = 0; i < words.length; i++) {
    kinds[await ttsKey(words[i].word)] = 'w';
    var sens = words[i].sentences || [];
    for (var j = 0; j < sens.length; j++) if (sens[j]) { var sk = await ttsKey(sens[j]); kinds[sk] = kinds[sk] || 's'; }
  }
  var summary = [];
  var fnames = Object.keys(folders);
  for (var f = 0; f < fnames.length; f++) {
    var folder = fnames[f], name = folders[folder];
    var files = await ttsFilesInStorage(folder);
    var keys = Object.keys(files);
    if (!keys.length) { delete m.voices[name]; continue; }
    var items = {};
    keys.forEach(function(k) { items[k] = kinds[k] || 'w'; });
    m.voices[name] = { folder: folder, items: items };
    summary.push(esc(name) + ' ' + keys.length + ' 個');
  }
  if (!summary.length) { devOut('❌ 雲端 tts/ 裡沒有音檔（或沒有權限列出）。請先用「🎙️ 匯入語音包」上傳。'); return; }
  if (!m.voices[m.wordVoice]) m.wordVoice = Object.keys(m.voices)[0];
  if (!m.voices[m.sentenceVoice]) m.sentenceVoice = m.wordVoice;
  await saveTtsManifest(m);
  devOut('✅ 已重建：' + summary.join('、') + '。<br>目前單字用 <b>' + esc(m.wordVoice) + '</b>、句子用 <b>' + esc(m.sentenceVoice) + '</b>。');
}

// ---------- 開發者模式：刪除某個聲音（Storage 檔案 + 清單）----------
async function devDeleteTtsVoice() {
  await loadTtsManifest();
  if (!ttsManifest || !Object.keys(ttsManifest.voices).length) { devOut('還沒有語音包。'); return; }
  var names = Object.keys(ttsManifest.voices);
  var name = prompt('要刪除哪個聲音？輸入名稱：\n' + names.join('、'));
  if (!name || !ttsManifest.voices[name]) return;
  if (names.length === 1 && !confirm('這是最後一個聲音，刪除後全部改用瀏覽器語音。確定？')) return;
  if (!confirm('確定刪除 ' + name + ' 的全部音檔？此動作無法復原（可以之後重新產生並匯入）。')) return;
  var folder = ttsManifest.voices[name].folder;
  var keys = Object.keys(ttsManifest.voices[name].items || {});
  var done = 0, fail = 0;
  var queue = keys.slice();
  async function worker() {
    while (queue.length) {
      var k = queue.shift();
      try { await storage.ref(TTS_STORAGE_DIR + '/' + folder + '/' + k + '.mp3').delete(); done++; }
      catch (e) { if (e && e.code === 'storage/object-not-found') done++; else fail++; }
      devOut('刪除 ' + esc(name) + ' 中 ' + (done + fail) + ' / ' + keys.length);
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  delete ttsManifest.voices[name];
  ttsManifest._deleted = [name];   // 告訴 saveTtsManifest：這個聲音是刻意刪除的，不要從雲端合併回來
  if (Array.isArray(ttsManifest.autoVoices)) ttsManifest.autoVoices = ttsManifest.autoVoices.filter(function(v) { return v !== name; });
  var rest = Object.keys(ttsManifest.voices);
  if (ttsManifest.wordVoice === name) ttsManifest.wordVoice = rest[0] || '';
  if (ttsManifest.sentenceVoice === name) ttsManifest.sentenceVoice = ttsManifest.wordVoice;
  await saveTtsManifest(ttsManifest);
  Object.keys(_ttsUrlCache).forEach(function(ck) { if (ck.indexOf(name + '/') === 0) delete _ttsUrlCache[ck]; });
  saveTtsUrlCache();
  devOut('✅ 已刪除 ' + esc(name) + '（' + done + ' 個' + (fail ? '，失敗 ' + fail + ' 個' : '') + '）。' +
    (rest.length ? '目前用 <b>' + esc(ttsManifest.wordVoice) + '</b>。' : '目前改用瀏覽器語音。'));
}

// 開發者模式：語音包狀態（每個聲音有多少單字/例句）
async function devTtsStatus() {
  await loadTtsManifest();
  if (!ttsReady) { devOut('還沒有語音包，目前全部用瀏覽器語音。'); return; }
  var words = await dbGetAll('words');
  var wKeys = [], sKeys = [];
  for (var i = 0; i < words.length; i++) {
    wKeys.push(await ttsKey(words[i].word));
    var sens = words[i].sentences || [];
    for (var j = 0; j < sens.length; j++) if (sens[j]) sKeys.push(await ttsKey(sens[j]));
  }
  var rows = Object.keys(ttsManifest.voices).map(function(n) {
    var it = ttsManifest.voices[n].items || {};
    var w = wKeys.filter(function(k) { return it[k]; }).length;
    var s = sKeys.filter(function(k) { return it[k]; }).length;
    var tag = (n === ttsManifest.wordVoice ? '　← 單字' : '') + (n === ttsManifest.sentenceVoice ? '　← 句子' : '');
    return '<b>' + esc(n) + '</b>：單字 ' + w + ' / ' + wKeys.length + '、例句 ' + s + ' / ' + sKeys.length + tag;
  });
  devOut('🎙️ ' + rows.join('<br>🎙️ ') +
    '<br><small>選的聲音沒有的字，會自動用其他聲音補；都沒有才用瀏覽器語音。</small>');
}

// 啟動時載入（DB/Storage 就緒後）
if (typeof window !== 'undefined') {
  window.addEventListener('load', function() { setTimeout(loadTtsManifest, 800); });
}
