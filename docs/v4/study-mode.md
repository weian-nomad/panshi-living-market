# V4 研究模式

_2026-07-20｜供 24 人跟拍測試使用，不是正式產品分析系統_

研究模式只回答三個產品問題：新手能否自己完成按住與交接、是否願意把完整十分鐘留在前景，以及隔日是否先找回首日最常跟拍的居民。不得從資料中另挑一組較好看的成功定義。

## 使用入口

- 第一次觀看：`/?study=P01&visit=1`
- 隔日觀看：`/?study=P01&visit=2`
- 研究者控制台：`/?research=1`

匿名代碼只接受 `P01` 至 `P24`。同一位受測者兩次觀看必須使用同一代碼；不得放入姓名、電話、email 或其他可識別資料。第二次觀看必須落在第一次觀看後的下一個 `Asia/Taipei` 日曆日；同日或隔超過一天都標為不符研究規則。

研究者先完成說明與同意程序，再把裝置交給受測者。產品內的同意頁會再次說明實際記錄範圍，但不透露通過門檻、指定人物或操作答案。拒絕後不建立 run，也不寫入事件。

本批正式研究 build 固定為 `study-2026-07-21.1`。production build 的 `VITE_STUDY_BUILD_ID` 未設定或不一致時，建置會直接失敗；執行階段也會在同意前再次檢查。控制台會顯示當前 build ID；混用 build ID、同意版本或 evaluator revision 的資料不產生正式裁決。

## 記錄範圍

每個 `(appBuildId, participantCode, visitOrdinal)` 只能對應一個 `runId`，`attemptOrdinal` 永遠為 1。事件只包含：

- `run_started`：匿名代碼、觀看次序、同意版本與 app build。
- `watch_sample`：每秒的前景可見、播放狀態、場景秒數，以及當下跟拍的居民 ID。
- `follow_started`：居民 ID 與按住、點按或替代控制來源。
- `handoff_completed`：拖曳交接的前後居民 ID。
- `run_ended`：第一次觀看完成十分鐘，或第二次觀看完成第一次人物選擇。

不記錄姓名、聯絡方式、IP、user agent、裝置指紋、自由文字、私人筆記或完整 pointer 軌跡。連續觀看一律使用單調時間；系統時間 `occurredAt` 只用來檢查兩次觀看是否落在相鄰的台北日曆日。

## 儲存與失敗

事件寫入瀏覽器原生 IndexedDB。建立 run 與寫入唯一鍵在同一個 IndexedDB transaction 完成；寫入使用單調 sequence 與 append-only `add`，相同 `eventId` 不會覆寫。重新整理只續接同一個未完成 run，並先追加一筆不可計入連續觀看的中斷樣本；已完成的觀看永久鎖定，不會建立第二個 attempt。儲存失敗時立即停止該 run 並遮住原型，不讓沒有證據的觀看繼續算入研究。

正式 build 在第一次連線載入研究入口後註冊獨立 service worker，快取 HTML、版本化 JS／CSS、字型與兩組正式場景資產。之後斷網仍可重新開啟研究入口並繼續寫入 IndexedDB。第一次載入尚未完成前不得切成離線狀態。

正式 origin 固定為 `https://world.panshi.app`。production 執行期會同時核對 `location.origin` 與 secure context；供應商預覽網址、HTTP 或其他 origin 在開啟 IndexedDB 前就停止。canonical、manifest、service worker scope 與 IndexedDB 都留在同一 origin；研究期間不得換網域、子網域或 path 前綴，否則視為另一批資料。公開根路徑只顯示封閉研究訊息，且整站 `noindex`；只有 `P01` 至 `P24` 的受測連結與研究者控制台能寫入或讀取紀錄。每份匯出也固定寫入並驗證同一個 `studyOrigin`。

研究者控制台只讀同一 origin、同一瀏覽器的資料。每位受測者結束後重新讀取並匯出 JSON；每天再做一次完整匯出。確認備份可讀之前不得清除裝置紀錄。匯出的真實檔案放在 repo 外，不可提交。

每份匯出都要在另一台受控裝置重新驗證。驗證器會檢查 schema、固定門檻、事件欄位、evaluator revision，再從原始事件重算結果；不信任 JSON 內原有的衍生數字。成功後只輸出匿名總數、版本與 SHA-256，不列出逐人代碼：

```bash
pnpm --filter @panshi/web study:verify /path/to/panshi-study-export.json
```

## 固定裁決

### 按住與交接

只計第一次觀看中，同一個有效 run 內先出現 `input=hold` 的 `follow_started`，之後再出現居民到居民的 `handoff_completed`。點按與底部替代控制不會讓這項通過。

### 完整前景十分鐘

只計第一次觀看。相鄰 `watch_sample` 必須同時為 visible 與 playing，單調時間間隔不得超過 1,750 ms。隱藏頁面、鎖屏、切到其他 App、暫停、重新整理、頁面 freeze、主執行緒長時間停止或 sequence 缺口都會中斷連續鏈。`visibilitychange`、`pagehide`、`freeze` 與播放控制會立即追加中斷樣本，不必等下一次每秒 tick。只有從場景開始附近一路走到第一次 599→0 回捲，而且有效單調時間至少 598,000 ms 的單一 run 才通過。

### 隔日先找回同一人

首日主角由唯一一次有效觀看的前景跟拍時間加總。相鄰樣本必須連續且指向同一位居民才會累加；平手時不指定主角，也不算通過。隔日人物使用唯一 run 的第一個直接按住或點按人物，寫入後立即封存；重新整理不會產生改選機會。兩次有效 `run_started` 若不是相鄰台北日曆日，整體只標示研究規則不符，不產生正式裁決。

## 三個數字

1. 20/24 無口頭協助完成按住跟拍與一次拖曳交接。
2. 10/24 在前景不中斷看完整個十分鐘。
3. 6/24 隔日第一位跟拍者，等於首日跟拍時長第一名。

只有至少含一個完整、有效 run 的匿名代碼才計入人數；只留下損壞紀錄的代碼不會把樣本數灌到 24。必須正好 24 人、同一封存 build、同一同意版本，而且沒有損壞 run、重複觀看次序或錯日觀看，才會產生正式裁決；少於或多於 24 人都不裁決。目前 evaluator revision 為 `v4-study-3`。任一門檻未達，就回查手勢可發現性、人物辨識、事件密度與視角代價，不增加功能掩蓋結果。
