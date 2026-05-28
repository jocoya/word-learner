// 拼字挑戰遊戲（隨機空格版）
function initSpellingGame(area, words) {
  const total = Math.min(10, words.length);
  const queue = shuffleArray(words).slice(0, total);
  let current = 0;
  let correct = 0;

  function renderQuestion() {
    if (current >= queue.length) {
      showResult(correct, total);
      return;
    }
    const target = queue[current];
    const letters = target.word.toLowerCase().split('');
    const img = getRandomImage(target);

    // 決定哪些位置要空格（至少空一半，但至少 2 個，最多全部-1）
    const blankCount = Math.max(2, Math.ceil(letters.length * 0.5));
    // 隨機選 blankCount 個位置
    const allIndices = letters.map((_, i) => i);
    const blankIndices = shuffleArray(allIndices).slice(0, Math.min(blankCount, letters.length));
    blankIndices.sort((a, b) => a - b);

    // 要填的字母（打散順序）
    const blankLetters = blankIndices.map(i => letters[i]);
    const shuffledBlanks = shuffleArray([...blankLetters]);

    area.innerHTML = `
      <div class="spell-container">
        ${img ? `<img class="spell-image" src="${img}" alt="" onerror="this.style.display='none'" />` : ''}
        <div class="spell-meaning">${esc(target.meaning)}</div>
        <button class="listen-play-btn" onclick="speakWord('${esc(target.word)}')" title="聽發音" style="font-size:2em;margin-bottom:12px;">🔊</button>
        <div class="spell-slots" id="spellSlots">
          ${letters.map((l, i) => {
            if (blankIndices.includes(i)) {
              return `<div class="spell-slot" data-blank="true" data-pos="${i}"></div>`;
            } else {
              return `<div class="spell-slot filled hint" data-blank="false">${l}</div>`;
            }
          }).join('')}
        </div>
        <div class="spell-letters" id="spellLetters">
          ${shuffledBlanks.map((l, i) => `<button class="spell-letter" data-idx="${i}" data-letter="${l}">${l}</button>`).join('')}
        </div>
        <div class="spell-result" id="spellResult"></div>
        <div style="margin-top:12px;color:#999;">${current + 1} / ${total}</div>
      </div>
    `;

    let filled = [];
    const blankSlots = area.querySelectorAll('.spell-slot[data-blank="true"]');
    const letterBtns = area.querySelectorAll('.spell-letter');

    letterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.classList.contains('used')) return;
        btn.classList.add('used');
        const letter = btn.dataset.letter;
        filled.push({ letter, btnEl: btn });
        const slot = blankSlots[filled.length - 1];
        slot.textContent = letter;
        slot.classList.add('filled');

        // 填滿所有空格時檢查
        if (filled.length === blankIndices.length) {
          // 組合完整答案
          const fullAnswer = [...letters];
          filled.forEach((f, fi) => {
            fullAnswer[blankIndices[fi]] = f.letter;
          });
          const answer = fullAnswer.join('');
          const isCorrect = answer === target.word.toLowerCase();
          const resultEl = document.getElementById('spellResult');
          if (isCorrect) {
            resultEl.textContent = '✅ 正確！';
            resultEl.className = 'spell-result correct';
            correct++;
            speakWord(target.word);
          } else {
            resultEl.textContent = `❌ 正確答案是 ${target.word.toLowerCase()}`;
            resultEl.className = 'spell-result wrong';
            speakWord(target.word);
            // 顯示正確字母
            blankSlots.forEach((s, si) => {
              s.textContent = blankLetters[si];
              s.style.color = s.textContent === filled[si]?.letter ? '#4CAF50' : '#f44336';
            });
          }
          // 計算錯誤字母數
          var wrongCount = 0;
          for (var li = 0; li < filled.length; li++) {
            if (filled[li] && blankLetters[li] && filled[li].letter !== blankLetters[li]) wrongCount++;
          }
          updateProgress(target.id, isCorrect, 'spelling', { mistakes: wrongCount });
          document.getElementById('gameScore').textContent = `${correct} / ${current + 1}`;
          setTimeout(() => { current++; renderQuestion(); }, 2000);
        }
      });
    });

    // 點擊已填的空格可以退回
    blankSlots.forEach((slot, i) => {
      slot.addEventListener('click', () => {
        if (i >= filled.length) return;
        while (filled.length > i) {
          const removed = filled.pop();
          removed.btnEl.classList.remove('used');
          blankSlots[filled.length].textContent = '';
          blankSlots[filled.length].classList.remove('filled');
        }
      });
    });
  }

  renderQuestion();
}
