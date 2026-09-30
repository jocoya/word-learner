// ===== 開發者模式（測試用）=====
// 開啟方式：首頁標題或版本號連點 3 下。開啟後遊戲不寫進度、不給獎勵。
var DEV_MODE = false;
var _devTapCount = 0;
var _devTapTimer = null;

function devToggle() {
  DEV_MODE = !DEV_MODE;
  updateDevIndicator();
  if (DEV_MODE) openDevPanel();
  else closeDevPanel();
}

// 標題/版本號連點觸發（3 下、2 秒內）
function devTapVersion() {
  _devTapCount++;
  clearTimeout(_devTapTimer);
  _devTapTimer = setTimeout(function() { _devTapCount = 0; }, 2000);
  if (_devTapCount >= 3) {
    _devTapCount = 0;
    devToggle();
  }
}

function updateDevIndicator() {
  var el = document.getElementById('devIndicator');
  if (!el) {
    el = document.createElement('div');
    el.id = 'devIndicator';
    el.className = 'dev-indicator';
    el.textContent = '🛠️ 測試模式';
    el.onclick = openDevPanel;
    document.body.appendChild(el);
  }
  el.style.display = DEV_MODE ? 'block' : 'none';
}

function openDevPanel() {
  var modal = document.getElementById('modal-dev');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-dev';
    modal.className = 'modal';
    document.body.appendChild(modal);
  }
  modal.innerHTML =
    '<div class="modal-content dev-panel">' +
      '<h3>🛠️ 開發者工具</h3>' +
      '<div class="dev-status">測試模式：<b style="color:' + (DEV_MODE ? '#4CAF50' : '#f44336') + '">' + (DEV_MODE ? '開啟（不寫進度/不給獎勵）' : '關閉') + '</b></div>' +
      '<div class="dev-btns">' +
        '<button class="dev-btn" onclick="devToggleMode()">' + (DEV_MODE ? '🔴 關閉測試模式' : '🟢 開啟測試模式') + '</button>' +
        '<button class="dev-btn dev-danger" onclick="devResetProgress()">♻️ 重置所有學習進度</button>' +
        '<button class="dev-btn" onclick="devResetToday()">🔄 重置今日觸發（小怪物/每日挑戰）</button>' +
        '<button class="dev-btn" onclick="devSetStability()">🎚️ 設定單字熟練度（列表）</button>' +
        '<button class="dev-btn" onclick="devPreviewAnimations()">🎬 預覽動畫</button>' +
        '<button class="dev-btn" onclick="devAddCoins()">💰 增加金幣/鑽石（可選數量）</button>' +
        '<button class="dev-btn" onclick="devTestVoices()">🔊 測試語音</button>' +
        '<button class="dev-btn" onclick="devImportTtsPack()">🎙️ 匯入語音包</button>' +
        '<button class="dev-btn" onclick="devChooseTtsVoice()">🎚️ 選擇聲音（單字/句子）</button>' +
        '<button class="dev-btn" onclick="devTtsStatus()">📈 語音包狀態</button>' +
        '<button class="dev-btn" onclick="devRebuildTtsManifest()">🧩 重建語音清單（不用重傳）</button>' +
        '<button class="dev-btn dev-danger" onclick="devDeleteTtsVoice()">🗑️ 刪除某個聲音</button>' +
        '<button class="dev-btn" onclick="devShowDataInfo()">📊 資料檢視</button>' +
        '<button class="dev-btn" onclick="openCloudManager()">☁️ 雲端圖片管理</button>' +
        '<button class="dev-btn" onclick="devToggleFastMode()">⏩ 快速模式：' + (window.DEV_FAST ? '開' : '關') + '</button>' +
      '</div>' +
      '<div class="dev-output" id="devOutput"></div>' +
      '<button class="btn-ghost" onclick="hideModal(\'modal-dev\')">關閉</button>' +
    '</div>';
  modal.hidden = false;
}

function closeDevPanel() {
  var modal = document.getElementById('modal-dev');
  if (modal) modal.hidden = true;
}

function devOut(msg) {
  var o = document.getElementById('devOutput');
  if (o) o.innerHTML = msg;
}

function devToggleMode() {
  DEV_MODE = !DEV_MODE;
  updateDevIndicator();
  openDevPanel();
}

// ♻️ 重置所有學習進度（清 progress，保留單字與金幣）
async function devResetProgress() {
  if (!confirm('確定重置所有學習進度？\n（所有單字回到認識期，單字內容和金幣不受影響。此動作無法復原，建議先匯出備份）')) return;
  var all = await dbGetAll('progress');
  for (var i = 0; i < all.length; i++) {
    await dbDelete('progress', all[i].wordId);
  }
  // 一併清掉「已認識的新朋友」名單 + 地圖島通關紀錄，讓認識新朋友/地圖也重來
  await dbPut('settings', { key: 'metFriends', boy: {}, girl: {} });
  await dbPut('settings', { key: 'atlasCleared', boy: {}, girl: {} });
  devOut('✅ 已重置 ' + all.length + ' 筆學習進度（含新朋友名單、地圖通關）。所有單字回到認識期。');
}

// 🔄 重置今日觸發：清掉今天的小怪物 + 每日挑戰標記，讓它們能立刻再觸發
async function devResetToday() {
  var today = getTodayStr();
  // 小怪物：清兩個小孩的 monsterDone
  await dbPut('settings', { key: 'monsterDone-boy', value: '' });
  await dbPut('settings', { key: 'monsterDone-girl', value: '' });
  // 每日挑戰金幣：清今天的 coinEarned 標記 + 今日完成日期
  var coins = await getCoins();
  delete coins['coinEarned-boy-' + today];
  delete coins['coinEarned-girl-' + today];
  if (coins.lastStreakRewardDate === today) coins.lastStreakRewardDate = '';
  if (coins.lastStreakChestDate === today) coins.lastStreakChestDate = '';
  await saveCoins(coins);
  // 認識新朋友橫幅：清今天的次數，讓橫幅再出現
  await dbPut('settings', { key: 'bannerLearn', date: today, count: 0 });
  // 首頁「認識新朋友」今日鑽石：清掉讓它能再領
  await dbPut('settings', { key: 'learnDiamond', date: today, boy: false, girl: false });
  // 每日遊戲次數 + 玩超過5次寶箱：清掉讓它能再觸發
  await dbPut('settings', { key: 'playCount', date: today, boy: 0, girl: 0, chestBoy: false, chestGirl: false, completionIds: [], pendingChests: {} });
  var daily = await getDailyData();
  if (daily.completedDates) {
    daily.completedDates = daily.completedDates.filter(function(d) {
      return d !== 'boy-' + today && d !== 'girl-' + today;
    });
  }
  await saveDailyData(daily);
  devOut('✅ 已重置今日觸發。回首頁選小孩進模式 → 小怪物會再跳；每日挑戰金幣也可再領。');
}
async function devSetStability() {
  var words = await dbGetByIndex('words', 'pool', 'permanent');
  if (!words.length) { devOut('沒有單字'); return; }
  words.sort(function(a, b) { return a.word.toLowerCase().localeCompare(b.word.toLowerCase()); });

  var modal = document.getElementById('modal-dev');
  var rows = '';
  for (var i = 0; i < words.length; i++) {
    var w = words[i];
    var s = await getWordStability(w.id);
    var stage = s >= 40 ? '大師' : s >= 15 ? '應用' : s >= 3 ? '熟悉' : '認識';
    rows += '<div class="devword-row">' +
      '<span class="devword-name">' + esc(w.word) + ' <small>S=' + s.toFixed(1) + ' ' + stage + '</small></span>' +
      '<span class="devword-btns">' +
        '<button onclick="devApplyStability(' + w.id + ',0)">認識</button>' +
        '<button onclick="devApplyStability(' + w.id + ',3)">熟悉</button>' +
        '<button onclick="devApplyStability(' + w.id + ',15)">應用</button>' +
        '<button onclick="devApplyStability(' + w.id + ',40)">大師</button>' +
      '</span>' +
    '</div>';
  }
  modal.innerHTML =
    '<div class="modal-content dev-panel">' +
      '<h3>🎚️ 設定熟練度（' + (currentChild === 'boy' ? '👦 小男生' : '👧 小女生') + '）</h3>' +
      '<div class="devword-list">' + rows + '</div>' +
      '<button class="btn-ghost" onclick="openDevPanel()">← 返回工具</button>' +
    '</div>';
  modal.hidden = false;
}

// 套用某單字的熟練度（給目前小孩）
async function devApplyStability(wordId, s) {
  var p = fsrsInitProgress(progressId(wordId));
  p.stability = s;
  p.difficulty = 5;
  p.reps = s > 0 ? 5 : 0;
  p.state = s > 0 ? 'review' : 'new';
  p.lastReview = Date.now();
  p.due = Date.now() + Math.max(1, Math.round(s)) * 86400000;
  p.unlockedStages = s >= 40 ? [1,2,3] : s >= 15 ? [1,2] : s >= 3 ? [1] : [];
  await dbPut('progress', p);
  devSetStability(); // 重新整理列表
}

// 🎬 預覽動畫
function devPreviewAnimations() {
  hideModal('modal-dev');
  var seq = [
    function() { if (typeof showLevelUpAnimation === 'function') showLevelUpAnimation(1); },
    function() { if (typeof showLevelUpAnimation === 'function') showLevelUpAnimation(2); },
    function() { if (typeof showLevelUpAnimation === 'function') showLevelUpAnimation(3); },
    function() { if (typeof showChestModal === 'function') showChestModal(); }
  ];
  var i = 0;
  function next() {
    if (i >= seq.length) { openDevPanel(); return; }
    seq[i](); i++;
    setTimeout(next, 2800);
  }
  next();
}

// 💰 加金幣/鑽石：可選對象、類型、數量
function devAddCoins() {
  var modal = document.getElementById('modal-dev');
  modal.innerHTML =
    '<div class="modal-content dev-panel">' +
      '<h3>💰 增加金幣 / 鑽石</h3>' +
      '<div class="devadd-row"><label>對象</label>' +
        '<select id="devAddWho">' +
          '<option value="boy">👦 小男生</option>' +
          '<option value="girl">👧 小女生</option>' +
        '</select></div>' +
      '<div class="devadd-row"><label>類型</label>' +
        '<select id="devAddType">' +
          '<option value="coin">🪙 金幣</option>' +
          '<option value="diamond">💎 鑽石</option>' +
          '<option value="3C">3C禮卷</option>' +
          '<option value="D">甜點禮卷</option>' +
          '<option value="B">購物禮卷</option>' +
          '<option value="TV">TV禮卷</option>' +
        '</select></div>' +
      '<div class="devadd-row"><label>數量</label>' +
        '<input type="number" id="devAddAmount" value="10" min="-999" max="999"></div>' +
      '<button class="dev-btn" onclick="devApplyAddCoins()">✅ 增加</button>' +
      '<div class="dev-output" id="devOutput"></div>' +
      '<button class="btn-ghost" onclick="openDevPanel()">← 返回工具</button>' +
    '</div>';
  modal.hidden = false;
}

async function devApplyAddCoins() {
  var who = document.getElementById('devAddWho').value;
  var type = document.getElementById('devAddType').value;
  var amount = parseInt(document.getElementById('devAddAmount').value) || 0;
  var coins = await getCoins();
  if (type === 'coin') {
    coins[who] = Math.max(0, (coins[who] || 0) + amount);
  } else {
    var field = who === 'boy' ? 'rewardsBoy' : 'rewardsGirl';
    coins[field] = coins[field] || {};
    coins[field][type] = Math.max(0, (coins[field][type] || 0) + amount);
  }
  await saveCoins(coins);
  var label = type === 'coin' ? '金幣' : (type === 'diamond' ? '鑽石' : type + '禮卷');
  devOut('✅ ' + (who === 'boy' ? '小男生' : '小女生') + ' ' + label + ' ' + (amount >= 0 ? '+' : '') + amount);
}

// 🔊 測試語音：依序念出前 10 個單字
async function devTestVoices() {
  var words = await dbGetByIndex('words', 'pool', 'permanent');
  words = words.slice(0, 10);
  devOut('🔊 念出 ' + words.length + ' 個單字...');
  var i = 0;
  function next() {
    if (i >= words.length) return;
    if (typeof speakWord === 'function') speakWord(words[i].word, 0.8);
    i++;
    setTimeout(next, 1500);
  }
  next();
}

// 📊 資料檢視
async function devShowDataInfo() {
  var words = await dbGetAll('words');
  var perm = words.filter(function(w){ return w.pool === 'permanent'; });
  var exam = words.filter(function(w){ return w.pool && w.pool.indexOf('exam-') === 0; });
  var progress = await dbGetAll('progress');
  var boyP = progress.filter(function(p){ return typeof p.wordId === 'string' && p.wordId.indexOf('_boy') !== -1; });
  var girlP = progress.filter(function(p){ return typeof p.wordId === 'string' && p.wordId.indexOf('_girl') !== -1; });
  var online = navigator.onLine ? '🟢 連線' : '🔴 離線';
  var uid = (typeof currentUserId !== 'undefined' && currentUserId) ? currentUserId.slice(0, 8) + '...' : '(無)';
  var base =
    '永久庫單字：' + perm.length + '<br>' +
    '考試包單字：' + exam.length + '<br>' +
    '進度紀錄：' + progress.length + '（男 ' + boyP.length + ' / 女 ' + girlP.length + '）<br>' +
    '網路：' + online + '<br>' +
    'Firebase UID：' + uid;
  devOut(base + '<br><br>💾 計算平板空間中…');
  var usage = await devStorageUsage(words);
  devOut(base + '<br><br>' + usage);
}

function devFmtSize(bytes) {
  if (!bytes) return '0 KB';
  if (bytes < 1048576) return Math.max(1, Math.round(bytes / 1024)) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

// 💾 平板空間：媒體快取（圖片/音檔分開算）、程式快取、單字資料、瀏覽器總用量
async function devStorageUsage(words) {
  var lines = ['<b>💾 平板空間</b>'];
  try {
    var img = { n: 0, b: 0 }, aud = { n: 0, b: 0 }, other = { n: 0, b: 0 }, app = { n: 0, b: 0 };
    if ('caches' in window) {
      var names = await caches.keys();
      for (var i = 0; i < names.length; i++) {
        var c = await caches.open(names[i]);
        var reqs = await c.keys();
        var isMedia = names[i].indexOf('media') !== -1;
        for (var j = 0; j < reqs.length; j++) {
          var res = await c.match(reqs[j]);
          var size = 0;
          // opaque（跨網域 no-cors）讀不到內容大小，只算數量
          if (res && res.type !== 'opaque') {
            var len = Number(res.headers.get('Content-Length') || 0);
            size = len || (await res.clone().blob()).size;
          }
          var u = decodeURIComponent(reqs[j].url);
          var bucket = !isMedia ? app
            : (/\/tts\/|\.mp3/i.test(u) ? aud : (/\.(jpe?g|png|webp|gif)|word_images|images/i.test(u) ? img : other));
          bucket.n++; bucket.b += size;
        }
      }
    }
    lines.push('🖼️ 圖片快取：' + img.n + ' 張，' + devFmtSize(img.b));
    lines.push('🔊 音檔快取：' + aud.n + ' 個，' + devFmtSize(aud.b));
    if (other.n) lines.push('📦 其他媒體：' + other.n + ' 個，' + devFmtSize(other.b));
    lines.push('⚙️ 程式檔案：' + devFmtSize(app.b));
  } catch (e) {
    lines.push('快取統計失敗：' + e.message);
  }
  // 單字資料裡直接存的圖片（舊版拍照、離線時拍的照片是 data URL，會跟著資料同步）
  var inline = 0, inlineN = 0;
  (words || []).forEach(function(w) {
    getAllImages(w).concat(w.huntPhotos || []).forEach(function(s) {
      if (s && String(s).indexOf('data:') === 0) { inline += s.length * 0.75; inlineN++; }
    });
  });
  lines.push('📝 單字資料內的照片：' + inlineN + ' 張，約 ' + devFmtSize(inline));
  try {
    if (navigator.storage && navigator.storage.estimate) {
      var est = await navigator.storage.estimate();
      var persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
      lines.push('📊 這個 App 總共使用：' + devFmtSize(est.usage || 0) +
        (est.quota ? '（瀏覽器允許上限約 ' + devFmtSize(est.quota) + '）' : ''));
      lines.push('🔒 持久保存：' + (persisted ? '是（空間不足時不會被自動清掉）' : '否'));
    }
  } catch (e) {}
  lines.push('<small>想釋放空間：首頁上方的「🗑️ 清除快取」，單字與進度不受影響。</small>');
  return lines.join('<br>');
}

// ⏩ 快速模式（縮短遊戲間等待）
function devToggleFastMode() {
  window.DEV_FAST = !window.DEV_FAST;
  openDevPanel();
}

// 給其他模組查詢：是否該跳過進度/獎勵
function devSkipRewards() {
  return DEV_MODE === true;
}
