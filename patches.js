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

  // 需要例句的遊戲（句子排列 / 讀句選字）：檢查有例句的單字是否足夠，不夠才提醒
  var NEEDS_SENTENCE = { fillblank: true, cloze: true };
  if (gameType && NEEDS_SENTENCE[gameType]) {
    var withSen = words.filter(function(w) {
      return w.sentences && w.sentences.some(function(s) { return s && s.trim().split(/\s+/).length >= 2; });
    });
    if (withSen.length < 4) {
      alert('「' + (GAME_NAMES_ZH[gameType] || gameType) + '」需要至少 4 個「有例句」的單字才能玩。\n\n請先到「管理單字」幫這些單字補上例句。');
      return null;
    }
  }

  // 註：已移除「不夠熟不給玩」的難度門檻 —— 不熟的字只是比較難過關，仍可練習。

  if (words.length < 4) { alert('單字不夠，至少需要 4 個！'); return null; }

  // 優先鞏固「剛學過的新字」+ FSRS 到期的字（排前面）
  // 規則：due（快忘）最優先，其次剛學過(reps 少且 S 低)，其餘隨機
  words = shuffleArray(words);
  if (source !== 'exam-multi' && source.indexOf('exam-') !== 0) {
    var now = Date.now();
    var scored = [];
    for (var pi = 0; pi < words.length; pi++) {
      var pr = (typeof getProgressFor === 'function') ? await getProgressFor(words[pi].id) : null;
      var pup = pr ? ((typeof fsrsUpgrade === 'function') ? fsrsUpgrade(pr) : pr) : null;
      var pri = 2; // 預設：一般
      if (pup) {
        var due = pup.due || 0;
        var s = pup.stability || 0;
        var reps = pup.reps || 0;
        if (due && due <= now) pri = 0;           // 到期快忘 → 最優先
        else if (reps >= 1 && s < 8) pri = 1;     // 剛學過、還在鞏固 → 次優先
      }
      scored.push({ w: words[pi], pri: pri, r: Math.random() });
    }
    scored.sort(function(a, b){ return (a.pri - b.pri) || (a.r - b.r); });
    words = scored.map(function(x){ return x.w; });
  }
  return words;
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
      { gameType: 'memory',   count: 0, minS: 0, memMode: 'baby' }, // 萌新翻牌：圖配圖（小寶貝風格）
      { gameType: 'bubble',   count: 0, minS: 0, rounds: 3 } // 泡泡：限 3 題
    ];
  }
  if (level === 'intermediate') {
    return [
      { gameType: 'listen',    count: 3, minS: 0 },
      { gameType: 'fillblank', count: 3, minS: 0 },
      { gameType: 'bubble',    count: 0, minS: 0, rounds: 3 }
    ];
  }
  // advanced
  return [
    { gameType: 'listen',    count: 3, minS: 0 },
    { gameType: 'fillblank', count: 3, minS: 0 },
    { gameType: 'spelling',  count: 3, minS: 0 },
    { gameType: 'bubble',    count: 0, minS: 0, rounds: 3 }
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
    if (seg.gameType === 'fillblank') {
      // 句子排列只能用有例句的單字
      picked = picked.filter(function(w) {
        return w.sentences && w.sentences.some(function(s) { return s && s.trim().split(/\s+/).length >= 2; });
      });
    }
    if (seg.count === 0) {
      // 一局多字（bubble / memory）：至少要 4 個才能玩
      if (picked.length >= 4) segments.push({ gameType: seg.gameType, words: picked, multi: true, rounds: seg.rounds || 0, memMode: seg.memMode || null });
    } else {
      // 一般區段：有幾個算幾個（不足 count 就用現有的，至少 1 個才納入）
      if (picked.length >= 1) segments.push({ gameType: seg.gameType, words: picked.slice(0, seg.count), multi: false });
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
    return sum + (s.multi ? 1 : s.words.length);
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
    var totalInSeg = seg.words.length;

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
        var extra = payload || { mistakes: isCorrect ? 0 : 1 };
        // skip:true 代表這題沒有可用內容（例如沒例句），不計分、不寫 FSRS
        if (!(extra && extra.skip)) {
          updateProgress(target.id, isCorrect, seg.gameType, extra);
          if (isCorrect) correctQuestions++;
          doneQuestions++;
        } else {
          totalQuestions = Math.max(0, totalQuestions - 1);
        }
        document.getElementById('gameScore').textContent = correctQuestions + '/' + totalQuestions;
        inSegDone++;
        setTimeout(nextInSeg, (extra && extra.skip) ? 0 : 1200);
      }

      switch (seg.gameType) {
        case 'listen':    renderMixListen(area, target, options, 'kid', onAnswer); break;
        case 'fillblank': renderMixFillblank(area, target, dueWords, onAnswer); break;
        case 'spelling':  renderMixSpelling(area, target, onAnswer); break;
        case 'speak':     renderMixSpeak(area, target, onAnswer); break;
        default:          onAnswer(true);
      }
    }

    if (seg.multi) {
      // 一局多字（bubble / memory）— 遊戲內部已自己呼叫 updateProgress 寫 FSRS，
      // 這裡只透過 hook showResult 收結算結果，避免雙寫
      runFullGameSegment(area, seg.gameType, seg.words, function(correctCount, totalCount) {
        var success = correctCount >= Math.ceil(totalCount * 0.6);
        if (success) correctQuestions++;
        doneQuestions++;
        document.getElementById('gameScore').textContent = correctQuestions + '/' + totalQuestions;
        segIdx++;
        setTimeout(runNextSegment, 1500);
      }, seg.rounds, seg.memMode);
    } else {
      nextInSeg();
    }
  }

  runNextSegment();
};

// 單題版 memory（保留供其他地方相容；每日挑戰已改用真正翻牌）
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

// 一局多字區段：劫持 showResult 收結算（bubble / memory 等整局遊戲共用）
// rounds: 可選，限制題數（bubble 用）
// memModeOverride: 可選，覆蓋 memory 顯示模式（'baby'=圖配圖 / 'kid'=字配圖）
function runFullGameSegment(area, gameType, words, doneCb, rounds, memModeOverride) {
  var origShowResult = showResult;
  showResult = function(correctCount, totalCount) {
    showResult = origShowResult; // 立刻還原
    if (doneCb) doneCb(correctCount, totalCount);
  };
  var shuffled = shuffleArray(words);
  var defMode = (typeof currentMode !== 'undefined' ? currentMode : 'kid');
  switch (gameType) {
    case 'bubble': initBubbleGame(area, shuffled, rounds || 0); break;
    case 'memory': initMemoryGame(area, shuffled, memModeOverride || defMode); break;
    case 'listen': initListenGame(area, shuffled, defMode); break;
    default:       initBubbleGame(area, shuffled, rounds || 0);
  }
}

// 舊名相容
function runBubbleSegment(area, words, doneCb) {
  runFullGameSegment(area, 'bubble', words, doneCb);
}

// ===== 圖片預載 =====
// 回傳 Promise：所有圖片載入完成（或逾時）才 resolve。
// 已快取的圖片會「立即」完成（onload 同步觸發），所以不會有等待感。
function preloadImages(words, maxWaitMs) {
  var urls = [];
  words.forEach(function(w) {
    getAllImages(w).forEach(function(url) {
      if (url && (url.indexOf('http') === 0 || url.indexOf('data:') === 0)) urls.push(url);
    });
  });
  urls = urls.filter(function(u, i) { return urls.indexOf(u) === i; });
  if (urls.length === 0) return Promise.resolve();

  var loaded = 0;
  return new Promise(function(resolve) {
    var done = false;
    function finish() { if (!done) { done = true; resolve(); } }
    urls.forEach(function(url) {
      var img = new Image();
      img.onload = img.onerror = function() {
        loaded++;
        if (loaded >= urls.length) finish();
      };
      img.src = url;
      // 已在瀏覽器/SW 快取的圖片，complete 會立刻是 true
      if (img.complete) { loaded++; if (loaded >= urls.length) finish(); }
    });
    // 保險：最多等 maxWaitMs（預設 2.5 秒），避免網路慢時卡死
    setTimeout(finish, maxWaitMs || 2500);
  });
}

// 把整個永久庫的圖片預先抓進快取（背景執行，讓之後離線也能玩）
var _precacheDone = false;
async function precacheAllWordImages() {
  if (_precacheDone) return;
  _precacheDone = true;
  try {
    var words = await dbGetByIndex('words', 'pool', 'permanent');
    var urls = [];
    words.forEach(function(w) {
      getAllImages(w).forEach(function(url) {
        if (url && url.indexOf('http') === 0) urls.push(url);
      });
    });
    urls = urls.filter(function(u, i) { return urls.indexOf(u) === i; });
    // 一次抓幾張，避免一次塞爆網路
    var idx = 0, BATCH = 4;
    function next() {
      if (idx >= urls.length) return;
      var batch = urls.slice(idx, idx + BATCH);
      idx += BATCH;
      Promise.all(batch.map(function(url) {
        return new Promise(function(res) {
          var img = new Image();
          img.onload = img.onerror = function() { res(); };
          img.src = url;
        });
      })).then(function() { setTimeout(next, 150); });
    }
    next();
  } catch (e) { /* 靜默 */ }
}

// 覆蓋 startGame 加入預載 + 難度門檻
var _originalStartGame = startGame;
startGame = async function(gameId) {
  var words = await getGameWords(gameId);
  if (!words) return;
  currentGameWords = words;
  document.getElementById('gameTitle').textContent = GAMES.find(function(g){return g.id===gameId;}).name;
  document.getElementById('gameScore').textContent = '';
  goTo('page-game');
  var area = document.getElementById('gameArea');
  area.innerHTML = '<div style="text-align:center;padding:40px;color:#999;">載入中...</div>';
  // 真正等圖片載入完成（已快取的會秒開，不會空等 500ms）
  preloadImages(words).then(function() {
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
      case 'match':     initMatchGame(area, words); break;
      case 'cloze':     initClozeGame(area, words); break;
      case 'write':     initWriteGame(area, words); break;
    }
  });
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

  // 註：已移除「連續 3 題 Easy 直接送鑽石」機制（觸發太頻繁）。
  //     鑽石改由「階段升級寶箱」與「連續 5 天挑戰」取得。

  // 階段升級獎勵
  if (result.stageUnlocked) {
    sessionStageUnlocks.push(result.stageUnlocked);
    if (result.stageUnlocked === 1) {
      // 熟悉期：全螢幕 Level Up 動畫（不給寶箱）
      showLevelUpAnimation(result.stageUnlocked);
    } else {
      // 應用期 / 大師期：升級動畫 + 寶箱
      showLevelUpAnimation(result.stageUnlocked);
      setTimeout(function() { showChestModal(); }, 1800);
    }
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

function showLevelUpAnimation(stage) {
  var stageNames = ['', '熟悉期', '應用期', '大師期'];
  var stageColors = ['', '#4CAF50', '#FF9800', '#E91E63'];
  var stageEmojis = ['', '🌱', '⭐', '👑'];
  var div = document.createElement('div');
  div.className = 'levelup-overlay';
  div.innerHTML =
    '<div class="levelup-box" style="--lvc:' + stageColors[stage] + '">' +
      '<div class="levelup-emoji">' + stageEmojis[stage] + '</div>' +
      '<div class="levelup-title">LEVEL UP!</div>' +
      '<div class="levelup-stage">升級到「' + stageNames[stage] + '」</div>' +
    '</div>';
  document.body.appendChild(div);
  setTimeout(function() { div.classList.add('show'); }, 30);
  setTimeout(function() { div.classList.remove('show'); }, 2200);
  setTimeout(function() { div.remove(); }, 2700);
}

// 是否正在玩「考試複習包」（考試包不計入 FSRS，畢業到永久庫才算）
function isExamPackSource() {
  var el = document.getElementById('gameSource');
  var src = el ? el.value : '';
  return src === 'exam-multi' || (typeof src === 'string' && src.indexOf('exam-') === 0);
}

// 包裝 updateProgress：保留多巴胺，把 FSRS 邏輯接進來
var _originalUpdateProgress = updateProgress;
updateProgress = async function(wordId, correct, gameType, extra) {
  // 測試模式：不寫進度、不給獎勵
  if (typeof devSkipRewards === 'function' && devSkipRewards()) return;
  // 考試複習包：不計入 FSRS（單字畢業到永久庫後才會累積熟練度）
  if (isExamPackSource()) return;
  // 如果有 gameType，走完整的 FSRS 流程
  if (gameType) {
    var payload = {
      wordId: wordId,
      gameType: gameType,
      mistakes: extra && extra.mistakes != null ? extra.mistakes : (correct ? 0 : 1),
      timeUsed: extra && extra.timeUsed != null ? extra.timeUsed : 0,
      hintUsed: extra && extra.hintUsed != null ? extra.hintUsed : 0,
      mode: (typeof currentMode !== 'undefined') ? currentMode : 'kid',
      spokenWords: extra && extra.spokenWords != null ? extra.spokenWords : 0
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

// ===== 啟動後：背景把所有單字圖片抓進快取（之後離線也能玩、秒開）=====
if (typeof window !== 'undefined') {
  window.addEventListener('load', function() {
    // 延遲一點，先讓首頁與資料載入完成，再背景預抓圖片
    setTimeout(function() {
      if (navigator.onLine && typeof precacheAllWordImages === 'function') {
        precacheAllWordImages();
      }
    }, 3000);
  });
}


// ===== 學習報告頁 =====
async function renderReport(child) {
  child = child || 'boy';
  // 切換 tab 樣式
  var tb = document.getElementById('reportTabBoy');
  var tg = document.getElementById('reportTabGirl');
  if (tb) tb.classList.toggle('active', child === 'boy');
  if (tg) tg.classList.toggle('active', child === 'girl');

  var body = document.getElementById('reportBody');
  if (body) body.innerHTML = '<div style="text-align:center;padding:40px;color:#999;">統計中...</div>';

  // 取得永久庫所有單字
  var words = await dbGetByIndex('words', 'pool', 'permanent');
  var total = words.length;

  // 統計各階段（用該小孩的進度）
  var suffix = '_' + child;
  var stages = { 認識: 0, 熟悉: 0, 應用: 0, 大師: 0 };
  var notStarted = 0;
  var struggling = []; // lapses 多的單字
  var dueCount = 0;
  var now = Date.now();

  for (var i = 0; i < words.length; i++) {
    var rec = await dbGet('progress', words[i].id + suffix);
    if (!rec) {
      // 沒有該小孩的獨立進度，看看有沒有舊共用進度
      var legacy = await dbGet('progress', words[i].id);
      if (!legacy) { notStarted++; continue; }
      rec = legacy;
    }
    var p = (typeof fsrsUpgrade === 'function') ? fsrsUpgrade(rec) : rec;
    if (!p.reps || p.reps === 0) { notStarted++; continue; }
    // 用「真實階段」（stability+次數+天數 三條件）而非只看 stability
    var lvl = (typeof getWordStageLevel === 'function') ? getWordStageLevel(p)
              : (p.stability >= 40 ? 3 : p.stability >= 15 ? 2 : p.stability >= 3 ? 1 : 0);
    if (lvl >= 3) stages['大師']++;
    else if (lvl === 2) stages['應用']++;
    else if (lvl === 1) stages['熟悉']++;
    else stages['認識']++;
    if (p.due && p.due <= now) dueCount++;
    if ((p.lapses || 0) >= 2) {
      struggling.push({ word: words[i].word, lapses: p.lapses });
    }
  }

  var learned = total - notStarted;
  struggling.sort(function(a, b) { return b.lapses - a.lapses; });

  function bar(label, count, color) {
    var pct = total > 0 ? Math.round(count / total * 100) : 0;
    return '<div class="report-bar-row">' +
      '<span class="report-bar-label">' + label + '</span>' +
      '<div class="report-bar-track"><div class="report-bar-fill" style="width:' + pct + '%;background:' + color + ';"></div></div>' +
      '<span class="report-bar-count">' + count + '</span>' +
    '</div>';
  }

  var html =
    '<div class="report-summary">' +
      '<div class="report-stat"><div class="report-stat-num">' + total + '</div><div class="report-stat-label">單字總數</div></div>' +
      '<div class="report-stat"><div class="report-stat-num">' + learned + '</div><div class="report-stat-label">已開始學</div></div>' +
      '<div class="report-stat"><div class="report-stat-num">' + dueCount + '</div><div class="report-stat-label">今日待複習</div></div>' +
    '</div>' +
    '<h3 class="report-section-title">各階段分布</h3>' +
    '<div class="report-bars">' +
      bar('🌱 認識期', stages['認識'], '#9E9E9E') +
      bar('📗 熟悉期', stages['熟悉'], '#4CAF50') +
      bar('⭐ 應用期', stages['應用'], '#FF9800') +
      bar('👑 大師期', stages['大師'], '#E91E63') +
      bar('⚪ 還沒學', notStarted, '#E0E0E0') +
    '</div>';

  if (struggling.length > 0) {
    html += '<h3 class="report-section-title">需要加強的單字（常答錯）</h3>' +
      '<div class="report-struggle">' +
      struggling.slice(0, 10).map(function(s) {
        return '<span class="report-struggle-item">' + esc(s.word) + ' <small>×' + s.lapses + '</small></span>';
      }).join('') +
      '</div>';
  } else if (learned > 0) {
    html += '<p style="text-align:center;color:#4CAF50;padding:16px;">太棒了！目前沒有特別困難的單字 🎉</p>';
  }

  if (body) body.innerHTML = html;
}
