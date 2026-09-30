// ===== 看圖問答（取代原本的看圖說句）=====
// App 看著圖「問問題」，孩子用說的回答（聽懂問題 → 回答，練對話；國中會考聽力也有此題型）
// 題型依詞性與標籤產生，全部有「預期關鍵字」，語音辨識只要聽到關鍵字就算對：
//   noun  : What is it? → It's a {w}.         （關鍵字：目標字）
//   noun  : Is it a {w}? → Yes, it is.        （關鍵字：yes）
//   noun  : Is it a {other}? → No, it isn't.  （關鍵字：no）
//   verb  : What can you do? → I can {w}.     （關鍵字：目標字）
//   color : What color is it? → It's {w}.     （關鍵字：目標字）
//   adj   : Is it {w}? → Yes, it is.
// 不支援語音辨識時：顯示選項讓孩子點答案（仍是先聽問題、再回答）

function speakQuestionFor(target, others) {
  var w = String(target.word || '').trim();
  var lw = w.toLowerCase();
  var art = /^[aeiou]/i.test(w) ? 'an' : 'a';
  var tags = (target.tags || []).map(function(t) { return String(t).toLowerCase(); });
  var isColor = (typeof HUNT_COLOR_WORDS !== 'undefined' && HUNT_COLOR_WORDS.indexOf(lw) !== -1) || tags.indexOf('colors') !== -1 || tags.indexOf('color') !== -1;
  var other = (others || []).find(function(o) { return o.pos === target.pos && String(o.word).toLowerCase() !== lw && !/\s/.test(o.word); });
  var list = [];
  if (isColor) {
    list.push({ q: 'What color is it?', qZh: '這是什麼顏色？', a: "It's " + w + '.', keys: [lw] });
  } else if (target.pos === 'verb') {
    list.push({ q: 'What can you do?', qZh: '你會做什麼？', a: 'I can ' + w + '.', keys: [lw] });
    list.push({ q: 'Can you ' + w + '?', qZh: '你會' + (target.meaning || w) + '嗎？', a: 'Yes, I can.', keys: ['yes', 'can'] });
  } else if (target.pos === 'adj') {
    list.push({ q: 'Is it ' + w + '?', qZh: '它' + (target.meaning || w) + '嗎？', a: 'Yes, it is.', keys: ['yes'] });
  } else {
    list.push({ q: 'What is it?', qZh: '這是什麼？', a: "It's " + art + ' ' + w + '.', keys: [lw] });
    list.push({ q: 'Is it ' + art + ' ' + w + '?', qZh: '這是' + (target.meaning || w) + '嗎？', a: 'Yes, it is.', keys: ['yes'] });
    if (other) {
      var oart = /^[aeiou]/i.test(other.word) ? 'an' : 'a';
      list.push({ q: 'Is it ' + oart + ' ' + other.word + '?', qZh: '這是' + (other.meaning || other.word) + '嗎？', a: "No, it isn't. It's " + art + ' ' + w + '.', keys: ['no'] });
    }
  }
  return list[Math.floor(Math.random() * list.length)];
}

// 回答是否含關鍵字（任一個即可；目標字接受 -s/-es/-ing/-ed）
function answerHasKey(transcript, keys) {
  var t = String(transcript || '').toLowerCase();
  return keys.some(function(k) {
    var safe = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('\\b' + safe + '(s|es|ed|ing)?\\b').test(t);
  });
}

// 產生「點選答案」用的選項（無語音辨識時）
function speakAnswerChoices(qa, target, others) {
  var opts = [qa.a];
  if (qa.keys[0] === 'yes') opts.push("No, it isn't.");
  else if (qa.keys[0] === 'no') opts.push('Yes, it is.');
  var pool = (others || []).filter(function(o) { return o.id !== target.id && !/\s/.test(o.word); });
  while (opts.length < 3 && pool.length) {
    var o = pool.shift();
    opts.push(qa.a.replace(new RegExp('\\b' + String(target.word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i'), o.word));
  }
  return shuffleArray(opts.filter(function(x, i) { return opts.indexOf(x) === i; }));
}

// 單題渲染（一般遊戲與每日挑戰共用）：cb(ok, extra)
function renderSpeakQA(area, target, others, cb, progressText) {
  var supported = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
  var img = getRandomImage(target);
  var qa = speakQuestionFor(target, others);
  var answered = false, tries = 0;

  area.innerHTML =
    '<div class="qa">' +
      (progressText ? '<div class="qa-progress">' + progressText + '</div>' : '') +
      (img ? '<img class="qa-img" src="' + img + '" alt="" onerror="this.style.display=\'none\'">' : '<div class="qa-noimg">' + esc(target.meaning || target.word) + '</div>') +
      '<div class="qa-bubble"><span class="qa-who">🧑‍🏫</span>' +
        '<span class="qa-q">' + esc(qa.q) + '</span>' +
        '<button class="qa-mini" id="qaSayQ" aria-label="再聽一次問題">🔊</button></div>' +
      '<div class="qa-qzh">' + esc(qa.qZh) + '</div>' +
      '<div class="qa-answer" id="qaAnswer"></div>' +
      '<div class="qa-hint" id="qaHint" hidden>可以這樣回答：<b>' + esc(qa.a) + '</b> <button class="qa-mini" id="qaSayA" aria-label="聽回答範例">🔊</button></div>' +
      '<div class="qa-actions" id="qaActions"></div>' +
      '<div class="qa-feedback" id="qaFb" role="status" aria-live="polite"></div>' +
    '</div>';

  var sayQ = function() { speakWord(qa.q, 0.8); };
  setTimeout(sayQ, 350);
  document.getElementById('qaSayQ').onclick = sayQ;
  document.getElementById('qaSayA').onclick = function() { speakWord(qa.a, 0.8); };

  function done(ok, usedHint) {
    if (answered) return;
    answered = true;
    var fb = document.getElementById('qaFb');
    fb.innerHTML = ok
      ? '<span class="qa-win">🎉 答得好！</span>'
      : '<span class="qa-try">正確回答：' + esc(qa.a) + '</span>';
    setTimeout(function() { speakWord(qa.a, 0.8); }, 300);
    // 看了提示才答對 → hintUsed，FSRS 給 Good 而不是 Easy
    cb(ok, { mistakes: ok ? 0 : 1, hintUsed: usedHint ? 1 : 0, spokenWords: ok ? 3 : 0 });
  }

  var hintShown = false;
  function showHint() {
    hintShown = true;
    document.getElementById('qaHint').hidden = false;
  }

  if (!supported) {
    var opts = speakAnswerChoices(qa, target, others);
    document.getElementById('qaActions').innerHTML = opts.map(function(o, i) {
      return '<button class="qa-choice" data-i="' + i + '">' + esc(o) + '</button>';
    }).join('');
    document.querySelectorAll('.qa-choice').forEach(function(b) {
      b.onclick = function() {
        var ok = opts[parseInt(b.dataset.i, 10)] === qa.a;
        b.classList.add(ok ? 'correct' : 'wrong');
        document.querySelectorAll('.qa-choice').forEach(function(x) { x.disabled = true; });
        done(ok, false);
      };
    });
    return;
  }

  document.getElementById('qaActions').innerHTML =
    '<button class="qa-mic" id="qaMic">🎙️ 回答</button>' +
    '<button class="btn-sm" id="qaHelp">💡 怎麼回答？</button>';
  document.getElementById('qaHelp').onclick = showHint;

  var mic = document.getElementById('qaMic');
  var recognition = null;
  mic.onclick = function() {
    if (answered) return;
    if (recognition) { recognition.stop(); return; }
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SR();
    recognition.lang = 'en-US'; recognition.interimResults = false; recognition.maxAlternatives = 5;
    mic.textContent = '🔴 聽你說...'; mic.classList.add('recording');
    recognition.onresult = function(e) {
      var heard = '', ok = false;
      for (var i = 0; i < e.results[0].length; i++) {
        var t = e.results[0][i].transcript;
        if (!heard) heard = t;
        if (answerHasKey(t, qa.keys)) { ok = true; heard = t; break; }
      }
      document.getElementById('qaAnswer').innerHTML = '<span class="qa-who">🧒</span> ' + esc(heard || '...');
      if (ok) { done(true, hintShown); return; }
      tries++;
      if (tries >= 2) { done(false, true); return; }
      document.getElementById('qaFb').innerHTML = '<span class="qa-try">再說一次看看～</span>';
      showHint();
    };
    var reset = function() { mic.textContent = '🎙️ 回答'; mic.classList.remove('recording'); recognition = null; };
    recognition.onerror = function() { reset(); document.getElementById('qaFb').textContent = '沒聽清楚，再按一次 🎙️'; };
    recognition.onend = reset;
    recognition.start();
  };
}

// 一般遊戲版：5 題、支援中斷恢復
async function initSpeakGame(area, words) {
  var pool = words.filter(function(w) { return !/\s/.test(String(w.word || '')) && (w.tags || []).indexOf('grammar') === -1; });
  if (pool.length < 1) {
    area.innerHTML = '<p style="text-align:center;color:#999;padding:40px;">沒有適合問答的單字！</p>';
    return;
  }
  var state = (typeof prepareChallengeQueue === 'function')
    ? await prepareChallengeQueue('speak', pool, 5)
    : { queue: shuffleArray(pool).slice(0, Math.min(5, pool.length)), current: 0, correct: 0, total: Math.min(5, pool.length) };
  var queue = state.queue, total = state.total;
  var current = state.current, correct = state.correct;

  function next() {
    if (current >= queue.length) { showResult(correct, total); return; }
    var target = queue[current];
    var others = shuffleArray(words.filter(function(w) { return w.id !== target.id; }));
    renderSpeakQA(area, target, others, async function(ok, extra) {
      if (ok) correct++;
      extra.answerId = (typeof makeChallengeAnswerId === 'function') ? makeChallengeAnswerId('speak', current, target.id) : null;
      await updateProgress(target.id, ok, 'speak', extra);
      document.getElementById('gameScore').textContent = correct + ' / ' + (current + 1);
      current++;
      if (typeof checkpointGameChallenge === 'function') await checkpointGameChallenge('speak', current, correct, total);
      setTimeout(next, 2400);
    }, '💬 看圖問答 ' + (current + 1) + ' / ' + total);
  }
  next();
}
