# 盤勢・眾生

真實台股是天氣，一群 AI 小人活在天氣裡；觀眾只能選擇跟著誰看，不能替任何人決定。

《盤勢・眾生》是一個與真實市場同步的互動實境節目。小人有自己的生活、命盤、記憶、關係與思考核心；觀眾在同一個持續運行的世界裡跟拍一個人，再因他的注意力把鏡頭交給另一個人。沒有角色卡牆、交易指令、每日官方主戲或唯一心理答案。

本 repo 是這個互動節目的獨立產品來源。它不接管盤勢研究產品的市場擷取、公司命盤研究或每日內容排程，只接收有來源、版本與 cutoff 的市場事件。

## 目前狀態

V2 的五席排程與 V3 的觀象所／今日主戲方向都已否決。V4 不先凍結架構，也不先擴寫世界設定；目前唯一任務是用一個直向場景、16 位居民、三檔股票和一則已封存公告，驗證十分鐘的「跟拍」是否成立。

現有 Rust、React、事件儲存與契約程式都是技術材料，不能反推 V4 產品。封測不串金流、不顯示廣告。第一個原型使用可核對的歷史市場片段，不偽裝直播，也不產生買賣建議。

V4 產品基準：

- [產品北極星](./docs/v4/product-north-star.md)
- [十分鐘互動原型](./docs/v4/interaction-prototype.md)
- [兩輪 Pro 原型審查與 24 人測試閘門](./docs/v4/prototype-review-2026-07-20.md)
- [24 人研究模式與固定裁決](./docs/v4/study-mode.md)
- [相鄰產品研究](./docs/v4/research-reset.md)
- [跨產品契約](./docs/repository-boundary.md)

V2、V3 歷史與技術材料，不得拿來定義 V4：

- [產品憲法](./docs/product-constitution.md)、[排席 User Journey](./docs/ux/user-journey.md)、[視覺系統](./docs/design/visual-system-brief.md)
- [Architecture Constitution](./docs/architecture/architecture-constitution.md)、[event catalog](./docs/architecture/event-catalog.md)、[state／payload map](./docs/architecture/state-payload-map.md)
- [command transition map](./contracts/policy/command-transition-map.yaml)、[client contract](./docs/architecture/client-contract.md)、[舊 backlog](./BACKLOG.md)
- [Pre-code readiness](./docs/reviews/pre-code-readiness.md)、[vertical-slice gate](./docs/reviews/vertical-slice-gate-2026-07-20.md)、[舊競品研究](./docs/research/competitive-patterns.md)
- [`docs/v3/`](./docs/v3/) 全部內容，包括觀象所、今日主戲、照拂時機、WorldNode 與五人房間。

## 產品邊界

| panshi.app 研究產品負責 | 本 repo 負責 |
| --- | --- |
| 市場與公司資料來源、授權、修訂 | 虛構角色與合成人口 |
| 公司命盤與象、證、界研究 | 注意、解讀、情緒、關係與思考核心引擎 |
| 事實封存與市場事件 | 角色生活、模擬行動、後果與持續正史 |
| 公司研究頁與每日內容來源 | 公開場景、跟拍視角、人物連續片段與分享 |

兩邊不共用資料庫、不直接 import application code，也不把 runtime 檔案當 API。需要共用的只有已發布、可驗證、向後相容的資料契約。

## 不做的事

- 不讓玩家指定小人的買進、賣出、價格、部位或盤中改單。
- 不提供自由聊天、照拂按鈕、資源 buff 或人格編輯。
- 不以報酬替角色、玩家或模型標示智力與價值。
- 不把真人資料灌進角色，也不讓模型臨時上網拼人物背景。
- 不讓付費提高勝率、提早取得市場事實或改寫角色情緒。
- 不在公開 repo 保存憑證、私有資料、生成媒體、營運紀錄或未公開供應資訊。

## 本機驗證

需求：Node 24、pnpm 11.15、Rust 1.97.1、Buf 1.72。完整 native／WASI 位元組驗證另需 Wasmtime 45.0.0。

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm test
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
tools/verify-kernel-parity.sh
```

啟動 V4 十分鐘跟拍原型：

```bash
pnpm --filter @panshi/web dev
```

開啟後會播放 2026-07-17 的封存場景。按住一位居民進入跟拍，按住不放並拖向另一位居民或公告即可交接；點按與下方三個按鈕提供相同的替代操作。

原創觀測桌插畫屬歷史資產，不再決定 V4 畫面。V4 以全螢幕共同場景、可跟拍的小人、灰藍自然光和冷色市場訊號重做視覺。

現有 CI 仍核對 V2 的 commands、canonical events、OpenAPI、Protobuf、PostgreSQL 與 native／WASI fixtures。它只能證明舊技術材料沒有壞，不能代表 V4 產品或架構已通過。
