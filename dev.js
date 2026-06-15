// ===== 開發者模式（測試用）=====
// 開啟方式：首頁版本號連點 5 下。開啟後遊戲不寫進度、不給獎勵。
var DEV_MODE = false;
var _devTapCount = 0;
var _devTapTimer = null;

function devToggle() {
  DEV_MODE = !DEV_MODE;
  updateDevIndicator();
  if (DEV_MODE) openDevPanel();
  else closeDevPanel();
}

// 版本號連點 5 下觸發
function devTapVersion() {
  _devTapCount++;
  clearTimeout(_devTapTimer);
  _devTapTimer = setTimeout(function() { _devTapCount = 0; }, 1500);
  if (_devTapCount >= 5) {
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
        '<button class="dev-btn" onclick="devSetStability()">🎚️ 設定單字熟練度</button>' +
        '<button class="dev-btn" onclick="devPreviewAnimations()">🎬 預覽動畫</button>' +
        '<button class="dev-btn" onclick="devAddCoins()">💰 加測試金幣/鑽石</button>' +
        '<button class="dev-btn" onclick="devTestVoices()">🔊 測試語音</button>' +
        '<button class="dev-btn" onclick="devShowDataInfo()">📊 資料檢視</button>' +
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
  devOut('✅ 已重置 ' + all.length + ' 筆學習進度。所有單字回到認識期。');
}

// 🎚️ 手動設定某單字的 stability（方便測試進階遊戲門檻）
async function devSetStability() {
  var words = await dbGetByIndex('words', 'pool', 'permanent');
  if (!words.length) { devOut('沒有單字'); return; }
  var word = prompt('輸入英文單字（設定目前小孩「' + currentChild + '」的熟練度）：');
  if (!word) return;
  var target = words.find(function(w) { return w.word.toLowerCase() === word.trim().toLowerCase(); });
  if (!target) { devOut('找不到單字：' + word); return; }
  var sInput = prompt('設定 stability（0=認識, 3=熟悉, 15=應用, 40=大師）：', '15');
  var s = parseFloat(sInput);
  if (isNaN(s)) return;
  var p = fsrsInitProgress(progressId(target.id));
  p.stability = s;
  p.difficulty = 5;
  p.reps = s > 0 ? 5 : 0;
  p.state = s > 0 ? 'review' : 'new';
  p.lastReview = Date.now();
  p.due = Date.now() + Math.max(1, Math.round(s)) * 86400000;
  p.unlockedStages = s >= 40 ? [1,2,3] : s >= 15 ? [1,2] : s >= 3 ? [1] : [];
  await dbPut('progress', p);
  devOut('✅ 已把「' + target.word + '」(' + currentChild + ') 設為 S=' + s);
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

// 💰 加測試金幣/鑽石
async function devAddCoins() {
  var coins = await getCoins();
  coins.boy = (coins.boy || 0) + 10;
  coins.girl = (coins.girl || 0) + 10;
  coins.rewardsBoy = coins.rewardsBoy || {};
  coins.rewardsGirl = coins.rewardsGirl || {};
  coins.rewardsBoy['diamond'] = (coins.rewardsBoy['diamond'] || 0) + 3;
  coins.rewardsGirl['diamond'] = (coins.rewardsGirl['diamond'] || 0) + 3;
  await saveCoins(coins);
  devOut('✅ 男女各 +10 金幣、+3 鑽石');
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
  devOut(
    '永久庫單字：' + perm.length + '<br>' +
    '考試包單字：' + exam.length + '<br>' +
    '進度紀錄：' + progress.length + '（男 ' + boyP.length + ' / 女 ' + girlP.length + '）<br>' +
    '網路：' + online + '<br>' +
    'Firebase UID：' + uid
  );
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
