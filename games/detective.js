// 線索偵探遊戲

// 詞性英文 → 中文
var POS_ZH = {
  noun: '名詞', verb: '動詞', adj: '形容詞', adv: '副詞',
  prep: '介系詞', other: '單字'
};

// 缺英英解釋時的智慧 fallback：詞性 + 首字母 + 字數
function buildWordHint(target) {
  var parts = [];
  if (target.pos && POS_ZH[target.pos]) {
    parts.push('這是一個「' + POS_ZH[target.pos] + '」');
  } else {
    parts.push('猜猜這個字');
  }
  var letters = target.word.replace(/\s/g, '').length;
  parts.push('開頭是「' + target.word.charAt(0).toUpperCase() + '」');
  parts.push('總共 ' + letters + ' 個字母');
  if (target.antonym && target.antonym.trim()) {
    parts.push('反義詞是「' + target.antonym + '」');
  }
  return parts.join('，') + '。';
}

// 逐步揭示字母骨架：露出前 n 個字母，其餘用底線
function buildLetterSkeleton(word, revealCount) {
  return word.split('').map(function(ch, i) {
    if (ch === ' ') return ' ';
    return i < revealCount ? ch : '_';
  }).join(' ');
}

function initDetectiveGame(area, words) {
  var supported = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
  var withSentence = words.filter(function(w) { return w.sentences && w.sentences.length > 0; });
  if (withSentence.length < 4) {
    area.innerHTML = '<p style="text-align:center;color:#999;padding:40px;">需要至少 4 個有例句的單字！</p>';
    return;
  }
  var total = Math.min(8, withSentence.length);

  // 建立佇列：若從「認識新字」入口進來，優先排新字（S=0）
  var learnFirst = (typeof window !== 'undefined' && window.detectiveLearnFirst);
  window.detectiveLearnFirst = false; // 用完即清

  var current = 0, correct = 0;
  var queue;

  function buildQueueAndStart() {
    if (learnFirst) {
      // 依 stability 把新字排前面
      var enriched = [];
      var pending = withSentence.length;
      withSentence.forEach(function(w) {
        getWordStability(w.id).then(function(s) {
          enriched.push({ w: w, s: s });
          if (--pending === 0) {
            var news = shuffleArray(enriched.filter(function(x){ return !x.s || x.s <= 0; }));
            var olds = shuffleArray(enriched.filter(function(x){ return x.s > 0; }));
            queue = news.concat(olds).slice(0, total).map(function(x){ return x.w; });
            renderRound();
          }
        });
      });
    } else {
      queue = shuffleArray(withSentence).slice(0, total);
      renderRound();
    }
  }

  function renderRound() {
    if (current >= queue.length) { showResult(correct, total); return; }
    var target = queue[current];
    // 依熟練度決定模式：新字（S=0）→ 學習模式；熟字 → 偵探模式
    getWordStability(target.id).then(function(s) {
      if (!s || s <= 0) renderLearnMode(target);
      else renderDetectiveMode(target);
    });
  }

  // ===== 學習模式（新字）：給線索 → 直接揭曉，不要求作答 =====
  function renderLearnMode(target) {
    var img = getRandomImage(target);
    var sentence = (target.sentences || []).find(function(s){ return s && s.trim(); });
    var blanked = sentence ? sentence.replace(new RegExp('\\b' + target.word + '\\b', 'gi'), '______') : '';

    area.innerHTML =
      '<div class="learn-scene">' +
        '<div class="learn-badge">🔍 認識新朋友</div>' +
        (img ? '<img class="learn-img" src="' + img + '" alt="" onerror="this.style.display=\'none\'">' : '') +
        (blanked ? '<div class="learn-sentence" id="learnSentence">' + esc(blanked) + '</div>' : '') +
        '<div class="learn-reveal" id="learnReveal" style="opacity:0;">' +
          '<div class="learn-word">' + esc(target.word) + '</div>' +
          '<div class="learn-meaning">' + esc(target.meaning) + '</div>' +
          '<button class="learn-speak" onclick="speakWord(\'' + esc(target.word) + '\',0.7)">🔊 再聽一次</button>' +
        '</div>' +
        '<div class="det-progress">' + (current+1) + ' / ' + total + '</div>' +
        '<button class="learn-next-btn" id="learnNextBtn" onclick="learnReveal()">看答案 👀</button>' +
      '</div>';

    // 先念例句（如果有），讓孩子聽語境
    if (sentence) setTimeout(function(){ speakWord(sentence, 0.7); }, 400);

    var revealed = false;
    window.learnReveal = function() {
      if (!revealed) {
        // 第一次按：揭曉單字
        revealed = true;
        var r = document.getElementById('learnReveal');
        if (r) { r.style.transition = 'opacity 0.5s'; r.style.opacity = '1'; }
        // 填回完整句子
        var se = document.getElementById('learnSentence');
        if (se && sentence) se.innerHTML = esc(sentence.replace(new RegExp('\\b' + target.word + '\\b', 'gi'),
          '<span class="cloze-filled">' + esc(target.word) + '</span>'));
        speakWord(target.word, 0.7);
        var btn = document.getElementById('learnNextBtn');
        if (btn) btn.textContent = '下一個 →';
      } else {
        // 第二次按：給輕量初始進度，進下一個
        // 學習模式給 Good(視為認識)，但因為 reps=0 首玩會被 FIRST_PLAY_SCALE 壓低，不會暴衝
        updateProgress(target.id, true, 'detective', { mistakes: 0 });
        current++;
        renderRound();
      }
    };
  }

  // ===== 偵探模式（熟字）：清爽單欄 + 漸進線索 + 語音/選擇兩種作答 =====
  function renderDetectiveMode(target) {
    var sentences = (target.sentences || []).slice();
    var wordLen = target.word.replace(/\s/g, '').length;

    // 線索清單（依序揭示）
    var clues = [];
    // 線索 1：英英解釋（沒有就用詞性/反義詞提示）
    if (target.definition && target.definition.trim()) {
      clues.push({ icon: '📖', label: '英英解釋', text: target.definition });
    } else {
      clues.push({ icon: '🔤', label: '提示', text: buildWordHint(target) });
    }
    // 線索 2：例句挖空
    var shuffledSen = shuffleArray(sentences);
    if (shuffledSen.length >= 1) {
      var wordRegex = new RegExp('\\b' + target.word + '\\b', 'gi');
      clues.push({ icon: '💬', label: '例句', text: shuffledSen[0].replace(wordRegex, '＿＿＿') });
    }

    // 干擾選項（給選擇題用）
    var pool = (typeof withSentence !== 'undefined' ? withSentence : sentences);
    var others = shuffleArray((words || []).filter(function(w){ return w.id !== target.id; })).slice(0, 3);
    var choiceOptions = shuffleArray([target].concat(others));

    var answered = false;
    var clueShown = 1;          // 已顯示幾張線索卡
    var letterReveal = 1;       // 骨架已揭示字母數（首字母先給）
    var choicesShown = false;   // 是否已顯示選擇題

    area.innerHTML =
      '<div class="det2">' +
        '<div class="det2-top">' +
          '<span class="det2-progress">🔍 ' + (current+1) + ' / ' + total + '</span>' +
          '<span class="det2-len">共 ' + wordLen + ' 個字母</span>' +
        '</div>' +
        '<div class="det2-skeleton" id="det2Skeleton">' + buildLetterSkeleton(target.word, 1) + '</div>' +
        '<div class="det2-clues" id="det2Clues"></div>' +
        '<div class="det2-feedback" id="det2Feedback"></div>' +
        '<div class="det2-choices" id="det2Choices" hidden></div>' +
        '<div class="det2-actions">' +
          '<button class="det2-btn det2-clue" id="det2ClueBtn" onclick="detNextClue()">🔍 給我線索</button>' +
          (supported ? '<button class="det2-btn det2-mic" id="det2MicBtn" onclick="detVoiceAnswer()">🎙️ 說答案</button>' : '') +
          '<button class="det2-btn det2-skip" onclick="skipDetective()">跳過 →</button>' +
        '</div>' +
      '</div>';

    var cluesEl = document.getElementById('det2Clues');
    // 先顯示第一張線索卡
    function appendClue(c) {
      var div = document.createElement('div');
      div.className = 'det2-card';
      div.innerHTML = '<span class="det2-card-icon">' + c.icon + '</span>' +
        '<span class="det2-card-body"><b>' + esc(c.label) + '</b><br>' + esc(c.text) + '</span>';
      cluesEl.appendChild(div);
      setTimeout(function(){ div.classList.add('show'); }, 30);
    }
    appendClue(clues[0]);

    // 「給我線索」：依序 揭示線索卡 → 逐字母 → 最後給選擇題
    window.detNextClue = function() {
      if (answered) return;
      // 階段一：還有線索卡沒揭示
      if (clueShown < clues.length) {
        appendClue(clues[clueShown]);
        clueShown++;
        return;
      }
      // 階段二：逐字母揭示
      if (letterReveal < wordLen) {
        letterReveal++;
        document.getElementById('det2Skeleton').innerHTML = buildLetterSkeleton(target.word, letterReveal);
        // 字母揭示到一半後，提示可以用選擇題
        if (letterReveal >= Math.ceil(wordLen / 2) && !choicesShown) {
          var btn = document.getElementById('det2ClueBtn');
          if (btn) btn.textContent = '🎯 給我選項';
        }
        return;
      }
      // 階段三：給選擇題（最後線索）
      if (!choicesShown) showChoices();
    };

    function showChoices() {
      choicesShown = true;
      var box = document.getElementById('det2Choices');
      box.hidden = false;
      box.innerHTML = choiceOptions.map(function(o) {
        return '<button class="det2-choice" data-id="' + o.id + '">' + esc(o.word) + '</button>';
      }).join('');
      box.querySelectorAll('.det2-choice').forEach(function(b) {
        b.addEventListener('click', function() {
          if (answered) return;
          var ok = parseInt(b.dataset.id) === target.id;
          b.classList.add(ok ? 'correct' : 'wrong');
          if (ok) win(0); else {
            var r = box.querySelector('.det2-choice[data-id="' + target.id + '"]');
            if (r) r.classList.add('correct');
            lose();
          }
        });
      });
      var btn = document.getElementById('det2ClueBtn');
      if (btn) btn.style.display = 'none';
    }

    // 語音作答
    var recognition = null;
    window.detVoiceAnswer = function() {
      if (answered) return;
      if (recognition) { recognition.stop(); return; }
      var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognition = new SR();
      recognition.lang = 'en-US'; recognition.interimResults = false; recognition.maxAlternatives = 5;
      var mic = document.getElementById('det2MicBtn');
      mic.textContent = '🔴 聽你說...'; mic.classList.add('recording');
      recognition.onresult = function(e) {
        var found = false, best = '';
        for (var i = 0; i < e.results[0].length; i++) {
          var t = e.results[0][i].transcript.toLowerCase();
          if (!best) best = e.results[0][i].transcript;
          if (t.indexOf(target.word.toLowerCase()) !== -1) { found = true; break; }
        }
        mic.textContent = '🎙️ 說答案'; mic.classList.remove('recording'); recognition = null;
        if (found) win(0);
        else document.getElementById('det2Feedback').innerHTML = '<span class="det2-try">你說了「' + esc(best) + '」，再試試？</span>';
      };
      recognition.onerror = function() { mic.textContent = '🎙️ 說答案'; mic.classList.remove('recording'); recognition = null; };
      recognition.onend = function() { mic.textContent = '🎙️ 說答案'; mic.classList.remove('recording'); recognition = null; };
      recognition.start();
    };

    function win(mistakes) {
      if (answered) return;
      answered = true;
      correct++;
      speakWord(target.word, 0.7);
      updateProgress(target.id, true, 'detective', { mistakes: mistakes });
      document.getElementById('gameScore').textContent = correct + ' / ' + (current+1);
      document.getElementById('det2Skeleton').innerHTML = '<span class="det2-answer">' + esc(target.word) + '</span>';
      document.getElementById('det2Feedback').innerHTML = '<span class="det2-win">🎉 答對了！</span>';
      setTimeout(function() { current++; renderRound(); }, 2200);
    }
    function lose() {
      if (answered) return;
      answered = true;
      speakWord(target.word, 0.7);
      updateProgress(target.id, false, 'detective', { mistakes: 2 });
      document.getElementById('det2Skeleton').innerHTML = '<span class="det2-answer">' + esc(target.word) + '</span>';
      document.getElementById('det2Feedback').innerHTML = '<span class="det2-try">正確答案：' + esc(target.word) + '</span>';
      setTimeout(function() { current++; renderRound(); }, 2200);
    }

    window.skipDetective = function() {
      if (answered) return;
      answered = true;
      updateProgress(target.id, false, 'detective', { mistakes: 2 });
      speakWord(target.word, 0.7);
      document.getElementById('det2Skeleton').innerHTML = '<span class="det2-answer">' + esc(target.word) + '</span>';
      setTimeout(function() { current++; renderRound(); }, 1500);
    };
  }
  buildQueueAndStart();
}
