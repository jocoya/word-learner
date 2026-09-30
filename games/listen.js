// 看字選圖（小寶貝）/ 看圖選字（挑戰）
// maxRounds: 可選，限制題數（每日挑戰萌新用）
function initListenGame(area, words, mode, maxRounds) {
  // 小寶貝：看字選圖的選項全部是圖片，沒圖片的字不出題、也不當干擾選項
  const pool = mode === 'baby' ? words.filter(w => getAllImages(w).length > 0) : words;
  if (mode === 'baby' && pool.length < 4) {
    area.innerHTML = '<p style="text-align:center;color:#999;padding:40px;">需要至少 4 個有圖片的單字才能玩看字選圖！</p>';
    // 每日挑戰中要讓流程繼續（一般遊戲就停在提示畫面，不算完成一場）
    if (window.dailySegmentActive) setTimeout(function() { showResult(0, 0); }, 1500);
    return;
  }
  const limit = (typeof maxRounds === 'number' && maxRounds > 0) ? maxRounds : 10;
  const total = Math.min(limit, pool.length);
  const queue = shuffleArray(pool).slice(0, total);
  let current = 0, correct = 0;

  function renderQuestion() {
    if (current >= queue.length) { showResult(correct, total); return; }
    const target = queue[current];
    const others = shuffleArray(pool.filter(w => w.id !== target.id)).slice(0, 3);
    const options = shuffleArray([target, ...others]);

    if (mode === 'baby') {
      // 小寶貝：聽音 + 圖片為主，文字最小化（4-5 歲還不識字，靠聽和看圖）
      let html = '<div class="baby-layout">';
      html += '<div class="baby-left">';
      html += '<button class="baby-speak baby-speak-big" onclick="speakWord(\'' + esc(target.word) + '\', 0.6)">🔊</button>';
      html += '<div class="baby-word baby-word-small">' + esc(target.word) + '</div>';
      html += '<div class="baby-progress">' + (current+1) + ' / ' + total + '</div>';
      html += '</div>';
      html += '<div class="baby-grid">';
      options.forEach(function(o) {
        var img = getRandomImage(o);
        html += '<button class="baby-cell" data-id="' + o.id + '">';
        if (img) {
          html += '<img src="' + img + '" alt="' + esc(o.meaning) + '">';
        } else {
          html += '<span class="baby-fallback">' + esc(o.meaning) + '</span>';
        }
        html += '</button>';
      });
      html += '</div></div>';
      area.innerHTML = html;

      // 圖片載入失敗時顯示中文
      area.querySelectorAll('.baby-cell img').forEach(function(img) {
        img.onerror = function() {
          var span = document.createElement('span');
          span.className = 'baby-fallback';
          span.textContent = img.alt;
          img.parentElement.replaceChild(span, img);
        };
      });

      // 自動念兩次，強化聽覺連結
      setTimeout(function() { speakWord(target.word, 0.6); }, 300);
      setTimeout(function() { speakWord(target.word, 0.5); }, 1600);
      bindClicks('.baby-cell', target);
    } else {
      // 挑戰模式：上方大圖，下方 4 個英文選項
      var img = getRandomImage(target);
      var html = '<div class="kid-layout">';
      html += '<div class="kid-top">';
      if (img) {
        html += '<img class="kid-image" src="' + img + '" alt="">';
      } else {
        html += '<div class="kid-image kid-noimg">' + esc(target.meaning) + '</div>';
      }
      html += '<button class="kid-speak" onclick="speakWord(\'' + esc(target.word) + '\', 0.7)">🔊</button>';
      html += '</div>';
      html += '<div class="kid-opts">';
      options.forEach(function(o) {
        html += '<button class="kid-opt" data-id="' + o.id + '">' + esc(o.word) + '</button>';
      });
      html += '</div>';
      html += '<div class="baby-progress">' + (current+1) + ' / ' + total + '</div>';
      html += '</div>';
      area.innerHTML = html;
      // 挑戰模式不自動唸
      bindClicks('.kid-opt', target);
    }

    function bindClicks(selector, target) {
      area.querySelectorAll(selector).forEach(function(btn) {
        btn.addEventListener('click', function() {
          var picked = parseInt(btn.dataset.id);
          var isCorrect = picked === target.id;
          btn.classList.add(isCorrect ? 'correct' : 'wrong');
          if (!isCorrect) {
            var right = area.querySelector(selector + '[data-id="' + target.id + '"]');
            if (right) right.classList.add('correct');
          }
          if (isCorrect) correct++;
          speakWord(target.word);
          updateProgress(target.id, isCorrect, 'listen', { mistakes: isCorrect ? 0 : 1 });
          document.getElementById('gameScore').textContent = correct + ' / ' + (current + 1);
          area.querySelectorAll(selector).forEach(function(b) { b.style.pointerEvents = 'none'; });
          setTimeout(function() { current++; renderQuestion(); }, 1500);
        });
      });
    }
  }
  renderQuestion();
}
