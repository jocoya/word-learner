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

  // ===== 偵探模式（熟字）：原本的猜謎玩法 =====
  function renderDetectiveMode(target) {
    var sentences = (target.sentences || []).slice();
    var clues = [];

    // 線索 1：英英解釋。沒有就用「詞性 + 首字母 + 字數」智慧 fallback
    if (target.definition && target.definition.trim()) {
      clues.push('📖 ' + target.definition);
    } else {
      clues.push('🔤 ' + buildWordHint(target));
    }

    // 線索 2：例句（挖空答案）
    var shuffledSen = shuffleArray(sentences);
    var wordRegex = new RegExp('\\b' + target.word + '\\b', 'gi');
    if (shuffledSen.length >= 1) {
      clues.push('💬 ' + shuffledSen[0].replace(wordRegex, '______'));
    }

    // 線索 3：逐步揭示字母（首字母 + 字數骨架）
    clues.push('✏️ ' + buildLetterSkeleton(target.word, 1));

    // 線索 4：中文意思（最後才給）
    clues.push('🀄 ' + target.meaning);

    var clueIdx = 0;

    // 底線提示：每個字母一個底線
    var blanks = target.word.split('').map(function() { return '_'; }).join(' ');

    area.innerHTML =
      '<div class="det-scene">' +
        '<img class="det-bg" src="./images/find.png" alt="">' +
        '<div class="det-overlay-split">' +
          '<div class="det-left">' +
            '<div class="det-blanks" id="detBlanks">' + blanks + '</div>' +
            '<div class="det-feedback" id="detFeedback"></div>' +
          '</div>' +
          '<div class="det-right">' +
            '<div class="det-progress">' + (current+1) + ' / ' + total + '</div>' +
            '<div class="det-cards" id="detCards">' +
              clues.map(function(c, i) {
                return '<div class="det-card" id="detCard' + i + '" style="opacity:' + (i === 0 ? '1' : '0') + ';transform:translateY(' + (i === 0 ? '0' : '-20px') + ')">' +
                  '<div class="det-card-text">' + esc(c) + '</div>' +
                '</div>';
              }).join('') +
            '</div>' +
            '<div class="det-actions">' +
              '<button class="det-clue-btn" id="detClueBtn" onclick="revealNextClue()">🔍 獲得線索</button>' +
              (supported ? '<button class="det-answer-btn" id="detAnswerBtn" onclick="startDetAnswer()">🎙️ 講出答案</button>' : '') +
              '<button class="det-skip-btn" onclick="skipDetective()">跳過 →</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    clueIdx = 1;
    var letterReveal = 1; // 底部骨架已揭示的字母數

    window.revealNextClue = function() {
      // 階段一：逐張揭示線索卡
      if (clueIdx < clues.length) {
        for (var i = 0; i < clueIdx; i++) {
          var prev = document.getElementById('detCard' + i);
          if (prev) prev.style.opacity = '0.4';
        }
        var card = document.getElementById('detCard' + clueIdx);
        if (card) {
          card.style.transition = 'opacity 0.5s, transform 0.5s';
          card.style.opacity = '1';
          card.style.transform = 'translateY(0)';
        }
        clueIdx++;
        // 線索看完後，按鈕轉成「再給一個字母」
        if (clueIdx >= clues.length) {
          var btn = document.getElementById('detClueBtn');
          if (btn) btn.textContent = '🔡 再給一個字母';
        }
        return;
      }
      // 階段二：逐步在底部骨架揭示字母
      var wordLen = target.word.replace(/\s/g, '').length;
      if (letterReveal < wordLen) {
        letterReveal++;
        document.getElementById('detBlanks').innerHTML = buildLetterSkeleton(target.word, letterReveal);
        if (letterReveal >= wordLen) {
          var b = document.getElementById('detClueBtn');
          if (b) b.style.display = 'none';
        }
      }
    };

    var recognition = null, answered = false;

    window.startDetAnswer = function() {
      if (answered) return;
      if (recognition) { recognition.stop(); return; }
      var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognition = new SR();
      recognition.lang = 'en-US'; recognition.interimResults = false; recognition.maxAlternatives = 5;
      var btn = document.getElementById('detAnswerBtn');
      btn.textContent = '🔴 聽你說...'; btn.classList.add('recording');

      recognition.onresult = function(e) {
        var found = false, best = '';
        for (var i = 0; i < e.results[0].length; i++) {
          var t = e.results[0][i].transcript.toLowerCase();
          if (!best) best = e.results[0][i].transcript;
          if (t.indexOf(target.word.toLowerCase()) !== -1) { found = true; best = e.results[0][i].transcript; break; }
        }
        btn.textContent = '🎙️ 講出答案'; btn.classList.remove('recording');
        recognition = null;

        if (found) {
          answered = true; correct++;
          speakWord(target.word, 0.7);
          updateProgress(target.id, true, 'detective', { mistakes: 0 });
          document.getElementById('gameScore').textContent = correct + ' / ' + (current+1);
          // 底線變成答案
          document.getElementById('detBlanks').innerHTML = '<span class="det-answer-word">' + esc(target.word) + '</span>';
          // 金色爆發
          document.querySelectorAll('.det-card').forEach(function(c) {
            c.style.opacity = '1'; c.classList.add('det-glow');
          });
          setTimeout(function() { current++; renderRound(); }, 2500);
        } else {
          document.getElementById('detFeedback').innerHTML = '<span style="color:#FF9800;">你說了「' + esc(best) + '」</span>';
        }
      };
      recognition.onerror = function() {
        btn.textContent = '🎙️ 講出答案'; btn.classList.remove('recording'); recognition = null;
        document.getElementById('detFeedback').textContent = '聽不清楚，再試一次？';
      };
      recognition.onend = function() { btn.textContent = '🎙️ 講出答案'; btn.classList.remove('recording'); recognition = null; };
      recognition.start();
    };

    window.skipDetective = function() {
      updateProgress(target.id, false, 'detective', { mistakes: 2 });
      speakWord(target.word, 0.7);
      document.getElementById('detBlanks').innerHTML = '<span class="det-answer-word">' + esc(target.word) + '</span>';
      setTimeout(function() { current++; renderRound(); }, 2000);
    };
  }
  buildQueueAndStart();
}
