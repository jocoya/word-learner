// ===== 手寫單字遊戲 =====
// 小孩看圖 + 中文 + 聽發音，然後在畫布上「照著淡淡的字母描寫」整個單字。
// 一個字母一格，寫完點「下一個」，最後一個寫完就過關。
// （純離線、不需 OCR：以「描寫 + 自我確認」方式練習手寫，符合幼兒書寫教學）
function initWriteGame(area, words) {
  var total = Math.min(8, words.length);
  var queue = shuffleArray(words).slice(0, total);
  var current = 0, correct = 0;

  function renderQuestion() {
    if (current >= queue.length) { showResult(correct, total); return; }
    var target = queue[current];
    var word = target.word;
    var letters = word.split('');
    var img = getRandomImage(target);

    area.innerHTML =
      '<div class="write-container">' +
        '<div class="write-top">' +
          (img ? '<img class="write-image" src="' + img + '" alt="" onerror="this.style.display=\'none\'">' : '') +
          '<div class="write-info">' +
            '<div class="write-word">' + esc(word) + '</div>' +
            '<div class="write-meaning">' + esc(target.meaning) + '</div>' +
            '<button class="write-speak" onclick="speakWord(\'' + esc(word) + '\',0.6)">🔊 聽發音</button>' +
          '</div>' +
        '</div>' +
        '<div class="write-progress-word" id="writeProgWord"></div>' +
        '<div class="write-canvas-wrap">' +
          '<canvas id="writeCanvas" class="write-canvas"></canvas>' +
          '<div class="write-guide" id="writeGuide"></div>' +
        '</div>' +
        '<div class="write-actions">' +
          '<button class="btn-ghost" id="writeClear">🧽 清除</button>' +
          '<button class="btn-primary" id="writeNext">下一個 →</button>' +
        '</div>' +
        '<div style="margin-top:8px;color:#999;">' + (current + 1) + ' / ' + total + '</div>' +
      '</div>';

    var letterIdx = 0;      // 目前寫到第幾個字母
    var strokesThisLetter = false;

    var canvas = document.getElementById('writeCanvas');
    var guide = document.getElementById('writeGuide');
    var progWord = document.getElementById('writeProgWord');
    var ctx = canvas.getContext('2d');

    function sizeCanvas() {
      var wrap = canvas.parentElement;
      var w = wrap.clientWidth, h = wrap.clientHeight;
      var dpr = window.devicePixelRatio || 1;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineWidth = 10; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.strokeStyle = '#2962FF';
    }

    function renderGuideLetter() {
      // 顯示目前要描的字母（淡色大字當底），並更新已完成字母
      guide.textContent = letters[letterIdx] || '';
      // 已完成的字母高亮
      progWord.innerHTML = letters.map(function(l, i) {
        var cls = i < letterIdx ? 'done' : (i === letterIdx ? 'active' : '');
        return '<span class="write-ch ' + cls + '">' + esc(l) + '</span>';
      }).join('');
    }

    function clearCanvas() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      strokesThisLetter = false;
    }

    setTimeout(function() {
      sizeCanvas();
      renderGuideLetter();
      speakWord(word, 0.6);
    }, 50);
    window.addEventListener('resize', sizeCanvas);

    var drawing = false;
    function pos(e) {
      var r = canvas.getBoundingClientRect();
      var cx = (e.touches ? e.touches[0].clientX : e.clientX) - r.left;
      var cy = (e.touches ? e.touches[0].clientY : e.clientY) - r.top;
      return { x: cx, y: cy };
    }
    function start(e) { e.preventDefault(); drawing = true; strokesThisLetter = true; var p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); }
    function move(e) { if (!drawing) return; e.preventDefault(); var p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); }
    function end() { drawing = false; }

    canvas.addEventListener('pointerdown', start);
    canvas.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);

    document.getElementById('writeClear').addEventListener('click', clearCanvas);

    document.getElementById('writeNext').addEventListener('click', function() {
      // 鼓勵至少有畫一點再進下一個（沒畫也放行，不強迫）
      if (letterIdx < letters.length - 1) {
        letterIdx++;
        clearCanvas();
        renderGuideLetter();
        speakWord(letters[letterIdx], 0.5);
      } else {
        // 最後一個字母寫完 → 過關
        finishWord();
      }
    });

    function finishWord() {
      correct++;
      updateProgress(target.id, true, 'write', { mistakes: 0 });
      document.getElementById('gameScore').textContent = correct + ' / ' + (current + 1);
      // 完成回饋
      guide.textContent = '';
      progWord.innerHTML = '<span class="write-done-msg">✅ 寫好了！</span>';
      speakWord(word, 0.6);
      window.removeEventListener('resize', sizeCanvas);
      setTimeout(function() { current++; renderQuestion(); }, 1500);
    }
  }

  renderQuestion();
}
