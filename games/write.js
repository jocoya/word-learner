// ===== 手寫單字遊戲 =====
// 小寶貝模式（baby）：描寫 —— 有淡淡底字照著描，一格一字母，練手部肌肉記憶。
// 挑戰模式（kid）：完全默寫 —— 看圖+聽音（不顯示英文），一格一字母白框自己寫，
//                 用 Tesseract.js 自動辨識判對錯；辨識不出來就翻正解讓使用者自我確認。

// 動態載入 Tesseract.js（CDN，SW 會快取，之後離線可用）
var _tesseractLoading = null;
function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (_tesseractLoading) return _tesseractLoading;
  _tesseractLoading = new Promise(function(resolve, reject) {
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    s.onload = function() { resolve(window.Tesseract); };
    s.onerror = function() { reject(new Error('Tesseract 載入失敗')); };
    document.head.appendChild(s);
  });
  return _tesseractLoading;
}

function initWriteGame(area, words) {
  var isBaby = (typeof currentMode !== 'undefined' && currentMode === 'baby');
  var total = Math.min(8, words.length);
  var queue = shuffleArray(words).slice(0, total);
  var current = 0, correct = 0;

  // 預先開始載入辨識引擎（挑戰模式才需要）
  if (!isBaby) { loadTesseract().catch(function(){}); }

  function renderQuestion() {
    if (current >= queue.length) { showResult(correct, total); return; }
    if (isBaby) renderTraceMode(queue[current]);
    else renderDictationMode(queue[current]);
  }

  // ========== 小寶貝：描寫模式（一格一字母，有底字）==========
  function renderTraceMode(target) {
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

    var letterIdx = 0;
    var canvas = document.getElementById('writeCanvas');
    var guide = document.getElementById('writeGuide');
    var progWord = document.getElementById('writeProgWord');
    var ctx = canvas.getContext('2d');

    function sizeCanvas() {
      var wrap = canvas.parentElement;
      var dpr = window.devicePixelRatio || 1;
      canvas.width = wrap.clientWidth * dpr; canvas.height = wrap.clientHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineWidth = 10; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = '#2962FF';
    }
    function renderGuideLetter() {
      guide.textContent = letters[letterIdx] || '';
      progWord.innerHTML = letters.map(function(l, i) {
        var cls = i < letterIdx ? 'done' : (i === letterIdx ? 'active' : '');
        return '<span class="write-ch ' + cls + '">' + esc(l) + '</span>';
      }).join('');
    }
    function clearCanvas() { ctx.clearRect(0, 0, canvas.width, canvas.height); }

    setTimeout(function() { sizeCanvas(); renderGuideLetter(); speakWord(word, 0.6); }, 50);
    window.addEventListener('resize', sizeCanvas);

    var drawing = false;
    function pos(e) { var r = canvas.getBoundingClientRect(); return { x: (e.clientX) - r.left, y: (e.clientY) - r.top }; }
    canvas.addEventListener('pointerdown', function(e){ e.preventDefault(); drawing = true; var p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); });
    canvas.addEventListener('pointermove', function(e){ if(!drawing) return; e.preventDefault(); var p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); });
    window.addEventListener('pointerup', function(){ drawing = false; });

    document.getElementById('writeClear').addEventListener('click', clearCanvas);
    document.getElementById('writeNext').addEventListener('click', function() {
      if (letterIdx < letters.length - 1) {
        letterIdx++; clearCanvas(); renderGuideLetter(); speakWord(letters[letterIdx], 0.5);
      } else {
        correct++;
        updateProgress(target.id, true, 'write', { mistakes: 0 });
        document.getElementById('gameScore').textContent = correct + ' / ' + (current + 1);
        guide.textContent = ''; progWord.innerHTML = '<span class="write-done-msg">✅ 寫好了！</span>';
        speakWord(word, 0.6);
        window.removeEventListener('resize', sizeCanvas);
        setTimeout(function() { current++; renderQuestion(); }, 1400);
      }
    });
  }

  // ========== 挑戰：默寫模式（一格一字母，白框，辨識判對錯）==========
  function renderDictationMode(target) {
    var word = target.word;
    var letters = word.toLowerCase().split('');
    var img = getRandomImage(target);

    area.innerHTML =
      '<div class="write-container">' +
        '<div class="write-top">' +
          (img ? '<img class="write-image" src="' + img + '" alt="" onerror="this.style.display=\'none\'">' : '') +
          '<div class="write-info">' +
            '<div class="write-meaning">' + esc(target.meaning) + '</div>' +
            '<button class="write-speak" onclick="speakWord(\'' + esc(word) + '\',0.6)">🔊 再聽一次</button>' +
            '<div class="write-dict-hint">聽發音，把整個單字寫出來！（' + letters.length + ' 個字母）</div>' +
          '</div>' +
        '</div>' +
        '<div class="write-boxes" id="writeBoxes"></div>' +
        '<div class="write-actions">' +
          '<button class="btn-ghost" id="writeClearAll">🧽 全部清除</button>' +
          '<button class="btn-primary" id="writeCheck">✓ 檢查</button>' +
        '</div>' +
        '<div class="write-result" id="writeResult"></div>' +
        '<div style="margin-top:8px;color:#999;">' + (current + 1) + ' / ' + total + '</div>' +
      '</div>';

    var boxesEl = document.getElementById('writeBoxes');
    var cells = [];  // { canvas, ctx }

    // 建立一格一字母的畫布
    letters.forEach(function(_, i) {
      var cell = document.createElement('div');
      cell.className = 'write-box';
      var cv = document.createElement('canvas');
      cv.className = 'write-box-canvas';
      cell.appendChild(cv);
      boxesEl.appendChild(cell);
      var ctx = cv.getContext('2d');
      cells.push({ canvas: cv, ctx: ctx });
    });

    function sizeCells() {
      cells.forEach(function(c) {
        var wrap = c.canvas.parentElement;
        var dpr = window.devicePixelRatio || 1;
        c.canvas.width = wrap.clientWidth * dpr;
        c.canvas.height = wrap.clientHeight * dpr;
        c.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        c.ctx.lineWidth = 9; c.ctx.lineCap = 'round'; c.ctx.lineJoin = 'round'; c.ctx.strokeStyle = '#222';
      });
    }
    setTimeout(function() { sizeCells(); speakWord(word, 0.6); }, 50);
    window.addEventListener('resize', sizeCells);

    // 每格獨立手寫
    cells.forEach(function(c) {
      var drawing = false;
      function pos(e) { var r = c.canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
      c.canvas.addEventListener('pointerdown', function(e){ e.preventDefault(); drawing = true; c.hasInk = true; var p = pos(e); c.ctx.beginPath(); c.ctx.moveTo(p.x, p.y); });
      c.canvas.addEventListener('pointermove', function(e){ if(!drawing) return; e.preventDefault(); var p = pos(e); c.ctx.lineTo(p.x, p.y); c.ctx.stroke(); });
      window.addEventListener('pointerup', function(){ drawing = false; });
    });

    function clearAll() {
      cells.forEach(function(c) { c.ctx.clearRect(0, 0, c.canvas.width, c.canvas.height); c.hasInk = false; });
      var rEl = document.getElementById('writeResult'); if (rEl) rEl.innerHTML = '';
    }
    document.getElementById('writeClearAll').addEventListener('click', clearAll);

    document.getElementById('writeCheck').addEventListener('click', function() {
      doCheck(target, word, letters, cells);
    });
  }

  // 辨識 + 判對錯（辨識失敗 → 自我確認保底）
  async function doCheck(target, word, letters, cells) {
    var resultEl = document.getElementById('writeResult');
    var checkBtn = document.getElementById('writeCheck');
    checkBtn.disabled = true;

    // 至少每格都要有寫東西
    var empty = cells.some(function(c) { return !c.hasInk; });
    if (empty) {
      resultEl.innerHTML = '<span style="color:#FF9800;">每一格都要寫一個字母喔！</span>';
      checkBtn.disabled = false;
      return;
    }

    resultEl.innerHTML = '<span style="color:#999;">辨識中...</span>';
    var recognized = null;
    try {
      var T = await loadTesseract();
      recognized = [];
      for (var i = 0; i < cells.length; i++) {
        var dataUrl = whitenBg(cells[i].canvas);
        var res = await T.recognize(dataUrl, 'eng', {
          tessedit_char_whitelist: 'abcdefghijklmnopqrstuvwxyz',
          tessedit_pageseg_mode: '10' // single character
        });
        var ch = (res.data.text || '').trim().toLowerCase().replace(/[^a-z]/g, '');
        recognized.push(ch.charAt(0) || '?');
      }
    } catch (e) {
      recognized = null; // 辨識失敗 → 走自我確認
    }

    if (recognized) {
      var allMatch = recognized.every(function(ch, i) { return ch === letters[i]; });
      // 標記每格對錯
      cells.forEach(function(c, i) {
        c.canvas.parentElement.classList.remove('ok', 'bad');
        c.canvas.parentElement.classList.add(recognized[i] === letters[i] ? 'ok' : 'bad');
      });
      if (allMatch) {
        finishDict(target, word, true);
        return;
      }
      // 辨識判為錯 → 讓使用者自我確認（辨識可能誤判）
      resultEl.innerHTML =
        '<div class="write-selfcheck">' +
          '<div>正確拼法：<b>' + esc(word) + '</b></div>' +
          '<div class="write-selfcheck-sub">辨識結果：' + esc(recognized.join('')) + '（可能認錯，你自己看寫對了嗎？）</div>' +
          '<div class="write-selfcheck-btns">' +
            '<button class="btn-primary" id="wcYes">✅ 我寫對了</button>' +
            '<button class="btn-ghost" id="wcNo">❌ 再練一次</button>' +
          '</div>' +
        '</div>';
      bindSelfCheck(target, word);
    } else {
      // 辨識引擎載入失敗（離線且沒快取）→ 純自我確認
      resultEl.innerHTML =
        '<div class="write-selfcheck">' +
          '<div>正確拼法：<b>' + esc(word) + '</b></div>' +
          '<div class="write-selfcheck-sub">對照上面，你寫對了嗎？</div>' +
          '<div class="write-selfcheck-btns">' +
            '<button class="btn-primary" id="wcYes">✅ 我寫對了</button>' +
            '<button class="btn-ghost" id="wcNo">❌ 再練一次</button>' +
          '</div>' +
        '</div>';
      bindSelfCheck(target, word);
    }
    checkBtn.disabled = false;
  }

  function bindSelfCheck(target, word) {
    var yes = document.getElementById('wcYes');
    var no = document.getElementById('wcNo');
    if (yes) yes.addEventListener('click', function() { finishDict(target, word, true); });
    if (no) no.addEventListener('click', function() {
      updateProgress(target.id, false, 'write', { mistakes: 1 });
      document.getElementById('gameScore').textContent = correct + ' / ' + (current + 1);
      current++; renderQuestion();
    });
  }

  function finishDict(target, word, ok) {
    if (ok) correct++;
    updateProgress(target.id, ok, 'write', { mistakes: ok ? 0 : 1 });
    document.getElementById('gameScore').textContent = correct + ' / ' + (current + 1);
    var resultEl = document.getElementById('writeResult');
    if (resultEl) resultEl.innerHTML = '<span class="write-done-msg">✅ 太棒了！「' + esc(word) + '」</span>';
    speakWord(word, 0.6);
    setTimeout(function() { current++; renderQuestion(); }, 1400);
  }

  // 把透明畫布轉成「白底黑字」的 dataURL（Tesseract 對白底較準）
  function whitenBg(srcCanvas) {
    var tmp = document.createElement('canvas');
    tmp.width = srcCanvas.width; tmp.height = srcCanvas.height;
    var tctx = tmp.getContext('2d');
    tctx.fillStyle = '#fff'; tctx.fillRect(0, 0, tmp.width, tmp.height);
    tctx.drawImage(srcCanvas, 0, 0);
    return tmp.toDataURL('image/png');
  }

  renderQuestion();
}
