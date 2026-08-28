// ===== FSRS-4.5 簡化版引擎 + Game Middleware =====
// 不需要外部依賴，純 JS 實作

// FSRS 預設參數（從 ts-fsrs 預設值簡化）
var FSRS_W = [0.4072, 1.1829, 3.1262, 15.4722, 7.2102, 0.5316, 1.0651, 0.0234,
              1.616, 0.1544, 1.0824, 1.9813, 0.0953, 0.2975, 2.2042, 0.2407,
              2.9466, 0.5034, 0.6567];
var REQUEST_RETENTION = 0.9;
var DECAY = -0.5;
var FACTOR = Math.pow(0.9, 1 / DECAY) - 1;

// ===== 升級節奏調校（讓單字慢慢升，要常玩才會進步）=====
var FIRST_PLAY_SCALE = 0.25; // 第一次玩的初始 stability 縮放（避免一次猜對就暴衝）
var GROWTH_SCALE = 0.28;     // 後續每次 stability 成長幅度縮放（爬升放慢，要常玩才會進步）
var MIN_ELAPSED_DAYS = 0.3;  // 同一天重複玩時，假設至少間隔的天數（讓連玩也有微量成長）

// 階段門檻：熟悉期 / 應用期 / 大師期
// s = 需要的 stability；minReps = 需要「複習過的次數」；minDays = 需要「不同天數」
// 雙重條件：光是 stability 夠不算數，還要真的練過夠多次、跨夠多天，才算「會應用」
var STAGE_THRESHOLDS = [
  { level: 1, s: 3,  minReps: 2,  minDays: 2 },  // 熟悉期：至少複習 2 次、跨 2 天
  { level: 2, s: 18, minReps: 6,  minDays: 4 },  // 應用期：至少 6 次、跨 4 天
  { level: 3, s: 45, minReps: 12, minDays: 8 }   // 大師期：至少 12 次、跨 8 天
];

// ===== 多小孩進度分流 =====
// 目前正在學習的小孩：'boy' | 'girl'（由首頁/每日挑戰設定）
var currentChild = 'boy';

// 進度的儲存 key：每個小孩各自一份，例如 "5_boy"、"5_girl"
function progressId(wordId) { return String(wordId) + '_' + currentChild; }

// 取得「目前小孩」對某單字的進度
// lazy 分流：若該小孩還沒有獨立進度，就用舊的共用進度當起點（複製、不動原本那筆）
async function getProgressFor(wordId) {
  var childRec = await dbGet('progress', progressId(wordId));
  if (childRec) return childRec;
  // 退回舊的共用進度（numeric key）當基礎
  var legacy = await dbGet('progress', wordId);
  if (legacy) {
    var clone = Object.assign({}, legacy);
    clone.wordId = progressId(wordId);
    delete clone._firestoreId; // 避免覆蓋舊那筆的 Firestore 文件
    return clone; // 尚未存檔，等下次 put 才真正分流出來
  }
  return null;
}

// 計算記憶可提取性（Retrievability）
function fsrsRetrievability(elapsedDays, stability) {
  if (stability <= 0) return 0;
  return Math.pow(1 + FACTOR * elapsedDays / stability, DECAY);
}

// 初始化單字進度（FSRS 格式）
function fsrsInitProgress(wordId) {
  return {
    wordId: wordId,
    stability: 0,
    difficulty: 0,
    reps: 0,
    lapses: 0,
    state: 'new',         // 'new' | 'learning' | 'review' | 'relearning'
    lastReview: 0,
    due: Date.now(),      // 下次複習時間
    // 相容舊欄位
    interval: 0,
    streak: 0,
    totalCorrect: 0,
    totalAttempts: 0,
    // 階段獎勵紀錄
    unlockedStages: [],   // 已解鎖的階段
    todayReviewed: '',    // 今天最後複習的日期 (YYYY-MM-DD)
    reviewDays: 0         // 練過的「不同天數」（升級的硬條件之一）
  };
}

// 把舊的 progress 升級成 FSRS 格式（向後相容）
function fsrsUpgrade(progress) {
  if (typeof progress.stability !== 'undefined') {
    // 數值防呆：清掉壞掉的 stability（NaN / Infinity / 暴衝的天文數字）
    if (!isFinite(progress.stability) || isNaN(progress.stability) || progress.stability > STABILITY_MAX) {
      progress = Object.assign({}, progress, { stability: Math.min(STABILITY_MAX, (progress.reps > 0 ? 3 : 0)) });
    }
    if (progress.stability < 0) progress = Object.assign({}, progress, { stability: 0 });
    return progress;
  }
  // 從舊資料推估 FSRS 值
  var s = (progress.streak || 0) >= 1 ? Math.max(1, progress.interval || 1) : 0;
  var d = 5;
  return Object.assign({}, fsrsInitProgress(progress.wordId), progress, {
    stability: s,
    difficulty: d,
    state: progress.streak > 0 ? 'review' : 'new',
    due: progress.nextReview || Date.now()
  });
}

// 數值防呆：把 stability 限制在合理範圍，並限制單次成長倍數
// - 過濾 NaN / Infinity（壞資料 → 退回前值或 0.1）
// - 上限 36500（約 100 年），下限 0.01
// - 單次複習成長不超過前值的 1.8 倍 + 1.2（避免任何公式暴衝，曲線平滑）
var STABILITY_MAX = 36500;
function fsrsClampStability(newS, prevS) {
  if (newS == null || !isFinite(newS) || isNaN(newS)) {
    return (prevS != null && isFinite(prevS) && prevS > 0) ? prevS : 0.1;
  }
  if (newS < 0.01) newS = 0.01;
  if (prevS != null && isFinite(prevS) && prevS > 0) {
    var cap = prevS * 1.8 + 1.2; // 單次最多成長到 1.8 倍 +1.2
    if (newS > cap) newS = cap;
  }
  if (newS > STABILITY_MAX) newS = STABILITY_MAX;
  return newS;
}

// FSRS 核心：根據評分（1-4）更新 S 和 D
// rating: 1=Again, 2=Hard, 3=Good, 4=Easy
function fsrsReview(progress, rating) {
  progress = fsrsUpgrade(progress);
  var w = FSRS_W;
  var now = Date.now();
  var lastReview = progress.lastReview || now;
  var elapsedDays = Math.max(0, (now - lastReview) / (24 * 60 * 60 * 1000));

  var newS, newD;

  if (progress.reps === 0) {
    // 第一次複習：使用初始值，但大幅壓低避免暴衝
    newS = w[rating - 1] * FIRST_PLAY_SCALE; // w0~w3 對應 Again/Hard/Good/Easy
    // 首玩封頂：第一次接觸絕不直接跳過「認識期」（必須改天再複習才會升級）
    newS = Math.min(newS, STAGE_THRESHOLDS[0].s * 0.8);
    newD = w[4] - (rating - 3) * w[5];
    newD = Math.max(1, Math.min(10, newD));
  } else {
    // 同一天重複玩時，套用最小間隔下限，讓連玩也有微量成長（選項 C）
    var effectiveElapsed = Math.max(elapsedDays, MIN_ELAPSED_DAYS);
    var r = fsrsRetrievability(effectiveElapsed, progress.stability);

    if (rating === 1) {
      // Again：穩定度大幅下降
      newS = w[11] * Math.pow(progress.difficulty, -w[12]) *
             (Math.pow(progress.stability + 1, w[13]) - 1) *
             Math.exp((1 - r) * w[14]);
      newS = Math.max(0.1, newS);
      progress.lapses++;
    } else {
      // Hard/Good/Easy：穩定度增加（成長幅度減半，爬升放慢）
      var hardPenalty = rating === 2 ? w[15] : 1;
      var easyBonus = rating === 4 ? w[16] : 1;
      var growth = Math.exp(w[8]) *
             (11 - progress.difficulty) *
             Math.pow(progress.stability, -w[9]) *
             (Math.exp((1 - r) * w[10]) - 1) *
             hardPenalty * easyBonus;
      newS = progress.stability * (1 + growth * GROWTH_SCALE);
    }
    newD = progress.difficulty - w[6] * (rating - 3);
    newD = w[7] * 5 + (1 - w[7]) * newD;
    newD = Math.max(1, Math.min(10, newD));
  }

  // 數值防呆：避免 NaN / Infinity / 暴衝（最高約 100 年），下限 0.01
  newS = fsrsClampStability(newS, progress.stability);
  if (!isFinite(newD)) newD = 5;

  // 計算下次複習日（基於目標保留率 90%）
  var intervalDays = newS * (Math.pow(REQUEST_RETENTION, 1 / DECAY) - 1) / FACTOR;
  intervalDays = Math.max(1, Math.round(intervalDays));

  return Object.assign({}, progress, {
    stability: newS,
    difficulty: newD,
    reps: progress.reps + 1,
    state: rating === 1 ? 'relearning' : 'review',
    lastReview: now,
    due: now + intervalDays * 24 * 60 * 60 * 1000,
    interval: intervalDays,
    streak: rating === 1 ? 0 : (progress.streak || 0) + 1,
    totalCorrect: (progress.totalCorrect || 0) + (rating > 1 ? 1 : 0),
    totalAttempts: (progress.totalAttempts || 0) + 1,
    nextReview: now + intervalDays * 24 * 60 * 60 * 1000  // 相容舊欄位
  });
}

// ===== Game Engine：把遊戲表現轉成 FSRS rating =====

// payload: { wordId, gameType, mistakes, timeUsed, hintUsed }
// gameType: 'memory' | 'listen' | 'bubble' | 'spelling' | 'fillblank' | 'detective' | 'flashlight' | 'echo' | 'speak'
// payload 可帶 mode:'baby'|'kid'（小寶貝模式全部最高給 Good）
function gameToRating(payload) {
  var gt = payload.gameType;
  var m = payload.mistakes || 0;
  var t = payload.timeUsed || 0;
  var hint = payload.hintUsed || 0;
  var isBaby = payload.mode === 'baby';

  // 認識新朋友（learn）：五步驟教學 + 超簡單看圖選字確認 → 只給 Good(3)，答錯 Again(1)
  // 因為這是「第一次認識」，不應該因為選對一個 4 選 1 就快速升級
  if (gt === 'learn') {
    return m > 0 ? 1 : 3;
  }

  // 手寫單字（write）：完整寫出整個單字 → 很有效的記憶，給 Easy(4)
  if (gt === 'write') {
    return m > 0 ? 2 : 4;
  }

  // 難遊戲：做對代表真的熟，可給 Easy(4)
  // spelling 拼字 / cloze 讀句 / detective 猜字 / fillblank 句子排列 / speak 造句
  if (gt === 'spelling') {
    if (isBaby) return m === 0 ? 3 : (m >= 2 ? 1 : 2);
    if (m === 0 && hint === 0) return 4;
    if (m === 1 || hint === 1) return 2;
    if (m >= 2) return 1;
    return 3;
  }
  if (gt === 'cloze' || gt === 'detective') {
    if (m === 0) return isBaby ? 3 : 4;
    return 1;
  }
  if (gt === 'fillblank') {
    if (m === 0) return isBaby ? 3 : 4;
    if (m === 1) return 2;
    return 1;
  }
  if (gt === 'speak') {
    // 看圖說句：依「有沒有講到目標字 + 句子完整度」評分
    // payload.spokenWords = 說出的字數；有講到字 + 完整句子(>=3字) → Easy
    if (m > 0) return 1; // 沒講到目標字
    if (isBaby) return 3;
    var sw = payload.spokenWords || 0;
    return sw >= 3 ? 4 : 3; // 完整句子給 Easy，只講單字/太短給 Good
  }

  // 簡單遊戲：最高只給 Good(3)，因為太容易、有猜的成分
  if (gt === 'memory') {
    if (m === 0) return 3;
    if (m === 1) return 2;
    return 1;
  }
  if (gt === 'listen' || gt === 'flashlight') {
    return m > 0 ? 1 : 3;
  }
  if (gt === 'bubble') {
    return m > 0 ? 1 : 3;
  }
  if (gt === 'echo') {
    return m === 0 ? 3 : 1;
  }
  if (gt === 'match') {
    return m === 0 ? 3 : 1;
  }
  return 3;
}

// 取得單字目前的「真實階段」等級（0=認識 1=熟悉 2=應用 3=大師）
// 一律以 unlockedStages 為準（已通過 stability+reps+天數 三條件才會解鎖）。
// 只有「非常舊、連 unlockedStages 欄位都沒有」的資料才退回用 stability 粗估。
function getWordStageLevel(progress) {
  if (!progress) return 0;
  var us = progress.unlockedStages;
  if (Array.isArray(us)) {
    // 新制資料：階段完全由 unlockedStages 決定（沒解鎖就是認識期，即使 S 很高）
    return us.length ? Math.max.apply(null, us) : 0;
  }
  // 舊資料（無 unlockedStages 欄位）→ 用 stability 粗估
  var s = progress.stability || 0;
  if (s >= STAGE_THRESHOLDS[2].s) return 3;
  if (s >= STAGE_THRESHOLDS[1].s) return 2;
  if (s >= STAGE_THRESHOLDS[0].s) return 1;
  return 0;
}

// 統一入口：遊戲完成時呼叫這個
// 回傳獎勵資訊：{ rating, coinEarned, diamondEarned, stageUnlocked }
async function recordGameResult(payload) {
  var rating = gameToRating(payload);
  var p = await getProgressFor(payload.wordId);
  if (!p) p = fsrsInitProgress(progressId(payload.wordId));
  else p = fsrsUpgrade(p);

  // App 可能在「FSRS 已寫入、場次游標尚未 checkpoint」之間被系統回收。
  // 固定 answerId 讓恢復後重送同一題時保持冪等，不會再次增加熟練度。
  if (payload.answerId && p.lastAnswerId === payload.answerId) {
    return {
      rating: rating,
      isFirstToday: false,
      isEasy: rating === 4,
      stageUnlocked: null,
      stability: p.stability,
      state: p.state,
      duplicate: true
    };
  }

  var prevS = p.stability || 0;
  var todayStr = (function() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  })();
  var isFirstToday = p.todayReviewed !== todayStr;

  // 套用 FSRS
  var newP = fsrsReview(p, rating);
  // 累計「不同天數」：今天第一次複習才 +1（同一天玩很多次不重複累加）
  newP.reviewDays = (p.reviewDays || 0) + (isFirstToday ? 1 : 0);
  newP.todayReviewed = todayStr;
  newP.wordId = progressId(payload.wordId); // 確保 key 是本小孩專屬
  if (payload.answerId) newP.lastAnswerId = payload.answerId;

  // 檢查階段升級：stability + 複習次數(reps) + 不同天數(reviewDays) 三條件都要達標
  // 這樣「同一天狂答對」不會直接升級，必須跨天、真的練夠才升 → 符合「會應用」的定義
  var unlockedStages = newP.unlockedStages || [];
  var newStageUnlocked = null;
  STAGE_THRESHOLDS.forEach(function(stage) {
    if (unlockedStages.indexOf(stage.level) !== -1) return;
    var meetS = newP.stability >= stage.s;
    var meetReps = (newP.reps || 0) >= stage.minReps;
    var meetDays = (newP.reviewDays || 0) >= stage.minDays;
    if (meetS && meetReps && meetDays) {
      unlockedStages.push(stage.level);
      newStageUnlocked = stage.level;
    }
  });
  newP.unlockedStages = unlockedStages;

  await dbPut('progress', newP);

  return {
    rating: rating,
    isFirstToday: isFirstToday,
    isEasy: rating === 4,
    stageUnlocked: newStageUnlocked,
    stability: newP.stability,
    state: newP.state
  };
}

// 取得今日該複習的單字（FSRS 版本，R<90%）— 依目前小孩
async function getDueWordsFSRS(pool) {
  var all = pool === 'permanent'
    ? await dbGetByIndex('words', 'pool', 'permanent')
    : await dbGetAll('words');
  var now = Date.now();
  var due = [];
  for (var i = 0; i < all.length; i++) {
    var p = await getProgressFor(all[i].id);
    if (!p) { due.push(all[i]); continue; }
    p = fsrsUpgrade(p);
    if (p.due <= now) due.push(all[i]);
  }
  return due;
}

// 根據 S 值推薦遊戲類型（鷹架理論）— 對齊新門檻 熟悉3/應用15/大師40
function recommendGameByStability(stability) {
  if (stability < 3) return ['memory', 'listen'];
  if (stability < 15) return ['bubble'];
  if (stability < 40) return ['spelling', 'detective'];
  return ['fillblank'];
}

// ===== 遊戲難度門檻系統（鷹架理論）=====
// 每個遊戲對應一個最低 stability 要求（對齊放慢後的升級曲線）
var GAME_MIN_STABILITY = {
  memory: 0,      // 翻牌配對 - 認知最低
  listen: 0,      // 看字選圖 - 認字配對
  flashlight: 0,  // 探照燈尋寶 - 探索式
  learn: 0,       // 認識新朋友 - 新字學習入口（門檻 0）
  write: 0,       // 手寫單字 - 描寫練習（門檻 0，任何字都能練）
  bubble: 1,      // 泡泡戳戳樂 - 需要快速反應
  echo: 1,        // 魔法發音動物園 - 跟讀
  spelling: 3,    // 拼字挑戰 - 需要會拼（約熟悉期）
  speak: 3,       // 看圖說句 - 需要會用
  fillblank: 8,   // 句子排列 - 需要情境理解（接近應用期）
  detective: 0,   // 線索偵探 - 雙模式：新字學習 + 熟字偵探（門檻 0 讓新字也能進來學）
  match: 0,       // 連連看 - 認字配對（最低）
  cloze: 3        // 讀句選字 - 需要情境理解（約熟悉期）
};

// 遊戲名稱對應（給友善提示用）
var GAME_NAMES_ZH = {
  memory: '翻牌配對',
  listen: '看字選圖',
  flashlight: '探照燈尋寶',
  learn: '認識新朋友',
  write: '手寫單字',
  bubble: '泡泡戳戳樂',
  echo: '魔法發音動物園',
  spelling: '拼字挑戰',
  speak: '看圖說句',
  fillblank: '句子排列',
  detective: '線索偵探',
  match: '連連看',
  cloze: '讀句選字'
};

// 取得單字的當前 stability（沒有 progress 紀錄就回 0）— 依目前小孩
async function getWordStability(wordId) {
  var p = await getProgressFor(wordId);
  if (!p) return 0;
  p = fsrsUpgrade(p);
  return p.stability || 0;
}

// 篩選符合該遊戲難度門檻的單字
async function filterWordsForGame(words, gameType) {
  var minS = GAME_MIN_STABILITY[gameType];
  if (minS == null || minS === 0) return words; // 不需要篩選
  var result = [];
  for (var i = 0; i < words.length; i++) {
    var s = await getWordStability(words[i].id);
    if (s >= minS) result.push(words[i]);
  }
  return result;
}

// 給玩家友善的「該玩什麼遊戲」提示
function getEasierGamesHint(gameType) {
  var minS = GAME_MIN_STABILITY[gameType];
  if (minS == null) return '';
  var easier = [];
  for (var key in GAME_MIN_STABILITY) {
    if (GAME_MIN_STABILITY[key] < minS) easier.push(GAME_NAMES_ZH[key]);
  }
  if (easier.length === 0) return '';
  return '這個遊戲需要你比較熟的單字喔！\n\n建議先去玩：' + easier.slice(0, 3).join('、');
}
