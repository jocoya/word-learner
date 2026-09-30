// ===== 自動產生單字音檔（Cloud Functions 2nd gen）=====
// 觸發：Firestore words/{docId} 新增或修改
// 只在「單字或例句文字真的改變」時才產生，其他欄位（圖片、標籤…）改動不會呼叫 TTS
//
// 要產生哪些聲音：讀 settings/ttsManifest.autoVoices（在 App 開發者工具「🎚️ 選擇聲音」勾選）
//   沒有設定 → 用 wordVoice / sentenceVoice（目前正在用的聲音）
// 產生結果：
//   Storage  tts/<聲音>/<key>.mp3（與電腦端 tools/tts/generate.js 完全相同的檔名規則）
//   settings/ttsManifest.voices.<聲音>.items.<key> = 'w' | 's'
//
// 安全與費用：
//   - 不需要 API 金鑰：用 Function 的服務帳戶（Application Default Credentials）呼叫 Cloud TTS
//   - 每月字元上限 MONTHLY_CHAR_CAP（記在 settings/ttsUsage），超過就不再產生，App 會退回瀏覽器語音
//   - 已經有的音檔直接跳過；同一句話在不同單字重複也只產生一次

const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { setGlobalOptions, logger } = require('firebase-functions/v2');
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getStorage } = require('firebase-admin/storage');
const crypto = require('crypto');

initializeApp();
const db = getFirestore();
const bucket = getStorage().bucket('eng-workspace.firebasestorage.app');

// 函式同時最多 1 個執行個體：避免多個單字同時寫入時互相覆蓋語音清單，也限制最壞情況的花費
setGlobalOptions({ region: 'asia-east1', maxInstances: 1, memory: '256MiB', timeoutSeconds: 120 });

const TTS_DIR = 'tts';
const LANGUAGE = 'en-US';
const SPEAKING_RATE = 0.9;                 // 與電腦端 config 預設相同
const MONTHLY_CHAR_CAP = 200000;           // 免費額度 100 萬；自動產生另外限制 20 萬，保留給電腦端
const MAX_TEXT_LEN = 400;

// ---------- 與 App / 電腦端完全相同的 key 規則 ----------
function ttsNormalize(text) {
  return String(text || '').replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();
}
function ttsKey(text) {
  return crypto.createHash('sha1').update(ttsNormalize(text), 'utf8').digest('hex').slice(0, 16);
}

function textsOf(data) {
  if (!data || !data.word) return [];
  const out = [{ text: String(data.word).trim(), kind: 'w' }];
  (data.sentences || []).forEach(s => {
    const t = String(s || '').trim();
    if (t && t.length <= MAX_TEXT_LEN) out.push({ text: t, kind: 's' });
  });
  return out.filter(x => x.text);
}

function monthKey() {
  const d = new Date();
  // 台灣時間的月份
  const tw = new Date(d.getTime() + 8 * 3600 * 1000);
  return tw.getUTCFullYear() + '-' + String(tw.getUTCMonth() + 1).padStart(2, '0');
}

// 用 Function 的服務帳戶取得存取權杖（不需要 API 金鑰）
const credential = applicationDefault();

async function synthesize(text, voiceName) {
  const { access_token: token } = await credential.getAccessToken();
  const res = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({
      input: { text },
      voice: { languageCode: LANGUAGE, name: LANGUAGE + '-Chirp3-HD-' + voiceName },
      audioConfig: { audioEncoding: 'MP3', speakingRate: SPEAKING_RATE }
    })
  });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + (await res.text().catch(() => '')).slice(0, 200));
  const data = await res.json();
  if (!data.audioContent) throw new Error('TTS 沒有回傳音訊');
  return Buffer.from(data.audioContent, 'base64');
}

exports.autoWordAudio = onDocumentWritten('words/{docId}', async (event) => {
  const before = event.data && event.data.before && event.data.before.exists ? event.data.before.data() : null;
  const after = event.data && event.data.after && event.data.after.exists ? event.data.after.data() : null;
  if (!after) return;                                    // 刪除單字：保留音檔（別的字可能用到同一句）

  // 只處理「新出現」的文字
  const beforeKeys = new Set(textsOf(before).map(t => ttsKey(t.text)));
  const fresh = textsOf(after).filter(t => !beforeKeys.has(ttsKey(t.text)));
  if (!fresh.length) return;

  const manifestRef = db.collection('settings').doc('ttsManifest');
  const manifestSnap = await manifestRef.get();
  const manifest = manifestSnap.exists ? manifestSnap.data() : {};
  if (manifest.autoEnabled === false) { logger.info('自動產生已關閉'); return; }
  const voices = manifest.voices || {};
  // 要自動產生的聲音：autoVoices（使用者勾選）→ 沒設定就用目前的單字/句子聲音
  let targets = Array.isArray(manifest.autoVoices) && manifest.autoVoices.length
    ? manifest.autoVoices
    : [manifest.wordVoice, manifest.sentenceVoice];
  targets = Array.from(new Set(targets.filter(v => typeof v === 'string' && /^[A-Za-z]+$/.test(v))));
  if (!targets.length) { logger.info('沒有設定要產生的聲音'); return; }

  // 本月用量
  const usageRef = db.collection('settings').doc('ttsUsage');
  const usageSnap = await usageRef.get();
  const month = monthKey();
  const used = (usageSnap.exists && usageSnap.data()[month]) || 0;

  const added = {};        // voice → { key: kind }
  let spent = 0;
  for (const voice of targets) {
    const folder = (voices[voice] && voices[voice].folder) || voice;
    const have = (voices[voice] && voices[voice].items) || {};
    for (const t of fresh) {
      const key = ttsKey(t.text);
      if (have[key] || (added[voice] && added[voice][key])) continue;
      if (used + spent + t.text.length > MONTHLY_CHAR_CAP) {
        logger.warn('本月自動產生已達上限 ' + MONTHLY_CHAR_CAP + ' 字元，停止產生');
        break;
      }
      const file = bucket.file(TTS_DIR + '/' + folder + '/' + key + '.mp3');
      try {
        const [exists] = await file.exists();
        if (!exists) {
          const mp3 = await synthesize(t.text, voice);
          await file.save(mp3, { contentType: 'audio/mpeg', metadata: { cacheControl: 'public,max-age=31536000' } });
          spent += t.text.length;
        }
        (added[voice] = added[voice] || {})[key] = t.kind;
      } catch (e) {
        logger.error('產生失敗', { voice, text: t.text.slice(0, 60), error: e.message });
      }
    }
  }

  const voiceNames = Object.keys(added);
  if (!voiceNames.length) return;

  // 用欄位路徑更新：只加新的 key，不會覆蓋 App 或電腦端同時寫入的其他內容
  const updates = { updatedAt: Date.now() };
  voiceNames.forEach(v => {
    if (!voices[v]) updates['voices.' + v + '.folder'] = v;
    Object.keys(added[v]).forEach(k => { updates['voices.' + v + '.items.' + k] = added[v][k]; });
  });
  if (manifestSnap.exists) await manifestRef.update(updates);
  else {
    const init = { key: 'ttsManifest', voices: {}, wordVoice: voiceNames[0], sentenceVoice: voiceNames[0], updatedAt: Date.now() };
    voiceNames.forEach(v => { init.voices[v] = { folder: v, items: added[v] }; });
    await manifestRef.set(init);
  }
  if (spent) await usageRef.set({ key: 'ttsUsage', [month]: FieldValue.increment(spent) }, { merge: true });
  logger.info('已產生', { word: after.word, voices: voiceNames, chars: spent });
});

// 測試用匯出
exports._test = { ttsNormalize, ttsKey, textsOf };
