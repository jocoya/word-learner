// 把句子切成「語塊」（lexical chunks），教小孩英文的自然組合方式
// 原則：
//   1. 目標單字永遠獨立成塊（學習重點）
//   2. 主詞 / 動詞 / 受詞 之間切開（SVO 結構，依 British Council 詞序教學）
//   3. 冠詞+形容詞+名詞 黏成一塊（the big dog）
//   4. 介系詞片語（in the park）黏成一塊
//   5. be/助動詞 + 主動詞 黏一塊（is running，時態語塊）
function chunkSentence(sentence, targetWord) {
  var clean = sentence.replace(/[.!?,;:"]/g, '').trim();
  var tokens = clean.split(/\s+/).filter(Boolean);
  if (tokens.length <= 1) return tokens;

  var DET   = ['the','a','an','this','that','these','those','my','your','his','her','its','our','their','some','any','no','each','every'];
  var PREP  = ['in','on','at','to','with','for','from','by','of','into','onto','up','down','over','under','about','after','before','near','behind','between','around','through'];
  var BEAUX = ['is','am','are','was','were','be','been','being','can','could','will','would','shall','should','do','does','did','has','have','had','may','might','must',
               "don't","doesn't","didn't","can't","won't","isn't","aren't","wasn't","weren't"];
  var CONJ  = ['and','but','or','so','because','then','when','if','while'];
  var PRON  = ['i','you','he','she','it','we','they'];

  function typeOf(w) {
    var lw = w.toLowerCase();
    if (DET.indexOf(lw) !== -1) return 'DET';
    if (PREP.indexOf(lw) !== -1) return 'PREP';
    if (BEAUX.indexOf(lw) !== -1) return 'BEAUX';
    if (CONJ.indexOf(lw) !== -1) return 'CONJ';
    if (PRON.indexOf(lw) !== -1) return 'PRON';
    return 'OTHER';
  }

  var tw = targetWord ? targetWord.toLowerCase().replace(/[^a-z']/g, '') : null;
  function isTarget(w) {
    if (!tw) return false;
    return w.toLowerCase().replace(/[^a-z']/g, '') === tw;
  }

  var chunks = [], cur = [];
  function flush() { if (cur.length > 0) { chunks.push(cur); cur = []; } }
  function curStartsWithDet() { return cur.length > 0 && typeOf(cur[0]) === 'DET'; }

  for (var i = 0; i < tokens.length; i++) {
    var w = tokens[i];
    var type = typeOf(w);
    var prevType = i > 0 ? typeOf(tokens[i - 1]) : null;

    // 規則 1：目標單字永遠獨立成塊
    if (isTarget(w)) {
      flush();
      chunks.push([w]);
      continue;
    }

    var boundary = false;
    if (i === 0) {
      boundary = false;
    } else if (type === 'PREP' || type === 'CONJ' || type === 'BEAUX' || type === 'PRON') {
      // 介系詞 / 連接詞 / be 助動詞 / 代名詞主詞 → 起新塊
      boundary = true;
    } else if (type === 'DET') {
      // 名詞片語開頭，但介系詞後的冠詞要黏在一起（in the park）
      boundary = (prevType !== 'PREP');
    } else { // OTHER：名詞 / 動詞 / 形容詞
      if (prevType === 'BEAUX') {
        boundary = false;           // is running 黏一起
      } else if (prevType === 'DET' || (prevType === 'OTHER' && curStartsWithDet())) {
        boundary = false;           // 名詞片語內（the big dog）黏一起
      } else if (prevType === 'PREP') {
        boundary = false;           // 介系詞直接接名詞（to school）黏一起
      } else {
        boundary = true;            // 動詞接受詞 / 主詞接動詞 → 切開
      }
    }

    if (boundary) flush();
    cur.push(w);
  }
  flush();

  var result = chunks.map(function(c) { return c.join(' '); });
  // 保險：如果只切出 1 塊（且原句不只 1 字），退回逐字切
  if (result.length < 2 && tokens.length > 1) return tokens;
  return result;
}

// 句子排列遊戲（原圖片填空，改為拖拉排列「語塊」卡片）
async function initFillBlankGame(area, words) {
  // 只選有例句的單字（語塊化後對長句也友善，不再硬性限制字數）
  const withSentence = words.filter(w => {
    if (!w.sentences || w.sentences.length === 0) return false;
    return w.sentences.some(s => s && s.trim().split(/\s+/).length >= 2);
  });
  if (withSentence.length < 4) {
    area.innerHTML = '<p style="text-align:center;color:#999;padding:40px;">需要至少 4 個有例句的單字才能玩排列遊戲！</p>';
    return;
  }
  const state = (typeof prepareChallengeQueue === 'function')
    ? await prepareChallengeQueue('fillblank', withSentence, 5)
    : { queue: shuffleArray(withSentence).slice(0, Math.min(5, withSentence.length)), current: 0, correct: 0, total: Math.min(5, withSentence.length) };
  const total = state.total;
  const queue = state.queue;
  let current = state.current;
  let correct = state.correct;

  async function renderQuestion() {
    if (current >= queue.length) {
      showResult(correct, total);
      return;
    }
    const target = queue[current];
    // 選一個句子（語塊化後不需限制長度，挑最短的讓小孩好上手）
    const validSentences = (target.sentences || []).filter(s => s && s.trim().split(/\s+/).length >= 2);
    let sentence = null;
    if (validSentences.length > 0) {
      // 偏好較短的句子
      const sorted = validSentences.slice().sort((a, b) => a.split(/\s+/).length - b.split(/\s+/).length);
      // 從最短的前半隨機挑一個，增加變化
      const pickPool = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 2)));
      sentence = pickPool[Math.floor(Math.random() * pickPool.length)];
    }
    if (!sentence) {
      current++;
      if (typeof checkpointGameChallenge === 'function') await checkpointGameChallenge('fillblank', current, correct, total);
      renderQuestion();
      return;
    }
    const img = getRandomImage(target);
    // 把句子切成「語塊」卡片（目標單字會獨立成塊）
    const correctWords = chunkSentence(sentence, target.word);
    const shuffled = shuffleArray([...correctWords]);

    area.innerHTML = `
      <div class="fill-container">
        ${img ? `<img class="fill-image" src="${img}" alt="" onerror="this.style.display='none'" />` : ''}
        <div style="font-size:1.1em;color:#666;margin-bottom:8px;">
          ${esc(target.meaning)}
          <button onclick="speakWord('${esc(sentence)}', 0.7)" style="background:none;border:none;font-size:1.2em;cursor:pointer;vertical-align:middle;">🔊</button>
        </div>
        <p style="color:#999;margin-bottom:12px;">把語塊排成正確的句子</p>
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
    let answered = false;

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

    window.checkSort = async () => {
      if (answered) return;
      answered = true;
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
      var extra = {
        mistakes: isCorrect ? 0 : 1,
        answerId: (typeof makeChallengeAnswerId === 'function') ? makeChallengeAnswerId('fillblank', current, target.id) : null
      };
      await updateProgress(target.id, isCorrect, 'fillblank', extra);
      document.getElementById('gameScore').textContent = `${correct} / ${current + 1}`;
      // 禁用操作
      document.getElementById('sortCheckBtn').disabled = true;
      document.getElementById('sortClearBtn').disabled = true;
      bankEl.querySelectorAll('.sort-word').forEach(b => b.style.pointerEvents = 'none');
      slotsEl.querySelectorAll('.sort-placed').forEach(b => b.style.pointerEvents = 'none');
      current++;
      if (typeof checkpointGameChallenge === 'function') await checkpointGameChallenge('fillblank', current, correct, total);
      setTimeout(renderQuestion, 2500);
    };
  }

  renderQuestion();
}
