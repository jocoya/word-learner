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

// ---------- 自動挑字（分級）----------
// 研究：讀者要認得大部分的字，故事才讀得順、新字才學得起來。
// 所以故事 = 「已熟悉的字」當骨架 + 少量「正在學的字」當重點字：
//   focus（重點字，要點圖、算複習）：STORY_NEW_WORDS 個，優先今天學過 / 到期 / 還在鞏固
//   known（已熟悉，熟悉期以上）：用來撐起句子，不算複習
// 已熟悉的字不足時，重點字自動增加，總數維持 STORY_WORDS 個
var STORY_NEW_WORDS = 2;

async function pickBedtimeWords() {
  var words = await dbGetByIndex('words', 'pool', 'permanent');
  var today = getTodayStr();
  var now = Date.now();
  var learning = [], known = [];
  for (var i = 0; i < words.length; i++) {
    var w = words[i];
    // 片語與功能詞（a few、the）不當故事主角
    if (/\s/.test(w.word) || (w.tags || []).indexOf('grammar') !== -1) continue;
    var p = (typeof getProgressFor === 'function') ? await getProgressFor(w.id) : null;
    var up = p && typeof fsrsUpgrade === 'function' ? fsrsUpgrade(p) : p;
    var lvl = (up && typeof getWordStageLevel === 'function') ? getWordStageLevel(up) : 0;
    var hasImg = getAllImages(w).length > 0 ? 0 : 1;
    if (up && up.reps > 0 && lvl >= 1) {
      known.push({ w: w, img: hasImg, r: Math.random() });
      continue;
    }
    var pri = 4;
    if (up && up.reps > 0) {
      if (up.todayReviewed === today) pri = 0;
      else if (up.due && up.due <= now) pri = 1;
      else pri = 2;
    } else {
      pri = 3; // 還沒學過的新字：放最後
    }
    learning.push({ w: w, pri: pri, img: hasImg, r: Math.random() });
  }
  learning.sort(function(a, b) { return (a.pri - b.pri) || (a.img - b.img) || (a.r - b.r); });
  known.sort(function(a, b) { return (a.img - b.img) || (a.r - b.r); });

  var knownPick = known.slice(0, STORY_WORDS - STORY_NEW_WORDS).map(function(x) { return x.w; });
  var focusPick = learning.slice(0, STORY_WORDS - knownPick.length).map(function(x) { return x.w; });
  // 正在學的字不夠時，用已熟悉的字補滿
  if (knownPick.length + focusPick.length < STORY_WORDS) {
    knownPick = known.slice(0, STORY_WORDS - focusPick.length).map(function(x) { return x.w; });
  }
  return { focus: focusPick, known: knownPick };
}

// ---------- 生成（只有文字）----------
// picked: { focus:[word], known:[word] }；相容舊呼叫（直接傳陣列 = 全部當重點字）
function buildStoryPrompt(picked) {
  if (Array.isArray(picked)) picked = { focus: picked, known: [] };
  var fmt = function(w) { return w.word + (w.meaning ? '（' + w.meaning + '）' : ''); };
  var focusList = picked.focus.map(function(w, i) { return (i + 1) + '. ' + fmt(w); }).join('\n');
  var knownList = picked.known.map(fmt).join(', ');
  return 'You are writing a gentle bedtime story for a Taiwanese child aged 5-9 who is learning English.\n' +
    'NEW words the child is learning (the story is about these):\n' + focusList + '\n' +
    (knownList ? 'Words the child ALREADY KNOWS (use them freely): ' + knownList + '\n' : '') +
    '\nRules:\n' +
    '- Exactly ' + STORY_PAGES + ' pages. Calm, cozy, happy ending, kid-safe.\n' +
    '- Each page: 1-2 very short English sentences (CEFR Pre-A1/A1, under 20 words).\n' +
    '- Use ONLY the words above plus the simplest everyday words (I, you, a, the, is, like, go, see, big, happy...). Avoid any other hard word.\n' +
    '- Each page has ONE "focus" word, written exactly as given, chosen from the NEW words. Use every NEW word at least twice across the story so the child hears it again.\n' +
    '- "zh" is a natural Traditional Chinese (Taiwan) translation.\n' +
    '- After the pages, write 2 very easy comprehension questions in English about the story, each with 3 short options and the correct option index (0-2).\n\n' +
    'Reply with ONLY this JSON, no markdown:\n' +
    '{"title":"English title","titleZh":"中文標題","pages":[{"en":"...","zh":"...","focus":"new word"}],' +
    '"questions":[{"q":"...","qZh":"中文題目","options":["...","...","..."],"answer":0}]}';
}

// 理解題：容錯解析，最多 2 題；格式不對就略過（故事照樣可以讀）
function parseStoryQuestions(data) {
  var qs = Array.isArray(data.questions) ? data.questions : [];
  return qs.slice(0, 2).map(function(q) {
    var opts = Array.isArray(q.options) ? q.options.map(function(o) { return String(o).trim(); }).filter(Boolean).slice(0, 3) : [];
    var ans = parseInt(q.answer, 10);
    if (!q.q || opts.length < 2 || isNaN(ans) || ans < 0 || ans >= opts.length) return null;
    return { q: String(q.q).trim(), qZh: String(q.qZh || '').trim(), options: opts, answer: ans };
  }).filter(Boolean);
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
  return {
    title: String(data.title || 'Bedtime Story').trim(),
    titleZh: String(data.titleZh || '').trim(),
    pages: pages,
    questions: parseStoryQuestions(data)
  };
}

async function startBedtimeStory() {
  if (storyBusy) return;
  storyBusy = true;
  var btn = storyEl('storyGenerateBtn');
  if (btn) btn.disabled = true;
  try {
    setStoryProgress('🔍 挑今天的單字…');
    var picked = await pickBedtimeWords();
    if (picked.focus.length < 1 || picked.focus.length + picked.known.length < 3) {
      throw new Error('單字太少，至少要有 3 個單字才能寫故事');
    }
    var prompt = buildStoryPrompt(picked);
    var story = null, lastErr = null;
    for (var attempt = 1; attempt <= 3 && !story; attempt++) {
      setStoryProgress('✍️ 正在寫故事…' + (attempt > 1 ? '（重試第 ' + attempt + ' 次）' : '') +
        '\n今天的新字：' + picked.focus.map(function(w) { return w.word; }).join(', ') +
        (picked.known.length ? '　複習：' + picked.known.map(function(w) { return w.word; }).join(', ') : ''));
      try {
        var text = await aiChat(prompt, { temperature: 0.8, maxTokens: 1800, timeout: 120000, json: true });
        // 只有「正在學的字」當重點字（點圖、算複習）
        story = parseStoryJson(text, picked.focus);
      } catch (e) { lastErr = e; }
    }
    if (!story) throw new Error('故事生成失敗：' + (lastErr ? lastErr.message : '未知錯誤') + '\n請確認電腦上的 AI（Ollama / LM Studio）有開。');
    var allPicked = picked.focus.concat(picked.known);
    story.id = 'story-' + Date.now();
    story.wordIds = allPicked.map(function(w) { return w.id; });
    story.words = allPicked.map(function(w) { return w.word; });
    story.focusWords = picked.focus.map(function(w) { return w.word; });
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
  var quiz = storyEl('storyQuiz');
  if (quiz) quiz.hidden = true;
  var reader = document.querySelector('#page-story-reader .story-reader');
  if (reader) reader.hidden = false;
  goTo('page-stories');
  renderStoryList();
}

// 標亮：重點字（focus）黃色 <mark>；已熟悉的字淡藍色 <mark class="story-known">
// 一次比對所有字，避免 <mark> 標籤被第二輪取代弄壞
function highlightStoryWords(text, words, focusWords) {
  var html = esc(text);
  var focusSet = {};
  (focusWords || words || []).forEach(function(w) { if (w) focusSet[String(w).toLowerCase()] = true; });
  var list = (words || []).filter(Boolean).slice().sort(function(a, b) { return b.length - a.length; });
  if (!list.length) return html;
  var alt = list.map(function(w) { return w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|');
  var re = new RegExp('\\b(' + alt + ')((?:s|es|ed|ing)?)\\b', 'gi');
  return html.replace(re, function(m, base) {
    var isFocus = focusSet[base.toLowerCase()];
    return isFocus ? '<mark>' + m + '</mark>' : '<mark class="story-known">' + m + '</mark>';
  });
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
  storyEl('storyReaderEn').innerHTML = highlightStoryWords(p.en, s.words, s.focusWords);
  storyEl('storyReaderZh').textContent = p.zh || '';
  storyEl('storyReaderPage').textContent = (storyPageIdx + 1) + ' / ' + s.pages.length;
  storyEl('storyPrevBtn').disabled = storyPageIdx === 0;
  // 最後一頁：有理解題就把「下一頁」變成「回答問題」
  var isLast = storyPageIdx >= s.pages.length - 1;
  var hasQ = s.questions && s.questions.length;
  var nextBtn = storyEl('storyNextBtn');
  nextBtn.disabled = isLast && !hasQ;
  nextBtn.textContent = isLast && hasQ ? '❓ 回答問題' : '下一頁 ▶';
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
  if (next >= storyViewing.pages.length && delta > 0 && storyViewing.questions && storyViewing.questions.length) {
    stopStoryReading();
    showStoryQuestions();
    return;
  }
  if (next < 0 || next >= storyViewing.pages.length) return;
  stopStoryReading();
  storyPageIdx = next;
  renderStoryPage();
}

// ---------- 讀完的理解題（不寫 FSRS，答對給鼓勵；答錯可再選）----------
function showStoryQuestions() {
  var s = storyViewing;
  var qs = s.questions || [];
  var idx = 0, firstTry = 0;
  var box = storyEl('storyQuiz');
  var reader = document.querySelector('#page-story-reader .story-reader');
  reader.hidden = true;
  box.hidden = false;

  function render() {
    if (idx >= qs.length) {
      box.innerHTML = '<div class="story-quiz-done">' +
        '<div class="story-quiz-emoji">' + (firstTry === qs.length ? '🌟' : '👍') + '</div>' +
        '<div class="story-quiz-title">' + (firstTry === qs.length ? '全部一次答對！' : '讀完了，好棒！') + '</div>' +
        '<div class="story-sub">一次答對 ' + firstTry + ' / ' + qs.length + ' 題</div>' +
        '<div class="story-quiz-btns">' +
          '<button class="btn-sm" onclick="backToStoryPages()">📖 再讀一次</button>' +
          '<button class="btn-sm btn-green" onclick="closeStoryReader()">🌙 晚安</button>' +
        '</div></div>';
      return;
    }
    var q = qs[idx];
    var tried = false;
    box.innerHTML = '<div class="story-quiz-q">' +
        '<div class="story-quiz-no">❓ ' + (idx + 1) + ' / ' + qs.length + '</div>' +
        '<div class="story-quiz-en">' + esc(q.q) + ' <button class="story-quiz-speak" id="storyQuizSpeak" aria-label="念題目">🔊</button></div>' +
        (q.qZh ? '<div class="story-quiz-zh">' + esc(q.qZh) + '</div>' : '') +
        '<div class="story-quiz-opts">' +
          q.options.map(function(o, i) { return '<button class="story-quiz-opt" data-i="' + i + '">' + esc(o) + '</button>'; }).join('') +
        '</div>' +
        '<div class="story-quiz-fb" id="storyQuizFb" role="status" aria-live="polite"></div>' +
      '</div>';
    setTimeout(function() { speakWord(q.q, 0.75); }, 300);
    storyEl('storyQuizSpeak').onclick = function() { speakWord(q.q, 0.75); };
    box.querySelectorAll('.story-quiz-opt').forEach(function(b) {
      b.addEventListener('click', function() {
        var i = parseInt(b.dataset.i, 10);
        speakWord(q.options[i], 0.75);
        if (i === q.answer) {
          if (!tried) firstTry++;
          b.classList.add('correct');
          box.querySelectorAll('.story-quiz-opt').forEach(function(x) { x.disabled = true; });
          storyEl('storyQuizFb').textContent = '🎉 答對了！';
          setTimeout(function() { idx++; render(); }, 1300);
        } else {
          tried = true;
          b.classList.add('wrong');
          b.disabled = true;
          storyEl('storyQuizFb').textContent = '再想想看～';
        }
      });
    });
  }
  render();
}

function backToStoryPages() {
  storyEl('storyQuiz').hidden = true;
  document.querySelector('#page-story-reader .story-reader').hidden = false;
  storyPageIdx = 0;
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
