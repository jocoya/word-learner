#!/usr/bin/env node
// ===== 語音產生工具（電腦端，Node 18+，不需安裝任何套件）=====
// 讀取 App 匯出的備份檔 → 用 Google Cloud TTS（Chirp 3 HD）產生 MP3 → 存到 tools/tts/output/
// 之後在 App「開發者模式 → 匯入語音包」選 output 資料夾裡的檔案上傳到 Firebase Storage。
//
// 用法：
//   node tools/tts/generate.js <備份檔.json> --sample        先做 5 個字試聽（預設）
//   node tools/tts/generate.js <備份檔.json> --words         只做單字
//   node tools/tts/generate.js <備份檔.json> --all           單字 + 例句
//   加 --voice Achird   用指定聲音（沒加就用 config.json 的 voice）
//   加 --dry  只估算字元數，不呼叫 API
//
// 多聲音：每個聲音輸出到 output/<聲音名>/，互不覆蓋；App 裡可切換或混用
//
// 設計：
//   - 檔名 = 文字雜湊（同一句話永遠同一個檔），已產生過的自動跳過，中斷後可接著跑
//   - 每次執行前估算字元數；超過本月預算（config.monthlyCharBudget）就停止，不會多花錢
//   - 本月已用字元記錄在 output/usage.json（依月份分開）

'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TOOL_DIR = __dirname;
const OUT_ROOT = path.join(TOOL_DIR, 'output');
// 用量記錄是整個專案共用（免費額度是專案層級），放在 output 根目錄
const USAGE = path.join(OUT_ROOT, 'usage.json');
const SAMPLE_COUNT = 5;

// 聲音短名：en-US-Chirp3-HD-Achird → Achird（資料夾與 Storage 路徑都用它）
function voiceShort(voice) {
  const m = String(voice || '').match(/([A-Za-z]+)$/);
  return m ? m[1] : 'voice';
}
// 每個聲音一個資料夾：output/<短名>/audio/*.mp3 + output/<短名>/manifest.json
function voicePaths(voice) {
  const dir = path.join(OUT_ROOT, voiceShort(voice));
  return { dir, audio: path.join(dir, 'audio'), manifest: path.join(dir, 'manifest.json') };
}

// ---------- 共用：文字正規化與雜湊（必須和 App 端 tts.js 完全一致）----------
function ttsNormalize(text) {
  return String(text || '').replace(/[’‘]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();
}
function ttsKey(text) {
  return crypto.createHash('sha1').update(ttsNormalize(text), 'utf8').digest('hex').slice(0, 16);
}

// ---------- 設定 ----------
function loadConfig() {
  const p = path.join(TOOL_DIR, 'config.json');
  if (!fs.existsSync(p)) {
    fail('找不到 tools/tts/config.json\n請複製 config.example.json 另存成 config.json，並貼上你的 API 金鑰。');
  }
  const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (!cfg.apiKey || /貼在這裡/.test(cfg.apiKey)) fail('config.json 裡的 apiKey 還沒填。');
  return Object.assign({ voice: 'en-US-Chirp3-HD-Sulafat', languageCode: 'en-US', speakingRate: 0.9,
    monthlyCharBudget: 900000, requestsPerMinute: 150 }, cfg);
}

function fail(msg) { console.error('\n❌ ' + msg + '\n'); process.exit(1); }
function readJson(p, fallback) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return fallback; } }
function monthKey() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }

// ---------- 收集要念的文字 ----------
function collectTexts(backup, mode) {
  const words = (backup.words || []).filter(w => w && w.word);
  // 永久庫優先，其次考試包；同一個字只算一次
  words.sort((a, b) => (a.pool === 'permanent' ? 0 : 1) - (b.pool === 'permanent' ? 0 : 1));
  const seen = new Set();
  const items = [];
  function add(text, kind) {
    const t = String(text || '').trim();
    if (!t || t.length > 400) return;
    const k = ttsKey(t);
    if (seen.has(k)) return;
    seen.add(k);
    items.push({ key: k, text: t, kind });
  }
  words.forEach(w => add(w.word, 'word'));
  if (mode === 'all') words.forEach(w => (w.sentences || []).forEach(s => add(s, 'sentence')));
  return items;
}

// ---------- 呼叫 Cloud TTS ----------
async function synthesize(cfg, text) {
  const url = 'https://texttospeech.googleapis.com/v1/text:synthesize?key=' + encodeURIComponent(cfg.apiKey);
  const body = {
    input: { text },
    voice: { languageCode: cfg.languageCode, name: cfg.voice },
    audioConfig: { audioEncoding: 'MP3', speakingRate: cfg.speakingRate }
  };
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) {
      const data = await res.json();
      if (!data.audioContent) throw new Error('API 沒有回傳音訊');
      return Buffer.from(data.audioContent, 'base64');
    }
    const errText = await res.text().catch(() => '');
    // 429 超過頻率 / 5xx 暫時錯誤 → 等一下再試
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      const wait = 2000 * attempt * attempt;
      console.log('   ⏳ HTTP ' + res.status + '，' + (wait / 1000) + ' 秒後重試…');
      await sleep(wait);
      continue;
    }
    // 403 常見原因：API 沒啟用 / 金鑰沒勾 Text-to-Speech / 沒有綁帳單
    throw new Error('HTTP ' + res.status + ' ' + errText.slice(0, 300));
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ---------- 主程式 ----------
async function main() {
  const args = process.argv.slice(2);
  const file = args.find(a => !a.startsWith('--'));
  const mode = args.includes('--all') ? 'all' : (args.includes('--words') ? 'words' : 'sample');
  const dry = args.includes('--dry');
  if (!file) fail('請指定備份檔，例如：node tools/tts/generate.js word-learner-backup-2026-09-30.json --sample');
  if (!fs.existsSync(file)) fail('找不到備份檔：' + file);

  const cfg = dry ? Object.assign({ monthlyCharBudget: 900000, requestsPerMinute: 150, voice: 'en-US-Chirp3-HD-Sulafat' }, readJson(path.join(TOOL_DIR, 'config.json'), {})) : loadConfig();
  // --voice Achird 或 --voice en-US-Chirp3-HD-Achird
  const vi = args.indexOf('--voice');
  if (vi !== -1 && args[vi + 1]) {
    const v = args[vi + 1];
    cfg.voice = /^[a-z]{2}-[A-Z]{2}-/.test(v) ? v : (cfg.languageCode || 'en-US') + '-Chirp3-HD-' + v.charAt(0).toUpperCase() + v.slice(1);
  }
  const backup = readJson(file, null);
  if (!backup || !Array.isArray(backup.words)) fail('備份檔格式不對（需要 App「匯出全部資料」產生的 JSON）。');

  const P = voicePaths(cfg.voice);
  migrateOldOutput();
  fs.mkdirSync(P.audio, { recursive: true });
  const manifest = readJson(P.manifest, { voice: cfg.voice, items: {} });
  manifest.voice = cfg.voice;
  const AUDIO_DIR = P.audio;
  const writeManifest = (m) => fs.writeFileSync(P.manifest, JSON.stringify(m, null, 1));

  let items = collectTexts(backup, mode === 'sample' ? 'words' : mode);
  if (mode === 'sample') items = items.slice(0, SAMPLE_COUNT);
  const todo = items.filter(it => !(manifest.items[it.key] && fs.existsSync(path.join(AUDIO_DIR, it.key + '.mp3'))));
  const chars = todo.reduce((n, it) => n + it.text.length, 0);

  const usage = readJson(USAGE, {});
  const month = monthKey();
  const used = usage[month] || 0;
  console.log('\n🎙️  聲音：' + cfg.voice + '　模式：' + mode);
  console.log('   共 ' + items.length + ' 筆，已完成 ' + (items.length - todo.length) + '，這次要做 ' + todo.length + ' 筆');
  console.log('   這次約 ' + chars.toLocaleString() + ' 字元；本月已用 ' + used.toLocaleString() + ' / 預算 ' + cfg.monthlyCharBudget.toLocaleString());

  if (!todo.length) { console.log('\n✅ 全部都做好了！\n'); writeManifest(manifest); return; }
  if (used + chars > cfg.monthlyCharBudget) {
    fail('這次會超過本月預算（免費額度每月 100 萬字元）。可以先用 --words 只做單字，或下個月再跑例句。');
  }
  if (dry) { console.log('\n（--dry 只估算，沒有呼叫 API）\n'); return; }

  const gap = Math.ceil(60000 / Math.max(1, cfg.requestsPerMinute));
  let done = 0, failed = 0, spent = 0;
  for (const it of todo) {
    try {
      const mp3 = await synthesize(cfg, it.text);
      fs.writeFileSync(path.join(AUDIO_DIR, it.key + '.mp3'), mp3);
      manifest.items[it.key] = { text: it.text, kind: it.kind, bytes: mp3.length };
      spent += it.text.length;
      done++;
      // 每 20 筆存一次進度，中斷也不會白做
      if (done % 20 === 0) { saveUsage(usage, month, used + spent); writeManifest(manifest); }
      process.stdout.write('\r   進度 ' + done + ' / ' + todo.length + (failed ? '（失敗 ' + failed + '）' : '') + '   ');
    } catch (e) {
      failed++;
      console.log('\n   ⚠️  「' + it.text.slice(0, 40) + '」失敗：' + e.message);
      if (/HTTP 40[0-9]/.test(e.message) && failed >= 3 && done === 0) {
        saveUsage(usage, month, used + spent); writeManifest(manifest);
        fail('連續失敗，請檢查：\n  1. eng-workspace 專案有啟用 Cloud Text-to-Speech API\n  2. 金鑰的 API 限制有勾 Cloud Text-to-Speech API\n  3. 專案有綁定帳單帳戶');
      }
    }
    await sleep(gap);
  }
  saveUsage(usage, month, used + spent);
  writeManifest(manifest);
  console.log('\n\n✅ 完成 ' + done + ' 筆' + (failed ? '，失敗 ' + failed + ' 筆（再跑一次會重試失敗的）' : '') + '。');
  console.log('   音檔在：' + AUDIO_DIR);
  if (mode === 'sample') console.log('   先打開幾個 mp3 試聽，滿意再用 --words 或 --all 做全部。');
  console.log('   上傳：電腦 Chrome 開 App → 首頁標題連點 3 下 → 🎙️ 匯入語音包 → 選 tools\\tts\\output\\' + voiceShort(cfg.voice) + ' 資料夾\n');
}

// 舊版（v69）輸出在 output/audio + output/manifest.json → 搬到 output/<聲音名>/
function migrateOldOutput() {
  const oldManifest = path.join(OUT_ROOT, 'manifest.json');
  const oldAudio = path.join(OUT_ROOT, 'audio');
  if (!fs.existsSync(oldManifest)) return;
  const m = readJson(oldManifest, null);
  if (!m || !m.voice) return;
  const P = voicePaths(m.voice);
  if (fs.existsSync(P.manifest)) return;
  fs.mkdirSync(P.dir, { recursive: true });
  if (fs.existsSync(oldAudio)) fs.renameSync(oldAudio, P.audio);
  fs.renameSync(oldManifest, P.manifest);
  console.log('   （已把舊的 ' + voiceShort(m.voice) + ' 音檔搬到 output\\' + voiceShort(m.voice) + '）');
}

function saveUsage(u, month, value) { fs.mkdirSync(OUT_ROOT, { recursive: true }); u[month] = value; fs.writeFileSync(USAGE, JSON.stringify(u, null, 1)); }

if (require.main === module) {
  main().catch(e => fail(e.stack || e.message));
}

module.exports = { ttsNormalize, ttsKey, collectTexts, voiceShort, voicePaths };
