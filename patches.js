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

async function getGameWords(gameType) {
  var source = document.getElementById('gameSource') ? document.getElementById('gameSource').value : 'permanent';
  var tagFilter = document.getElementById('gameTagFilter') ? document.getElementById('gameTagFilter').value : 'all';
  var words;
  if (source === 'exam-multi') {
    // 多選考試包：currentGameWords 已預先合併
    words = currentGameWords.length > 0 ? currentGameWords.slice() : [];
  } else if (source.indexOf('exam-') === 0) {
    words = currentGameWords.length > 0 ? currentGameWords : await dbGetByIndex('words', 'pool', source);
  } else if (source === 'due') {
    words = await getDueWordsFSRS('permanent');
    if (words.length < 4) words = await dbGetByIndex('words', 'pool', 'permanent');
  } else {
    words = await dbGetByIndex('words', 'pool', 'permanent');
  }
  if (tagFilter !== 'all') {
    words = words.filter(function(w) { return w.tags && w.tags.indexOf(tagFilter) !== -1; });
  }

  // 套用遊戲難度門檻（依 stability 篩選）
  // 小寶貝模式（baby）不套用門檻，讓 4 歲小孩無壓力玩
  var skipThreshold = (typeof currentMode !== 'undefined' && currentMode === 'baby');
  if (gameType && !skipThreshold && typeof filterWordsForGame === 'function') {
    var filtered = await filterWordsForGame(words, gameType);
    if (filtered.length < 4) {
      var hint = (typeof getEasierGamesHint === 'function') ? getEasierGamesHint(gameType) : '';
      alert('「' + (GAME_NAMES_ZH[gameType] || gameType) + '」目前還沒有夠熟的單字（至少需要 4 個）。\n\n' + hint);
      return null;
    }
    words = filtered;
  }

  if (words.length < 4) { alert('單字不夠，至少需要 4 個！'); return null; }
  return shuffleArray(words);
}

// ===== 每日挑戰：固定流程 + FSRS 區段篩選 + 程度自適應 =====

// 載入 / 儲存程度設定
async function getDailyLevels() {
  var s = await dbGet('settings', 'dailyLevels');
  return s || { key: 'dailyLevels', boy: 'auto', girl: 'auto' };
}
async function saveDailyLevel(role, level) {
  var s = await getDailyLevels();
  s[role] = level;
  await dbPut('settings', s);
}
async function loadDailyLevels() {
  var s = await getDailyLevels();
  var b = document.getElementById('dailyLevelBoy');
  var g = document.getElementById('dailyLevelGirl');
  if (b) b.value = s.boy || 'auto';
  if (g) g.value = s.girl || 'auto';
}

// 計算「目前小孩」玩過的單字平均 stability
async function getRoleAvgStability(role) {
  var allProgress = await dbGetAll('progress');
  if (!allProgress.length) return 0;
  var suffix = '_' + role;
  var sum = 0, count = 0;
  for (var i = 0; i < allProgress.length; i++) {
    var rec = allProgress[i];
    // 只看該小孩專屬的進度（key 以 _boy / _girl 結尾）
    if (typeof rec.wordId !== 'string' || rec.wordId.indexOf(suffix) === -1) continue;
    var p = (typeof fsrsUpgrade === 'function') ? fsrsUpgrade(rec) : rec;
    if (p.reps && p.reps > 0) { sum += (p.stability || 0); count++; }
  }
  return count > 0 ? sum / count : 0;
}

// 依角色 + 自動/手動設定，決定當天的關卡流程
async function planDailyChallenge(role) {
  var levels = await getDailyLevels();
  var setting = levels[role] || 'auto';
  var level = setting;
  if (setting === 'auto') {
    var avg = await getRoleAvgStability(role);
    if (avg < 2) level = 'beginner';
    else if (avg < 8) level = 'intermediate';
    else level = 'advanced';
  }
  // 各等級對應的關卡流程：[{ gameType, count, minS }]
  // count = 0 表示「一局多字」
  if (level === 'beginner') {
    return [
      { gameType: 'listen',   count: 3, minS: 0 },
      { gameType: 'memory',   count: 3, minS: 0 },
      { gameType: 'bubble',   count: 0, minS: 1 } // 一局多字
    ];
  }
  if (level === 'intermediate') {
    return [
      { gameType: 'listen',    count: 3, minS: 0 },
      { gameType: 'fillblank', count: 3, minS: 1 },
      { gameType: 'bubble',    count: 0, minS: 1 }
    ];
  }
  // advanced
  return [
    { gameType: 'listen',    count: 3, minS: 0 },
    { gameType: 'fillblank', count: 3, minS: 1 },
    { gameType: 'spelling',  count: 3, minS: 4 },
    { gameType: 'bubble',    count: 0, minS: 1 }
  ];
}

// 從給定的單字池中，挑出 stability >= minS 的前 n 個
async function pickWordsByMinStability(words, minS, n) {
  var enriched = [];
  for (var i = 0; i < words.length; i++) {
    var s = await getWordStability(words[i].id);
    enriched.push({ w: words[i], s: s });
  }
  // 過濾出符合的
  var ok = enriched.filter(function(x) { return x.s >= minS; });
  // 隨機打亂後取 n 個（n=0 表示全部）
  ok = shuffleArray(ok);
  if (n > 0) ok = ok.slice(0, n);
  return ok.map(function(x) { return x.w; });
}

// 區段轉場提示
function showSegmentBanner(text, callback) {
  var div = document.createElement('div');
  div.className = 'segment-banner';
  div.innerHTML = '<div class="segment-banner-inner">' + text + '</div>';
  document.body.appendChild(div);
  setTimeout(function() { div.classList.add('show'); }, 30);
  setTimeout(function() {
    div.classList.remove('show');
    setTimeout(function() { div.remove(); if (callback) callback(); }, 350);
  }, 1400);
}

// 主入口：取代原本的 startDailyWithRole
startDailyWithRole = async function(role) {
  dailyRole = role;
  currentChild = role; // 每日挑戰的小孩 = 進度歸屬的小孩
  if (typeof updateChildSwitchUI === 'function') updateChildSwitchUI();
  currentMode = 'kid';
  resetSession();

  // 取得所有 due 單字
  var dueWords = await getDueWordsFSRS('permanent');
  if (dueWords.length < 4) {
    // 沒有 due，用全部永久庫
    dueWords = await dbGetByIndex('words', 'pool', 'permanent');
  }
  if (dueWords.length < 4) {
    alert('單字不夠，至少需要 4 個！\n請先到「管理單字」加幾個單字。');
    return;
  }

  // 規劃今天的流程
  var plan = await planDailyChallenge(role);

  // 為每個區段挑單字
  var segments = [];
  for (var i = 0; i < plan.length; i++) {
    var seg = plan[i];
    var picked = await pickWordsByMinStability(dueWords, seg.minS, seg.count);
    if (seg.count === 0) {
      // bubble：至少要 4 個才能玩
      if (picked.length >= 4) segments.push({ gameType: seg.gameType, words: picked });
    } else {
      // 一般區段：必須剛好 count 個
      if (picked.length >= seg.count) segments.push({ gameType: seg.gameType, words: picked });
    }
  }

  if (segments.length === 0) {
    alert('今天沒有合適的單字可以挑戰！\n請先去「管理單字」或「全部單字」模式練幾題。');
    return;
  }

  // 進入遊戲頁，依序跑各區段
  goTo('page-game');
  document.getElementById('gameTitle').textContent = (role === 'boy' ? '👦' : '👧') + ' 每日挑戰';
  document.getElementById('gameScore').textContent = '';
  var area = document.getElementById('gameArea');
  area.innerHTML = '';

  var totalQuestions = segments.reduce(function(sum, s) {
    return sum + (s.gameType === 'bubble' ? 1 : s.words.length);
  }, 0);
  var doneQuestions = 0;
  var correctQuestions = 0;
  var segIdx = 0;

  function runNextSegment() {
    if (segIdx >= segments.length) {
      // 全部跑完
      showResult(correctQuestions, totalQuestions);
      return;
    }
    var seg = segments[segIdx];
    var bannerText = (segIdx === 0 ? '🎯 ' : '✨ ') + 'Round ' + (segIdx + 1) + '：' + (GAME_NAMES_ZH[seg.gameType] || seg.gameType);
    showSegmentBanner(bannerText, function() {
      area.innerHTML = '';
      runSegment(seg);
    });
  }

  function runSegment(seg) {
    var inSegDone = 0;
    var totalInSeg = seg.gameType === 'bubble' ? 1 : seg.words.length;

    function nextInSeg() {
      if (inSegDone >= totalInSeg) {
        segIdx++;
        runNextSegment();
        return;
      }
      var target = seg.words[inSegDone];
      var others = shuffleArray(dueWords.filter(function(w) { return w.id !== target.id; })).slice(0, 3);
      var options = shuffleArray([target].concat(others));
      document.getElementById('gameScore').textContent = (doneQuestions + 1) + '/' + totalQuestions;

      area.innerHTML = '';
      function onAnswer(isCorrect, payload) {
        // 寫 FSRS 進度
        var extra = payload || { mistakes: isCorrect ? 0 : 1 };
        updateProgress(target.id, isCorrect, seg.gameType, extra);
        if (isCorrect) correctQuestions++;
        doneQuestions++;
        document.getElementById('gameScore').textContent = correctQuestions + '/' + totalQuestions;
        inSegDone++;
        setTimeout(nextInSeg, 1200);
      }

      switch (seg.gameType) {
        case 'listen':    renderMixListen(area, target, options, 'kid', onAnswer); break;
        case 'memory':    renderMixMemorySingle(area, target, others, onAnswer); break;
        case 'fillblank': renderMixFillblank(area, target, dueWords, onAnswer); break;
        case 'spelling':  renderMixSpelling(area, target, onAnswer); break;
        case 'speak':     renderMixSpeak(area, target, onAnswer); break;
        default:          onAnswer(true);
      }
    }

    if (seg.gameType === 'bubble') {
      // 一局多字 bubble — bubble.js 內部已經會自己呼叫 updateProgress 寫 FSRS，
      // 這裡只透過 hook showResult 收結算結果，避免雙寫
      runBubbleSegment(area, seg.words, function(correctCount, totalCount) {
        var success = correctCount >= Math.ceil(totalCount * 0.6);
        if (success) correctQuestions++;
        doneQuestions++;
        document.getElementById('gameScore').textContent = correctQuestions + '/' + totalQuestions;
        segIdx++;
        setTimeout(runNextSegment, 1500);
      });
    } else {
      nextInSeg();
    }
  }

  runNextSegment();
};

// 單題版 memory（一張目標 + 3 張干擾，找出目標）
function renderMixMemorySingle(area, target, others, cb) {
  var img = getRandomImage(target);
  var options = shuffleArray([target].concat(others));
  area.innerHTML = '<div class="kid-layout"><div class="kid-top">' +
    '<div class="kid-image kid-noimg">「' + esc(target.meaning) + '」是哪個？</div>' +
    '</div><div class="kid-opts">' +
    options.map(function(o) {
      return '<button class="kid-opt" data-id="' + o.id + '">' + esc(o.word) + '</button>';
    }).join('') +
    '</div></div>';
  area.querySelectorAll('.kid-opt').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var ok = parseInt(btn.dataset.id) === target.id;
      btn.classList.add(ok ? 'correct' : 'wrong');
      if (!ok) { var r = area.querySelector('.kid-opt[data-id="' + target.id + '"]'); if (r) r.classList.add('correct'); }
      speakWord(target.word);
      area.querySelectorAll('.kid-opt').forEach(function(b) { b.style.pointerEvents = 'none'; });
      cb(ok, { mistakes: ok ? 0 : 1 });
    });
  });
}

// bubble 區段：一局多字。劫持 showResult 收結算
function runBubbleSegment(area, words, doneCb) {
  var origShowResult = showResult;
  showResult = function(correctCount, totalCount) {
    showResult = origShowResult; // 立刻還原
    if (doneCb) doneCb(correctCount, totalCount);
  };
  initBubbleGame(area, shuffleArray(words));
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

// 覆蓋 startGame 加入預載 + 難度門檻
var _originalStartGame = startGame;
startGame = async function(gameId) {
  var words = await getGameWords(gameId);
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

  // 連續 3 題 Easy 且該單字今天第一次複習 → 給鑽石（歸目前小孩）
  if (result.isEasy && result.isFirstToday) {
    sessionEasyStreak++;
    if (sessionEasyStreak >= 3) {
      sessionEasyStreak = 0;
      sessionDiamondsEarned++;
      var coins = await getCoins();
      var child = (typeof currentChild !== 'undefined') ? currentChild : 'boy';
      var fieldName = child === 'boy' ? 'rewardsBoy' : 'rewardsGirl';
      coins[fieldName] = coins[fieldName] || {};
      coins[fieldName]['diamond'] = (coins[fieldName]['diamond'] || 0) + 1;
      coins.log.push({ role: child, count: 0, date: getTodayStr(), chest: '💎 連續 Easy 鑽石' });
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

// ===== 啟動：載入上次選的小孩 =====
if (typeof loadCurrentChild === 'function') {
  loadCurrentChild();
}
