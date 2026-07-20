# Pre-code backlog

_2026-07-20｜依[產品憲法 v2.1](./docs/product-constitution.md)重建。核心架構已達 `PRE-CODE MAXIMUM REACHED`；原型、資料權利、設計與工程 qualification gate 尚未關閉。_

## P0-A｜排席是否好玩

| ID | 交付 | 驗收證據 | 狀態 |
| --- | --- | --- | --- |
| A-01 | 60 秒排席原型 | 五人、五卷宗、五桌位、合法行為預覽與封席；全程不超過十次動作，無權重／滑桿／自由畫線 | Open |
| A-02 | 三日縱向測試 | 第三日後至少 80% 測試者能說出一條排席如何改變決定；能理解脈絡深度與拆回音室取捨 | Open |
| A-03 | 揭曉與反事實 | 每次顯示第一／第二行動、效用差與一個單變量反事實；「因為」只出現在行動真的改變時 | Open |
| A-04 | 八回合加速測試 | 十交易日中位數有 2–5 次因果有效改動；成熟玩家能描述隊伍規律，若只談選錯公司則核心判死 | Open |
| A-05 | 觀看者誤讀測試 | 歷史虛構標籤下仍能理解玩法，且不把角色內容當成當期買賣建議 | Open |

## P0-B｜角色可證偽

| ID | 交付 | 驗收證據 | 狀態 |
| --- | --- | --- | --- |
| B-01 | Deterministic action policy | 注意分、行動效用、`不做`、epsilon tie-break、風險煞車均版本化 | Open |
| B-02 | 模型解讀契約 | 只輸出 evidence appraisal；不得輸出最後公司、方向、信心、價格或人物狀態 | Open |
| B-03 | 一次社交交換 | 同時送出、每人一份、無第二輪；社交效用占比不超過 25% | Open |
| B-04 | 三種 replay | 法證重播 100%；單變量反事實與核心替代推演清楚分級 | Open |
| B-05 | 因素影響率 | 有效 exposure 中，效用差 ≥0.10 為 15%–60%，action flip 為 3%–20%；單因子不超過 25% flips | Open |
| B-06 | 角色差異率 | 同一卷宗與證據下，不同角色行動差異率 15%–45%；差異不是高溫度噪音 | Open |

## P0-C｜賽制與反作弊

| ID | 交付 | 驗收證據 | 狀態 |
| --- | --- | --- | --- |
| C-01 | 決策分 golden model | 8×5 cohort、留一中位數、60 日 MAD scale、z 雜訊帶、`DP=4×(2qy−q²)` 與 rounding fixtures | Open |
| C-02 | Coverage 與風險煞車 | `Coverage=min(1,Σq/8)`、正分平滑折減、標準化 g 回撤與 qmax 階梯，不清分、不失格 | Open |
| C-03 | 500 個分層賽季 | regime-stratified block bootstrap；全上／全下、固定信心、高低波動、不做、永不換位等盲策略 | Open |
| C-04 | 支配門檻 | 平均分 95% CI 上界 ≤0；top-two Wilson 上界 ≤30%；任一 regime ≤35% | Open |
| C-05 | 卷宗與保密 | 40 家＝8 cohort×5；每卷四 cohort、全隊每 cohort 最多三家、回合後揭露 | Open |
| C-06 | 帳號與分區完整性 | 一名驗證主體一支排名隊、關聯帳號隔離、制度異常全區同日作廢 | Open |

## P0-D｜法律、資料與模式隔離

| ID | 交付 | 驗收證據 | 狀態 |
| --- | --- | --- | --- |
| D-01 | 歷史 beta 資料權利 | 至少一年前資料；顯示、非顯示模型輸入、衍生分數、保存與測試用途均有權利依據 | External gate |
| D-02 | 歷史隔離 UX | 虛構公司名、遮蔽日期、無 ticker 搜尋、行情連結、清單匯出、命中率與預測式招募 | Open |
| D-03 | 當期模式書面法律問題 | 真實公司＋立場＋信心＋依據、付費、延遲、排行榜、搜尋、廣告與合作路徑逐項送審 | External gate |
| D-04 | 當期模式 kill switch | 當期程式、資料、flag、通知與分享預設關閉；未取得核准路徑不可外部啟用 | Open |
| D-05 | 訊號誤讀測試 | 30 名目標使用者；超過 10% 想拿角色結果做隔日交易時，當期模式不得公開 | Blocked by legal |
| D-06 | 模式 truth contract | 歷史、虛構、內部當期、外部當期不可共用會造成錯誤標示或洩漏的 projection | Open |

## P0-E｜新架構

| ID | 交付 | 驗收證據 | 狀態 |
| --- | --- | --- | --- |
| E-01 | Domain map | 從卷宗、排席、封席、解讀、決策、計分、反事實、人物更新與模式 gate 切 bounded contexts | Contract frozen；待 ADR 簽核 |
| E-02 | Canonical event catalog | command／event invariant、payload、版本、冪等、因果、修訂與 replay fixture | Catalog v1.3＋transition contract v1.2.0 complete；待 Protobuf schema |
| E-03 | Decision snapshot contract | cutoff、evidence allowlist、action mask、core output、policy、seed、fact revision 可法證重播 | Shape frozen；待 fixtures |
| E-04 | Identity／entitlement／privacy | 唯一五人、記憶三層、公開自主、恢復、退休、export、delete 與 projection isolation | Canonical lifecycle frozen；待 schema、threat model 與 E2E |
| E-05 | Season／scoring engine | universe freeze、卷宗、DP、Coverage、risk brake、division、void session 與 500-season simulator 同一規則包 | Blocked by C |
| E-06 | Mode isolation architecture | 歷史與當期資料、搜尋、cache、通知、分享、analytics 逐層 deny-by-default | Architecture frozen；待 threat model |
| E-07 | Scale proof | 8 人分區到 50,000 角色沿用同一事件、決策與 replay 契約；排程、儲存、模型預算 benchmark | Topology frozen；待 qualification |
| E-08 | API v1 freeze | OpenAPI、error catalog、ETag、idempotency、pagination、polling／push 與 golden fixtures | Client truth／receipt／error contract frozen；待 schema |
| E-09 | Failure matrix | missing／stale／corrected／held／model timeout／policy reject／void day 的 UI、worker、API 狀態 | Open |

## P0-F｜設計交付

| ID | 交付 | 驗收證據 | 狀態 |
| --- | --- | --- | --- |
| F-01 | 新 FigJam | 首次進入、回合卷宗、每日排席、封席、揭曉、分區、公開觀看、失訂／恢復完整旅程 | Draft complete；待刪除十五則注意事項 drift 與 usability review |
| F-02 | 高保真 Figma | mobile／desktop 五席圓桌、卷宗、合法行為預覽、因果反事實、人物、分區與錯誤狀態 | Open |
| F-03 | Design system | 字型授權、色彩、spacing、grid、元件 variants、truth badge、motion 與 reduced-motion | Visual brief frozen；待 Figma library 與對比驗證 |
| F-04 | Image／motion bible | 角色主視覺、命盤封席動效、反事實轉場、crop-safe master、seed／prompt／usage record | Asset contract frozen；待首批 Codex 生成與 motion study |
| F-05 | UX copy system | 排席、卷宗、封席、合成下行、決策分、資料模式、錯誤與權益完成繁中及 anti-AI audit | Open |

## 動工順序

1. 同時完成 A-01、B-01／B-02 與 C-01 的最小規則原型。
2. 以固定歷史 episode 做三日、八回合與 500 個分層賽季試算；任一核心門檻失敗就改憲法。
3. 關閉歷史資料權利與隔離 UX；當期模式保持 kill switch 關閉。
4. 產品規則通過後，才推導 E-01 到 E-09，不沿用已刪除的城市架構。
5. FigJam 與 Figma 以已驗證規則重畫，將所有狀態納入 golden fixtures。

可先做的工作只有歷史資料契約、決策／賽制模擬、點擊原型、角色反事實實驗與測試骨架。當期真實公司、城市、公地社交、開放聊天、模型商店、全球榜與真錢獎勵都不得先進 production architecture。
