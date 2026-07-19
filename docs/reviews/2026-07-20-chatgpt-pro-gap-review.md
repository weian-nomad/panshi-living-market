# Pre-code gap review

_Review date: 2026-07-20_

Review source: [ChatGPT Pro conversation](https://chatgpt.com/c/6a5d4e0c-6e2c-83ec-9a22-e914606de671)

## Verdict

**68／100. 補完指定缺口後進入實作。**

審查認為產品方向不用重切。20 人名冊、每週 5 席、20 個歷史節點、五種 `truth_class`、四個事實時間與 `/api/v1` 都有正確骨架。當時的 v0.4 仍把遊戲寫成既有盤勢 repo 內的 monorepo，API 與 UX 狀態也沒有閉合。

審查完成前，本 repo 已先做完第一項修正：遊戲已拆成 `panshi-living-market`，並以 [ADR-0001](../repository-boundary.md) 禁止跨 repo 直讀資料庫、SQLite、application package、migration 與 secret。市場事實只走版本化 sealed-fact contract。

分數是審查 v0.4 的基準，不是對本次修正後 v0.5 的重新評分。P0 未全數關閉前，技術架構仍維持 `Implementation candidate`。

## Fifteen gaps and current disposition

| Priority | Gap | Failure moment | Required proof | Owner | Status |
| --- | --- | --- | --- | --- | --- |
| P0 | 同一 repo 與獨立 repo 互衝 | 建資料庫與 package 時直接耦合上游 | ADR、獨立 remote、CI 禁止 path import／跨庫 | Engineering | Closed in v0.5 |
| P0 | API route、error、ETag 不完整 | Web 與 SwiftUI 各自猜錯誤和重送方式 | OpenAPI、error catalog、ETag／idempotency fixtures | API | Open |
| P0 | 匿名 installation 合併登入帳號 | 首次轉折遺失或重複 | anonymous-to-user merge E2E | Backend | Open |
| P0 | 五席的指派、確認與週界語意不清 | 重複扣席、翌日無席、換週錯人 | 席位狀態機、冪等與週界 property tests | Domain | Open |
| P0 | 角色進公地缺少明確同意 | 權益到期後誤公開 | 拒絕公開時零 public projection | Product／Privacy | Open decision |
| P0 | 五種資料身分缺少視覺契約 | 虛構人物被看成真人，象徵被看成選股 | 100% visible claim badge audit | Design／Risk | Open |
| P0 | 延遲、資料不足與後續更正沒有完整 UX | 舊數字仍顯示，卻無法知道原因 | before／after fixtures、revision replay | Data | Open |
| P0 | retry、fallback、held-for-review 沒有閉合旅程 | 畫面卡死或錯發半成品 | 四態 E2E、未驗證發布數為 0 | AI／Frontend | Open |
| P0 | 玩家未成年人邊界未決 | 註冊與紙上推演權限不一致 | 18+ guidance gate 或書面核准的替代政策 | Legal／Product | Open decision |
| P0 | 來源與衍生用途授權尚未逐項簽核 | 功能完成後不能測試或公開 | source register、每來源書面 go／no-go | Legal／Data | External gate |
| P1 | offline、stale 與跨裝置同步 | 席位或私人筆記互相覆蓋 | sync matrix、ETag refresh／resubmit tests | Web／iOS | Open |
| P1 | 通知、quiet hours 與 deep link | 推播被看成個股訊號 | notification policy、金融文案紅隊 | Product／Risk | Open |
| P1 | 私人筆記版本、合併與資料隔離 | 筆記流入公地、分析或模型 | RLS、加密、projection attack tests | Privacy | Open |
| P1 | 匯出、刪除與封測結束 | 使用者留在處理中或無法帶走資料 | deadline、retry、resume E2E | Operations | Open |
| P2 | IA、screen inventory、tokens、a11y 與名詞 | Web、desktop、SwiftUI 各自長成不同產品 | signed stories、prototype 與 handoff | Design Ops | Open |

## Traceability findings

| Finding | Missing or conflicting items |
| --- | --- |
| 規格已有，FigJam 沒有 | 登入、匿名 merge、五種 badge、`available_at`／revision、更正、offline／stale／held、通知、刪除、a11y、營運泳道 |
| FigJam 已有，規格或 API 沒有 | 跟隨三人的保存期限、人物底盤返回、只想看方向時如何 handoff、封測後免費狀態 |
| 文件互衝 | repo 邊界已修；公地同意與席位扣用仍待決策 |
| 名稱不一致 | 觀測艙／觀察所、四軸性格偏好／MBTI、公地／世界鏡頭、20 人名冊／五人名冊 |

名詞建議固定如下：主場景用「觀測艙」；人格只用「四軸性格偏好」；公開世界用「公地」；帳號最多 20 人，本週被引導的 5 人稱「五席」。示範介面圖中的 MBTI、部位、總資產、報酬、公司合盤因果、商店與 Pro 都不能直接進正式 Figma。

## User journey nodes still missing

下一輪 FigJam 需新增八個 section，每個節點都要有成功、拒絕、失敗與恢復去向。

| Section | Nodes | Connects to | Decision condition |
| --- | --- | --- | --- |
| Auth | installation、link confirmation、expired link、account merge | 首次觀測 | token 狀態、帳號狀態、merge 結果 |
| Birth | 統計取樣／虛構身分告知、生成、失敗、底盤鎖定 | 五席安排 | consent、constraint、generation validation |
| Seats | 週別、暫存、確認、409、鎖定 | 每日循環 | 空席、重送、週界、角色資格 |
| Data | badge、來源、資料不足、延遲、後續更正 | 引導與證據展開 | revision、license、`available_at`、staleness |
| Simulation | queued、retry、fallback、held、published | 事件卡與原因說明 | validator、retry budget、review result |
| Sync／Notify | offline、重連、ETag conflict、詢問通知、拒絕、quiet hours | 原畫面或 deep link | 網路、權限、裝置版本 |
| Privacy／Entitlement | 私人筆記、公地同意、grace、guidance lost、recall | 私有封存、公地或五席 | consent、期限、空席、召回上限 |
| Account／Guardrails | 匯出、刪除、封測結束、age gate、a11y equivalent path | 完成、重試或唯讀 | job 狀態、年齡政策、偏好設定 |

所有非同步流程都要畫出 `queued → published | held | fallback → retry | next-day`。權益則要把 `grace → guidance_lost → consented_public | private_archive → recalled` 畫完整，不能從到期直接跳公地。

## Figma and FigJam deliverables

### FigJam

- Product IA 與完整 screen inventory。
- Happy path、unhappy path、資料狀態與服務藍圖。
- Web mobile、desktop、SwiftUI 的差異矩陣。
- 前端、API、worker、資料、隱私、營運的 swimlanes。
- 每一條 prototype 測試任務、成功條件與觀察點。

### Figma Design file

- Mobile、desktop、SwiftUI 三端必要畫面，不以單張 desktop dashboard 代替。
- Design tokens、字型授權與 fallback、grid、layer、元件 variants。
- 五種資料 badge 與來源、延遲、更正、held-for-review 的完整組合。
- default、loading、empty、offline、stale、error、locked、redacted、held、reduced-motion states。
- 收盤鐘響、人物呼吸、視線、遞紙、關係牽引的 motion spec 與靜態替代。
- Keyboard、screen reader、200% zoom、contrast、dynamic type 與等價路徑。
- Dev Mode naming、token export、asset manifest、crop／motion layers、handoff acceptance。

## Repository decision

Pro 審查支持拆出 `panshi-living-market`。Bounded contexts 應維持 Identity／Entitlement、Character、World／Manifest、Simulation、Commons／Privacy、Delivery。盤勢研究產品擁有 source adapter、修訂與 manifest；本 repo 擁有 manifest reference、角色、事件、筆記與公地。

共享內容限於版本化 schema artifact、OpenAPI、簽章物件與 consumer tests。契約採 SemVer、`schemaVersion` 與 N／N-1 相容窗口。禁止直連上游資料庫、path import、共享 migration、共享 secret，或讀取「最新行情」取代固定 manifest。

## Delivery reality

Pro 審查判斷：若由五人團隊執行，十二週只能交付 production-shaped release candidate，不能同時承諾 200 人封測。Critical path 是授權 → manifest／revision → character → perception packet → model validation → Web／SwiftUI。

最容易拖延的是來源授權、20 個歷史節點 QA、匿名與雙端 auth、五種資料身分全鏈路，以及角色資產／a11y／App release。建議 W12 使用最終資料形狀完成 6 個 golden 歷史節點、8 名 canonical QA 角色與 1 個思考核心＋fallback；W16 補到 20 節點並通過 200 人 go／no-go。這是內容與 release gate 分期，不是拋棄正式契約的傳統 MVP。

團隊人數與 release 日期尚未由產品 owner 確認，因此此時程先列為 planning assumption，不改寫公開承諾。

## Pre-code gate

依順序完成：

1. 簽署獨立 repo、週席、公地同意、未成年人四項決策。
2. 凍結名詞、禁詞與禁畫面。
3. 核准 bounded-context ADR、共享契約與零跨庫規則。
4. 凍結 OpenAPI、error catalog、idempotency、ETag 與雙端 fixtures。
5. 核准匿名、造人、席位、simulation、revision、entitlement 與 privacy 狀態機。
6. 取得每個資料來源與衍生用途的書面 go／no-go。
7. 簽核 FigJam、screen inventory、五種 badge、全 state 與 a11y handoff。
8. 建立六組 golden fixtures：延遲、更正、缺資料、模型違規、跨裝置、公地拒絕。
9. 定義 W12／W16 的 owner、證據與 go／no-go。P0 未關閉前，不進 feature code。
