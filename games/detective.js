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

  // 「認識新朋友」入口設定（由 app.js 設定全域）
  var learnFirst = (typeof window !== 'undefined' && window.detectiveLearnFirst);
  var learnConfig = (typeof window !== 'undefined' && window.learnConfig) ? window.learnConfig : null;
  var themeFilter = (typeof window !== 'undefined') ? window.learnThemeFilter : null;
  window.detectiveLearnFirst = false; // 用完即清
  window.learnThemeFilter = null;
  window.learnConfig = null;

  // 一般偵探模式：要至少 4 個有例句的字
  if (!learnFirst && withSentence.length < 4) {
    area.innerHTML = '<p style="text-align:center;color:#999;padding:40px;">需要至少 4 個有例句的單字！</p>';
    return;
  }
  var total = Math.min(8, withSentence.length);

  // 若有主題篩選，先把單字池縮到該主題
  if (learnFirst && themeFilter) {
    withSentence = withSentence.filter(function(w) {
      if (themeFilter === '__notag__') return !w.tags || w.tags.length === 0;
      return w.tags && w.tags.indexOf(themeFilter) !== -1;
    });
  }

  var current = 0, correct = 0;
  var queue;
  var learnedFriends = []; // 這場認識的新朋友（學習模式用）
  var learnReward = learnConfig ? learnConfig.reward : 'coin';   // 'coin' | 'diamond'
  var learnCount = learnConfig ? learnConfig.count : 2;          // 認識幾個新朋友

  function buildQueueAndStart() {
    if (learnFirst) {
      // 只挑「認識期」的字（reps=0 或 S<3），優先沒學過的
      var enriched = [];
      var pending = withSentence.length;
      if (pending === 0) { noNewFriends(); return; }
      withSentence.forEach(function(w) {
        getProgressFor(w.id).then(function(p) {
          var up = p ? (typeof fsrsUpgrade === 'function' ? fsrsUpgrade(p) : p) : null;
          var s = up ? (up.stability || 0) : 0;
          var reps = up ? (up.reps || 0) : 0;
          // 認識期：還沒學過(reps=0) 或 S<3
          if (reps === 0 || s < 3) enriched.push({ w: w, s: s, reps: reps });
          if (--pending === 0) {
            // reps=0 全新優先，其次 S 低的
            enriched.sort(function(a, b){ return (a.reps - b.reps) || (a.s - b.s); });
            queue = enriched.slice(0, learnCount).map(function(x){ return x.w; });
            if (queue.length === 0) { noNewFriends(); return; }
            renderRound();
          }
        });
      });
    } else {
      queue = shuffleArray(withSentence).slice(0, total);
      renderRound();
    }
  }

  function noNewFriends() {
    area.innerHTML = '<div style="text-align:center;padding:60px 20px;">' +
      '<div style="font-size:4em;">🎉</div>' +
      '<div style="font-size:1.4em;color:#43A047;font-weight:700;margin-top:12px;">目前沒有新朋友了！</div>' +
      '<div style="color:#999;margin-top:8px;">所有單字都認識過囉，去玩遊戲鞏固記憶吧</div>' +
      '<button class="btn-primary" style="margin-top:20px;" onclick="goTo(\'page-home\')">回首頁</button>' +
    '</div>';
  }

  function renderRound() {
    if (current >= queue.length) {
      // 學習模式入口：結算 + 獎勵
      if (learnFirst) { showLearnSummary(); return; }
      showResult(correct, total);
      return;
    }
    var target = queue[current];
    // 從「認識新朋友」入口進來（learnFirst）→ 整場都用學習模式（五步驟）
    if (learnFirst) { renderLearnMode(target); return; }
    // 一般進入線索偵探：依熟練度決定。新字（S=0）→ 學習模式；熟字 → 偵探模式
    getWordStability(target.id).then(function(s) {
      if (!s || s <= 0) renderLearnMode(target);
      else renderDetectiveMode(target);
    });
  }

  // 認識新朋友結算：給獎勵（金幣或鑽石）+ 滿版獎勵圖
  async function showLearnSummary() {
    if (learnedFriends.length === 0) {
      // 沒認識到任何（理論上不會），直接回首頁
      goTo('page-home'); return;
    }
    var child = (typeof currentChild !== 'undefined') ? currentChild : 'boy';
    var devSkip = (typeof devSkipRewards === 'function' && devSkipRewards());

    if (!devSkip && typeof getCoins === 'function') {
      var coins = await getCoins();
      if (learnReward === 'diamond') {
        // 首頁版：給 1 顆鑽石
        var field = child === 'boy' ? 'rewardsBoy' : 'rewardsGirl';
        coins[field] = coins[field] || {};
        coins[field]['diamond'] = (coins[field]['diamond'] || 0) + 1;
        coins.log.push({ role: child, count: 0, date: getTodayStr(), chest: '💎 認識 ' + learnedFriends.length + ' 個新朋友' });
      } else {
        // 橫幅版：給 1 金幣
        coins[child] = (coins[child] || 0) + 1;
        coins.log.push({ role: child, count: 1, date: getTodayStr(), chest: '🦍 認識新朋友' });
      }
      await saveCoins(coins);
    }

    // 滿版獎勵圖（點擊才消失），消失後回首頁
    if (typeof showRewardImage === 'function') {
      showRewardImage(learnReward === 'diamond' ? 'diamond' : 'coin', function() { goTo('page-home'); });
    } else {
      goTo('page-home');
    }
  }

  // ===== 學習模式（新字）：多感官流程 看→聽→跟讀→動作(TPR)→例句→確認 =====
  function renderLearnMode(target) {
    var img = getRandomImage(target);
    var sentence = (target.sentences || []).find(function(s){ return s && s.trim(); });
    var isAction = (target.pos === 'verb') || (target.tags && target.tags.some(function(t){ return /action|動作|verb/i.test(t); }));
    var supportsMic = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;

    // 步驟：0=看圖聽音, 1=跟讀, 2=動作(僅動作詞), 3=例句, 4=確認
    var steps = ['look', 'repeat'];
    if (isAction) steps.push('action');
    if (sentence) steps.push('sentence');
    steps.push('confirm');
    var stepIdx = 0;

    function renderStep() {
      var step = steps[stepIdx];
      var html = '<div class="learn2">' +
        '<div class="learn2-badge">🌟 認識新朋友 ' + (current+1) + '/' + total + '</div>';

      // 單字卡（每步都顯示）
      html += '<div class="learn2-card">' +
        (img ? '<img class="learn2-img" src="' + img + '" alt="" onerror="this.style.display=\'none\'">' : '') +
        '<div class="learn2-word">' + esc(target.word) + '</div>' +
        '<div class="learn2-meaning">' + esc(target.meaning) + '</div>' +
        '<button class="learn2-speak" onclick="speakWord(\'' + esc(target.word) + '\',0.6)">🔊 聽發音</button>' +
      '</div>';

      // 步驟指示
      if (step === 'look') {
        html += '<div class="learn2-prompt">👀 看圖片，聽聽看這個字怎麼念</div>';
        html += '<button class="learn2-next" onclick="learnNext()">我聽到了 👂</button>';
      } else if (step === 'repeat') {
        html += '<div class="learn2-prompt">🎤 換你念念看！</div>';
        if (supportsMic) html += '<button class="learn2-mic" id="learn2Mic" onclick="learnTryRepeat()">🎙️ 跟我念</button>';
        html += '<button class="learn2-next" onclick="learnNext()">' + (supportsMic ? '念好了 →' : '我念過了 →') + '</button>';
        html += '<div class="learn2-feedback" id="learn2Feedback"></div>';
      } else if (step === 'action') {
        html += '<div class="learn2-prompt">🏃 站起來，做出「' + esc(target.meaning) + '」的動作！</div>';
        html += '<div class="learn2-action-emoji">🤸</div>';
        html += '<button class="learn2-next" onclick="learnNext()">做好了 →</button>';
      } else if (step === 'sentence') {
        html += '<div class="learn2-prompt">💬 看看這個字怎麼用在句子裡</div>';
        html += '<div class="learn2-sentence">' + esc(sentence) +
          ' <button class="learn2-speak-sm" onclick="speakWord(\'' + esc(sentence) + '\',0.7)">🔊</button></div>';
        html += '<button class="learn2-next" onclick="learnNext()">懂了 →</button>';
      } else if (step === 'confirm') {
        // 超簡單確認：目標 + 3 干擾（看圖選字）
        var others = shuffleArray((words || []).filter(function(w){ return w.id !== target.id; })).slice(0, 3);
        var opts = shuffleArray([target].concat(others));
        html += '<div class="learn2-prompt">✅ 哪一個是「' + esc(target.meaning) + '」？</div>';
        html += '<div class="learn2-choices">' +
          opts.map(function(o){ return '<button class="learn2-choice" data-id="' + o.id + '">' + esc(o.word) + '</button>'; }).join('') +
        '</div>';
      }
      html += '</div>';
      area.innerHTML = html;

      // 看圖步驟：自動念兩次（多感官 看+聽）
      if (step === 'look') {
        setTimeout(function(){ speakWord(target.word, 0.6); }, 300);
        setTimeout(function(){ speakWord(target.word, 0.5); }, 1500);
      } else if (step === 'sentence') {
        setTimeout(function(){ speakWord(sentence, 0.7); }, 300);
      } else if (step === 'confirm') {
        bindConfirm();
      }
    }

    window.learnNext = function() {
      stepIdx++;
      if (stepIdx >= steps.length) { finishLearn(); return; }
      renderStep();
    };

    // 跟讀（語音鼓勵，不強迫）
    window.learnTryRepeat = function() {
      var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) return;
      var r = new SR(); r.lang = 'en-US'; r.interimResults = false; r.maxAlternatives = 5;
      var mic = document.getElementById('learn2Mic');
      mic.textContent = '🔴 聽你念...'; mic.classList.add('recording');
      r.onresult = function(e) {
        var ok = false;
        for (var i = 0; i < e.results[0].length; i++) {
          if (e.results[0][i].transcript.toLowerCase().indexOf(target.word.toLowerCase()) !== -1) { ok = true; break; }
        }
        mic.textContent = '🎙️ 跟我念'; mic.classList.remove('recording');
        var fb = document.getElementById('learn2Feedback');
        if (fb) fb.innerHTML = ok ? '<span class="learn2-good">👍 念得好棒！</span>' : '<span class="learn2-try">再念一次看看～</span>';
        if (ok) speakWord(target.word, 0.6);
      };
      r.onerror = function() { mic.textContent = '🎙️ 跟我念'; mic.classList.remove('recording'); };
      r.start();
    };

    function bindConfirm() {
      area.querySelectorAll('.learn2-choice').forEach(function(b) {
        b.addEventListener('click', function() {
          var ok = parseInt(b.dataset.id) === target.id;
          b.classList.add(ok ? 'correct' : 'wrong');
          if (!ok) {
            var r = area.querySelector('.learn2-choice[data-id="' + target.id + '"]');
            if (r) r.classList.add('correct');
          }
          speakWord(target.word, 0.6);
          area.querySelectorAll('.learn2-choice').forEach(function(x){ x.style.pointerEvents = 'none'; });
          setTimeout(finishLearn, 1500);
        });
      });
    }

    function finishLearn() {
      // 學習模式給輕量初始進度（reps=0 首玩會被 FIRST_PLAY_SCALE 壓低，不暴衝）
      updateProgress(target.id, true, 'detective', { mistakes: 0 });
      learnedFriends.push(target);
      current++;
      renderRound();
    }

    renderStep();
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
    var imageShown = false;     // 是否已顯示單字圖
    var choicesShown = false;   // 是否已顯示選擇題
    var targetImg = getRandomImage(target);

    area.innerHTML =
      '<div class="det2">' +
        '<img class="det2-bg" src="./images/find.png" alt="">' +
        '<div class="det2-panel">' +
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
        '</div>' +
      '</div>';

    var cluesEl = document.getElementById('det2Clues');
    // 先顯示第一張線索卡
    function appendClue(c) {
      var div = document.createElement('div');
      div.className = 'det2-card';
      if (c.img) {
        div.innerHTML = '<span class="det2-card-icon">' + c.icon + '</span>' +
          '<span class="det2-card-body"><b>' + esc(c.label) + '</b><br>' +
          '<img class="det2-clue-img" src="' + c.img + '" alt="" onerror="this.style.display=\'none\'"></span>';
      } else {
        div.innerHTML = '<span class="det2-card-icon">' + c.icon + '</span>' +
          '<span class="det2-card-body"><b>' + esc(c.label) + '</b><br>' + esc(c.text) + '</span>';
      }
      cluesEl.appendChild(div);
      setTimeout(function(){ div.classList.add('show'); }, 30);
    }
    appendClue(clues[0]);

    // 「給我線索」：依序 揭示線索卡 → 逐字母 → 圖片 → 選擇題
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
        if (letterReveal >= wordLen && targetImg && !imageShown) {
          var b1 = document.getElementById('det2ClueBtn');
          if (b1) b1.textContent = '🖼️ 給我圖片';
        }
        return;
      }
      // 階段三：顯示單字圖
      if (targetImg && !imageShown) {
        imageShown = true;
        appendClue({ icon: '🖼️', label: '圖片', img: targetImg });
        var b2 = document.getElementById('det2ClueBtn');
        if (b2) b2.textContent = '🎯 給我選項';
        return;
      }
      // 階段四：給選擇題（最後線索）
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
