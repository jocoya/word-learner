// ===== 仿造句子（Pattern Talk）— 挑戰模式 =====
// 目標：自己產出句子（generation effect）+ 連結自己的生活。
// 流程：看句型範本（依詞性）→ 聽範例 → 用「自己的」東西/事情替換空格 → 說出來 → 打出來 → 家長確認
// 不做 AI 批改：家長按 ✓ 就算完成；句子要包含目標字才能送出（大小寫、變化形 -s/-ed/-ing 都接受）

var PATTERN_ROUNDS = 5;

// 依詞性的句型（___ 的位置放目標字；{w} 會換成目標字）
var PATTERN_TEMPLATES = {
  noun: [
    { en: 'I have a {w}.', zh: '我有一個 {w}。' },
    { en: 'I like my {w}.', zh: '我喜歡我的 {w}。' },
    { en: 'This is my {w}. It is ___.', zh: '這是我的 {w}，它是 ___。' },
    { en: 'I see a {w} in the ___.', zh: '我在 ___ 看到一個 {w}。' }
  ],
  verb: [
    { en: 'I can {w}.', zh: '我會 {w}。' },
    { en: 'I like to {w} with my ___.', zh: '我喜歡和我的 ___ 一起 {w}。' },
    { en: 'Every day, I {w} ___.', zh: '每天我都 {w} ___。' }
  ],
  adj: [
    { en: 'I am {w}.', zh: '我很 {w}。' },
    { en: 'My ___ is {w}.', zh: '我的 ___ 很 {w}。' },
    { en: 'I feel {w} when I ___.', zh: '當我 ___ 的時候，我覺得很 {w}。' }
  ],
  other: [
    { en: 'I like {w}.', zh: '我喜歡 {w}。' },
    { en: 'I see {w} ___.', zh: '我看到 {w} ___。' }
  ]
};

function patternPosOf(w) {
  if (w.pos === 'noun' || w.pos === 'verb' || w.pos === 'adj') return w.pos;
  return 'other';
}

// 句子是否含目標字（接受常見變化形）
function sentenceHasWord(sentence, word) {
  var safe = String(word).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!safe) return false;
  return new RegExp('\\b' + safe + '(s|es|ed|d|ing)?\\b', 'i').test(String(sentence || ''));
}

// 適合造句的字：單字（非片語）、不是功能詞
function isPatternWord(w) {
  var s = String(w.word || '').trim();
  if (!/^[A-Za-z][A-Za-z'\-]*$/.test(s)) return false;
  if ((w.tags || []).indexOf('grammar') !== -1) return false;
  return true;
}

async function initPatternGame(area, words) {
  var pool = words.filter(isPatternWord);
  if (pool.length < 1) {
    area.innerHTML = '<p style="text-align:center;color:#999;padding:40px;">沒有適合造句的單字，先新增一些名詞、動詞或形容詞吧！</p>';
    return;
  }
  var state = (typeof prepareChallengeQueue === 'function')
    ? await prepareChallengeQueue('pattern', pool, PATTERN_ROUNDS)
    : { queue: shuffleArray(pool).slice(0, Math.min(PATTERN_ROUNDS, pool.length)), current: 0, correct: 0, total: Math.min(PATTERN_ROUNDS, pool.length) };
  var queue = state.queue, total = state.total;
  var current = state.current, correct = state.correct;
  var supportsMic = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;

  function renderRound() {
    if (current >= queue.length) { showResult(correct, total); return; }
    var target = queue[current];
    var templates = PATTERN_TEMPLATES[patternPosOf(target)];
    var tpl = templates[Math.floor(Math.random() * templates.length)];
    var model = tpl.en.replace('{w}', target.word);
    var modelZh = tpl.zh.replace('{w}', target.meaning || target.word);
    var example = getRandomSentence(target);
    var img = getRandomImage(target);
    var answered = false;
    var spoke = false;

    area.innerHTML =
      '<div class="pat">' +
        '<div class="pat-progress">💬 仿造句子 ' + (current + 1) + ' / ' + total + '</div>' +
        '<div class="pat-card">' +
          (img ? '<img class="pat-img" src="' + img + '" alt="" onerror="this.style.display=\'none\'">' : '') +
          '<div><div class="pat-word">' + esc(target.word) + '</div><div class="pat-mean">' + esc(target.meaning || '') + '</div></div>' +
        '</div>' +
        '<div class="pat-step">① 看句型，用<b>你自己的</b>東西或事情來說</div>' +
        '<div class="pat-model">' + highlightPatternModel(model, target.word) +
          ' <button class="pat-mini" id="patSayModel" aria-label="聽句型">🔊</button></div>' +
        '<div class="pat-model-zh">' + esc(modelZh) + '</div>' +
        (example ? '<div class="pat-example">例如：' + esc(example) + ' <button class="pat-mini" id="patSayEx" aria-label="聽例句">🔊</button></div>' : '') +
        '<div class="pat-step">② 說出來</div>' +
        '<div class="pat-say">' +
          (supportsMic ? '<button class="pat-mic" id="patMic">🎙️ 說說看</button>' : '') +
          '<button class="btn-sm" id="patSaid">' + (supportsMic ? '我說過了（不錄音）' : '我說好了 ✓') + '</button>' +
        '</div>' +
        '<div class="pat-heard" id="patHeard" aria-live="polite"></div>' +
        '<div class="pat-write" id="patWrite" hidden>' +
          '<div class="pat-step">③ 把你說的句子打出來</div>' +
          '<input class="pat-input" id="patInput" type="text" autocomplete="off" autocapitalize="sentences" spellcheck="false" ' +
            'placeholder="' + esc(model.replace(/___/g, '...')) + '" aria-label="輸入你的句子">' +
          '<div class="pat-input-tip" id="patTip"></div>' +
          '<div class="pat-actions">' +
            '<button class="btn-primary" id="patSubmit" disabled>送出給爸媽看</button>' +
            '<button class="btn-sm" id="patSkipWrite">只說不寫</button>' +
          '</div>' +
        '</div>' +
        '<div class="pat-confirm" id="patConfirm" hidden>' +
          '<div class="pat-final" id="patFinal"></div>' +
          '<div class="pat-confirm-q">👨‍👩‍👧 家長確認：句子有用對 <b>' + esc(target.word) + '</b> 嗎？</div>' +
          '<div class="pat-actions">' +
            '<button class="btn-sm btn-green" id="patOk">✓ 很好！</button>' +
            '<button class="btn-sm" id="patHelp">🤝 有幫忙才完成</button>' +
            '<button class="btn-sm" id="patRetry">↺ 再試一次</button>' +
            '<button class="btn-sm" id="patNext">換下一題 →</button>' +
          '</div>' +
        '</div>' +
        '<div class="pat-feedback" id="patFb" role="status" aria-live="polite"></div>' +
      '</div>';

    var sayModel = function() { speakWord(model.replace(/___/g, ''), 0.75); };
    document.getElementById('patSayModel').onclick = sayModel;
    var exBtn = document.getElementById('patSayEx');
    if (exBtn) exBtn.onclick = function() { speakWord(example, 0.75); };
    setTimeout(sayModel, 400);

    function openWrite() {
      if (spoke) return;
      spoke = true;
      document.getElementById('patWrite').hidden = false;
      var inp = document.getElementById('patInput');
      setTimeout(function() { inp.focus(); }, 100);
    }

    var input, tip, submit;
    function bindWrite() {
      input = document.getElementById('patInput');
      tip = document.getElementById('patTip');
      submit = document.getElementById('patSubmit');
      input.addEventListener('input', function() {
        var v = input.value.trim();
        var has = sentenceHasWord(v, target.word);
        var enough = v.split(/\s+/).filter(Boolean).length >= 3;
        submit.disabled = !(has && enough);
        tip.textContent = !v ? '' : (!has ? '句子裡要有 ' + target.word + ' 喔' : (!enough ? '再多寫幾個字' : '👍 可以送出了'));
        tip.className = 'pat-input-tip' + (has && enough ? ' ok' : '');
      });
      input.addEventListener('keydown', function(e) { if (e.key === 'Enter' && !submit.disabled) submit.click(); });
      submit.onclick = function() { showConfirm(input.value.trim(), false); };
      document.getElementById('patSkipWrite').onclick = function() { showConfirm(lastHeard || '', true); };
    }
    bindWrite();

    var lastHeard = '';
    var mic = document.getElementById('patMic');
    if (mic) {
      mic.onclick = function() {
        var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        var r = new SR();
        r.lang = 'en-US'; r.interimResults = false; r.maxAlternatives = 1;
        mic.textContent = '🔴 聽你說...'; mic.classList.add('recording');
        r.onresult = function(e) {
          lastHeard = e.results[0][0].transcript || '';
          var ok = sentenceHasWord(lastHeard, target.word);
          document.getElementById('patHeard').innerHTML = '我聽到：「' + esc(lastHeard) + '」' +
            (ok ? ' 👍' : '<br><small>（沒聽到 ' + esc(target.word) + '，沒關係，打出來也可以）</small>');
          openWrite();
        };
        var reset = function() { mic.textContent = '🎙️ 再說一次'; mic.classList.remove('recording'); };
        r.onerror = function() { reset(); document.getElementById('patHeard').textContent = '沒聽清楚，再說一次，或按「我說過了」'; };
        r.onend = reset;
        r.start();
      };
    }
    document.getElementById('patSaid').onclick = openWrite;

    // 只說不寫 → 算有幫忙（Good），寫出來 → Easy
    var skippedWrite = false;
    function showConfirm(text, noWrite) {
      skippedWrite = noWrite;
      document.getElementById('patWrite').hidden = true;
      document.getElementById('patConfirm').hidden = false;
      document.getElementById('patFinal').innerHTML = text
        ? '「' + highlightPatternModel(text, target.word) + '」'
        : '<span class="pat-mean">（用說的完成）</span>';
      if (text) speakWord(text, 0.8);
    }

    async function finish(mistakes, helped) {
      if (answered) return;
      answered = true;
      document.getElementById('patConfirm').hidden = true;
      if (mistakes === 0) correct++;
      document.getElementById('patFb').innerHTML = mistakes === 0
        ? '<span class="pat-win">🎉 你自己造出句子了！</span>'
        : '<span class="pat-mean">有練習就很棒，下次再試試！</span>';
      var extra = {
        mistakes: mistakes,
        hintUsed: (helped || skippedWrite) ? 1 : 0,
        answerId: (typeof makeChallengeAnswerId === 'function') ? makeChallengeAnswerId('pattern', current, target.id) : null
      };
      await updateProgress(target.id, mistakes === 0, 'pattern', extra);
      document.getElementById('gameScore').textContent = correct + ' / ' + (current + 1);
      current++;
      if (typeof checkpointGameChallenge === 'function') await checkpointGameChallenge('pattern', current, correct, total);
      setTimeout(renderRound, 1800);
    }

    document.getElementById('patHelp').onclick = function() { finish(0, true); };
    // 再試一次：回到打字，孩子重寫（不記分）
    var retried = false;
    document.getElementById('patRetry').onclick = function() {
      retried = true;
      document.getElementById('patConfirm').hidden = true;
      document.getElementById('patWrite').hidden = false;
      setTimeout(function() { input.focus(); input.select(); }, 100);
    };
    // 換下一題：家長覺得沒用對 → 記一次 Hard（仍有練到，不當忘記），避免孩子卡住
    document.getElementById('patNext').onclick = function() { finish(1, true); };
    // ✓ 很好：一次就寫對 → Easy；重寫後才對 → 視為有幫忙（Good）
    document.getElementById('patOk').onclick = function() { finish(0, retried); };
  }

  renderRound();
}

// 句型中的目標字標亮、___ 變成空格框
function highlightPatternModel(text, word) {
  var html = esc(text).replace(/___/g, '<span class="pat-blank">___</span>');
  var safe = String(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return html.replace(new RegExp('\\b(' + safe + '(?:s|es|ed|d|ing)?)\\b', 'gi'), '<mark>$1</mark>');
}
