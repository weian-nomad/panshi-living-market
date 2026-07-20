# Aggregate state and payload map

_版本 1.2｜2026-07-20｜補充 [Event Catalog v1.3](./event-catalog.md)_

本文件固定 aggregate ownership、state 與 event payload 的最小欄位；逐 command transition 見 [machine-readable map](../../contracts/policy/command-transition-map.yaml)。所有 payload 另受 event envelope、Protobuf schema、rights scope 與 data class 約束；表中不重複 envelope 已有欄位。

所有 canonical state mutation event 必須保存可重播資料，不能只存 digest：

- 小型 mutation 內嵌 `patch_schema_revision + forward_patch_bytes`。
- 需要 reverse 的 settlement journal 同時內嵌 `forward_patch_bytes + inverse_patch_bytes`。
- 大型內容可引用 immutable content-addressed blob，但 event 必須保存 `blob_id + schema_revision + digest`，blob 與 canonical stream 具有相同 retention、WORM 與備份政策。
- Digest 只作驗證，不能成為重建 state 的唯一資料。

上述 replay 欄位是每個 mutation event 的共同必要欄位，下表只列 domain-specific payload，不再逐列重複。

## Aggregate ownership

| Aggregate | Command owner | Stream ID | Write boundary |
| --- | --- | --- | --- |
| `ModeDomain` | `governance` | `domain_id` | Content Vault DB |
| `RightsManifest` | `governance` | `rights_manifest_id` | Content Vault DB |
| `Episode` | `content` | `episode_id` | Content Vault DB |
| `SessionSchedule` | `content` | `content_session_id` | Content Vault DB |
| `ContentSessionLedger` | `content` | `content_session_id` | Content Vault DB；fact／rights／permit ordering 的唯一 owner |
| `Universe／Calendar／FactPack／AppraisalPack／BenchmarkPack／PackBindPermit` | `content` | artifact／permit ID | Content Vault DB＋object store |
| `Account／Entitlement／ControlLease` | `identity` | subject／entitlement／crew ID | Identity DB |
| `CrewLifecycleFence／VisibilityGrant` | `lifecycle_visibility` | `crew_id` | Logical-cell DB |
| `Season／Division` | `competition` | season／division ID | Competition canonical DB |
| `CompetitionAdjudication` | `competition` | adjudication ID | Competition canonical DB |
| `SeasonDesk／RoundDesk` | `desk_play` | crew-season／crew-round ID | Logical-cell DB |
| `Crew` | `character_life` | `crew_id` | Logical-cell DB |
| `DecisionSession` | `decision` | `decision_session_id` | Logical-cell DB |
| `ScoreLedger` | `competition_ledger` | crew-season ID | Logical-cell DB |
| `AutonomyRun` | `public_world` | autonomy run ID | Logical-cell DB；只能 command Crew |
| `CellMigration` | `cell_router` | migration ID | Control DB＋source／target cell |

## Authoritative state transitions

### Content

```text
ModeDomain: ABSENT → REGISTERED → ENABLED → SUSPENDED | RETIRED
RightsManifest: DRAFT → APPROVED → REVOKED
Episode: DRAFT → APPROVED → SEALED → PUBLISHED → SUSPENDED | REVOKED
SessionSchedule: ABSENT → DRAFT → ACTIVE → ACTIVE(revised) | RETIRED
ContentSessionLedger: ABSENT → ACTIVE → ACTIVE(position advanced)
Artifact pack: BUILDING → SEALED → STALE | REVOKED
```

`ModeDomain.ENABLED` 必須驗證 required gate digests；Current 缺一項就不能由 `ABSENT` 建立。Published episode 只能引用 sealed artifacts。

### Identity／control

```text
Account: ACTIVE → DELETION_PENDING → DELETED
Entitlement: ABSENT → ACTIVE → EXPIRED
ControlLease:
CONTROLLED → RELEASE_PENDING → AUTONOMOUS_PUBLIC
AUTONOMOUS_PUBLIC → RESTORE_PENDING → CONTROLLED
CONTROLLED | RELEASE_PENDING | RESTORE_PENDING | AUTONOMOUS_PUBLIC
→ DELETION_PENDING → PRIVACY_SEALED_ARCHIVE

CrewLifecycleFence:
ACTIVE(epoch N) → DELETION_PENDING(epoch N+1) → ARCHIVED

VisibilityGrant:
HIDDEN → CONTROLLER_VISIBLE → PUBLIC_VISIBLE
HIDDEN | CONTROLLER_VISIBLE | PUBLIC_VISIBLE
→ WITHDRAWN(epoch N+1)
```

`DELETION_PENDING` 同步拒絕新 gameplay command、migration 與 public reveal。

### Competition／play

```text
Season: DRAFT → SEED_COMMITTED → OPEN → LOCKED → CLOSED → SEED_REVEALED
Division: DRAFT → ROSTER_LOCKED → ACTIVE → CLOSED
Round: DRAFT → READY → OPEN → FINALIZING → SETTLED → CLOSED
DecisionSession:
OPEN → INPUT_SEALED → ACTION_COMMITTED
→ OUTCOME_PENDING → SETTLEMENT_COMMITTED → CAUSALITY_CLOSED

AutonomyRun:
PLANNED → RUNNING → COMPLETED
PLANNED | RUNNING → CANCELLED

CompetitionAdjudication:
OPEN → CONTRIBUTIONS_SUPERSEDED → DIVISION_STANDINGS_CORRECTED
→ SEASON_STANDING_CORRECTED → CLOSED
```

`HELD` 是附帶 hold record 的暫停狀態；只可回到原 transition 或進 `VOID_COMMITTED`。`VOID_COMMITTED` 永久 terminal。

### Migration

```text
ACTIVE_SOURCE → FREEZE_REQUESTED → FROZEN → COPIED
→ VERIFIED → ACTIVE_TARGET → SOURCE_TOMBSTONED
```

`FREEZE_REQUESTED` 到 target 第一筆 canonical write 前可 `CellMigrationAborted` 回來源；target 已寫入後只能再建立反向 migration。

## Governance／content event payloads

| Event | Required payload |
| --- | --- |
| `ModeDomainRegistered` | `domain_id, mode_kind, jurisdiction, required_gate_digests, isolation_profile` |
| `ModeDomainEnabled` | `domain_id, satisfied_gate_digests, enabled_at` |
| `ModeDomainSuspended` | `domain_id, reason_class, suspended_at` |
| `ModeDomainResumed` | `domain_id, resolution_digest, resumed_at` |
| `ModeDomainRetired` | `domain_id, retirement_policy_revision, retired_at` |
| `RightsManifestApproved` | `rights_manifest_id, content_classes, permitted_purposes, territories, effective_at, expires_at, document_digest` |
| `RightsManifestRevoked` | `rights_manifest_id, revoked_at, reason_class, withdrawal_policy_revision` |
| `PolicyBundlePublished` | `policy_revision, decision_policy_digest, scoring_policy_digest, fallback_policy_digest, effective_scope` |
| `ModelAdapterRegistered` | `adapter_revision, core_contract_revision, input_schema_revision, output_schema_revision, transport_class` |
| `ModelSnapshotApproved` | `model_revision, weights_digest, tokenizer_digest, deployment_rights_digest, approval_scope` |
| `EpisodeCreated` | `episode_id, domain_id, jurisdiction, masked_date_policy, fictional_entity_namespace` |
| `EpisodeApproved` | `episode_id, rights_manifest_id, legal_review_digest, approver_ids` |
| `EpisodeSealed` | `episode_id, universe_revision, calendar_revision, session_schedule_digest, artifact_set_digest` |
| `EpisodePublished` | `episode_id, published_at, public_policy_revision, visibility_epoch` |
| `EpisodeSuspended` | `episode_id, reason_class, held_artifact_ids, suspended_at` |
| `EpisodeRevoked` | `episode_id, reason_class, revoked_at, withdrawal_policy_revision` |
| `SessionScheduleCreated` | `content_session_id, episode_id, interaction_cutoff_at, evidence_cutoff_at, finality_policy_revision, controller_embargo_revision, public_embargo_revision, clock_authority_revision` |
| `SessionScheduleActivated` | `content_session_id, schedule_digest, activated_at` |
| `SessionScheduleRevised` | `content_session_id, prior_schedule_digest, new_schedule_digest, reason_class, effective_before_input_seal` |
| `SessionScheduleRetired` | `content_session_id, retirement_reason, retired_at` |
| `ContentSessionLedgerOpened` | `content_session_id, ledger_id, initial_fact_head, initial_rights_head, initial_content_position=0, opened_at` |
| `ContentFactRevisionPositioned` | `content_session_id, ledger_id, content_position, previous_content_position, fact_revision_id, prior_fact_head, next_fact_head, source_event_id, positioned_at` |
| `ContentRightsRevisionPositioned` | `content_session_id, ledger_id, content_position, previous_content_position, rights_manifest_id, rights_revision_kind, prior_rights_head, next_rights_head, source_event_id, positioned_at` |
| `UniverseSealed` | `universe_revision, company_ids, cohort_assignments, eligibility_digest` |
| `CalendarSealed` | `calendar_revision, jurisdiction, valid_session_dates, holiday_rules_digest` |
| `FactPackSealed` | `fact_pack_id, content_session_id, manifest_digest, fact_revision_digest, rights_manifest_digest` |
| `AppraisalUnitSealed` | `unit_id, content_session_id, evidence_id, company_id, core_contract_revision, raw_digest, normalized_unit_digest, fallback_used` |
| `ContradictionGraphBuilt` | `graph_id, content_session_id, unit_set_digest, normalizer_revision, edge_digest` |
| `AppraisalPackSealed` | `pack_id, content_session_id, unit_set_digest, graph_id, fallback_numerator, fallback_denominator, required_fact_fallback_count` |
| `BenchmarkPackSealed` | `benchmark_pack_id, content_session_id, cohort_returns_digest, robust_scale_revision` |
| `PackBindPermitIssued` | `permit_id, decision_session_id, pack_id, content_session_id, ledger_id, content_position, previous_content_position, fact_head, rights_head, fact_revision_digest, rights_manifest_digest, issued_at, expires_at` |
| `ArtifactPackStaled` | `artifact_id, artifact_type, prior_state=SEALED, fact_revision_id, affected_manifest_digest, staled_at` |
| `ArtifactPackRevoked` | `artifact_id, artifact_type, prior_state, rights_manifest_id, withdrawal_policy_revision, revoked_at` |
| `FactRevisionPublished` | `fact_revision_id, supersedes_revision_id, world_published_at, platform_received_at, source_digest, correction_class` |
| `EpisodeSessionFinalityDeclared` | `content_session_id, finality_revision, authoritative_outcome_digest, declared_at` |
| `MarketSessionFinalityDeclared` | `content_session_id, finality_revision, authoritative_outcome_digest, source_sla_digest, declared_at` |

## Identity／control event payloads

| Event | Required payload |
| --- | --- |
| `EntitlementGranted` | `entitlement_id, subject_id, entitlement_class, valid_from, valid_until` |
| `EntitlementExpired` | `entitlement_id, expired_at, boundary_policy_revision` |
| `ControlReleaseScheduled` | `crew_id, effective_round_boundary, prior_control_state` |
| `ControlReleased` | `crew_id, control_lease_version, autonomy_policy_revision, effective_at` |
| `ControlRestoreScheduled` | `crew_id, effective_round_boundary, target_competition_state` |
| `ControlRestored` | `crew_id, control_lease_version, effective_at` |
| `AccountExportPrepared` | `subject_id, export_id, included_data_classes, excluded_rights_classes, expires_at` |
| `AccountDeletionRequested` | `subject_id, crew_id, deletion_hold_id, lifecycle_fence_command_id, requested_at` |
| `ControlDeletionPending` | `crew_id, deletion_intent_id, prior_control_state, prior_control_lease_version, next_control_lease_version, fence_receipt_digest, effective_at` |
| `AccountDeletionCompleted` | `subject_id_pseudonym, crew_id, lifecycle_epoch, completed_at` |
| `PrivacyArchiveSealed` | `subject_id_pseudonym, crew_id, shredded_key_ids, retained_audit_digest, sealed_at` |

## Lifecycle／visibility event payloads

| Event | Required payload |
| --- | --- |
| `CrewDeletionFenceCommitted` | `crew_id, deletion_intent_id, prior_lifecycle_epoch, next_lifecycle_epoch, cancelled_autonomy_run_ids, cancelled_deadline_ids, identity_transition_required=true` |
| `CrewLifecycleArchived` | `crew_id, deletion_intent_id, lifecycle_epoch, terminal_session_set_digest, archive_ready_at` |
| `VisibilityEpochAdvanced` | `crew_id, visibility_grant_id, prior_visibility_epoch, next_visibility_epoch, reason_class` |
| `SubjectVisibilityWithdrawn` | `subject_id_pseudonym, visibility_grant_id, new_visibility_epoch, affected_resource_ids, withdrawal_reason` |
| `ControllerRevealReleased` | `visibility_grant_id, decision_session_id, settlement_revision, visibility_epoch, released_at` |
| `PublicRevealReleased` | `visibility_grant_id, decision_session_id, sanitizer_policy_revision, visibility_epoch, released_at` |

## Season／division event payloads

| Event | Required payload |
| --- | --- |
| `SeasonCreated` | `season_id, domain_id, episode_ids, scoring_policy_revision, round_count, division_size` |
| `SeasonSeedCommitted` | `season_id, commitment_digest, seed_policy_revision` |
| `SeasonOpened` | `season_id, opened_at, roster_deadline, first_content_session_id` |
| `SeasonLocked` | `season_id, locked_at, roster_digest, policy_revision_set` |
| `SeasonClosed` | `season_id, closed_at, contribution_set_digest, standing_revision` |
| `SeasonSeedRevealed` | `season_id, season_secret, commitment_digest, revealed_at` |
| `DivisionCreated` | `division_id, season_id, division_number, capacity` |
| `DivisionMemberAdded` | `division_id, crew_id, membership_id, eligibility_digest` |
| `DivisionRosterLocked` | `division_id, member_ids, roster_digest, locked_at` |
| `DivisionActivated` | `division_id, season_id, roster_digest, activated_at` |
| `DivisionScoreContributionSubmitted` | `division_id, crew_id, contribution_revision, score_digest, source_cell_epoch` |
| `DivisionClosed` | `division_id, contribution_set_digest, standing_revision, closed_at` |
| `CompetitionAdjudicationCreated` | `competition_adjudication_id, season_id, affected_division_ids, reason_class, authority_digest, required_correction_items, required_correction_set_digest` |
| `DivisionContributionSuperseded` | `competition_adjudication_id, correction_item_id, division_id, crew_id, source_score_revision, prior_contribution_revision, next_contribution_revision, score_bytes, score_digest` |
| `ContributionSupersessionCompleted` | `competition_adjudication_id, required_contribution_subset_digest, completed_contribution_subset_digest, resulting_contribution_set_digest, completed_at` |
| `DivisionStandingCorrected` | `competition_adjudication_id, correction_item_id, division_id, source_contribution_set_digest, prior_standing_revision, next_standing_revision, standing_bytes, standing_digest` |
| `DivisionStandingCorrectionSetCompleted` | `competition_adjudication_id, required_division_standing_subset_digest, completed_division_standing_subset_digest, resulting_division_standing_set_digest, completed_at` |
| `SeasonStandingCorrected` | `competition_adjudication_id, correction_item_id, season_id, source_division_standing_set_digest, prior_standing_revision, next_standing_revision, standing_bytes, standing_digest` |
| `CompetitionAdjudicationClosed` | `competition_adjudication_id, required_correction_set_digest, completed_correction_set_digest, contribution_set_digest, standing_set_digest, closed_at` |

## Desk／crew／autonomy event payloads

| Event | Required payload |
| --- | --- |
| `CrewOriginated` | `crew_id, character_ids[5], identity_seed_commitment, origin_policy_revision, origin_blob_id, origin_schema_revision, origin_digest` |
| `SeasonEntryCreated` | `crew_id, season_id, season_desk_id, control_lease_version` |
| `RoundCreated` | `round_id, season_desk_id, round_index, prior_round_id` |
| `RoundReady` | `round_id, dossier_set_digest, starter_config_used, readiness_digest` |
| `RoundOpened` | `round_id, season_desk_id, valid_day_target=5, prior_round_id` |
| `DossiersDrafted` | `round_id, dossier_ids[5], company_sets, base_version` |
| `DossiersSealed` | `round_id, dossier_set_digest, cohort_validation_digest` |
| `SeatPlanSaved` | `round_id, layout_digest, placements[5], base_version` |
| `SeatPlanCarriedForward` | `round_id, source_session_id, layout_digest, reason_class` |
| `SeatPlanSealed` | `round_id, content_session_id, layout_digest, interaction_cutoff_at, db_committed_at` |
| `CrewSnapshotFrozen` | `crew_id, decision_session_id, crew_stream_version, snapshot_blob_id, snapshot_schema_revision, snapshot_digest` |
| `CrewSettlementApplied` | `crew_id, decision_session_id, settlement_revision, patch_schema_revision, forward_patch_bytes, prior_state_digest, next_state_digest` |
| `CrewStateAdvanced` | `crew_id, source_command_id, patch_schema_revision, forward_patch_bytes, prior_state_digest, next_state_digest, policy_revision` |
| `CrewEnteredAutonomy` | `crew_id, autonomy_run_id, visibility_epoch, effective_at` |
| `AutonomyRunPlanned` | `autonomy_run_id, crew_id, lifecycle_epoch, eligible_actions_digest, seed_ref, plan_blob_id, plan_schema_revision, plan_digest` |
| `AutonomyRunStarted` | `autonomy_run_id, crew_id, lifecycle_epoch, started_at` |
| `CrewAutonomyAdvanceRequested` | `autonomy_run_id, crew_id, expected_crew_version, typed_patch_intent` |
| `AutonomyStateAdvanced` | `autonomy_run_id, crew_id, accepted_command_id, patch_schema_revision, forward_patch_bytes, prior_state_digest, next_state_digest` |
| `AutonomyRunCompleted` | `autonomy_run_id, crew_id, final_result_digest, completed_at` |
| `AutonomyRunCancelled` | `autonomy_run_id, crew_id, lifecycle_epoch, cancellation_reason, cancelled_deadline_ids` |
| `CrewExitedAutonomy` | `crew_id, autonomy_run_id, effective_at` |
| `CharacterRetired` | `crew_id, character_id, season_boundary, retirement_policy_revision` |
| `CrewCorrectionLearned` | `crew_id, source_session_id, correction_revision, patch_schema_revision, forward_patch_bytes, prior_state_digest, next_state_digest` |
| `CrewAdjudicationLearned` | `crew_id, adjudication_epoch, source_session_ids, patch_schema_revision, forward_patch_bytes, prior_state_digest, next_state_digest` |

## Decision／score event payloads

| Event | Required payload |
| --- | --- |
| `DecisionSessionCreated` | `decision_session_id, crew_id, round_id, content_session_id, session_index` |
| `DecisionInputSealed` | `decision_session_id, seat_plan_digest, crew_snapshot_digest, score_snapshot_digest, fact_pack_id, appraisal_pack_id, pack_bind_permit_id, benchmark_pack_id, action_mask_digest, engine_digest` |
| `AppraisalPackBound` | `decision_session_id, pack_id, pack_bind_permit_id, content_session_ledger_id, permit_content_position, permit_fact_head, permit_rights_head, raw_digest, normalized_digest, all_revision_digests` |
| `AppraisalFallbackRecorded` | `decision_session_id, unit_id, fallback_reason, fallback_policy_revision` |
| `AttentionSelected` | `decision_session_id, character_id, evidence_ids[3], continuity_slot_used, selection_digest` |
| `PeerPacketsCommitted` | `decision_session_id, packets[5], circular_mapping_digest` |
| `ActionsCommitted` | `decision_session_id, actions[5], first_second_utility_gaps, seed_refs, action_digest` |
| `OpenPriceBound` | `decision_session_id, outcome_revision, company_open_values_digest` |
| `ClosePriceBound` | `decision_session_id, outcome_revision, company_close_values_digest, finality_ref` |
| `SeatVoided` | `decision_session_id, seat_id, reason_class, q=0, dp=0` |
| `SessionHeld` | `decision_session_id, hold_id, held_from_state, reason_class, required_resolution, held_at` |
| `SessionHoldReleased` | `decision_session_id, hold_id, resume_state, resolution_digest, released_at` |
| `SettlementJournalOpened` | `decision_session_id, settlement_revision, settlement_digest, precondition_versions` |
| `SessionSettlementPrepared` | `decision_session_id, settlement_revision, seat_results_bytes, seat_results_digest, patch_schema_revision, crew_forward_patch_bytes, crew_inverse_patch_bytes, score_forward_patch_bytes, score_inverse_patch_bytes` |
| `DecisionScorePosted` | `score_ledger_id, decision_session_id, settlement_revision, dp_by_seat, raw_total` |
| `RiskBrakeAdvanced` | `score_ledger_id, decision_session_id, prior_drawdown_by_seat, next_drawdown_by_seat, qmax_by_seat, state_digest` |
| `CoverageAdvanced` | `score_ledger_id, q_sum_by_seat, raw_by_seat, seat_scores` |
| `SettlementCommitted` | `decision_session_id, settlement_revision, crew_version, score_version, journal_digest` |
| `SessionCausalityClosed` | `decision_session_id, settlement_revision, next_input_session_id_or_round_close, closed_at` |
| `SettlementReversed` | `decision_session_id, prior_settlement_revision, correction_revision, journal_id, inverse_patch_schema_revision, inverse_patch_bytes, inverse_patch_digest` |
| `CrewSettlementReversed` | `crew_id, decision_session_id, journal_id, inverse_patch_schema_revision, inverse_patch_bytes, reversed_patch_digest, next_crew_version` |
| `ScoreSettlementReversed` | `score_ledger_id, decision_session_id, journal_id, inverse_patch_schema_revision, inverse_patch_bytes, reversed_score_digest, next_score_version` |
| `SessionResettled` | `decision_session_id, prior_revision, next_revision, authoritative_outcome_digest` |
| `SettlementRecommitted` | `decision_session_id, next_revision, crew_version, score_version, journal_digest` |
| `SessionScoreCorrectionRecorded` | `decision_session_id, correction_revision, authoritative_outcome_digest, prior_score_revision, next_score_revision, crew_history_changed=false` |
| `ClosedSessionScoreCorrected` | `score_ledger_id, decision_session_id, correction_revision, patch_schema_revision, forward_patch_bytes, inverse_patch_bytes, prior_state_digest, next_state_digest` |
| `RiskBrakeCorrectionCarried` | `score_ledger_id, source_session_id, target_unsealed_session_id, delta_digest` |
| `RiskBrakeCorrectionNoActionSpace` | `score_ledger_id, source_session_id, round_id, delta_digest, reason=NO_UNSEALED_SESSION_IN_ROUND` |
| `SessionVoided` | `decision_session_id, void_stage, reason_class, replacement_day_required` |
| `VoidCommitted` | `decision_session_id, void_revision, crew_effect_retained, score_reversed, committed_at` |
| `RoundFinalizing` | `round_id, terminal_session_ids, last_session_id, finalization_basis_digest` |
| `RoundSettled` | `round_id, valid_session_count=5, score_contribution_digest` |
| `RoundClosed` | `round_id, division_contribution_revision, closed_at` |
| `StandingsPublished` | `division_id, standing_revision, contribution_set_digest, visibility_epoch` |

## Operations event payloads

| Event | Required payload |
| --- | --- |
| `ReplayVerified` | `scope_id, source_event_range, engine_digest, replay_digest, divergence=0` |
| `ReplayFailed` | `scope_id, first_divergent_event_id, expected_digest, actual_digest, engine_digest` |
| `DeadlineScheduled` | `deadline_id, command_template_digest, due_at, logical_cell_id, ownership_epoch` |
| `DeadlineFired` | `deadline_id, command_id, claimed_epoch, fired_at` |
| `DeadlineCancelled` | `deadline_id, reason_class, cancelled_at` |
| `CorrectionApplied` | `correction_revision, affected_session_ids, causality_states, adjudication_policy_revision` |
| `AdjudicationEpochCreated` | `adjudication_epoch, reason_class, frozen_session_range, authority_digest` |
| `CellMigrationRequested` | `migration_id, crew_id, source_cell, target_cell, source_epoch` |
| `CellBundleFreezeRequested` | `migration_id, required_terminal_sessions, requested_at` |
| `CellBundleFrozen` | `migration_id, source_epoch, stream_heads, outbox_empty, frozen_at` |
| `CellBundleCopied` | `migration_id, bundle_digest, object_refs_digest, target_copy_location` |
| `CellBundleVerified` | `migration_id, stream_hashes, replay_digest, pending_settlement=0` |
| `CellOwnershipCutOver` | `migration_id, prior_epoch, next_epoch, target_endpoint_ref, cutover_at` |
| `CellMigrationAborted` | `migration_id, source_epoch, abort_stage, cleanup_digest` |
| `CellSourceTombstoned` | `migration_id, source_cell, read_only_until, tombstone_digest` |
| `ProjectionCheckpointed` | `projection_name, source_event_id, projection_version, checkpoint_digest` |

## Scenario store payloads

```text
scenario_id
scenario_type: SINGLE_VARIABLE | ALTERNATE_CORE
source_decision_snapshot_id
source_action_digest
intervention_type
intervention_payload_digest
alternate_appraisal_pack_id?
engine_digest
result_action_digest
utility_gap_delta
classification
computed_at
```

Scenario record 只能進 audit／read model，沒有 canonical aggregate version，也不能成為任何 gameplay command 的 causation source。
