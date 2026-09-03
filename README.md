# 盤勢・眾生

真實台股每天替一群 AI 小人製造未知；你追著他們看，也看著他們追高、嘴硬、凹單、認錯，最後把每次輸贏活成人生。

《盤勢・眾生》是一個行情驅動的 AI 角色實境世界。成年虛構居民帶著性格、命盤、記憶、情緒、生活責任、關係與思考核心，在共同世界裡研究、交談、誤解和紙上交易。公共世界讓人遇見角色，跟拍讓人靠近，角色人生誌沿時序編排原話與直接後果摘要；完整命盤、關係、記憶、紙上持股、損益與交易歷史只由深層人生檔案保存。

持股與績效是角色的承擔證據，不是全世界的排名。本產品不提供全域績效榜、最佳模型榜、跟單訊號或買賣建議。

本 repo 是《盤勢・眾生》的獨立產品來源。它不接管 Panshi 市場研究產品的市場擷取、公司命盤研究或每日內容排程，只接收有來源、版本與 cutoff 的市場事件。

## 現行產品基準

V5 是唯一正式產品基準。遇到衝突時，以[產品憲法](./docs/v5/product-constitution.md)為準，再依[V5 規格索引](./docs/v5/README.md)列出的順序裁決。

- [產品憲法](./docs/v5/product-constitution.md)
- [市場內容與發布邊界](./docs/v5/market-safety.md)
- [完整體驗與 User Journey](./docs/v5/experience-spec.md)
- [角色與故事引擎](./docs/v5/character-story-engine.md)
- [系統設計](./docs/v5/system-design.md)
- [視覺與動態系統](./docs/v5/visual-system.md)
- [交付計畫](./docs/v5/delivery-plan.md)
- [全球競品求同存異與定價](./docs/v5/competitive-synthesis.md)
- [V4 → V5 決策紀錄](./docs/v5/decision-record.md)
- [跨產品契約](./docs/repository-boundary.md)

V4 保留為跟拍手勢、共享場景與受控研究的歷史證據。它不能再決定正式產品的資訊架構、角色深度、商業模式或視覺方向。V2、V3 也只作歷史與技術參考。

## 目前實作狀態

現在可執行的 Web 程式仍是 legacy V4 跟拍研究切片，不代表 V5 已完成。現有 Rust、React、事件儲存、契約與研究程式可作技術材料；是否沿用，必須以 V5 系統設計與交付計畫重新裁決。

封測使用 `beta_full_access`，不接金流、不顯示廣告，也不啟用試用倒數。V5 第一個可測街區必須同時包含公共世界、跟拍、角色近景、角色人生誌、紙上承擔與可愛成人 2.5D 角色，不能再把跟拍切片當成完整產品。

## 產品邊界

| Panshi 市場研究產品負責 | 本 repo 負責 |
| --- | --- |
| 市場與公司資料來源、授權、修訂 | 虛構成年角色與合成人口 |
| 公司命盤與象、證、界研究 | 注意、解讀、情緒、關係與思考核心引擎 |
| 事實封存與市場事件 | 角色生活、紙上行動、帳本、後果與持續正史 |
| 公司研究頁與每日內容來源 | 公共世界、跟拍、角色人生誌、深層檔案與分享 |

兩個產品不共用資料庫、不直接 import application code，也不把 runtime 檔案當 API。需要共用的只有已發布、可驗證、向後相容的資料契約。

## 不做的事

- 不讓玩家指定角色買進、賣出、價格、部位或盤中改單。
- 不提供自由 prompt、資源 buff、人格編輯或改寫人生的 reroll。
- 不用報酬替角色、玩家或模型標示智力與價值。
- 不把真人資料灌進角色，也不讓模型臨時上網拼人物背景。
- 不讓付費提高勝率、提早取得市場事實或改寫既有後果。
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

啟動目前的 legacy V4 跟拍研究切片：

```bash
pnpm --filter @panshi/web dev
```

封存研究 build 時，仍須指定整批受測者共用的 build ID：

```bash
VITE_STUDY_BUILD_ID=study-2026-07-23.5 pnpm --filter @panshi/web build
```

production build 未指定這個 build ID，或指定不同值，現有研究程式會直接建置失敗。這是 V4 研究證據鏈的限制，不是 V5 正式產品的部署契約。

目前 CI 仍會核對部分 V2／V4 commands、canonical events、OpenAPI、Protobuf、PostgreSQL 與 native／WASI fixtures。通過只代表既有技術材料沒有壞，不代表 V5 產品或架構已完成。
