# 語音產生工具（Google Cloud TTS · Chirp 3 HD）

在電腦上把單字和例句做成 MP3，再從 App 上傳到 Firebase Storage。App 會優先播放這些音檔，沒有音檔的字照舊用瀏覽器語音。

可以同時有好幾個聲音（例如 Sulafat、Achird），單字和句子也可以用不同聲音。

## 第一次設定

1. 複製 `config.example.json`，另存成 `config.json`（同一個資料夾）。
2. 把 `word-learner-tts` 那把 API 金鑰貼到 `apiKey`。
3. `config.json` 已經列在 `.gitignore`，不會被推送到 GitHub。**不要把金鑰貼到其他地方。**

## 產生某個聲音

1. 在 App：管理單字 → 📤 匯出/匯入 → 匯出全部資料，把 `word-learner-backup-日期.json` 放到 `word-learner` 資料夾。
2. 在 `word-learner` 資料夾執行（`--voice` 後面接聲音名稱）：

   ```
   node tools/tts/generate.js word-learner-backup-日期.json --all --voice Achird --sample   先做 5 個字試聽
   node tools/tts/generate.js word-learner-backup-日期.json --all --voice Achird            單字 + 例句
   ```

   - 不加 `--voice` 就用 `config.json` 裡的 `voice`。
   - 加 `--words` 只做單字；加 `--dry` 只估算字元數、不呼叫 API。
3. 音檔會存在 `tools/tts/output/<聲音名>/`，每個聲音一個資料夾，互不覆蓋。

## 上傳到 App

1. 用**電腦的 Chrome** 打開 App（https://jocoya.github.io/word-learner/）→ 首頁標題連點 3 下開啟開發者工具。
2. 🎙️ 匯入語音包 → 選 `tools\tts\output\<聲音名>` 資料夾（例如 `output\Achird`）。
3. 第一次匯入的聲音會**自動變成目前使用的聲音**。
4. 平板不用做任何事，重新打開 App 就會套用。

## 切換 / 混用 / 刪除聲音（開發者工具）

- 🎚️ 選擇聲音：分別設定「念單字」和「念句子」用哪個聲音，可以試聽。
- 某個聲音沒有的字，會自動用其他聲音補上；都沒有才用瀏覽器語音。
- 🗑️ 刪除某個聲音：刪掉 Storage 上該聲音的全部音檔。確定不用的聲音可以刪掉，節省空間。
- 🧩 重建語音清單：清單和 Storage 對不上時使用，不會重新上傳檔案。

## 可用的聲音（en-US Chirp 3 HD）

女聲：Achernar、Aoede、Autonoe、Callirrhoe、Despina、Erinome、Gacrux、Kore、Laomedeia、Leda、Pulcherrima、Sulafat、Vindemiatrix、Zephyr
男聲：Achird、Algenib、Algieba、Alnilam、Charon、Enceladus、Fenrir、Iapetus、Orus、Puck、Rasalgethi、Sadachbia、Sadaltager、Schedar、Umbriel、Zubenelgenubi

## 費用與安全

- 免費額度：Chirp 3 HD 每月 100 萬字元，**所有聲音共用**。目前一個聲音的全部單字 + 例句約 1 萬字元。
- 程式預設每月最多用 90 萬字元，超過就停止，不會自動多花錢。本月用量記在 `output/usage.json`。
- 已經做過的文字會跳過，重跑不會重複計費。新增單字後，重新匯出、再跑一次，只會補做新的字。

## 常見錯誤

- `HTTP 403`：確認 eng-workspace 專案已啟用 Cloud Text-to-Speech API、金鑰的 API 限制有勾它，而且專案已綁定帳單帳戶。
- `HTTP 400` 且提到 voice：聲音名稱打錯，請對照上面的清單（大小寫不拘）。
