// 全域狀態
let currentMode = 'kid';
let currentGameWords = [];
let currentExamId = null;
let localImageData = null;
let examLocalImageData = null;
let dailyRole = null;

// 頁面導航
function goTo(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(pageId).classList.add('active');
  if (pageId === 'page-manage') { renderWordList(); loadTagDropdown('tagDropdown'); }
  if (pageId === 'page-exams') renderExamList();
  if (pageId === 'page-coins') renderCoinPage();
  if (pageId === 'page-games') {
    const srcEl = document.getElementById('gameSource');
    if (srcEl) srcEl.parentElement.style.display = '';
  }
}

function enterMode(mode) {
  currentMode = mode;
  dailyRole = null;
  renderGameCards();
  goTo('page-games');
}

const GAMES = [
  { id: 'memory',    icon: '🃏', name: '翻牌配對',   desc: '找到相同的配對',     modes: ['baby','kid'] },
  { id: 'listen',    icon: '👀', name: '看字選圖',   desc: '看英文選圖片',       modes: ['baby','kid'] },
  { id: 'bubble',    icon: '🫧', name: '泡泡戳戳樂', desc: '聽聲音戳泡泡',       modes: ['baby','kid'] },
  { id: 'echo',      icon: '�', name: '魔法動物園',  desc: '唸對單字叫醒恐龍',   modes: ['baby','kid'] },
  { id: 'flashlight',icon: '🔦', name: '探照燈尋寶',  desc: '用手電筒找出圖片',   modes: ['baby'] },
  { id: 'fillblank', icon: '📝', name: '句子排列',   desc: '把單字排成正確句子',  modes: ['kid'] },
  { id: 'spelling',  icon: '🔤', name: '拼字挑戰',   desc: '拼出正確的單字',     modes: ['kid'] },
  { id: 'speak',     icon: '🎤', name: '看圖說句',   desc: '看圖說出句子',       modes: ['kid'] },
  { id: 'detective', icon: '🔍', name: '線索偵探',   desc: '聽線索猜單字',       modes: ['kid'] },
];

function renderGameCards() {
  const el = document.getElementById('gameCards');
  const title = document.getElementById('gamesTitle');
  if (!dailyRole) title.textContent = currentMode === 'baby' ? '🧒 小寶貝遊戲' : '🧑‍🎓 挑戰遊戲';
  const games = GAMES.filter(g => g.modes.includes(currentMode));
  el.innerHTML = games.map(g => `
    <button class="game-card" onclick="startGame('${g.id}')">
      <div class="game-card-icon">${g.icon}</div>
      <div class="game-card-name">${g.name}</div>
      <div class="game-card-desc">${g.desc}</div>
    </button>`).join('');
}

async function getGameWords() {
  const source = document.getElementById('gameSource')?.value || 'permanent';
  let words;
  if (source.startsWith('exam-')) {
    words = currentGameWords.length > 0 ? currentGameWords : await dbGetByIndex('words', 'pool', source);
  } else if (source === 'due') {
    words = await getDueWords('permanent');
  } else {
    words = await dbGetByIndex('words', 'pool', 'permanent');
  }
  if (words.length < 4) { alert('單字不夠，至少需要 4 個！'); return null; }
  return shuffleArray(words);
}

function updateGameSource() {}

async function startGame(gameId) {
  const words = await getGameWords();
  if (!words) return;
  currentGameWords = words;
  document.getElementById('gameTitle').textContent = GAMES.find(g => g.id === gameId).name;
  document.getElementById('gameScore').textContent = '';
  goTo('page-game');
  const area = document.getElementById('gameArea');
  area.innerHTML = '';
  switch (gameId) {
    case 'memory':    initMemoryGame(area, words, currentMode); break;
    case 'listen':    initListenGame(area, words, currentMode); break;
    case 'fillblank': initFillBlankGame(area, words); break;
    case 'spelling':  initSpellingGame(area, words); break;
    case 'speak':     initSpeakGame(area, words); break;
    case 'bubble':    initBubbleGame(area, words); break;
    case 'echo':      initEchoGame(area, words); break;
    case 'flashlight':initFlashlightGame(area, words); break;
    case 'detective': initDetectiveGame(area, words); break;
  }
}

async function startExamPractice() {
  if (!currentExamId) return;
  const words = await dbGetByIndex('words', 'pool', 'exam-' + currentExamId);
  if (words.length < 4) { alert('考試包單字不夠，至少需要 4 個！'); return; }
  currentGameWords = shuffleArray(words);
  currentMode = 'kid';
  renderGameCards();
  goTo('page-games');
  const srcEl = document.getElementById('gameSource');
  const opt = document.createElement('option');
  opt.value = 'exam-' + currentExamId; opt.textContent = '目前考試包'; opt.selected = true;
  srcEl.appendChild(opt);
}

function exitGame() {
  const srcEl = document.getElementById('gameSource');
  if (srcEl) srcEl.parentElement.style.display = '';
  dailyRole = null;
  goTo('page-games');
}

function showResult(correct, total) {
  const pct = total > 0 ? correct / total : 0;
  const stars = pct >= .9 ? '⭐⭐⭐' : pct >= .7 ? '⭐⭐' : pct >= .5 ? '⭐' : '💪';
  const msgs  = pct >= .9 ? '太厲害了！' : pct >= .7 ? '很棒喔！' : pct >= .5 ? '繼續加油！' : '再練習一下！';
  document.getElementById('resultStars').textContent = stars;
  document.getElementById('resultMsg').textContent   = msgs;
  document.getElementById('resultStats').textContent  = `答對 ${correct} / ${total} 題`;
  const coinArea = document.getElementById('resultCoinArea');
  if (dailyRole && pct >= 0.5) {
    awardDailyCoin(dailyRole).then(() => {
      const coinImg = dailyRole === 'boy' ? './images/COIN_CAT.png' : './images/COIN_DOG.png';
      if (coinArea) coinArea.innerHTML = '<div class="coin-earn-anim"><img src="' + coinImg + '" style="width:48px;height:48px;"> +1</div>';
    });
  } else if (dailyRole && coinArea) {
    coinArea.innerHTML = '<div style="color:#999;">這次沒拿到金幣，再試一次！</div>';
  } else if (coinArea) {
    coinArea.innerHTML = '';
  }
  goTo('page-result');
}

async function awardDailyCoin(role) {
  const coins = await getCoins();
  if (role === 'boy') coins.boy += 1; else coins.girl += 1;
  coins.log.push({ role, count: 1, date: getTodayStr() });
  await saveCoins(coins);
  // 同步到 Firestore 使用者進度
  updateUserProgress(role, 1, 10);
  const daily = await getDailyData();
  const today = getTodayStr();
  const roleKey = role + '-' + today;
  if (!daily.completedDates.includes(roleKey)) {
    daily.completedDates.push(roleKey);
    const y = new Date(); y.setDate(y.getDate() - 1);
    const yStr = `${y.getFullYear()}-${String(y.getMonth()+1).padStart(2,'0')}-${String(y.getDate()).padStart(2,'0')}`;
    if (daily.completedDates.includes('boy-'+yStr) || daily.completedDates.includes('girl-'+yStr) || daily.streak === 0) daily.streak++;
    else if (daily.lastDate !== today) daily.streak = 1;
    daily.lastDate = today;
    await saveDailyData(daily);
  }
}

async function updateProgress(wordId, correct) {
  let p = await dbGet('progress', wordId);
  if (!p) p = newProgress(wordId);
  p = calcNextReview(p, correct);
  await dbPut('progress', p);
}

// ===== 本地 AI（Ollama）英英解釋 + 例句生成 =====
// 電腦上用 localhost，平板/手機透過 Tailscale 用固定 IP
const OLLAMA_HOST = (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
  ? 'http://localhost:11434'
  : 'http://100.125.96.108:11434';
const OLLAMA_URL = OLLAMA_HOST + '/api/generate';
const OLLAMA_MODEL = 'bjoernb/gemma4-e4b-fast';

async function ollamaGenerate(prompt) {
  var res = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OLLAMA_MODEL, prompt: prompt, stream: false })
  });
  var data = await res.json();
  return (data.response || '').trim();
}

async function aiGenerateDefinition(wordInputId, defInputId) {
  var word = document.getElementById(wordInputId).value.trim();
  if (!word) return alert('請先輸入英文單字');
  var defInput = document.getElementById(defInputId);
  defInput.value = '生成中...';
  var mEl = document.getElementById('newMeaning') || document.getElementById('editMeaning');
  var mHint = mEl && mEl.value ? ' (Chinese meaning: ' + mEl.value.trim() + ')' : '';
  try {
    var text = await ollamaGenerate(
      "Explain the English word '" + word + "'" + mHint + " in the simplest way possible. Use very basic words that even a 4-year-old can understand. One short sentence only. Return ONLY the sentence.\n\nWord: glasses (眼鏡)\nExplanation: Something you wear on your face to help you see better.\nWord: glasses (玻璃杯)\nExplanation: A cup made of glass that you drink water from.\nWord: cat\nExplanation: A small furry animal that says meow.\nWord: " + word + mHint + "\nExplanation:"
    );
    // 清理多餘的換行和引號
    text = text.replace(/^["'\s]+|["'\s]+$/g, '').split('\n')[0];
    defInput.value = text || '(生成失敗)';
  } catch (e) {
    defInput.value = '';
    alert('AI 生成失敗（請確認 Ollama 有在執行）：' + e.message);
  }
}

async function aiGenerateSentence(wordInputId, sentenceInputId) {
  var word = document.getElementById(wordInputId).value.trim();
  if (!word) return alert('請先輸入英文單字');
  var senInput = document.getElementById(sentenceInputId);
  senInput.value = '生成中...';

  // 收集已有的例句，告訴模型不要重複
  var existing = [];
  var prefix = sentenceInputId.replace(/\d$/, '');
  for (var i = 1; i <= 3; i++) {
    var el = document.getElementById(prefix + i);
    if (el && el.value && el.value !== '生成中...' && el !== senInput) {
      existing.push(el.value.trim());
    }
  }
  var avoidText = '';
  if (existing.length > 0) {
    avoidText = '\n\nDo NOT use these sentences (already used):\n- ' + existing.join('\n- ') + '\n\nWrite a DIFFERENT sentence:';
  }

  // 隨機選一個難度等級（4歲到8歲）
  var levels = [
    { age: 4, ex: 'I like the red ball.' },
    { age: 5, ex: 'The cat is sleeping on the sofa.' },
    { age: 6, ex: 'We went to the park after school.' },
    { age: 7, ex: 'My sister always reads a book before bed.' },
    { age: 8, ex: 'The dog was so happy when we came home.' }
  ];
  var level = levels[Math.floor(Math.random() * levels.length)];

  // 取得詞性和中文意思
  var posEl = document.getElementById('newPos') || document.getElementById('editPos');
  var posHint = posEl && posEl.value ? ' (used as ' + posEl.value + ')' : '';
  var meaningEl = document.getElementById('newMeaning') || document.getElementById('editMeaning');
  var meaningHint = meaningEl && meaningEl.value ? ' (meaning: ' + meaningEl.value.trim() + ')' : '';

  try {
    var text = await ollamaGenerate(
      "You are a children's picture book author. Write one English sentence using the word '" + word + "'" + posHint + meaningHint + " for a " + level.age + "-year-old child.\n\nIMPORTANT RULES:\n- The sentence must describe something that REALLY happens in the real world\n- Animals can only do what real animals do (eat, sleep, run, fly)\n- Objects can only be described by their real properties (color, size, location)\n- Do NOT make animals talk, go to school, or have human friends\n- Do NOT write fantasy or fairy tale sentences\n- Keep it under 10 words\n- Return ONLY the sentence\n\nGood examples:\n- chicken: I had chicken and rice for lunch.\n- dog: The dog is playing in the yard.\n- fast: She can run very fast.\n- beautiful: The flowers in the garden are beautiful.\n\nBad examples (NEVER write like this):\n- The chicken played with his best friend. (WRONG: chickens don't have friends)\n- The fast went to the store. (WRONG: grammatically incorrect)" + avoidText + "\n\nWord: " + word + "\nSentence:"
    );
    text = text.replace(/^["'\s]+|["'\s]+$/g, '').split('\n')[0];
    senInput.value = text || '(生成失敗)';
  } catch (e) {
    senInput.value = '';
    alert('例句生成失敗（請確認 Ollama 有在執行）：' + e.message);
  }
}

// ===== 圖片搜尋 =====
const PIXABAY_KEY = '55343360-32689ce0eb7144b69e7844579';
let currentImageTarget = null;

async function searchImages(wordInputId, resultsContainerId, targetInputId) {
  const word = document.getElementById(wordInputId).value.trim();
  if (!word) return alert('請先輸入英文單字');
  currentImageTarget = targetInputId || null;
  const container = document.getElementById(resultsContainerId);
  container.hidden = false;
  container.innerHTML = '<div class="image-search-loading">搜尋中...</div>';
  try {
    const url = `https://pixabay.com/api/?key=${PIXABAY_KEY}&q=${encodeURIComponent(word)}&image_type=photo&per_page=12&safesearch=true`;
    const res = await fetch(url);
    const data = await res.json();
    if (!data.hits || data.hits.length === 0) { container.innerHTML = '<div class="image-search-loading">找不到圖片</div>'; return; }
    container.innerHTML = data.hits.map(hit =>
      `<div class="image-search-item" data-url="${hit.webformatURL}" onclick="selectSearchImage(this, '${resultsContainerId}')"><img src="${hit.previewURL}" alt="${esc(hit.tags)}" loading="lazy" /></div>`
    ).join('');
  } catch (err) { container.innerHTML = '<div class="image-search-loading">搜尋失敗</div>'; }
}

function selectSearchImage(el, resultsContainerId) {
  el.parentElement.querySelectorAll('.image-search-item').forEach(i => i.classList.remove('selected'));
  el.classList.add('selected');
  const pixabayUrl = el.dataset.url;

  // 自動轉存到 Firebase Storage
  if (currentImageTarget) {
    const targetInput = document.getElementById(currentImageTarget);
    if (currentImageTarget === 'editNewImgUrl') {
      // 編輯模式：加入新的圖片行
      targetInput.value = '上傳中...';
      uploadPixabayImage(pixabayUrl, 'img').then(function(firebaseUrl) {
        targetInput.value = '';
        addEditImageRow(firebaseUrl);
      });
    } else {
      targetInput.value = '上傳中...';
      targetInput.style.color = '#FF9800';
      uploadPixabayImage(pixabayUrl, targetInput.id || 'img').then(function(firebaseUrl) {
        targetInput.value = firebaseUrl;
        if (firebaseUrl.includes('firebasestorage')) {
          targetInput.style.color = '#4CAF50';
        } else {
          targetInput.style.color = '#f44336';
        }
        setTimeout(function() { targetInput.style.color = ''; }, 3000);
      });
    }
  }

  const previewId = resultsContainerId === 'imageSearchResults' ? 'imagePreview' : 'examImagePreview';
  const preview = document.getElementById(previewId);
  if (preview) {
    const img = document.createElement('img');
    img.src = pixabayUrl; img.alt = '預覽'; img.style.cssText = 'max-height:80px;border-radius:8px;margin:4px;';
    preview.appendChild(img); preview.hidden = false;
  }
}

// ===== 單字管理 =====
function handleImageUpload(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    localImageData = ev.target.result;
    const preview = document.getElementById('imagePreview');
    preview.innerHTML = `<img src="${localImageData}" alt="預覽" />`; preview.hidden = false;
  };
  reader.readAsDataURL(file);
}

function handleExamImageUpload(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    examLocalImageData = ev.target.result;
    const preview = document.getElementById('examImagePreview');
    preview.innerHTML = `<img src="${examLocalImageData}" alt="預覽" />`; preview.hidden = false;
  };
  reader.readAsDataURL(file);
}

function parseTags(str) {
  return str.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
}

// 標籤選擇系統
async function loadTagDropdown(dropdownId) {
  var tags = await getAllTags();
  var dd = document.getElementById(dropdownId);
  if (!dd) return;
  dd.innerHTML = '<option value="">選擇標籤...</option>';
  tags.forEach(function(t) {
    dd.innerHTML += '<option value="' + esc(t) + '">' + esc(t) + '</option>';
  });
}

function addTagFromDropdown(dropdownId, hiddenId, chipsId) {
  var dd = document.getElementById(dropdownId);
  var tag = dd.value.trim().toLowerCase();
  dd.value = '';
  if (!tag) return;
  addTagToChips(tag, hiddenId, chipsId);
}

function addManualTag(inputId, hiddenId, chipsId) {
  var input = document.getElementById(inputId);
  var tag = input.value.trim().toLowerCase();
  input.value = '';
  if (!tag) return;
  addTagToChips(tag, hiddenId, chipsId);
}

function addTagToChips(tag, hiddenId, chipsId) {
  var hidden = document.getElementById(hiddenId);
  var current = parseTags(hidden.value);
  if (current.indexOf(tag) !== -1) return; // 已存在
  current.push(tag);
  hidden.value = current.join(', ');
  renderTagChips(hiddenId, chipsId);
}

function removeTagChip(tag, hiddenId, chipsId) {
  var hidden = document.getElementById(hiddenId);
  var current = parseTags(hidden.value);
  current = current.filter(function(t) { return t !== tag; });
  hidden.value = current.join(', ');
  renderTagChips(hiddenId, chipsId);
}

function renderTagChips(hiddenId, chipsId) {
  var hidden = document.getElementById(hiddenId);
  var chips = document.getElementById(chipsId);
  if (!chips) return;
  var current = parseTags(hidden.value);
  chips.innerHTML = current.map(function(t) {
    return '<span class="tag-chip">' + esc(t) + '<button class="tag-chip-x" onclick="removeTagChip(\'' + esc(t) + '\',\'' + hiddenId + '\',\'' + chipsId + '\')">✕</button></span>';
  }).join('');
}

async function addWord() {
  const word    = document.getElementById('newWord').value.trim();
  const meaning = document.getElementById('newMeaning').value.trim();
  if (!word || !meaning) return alert('請輸入單字和中文意思');
  const pos = document.getElementById('newPos').value;
  const antonym = document.getElementById('newAntonym').value.trim();
  const definition = document.getElementById('newDefinition').value.trim();
  const tags = parseTags(document.getElementById('newTags').value);
  const sentences = [
    document.getElementById('newSentence1').value.trim(),
    document.getElementById('newSentence2').value.trim(),
    document.getElementById('newSentence3').value.trim(),
  ].filter(Boolean);
  const images = [
    document.getElementById('newImageUrl1').value.trim(),
    document.getElementById('newImageUrl2').value.trim(),
    document.getElementById('newImageUrl3').value.trim(),
  ].filter(Boolean);
  if (localImageData) images.push(localImageData);
  await dbAdd('words', { word, meaning, pos, antonym, definition, tags, sentences, images, imageUrl: null, imageLocal: null, pool: 'permanent', createdAt: Date.now() });
  ['newWord','newMeaning','newTags','newAntonym','newDefinition','newSentence1','newSentence2','newSentence3','newImageUrl1','newImageUrl2','newImageUrl3'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('newPos').value = '';
  document.getElementById('imagePreview').innerHTML = '';
  document.getElementById('imagePreview').hidden = true;
  document.getElementById('imageSearchResults').hidden = true;
  localImageData = null;
  renderWordList();
}

async function renderWordList() {
  let words = await dbGetByIndex('words', 'pool', 'permanent');
  // 字母排序
  words.sort((a, b) => a.word.toLowerCase().localeCompare(b.word.toLowerCase()));
  const search = (document.getElementById('wordSearch')?.value || '').toLowerCase();
  const filter = document.getElementById('wordFilter')?.value || 'all';
  const posF   = document.getElementById('posFilter')?.value || 'all';
  const tagF   = document.getElementById('tagFilter')?.value || 'all';

  let filtered = words;
  if (search) filtered = filtered.filter(w => w.word.toLowerCase().includes(search) || w.meaning.includes(search));
  if (filter === 'no-image') filtered = filtered.filter(w => getAllImages(w).length === 0);
  if (filter === 'no-sentence') filtered = filtered.filter(w => !w.sentences || w.sentences.length === 0);
  if (posF === 'none') filtered = filtered.filter(w => !w.pos);
  else if (posF !== 'all') filtered = filtered.filter(w => w.pos === posF);
  if (tagF !== 'all') filtered = filtered.filter(w => w.tags && w.tags.includes(tagF));

  // 更新標籤下拉
  const tagSelect = document.getElementById('tagFilter');
  if (tagSelect) {
    const allTags = await getAllTags();
    const currentVal = tagSelect.value;
    tagSelect.innerHTML = '<option value="all">所有標籤</option>' + allTags.map(t => `<option value="${t}" ${t === currentVal ? 'selected' : ''}>${t}</option>`).join('');
  }

  // 更新計數
  const countEl = document.getElementById('wordCount');
  if (countEl) countEl.textContent = `(${filtered.length}/${words.length})`;

  const el = document.getElementById('wordList');
  el.innerHTML = filtered.map(w => {
    const hasImg = getAllImages(w).length > 0;
    const hasSen = w.sentences && w.sentences.length > 0;
    const posLabel = w.pos ? `<span class="word-pos">${esc(w.pos)}</span>` : '';
    const tags   = (w.tags || []).map(t => `<span class="word-tag">${esc(t)}</span>`).join('');
    return `
    <div class="word-item">
      <div class="word-item-info">
        <div class="word-item-word">${esc(w.word)} ${posLabel}</div>
        <div class="word-item-meaning">${esc(w.meaning)}${w.antonym ? ' ↔ ' + esc(w.antonym) : ''}</div>
        ${tags ? `<div class="word-item-tags">${tags}</div>` : ''}
      </div>
      <div class="word-item-icons">
        ${hasImg ? '📷' : ''}${hasSen ? '📝' : ''}
      </div>
      <div class="word-item-actions">
        <button class="btn-sm" onclick="editWord(${w.id})">✏️</button>
        <button class="btn-sm btn-red" onclick="deleteWord(${w.id})">🗑️</button>
      </div>
    </div>`;
  }).join('') || '<p style="color:#999;text-align:center;padding:20px;">還沒有單字，快來新增吧！</p>';
}

function getWordImage(w) {
  const src = getImageSrc(w);
  if (src) return `<img class="word-item-img" src="${esc(src)}" alt="${esc(w.word)}" onerror="this.style.display='none'" />`;
  return '<div class="word-item-img" style="display:flex;align-items:center;justify-content:center;font-size:1.5em;">📖</div>';
}

async function deleteWord(id) {
  if (!confirm('確定刪除？')) return;
  await dbDelete('words', id); await dbDelete('progress', id);
  renderWordList();
}

async function editWord(id) {
  const w = await dbGet('words', id); if (!w) return;
  const imgs = getAllImages(w);
  const sentences = w.sentences || [];
  const tags = (w.tags || []).join(', ');
  const modal = document.getElementById('modal-edit');
  modal.innerHTML = `
    <div class="modal-content" style="max-width:520px;max-height:90vh;overflow-y:auto;">
      <h3>編輯單字</h3>
      <div class="form-row">
        <input id="editWord" type="text" placeholder="英文單字" value="${esc(w.word)}" />
        <input id="editMeaning" type="text" placeholder="中文意思" value="${esc(w.meaning)}" />
      </div>
      <div class="form-row">
        <select id="editPos">
          <option value="">詞性</option>
          <option value="noun" ${w.pos==='noun'?'selected':''}>名詞</option>
          <option value="verb" ${w.pos==='verb'?'selected':''}>動詞</option>
          <option value="adj" ${w.pos==='adj'?'selected':''}>形容詞</option>
          <option value="adv" ${w.pos==='adv'?'selected':''}>副詞</option>
          <option value="prep" ${w.pos==='prep'?'selected':''}>介系詞</option>
          <option value="other" ${w.pos==='other'?'selected':''}>其他</option>
        </select>
        <input id="editAntonym" type="text" placeholder="反義詞（選填）" value="${esc(w.antonym||'')}" />
      </div>
      <div class="form-row">
        <input id="editDefinition" type="text" placeholder="英英解釋（選填）" value="${esc(w.definition||'')}" />
        <button class="btn-upload" type="button" onclick="aiGenerateDefinition('editWord','editDefinition')">🤖 AI生成</button>
      </div>
      <div class="form-row">
        <select id="editTagDropdown" onchange="addTagFromDropdown('editTagDropdown','editTags','editTagChips')"><option value="">選擇標籤...</option></select>
        <input id="editTagManual" type="text" placeholder="新標籤" style="flex:1;" />
        <button class="btn-upload" type="button" onclick="addManualTag('editTagManual','editTags','editTagChips')">＋</button>
      </div>
      <input type="hidden" id="editTags" value="${esc(tags)}" />
      <div class="tag-chips" id="editTagChips"></div>
      <div class="form-row"><input id="editSentence1" type="text" placeholder="例句 1" value="${esc(sentences[0]||'')}" /><button class="btn-upload" type="button" onclick="aiGenerateSentence('editWord','editSentence1')">🤖</button></div>
      <div class="form-row"><input id="editSentence2" type="text" placeholder="例句 2" value="${esc(sentences[1]||'')}" /><button class="btn-upload" type="button" onclick="aiGenerateSentence('editWord','editSentence2')">🤖</button></div>
      <div class="form-row"><input id="editSentence3" type="text" placeholder="例句 3" value="${esc(sentences[2]||'')}" /><button class="btn-upload" type="button" onclick="aiGenerateSentence('editWord','editSentence3')">🤖</button></div>
      <div style="margin-bottom:8px;font-weight:600;">圖片</div>
      <div id="editImagesContainer">
        ${imgs.map(img => `<div class="form-row edit-img-row"><input type="text" class="edit-img-url" value="${esc(img)}" style="flex:1;" /><button class="btn-sm btn-red" onclick="this.parentElement.remove()">✕</button></div>`).join('')}
      </div>
      <div class="form-row">
        <button class="btn-sm" onclick="addEditImageRow()">＋ 新增圖片</button>
        <button class="btn-sm" onclick="searchImages('editWord','editImageSearchResults','editNewImgUrl')">🔍 搜圖</button>
        <label class="btn-upload">📷 上傳<input type="file" accept="image/*" onchange="handleEditImageUpload(event)" hidden /></label>
      </div>
      <div id="editImageSearchResults" class="image-search-results" hidden></div>
      <input type="hidden" id="editNewImgUrl" />
      <div id="editImagePreview" class="image-preview" style="display:flex;gap:6px;flex-wrap:wrap;">
        ${imgs.map(img => `<img src="${img}" style="max-height:60px;border-radius:6px;" onerror="this.style.display='none'" />`).join('')}
      </div>
      <div style="display:flex;gap:8px;margin-top:12px;">
        <button class="btn-primary" onclick="saveEditWord(${w.id})">儲存</button>
        <button class="btn-ghost" onclick="hideModal('modal-edit')">取消</button>
      </div>
    </div>`;
  modal.hidden = false;
  loadTagDropdown('editTagDropdown');
  renderTagChips('editTags', 'editTagChips');
}

function addEditImageRow(url) {
  const c = document.getElementById('editImagesContainer');
  const d = document.createElement('div'); d.className = 'form-row edit-img-row';
  d.innerHTML = '<input type="text" class="edit-img-url" placeholder="圖片 URL" style="flex:1;" value="' + (url ? esc(url) : '') + '" /><button class="btn-sm btn-red" onclick="this.parentElement.remove()">✕</button>';
  c.appendChild(d);
}

function handleEditImageUpload(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    const c = document.getElementById('editImagesContainer');
    const d = document.createElement('div'); d.className = 'form-row edit-img-row';
    d.innerHTML = `<input type="text" class="edit-img-url" value="${ev.target.result}" style="flex:1;" readonly /><button class="btn-sm btn-red" onclick="this.parentElement.remove()">✕</button>`;
    c.appendChild(d);
    const img = document.createElement('img');
    img.src = ev.target.result; img.style.cssText = 'max-height:60px;border-radius:6px;';
    document.getElementById('editImagePreview').appendChild(img);
  };
  reader.readAsDataURL(file);
}

async function saveEditWord(id) {
  const w = await dbGet('words', id); if (!w) return;
  w.word = document.getElementById('editWord').value.trim() || w.word;
  w.meaning = document.getElementById('editMeaning').value.trim() || w.meaning;
  w.pos = document.getElementById('editPos').value;
  w.antonym = document.getElementById('editAntonym').value.trim();
  w.definition = document.getElementById('editDefinition').value.trim();
  w.tags = parseTags(document.getElementById('editTags').value);
  w.sentences = ['editSentence1','editSentence2','editSentence3'].map(i => document.getElementById(i).value.trim()).filter(Boolean);
  w.images = Array.from(document.querySelectorAll('#editImagesContainer .edit-img-url')).map(i => i.value.trim()).filter(Boolean);
  w.imageUrl = null; w.imageLocal = null;
  await dbPut('words', w);
  hideModal('modal-edit');
  renderWordList();
  if (typeof renderExamWordList === 'function') renderExamWordList();
}

// ===== 考試包管理 =====
async function addExam() {
  const name = document.getElementById('examName').value.trim();
  const date = document.getElementById('examDate').value;
  if (!name) return alert('請輸入主題名稱');
  await dbAdd('exams', { name, examDate: date || null, createdAt: Date.now() });
  document.getElementById('examName').value = ''; document.getElementById('examDate').value = '';
  renderExamList();
}
async function renderExamList() {
  const exams = await dbGetAll('exams');
  const counts = {}; const allWords = await dbGetAll('words');
  allWords.forEach(w => { if (w.pool && w.pool.startsWith('exam-')) { const eid = parseInt(w.pool.replace('exam-','')); counts[eid] = (counts[eid]||0)+1; } });
  document.getElementById('examList').innerHTML = exams.map(ex => `
    <div class="exam-item" onclick="openExam(${ex.id})">
      <div class="exam-item-icon">📝</div>
      <div class="exam-item-info"><div class="exam-item-name">${esc(ex.name)}</div><div class="exam-item-meta">${counts[ex.id]||0} 個單字${ex.examDate?' · 考試日 '+ex.examDate:''}</div></div>
      <button class="btn-sm btn-red" onclick="event.stopPropagation();deleteExam(${ex.id})">🗑️</button>
    </div>`).join('') || '<p style="color:#999;text-align:center;padding:20px;">還沒有考試包</p>';
}
async function openExam(id) {
  currentExamId = id;
  document.getElementById('examDetailTitle').textContent = (await dbGet('exams', id)).name;
  goTo('page-exam-detail'); renderExamWordList();
}
async function renderExamWordList() {
  const words = await dbGetByIndex('words', 'pool', 'exam-' + currentExamId);
  document.getElementById('examWordList').innerHTML = words.map(w => `
    <div class="word-item">
      ${getWordImage(w)}
      <div class="word-item-info"><div class="word-item-word">${esc(w.word)}</div><div class="word-item-meaning">${esc(w.meaning)}</div></div>
      <button class="btn-sm" onclick="editWord(${w.id})">✏️</button>
      <button class="btn-sm btn-red" onclick="deleteExamWord(${w.id})">🗑️</button>
    </div>`).join('') || '<p style="color:#999;text-align:center;padding:20px;">還沒有單字</p>';
}
async function addExamWord() {
  const word = document.getElementById('examNewWord').value.trim();
  const meaning = document.getElementById('examNewMeaning').value.trim();
  if (!word || !meaning) return alert('請輸入單字和中文意思');
  const sentence = document.getElementById('examNewSentence1').value.trim();
  const imageUrl = document.getElementById('examNewImageUrl').value.trim();
  const images = []; if (imageUrl) images.push(imageUrl); if (examLocalImageData) images.push(examLocalImageData);
  await dbAdd('words', { word, meaning, tags: [], sentences: sentence?[sentence]:[], images, imageUrl:null, imageLocal:null, pool:'exam-'+currentExamId, createdAt:Date.now() });
  ['examNewWord','examNewMeaning','examNewSentence1','examNewImageUrl'].forEach(id => { document.getElementById(id).value=''; });
  document.getElementById('examImagePreview').hidden = true; examLocalImageData = null;
  renderExamWordList();
}
async function deleteExamWord(id) { if (!confirm('確定刪除？')) return; await dbDelete('words',id); renderExamWordList(); }
async function deleteExam(id) {
  if (!confirm('確定刪除此考試包？')) return;
  const words = await dbGetByIndex('words','pool','exam-'+id);
  for (const w of words) await dbDelete('words',w.id);
  await dbDelete('exams',id); renderExamList();
}
async function graduateExam() {
  if (!confirm('將此考試包的所有單字移到永久單字庫？')) return;
  const words = await dbGetByIndex('words','pool','exam-'+currentExamId);
  for (const w of words) { w.pool='permanent'; await dbPut('words',w); }
  alert(`已將 ${words.length} 個單字移到永久庫！`); renderExamWordList();
}

// ===== 匯出匯入 =====
function showImportExport() { document.getElementById('modal-import').hidden = false; }
function hideModal(id) { document.getElementById(id).hidden = true; }
async function exportAllData() {
  const data = { words: await dbGetAll('words'), exams: await dbGetAll('exams'), progress: await dbGetAll('progress'), exportedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
  const url = URL.createObjectURL(blob); const a = document.createElement('a');
  a.href = url; a.download = 'word-learner-backup.json'; a.click(); URL.revokeObjectURL(url);
}
async function importAllData(e) {
  const file = e.target.files[0]; if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.words) for (const w of data.words) { delete w.id; await dbAdd('words',w); }
    if (data.exams) for (const ex of data.exams) { delete ex.id; await dbAdd('exams',ex); }
    if (data.progress) for (const p of data.progress) await dbPut('progress',p);
    alert('匯入成功！'); hideModal('modal-import'); renderWordList();
  } catch (err) { alert('匯入失敗：'+err.message); }
}

// ===== 工具函式 =====
function shuffleArray(arr) {
  const a=[...arr]; for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a;
}
function esc(s) { const d=document.createElement('div'); d.textContent=s; return d.innerHTML; }
function getAllImages(w) {
  const imgs=[]; if(w.images&&w.images.length>0) w.images.forEach(i=>{if(i)imgs.push(i);}); if(w.imageUrl)imgs.push(w.imageUrl); if(w.imageLocal)imgs.push(w.imageLocal); return[...new Set(imgs)];
}
function getImageSrc(w) { const imgs=getAllImages(w); return imgs.length>0?imgs[0]:''; }
function getRandomImage(w) { const imgs=getAllImages(w); return imgs.length===0?'':imgs[Math.floor(Math.random()*imgs.length)]; }
function speakWord(word, rate=0.8) { const u=new SpeechSynthesisUtterance(word); u.lang='en-US'; u.rate=rate; speechSynthesis.speak(u); }
function getRandomSentence(w) { if(!w.sentences||w.sentences.length===0)return null; return w.sentences[Math.floor(Math.random()*w.sentences.length)]; }
function parseTags(str) { return str.split(',').map(t=>t.trim().toLowerCase()).filter(Boolean); }

// ===== 每日挑戰 =====
function getTodayStr() { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
async function getDailyData() { return(await dbGet('settings','daily'))||{key:'daily',completedDates:[],streak:0,lastDate:null}; }
async function saveDailyData(data) { data.key='daily'; await dbPut('settings',data); }
async function getCoins() { return(await dbGet('settings','coins'))||{key:'coins',boy:0,girl:0,log:[]}; }
async function saveCoins(data) { data.key='coins'; await dbPut('settings',data); }
function startDailyChallenge() { goTo('page-daily-pick'); }
function startDailyWithRole(role) {
  dailyRole = role;
  startDailyMix(role);
}

async function startDailyMix(role) {
  var words = await getDueWords('permanent');
  if (words.length < 4) words = await dbGetByIndex('words', 'pool', 'permanent');
  if (words.length < 4) { alert('單字不夠，至少需要 4 個！'); return; }
  words = shuffleArray(words);

  // 題目組合
  var plan;
  if (role === 'boy') {
    // 小男孩：看字選圖x4, 探照燈x4, 動物園x2 = 10題
    plan = [
      'listen','listen','listen','listen',
      'flashlight','flashlight','flashlight','flashlight',
      'echo','echo'
    ];
  } else {
    // 小女孩：看字選圖x5, 拼字x2, 句子排列x2, 看圖說句x1 = 10題
    plan = [
      'listen','listen','listen','listen','listen',
      'spelling','spelling',
      'fillblank','fillblank',
      'speak'
    ];
  }
  plan = shuffleArray(plan);

  goTo('page-game');
  document.getElementById('gameTitle').textContent = (role === 'boy' ? '👦' : '👧') + ' 每日挑戰';
  document.getElementById('gameScore').textContent = '';
  var area = document.getElementById('gameArea');
  area.innerHTML = '';

  var current = 0, correct = 0, total = plan.length;
  var usedWords = [];

  function nextMixQuestion() {
    if (current >= total) {
      showResult(correct, total);
      return;
    }
    var gameType = plan[current];
    // 取一個還沒用過的單字
    var available = words.filter(function(w) { return usedWords.indexOf(w.id) === -1; });
    if (available.length < 4) { available = words; usedWords = []; }
    var target = available[0];
    usedWords.push(target.id);
    var others = shuffleArray(words.filter(function(w) { return w.id !== target.id; })).slice(0, 3);
    var options = shuffleArray([target].concat(others));

    document.getElementById('gameScore').textContent = (current + 1) + '/' + total;

    // 根據題型渲染單題
    switch (gameType) {
      case 'listen':
        renderMixListen(area, target, options, role === 'boy' ? 'baby' : 'kid', onAnswer);
        break;
      case 'flashlight':
        renderMixFlashlight(area, target, onAnswer);
        break;
      case 'echo':
        renderMixEcho(area, target, words, onAnswer);
        break;
      case 'spelling':
        renderMixSpelling(area, target, onAnswer);
        break;
      case 'fillblank':
        renderMixFillblank(area, target, words, onAnswer);
        break;
      case 'speak':
        renderMixSpeak(area, target, onAnswer);
        break;
    }

    function onAnswer(isCorrect) {
      if (isCorrect) correct++;
      updateProgress(target.id, isCorrect);
      document.getElementById('gameScore').textContent = correct + '/' + (current + 1);
      current++;
      setTimeout(nextMixQuestion, 1500);
    }
  }
  nextMixQuestion();
}

// === 每日挑戰單題渲染器 ===
function renderMixListen(area, target, options, mode, cb) {
  if (mode === 'baby') {
    var img;
    var html = '<div class="baby-layout"><div class="baby-left">' +
      '<div class="baby-word">' + esc(target.word) + '</div>' +
      '<button class="baby-speak" onclick="speakWord(\'' + esc(target.word) + '\',0.6)">🔊</button>' +
      '</div><div class="baby-grid">';
    options.forEach(function(o) {
      img = getRandomImage(o);
      html += '<button class="baby-cell" data-id="' + o.id + '">' +
        (img ? '<img src="' + img + '" alt="' + esc(o.meaning) + '">' : '<span class="baby-fallback">' + esc(o.meaning) + '</span>') +
        '</button>';
    });
    html += '</div></div>';
    area.innerHTML = html;
    setTimeout(function() { speakWord(target.word, 0.6); }, 300);
    area.querySelectorAll('.baby-cell img').forEach(function(i) {
      i.onerror = function() { var s = document.createElement('span'); s.className='baby-fallback'; s.textContent=i.alt; i.parentElement.replaceChild(s,i); };
    });
  } else {
    var timg = getRandomImage(target);
    var html = '<div class="kid-layout"><div class="kid-top">' +
      (timg ? '<img class="kid-image" src="' + timg + '">' : '<div class="kid-image kid-noimg">' + esc(target.meaning) + '</div>') +
      '<button class="kid-speak" onclick="speakWord(\'' + esc(target.word) + '\',0.7)">🔊</button>' +
      '</div><div class="kid-opts">';
    options.forEach(function(o) {
      html += '<button class="kid-opt" data-id="' + o.id + '">' + esc(o.word) + '</button>';
    });
    html += '</div></div>';
    area.innerHTML = html;
  }
  var sel = mode === 'baby' ? '.baby-cell' : '.kid-opt';
  area.querySelectorAll(sel).forEach(function(btn) {
    btn.addEventListener('click', function() {
      var ok = parseInt(btn.dataset.id) === target.id;
      btn.classList.add(ok ? 'correct' : 'wrong');
      if (!ok) { var r = area.querySelector(sel + '[data-id="' + target.id + '"]'); if (r) r.classList.add('correct'); }
      speakWord(target.word);
      area.querySelectorAll(sel).forEach(function(b) { b.style.pointerEvents = 'none'; });
      cb(ok);
    });
  });
}

function renderMixFlashlight(area, target, cb) {
  var img = getRandomImage(target);
  if (!img) { cb(true); return; }
  area.innerHTML = '<div class="fl-container">' +
    '<div class="fl-scene" id="flScene"><img class="fl-image" src="' + img + '"><div class="fl-dark" id="flDark"></div></div>' +
    '<div class="fl-info"><div class="fl-hint">滑動探照，雙擊揭曉</div>' +
    '<div class="fl-word" id="flWord" style="visibility:hidden;">' + esc(target.word) + '</div></div></div>';
  var scene = document.getElementById('flScene');
  var dark = document.getElementById('flDark');
  var revealed = false, lastTap = 0;
  function mv(cx, cy) {
    if (revealed) return;
    var r = scene.getBoundingClientRect();
    dark.style.maskImage = 'radial-gradient(circle 70px at ' + (cx-r.left) + 'px ' + (cy-r.top) + 'px, transparent 60px, black 80px)';
    dark.style.webkitMaskImage = dark.style.maskImage;
  }
  scene.addEventListener('touchmove', function(e) { e.preventDefault(); mv(e.touches[0].clientX, e.touches[0].clientY); }, {passive:false});
  scene.addEventListener('mousemove', function(e) { mv(e.clientX, e.clientY); });
  function rev() {
    if (revealed) return; revealed = true;
    dark.classList.add('fl-reveal');
    document.getElementById('flWord').style.visibility = 'visible';
    document.getElementById('flWord').classList.add('fl-word-show');
    speakWord(target.word, 0.6);
    cb(true);
  }
  scene.addEventListener('touchend', function() { var n=Date.now(); if(n-lastTap<400) rev(); lastTap=n; });
  scene.addEventListener('dblclick', rev);
}

function renderMixEcho(area, target, words, cb) {
  var img = getRandomImage(target);
  area.innerHTML = '<div class="zoo-container"><div class="zoo-left"><div class="zoo-lion-wrap">' +
    '<img class="zoo-lion" id="zooLion" src="./images/lion-sleep.png"><div class="zoo-zzz" id="zooZzz">💤</div></div>' +
    '<div class="zoo-status" id="zooStatus">恐龍在睡覺...</div></div>' +
    '<div class="zoo-right">' + (img ? '<img class="zoo-word-img" src="' + img + '">' : '') +
    '<div class="zoo-word">' + esc(target.word) + '</div>' +
    '<button class="zoo-listen" onclick="speakWord(\'' + esc(target.word) + '\',0.6)">🔊</button>' +
    '<button class="zoo-mic" id="zooMic">🎙️</button>' +
    '<div class="zoo-feedback" id="zooFeedback"></div></div></div>';
  setTimeout(function() { speakWord(target.word, 0.6); }, 400);
  var mic = document.getElementById('zooMic'), done = false;
  mic.addEventListener('click', function() {
    if (done) return;
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { cb(false); return; }
    var r = new SR(); r.lang='en-US'; r.interimResults=false; r.maxAlternatives=5;
    mic.textContent='🔴'; mic.classList.add('recording');
    document.getElementById('zooLion').src='./images/lion-listen.jpeg';
    r.onresult = function(e) {
      var found=false;
      for(var i=0;i<e.results[0].length;i++) if(e.results[0][i].transcript.toLowerCase().indexOf(target.word.toLowerCase())!==-1){found=true;break;}
      mic.textContent='🎙️'; mic.classList.remove('recording');
      if(found){done=true;document.getElementById('zooZzz').style.display='none';document.getElementById('zooLion').src='./images/lion-dance.png';document.getElementById('zooLion').classList.add('zoo-dance');document.getElementById('zooStatus').textContent='恐龍醒來了！🎉';}
      else{document.getElementById('zooLion').src='./images/lion-sleep.png';document.getElementById('zooStatus').textContent='再試一次？';}
      if(found) cb(true);
    };
    r.onerror=function(){mic.textContent='🎙️';mic.classList.remove('recording');};
    r.start();
  });
  // 10秒超時
  setTimeout(function() { if(!done){done=true;cb(false);} }, 15000);
}

function renderMixSpelling(area, target, cb) {
  initSpellingGame.__singleMode = { target: target, cb: cb };
  initSpellingGame(area, [target, target, target, target]);
}

function renderMixFillblank(area, target, words, cb) {
  if (!target.sentences || target.sentences.length === 0) { cb(false); return; }
  initFillBlankGame.__singleMode = { target: target, cb: cb };
  initFillBlankGame(area, [target, target, target, target]);
}

function renderMixSpeak(area, target, cb) {
  initSpeakGame.__singleMode = { target: target, cb: cb };
  initSpeakGame(area, [target, target, target, target]);
}

// ===== 金幣庫 =====
async function renderCoinPage() {
  const daily = await getDailyData(); const coins = await getCoins();
  document.getElementById('coinSummary').innerHTML = `
    <div class="coin-card"><div class="coin-card-icon">👦🥇</div><div class="coin-card-count">${coins.boy}</div><div class="coin-card-label">小男生金幣</div><button class="btn-redeem" onclick="redeemCoins('boy')">💰 領錢</button></div>
    <div class="coin-card"><div class="coin-card-icon">👧💎</div><div class="coin-card-count">${coins.girl}</div><div class="coin-card-label">小女生金幣</div><button class="btn-redeem" onclick="redeemCoins('girl')">💰 領錢</button></div>`;
  renderCalendar(daily.completedDates);
  const logEl = document.getElementById('coinLog');
  if (coins.log.length===0) { logEl.innerHTML='<p style="color:#999;text-align:center;padding:20px;">還沒有金幣紀錄</p>'; }
  else { logEl.innerHTML=[...coins.log].reverse().map(l=>`<div class="coin-log-item"><div class="coin-log-date">${l.date}</div><div class="coin-log-icon">${l.role==='boy'?'👦🥇':'👧💎'}</div><div class="coin-log-text">${l.redeemed?'已領取 '+l.redeemed+' 金幣':'+'+l.count+' 金幣'}</div></div>`).join(''); }
}
async function redeemCoins(role) {
  const coins = await getCoins(); const amount = role==='boy'?coins.boy:coins.girl;
  if (amount===0) { alert('沒有金幣可以領！'); return; }
  if (!confirm(`確定要領取 ${role==='boy'?'👦':'👧'} 的 ${amount} 個金幣嗎？`)) return;
  coins.log.push({role,count:0,date:getTodayStr(),redeemed:amount});
  if(role==='boy')coins.boy=0;else coins.girl=0;
  await saveCoins(coins); renderCoinPage();
}
function renderCalendar(completedDates) {
  const now=new Date(),year=now.getFullYear(),month=now.getMonth();
  const firstDay=new Date(year,month,1).getDay(),daysInMonth=new Date(year,month+1,0).getDate(),today=now.getDate();
  const mN=['一月','二月','三月','四月','五月','六月','七月','八月','九月','十月','十一月','十二月'];
  let h=`<h3 style="margin-bottom:8px;">${mN[month]} ${year}</h3><div class="calendar-grid">`;
  ['日','一','二','三','四','五','六'].forEach(d=>{h+=`<div class="calendar-header">${d}</div>`;});
  for(let i=0;i<firstDay;i++)h+='<div class="calendar-day empty"></div>';
  for(let d=1;d<=daysInMonth;d++){
    const ds=`${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const boy=completedDates.includes('boy-'+ds),girl=completedDates.includes('girl-'+ds);
    let cls='calendar-day';if(boy||girl)cls+=' completed';if(d===today)cls+=' today';
    h+=`<div class="${cls}">${(boy?'🥇':'')+(girl?'💎':'')||d}</div>`;
  }
  h+='</div>';document.getElementById('calendarSection').innerHTML=h;
}

// 初始化由 db.js 處理
