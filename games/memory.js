// 翻牌配對遊戲
// 音效：用 Web Audio API 合成
function playMatchSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    // 成功音：兩個上升音
    [523.25, 659.25, 783.99].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.3, ctx.currentTime + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + i * 0.12 + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.12);
      osc.stop(ctx.currentTime + i * 0.12 + 0.3);
    });
  } catch (e) { /* 靜音 fallback */ }
}

function playMissSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 200;
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch (e) {}
}

function initMemoryGame(area, words, mode) {
  const count = Math.min(6, words.length);
  const selected = words.slice(0, count);
  let cards = [];

  if (mode === 'baby') {
    // 只選有圖片的單字，完全不顯示文字
    const withImg = words.filter(w => getAllImages(w).length > 0);
    if (withImg.length < 4) {
      area.innerHTML = '<p style="text-align:center;color:#999;padding:40px;">需要至少 4 個有圖片的單字才能玩翻牌！</p>';
      return;
    }
    const useWords = shuffleArray(withImg).slice(0, Math.min(6, withImg.length));
    const cnt = useWords.length;
    useWords.forEach((w, i) => {
      const img = getRandomImage(w);
      const label = `<img src="${img}" alt="" style="max-width:90%;max-height:70%;object-fit:contain;border-radius:6px;" />`;
      cards.push({ id: i, pairId: i, content: label, word: w });
      const img2 = getRandomImage(w);
      const label2 = `<img src="${img2}" alt="" style="max-width:90%;max-height:70%;object-fit:contain;border-radius:6px;" />`;
      cards.push({ id: i + cnt, pairId: i, content: label2, word: w });
    });
  } else {
    // 8歲：英文單字配圖片
    selected.forEach((w, i) => {
      const img = getRandomImage(w);
      cards.push({ id: i, pairId: i, content: `<div style="font-size:1.3em;font-weight:700">${esc(w.word)}</div>`, word: w });
      const imgContent = img
        ? `<img src="${img}" alt="" style="max-width:90%;max-height:70%;object-fit:contain;border-radius:6px;" onerror="this.outerHTML='<div style=\\'font-size:1.3em\\'>${esc(w.word)}</div>'" />`
        : `<div style="font-size:1.3em">${esc(w.word)}</div>`;
      cards.push({ id: i + count, pairId: i, content: imgContent, word: w });
    });
  }

  cards = shuffleArray(cards);
  const cols = cards.length <= 8 ? 4 : cards.length <= 12 ? 4 : 6;

  area.innerHTML = `<div class="memory-grid" style="grid-template-columns:repeat(${cols},1fr)"></div>`;
  const grid = area.querySelector('.memory-grid');

  cards.forEach((c, idx) => {
    const el = document.createElement('div');
    el.className = 'memory-card';
    el.dataset.idx = idx;
    el.innerHTML = `
      <div class="memory-card-inner">
        <div class="memory-card-front">❓</div>
        <div class="memory-card-back">${c.content}</div>
      </div>
    `;
    el.addEventListener('click', () => flipCard(el, idx));
    grid.appendChild(el);
  });

  let flipped = [];
  let matched = 0;
  let attempts = 0;
  let locked = false;

  function flipCard(el, idx) {
    if (locked || el.classList.contains('flipped') || el.classList.contains('matched')) return;
    el.classList.add('flipped');
    speakWord(cards[idx].word.word);
    flipped.push({ el, idx });

    if (flipped.length === 2) {
      locked = true;
      attempts++;
      const [a, b] = flipped;
      if (cards[a.idx].pairId === cards[b.idx].pairId) {
        // 配對成功：音效 + 消失
        playMatchSound();
        setTimeout(() => {
          a.el.classList.add('matched');
          b.el.classList.add('matched');
          // 消失動畫
          a.el.style.transition = 'opacity .5s, transform .5s';
          b.el.style.transition = 'opacity .5s, transform .5s';
          a.el.style.opacity = '0';
          b.el.style.opacity = '0';
          a.el.style.transform = 'scale(0.5)';
          b.el.style.transform = 'scale(0.5)';
          setTimeout(() => {
            a.el.style.visibility = 'hidden';
            b.el.style.visibility = 'hidden';
          }, 500);
          matched++;
          updateProgress(cards[a.idx].word.id, true);
          flipped = [];
          locked = false;
          updateScore();
          if (matched === count) {
            setTimeout(() => showResult(matched, attempts), 800);
          }
        }, 600);
      } else {
        // 配對失敗
        playMissSound();
        setTimeout(() => {
          a.el.classList.remove('flipped');
          b.el.classList.remove('flipped');
          flipped = [];
          locked = false;
          updateScore();
        }, 1000);
      }
    }
  }

  function updateScore() {
    document.getElementById('gameScore').textContent = `配對 ${matched}/${count} · 翻了 ${attempts} 次`;
  }
  updateScore();
}
