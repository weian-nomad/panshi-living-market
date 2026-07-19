# 盤勢・市中人

市場收盤後，小人開始過日子。

《盤勢・市中人》是一個由臺股交易日推動的人物觀察沙盒。五名虛構角色只能使用當時已公開、已進入世界的證據做紙上決策；玩家可以遞交反證、追問未知、安排角色對話，但不能替角色指定個股、價格、方向或交易數量。

本 repo 是遊戲的獨立產品來源。它不接管盤勢研究產品的市場擷取、公司命盤研究或每日內容排程，只接收帶版本與 hash 的 sealed fact manifest。

## 目前狀態

產品處於最終級首版規劃與 pre-code review。封測目標為 200 名受邀使用者，權益完整開放，不串金流、不顯示廣告，也不啟用尚未通過資料授權與法規審查的當期個股功能。

現在的正式文件：

- [產品企劃書](./docs/game-product-proposal.md)
- [技術架構](./docs/game-technical-architecture.md)
- [跨產品契約](./docs/repository-boundary.md)
- [FigJam 現況盤點](./docs/figjam-current-state.md)
- [ChatGPT Pro pre-code gap review](./docs/reviews/2026-07-20-chatgpt-pro-gap-review.md)
- [Pre-code backlog](./BACKLOG.md)
- [使用者旅程 FigJam](https://www.figma.com/board/OZG06ChjZGMaatLc2DDzQA)

## 產品邊界

| 盤勢研究產品負責 | 本 repo 負責 |
| --- | --- |
| 市場與公司資料來源、授權、修訂 | 虛構角色與合成人口 |
| 公司命盤與象、證、界研究 | 注意、解讀、情緒與行為引擎 |
| 事實封存與 sealed manifest | 記憶、關係、事件帳本與紙上決策 |
| 每日短影音與研究頁 | 觀測室、人物週卷、公地與遊戲分享內容 |

兩邊不共用資料庫、不直接 import application code，也不把 runtime 檔案當 API。需要共用的只有已發布、可驗證、向後相容的資料契約。

## 不做的事

- 不提供買進、賣出、停損、目標價或個人化投資建議。
- 不以紙上報酬替角色或模型排名。
- 不把真人資料灌進角色，也不讓模型臨時上網拼人物背景。
- 不讓付費提高資料權限、提早看答案或改寫角色情緒。
- 不在公開 repo 保存憑證、私有資料、生成媒體、營運紀錄或未公開供應資訊。

程式碼會在 P0 產品、設計、資料與安全缺口關閉後進場。第一個可執行版本仍須使用最終資料形狀與正式 API 契約，不做之後必須整批搬家的展示型切片。
