# 《盤勢・眾生》最終級首版技術架構

_2026-07-20｜決策狀態：Implementation candidate，P0 pre-code review 尚未關閉_

本文件是《盤勢・眾生》的工程契約。產品規則以[產品企劃書](./game-product-proposal.md)為準；旅程與跨職能討論放在 [FigJam](https://www.figma.com/board/OZG06ChjZGMaatLc2DDzQA)。若三者衝突，先修產品企劃，再改本文件與 FigJam，不能讓實作自行發明規則。

## 1. 首版定義

這裡的 MVP 是 **Minimum Final Product**。首個 200 人公開封測版就要具備最終產品的資料形狀、身份系統、事件模型、核心循環、雙端契約、隱私操作、視覺語言與營運能力。封測不啟用付款、廣告與商店；當期世界 tick 只在資料授權、延遲規則、金融風險與訊號誤讀 gate 全數通過時啟用。未通過時世界停住並顯示原因，不能用歷史盲播或假資料取代真實未知。

首發後允許的工作只有三類：

1. 增加世界內容、居民、事件回放與敘事細節。
2. 調整已版本化的規則、提示、權重與介面細節。
3. 在不改 API、事件與資料契約下增加 worker、連線池、唯讀副本、CDN 與儲存容量。

首發後若仍要搬主資料庫、換認證、重切 repo、重寫事件帳本、補核心遊戲循環或重做主要資訊架構，即視為首版架構失敗。

## 2. 十項修正

| 舊假設 | 最終決策 |
| --- | --- |
| 先用 SQLite，確認留存後再換 Postgres | 本產品不擁有市場 SQLite；身份、遊戲、權益、事件、fact mirror 與營運資料第一天使用正式 PostgreSQL |
| 一個事件、五個角色就算完成 | 首發是一座含 50 位居民的單一城市；完整支援 D／D+1／D+2、五席、每日引導、紙上帳本與 public replay |
| 只做角色檔案式手機觀測室 | 同時交付 mobile、desktop、reduced-motion 與既有 SwiftUI 的活世界、五席與 replay 畫面 |
| 原生 App 之後再接 | Web 與 SwiftUI 從第一天共用 `/api/v1`、身份、deep link、entitlement 與錯誤契約 |
| 模型可以 bit-level 重播 | 規則可逐位元重播；既有模型輸出靠保存原文重播；重新生成只記錄可比較性，不承諾相同 |
| Magic link 用 URL fragment | 使用一次性、短效、雜湊保存的 email URL token，伺服器兌換後立即失效並旋轉 session |
| 所有頁面都禁止 gapfill | 遊戲只讀 sealed manifest；一般研究頁保留有上限、可標示、可稽核的近期補值 |
| 先寫固定月預算與單次成本 | 成本上限由環境設定、實測單價與活躍席位公式產生，不在程式碼硬寫金額 |
| 先做功能，設計 QA 之後補 | tokens、元件狀態、角色資產規格、動效預算、無障礙與 visual regression 都是首發 gate |
| 套件版本靠規格書猜 | 已存在套件沿用 lockfile；新增套件用 exact pin，升級只能由自動 PR 通過完整測試後合併 |

## 3. 一句話架構

**《盤勢・眾生》使用獨立公開 repository，以 pnpm workspace＋Turborepo 組成 modular monolith；它只接收盤勢研究產品輸出的版本化 sealed fact contract，部署為可獨立擴容的 Web、simulation worker、world scheduler 與 Remotion renderer。**

現在不拆微服務。產品真正需要固定的是事件、模型與資料版本，不是內部服務邊界。Web 與 worker 可用同一份 image、不同 entrypoint 部署；日後增加 replica 不會碰 domain contract。盤勢研究產品與本產品之間以帶版本、hash、`available_at` 與授權標記的事實包交接，禁止直接查詢對方資料庫、掛載對方 SQLite 或 import 對方 application package。

## 4. 唯一技術棧

| 層 | 採用 | 版本與邊界 |
| --- | --- | --- |
| Runtime | Node.js 24.14.0 | 與現有測試用 runtime、Docker、`node:sqlite` 一致；以 `.node-version`／container digest 固定 |
| Workspace | pnpm workspace、Turborepo | 單一 lockfile；Turbo 只負責 task graph、cache 與受影響範圍，不承載 domain logic |
| Web | Next.js 16.2.6、React 19.2.6、TypeScript 5.9.3 | 保留 App Router、RSC 與 standalone image |
| CSS／tokens | CSS Modules、CSS custom properties、JSON design tokens | 不引入 Tailwind；Web 與 SwiftUI 由同一 token source 產生常數 |
| Motion | Motion 12.42.2、CSS、SVG | 互動用 transform／opacity；Remotion 只做影音，不進頁面 runtime |
| API | Next Route Handlers、REST `/api/v1` | 不用 tRPC、GraphQL；domain mutation 不走 Server Actions；OpenAPI 3.1 由 Zod 產生並做 breaking-change gate |
| Validation | Zod 4.3.6 | 輸入、事件、模型輸出與 OpenAPI 的單一契約來源 |
| Auth | Better Auth：invite magic link、passkey、OAuth 2.1 Provider | Web 用 host-only cookie；SwiftUI 用 Authorization Code＋PKCE、短效 access token、旋轉 refresh token |
| Primary DB | Neon PostgreSQL 17，Singapore，production 不 scale-to-zero | pooled Web endpoint、direct worker/migration endpoint、PITR；不用供應商專屬資料模型 |
| Query／migration | Drizzle ORM、`pg`、drizzle-kit SQL migrations | migration 產生 SQL、人工 review、forward-only／expand-contract；不用 Prisma |
| Fact mirror | PostgreSQL metadata＋R2 content-addressed objects | 只保存已驗證的 sealed manifest 與證據修訂；不擁有市場原始 ingest，也不接受未封存補值 |
| Queue／scheduler | pg-boss | 與業務事件同一 PostgreSQL transaction；只負責世界時鐘、事實包匯入與遊戲工作，不接管上游市場排程 |
| Object storage | Cloudflare R2＋CDN | facts、public artifacts、private exports 分 bucket；按 content hash 保存，私有物件走短效 signed URL |
| AI gateway | 自建 typed fetch adapter | 公開程式只見 capability alias，不含 endpoint、憑證與外部 capacity 名稱 |
| Structured generation | Zod → JSON Schema、strict parse、deterministic validator | 不使用 agent framework；模型不是 business logic |
| Video renderer | Remotion 4.0.489 | 與現有 Studio 同版；只吃 sealed manifest 與 approved artifacts |
| Observability | OpenTelemetry→Grafana Cloud、Sentry | trace ID 串 Web、job、model invocation、event 與 artifact；不得送私人筆記 |
| Product analytics | PostHog server-side events | beta 預設最少蒐集；不用 session replay |
| Feature flags | PostgreSQL `feature_flags`＋`feature_flag_overrides` | 預設 fail closed；付款、廣告、商店關閉；`world.current_market` 只在外部 gate 通過後開啟 |
| Rate limit | Cloudflare WAF/IP shield＋PostgreSQL token bucket | 200 人不加 Redis；auth、export、model、public API 與 weekly ledger 分 bucket |
| Email | Postmark REST adapter | SPF、DKIM、DMARC；template 與寄送紀錄不含 magic token 原文 |
| Tests | Vitest／既有 Node test、fast-check、Testcontainers、Playwright、axe-core、Lighthouse CI | 加入 contract、property、visual、load 與 security gates |
| Visual contract | Storybook＋Testing Library＋Playwright screenshots | 所有正式元件與互動狀態有 story；固定 Chromium image 做 pixel diff |
| CI/CD | GitHub Actions、GHCR digest、CodeQL、Gitleaks、Trivy、SBOM、Cosign | build once，promote same signed digest；staging smoke 後人工 promote，migration 與 app 分兩階段 |
| Infra | Docker、Caddy／Cloudflare edge、Neon、R2、公司核准 production capacity | 不上 Kubernetes；主機與部署細節依私有 Nomad runbook，不能寫入 public repo |
| Secrets | 主機 secret vault／systemd credentials／CI environment secrets | 不進 repo、不進 image、不寫 log |
| iOS | SwiftUI、Swift OpenAPI Generator、URLSession transport、Observation、GRDB、Keychain、CryptoKit | 本 repo 維護遊戲原生 target 與共用 API 契約；不用 Expo 或 React Native |

正式環境基線是兩個 Web replicas、至少兩個 workers、一個有 database lease 的 active scheduler，以及可按 backlog 增減的 renderer。四種 process 共用 image digest 與 packages，但使用不同 DB role、resource limit、health／readiness probe；scheduler 即使啟動兩份也只能有一份取得 lease。

### 版本規則

- 現有 `next`、`react`、`remotion`、`zod` 等沿用已提交 lockfile 的 exact resolution。
- 新 production dependency 一律用 `pnpm add -E`；新增前要有 license、維護狀態、bundle／runtime 影響與移除方案。
- 每週由 Renovate 建立 npm、Docker、GitHub Actions 與 Swift package 升級 PR。禁止自動合併 major；minor／patch 也須通過 replay、contract、E2E、visual 與 build gates。
- 規格書不預填尚未安裝的版本號。實作 PR 的 lockfile、SBOM 與 CI 結果才是版本事實。

### 與既有盤勢技術怎麼銜接

| 現況 | 決策 |
| --- | --- |
| Next／React／Zod／Motion／Remotion | 在本 repo 以 exact lockfile 建立，不引用上游 application source |
| Node 24 standalone Docker | 沿用相同 runtime family，各自 build、簽章與部署 |
| 上游 SQLite OHLCV 與研究頁近期 gapfill | 本產品完全不直讀；只有 sealed manifest 能跨越邊界 |
| 上游 SQLite `REAL` 價格 | 上游在輸出契約前轉成整數最小單位＋scale；本產品拒收 JSON 浮點價格 |
| SwiftUI App | 本 repo 維護遊戲畫面並接自身 `/api/v1`；共用登入與 entitlement 只能走已發布的外部契約 |
| Redis、BullMQ、Temporal、Kafka | 首版拒絕；pg-boss 與 PostgreSQL 足以維持 transaction 與重播 |
| Vector DB、Graph DB | 首版拒絕；記憶與關係採 PostgreSQL adjacency rows、版本與明確索引 |
| LangChain、LangGraph、通用 agent SDK | 拒絕；會模糊 evidence、retry 與模型權限 |
| Canvas、WebGL、Pixi | 主要產品拒絕；可存取 DOM＋SVG 足以完成紙偶與關係圖 |
| Storybook | 採用；作為正式 component state contract，與 Playwright visual gate 綁定 |
| Turborepo | 採用；只處理 workspace 任務排序與 cache，不形成部署或 domain 邊界 |

## 5. Runtime 架構

```text
同步讀取
Browser / SwiftUI
  → CDN / Caddy
  → Next /api/v1
  → Auth + rate limit + Zod
  → PostgreSQL read models
  → response + ETag

使用者引導
POST /api/v1/guidance-commands
  → transaction: validate active weekly seat + daily token
                 append guidance command event
                 reserve exactly one guidance token
                 write outbox
  → 202 + command_id

世界推進
world scheduler receives a valid D manifest
  → atomically create world tick
  → enqueue each eligible resident's perception / decision job
  → D: seal paper-order intent
  → D+1: execute fixed paper-order rule
  → D+2: publish delayed replay projection

非同步模擬
pg-boss worker claims job
  → load sealed fact manifest
  → deterministic attention / memory / relationship rules
  → build evidence allowlist
  → optional model invocation through typed gateway
  → schema + evidence + policy validation
  → deterministic allowed action, including a sealed paper-order intent
  → append event chain + projections + narrative artifact
  → outbox dispatch
  → Web SSE / iOS polling refresh

盤後事實包
盤勢研究產品
  → source／license／schema／revision validation
  → published／effective／available／ingested time normalization
  → seal manifest＋content hash
  → 發布版本化 contract artifact 與 immutable object

本產品 world scheduler
  → authenticated fetch／webhook receipt
  → schema version＋hash＋license class＋available_at 驗證
  → immutable fact mirror
  → 原子切換可用 manifest pointer
  → simulation 與 renderer 只讀同一 manifest id

公開公地
approved narrative artifact
  → privacy projection
  → commons entry
  → CDN page / share card
  ↛ private_notes（資料路徑不存在）

短影音
sealed fact manifest + approved narrative fragments
  → 盤勢研究產品的 Studio / Remotion
  → QC
  → media object + publication record
```

### Repo 目標結構

```text
apps/
  web/                 Next Web、REST API、BFF
  worker/              simulation、outbox、export/delete jobs
  scheduler/           fact import、world clock、定期稽核
  renderer/            Remotion 按需 render process
  ios/                 遊戲 SwiftUI target、generated OpenAPI client
packages/
  contracts/           Zod、OpenAPI、error codes、API fixtures
  domain/              角色、關係、席位、entitlement、state machine
  db/                  Drizzle schema、SQL migrations、repositories
  fact-contracts/      上游 schema 的 pinned、generated read-only artifact
  fact-client/         manifest 驗證、匯入與 immutable mirror
  ai/                  capability registry、gateway、validators
  observability/       trace、metrics、redaction
  design-tokens/       Style Dictionary、Web／SwiftUI token generator
docs/                  產品、架構、ADR、runbooks 的公開部分
deploy/                Docker、Caddy、health、promote scripts
```

`apps` 不能互相 import。它們只依賴 `packages`。`domain` 不 import Next、Drizzle、S3 或任何模型 client；所有外部能力透過 interface 注入。這條規則由 ESLint boundaries 與 TypeScript project references 檢查。

## 6. 資料模型

### 共通規則

- ID：UUIDv7 字串；外部公開 ID 另設不可猜測 slug。
- 時間：資料庫 `timestamptz`，API 為帶 `Z` 或 offset 的 RFC 3339；交易日另存 `YYYY-MM-DD` 與 `Asia/Taipei` market calendar version。
- 金額與價格：整數最小單位＋scale，例如 `amount_minor = 12345, scale = 2`；API 用十進位字串，禁止 JSON 浮點。
- 比例：basis points 整數；引擎不得用浮點比較決策門檻。
- JSON：只存經 Zod 驗證、帶 `schema_version` 的 payload；常用查詢欄位正規化成 column。
- 資料身分：`truth_class` 只允許 `real_fact`、`statistical_sample`、`fictional_setting`、`symbolic_interpretation`、`simulated_narrative`。每個可見 claim 必須帶一種身分，且來源型別與身分不符時 fail closed。
- 事實時間：`published_at` 表示來源發布，`effective_at` 表示開始生效，`available_at` 表示依授權、延遲與產品規則可供世界使用，`ingested_at` 表示系統實際取得。角色可見性一律以 `available_at <= logical_at` 判斷。
- 合成人口：只接彙總統計與版本化分布，不保存外部個人列、真實姓名、生日、地址、履歷或社群識別碼。角色身分不得含可回連真人的 upstream key。
- 角色年齡：參與紙上交易的角色生成與匯入都必須滿 18 歲；constraint violation 阻止角色進入世界。
- 刪除：事件真相不做實體改寫。個資以 subject key 加密；刪除時匿名化索引並 crypto-shred，保留無法回推個人的稽核骨架。

### 正式 PostgreSQL tables

資料從第一天分成 `auth`、`game`、`private`、`public`、`ops` 五個 schema，分別給 Web、worker、commons、privacy job 與 operator 最小權限 DB role。下表省略 schema prefix；實作 migration 必須寫出完整名稱。

| Table | 可變性 | 關鍵約束與索引 |
| --- | --- | --- |
| `users` | 可更新 | unique normalized email hash；status、locale、deleted_at |
| `auth_accounts`／`sessions`／`verification_tokens` | 可更新 | token 只存 hash；expiry index；一次性消耗 |
| `installations` | 可更新 | unique installation public key；user nullable 供匿名合併 |
| `data_sources` | 可更新 metadata | public source key unique；authority、adapter、schema、enabled；不存秘密 endpoint |
| `source_license_versions` | append-only | source、license_class、用途、延遲、有效區間、證據物件 hash；不得重疊生效 |
| `source_snapshots` | append-only | source、retrieved_at、schema_version、raw／normalized hash、object key；禁止 row-level personal input |
| `population_distribution_versions` | append-only | authority、reference period、geography、dimensions、method、source snapshot、content hash |
| `population_cells` | append-only | distribution version＋dimension keys unique；count／weight 為整數縮放；抑制值明示 missing reason |
| `generation_constraint_versions` | append-only | rules／IPF／raking／solver config hash、有效區間、review status |
| `cohort_events` | append-only | 起訖、geography、industry、age／cohort eligibility、event type、official fact revision |
| `character_generation_runs` | append-only | distribution／constraint version、seed、input choice hash、validation result、output hash |
| `characters` | 可更新 metadata | owner、public slug、status；出生後 engine identity 不覆寫 |
| `character_traits` | append-only | unique(character_id, version)；有效期不可重疊 |
| `character_background_versions` | append-only | generation run、統計取樣欄位、虛構出生資料、provenance hash；supersedes_id |
| `life_bibles` | append-only | structured fields 與 life events 各帶 truth_class；content hash unique；supersedes_id |
| `memories` | append-only | character_id＋logical_at；correction/supersedes link |
| `relationships` | append-only | canonical pair order；unique(pair, version) |
| `world_snapshots` | append-only | logical_at、calendar_version、content_hash unique |
| `evidence_items` | append-only identity | source_id＋external_fact_key unique；只標識同一事實，不保存可覆寫內容 |
| `evidence_revisions` | append-only | evidence、revision unique；四個時間、license_class、truth_class、source_version、content hash |
| `fact_manifests` | append-only | manifest_hash unique；sealed_at non-null 才可被遊戲使用 |
| `fact_manifest_items` | append-only | unique(manifest_id, evidence_revision_id, ordinal)；available_at <= manifest as_of |
| `perception_decisions` | append-only | run、character、fact revision、full／partial／transmitted／missed、reason codes、attention version、seed |
| `perception_packets` | append-only | character、logical_at、manifest、visible revision／field allowlist、packet hash；prompt 只能讀此表 |
| `event_catalog_versions` | append-only | event type、payload schema hash、aggregate／stream、compatibility window；所有 domain event 必須先登錄 |
| `guidance_commands` | append-only | owner、character、market day、kind、permitted evidence／counterfactual／counterparty、idempotency key、applied tick；不可含 security、side、quantity、price 或槓桿 |
| `daily_guidance_tokens` | 可更新 projection | unique(owner, market day, ordinal)；每日三枚、一次使用、可由事件重建；重送不可多扣 |
| `world_day_sagas` | append-only＋狀態 projection | market day、calendar／manifest／execution policy version、phase、gate result、run hash；確保全城同一 phase 前進 |
| `simulation_runs` | 狀態可更新 | idempotency_key unique；lease、attempt、engine/model/schema version |
| `execution_rule_versions` | append-only | paper cash／exposure、eligible instrument、price basis、fill／corporate action／rounding／tax policy、effective interval、content hash |
| `paper_order_intents` | append-only | character、D manifest、security、side、quantity、rule／reason versions、sealed at；D+1 前沒有 public projection |
| `paper_order_executions` | append-only | intent、D+1 manifest、fixed execution rule、price basis、fill／unfilled reason、content hash |
| `paper_position_projections` | 可重建 | character、logical day、cash／position／corporate-action adjusted state；不可作真相來源 |
| `outcome_replays` | append-only | intent／execution／D+2 manifest、perception／relationship／state refs、owner and public reveal times、artifact hash |
| `disclosure_policy_versions` | append-only | D／D+1／D+2、private／public 各欄位 allowlist、redaction reason、cache／ETag policy；不以事後遮罩代替資料隔離 |
| `simulation_tier_versions` | append-only | high／low tier 的觸發、頻率、關係傳播邊界、fallback、capacity test target；擴容不可改 event 形狀 |
| `state_transitions` | append-only | unique(run_id, seq)；from／to 與 reason |
| `events` | append-only | unique(stream_id, seq)、event_id、prev_hash、hash；不可 update/delete |
| `event_projections` | 可重建 | projection name＋stream version；不可作真相來源 |
| `model_registry` | append-only version | public capability alias、context、schema、status；不存秘密 endpoint |
| `model_invocations` | append-only | run、model version、prompt/schema hash、latency、usage、result object hash |
| `narrative_claims` | append-only | truth_class、basis type／IDs、badge key、template／slot hash；class-basis constraint |
| `narrative_artifacts` | append-only | event range、locale、renderer version、object hash、approval status |
| `weekly_slots` | 狀態可更新＋append events | unique(user_id, season_id, week, slot_no)；draft／confirmed／active／locked／released；不隨單次 simulation consume |
| `entitlements` | 事件＋projection | source adapter、effective interval、capabilities；beta 也是正式 entitlement |
| `commons_entitlements` | append＋projection | resident destination consent、guidance loss、public／private archive、recall 狀態機與生效時間 |
| `commons_entries` | 可撤下 projection | character、artifact、privacy review；不含私人欄位 |
| `private_notes` | 可更新／刪除 | 獨立 encryption key；owner-only RLS／repository；禁止進 analytics |
| `feature_flags`／`feature_flag_overrides` | 可更新 | key unique；environment、audience、expiry、audit reason |
| `rate_limit_buckets` | 可更新 | unique(subject_hash, action, window)；TTL cleanup |
| `audit_log` | append-only | actor、action、target hash、trace、prev_hash；不存 payload 原文 |
| `outbox` | append＋派送狀態 | unique(event_id, destination)；attempt、available_at、sent_at |
| `exports`／`deletion_requests` | 狀態可更新 | owner、expiry、object hash；完成與失敗都有 audit event |

所有 append-only table 由資料庫權限撤銷 `UPDATE`／`DELETE`；更正新增 `evidence_revisions` 與 correction event，不覆寫舊內容。`events`、`model_invocations`、`audit_log` 從第一天按月 range partition。`simulation_runs`、outbox 與 projections 可以更新，因為它們是協調或可重建狀態，不是世界真相。

### 上游市場儲存邊界

市場 SQLite、研究查詢 ledger、近期快取與 gapfill 全部留在盤勢研究產品。遊戲 worker 不查「最新一列」，也不掛載上游資料檔；它只接受已封存且 hash 驗證成功的 `manifest_id`。研究頁的 ephemeral overlay 不得出現在跨產品契約中，成功或失敗都不能修改本產品已匯入的 sealed game snapshot。

### 外部 adapter 與授權閘門

首發只有三類外部 adapter。市場證據走 sealed-fact consumer contract；本產品自行取得的合成人口彙總統計，才走 `discover → fetch → fingerprint → normalize → validate → stage → seal`：

| Adapter | 接收資料 | 必須保留 |
| --- | --- | --- |
| Sealed fact contract | 上游已封存的交易日、公司、市場、公開事件與必要背景 | contract version、manifest/object hash、market calendar、四個時間、license class、revision chain |
| RIS | 年齡、地區、教育與戶數結構 | 統計期間、地理層級、維度、抑制／缺值語意 |
| DGBAS／MOL | 薪資、職業、家庭所得與支出分布 | 調查母體、分類版本、區間、權重與不可涵蓋範圍 |

合成人口 adapter 先查 `source_license_versions`。用途、環境或有效期不符時停止 seal；不能因來源公開可讀就推定可再散布。Sealed fact contract 另驗證上游提供的授權類別、延遲與使用範圍。一般新聞、社群、論壇與真人履歷沒有首發 adapter，gateway 也不提供通用網頁抓取能力。

人口 adapter 只產生分布版本與 cells。角色生成器依年齡／世代 → 地區 → 教育 → 職業 → 收入帶 → 家庭型態 → 居住／照顧負擔 → 職涯 → 四軸與偏誤 → 虛構人生 → 虛構出生資料的順序取樣。只有邊際分布時，方法欄必須標記 rules、weighted sampling、IPF／raking 或 constraint solver；不得以補值名義捏造官方交叉統計。

## 7. 七個核心契約

以下是形狀，不是可直接貼入 repo 的完整 schema；實作以 `packages/contracts` 測試通過的版本為準。

```ts
const Uuid = z.uuid();
const Instant = z.iso.datetime({ offset: true });
const MarketDay = z.iso.date();
const IntString = z.string().regex(/^-?(0|[1-9]\d*)$/);
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const TruthClass = z.enum([
  "real_fact",
  "statistical_sample",
  "fictional_setting",
  "symbolic_interpretation",
  "simulated_narrative",
]);

const DecimalValue = z.object({
  units: IntString,
  scale: z.number().int().min(0).max(8),
  currency: z.literal("TWD").optional(),
});
```

```ts
export const FactManifest = z.object({
  id: Uuid,
  schemaVersion: z.string(),
  asOf: Instant,
  marketDay: MarketDay,
  calendarVersion: z.string(),
  evidence: z.array(z.object({
    evidenceId: Uuid,
    factRevisionId: Uuid,
    sourceId: Uuid,
    revision: z.number().int().positive(),
    publishedAt: Instant,
    effectiveAt: Instant,
    availableAt: Instant,
    ingestedAt: Instant,
    licenseClass: z.string(),
    truthClass: z.literal("real_fact"),
    sourceVersion: z.string(),
    contentHash: Hash,
  })),
  manifestHash: Hash,
  sealedAt: Instant,
}).superRefine(rejectEvidenceUnavailableAtAsOfOrIngestedAfterSeal);
```

`FactManifest` 的可見性判斷只看 `availableAt <= asOf`，不能退回 `publishedAt`。同一個 `evidenceId` 可有多個 revision；manifest 必須鎖定 `factRevisionId`，讓歷史回放保留角色當時真正能讀到的版本。

```ts
export const CharacterState = z.object({
  characterId: Uuid,
  logicalAt: Instant,
  engineVersion: z.string(),
  traitVersion: z.number().int().positive(),
  backgroundVersion: z.number().int().positive(),
  stateBps: z.record(z.string(), z.number().int().min(0).max(10_000)),
  memoryIds: z.array(Uuid),
  relationshipVersion: z.number().int().nonnegative(),
  perceptionPacketId: Uuid,
  stateHash: Hash,
});
```

```ts
export const PerceptionPacket = z.object({
  id: Uuid,
  characterId: Uuid,
  manifestId: Uuid,
  logicalAt: Instant,
  attentionPolicyVersion: z.string(),
  perceivedFacts: z.array(z.object({
    factRevisionId: Uuid,
    channel: z.enum(["direct", "transmitted"]),
    view: z.enum(["full", "partial"]),
    visibleFieldKeys: z.array(z.string()).min(1),
    perceivedAt: Instant,
  })),
  packetHash: Hash,
}).strict();
```

`PerceptionPacket` 不包含角色錯過的事實。觀察者介面可從 `perception_decisions` 另行解釋遺漏，但那份資料不能送入角色 prompt。

```ts
export const CandidateInterpretation = z.object({
  interpretationId: Uuid,
  evidenceClaims: z.array(z.object({
    factRevisionIds: z.array(Uuid).min(1),
    stance: z.enum(["supports", "challenges", "unknown"]),
    proseTemplateKey: z.string(),
    slotKeys: z.array(z.string()),
  })),
  counterEvidenceQuestion: z.string().max(240),
  uncertaintyBps: z.number().int().min(0).max(10_000),
}).strict();
```

`CandidateInterpretation` 只能引用當次 `PerceptionPacket` 裡的 `factRevisionIds`，也只能回傳 allowlist 中的 slot key，不能回傳 slot value；文字欄的數字 literal 由 policy validator 拒絕。renderer 只能從該 perception packet 對應的 manifest 以 slot key 注入數字、日期與公司名稱。

```ts
export const AllowedAction = z.object({
  kind: z.enum([
    "observe", "request_counterevidence", "schedule_dialogue",
    "update_memory_interpretation", "defer", "commit_paper_order",
  ]),
  factRevisionIds: z.array(Uuid),
  ruleVersion: z.string(),
  reasonCodes: z.array(z.string()),
}).strict();

export const PaperOrderIntent = z.object({
  id: Uuid,
  characterId: Uuid,
  decisionManifestId: Uuid,
  securityId: z.string(),
  side: z.enum(["buy", "sell"]),
  quantityMinor: IntString,
  executionMarketDay: MarketDay,
  executionRuleVersion: z.literal("next_market_close.v1"),
  privateIntentRevealAt: Instant,
  publicFullRevealAt: Instant,
  state: z.enum(["sealed", "executed", "unfilled", "cancelled_by_market_state"]),
  reasonCodes: z.array(z.string()).min(1),
  hash: Hash,
}).strict();
```

`commit_paper_order` 只能由角色的規則引擎產生，且必須引用該角色的 `PerceptionPacket`、帳本、狀態與關係版本。使用者 API 永遠沒有 security、side、quantity、price、leverage 或 stop 欄位。D 的意圖封存後由 D+1 manifest 依固定收盤成交規則執行；D+2 才建立完整 public replay。使用者私人畫面只能在公開前一個節點讀到不含標的、方向、數量或價格的意圖類型。

```ts
export const ImmutableEvent = z.object({
  eventId: Uuid,
  streamId: Uuid,
  sequence: z.number().int().positive(),
  logicalAt: Instant,
  recordedAt: Instant,
  eventType: z.string(),
  schemaVersion: z.string(),
  payload: z.record(z.string(), z.unknown()),
  causationId: Uuid.optional(),
  correlationId: Uuid,
  previousHash: Hash.nullable(),
  hash: Hash,
}).strict();
```

```ts
export const NarrativeClaim = z.object({
  claimId: Uuid,
  truthClass: TruthClass,
  proseTemplateKey: z.string(),
  slotKeys: z.array(z.string()),
  basis: z.array(z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("fact_revision"), id: Uuid }),
    z.object({ kind: z.literal("generation_run"), id: Uuid, fieldKey: z.string() }),
    z.object({ kind: z.literal("life_bible_or_memory"), id: Uuid }),
    z.object({ kind: z.literal("symbolic_rule"), id: Uuid, version: z.string() }),
    z.object({ kind: z.literal("simulation_event"), id: Uuid }),
  ])).min(1),
  displayBadgeKey: z.enum([
    "truth.real_fact.public_source",
    "truth.statistical_sample.not_a_person",
    "truth.fictional_setting.character_memory",
    "truth.symbolic_interpretation.not_market_direction",
    "truth.simulated_narrative.character_reaction",
  ]),
}).strict().superRefine(rejectMismatchedTruthClassBasisOrBadge);
```

敘事 renderer 的每個可見 claim 都使用 `NarrativeClaim`。`real_fact` 只能引用 fact revision；`statistical_sample` 只能引用 generation run；`fictional_setting` 只能引用 life bible／memory version；`symbolic_interpretation` 只能引用固定命盤計算與象徵規則；`simulated_narrative` 必須引用本次 action／event。不同身分不能互相冒充來源。

CI 會用「`available_at` 尚未到」、「未感知 evidence」、「浮點價格」、「未知 action」、「缺 truth class／schema version」、「身分與來源不符」、「hash 斷鏈」七類 fixture 確認 fail closed。

### Pre-code P0：五份不可日後補救的凍結契約

GPT Pro 的最終架構 gate 通過後，這五份工作不是再討論產品方向，而是 feature code 前必須被版本化、測試化的世界規則。它們的值可以隨版本演進；**不可**由 UI、prompt 或 worker 各自猜一套。

#### 1. Canonical event catalog 與 client boundary

`packages/contracts` 必須在第一個 feature branch 前登錄下列事件；每個事件都有 payload schema、aggregate／stream、`causation_id`、`correlation_id`、idempotency rule、SemVer 相容策略與跨端 fixture：

| Event | Aggregate／stream | 不可省略的因果 |
| --- | --- | --- |
| `GuidanceCommandIssued` | owner-week-seat | 使用者唯一可寫入的引導命令；消耗哪一枚 token、作用在哪個 tick |
| `DailyTokenConsumed` | owner-market-day | 和 command 同 transaction；重送不能再扣 |
| `PaperOrderIntentSealed` | resident-market-day | 引用 D manifest、perception、rule version；只在 domain 內部產生 |
| `PaperOrderExecuted` | paper-intent | 引用 D+1 manifest、execution rule、fill 或未成交原因 |
| `PositionProjected` | resident-ledger | 引用前一帳本 hash、corporate-action adjustment 與 execution |
| `ReplayPublished` | resident-market-day | 引用 D+2 manifest、disclosure policy、private/public artifact hash |

Client mutation schema 只存在 `GuidanceCommand`; `PaperOrder*`、`PositionProjected` 和 `ReplayPublished` 都只能由 worker／domain append。新增 event 走 additive field → N／N−1 consumer fixture → deprecation window，禁止無版本的 payload rewrite。

#### 2. 世界鐘與跨日 saga

`world_day_sagas` 是全城唯一的市場日狀態機，不是每個角色各自的計時器。它凍結臺北交易日曆、D cutoff、D+1 execution、D+2 publication、時區、假日、停牌、manifest 延遲、補件、更正、重跑與 dead-letter 的轉移表。

```text
waiting_for_valid_manifest
  → D_sealed
  → D_plus_1_execution_ready
  → D_plus_1_executed
  → D_plus_2_replay_ready
  → D_plus_2_published

任一 precondition 失敗 → held（整個 market-day stream 停住）
held → corrected_or_retried → 對應 phase
不可恢復錯誤 → dead_letter（不可部分公開）
```

同一 market day 的 manifest、calendar version、execution policy 與 disclosure policy 必須先鎖定，再 enqueue resident jobs。任何一個前置 gate 未完成時，不能有角色先執行、另一角色先公開；舊資料只能作明確標示的回放，不能假冒為當期世界。

#### 3. 紙上執行規則

`execution_rule_versions` 的第一版在 code 前一次凍結：虛擬起始現金、曝險上限、可用意圖類型、可交易範圍、參考價格／成交時點、成交與未成交、整股／零股、費稅、四捨五入、停牌、除權息、分割、下市與 intent 失效。它是可審計的世界物理，不是產品頁上的操作建議。

每個 rule version 都要產生 sealed fixture。相同 input 的 Rules replay 必須輸出相同 `PaperOrderExecuted` 與 `PositionProjected` hash；錯誤、修訂或缺資料須保留未成交／held 理由，不能用補值偷渡成交。

#### 4. 私有／公共投影的資料隔離

`disclosure_policy_versions` 以逐欄 matrix 定義 owner 與 public 在 D、D+1、D+2 各能讀到什麼，以及哪些欄位永遠 redacted。公地同意、權益失效、撤回、修訂、撤下、CDN invalidation 和 ETag 都要引用同一個 policy version。

private projection 與 public projection 使用不同 repository query、不同 read model 與不同 cache key；不得先讀全資料再以 UI 或 serializer 遮罩。D+1 的 private view 只能取 `intent_type`；任何可被還原為標的、方向、數量或價格的欄位都不進該 projection。

#### 5. Simulation tier 與擴容驗收

`simulation_tier_versions` 凍結 10 位高頻與 40 位低頻居民的升降級條件、更新頻率、關係傳播邊界、model fallback／deterministic fallback 與拒絕發布規則。tier 只改計算資源，不得改資料權限、event schema、replay 形狀或揭示節奏。

必備壓測以同一組 event contract 和 golden fixture 執行 50、5,000、50,000 居民的 replay、排程與 projection benchmark。通過標準是只增加 worker、partition 與 read model 即可擴容；任何需要改 event 或 projection 形狀的結果都視為 P0 失敗。

## 8. Simulation 與重播

### 狀態機

```text
queued
→ claimed
→ facts_sealed
→ attention_completed
→ interpretation_completed | deterministic_fallback
→ action_decided
→ committed
→ narrative_rendered
→ published | held_for_review
→ completed

任一步驟 → retry_wait → claimed
不可恢復錯誤 → dead_letter
取消 → cancelled（只允許尚未 committed）
```

### 一致性規則

- API 接受 `Idempotency-Key`；server 以 actor、command type、週席、canonical payload 產生 request hash。相同 key＋不同 payload 回 `409`。
- worker 使用 pg-boss claim；系統仍一律視為 at-least-once execution，外部 side effect 必須冪等。job payload 只有 ID 與 version，不塞大型 evidence。
- lease 與 heartbeat 都是設定值，依實測 p99 調整；不能在 domain code 寫死秒數。
- retry 只針對 timeout、429、5xx 與暫時性儲存錯誤。schema、evidence、policy、hash 錯誤直接 hold/dead-letter，不用重試洗過去。
- 每一步先查唯一鍵再寫入；commit 事件、projection、outbox 與下一 job 在同一 transaction。
- event hash 使用 RFC 8785 canonical JSON＋SHA-256；每個 stream 維持 sequence 與 previous hash。
- 更正先新增 `evidence_revision`，再建立 `CorrectionIssued`，引用被更正 revision、替代 revision 與新 manifest；舊畫面顯示更正標記，不覆寫歷史。角色只有在新版 `available_at` 之後重新接觸到它，才會更新自己的理解。
- seed 由 run、character、logical date、engine version 決定；所有 pseudo-randomness 走同一注入式 PRNG。

### 三種重播要分開

1. **Rules replay**：相同 manifest、fact revisions、perception packet、seed、engine/schema version 必須得到 bit-exact state 與 action hash。
2. **Stored model replay**：讀保存的原始模型輸出 object，重新跑 validator、action 與 renderer；這條必須可重現。
3. **Model regeneration**：相同 alias、version 與 prompt 再呼叫只做 drift evaluation；不宣稱 deterministic，也不能覆寫原事件。

## 9. 模型安全與角色智商

```text
manifest allowlist
→ available_at time gate
→ deterministic attention／exposure decision
→ immutable perception packet
→ prompt assembler（人物版本、記憶摘要、關係、已感知 fact revisions）
→ capability router（角色選定 alias＋fallback policy）
→ structured model output
→ Zod parse
→ perceived fact revision allowlist
→ number/name slot verification
→ financial-language policy
→ deterministic allowed-action rules
→ narrative renderer
→ truth class / event ID / basis citation
```

模型可以寫候選解讀、三層內心戲、反證問題、研究計畫與記憶連結。模型沒有 browser、search 或任意 retrieval tool，只能讀 `PerceptionPacket`；完整 manifest、錯過的事實與觀察者說明都不進角色 prompt。模型不能新增證據、讀取未來、改價格、決定允許動作、扣席位、改權益、公開私人筆記或直接發布。

角色出生也不由模型自由生成。合成人口引擎先固定統計取樣、四軸性格偏好、虛構人生事件與虛構出生資料；星曆計算服務再以固定版本產生命盤與象徵主題。模型最後只把結構化人生聖經寫成敘事，不得新增欄位、真人來源或事實主張。

`model_registry` 保存 capability alias、輸入／輸出 schema hash、context limit、locale 能力、啟停狀態與 fallback chain。角色出生時選的是公開 alias；不顯示或保存非公開 capacity 來源。預設思考核心的公開 alias 為 `balanced-26b`；實際 model route、供應商與 capacity mapping 只存在私密營運設定，不能進 public repo、文件、commit 或產品 UI。

失敗處理：

- timeout／rate limit：同 alias 一次受控 retry，再依 registry 走 fallback。
- schema 或 evidence 違規：不發布模型文字，改用 deterministic fallback 卡並留下 review event。
- 所有模型都不可用：角色「今天沒有形成可發布判斷」，每日循環仍可完成，不能憑空補內容。
- kill switch 可依 alias、功能、環境、角色或全域關閉；關閉後不影響 rules engine 與歷史重播。

## 10. Auth、權益與隱私

### Web 與 SwiftUI 共用身份

1. 使用者輸入 email；server 回傳相同成功訊息，避免帳號枚舉。
2. server 產生高熵、短效、單次 token，只保存 hash；transactional email 寄出 HTTPS link。
3. Email 指向 `/auth/link?t=...`。GET 只顯示無第三方資源的確認頁，避免郵件安全掃描器消耗 token；使用者確認後以同源 POST 原子兌換，再 `303` 到不含 token 的 URL。
4. Web 建立 host-only `Secure`、`HttpOnly`、`SameSite=Lax` session cookie；登入後可註冊 passkey，magic link 仍保留作復原路徑。
5. SwiftUI 走 Better Auth OAuth 2.1 Provider 的 Authorization Code＋PKCE；access token 短效、refresh token 旋轉並只放 Keychain，不做 cookie bridge。
6. magic token、authorization code、state、nonce、installation 與 redirect URI 都有到期、單次使用與 replay audit。登入頁設 `Referrer-Policy: no-referrer`。

Cookie 不設 `Domain`，只屬 `panshi.app`。CSRF 以 SameSite、Origin/Fetch Metadata 檢查與 mutation token 防護。正式 Web/API 同源；瀏覽器跨 origin CORS 預設全部拒絕，iOS 不依賴 CORS。

### Entitlement 從首日就是最終形狀

所有功能只問 capability，例如 `weekly_slots=5`、`models.select=true`、`ads.enabled=false`，不直接問「是不是 Pro」。封測由 `beta_full_access` adapter 發正式 entitlement events。付款、StoreKit、廣告 adapters 已有 interface、contract tests 與 disabled configuration，但不載入 SDK、不呈現付費牆、不送廣告 request。

失去權益的狀態機完整可測：grace → guidance_lost → chosen_destination(public_city | private_archive) → recalled。建立角色時明示選擇目的地，預設 public_city；私人筆記、未公開人生聖經與帳號資料永遠不隨角色進公地。

### Privacy operations

- Export：非同步生成 JSON＋Markdown，物件加密、短效 signed URL、下載後到期刪除。
- Delete：二次確認、撤銷 session／token、停止 jobs、刪私人 objects、crypto-shred subject key、匿名化必要稽核欄位。
- Private notes：獨立 repository、獨立 encryption key；simulation worker、analytics、commons projection 沒有讀取權限。
- Backup：PostgreSQL PITR＋每日可攜 dump、object versioning／lifecycle；每月 staging restore drill，每季書面 production recovery exercise。
- Log：email、token、筆記、prompt 原文與自由文字一律 redaction；trace 只留 stable opaque ID。

### 合成人口與角色隱私

- 外部人口、薪資與家庭來源只接彙總表，不接個人 microdata 或可識別列；若未來研究需要 microdata，必須另立隱私、授權與隔離審查，本首發契約不自動涵蓋。
- 禁止匯入或爬取真人社群、履歷、生日、住址、職涯軌跡與關係網，也禁止把多個真人欄位拼成一個可辨識角色。
- 血型只能隨機生成或由玩家在儀式中有限選擇，不得從地區、族群、外貌、健康或其他特徵推論。
- 公地發布前檢查罕見條件組合與自由文字，不顯示過細地理、完整虛構生日或可造成真人誤認的細節；檢查規則版本化並保留 review event。
- UI、export 與 share card 都要把 `statistical_sample` 顯示為「統計取樣｜非真人資料」，不得簡寫成真實人物、真人背景或使用者資料。

## 11. `panshi.app` domain contract

域名已購買，但規格不假設 DNS、憑證或信箱已完成。

| 項目 | 正式契約 |
| --- | --- |
| Canonical | `https://panshi.app` |
| `www` | `https://www.panshi.app/*` 308 到相同 path/query 的 apex |
| 舊站 | 舊公開 subdomain 在 cutover 驗證後 301 到相同 path；至少保留 12 個月 |
| Media | `https://media.panshi.app` 只提供已核准、不可變的 public artifacts |
| Staging | 不可索引的獨立 host；不同 cookie、DB、bucket、OAuth／email config |
| TLS | TLS 1.2+；先短 HSTS canary，再升一年，確認所有 subdomain 後才考慮 includeSubDomains／preload |
| Headers | nonce-based CSP、HSTS、Referrer-Policy、Permissions-Policy、nosniff、frame-ancestors、COOP；依 route 設 cache |
| Cookie | host-only、Secure、HttpOnly、SameSite；不跨 subdomain |
| SEO | self canonical、sitemap、robots、OG；帳號、私人觀測所、分享草稿 noindex |
| PWA | manifest、icons、theme、standalone；service worker 不快取 auth、私人頁與 mutation response |
| Universal Links | `/.well-known/apple-app-site-association` 以有效 HTTPS、無 redirect 提供；只開可安全導覽的 path |
| Email | SPF、DKIM、DMARC 先觀察再收緊；transactional return-path 與人類回覆信箱分開 |

Cutover 順序：staging rehearsal → apex DNS 低 TTL → TLS／headers／AASA／email 驗證 → canary → canonical 與 sitemap → 舊站 redirect → HSTS 拉長。回滾只改流量與 canonical，不回滾已執行的資料 migration。

需要人類完成的外部項目：Cloudflare zone／WAF／R2、Neon production／staging projects 與備份等級、Postmark 寄信網域、Grafana Cloud／Sentry／PostHog projects、正式 Apple Team／Associated Domains，以及法務與資料授權簽核。工程不能假裝這些帳戶、DNS 或憑證已完成。

## 12. Web、動效與視覺品質

### Rendering strategy

- RSC：首頁、公地、角色卷宗初始資料、SEO 與靜態敘事。
- Client islands：角色出生、五席安排、關係圖互動、事件展開、模型狀態與即時 job progress。
- RSC 負責 initial read；TanStack Query 只處理 client polling、mutation、失效與局部 optimistic UI。optimistic 操作必須可撤銷且帶 idempotency key。
- pointer／scroll 連續值進 Motion value 或 CSS property，不進 React state。
- DOM 保存閱讀順序與鍵盤操作；SVG 僅畫關係線、命盤與裝飾，所有資訊另有語意文字。

### 首發 visual contract

- Design tokens：色彩、字級、字距、行高、空間、邊框、陰影、紙材、墨色、動效 duration／easing、z-index、focus ring。
- 元件狀態：default、hover、focus-visible、pressed、selected、loading、empty、error、offline、stale、locked、redacted、held-for-review、reduced-motion。
- 角色資產：每名種子角色有頭像、半身、剪影、五種狀態與分層紙偶；來源、prompt、license、版本與 crop safe area 一併保存。
- 動效：紙偶呼吸、銅燈、關係牽引、卷宗展開與場景轉換；不得用循環閃爍、不可阻斷閱讀。
- 字型：品牌 display font 只用於短標題；長文使用高可讀繁中字體 fallback；所有 glyph subset、license 與 FOIT/FOUT 策略入版控。
- Component contract：每個正式元件、頁面組合與上述狀態都有 Storybook story，mock 只使用經 contract 驗證的 fixture。
- Visual regression：Playwright 從 Storybook 與完整旅程截圖，覆蓋 390、768、1440 px、dark/light 如適用、200% zoom 與 reduced motion。固定 Chromium image；差異需設計 owner 核准。

### Performance budgets

| 指標 | 首發 gate |
| --- | --- |
| 公開入口 LCP p75 | ≤ 2.5 s（目標區域真機／4G profile） |
| INP p75 | ≤ 200 ms |
| CLS p75 | ≤ 0.1 |
| 首頁 initial JS gzip | ≤ 180 KB；超出需 ADR |
| 世界視圖 route incremental JS gzip | ≤ 250 KB；角色圖片不計 |
| 角色首屏圖片 | AVIF/WebP、明確尺寸、responsive；不得阻塞文字 |
| 非必要 motion | `prefers-reduced-motion` 下移除位移與 parallax |

## 13. SwiftUI 首發範圍

原生 App 不複製 domain rules。Swift OpenAPI Generator 從同一份 OpenAPI 3.1 產生 client，搭配官方 URLSession transport、相同 error codes 與相同 entitlement capabilities；CI 禁止另寫重複 DTO。

首發必要畫面：登入與 link exchange、今日世界與 D／D+1／D+2 replay、居民名冊與出生、五席安排、城市世界視圖、三層內心戲、證據因果、關係網、分岔報告、私人筆記、公地、思考核心選擇、權益模擬、分享／匯出／刪除、離線／失敗／held-for-review。

- Networking：generated client＋`URLSession` async/await transport；request signer、idempotency key、ETag 與 typed errors 集中在 `APIClient` adapter。
- Auth：access token 僅記憶體，refresh token 放 Keychain；401 單航班 refresh，失敗回登入。
- State：Observation；screen model 不保存另一份世界真相。
- Cache：GRDB 只保存 read models；公開 manifest、角色 projection 與圖片可離線，私人筆記另行本地加密。離線不可提交 simulation，所有 mutation 以 server event 為準。
- Deep link：`panshi.app` Universal Links；custom scheme 只作開發／舊版 fallback，不承載 auth token。
- beta：StoreKit、廣告與付費牆由 feature flag 完全隱藏；既有程式不刪，不能在未啟用時初始化 SDK。

Web 可以先於 App UI 數日進 staging，但兩端要在同一 first-release gate 通過。任何排程差只能是畫面施工順序，不能產生第二套 API、auth 或 entitlement。

## 14. 可觀測性、SLO 與成本

每個 simulation／model event 記錄：trace ID、run ID、job type、manifest／engine／schema／model alias version、queue wait、step latency、attempt、input/output byte size、token usage、validator reason code、fallback、artifact hash、成功／held/dead-letter。不得記 email、筆記、prompt 原文或可回推內容。

### SLO

| SLI | 200 人封測 SLO |
| --- | --- |
| 公開與已登入讀取可用性 | 30 日 99.9% |
| mutation 接受率 | 99.5%，排除客戶端 4xx |
| 已接受 simulation 最終完成 | 15 分鐘內 99%，模型全掛時仍產生 fallback |
| evidence／citation integrity | 100%；不符即停止發布 |
| truth-class／badge integrity | 100% 可見 claim 有合法身分與 basis；不符即停止發布 |
| event chain 驗證 | 每日 100% stream 抽驗、每週全量 |
| export | 24 小時內 99% |
| deletion workflow | 依法定／產品承諾時限 100% 完成 |

告警依 error budget，而不是單一尖峰。kill switch 分 `model`, `simulation`, `commons_publish`, `share`, `live_market`, `ads`, `payments` 七層。

### Budget guard

```text
weekly_budget = active_guided_characters
              × trading_days
              × max_full_reasoning_per_character_day
              × measured_p95_cost_per_invocation
              × safety_factor

admission_allowed = projected_period_cost <= configured_budget
                 && model_error_budget_remaining
                 && queue_age < configured_limit
```

所有金額、倍率與期間來自 secret-free environment config／feature flags；dashboard 顯示預估、實際與每活躍角色成本。達 soft limit 降低非引導角色敘事頻率；達 hard limit 切 deterministic fallback，不讓請求無限排隊。

## 15. 測試與 release gates

| 層 | 必測 |
| --- | --- |
| Unit | 角色權重、四個事實時間、truth class、金額、席位、entitlement、policy、canonical hash |
| Property | `available_at` 防偷看、18+、合成人口條件一致、相同比例縮放不改 action、事件 sequence 單調、任意 retry 不重複扣席 |
| Replay | 20 manifest 的 rules bit-exact；指定 fact revision／perception packet；stored model output；correction chain |
| Contract | Zod↔OpenAPI↔Swift fixtures；truth class／badge／basis；向後相容；所有 error code |
| Model | schema、perceived fact allowlist、漏看資料不進 prompt、數字 slot、prompt injection、timeout／fallback、alias retirement |
| Integration | sealed-fact consumer contract、兩類人口統計 adapter、license gate、Postgres transaction、pg-boss claim、outbox、S3 hash、export/delete、PITR restore fixture |
| UI | 五種資料身分 100% 可見、來源與修訂展開、Playwright Web E2E、axe、鍵盤、200% zoom、reduced motion、visual snapshots |
| iOS | XCTest contract fixtures、Universal Link、Keychain refresh、offline、export/delete |
| Security | auth enumeration、token replay、CSRF、SSRF、IDOR、rate limit、真人資料／罕見組合洩漏、headers、secret scan、dependency audit |
| Finance red team | 買賣指示、目標價、報酬排序、當期個股洩漏、免責包裝訊號、廣告誘導 |
| Load／chaos | 目標負載 2 倍；kill worker、model timeout、DB failover、object 5xx、queue retry |

Production promote 前必須同時通過：lint、typecheck、build、unit/property、migration dry run、20 節點 replay、contract、Web E2E、iOS tests、visual approval、a11y、security scan、load target、backup restore drill、observability smoke、法規／資料 flag 檢查與 panshi.app cutover rehearsal。

## 16. 十二週交付順序

| 週 | Production-grade artifact |
| --- | --- |
| 1 | pnpm／Turbo workspace、正式 PostgreSQL 五個 schemas／roles／migration、contracts、CI/security、secret boundary、staging skeleton |
| 2 | Better Auth magic link／passkey／OAuth PKCE、Swift generated client、installation merge、entitlement／flags、rate limits、audit |
| 3 | event store、hash chain、outbox、pg-boss worker、idempotency、replay CLI、S3 artifact adapter |
| 4 | sealed-fact consumer、兩類人口統計 adapters、license ledger、四時間正規化、D／D+1／D+2 manifest fixtures、`available_at` tests、跨 repo contract test |
| 5 | population distributions、generation constraints、cohort events、versioned character birth／background／traits／life bible／memory／relationship |
| 6 | weekly slots、每日三枚引導籤、world tick、attention／exposure／perception packet、sealed order intent、D+1 execution、D+2 replay、commons state machine |
| 7 | model registry、選擇／fallback、strict generation、perceived-fact／truth-class／policy validator、stored-output replay |
| 8 | 完整 Web mobile＋desktop 活世界、五席、名冊、出生、因果、關係、公地、私人筆記、失敗狀態 |
| 9 | SwiftUI 全核心旅程接 `/api/v1`、Universal Links、離線快取、分享、匯出、刪除 |
| 10 | generated character asset set、Style Dictionary tokens、Storybook、Motion、visual/a11y/perf gates |
| 11 | observability、analytics、budget／kill switches、backup／restore、load／chaos／security／金融紅隊 |
| 12 | 200 人資料與權限演練、內容 QA、App/Web release candidate、panshi.app cutover rehearsal、beta go/no-go |

### 前十個工作天

| 日 | 交付 |
| --- | --- |
| D1 | 建 pnpm／Turbo workspace、ADR、Node/pnpm exact toolchain、CI/security matrix、env schema、secret boundary；不搬現有功能 |
| D2 | 建 Neon staging、五個 schemas、source／population／character／fact-revision／perception tables、最小權限 roles、partitions、baseline migration、PITR／dump policy |
| D3 | 寫七個核心 Zod contracts、truth class、四時間與 perception rules、OpenAPI 3.1、Swift client generation、breaking-change test |
| D4 | Better Auth schema、scanner-safe magic link、passkey、Web session、auth rate limit、audit events |
| D5 | OAuth 2.1 Provider＋PKCE、Keychain rotation、installation merge、Universal Link／callback fixture |
| D6 | event store、canonical hash、stream concurrency、revision-preserving correction event、rules replay test |
| D7 | pg-boss、lease/retry/dead-letter、transactional outbox、idempotent simulation command |
| D8 | R2 三 bucket adapter、content-addressed artifact、bucket lock／retention、model registry tables |
| D9 | Style Dictionary tokens、Storybook state matrix、semantic app shell、紙偶 asset manifest |
| D10 | 第一個官方來源 manifest 與第一名合成角色走完整管線，驗證 truth class、`available_at`、perception 與正式底座 |

## 17. 首發承載量與只擴容門檻

首發不是按 200 人剛好配置。release candidate 要在 staging 通過下列合成負載，並保留至少 2 倍日常餘裕：

| 維度 | 首發驗收容量 | 只擴容觸發 |
| --- | --- | --- |
| Registered users | 10,000 | 不改 schema；加 app replica／DB capacity |
| DAU | 2,000 | CDN hit、Web CPU 或 DB read p95 逼近 SLO 時加 replica／read pool |
| Concurrent interactive sessions | 500 | Web p95 或 connection utilization > 70% 持續 15 分鐘 |
| Active character fixtures | 50,000 | 增 worker／DB compute；不改角色或席位事件 |
| Simulation jobs | 50,000／交易日 | queue age 超 SLO 或 worker utilization > 70% 時加 replica |
| Immutable events | 10 million | 已按月 partition；加 DB compute／調 partition，不改 event envelope |
| Queue／outbox history | 1 million | retention／archive；job schema 不變 |
| Artifacts | 100,000 objects／100 GB fixture | lifecycle tier＋CDN；object key／hash 契約不變 |
| API reads | 150 req/s sustained，30 分鐘 | CDN、read replica、pool；API 不變 |
| Mutations | 30 req/s sustained，30 分鐘 | Web replica、pool；idempotency／event 不變 |
| Backup | 實測 RPO ≤ 5 min、RTO ≤ 60 min | 增 PITR／backup capacity；資料契約不變 |

這些數字是 load-test target，不是流量預測。真正擴容採監控觸發：

- worker：queue oldest age 達 SLO 的 50% 或 CPU > 70% 持續 15 分鐘，增加 replica。
- DB pool：等待時間 p95 > 50 ms 或使用率 > 70%，先修慢 query，再增加 pool／compute；總連線受 DB 上限控制。
- Read replica：讀流量占 DB CPU > 60% 且索引／cache 已最佳化。
- Queue partition：單一 queue 的 oldest age 在增加 worker 後仍失控，按 job class 分 queue，不改 job payload。
- Object CDN：egress 或 origin p95 超 budget，調 cache key／TTL 與區域，不改 artifact identity。
- 真正需要新服務的唯一門檻，是單一 PostgreSQL transaction 已無法維持所需吞吐；在實測前不預建 Kafka／Temporal。

## 18. ADR

| 技術 | 決策 | 重新評估門檻 |
| --- | --- | --- |
| pnpm workspace＋Turborepo | Adopt now | Turbo 可換，workspace／package 邊界不變 |
| Neon PostgreSQL 17＋Drizzle | Adopt now | 不重評主資料模型；只增加 compute／read replica，必要時以標準 PostgreSQL 移轉 |
| Sealed fact consumer contract | Adopt now | 只有版本、授權或可用時間語意改變時升級；禁止退回直讀上游儲存 |
| Better Auth | Adopt now | 只有安全／維護停止或無法支援既定雙端契約才換 adapter |
| pg-boss | Adopt now | 跨區、跨 DB transaction 或每日 job 遠超 50,000 才評估 Temporal/Kafka |
| Cloudflare R2／S3 contract | Adopt now | 只換 endpoint，不換 object contract |
| Redis／BullMQ | Reject now | rate/queue 實測證明 PostgreSQL 成為瓶頸且加容量無效 |
| Temporal／Kafka | Reject now | 出現跨服務長流程與明確吞吐證據 |
| Vector／Graph DB | Reject now | 明確產品查詢無法由 PostgreSQL 索引達 SLO |
| Prisma | Reject | 無重評需求 |
| LangChain／LangGraph／通用 agent SDK | Reject | 無；模型不能成為 orchestrator |
| OpenTelemetry＋Sentry | Adopt now | 可換 exporter，不換 trace contract |
| PostHog server-side | Adopt now | 隱私或成本不符時換 sink，不換 event taxonomy |
| Storybook | Adopt now | 正式 component contract；與 Playwright visual gate 一起維護 |
| Vitest／Node test＋fast-check＋Playwright | Adopt now | 既有 Node tests 不重寫；新 component/domain tests 依適用 runner |
| Swift OpenAPI Generator＋GRDB | Adopt now | generated contract 不變；本地 cache 可換 adapter |
| Expo／React Native | Reject | 本產品維持 SwiftUI 原生 target |
| Kubernetes | Reject now | 至少三個獨立服務、跨多主機排程與值班能力成熟才重評 |

## 19. Definition of Done

首個公開封測版只有在以下條件全部成立時才算完成：

### 核心產品

- 至少一組 D／D+1／D+2 當期世界 fixture 與足夠的回放 fixture，各有 manifest、來源、`published／effective／available／ingested` 時間、hash 與 revision-preserving 更正流程。
- 50 位單城居民、角色出生、三種同權思考核心、長期名冊、每週五席、每日三枚引導籤、D／D+1／D+2、三層內心戲、證據因果、關係網與分岔報告完整可用。
- 角色由版本化彙總統計與條件規則生成；可用相同 seed 重建，沒有真人 upstream key，所有紙上交易角色均滿 18 歲。
- 每個可見 claim 都有五種 `truth_class` 之一、正確 badge 與可展開 basis；統計取樣、虛構人生、象徵解讀與模擬敘事不能被引用成真實事實。
- 同一則世界事實可被角色完整閱讀、部分閱讀、轉述或錯過；角色 prompt 只含自己的 perception packet，觀察者層才能解釋遺漏。
- 玩家能投入問一問、遞線索、約一席三種引導籤，寫私人筆記、追蹤公地、分享、匯出與刪除；任何 client mutation 都不能攜帶交易指令欄位。
- 權益失效、失去引導權、角色進公地與召回以 simulator 走完整事件，不接付款。
- 公地不含私人筆記、email、未公開人生聖經或可反查 owner 的 ID。
- 模型選擇、版本固定、fallback、held-for-review、kill switch 與 stored-output replay 通過。

### 雙端與設計

- Web mobile、desktop、鍵盤、200% zoom、screen reader 與 reduced motion 通過。
- Storybook 覆蓋所有正式元件、頁面組合與互動狀態；固定 Chromium image 無未核准 visual diff。
- SwiftUI 完成第 13 節必要畫面，generated client、OAuth PKCE、Universal Links、GRDB offline read 與 Web contract conformance 全部通過。
- generated character assets、字型、tokens、元件全狀態、Motion 與 visual regression 由設計 owner 核准。
- 公開入口與世界視圖通過第 12 節 performance budgets。

### 資料、營運與安全

- TWSE、TPEx、MOPS、RIS、DGBAS／MOL、CWA adapters 通過 schema、provenance、license、revision 與 fixture tests；一般新聞、社群、論壇與真人履歷沒有啟用 ingestion path。
- rules bit-exact replay、stored model replay、`available_at` look-ahead、perception isolation、exact-revision correction、idempotency、outbox 與 hash chain 全數通過。
- 合成人口 property tests 通過年齡、教育、職業、收入、家庭與職涯約束；只有邊際統計時，method／missing reason 如實保存，不能出現偽造交叉表。
- 100% Web、SwiftUI、export、share 與短影音可見 claim 通過 truth-class／badge／basis 自動檢查；任何漏標一律 fail closed。
- migration 可在 production-like dataset forward deploy；上一版 app 在 migration window 仍可讀寫相容欄位。
- export、delete、session revoke、anonymous merge 與 private-note isolation 通過攻擊測試。
- Neon PITR 與 nightly logical backup 已啟用；完成隔離 staging restore，實測 RPO ≤ 5 分鐘、RTO ≤ 60 分鐘。
- 500 concurrent sessions、150 read RPS、30 mutation RPS、50,000 simulations/day 的 gate，以及 worker kill、model timeout、object failure、DB failover 演練通過。
- dashboards、SLO、alert、budget guard、PII redaction 與七層 kill switches 在 staging 觸發過。
- secret scan、dependency audit、CSP／HSTS／CORS／CSRF／IDOR／rate limit 與金融禁語紅隊無未處理 blocker。
- `panshi.app` DNS、TLS、AASA、email、canonical、redirect 與回滾完成 cutover rehearsal；正式 DNS 尚未核准前不宣稱上線。
- 付款、廣告、live current-stock、商店訂閱全部由 production feature flag 關閉；程式不初始化相應 SDK。
- 法務、資料授權與 App Store 風險項目有 owner、證據與 go/no-go 狀態。

## 20. 參考實作文件

- [TWSE OpenAPI](https://openapi.twse.com.tw/)
- [TPEx OpenAPI](https://www.tpex.org.tw/openapi/)
- [公開資訊觀測站](https://mops.twse.com.tw/mops/)
- [TWSE 交易資訊使用管理辦法、契約與收費](https://www.twse.com.tw/zh/products/information/use.html)
- [內政部戶政司人口統計](https://www.ris.gov.tw/info-popudata/app/awFastDownload/toMain_panel)
- [主計總處薪情平臺](https://earnings.dgbas.gov.tw/)
- [勞動部職類別薪資調查](https://www.mol.gov.tw/1607/71771/72867/72920/lpsimplelist)
- [中央氣象署開放資料使用說明](https://opendata.cwa.gov.tw/devManual/insrtuction)
- [MBTI 名稱與正式評量工具權利說明](https://www.myersbriggs.org/using-type-as-a-professional/mbti-permission-trademarks/)
- [Better Auth Magic Link](https://better-auth.com/docs/plugins/magic-link)
- [Better Auth OAuth 2.1 Provider](https://better-auth.com/docs/plugins/oauth-provider)
- [Better Auth Next.js integration](https://better-auth.com/docs/integrations/next)
- [Drizzle migrations](https://orm.drizzle.team/docs/migrations)
- [pg-boss](https://github.com/timgit/pg-boss)
- [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting)
- [PostgreSQL point-in-time recovery](https://www.postgresql.org/docs/current/continuous-archiving.html)
- [Apple Supporting Associated Domains](https://developer.apple.com/documentation/xcode/supporting-associated-domains)
- [Swift OpenAPI Generator](https://github.com/apple/swift-openapi-generator)
- [Storybook visual testing](https://storybook.js.org/docs/writing-tests/visual-testing)
- [Turborepo](https://turborepo.dev/docs)
- [Neon regions](https://neon.com/docs/introduction/regions)
- [Renovate](https://docs.renovatebot.com/)

本文件不公開部署主機、憑證路徑、外部模型 capacity 來源、私有 endpoint 或營運帳戶。這些只存在私有 runbook。
