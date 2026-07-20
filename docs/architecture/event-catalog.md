# Canonical command and event catalog

_版本 1.3｜2026-07-20｜不得以「其他事件」省略第一版契約_

逐 command 的 owner、target、合法來源狀態與輸出事件，以機器可讀的 [command transition map](../../contracts/policy/command-transition-map.yaml) 為準；event payload 見 [Aggregate state and payload map](./state-payload-map.md)。任何新增 command 或 canonical event 必須在同一 change 通過 contract audit。

## Command envelope

```text
command_id: UUIDv7
command_type
command_owner
primary_target: {stream_type, stream_id}
preconditions[]: {stream_type, stream_id, expected_version}
logical_cell_id
ownership_epoch
idempotency_key
mode_domain
actor
deadline_at
payload
trace_id
```

`(command_owner, idempotency_key)` 必須唯一。所有 precondition 都要精確匹配；版本衝突回傳各 stream 的 canonical current version，client 必須重新取得 projection，不可覆蓋。

## Event envelope

```text
event_id: UUIDv7
event_type
schema_version
stream_type
stream_id
stream_version
logical_cell_id
ownership_epoch
mode_domain
command_id
causation_id
correlation_id
trace_id
actor
occurred_at
recorded_at
policy_revision
model_revision
fact_revision
engine_artifact_digest
rights_scope
data_class
visibility_epoch
payload_hash
previous_event_hash
payload
```

canonical event 與 outbox 在同一 PostgreSQL transaction 寫入。event 不 update、不 delete。Consumer 以 `(consumer_id, event_id)` inbox unique key 去重；broker 或 worker 的 at-least-once delivery 不得被誤當成 domain exactly-once。

Event store 與 outbox 保存同一份 deterministic Protobuf bytes；`payload_hash` 對原始 bytes 計算。Upcaster 只產生讀取 view，不得重寫舊 event 或改 hash chain。

## Immutable snapshots

Aggregate snapshot 每 100 events 或 stream payload 超過 512 KiB 時建立，可由 events 全數重建。以下四種不是 cache，永久不可變：

1. `DecisionInputSnapshot`
2. `RawModelSnapshot`
3. `NormalizedAppraisalSnapshot`
4. `SettlementSnapshot`

每一份都保存 payload digest、schema、policy、model、fact、normalizer、engine 與 rights revision。

## Required commands

### Governance／Content

```text
RegisterModeDomain
EnableModeDomain
SuspendModeDomain
ResumeModeDomain
RetireModeDomain
ApproveRightsManifest
RevokeRightsManifest
PublishPolicyBundle
RegisterModelAdapter
ApproveModelSnapshot
CreateEpisode
ApproveEpisode
SealEpisode
CreateSessionSchedule
ActivateSessionSchedule
ReviseSessionSchedule
RetireSessionSchedule
OpenContentSessionLedger
PositionFactRevisionForSession
PositionRightsRevisionForSession
SealUniverse
SealCalendar
SealFactPack
SealAppraisalUnit
BuildContradictionGraph
SealAppraisalPack
SealBenchmarkPack
IssuePackBindPermit
MarkArtifactPackStale
RevokeArtifactPack
PublishEpisode
SuspendEpisode
RevokeEpisode
PublishFactRevision
DeclareEpisodeSessionFinality
DeclareMarketSessionFinality
```

### Identity／Control

```text
GrantEntitlement
ExpireEntitlement
ScheduleControlRelease
ReleaseControl
ScheduleControlRestore
RestoreControl
RequestAccountExport
RequestAccountDeletion
SealPrivacyArchive
CompleteAccountDeletion
```

### Lifecycle／Visibility

```text
BeginCrewDeletion
ArchiveCrewLifecycle
AdvanceVisibilityEpoch
ReleaseControllerReveal
ReleasePublicReveal
WithdrawSubjectVisibility
```

### Desk／Crew

```text
OriginateCrew
CreateSeasonEntry
CreateRound
ReadyRound
OpenRound
DraftDossiers
SealDossiers
SaveSeatPlan
CarryForwardSeatPlan
SealSeatPlan
FreezeCrewSnapshot
EnterAutonomy
ExitAutonomy
RetireCharacter
```

### Competition／Public World

```text
CreateSeason
CommitSeasonSeed
OpenSeason
LockSeason
RevealSeasonSeed
CreateDivision
AddDivisionMember
LockDivisionRoster
ActivateDivision
SubmitDivisionScoreContribution
CloseDivision
PlanAutonomyRun
StartAutonomyRun
RequestCrewAutonomyAdvance
ApplyCrewAutonomyAdvance
CompleteAutonomyRun
CancelAutonomyRun
CreateCompetitionAdjudication
SupersedeDivisionContribution
CompleteContributionSupersession
CorrectDivisionStanding
CompleteDivisionStandingCorrections
CorrectSeasonStanding
CloseCompetitionAdjudication
```

### Decision／Score

```text
CreateDecisionSession
SealDecisionInput
BindAppraisalPack
RecordAppraisalFallback
SelectAttention
CommitPeerPackets
CommitActions
BindOpenPrice
BindClosePrice
VoidSeat
HoldSession
ReleaseSessionHold
CommitSessionSettlement
CarryRiskBrakeCorrection
RecordRiskBrakeNoActionSpace
ResettleSession
CorrectClosedSessionScore
VoidSession
BeginRoundFinalization
CloseRoundCausality
SettleRound
CloseRound
CloseSeason
PublishStandings
```

### Replay／Correction／Operations

```text
VerifyReplay
ComputeCounterfactual
ComputeAlternateCoreScenario
ScheduleDeadline
FireDeadline
CancelDeadline
ApplyCorrection
CreateAdjudicationEpoch
ApplyCrewCorrectionLearning
ApplyCrewAdjudicationLearning
CheckpointProjection
RequestCellMigration
FreezeCellBundle
ConfirmCellBundleFrozen
CopyCellBundle
VerifyCellBundle
CutOverCellOwnership
AbortCellMigration
TombstoneCellSource
```

## Required events

### Governance／Content

```text
ModeDomainRegistered
ModeDomainEnabled
ModeDomainSuspended
ModeDomainResumed
ModeDomainRetired
RightsManifestApproved
RightsManifestRevoked
PolicyBundlePublished
ModelAdapterRegistered
ModelSnapshotApproved
EpisodeCreated
EpisodeApproved
EpisodeSealed
SessionScheduleCreated
SessionScheduleActivated
SessionScheduleRevised
SessionScheduleRetired
ContentSessionLedgerOpened
ContentFactRevisionPositioned
ContentRightsRevisionPositioned
UniverseSealed
CalendarSealed
FactPackSealed
AppraisalUnitSealed
ContradictionGraphBuilt
AppraisalPackSealed
BenchmarkPackSealed
PackBindPermitIssued
ArtifactPackStaled
ArtifactPackRevoked
EpisodePublished
EpisodeSuspended
EpisodeRevoked
FactRevisionPublished
EpisodeSessionFinalityDeclared
MarketSessionFinalityDeclared
```

### Identity／Control

```text
EntitlementGranted
EntitlementExpired
ControlReleaseScheduled
ControlReleased
ControlRestoreScheduled
ControlRestored
AccountExportPrepared
AccountDeletionRequested
ControlDeletionPending
AccountDeletionCompleted
PrivacyArchiveSealed
```

### Lifecycle／Visibility

```text
CrewDeletionFenceCommitted
CrewLifecycleArchived
VisibilityEpochAdvanced
SubjectVisibilityWithdrawn
ControllerRevealReleased
PublicRevealReleased
```

### Desk／Crew

```text
CrewOriginated
SeasonEntryCreated
RoundCreated
RoundReady
RoundOpened
DossiersDrafted
DossiersSealed
SeatPlanSaved
SeatPlanCarriedForward
SeatPlanSealed
CrewSnapshotFrozen
CrewSettlementApplied
CrewStateAdvanced
CrewEnteredAutonomy
AutonomyStateAdvanced
CrewExitedAutonomy
CharacterRetired
CrewCorrectionLearned
CrewAdjudicationLearned
```

### Competition／Public World

```text
SeasonCreated
SeasonSeedCommitted
SeasonOpened
SeasonLocked
SeasonClosed
SeasonSeedRevealed
DivisionCreated
DivisionMemberAdded
DivisionRosterLocked
DivisionActivated
DivisionScoreContributionSubmitted
DivisionClosed
AutonomyRunPlanned
AutonomyRunStarted
CrewAutonomyAdvanceRequested
AutonomyRunCompleted
AutonomyRunCancelled
CompetitionAdjudicationCreated
DivisionContributionSuperseded
ContributionSupersessionCompleted
DivisionStandingCorrected
DivisionStandingCorrectionSetCompleted
SeasonStandingCorrected
CompetitionAdjudicationClosed
```

### Decision／Score

```text
DecisionSessionCreated
DecisionInputSealed
AppraisalPackBound
AppraisalFallbackRecorded
AttentionSelected
PeerPacketsCommitted
ActionsCommitted
OpenPriceBound
ClosePriceBound
SeatVoided
SessionHeld
SessionHoldReleased
SettlementJournalOpened
SessionSettlementPrepared
DecisionScorePosted
RiskBrakeAdvanced
CoverageAdvanced
SettlementCommitted
SessionCausalityClosed
SettlementReversed
CrewSettlementReversed
ScoreSettlementReversed
SessionResettled
SettlementRecommitted
SessionScoreCorrectionRecorded
ClosedSessionScoreCorrected
RiskBrakeCorrectionCarried
RiskBrakeCorrectionNoActionSpace
SessionVoided
VoidCommitted
RoundFinalizing
RoundSettled
RoundClosed
StandingsPublished
```

### Replay／Correction／Operations

```text
ReplayVerified
ReplayFailed
DeadlineScheduled
DeadlineFired
DeadlineCancelled
CorrectionApplied
AdjudicationEpochCreated
ProjectionCheckpointed
CellMigrationRequested
CellBundleFreezeRequested
CellBundleFrozen
CellBundleCopied
CellBundleVerified
CellOwnershipCutOver
CellMigrationAborted
CellSourceTombstoned
ProjectionCheckpointed
```

`CounterfactualComputed` 與 `AlternateCoreScenarioComputed` 只存在 scenario store／audit contract，不是 canonical gameplay event。它們必須引用原始 snapshot 與 intervention digest，也沒有任何 consumer 可以將其轉成 Crew、Score 或 Standing write。`MarkArtifactPackStale` 與 `RevokeArtifactPack` 只能由已提交的 fact／rights 事件觸發，不接受管理員任意指定 pack 狀態。

## Scheduler contract

Cron 或 workflow history 不能成為 deadline 的真相源。所有 cutoff、reveal、round boundary、control release、restore 與 migration deadline 先寫 `DeadlineScheduled`。Worker claim deadline 後只能送出相同 idempotency command，且 claim／fire 都要驗證 logical cell ownership epoch；重啟、重複 delivery、cell cutover 或時鐘漂移不得製造第二次封席或結算。

## Correction contract

- 新 fact 不得注入已 `DecisionInputSealed` 的 session。
- `SessionCausalityClosed` 前的 authoritative correction 可以 reverse＋resettle，保留原 journal 與事件。
- 因果關閉後只可用 `CorrectClosedSessionScore` 在同一 logical-cell transaction 追加 Session correction record 並更新 ScoreLedger；角色另以 typed Character Life command 得知修正，不回寫已經歷人生。若 correction 改變理論 qmax，使用 `RiskBrakeCorrectionCarried` 從同一回合下一個尚未封存 session 生效。
- time-travel、rights revoke、engine defect 或制度異常必須建立 hold／void／adjudication event；管理員不能更新 event payload。
- scenario store 不在 canonical stream，沒有任何 consumer 可將它投影成正式人物、分數或榜單。
- Public projection event 必帶 visibility epoch；低於 `VisibilityRevocationRegistry` 的 epoch 時必須拒絕，不能因亂序 delivery 重新發布已撤回角色。

## Golden fixtures

第一批 fixtures 至少涵蓋：正常五席、全員不做、單席 cohort 不足、`qmax=0`、全席鎖定、休市、資料延遲、pack stale、schema fallback、價格 correction、三階段 session void、因果關閉後 correction、重複 settlement、transaction rollback、cell migration copy／abort／epoch conflict、visibility epoch 亂序、五種人物因素反事實與 alternative core scenario。
