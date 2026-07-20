# Pre-code readiness

_2026-07-20｜判決：`PRE-CODE MAXIMUM REACHED`_

核心架構已到可動工前能合理固定的上限。目前沒有已知缺口會迫使團隊在擴張時重切 bounded context、aggregate ownership、canonical history、deterministic kernel、privacy isolation 或 cell-based scale path。

這個判決不等於產品已完成，也不等於可以公開上線。它表示後續工作可以在既有契約內增加 schema、fixtures、服務、介面與容量，不應再靠改寫核心歷史來補洞。若產品憲法、法律路徑或當期模式邊界改變，必須重新開啟架構審查。

## 判決依據

- 產品規則以 [產品憲法 v2.1](../product-constitution.md)為唯一基準。
- [Architecture Constitution v1.3](../architecture/architecture-constitution.md)固定 bounded contexts、交易邊界、時間、權利、修正、刪除、遷移與容量路徑。
- [Event Catalog v1.3](../architecture/event-catalog.md)、[State／Payload Map v1.2](../architecture/state-payload-map.md)與 [transition contract v1.2.0](../../contracts/policy/command-transition-map.yaml)互相對照。
- `ruby tools/contract-audit.rb` 已驗證 133 個 commands、147 個 canonical events，沒有 catalog、transition 或 payload 漏接。
- 多輪對抗式審查逐次重跑刪帳、封盤、修正、作廢、榜單裁決、content／game bind、crash／retry、亂序 delivery 與 scale boundary；最後一輪未發現核心重寫 blocker。

## 已固定的骨架

1. 玩家只做「排席」；角色最後的公司、方向、`NO_ACTION` 與信心由版本化 deterministic policy 決定。
2. 模型只產生可封存的 evidence appraisal，不寫人物、價格、分數或最終行動。
3. Historical 與 Current 是隔離的 mode domains。公開首版只使用至少一年前、虛構名稱與遮蔽日期的 historical episode。
4. 每個 content session 以單一 `ContentSessionLedger` 排定 fact、rights 與 bind permit；pack digest 必須等於 ledger heads，不能被延遲 stale 通知繞過。
5. Session、Crew 與 Score 的結算可原子重播；因果關閉後只追加 correction，不覆寫角色已經歷的人生。
6. Contribution、division standing、season standing 與 adjudication close 有兩道完成集 barrier；少一項都不能關閉。
7. Account、ControlLease、CrewLifecycleFence、visibility 與 privacy archive 各有可達、可重建的刪除路徑；舊 autonomy、deadline 與 projection 受 epoch fence 阻擋。
8. Beta 可用較小部署拓撲，但事件、receipt、logical cell、ownership epoch 與 migration contract 從第一版就沿用最終資料形狀。

## 仍須關閉的 gate

- 好玩度：60 秒排席、三日理解、八回合因果有效率與觀看者誤讀測試。
- 角色：因素影響率、角色差異率、反事實與模型 fallback fixtures。
- 賽制：500 個分層賽季、盲策略支配、Coverage、risk brake 與 scoring golden model。
- 外部條件：歷史資料權利、臺灣法遵、當期模式書面路徑與訊號誤讀測試。
- 工程：OpenAPI edge conformance、threat model、command handlers、projection worker、failure injection 與 load qualification。Protobuf canonical bytes、native／WASI golden parity、SQLx migration 與 atomic append vertical slice 已關閉。
- 設計：高保真 Figma、元件 library、首批生成角色資產、motion study、可用性與無障礙驗證。FigJam 尚有一個舊「查看十五則注意事項」節點；刪除前不得交付工程。

完整項目與驗收證據見 [Pre-code backlog](../../BACKLOG.md)。
