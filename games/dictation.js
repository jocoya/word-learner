// ===== 句子聽寫（Dictation）— 挑戰模式 =====
// 聽例句 → 把整句打出來 → 逐字比對、標出錯的字
// 評分重點是「目標字有沒有拼對」：目標字對 + 整句全對 → Easy；目標字對、其他有錯 → Good；目標字錯 → Again
// 比對忽略大小寫、標點、多餘空白；縮寫（it's / it is）視為相同

var DICTATION_ROUNDS = 5;
var DICTATION_MAX_WORDS = 10;   // 太長的句子對小學生負擔太重

// 正規化：小寫、統一引號、展開常見縮寫、去掉標點
function dictNormalize(s) {
  var t = String(s || '').toLowerCase().replace(/[’‘]/g, "'");
  var CONTRACTIONS = {
    "it's": 'it is', "i'm": 'i am', "you're": 'you are', "he's": 'he is', "she's": 'she is',
    "we're": 'we are', "they're": 'they are', "that's": 'that is', "what's": 'what is',
    "don't": 'do not', "doesn't": 'does not', "can't": 'can not', "cannot": 'can not', "isn't": 'is not',
    "aren't": 'are not', "didn't": 'did not', "won't": 'will not', "let's": 'let us', "i'll": 'i will'
  };
  t = t.replace(/[a-z]+'[a-z]+|cannot/g, function(m) { return CONTRACTIONS[m] || m; });
  return t.replace(/[^a-z0-9'\s]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
}

// 逐字比對（LCS 對齊）：回傳每個「正確答案字」是否被打對，以及孩子多打/打錯的字
function dictDiff(expected, typed) {
  var a = dictNormalize(expected), b = dictNormalize(typed);
  var n = a.length, m = b.length;
  var dp = [];
  for (var i = 0; i <= n; i++) { dp.push(new Array(m + 1).fill(0)); }
  for (i = n - 1; i >= 0; i--) {
    for (var j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  var ok = new Array(n).fill(false);
  i = 0; j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ok[i] = true; i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  var correct = ok.filter(Boolean).length;
  return { words: a, ok: ok, correct: correct, total: n, extra: Math.max(0, m - correct), perfect: correct === n && m === n };
}

// 目標字（或其變化形）有沒有拼對
function dictTargetOk(diff, target) {
  var tw = String(target || '').toLowerCase();
  var re = new RegExp('^' + tw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(s|es|ed|d|ing)?$');
  var hit = false, anyOk = false;
  diff.words.forEach(function(w, i) {
    if (re.test(w)) { hit = true; if (diff.ok[i]) anyOk = true; }
  });
  return hit ? anyOk : diff.perfect; // 句子裡找不到目標字（例句變化形太特別）→ 用整句判斷
}

// 挑一句適合聽寫的例句：含目標字、3–10 個字
function pickDictationSentence(w) {
  var list = (w.sentences || []).map(function(s) { return String(s || '').trim(); }).filter(function(s) {
    var n = s.split(/\s+/).length;
    return n >= 3 && n <= DICTATION_MAX_WORDS && new RegExp('\\b' + String(w.word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(s);
  });
  if (!list.length) return null;
  list.sort(function(a, b) { return a.split(/\s+/).length - b.split(/\s+/).length; });
  // 從較短的一半隨機挑，增加變化
  var half = list.slice(0, Math.max(1, Math.ceil(list.length / 2)));
  return half[Math.floor(Math.random() * half.length)];
}

async function initDictationGame(area, words) {
  var pool = words.filter(function(w) { return pickDictationSentence(w); });
  if (pool.length < 1) {
    area.innerHTML = '<p style="text-align:center;color:#999;padding:40px;">需要有例句（3–10 個字）的單字才能玩聽寫！<br>可以到「管理單字」用 AI 補例句。</p>';
    return;
  }
  var state = (typeof prepareChallengeQueue === 'function')
    ? await prepareChallengeQueue('dictation', pool, DICTATION_ROUNDS)
    : { queue: shuffleArray(pool).slice(0, Math.min(DICTATION_ROUNDS, pool.length)), current: 0, correct: 0, total: Math.min(DICTATION_ROUNDS, pool.length) };
  var queue = state.queue, total = state.total;
  var current = state.current, correct = state.correct;

  function renderRound() {
    if (current >= queue.length) { showResult(correct, total); return; }
    var target = queue[current];
    var sentence = pickDictationSentence(target) || target.word;
    var answered = false;
    var plays = 0;

    area.innerHTML =
      '<div class="dict">' +
        '<div class="dict-progress">✍️ 句子聽寫 ' + (current + 1) + ' / ' + total + '</div>' +
        '<div class="dict-prompt">聽句子，把它<b>完整</b>打出來</div>' +
        '<div class="dict-play">' +
          '<button class="dict-speak" id="dictPlay">🔊 播放</button>' +
          '<button class="btn-sm" id="dictSlow">🐢 慢慢念</button>' +
        '</div>' +
        '<div class="dict-plays" id="dictPlays"></div>' +
        '<div class="dict-help"><button class="btn-sm" id="dictHint">💡 提示：這句有 ' + dictNormalize(sentence).length + ' 個字，重點字是…</button>' +
          '<span class="dict-hint-word" id="dictHintWord" hidden>' + esc(target.meaning || '') + '</span></div>' +
        '<input class="dict-input" id="dictInput" type="text" autocomplete="off" autocapitalize="sentences" spellcheck="false" aria-label="輸入你聽到的句子">' +
        '<div class="dict-actions"><button class="btn-primary" id="dictCheck" disabled>檢查</button></div>' +
        '<div class="dict-result" id="dictResult" role="status" aria-live="polite"></div>' +
      '</div>';

    function play(rate) {
      plays++;
      document.getElementById('dictPlays').textContent = '已聽 ' + plays + ' 次';
      speakWord(sentence, rate);
    }
    setTimeout(function() { play(0.75); }, 400);
    document.getElementById('dictPlay').onclick = function() { play(0.75); };
    document.getElementById('dictSlow').onclick = function() { play(0.5); };
    var hintUsed = false;
    document.getElementById('dictHint').onclick = function() {
      hintUsed = true;
      document.getElementById('dictHintWord').hidden = false;
      this.disabled = true;
    };

    var input = document.getElementById('dictInput');
    var check = document.getElementById('dictCheck');
    input.addEventListener('input', function() { check.disabled = !input.value.trim(); });
    input.addEventListener('keydown', function(e) { if (e.key === 'Enter' && !check.disabled) check.click(); });
    setTimeout(function() { input.focus(); }, 200);

    check.onclick = async function() {
      if (answered) return;
      answered = true;
      input.disabled = true; check.disabled = true;
      var diff = dictDiff(sentence, input.value);
      var targetOk = dictTargetOk(diff, target.word);
      // 顯示正確句子：打對的字綠色、漏掉/打錯的字紅色底線
      var shown = diff.words.map(function(w, i) {
        return '<span class="' + (diff.ok[i] ? 'dict-ok' : 'dict-miss') + '">' + esc(w) + '</span>';
      }).join(' ');
      var pct = diff.total ? Math.round(diff.correct / diff.total * 100) : 0;
      var mistakes = diff.perfect ? 0 : (targetOk ? 1 : 2);
      var msg = diff.perfect ? '🎉 全部正確！' : (targetOk ? '👍 重點字寫對了！（' + pct + '%）' : '💪 重點字是 <b>' + esc(target.word) + '</b>，再練練！');
      document.getElementById('dictResult').innerHTML =
        '<div class="dict-msg">' + msg + '</div>' +
        '<div class="dict-answer">' + shown + '</div>' +
        (diff.perfect ? '' : '<div class="dict-yours">你寫的：' + esc(input.value) + '</div>') +
        '<button class="btn-primary" id="dictNext">下一題 →</button>';
      speakWord(sentence, 0.8);
      if (mistakes === 0) correct++;
      // 用了提示最多算 Good
      if (mistakes === 0 && hintUsed) mistakes = 1;
      var extra = {
        mistakes: mistakes, hintUsed: hintUsed ? 1 : 0,
        answerId: (typeof makeChallengeAnswerId === 'function') ? makeChallengeAnswerId('dictation', current, target.id) : null
      };
      await updateProgress(target.id, targetOk, 'dictation', extra);
      document.getElementById('gameScore').textContent = correct + ' / ' + (current + 1);
      current++;
      if (typeof checkpointGameChallenge === 'function') await checkpointGameChallenge('dictation', current, correct, total);
      // 讓孩子看完對錯再按下一題（不自動跳）
      document.getElementById('dictNext').onclick = renderRound;
    };
  }

  renderRound();
}
