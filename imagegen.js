// ===== 本地生圖（SwarmUI）統一介面 =====
// 用例句/單字當 prompt → SwarmUI 生圖 → 上傳 Firebase Storage → 回傳 URL。
// 抽象成 generateImage()，未來換後端只改這裡。

var IMG_DEFAULTS = {
  provider: 'swarmui',                        // 目前只有 swarmui
  swarmHost: 'http://100.125.96.108:7801',    // 平板經 Tailscale，電腦本機會自動轉 localhost
  model: 'Juggernaut_XL_-_Ragnarok',          // 你下載的模型（檔名，不含副檔名/資料夾）
  width: 1024,
  height: 1024,
  steps: 25,
  cfgscale: 6,
  // 給小孩看的安全前綴/負面詞，避免生出不適當內容
  stylePrefix: 'a wholesome, friendly, colorful illustration for young children, ',
  negative: 'nsfw, nude, naked, sexual, violence, blood, scary, horror, weapon, gore, disturbing, deformed, ugly, text, watermark'
};

async function getImgSettings() {
  var s = await dbGet('settings', 'imgConfig');
  return Object.assign({ key: 'imgConfig' }, IMG_DEFAULTS, s || {});
}
async function saveImgSettings(cfg) {
  cfg.key = 'imgConfig';
  await dbPut('settings', cfg);
}

function imgLocalizeHost(host) {
  if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
    return host.replace(/\/\/100\.\d+\.\d+\.\d+/, '//localhost').replace(/\/\/[\d.]+:/, '//localhost:');
  }
  return host;
}

async function imgFetch(url, opts, timeoutMs) {
  timeoutMs = timeoutMs || 120000; // 生圖較久，給 2 分鐘
  var controller = new AbortController();
  var timer = setTimeout(function(){ controller.abort(); }, timeoutMs);
  try {
    var res = await fetch(url, Object.assign({}, opts, { signal: controller.signal }));
    clearTimeout(timer);
    return res;
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('生圖逾時（' + (timeoutMs/1000) + '秒）');
    if (e instanceof TypeError) {
      throw new Error('連線錯誤（' + (e.message || 'fetch failed') + '）— 確認 SwarmUI 有開、位址對、CORS=*');
    }
    throw e;
  }
}

// 核心：用 prompt 生一張圖，回傳「SwarmUI 圖片的完整 URL」
async function swarmGenerate(prompt) {
  var cfg = await getImgSettings();
  var host = imgLocalizeHost(cfg.swarmHost).replace(/\/$/, '');

  // 1. 取得 session
  var sRes;
  try {
    sRes = await imgFetch(host + '/API/GetNewSession', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
    }, 20000);
  } catch (e) {
    throw new Error('[步驟1 連線 SwarmUI 失敗] ' + e.message);
  }
  if (!sRes.ok) throw new Error('[步驟1] GetNewSession HTTP ' + sRes.status);
  var sData = await sRes.json();
  var session = sData.session_id;
  if (!session) throw new Error('[步驟1] 拿不到 session_id');

  // 2. 生圖
  var body = {
    session_id: session,
    images: 1,
    prompt: cfg.stylePrefix + prompt,
    negativeprompt: cfg.negative,
    model: cfg.model,
    width: cfg.width,
    height: cfg.height,
    steps: cfg.steps,
    cfgscale: cfg.cfgscale,
    seed: -1
  };
  var gRes;
  try {
    gRes = await imgFetch(host + '/API/GenerateText2Image', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
    });
  } catch (e) {
    throw new Error('[步驟2 生圖請求失敗] ' + e.message);
  }
  if (!gRes.ok) throw new Error('[步驟2] GenerateText2Image HTTP ' + gRes.status);
  var gData = await gRes.json();
  if (gData.error) throw new Error('[步驟2] SwarmUI: ' + gData.error);
  if (!gData.images || !gData.images.length) throw new Error('[步驟2] SwarmUI 沒回傳圖片');

  // 3. 組完整圖片 URL（SwarmUI 回的是相對路徑）
  var imgPath = gData.images[0];
  var fullUrl = imgPath.indexOf('http') === 0 ? imgPath : (host + '/' + imgPath.replace(/^\//, ''));
  return fullUrl;
}

// 把 SwarmUI 生的圖抓下來變 blob → 上傳 Firebase Storage → 回傳永久 URL
async function generateAndUploadImage(prompt, wordForName) {
  var swarmUrl = await swarmGenerate(prompt);
  // 抓圖
  var res = await imgFetch(swarmUrl, { method: 'GET' }, 60000);
  if (!res.ok) throw new Error('下載生成圖失敗 HTTP ' + res.status);
  var blob = await res.blob();
  // 上傳 Storage（複用 db.js 的 storage）
  var safe = (wordForName || 'gen').toLowerCase().replace(/[^a-z0-9]/g, '_');
  var filename = 'gen_' + safe + '_' + Date.now() + '.png';
  var ref = storage.ref('word_images/' + filename);
  var snap = await ref.put(blob, { contentType: 'image/png' });
  var downloadUrl = await snap.ref.getDownloadURL();
  return downloadUrl;
}

// 測試 SwarmUI 連線
async function imgTestConnection() {
  try {
    var cfg = await getImgSettings();
    var host = imgLocalizeHost(cfg.swarmHost).replace(/\/$/, '');
    var r = await imgFetch(host + '/API/GetNewSession', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
    }, 15000);
    if (!r.ok) return { ok: false, error: 'HTTP ' + r.status };
    var d = await r.json();
    return d.session_id ? { ok: true } : { ok: false, error: '無 session_id' };
  } catch (e) { return { ok: false, error: e.message }; }
}

// ===== 生圖設定面板 =====
async function openImgSettings() {
  var cfg = await getImgSettings();
  var modal = document.getElementById('modal-img');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-img';
    modal.className = 'modal';
    document.body.appendChild(modal);
  }
  modal.innerHTML =
    '<div class="modal-content ai-settings">' +
      '<h3>🎨 生圖設定（SwarmUI）</h3>' +
      '<div class="ai-row"><label>SwarmUI 位址</label><input id="imgHost" value="' + esc(cfg.swarmHost) + '"></div>' +
      '<div class="ai-row"><label>模型名稱</label><input id="imgModel" value="' + esc(cfg.model) + '"></div>' +
      '<div class="ai-row"><label>步數</label><input id="imgSteps" type="number" value="' + cfg.steps + '"></div>' +
      '<div class="ai-row"><label>CFG</label><input id="imgCfg" type="number" step="0.5" value="' + cfg.cfgscale + '"></div>' +
      '<div class="ai-hint">模型名稱填 SwarmUI 模型下拉顯示的名字（例如 Juggernaut_XL_-_Ragnarok）。若在子資料夾，要含路徑如 SDXL/xxx。</div>' +
      '<div class="ai-output" id="imgTestOut"></div>' +
      '<div style="display:flex;gap:8px;margin-top:12px;">' +
        '<button class="btn-primary" onclick="imgSaveSettings()">儲存</button>' +
        '<button class="dev-btn" onclick="imgRunTest()">🔌 測試連線</button>' +
        '<button class="dev-btn" onclick="imgTryGenerate()">🖼️ 試生一張</button>' +
        '<button class="btn-ghost" onclick="hideModal(\'modal-img\')">關閉</button>' +
      '</div>' +
    '</div>';
  modal.hidden = false;
}

async function imgSaveSettings() {
  var cfg = await getImgSettings();
  cfg.swarmHost = document.getElementById('imgHost').value.trim();
  cfg.model = document.getElementById('imgModel').value.trim();
  cfg.steps = parseInt(document.getElementById('imgSteps').value) || 25;
  cfg.cfgscale = parseFloat(document.getElementById('imgCfg').value) || 6;
  await saveImgSettings(cfg);
  document.getElementById('imgTestOut').innerHTML = '✅ 已儲存';
}

async function imgRunTest() {
  document.getElementById('imgTestOut').innerHTML = '測試中...';
  await imgSaveSettings();
  var r = await imgTestConnection();
  document.getElementById('imgTestOut').innerHTML = r.ok ? '✅ 連線成功' : '❌ ' + esc(r.error);
}

async function imgTryGenerate() {
  document.getElementById('imgTestOut').innerHTML = '生成中（可能要幾十秒）...';
  await imgSaveSettings();
  try {
    var url = await swarmGenerate('a cute cat sitting in a garden');
    document.getElementById('imgTestOut').innerHTML = '✅ 生成成功！<br><img src="' + url + '" style="max-width:200px;border-radius:8px;margin-top:6px;">';
  } catch (e) {
    document.getElementById('imgTestOut').innerHTML = '❌ ' + esc(e.message);
  }
}


// ===== 整合到單字編輯：用例句/單字生圖，結果填進圖片欄位 =====
// prefix: 'new' | 'exam' | 'edit'
async function aiGenImageForWord(prefix) {
  prefix = prefix || 'new';
  var wordId = prefix === 'edit' ? 'editWord' : (prefix === 'exam' ? 'examNewWord' : 'newWord');
  var word = (document.getElementById(wordId) || {}).value;
  word = word ? word.trim() : '';
  if (!word) return alert('請先輸入英文單字');

  // 優先用第一個有內容的例句當 prompt，沒有就用單字本身
  var sentIds = prefix === 'edit'
    ? ['editSentence1','editSentence2','editSentence3']
    : (prefix === 'exam' ? ['examNewSentence1','examNewSentence2','examNewSentence3'] : ['newSentence1','newSentence2','newSentence3']);
  var prompt = '';
  for (var i = 0; i < sentIds.length; i++) {
    var el = document.getElementById(sentIds[i]);
    if (el && el.value && el.value.trim() && el.value !== '生成中...') { prompt = el.value.trim(); break; }
  }
  if (!prompt) prompt = word; // 沒例句就用單字

  var btn = document.getElementById('genImgBtn_' + prefix);
  var orig = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = '🎨 生成中(數十秒)...'; }

  try {
    var url = await generateAndUploadImage(prompt, word);
    // 填進第一個空的圖片 URL 欄位
    var imgFieldIds = prefix === 'edit'
      ? null  // edit 用動態圖片列
      : (prefix === 'exam' ? ['examNewImageUrl1','examNewImageUrl2','examNewImageUrl3'] : ['newImageUrl1','newImageUrl2','newImageUrl3']);
    if (imgFieldIds) {
      var placed = false;
      for (var j = 0; j < imgFieldIds.length; j++) {
        var f = document.getElementById(imgFieldIds[j]);
        if (f && !f.value.trim()) { f.value = url; placed = true; break; }
      }
      if (!placed) { var f0 = document.getElementById(imgFieldIds[0]); if (f0) f0.value = url; }
      // 預覽
      var prevId = prefix === 'exam' ? 'examImagePreview' : 'imagePreview';
      var prev = document.getElementById(prevId);
      if (prev) { prev.hidden = false; prev.innerHTML += '<img src="' + url + '" style="max-height:80px;border-radius:8px;margin:4px;">'; }
    } else {
      // 編輯模式：加一列圖片
      if (typeof addEditImageRow === 'function') addEditImageRow(url);
    }
    if (btn) { btn.textContent = '✅ 完成！'; setTimeout(function(){ btn.textContent = orig; btn.disabled = false; }, 1500); }
  } catch (e) {
    alert('生圖失敗：' + e.message + '\n（請確認 SwarmUI 有開、生圖設定的位址正確，可到「🎨 生圖設定」測試連線）');
    if (btn) { btn.textContent = orig; btn.disabled = false; }
  }
}
