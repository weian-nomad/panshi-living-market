# Pre-code backlog

這份 backlog 只放會阻擋正式實作的工作。v0.6 將產品重置為真實市場時間驅動的活世界；產品細節與長期內容仍以[產品企劃書](./docs/game-product-proposal.md)為準，舊 Pro 缺口報告僅保留其中仍適用的身份、資料、隱私與雙端審查結論。

## P0

| ID | Deliverable | Acceptance evidence | Owner | Status |
| --- | --- | --- | --- | --- |
| P0-01 | 獨立 repo 與跨產品契約 | public remote、ADR-0001、舊 repo 無遊戲企劃、零跨庫規則 | Engineering | Done |
| P0-02 | 名詞、世界揭示與金融視覺契約 | glossary、D／D+1／D+2 reveal policy、禁詞／禁畫面、示範稿 removal list | Product／Risk | Open |
| P0-03 | 五席與每日引導狀態機 | assign／draft／confirm／active／lock／release；三枚引導籤、週界、重送不重扣 | Domain | Open |
| P0-03a | 虛擬交易與 replay 狀態機 | D intent seal → D+1 execution → D+2 owner／public reveal；停牌、除權息、缺資料與修訂 fixtures | Domain／Data | Open |
| P0-03b | 思考核心差異契約 | 三個同權 core 的可比較失誤型態、alias/version/fallback/replay；無能力或付費優勢 | AI／Product | Open |
| P0-03c | Canonical event catalog | 6 個核心 event 的 payload、aggregate、causation／correlation、idempotency、SemVer、N／N−1 fixtures；client 只可送 guidance command | Domain／API | Open |
| P0-03d | World-day saga | D／D+1／D+2、臺北交易日曆、停牌、延遲、補件、更正、dead-letter 的全城 atomic transition table 與 E2E | Domain／Data | Open |
| P0-03e | 紙上執行 rule v1 | cash／exposure、成交、公司行動、費稅、rounding、unfilled、intent 失效的 versioned policy 和 bit-exact replay fixtures | Domain／QA | Open |
| P0-03f | Private／public disclosure matrix | D／D+1／D+2 的逐欄 allowlist、redaction、query/read-model/cache isolation、ETag／CDN invalidation tests | Privacy／API | Open |
| P0-03g | Simulation tier 與 scale proof | 10／40 tier policy、fallback、關係邊界；50／5,000／50,000 同 contract replay／scheduler benchmark | AI／Platform | Open |
| P0-04 | 公地同意與失去權益 | consent receipt、revoke、private archive、public projection、recall state machine | Product／Privacy | Open decision |
| P0-05 | 未成年人政策 | 18+ guidance gate 或法律核准替代方案；FigJam 與 API 同步 | Legal／Product | Open decision |
| P0-06 | 來源及衍生用途 register | 每來源 authority、license、延遲、App／影片／遊戲用途與書面 go／no-go | Legal／Data | External gate |
| P0-07 | API v1 freeze | OpenAPI、error catalog、ETag、idempotency、pagination、SSE／polling、fixtures | API | Open |
| P0-08 | 匿名與登入合併 | installation merge rules、conflict policy、Web／SwiftUI E2E | Backend | Open |
| P0-09 | Truth badge visual contract | 五 badge、混合 claim 拆分、來源／時間／修訂展開；100% claim audit | Design／Risk | Open |
| P0-10 | Data and reveal state matrix | missing／delayed／stale／corrected／withdrawn + D／D+1／D+2 的 UI、API、worker transitions | Data／Design | Open |
| P0-11 | World simulation failure matrix | queued／retry／fallback／held／published／dead-letter + paper intent／execution／replay 的 UI 與操作 | AI／Frontend | Open |
| P0-12 | FigJam pre-code package | 城市 IA、世界時鐘、inventory、journey、service blueprint、swimlanes、test script | Design Ops | Open |
| P0-13 | Figma pre-code package | 世界視圖、三端核心畫面、tokens、font、components、states、motion、a11y、handoff | Design Ops | Open |
| P0-14 | Golden fixtures | D／D+1／D+2、延遲、更正、缺資料、模型違規、跨裝置、公地拒絕各一組 | QA／Data | Open |
| P0-15 | Release gates | W12 RC 與 W16 beta 的 owner、測試證據、當期世界外部 gate、人工簽核和 go／no-go | Product／Engineering | Open |

## P1

| ID | Deliverable | Acceptance evidence | Owner |
| --- | --- | --- | --- |
| P1-01 | Offline／stale／cross-device sync | ETag conflict、筆記合併、席位刷新、重送測試 | Web／iOS |
| P1-02 | Notification policy | opt-in、quiet hours、deep link、拒絕與金融文案紅隊 | Product／Risk |
| P1-03 | Private note isolation | RLS、encryption、analytics／prompt／commons denial tests | Privacy |
| P1-04 | Export／delete／beta-end lifecycle | deadline、retry、resume、failure recovery E2E | Operations |
| P1-05 | Design parity | mobile Web、desktop、SwiftUI state parity review | Design Ops |

## Execution order

P0-02 到 P0-06 先關決策與外部 gate。P0-03c 到 P0-03g 與 P0-07 再凍結世界事件、時鐘、執行、可見性與跨端契約。接著完成 FigJam、Figma 與 golden fixtures，最後簽署 release gates。

Workspace、CI、schema 與 contract scaffolding 可以先做；任何會固定使用者旅程、公開資料、席位扣用或模型發布行為的 feature code，需等對應 P0 有驗收證據。
