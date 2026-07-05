// 讀句選字：顯示挖空例句 + 朗讀，從 4 個選項選出正確單字（情境記憶）

// 挑干擾項：優先選同詞性的字（讓選項語法上都能填入空格，逼孩子真正理解語意）
function pickDistractors(target, pool) {
  var candidates = pool.filter(function(w) { return w.id !== target.id; });
  // 同詞性優先
  var samePos = candidates.filter(function(w) { return target.pos && w.pos === target.pos; });
  var others = candidates.filter(function(w) { return !(target.pos && w.pos === target.pos); });
  var ordered = shuffleArray(samePos).concat(shuffleArray(others));
  return ordered.slice(0, 3);
}

function initClozeGame(area, words) {
  // 只選有例句的單字
  var withSentence = words.filter(function(w) {
    return w.sentences && w.sentences.some(function(s) { return s && s.trim(); });
  });
  if (withSentence.length < 4) {
    area.innerHTML = '<p style="text-align:center;color:#999;padding:40px;">需要至少 4 個有例句的單字才能玩讀句選字！</p>';
    return;
  }
  var total = Math.min(10, withSentence.length);
  var queue = shuffleArray(withSentence).slice(0, total);
  var current = 0, correct = 0;

  function renderQuestion() {
    if (current >= queue.length) { showResult(correct, total); return; }
    var target = queue[current];

    // 挑一個含有目標單字的例句
    var valid = (target.sentences || []).filter(function(s) {
      return s && new RegExp('\\b' + target.word + '\\b', 'i').test(s);
    });
    // 若沒有句子剛好含該字，退回任一句
    var sentence = valid.length > 0
      ? valid[Math.floor(Math.random() * valid.length)]
      : (target.sentences.find(function(s){return s && s.trim();}) || null);
    if (!sentence) { current++; renderQuestion(); return; }

    // 挖空（把目標單字換成底線）
    var blanked = sentence.replace(new RegExp('\\b' + target.word + '\\b', 'gi'), '______');

    var others = pickDistractors(target, withSentence);
    var options = shuffleArray([target].concat(others));
    var img = getRandomImage(target);

    area.innerHTML =
      '<div class="cloze-container">' +
        (img ? '<img class="cloze-image" src="' + img + '" alt="" onerror="this.style.display=\'none\'">' : '') +
        '<div class="cloze-sentence">' + esc(blanked) +
          ' <button class="cloze-speak" onclick="speakWord(\'' + esc(sentence) + '\', 0.7)">🔊</button>' +
        '</div>' +
        '<div class="cloze-opts">' +
          options.map(function(o) {
            return '<button class="cloze-opt" data-id="' + o.id + '">' + esc(o.word) + '</button>';
          }).join('') +
        '</div>' +
        '<div class="baby-progress">' + (current + 1) + ' / ' + total + '</div>' +
      '</div>';

    // 進場先朗讀整句（聽語境）
    setTimeout(function() { speakWord(sentence, 0.7); }, 300);

    area.querySelectorAll('.cloze-opt').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var picked = parseInt(btn.dataset.id);
        var isCorrect = picked === target.id;
        btn.classList.add(isCorrect ? 'correct' : 'wrong');
        if (!isCorrect) {
          var right = area.querySelector('.cloze-opt[data-id="' + target.id + '"]');
          if (right) right.classList.add('correct');
        }
        if (isCorrect) correct++;
        // 填回完整句子並朗讀（先 escape 純文字，再插入高亮 span，避免標籤被當文字顯示）
        var sentEl = area.querySelector('.cloze-sentence');
        if (sentEl) {
          var filledHtml = esc(sentence).replace(
            new RegExp('\\b' + target.word + '\\b', 'gi'),
            '<span class="cloze-filled">' + esc(target.word) + '</span>'
          );
          sentEl.innerHTML = filledHtml;
        }
        speakWord(target.word);
        updateProgress(target.id, isCorrect, 'cloze', { mistakes: isCorrect ? 0 : 1 });
        document.getElementById('gameScore').textContent = correct + ' / ' + (current + 1);
        area.querySelectorAll('.cloze-opt').forEach(function(b) { b.style.pointerEvents = 'none'; });
        setTimeout(function() { current++; renderQuestion(); }, 2200);
      });
    });
  }
  renderQuestion();
}
