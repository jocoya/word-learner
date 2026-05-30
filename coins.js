// ===== 金幣庫（獨立模組）=====
// 覆蓋 app.js 中的 renderCoinPage, redeemCoins, renderCalendar

var pendingRedeemKey = null;
var pendingRedeemChild = null;
var REWARDS = [
  { key: '3C', name: '3C禮卷', img: './images/3C.png' },
  { key: 'D', name: '甜點禮卷', img: './images/D.png' },
  { key: 'B', name: '購物禮卷', img: './images/B.png' },
  { key: 'TV', name: 'TV禮卷', img: './images/TV.png' },
  { key: 'diamond', name: '鑽石', img: './images/diamond.png' },
];

// 取得某小孩的禮券集合（向後相容：舊資料的 coins.rewards 視為共用，首次顯示時不動）
function getChildRewards(coins, child) {
  var fieldName = child === 'boy' ? 'rewardsBoy' : 'rewardsGirl';
  if (!coins[fieldName]) coins[fieldName] = {};
  return coins[fieldName];
}

async function renderCoinPage() {
  var daily = await getDailyData();
  var coins = await getCoins();

  // 金幣卡（兩個小孩並排）
  document.getElementById('coinSummary').innerHTML =
    '<div class="coin-card">' +
      '<div class="coin-card-row">' +
        '<span style="font-size:3em;">👦</span>' +
        '<img src="./images/COIN_CAT.png" style="width:56px;height:56px;object-fit:contain;">' +
        '<span class="coin-card-count">' + coins.boy + '</span>' +
      '</div>' +
    '</div>' +
    '<div class="coin-card">' +
      '<div class="coin-card-row">' +
        '<span style="font-size:3em;">👧</span>' +
        '<img src="./images/COIN_DOG.png" style="width:56px;height:56px;object-fit:contain;">' +
        '<span class="coin-card-count">' + coins.girl + '</span>' +
      '</div>' +
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
    html += '<div style="display:flex;flex-wrap:wrap;gap:10px;">';
    // 金幣本身
    html += '<div class="reward-item" onclick="askRedeem(\'' + group.child + '\',\'' + esc(group.coinName) + '\',' + group.coinCount + ',\'' + group.child + '\')">' +
      '<img src="' + group.coinImg + '" alt="' + esc(group.coinName) + '">' +
      '<span class="reward-item-count">x ' + group.coinCount + '</span>' +
    '</div>';
    // 禮券
    REWARDS.forEach(function(r) {
      var count = rewards[r.key] || 0;
      html += '<div class="reward-item" onclick="askRedeem(\'' + r.key + '\',\'' + esc(r.name) + '\',' + count + ',\'' + group.child + '\')">' +
        '<img src="' + r.img + '" alt="' + esc(r.name) + '">' +
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

  // 檢查是否可以開寶箱
  checkChestReward();
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

// 寶箱邏輯
async function checkChestReward() {
  var daily = await getDailyData();
  var coins = await getCoins();
  // 收集所有完成的日期（不分角色）
  var dates = [];
  daily.completedDates.forEach(function(d) {
    var dateOnly = d.replace(/^(boy|girl)-/, '');
    if (dates.indexOf(dateOnly) === -1) dates.push(dateOnly);
  });
  dates.sort();
  var lastChestDate = coins.lastChestDate || '';
  // 計算從 lastChestDate 之後的連續天數
  var streak = 0;
  var d = new Date();
  for (var i = 0; i < 30; i++) {
    var ds = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    if (ds <= lastChestDate) break;
    if (dates.indexOf(ds) !== -1) streak++;
    else if (i > 0) break;
    d.setDate(d.getDate() - 1);
  }
  if (streak >= 7) showChestModal();
}

function showChestModal() {
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
  var reward = REWARDS[Math.floor(Math.random() * REWARDS.length)];
  setTimeout(async function() {
    document.getElementById('chestStage').hidden = true;
    document.getElementById('chestReward').hidden = false;
    document.getElementById('chestRewardImg').innerHTML = '<img src="' + reward.img + '">';
    document.getElementById('chestRewardText').textContent = '獲得 ' + reward.name + '！';
    var coins = await getCoins();
    // 寶箱獎勵歸給「目前小孩」
    var child = (typeof currentChild !== 'undefined') ? currentChild : 'boy';
    var rewards = getChildRewards(coins, child);
    rewards[reward.key] = (rewards[reward.key] || 0) + 1;
    coins.lastChestDate = getTodayStr();
    coins.log.push({ role: child, count: 0, date: getTodayStr(), chest: reward.name });
    await saveCoins(coins);
  }, 800);
}

function closeChestModal() {
  hideModal('modal-chest');
  renderCoinPage();
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
