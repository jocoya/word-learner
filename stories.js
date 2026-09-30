// ===== 睡前故事（一鍵版）=====
// 流程：按「今天的故事」→ 自動挑 3–5 個「今天學過 / 到期 / 最近在鞏固」的字
//       → 本地 LLM 只寫文字（5 頁，每頁用 1 個重點字）→ 每頁用該單字現有的圖片 → 朗讀
// 互動：每頁念完後點「重點字的圖片」，點對算一次複習（寫 FSRS，Good）
// 不生圖、不需 SwarmUI；故事文字存本機 IndexedDB 'stories'，可重讀或刪除

var STORY_PAGES = 5;
var STORY_WORDS = 5;

var storyViewing = null;   // 目前閱讀的故事
var storyPageIdx = 0;
var storyReading = false;  // 是否連續朗讀中
var storyBusy = false;
var storyWordMap = {};     // wordId -> word（閱讀時查圖片）
var storyTapDone = {};     // 本次閱讀中，哪幾頁的點圖已完成

function storyEl(id) { return document.getElementById(id); }

// ---------- 入口 ----------
async function openStoryZone() {
  goTo('page-stories');
  setStoryProgress('');
  await renderStoryList();
}

// ---------- 自動挑字 ----------
// 優先：今天玩過的 → FSRS 到期 → 最近學過還在鞏固（reps≥1, S<8）→ 其他
async function pickBedtimeWords() {
  var words = await dbGetByIndex('words', 'pool', 'permanent');
  var today = getTodayStr();
  var now = Date.now();
  var scored = [];
  for (var i = 0; i < words.length; i++) {
    var w = words[i];
    var p = (typeof getProgressFor === 'function') ? await getProgressFor(w.id) : null;
    var up = p && typeof fsrsUpgrade === 'function' ? fsrsUpgrade(p) : p;
    var pri = 4;
    if (up && up.reps > 0) {
      if (up.todayReviewed === today) pri = 0;
      else if (up.due && up.due <= now) pri = 1;
      else if ((up.stability || 0) < 8) pri = 2;
      else pri = 3;
    }
    // 故事需要能「點圖片」：有圖片的字優先
    var hasImg = getAllImages(w).length > 0;
    scored.push({ w: w, pri: pri, img: hasImg ? 0 : 1, r: Math.random() });
  }
  scored.sort(function(a, b) { return (a.pri - b.pri) || (a.img - b.img) || (a.r - b.r); });
  return scored.slice(0, STORY_WORDS).map(function(x) { return x.w; });
}

// ---------- 生成（只有文字）----------
function buildStoryPrompt(words) {
  var list = words.map(function(w, i) {
    return (i + 1) + '. ' + w.word + (w.meaning ? '（' + w.meaning + '）' : '');
  }).join('\n');
  return 'You are writing a gentle bedtime story for a Taiwanese child aged 5-9 who is learning English.\n' +
    'Target words:\n' + list + '\n\n' +
    'Rules:\n' +
    '- Exactly ' + STORY_PAGES + ' pages. Calm, cozy, happy ending, kid-safe.\n' +
    '- Each page: 1-2 very simple English sentences (CEFR A1, under 25 words).\n' +
    '- Each page must use ONE target word as its "focus" word, written exactly as given. Use every target word at least once across the story.\n' +
    '- "zh" is a natural Traditional Chinese (Taiwan) translation.\n\n' +
    'Reply with ONLY this JSON, no markdown:\n' +
    '{"title":"English title","titleZh":"中文標題","pages":[{"en":"...","zh":"...","focus":"target word"}]}';
}

// 從模型回應抓出 JSON（容忍 ```json 包裹或前後多餘文字），並把 focus 對應回單字
function parseStoryJson(text, words) {
  var t = (text || '').replace(/```json|```/gi, '').trim();
  var start = t.indexOf('{');
  var end = t.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('模型沒有回傳 JSON');
  var data = JSON.parse(t.slice(start, end + 1));
  if (!data || !Array.isArray(data.pages)) throw new Error('JSON 缺少 pages');
  words = words || [];
  var byWord = {};
  words.forEach(function(w) { byWord[String(w.word).toLowerCase()] = w; });

  var pages = data.pages.slice(0, STORY_PAGES).map(function(p) {
    var en = String(p.en || p.text || '').trim();
    var focus = String(p.focus || '').trim().toLowerCase();
    var w = byWord[focus];
    // 模型沒標 focus 或標錯 → 找句子裡出現的第一個目標字
    if (!w) {
      w = words.find(function(x) {
        return new RegExp('\\b' + String(x.word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(en);
      }) || null;
    }
    return { en: en, zh: String(p.zh || '').trim(), focusId: w ? w.id : null, focusWord: w ? w.word : '' };
  }).filter(function(p) { return p.en; });
  if (pages.length < STORY_PAGES) throw new Error('只產生 ' + pages.length + ' 頁（需要 ' + STORY_PAGES + ' 頁）');
  return { title: String(data.title || 'Bedtime Story').trim(), titleZh: String(data.titleZh || '').trim(), pages: pages };
}

async function startBedtimeStory() {
  if (storyBusy) return;
  storyBusy = true;
  var btn = storyEl('storyGenerateBtn');
  if (btn) btn.disabled = true;
  try {
    setStoryProgress('🔍 挑今天的單字…');
    var words = await pickBedtimeWords();
    if (words.length < 3) throw new Error('單字太少，至少要有 3 個單字才能寫故事');
    var prompt = buildStoryPrompt(words);
    var story = null, lastErr = null;
    for (var attempt = 1; attempt <= 3 && !story; attempt++) {
      setStoryProgress('✍️ 正在寫故事…' + (attempt > 1 ? '（重試第 ' + attempt + ' 次）' : '') +
        '　今天的字：' + words.map(function(w) { return w.word; }).join(', '));
      try {
        var text = await aiChat(prompt, { temperature: 0.8, maxTokens: 1500, timeout: 120000, json: true });
        story = parseStoryJson(text, words);
      } catch (e) { lastErr = e; }
    }
    if (!story) throw new Error('故事生成失敗：' + (lastErr ? lastErr.message : '未知錯誤') + '\n請確認電腦上的 AI（Ollama / LM Studio）有開。');
    story.id = 'story-' + Date.now();
    story.wordIds = words.map(function(w) { return w.id; });
    story.words = words.map(function(w) { return w.word; });
    story.child = (typeof currentChild !== 'undefined') ? currentChild : 'boy';
    story.createdAt = Date.now();
    // 直接存入書架，不用再按「存入」；不想要可以在書架刪除
    await dbPutLocal('stories', story);
    setStoryProgress('');
    await renderStoryList();
    await openStoryReader(story);
  } catch (e) {
    setStoryProgress('❌ ' + e.message);
  } finally {
    storyBusy = false;
    if (btn) btn.disabled = false;
  }
}

function setStoryProgress(msg) {
  var el = storyEl('storyProgress');
  if (el) el.textContent = msg || '';
}

// ---------- 書架 ----------
async function renderStoryList() {
  var list = storyEl('storyList');
  if (!list) return;
  var stories = await dbGetAll('stories');
  stories.sort(function(a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });
  if (!stories.length) {
    list.innerHTML = '<p class="story-hint">還沒有故事，按上面的按鈕說第一個睡前故事吧！</p>';
    return;
  }
  list.innerHTML = stories.map(function(s) {
    var d = new Date(s.createdAt || Date.now());
    var who = s.child === 'girl' ? '👧' : '👦';
    return '<div class="story-book">' +
      '<button class="story-book-main" onclick="openSavedStory(\'' + s.id + '\')">' +
        '<span class="story-book-icon">🌙</span>' +
        '<span class="story-book-info">' +
          '<span class="story-book-title">' + esc(s.title) + '</span>' +
          '<span class="story-sub">' + esc(s.titleZh || '') + '</span>' +
          '<span class="story-book-meta">' + who + ' ' + (d.getMonth() + 1) + '/' + d.getDate() + ' · ' + esc((s.words || []).join(', ')) + '</span>' +
        '</span>' +
      '</button>' +
      '<button class="btn-sm btn-red" onclick="deleteStory(\'' + s.id + '\')" aria-label="刪除故事">🗑️</button>' +
    '</div>';
  }).join('');
}

async function openSavedStory(id) {
  var s = await dbGet('stories', id);
  if (s) await openStoryReader(s);
}

async function deleteStory(id) {
  var s = await dbGet('stories', id);
  if (!confirm('確定刪除故事「' + (s ? s.title : '') + '」嗎？')) return;
  await dbDeleteLocal('stories', id);
  await renderStoryList();
}

// ---------- 閱讀器 ----------
async function openStoryReader(story) {
  storyViewing = story;
  storyPageIdx = 0;
  storyTapDone = {};
  storyWordMap = {};
  var ids = story.wordIds || [];
  for (var i = 0; i < ids.length; i++) {
    var w = await dbGet('words', ids[i]);
    if (w) storyWordMap[w.id] = w;
  }
  stopStoryReading();
  storyEl('storyReaderTitle').textContent = story.title;
  goTo('page-story-reader');
  renderStoryPage();
}

function closeStoryReader() {
  stopStoryReading();
  storyViewing = null;
  goTo('page-stories');
  renderStoryList();
}

function highlightStoryWords(text, words) {
  var html = esc(text);
  (words || []).forEach(function(w) {
    if (!w) return;
    var safe = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    html = html.replace(new RegExp('\\b(' + safe + '(?:s|es|ed|ing)?)\\b', 'gi'), '<mark>$1</mark>');
  });
  return html;
}

// 每頁：大圖（重點字的圖片）+ 句子；點圖 = 小互動
function renderStoryPage() {
  var s = storyViewing;
  if (!s) return;
  var p = s.pages[storyPageIdx];
  var w = p.focusId != null ? storyWordMap[p.focusId] : null;
  // 有「家中尋寶」拍的照片就優先用，讓故事出現自己家的東西
  var img = w ? ((w.huntPhotos && w.huntPhotos[0]) || getRandomImage(w)) : '';
  var pic = storyEl('storyReaderPic');
  if (img) {
    pic.innerHTML = '<img src="' + img + '" alt="' + esc(w.word) + '" onerror="this.parentElement.innerHTML=\'<div class=story-reader-noimg>🌙</div>\'">';
  } else {
    pic.innerHTML = '<div class="story-reader-noimg">🌙</div>';
  }
  storyEl('storyReaderEn').innerHTML = highlightStoryWords(p.en, s.words);
  storyEl('storyReaderZh').textContent = p.zh || '';
  storyEl('storyReaderPage').textContent = (storyPageIdx + 1) + ' / ' + s.pages.length;
  storyEl('storyPrevBtn').disabled = storyPageIdx === 0;
  storyEl('storyNextBtn').disabled = storyPageIdx >= s.pages.length - 1;
  var ask = storyEl('storyTapAsk');
  if (w && img && !storyTapDone[storyPageIdx]) {
    ask.innerHTML = '👆 <b>' + esc(w.word) + '</b> 在哪裡？點點圖片！';
    ask.hidden = false;
  } else if (storyTapDone[storyPageIdx]) {
    ask.innerHTML = '⭐ 找到 <b>' + esc(w ? w.word : '') + '</b> 了！';
    ask.hidden = false;
  } else {
    ask.hidden = true;
  }
}

// 點重點字圖片 → 念單字 + 算一次複習（每頁每次閱讀只算一次）
async function storyTapPicture() {
  var s = storyViewing;
  if (!s) return;
  var p = s.pages[storyPageIdx];
  var w = p.focusId != null ? storyWordMap[p.focusId] : null;
  if (!w) return;
  speakWord(w.word, 0.6);
  if (storyTapDone[storyPageIdx]) return;
  storyTapDone[storyPageIdx] = true;
  var pic = storyEl('storyReaderPic');
  pic.classList.remove('story-pic-pop');
  void pic.offsetWidth;
  pic.classList.add('story-pic-pop');
  renderStoryPage();
  // 故事裡的字屬於永久庫，照常計入 FSRS（睡前故事只當 Good 複習，不會暴衝）
  var prevChild = currentChild;
  if (s.child) currentChild = s.child;
  try { await updateProgress(w.id, true, 'story', { mistakes: 0 }); }
  finally { currentChild = prevChild; }
}

function storyGoPage(delta) {
  if (!storyViewing) return;
  var next = storyPageIdx + delta;
  if (next < 0 || next >= storyViewing.pages.length) return;
  stopStoryReading();
  storyPageIdx = next;
  renderStoryPage();
}

function toggleStoryZh() {
  storyEl('storyReaderZh').classList.toggle('story-zh-hidden');
}

function speakStoryPage(onDone) {
  var p = storyViewing && storyViewing.pages[storyPageIdx];
  if (!p || !('speechSynthesis' in window)) { if (onDone) onDone(); return; }
  speechSynthesis.cancel();
  var u = new SpeechSynthesisUtterance(p.en);
  u.lang = 'en-US';
  u.rate = parseFloat(storyEl('storyRate').value) || 0.75;
  u.onend = function() { if (onDone) onDone(); };
  u.onerror = function() { if (onDone) onDone(); };
  speechSynthesis.speak(u);
}

function readStoryPage() {
  storyReading = false;
  updateStoryReadBtn();
  speakStoryPage(null);
}

// 從目前頁一路念到最後，每頁念完停 1.5 秒讓孩子點圖
function toggleStoryAutoRead() {
  if (storyReading) { stopStoryReading(); return; }
  storyReading = true;
  updateStoryReadBtn();
  (function loop() {
    if (!storyReading || !storyViewing) return;
    speakStoryPage(function() {
      if (!storyReading || !storyViewing) return;
      if (storyPageIdx >= storyViewing.pages.length - 1) { stopStoryReading(); return; }
      setTimeout(function() {
        if (!storyReading) return;
        storyPageIdx++;
        renderStoryPage();
        loop();
      }, 1500);
    });
  })();
}

function stopStoryReading() {
  storyReading = false;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  updateStoryReadBtn();
}

function updateStoryReadBtn() {
  var b = storyEl('storyAutoBtn');
  if (b) b.textContent = storyReading ? '⏹️ 停止' : '▶️ 一路念下去';
}
