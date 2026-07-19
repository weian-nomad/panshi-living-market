# FigJam 方向重置與重畫單

_2026-07-20｜原 FigJam 保留為歷史討論紀錄；不得再當成可交付的使用者旅程。_

產品已從「角色檔案與週卷」重切為由真實交易日推動的活世界。現有 [FigJam](https://www.figma.com/board/OZG06ChjZGMaatLc2DDzQA)的角色出生、五席、公地與錯誤狀態可保留部分素材，但其主幹「序幕 → 五人觀測室 → 週卷」必須廢止。新的主幹是：

```text
世界時鐘 → 封存事實 → 居民感知與社交 → 使用者引導
→ D 意圖封存 → D+1 虛擬執行 → D+2 後果與 replay → 關係／記憶變化
```

產品規則以[企劃書 v0.6](./game-product-proposal.md)為準；這份文件只定義 FigJam 要畫什麼、每個節點的輸入輸出與設計交付邊界。

## 要刪除或降為舊稿的內容

- 將角色履歷、雷達圖、帳本與命盤當成首頁的資訊階級。
- 「看完 20 秒序幕 → 跟隨三人 → 直接進觀測室」作為唯一發現路徑。
- 以歷史盲播取代當期世界時鐘。
- 單次遞反證／追問未知／安排對話後直接跳週卷。
- 將「每週五人」畫成每週永久新造五人，或將席位按模擬 run 扣除。
- 讓權益失效自動公開角色、卻未畫出建立時的歸宿選擇。

## 新 FigJam 的八個 section

每個 section 都要畫出 success、拒絕、資料不足、模型 failure、離線或恢復去向；不能只畫 happy path。

| Section | 節點 | 連到哪裡 | 判斷條件 |
|---|---|---|---|
| 1. 進世界 | 公地分享／短影音／盤勢研究事件 → 今日城市 → 跟隨一位居民 → 登入或繼續旁觀 | 世界視圖、角色深層 | 是否登入、內容是否 public、manifest 是否可用 |
| 2. 世界時鐘 | 交易日狀態 → manifest receipt → 世界更新中／可引導／等待 D+1／等待 D+2／世界停住 | 事件視圖、資料狀態 | market calendar、`available_at`、license、revision、job state |
| 3. 居民出生 | 虛構與統計取樣告知 → 人生約束取樣 → 命盤／四軸／記憶底盤 → 思考核心 → 公地歸宿 → 建立完成 | 名冊、五席 | 18+、constraint validity、model selection、destination consent |
| 4. 五席與引導 | 名冊 → 本週 draft → confirm → active seats → 每日三枚引導籤 → 已用／失效／重送 | 世界視圖與角色事件 | week boundary、seat eligibility、token balance、idempotency |
| 5. 分岔事件 | 今日五個事件 → 同證異讀 → 看見／漏掉／轉述 → 問一問／遞線索／約一席 → 回到世界 | D 意圖封存 | truth class、perception packet、可用 guidance、對方角色可用性 |
| 6. D／D+1／D+2 | D seal → D+1 execute／unfilled → D+2 owner replay → D+2 public projection | 帳本、關係、分岔報告、公地 | corporate action、halt、missing data、reveal policy、revision |
| 7. 公地與權益 | beta full access → future grace → guidance lost → chosen public city／private archive → recall | 公地、名冊、私有封存 | destination receipt、period end、public review、空席 |
| 8. 系統與帳號 | offline／reconnect／ETag conflict、held-for-review、notification opt-in、export、delete、age gate、accessibility path | 原工作或唯讀／重試 | network、job、permission、age、data export state |

## FigJam service blueprint swimlanes

FigJam 需要五條固定泳道，任何一個世界 tick 都從左到右走完：

```text
使用者
  → Web／SwiftUI
  → API／Identity／Entitlement
  → World Scheduler／Simulation Worker
  → Sealed Facts／Model／Privacy Projection
```

至少畫出下列分支：

- manifest 延遲、被撤回、修訂、缺資料或授權不符。
- 模型 timeout、schema 不符、evidence 不在 allowlist、policy 違規、deterministic fallback、held-for-review。
- D intent 已封存，但 D+1 停牌／無成交／除權息／資料缺漏。
- 同一引導籤重送、跨裝置 ETag 衝突與週界切換。
- 使用者失去引導權時 public city 與 private archive 的不同 projection。

## Figma Design file 必須另建的頁面

FigJam 不代替高保真介面。Figma Design file 需要至少：

- Mobile、desktop、SwiftUI 三端的世界視圖、事件分岔、五席、居民深層、D+2 replay、公地、出生、思考核心、權益與所有系統狀態。
- 以「墨、紙、銅、冷藍資料」建立 token、字型、grid、元件 variants、motion spec 與 reduced-motion 等價畫面。
- 五種 truth badge，及真實事實／虛構記憶／象徵解讀／模擬敘事並列時的拆分規則。
- `ready`、`waiting_d1`、`waiting_d2`、`stopped_data`、`offline`、`stale`、`held`、`redacted`、`error`、`locked`、`reduced motion` 狀態。
- 適用於行動與桌面的鍵盤、screen reader、動態字體、200% zoom、對比與不依賴顏色的路徑。

## 這次設計的驗收問題

每個 prototype 測試都要用下列問題驗收：

1. 使用者在 10 秒內能否說出世界現在是 D、D+1 還是 D+2？
2. 他能否看懂「我剛才的引導改變了什麼」，而不誤以為自己下了單？
3. 他能否區分角色行為、真實事實、象徵解讀與系統敘事？
4. 未登入的觀看者能否感受到城市活著，而不誤讀成即時個股訊號？
5. 任何 loading、停住、延遲、修訂與模型失敗時，是否知道世界保留了什麼、下一步是什麼？
