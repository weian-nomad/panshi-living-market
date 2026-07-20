# Architecture Constitution

_版本 1.3｜2026-07-20｜由[產品憲法 v2.1](../product-constitution.md)推導_

本文件固定第一個可執行版本就必須遵守的 domain、資料、決策與部署契約。beta 可以使用較小的實體拓撲，但不能使用之後需要換資料形狀、重寫重播或拆除跨模式共用的臨時架構。

## 架構判決

採用 **cell-based、append-only、single-write-boundary modular core**：

- 玩家與角色的業務真相保存在 append-only canonical streams。
- 同一 crew 的遊戲 aggregate 共置於一個 logical cell，session 結算在單一 PostgreSQL transaction 完成。
- 模型只建立可封存的 evidence appraisal；08:25 後的注意、社交、行動、計分與人物更新全由 deterministic Rust kernel 執行。
- Historical、Current、PII、private gameplay、public projection 與 audit 依資料風險分層；Current 未通過 gate 前，資料面、憑證、hostname 與 key 都不存在。
- logical contracts 從 beta 起完整；Kubernetes 與 broker 只在容量與操作複雜度達到門檻後加入。

## 不可違反的十條 invariant

1. `Crew`、`RoundDesk`、`DecisionSession`、`ScoreLedger` 與 settlement journal 必須位於同一 logical-cell write boundary。
2. 每個 canonical write 都帶 `command_owner`、`preconditions[]`、idempotency key、logical cell 與 ownership epoch；禁止 last-write-wins。
3. 前一個有效 session 未 `SessionCausalityClosed` 或 `VoidCommitted`，不得封存下一個 session 的 decision input。
4. stale appraisal pack 不得 bind；bind 後不得靜默換入新事實、模型、政策或 normalizer。
5. 模型輸出、prompt、fact、policy、engine 與 normalized appraisal revision 永久留在 decision snapshot；法證重播不重新呼叫模型。
6. 單變量反事實與替代思考核心情境只寫 scenario store，不得產生 canonical 人物、分數或榜單事件。
7. 失訂與刪帳是不同流程；刪帳先提交 logical-cell lifecycle fence，再撤銷身份與銷毀 user-scoped key，且不得讓角色進入公共自主世界。
8. public projection 只能由 `VisibilityGrant` 的單向 sanitizer bridge 建立，不能反寫 private gameplay；所有 public write 都要通過 visibility epoch。
9. client clock、cache、projection、broker delivery 與管理員畫面都不是 cutoff、結算或權利狀態的真相源。
10. Current domain 未通過核准 gate 時，任何人都不能靠 feature flag、資料上傳或管理員權限把它打開。

## Bounded contexts

| Context | Authoritative aggregates | 唯一可寫內容 | 禁止事項 |
| --- | --- | --- | --- |
| Governance／Content Vault | `ModeDomain`、`RightsManifest`、`Episode`、`SessionSchedule`、`ContentSessionLedger`、`Universe`、`FactPack`、`AppraisalPack`、`BenchmarkPack`、`PolicyBundle`、`ModelSnapshot` | 三種時間、內容、權利、模型與 policy revision 的批准、封存、撤回，以及每一 content session 的單調語意順序 | 遊戲端補事實、換模型、改 rights 或啟用 Current |
| Identity／Control | `Account`、`Entitlement`、`ControlLease` | 身份、封測權益、排席控制權、匯出與刪帳協調 | PII 進 gameplay event；付款服務直接控制角色 |
| Desk Play | `SeasonDesk`、`RoundDesk` | 卷宗、排席、脈絡、封席合法性 | 選角色最後公司、方向、q；繞過 risk brake |
| Character Life | `Crew` | 五名角色、十組關係、記憶、情緒、需求、信念與校準更新 | 模型或公共世界直接 patch 人物狀態 |
| Decision／Replay | `DecisionSession` | frozen input、注意、peer packet、actions、settlement、void 與 replay | 擁有 reveal visibility；直接寫 Crew 或 Score；重抽 appraisal |
| Competition | `Season`、`Division`、`ScoreLedger` | season seed、division membership、DP、Coverage、standardized drawdown、risk brake 與 qmax | 由 projection 或排行榜回寫會員或分數 |
| Lifecycle／Visibility | `CrewLifecycleFence`、`VisibilityGrant` | lifecycle epoch、刪帳 fence、公開 audience 與 visibility epoch | 由 projection 自行恢復可見性；舊 epoch command |
| Public World | `AutonomyRun` | 產生公共生活計畫，再向 Character Life 發 typed command | 直接 patch Crew；接管、拍賣、贖回角色；讀 private memory |

這些 context 是 monorepo 內的獨立 Rust crate／module，不是七個 repository。Desk Play、Character Life、Decision 與 Competition 在 beta 共用一個 game-core deployment 與同一 logical-cell database，但各自使用 PostgreSQL namespace、command handler 與寫入權限。Identity、content builder、public API 分 deployment。

## 狀態機

```text
Episode
DRAFT → APPROVED → SEALED → PUBLISHED
                         ↘ SUSPENDED | REVOKED

Season
DRAFT → SEED_COMMITTED → OPEN → LOCKED → CLOSED → SEED_REVEALED

Division
DRAFT → ROSTER_LOCKED → ACTIVE → CLOSED

Control
CONTROLLED → RELEASE_PENDING → AUTONOMOUS_PUBLIC
AUTONOMOUS_PUBLIC → RESTORE_PENDING → CONTROLLED
CONTROLLED | RELEASE_PENDING | RESTORE_PENDING | AUTONOMOUS_PUBLIC
→ DELETION_PENDING → PRIVACY_SEALED_ARCHIVE

CrewLifecycleFence
ACTIVE(epoch N) → DELETION_PENDING(epoch N+1) → ARCHIVED

AutonomyRun
PLANNED → RUNNING → COMPLETED
PLANNED | RUNNING → CANCELLED

VisibilityGrant
HIDDEN → CONTROLLER_VISIBLE → PUBLIC_VISIBLE
任何可見狀態 → WITHDRAWN(epoch N+1)

Round
DRAFT → READY → OPEN → FINALIZING → SETTLED → CLOSED

Session
OPEN → INPUT_SEALED → ACTION_COMMITTED
→ OUTCOME_PENDING → SETTLEMENT_COMMITTED → CAUSALITY_CLOSED

Session hold
任一未公開終態 → HELD → 恢復原流程 | VOID_COMMITTED
```

回合只計五個有效交易日。休市或全市場資料無效不建立有效 session，也不增加回合日序。單席資料不足用 `SeatVoided`；其他席可正常結算。整個已建立 session 若在回合關閉前被作廢，必須安排替代有效交易日；回合關閉後才發現重大問題時，進 adjudication epoch 反轉競賽結果，不重新演出人物人生。

## Logical cell 與遷移

logical cell 是 canonical write ownership 與路由單位，不等於資料庫機器或 Kubernetes cluster。權威 directory 保存：

```text
crew_id
logical_cell_id
ownership_epoch
migration_state
physical_endpoint
```

command 必須帶 `logical_cell_id + ownership_epoch`。舊 epoch 一律拒絕，避免來源與目標同時寫入。

Crew migration bundle 包含：

```text
Crew
SeasonDesk / RoundDesk
DecisionSession
ScoreLedger
settlement journals
command dedupe / inbox
deadlines
canonical object references
```

遷移只在沒有 open／held settlement、correction 或 deletion hold 的回合邊界執行：

```text
ACTIVE_SOURCE
→ FREEZE_REQUESTED
→ FROZEN
→ COPIED
→ VERIFIED
→ ACTIVE_TARGET
→ SOURCE_TOMBSTONED
```

`FROZEN` 後來源拒絕 gameplay write 並排空 outbox。驗證 stream version、hash chain、snapshot replay digest、dedupe、deadline 與 `pending settlement=0` 後，router 以 CAS 將 epoch 加一。目標寫入第一個 canonical event 後不能 rollback，只能再次做受控反向遷移。

Division membership 由 Competition 的 canonical `Division` aggregate 擁有，可包含不同 logical cells 的 crew；`DivisionStanding` 才是 projection。成員分數以已提交、帶 revision 的 score contribution 匯入 Division，不要求跨 cell 同步寫入。

## Appraisal build 與 bind

Historical 與未來 Current 共用 `AppraisalUnitV1`、`ContradictionGraphV1` 與 `AppraisalPackV1` 資料形狀，pipeline、資料面與權限完全分離。

```text
pack_id = SHA256(
  domain_id | jurisdiction | content_session_id |
  evidence_cutoff_at | calendar_revision |
  universe_revision | company_scope_digest |
  evidence_manifest_digest | fact_revision_digest |
  rights_manifest_digest |
  core_contract_revision |
  model_adapter_revision | model_weights_digest |
  prompt_revision |
  input_schema_revision | output_schema_revision |
  normalizer_revision |
  leakage_policy_revision |
  fallback_policy_revision |
  builder_revision
)
```

三種時間不可混用：

```text
interaction_cutoff_at
  = 玩家 command 必須抵達 canonical write boundary 的現實時間

evidence_cutoff_at
  = 角色世界內可以知道證據的 domain time

finality / reveal trigger
  = 結果何時可結算，以及 controller / public 何時可看
```

`SessionSchedule` 保存三種時間、jurisdiction、calendar revision 與 authoritative clock，不可只存「08:25」。每項事實分別保存 `world_published_at`、`platform_received_at` 與 rights validity：

- Historical 可知性只看 `world_published_at <= evidence_cutoff_at`。
- Current 可知性看 `max(world_published_at, platform_received_at) <= evidence_cutoff_at`。
- rights validity 只作 build／bind gate，不參與角色世界時間。

Cutoff 前的最新公開 correction 必須納入 manifest。

### Historical

- 先物理排除 cutoff 後欄位、真實名稱、ticker、絕對日期與結果欄位。
- 用虛構 entity、相對日與 frozen evidence manifest 離線產生 packs。
- leakage、rights、schema 與 fallback gate 通過後才發布 episode。
- episode 啟用後 pack 不重算。

### Current（預設不存在）

- 每項新 fact revision 只對 `fact × company × core contract` 產生一次 immutable `AppraisalUnit`。
- Cutoff 時封存 evidence manifest，再組裝全 universe pack。
- 模型 unit 不輸出跨事實 `contradiction_ids`；deterministic normalizer 讀完整 manifest 後建立 contradiction graph，再封成 pack。
- 成本隨內容量成長，不隨玩家或角色數成長。
- 人物 attention、peer packet、company、direction 與 q 仍由 deterministic kernel 計算；player-level runtime LLM calls 固定為零。

### Failure semantics

- bind 前 correction：舊 pack 標記 `STALE`，不能使用。
- bind 後一般新事實：只進下一個 session。
- 時間穿越、權利失效或來源撤回：session 進 `HELD`，由 typed adjudication command 決定恢復、重綁或 void。
- transport error：相同 request ID 最多重試一次。
- 已收到但 schema-invalid：不重新抽樣，寫入 deterministic neutral fallback。
- pack fallback 分母是該 `content_session_id × core_contract_revision` 中通過 rights／time gate、理應存在的 appraisal units；分子是使用 neutral fallback 的 units。比率必須 `<=2%`，必要官方事實 fallback 必須為零；未通過不得發布或 action-commit。

Anti-leakage gate：cutoff audit 必須 100% 無未來資料；pack 不得含實際報酬、未來事件或結果衍生欄位；無 evidence 對照須符合產品憲法的 45%–55% 與非正平均 DP；歷史實體／日期再識別測試須通過另行核准門檻。

Content Vault 與 logical cell 不做跨資料庫 2PC。每個 `content_session_id` 有唯一 `ContentSessionLedger`，它是 fact applicability、rights applicability 與 bind permit 的 ordering owner，並為每次 append 配發不可重用的單調 `content_position`。`PositionFactRevisionForSession`、`PositionRightsRevisionForSession` 與 `IssuePackBindPermit` 都在同一 Content DB transaction 鎖同一 ledger head；前兩者須引用已提交的 governance/content revision。Permit 只有在 ledger 已追上當下適用的 fact／rights authoritative heads，而且 pack 自身封存的 fact／rights digests 分別等於 ledger 兩個 heads 時才能發出。任一 head 或 pack digest 未對齊都必須拒發，不能靠尚未送達的 stale／revoke 通知判斷。

`PackBindPermit` 綁定 `decision_session_id + pack_id`，並保存自己的 `content_position`、前一位置與當時 fact／rights head。該位置就是事實語意上的 bind 時點。`BindAppraisalPack` 只接受未過期、對象一致，且可在 `ContentSessionLedger` 重播驗證的 permit，並把 permit ID、ledger ID 與 position 寫進 DecisionSession。position 之前的 correction 必須先反映在 pack；position 之後的 correction 一律走 bind 後 hold／correction，即使 game transaction 尚未完成。相同 idempotency key 的重試只能讀回原 position；失敗或過期 permit 不能改綁其他 session。

## Deterministic kernel

Decision 與 scoring 使用同一個 Rust 2024 pure crate：

- 全部正式數值使用 `i64` fixed-point，scale `1e-6`。
- 禁止浮點數、wall clock、runtime network、未承諾 randomness 與 provider-specific hidden state。
- 同一 crate 產出 native worker、WASI replay tool 與 simulation runner。
- seed 只處理效用平手、公共生活候選與敘事變體。
- native、WASI、offline fixtures 必須 byte parity；全量 replay divergence 必須為零。

固定資料流：

```text
freeze seat + crew + score + fact refs
→ bind sealed appraisal pack
→ deterministic attention (3 slots)
→ independent utility
→ simultaneous peer packets
→ deterministic final action
→ bind authoritative outcome
→ settlement transaction
→ reveal projections
```

永久不可重算：sealed facts、raw／normalized appraisal、decision input、peer packets、actions、settlement、policy/model/fact/engine revision。可由 canonical streams 重建：aggregate snapshots、standings、feed、search、analytics 與 public/controller views。

## Single write boundary settlement 與因果封閉

不採 saga、2PC 或跨服務補償來維持核心一致性。`DecisionSession`、`Crew`、`ScoreLedger` 與 journal 在同一 logical-cell PostgreSQL cluster 中，以單一 `SERIALIZABLE` transaction 提交：

```text
CommitSessionSettlement

idempotency_key = settle/{session_id}/{settlement_revision}
primary_target = DecisionSession/{session_id}
preconditions = DecisionSession + Crew + ScoreLedger stream versions
payload = settlement_digest + crew_patch + score_patch
        + risk_patch + coverage_patch + authoritative revisions
```

transaction 依序鎖定 stream heads 與 journal，驗證 version／hold／migration／deletion，然後 append：

```text
SettlementJournalOpened
SessionSettlementPrepared
CrewSettlementApplied
DecisionScorePosted
RiskBrakeAdvanced
CoverageAdvanced
SettlementCommitted
```

同 transaction 寫 snapshot 與 outbox。任何一步失敗整筆 rollback。相同 idempotency key＋digest 回傳既有結果；相同 key 但 digest 不同是 fatal conflict。

`SettlementCommitted` 代表結果已原子入帳，不代表前日人物因果已不可改。下一個 session 的 `SealDecisionInput` 必須在同一 transaction 先 append `SessionCausalityClosed`；回合最後一日則在 round finalization 關閉因果。關閉前可用 journal 的 exact inverse patch 同 transaction reverse＋resettle；關閉後永不重寫 Crew。

正常路徑沒有可獨立呼叫的 `CloseSessionCausality`。`SealDecisionInput(S2)` 同一 transaction append `SessionCausalityClosed(S1)` 與 `DecisionInputSealed(S2)`；若 S2 因 pack stale 或其他 precondition 失敗，兩者一起 rollback。最後一日只可由 `CloseRoundCausality` 在 round finalization 關閉。

Correction／void 固定三種 interleaving：

1. settlement 前：`VoidSession` 直接寫 `VoidCommitted`。
2. settlement 後、causality close 前：`ResettleSession` 在單一 transaction reverse＋套新 patch＋recommit；或 `VoidSession` 在單一 transaction reverse＋void commit。不存在可獨立成功的 reverse command。
3. causality close 後：`CorrectClosedSessionScore` 在同一 logical-cell transaction 追加 Session correction record 與完整 ScoreLedger patch；Crew 另以 typed command 寫 `CrewCorrectionLearned` 或 `CrewAdjudicationLearned`。已被後續 action mask 消費的 risk-brake path 不回寫，差額只可用 `RiskBrakeCorrectionCarried` 從同一回合下一個尚未封存 session 生效；同回合已無未封存 session 則記 `RiskBrakeCorrectionNoActionSpace`，不能帶進下一回合。

Engine／policy defect 必須建立 `AdjudicationEpoch`、停止後續 seal，再以 frozen actions 重建，管理員不能手改分數。

Round／Division／Season 關閉後才出現的正式分數修正由 canonical `CompetitionAdjudication` 擁有：

```text
OPEN
→ CONTRIBUTIONS_SUPERSEDED
→ DIVISION_STANDINGS_CORRECTED
→ SEASON_STANDING_CORRECTED
→ CLOSED
```

建立 adjudication 時先封存 `required_correction_items + required_correction_set_digest`。它只能引用已提交的 closed-session score revision。全部 contribution item 完成並通過 subset digest barrier 後，才可計算 division standings；全部 division standing item 再通過第二道 barrier，才可計算 season standing。每個 standing event 都保存它實際讀取的來源 set digest。只有 completed set digest 與 required digest 完全相同時才能 close。原 contribution 與 standing 永久保留，Closed season 不重新開啟，也不能讓 ScoreLedger 與正式榜單停在不同 revision。

## Mode、time 與 privacy

Historical reveal 由 `EpisodeSessionFinalityDeclared` 觸發；未來 Current 由 `MarketSessionFinalityDeclared + approved embargo policy` 觸發。沒有核准的 finality 與 embargo 契約，Current domain 不得建立。任何模式都不寫死 17:00。Finality／reveal 不得與 interaction 或 evidence cutoff 共用欄位。

Client clock 不具權威。`SaveSeatPlan` 與 `SealSeatPlan` 鎖同一 `RoundDesk` head，使用資料庫權威時間：前者只在 `db_now < interaction_cutoff_at` 成功，後者只在 `db_now >= interaction_cutoff_at` 成功。離線只能保存本機草稿；只有 cutoff 前抵達伺服器且 preconditions 正確的完整 placement 才是 canonical state，沒有 client timestamp grace period。

失訂在回合邊界進入 `AUTONOMOUS_PUBLIC`。刪帳可從包含 `AUTONOMOUS_PUBLIC` 的任何控制狀態開始：先在 logical cell 的單一 transaction 將 `CrewLifecycleFence` 與 `VisibilityGrant` epoch 各加一、取消 active AutonomyRun 與 deadlines，並撤下可見性；所有 gameplay、autonomy、migration、deadline command 都需匹配 lifecycle epoch。Identity 收到不可變的 fence receipt 後，在自身單一 transaction 同時提交 `AccountDeletionRequested + ControlDeletionPending`，讓 Account 與 ControlLease 都能由事件重建到 `DELETION_PENDING`，不假裝跨兩個資料庫原子寫入。既有 session 到安全終態後，Lifecycle 以 `ArchiveCrewLifecycle` 將 fence 轉為 `ARCHIVED`；Identity 必須看到該 receipt 才能提交 `PrivacyArchiveSealed`，之後才可 `AccountDeletionCompleted`。角色不公開、不可再控制，user-scoped key 依保留政策銷毀。

Canonical `VisibilityGrant` 是 visibility epoch 的唯一 owner。Public edge 先同步更新其 `VisibilityRevocationRegistry(subject_id, visibility_epoch)` read model，所有 projection event 都帶 epoch，舊 epoch 一律拒絕；之後再非同步清除 public DB、search、cache、media 與未送通知。管理員只能經雙人批准的 typed command 執行 `HOLD`、`VOID`、`CORRECT`、`WITHDRAW`、`MIGRATE`；不可 backdate、改 event 或直接更新 canonical table。

## 資料隔離

| Layer | Beta Historical | Future Current |
| --- | --- | --- |
| Database | Identity、History private、History public 分 HA cluster | 新建獨立整套資料面 |
| Object | content、raw-model、public-media、audit-WORM 分 bucket／root key | 另一套 bucket、root key、service account、lifecycle |
| Cache／search | private／public 分 credential 與 index | 不與 Historical 共用 |
| Queue／schema registry | beta 使用 PostgreSQL outbox／inbox | 若啟用需獨立 transport 與 registry |
| API | `api.panshi.app` 與 `world.panshi.app` | 獨立 hostname、OAuth audience、WAF；gate 前無 DNS |
| Analytics／notification | 只收 allowlist 中的 opaque ID | 獨立 allowlist 與 catalog |

RBAC 與 ABAC 同時檢查：`subject、role、purpose、mode_domain、rights_scope、data_class、control_lease、episode_revision`。缺任一項即 deny。所有解密、管理讀取、rights override、mode enablement 寫入至少 400 日 WORM audit。

## Client truth

Client API、command receipt、atomic placement、offline draft、typed recovery、revision-aware reveal、notification 與 structured causality 的正式契約位於 [Client truth and recovery contract](./client-contract.md)。Figma 不能自行發明 domain state；每張 frame 都要標 command／resource、authoritative state、canonical／projection version、blocking reason、禁顯資訊與無障礙等價操作。

## Physical topology by stage

### Beta

- 不使用 Kubernetes，也不部署 Redpanda。
- managed OCI container runtime，跨兩個 failure zone。
- deployments：`identity-api`、`game-core`、`content-builder`、`projection-worker`、`public-api`。
- 三個 PostgreSQL HA clusters：Identity／PII、Historical private canonical、Historical public projection。
- PostgreSQL outbox／inbox 兼工作佇列；router interface 從 beta 起存在，directory 可先與 private DB 共置。
- 跨區 WAL archive／PITR 與 object replication 從 beta 起啟用；未通過 restore qualification 前，region SLO 只能標為 target。
- content、raw-model、public-media、audit-WORM 分 object bucket 與 KMS root。
- Current 資料面不存在。

### 50,000 characters

一個 logical gameplay cell，水平增加 stateless game／projection workers。若 2× peak 壓測下 outbox p99 lag 超過 10 秒，或 queue 工作量持續占 private DB 20% 以上 I/O／CPU，必須在上線前導入 event transport；角色數本身不是理由。Broker 只取代 fan-out，不接管 canonical deadline、idempotency、journal 或 scheduler。

### 500,000 characters

- 每個 logical gameplay cell 先通過 2× peak 的 25,000 crews qualification；500,000 characters 約需四個 cells，但實際 cell 數由 qualification 決定，不是常數。
- private/control plane 與 public edge 分 Kubernetes cluster。
- History-private 與 public projection 分別使用獨立三節點 event transport。
- router directory 與 ownership epoch 使用獨立 control PostgreSQL。
- 每 cell 獨立 DB credential、KMS subkey 與 migration quota。
- Current 若通過 gate，仍建立獨立整套資料面。

## Repository layout

```text
/contracts/{proto,openapi,policy}
/crates/{domain,event-store,decision-kernel,scoring,rights}
/services/{identity-api,game-core,content-builder,projection-worker,public-api}
/apps/{web,mobile}
/tools/{replay,simulator,loadgen,fixtures}
/deploy
/adr
```

- `apps/web`：TypeScript／React，含產品網站與桌面遊戲 client。
- `apps/mobile`：React Native client，使用同一 generated API contracts；不參與 canonical determinism。
- Protobuf 是內部 command／event contract；外部 client API 使用 OpenAPI 3.1。
- event schema 只做 additive evolution；breaking change 升 major 並提供 upcaster。
- canonical event store 與 outbox 保存同一份 deterministic Protobuf bytes；`payload_hash` 對原始 bytes 計算。Upcaster 只建立讀取 view，不重寫舊 event。
- database migration 使用 expand／migrate／contract，舊 reader 全數退出前不能刪欄。

## Version policy

- Rust 使用 2024 edition；`rust-toolchain.toml` 與 `Cargo.lock` 鎖定專案建立時的 current stable。每次 compiler／dependency 升級都跑完整 golden replay。
- PostgreSQL 使用 major 18 與仍受支援的最新 minor；major 升級需 migration rehearsal 與 full replay。
- Kubernetes 與 event transport 不寫入 beta 前提；進入多 cell 階段時，以當時受支援版本重新 pin，不能把 2026 年的 patch 號永久寫死。
- security patch 通過 replay 與 restore smoke 後七日內升級；PostgreSQL minor 十四日內升級。

2026-07-20 核對基線：PostgreSQL 18.4、Rust 1.97.1、Kubernetes 1.36.2、Redpanda 26.1、OpenTelemetry semantic conventions 1.43.0。這些是依賴稽核基線，不是永久架構常數。參考：[PostgreSQL 18 文件](https://www.postgresql.org/docs/18/)、[Rust releases](https://blog.rust-lang.org/releases/)、[Kubernetes releases](https://kubernetes.io/releases/)、[Redpanda releases](https://docs.redpanda.com/streaming/current/reference/releases/)、[OpenTelemetry semantic conventions 1.43.0](https://opentelemetry.io/docs/specs/semconv/)。

## SLO 與 qualification

| 指標 | Gate |
| --- | ---: |
| Command API availability | 99.95%／30-day rolling window |
| Command API p95 | <250 ms |
| Cutoff 後 seal deadline command 發出 | 99.9% <5 s |
| 10,000 sessions action committed | <120 s |
| 100,000 sessions action committed | <8 min |
| Finality 宣告後 controller reveal | 99.9% <5 min |
| Public projection lag | <60 s |
| Canonical event loss | 0 |
| Replay divergence | 0 |
| AZ failure | RPO 0；RTO <=15 min |
| Region failure | qualification 後 RPO <=5 min；RTO <=4 h |

每季執行 restore、full replay、mode-isolation、50k／500k load 與 failure injection。必監控 seal lag、fallback rate、revision skew、projection lag、rights deny、mode-boundary violation、replay divergence、finalization barrier age 與 migration epoch conflict。

## 動工前文件順序

1. Mode isolation／data classification ADR。
2. Aggregates／state machines ADR。
3. Event envelope／idempotency ADR。
4. Immutable policy／model／fact revision ADR。
5. Fixed-point decision／scoring kernel ADR。
6. Cutoff scheduler／single-write finalization ADR。
7. Void／correction／adjudication ADR。
8. Public projection／reveal delay ADR。
9. Identity／entitlement／privacy ADR。
10. Logical cell／migration／SLO／DR ADR。

尚未能由內部文件消除的外部不確定性：歷史資料的模型輸入與衍生使用權、臺灣金融法律書面意見、未來 Current 的 finality／correction SLA、模型權重與輸入留存權利，以及一人一隊身份驗證的隱私可行性。它們阻止外部 launch，不阻止使用完全合成 fixtures 建立 contracts、kernel、simulator 與原型。

架構狀態：**FROZEN FOR PRE-CODE ARTIFACTS**。只有產品憲法改版、外部 gate 改變或 qualification 失敗，才可修改核心契約。
