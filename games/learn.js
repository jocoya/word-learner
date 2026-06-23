// ===== 認識新朋友（獨立遊戲，不再依附線索偵探）=====
// 多感官五步驟流程：看圖聽音 → 跟讀 → 動作(TPR，動作詞才有) → 例句 → 確認
// 入口：
//   - 首頁大按鈕 startHomeLearn()  → 5 個新朋友、給鑽石、每認識 3 個跳「💎 +1」動畫
//   - 模式內橫幅 startBannerLearn() → 2 個新朋友、給金幣
//
// config: { count, reward:'coin'|'diamond', milestone:Number(每幾個跳一次階段動畫) }
async function startLearnSession(config) {
  config = config || {};
  var count = config.count || 5;
  var reward = config.reward || 'diamond';
  var milestone = config.milestone || 0; // 0 = 不跳階段動畫

  var newFriends = (typeof getNewFriends === 'function') ? await getNewFriends() : [];
  if (!newFriends.length) {
    alert('目前沒有新朋友囉！所有單字都認識過了 🎉');
    return;
  }

  // 只挑「認識期」的字，reps=0 全新優先、其次 S 低的
  var enriched = [];
  for (var i = 0; i < newFriends.length; i++) {
    var w = newFriends[i];
    var p = (typeof getProgressFor === 'function') ? await getProgressFor(w.id) : null;
    var up = p ? ((typeof fsrsUpgrade === 'function') ? fsrsUpgrade(p) : p) : null;
    enriched.push({ w: w, s: up ? (up.stability || 0) : 0, reps: up ? (up.reps || 0) : 0 });
  }
  enriched.sort(function(a, b) { return (a.reps - b.reps) || (a.s - b.s); });
  var queue = enriched.slice(0, count).map(function(x) { return x.w; });
  // 干擾選項用的字池（盡量用永久庫全部）
  var allWords = await dbGetByIndex('words', 'pool', 'permanent');

  goTo('page-game');
  document.getElementById('gameTitle').textContent = '🦍 認識新朋友';
  document.getElementById('gameScore').textContent = '';
  var area = document.getElementById('gameArea');
  area.innerHTML = '';

  var current = 0;
  var learnedFriends = [];
  var total = queue.length;

  function renderRound() {
    if (current >= total) { showLearnSummary(); return; }
    renderLearnMode(queue[current]);
  }

  // ===== 單字學習：多感官五步驟 =====
  function renderLearnMode(target) {
    var img = (typeof getRandomImage === 'function') ? getRandomImage(target) : '';
    var sentence = (target.sentences || []).find(function(s) { return s && s.trim(); });
    var isAction = (target.pos === 'verb') || (target.tags && target.tags.some(function(t) { return /action|動作|verb/i.test(t); }));
    var supportsMic = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;

    var steps = ['look', 'repeat'];
    if (isAction) steps.push('action');
    if (sentence) steps.push('sentence');
    steps.push('confirm');
    var stepIdx = 0;

    function renderStep() {
      var step = steps[stepIdx];
      var html = '<div class="learn2">' +
        '<div class="learn2-badge">🌟 認識新朋友 ' + (current + 1) + '/' + total + '</div>';

      html += '<div class="learn2-card">' +
        (img ? '<img class="learn2-img" src="' + img + '" alt="" onerror="this.style.display=\'none\'">' : '') +
        '<div class="learn2-word">' + esc(target.word) + '</div>' +
        '<div class="learn2-meaning">' + esc(target.meaning) + '</div>' +
        '<button class="learn2-speak" onclick="speakWord(\'' + esc(target.word) + '\',0.6)">🔊 聽發音</button>' +
      '</div>';

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
        var others = shuffleArray(allWords.filter(function(w) { return w.id !== target.id; })).slice(0, 3);
        var opts = shuffleArray([target].concat(others));
        html += '<div class="learn2-prompt">✅ 哪一個是「' + esc(target.meaning) + '」？</div>';
        html += '<div class="learn2-choices">' +
          opts.map(function(o) { return '<button class="learn2-choice" data-id="' + o.id + '">' + esc(o.word) + '</button>'; }).join('') +
        '</div>';
      }
      html += '</div>';
      area.innerHTML = html;

      if (step === 'look') {
        setTimeout(function() { speakWord(target.word, 0.6); }, 300);
        setTimeout(function() { speakWord(target.word, 0.5); }, 1500);
      } else if (step === 'sentence') {
        setTimeout(function() { speakWord(sentence, 0.7); }, 300);
      } else if (step === 'confirm') {
        bindConfirm();
      }
    }

    window.learnNext = function() {
      stepIdx++;
      if (stepIdx >= steps.length) { finishLearn(true); return; }
      renderStep();
    };

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
          } else if (typeof celebrateLearnCorrect === 'function') {
            celebrateLearnCorrect(area, b);
          }
          speakWord(target.word, 0.6);
          area.querySelectorAll('.learn2-choice').forEach(function(x) { x.style.pointerEvents = 'none'; });
          setTimeout(function() { finishLearn(ok); }, 1500);
        });
      });
    }

    function finishLearn(wasCorrect) {
      var correct = (wasCorrect !== false);
      if (typeof updateProgress === 'function') {
        updateProgress(target.id, correct, 'learn', { mistakes: correct ? 0 : 1 });
      }
      learnedFriends.push(target);
      current++;
      document.getElementById('gameScore').textContent = current + '/' + total;
      // 階段獎勵：每認識 milestone 個（且還沒到最後）→ 跳「💎 +1」動畫並真的給 1 鑽石
      if (milestone > 0 && current < total && current % milestone === 0) {
        grantMilestoneDiamond();
        setTimeout(renderRound, 1400);
      } else {
        renderRound();
      }
    }

    renderStep();
  }

  // 階段鑽石：認識滿 milestone 個跳動畫 + 給鑽石
  async function grantMilestoneDiamond() {
    var child = (typeof currentChild !== 'undefined') ? currentChild : 'boy';
    var devSkip = (typeof devSkipRewards === 'function' && devSkipRewards());
    if (!devSkip && typeof getCoins === 'function') {
      var coins = await getCoins();
      var field = child === 'boy' ? 'rewardsBoy' : 'rewardsGirl';
      coins[field] = coins[field] || {};
      coins[field]['diamond'] = (coins[field]['diamond'] || 0) + 1;
      coins.log.push({ role: child, count: 0, date: getTodayStr(), chest: '💎 認識新朋友里程碑' });
      await saveCoins(coins);
    }
    if (typeof showFloatingReward === 'function') showFloatingReward('💎 +1', '#00bcd4');
  }

  // 結算：給最終獎勵（金幣或鑽石）+ 滿版獎勵圖
  async function showLearnSummary() {
    if (learnedFriends.length === 0) { goTo('page-home'); return; }
    var child = (typeof currentChild !== 'undefined') ? currentChild : 'boy';
    var devSkip = (typeof devSkipRewards === 'function' && devSkipRewards());

    if (!devSkip && typeof getCoins === 'function') {
      var coins = await getCoins();
      if (reward === 'diamond') {
        var field = child === 'boy' ? 'rewardsBoy' : 'rewardsGirl';
        coins[field] = coins[field] || {};
        coins[field]['diamond'] = (coins[field]['diamond'] || 0) + 1;
        coins.log.push({ role: child, count: 0, date: getTodayStr(), chest: '💎 認識 ' + learnedFriends.length + ' 個新朋友' });
      } else {
        coins[child] = (coins[child] || 0) + 1;
        coins.log.push({ role: child, count: 1, date: getTodayStr(), chest: '🦍 認識新朋友' });
      }
      await saveCoins(coins);
    }

    if (typeof showRewardImage === 'function') {
      showRewardImage(reward === 'diamond' ? 'diamond' : 'coin', function() { goTo('page-home'); });
    } else {
      goTo('page-home');
    }
  }

  renderRound();
}
