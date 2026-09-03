# 《盤勢・眾生》V5 系統設計

_2026-07-23｜Final-product architecture baseline_

本文件把 V5 的故事產品定義翻成可以直接動工、也不需要在擴張時重切正史的技術架構。V5 的技術主體不是選股引擎、五席賽局或十分鐘播放程式，而是一個由當期市場事實驅動、持續運行、可重播的虛構人物世界。

本文件的核心判決是：

> **用 append-only 事件保存人物一生；用封存市場事實提供未知；用受限模型形成角色解讀；用 deterministic Rust 規則落實紙上行動、記憶與關係；最後把正史投影成公共世界、角色近景、角色人生誌與深層檔案。**

V2／V4 的現有程式只視為可拆用的技術 spike。任何舊文件或程式若和 V5 的故事正史、角色深度或紙上承擔紀錄衝突，以 V5 為準。

---

## 1. 產品不變量

以下規則必須由 domain contract 保證，不能只寫在 prompt、Figma 或營運手冊裡：

1. 所有居民都是成年虛構角色；角色出生資料不可識別、模仿或反推真人。
2. 公共世界持續運行。使用者離線不會暫停角色，登入也不會觸發只為他表演的一次性世界。
3. 真實市場只透過已驗證的 sealed-fact manifest 進入世界；角色、模型與 client 都不能改寫行情、公告或時間。
4. 每個角色只能接觸當時已可知的事實。任何 cutoff 後資訊都不能進入較早的觀察、解讀或行動。
5. 角色的命盤、人格、血型自我敘事、記憶、情緒、生活責任與關係會影響注意、意義、信任與行為門檻；它們不能改寫市場資料或取得隱藏資訊。
6. 思考核心只產生有 schema 的解讀提案；它不能直接寫角色狀態、紙上帳本、關係、公共投影或最終 prose。
7. 紙上交易是 canonical simulation。理由、送出時間、成交規則、持股、損益、費用、修正與結果都可重播，不能看完結果後重抽。
8. 「韭菜樣」來自可追溯的認知偏誤、承諾、改口與後果，不是隨機把角色寫笨，也不建立一個「韭菜分數」。
9. 公共世界、角色近景、角色人生誌與深層檔案讀取同一條正史，只改變資訊距離與可見權限。
10. 每段可見敘事拆成帶 `truth_class` 與 source refs 的 segments；文字不是 canonical truth。
11. 不建立全服績效排行榜、模型報酬榜或「最聰明核心」。績效只用來證明個別角色承擔過什麼。
12. 封測固定使用 `beta_full_access`；支付、廣告、試用倒數及商店 SDK 是 disabled adapters。

---

## 2. 架構總覽

### 2.1 Canonical story chain

每一段可發布人物故事都必須能沿以下鏈條回到 canonical event：

```text
current-market sealed fact
→ fact becomes visible in a world scene
→ observed clue
→ character appraisal
→ autonomous paper action
→ fill / mark / outcome
→ relationship and memory update
→ story projection
```

鏈條可以在任何一點停止：角色可能沒看到、看到了卻沒理解、理解後沒有行動、行動後沒有成交，或結果尚未發生。系統不能為了讓故事完整而補造缺少的環節。

### 2.2 Single-write-boundary modular core

採用 **cell-based、append-only、single-write-boundary modular core**：

- 每個角色及其高頻互動關係位於一個 logical world cell。
- `CharacterLife`、該角色的 `CognitiveEpisode`、`PaperAccount`、相關 `PaperOrder`／`PaperPosition` 與同場 `RelationshipDyad` 可在同一 PostgreSQL cluster 內做精確 precondition 的 multi-stream transaction。
- 每個 `RelationshipDyad` 仍只有一個明確 home cell；跨 cell 的關係與場景只靠 typed command／event 交換，不做共享資料表、雙份關係真相或跨資料庫 2PC。
- canonical write 使用 Rust；TypeScript client 只送 command、讀 projection 與執行視覺插值。
- beta 使用 PostgreSQL outbox／inbox；達到明確容量門檻後才替換 fan-out transport，canonical deadline、dedupe、stream CAS 和 journal 仍留在 PostgreSQL。

### 2.3 Logical layers

```text
┌───────────────────────────────────────────────────────────────┐
│ React web / future mobile                                    │
│ 公共世界｜跟拍｜角色近景｜角色人生誌｜深層檔案                    │
└─────────────────────────┬─────────────────────────────────────┘
                          │ OpenAPI + SSE
┌─────────────────────────▼─────────────────────────────────────┐
│ Public edge / private player API / entitlement policy         │
├───────────────────────────────────────────────────────────────┤
│ Public projections │ story projections │ private projections  │
└─────────────────────────┬─────────────────────────────────────┘
                          │ sanitized projection events
┌─────────────────────────▼─────────────────────────────────────┐
│ World cells                                                   │
│ World clock │ Character life │ Cognition │ Relationship        │
│ Paper ledger │ Story editorial                                │
└─────────────────────────┬─────────────────────────────────────┘
                          │ verified immutable manifests
┌─────────────────────────▼─────────────────────────────────────┐
│ Market evidence gateway                                       │
│ contract verification │ rights/time gate │ immutable mirror    │
└─────────────────────────┬─────────────────────────────────────┘
                          │ versioned cross-repository contract
                 separate market-research product
```

---

## 3. 技術基線

| Layer | Baseline | Decision |
| --- | --- | --- |
| Canonical domain | Rust 2024 | 純 domain crates 不依賴 transport、ORM 或 generated Protobuf type |
| Async services | Tokio + Axum／Tower family | exact versions 必須進 `Cargo.lock`；HTTP 只作 adapter |
| Persistence | PostgreSQL 18 HA + SQLx | canonical streams、stream heads、command journal、outbox／inbox、read models |
| Internal contract | Protobuf deterministic bytes | no maps、no floats、domain-owned order；breaking change 升 major |
| Public API | OpenAPI 3.1 | 手寫 contract 是單一來源，產生 TypeScript client |
| Web | TypeScript + React 19 + Vite | server projection 是 truth；Canvas/WebGL 可作場景 renderer，但不能擁有 domain state |
| Realtime | SSE first | 公共世界是 server-to-client event stream；需要雙向互動時仍以 HTTP command receipt 為準 |
| Numeric | integer／fixed-point | 金額、價格、數量、效用與比例禁用 binary floating point |
| Model integration | versioned model gateway | schema-first、queued、可取消、不可直寫 canonical store |
| Large immutable artifacts | content-addressed object storage | market packs、model input/output、角色生成資產、公開媒體分 bucket／root key |
| Observability | OpenTelemetry | traces／metrics／logs 不攜帶 prompt、私有記憶、持股 payload 或 PII |
| Edge | CDN + WAF + signed asset URLs | public read-heavy projection 可快取；visibility epoch 撤回必須立即失效 |

Rust toolchain、Node 24、pnpm 11 及現有 lockfile 可沿用。新增依賴必須附 license、maintenance、runtime impact 與 removal note，不能用框架型便利換掉 canonical contract。

### 3.1 Public origin and edge contract

- `https://panshi.app` 是唯一 public origin；`www.panshi.app` 以 308 保留 path／query 導向 apex。
- Web client 只呼叫同源 `/api/v2/*` 與 `/events/v2/*`。Edge gateway 才把 authenticated request 送往 internal service；public bundle、錯誤 payload、OpenAPI server 與 source map 都不得洩露內部 origin。
- Session cookie 使用 host-only、`Secure`、`HttpOnly`、`SameSite=Lax`；不設定寬鬆 `.panshi.app` Domain。管理面與營運面不得共用 public session 或 public origin。
- Apex 啟用 TLS、HSTS（確認所有預定 subdomain 已可 HTTPS 後才加 `includeSubDomains`）、CSP、WAF、bot／rate controls 與 canonical response header。`www` 不設 session，只做 redirect。
- 人物、章節與回看路由是 stable deep-link contract。刪除或撤下時回傳可解釋的 tombstone projection，不把既有公開 URL 靜默改指另一位人物或另一段故事。
- Apple universal links／Android App Links 共用 Web route semantics；association files 由 release pipeline 驗證 bundle／package identity、cache header 與 fallback。
- 舊研究部署不掛在 apex root，不共用 cookie、OAuth callback、analytics property 或 canonical tag。它若保留，只能在隔離、`noindex` 的 historical route。

---

## 4. Bounded contexts

| Context | Authoritative aggregates | 唯一負責 | 明確禁止 |
| --- | --- | --- | --- |
| Governance／Model Registry | `PolicyBundle`, `ModelCore`, `ModelSnapshot`, `PromptTemplate`, `RightsPolicy` | 核准可用 policy、core contract、snapshot、prompt、schema、fallback 與 rollout | 直接跑角色、修改人物或發布故事 |
| Market Evidence Gateway | `FactManifestMirror`, `FactRevisionChain`, `MarketSession` | 驗證跨 repo manifest、時間、rights、hash、correction、finality，建立 immutable mirror | 查上游 DB、補行情、替來源做推論 |
| World Clock／Scene | `WorldCell`, `WorldSession`, `Scene`, `Presence`, `EncounterWindow`, `SceneSeed` | 世界時間、有效交易日、場景位置、可見事實、相遇、有限編導衍生物與 deadline | 決定角色相信什麼或替角色交易；接受自由 prompt |
| Character Origin | `Introduction`, `Character`, `CharacterAssetPack` | 虛構出生、外觀／聲音 identity seed、人格／命盤 motif、初始人生背景、核心指派、資產資格、continuity class 與引介就緒 | 使用真人背景或聲紋、重抽已出生角色、按績效換核心、資產未核准就讓角色入場 |
| Character Life | `CharacterLife`, `UtteranceArtifact` | needs、emotion、belief、commitment、sealed public claims 與 behavioral progression；public continuity lifecycle 只由 Character Origin 的 `Character` 擁有 | 模型直接 patch state；投影回寫人物；第二次生成或改寫已封存原話 |
| Cognition／Decision | `CognitiveEpisode` | 冻結當時可知 input、取得不含 prose 的 core appraisal、deterministic attention、action intent 與 semantic speech act | 讀未來 fact、重試到好看的答案、直接改帳本、輸出角色台詞 |
| Relationship | `RelationshipDyad` | 兩個方向的 trust、deference、obligation、resentment、distance 與共同事件 | 由一方 Character stream 單方面覆寫另一方 |
| Memory | `MemoryLedger` | episodic memory、角色對信念改變的記憶、recalled／reframed links、salience 與 visibility class；current belief 與 `BeliefRevised` 永遠由 Character Life 擁有 | 保存或公開 chain-of-thought；任意刪失敗記憶；修改 current belief |
| Paper Portfolio | `PaperAccount`, `PaperOrder`, `PaperPosition` | Account 只擁有 cash／reservation／double-entry journal 與 account invariants；Order 只擁有 order lifecycle／fill refs；Position 只擁有 lots／quantity／cost basis／marks／position P&L／corporate-action outcome | 接外部券商、接受 client 訂單、以回測價格回填；讓三個 aggregate 欄位重疊 |
| Story Editorial | `StoryChapter`, `DailyMomentsEdition` | 從正史挑選觀察線索、建立章節、0–5 幕日版、版本與發布要求；實際 audience visibility 由 Privacy／Visibility 擁有 | 改寫 canonical action、作者化角色台詞、補心理真因、只留獲利故事、由 client 臨時排五幕 |
| Viewer Library | `FollowSet`, `SavedClip`, `ReminderRule`, `StoryRoll` | 觀眾追蹤、收藏、提醒、故事卷版本、私人／公開可見性與來源章節引用 | 冒充官方正史、複製或改寫角色台詞、持有市場或人物 canonical state |
| Identity／Entitlement | `Account`, `Entitlement`, `QuotaLedger`, `BillingSubscription`, `IntroducerBond` | 登入、`beta_full_access`、有效 access claims、billing lifecycle、quota、引介關係、export／deletion | payment webhook 直接改角色；用 expired billing row 決定前台權益；廣告決定 domain outcome |
| Privacy／Visibility | `SubjectLifecycleFence`, `VisibilityGrant` | PII 隔離、public current／Free archive／subscriber archive／restricted scope、epoch、撤回、crypto-shred | public worker 自行恢復內容；舊 epoch 重新發布；引介人取得獨家角色真相 |
| Projection／Search | 無 canonical aggregate | 公共世界、近景、人生誌、深檔、portfolio、search、share card 與語音 rendition read models；逐字 resolve 可見 utterance artifact | 成為 cutoff、權益、持股或人物狀態真相源；摘要、翻譯或改寫原話；讓衍生音訊回寫人物 |

Bounded context 是 monorepo 內的 crate/module 與資料庫權限邊界，不代表一開始要拆成十三個網路服務。Beta 先部署成 `world-core`、`model-runner`、`projection-worker`、`public-api`、`identity-api`、`evidence-gateway` 六個 process。

---

## 5. Canonical aggregate 與事件所有權

### 5.1 Event envelope

沿用現有 append-only envelope 的設計，V5 建立 `panshi.common.v2.EventEnvelope`：

```text
event_id                 UUIDv7
event_type
schema_version
stream_type / stream_id / stream_version
logical_cell_id / ownership_epoch
world_session_id
command_id / causation_id / correlation_id / trace_id
actor
occurred_at / recorded_at
truth_class
policy_revision_set
model_core_id / model_snapshot_revision?
prompt_revision? / adapter_revision?
fact_manifest_id? / fact_revision_ids[]
engine_artifact_digest
rights_scope / data_class / visibility_epoch
payload_hash / previous_event_hash
payload_bytes
```

同一 event 的 deterministic Protobuf bytes 同時寫 canonical event store 與 outbox pointer。Event 永不 update／delete；upcaster 只建立讀取 view，不改舊 bytes 或 hash chain。

每個 command 必帶：

```text
command_owner
primary_target
exact stream preconditions[]
logical_cell_id
ownership_epoch
idempotency_key
deadline_at
request_hash
```

禁止 `expected_version=ANY`、last-write-wins 及用 message delivery 當成 exactly-once。`(command_owner, idempotency_key)` 唯一；相同 key 不同 digest 是 fatal conflict。

### 5.2 Minimum canonical event families

| Owner | Canonical events |
| --- | --- |
| Governance／Model Registry | `PolicyBundlePublished`, `RightsPolicyPublished`, `ModelCoreRegistered`, `ModelSnapshotApproved`, `ModelSnapshotDeprecated`, `PromptTemplatePublished`, `FallbackPolicyPublished` |
| Market Evidence Gateway | `FactManifestAccepted`, `FactRevisionMirrored`, `FactManifestQuarantined`, `FactRightsRevoked`, `MarketSessionFinalityAccepted`, `FactCorrectionObserved` |
| World Clock／Scene | `WorldSessionOpened`, `WorldTickCommitted`, `DeadlineScheduled`, `DeadlineFired`, `FactBecameVisible`, `CharacterExposureScheduled`, `CharacterEnteredScene`, `CharacterLeftScene`, `EncounterWindowOpened`, `EncounterResolved`, `SceneSeedRequested`, `SceneSeedValidated`, `SceneSeedAccepted`, `SceneSeedRejected`, `SceneSeedDeferred`, `SceneSeedScheduled`, `SceneSeedPresented`, `SceneSeedObserved`, `SceneSeedIgnored`, `SceneSeedExpired`, `SceneSeedVoided`, `SceneSeedWithdrawn`, `WorldSessionClosed` |
| Character Origin | `IntroductionRequested`, `IntroductionCancellationRequested`, `IntroductionCancelledBeforeOrigin`, `IntroductionCapacityReserved`, `IntroductionCapacityWaitlisted`, `IntroductionValidated`, `CharacterOriginSealed`, `ModelCoreAssigned`, `CharacterAssetPackRequested`, `CharacterAssetPackQualified`, `CharacterAssetPackRejected`, `IntroductionReadyForActivation`, `IntroductionActivationAcknowledged`, `CharacterIntroduced`, `IntroductionFailed`, `IntroductionCapacityReleased`, `CharacterContinuityClassChanged` |
| Character Life | `CharacterStateAdvanced`, `NeedStateAdvanced`, `EmotionStateAdvanced`, `CommitmentRationaleSealed`, `PublicClaimMade`, `SelfAcknowledgementMade`, `BeliefRevised`, `BehaviorHypothesisAdvanced`, `BehaviorMarkerActivated`, `ThesisOpened`, `ThesisRevised`, `ThesisDriftDetected`, `OutcomeAttributed`, `LessonThreadAdvanced`, `CharacterCorrectionLearned` |
| Cognition／Decision | `CognitiveEpisodeOpened`, `ObservedClueRegistered`, `CognitionInputSealed`, `CoreAppraisalAccepted`, `CoreAppraisalFallbackUsed`, `AttentionCommitted`, `RelationshipImpulseCommitted`, `AutonomousActionIntentCommitted`, `SemanticSpeechActCommitted`, `CognitiveEpisodeClosed` |
| Relationship | `EncounterMailboxOpened`, `EncounterMailboxAccepted`, `EncounterMailboxExpired`, `RelationshipEncounterCommitted`, `RelationshipSignalObserved`, `DirectedTrustChanged`, `DirectedObligationChanged`, `DirectedResentmentChanged`, `RelationshipMilestoneReached`, `RelationshipDyadOwnershipTransferred` |
| Memory | `MemoryFormed`, `MemoryRecalled`, `MemoryLinked`, `MemoryReframed`, `MemorySalienceChanged`, `MemoryVisibilityChanged` |
| Paper Portfolio | `PaperAccountOpened`, `PaperCashInitialized`, `PaperAccountJournalPosted`, `PaperOrderSubmitted`, `PaperOrderRejected`, `PaperOrderFilled`, `PaperOrderExpired`, `PaperPositionOpened`, `PaperPositionAdjusted`, `PaperPositionClosed`, `PaperMarkApplied`, `PaperCorporateActionApplied`, `PaperOutcomeRecognized`, `PaperAccountingCorrectionApplied` |
| Story Editorial | `StoryCandidateOpened`, `StoryChapterComposed`, `StoryChapterPublished`, `StoryChapterSuperseded`, `StoryChapterWithdrawn`, `DailyMomentsEditionPublished`, `DailyMomentsEditionSuperseded`, `DailyMomentsEditionWithdrawn` |
| Viewer Library | `CharacterFollowActivated`, `CharacterFollowDeactivated`, `SavedClipAdded`, `SavedClipRemoved`, `ReminderRuleChanged`, `StoryRollCreated`, `StoryRollItemsChanged`, `StoryRollNoteRevised`, `StoryRollPublished`, `StoryRollVisibilityWithdrawn` |
| Identity／Entitlement | `EntitlementGranted`, `EntitlementEnteredGrace`, `EntitlementReplacedByFree`, `QuotaReserved`, `QuotaReservationReleased`, `QuotaConsumed`, `IntroducerBondCreated`, `IntroducerBondStateChanged`, `BillingSubscriptionStateChanged`, `AccountExportPrepared`, `AccountDeletionRequested`, `AccountDeletionCompleted` |
| Privacy／Visibility | `SubjectLifecycleFenceAdvanced`, `VisibilityEpochAdvanced`, `SubjectVisibilityWithdrawn`, `PublicVisibilityGranted`, `SubscriberArchiveVisibilityGranted` |

事件名稱只屬於表中的 owner。其他 context 想造成改變時送 typed command，不能偽造對方事件。`StoryChapterPublished` 證明某個版本曾公開，不取代它引用的 `ObservedClueRegistered`、`PaperOrderFilled` 或 `MemoryFormed`。

### 5.3 Atomic boundaries

所有跨 context receipt 共用一個不可自我引用的 envelope：

```ts
type CrossContextReceiptEnvelopeV1<TBody> = {
  envelopeVersion: "cross-context-receipt-envelope/v1";
  bodySchema: string;
  body: TBody;
  bodyDigest: string;
  signingKeyId: string;
  signature: string;
};
```

每種 `TBody` 都是 deterministic Protobuf／canonical bytes schema，禁止 map、
float、自己的 envelope `bodyDigest`、signature、append position、event
ID／hash 或其他 provenance 欄位；它可以用名稱明確的欄位引用另一份已存在的
immutable artifact／receipt body digest。計算順序唯一：

```text
body_bytes = deterministic_encode(bodySchema, body)
bodyDigest = HASH("panshi.cross-context-receipt/v1" || bodySchema || body_bytes)
signature = SIGN(signingKeyId, envelopeVersion || bodySchema || bodyDigest)
```

`bodyDigest` 與 `signature` 永遠不進 `body_bytes`，所以不存在自我引用。Canonical
owner event 保存 body bytes、body schema 與 body digest；signature 只在跨
context envelope 傳輸／驗證。Append position、event ref／hash 與 acknowledgement
provenance 放在 envelope 外，以 body digest 關聯。以下
`CommandAdmissionReceiptV1`、`IntroductionReadyReceiptV1` 與
`SceneSeedValidatedReceiptV1` 都必須使用本規則，不得各自發明 digest。

以下操作必須單一 `SERIALIZABLE` transaction 完成：

- `AdmitAuthoringCommand`：Identity／Entitlement 以 server DB transaction time
  封存 `commandAcceptedAt`，驗證 entitlement 與封測 authoring half-open window，
  決定 ISO quota window，寫 `QuotaReserved` 及同 payload 的
  `CommandAdmissionReceiptV1`／outbox。三者全部存在或全部不存在。
- `SealCharacterOrigin`：Introduction state、Character、origin blob、core assignment 與 asset request outbox；不能包含外部圖像工作。
- `CommitAutonomousPaperAction`：CognitiveEpisode action intent、PaperAccount 與所有會影響 action mask 的 open PaperOrder／relevant PaperPosition exact version-set validation、新 PaperOrder submitted／rejected、Character structured commitment rationale；rationale 永遠不含 quote 或 utterance artifact。
- `ApplyPaperFill`：同一 fill transaction 分別寫 PaperOrder lifecycle、PaperAccount 的 `PaperAccountJournalPosted` 及 PaperPosition lot／quantity／outcome event；三者引用同一 fill ID、source price 與 transaction digest，任一 stream CAS 失敗就全部不提交。
- `RecognizeOutcome`：Paper outcome、Character state patch、Memory mutation；同 cell 的 relationship effect 可一併提交。
- `SealUtterance`：完整 `UtteranceArtifactV1` bytes、artifact hash、`PublicClaimMade` 或 `SelfAcknowledgementMade`、unique constraint 與 projection outbox；全部存在或全部不存在。它不會 reopen 或附加到既有 `CommitmentRationaleSealed`。
- `SealSceneSeedArtifact`：`SceneSeedValidated`、normalized typed artifact candidate、policy／template／source refs、payload digest、deadline 與 quota-consumption-request outbox；artifact 此時不可進 scheduler 或 cognition。
- `AcceptSceneSeed`：驗證 Identity 的同 seed／window `QuotaConsumed` acknowledgement，寫 `SceneSeedAccepted`、啟用既有 artifact 與 scheduler outbox；不生成新 payload。
- `PublishStoryChapter`：chapter version、source event set digest 與 publication-request outbox；不得自行寫 Privacy 的 visibility grant。
- `BeginAccountDeletion`：只在 Identity local transaction 寫 `AccountDeletionRequested`、deletion job state 與 privacy-fence-request outbox；不得同時寫 Privacy 的 lifecycle fence、visibility epoch 或 purge receipt。

每個 multi-stream transaction 都保存 forward patch。會被 correction reverse 的帳本 mutation 同時保存 exact inverse patch。

Story publication 與 Privacy visibility 也不假裝共用 owner。Story 寫 `StoryChapterPublished` 代表內容版本完成；Privacy 驗證 audience、market-time fence、rights 與 visibility epoch 後，在自己的 local transaction 寫 `PublicVisibilityGranted`／`SubscriberArchiveVisibilityGranted`。Public projection 必須同時引用 chapter event 與 grant event，缺一不發布。

引介跨 Identity DB 與 world canonical DB，不假裝成一筆跨資料庫 transaction。它使用 quota、continuity capacity 與 activation 三段 saga：Identity／Entitlement 先以 introduction ID 完成 `AdmitAuthoringCommand`，保留由同一份 `CommandAdmissionReceiptV1` 固定的當週名額；Character Origin 的 `IntroductionRequested` 必須引用該 envelope 的 body digest、decoded body 中的 `commandAcceptedAt` 與 quota window，不能重採 server time。Character Origin 再以同 ID 取得一筆能覆蓋角色延續義務的 capacity reservation，才進入 birth／asset pipeline；全部 business gates 通過後封存 ready receipt，Identity／Entitlement 在自己的 transaction 寫 `QuotaConsumed` 與 `IntroducerBondCreated`，Character Origin 收到兩個 acknowledgement 後只能 idempotent finalize `CharacterIntroduced`。任何終局政策失敗只能發生在 quota consume 前並釋放 quota／capacity；consume 後沒有 business reject。網路／worker／模型暫時失敗只保留同一 pending introduction，不讓使用者換 seed 重抽。任一 acknowledgement 遺失時人物維持不可公開的 ready state，由 reconciler 以兩邊 event refs 修復；不能出現「人已在世界、名額卻沒扣」或反過來的半套狀態。

---

## 6. 當期市場 sealed facts

### 6.1 Repository boundary

市場研究產品仍擁有來源、授權、公司事件、交易日曆、行情 revision、manifest sealing 與 finality。本 repo 只能消費 released artifacts：

- 不直接查上游資料庫。
- 不 mount SQLite、共享 ORM model、relative import 或 Git submodule。
- 不在本 repo 補抓缺少的價格或新聞。
- 上游儲存方式改變時，本 repo 只要 sealed contract 不變就不需要重寫。

### 6.2 Contract

現有 `sealed-facts/v1` 的 `fact_id`、JCS canonicalization、`content_hash`、`supersedes` 與來源 alias 可保留；它不足以單獨支撐當期世界，需新增 manifest envelope：

```ts
type WorldFactManifestV1 = {
  contractVersion: "world-fact-manifest/v1";
  modeDomain: "current";
  jurisdiction: "TW";
  manifestId: string;
  manifestHash: string;
  signatureKeyId: string;
  sealedAt: string;

  marketSessionId: string;
  marketDateTaipei: string;
  marketCalendarRevision: string;
  interactionCutoffAt: string;
  evidenceCutoffAt: string;
  finalityPolicyRevision: string;
  clockAuthorityRevision: string;

  rightsManifestId: string;
  licenseClass: string;
  rightsValidFrom: string;
  rightsValidUntil: string | null;
  permittedPurposes: string[];

  interactionFactRevisionIds: string[];
  interactionFactSetDigest: string;
  outcomeEvidenceRevisionIds: string[];
  outcomeEvidenceSetDigest: string;
  objectUri: string;
  objectHash: string;
};
```

每個 fact revision 必須另存：

```text
world_published_at
platform_received_at
observed_at
source_revision
supersedes_fact_id?
rights_scope
```

同一 manifest 物理分成兩組 immutable allowlist：

```text
available_at = max(world_published_at, platform_received_at)

interaction eligibility:
available_at <= min(
  character_world_time,
  interactionCutoffAt,
  CognitionInputSealed.occurred_at
)

outcome/editorial evidence eligibility:
available_at <= evidenceCutoffAt
```

`interactionFactRevisionIds` 才能進 exposure、attention、appraisal 與 action。`outcomeEvidenceRevisionIds` 只供 paper outcome、correction 與盤後 editorial 使用；即使同一 fact 同時合格，也要以兩個 allowlist 的明確 ref 進各自 pipeline。Outcome worker 沒有 Cognition command credential，CognitionInput 也沒有 outcome evidence 欄位。

Rights validity 只作 ingest／bind gate，不得拿來替代世界時間。Client 時鐘不參與裁決。`evidenceCutoffAt` 較晚時，新增證據不得回填、重跑或改變已 seal 的 attention、appraisal、action intent 或 order。

### 6.3 Ingest state machine

```text
RECEIVED
→ HASH_VERIFIED
→ SIGNATURE_VERIFIED
→ CONTRACT_VERIFIED
→ RIGHTS_VERIFIED
→ TIME_VERIFIED
→ MIRRORED
→ AVAILABLE_TO_WORLD

任何一步失敗 → QUARANTINED
MIRRORED | AVAILABLE_TO_WORLD → REVOKED
```

- 缺欄、hash 不符、unsupported major、rights 不明、時間矛盾或 revision 斷鏈全部 fail closed。
- 新包失敗時保留上一個有效 world projection並顯示資料時間；不自行補值。
- decision input seal 前到達的 correction 必須進新 manifest；seal 後 correction 以 `FactCorrectionObserved` 形成後續世界事件，不改寫角色當時知道的事。
- rights revoke 立即阻止新 cognition 與新公開投影；既有章節依 manifest 的 withdrawal policy 撤下或只保留不可還原 audit skeleton。

---

## 7. Persistent world engine

### 7.1 World time

`WorldSession` 保存 `Asia/Taipei` 市場日、權威 clock revision、交易狀態及 scene schedule。Cron 不是正史；所有晨起、開市、收盤、夜談、story publish、entitlement boundary 與 migration deadline 都先寫 `DeadlineScheduled`，worker 只能以固定 idempotency key fire。

世界有兩種前進來源：

1. `scheduled tick`：生活節律、移動、休息、工作、社交窗口。
2. `event tick`：新 sealed fact、paper fill、outcome、relationship encounter、rights correction。

同一 logical cell 在同一 `world_tick_id` 只有一個 writer ownership epoch。Client 只插值已投影的移動，不會因 frame rate 或背景分頁改變人物結果。

### 7.2 Activity tiers

所有角色都持續存在，但不是每秒呼叫模型：

| Tier | Trigger | Execution |
| --- | --- | --- |
| Visible | 正在公開場景、被跟拍或處於故事章節 | 完整 scene actions、必要 cognition、細緻 projection |
| Active | 有未結束紙上承諾、關係事件或高 salience fact | event-driven cognition + deterministic life ticks |
| Background | 無重要新輸入 | deterministic coarse ticks；不生成無意義 dialogue |

升降 tier 只改計算精度與投影頻率，不改角色可見市場資料、紙上帳本或結果。Activity tier 是 scheduler projection，不是人物生命週期；不能用 `Background` 當作刪除、退休或失訂狀態。

### 7.2.1 Character continuity lifecycle

公開後的 canonical continuity class 只有：

```text
PUBLIC ↔ VISIBILITY_HELD
VISIBILITY_HELD → WITHDRAWN
PUBLIC → WITHDRAWN // 只供必須立即撤下的安全／法令事件
```

- `PUBLIC`：stable ID 可找到；至少執行 coarse life progression、holding-relevant corporate actions／marks／corrections、重要關係與記憶事件 eligibility，並能在 relevant 時升回 Active／Visible。
- `VISIBILITY_HELD`：只因可修復的權利、真人相似、年齡、安全、隱私或資料完整性調查；停止新公開章節，但 canonical ledger、correction、retention 與 audit 繼續。修復後回到同一人物。
- `WITHDRAWN`：確認必須撤下；公開 read model 只留 policy-safe tombstone，限制區保存不可還原的 audit skeleton。它不是低人氣、成本、失訂或 inactivity 的出口。

`CharacterContinuityClassChanged` 由 Character owner 寫入，Privacy／Visibility 收到 typed command 後另行推進 `SubjectLifecycleFenceAdvanced` 與 visibility epoch。兩者不能共寫同一 canonical stream。帳號刪除只 detach `IntroducerBond`、Viewer Library 與私人筆記；角色沒有使用者自由文字或真人資料時仍留在 `PUBLIC`。

每個 `PUBLIC` 角色的最低排程義務由 versioned `CharacterLifecyclePolicy` 定義：

```ts
type CharacterLifecyclePolicy = {
  revision: string;
  coarseTickCadences: Array<{
    activityTier: "Visible" | "Active" | "Background";
    cadencePolicyKey: string;
  }>;
  mandatoryFactClasses: string[];
  mandatoryPaperProcesses: string[];
  relationshipAndMemoryEligibilityRules: string[];
  maxBackgroundCognitionCallsPerPeriod: number;
  sharedExtractionPolicyRevision: string;
  visibilityHoldReasons: string[];
  withdrawalReasons: string[];
  retentionAndTombstonePolicyRevision: string;
  capacityCostModelRevision: string;
};
```

`coarseTickCadences` 依 `Visible → Active → Background` 的 domain enum order 封存，tier 不得重複或缺漏。其餘 repeated policy 欄位使用 schema 宣告的 enum／UTF-8 byte order；validator 拒絕 duplicate，不能依語言 map iteration 產生 policy digest。

Background cognition 先使用 shared fact extraction、deterministic relevance 與 versioned fallback；只有對持股、退出條件、職業、生活責任、重要關係或未解記憶跨過 salience gate 才呼叫核准核心。沒有 eligible event 就讓人物安靜，不生成「還活著」台詞。

### 7.2.2 Population capacity admission

`IntroductionCapacityReserved` 不是 VM slot，而是一筆長尾義務預算，至少涵蓋 origin／asset 一次性成本、前 30 日活躍成本、day 90／365 背景成本、五年現值及穩態儲存／必要維運終值。Capacity service 只能以已實測 cost model、目前人口、活動分布、事件 fan-out、rights／correction 負擔及 headroom 批准。

封測人口建立窗固定為同一 cohort、`Asia/Taipei` 的連續 30 個日曆日半開區間 `[betaAuthoringStartsAt, betaAuthoringEndsAt)`，最多相交六個 ISO 週。只有 Identity admission transaction 同時滿足 `commandAcceptedAt >= betaAuthoringStartsAt && commandAcceptedAt < betaAuthoringEndsAt` 才能寫 `QuotaReserved`；起點前或終點後的新引介／SceneSeed 一律拒絕且不保留 quota。窗內已接受的 pending command 仍綁 receipt 原 window，即使 domain validation、quota consume 或完成時間落在窗外也不重算或建立新額度。`beta_full_access` 的觀看、深檔案與免廣告可繼續到觀察結束，不因此建立第七個作者額度窗。

Qualification population 固定為 1,850：50 名種子居民，加上 60 名測試者在六個相交 ISO 週各用滿五次所產生的 1,800 名居民。負載演練包含：

- 1,800 份新人物 origin 與完整 asset pack qualification，不用 placeholder 逃避成本。
- 全 1,850 人的 deterministic ticks、持股 mark、公司行動、correction、關係與記憶 eligibility。
- 可見／Active／Background tier 的尖峰切換與熱門事件 fan-out。
- calendar day 31 全部測試者失訂後，calendar day 90、365 的無新增收入 tail。
- 全 1,850 人持續跑到第 30 個完成交易日；若交易日驗收晚於 calendar day 30，以較晚者計入事件量與運算成本，但不得新增居民。
- 五年現值與 terminal maintenance reserve；既有角色不能用降真實性來通過。

容量不足時 `IntroductionCapacityWaitlisted` 保留同一 request／seed，不消耗 quota，也不建立公開角色；商業層必須停止新增付費承諾。V5 不得以 capacity 或 cost gate 臨時更改 NT$329／NT$2,790、每週五次引介或三次有限編導；只能降低基礎設施／供應成本並用同一權益重驗。已 `PUBLIC` 的角色永遠優先於新引介。

### 7.3 Scene and encounter

`WorldCell` 是角色正史與高頻關係的 routing unit；`Scene` 是可見空間，不是資料庫 shard。角色換 cell 只能在沒有 open cognition、pending fill、relationship settlement 或 privacy hold 的 scene boundary 執行。

相遇由 deterministic candidate scheduler 先根據位置、作息、關係與事件建立 `EncounterWindow`。Encounter staging 只能決定站位、姿勢、輪到誰取得語言行為窗口與是否沉默；它不能產生台詞。每人的 deterministic behavior policy 若提交 `SemanticSpeechActCommitted`，才由唯一 utterance realizer 走 `SealUtterance`。`RelationshipSignalObserved` 只引用已封存的 `PublicClaimMade` 與 artifact hash，不保存另一份文字。Realizer 失敗時仍可用姿勢、停頓、移動與 typed state 演出，不阻塞世界。

---

## 8. 角色、思考核心與模型治理

### 8.1 Character origin

出生流程固定：

```text
synthetic population constraint
→ immutable origin seed
→ adult fictional life bible
→ personality / symbolic motif normalization
→ relationship hooks
→ model-core selection
→ visual identity
→ CharacterOriginSealed
```

出生資料分為：

- immutable：出生 seed、年齡區間、背景事件、命盤計算輸入、外觀 identity、初始 core。
- slowly changing：職業、住處、關係、長期需求、生活責任。
- dynamic：情緒、疲勞、belief、commitment、paper position、short-lived intention。

人物生成先過 uniqueness、real-person similarity、age、unsafe combination 與 distribution drift gates。生成的 marketing prose 不能反過來成為 origin truth。

### 8.2 Introduction and asset readiness

`Introduction` 是可恢復的長工作，不是 request timeout。狀態機固定為：

```text
REQUESTED
→ CAPACITY_CHECKING
→ CAPACITY_RESERVED
→ VALIDATING
→ ORIGIN_SEALED
→ ASSET_PACK_BUILDING
→ ASSET_PACK_QUALIFYING
→ READY_FOR_ACTIVATION
→ AWAITING_IDENTITY_ACK
→ AWAITING_ARRIVAL_NODE
→ ACTIVATED

CAPACITY_CHECKING → WAITING_FOR_CAPACITY
WAITING_FOR_CAPACITY → CAPACITY_CHECKING
REQUESTED | CAPACITY_CHECKING | WAITING_FOR_CAPACITY | CAPACITY_RESERVED | VALIDATING
  → CANCELLATION_PENDING
CANCELLATION_PENDING → CANCELLED_BEFORE_ORIGIN
VALIDATING → FAILED_TERMINAL
ASSET_PACK_BUILDING | ASSET_PACK_QUALIFYING → RETRY_PENDING
ASSET_PACK_BUILDING | ASSET_PACK_QUALIFYING → FAILED_TERMINAL
RETRY_PENDING → ASSET_PACK_BUILDING
```

`CancelIntroductionBeforeOrigin` 只在 `CharacterOriginSealed` 尚未存在且 `QuotaConsumed` 尚未發生時接受。Character Origin 以 stream CAS，在同一 local transaction 寫 `IntroductionCancellationRequested`、origin-seal fence、`IntroductionCapacityReleased`（若已保留）與 quota-release-request outbox；其中任何一項失敗就全部不提交。Identity idempotently 寫 `QuotaReservationReleased` acknowledgement 後，Character Origin 的 reconciler 以 introduction／reservation／window／request digest 去重並以 CAS 寫 `IntroductionCancelledBeforeOrigin`。Request 或 acknowledgement 遺失只會讓 reconciler 重送，不能永久占住 capacity、本週名額或取消中的 stream。若 origin seal 在 race 中先提交，取消 command 拒絕，人物繼續原流程，不能藉此重抽。UI 在 acknowledgement 前顯示「正在退回保留次數」，也不能先開出新的名額。

只有 `READY_FOR_ACTIVATION` 後才向 Identity 要求消耗 quota 並建立 `IntroducerBond`。進入 READY 的同一 transaction 先封存 `IntroductionReadyReceiptBodyV1`，再依 §5.3 包成 `IntroductionReadyReceiptV1 = CrossContextReceiptEnvelopeV1<IntroductionReadyReceiptBodyV1>`：

```text
introduction_id
character_id
command_admission_body_digest
command_accepted_at
origin_digest
model_core_assignment_digest
asset_pack_digest
capacity_reservation_id
quota_window_id
policy_revision_set
rights_snapshot_refs
ready_at
```

這個 body 不含自己的 digest、signature 或 event provenance。所有年齡、真人相似、內容、權利、身份、資產、capacity 與 schema business gates 都在 receipt 前完成。Ready receipt 不用 wall-clock expiry；跨週 pending 仍綁原 quota window，rights／policy 變化以後續 lifecycle event 處理。Identity／Entitlement 驗證 envelope signature／body digest 後，在同一 local transaction 寫 `QuotaConsumed`、`IntroducerBondCreated` 與 acknowledgement outbox。Character Origin 核對 acknowledgement event ref／同一 body digest 後寫 `IntroductionActivationAcknowledged`，進 `AWAITING_ARRIVAL_NODE`；下一個有效世界節點才寫 `CharacterIntroduced` 並進 `ACTIVATED`。從 `QuotaConsumed` 開始不得再跑會 reject 的 business validation，也不能轉 `FAILED_TERMINAL`。Worker、網路、錯過節點或 deadline 問題只會以同一 receipt 重試 finalize。

若 rights／safety 狀態在 ready 或 consume 後改變，角色仍先完成 canonical introduction，再依新事件進 `VISIBILITY_HELD`／`WITHDRAWN`；Privacy 可以不發 public visibility grant。它仍算一次引介，不能用 compensation 重抽。這套規則讓系統不會留下「已扣額＋bond、無角色」孤兒。Identity／Entitlement 是 bond 的唯一 owner；Character Origin 不能自己建立 bond。在此之前 quota 是 reservation：會占用可用名額，避免併發超發，但 UI 不寫成已使用。

`FAILED_TERMINAL` 只用於年齡、真人相似、內容安全、權利、身份一致性、資產人工核准或不可修復 schema 問題。這些檢查可能在 VALIDATING 才發現，也可能在生成完成後由 asset qualification 發現，所以兩個階段都有 terminal path。寫 `IntroductionFailed` 的 local transaction 必須同時寫 `IntroductionCapacityReleased`（若已保留）與 quota-release-request outbox；Identity idempotently 寫 `QuotaReservationReleased` acknowledgement。API 在 ack 前回 `quotaReleaseState = PENDING`，本週名額仍顯示保留中；lost request／ack 由 reconciler 重送，不能讓 terminal failure 永久吃額度。Capacity 不足進 `WAITING_FOR_CAPACITY`；timeout、網路、算力不足或可重試生成失敗進 `RETRY_PENDING`，全部重跑同一 request／origin／visual seed，不產生新候選。

`CharacterOriginSealed` 後人物人生已固定，不能取消後重抽。使用者離開頁面不影響工作；`GET /api/v2/introductions` 以 durable state、下一步與同一 receipt 恢復。

最小 `CharacterAssetPack` 必須同時通過：

- 4:5 identity master、1:1 avatar、9:16 safe crop。
- 可在六個世界場景使用的八層 rig bundle、必要表情／姿勢 token 與 approved static fallback。
- `VoiceIdentityProfileV1`：固定成人聲線契約、語速／停頓／語尾範圍、發音詞典、核准用途、權利期限、反真人聲紋相似檢查、合成 capability revision 與 approved text-only fallback；禁止真人聲音複製。
- 年齡、視覺／聲音身份一致性、crop、alt text、caption、reduced-motion、rights、model／seed／prompt provenance、內容 hash 與人工核准。
- 世界 atlas／bundle budget 與中階手機 qualification。

資產未 qualified 前不把陌生 placeholder、半成品或新臉放進公共世界。Qualified 只讓引介進 `READY_FOR_ACTIVATION`；Identity 寫入同 receipt 的 `QuotaConsumed`／`IntroducerBondCreated`，Character Origin 收到 activation acknowledgement 並進 `AWAITING_ARRIVAL_NODE` 後，scheduler 才能在下一個有效世界節點寫 `CharacterIntroduced`。錯過節點就等下一個，不靠 client timer。動畫層暫時失效時使用同一 pack 的已核准靜態 fallback，不重新生成另一張臉。

### 8.3 ModelCore contract

封測預設核心為 `Gemma 4 26B`。選擇頁可顯示公開模型名稱，並描述閱讀深度、反應速度、矛盾處理與社會推理；不提供 IQ、勝率、預期報酬或非公開運算來源。

```ts
type ModelCoreContract = {
  coreId: string;
  publicName: string;
  capabilityDescriptors: {
    readingDepth: string;
    responseCadence: string;
    contradictionHandling: string;
    socialReasoning: string;
  };
  coreContractRevision: string;
  modelSnapshotRevision: string;
  weightsDigest: string;
  tokenizerDigest: string;
  adapterRevision: string;
  promptRevision: string;
  inputSchemaRevision: string;
  outputSchemaRevision: string;
  fallbackPolicyRevision: string;
  effectiveFrom: string;
  retiredAt: string | null;
};
```

使用者只在角色出生時選核心。`ModelCoreAssigned` 後不能因短期結果重抽；安全或維運升級必須保持同一 core behavior contract，且每一次 cognition 仍保存 exact snapshot。

### 8.4 Cognition pipeline

```text
freeze character + memory + relationship + paper-account refs
→ bind interaction fact allowlist + interaction cutoff
→ deterministic clue eligibility
→ shared core fact extraction/cache
→ bounded per-character appraisal request
→ schema / source-ref / policy validation
→ deterministic attention
→ deterministic action utility and constraints
→ atomic primary action intent; paper action also seals order + structured rationale
→ optional semantic speech act referencing the committed intent/state
→ if speech: single utterance realizer + immutable seal in its own transaction
```

模型輸入只有：

- 已 sealed、位於 `interactionFactRevisionIds` 且通過三重 cutoff 的 fact refs。
- deterministic retrieval 選出的有限記憶與關係摘要。
- 人格／命盤 normalized motifs、目前需要與生活壓力。
- paper account 摘要、合法 action mask、時間與 output schema。

模型輸出只有 `CognitionAppraisalV1`：

```ts
type CognitionAppraisalV1 = {
  contractVersion: "cognition-appraisal/v1";
  factAppraisals: Array<{
    factRevisionId: string;
    relevanceBp: number;
    reliabilityBp: number;
    uncertaintyBp: number;
    supportsPropositionIds: string[];
    challengesPropositionIds: string[];
  }>;
  interpretationCandidates: Array<{
    propositionId: string;
    supportFactRevisionIds: string[];
    counterFactRevisionIds: string[];
    uncertaintyBp: number;
  }>;
  socialInterpretationCodes: string[];
  attentionProposalRefs: string[];
};
```

Schema 設 `additionalProperties: false`，`propositionId` 只能引用 input allowlist。模型不輸出 prose、claim string、communication intent、final paper order、價格、帳本 patch、記憶 patch、關係 patch或公開長文。內部 reasoning／chain-of-thought 不要求、不保存、不公開。

語言行為由 deterministic behavior policy 提交為 `SemanticSpeechActV1`；`WITHHOLD` 只產生沉默或離開，不產生台詞。唯一 utterance realizer 可把已提交的 act 變成一個候選，但 verifier 只有 `ACCEPT`／`REJECT(reason_codes)`，不能改字。Invalid／unsafe 候選直接走同版本 deterministic fallback；沒有安全 fallback 就 `NO_UTTERANCE`。

Paper action 與語句不是同一 atomic promise：訂單與 structured rationale 先完成，之後的 semantic speech act 引用該 committed state。Realizer／artifact 失敗不能 rollback 紙上行動，也不能把一句話事後塞回 rationale event。

第一個 terminal surface form 以 [`character-story-engine.md`](./character-story-engine.md) 定義的 `UtteranceArtifactV1`，和 `PublicClaimMade` 或 `SelfAcknowledgementMade` 在 `SealUtterance` transaction 原子封存。`CommitmentRationaleSealed` 永遠只存 structured rationale；若角色稍後把理由說出口，必須先有新的 `SemanticSpeechActCommitted`，再封存獨立 artifact，不能附回原交易事件。`canonicalTextUtf8` 經 NFC／LF 正規化、完整內嵌 event payload，再計 `canonicalTextSha256`；`(semanticSpeechActEventId, surfaceKind)` 唯一，沒有 update。改口、澄清、收回與翻譯都只能建立明確標示的新 artifact，不能覆蓋或冒充原句。

角色只會說一次。Story、caption、share、notification、video、accessibility、visibility sanitizer 與 client 只能逐字引用或整筆隱藏 artifact；不得 paraphrase、截短成引號、重做標點、代換代名詞或用模型重新生成。畫面放不下就不顯示整句；未來翻譯必須標成 translation artifact。

語音是同一份原話的衍生 rendition，不是第二條台詞生成路徑。Projection／Search 的 media projector 只對 visibility policy 允許朗讀的 `UtteranceArtifactV1` 產生：

```ts
type UtteranceAudioRenditionV1 = {
  contractVersion: "utterance-audio-rendition/v1";
  renditionId: string;
  utteranceArtifactId: string;
  characterId: string;
  canonicalTextSha256: string;
  voiceProfileRevision: string;
  speechSynthesisPolicyRevision: string;
  synthesisCapabilityRevision: string;
  pronunciationLexiconRevision: string;
  audioCodec: "opus" | "aac";
  audioContentSha256: string;
  durationMs: number;
  captionCues: Array<{
    startMs: number;
    endMs: number;
    startUtf8Byte: number;
    endUtf8Byte: number;
  }>;
  rightsSnapshotRefs: string[];
  visibilityEpoch: number;
  generatedAt: string;
};
```

Rendition 不保存第二份 transcript；caption cue 只能指向 `canonicalTextUtf8` 的完整 UTF-8 byte ranges，順序遞增且不得重疊、改字或略字。生成鍵至少包含 utterance artifact、text hash、voice profile、合成 policy、capability 與發音詞典 revision；同鍵 idempotent，成品 content-addressed。TTS／音訊失敗時保留同一原話文字與字幕，不換另一個聲線、不重跑成另一句；權利、artifact visibility 或 visibility epoch 失效時整份音訊一起 withheld／purged。此 projector 沒有 command API，不能發 canonical event 或回寫 `UtteranceArtifact`。

### 8.5 Version upgrade

任何 model snapshot 升級需經：

1. schema conformance。
2. frozen cognition fixtures。
3. future-information leakage suite。
4. bias／character differentiation regression。
5. shadow traffic。
6. small canary cohort。
7. replay-by-stored-output qualification。
8. two-person approval。

相容 snapshot 可留在相同 `core_contract_revision`；若角色行為取捨有實質變化，必須建立新 core contract，不能靜默替換。Rollback 只影響尚未 seal 的 cognition；已發生事件永不重新呼叫模型。

可選核心由 versioned `ModelCoreCatalog` 提供。每筆至少包含 `core_id`、public model name、behavior contract revision、approved snapshots、fallback core、latency／cost envelope、rollout state 與 deprecation policy。Gemma 4 26B 是 beta default。選擇器只讀 `rollout_state = PUBLIC_SELECTABLE`；少於兩個可選核心時，client 顯示固定預設，不用 persona preset 冒充模型選擇。任何新增核心都要完成上述八項升級測試與成本門檻。

---

## 9. 自主紙上交易與承擔紀錄

### 9.1 Paper canonical topology

每個角色有一個獨立 `PaperAccount`、每筆 order 一個 `PaperOrder`，並對每個
持有過的 instrument 建立 `PaperPosition`。三者欄位 ownership 不重疊：

| Aggregate | Authoritative state | 不得保存 |
| --- | --- | --- |
| `PaperAccount` | currency、cash、reserved cash、double-entry journal postings、account balance／risk invariants、account correction refs | order lifecycle、fill 狀態、lot、quantity、cost basis、mark、position P&L |
| `PaperOrder` | requested terms、submitted／rejected／filled／expired lifecycle、fill refs、execution ruleset、price-source refs | cash、journal balance、position quantity／cost／mark |
| `PaperPosition` | instrument、lots、quantity、cost basis、marks、position-level realized／unrealized P&L、corporate-action effects、position outcome | account cash／journal、order lifecycle |

Fees、tax 與 realized P&L 在 `PaperAccount` 中只以 double-entry postings 存在；
lot 歸屬與 position-level 計算由 `PaperPosition` 擁有。兩者在同一 fill／corporate
action／correction transaction 以共同 source ref 對帳，但任何 aggregate
不得複製另一方的 authoritative field。

首發 `PaperAccountPolicy` 以相同的 NT$1,000,000 虛擬本金開戶，只允許現金股票與既有持股賣出；同時最多八檔、單檔 intent commit 時不超過模擬資產 25%，成交後至少保留 5% 現金。這些限制全部版本化，付費 entitlement 不得覆寫。

所有價格以原始貨幣最小單位或宣告 scale 的 integer 表示；數量使用定點整數。正式計算不得使用 JavaScript number 或 Rust float。

任何 cognition input、action seal、fill、outcome、correction、`CharacterStateView`
與 portfolio projection 都保存 exact version set：

```text
paper_account_ref / paper_account_version
paper_order_refs[] / paper_order_versions[]
paper_position_refs[] / paper_position_versions[]
paper_version_set_digest
```

Repeated refs 依 stable aggregate ID byte order 封存且拒絕 duplicate。只引用
`paper_account_version` 的 input 或 projection 一律不合格。

### 9.2 Action and fill

角色可以產生 `BUY`、`SELL`、`HOLD`、`NO_ACTION` 的紙上意圖，但合法集合由 portfolio policy、cash、持股、市場狀態與風險限制決定。

每個意圖封存：

```text
decision_at
paper_account_ref / paper_account_version
open_paper_order_refs[] / open_paper_order_versions[]
relevant_paper_position_refs[] / relevant_paper_position_versions[]
knowledge_manifest_id
observed_clue_ids[]
appraisal_snapshot_id
commitment_rationale_id
action
quantity_policy
order_expiry
fill_policy_revision
```

成交只能使用 decision 後第一個符合 `fill_policy_revision` 的 sealed reference price。沒有合格價格就 `PaperOrderExpired`；不得在事後挑一個最好看的日內價格。Same-day、next-session、corporate action、停牌、漲跌幅限制與零成交量都有 golden fixture。

### 9.3 Outcome and correction

- `PaperMarkApplied` 引用 exact fact revision；人生曲線只是這些 marks 的 projection。
- 已實現與未實現損益分開，不能把未成交意圖算進績效。
- 事實 correction 不覆寫舊 ledger event；同一 correction transaction 以 `PaperAccountingCorrectionApplied` 追加 Account journal 的 inverse／forward postings，並以 `PaperPositionAdjusted` 追加 Position lot／cost／outcome patch。原 `PaperOrder` fill lifecycle 不改寫，只增加 correction provenance ref。
- 角色當時的人生不因後續資料修正被重寫；可以在稍後收到 `CharacterCorrectionLearned`。
- portfolio projection 同時讀 `PaperAccount`、相關 `PaperOrder` 與 `PaperPosition` exact version set，永遠回傳 `as_of`、data state、policy revision 與 source refs。

### 9.4 「韭菜樣」的正式資料

角色可笑、可愛與令人牽掛的部分，必須從以下可驗證材料長出來：

| Pattern | Canonical evidence |
| --- | --- |
| 追高／FOMO | price-attention acceleration、social exposure、late action、原本未持有 |
| 錨定 | sealed reference claim 與後續 action threshold 長期黏著 |
| 凹單／沉沒成本 | commitment 已失效、虧損擴大、仍拒絕 close 的連續事件 |
| 處分效應 | 相似 conviction 下，獲利部位較快 close、虧損部位較久保留 |
| 確認偏誤 | attention 持續排除 contradiction refs |
| 改口 | 原始 `CommitmentRationaleSealed` 的 structured proposition，與後續 `PublicClaimMade`／`SelfAcknowledgementMade` 所封存 artifact 的 typed contradiction；structured rationale 本身沒有 quote |
| 歸因偏誤 | outcome 後把成功歸自己、失敗歸外部的結構化 attribution |
| 偷看／嘴硬／躲人 | observable scene actions、relationship avoidance 與 check cadence |

`BehaviorMarkerActivated` 只能說「這一段行為符合哪種 pattern」，不能宣稱還原角色唯一內在真因。人生誌用並列證據呈現：

```text
當初承諾
→ 現在說法
→ 紙上持有天數與損益
→ 沒有回應的反證
→ 關係／記憶後果
```

沒有全域「菜度」、最好／最差角色或模型排行。

---

## 10. Memory and relationship architecture

### 10.1 MemoryLedger

記憶不是 prose list，而是 versioned graph：

```ts
type MemoryRecord = {
  memoryId: string;
  characterId: string;
  kind: "episodic" | "belief" | "relationship" | "self_narrative";
  sourceEventIds: string[];
  formedAt: string;
  recalledAt?: string;
  salienceFixed: string;
  confidenceFixed: string;
  valenceFixed: string;
  decayPolicyRevision: string;
  supersedesMemoryId?: string;
  visibility: "canonical_restricted" | "subscriber_archive" | "public_edition";
};
```

- 新理解以 `MemoryReframed` 指向舊 memory，不 update 舊內容。
- 記憶合併需保存 source set；不能只存模型摘要。
- retrieval 是 deterministic candidate selection，再由 core appraisal使用；不能讓模型任意搜尋全世界。
- `canonical_restricted` 記憶不進 analytics、任何使用者 projection、公開 story prompt 或 notification。`subscriber_archive` 只代表已核准可發布的深層證據，不代表 raw prompt 或 chain-of-thought。

### 10.2 RelationshipDyad

一段關係由單一 dyad aggregate 擁有兩個方向：

```text
A→B trust / deference / obligation / resentment / familiarity
B→A trust / deference / obligation / resentment / familiarity
shared event refs
last meaningful encounter
relationship milestones
```

關係更新需要可觀察 signal 與 policy；「同一次獲利」不能自動讓所有關係變好。跨 cell dyad 先建立 immutable encounter mailbox，目標 cell 接受後才提交 `RelationshipEncounterCommitted`。超時不補寫相遇。

`dyad_id` 由排序後的兩個 character ID 加 relationship schema revision 決定；routing directory 以 `dyad_id → home_logical_cell_id + ownership_epoch` 指向唯一 writer。兩個 Character stream 只保存 dyad ref 和最後已套用版本，不保存 trust／resentment 等第二份真相。

跨 cell 更新固定走：

```text
scene coordinator opens immutable encounter mailbox
→ participant cells validate presence／exposure and acknowledge source refs
→ dyad home cell checks mailbox deadline, stream version and ownership epoch
→ one RelationshipEncounterCommitted transaction advances both directions
→ outbox publishes the new dyad version to participant projections
```

任何一方缺席、epoch 過期或 deadline 到期就寫 expired／rejected terminal state，不靠補償交易假造相遇。Dyad migration 只能在 scheduled barrier 進行：舊 owner 停收新 command、排空 inbox、封存 stream version，寫 `RelationshipDyadOwnershipTransferred`；新 owner 以 `epoch + 1` 接手。舊 epoch command 一律拒絕，migration replay 必須得到相同 dyad digest。

---

## 11. Story projection and APIs

### 11.1 Story chapter contract

故事不是自由生成文章。每章先建立 `StorySourceSet`：

```ts
type StorySourceSet = {
  chapterId: string;
  characterIds: string[];
  sourceEventIds: string[];
  utteranceArtifactRefs: Array<{
    utteranceArtifactId: string;
    canonicalTextSha256: string;
  }>;
  sourceSetDigest: string;
  marketFactRefs: string[];
  timeRange: { from: string; to: string };
  visibilityEpoch: number;
  narrativePolicyRevision: string;
};
```

生成器只能把已核准 source set 渲染成 segments。`character_claim` 沒有自由文字欄：

```ts
type NarrativeSegment =
  | {
      segmentId: string;
      perspective: "character_claim";
      truthClass: "simulated_narrative";
      utteranceArtifactRef: string;
      canonicalTextSha256: string;
      sourceRefs: string[];
    }
  | {
      segmentId: string;
      perspective: "observable" | "editorial_bridge";
      truthClass:
        | "real_fact"
        | "statistical_sample"
        | "fictional_setting"
        | "symbolic_interpretation"
        | "simulated_narrative";
      text: string;
      sourceRefs: string[];
    };
```

Story model 可以寫動作、鏡頭與 editorial bridge，也可以挑選或排列允許的 artifact ref；它不能輸出角色說了什麼。Server 在 projection 階段依 ref 解析 exact canonical bytes。Segment 沒 source ref、artifact hash 不符、混合 truth classes、把角色 claim 寫成客觀事實、或宣稱唯一心理因果時，chapter 不得發布。生成失敗時使用 typed structured card fallback；fallback 不能用第一人稱替角色補話，也不能阻塞 world tick。

### 11.2 Projection chain

```text
Canonical events
→ private projection
→ visibility sanitizer
→ public projection event
→ public PostgreSQL read model
→ CDN / SSE
```

Public worker 使用 `(consumer_id, event_id)` inbox 去重。每筆 public row 保存 source global position、projection version、visibility epoch、source set digest。舊 epoch event 一律拒絕。

`PublicationDelayPolicy` 是 visibility sanitizer 的必要輸入。首發 current-market 規則：

- 交易時段只公開截至前一有效交易日收盤的 paper portfolio。
- 當日 ticker-specific action、direction、quantity、confidence、fill 與 thesis 在 `MarketSessionFinalityAccepted` 前只存在 private canonical projection。
- finality 通過後，以盤後章節一次公開當日 action、來源時間、模擬標示和人物後果。
- Free、subscriber、admin preview、notification、search、share 與影片 renderer 共用同一 market-time fence；entitlement 不能提早揭露。

被 fence 的欄位要在 public schema 物理移除，不能只靠前端隱藏或 `null` 文案。完整產品邊界見 [`market-safety.md`](./market-safety.md)。

`market_sensitivity` 不是只有 paper 欄位標記。Visibility sanitizer 必須同時檢查場景姿勢、手上物件、focus hint、motion class、聲音、utterance artifact、人物近景、SSE hook 與替代文字。任何能被直接讀成「剛下單、正在加碼、已減碼、正在處理某 ticker」的語義，在 finality 前都不能進 public projection；姿勢、物件與 narrator observation 可改投影為「查證」「等待」「被打斷」等中性狀態。

角色原話是例外：sanitizer 只能整筆 withhold `character_claim` segment，不能把 artifact 改寫成中性台詞。若畫面需要連續性，另建 `observable`／`editorial_bridge` 段落且不用引號。Finality 後解析的是原 artifact ID、bytes 與 hash，不是重生成版本。World、close-up、journal、search、share、notification、video 與 accessibility projection 使用同一 sanitizer、artifact resolver 和負向 golden fixtures。

`DailyMomentsEdition` 是「今日五幕」唯一 canonical editorial aggregate，與使用者建立的 `StoryRoll` 分開。每版固定保存：

```text
market_date
ordered_story_chapter_refs: StoryChapterRef[] // minItems: 0, maxItems: 5
selection_policy_revision
candidate_set_digest
source_revision_set
market_finality_ref
visibility_epoch
published_at
supersedes_edition_id?
withdrawal_state
```

只有通過來源、人物後果、market-time fence、rights 與非績效排序檢查的已發布 chapter 能入版。資料不足時發布 0–4 幕；correction、rights revoke 或撤稿以 supersede／withdraw 建立新版，不由 client 補位或重排。

Viewer-authored `StoryRoll` 私人建立、預設不公開，僅能引用 3–12 個當下仍可見的完整 public segment refs。排序與觀眾札記是 viewer content，不是世界正史；公開分享前要通過內容、ticker-signal、權利與個資檢查，並顯示「觀眾整理」。來源 chapter／segment withdrawn 或 visibility epoch 改變時，roll projection 立即 tombstone 該項，不保存改寫副本。Quota 消耗與 Viewer Library mutation 用 idempotent command／outbox 協調；React 不能在本機假裝建立成功。

### 11.3 Read APIs

V5 新建 OpenAPI major，不擴寫五席 `/v1/rounds`。下表一律使用瀏覽器可見的
public path；手寫 OpenAPI 與 generated TypeScript client 也只發布這些路徑。
Edge 將 `/api/v2/*` 映射到 internal HTTP router 的 `/v2/*`，並將
`/events/v2/world` 映射到 internal SSE router 的 `/v2/world/stream`。Internal
path 不是 public contract，不能出現在 client、錯誤 payload 或分享網址：

| Resource | Purpose |
| --- | --- |
| `GET /api/v2/world` | 公共世界 snapshot：場景、人物位置、market clock、story hooks、data state |
| `GET /events/v2/world` | SSE：world ticks、scene changes、可公開人物事件與 projection checkpoint |
| `GET /api/v2/characters/{id}/close-up` | 角色近景：當下可觀察狀態、正在注意、公開說法、未解承諾 |
| `GET /api/v2/characters/{id}/life-journal` | cursor-based canonical 時序章節；只含章節內後果摘要與 `/archive/*` refs，不回完整人生曲線、帳本、關係或記憶索引 |
| `GET /api/v2/characters/{id}/archive` | 深層檔案索引、各 section entitlement／as-of／visibility；不內嵌完整 section payload |
| `GET /api/v2/characters/{id}/archive/paper` | 已通過 public time fence 的紙上帳戶、orders、positions、lots、損益、歷史 action／fill、三 aggregate exact version set、as-of 與資料 revision |
| `GET /api/v2/characters/{id}/archive/relations` | 完整可發布關係年表、directed state 與共同事件 |
| `GET /api/v2/characters/{id}/archive/chart` | 固定出生資料、完整命盤與連回人物事件的 symbolic motifs |
| `GET /api/v2/characters/{id}/archive/traits` | 四軸偏好、行為證據、反例、習慣與已可發布 pattern |
| `GET /api/v2/characters/{id}/archive/memories` | 記憶索引、來源、可信度與 reframe revisions |
| `GET /api/v2/characters/{id}/archive/life` | 人生聖經、世代背景與 canonical 生平時間線 |
| `GET /api/v2/moments?marketDate=` | 指定交易日的 `DailyMomentsEdition`：0–5 個有序 chapter refs、edition／policy／finality／visibility 資訊 |
| `GET /api/v2/story-chapters/{id}` | 一章故事及 segment provenance |
| `GET /api/v2/utterances/{id}/audio-rendition` | 通過同一 visibility／market-time fence 的 rendition metadata、caption byte cues 與短效 signed media URL；無合格音訊時回明確 text-only state |
| `GET /api/v2/model-cores` | 目前可公開選擇的 core catalog；少於兩個時回固定預設狀態 |
| `GET /api/v2/market-facts/{factId}` | 可公開 sealed fact、來源與 correction chain |
| `GET /api/v2/search` | 角色、章節、公開事件；不可依績效或模型排序角色 |
| `GET /api/v2/me/entitlement` | 簽章後的有效 access claim、quota balances 與 ad policy；不回傳原始 receipt |
| `GET /api/v2/price-catalog` | 市場、channel、月／年方案、含稅顯示價格與 catalog revision |
| `GET /api/v2/me/library` | active／selection-pending follows、reminders、clips、story-roll summaries |
| `PUT／DELETE /api/v2/me/follows/{characterId}` | 啟用／停用追蹤；遵守 Free active selection policy |
| `PUT／DELETE /api/v2/me/reminders/{characterId}` | 設定人物提醒或每日彙整 |
| `POST／DELETE /api/v2/me/clips/{segmentId}` | 收藏／移除一個仍可公開的完整片段引用 |
| `GET／POST／PATCH /api/v2/story-rolls` | 讀取、建立、排序、札記與發布 viewer-authored story roll |
| `POST /api/v2/introductions` | 引介角色 command，回 durable command receipt |
| `GET /api/v2/introductions` | pending／completed／failed 引介、可恢復 receipt 與 `quotaReleaseState`；release ack 前不能把次數加回 |
| `POST /api/v2/scene-seeds` | 三種有限編導 intent：安排相遇、放入封存公開材料、留下候選問題 |
| `GET /api/v2/scene-seeds` | quota balance、待執行／延後／拒絕結果、`quotaReleaseState` 與 source command refs |
| `PATCH /api/v2/me/settings` | 通知、可及性、語系與資料同意；不接角色世界 state |
| `POST /api/v2/me/export`、`POST /api/v2/me/delete` | 建立可追蹤 account lifecycle command |
| `GET /api/v2/commands/{id}` | canonical command status |

角色讀取 endpoint 套用同一個 versioned audience contract，不能各自臨時判權：

| Audience scope | Life journal | `/archive/paper` | 其他 `/archive/*` sections |
| --- | --- | --- | --- |
| `public_current` | 今日與最新已發布後果 | 截至前一交易日的目前摘要 | 不回完整索引 |
| `free_archive` | 最近 30 日＋公開精選 | 最近 30 日＋公開精選 | 固定試讀片段 |
| `subscriber_archive` | 所有可發布歷史 | 完整可發布帳本投影 | 完整可發布關係、命盤、性格、記憶、生平證據 |
| `canonical_restricted` | 不可查 | 不可查 | 不可查 |

「完整」不包含 raw prompt、chain-of-thought、未發布候選記憶、內部 utility 或 moderation artifact。引介人與其他同方案使用者取得相同角色事實；引介 bond 只影響創作與 Viewer Library 工具。Audience projection 採 server-side field selection／separate read model，不能把 restricted 欄位送到 client 再隱藏。

所有 projection response 至少包含：

```text
projection_version
source_global_position
server_now
data_state: READY | STALE | HELD | CORRECTED | WITHDRAWN
visibility_epoch
truth_classes[]
source_revision_set
```

SSE 只提示 resource changed；斷線重連以 checkpoint cursor 補讀。Client 收到 event 後仍以 GET projection 為準。

### 11.4 Public world renderer

場景 API 回傳角色世界座標、姿勢 state、focus hints、z-order、motion class 與 source event refs。Web client 負責：

- 跟拍手勢、鏡頭交接、視差、動畫插值。
- reduced-motion、鍵盤、switch control 與 screen-reader 等價操作。
- loading、stale、held、offline、projection-lagging 狀態。

Client 不根據 timer 自行推演新 dialogue、位置、持股或市場狀態。

所有 client／renderer 對 `character_claim` 只能用 server-resolved artifact bytes。允許 HTML escape、字型、完整句換行與時間軸對齊；不允許摘要、翻譯、改標點、換代名詞、截成看似逐字的短句或在 accessibility label 另寫一版。無 artifact 的結構化 rationale 只能顯示為無引號的系統摘要。

首次使用教學也是 projection，不是 world command。它只能高亮目前存在的 public character，或深連結到已發布且已通過 finality 的歷史 chapter；不得建立 per-viewer encounter、speech、paper action、contradiction 或 story beat。歷史章節回傳原 `world_time` 與 `viewMode = REPLAY`，返回後重新讀 current world checkpoint，不把觀看事件送進角色 cognition。

---

## 12. Entitlement、訂閱與廣告

商業規則進 versioned `EntitlementPolicyBundle`，不散落在 React condition：

```ts
type EntitlementBase = {
  subjectId: string;
  features: string[];
  quotaEntries: Array<{
    quotaKey: string;
    limit: number;
    periodKey: string;
    used: number;
  }>;
  adPolicyKey: string;
  issuedAt: string;
  policyRevision: string;
  signature: string;
};

type NormalizedEntitlement =
  | (EntitlementBase & {
      viewerClass: "anonymous";
      planKey: "anonymous";
      status: "active";
      validUntil: null;
    })
  | (EntitlementBase & {
      viewerClass: "registered";
      planKey: "free";
      status: "active";
      validUntil: null;
    })
  | (EntitlementBase & {
      viewerClass: "registered";
      planKey: "subscriber";
      status: "active" | "grace";
      validUntil: string;
    })
  | (EntitlementBase & {
      viewerClass: "registered";
      planKey: "beta_full_access";
      status: "active";
      validUntil: string | null;
      authoringWindow: {
        startsAt: string;
        endExclusiveAt: string;
      };
    });
```

簽章與 canonical claim bytes 依 `quotaKey` UTF-8 byte order 排列 `quotaEntries`，拒絕 duplicate key；`features` 依 policy-declared order。HTTP read projection 可以另產生方便 client 查詢的 object，但該 object 不是簽章或 canonical digest 的來源。

匿名 subject 使用簽章後的短期 opaque session ID，不是 account PII。它只能讀公共 projection，不能建立 server-side follow、收藏、提醒、故事卷、引介或場景 command。

`NormalizedEntitlement` 只描述此刻有效的存取，不保存 `expired`／`refunded` 等 billing 狀態。原始付款生命週期另存於 `BillingSubscription`：`pending | active | grace | expired | refunded | revoked`。Subscriber grace 結束時，server 以 `EntitlementReplacedByFree` 簽發新的 `free／active` claim；client 永遠不必猜 `subscriber／expired` 應該有哪些功能。

需要 quota 的引介與 SceneSeed 共用唯一 ingress 時間契約：

```ts
type CommandAdmissionReceiptBodyV1 = {
  commandId: string;
  commandKind: "resident_introduction" | "scene_authorship";
  quotaKey: "resident_introduction" | "scene_authorship";
  quotaWindowId: string;
  quotaWindowStartsAt: string;
  quotaWindowEndsAt: string;
  commandAcceptedAt: string;
  entitlementRevision: string;
  authoringWindowStartsAt: string | null;
  authoringWindowEndExclusiveAt: string | null;
  idempotencyKeyDigest: string;
  quotaReservationId: string;
};

type CommandAdmissionReceiptV1 =
  CrossContextReceiptEnvelopeV1<CommandAdmissionReceiptBodyV1>;
```

`commandAcceptedAt` 只有一個語義：Identity／Entitlement 接受這個可計額 command
並在同一 transaction 寫 `QuotaReserved` 的 server DB time。它不是 client
送出時間、HTTP 到達時間、domain validation 完成時間、排程時間或執行時間。
Identity 以它判定封測 half-open authoring window 與台北 ISO quota week；其他
context 只能引用 receipt，不能重採時間或另算 window。同一 subject、quota key
與 idempotency digest 的重送必須回原 command ID、原 `commandAcceptedAt`、原
window 與原 reservation ID；receipt 送達較晚也不移動週界。

`quotaReservationId` 在 transaction 內先生成；body 依 §5.3 計算 `bodyDigest`
並包進 envelope。`QuotaReserved` canonical payload 保存 body bytes、body schema
與 body digest，不保存 envelope signature 或 event provenance。跨 context
的 body 不含 subject／account ID；Identity 內部以 command ID 關聯 subject。
若 entitlement、authoring
window 或 quota 在 admission transaction 不合法，command 當場拒絕且不建立
receipt、reservation、Introduction／SceneSeed stream。進入 domain 後的
`domainAcceptedAt` 只描述領域 artifact 通過，不參與 quota、authoring window、
人口上限或週界判定。

### 12.1 Initial policy data

| Plan | Public stories | Follow／reminder／clips | Introduction | Scene authorship | Archive／story roll | Ads |
| --- | --- | --- | --- | --- | --- | --- |
| `anonymous` | full public world | 0／0／0 server-side | disabled | disabled | public／disabled | first complete story off; later natural breaks on |
| `beta_full_access` | full | reasonable／reasonable／reasonable | 5／week only when `commandAcceptedAt` is inside signed `[authoringWindow.startsAt, authoringWindow.endExclusiveAt)`, then disabled | 3／week by the same receipt rule, then disabled | deep／create-edit | disabled |
| `free` | full public world | 3 active／1 daily digest／10 clips | disabled | disabled | public depth／existing read-export | account day 0–29 off; day 30+ natural breaks on |
| `subscriber` | full | reasonable／reasonable／reasonable | 5／week | 3／week | deep／create-edit | disabled |

這些是初始 policy values，不是 UI constants。模型核心不能成為按績效販售的 tier，訂閱也不能讓角色較早看到市場事實。

前台名稱 **Pro** 對應內部穩定 `planKey = "subscriber"`。Client、分析事件與客服畫面不得自行建立 `pro`、`premium` 等第二套 plan key。

`resident_introduction` 與 `scene_authorship` 的週期固定為 `Asia/Taipei` ISO calendar week：週一 00:00:00 start-inclusive、下一週一 00:00:00 end-exclusive。Server 發布同一個 `windowId`、`startsAt`、`endsAt` 給兩種 quota，client 不自行算週界。額度只依 `CommandAdmissionReceiptBodyV1.commandAcceptedAt` 所屬 window 扣除，不依 client 送出、domain accepted、排程或完成時間；跨週 pending command、重送與延後執行仍只消耗 receipt 固定的原 window 一次。Billing renewal day 不影響 quota window。

跨 owner 的 reject／cancel／terminal failure 回傳 `quotaReleaseState: NOT_APPLICABLE | PENDING | RELEASED`。只有 Identity 的 `QuotaReservationReleased` 能把 PENDING 變 RELEASED；Origin／World 的失敗事件、client success callback 或 timeout 不能先恢復可用數。Reconciler 以 command ID、window ID、reservation ID、admission body digest、已提交的 reservation event ref 與 release-request digest 去重；event ref 是 receipt 外的 canonical provenance，不參與 body digest。

### 12.2 Price catalog and billing boundary

價格與 SKU 由簽章後的 versioned catalog 提供，React 不寫死：

```ts
type PriceCatalogEntry = {
  planKey: "subscriber";
  market: string;
  channel: "web" | "app_store";
  currency: string;
  cadence: "month" | "year";
  displayAmountMinor: number;
  skuRef: string;
  taxMode: "inclusive";
  effectiveFrom: string;
  effectiveUntil: string | null;
  policyRevision: string;
};
```

初始台灣 Web catalog 為月繳 NT$329、年繳 NT$2,790。App Store 可使用最接近的合法價格級距，以商店驗證後價格為準；channel 間權益相同。catalog 版本、使用者同意時看到的總價、receipt／webhook reference 與 entitlement transition 都要保存，不保存卡號或完整商店憑證。

30 日免廣告只對 registered account 由 `accountCreatedAt` 與 ad policy 計算，不產生 trial entitlement、不要求付款方式，也不會自動轉成 `subscriber`。Anonymous policy 不猜 account age：第一個完整故事免廣告，之後只在自然換場顯示；建立帳號後另起 30 日。Beta 只回 `beta_full_access`；price catalog 可供方案研究畫面讀取，但 checkout、receipt validation、renewal、refund 與 store SDK adapters 全部 disabled。

正式扣款時，只有 server 驗證成功、具 idempotency key 的 receipt／webhook transition 能簽發或撤銷 entitlement。Client 回傳成功畫面、廣告 callback、模型輸出與角色事件都不能改 plan。付款 pending 時保留原權益；grace、退款、到期與恢復走可重播 state machine。

方案固定為單一 Pro，不支援週繳、終身、代幣、次數加購、模型 tier 或紙上資源加購。V5 禁止價格 A/B、quota A/B 或權益 A/B；月繳 NT$329、年繳 NT$2,790、每週五次引介與三次有限編導是 qualification 的固定輸入。任何未來變更都必須另建 founder ADR，明確推翻 V5，並重跑價格、權益、capacity、轉換研究與長尾成本 gate。

場景創作只接受三種 typed intent：

1. `ARRANGE_ENCOUNTER`：兩名已引介居民與一個合格公共地點。
2. `PLACE_SEALED_PUBLIC_MATERIAL`：一份已封存公開材料與一名居民可接觸的環境。
3. `LEAVE_CANDIDATE_QUESTION`：`question_template_id` 加 allowlisted categorical slots；只能選生活主題、已封存公開 material ref 與政策允許時間範圍。

`LEAVE_CANDIDATE_QUESTION` 沒有自由文字欄；Viewer Library 私人札記不能成為 slot、prompt 或 canonical payload。World canonical payload 使用 discriminated union：

```ts
type SceneSeedArtifactV1 = {
  artifactVersion: "scene-seed-artifact/v1";
  sceneSeedId: string;
  intentType:
    | "ARRANGE_ENCOUNTER"
    | "PLACE_SEALED_PUBLIC_MATERIAL"
    | "LEAVE_CANDIDATE_QUESTION";
  truthClass: "simulated_narrative";
  domainAcceptedAt: string;
  quotaWindowId: string;
  sourceCommandDigest: string;
  authorizationReceiptDigest: string; // 不含 subject／account ID
  policyRevision: string;
  schedulerPolicyRevision: string;
  deadlineAt: string;
  deterministicSeed: string;
  payload:
    | {
        kind: "encounter";
        characterIds: [string, string];
        publicLocationId: string;
      }
    | {
        kind: "material";
        characterId: string;
        factManifestId: string;
        factRevisionId: string;
        presentationChannel: string;
      }
    | {
        kind: "question";
        characterId: string;
        questionTemplateId: string;
        templateRevision: string;
        slotSchemaRevision: string;
        normalizedCategoricalSlots: Array<{
          slotKey: string;
          valueKey: string;
        }>;
        sealedMaterialRef?: string;
        allowedTimeRangeKey: string;
      };
  payloadDigest: string;
};
```

`normalizedCategoricalSlots` 依 `questionTemplateId + templateRevision` 宣告的 slot order 封存；validator 拒絕 duplicate、unknown、missing required slot 或同一 slot 的第二個值。Template 升版若改順序，舊 artifact 仍按舊 revision 重播，不能依 JavaScript object iteration 或資料庫回傳順序計 digest。

`SceneSeedValidated` 使用下列 body，再依 §5.3 包成
`SceneSeedValidatedReceiptV1 = CrossContextReceiptEnvelopeV1<SceneSeedValidatedReceiptBodyV1>`：

```ts
type SceneSeedValidatedReceiptBodyV1 = {
  sceneSeedId: string;
  normalizedPayloadBodyDigest: string;
  commandAdmissionBodyDigest: string;
  quotaWindowId: string;
  policyRevisionSetDigest: string;
  templateRevision: string | null;
  rightsSnapshotDigest: string;
  deadlineAt: string;
};
```

Artifact 與 receipt body 都不保存自由文字、私人札記、帳號 ID、引介人顯示名、
使用者人格資料、自己的 digest／signature 或 event provenance。Identity 先以
`CommandAdmissionReceiptV1` 封存唯一 `commandAcceptedAt`、quota window 與
reservation；World 的 `SceneSeedRequested` 必須引用 admission body digest，
不能自行接收一個沒有 quota admission 的 stream。`SceneSeedValidated` 再封存
不含 `domainAcceptedAt` 的 `ValidatedSceneSeedPayloadV1` exact bytes 與上述
receipt envelope；它不能進 scheduler 或 cognition。

Validated receipt 不用 wall-clock expiry；deadline 是 domain accepted 後的世界排程期限，不是 quota acknowledgement 的競態開關。Identity 核對 validated envelope signature／body digest 及原 admission body digest 後寫 `QuotaConsumed`。收到同 seed／window 的 acknowledgement 後，World 只能核對 refs 並 idempotently finalize：`SceneSeedAccepted` 把 exact normalized bytes 加上 server `domainAcceptedAt` 與非識別 authorization receipt，封存成第一份 schema-valid `SceneSeedArtifactV1`。`domainAcceptedAt` 永不參與 quota 或 authoring-window 判定。這一步不得再跑會 reject 的 moderation、rights、deadline 或 policy validation。後來的 template、policy、moderation 或 model 更新不得改 artifact。

SceneSeed 與 Identity quota 跨資料庫，不假裝 atomic：

```text
Identity: CommandAdmissionReceiptV1 + QuotaReserved
→ World: SceneSeedRequested (same admission body digest)
→ VALIDATING
→ SceneSeedValidated + sealed normalized payload
→ Identity QuotaConsumed acknowledgement
→ SceneSeedAccepted + immutable artifact
→ DEFERRED | SCHEDULED
→ PRESENTED
→ OBSERVED | IGNORED
```

其他終局路徑：

```text
VALIDATING → REJECTED               // release quota reservation
ACCEPTED | DEFERRED | SCHEDULED → EXPIRED
ACCEPTED | DEFERRED | SCHEDULED → VOIDED
ACCEPTED | DEFERRED | SCHEDULED → WITHDRAWN
```

`SceneSeedAccepted` 只在 World 已驗證 Identity 的同一 seed／window `QuotaConsumed` acknowledgement 後寫入；Identity lost acknowledgement 由 reconciler 修復，World 在此前維持 validated-but-inert。政策拒絕若發生在 validation 階段不扣：World 寫 `SceneSeedRejected` 的同一 transaction 也寫 quota-release-request outbox，Identity 寫 `QuotaReservationReleased` acknowledgement；API 在 ack 前回 `quotaReleaseState = PENDING`，名額仍保留，lost request／ack 由 reconciler 修復。Validation 後的技術問題只讓命令 pending，不算失敗。

一旦 `QuotaConsumed`，後續 worker／網路問題只有 retry，不能再轉 `REJECTED`。若 rights revoke、deadline 或新 policy 在 consume 後到達，World 仍先 finalize `ACCEPTED`，再依新事件寫 `VOIDED`／`EXPIRED`，且算一次。Accepted 後的 deferred、expired、voided 或 user-withdrawn 都算一次，避免看完排程狀態再重抽。`SceneSeedWithdrawn` 只允許在 `Presented` 前；一旦任何角色可能接觸，使用者不能倒帶。帳號刪除在 presented 前 void seed；presented 後只刪 authorization mapping 與私人資料，非識別 artifact 及其既成後果留在正史。

World 只在 `VALIDATING` 階段可以拒絕；`SceneSeedAccepted` 之後不可再進 `REJECTED`，只能依既定 graph 排程、延後、到期、作廢或在呈現前撤回。角色自己的忽略、誤解、延後或拒絕是世界內行為，不是 World 對已扣 quota seed 的政策拒絕。Intent 不能指定公司方向、紙上交易、情緒、記憶、關係數值、答案或結果。只有 `SceneSeedPresented` 建立一個正常世界條件；只有後續 eligibility／attention 事件能證明角色看見，artifact 本身不能直接 patch cognition。

SceneSeed 的 replay 不重新跑 moderation、選模板、換材料或找較好的場景：

- `ARRANGE_ENCOUNTER` 保存兩名居民、使用者所選且已驗證的公共地點、期限、scheduler policy 與 deterministic seed；期限內無合法窗口就 expire。
- `PLACE_SEALED_PUBLIC_MATERIAL` 保存 manifest／revision ref；呈現前被撤權或更正就 void，不偷偷換另一份材料。
- `LEAVE_CANDIDATE_QUESTION` 保存 template／slot bytes；呈現只建立 candidate attention item，不保證被看見或採用。
- Deferred seed 保留原 accepted quota window 與 payload digest；retry 使用相同 idempotency key。
- Encounter 重播使用原 public location、participants、deadline、scheduler policy 與 deterministic seed；不挑一個更有戲的相遇時段。
- Material 或 question 只有在 Cognition 的 `ObservedClueRegistered` 引用同一 `SceneSeedPresented` 時才成為角色輸入。Cognition 以 outbox 發出帶 source event ref 的 typed `AcknowledgeSceneSeedObservation` command；World 驗證 seed、target、source event 與 current state 後，以 idempotency key／stream CAS 寫自己的 canonical `SceneSeedObserved` lifecycle acknowledgement。它不複製 clue 內容，也不由 projection worker 回寫 canonical stream。
- Observed／ignored／expired／voided／withdrawn 都是終局事件，不能在看見角色反應後重跑。

### 12.3 State changes

```text
CONTROLLED_INTRODUCER
→ GRACE
→ PUBLIC_UNCONTROLLED
PUBLIC_UNCONTROLLED → RESTORE_PENDING → CONTROLLED_INTRODUCER
任何狀態 → DELETION_PENDING → DETACHED
```

失去訂閱只改引介權、場景額度、深層 archive 與廣告狀態；角色正史、公開人生與紙上承擔繼續。恢復權益不回檔、不重生、不重新配核心。

`QuotaLedger` 至少包含 `active_follow`、`individual_reminder`、`saved_clip`、`story_roll_create`、`resident_introduction` 與 `scene_authorship` 六個 policy key。Pro 到期時：

- 不刪除任何 follow、clip 或 story roll record。
- 超額 follows 全部保留可讀，狀態改為 `selection_pending`；所有 individual reminders 暫停。
- 使用者明確選出最多三名後才標成 Free active，系統不得依績效、最近報酬或模型自動選；其中最多一人可啟用每日彙整。
- 超過十段的 clips 與所有既有 story rolls 保留唯讀；使用者降到上限前不能新增。
- 恢復 `subscriber` 時按原 record 恢復，不補發失訂期間通知。

### 12.4 Ad isolation

- Beta 的 ad adapter 永遠回 `NO_AD`.
- Anonymous 第一段完整故事與 registered Free 的 account day 0–29 永遠回 `NO_AD`；這兩者是 ad policy，不是 trial plan。
- 正式廣告只取得 placement ID、語系、粗粒度 content rating 與 consent；不得取得 ticker、持股、損益、角色心理、記憶或關係。
- Ad slots 只存在於章節自然斷點，不插進跟拍手勢、角色脆弱片段或 canonical command confirmation。初始 policy 為 45–90 秒節目間長版廣告、每次使用最多兩個自然換場。
- Ad callback 不簽發 chapter、archive 或臨時 visibility grant，不新增 audience scope，也不能改 entitlement。Free 永遠維持 `public_current + free_archive`；完整可發布歷史只有 `subscriber_archive`。
- Ad service 故障時直接無廣告，不阻塞故事。
- 所有 ad impression／completion 都不能成為 gameplay event causation source。

---

## 13. Privacy and security

### 13.1 Data classes

| Class | Examples | Storage |
| --- | --- | --- |
| `public_fact` | sealed market fact、source metadata | evidence mirror／public projection |
| `fictional_canonical` | character state、paper ledger、relationship、memory refs | encrypted world cell |
| `fictional_restricted` | 未發布 memory candidate、內部 needs／utility、隱藏 scene、moderation artifact | restricted projection with separate key；不對任何觀眾開放 |
| `account_pii` | login subject、email、consent | identity DB only |
| `creator_private_source` | 使用者場景草稿、私人收藏、未發布輸入 | user-scoped encrypted store |
| `public_media` | 已核准角色圖、chapter card、動畫 layer | public asset bucket |
| `security_audit` | access／approval／withdrawal records | WORM audit store |

Account PII、私人筆記、creator source 不得進角色 prompt、世界 canonical event、公共 projection 或一般 analytics。公開角色 ID 與 account subject 使用不同 namespace；public API 無法由角色反查引介人。

### 13.2 Threat controls

| Threat | Required control |
| --- | --- |
| 偽造／竄改市場包 | signed manifest、content hash、revision chain、rights/time gate、immutable mirror |
| Fact text prompt injection | structured field allowlist、text quarantine、tool-free model sandbox、output schema |
| Model 越權 | model gateway 無 canonical DB credential；所有輸出經 Rust validator |
| Future leakage | physical field exclusion、cutoff property tests、manifest binding、no free network |
| IDOR／跨帳號資料 | audience-bound short token、RBAC + ABAC、object-level authorization |
| Projection 復活已撤內容 | visibility epoch registry、edge purge、old-epoch reject |
| Admin 手改人生／帳本 | typed commands、two-person approval、WORM audit；禁 direct UPDATE |
| Supply-chain compromise | locked dependencies、SBOM、artifact signature、secret scanning、reproducible build |
| XSS／malicious UGC | no raw HTML、server sanitization、CSP、trusted asset domains |
| Scraping／abuse | WAF、rate limits、cursor bounds、behavioral abuse detection、opaque IDs |
| Ad／analytics data leakage | separate consent and credentials、strict event allowlists、no financial or mental-state payload |

Secrets只由 runtime secret store 注入；不進 repo、log、event payload、model artifact 或 public docs。Service-to-service 使用 mTLS／workload identity及最小 DB role。

### 13.3 Export and deletion

Export／deletion 是 product flow：

1. Identity local transaction 寫 `AccountDeletionRequested`、deletion job 與帶 request digest 的 privacy-fence-request outbox。
2. Privacy／Visibility 在自己的 local transaction 驗證 request，寫 `SubjectLifecycleFenceAdvanced`、`VisibilityEpochAdvanced` 與 acknowledgement outbox；Identity 只能記錄 ack，不能代寫這兩個事件。
3. 取消 pending scene authorship、private notification、introducer deadlines。
4. 公共角色若完全由合成資料構成，可依事前同意保留為無引介人的虛構正史；所有 account link、creator-private source、私人收藏與未發布輸入 crypto-shred。
5. 若角色含必須刪除的 user-derived public element，先以 typed redaction／replacement event 撤下，再保留 non-identifying audit skeleton。
6. Public DB、search、cache、media 先受 epoch fence 阻擋，再非同步 purge。
7. Privacy、Viewer Library 與 media purge 各回不可變 receipt；Identity 收齊同一 deletion request digest 的 receipts 後才寫 `AccountDeletionCompleted`。Lost request／ack 由 reconciler 重送，不以 timeout 假裝完成。

刪帳與失訂是兩個完全不同的狀態機。

---

## 14. Retention and backup

Retention 由 `retention_class + rights_scope + data_class` 共同決定。初始 policy：

| Data | Initial retention |
| --- | --- |
| Canonical fictional world、paper ledger、relationship、story publication events | 世界存續期間永久；只以新事件修正 |
| Sealed market artifacts | 依 rights manifest；不足以支撐完整 replay 時不得 ingest 成 canonical input |
| Normalized model appraisal、exact version refs | 與其造成的 canonical history 同期 |
| Raw model input／output blobs | encrypted 400 days；若是 replay 必要且 rights 允許則 content-addressed archive 延長 |
| Public projections | 可重建；withdraw 後 edge block 立即、primary purge 24 小時內 |
| Account PII／creator-private source | active life；deletion fence 後 30 日內 crypto-shred |
| Raw product analytics | 90 days |
| Aggregated non-identifying product metrics | 13 months |
| Operational logs | 30 days |
| Security／admin／decryption audit | WORM 400 days minimum |
| PostgreSQL PITR | 35 days |
| Monthly encrypted canonical backup | 12 months；restore qualification 每季 |

若法律、契約或使用者刪除義務要求更短時間，以更短者為準；canonical event 可保留不可還原的 pseudonymous skeleton、digest 和 deletion receipt，不保留可還原 subject data。

`CanonicalDurabilitySetV1` 固定包含 canonical event store、command journal、與 canonical event 同一 transaction 建立的 outbox pointer，以及已被 canonical event 引用且無法重新產生的 sealed source asset。這組資料在 AZ 與 region failure 都是 RPO 0；canonical command 只有在本區 quorum durable write 與跨區 lossless durable record 都成功後才能 ACK。跨區 durability 不可用時，canonical mutation fail closed；公共讀取可以用帶有 source position／stale 標記的既有投影繼續。

Failover target 在升為 writer 前，必須證明 WAL／global position／event hash chain 無缺口，command journal 可重建 idempotency，且 outbox pointer 與 canonical transaction 一一完整；任何一項無法證明就維持 stale read-only，不能接受 canonical write。RPO ≤5 分鐘只適用於能從 `CanonicalDurabilitySetV1` 重建的 public projection、search、cache 與 derivative media。未通過 region-loss restore drill 前，不得宣稱 regional SLO 已達成。

---

## 15. Physical topology and scale path

### 15.1 Beta

- `identity-api`
- `evidence-gateway`
- `world-core`
- `model-runner`
- `projection-worker`
- `public-api`
- Identity／PII PostgreSQL HA
- Current-world private canonical PostgreSQL HA
- Public projection PostgreSQL HA
- content、model-artifact、public-media、audit 分離 object roots／keys
- PostgreSQL outbox／inbox，不先部署 broker 或 Kubernetes
- CDN／WAF 保護 `world` public reads

Beta 雖然部署較少，但 event envelope、logical cell、ownership epoch、visibility epoch、model revision與 migration contract 必須使用最終資料形狀。

### 15.2 Scale triggers

| Trigger | Action |
| --- | --- |
| 2× peak 下 outbox p99 lag >10s，或 queue workload 持續占 private DB >20% I/O／CPU | 導入獨立 event transport，只替換 fan-out |
| 單 cell 在 2× peak 無法通過 25,000 active characters qualification | 依 community／scene boundary 增加 world cells |
| Public read DB p95 超標且 cache hit 已最佳化 | 依 scene/date 分 projection shard |
| Relationship mailbox p99 >60s | 調整 cell placement，把高頻 dyads 共置 |
| Search 索引超過 PostgreSQL FTS qualification | 引入獨立 public search，仍由 projection rebuild |
| Model queue 無法在 story deadline 前消化 | shared extraction、micro-batching、activity tier、capacity scaling；不減弱 cutoff |

`logical_cell_directory`：

```text
character_id
logical_cell_id
ownership_epoch
migration_state
physical_endpoint_ref
```

遷移只在沒有 open cognition、pending fill、relationship settlement、correction 或 deletion hold 的 world boundary：

```text
ACTIVE_SOURCE
→ FREEZE_REQUESTED
→ FROZEN
→ COPIED
→ REPLAY_VERIFIED
→ ACTIVE_TARGET(epoch + 1)
→ SOURCE_TOMBSTONED
```

Target 第一筆 canonical write 後不能 rollback，只能另做受控反向遷移。

### 15.3 Large-world projection

公共世界不是把全部角色傳給一台手機。API 先傳 viewport／scene 的 active set、邊緣 silhouettes 與 story hooks；角色近景再按需讀詳細 projection。Media assets用 atlas／layer bundles、responsive image、signed version URL 與 deterministic fallback。場景更新採 delta + checkpoint，避免長連線缺包後狀態漂移。

---

## 16. SLO and observability

### 16.1 SLO targets

| Metric | Target |
| --- | ---: |
| Public read API availability | 99.95%／30-day |
| Authenticated command API availability | 99.95%／30-day |
| `GET /api/v2/world` p95 | <300 ms |
| Character close-up／life-journal p95 | <350 ms |
| Command receipt p95 | <250 ms |
| Verified manifest received → mirrored p99 | <60 s |
| `FactBecameVisible` → eligible cognition scheduled p99 | <90 s |
| Valid model appraisal or fallback after schedule p99 | <120 s |
| Canonical event → public projection p99 | <30 s |
| Canonical source set → rich story chapter p95 | <5 min |
| Paper reference price fact → mark projection p99 | <60 s |
| Visibility withdrawal edge block p99 | <60 s |
| Public primary/search/cache purge | <24 h |
| Canonical event loss | 0 |
| Full replay divergence | 0 |
| Duplicate paper fill | 0 |
| AZ failure | RPO 0, RTO ≤15 min |
| `CanonicalDurabilitySetV1`, region failure | RPO 0；continuity proof 通過後 RTO ≤4 h |
| Rebuildable projection／search／cache／derivative media | RPO ≤5 min；canonical recovery 後 RTO ≤4 h |

Model或 story renderer SLO 未達不能拖垮公共世界：角色可進 deterministic fallback、`NO_ACTION`、silent observable action 或 structured chapter。

### 16.2 Metrics

至少監控：

- manifest accept／quarantine／rights deny／revision gap。
- fact-to-world lag、world tick lag、deadline age。
- cognition queue age、schema reject、fallback rate、snapshot skew、core-specific drift。
- action intent、order reject、fill delay、ledger imbalance、mark stale、correction age。
- relationship mailbox lag、memory mutation conflicts。
- projection lag、SSE reconnect gap、chapter publish／fallback／withdraw。
- entitlement deny、quota conflict、ad null／error。
- visibility epoch reject、privacy purge age、unauthorized access。
- stream CAS conflict、outbox lag、replay divergence、cell epoch conflict。

Trace 使用 opaque `correlation_id` 串接 fact → cognition → action → outcome → story，不把 fact text、prompt、memory、position或 PII 放入 span attribute。每次 model run 有 `model_run_id`，只記版本、latency、token counts、validation outcome 與 digest。

Alert 以使用者可見後果分級：

- P0：event loss、double fill、future leakage、visibility resurrection、cross-account read。
- P1：world tick stopped、rights revoke not enforced、ledger imbalance、replay divergence。
- P2：projection lag、model fallback spike、story renderer failure、SSE instability。

---

## 17. Failure semantics

| Failure | Required behavior |
| --- | --- |
| Manifest missing／late | 保留上一個有效世界、標 `STALE`；受影響的新 cognition 不開啟 |
| Manifest hash／signature／schema invalid | quarantine、告警；絕不寬鬆 parse |
| Conflicting fact revisions | affected symbol/session `HELD`，等 authoritative supersedes chain |
| Correction before cognition seal | 重建尚未 seal input；舊 pack 不可 bind |
| Correction after seal | 保留原 decision knowledge，追加 correction 世界事件與 accounting patch |
| Cognition model timeout／transport failure | 相同 request 最多一次 transport retry；再失敗走不含 prose 的固定 appraisal fallback |
| Cognition model schema invalid／輸出文字 | 保存 invalid digest、直接 deterministic appraisal fallback；不重抽 |
| Utterance candidate invalid／unsafe | verifier 只 reject；走同版本 deterministic utterance fallback，無安全句就 `NO_UTTERANCE` |
| Duplicate／late utterance result | unique constraint 與 CAS 只讓一個 terminal artifact 勝出；late model result 不覆蓋已封存 fallback |
| Utterance atomic write crash | artifact、sealing event、hash 與 outbox 全部 rollback；不得出現孤兒原話或有 claim 無 artifact |
| Late cognition model result | snapshot／session version 不符即拒絕，不覆蓋 fallback 或新 state |
| Paper fill fact absent | order 等到 expiry 後失效，不用事後價格補成交 |
| Insufficient paper cash／position | action intent 與 `PaperOrderRejected` 原子提交，成為人物後果 |
| Story generation failure | 發不含第一人稱補話的 typed evidence card；既有 artifact 仍逐字引用，canonical world 繼續 |
| Projection lag | 回 stale checkpoint + source position；client 不猜新 state |
| Utterance artifact projection missing／hash mismatch | 移除整個 `character_claim` segment、告警並重建 projection；不得由 renderer 補一句 |
| Entitlement service unavailable | 公共 free read 繼續；mutation 只接受未過期 signed claim，否則 fail closed |
| Ad service unavailable | no ad；不阻塞章節 |
| Public asset missing | 使用已核准靜態角色 fallback，不生成臨時陌生人 |
| Cell migration conflict | 舊 ownership epoch 全拒絕；router 重新抓 directory，不雙寫 |
| Rights revoke | 停新使用、提升 visibility epoch、edge block、typed withdrawal |
| Region failure | 只有在 WAL／global position／event hash chain 零缺口，command journal idempotency 與 outbox completeness 都通過 continuity proof 後，target 才能升為 writer；否則維持 stale read-only，拒絕全部 canonical write |

「重試直到產生更好角色行動」永遠不是 recovery。

---

## 18. Existing contracts：reuse vs replace

### 18.1 Reuse as production foundations

| Existing asset | Decision | Required adaptation |
| --- | --- | --- |
| `crates/event-store` append batch、CAS、dedupe、hash chain、outbox | **保留** | generalized `ModeDomain`、V2 envelope、world session及 multi-stream story events |
| SQL migration的 dedicated append function／writer-role denial | **保留** | 新 stream types 與 retention／partition qualification |
| `contracts/proto/.../envelope.proto` 基本欄位 | **保留設計，升 major** | truth class、revision set、world session、fact revision list |
| deterministic Protobuf bytes、domain tag digest、golden parity | **完整保留** | 增加 world／character／portfolio fixtures |
| `decision-kernel` fixed-point primitives、exact ranking approach | **保留 primitives** | 拆除五席 input，重建單角色 action candidates 與 portfolio constraints |
| `crates/scoring` 的 fixed-point implementation technique | **保留技術，不保留賽制** | 改為 paper ledger／behavior policy；舊 DP／Coverage 不進 V5 |
| `contracts/sealed-facts/v1` JCS hash、fact ID、supersedes | **保留 atomic fact format** | 新增 manifest、signature、rights、三種時間、finality |
| OpenAPI handwritten source → generated TS client | **保留 workflow** | 建立 public `/api/v2/world`、character、journal、portfolio、story APIs 與 `/events/v2/world` SSE；edge 再映射 internal router |
| logical cell、ownership epoch、visibility epoch、typed deletion | **保留** | ownership unit 改為 character／world cell，不是五人 crew |
| Rust 2024／WASI replay／simulator／loadgen | **保留** | 新增 story-chain replay 與 paper accounting simulator |

### 18.2 Reuse only as presentation primitives

| Existing asset | Decision |
| --- | --- |
| `apps/web/src/interaction.ts` world-space hit testing | 保留為跟拍／handoff primitive，加 pointer／keyboard／screen-reader tests |
| V4 follow-camera gesture and focus state | 保留互動語法，改讀 server characters；不再是唯一產品 |
| V4 layered scene／resident atlas pipeline | 保留 asset workflow；角色 identity、motion layer與 projection binding重做 |
| V4 study recorder／fixed-device route | 移入 research-only boundary；不可當 production analytics 或 product root |
| V4 visual tokens | 可抽成 design tokens；不保留人物扁平同質與只有一個開盤廳的限制 |

### 18.3 Replace or archive

| Existing asset | Decision | Reason |
| --- | --- | --- |
| `RoundDesk`, `SeatPlan`, five fixed `SeatId` | **archive** | V2 五席玩法不是 V5 canonical domain |
| `DecisionSession` five-seat batch | **replace** | V5 需要 per-character cognition、paper action 與 persistent life |
| `decision-v1.json` four-companies／five-seat policy | **archive fixture** | 不能限制 V5 action space |
| `crates/scoring` DP／Coverage／ranking | **archive** | V5 無正式績效競賽或全服榜 |
| `/v1/rounds`, seat preview／seal APIs | **sunset** | 新 client 不再以排席為 root |
| `scene.ts` hard-coded 16 residents、3 tickers、lines | **replace** | 正式場景必須讀 projection，不能播放固定劇本 |
| App 的 0–599 秒循環與 V4 fixed timeline | **replace** | 世界時間與事件由 server canonical ticks 推進 |
| `StudyRoot`／「受控研究階段」作為 public landing | **remove from production route** | 研究入口不是產品首頁 |
| V4「永遠不出現角色詳情／持股／績效」禁令 | **rejected** | 角色人生誌、紙上持股與承擔紀錄是 V5 核心 |
| V2 `Crew`、season／division／leaderboard ownership | **do not migrate** | 技術概念可參考，資料語義不相容 |

現有 historical `input.pb`／`output.pb` 留在 `fixtures/legacy-v2` 類別供回歸舊 append／decoder，不轉成 V5 人物歷史。

---

## 19. Migration plan

### Phase 0 — Freeze and classify

- 把 V2／V4 event、API、UI、study data 標成 `legacy-v2`／`research-v4`。
- 更新 repository router，禁止新功能 import `RoundDesk`／`SeatPlan`。
- 保留既有公開研究部署，直到 V5 production route 通過 smoke；不把其 runtime DB 當 canonical seed。

### Phase 1 — New contracts beside old contracts

- 新增 `common.v2`, `world.v1`, `character.v1`, `portfolio.v1`, `story.v1` Protobuf。
- 新增 `WorldFactManifestV1` schema 和 consumer fixtures。
- 新建 `/v2` OpenAPI，不在 `/v1` 偷改語義。
- 寫 machine-readable command owner／transition map。

### Phase 2 — One-character vertical slice

用完全合成 fixture 跑通：

```text
fact accepted
→ world exposure
→ observed clue
→ appraisal/fallback
→ paper action
→ fill
→ outcome
→ memory update
→ story chapter
→ close-up/life-journal/portfolio APIs
```

同一 fixture需 native／WASI／PostgreSQL replay byte parity，並可由零 read model rebuild。

### Phase 3 — Multi-character world

- RelationshipDyad、encounter mailbox、scene scheduler。
- 50 名角色先在三個場景完成 runtime qualification 與跨交易日持續狀態；這不是封測場景上限。
- V4 跟拍手勢改接 public `/api/v2/world` 與 `/events/v2/world` SSE。
- 建立角色近景、人生誌、深層檔案與紙上持股。

### Phase 4 — Identity and beta

- `beta_full_access`、5／week quota、scene-seed policy。
- Export、deletion、visibility withdrawal。
- 補齊並驗收六個正式封測場景後才開放受測者。
- 關閉 public study root；V5 world 成為 canonical root。
- 封測仍不接 payment／ads。

### Phase 5 — Scale and commercial adapters

- 通過 load、restore、privacy、rights、model drift 與 signal-confusion gates後才開外部 beta。
- Payment、ad、30-day intro 只接既有 entitlement／ad interfaces，不更動 Character／Paper／Story contexts。
- 依量測門檻才引入 broker、projection shards與多 cells。

Legacy data migration原則：**只遷移可證明來源、schema與權利的 sealed facts及已核准視覺資產；不把研究行為、固定台詞、假居民 state或五席結果偽裝成 V5 正史。**

---

## 20. Test and release gates

### 20.1 Contract and replay

- Protobuf canonical bytes、decode／re-encode equality、hash domain tags。
- OpenAPI lint、generated-client diff、consumer conformance。
- Command owner／event owner／payload map completeness audit；CI 解析 [`contracts/canonical-owner-map.yaml`](./contracts/canonical-owner-map.yaml)，拒絕 duplicate event owner、未知 aggregate 或 projection 回寫。
- Native／WASI／PostgreSQL golden parity。
- Full event replay divergence = 0；projection rebuild digest相同。
- Previous major upcaster fixtures與 expand／migrate／contract rehearsal。

### 20.2 Market time and rights

- future fact field physical exclusion。
- `world_published_at`／`platform_received_at`／cutoff property tests。
- `interactionFactRevisionIds` 與 `outcomeEvidenceRevisionIds` schema、storage、credentials 與 fixtures 物理隔離；較晚 evidence cutoff 對已 seal cognition／action 的差異率固定為 0。
- correction before／after seal、rights expiry／revoke、holiday、停牌、晚 finality。
- hash、signature、revision gap、unsupported major failure injection。
- model free-network denial與 fact-text prompt injection suite。

### 20.3 Character and model

- 相同 snapshot＋seed＋policy＋stored appraisal 必須得到相同 action。
- 純敘事改寫造成 canonical action差異率 = 0。
- personality、motif、memory、emotion、relationship 各自有有界反事實 exposure。
- 不同 core 的差異來自 contract descriptors，不是 prompt name。
- invalid schema、timeout、late result、duplicate result 只走一條固定 fallback path。
- Cognition／fallback schema fuzz 注入 `text`、`quote`、`claim: string`、communication intent 或 prose 必須拒絕。
- `SealUtterance` 對 artifact insert、sealing event、outbox 做 crash injection；只能全部存在或全部不存在。
- 兩個 runner、duplicate callback、late result 與 fallback 競態，同一 `(semanticSpeechActEventId, surfaceKind)` 只能留下單一 artifact。
- Verifier output type 不含文字；unsafe／source mismatch 只能 reject，不能修改候選。
- real-person similarity、minor prevention、distribution drift與unsafe-origin tests。
- Voice profile 的成人、權利、真人聲紋相似與身份連續性 gate；不合格不得進 `CharacterAssetPackQualified`。
- Audio rendition 的 source artifact／text hash equality、caption UTF-8 byte coverage、voice／capability revision、content hash、text-only failure、rights revoke 與 visibility-epoch purge fixtures。

### 20.4 Paper accounting

- double-entry conservation、cash reservation、lots、fees、corporate action、partial fill／expiry。
- 同一 order 不得重複 fill。
- decision 之後的第一個合格 sealed price property test。
- correction inverse／forward patch、stale marks、停牌、零量、market holiday。
- 大量 randomized ledger replay後 balance digest一致。

### 20.5 Story and「韭菜樣」

- 每個 chapter segment 有 truth class與source refs。
- `character_claim` 不可變成 `real_fact`，也沒有自由 `text` 欄。
- World、close-up、journal、archive、search、share、notification、video、caption 與 screen reader 對同一 quote 的 artifact ID／hash／canonical bytes 完全一致。
- 改 story prompt、model、chapter version、版型或字幕 renderer 不得改 quote；刻意要求「把台詞寫得更性感」時 schema 仍無法輸出台詞。
- Market fence 只能整筆 withhold artifact；neutral replacement 必須是無引號 narrator segment，finality 後仍使用原 artifact。
- Chapter supersede、correction、clarification、retraction 與 replay 不改舊 artifact；只能沿用、隱藏或追加有連結的新 artifact。
- original rationale／current claim／holding result可從event chain重建。
- 獲利、虧損、不成交、認錯、繼續凹單都有章節 fixtures，不能只挑好看結果。
- behavior marker需滿足 typed evidence；移除一項證據後不可仍斷言相同 pattern。
- Story renderer failure必須產生structured fallback。
- `DailyMomentsEdition` 接受 0–5 cardinality；不得重複 chapter、越過 finality／rights fence、由 client 重排或因撤一幕自動補入未核准候選。
- Search／home API不存在按績效、模型或「菜度」排序。

### 20.6 Security and privacy

- IDOR、cross-account、JWT audience、ABAC、rate-limit、CSP、UGC fuzz。
- Follow／clip／reminder／story-roll quota、owner scope、source withdrawal、公開分享審核與 `selection_pending` 降級 fixtures。
- Model runner無canonical writer credential。
- Direct DB writes由role／function boundary拒絕。
- Visibility epoch亂序、cache resurrection、search purge、media purge。
- Export completeness、deletion fence、crypto-shred、backup expiry。
- Dependency／container／SBOM／secret scan。

### 20.7 UX and accessibility

- 世界 → 跟拍 → 近景 → 人生誌 → 深層檔案路徑端到端。
- 首訪在「當下無新事件」「居民無歷史」「只有過去已完成章節」三種 fixture 都不新增 canonical event；90 秒成功只驗證看懂當下與抵達近景，不要求即時交易或矛盾。
- `viewMode = REPLAY` 顯示原發生時間，離開後回 current checkpoint；觀看、收藏與追蹤不能回寫歷史 cognition。
- 角色持股、損益、交易歷史與改口紀錄可找到，但不把首頁變 dashboard。
- pointer、touch、keyboard、switch control、screen reader產生同一 follow target。
- reduced-motion、200% text、narrow／wide、offline、stale、held、corrected、withdrawn。
- Visual regression包含可愛 2.5D 人物、不同體型／年齡／姿態與資產 fallback。

### 20.8 Capacity and operations

- 2× peak load：world read、SSE reconnect、cognition queue、paper mark、projection fan-out。
- 50 seed＋1,800 full-quota introductions 的 1,850 人 qualification：完整 origin／asset pack、life ticks、paper corporate actions、correction、relationship／memory eligibility 與熱門事件 fan-out。
- Day 31 全員失訂後，day 90／365 deterministic tail、五年現值與 terminal maintenance reserve；既有角色最低生命週期義務不得下降。
- Kill process、duplicate delivery、outbox stall、DB failover、object 404、model outage、rights revoke。
- Quarterly PITR／regional restore、full replay、cell migration／abort。
- SLO error-budget alert與runbook game day。

---

## 21. Definition of architecture-ready

只有以下項目全部完成，V5 才算可以從規格進正式 implementation：

1. V5 product、experience、character story、system、visual documents互相沒有 ownership或名詞衝突。
2. 新 command/event catalog、payload map、Protobuf與OpenAPI major完成，machine-readable canonical owner map 全域唯一。
3. `WorldFactManifestV1` 有上游 producer與本 repo consumer conformance fixtures。
4. 單角色 canonical story chain通過 byte-level replay。
5. Paper ledger通過 property tests與 correction fixtures。
6. ModelCore registry、Gemma 4 26B default、fallback及upgrade policy有可執行 contract。
7. 公共世界、角色近景、人生誌、深層檔案與portfolio projection schema固定。
8. Entitlement／ad interfaces存在，beta adapters明確 disabled。
9. Privacy lifecycle、visibility epoch、retention與restore rehearsal有測試證據。
10. `UtteranceArtifactV1` 原子封存、全通路 hash equality、visibility withhold 與 replay fixtures 全數通過。
11. `CharacterLifecyclePolicy`、1,850 人 qualification、全員失訂 day 90／365 tail 與長尾成本準備通過。
12. V2／V4 reuse／archive清單進code owners與CI boundary check，防止舊骨架重新滲回V5。

這個設計容許之後增加人物、場景、模型核心、語言、商業方案、projection shards與world cells；這些都只需要擴充 policy、adapter與容量，不需要重寫人物一生、紙上帳本或市場證據鏈。
