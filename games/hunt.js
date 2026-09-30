// ===== 家中尋寶系列（三個遊戲共用核心）=====
//   hunt   🏠 家中尋寶：名詞 → 在家找到它，拍照（或直接確認）
//   mimic  🤸 動作模仿：動詞 → 做出動作，家長確認（TPR 全身反應，不拍照）
//   color  🎨 顏色尋寶：顏色/形容詞 → 找一個「是這個顏色／有這個特徵」的東西，拍照（或直接確認）
//
// 「找到過」依小孩分開記錄在 word.huntFound[child] = 時間戳（拍照或直接確認都算）：
//   新任務優先出「還沒找到過」的字；全部找過後進入「複習」，挑最久沒找的字，並顯示上次的照片。
// 照片只存 word.huntPhotos（不動原本 images），遊戲/縮圖照舊用原本圖片；
// 自家照片用在「睡前故事」與尋寶的「上次找到的」回顧。

var HUNT_ROUNDS = 5;
var HUNT_MAX_SIDE = 800;   // 照片壓縮後長邊像素（約 60–120 KB）
var HUNT_MAX_PHOTOS = 3;   // 每個單字最多保留幾張照片；超過會自動刪除最舊的（含 Storage 檔案）

// 家裡較常找得到的標籤（英文標籤，與專案標籤慣例一致）
var HUNT_HOME_TAGS = ['home', 'house', 'kitchen', 'food', 'fruit', 'vegetable', 'toy', 'toys', 'bathroom', 'bedroom',
  'living room', 'furniture', 'clothes', 'clothing', 'school', 'stationery', 'body', 'shape', 'shapes',
  'animal', 'animals', 'pet', 'drink', 'daily', 'object', 'objects', 'things', 'family', 'hobbies'];
var HUNT_COLOR_WORDS = ['red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'black', 'white', 'brown', 'gray', 'grey', 'gold', 'silver'];
// 顏色對應的畫面色塊（讓不識字的孩子也知道要找什麼顏色）
var HUNT_COLOR_HEX = { red: '#E53935', blue: '#1E88E5', green: '#43A047', yellow: '#FDD835', orange: '#FB8C00', purple: '#8E24AA',
  pink: '#F06292', black: '#212121', white: '#FAFAFA', brown: '#795548', gray: '#9E9E9E', grey: '#9E9E9E', gold: '#FFC107', silver: '#B0BEC5' };
// 摸得到、看得出的形容詞才適合「找一個這樣的東西」（抽象的 happy、kind 不適合）
var HUNT_LOOK_ADJ = ['big', 'small', 'little', 'long', 'short', 'tall', 'round', 'soft', 'hard', 'hot', 'cold', 'warm', 'cool',
  'heavy', 'light', 'new', 'old', 'clean', 'dirty', 'wet', 'dry', 'thick', 'thin', 'fat', 'full', 'empty', 'sweet', 'sour',
  'bright', 'dark', 'square', 'fast', 'slow', 'loud', 'quiet', 'smooth', 'sharp', 'fresh', 'beautiful', 'cute', 'pretty'];

// 每個遊戲的設定
var HUNT_KINDS = {
  hunt:  { icon: '🏠', title: '家中尋寶', label: '去家裡找找看：', btn: '📷 找到了！拍下來', confirm: '這是', win: '找到了！', photo: true, skip: '家裡沒有 →', empty: '沒有可以尋寶的名詞，先去新增一些家裡的東西吧（例如 cup、bed、ball）！' },
  mimic: { icon: '🤸', title: '動作模仿', label: '做出這個動作：', btn: '🤸 我做到了！', confirm: '有做出', win: '做得好！', photo: false, skip: '先跳過 →', empty: '沒有可以模仿的動作單字，先去新增一些動詞吧（例如 jump、clap、run）！' },
  color: { icon: '🎨', title: '顏色尋寶', label: '找一個這樣的東西：', btn: '📷 找到了！拍下來', confirm: '這個東西是', win: '找到了！', photo: true, skip: '家裡沒有 →', empty: '沒有顏色或形容詞單字，先去新增一些吧（例如 red、blue、soft、big）！' }
};

function huntWordKey(w) { return String(w.word || '').toLowerCase().trim(); }

// 判斷單字屬於哪個遊戲（null = 都不適合）
function huntTaskType(w) {
  var word = huntWordKey(w);
  var tags = (w.tags || []).map(function(t) { return String(t).toLowerCase(); });
  // 功能詞（a、the、of、he…）與片語（a few、in front of）無法找也無法演
  if (tags.indexOf('grammar') !== -1 || word.indexOf(' ') !== -1) return null;
  if (HUNT_COLOR_WORDS.indexOf(word) !== -1 || tags.indexOf('color') !== -1 || tags.indexOf('colors') !== -1) return 'color';
  if (w.pos === 'verb') return 'mimic';
  if (w.pos === 'adj') return HUNT_LOOK_ADJ.indexOf(word) !== -1 ? 'color' : null;
  if (w.pos === 'noun') return 'hunt';
  if (!w.pos && tags.some(function(t) { return HUNT_HOME_TAGS.indexOf(t) !== -1; })) return 'hunt';
  return null;
}

// 這個小孩上次找到這個字的時間（沒找過 = 0）
function huntFoundAt(w, child) {
  return (w.huntFound && w.huntFound[child]) || 0;
}

// 挑字：
//   1. 只挑屬於這個遊戲的字
//   2. 優先「還沒找過」的（家居標籤再優先）→ 新任務
//   3. 新任務不足 n 題 → 用「找過最久的」補成複習（避免一直重複剛找過的）
// 回傳 { items:[{word, review}], fresh: 新任務數 }
function pickHuntWords(words, n, kind, child) {
  child = child || 'boy';
  var mine = words.filter(function(w) { return huntTaskType(w) === kind; });
  var fresh = [], found = [];
  mine.forEach(function(w) {
    var home = (w.tags || []).some(function(tag) { return HUNT_HOME_TAGS.indexOf(String(tag).toLowerCase()) !== -1; });
    var at = huntFoundAt(w, child);
    if (at) found.push({ w: w, at: at });
    else fresh.push({ w: w, score: (home ? 1 : 0) + Math.random() });
  });
  fresh.sort(function(a, b) { return b.score - a.score; });
  found.sort(function(a, b) { return a.at - b.at; }); // 最久沒找的在前面
  var items = fresh.slice(0, n).map(function(x) { return { word: x.w, review: false }; });
  var freshCount = items.length;
  if (items.length < n) {
    found.slice(0, n - items.length).forEach(function(x) { items.push({ word: x.w, review: true }); });
  }
  // 新任務在前、複習在後；各自內部打亂
  var a = shuffleArray(items.filter(function(x) { return !x.review; }));
  var b = shuffleArray(items.filter(function(x) { return x.review; }));
  return { items: a.concat(b), fresh: freshCount, totalKind: mine.length, foundKind: found.length };
}

// 記錄「這個小孩找到了」（每次都更新時間，複習排序才會正確）
async function markHuntFound(wordId, child) {
  var w = await dbGet('words', wordId);
  if (!w) return;
  w.huntFound = w.huntFound || {};
  w.huntFound[child] = Date.now();
  await dbPut('words', w);
}

// 讀取相機檔案 → 縮小壓縮成 JPEG
function huntCompressPhoto(file) {
  return new Promise(function(resolve, reject) {
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function() {
      var scale = Math.min(1, HUNT_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      var canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob(function(b) {
        if (b) resolve({ blob: b, dataUrl: canvas.toDataURL('image/jpeg', 0.8) });
        else reject(new Error('照片轉檔失敗'));
      }, 'image/jpeg', 0.8);
    };
    img.onerror = function() { URL.revokeObjectURL(url); reject(new Error('照片讀取失敗')); };
    img.src = url;
  });
}

// 刪除 Storage 上的舊照片（只刪 Firebase Storage 網址；data URL 本來就只在本機資料裡）
async function deleteHuntPhotoFile(src) {
  if (!src || src.indexOf('data:') === 0 || typeof storage === 'undefined') return;
  if (src.indexOf('firebasestorage.googleapis.com') === -1 && src.indexOf('storage.googleapis.com') === -1) return;
  try { await storage.refFromURL(src).delete(); }
  catch (e) { console.warn('刪除舊尋寶照片失敗（可用「清除孤兒圖」處理）：', e.message); }
}

// 存照片：只寫 word.huntPhotos，不動 images
// 線上 → 上傳 Storage 存網址；離線/失敗 → data URL
async function saveHuntPhoto(wordId, photo) {
  var w = await dbGet('words', wordId);
  if (!w) return;
  var src = photo.dataUrl;
  if (navigator.onLine && typeof storage !== 'undefined') {
    try {
      var safe = String(w.word || 'hunt').toLowerCase().replace(/[^a-z0-9]/g, '_');
      var ref = storage.ref('word_images/hunt_' + safe + '_' + Date.now() + '.jpg');
      var snap = await ref.put(photo.blob, { contentType: 'image/jpeg' });
      src = await snap.ref.getDownloadURL();
    } catch (e) { console.warn('尋寶照片上傳失敗，改存本機：', e.message); }
  }
  // 重新讀一次：避免覆蓋 markHuntFound 剛寫入的 huntFound
  w = (await dbGet('words', wordId)) || w;
  var photos = (w.huntPhotos || []).filter(Boolean);
  photos.unshift(src);
  var removed = photos.slice(HUNT_MAX_PHOTOS);
  w.huntPhotos = photos.slice(0, HUNT_MAX_PHOTOS);
  await dbPut('words', w);
  // 資料先存好再刪舊檔，避免刪了檔案但資料沒更新
  for (var i = 0; i < removed.length; i++) await deleteHuntPhotoFile(removed[i]);
}

// kind: 'hunt' | 'mimic' | 'color'
function initHuntGame(area, words, kind) {
  kind = HUNT_KINDS[kind] ? kind : 'hunt';
  var cfg = HUNT_KINDS[kind];
  var child = (typeof currentChild !== 'undefined') ? currentChild : 'boy';
  var pick = pickHuntWords(words, Math.min(HUNT_ROUNDS, words.length), kind, child);
  var queue = pick.items;
  var total = queue.length;
  var current = 0, correct = 0;
  var gameType = kind; // FSRS 用的 gameType

  if (!total) {
    area.innerHTML = '<p style="text-align:center;color:#999;padding:40px;">' + cfg.empty + '</p>';
    return;
  }

  // 開場說明：這次有幾個新任務、幾個複習（全部找過時特別說明，避免孩子以為壞掉）
  function intro(next) {
    var msg;
    if (pick.fresh === 0) {
      msg = '🌟 全部 ' + pick.totalKind + ' 個都找過了！<br>這次來<b>複習</b>最久沒找的 ' + total + ' 個。<br><small>新增單字就會有新任務喔</small>';
    } else if (pick.fresh < total) {
      msg = '這次有 <b>' + pick.fresh + '</b> 個新任務，加上 ' + (total - pick.fresh) + ' 個複習';
    } else {
      msg = '這次有 <b>' + total + '</b> 個新任務！';
    }
    area.innerHTML = '<div class="hunt hunt-' + kind + '"><div class="hunt-intro">' +
      '<div class="hunt-intro-icon">' + cfg.icon + '</div>' +
      '<div class="hunt-intro-title">' + cfg.title + '</div>' +
      '<div class="hunt-intro-msg">' + msg + '</div>' +
      '<div class="hunt-intro-count">已找過 ' + pick.foundKind + ' / ' + pick.totalKind + '</div>' +
      '<button class="hunt-camera" id="huntGo">開始 →</button>' +
    '</div></div>';
    document.getElementById('huntGo').onclick = next;
  }

  function renderRound() {
    if (current >= total) {
      if (total <= 0) {
        // 全部都跳過 → 不算完成一場，不影響每日場次與獎勵
        area.innerHTML = '<div style="text-align:center;padding:60px 20px;">' +
          '<div style="font-size:3em;">' + cfg.icon + '</div>' +
          '<div style="font-size:1.2em;margin-top:12px;">這次都跳過了，換一批再試試！</div>' +
          '<button class="btn-primary" style="margin-top:20px;" onclick="startGame(\'' + kind + '\')">🔄 換一批</button>' +
        '</div>';
        return;
      }
      showResult(correct, total);
      return;
    }
    var item = queue[current];
    var target = item.word;
    var needPhoto = cfg.photo;
    var hintImg = getRandomImage(target);
    var lastPhoto = (target.huntPhotos && target.huntPhotos[0]) || '';
    var colorHex = HUNT_COLOR_HEX[huntWordKey(target)];
    var answered = false;
    var photo = null;
    var usedHint = false;

    area.innerHTML =
      '<div class="hunt hunt-' + kind + '">' +
        '<div class="hunt-progress">' + cfg.icon + ' ' + (current + 1) + ' / ' + total +
          (item.review ? ' <span class="hunt-review-tag">複習</span>' : ' <span class="hunt-new-tag">新任務</span>') + '</div>' +
        '<div class="hunt-mission">' +
          '<div class="hunt-label">' + cfg.label + '</div>' +
          (colorHex ? '<div class="hunt-swatch" style="background:' + colorHex + '" aria-hidden="true"></div>' : '') +
          '<div class="hunt-word">' + esc(target.word) + '</div>' +
          '<button class="hunt-speak" id="huntSpeak" aria-label="再聽一次">🔊 再聽一次</button>' +
        '</div>' +
        // 複習：先給孩子看上次自己找到的照片，喚起記憶
        (item.review && lastPhoto ? '<div class="hunt-memory hunt-memory-top"><div>上次你找到的：</div><img src="' + lastPhoto + '" alt="" onerror="this.parentElement.hidden=true"></div>' : '') +
        '<div class="hunt-hint" id="huntHint" hidden>' +
          '<div class="hunt-hint-zh">' + esc(target.meaning || '') + '</div>' +
          (hintImg ? '<img src="' + hintImg + '" alt="" onerror="this.style.display=\'none\'">' : '') +
        '</div>' +
        '<div class="hunt-photo" id="huntPhoto" hidden></div>' +
        '<div class="hunt-actions" id="huntActions">' +
          (needPhoto
            ? '<label class="hunt-camera">' + cfg.btn + '<input type="file" accept="image/*" capture="environment" id="huntFile" hidden></label>' +
              '<button class="btn-sm" id="huntFoundNoPhoto">✋ 找到了（不拍照）</button>'
            : '<button class="hunt-camera" id="huntActDone">' + cfg.btn + '</button>') +
          '<button class="btn-sm" id="huntHintBtn">💡 提示</button>' +
          '<button class="btn-sm" id="huntSkip">' + cfg.skip + '</button>' +
        '</div>' +
        '<div class="hunt-confirm" id="huntConfirm" hidden>' +
          '<div class="hunt-confirm-q">👨‍👩‍👧 家長確認：' + cfg.confirm + ' <b>' + esc(target.word) + '</b> 嗎？</div>' +
          '<div class="hunt-confirm-btns">' +
            '<button class="btn-sm btn-green" id="huntYes">✓ 對！</button>' +
            '<button class="btn-sm" id="huntRetake">↺ 再試試</button>' +
          '</div>' +
        '</div>' +
        '<div class="hunt-feedback" id="huntFeedback" role="status" aria-live="polite"></div>' +
      '</div>';

    var speak = function() { speakWord(target.word, 0.6); };
    setTimeout(speak, 300);
    setTimeout(function() { speakWord(target.word, 0.5); }, 1600);
    document.getElementById('huntSpeak').onclick = speak;

    document.getElementById('huntHintBtn').onclick = function() {
      usedHint = true;
      document.getElementById('huntHint').hidden = false;
      this.disabled = true;
    };

    function showConfirm() {
      document.getElementById('huntActions').hidden = true;
      document.getElementById('huntConfirm').hidden = false;
    }

    if (needPhoto) {
      document.getElementById('huntFile').onchange = async function(e) {
        var file = e.target.files && e.target.files[0];
        if (!file) return;
        try {
          photo = await huntCompressPhoto(file);
          var box = document.getElementById('huntPhoto');
          box.innerHTML = '<img src="' + photo.dataUrl + '" alt="拍到的照片">';
          box.hidden = false;
          showConfirm();
        } catch (err) {
          document.getElementById('huntFeedback').textContent = '⚠️ ' + err.message;
        }
        e.target.value = '';
      };
      document.getElementById('huntFoundNoPhoto').onclick = function() { finish(true); };
    } else {
      // 動作任務：孩子做完 → 家長確認
      document.getElementById('huntActDone').onclick = showConfirm;
    }

    document.getElementById('huntRetake').onclick = function() {
      photo = null;
      document.getElementById('huntPhoto').hidden = true;
      document.getElementById('huntConfirm').hidden = true;
      document.getElementById('huntActions').hidden = false;
    };

    async function finish(found) {
      if (answered) return;
      answered = true;
      document.getElementById('huntActions').hidden = true;
      document.getElementById('huntConfirm').hidden = true;
      var fb = document.getElementById('huntFeedback');
      if (found) {
        correct++;
        fb.innerHTML = '<span class="hunt-win">🎉 ' + esc(target.word) + ' — ' + cfg.win + '</span>';
        speakWord(target.word, 0.6);
        // 找到/做到 = 把英文連到生活，視為 Good；用了提示算 Hard
        await updateProgress(target.id, true, gameType, { mistakes: 0, hintUsed: usedHint ? 1 : 0 });
        // 記錄「找到過」：下次新任務不會再出這個字（全部找完才會進複習）
        await markHuntFound(target.id, child);
        if (photo) {
          fb.innerHTML += '<div class="hunt-saved">📸 照片存進「我家的 ' + esc(target.word) + '」</div>';
          saveHuntPhoto(target.id, photo).catch(function(e) { console.warn('保存照片失敗', e); });
        } else if (lastPhoto && !item.review) {
          fb.innerHTML += '<div class="hunt-memory"><div>上次你找到的：</div><img src="' + lastPhoto + '" alt="" onerror="this.parentElement.hidden=true"></div>';
        }
      } else {
        // 家裡沒有 / 先跳過：不是孩子的錯，不寫 FSRS、不扣分、不記找到，從總題數扣掉
        total--;
        fb.innerHTML = '<span class="hunt-skip">沒關係，下次再試試！</span>';
        queue.splice(current, 1);
        current--;
      }
      document.getElementById('gameScore').textContent = correct + ' / ' + Math.max(total, 0);
      setTimeout(function() { current++; renderRound(); }, photo || !lastPhoto ? 1800 : 2600);
    }

    document.getElementById('huntYes').onclick = function() { finish(true); };
    document.getElementById('huntSkip').onclick = function() { finish(false); };
  }

  intro(renderRound);
}
