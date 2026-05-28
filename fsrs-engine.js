// ===== FSRS-4.5 簡化版引擎 + Game Middleware =====
// 不需要外部依賴，純 JS 實作

// FSRS 預設參數（從 ts-fsrs 預設值簡化）
var FSRS_W = [0.4072, 1.1829, 3.1262, 15.4722, 7.2102, 0.5316, 1.0651, 0.0234,
              1.616, 0.1544, 1.0824, 1.9813, 0.0953, 0.2975, 2.2042, 0.2407,
              2.9466, 0.5034, 0.6567];
var REQUEST_RETENTION = 0.9;
var DECAY = -0.5;
var FACTOR = Math.pow(0.9, 1 / DECAY) - 1;

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
    unlockedStages: [],   // 已解鎖的階段（1=S>=2, 2=S>=8, 3=S>=20）
    todayReviewed: ''     // 今天最後複習的日期 (YYYY-MM-DD)
  };
}

// 把舊的 progress 升級成 FSRS 格式（向後相容）
function fsrsUpgrade(progress) {
  if (typeof progress.stability !== 'undefined') return progress;
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
    // 第一次複習：使用初始值
    newS = w[rating - 1]; // w0~w3 對應 Again/Hard/Good/Easy 的初始穩定度
    newD = w[4] - (rating - 3) * w[5];
    newD = Math.max(1, Math.min(10, newD));
  } else {
    var r = fsrsRetrievability(elapsedDays, progress.stability);

    if (rating === 1) {
      // Again：穩定度大幅下降
      newS = w[11] * Math.pow(progress.difficulty, -w[12]) *
             (Math.pow(progress.stability + 1, w[13]) - 1) *
             Math.exp((1 - r) * w[14]);
      newS = Math.max(0.1, newS);
      progress.lapses++;
    } else {
      // Hard/Good/Easy：穩定度增加
      var hardPenalty = rating === 2 ? w[15] : 1;
      var easyBonus = rating === 4 ? w[16] : 1;
      newS = progress.stability * (1 + Math.exp(w[8]) *
             (11 - progress.difficulty) *
             Math.pow(progress.stability, -w[9]) *
             (Math.exp((1 - r) * w[10]) - 1) *
             hardPenalty * easyBonus);
    }
    newD = progress.difficulty - w[6] * (rating - 3);
    newD = w[7] * 5 + (1 - w[7]) * newD;
    newD = Math.max(1, Math.min(10, newD));
  }

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
function gameToRating(payload) {
  var gt = payload.gameType;
  var m = payload.mistakes || 0;
  var t = payload.timeUsed || 0;
  var hint = payload.hintUsed || 0;

  if (gt === 'memory') {
    if (m === 0 && t < 3) return 4;
    if (m === 0) return 3;
    if (m === 1) return 2;
    return 1;
  }
  if (gt === 'listen' || gt === 'flashlight') {
    if (m > 0) return 1;
    return t < 2 ? 4 : 3;
  }
  if (gt === 'bubble') {
    if (m > 0) return 1;
    return t < 1.5 ? 4 : 3;
  }
  if (gt === 'spelling') {
    if (m === 0 && hint === 0) return 4;
    if (m === 1 || hint === 1) return 2;
    if (m >= 2) return 1;
    return 3;
  }
  if (gt === 'fillblank' || gt === 'detective') {
    if (m === 0) return 3;
    if (m === 1) return 2;
    return 1;
  }
  if (gt === 'echo' || gt === 'speak') {
    if (m === 0) return 3;
    return 1;
  }
  return 3;
}

// 統一入口：遊戲完成時呼叫這個
// 回傳獎勵資訊：{ rating, coinEarned, diamondEarned, stageUnlocked }
async function recordGameResult(payload) {
  var rating = gameToRating(payload);
  var p = await dbGet('progress', payload.wordId);
  if (!p) p = fsrsInitProgress(payload.wordId);
  else p = fsrsUpgrade(p);

  var prevS = p.stability || 0;
  var todayStr = (function() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  })();
  var isFirstToday = p.todayReviewed !== todayStr;

  // 套用 FSRS
  var newP = fsrsReview(p, rating);
  newP.todayReviewed = todayStr;

  // 檢查階段升級
  var stageThresholds = [{level: 1, s: 2}, {level: 2, s: 8}, {level: 3, s: 20}];
  var unlockedStages = newP.unlockedStages || [];
  var newStageUnlocked = null;
  stageThresholds.forEach(function(stage) {
    if (prevS < stage.s && newP.stability >= stage.s && unlockedStages.indexOf(stage.level) === -1) {
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

// 取得今日該複習的單字（FSRS 版本，R<90%）
async function getDueWordsFSRS(pool) {
  var all = pool === 'permanent'
    ? await dbGetByIndex('words', 'pool', 'permanent')
    : await dbGetAll('words');
  var now = Date.now();
  var due = [];
  for (var i = 0; i < all.length; i++) {
    var p = await dbGet('progress', all[i].id);
    if (!p) { due.push(all[i]); continue; }
    p = fsrsUpgrade(p);
    if (p.due <= now) due.push(all[i]);
  }
  return due;
}

// 根據 S 值推薦遊戲類型（鷹架理論）
function recommendGameByStability(stability) {
  if (stability < 2) return ['memory', 'listen'];
  if (stability < 8) return ['bubble'];
  if (stability < 20) return ['spelling', 'detective'];
  return ['fillblank'];
}
