// ===== 家中尋寶 =====
// App 念出一個單字 → 依單字類型給任務：
//   find   名詞：在家找到它，拍照（或直接確認）
//   act    動詞：做出這個動作，家長確認（TPR 全身反應，不拍照）
//   look   形容詞/顏色：找一個「有這個特徵」的東西，拍照（或直接確認）
// 照片只存在 word.huntPhotos（不動原本的 images），遊戲/縮圖照舊用原本圖片；
// 自家照片只用在「睡前故事」與尋寶的「上次找到的」回顧。

var HUNT_ROUNDS = 5;
var HUNT_MAX_SIDE = 800;   // 照片壓縮後長邊像素（約 60–120 KB）
var HUNT_MAX_PHOTOS = 3;   // 每個單字最多保留幾張照片；超過會自動刪除最舊的（含 Storage 檔案）

// 家裡較常找得到的標籤（英文標籤，與專案標籤慣例一致）
var HUNT_HOME_TAGS = ['home', 'house', 'kitchen', 'food', 'fruit', 'vegetable', 'toy', 'toys', 'bathroom', 'bedroom',
  'living room', 'furniture', 'clothes', 'clothing', 'school', 'stationery', 'body', 'color', 'colors', 'shape', 'shapes',
  'animal', 'animals', 'pet', 'drink', 'daily', 'object', 'objects', 'things'];
var HUNT_COLOR_WORDS = ['red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'black', 'white', 'brown', 'gray', 'grey', 'gold', 'silver'];

// 判斷單字要出哪種任務
function huntTaskType(w) {
  var word = String(w.word || '').toLowerCase().trim();
  var tags = (w.tags || []).map(function(t) { return String(t).toLowerCase(); });
  if (HUNT_COLOR_WORDS.indexOf(word) !== -1 || tags.indexOf('color') !== -1 || tags.indexOf('colors') !== -1) return 'look';
  if (w.pos === 'verb') return 'act';
  if (w.pos === 'adj') return 'look';
  if (w.pos === 'noun') return 'find';
  if (tags.some(function(t) { return HUNT_HOME_TAGS.indexOf(t) !== -1; })) return 'find';
  return null; // 詞性不明、也沒有家居標籤 → 不適合尋寶
}

// 挑字：名詞/家居為主，再混入動作與顏色任務，讓名詞少時也玩得起來
function pickHuntWords(words, n) {
  var groups = { find: [], act: [], look: [] };
  words.forEach(function(w) {
    var t = huntTaskType(w);
    if (!t) return;
    var home = (w.tags || []).some(function(tag) { return HUNT_HOME_TAGS.indexOf(String(tag).toLowerCase()) !== -1; });
    groups[t].push({ w: w, task: t, score: (home ? 1 : 0) + Math.random() });
  });
  Object.keys(groups).forEach(function(k) { groups[k].sort(function(a, b) { return b.score - a.score; }); });

  // 目標配額：約 3 找物品 + 1 動作 + 1 顏色；不足的由其他類補
  var quota = { find: Math.ceil(n * 0.6), act: Math.max(1, Math.floor(n * 0.2)), look: Math.max(1, Math.floor(n * 0.2)) };
  var picked = [];
  ['find', 'act', 'look'].forEach(function(k) { picked = picked.concat(groups[k].splice(0, quota[k])); });
  var rest = groups.find.concat(groups.act, groups.look).sort(function(a, b) { return b.score - a.score; });
  while (picked.length < n && rest.length) picked.push(rest.shift());
  // 真的湊不到時（例如全部詞性不明），退回任意單字當「找物品」
  if (picked.length < n) {
    var usedIds = picked.map(function(x) { return x.w.id; });
    shuffleArray(words.filter(function(w) { return usedIds.indexOf(w.id) === -1; }))
      .slice(0, n - picked.length)
      .forEach(function(w) { picked.push({ w: w, task: 'find', score: 0 }); });
  }
  return shuffleArray(picked.slice(0, n)).map(function(x) { return { word: x.w, task: x.task }; });
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
  var photos = (w.huntPhotos || []).filter(Boolean);
  photos.unshift(src);
  var removed = photos.slice(HUNT_MAX_PHOTOS);
  w.huntPhotos = photos.slice(0, HUNT_MAX_PHOTOS);
  await dbPut('words', w);
  // 資料先存好再刪舊檔，避免刪了檔案但資料沒更新
  for (var i = 0; i < removed.length; i++) await deleteHuntPhotoFile(removed[i]);
}

// 任務文字
function huntTaskText(task) {
  if (task === 'act') return { label: '做出這個動作：', btn: '🤸 我做到了！', confirm: '做出來了嗎？', win: '做得好！' };
  if (task === 'look') return { label: '找一個這樣的東西：', btn: '📷 找到了！拍下來', confirm: '這個東西是', win: '找到了！' };
  return { label: '去家裡找找看：', btn: '📷 找到了！拍下來', confirm: '這是', win: '找到了！' };
}

function initHuntGame(area, words) {
  var queue = pickHuntWords(words, Math.min(HUNT_ROUNDS, words.length));
  var total = queue.length;
  var current = 0, correct = 0;

  if (!total) {
    area.innerHTML = '<p style="text-align:center;color:#999;padding:40px;">沒有可以尋寶的單字，先去新增一些名詞、動詞或顏色吧！</p>';
    return;
  }

  function renderRound() {
    if (current >= total) {
      if (total <= 0) {
        // 全部都「家裡沒有」→ 不算完成一場，不影響每日場次與獎勵
        area.innerHTML = '<div style="text-align:center;padding:60px 20px;">' +
          '<div style="font-size:3em;">🏠</div>' +
          '<div style="font-size:1.2em;margin-top:12px;">這次的東西家裡都沒有，換一批再試試！</div>' +
          '<button class="btn-primary" style="margin-top:20px;" onclick="startGame(\'hunt\')">🔄 換一批</button>' +
        '</div>';
        return;
      }
      showResult(correct, total);
      return;
    }
    var item = queue[current];
    var target = item.word;
    var task = item.task;
    var txt = huntTaskText(task);
    var needPhoto = task !== 'act';
    var hintImg = getRandomImage(target);
    var lastPhoto = (target.huntPhotos && target.huntPhotos[0]) || '';
    var answered = false;
    var photo = null;
    var usedHint = false;

    area.innerHTML =
      '<div class="hunt hunt-' + task + '">' +
        '<div class="hunt-progress">🔎 尋寶 ' + (current + 1) + ' / ' + total + '</div>' +
        '<div class="hunt-mission">' +
          '<div class="hunt-label">' + txt.label + '</div>' +
          '<div class="hunt-word">' + esc(target.word) + '</div>' +
          '<button class="hunt-speak" id="huntSpeak" aria-label="再聽一次">🔊 再聽一次</button>' +
        '</div>' +
        '<div class="hunt-hint" id="huntHint" hidden>' +
          '<div class="hunt-hint-zh">' + esc(target.meaning || '') + '</div>' +
          (hintImg ? '<img src="' + hintImg + '" alt="" onerror="this.style.display=\'none\'">' : '') +
        '</div>' +
        '<div class="hunt-photo" id="huntPhoto" hidden></div>' +
        '<div class="hunt-actions" id="huntActions">' +
          (needPhoto
            ? '<label class="hunt-camera">' + txt.btn + '<input type="file" accept="image/*" capture="environment" id="huntFile" hidden></label>' +
              '<button class="btn-sm" id="huntFoundNoPhoto">✋ 找到了（不拍照）</button>'
            : '<button class="hunt-camera" id="huntActDone">' + txt.btn + '</button>') +
          '<button class="btn-sm" id="huntHintBtn">💡 提示</button>' +
          '<button class="btn-sm" id="huntSkip">' + (task === 'act' ? '先跳過 →' : '家裡沒有 →') + '</button>' +
        '</div>' +
        '<div class="hunt-confirm" id="huntConfirm" hidden>' +
          '<div class="hunt-confirm-q">👨‍👩‍👧 家長確認：' + txt.confirm + ' <b>' + esc(target.word) + '</b> 嗎？</div>' +
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
        fb.innerHTML = '<span class="hunt-win">🎉 ' + esc(target.word) + ' — ' + txt.win + '</span>';
        speakWord(target.word, 0.6);
        // 找到/做到 = 把英文連到生活，視為 Good；用了提示算 Hard
        await updateProgress(target.id, true, 'hunt', { mistakes: 0, hintUsed: usedHint ? 1 : 0 });
        if (photo) {
          fb.innerHTML += '<div class="hunt-saved">📸 照片存進「我家的 ' + esc(target.word) + '」</div>';
          saveHuntPhoto(target.id, photo).catch(function(e) { console.warn('保存照片失敗', e); });
        } else if (lastPhoto) {
          // 沒拍新照片，但以前拍過 → 回顧一下
          fb.innerHTML += '<div class="hunt-memory"><div>上次你找到的：</div><img src="' + lastPhoto + '" alt="" onerror="this.parentElement.hidden=true"></div>';
        }
      } else {
        // 家裡沒有 / 先跳過：不是孩子的錯，不寫 FSRS、不扣分，從總題數扣掉
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

  renderRound();
}
