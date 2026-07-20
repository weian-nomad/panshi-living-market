# 盤勢・眾生

你不下單，你排席。

《盤勢・眾生》是一款五人 AI 命運策略遊戲。玩家每五個有效交易日編成一回合的五份公司卷宗，再把五個人與卷宗排進五張固定桌位；封席後，小人自行決定公司、上行／下行／不做及信心部位。揭曉時可沿著因果帶，看見結果，也看見注意、記憶、情緒與關係如何推動這次選擇。

本 repo 是遊戲的獨立產品來源。它不接管盤勢研究產品的市場擷取、公司命盤研究或每日內容排程，只接收帶版本與 hash 的 sealed fact manifest。

## 目前狀態

產品憲法 v2.1 與核心架構已完成 pre-code 封頂審查；目前沒有已知缺口會迫使後續重切 bounded context、canonical history、deterministic kernel、privacy isolation 或 scale path。這不等於產品已可上線：排席原型、角色反事實、賽制試算、資料權利、法遵、Figma 與工程 qualification 仍須逐項過 gate。封測權益完整開放，不串金流、不顯示廣告。公開首版凍結為至少一年前的封存資料，遊玩時使用虛構公司名與遮蔽日期；當期真實公司不是預設架構，須另過臺灣法遵、資料授權與訊號誤讀 gate。

現在的正式文件：

- [產品憲法（唯一產品基準）](./docs/product-constitution.md)
- [排席 User Journey 與 FigJam](./docs/ux/user-journey.md)
- [視覺、字型、生成圖與動態系統](./docs/design/visual-system-brief.md)
- [Architecture Constitution](./docs/architecture/architecture-constitution.md)
- [Canonical command／event catalog](./docs/architecture/event-catalog.md)
- [Aggregate state／payload map](./docs/architecture/state-payload-map.md)
- [Machine-readable command transition map](./contracts/policy/command-transition-map.yaml)
- [Client truth／recovery contract](./docs/architecture/client-contract.md)
- [Pre-code readiness 判決](./docs/reviews/pre-code-readiness.md)
- [全球競品與相鄰產品模式](./docs/research/competitive-patterns.md)
- [跨產品契約](./docs/repository-boundary.md)
- [重構後 pre-code backlog](./BACKLOG.md)

## 產品邊界

| 盤勢研究產品負責 | 本 repo 負責 |
| --- | --- |
| 市場與公司資料來源、授權、修訂 | 虛構角色與合成人口 |
| 公司命盤與象、證、界研究 | 注意、解讀、情緒、關係與思考核心引擎 |
| 事實封存與 sealed manifest | 卷宗、封席、決策分、反事實與 replay |
| 每日短影音與研究頁 | 五席圓桌、分區賽季、角色人生與延遲觀看 |

兩邊不共用資料庫、不直接 import application code，也不把 runtime 檔案當 API。需要共用的只有已發布、可驗證、向後相容的資料契約。

## 不做的事

- 不提供買進、賣出、停損、目標價或個人化投資建議。
- 不提供全球紙上報酬榜，也不以報酬替角色或模型標示能力。
- 不把真人資料灌進角色，也不讓模型臨時上網拼人物背景。
- 不讓付費提高模型勝率、提早看封存答案或改寫角色情緒。
- 不在公開 repo 保存憑證、私有資料、生成媒體、營運紀錄或未公開供應資訊。

程式碼會在排席原型、賽制試算、角色可證偽、法遵邊界與新架構 P0 關閉後進場。第一個可執行版本仍須使用最終資料形狀與正式 API 契約，不做之後必須整批搬家的展示型切片。

規格契約可用 `ruby tools/contract-audit.rb` 稽核；目前會核對 133 個 commands、147 個 canonical events，以及 transition 與 payload map 是否完整對應。CI 會在相關契約變動時自動重跑。
