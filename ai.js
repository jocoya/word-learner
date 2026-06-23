// ===== AI 統一介面（可切換後端：Ollama / LM Studio / 自訂）=====
// 所有 AI 文字功能都走 aiChat()，未來接 agent 或別的後端只要加 provider，上層不用改。

// 預設後端設定
var AI_DEFAULTS = {
  provider: 'ollama',                       // 'ollama' | 'lmstudio' | 'custom'
  ollamaHost: 'http://100.125.96.108:11434',// 平板經 Tailscale 連電腦
  ollamaModel: 'bjoernb/gemma4-e4b-fast',
  lmstudioHost: 'http://100.125.96.108:1234',// LM Studio 預設 port 1234
  lmstudioModel: 'local-model',             // LM Studio 用載入中的模型，名稱通常可任意
  customUrl: '',                            // 自訂完整 endpoint（OpenAI 相容 /v1/chat/completions）
  customModel: ''
};

// 取得目前 AI 設定（從 settings 讀，沒設定就用預設）
async function getAISettings() {
  var s = await dbGet('settings', 'aiConfig');
  if (!s) return Object.assign({ key: 'aiConfig' }, AI_DEFAULTS);
  return Object.assign({ key: 'aiConfig' }, AI_DEFAULTS, s);
}

async function saveAISettings(cfg) {
  cfg.key = 'aiConfig';
  await dbPut('settings', cfg);
}

// 在電腦本機時把 Tailscale IP 換成 localhost（加速）
function localizeHost(host) {
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    return host.replace(/\/\/100\.\d+\.\d+\.\d+/, '//localhost').replace(/\/\/[\d.]+:/, '//localhost:');
  }
  return host;
}

// 統一 AI 對話入口：傳入 prompt（或 messages），回傳純文字
// options: { system, temperature, maxTokens }
async function aiChat(prompt, options) {
  options = options || {};
  var cfg = await getAISettings();
  var provider = cfg.provider || 'ollama';

  if (provider === 'ollama') {
    return await _ollamaChat(cfg, prompt, options);
  }
  // lmstudio / custom 都走 OpenAI 相容格式
  var url, model;
  if (provider === 'lmstudio') {
    url = localizeHost(cfg.lmstudioHost) + '/v1/chat/completions';
    model = cfg.lmstudioModel || 'local-model';
  } else { // custom
    url = cfg.customUrl;
    model = cfg.customModel || 'local-model';
  }
  return await _openAIChat(url, model, prompt, options);
}

// 帶 timeout 的 fetch（避免連不上時卡死）
async function fetchWithTimeout(url, opts, timeoutMs) {
  timeoutMs = timeoutMs || 30000;
  var controller = new AbortController();
  var timer = setTimeout(function() { controller.abort(); }, timeoutMs);
  try {
    var res = await fetch(url, Object.assign({}, opts, { signal: controller.signal }));
    clearTimeout(timer);
    return res;
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') {
      throw new Error('連線逾時（' + (timeoutMs/1000) + '秒）— 請確認 AI 後端有開啟且網路可連');
    }
    // 連不上 / CORS / mixed-content 通常是 TypeError: Failed to fetch
    if (e instanceof TypeError) {
      var hint = '';
      if (location.protocol === 'https:' && url.indexOf('http:') === 0) {
        hint = '\n⚠️ 你的網頁是 HTTPS，但 AI 後端是 HTTP，瀏覽器會封鎖（mixed content）。請用 HTTPS 存取後端，或在電腦本機(localhost)使用。';
      } else {
        hint = '\n可能原因：後端沒開、位址錯誤、或 CORS 未允許（LM Studio 需開啟 CORS）。';
      }
      throw new Error('無法連線到 AI 後端' + hint);
    }
    throw e;
  }
}

// Ollama 原生 /api/generate
async function _ollamaChat(cfg, prompt, options) {
  var url = localizeHost(cfg.ollamaHost) + '/api/generate';
  var fullPrompt = options.system ? (options.system + '\n\n' + prompt) : prompt;
  var res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: cfg.ollamaModel,
      prompt: fullPrompt,
      stream: false,
      options: { temperature: options.temperature != null ? options.temperature : 0.7 }
    })
  }, options.timeout || 60000);
  if (!res.ok) {
    var t = await res.text().catch(function(){ return ''; });
    throw new Error('Ollama HTTP ' + res.status + (t ? ' — ' + t.slice(0, 120) : ''));
  }
  var data = await res.json();
  return (data.response || '').trim();
}

// OpenAI 相容 /v1/chat/completions（LM Studio、其他）
async function _openAIChat(url, model, prompt, options) {
  if (!url) throw new Error('AI endpoint 未設定');
  var messages = [];
  if (options.system) messages.push({ role: 'system', content: options.system });
  messages.push({ role: 'user', content: prompt });
  var res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model,
      messages: messages,
      temperature: options.temperature != null ? options.temperature : 0.7,
      max_tokens: options.maxTokens || 512,
      stream: false
    })
  }, options.timeout || 60000);
  if (!res.ok) {
    var tt = await res.text().catch(function(){ return ''; });
    throw new Error('AI HTTP ' + res.status + (tt ? ' — ' + tt.slice(0, 120) : ''));
  }
  var data = await res.json();
  return ((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '').trim();
}

// 測試目前後端是否連得上（短 timeout）
async function aiTestConnection() {
  try {
    var r = await aiChat('Say OK', { maxTokens: 10, temperature: 0, timeout: 15000 });
    return { ok: true, reply: r };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ===== AI 設定面板 =====
async function openAISettings() {
  var cfg = await getAISettings();
  var modal = document.getElementById('modal-ai');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-ai';
    modal.className = 'modal';
    document.body.appendChild(modal);
  }
  function sel(v) { return cfg.provider === v ? ' selected' : ''; }
  modal.innerHTML =
    '<div class="modal-content ai-settings">' +
      '<h3>🤖 AI 後端設定</h3>' +
      '<div class="ai-row"><label>後端</label>' +
        '<select id="aiProvider" onchange="aiToggleFields()">' +
          '<option value="ollama"' + sel('ollama') + '>Ollama</option>' +
          '<option value="lmstudio"' + sel('lmstudio') + '>LM Studio</option>' +
          '<option value="custom"' + sel('custom') + '>自訂 (OpenAI 相容)</option>' +
        '</select></div>' +
      '<div class="ai-fields" id="aiFieldsOllama">' +
        '<div class="ai-row"><label>Ollama 位址</label><input id="aiOllamaHost" value="' + esc(cfg.ollamaHost) + '"></div>' +
        '<div class="ai-row"><label>模型</label><input id="aiOllamaModel" value="' + esc(cfg.ollamaModel) + '"></div>' +
      '</div>' +
      '<div class="ai-fields" id="aiFieldsLmstudio">' +
        '<div class="ai-row"><label>LM Studio 位址</label><input id="aiLmHost" value="' + esc(cfg.lmstudioHost) + '"></div>' +
        '<div class="ai-row"><label>模型</label><input id="aiLmModel" value="' + esc(cfg.lmstudioModel) + '"></div>' +
        '<div class="ai-hint">⚠️ LM Studio 需在「Developer」分頁 <b>Start Server</b>，並開啟 <b>CORS</b> 與 <b>Serve on Local Network</b>（才能讓平板連）。位址用電腦的 Tailscale IP:1234，不要加 /v1。</div>' +
      '</div>' +
      '<div class="ai-fields" id="aiFieldsCustom">' +
        '<div class="ai-row"><label>Endpoint URL</label><input id="aiCustomUrl" value="' + esc(cfg.customUrl) + '" placeholder="http://.../v1/chat/completions"></div>' +
        '<div class="ai-row"><label>模型</label><input id="aiCustomModel" value="' + esc(cfg.customModel) + '"></div>' +
      '</div>' +
      '<div class="ai-output" id="aiTestOut"></div>' +
      '<div style="display:flex;gap:8px;margin-top:12px;">' +
        '<button class="btn-primary" onclick="aiSaveSettings()">儲存</button>' +
        '<button class="dev-btn" onclick="aiRunTest()">🔌 測試連線</button>' +
        '<button class="btn-ghost" onclick="hideModal(\'modal-ai\')">關閉</button>' +
      '</div>' +
    '</div>';
  modal.hidden = false;
  aiToggleFields();
}

function aiToggleFields() {
  var p = document.getElementById('aiProvider').value;
  ['ollama', 'lmstudio', 'custom'].forEach(function(x) {
    var el = document.getElementById('aiFields' + x.charAt(0).toUpperCase() + x.slice(1));
    if (el) el.style.display = (p === x) ? 'block' : 'none';
  });
}

async function aiSaveSettings() {
  var cfg = await getAISettings();
  cfg.provider = document.getElementById('aiProvider').value;
  cfg.ollamaHost = document.getElementById('aiOllamaHost').value.trim();
  cfg.ollamaModel = document.getElementById('aiOllamaModel').value.trim();
  cfg.lmstudioHost = document.getElementById('aiLmHost').value.trim();
  cfg.lmstudioModel = document.getElementById('aiLmModel').value.trim();
  cfg.customUrl = document.getElementById('aiCustomUrl').value.trim();
  cfg.customModel = document.getElementById('aiCustomModel').value.trim();
  await saveAISettings(cfg);
  document.getElementById('aiTestOut').innerHTML = '✅ 已儲存';
}

async function aiRunTest() {
  document.getElementById('aiTestOut').innerHTML = '測試中...';
  await aiSaveSettings();
  var r = await aiTestConnection();
  document.getElementById('aiTestOut').innerHTML = r.ok
    ? '✅ 連線成功：' + esc(r.reply.slice(0, 40))
    : '❌ 連線失敗：' + esc(r.error);
}


// ===== AI 批次工具 =====

// 為單一單字物件生成完整資料（回傳 {meaning, pos, definition, sentences}）
async function aiGenerateForWord(word, opts) {
  opts = opts || {};
  var prompt =
    "You are helping build a children's English vocabulary card for the word \"" + word + "\".\n" +
    "Return ONLY valid JSON (no markdown) with this shape:\n" +
    '{"meaning":"繁體中文意思","pos":"noun|verb|adj|adv|prep|other","definition":"simple English explanation for a 4-year-old, one short sentence","sentences":["s1","s2","s3"]}\n' +
    "Rules: meaning 用繁體中文最常見意思; pos 選一個; definition 很簡單的英文一句; sentences 3 句不同、真實世界、4-8 歲、每句少於10字、必須含 \"" + word + "\"、無奇幻。\n" +
    "Word: " + word;
  var raw = await aiChat(prompt, { temperature: 0.6, maxTokens: 400 });
  return parseAIJson(raw);
}

function setBatchProgress(id, msg) {
  var el = document.getElementById(id);
  if (el) el.innerHTML = msg;
}

// 📝 批次補例句：掃描所有「缺例句」的永久庫單字，逐個補上
async function batchFillSentences() {
  if (!confirm('將為所有「缺例句」的單字自動生成例句，可能需要一段時間。開始嗎？')) return;
  var words = await dbGetByIndex('words', 'pool', 'permanent');
  var targets = words.filter(function(w) { return !w.sentences || w.sentences.filter(Boolean).length === 0; });
  if (!targets.length) { setBatchProgress('batchProgress', '✅ 所有單字都有例句了！'); return; }
  var done = 0, fail = 0;
  for (var i = 0; i < targets.length; i++) {
    var w = targets[i];
    setBatchProgress('batchProgress', '處理中 ' + (i + 1) + '/' + targets.length + '：' + esc(w.word));
    try {
      var data = await aiGenerateForWord(w.word);
      if (data && Array.isArray(data.sentences)) {
        w.sentences = data.sentences.filter(Boolean).slice(0, 3);
        if (!w.definition && data.definition) w.definition = data.definition;
        await dbPut('words', w);
        done++;
      } else { fail++; }
    } catch (e) { fail++; }
  }
  setBatchProgress('batchProgress', '✅ 完成！補了 ' + done + ' 個，失敗 ' + fail + ' 個。');
  if (typeof renderWordList === 'function') renderWordList();
}

// 🀄 批次補中文意思：掃描沒有 meaning 的單字
async function batchFillMeaning() {
  if (!confirm('將為所有「缺中文意思」的單字自動翻譯。開始嗎？')) return;
  var words = await dbGetByIndex('words', 'pool', 'permanent');
  var targets = words.filter(function(w) { return !w.meaning || !w.meaning.trim(); });
  if (!targets.length) { setBatchProgress('batchProgress', '✅ 所有單字都有中文意思了！'); return; }
  var done = 0, fail = 0;
  for (var i = 0; i < targets.length; i++) {
    var w = targets[i];
    setBatchProgress('batchProgress', '處理中 ' + (i + 1) + '/' + targets.length + '：' + esc(w.word));
    try {
      var raw = await aiChat('Translate the English word "' + w.word + '" to Traditional Chinese. Return ONLY the Chinese translation, the most common meaning, no explanation.', { temperature: 0.3, maxTokens: 30 });
      var meaning = raw.replace(/^["'\s]+|["'\s]+$/g, '').split('\n')[0];
      if (meaning) { w.meaning = meaning; await dbPut('words', w); done++; } else { fail++; }
    } catch (e) { fail++; }
  }
  setBatchProgress('batchProgress', '✅ 完成！補了 ' + done + ' 個，失敗 ' + fail + ' 個。');
  if (typeof renderWordList === 'function') renderWordList();
}

// 🔤 批次判斷詞性：掃描沒有 pos 的單字
async function batchFillPos() {
  if (!confirm('將為所有「未設定詞性」的單字自動判斷。開始嗎？')) return;
  var words = await dbGetByIndex('words', 'pool', 'permanent');
  var targets = words.filter(function(w) { return !w.pos; });
  if (!targets.length) { setBatchProgress('batchProgress', '✅ 所有單字都有詞性了！'); return; }
  var valid = ['noun','verb','adj','adv','prep','other'];
  var done = 0, fail = 0;
  for (var i = 0; i < targets.length; i++) {
    var w = targets[i];
    setBatchProgress('batchProgress', '處理中 ' + (i + 1) + '/' + targets.length + '：' + esc(w.word));
    try {
      var raw = await aiChat('What part of speech is the English word "' + w.word + '"? Answer with ONLY one of: noun, verb, adj, adv, prep, other. No other text.', { temperature: 0, maxTokens: 10 });
      var pos = raw.toLowerCase().replace(/[^a-z]/g, '');
      if (valid.indexOf(pos) !== -1) { w.pos = pos; await dbPut('words', w); done++; } else { fail++; }
    } catch (e) { fail++; }
  }
  setBatchProgress('batchProgress', '✅ 完成！補了 ' + done + ' 個，失敗 ' + fail + ' 個。');
  if (typeof renderWordList === 'function') renderWordList();
}

// 📥 整批匯入
function openBulkImport() {
  var box = document.getElementById('bulkImportBox');
  if (box) box.hidden = !box.hidden;
}

async function runBulkImport() {
  var text = document.getElementById('bulkImportText').value;
  var lines = text.split('\n').map(function(l) { return l.trim(); }).filter(Boolean);
  if (!lines.length) { setBatchProgress('bulkProgress', '請先貼上單字'); return; }
  if (!confirm('將匯入 ' + lines.length + ' 個單字，AI 自動補齊資料。已存在的會跳過。開始嗎？')) return;

  // 既有單字（去重用）
  var existing = await dbGetByIndex('words', 'pool', 'permanent');
  var existSet = {};
  existing.forEach(function(w) { existSet[w.word.trim().toLowerCase()] = true; });

  var added = 0, skipped = 0, fail = 0;
  for (var i = 0; i < lines.length; i++) {
    var word = lines[i];
    setBatchProgress('bulkProgress', '處理中 ' + (i + 1) + '/' + lines.length + '：' + esc(word));
    if (existSet[word.toLowerCase()]) { skipped++; continue; }
    try {
      var data = await aiGenerateForWord(word);
      if (!data) { fail++; continue; }
      await dbAdd('words', {
        word: word,
        meaning: data.meaning || '',
        pos: data.pos || '',
        antonym: '',
        definition: data.definition || '',
        tags: [],
        sentences: Array.isArray(data.sentences) ? data.sentences.filter(Boolean).slice(0, 3) : [],
        images: [],
        imageUrl: null, imageLocal: null,
        pool: 'permanent', createdAt: Date.now()
      });
      existSet[word.toLowerCase()] = true;
      added++;
    } catch (e) { fail++; }
  }
  setBatchProgress('bulkProgress', '✅ 完成！新增 ' + added + '，跳過(已存在) ' + skipped + '，失敗 ' + fail + '。');
  if (typeof renderWordList === 'function') renderWordList();
}


// 🏷️ 批次分類：AI 自動給單字打主題標籤（動物/食物/衣服...）
async function batchClassifyTags() {
  if (!confirm('將為所有單字自動判斷主題並加上標籤（動物、食物、衣服、動作...）。已有標籤的會保留並補充。開始嗎？')) return;
  var words = await dbGetByIndex('words', 'pool', 'permanent');
  if (!words.length) { setBatchProgress('batchProgress', '沒有單字'); return; }
  var done = 0, fail = 0;
  for (var i = 0; i < words.length; i++) {
    var w = words[i];
    setBatchProgress('batchProgress', '分類中 ' + (i + 1) + '/' + words.length + '：' + esc(w.word));
    try {
      var raw = await aiChat(
        'Classify the English word "' + w.word + '" (meaning: ' + (w.meaning || '') + ') into ONE simple theme for a kids vocabulary app. ' +
        'Answer with ONLY a single Traditional Chinese theme word from: 動物, 食物, 水果, 蔬菜, 衣服, 顏色, 數字, 身體, 家庭, 動作, 情緒, 自然, 交通, 物品, 地點, 學校. ' +
        'If none fits, answer 其他. No other text.',
        { temperature: 0, maxTokens: 16 }
      );
      var tag = raw.replace(/[^\u4e00-\u9fa5]/g, '').slice(0, 4);
      if (tag) {
        w.tags = w.tags || [];
        if (w.tags.indexOf(tag) === -1) w.tags.push(tag);
        await dbPut('words', w);
        done++;
      } else { fail++; }
    } catch (e) { fail++; }
  }
  setBatchProgress('batchProgress', '✅ 完成！分類了 ' + done + ' 個，失敗 ' + fail + ' 個。');
  if (typeof renderWordList === 'function') renderWordList();
}
