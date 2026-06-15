// 連連看：英文單字 ↔ 中文 配對（連對要發音一次，仿 Duolingo）
function initMatchGame(area, words) {
  // 每輪取 5 對（不夠就用全部）
  var perRound = Math.min(5, words.length);
  var pool = shuffleArray(words);
  var roundWords = pool.slice(0, perRound);
  var totalPairs = roundWords.length;
  var matched = 0;
  var attempts = 0;

  // 左：英文（原順序），右：中文（打散）
  var leftItems = shuffleArray(roundWords.slice());
  var rightItems = shuffleArray(roundWords.slice());

  var selectedLeft = null;   // { id, el }
  var selectedRight = null;  // { id, el }

  function render() {
    var html = '<div class="match-container">' +
      '<div class="match-hint">把英文和中文連起來！</div>' +
      '<div class="match-board">' +
        '<div class="match-col" id="matchLeft">' +
          leftItems.map(function(w) {
            return '<button class="match-card match-en" data-id="' + w.id + '">' + esc(w.word) + '</button>';
          }).join('') +
        '</div>' +
        '<div class="match-col" id="matchRight">' +
          rightItems.map(function(w) {
            return '<button class="match-card match-zh" data-id="' + w.id + '">' + esc(w.meaning) + '</button>';
          }).join('') +
        '</div>' +
      '</div>' +
      '<div class="match-progress" id="matchProgress">0 / ' + totalPairs + '</div>' +
    '</div>';
    area.innerHTML = html;

    area.querySelectorAll('.match-en').forEach(function(btn) {
      btn.addEventListener('click', function() { pickLeft(btn); });
    });
    area.querySelectorAll('.match-zh').forEach(function(btn) {
      btn.addEventListener('click', function() { pickRight(btn); });
    });
  }

  function clearSelection() {
    if (selectedLeft && selectedLeft.el) selectedLeft.el.classList.remove('selected');
    if (selectedRight && selectedRight.el) selectedRight.el.classList.remove('selected');
    selectedLeft = null;
    selectedRight = null;
  }

  function pickLeft(btn) {
    if (btn.classList.contains('done')) return;
    if (selectedLeft && selectedLeft.el) selectedLeft.el.classList.remove('selected');
    selectedLeft = { id: parseInt(btn.dataset.id), el: btn };
    btn.classList.add('selected');
    tryMatch();
  }

  function pickRight(btn) {
    if (btn.classList.contains('done')) return;
    if (selectedRight && selectedRight.el) selectedRight.el.classList.remove('selected');
    selectedRight = { id: parseInt(btn.dataset.id), el: btn };
    btn.classList.add('selected');
    tryMatch();
  }

  function tryMatch() {
    if (!selectedLeft || !selectedRight) return;
    attempts++;
    var l = selectedLeft, r = selectedRight;
    if (l.id === r.id) {
      // 配對成功
      l.el.classList.remove('selected'); r.el.classList.remove('selected');
      l.el.classList.add('done', 'correct');
      r.el.classList.add('done', 'correct');
      l.el.style.pointerEvents = 'none';
      r.el.style.pointerEvents = 'none';
      // 連對要發音一次（仿 Duolingo）
      var w = roundWords.find(function(x) { return x.id === l.id; });
      if (w) speakWord(w.word);
      matched++;
      document.getElementById('matchProgress').textContent = matched + ' / ' + totalPairs;
      // 寫 FSRS：配對成功算答對
      updateProgress(l.id, true, 'match', { mistakes: 0 });
      selectedLeft = null; selectedRight = null;
      if (matched >= totalPairs) {
        setTimeout(function() { showResult(matched, totalPairs); }, 800);
      }
    } else {
      // 配對失敗：閃紅後復原
      var lEl = l.el, rEl = r.el;
      lEl.classList.add('wrong'); rEl.classList.add('wrong');
      // 答錯的那個英文字寫一次 FSRS（標記不熟）
      updateProgress(l.id, false, 'match', { mistakes: 1 });
      setTimeout(function() {
        lEl.classList.remove('wrong', 'selected');
        rEl.classList.remove('wrong', 'selected');
      }, 600);
      selectedLeft = null; selectedRight = null;
    }
  }

  render();
}
