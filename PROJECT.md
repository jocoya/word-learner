# 英文單字學習樂園 — 專案說明（給接手的 AI / 開發者）

> **接手前必讀。** 這份文件記錄了專案的架構、關鍵設計決策與雷區。
> 在動任何程式碼之前，請先完整讀完本文件，特別是「⚠️ 雷區」一節。

---

## 專案概觀

一個給小孩（4 歲～小學）在遊戲中學英文單字的 PWA（漸進式網頁應用）。

- **技術棧**：純原生 HTML / CSS / JavaScript，**無框架、無打包工具、無 build 步驟**。
- **後端**：Firebase（Firestore 存資料、Storage 存圖片/音檔、Auth 匿名登入）。
- **離線**：Service Worker（`sw.js`）+ IndexedDB 雙層快取。
- **部署**：GitHub Pages（注意：`.github/workflows/deploy.yml` 目前部署的是 `food-picker` 資料夾，若要自動部署 word-learner 需修改 `path`）。
- **本機 AI**：透過 Ollama（電腦 localhost / 平板經 Tailscale）生成英英解釋與例句。

> ⚠️ **不要引入 React / Vue / webpack / npm 打包流程。** 這個專案刻意保持零依賴、可直接用瀏覽器開啟。

---

## 檔案結構與載入順序

`index.html` 底部的 script 載入順序**有依賴關係，不可隨意調動**：

```
firebase SDK (CDN)
db.js            ← Firebase 初始化、IndexedDB CRUD、舊版 SM-2 演算法、getDueWords
fsrs-engine.js   ← FSRS 演算法、多小孩進度分流、遊戲難度門檻
games/*.js       ← 11 個遊戲（memory, listen, fillblank, spelling, speak, bubble, echo, flashlight, detective, match, cloze）
app.js           ← 全域狀態、頁面導航、單字/考試包管理、每日挑戰（舊版）、工具函式
coins.js         ← 金幣庫、禮券、寶箱（覆蓋 app.js 的 renderCoinPage 等）
patches.js       ← ⚠️ Monkey-patch 覆蓋層（最後載入，覆蓋前面的多個函式）
```

### 各檔案職責

| 檔案 | 職責 |
|---|---|
| `db.js` | Firebase 初始化、`dbAdd/dbPut/dbGet/dbDelete/dbGetByIndex`（IndexedDB + Firestore 雙寫）、圖片上傳 Storage、**舊版** `calcNextReview`(SM-2) 與 `getDueWords` |
| `fsrs-engine.js` | FSRS-4.5 演算法、`gameToRating`、`recordGameResult`、多小孩進度分流（`currentChild`/`progressId`/`getProgressFor`）、`getDueWordsFSRS`、遊戲難度門檻 `GAME_MIN_STABILITY` |
| `app.js` | 全域變數、`goTo` 導航、`enterMode`、小孩切換 `setChild`、單字 CRUD、考試包管理、畢業合併、AI 生成、圖片搜尋、**舊版** `updateProgress`、`startDailyMix`（已被 patches 取代） |
| `coins.js` | `renderCoinPage`、`confirmRedeem`、寶箱 `openChest`、`renderCalendar`（覆蓋 app.js 同名函式） |
| `patches.js` | **覆蓋** `updateProgress`(→FSRS)、`getGameWords`(+難度門檻)、`startGame`(+預載)、`startDailyWithRole`(→新版每日挑戰)、圖片預載、多巴胺獎勵系統 |

---

## ⚠️ 雷區（最容易踩的坑）

### 1. `patches.js` 是 Monkey-Patch 覆蓋層
`patches.js` 在最後載入，用 `funcName = function...` 的方式**覆蓋** `app.js` 與 `db.js` 裡的多個函式。

- 看到 `app.js` 裡的 `updateProgress`（舊 SM-2）**不是實際執行的版本**。實際跑的是 `patches.js` 裡覆蓋後的版本（走 FSRS）。
- 同理 `getGameWords`、`startGame`、`startDailyWithRole` 都被 patches.js 覆蓋。
- **改任何函式前，先全域搜尋該函式名，確認它有沒有在 patches.js 被覆蓋。**

### 2. 學習進度（progress）的 key 是複合鍵
- 進度儲存 key 格式為 `"{wordId}_{child}"`，例如 `"5_boy"`、`"5_girl"`。
- 純數字 key（如 `5`）是**舊版共用進度**，作為「lazy 分流」的繼承基礎，**不要刪、不要直接覆寫**。
- 存取進度**一律**透過 `fsrs-engine.js` 的 `getProgressFor(wordId)` 與 `progressId(wordId)`，不要自己拼 key。
- `currentChild`（全域變數，宣告在 `fsrs-engine.js`）決定當前是哪個小孩。由首頁 👦/👧 按鈕（`setChild`）或每日挑戰設定。

### 3. 資料雙寫 IndexedDB + Firestore
- `dbAdd/dbPut/dbDelete` 會同時寫本地 IndexedDB 與雲端 Firestore。
- 不能只改其中一邊。
- Firestore 文件 ID 規則：`words` 用 `_firestoreId`、`settings` 用 `key`、`progress` 用 `String(wordId)`。

### 4. Service Worker 快取版本
- 改了**任何**前端檔案後，必須 bump `sw.js` 最上方的 `CACHE` 常數（例如 `word-learner-v15` → `v16`）。
- 否則平板/PWA 會繼續用舊的快取檔案，看不到更新。
- 版本號慣例：簡單遞增 `vN`。

### 5. 遊戲統一回報介面
每個遊戲結束一題時呼叫：
```js
updateProgress(wordId, isCorrect, gameType, { mistakes, timeUsed, hintUsed });
```
- `gameType` 必填（'memory'|'listen'|'bubble'|'spelling'|'fillblank'|'detective'|'flashlight'|'echo'|'speak'）。
- 這個 payload 是 FSRS 評分的依據（`gameToRating`），格式不可亂改。
- 沒帶 `gameType` 會走舊版 SM-2 邏輯（向後相容用）。

### 6. Firebase 安全規則會過期
- Firestore / Storage 的「測試模式」安全規則有期限，到期後會拒絕所有讀寫（曾導致「平板看不到資料」）。
- 規則建議設為 `allow read, write: if request.auth != null;`（搭配匿名登入）。

---

## 核心系統說明

### FSRS 間隔重複系統
- `fsrs-engine.js` 實作簡化版 FSRS-4.5，用 `stability`(S) 與 `difficulty`(D) 追蹤記憶。
- 遊戲表現 → `gameToRating()` → 1~4 分（Again/Hard/Good/Easy）→ `fsrsReview()` 更新 S/D。
- 階段門檻：S≥2 / S≥8 / S≥20 解鎖「熟悉期 / 應用期 / 大師期」，觸發寶箱獎勵。

### 遊戲難度門檻（鷹架理論）
- `GAME_MIN_STABILITY` 定義每個遊戲的最低 S 要求（memory/listen/flashlight=0、bubble/echo=1、spelling/speak=4、fillblank/detective=10）。
- 自選遊戲時，依當前小孩的單字 S 篩選可玩單字。
- **小寶貝模式（baby）不套用門檻**（讓 4 歲無壓力玩）。

### 多小孩分流（boy / girl）
- 兩個小孩**共用同一個單字庫**（words 只有一份），但**進度各自獨立**（`_boy` / `_girl`）。
- Lazy 分流：某小孩第一次玩某單字時，繼承舊共用進度當起點，之後獨立累積。
- 金幣 `coins.boy`/`coins.girl`、禮券 `coins.rewardsBoy`/`coins.rewardsGirl` 也分開。
- 「換小孩」是首頁按鈕（`setChild`），**與登入帳號無關**，不需重新登入。

### 每日挑戰（patches.js 的 startDailyWithRole）
- 固定流程 + FSRS 區段篩選 + 程度自適應（萌新/中級/高級）。
- 程度可手動設定或「自動」（依該小孩平均 S 判定）。
- 各區段單字不足會自動跳過。

### 句子排列的語塊切分（fillblank.js 的 chunkSentence）
- 把例句切成「語塊」教英文自然組合方式。
- 規則：目標單字獨立成塊、主詞/動詞切開（SVO）、冠詞+形容詞+名詞 黏一塊、介系詞片語黏一塊、be/助動詞+動詞黏一塊。

---

## 資料結構

### words（單字）
```js
{
  id, word, meaning, pos, antonym, definition,
  tags: [], sentences: [], images: [],
  pool: 'permanent' | 'exam-{examId}',
  createdAt,
  _firestoreId, _localId  // Firebase 同步用
  // 未來 TTS：audioWord, audioSentences[]（音檔存 Storage，這裡存 URL）
}
```

### progress（學習進度）
```js
{
  wordId: "5_boy",  // 複合鍵！
  stability, difficulty, reps, lapses, state,
  lastReview, due, interval, streak,
  totalCorrect, totalAttempts,
  unlockedStages: [], todayReviewed,
  nextReview  // 相容舊欄位
}
```

### settings（key-value）
- `key: 'coins'` → 金幣、禮券、寶箱紀錄
- `key: 'daily'` → 每日挑戰完成日期、連續天數
- `key: 'dailyLevels'` → 每個小孩的程度設定
- `key: 'currentChild'` → 上次選的小孩

### 遊戲清單（11 個）
- **match（連連看）**：英文↔中文配對，連對發音一次。需 ≥4 字，S 門檻 0。
- **cloze（讀句選字）**：顯示挖空例句+朗讀，選正確單字（情境記憶）。需有例句，S 門檻 3。
- 其餘 9 個見各 games/*.js。

### 學習報告（patches.js 的 renderReport）
- 頁面 `page-report`，依小孩顯示：單字總數、已學、今日待複習、各階段分布長條圖、需加強單字（lapses≥2）。
- 純 CSS 長條圖，無圖表庫。

---

## 待辦 / 規劃中（依討論順序）

1. **離線快取強化**：Storage 圖片/音檔改「快取優先」、首頁「清除快取」按鈕（顯示用量）、「更新」按鈕、右下角版本號。
2. **TTS 語音**：用「TTS 供應商介面」抽象化 → 先接 Google Cloud TTS（預生成存 Storage、存 URL）→ 未來可切換本地 Piper/CosyVoice。`speakWord` 改為「有音檔播音檔、無則 fallback 內建 speechSynthesis」。
3. **Google 登入**：取代脆弱的匿名登入，用 `linkWithCredential` 把匿名帳號升級成 Google 帳號（保留現有資料）。做之前務必先匯出 JSON 備份。
4. **匯出強化**：目前 `exportAllData` 只匯出 words/exams/progress，**未含 coins/settings**，應補上讓備份完整。

---

## 開發注意事項

- **改 FSRS 或進度邏輯前，先匯出 JSON 備份**（首頁 → 管理單字 → 匯出/匯入）。
- 用 `git` 小步提交，方便回退。
- 平板測試前記得 bump `sw.js` 版本，並在平板上重開 PWA / 按更新。
- 語音 `speakWord(text, rate)` 目前用瀏覽器內建 `speechSynthesis`，全 app 共用，被 9 個遊戲呼叫。
- 圖片上傳：Pixabay 搜圖 → 轉存 Firebase Storage（`uploadPixabayImage`）→ 存 URL。音檔未來比照辦理。
