// 句子排列遊戲（原圖片填空，改為拖拉排列單字卡片）
function initFillBlankGame(area, words) {
  // 只選有短例句的單字（8個字以內）
  const withSentence = words.filter(w => {
    if (!w.sentences || w.sentences.length === 0) return false;
    return w.sentences.some(s => s.split(/\s+/).length <= 8);
  });
  if (withSentence.length < 4) {
    area.innerHTML = '<p style="text-align:center;color:#999;padding:40px;">需要至少 4 個有例句的單字才能玩排列遊戲！</p>';
    return;
  }
  const total = Math.min(10, withSentence.length);
  const queue = shuffleArray(withSentence).slice(0, total);
  let current = 0;
  let correct = 0;

  function renderQuestion() {
    if (current >= queue.length) {
      showResult(correct, total);
      return;
    }
    const target = queue[current];
    // 只選短例句（8個字以內）
    const shortSentences = (target.sentences || []).filter(s => s.split(/\s+/).length <= 8);
    const sentence = shortSentences.length > 0 ? shortSentences[Math.floor(Math.random() * shortSentences.length)] : null;
    if (!sentence) { current++; renderQuestion(); return; }
    const img = getRandomImage(target);
    // 把句子拆成單字卡片
    const correctWords = sentence.replace(/[.!?,;:'"]/g, '').split(/\s+/).filter(Boolean);
    const shuffled = shuffleArray([...correctWords]);

    area.innerHTML = `
      <div class="fill-container">
        ${img ? `<img class="fill-image" src="${img}" alt="" onerror="this.style.display='none'" />` : ''}
        <div style="font-size:1.1em;color:#666;margin-bottom:8px;">
          ${esc(target.meaning)}
          <button onclick="speakWord('${esc(sentence)}', 0.7)" style="background:none;border:none;font-size:1.2em;cursor:pointer;vertical-align:middle;">🔊</button>
        </div>
        <p style="color:#999;margin-bottom:12px;">把單字排成正確的句子</p>
        <div class="sort-slots" id="sortSlots"></div>
        <div class="sort-bank" id="sortBank">
          ${shuffled.map((w, i) => `<button class="sort-word" data-idx="${i}" data-word="${esc(w)}">${esc(w)}</button>`).join('')}
        </div>
        <div class="sort-actions">
          <button class="btn-ghost" id="sortClearBtn" onclick="clearSort()">清除</button>
          <button class="btn-primary" id="sortCheckBtn" onclick="checkSort()" disabled>確認</button>
        </div>
        <div class="sort-result" id="sortResult"></div>
        <div style="margin-top:12px;color:#999;">${current + 1} / ${total}</div>
      </div>
    `;

    const slotsEl = document.getElementById('sortSlots');
    const bankEl = document.getElementById('sortBank');
    let placed = [];

    // 點擊單字卡片 → 放入排列區
    bankEl.querySelectorAll('.sort-word').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.classList.contains('used')) return;
        btn.classList.add('used');
        const word = btn.dataset.word;
        placed.push({ word, btnEl: btn });
        renderSlots();
      });
    });

    function renderSlots() {
      slotsEl.innerHTML = placed.map((p, i) =>
        `<button class="sort-placed" data-i="${i}">${esc(p.word)}</button>`
      ).join('');
      // 點擊已放的卡片 → 退回
      slotsEl.querySelectorAll('.sort-placed').forEach(el => {
        el.addEventListener('click', () => {
          const i = parseInt(el.dataset.i);
          const removed = placed.splice(i, 1)[0];
          removed.btnEl.classList.remove('used');
          renderSlots();
        });
      });
      document.getElementById('sortCheckBtn').disabled = placed.length !== correctWords.length;
    }

    window.clearSort = () => {
      placed.forEach(p => p.btnEl.classList.remove('used'));
      placed = [];
      renderSlots();
    };

    window.checkSort = () => {
      const answer = placed.map(p => p.word).join(' ').toLowerCase();
      const expected = correctWords.join(' ').toLowerCase();
      const isCorrect = answer === expected;
      const resultEl = document.getElementById('sortResult');

      if (isCorrect) {
        resultEl.innerHTML = '✅ 正確！';
        resultEl.style.color = '#4CAF50';
        correct++;
        speakWord(sentence, 0.7);
      } else {
        resultEl.innerHTML = `❌ 正確順序：<span style="color:#667eea;font-weight:600;">${esc(sentence)}</span>`;
        resultEl.style.color = '#f44336';
        speakWord(sentence, 0.7);
      }
      updateProgress(target.id, isCorrect);
      document.getElementById('gameScore').textContent = `${correct} / ${current + 1}`;
      // 禁用操作
      document.getElementById('sortCheckBtn').disabled = true;
      document.getElementById('sortClearBtn').disabled = true;
      bankEl.querySelectorAll('.sort-word').forEach(b => b.style.pointerEvents = 'none');
      slotsEl.querySelectorAll('.sort-placed').forEach(b => b.style.pointerEvents = 'none');
      setTimeout(() => { current++; renderQuestion(); }, 2500);
    };
  }

  renderQuestion();
}
