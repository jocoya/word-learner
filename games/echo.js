// 跟我唸 / 魔法發音動物園
function initEchoGame(area, words) {
  var supported = 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
  if (!supported) {
    area.innerHTML = '<p style="text-align:center;color:#999;padding:40px;">瀏覽器不支援語音辨識，請使用 Chrome。</p>';
    return;
  }
  var isBaby = currentMode === 'baby';
  var total = Math.min(8, words.length);
  var queue = shuffleArray(words).slice(0, total);
  var current = 0, correct = 0;

  function playCelebrate() {
    try {
      var ctx = new (window.AudioContext || window.webkitAudioContext)();
      [523,659,784,1047].forEach(function(f,i) {
        var o=ctx.createOscillator(),g=ctx.createGain();
        o.type='sine';o.frequency.value=f;
        g.gain.setValueAtTime(0.25,ctx.currentTime+i*0.1);
        g.gain.exponentialRampToValueAtTime(0.01,ctx.currentTime+i*0.1+0.25);
        o.connect(g);g.connect(ctx.destination);
        o.start(ctx.currentTime+i*0.1);o.stop(ctx.currentTime+i*0.1+0.25);
      });
    } catch(e){}
  }

  function renderQuestion() {
    if (current >= queue.length) { showResult(correct, total); return; }
    var target = queue[current];
    var img = getRandomImage(target);

    if (isBaby) {
      // 魔法發音動物園
      area.innerHTML =
        '<div class="zoo-container">' +
          '<div class="zoo-left">' +
            '<div class="zoo-lion-wrap">' +
              '<img class="zoo-lion" id="zooLion" src="./images/lion-sleep.png" alt="恐龍">' +
              '<div class="zoo-zzz" id="zooZzz">💤</div>' +
            '</div>' +
            '<div class="zoo-status" id="zooStatus">恐龍在睡覺...</div>' +
          '</div>' +
          '<div class="zoo-right">' +
            (img ? '<img class="zoo-word-img" src="' + img + '" alt="" onerror="this.style.display=\'none\'">' : '') +
            '<div class="zoo-word">' + esc(target.word) + '</div>' +
            '<button class="zoo-listen" onclick="speakWord(\'' + esc(target.word) + '\', 0.6)">🔊 聽一次</button>' +
            '<button class="zoo-mic" id="zooMic">🎙️ 跟著唸</button>' +
            '<div class="zoo-feedback" id="zooFeedback"></div>' +
            '<button class="zoo-skip" onclick="skipZoo()">跳過 →</button>' +
            '<div class="baby-progress">' + (current+1) + ' / ' + total + '</div>' +
          '</div>' +
        '</div>';
      setTimeout(function() { speakWord(target.word, 0.6); }, 400);
      bindZooMic(target);
    } else {
      // 挑戰模式：原本的跟我唸
      area.innerHTML =
        '<div class="echo-container">' +
          (img ? '<img class="echo-image" src="' + img + '" alt="" onerror="this.style.display=\'none\'">' : '') +
          '<div class="echo-word">' + esc(target.word) + '</div>' +
          '<div class="echo-meaning">' + esc(target.meaning) + '</div>' +
          '<button class="echo-listen-btn" onclick="speakWord(\'' + esc(target.word) + '\', 0.7)">🔊 聽一次</button>' +
          '<button class="echo-mic-btn" id="echoMicBtn">🎙️ 跟我唸</button>' +
          '<div class="echo-feedback" id="echoFeedback"></div>' +
          '<button class="echo-skip" onclick="skipEcho()">跳過 →</button>' +
          '<div class="baby-progress">' + (current+1) + ' / ' + total + '</div>' +
        '</div>';
      // 挑戰模式不自動唸
      bindEchoMic(target);
    }

    window.skipZoo = function() { updateProgress(target.id, false); current++; renderQuestion(); };
    window.skipEcho = function() { updateProgress(target.id, false); current++; renderQuestion(); };
  }

  function bindZooMic(target) {
    var mic = document.getElementById('zooMic');
    var feedback = document.getElementById('zooFeedback');
    var lion = document.getElementById('zooLion');
    var zzz = document.getElementById('zooZzz');
    var status = document.getElementById('zooStatus');
    var recognition = null;
    var answered = false;

    mic.addEventListener('click', function() {
      if (answered) return;
      if (recognition) { recognition.stop(); return; }
      var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognition = new SR();
      recognition.lang = 'en-US';
      recognition.interimResults = false;
      recognition.maxAlternatives = 5;
      mic.textContent = '🔴 聽你說...';
      mic.classList.add('recording');
      status.textContent = '恐龍豎起耳朵聽...';
      lion.src = './images/lion-listen.jpeg';
      lion.classList.remove('zoo-dance');
      lion.classList.add('zoo-listening');
      feedback.textContent = '';

      recognition.onresult = function(e) {
        var found = false, best = '';
        for (var i = 0; i < e.results[0].length; i++) {
          var t = e.results[0][i].transcript.toLowerCase();
          if (!best) best = e.results[0][i].transcript;
          if (t.indexOf(target.word.toLowerCase()) !== -1) { found = true; best = e.results[0][i].transcript; break; }
        }
        answered = found;
        mic.textContent = '🎙️ 跟著唸';
        mic.classList.remove('recording');
        lion.classList.remove('zoo-listening');

        if (found) {
          // 恐龍醒來跳舞
          playCelebrate();
          correct++;
          zzz.style.display = 'none';
          lion.src = './images/lion-dance.png';
          lion.classList.remove('zoo-listening');
          lion.style.filter = 'none';
          lion.classList.add('zoo-dance');
          status.textContent = '恐龍醒來了！🎉';
          status.style.color = '#4CAF50';
          feedback.innerHTML = '<span style="color:#4CAF50;font-size:1.3em;font-weight:700;">太棒了！</span>';
          updateProgress(target.id, true);
          document.getElementById('gameScore').textContent = correct + ' / ' + (current+1);
          setTimeout(function() { current++; renderQuestion(); }, 2000);
        } else {
          // 繼續睡覺
          lion.src = './images/lion-sleep.png';
          lion.classList.remove('zoo-listening');
          zzz.style.display = '';
          status.textContent = '恐龍還在睡...再試一次？';
          status.style.color = '';
          feedback.innerHTML = '<span style="color:#FF9800;">你說了「' + esc(best) + '」</span>';
          recognition = null;
        }
      };
      recognition.onerror = function() {
        status.textContent = '聽不清楚，再試一次？';
        mic.textContent = '🎙️ 跟著唸';
        mic.classList.remove('recording');
        lion.src = './images/lion-sleep.png';
        lion.classList.remove('zoo-listening');
        recognition = null;
      };
      recognition.onend = function() {
        mic.textContent = '🎙️ 跟著唸';
        mic.classList.remove('recording');
        lion.classList.remove('zoo-listening');
        recognition = null;
      };
      recognition.start();
    });
  }

  function bindEchoMic(target) {
    var mic = document.getElementById('echoMicBtn');
    var feedback = document.getElementById('echoFeedback');
    var recognition = null;
    var answered = false;

    mic.addEventListener('click', function() {
      if (answered) return;
      if (recognition) { recognition.stop(); return; }
      var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      recognition = new SR();
      recognition.lang = 'en-US';
      recognition.interimResults = false;
      recognition.maxAlternatives = 5;
      mic.textContent = '🔴 聽你說...';
      mic.classList.add('recording');

      recognition.onresult = function(e) {
        var found = false, best = '';
        for (var i = 0; i < e.results[0].length; i++) {
          var t = e.results[0][i].transcript.toLowerCase();
          if (!best) best = e.results[0][i].transcript;
          if (t.indexOf(target.word.toLowerCase()) !== -1) { found = true; break; }
        }
        mic.textContent = '🎙️ 跟我唸';
        mic.classList.remove('recording');
        if (found) {
          answered = true;
          playCelebrate();
          correct++;
          feedback.innerHTML = '<span style="color:#4CAF50;font-size:1.3em;font-weight:700;">✅ 太棒了！</span>';
          var imgEl = area.querySelector('.echo-image');
          if (imgEl) imgEl.classList.add('echo-dance');
        } else {
          feedback.innerHTML = '<span style="color:#FF9800;">你說了「' + esc(best) + '」，再試一次？</span>';
        }
        updateProgress(target.id, found);
        document.getElementById('gameScore').textContent = correct + ' / ' + (current+1);
        recognition = null;
        if (found) setTimeout(function() { current++; renderQuestion(); }, 2000);
      };
      recognition.onerror = function() {
        feedback.textContent = '聽不清楚，再試一次？';
        mic.textContent = '🎙️ 跟我唸';
        mic.classList.remove('recording');
        recognition = null;
      };
      recognition.onend = function() {
        mic.textContent = '🎙️ 跟我唸';
        mic.classList.remove('recording');
      };
      recognition.start();
    });
  }

  renderQuestion();
}
