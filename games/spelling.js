// 拼字挑戰遊戲（隨機空格版）— 拖放字母到空格（觸控友善）
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

    // 決定哪些位置要空格（至少空一半，但至少 2 個）
    const blankCount = Math.max(2, Math.ceil(letters.length * 0.5));
    const allIndices = letters.map((_, i) => i);
    const blankIndices = shuffleArray(allIndices).slice(0, Math.min(blankCount, letters.length));
    blankIndices.sort((a, b) => a - b);

    const blankLetters = blankIndices.map(i => letters[i]);
    const shuffledBlanks = shuffleArray([...blankLetters]);

    area.innerHTML = `
      <div class="spell-container">
        ${img ? `<img class="spell-image" src="${img}" alt="" onerror="this.style.display='none'" />` : ''}
        <div class="spell-meaning">${esc(target.meaning)}</div>
        <button class="listen-play-btn" onclick="speakWord('${esc(target.word)}')" title="聽發音" style="font-size:2em;margin-bottom:12px;">🔊</button>
        <div class="spell-hint-tip">點下面的字母填進空格 👆</div>
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

    const blankSlots = area.querySelectorAll('.spell-slot[data-blank="true"]');
    const letterBtns = area.querySelectorAll('.spell-letter');

    // 用共用的拖放工具（定義於 app.js）
    attachSpellDrag(area, blankSlots, letterBtns, function(placed) {
      const fullAnswer = [...letters];
      blankIndices.forEach((pos, fi) => { fullAnswer[pos] = placed[fi]; });
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
        blankSlots.forEach((s, si) => {
          s.textContent = blankLetters[si];
          s.style.color = (placed[si] === blankLetters[si]) ? '#4CAF50' : '#f44336';
        });
      }
      let wrongCount = 0;
      for (let li = 0; li < placed.length; li++) {
        if (placed[li] !== blankLetters[li]) wrongCount++;
      }
      updateProgress(target.id, isCorrect, 'spelling', { mistakes: wrongCount });
      document.getElementById('gameScore').textContent = `${correct} / ${current + 1}`;
      letterBtns.forEach(b => b.style.pointerEvents = 'none');
      setTimeout(() => { current++; renderQuestion(); }, 2000);
    });
  }

  renderQuestion();
}
