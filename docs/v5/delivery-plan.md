# 《盤勢・眾生》V5 動工與交付計畫

_2026-07-23｜Final-product build plan_

## 這不是傳統 MVP

第一個給封測者使用的版本，就要能看見產品最後會長成什麼：

- 公共世界裡有一群持續生活的成年居民。
- 可以跟拍、靠近，再走進一名角色的人生誌。
- 性格、命盤、記憶、情緒、關係與生活壓力真的改變行為。
- 紙上持股、損益、交易和改口留下完整後果。
- 使用者離線後，世界仍繼續。
- 引介、有限編導、失訂和恢復已使用正式權益狀態。
- 資料缺漏、更正、模型失敗、離線與無障礙不是之後再補。

它不是拿幾張假卡驗證點擊率，也不會先做一套日後必須推倒的遊戲規則。實作仍採垂直切片，因為每條正史都必須先證明能重播；差別在於切片使用最終資料形狀，最後只增加容量、內容與精緻度。

## 交付範圍

V5 第一個封測街區固定包含：

| 領域 | 封測交付 |
| --- | --- |
| 世界 | 開盤廳、研究室、咖啡店、住家、車站、夜間屋頂六個場景 |
| 居民 | 50 名成年虛構種子居民，具有完整人生聖經、外觀、關係種子與紙上帳戶 |
| 時間 | 盤前、盤中、收盤、夜間、週末與跨交易日連續性 |
| 市場 | 當期已封存事實、修訂、缺漏、暫停與作廢狀態 |
| 角色 | 注意、解讀、情緒、需求、記憶、關係、命盤作用鏈與行為後果 |
| 交易 | 自主紙上訂單、成交、持股、費用、損益、回撤、公司行動與更正 |
| 故事 | 公共事件、今日五幕、角色近景、人生誌、深層檔案、週末章節與分享卡 |
| 使用者 | 訪客、帳號、追蹤、收藏、引介、有限編導、模擬失訂與恢復 |
| 商業 | `beta_full_access`；正式 entitlement、30 日免廣告與廣告介面存在，但金流和廣告 adapter 關閉 |
| 品質 | 桌機、手機、鍵盤、螢幕閱讀器、reduced motion、200% 字級及所有資料狀態 |

不在封測範圍：

- 真錢交易或券商串接。
- 個人化買賣答案、選股榜、目標價和跟單。
- 全員報酬、勝率、Sharpe、模型能力或「菜度」排行榜。
- 自由 prompt、交易指令或直接改寫角色狀態。
- 未成年人紙上交易。
- 全球市場、多語系與原生商店上架。
- 正式扣款、正式廣告投放和試用倒數。

## 動工前的九個鎖

下列九項沒有書面與機器可驗證結果，不進 production feature sprint：

1. **產品鎖**：本目錄五份核心規格無名詞、權限或資訊層級衝突。
2. **事實鎖**：市場研究 repo 能產生 `WorldFactManifestV1`，本 repo 能驗 hash、版本、時間與權利。
3. **正史鎖**：單一角色從事實到故事的完整事件鏈可 byte-level replay。
4. **帳本鎖**：紙上 ledger 在成交、費用、停牌、公司行動和修正下仍守恆。
5. **角色鎖**：移除人格、命盤、記憶、情緒或關係中的任何一項，能在有界測試中看見它獨有的影響；改 prose 不得改 action。
6. **呈現鎖**：Figma 已交付公共世界、人生誌、承擔、深層檔案與所有失敗狀態，不再拿研究頁當首頁。
7. **市場發布鎖**：盤中 ticker-specific action 物理隔離，盤後 finality、搜尋、通知、分享、廣告與誤讀測試符合 [`market-safety.md`](./market-safety.md)。
8. **人口延續鎖**：每個公開居民都有可機器驗證的 `CharacterLifecyclePolicy` 與 capacity reservation；1,850 人 qualification、全員失訂 tail、day 30／90／365 及長尾成本已通過。
9. **跨區正史鎖**：故障注入證明 canonical event store、command journal、same-transaction outbox pointer 與不可重建 sealed source asset 在 region loss 下 RPO 0；WAL／global position／hash chain 零缺口、command idempotency 與 outbox completeness 未通過時，target 只能 stale read-only。可重建 projection／search／cache／derivative media 的 RPO ≤5 分鐘另行驗收。

## 里程碑

### M0｜V5 規格鎖

完成條件：

- 產品憲法、完整體驗、角色故事引擎、系統設計、視覺系統與本計畫互相引用一致。
- 核心名詞、權益、truth class、事件鏈和 30 日產品驗收固定。
- `ModelCoreCatalog` 至少核准 Gemma 4 26B 預設；若封測呈現核心選擇，至少再有一個通過同組安全、差異、成本與 fallback 測試的公開核心。
- Figma sitemap、desktop／mobile wireframe 與角色母版完成。
- 上游 sealed-fact producer 與本 repo consumer 共同確認 manifest。
- `https://panshi.app` 的 DNS、TLS、apex／www redirect、同源 `/api/v2`、deep link、universal／app link 與舊研究入口隔離契約完成 staging 驗證；M0 不要求公開上線。
- 舊 V2／V4 資產完成 `reuse`、`replace`、`archive` 分類。

輸出：

- ADR：canonical event、logical cell、paper ledger、model gateway、projection、entitlement。
- OpenAPI／Protobuf／JSON Schema 草案。
- command owner、event owner、資料可見性表，以及 CI 可驗證的 [`contracts/canonical-owner-map.yaml`](./contracts/canonical-owner-map.yaml)。
- 端到端 golden episode 劇本。

### M1｜正史脊椎

用一名完全合成的角色和一個封存市場事件打通：

```text
manifest accepted
→ fact visible
→ clue observed
→ appraisal accepted or fallback
→ action intent / semantic speech act
→ immutable utterance artifact when speech exists
→ paper order and fill
→ outcome
→ memory and relationship consequence
→ story chapter
→ close-up, life-journal and portfolio projection
```

完成條件：

- Rust native、WASI、PostgreSQL replay digest 完全一致。
- 所有模型輸入有 cutoff；模型無網路與 canonical write 權限。
- read model 可從零重建。
- 同一命令重送不重複成交。
- 事實更正在 decision seal 前後走兩條正確路徑。
- rich narrative 失敗時，typed evidence card 仍能完整顯示後果。
- 同一 semantic speech act 在 world、近景、人生誌、分享、字幕與重播中只有一份原話 bytes／hash；renderer 不能重寫。
- 區域故障演練在 ACK 後任意切斷 primary：canonical event、command journal、same-transaction outbox pointer 與不可重建 sealed source asset 零遺失；WAL／global position／hash chain、idempotency 與 outbox completeness 未證明前不升 writer。Projection 的 ≤5 分鐘 RPO 只以 canonical recovery 後重建結果計算。

此階段只有內部介面，不對封測者發布。

### M2｜一條完整人物生命

把單角切片做成最終資訊架構：

- 可辨識、可換表情與姿勢的成人 2.5D 角色。
- 一條 canonical 時序人生誌；完整模擬、關係、命盤、性格、記憶與生平各自只存在於 `/archive/*`。
- 原本理由、現在說法、紙上代價和關係後果並排可讀。
- 30 個交易日 fixture，可重播至少一次追高、一次凹單、一次錯過、一次認錯和一次把責任推給別人的事件。
- Loading、empty、stale、held、corrected、withdrawn、offline 全部完成。

完成條件：

- 新使用者不用教學，90 秒內能回答「他現在在意什麼」。
- 首訪在沒有新交易、新台詞或完整歷史的 fixture 上仍能完成跟拍與近景；系統不為 onboarding 建立 per-user 正史。
- 能在兩次操作內從一句改口回到原始說法與當時資料。
- 能在三次操作內找到持股成本、損益、原始理由和退出條件。
- 無障礙替代流程能取得相同人物與數字資訊。

### M3｜終局級封測街區

先把 50 名種子居民放進六個場景；這是初始人口，不是容量上限：

- 世界時間、移動、關係距離與相遇持續運行。
- 公共世界、跟拍、角色近景、人生誌、深層檔案連成單一路徑。
- `今日五幕`（0–5 幕）與週末章節由正史挑選，不按報酬選角。
- 引介每週五名、三種有限編導、追蹤、收藏和提醒。
- `beta_full_access`、模擬失訂、公開世界承接與恢復。
- Character continuity 的 `PUBLIC`／`VISIBILITY_HELD`／`WITHDRAWN` 與 Visible／Active／Background activity tier 分開演練。
- 盤前、盤中、收盤與夜間有不同節奏。
- 分享卡和 9:16 短影音都能回到同一故事章節。

完成條件：

- 2× 預估尖峰下通過 system-design SLO。
- 50 名居民跨 30 個交易日 replay divergence 為零。
- 已公開居民在引介人失訂、低觀看與 Background tier 下仍完成必要 life tick、持股公司行動、更正及高關聯事件 eligibility。
- 紙上帳本 imbalance、double fill 和 future leakage 都是零。
- 引介人看不見任何可直接指定買賣的入口。
- 首頁沒有全員績效、ticker 排名或角色卡牆。
- 角色深頁完整顯示虧損、持股和交易歷史。

### M4｜30 個日曆日 authoring 封測＋30 個交易日觀察

使用固定的至少 60 名成年測試者；這是受測者數量，不是街區居民數。中途離開仍留在分母，不因結果不好更換族群。

同一 cohort 的引介與有限編導窗固定為 `Asia/Taipei` 連續 30 個日曆日半開區間 `[betaAuthoringStartsAt, betaAuthoringEndsAt)`；最多相交六個 ISO 週。只有 Identity admission transaction 封存的 `CommandAdmissionReceiptBodyV1.commandAcceptedAt` 落在窗內，才能在同一 transaction 寫 `QuotaReserved`。Domain validation／acceptance／排程／完成時間不參與 quota window，跨窗 pending command 仍綁原 receipt。窗關閉後仍保留 `beta_full_access` 的完整觀看、深檔案與免廣告，直到至少觀察完第 30 個交易日，但不再開新 authoring quota。

所有測試者在六個相交 ISO 週用滿每週五次引介時，封測人口上界是：

```text
50 seed residents
+ 60 testers × 5 introductions × 6 quota windows
= 1,850 residents
```

Capacity／cost qualification 必須真的建立，或以 production-identical shadow pipeline 建立全部 1,800 份 origin 與合格 asset packs，再讓 1,850 人跑到 calendar day 30 與第 30 個完成交易日中的較晚者；不能只把資料列倍增、拿 placeholder 或關閉角色 cognition 假裝壓測。Calendar day 31 模擬所有人失訂，繼續 deterministic projection 到 calendar day 90、365，並輸出五年現值與 terminal maintenance reserve。

三組互相獨立的證據：

1. **產品行為**：跨日找回同一角色、深頁回訪、追蹤非自己引介的居民。
2. **人物記憶**：能說出慾望、老毛病、一次改口和一段關係變化。
3. **產品定位**：先談人物後談報酬；移除真實市場後續看意願下降。

完整數值門檻以 [`product-constitution.md`](./product-constitution.md) 的 30 日驗收為準。任何 future leakage、帳本不平、人物正史回寫或私人資料外洩都直接停止測試，不用平均分數抵銷。

### M5｜商業發布

只有 M4 通過，且資料權利、台灣法律、資安與營運路徑完成外部審查後才進入。

啟用順序：

1. `panshi.app` apex、`www` 308、TLS／HSTS、同源 API、deep link、association files、OAuth callback 與舊研究入口隔離通過 production smoke test。
2. `free`／`subscriber` 正式 entitlement、簽章 price catalog 和 app receipt／web payment adapter。
3. 帳號建立後 30 日免廣告；之後只在完整章節斷點插入廣告。
4. 單一 Pro 以月繳 NT$329、年繳 NT$2,790 上市；訂閱者無廣告、每週引介五人、三次有限編導及完整歷史。
5. 失訂、grace、公開承接、恢復與刪帳演練通過。
6. p75 與 full-quota cohort 的 origin、asset、day 30／90／365、五年現值及 terminal maintenance reserve 合計不超過淨收入 35%；固定 NT$329／NT$2,790 與每週 5＋3 權益若未通過，M5 直接阻擋，只能降低基礎設施／供應成本後以相同產品承諾重跑。Free 廣告只採實際淨收入，不採預估補貼。
7. p95、錯誤預算、客服、資料更正和緊急撤下 runbook 完成。

金流和廣告只能接在既有 adapter 上。它們不得改動角色、紙上帳本、世界時間或故事正史。

## 並行工作流

### A｜契約與正史

負責：

- `common.v2`、world、character、portfolio、story schemas。
- command／event catalog、idempotency、CAS、cell ownership。
- replay、migration、upcaster 與 canonical fixtures。

依賴：無。
阻擋：B、C、D、E 的 production integration。

### B｜市場證據

負責：

- `WorldFactManifestV1` consumer。
- hash、signature、rights、cutoff、revision 與 correction。
- current-market stale／held／withdrawn 狀態。

依賴：A 的 envelope。
外部依賴：市場研究 repo 發布相容 manifest。

### C｜人物與故事引擎

負責：

- 合成人口、人生聖經、四軸性格、命盤 motif、記憶與關係。
- cognition input seal、思考核心、fallback、deterministic attention／action。
- 韭菜行為 marker、故事 source set 與 narrative segment。

依賴：A、B。
不能依賴：React 畫面、自由 prompt 或未封存網路內容。

### D｜紙上帳本

負責：

- account、order、fill、lot、fee、mark、P&L、drawdown、corporate action。
- correction inverse／forward patch。
- `/archive/paper` 唯一完整人生曲線與承擔 projection；人生誌只取章節摘要 ref。

依賴：A、B。
不能依賴：角色 prose 或 client timer。

### E｜世界與投影

負責：

- clock、scene、presence、encounter、relationship mailbox。
- public／private projection、visibility epoch、SSE、search。
- 今日五幕與週末章節選稿。

依賴：A、B、C、D。

### F｜產品介面

負責：

- 公共世界、跟拍、近景、人生誌、深層檔案。
- 追蹤、收藏、分享、引介與有限編導。
- 所有資料狀態、無障礙和 responsive layout。

依賴：先用 A–E 的 contract fixtures，再接實際 API。
不能建立第二套 client truth。

### G｜視覺、動態與聲音

負責：

- 角色視覺／聲音 identity、表情、姿勢、服裝、物件與磨損狀態。
- 六個場景、鏡頭語法、人生誌母版、分享與 9:16 動態。
- ImageGen source record、crop-safe master、layer bundle、fallback 與 reduced-motion。
- 可恢復的 `CharacterAssetPack` qualification：同一 origin／visual seed、`VoiceIdentityProfileV1`、視覺／聲音身份一致性、成人與反真人相似檢查、權利、alt text、caption、atlas budget 與入場 gate。
- 由不可變原話派生的 `UtteranceAudioRenditionV1`：text／audio hash、voice／合成／詞典 revision、字幕 timing、visibility epoch、rights 與 text-only fallback。

依賴：角色母版與 F 的 viewport contract。
不能用單張漂亮圖代替可演出的角色系統，也不能為了配音好聽重寫角色原話或臨時換聲線。

### H｜帳號、權益與營運

負責：

- account、consent、quota、`beta_full_access`、失訂、恢復、export、delete。
- introduction quota reservation、durable pending state、全 business／asset／capacity gates 通過後 consume、不可拒絕 arrival finalize、終局失敗 release 與 lost-ack reconciliation。
- payment／ads 的 disabled adapters。
- metrics、alerts、backup、restore、withdrawal 與 incident runbook；每季執行 PITR／region-loss restore，分開記錄 canonical RPO 0 qualification 與可重建投影 RPO ≤5 分鐘。

依賴：A 的 lifecycle 與 E 的 visibility boundary。
不能把 account PII 或廣告資料送入角色世界。

## Figma 交付順序

Figma 不是在工程完成後替畫面上色。它先固定資訊距離、動態和失敗狀態：

1. **Sitemap 與 journey**：初見公共世界 → 跟拍 → 近景 → 時序人生誌 → 深層檔案的承擔／關係／命盤／性格／記憶／生平 → 追蹤 → 引介 → 跨日回來。
2. **角色母版**：一名角色在 8 種表情、6 種身體狀態、3 種生活磨損下仍能辨識。
3. **Desktop／mobile 主路徑**：公共世界、近景、人生誌今日章節、深層檔案的承擔與其餘索引。
4. **關係與韭菜樣**：追高、凹單、嘴硬、躲人、認錯各一組動態 storyboard。
5. **權益**：訪客、30 日免廣告、free、subscriber、grace、失訂、恢復、beta。
6. **資料狀態**：loading、empty、stale、held、corrected、withdrawn、offline。
7. **無障礙**：鍵盤、螢幕閱讀器、reduced motion、200% 字級和 390 × 844。

任何 frame 都要標註：

- 世界時間與資料截至時間。
- 此屏 truth class。
- 使用者能改什麼、不能改什麼。
- 哪個結果已成正史。
- 動態開始、結束與中斷後的狀態。

## 種子居民製作線

50 名居民不是讓模型一次吐 50 篇人物介紹。

```text
統計約束與時代背景
→ 合成身分與人生階段
→ 結構化人生聖經
→ 四軸性格、需求與偏誤
→ 固定出生資料與命盤 motif
→ 關係 hook 與生活責任
→ 角色一致性測試
→ 成人／真人相似／分布漂移審查
→ 視覺 identity 與聲音規格
→ 30 日情境 fixture
→ CharacterOriginSealed
```

種子群必須有不同年齡帶、工作狀態、收入壓力、照顧責任、研究能力、社交位置與市場經驗。多樣性不能只靠換髮型、MBTI 字母或一段創傷故事。

每名居民在進封測前至少通過：

- 五段不同市場事件下仍可辨識。
- 一段沒有交易的生活場景也成立。
- 一次與自己信念相反的資料能產生合理反應。
- 一次關係衝突不會被模型直接化解。
- 一次模型 fallback 不會失去人物一致性。
- 一張虧損人生誌不會退化成分析報告。

## 分析事件與隱私

產品分析只記使用者如何追故事，不記角色私人內容：

| Event | 必要欄位 |
| --- | --- |
| `world_entered` | anonymous/account cohort、scene、data state |
| `follow_started` | public character ID、entry surface |
| `close_up_opened` | character ID、source chapter |
| `life_journal_opened` | character ID、entry chapter、return-day bucket |
| `chapter_completed` | chapter ID、duration bucket |
| `commitment_compared` | character ID、commitment and claim public refs |
| `paper_consequence_opened` | character ID、public consequence ref；不送持股 payload |
| `character_followed` | character ID、own-introduction boolean |
| `introduction_completed` | public character ID、selected option categories |
| `scene_seed_submitted` | intent type、accepted／delayed／refused；不送原文 |
| `share_created` | chapter ID、format |

禁止送進一般 analytics：

- account email、登入識別與角色關聯表。
- prompt、記憶文字、人物內心、關係內容。
- ticker 級持股、損益、交易數量與完整分享原文。
- 思考核心 raw input／output。
- 未發布的編導問題。

## 風險登錄

| 風險 | 最早訊號 | 預防與裁決 |
| --- | --- | --- |
| 角色都像同一個模型 | 同事件對白同義、行動差異只靠溫度 | frozen cohort、反事實 exposure、core contract、角色一致性 review |
| 故事只剩盤後摘要 | 使用者先記 ticker、忘記人物 | 首頁人物入口、夜間生活、關係後果、人物記憶指標 |
| 績效搶走故事 | 深頁只看曲線、分享只談報酬 | 承擔順序固定、無全域排行、分享以矛盾和關係為題 |
| 可愛變幼稚 | 年齡難辨、人生壓力沒有視覺痕跡 | 成人比例、生活磨損、年齡與職業 QA |
| 玄學變預言 | 命盤文案出現價格方向或必然 | motif 只進 attention／meaning，copy lint 和 content review |
| 角色變遙控玩具 | 引介人期待指定買賣或結果 | 三種有限編導、角色可拒絕、不可重跑、清楚回饋 |
| current facts 洩漏未來 | 角色引用 cutoff 後資料 | physical field exclusion、manifest binding、property tests |
| 模型成為正史 | 重跑後人物或帳本改變 | schema proposal、Rust validator、stored output replay |
| 同一句被各畫面重寫 | 世界、人生誌、字幕出現不同原話 | immutable utterance artifact、原子封存、全通路 hash equality、整筆 visibility withhold |
| 帳本只是 UI 數字 | 交易無法重播或更正覆寫 | double-entry、exact source price、append-only correction |
| 世界規模先拖垮系統 | 每人每 tick 呼叫模型 | activity tier、event-driven cognition、shared extraction |
| 新引介留下永久成本洞 | 當月收入好看、失訂後角色成本持續上升 | capacity reservation、1,850 人壓測、30／90／365 與長尾準備、既有居民優先 |
| 廣告破壞情緒 | 脆弱片段中途插播 | chapter-boundary slots、ad failure = no ad |
| 退訂像角色被沒收 | 使用者以為人物死亡或被轉賣 | 公開承接、歷史不回檔、恢復後找回原關係 |
| 真人拼貼 | 人物可被對號入座 | 統計約束、禁止真人資料、similarity gate、adult-only |
| 舊 V2／V4 回流 | 新 code import seat／study root | codeowners、CI boundary check、archive namespace |

## 發布阻斷

下列任一條成立，不得對外擴大封測：

- 角色使用當時尚未取得的市場事實。
- 紙上帳本不守恆、重複成交或事後挑價。
- 相同正史在 replay 後得到不同持股、關係或故事來源。
- 模型能直接寫角色、帳本、關係或市場事實。
- cognition、story renderer、字幕或 client 能生成第二份角色原話，或同一 semantic act 出現不同 hash。
- 角色被系統描寫成未成年人。
- 角色可與真實個人資料對號入座。
- 首頁出現依報酬、勝率、模型或「菜度」排序的角色探索。
- 虧損、拒單、錯過或改口被系統性隱藏。
- 使用者或廣告資料進入角色 prompt／正史。
- 任何已公開居民因失訂、低觀看或成本壓力停止最低生命週期義務。
- 1,850 人與全員失訂 tail 未通過容量及長尾成本 gate，卻仍開始收費承諾每週五次引介。
- withdrawn 內容從 cache、搜尋或舊 visibility epoch 復活。
- public flow 可被合理理解成某檔股票的買賣指令。
- 主要流程沒有鍵盤或 reduced-motion 等價操作。

## 完成定義

「規格完成」代表工程不需要再猜以下問題：

- 產品主角是誰，使用者為什麼隔天回來。
- 首頁、跟拍、人生誌與深層檔案各自回答什麼。
- 角色如何出生、知道什麼、犯錯、改口、記得與改變關係。
- 命盤、人格、血型、情緒、記憶和關係各自影響哪一層。
- 模型能做什麼，不能寫入什麼。
- 紙上交易如何成交、結算、更正和呈現。
- 免費、訂閱、封測、廣告、退訂與恢復如何運作。
- 真實資料、統計取樣、虛構設定、象徵解讀和模擬敘事如何區分。
- 系統從一人長到大量居民時，哪些邊界不能改。
- 什麼情況可以發布，什麼情況必須停。

「第一個封測完成」代表同一 cohort 已完成 30 個日曆日 authoring window，且至少一個以 50 名種子居民開場的街區已連續運行 30 個完成交易日，通過人物依附、故事優先、帳本、正史、資料時間、隱私、可用性、無障礙與復原驗收。第 30 個日曆日之後不再新增居民，所以完整引介負載仍以 1,850 名 qualification 為上界；這不是只跑 50 人的 total-population 或 cost gate。它不代表所有內容已做完；它代表之後只需要增加世界、角色、模型、語言、容量和精緻度，不需要再重寫產品骨頭。
