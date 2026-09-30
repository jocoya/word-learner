# 自動產生單字音檔（Cloud Functions）

在 App 新增或修改單字時，雲端自動用 Chirp 3 HD 產生你選的聲音，幾秒後就能播放。不需要 API 金鑰（用 Firebase 專案自己的服務帳戶）。

## 第一次部署

在 `word-learner` 資料夾執行：

```
npm install -g firebase-tools
firebase login
cd functions
npm install
cd ..
firebase deploy --only functions
```

- `firebase login` 會開瀏覽器，用 **eng-workspace 的 Google 帳號** 登入。
- 第一次部署會要求啟用幾個 API（Cloud Functions、Cloud Build、Artifact Registry、Eventarc），出現提示時選 **Yes**。
- 部署完成後會看到 `autoWordAudio(asia-east1)` 建立成功。

## 設定服務帳戶可以呼叫 Text-to-Speech

第一次部署後，到 [Google Cloud Console → IAM](https://console.cloud.google.com/iam-admin/iam?project=eng-workspace) 確認：

- `434719078442-compute@developer.gserviceaccount.com`（Compute Engine 預設服務帳戶）
- 如果產生失敗、日誌出現 `HTTP 403`，幫它加上角色 **Cloud Text-to-Speech 使用者**（若清單裡沒有這個角色，用 **Service Usage Consumer** 也可以）。

## 選擇要自動產生哪些聲音

App → 開發者工具 → 🎚️ 選擇聲音：

- 勾選「新增/修改單字時自動產生音檔」。
- 勾選要自動產生的聲音（例如只勾 Achird，或 Achird + Sulafat）。
- 按 💾 儲存。

## 費用與安全

- 只在「單字或例句文字改變」時才產生；改圖片、標籤不會呼叫 TTS。已有的音檔直接跳過。
- 雲端每月最多自動產生 **20 萬字元**（記錄在 settings/ttsUsage），超過就停止，App 退回瀏覽器語音。電腦端產生程式也會把這個用量算進去，兩邊加起來不會超過免費額度（每月 100 萬）。
- 函式同時只跑 1 個，最壞情況的花費也有上限。
- 建議在 Google Cloud 帳單設定預算提醒（例如 1 美元）。

## 查看執行紀錄

```
firebase functions:log
```

或到 [Firebase Console → Functions → 記錄](https://console.firebase.google.com/project/eng-workspace/functions/logs)。

## 關閉 / 移除

- 暫時關閉：App 開發者工具取消勾選「自動產生音檔」。
- 完全移除：`firebase functions:delete autoWordAudio --region asia-east1`
