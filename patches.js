// ===== 覆蓋 app.js 的函式 =====

// 遊戲來源選擇 + 標籤篩選
async function updateGameSource() {
  var tagSel = document.getElementById('gameTagFilter');
  if (tagSel) {
    var tags = await getAllTags();
    var cur = tagSel.value;
    tagSel.innerHTML = '<option value="all">所有標籤</option>';
    tags.forEach(function(t) {
      tagSel.innerHTML += '<option value="' + esc(t) + '"' + (t === cur ? ' selected' : '') + '>' + esc(t) + '</option>';
    });
  }
}

async function getGameWords() {
  var source = document.getElementById('gameSource') ? document.getElementById('gameSource').value : 'permanent';
  var tagFilter = document.getElementById('gameTagFilter') ? document.getElementById('gameTagFilter').value : 'all';
  var words;
  if (source.indexOf('exam-') === 0) {
    words = currentGameWords.length > 0 ? currentGameWords : await dbGetByIndex('words', 'pool', source);
  } else if (source === 'due') {
    words = await getDueWords('permanent');
    if (words.length < 4) words = await dbGetByIndex('words', 'pool', 'permanent');
  } else {
    words = await dbGetByIndex('words', 'pool', 'permanent');
  }
  if (tagFilter !== 'all') {
    words = words.filter(function(w) { return w.tags && w.tags.indexOf(tagFilter) !== -1; });
  }
  if (words.length < 4) { alert('單字不夠，至少需要 4 個！'); return null; }
  return shuffleArray(words);
}

// 每日挑戰改回可選遊戲
function startDailyWithRole(role) {
  dailyRole = role;
  currentMode = 'kid';
  renderGameCards();
  document.getElementById('gamesTitle').textContent = (role === 'boy' ? '👦' : '👧') + ' 每日挑戰 — 選一個遊戲';
  var srcEl = document.getElementById('gameSource');
  if (srcEl) {
    srcEl.value = 'due';
    srcEl.parentElement.style.display = '';
  }
  updateGameSource();
  goTo('page-games');
}

// ===== 圖片預載 =====
function preloadImages(words) {
  words.forEach(function(w) {
    var imgs = getAllImages(w);
    imgs.forEach(function(url) {
      if (url && url.indexOf('http') === 0) {
        var img = new Image();
        img.src = url;
      }
    });
  });
}

// 覆蓋 startGame 加入預載
var _originalStartGame = startGame;
startGame = async function(gameId) {
  var words = await getGameWords();
  if (!words) return;
  // 預載圖片
  preloadImages(words);
  currentGameWords = words;
  document.getElementById('gameTitle').textContent = GAMES.find(function(g){return g.id===gameId;}).name;
  document.getElementById('gameScore').textContent = '';
  goTo('page-game');
  var area = document.getElementById('gameArea');
  area.innerHTML = '<div style="text-align:center;padding:40px;color:#999;">載入中...</div>';
  // 等一下讓圖片有時間載入
  setTimeout(function() {
    area.innerHTML = '';
    switch (gameId) {
      case 'memory':    initMemoryGame(area, words, currentMode); break;
      case 'listen':    initListenGame(area, words, currentMode); break;
      case 'fillblank': initFillBlankGame(area, words); break;
      case 'spelling':  initSpellingGame(area, words); break;
      case 'speak':     initSpeakGame(area, words); break;
      case 'bubble':    initBubbleGame(area, words); break;
      case 'echo':      initEchoGame(area, words); break;
      case 'flashlight':initFlashlightGame(area, words); break;
      case 'detective': initDetectiveGame(area, words); break;
    }
  }, 500);
};

// ===== FSRS 整合的多巴胺系統 =====
// 同一場挑戰的連擊計數
var sessionEasyStreak = 0;
var sessionDiamondsEarned = 0;
var sessionStageUnlocks = [];

function resetSession() {
  sessionEasyStreak = 0;
  sessionDiamondsEarned = 0;
  sessionStageUnlocks = [];
}

// 統一的遊戲結算入口（取代原本各遊戲的 updateProgress）
async function finishWordRound(payload) {
  if (!payload || !payload.wordId) return;
  var result = await recordGameResult(payload);

  // 連續 3 題 Easy 且該單字今天第一次複習 → 給鑽石
  if (result.isEasy && result.isFirstToday) {
    sessionEasyStreak++;
    if (sessionEasyStreak >= 3) {
      sessionEasyStreak = 0;
      sessionDiamondsEarned++;
      var coins = await getCoins();
      coins.rewards = coins.rewards || {};
      coins.rewards['diamond'] = (coins.rewards['diamond'] || 0) + 1;
      coins.log.push({ role: '-', count: 0, date: getTodayStr(), chest: '💎 連續 Easy 鑽石' });
      await saveCoins(coins);
      showFloatingReward('💎 +1', '#00bcd4');
    }
  } else if (!result.isEasy) {
    sessionEasyStreak = 0;
  }

  // 階段升級 → 寶箱
  if (result.stageUnlocked) {
    sessionStageUnlocks.push(result.stageUnlocked);
    showStageUpAnimation(result.stageUnlocked);
    setTimeout(function() { showChestModal(); }, 1500);
  }

  return result;
}

function showFloatingReward(text, color) {
  var div = document.createElement('div');
  div.className = 'floating-reward';
  div.style.color = color || '#FFD700';
  div.textContent = text;
  document.body.appendChild(div);
  setTimeout(function() { div.remove(); }, 1800);
}

function showStageUpAnimation(stage) {
  var stageNames = ['', '熟悉期', '應用期', '大師期'];
  var div = document.createElement('div');
  div.className = 'stage-up-banner';
  div.innerHTML = '<div class="stage-up-icon">🌟</div><div class="stage-up-text">單字升級到 ' + stageNames[stage] + '！</div>';
  document.body.appendChild(div);
  setTimeout(function() { div.classList.add('show'); }, 50);
  setTimeout(function() { div.classList.remove('show'); }, 2500);
  setTimeout(function() { div.remove(); }, 3000);
}

// 包裝 updateProgress：保留多巴胺，把 FSRS 邏輯接進來
var _originalUpdateProgress = updateProgress;
updateProgress = async function(wordId, correct, gameType, extra) {
  // 如果有 gameType，走完整的 FSRS 流程
  if (gameType) {
    var payload = {
      wordId: wordId,
      gameType: gameType,
      mistakes: extra && extra.mistakes != null ? extra.mistakes : (correct ? 0 : 1),
      timeUsed: extra && extra.timeUsed != null ? extra.timeUsed : 0,
      hintUsed: extra && extra.hintUsed != null ? extra.hintUsed : 0
    };
    return await finishWordRound(payload);
  }
  // 沒有 gameType 就走舊邏輯（向後相容）
  return await _originalUpdateProgress(wordId, correct);
};

// 進入遊戲時重置 session 計數
var _origStartGame2 = startGame;
startGame = async function(gameId) {
  resetSession();
  return await _origStartGame2(gameId);
};
