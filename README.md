# 盤勢・眾生

把五個人送進同一個真實市場，看他們活成五種不同的命。

《盤勢・眾生》是一個與真實市場同步的 AI 人物世界。小人有自己的生活、命盤、記憶、關係與思考核心；市場每天提供所有人共同面對的未知事件。玩家扮演觀象所館主，給最多五名小人資源、問題與相遇的機會，不能替他們決定答案。

本 repo 是遊戲的獨立產品來源。它不接管盤勢研究產品的市場擷取、公司命盤研究或每日內容排程，只接收有來源、版本與 cutoff 的市場事件。

## 目前狀態

V2 曾把產品收斂成五席排程遊戲；2026-07-20 經產品重置後，該方向不再成立。V3 以「可追劇的活人市場世界」為產品中心：公共世界先行、人物是主角、真實市場是物理層、玩家只有有限照拂權。V3 產品方向已完成反證並凍結，下一階段是 Figma、世界模擬架構、法律／資料查核與封測設計。

產品方向凍結不代表 V3 已可上線。V2 尚未合併的 server-loop 程式已封存在 `william/archive-v2-seat-engine-spike`；現有 main 程式只能作技術材料，不能再反推產品。封測不串金流、不顯示廣告，先用當期公開市場事件驗證人物世界與觀看迴圈。

V3 產品基準：

- [V3 產品重置判決](./docs/v3/product-reset.md)
- [V3 凍結後執行交接](./docs/v3/execution-handoff.md)
- [V3 User Journey](./docs/v3/user-journey.md)
- [V3 競品重查](./docs/v3/competitive-reset.md)
- [V3 視覺與動態系統](./docs/v3/visual-system.md)
- [跨產品契約](./docs/repository-boundary.md)

V2 歷史與技術材料，不得拿來定義 V3：

- [產品憲法](./docs/product-constitution.md)、[排席 User Journey](./docs/ux/user-journey.md)、[視覺系統](./docs/design/visual-system-brief.md)
- [Architecture Constitution](./docs/architecture/architecture-constitution.md)、[event catalog](./docs/architecture/event-catalog.md)、[state／payload map](./docs/architecture/state-payload-map.md)
- [command transition map](./contracts/policy/command-transition-map.yaml)、[client contract](./docs/architecture/client-contract.md)、[舊 backlog](./BACKLOG.md)
- [Pre-code readiness](./docs/reviews/pre-code-readiness.md)、[vertical-slice gate](./docs/reviews/vertical-slice-gate-2026-07-20.md)、[舊競品研究](./docs/research/competitive-patterns.md)

## 產品邊界

| panshi.app 研究產品負責 | 本 repo 負責 |
| --- | --- |
| 市場與公司資料來源、授權、修訂 | 虛構角色與合成人口 |
| 公司命盤與象、證、界研究 | 注意、解讀、情緒、關係與思考核心引擎 |
| 事實封存與市場事件 | 角色生活、有限照拂、模擬行動、後果與 replay |
| 公司研究頁與每日內容來源 | 公開眾生場、人物連載、收盤一幕與分享 |

兩邊不共用資料庫、不直接 import application code，也不把 runtime 檔案當 API。需要共用的只有已發布、可驗證、向後相容的資料契約。

## 不做的事

- 不讓玩家指定小人的買進、賣出、價格、部位或盤中改單。
- 不以報酬替角色、玩家或模型標示智力與價值。
- 不把真人資料灌進角色，也不讓模型臨時上網拼人物背景。
- 不讓付費提高勝率、提早取得市場事實或改寫角色情緒。
- 不在公開 repo 保存憑證、私有資料、生成媒體、營運紀錄或未公開供應資訊。

## V2 技術材料的本機驗證

需求：Node 24、pnpm 11.15、Rust 1.97.1、Buf 1.72。完整 native／WASI 位元組驗證另需 Wasmtime 45.0.0。

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm test
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
tools/verify-kernel-parity.sh
```

啟動目前的 V2 技術原型：

```bash
pnpm --filter @panshi/web dev
```

原創觀測桌插畫屬 release asset，不進 source control。V3 會沿用黑墨、古銅、紙張、命盤與人物肖像，但不再以五席圓桌作為首頁或唯一互動。

現有 CI 仍核對 V2 的 commands、canonical events、OpenAPI、Protobuf、PostgreSQL 與 native／WASI fixtures。它只能證明舊技術材料沒有壞，不能代表 V3 產品或架構已通過。
