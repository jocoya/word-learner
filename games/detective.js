// 線索偵探遊戲
function initDetectiveGame(area, words) {
  var supported = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
  var withSentence = words.filter(function(w) { return w.sentences && w.sentences.length > 0; });
  if (withSentence.length < 4) {
    area.innerHTML = '<p style="text-align:center;color:#999;padding:40px;">需要至少 4 個有例句的單字！</p>';
    return;
  }
  var total = Math.min(8, withSentence.length);
  var queue = shuffleArray(withSentence).slice(0, total);
  var current = 0, correct = 0;

  function renderRound() {
    if (current >= queue.length) { showResult(correct, total); return; }
    var target = queue[current];
    var sentences = (target.sentences || []).slice();
    var clues = [];
    // 第一個固定是英英解釋
    if (target.definition) {
      clues.push(target.definition);
    } else {
      clues.push('(no definition)');
    }
    // 第二個是例句（挖空答案）
    var shuffledSen = shuffleArray(sentences);
    var wordRegex = new RegExp('\\b' + target.word + '\\b', 'gi');
    if (shuffledSen.length >= 1) {
      clues.push(shuffledSen[0].replace(wordRegex, '______'));
    }
    // 第三個固定是中文
    clues.push(target.meaning);
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

    window.revealNextClue = function() {
      if (clueIdx >= clues.length) return;
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
      if (clueIdx >= clues.length) {
        document.getElementById('detClueBtn').style.display = 'none';
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
  renderRound();
}
