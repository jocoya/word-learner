# 語音產生工具（Sulafat）

在電腦上用 Google Cloud Text-to-Speech（Chirp 3 HD）把單字和例句做成 MP3，再從 App 上傳到 Firebase Storage。App 會優先播放這些音檔，沒有音檔的字照舊用瀏覽器語音。

## 第一次設定

1. 複製 `config.example.json`，另存成 `config.json`（同一個資料夾）。
2. 把 `word-learner-tts` 那把 API 金鑰貼到 `apiKey`。
3. `config.json` 已經列在 `.gitignore`，不會被推送到 GitHub。**不要把金鑰貼到其他地方。**

## 每次產生音檔

1. 在 App：管理單字 → 📤 匯出/匯入 → 匯出全部資料，把 `word-learner-backup-日期.json` 放到 `word-learner` 資料夾。
2. 在 `word-learner` 資料夾執行：

   ```
   node tools/tts/generate.js word-learner-backup-日期.json --sample   先做 5 個字試聽
   node tools/tts/generate.js word-learner-backup-日期.json --words    做全部單字
   node tools/tts/generate.js word-learner-backup-日期.json --all      單字 + 例句
   ```

   加上 `--dry` 只估算字元數、不呼叫 API。

3. 音檔會存在 `tools/tts/output/audio/`，另外有 `manifest.json`。
4. 用**電腦的 Chrome** 打開 App（https://jocoya.github.io/word-learner/）→ 首頁標題連點 3 下開啟開發者工具 → 🎙️ 匯入語音包 → 選 `tools\tts\output` **資料夾**（不是裡面的 audio）。已上傳過的會跳過。
5. 平板不用做任何事，重新打開 App 就會讀到新的語音。

## 費用與安全

- 免費額度：Chirp 3 HD 每月 100 萬字元。程式預設每月最多用 90 萬字元，超過就停止，不會自動多花錢。
- 已經做過的文字會跳過，重跑不會重複計費；本月用量記錄在 `output/usage.json`。
- 新增單字後，重新匯出、再跑一次 `--words` 或 `--all`，只會補做新的字。
- 要換聲音：修改 `config.json` 的 `voice`，並先把 `output` 資料夾改名或刪除。

## 常見錯誤

- `HTTP 403`：確認 eng-workspace 專案已啟用 Cloud Text-to-Speech API、金鑰的 API 限制有勾它，而且專案已綁定帳單帳戶。
- `HTTP 400` 且提到 voice：確認 `voice` 是 `en-US-Chirp3-HD-Sulafat`。
