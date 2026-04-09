// 看字選圖（小寶貝）/ 看圖選字（挑戰）
function initListenGame(area, words, mode) {
  const total = Math.min(10, words.length);
  const queue = shuffleArray(words).slice(0, total);
  let current = 0, correct = 0;

  function renderQuestion() {
    if (current >= queue.length) { showResult(correct, total); return; }
    const target = queue[current];
    const others = shuffleArray(words.filter(w => w.id !== target.id)).slice(0, 3);
    const options = shuffleArray([target, ...others]);

    if (mode === 'baby') {
      // 小寶貝：左邊大英文字+發音，右邊 2x2 圖片
      let html = '<div class="baby-layout">';
      html += '<div class="baby-left">';
      html += '<div class="baby-word">' + esc(target.word) + '</div>';
      html += '<button class="baby-speak" onclick="speakWord(\'' + esc(target.word) + '\', 0.6)">🔊</button>';
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

      setTimeout(function() { speakWord(target.word, 0.6); }, 300);
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
          updateProgress(target.id, isCorrect);
          document.getElementById('gameScore').textContent = correct + ' / ' + (current + 1);
          area.querySelectorAll(selector).forEach(function(b) { b.style.pointerEvents = 'none'; });
          setTimeout(function() { current++; renderQuestion(); }, 1500);
        });
      });
    }
  }
  renderQuestion();
}
