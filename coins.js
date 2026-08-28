// ===== 金幣庫（獨立模組）=====
// 覆蓋 app.js 中的 renderCoinPage, redeemCoins, renderCalendar

var pendingRedeemKey = null;
var pendingRedeemChild = null;
var REWARDS = [
  { key: '3C', name: '3C禮卷', img: './images/3C.png', weight: 10 },
  { key: 'D', name: '甜點禮卷', img: './images/D.png', weight: 20 },
  { key: 'B', name: '購物禮卷', img: './images/B.png', weight: 5 },
  { key: 'TV', name: 'TV禮卷', img: './images/TV.png', weight: 10 },
  { key: 'diamond', name: '鑽石', img: './images/diamond.png', weight: 55 },
];

// 依權重隨機抽一個寶箱獎勵（3C 10% / D 20% / B 5% / TV 10% / 鑽石 55%）
function pickWeightedReward() {
  var totalW = 0;
  for (var i = 0; i < REWARDS.length; i++) totalW += (REWARDS[i].weight || 0);
  var r = Math.random() * totalW;
  for (var j = 0; j < REWARDS.length; j++) {
    r -= (REWARDS[j].weight || 0);
    if (r < 0) return REWARDS[j];
  }
  return REWARDS[REWARDS.length - 1];
}

// 取得某小孩的禮券集合（向後相容：舊資料的 coins.rewards 視為共用，首次顯示時不動）
function getChildRewards(coins, child) {
  var fieldName = child === 'boy' ? 'rewardsBoy' : 'rewardsGirl';
  if (!coins[fieldName]) coins[fieldName] = {};
  return coins[fieldName];
}

async function renderCoinPage() {
  var daily = await getDailyData();
  var coins = await getCoins();

  // 金幣卡（兩個小孩並排）+ 圖鑑（學習地圖）入口
  document.getElementById('coinSummary').innerHTML =
    '<div class="coin-card">' +
      '<div class="coin-card-row">' +
        '<span style="font-size:3em;">👦</span>' +
        '<img src="./images/COIN_CAT.png" style="width:56px;height:56px;object-fit:contain;">' +
        '<span class="coin-card-count">' + coins.boy + '</span>' +
      '</div>' +
      '<button class="atlas-enter-btn" onclick="openAtlas(\'boy\')">🗺️ 小男生圖鑑</button>' +
    '</div>' +
    '<div class="coin-card">' +
      '<div class="coin-card-row">' +
        '<span style="font-size:3em;">👧</span>' +
        '<img src="./images/COIN_DOG.png" style="width:56px;height:56px;object-fit:contain;">' +
        '<span class="coin-card-count">' + coins.girl + '</span>' +
      '</div>' +
      '<button class="atlas-enter-btn" onclick="openAtlas(\'girl\')">🗺️ 小女生圖鑑</button>' +
    '</div>';

  // 獎勵統計（小男生 / 小女生 各一區）
  var html = '<h3 style="margin:0 0 8px;">獎勵收藏（點擊領取歸零）</h3>';
  [
    { child: 'boy', label: '👦 小男生', coinName: '貓幣', coinImg: './images/COIN_CAT.png', coinCount: coins.boy },
    { child: 'girl', label: '👧 小女生', coinName: '狗幣', coinImg: './images/COIN_DOG.png', coinCount: coins.girl }
  ].forEach(function(group) {
    var rewards = getChildRewards(coins, group.child);
    html += '<div class="reward-group">';
    html += '<div class="reward-group-title">' + group.label + '</div>';
    html += '<div class="reward-grid">';
    // 金幣本身
    html += '<div class="reward-item" onclick="askRedeem(\'' + group.child + '\',\'' + esc(group.coinName) + '\',' + group.coinCount + ',\'' + group.child + '\')">' +
      '<img src="' + group.coinImg + '" alt="' + esc(group.coinName) + '">' +
      '<span class="reward-item-name">' + esc(group.coinName) + '</span>' +
      '<span class="reward-item-count">x ' + group.coinCount + '</span>' +
    '</div>';
    // 禮券
    REWARDS.forEach(function(r) {
      var count = rewards[r.key] || 0;
      html += '<div class="reward-item' + (count === 0 ? ' reward-item-empty' : '') + '" onclick="askRedeem(\'' + r.key + '\',\'' + esc(r.name) + '\',' + count + ',\'' + group.child + '\')">' +
        '<img src="' + r.img + '" alt="' + esc(r.name) + '">' +
        '<span class="reward-item-name">' + esc(r.name) + '</span>' +
        '<span class="reward-item-count">x ' + count + '</span>' +
      '</div>';
    });
    html += '</div></div>';
  });
  document.getElementById('rewardSummary').innerHTML = html;

  renderCalendar(daily.completedDates);

  // 紀錄
  var logEl = document.getElementById('coinLog');
  if (coins.log.length === 0) {
    logEl.innerHTML = '<p style="color:#999;text-align:center;padding:20px;">還沒有紀錄</p>';
  } else {
    logEl.innerHTML = coins.log.slice(-20).reverse().map(function(l) {
      var icon = l.role === 'boy'
        ? '<img src="./images/COIN_CAT.png" style="width:24px;">'
        : (l.role === 'girl' ? '<img src="./images/COIN_DOG.png" style="width:24px;">' : '🎁');
      var text = l.redeemed
        ? '已領取 ' + l.redeemed
        : (l.chest ? '開寶箱: ' + l.chest : '+' + l.count);
      return '<div class="coin-log-item"><div class="coin-log-date">' + l.date +
        '</div><div class="coin-log-icon">' + icon +
        '</div><div class="coin-log-text">' + text + '</div></div>';
    }).join('');
  }
}

function askRedeem(key, name, count, child) {
  if (count === 0) return;
  pendingRedeemKey = key;
  pendingRedeemChild = child || null;
  document.getElementById('redeemTitle').textContent = '確定要領取嗎？';
  var who = child === 'boy' ? '👦 ' : (child === 'girl' ? '👧 ' : '');
  document.getElementById('redeemDesc').textContent = who + name + ' x ' + count + ' 將歸零';
  document.getElementById('modal-redeem').hidden = false;
}

async function confirmRedeem() {
  if (!pendingRedeemKey) return;
  var coins = await getCoins();
  if (pendingRedeemKey === 'boy') {
    coins.log.push({ role: 'boy', count: 0, date: getTodayStr(), redeemed: coins.boy });
    coins.boy = 0;
  } else if (pendingRedeemKey === 'girl') {
    coins.log.push({ role: 'girl', count: 0, date: getTodayStr(), redeemed: coins.girl });
    coins.girl = 0;
  } else {
    // 禮券：歸零「該小孩」的那一份
    var rewards = getChildRewards(coins, pendingRedeemChild || 'boy');
    coins.log.push({ role: pendingRedeemChild || '-', count: 0, date: getTodayStr(), redeemed: rewards[pendingRedeemKey] || 0, chest: pendingRedeemKey });
    rewards[pendingRedeemKey] = 0;
  }
  await saveCoins(coins);
  hideModal('modal-redeem');
  pendingRedeemKey = null;
  pendingRedeemChild = null;
  renderCoinPage();
}

// 連續遊玩的鑽石獎勵已移到 app.js 的 checkStreakDiamond（挑戰完成時觸發，連續 5 天給鑽石）

// 目前寶箱的模式與歸屬；歸屬在排入佇列時固定，避免等待期間切換角色後發錯人。
var _chestItem = { mode: 'default', child: 'boy' };

// 「玩超過 5 次」寶箱：80% 金幣 / 15% 鑽石 / 5% 禮券（4 種隨機一個）
function pickPlayReward() {
  var r = Math.random() * 100;
  if (r < 80) return { key: 'coin', name: '金幣', img: null };          // 80%
  if (r < 95) return { key: 'diamond', name: '鑽石', img: './images/diamond.png' }; // 15%
  // 5% 禮券：4 種隨機
  var vouchers = REWARDS.filter(function(x){ return x.key !== 'diamond'; });
  return vouchers[Math.floor(Math.random() * vouchers.length)];
}

// 寶箱佇列：避免多個寶箱同時彈出互相蓋掉
var _chestQueue = [];
var _chestShowing = false;

// mode: 'default' | 'play'
function showChestModal(mode, child, awardId) {
  _chestQueue.push({
    mode: mode === 'play' ? 'play' : 'default',
    child: child || ((typeof currentChild !== 'undefined') ? currentChild : 'boy'),
    awardId: awardId || null
  });
  if (!_chestShowing) _showNextChest();
}

function _showNextChest() {
  if (_chestQueue.length === 0) { _chestShowing = false; return; }
  _chestShowing = true;
  _chestItem = _chestQueue.shift();
  var img = document.getElementById('chestImg');
  img.src = './images/BOX.png';
  img.className = 'chest-img chest-shake';
  img.style.pointerEvents = 'auto';
  document.getElementById('chestStage').hidden = false;
  document.getElementById('chestReward').hidden = true;
  document.getElementById('modal-chest').hidden = false;
}

async function openChest() {
  var img = document.getElementById('chestImg');
  img.classList.remove('chest-shake');
  img.src = './images/OPEN%20BOX.png';
  img.classList.add('chest-open-anim');
  img.style.pointerEvents = 'none';
  var item = _chestItem;
  var reward = item.mode === 'play' ? pickPlayReward() : pickWeightedReward();
  setTimeout(async function() {
    document.getElementById('chestStage').hidden = true;
    document.getElementById('chestReward').hidden = false;
    // 金幣沒有圖檔 → 用寶箱所屬小孩的金幣圖
    var rewardImg = reward.img;
    if (reward.key === 'coin') {
      rewardImg = item.child === 'girl' ? './images/COIN_DOG.png' : './images/COIN_CAT.png';
    }
    document.getElementById('chestRewardImg').innerHTML = '<img src="' + rewardImg + '">';
    document.getElementById('chestRewardText').textContent = '獲得 ' + reward.name + '！';
    // 測試模式：只播動畫，不寫入獎勵
    if (typeof devSkipRewards === 'function' && devSkipRewards()) return;
    // 若同一個 pending 寶箱已領過，直接略過，避免 callback／重開重複發獎。
    if (item.awardId) {
      var playCount = await dbGet('settings', 'playCount');
      var pendingForChild = playCount && playCount.pendingChests ? playCount.pendingChests[item.child] : null;
      if (!pendingForChild || pendingForChild.id !== item.awardId) {
        document.getElementById('chestRewardText').textContent = '這個寶箱已經領過囉！';
        return;
      }
    }
    var coins = await getCoins();
    if (!Array.isArray(coins.chestAwardIds)) coins.chestAwardIds = [];
    if (item.awardId && coins.chestAwardIds.indexOf(item.awardId) !== -1) {
      var alreadyClaimed = await dbGet('settings', 'playCount');
      if (alreadyClaimed && alreadyClaimed.pendingChests && alreadyClaimed.pendingChests[item.child] && alreadyClaimed.pendingChests[item.child].id === item.awardId) {
        delete alreadyClaimed.pendingChests[item.child];
        await dbPut('settings', alreadyClaimed);
      }
      document.getElementById('chestRewardText').textContent = '這個寶箱已經領過囉！';
      return;
    }
    var child = item.child;
    if (reward.key === 'coin') {
      // 金幣直接加到該小孩的金幣數
      coins[child] = (coins[child] || 0) + 1;
    } else {
      var rewards = getChildRewards(coins, child);
      rewards[reward.key] = (rewards[reward.key] || 0) + 1;
    }
    coins.lastChestDate = getTodayStr();
    coins.log.push({ role: child, count: reward.key === 'coin' ? 1 : 0, date: getTodayStr(), chest: reward.name });
    if (item.awardId) {
      coins.chestAwardIds.push(item.awardId);
      if (coins.chestAwardIds.length > 80) coins.chestAwardIds = coins.chestAwardIds.slice(-80);
    }
    await saveCoins(coins);
    if (item.awardId) {
      var latestPlayCount = await dbGet('settings', 'playCount');
      if (latestPlayCount && latestPlayCount.pendingChests && latestPlayCount.pendingChests[item.child] && latestPlayCount.pendingChests[item.child].id === item.awardId) {
        delete latestPlayCount.pendingChests[item.child];
        await dbPut('settings', latestPlayCount);
      }
    }
  }, 800);
}

function closeChestModal() {
  hideModal('modal-chest');
  // 還有排隊的寶箱 → 接著開下一個；否則刷新金幣頁
  if (_chestQueue.length > 0) {
    setTimeout(_showNextChest, 250);
  } else {
    _chestShowing = false;
    renderCoinPage();
  }
}

// 若第六場達標後 App 在開箱前被系統回收，重開後補回尚未領取的寶箱。
async function offerPendingPlayChest() {
  var s = await dbGet('settings', 'playCount');
  if (!s || s.date !== getTodayStr() || !s.pendingChests) return;
  ['boy', 'girl'].forEach(function(child) {
    var p = s.pendingChests[child];
    if (p) showChestModal('play', child, p.id);
  });
}

// 覆蓋 renderCalendar — 用圖片代替 emoji
function renderCalendar(completedDates) {
  var now = new Date(), year = now.getFullYear(), month = now.getMonth();
  var firstDay = new Date(year, month, 1).getDay();
  var daysInMonth = new Date(year, month + 1, 0).getDate();
  var today = now.getDate();
  var mN = ['一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月'];
  var h = '<h3 style="margin-bottom:8px;">' + mN[month] + ' ' + year + '</h3><div class="calendar-grid">';
  ['日','一','二','三','四','五','六'].forEach(function(d) { h += '<div class="calendar-header">' + d + '</div>'; });
  for (var i = 0; i < firstDay; i++) h += '<div class="calendar-day empty"></div>';
  for (var d = 1; d <= daysInMonth; d++) {
    var ds = year + '-' + String(month+1).padStart(2,'0') + '-' + String(d).padStart(2,'0');
    var boy = completedDates.indexOf('boy-' + ds) !== -1;
    var girl = completedDates.indexOf('girl-' + ds) !== -1;
    var cls = 'calendar-day';
    if (boy || girl) cls += ' completed';
    if (d === today) cls += ' today';
    var icons = '';
    if (boy) icons += '<img src="./images/COIN_CAT.png" style="width:16px;">';
    if (girl) icons += '<img src="./images/COIN_DOG.png" style="width:16px;">';
    h += '<div class="' + cls + '">' + (icons || d) + '</div>';
  }
  h += '</div>';
  document.getElementById('calendarSection').innerHTML = h;
}


// ===== 滿版獎勵圖片（點擊才消失）=====
// type: 'coin' → give C.png；'diamond' → give D.png
// 點擊消失後：播放音效 + 依目前小孩飄出 COIN_CAT(小男生)/COIN_DOG(小女生) +1
function playRewardChime() {
  try {
    var c = new (window.AudioContext || window.webkitAudioContext)();
    [659.25, 783.99, 1046.5].forEach(function(f, i) {
      var o = c.createOscillator(), g = c.createGain();
      o.type = 'triangle'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, c.currentTime + i * 0.1);
      g.gain.exponentialRampToValueAtTime(0.35, c.currentTime + i * 0.1 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.01, c.currentTime + i * 0.1 + 0.35);
      o.connect(g); g.connect(c.destination);
      o.start(c.currentTime + i * 0.1); o.stop(c.currentTime + i * 0.1 + 0.35);
    });
  } catch (e) {}
}

function showCoinPlusOne(type) {
  var wrap = document.createElement('div');
  wrap.className = 'coin-plus-one';
  if (type === 'diamond') {
    // 鑽石：用 emoji 顯示 💎 +1
    wrap.innerHTML = '<div class="coin-plus-diamond">💎</div><span>+1</span>';
  } else {
    var child = (typeof currentChild !== 'undefined') ? currentChild : 'boy';
    var coinImg = child === 'girl' ? './images/COIN_DOG.png' : './images/COIN_CAT.png';
    wrap.innerHTML = '<img src="' + encodeURI(coinImg) + '" alt="coin"><span>+1</span>';
  }
  document.body.appendChild(wrap);
  setTimeout(function() { wrap.classList.add('show'); }, 30);
  setTimeout(function() { wrap.classList.remove('show'); }, 1600);
  setTimeout(function() { wrap.remove(); }, 2000);
}

function showRewardImage(type, onClose) {
  var img = type === 'diamond' ? './images/give D.png' : './images/give C.png';
  var div = document.createElement('div');
  div.className = 'reward-fullscreen';
  div.innerHTML = '<img src="' + encodeURI(img) + '" alt="獎勵">';
  div.addEventListener('click', function() {
    div.classList.remove('show');
    playRewardChime();
    showCoinPlusOne(type);
    setTimeout(function() { div.remove(); if (onClose) onClose(); }, 300);
  });
  document.body.appendChild(div);
  setTimeout(function() { div.classList.add('show'); }, 30);
}
