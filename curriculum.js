// ===== 課綱字表（教育部 國中小 2000 常用字 / 1200 基本字）=====
// 資料：data/moe-wordlist.js 的 MOE_WORDLIST = [[word, basic, tag, pos], ...]
// 功能：
//   1. 學習報告顯示「基本 1200 / 常用 2000」進度（依每個小孩的真實階段）
//   2. 分批匯入：依主題或「下一批 N 個」匯入永久庫，本地 AI 自動補意思/例句/英英解釋
//      AI 失敗時仍會建立單字（只有英文），之後可用「批次補中文意思 / 補例句」補上
// 字表標籤：moe-basic（基本1200）/ moe-2000（常用2000，非基本），另加主題標籤（food、school...）

var MOE_BATCH_DEFAULT = 20;
var _moeImporting = false;
var _moeCancel = false;

function moeKey(w) { return String(w || '').trim().toLowerCase(); }

// 字表索引：word(小寫) → { word, basic, tag, pos }
var _moeIndex = null;
function getMoeIndex() {
  if (_moeIndex) return _moeIndex;
  _moeIndex = {};
  (typeof MOE_WORDLIST !== 'undefined' ? MOE_WORDLIST : []).forEach(function(r) {
    _moeIndex[moeKey(r[0])] = { word: r[0], basic: r[1] === 1, tag: r[2], pos: r[3] || '' };
  });
  return _moeIndex;
}

// 字表主題（依原表順序）與各主題字數
function getMoeTopics() {
  var order = [], count = {};
  (typeof MOE_WORDLIST !== 'undefined' ? MOE_WORDLIST : []).forEach(function(r) {
    if (!count[r[2]]) { count[r[2]] = { all: 0, basic: 0 }; order.push(r[2]); }
    count[r[2]].all++;
    if (r[1] === 1) count[r[2]].basic++;
  });
  return order.map(function(t) { return { tag: t, all: count[t].all, basic: count[t].basic }; });
}

// 計算某小孩在字表上的進度：已在單字庫 / 熟悉期以上
async function getMoeProgress(child) {
  var idx = getMoeIndex();
  var words = await dbGetByIndex('words', 'pool', 'permanent');
  var res = {
    basic: { total: 0, inLibrary: 0, familiar: 0 },
    all: { total: 0, inLibrary: 0, familiar: 0 }
  };
  Object.keys(idx).forEach(function(k) {
    res.all.total++;
    if (idx[k].basic) res.basic.total++;
  });
  var seen = {};
  for (var i = 0; i < words.length; i++) {
    var k = moeKey(words[i].word);
    var entry = idx[k];
    if (!entry || seen[k]) continue; // 一字多義只算一次
    seen[k] = true;
    res.all.inLibrary++;
    if (entry.basic) res.basic.inLibrary++;
    var rec = await dbGet('progress', words[i].id + '_' + child);
    if (!rec) rec = await dbGet('progress', words[i].id);
    if (!rec) continue;
    var p = (typeof fsrsUpgrade === 'function') ? fsrsUpgrade(rec) : rec;
    var lvl = (typeof getWordStageLevel === 'function') ? getWordStageLevel(p) : 0;
    if (lvl >= 1) {
      res.all.familiar++;
      if (entry.basic) res.basic.familiar++;
    }
  }
  return res;
}

// 報告頁用的 HTML 區塊
var _moeTaggedOnce = false;
async function renderMoeProgressHtml(child) {
  if (typeof MOE_WORDLIST === 'undefined') return '';
  // 使用者自己先建的字（apple、dog…）也要算進課綱：每次開 App 第一次看報告時補一次標籤
  if (!_moeTaggedOnce) {
    _moeTaggedOnce = true;
    try { await tagExistingMoeWords(); } catch (e) { console.warn('補字表標籤失敗', e); }
  }
  var p = await getMoeProgress(child);
  function row(label, d, color) {
    var libPct = d.total ? Math.round(d.inLibrary / d.total * 100) : 0;
    var famPct = d.total ? Math.round(d.familiar / d.total * 100) : 0;
    return '<div class="moe-row">' +
      '<div class="moe-row-head"><b>' + label + '</b>' +
        '<span>熟悉以上 <b style="color:' + color + '">' + d.familiar + '</b> / ' + d.total + '（' + famPct + '%）</span></div>' +
      '<div class="moe-track" role="img" aria-label="' + label + ' 已加入 ' + libPct + '%，熟悉 ' + famPct + '%">' +
        '<div class="moe-fill-lib" style="width:' + libPct + '%"></div>' +
        '<div class="moe-fill-fam" style="width:' + famPct + '%;background:' + color + '"></div>' +
      '</div>' +
      '<div class="moe-row-foot">已加入單字庫 ' + d.inLibrary + ' 個（' + libPct + '%）</div>' +
    '</div>';
  }
  return '<h3 class="report-section-title">📘 課綱字表進度（教育部）</h3>' +
    '<div class="moe-progress">' +
      row('國中小基本 1200 字', p.basic, '#43A047') +
      row('國中常用 2000 字', p.all, '#1E88E5') +
      '<button class="btn-sm" onclick="goTo(\'page-manage\');openMoeImport()">📥 從字表加入單字</button>' +
    '</div>';
}

// ---------- 匯入介面（放在管理單字頁）----------
function openMoeImport() {
  var box = document.getElementById('moeImportBox');
  if (!box) return;
  box.hidden = false;
  renderMoeImportBox();
  setTimeout(function() { box.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 50);
}

async function renderMoeImportBox() {
  var box = document.getElementById('moeImportBox');
  if (!box) return;
  var words = await dbGetByIndex('words', 'pool', 'permanent');
  var have = {};
  words.forEach(function(w) { have[moeKey(w.word)] = true; });
  var topics = getMoeTopics().map(function(t) {
    var left = (MOE_WORDLIST || []).filter(function(r) { return r[2] === t.tag && !have[moeKey(r[0])]; }).length;
    return '<option value="' + esc(t.tag) + '">' + esc(t.tag) + '（還有 ' + left + ' / ' + t.all + '）</option>';
  }).join('');
  var basicLeft = MOE_WORDLIST.filter(function(r) { return r[1] === 1 && !have[moeKey(r[0])]; }).length;
  var allLeft = MOE_WORDLIST.filter(function(r) { return !have[moeKey(r[0])]; }).length;
  box.innerHTML =
    '<h4>📘 從教育部字表加入單字</h4>' +
    '<p class="moe-hint">字表裡的字會加上 <code>moe-basic</code> 或 <code>moe-2000</code> 標籤，並由本地 AI 補中文意思、例句與英英解釋。已經有的字會跳過。</p>' +
    '<div class="moe-form">' +
      '<label>範圍 <select id="moeScope">' +
        '<option value="basic">基本 1200 字（還有 ' + basicLeft + ' 個）</option>' +
        '<option value="all">常用 2000 字（還有 ' + allLeft + ' 個）</option>' +
        '<option value="topic">依主題</option>' +
      '</select></label>' +
      '<label id="moeTopicWrap" hidden>主題 <select id="moeTopic">' + topics + '</select></label>' +
      '<label>這次加入 <select id="moeCount">' +
        '<option value="10">10 個</option><option value="20" selected>20 個</option><option value="50">50 個</option>' +
      '</select></label>' +
      '<label class="moe-check"><input type="checkbox" id="moeUseAI" checked> 用本地 AI 補資料</label>' +
    '</div>' +
    '<div class="batch-btns">' +
      '<button class="btn-primary" id="moeStartBtn" onclick="runMoeImport()">🚀 開始加入</button>' +
      '<button class="btn-ghost" id="moeCancelBtn" onclick="_moeCancel=true" hidden>⏹️ 停止</button>' +
      '<button class="btn-ghost" onclick="document.getElementById(\'moeImportBox\').hidden=true">關閉</button>' +
    '</div>' +
    '<div class="batch-progress" id="moeProgress" role="status" aria-live="polite"></div>';
  document.getElementById('moeScope').onchange = function() {
    document.getElementById('moeTopicWrap').hidden = this.value !== 'topic';
  };
}

// 挑出這次要匯入的字：依字表原順序（原表依主題排列，基本字優先）
function pickMoeBatch(scope, topic, count, haveSet) {
  var rows = MOE_WORDLIST.filter(function(r) {
    if (haveSet[moeKey(r[0])]) return false;
    if (scope === 'basic') return r[1] === 1;
    if (scope === 'topic') return r[2] === topic;
    return true;
  });
  // 「常用 2000」與「依主題」也讓基本字排前面
  rows.sort(function(a, b) { return (b[1] - a[1]); });
  return rows.slice(0, count);
}

async function runMoeImport() {
  if (_moeImporting) return;
  var scope = document.getElementById('moeScope').value;
  var topic = document.getElementById('moeTopic').value;
  var count = parseInt(document.getElementById('moeCount').value) || MOE_BATCH_DEFAULT;
  var useAI = document.getElementById('moeUseAI').checked;

  var existing = await dbGetByIndex('words', 'pool', 'permanent');
  var haveSet = {};
  existing.forEach(function(w) { haveSet[moeKey(w.word)] = true; });
  var batch = pickMoeBatch(scope, topic, count, haveSet);
  if (!batch.length) { setBatchProgress('moeProgress', '✅ 這個範圍的字都已經加入了！'); return; }
  if (!confirm('將加入 ' + batch.length + ' 個單字' + (useAI ? '，並用本地 AI 補資料（每個約數秒）' : '') + '。開始嗎？')) return;

  _moeImporting = true; _moeCancel = false;
  document.getElementById('moeStartBtn').disabled = true;
  document.getElementById('moeCancelBtn').hidden = false;
  var added = 0, aiFail = 0;
  try {
    for (var i = 0; i < batch.length; i++) {
      if (_moeCancel) break;
      var r = batch[i];
      var word = r[0];
      setBatchProgress('moeProgress', '處理中 ' + (i + 1) + '/' + batch.length + '：' + esc(word));
      var data = null;
      if (useAI && typeof aiGenerateForWord === 'function') {
        try { data = await aiGenerateForWord(word); } catch (e) { data = null; }
        if (!data) aiFail++;
      }
      var tags = [r[1] === 1 ? 'moe-basic' : 'moe-2000'];
      if (r[2] && tags.indexOf(r[2]) === -1) tags.push(r[2]);
      var validPos = ['noun', 'verb', 'adj', 'adv', 'prep', 'other'];
      var pos = (data && validPos.indexOf(data.pos) !== -1) ? data.pos : (r[3] || '');
      await dbAdd('words', {
        word: word,
        meaning: (data && data.meaning) || '',
        pos: pos,
        antonym: '',
        definition: (data && data.definition) || '',
        tags: tags,
        sentences: (data && Array.isArray(data.sentences)) ? data.sentences.filter(Boolean).slice(0, 3) : [],
        images: [],
        imageUrl: null, imageLocal: null,
        pool: 'permanent', createdAt: Date.now()
      });
      haveSet[moeKey(word)] = true;
      added++;
    }
    var msg = (_moeCancel ? '⏹️ 已停止。' : '✅ 完成！') + '加入 ' + added + ' 個';
    if (aiFail) msg += '，其中 ' + aiFail + ' 個 AI 沒補到資料（可用上方「批次補中文意思 / 補例句」再補）';
    setBatchProgress('moeProgress', msg + '。');
  } finally {
    _moeImporting = false;
    var sb = document.getElementById('moeStartBtn');
    if (sb) sb.disabled = false;
    var cb = document.getElementById('moeCancelBtn');
    if (cb) cb.hidden = true;
    if (typeof renderWordList === 'function') renderWordList();
  }
}

// 為既有單字補上字表標籤（使用者自己先建的字，也能算進課綱進度與篩選）
async function tagExistingMoeWords() {
  var idx = getMoeIndex();
  var words = await dbGetByIndex('words', 'pool', 'permanent');
  var changed = 0;
  for (var i = 0; i < words.length; i++) {
    var w = words[i];
    var e = idx[moeKey(w.word)];
    if (!e) continue;
    var tag = e.basic ? 'moe-basic' : 'moe-2000';
    var tags = (w.tags || []).slice();
    if (tags.indexOf(tag) !== -1) continue;
    tags.push(tag);
    w.tags = tags;
    await dbPut('words', w);
    changed++;
  }
  return changed;
}
