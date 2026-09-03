# 《盤勢・眾生》V5 動工前終局審查

_2026-07-23｜Status: `PRE-CODE MAXIMUM REACHED`_

## 結論

V5 已到適合鎖定骨架、開始 production-shaped 垂直切片的程度。

ChatGPT Pro 只讀取以 `V5-FINAL-143-R5-` 命名的九份終局附件，先驗證附件版本與機器基線，再做跨文件 P0 審查。最終判定是：

> `VERDICT: PRE-CODE MAXIMUM REACHED`
>
> `P0 BLOCKERS: NONE`

審查原文保留在[同一條 Pro 對話](https://chatgpt.com/c/6a61ac35-6f54-83ec-b4b7-ee703b4e9a52)。

這個判定的意思不是「產品已可發布」，而是目前沒有已知問題會迫使團隊在工程中後期重切產品形狀、canonical history、aggregate ownership、跨 context saga、紙上帳本、權益、公開 API、可見性或跨區 durability。接下來的未知應靠程式、Figma、故障注入、封測與外部審查取得證據，不再靠增加規格段落想像答案。

終局 verdict 後，只有 [`README.md`](./README.md) 增加本審查紀錄的連結；九份受審規格與 owner map 的 normative 內容未再修改。

## R5 受審基線

| R5 attachment | Repository source | 裁決範圍 |
| --- | --- | --- |
| `00-INDEX` | [`README.md`](./README.md) | 文件優先序、產品形狀、V4／V5 邊界 |
| `01-PRODUCT-CONSTITUTION` | [`product-constitution.md`](./product-constitution.md) | 不可退讓原則、商業契約、30 日驗收 |
| `02-EXPERIENCE-SPEC` | [`experience-spec.md`](./experience-spec.md) | 完整旅程、資訊架構、畫面與狀態 |
| `03-CHARACTER-STORY-ENGINE` | [`character-story-engine.md`](./character-story-engine.md) | 人物出生、認知、關係、記憶、紙上後果與故事 |
| `04-SYSTEM-DESIGN` | [`system-design.md`](./system-design.md) | bounded contexts、事件、API、權益、安全、復原與擴張 |
| `05-VISUAL-SYSTEM` | [`visual-system.md`](./visual-system.md) | 可愛成人 2.5D、韭菜樣、ImageGen、動態、聲音與字型 |
| `06-DELIVERY-PLAN` | [`delivery-plan.md`](./delivery-plan.md) | 動工鎖、里程碑、工作流與驗收 |
| `07-MARKET-SAFETY` | [`market-safety.md`](./market-safety.md) | 台股時序、非建議邊界、發布與撤回 |
| `08-CANONICAL-OWNER-MAP` | [`contracts/canonical-owner-map.yaml`](./contracts/canonical-owner-map.yaml) | aggregate／event owner 與 projection 禁止回寫 |

[`competitive-synthesis.md`](./competitive-synthesis.md) 與 [`decision-record.md`](./decision-record.md) 是研究與決策脈絡；它們不覆蓋上表的 normative 規格。

## 五輪審查如何收斂

| Round | 判定 | 找到的骨架問題 | 關閉方式 |
| --- | --- | --- | --- |
| R1 | `REWRITE` | 資訊架構、owner map、immutable utterance、SceneSeed、Introduction、首訪與人口上限共七項 P0 | 人生誌與 `/archive/*` 分工；建立機器可讀 owner map；原話只封存一次；補完跨 context receipt／quota saga；首訪只讀既有正史；固定 1,850 人 qualification |
| R2 | `REWRITE` | PaperAccount／PaperOrder／PaperPosition 權責重疊；廣告解鎖形成第五種 audience path；價格與 5＋3 仍可移動 | 三個 aggregate 分權並封存 exact version set；刪除 rewarded archive grant；固定 NT$329／NT$2,790 與每週 5＋3，35% 不過只阻擋 M5 |
| R3 | `ATTACHMENT SET INVALID` | 同一對話混入舊附件，重提已修問題 | 不採信該輪架構 verdict；改用每輪唯一檔名、byte-for-byte 複本與強制附件前置驗證 |
| R4 | `REWRITE` | Canonical event loss = 0，卻允許 region failure RPO ≤5 分鐘 | 建立 `CanonicalDurabilitySetV1`；canonical ACK 前完成跨區 lossless durable record；failover continuity proof 未過只能 stale read-only；≤5 分鐘只留給可重建投影 |
| R5 | `PRE-CODE MAXIMUM REACHED` | 無 P0 | 鎖定 V5；開始垂直切片與實證 gate |

R5 也重新核對 R1–R4 的所有修正，不以「前一輪說已修」代替讀取終局附件。

## 機器與本地驗證

終局基線已通過：

- 14 個 bounded contexts，其中 13 個可寫 canonical state。
- 38 個 canonical aggregates。
- 13 個 event families、143 個事件，143 個名稱全部 globally unique。
- 10 個 non-canonical projections；全部禁止 command、canonical event 與 write-back。
- Paper Portfolio 有 14 個事件；`PaperAccountJournalPosted` 存在。
- PaperAccount 4、PaperOrder 4、PaperPosition 6 個 route；無重複、無遺漏、無額外 route。
- Relative Markdown links 全部可解析；code fences 成對；`git diff --check` 通過。
- 既有 contract audit、fixture audit、sealed-fact audit、study-release audit、OpenAPI lint 與 Web TypeScript check 通過。
- 獨立的 region-loss 定向審查結果為 `NO P0/P1`。

## 動工後仍要取得的證據

以下項目可以阻擋里程碑或發布，但不要求重開 V5 骨架：

1. **Schema 與 replay**：deterministic bytes、native／WASI／PostgreSQL parity、upcaster fixtures、read model 從零重建與 owner-map CI。
2. **市場證據**：producer／consumer conformance、cutoff、correction、rights revoke、停牌、假日、晚 finality 與所有 public surfaces 的負向 fixture。
3. **人物因果**：人格、命盤、記憶、情緒與關係各自的有界反事實測試；模型 timeout、late result、schema reject 與 fallback race。
4. **原話一致性**：artifact 原子 crash injection、duplicate callback、全通路 ID／hash equality，以及 audio／caption 共用同一 text hash。
5. **紙上帳本**：double-entry 守恆、double fill = 0、事後挑價 = 0、公司行動、更正與三 stream CAS fault injection。
6. **跨區正史**：ACK 後任意 region loss 仍零資料損失；continuity proof 失敗時維持 stale read-only；可重建投影的 RPO 另行量測。
7. **產品與可及性**：16 人高保真設計驗證、50 名種子居民與六個場景；手機、桌面、鍵盤、螢幕閱讀器、200% 字級、reduced motion 與完整資料狀態。
8. **人口與成本**：1,850 份 production-identical origin／asset qualification，跑到較晚的 calendar day 30 或第 30 個完成交易日，再驗 day 90／365、五年現值與 35% gate。
9. **外部發布**：Figma 視覺母版、真實 sealed-fact producer、資料與生成資產權利、台灣證券法、隱私、資安及 current-market release gate。

封測仍使用 `beta_full_access`，不接金流、不顯示廣告。任何外部審查、故障演練或使用者證據未通過，都應關閉相應功能或阻擋里程碑；不能暗中縮減人物生命、改寫正史、移動價格與 5＋3 承諾，或把產品退回冷色研究入口。
