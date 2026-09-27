//! A self-contained, deterministic mini fixture for the two fact-correction
//! paths of `docs/v5/system-design.md` §6.3 ("decision input seal 前到達的
//! correction 必須進新 manifest；seal 後 correction 以 `FactCorrectionObserved`
//! 形成後續世界事件，不改寫角色當時知道的事") and §9.3 ("可以在稍後收到
//! `CharacterCorrectionLearned`").
//!
//! It deliberately shares no event with `golden_episode()` or the 30-session
//! slice: both of those sequences stay byte-identical, and this module only
//! reuses their encoding helpers. Everything here is synthetic -- one adult
//! fictional character, fictional manifests and fact revisions -- and runs no
//! model: appraisal goes through `gateway::resolve_appraisal_once` with no
//! gateway, i.e. the `NO_NETWORK` deterministic fallback.
//!
//! Which path a correction takes is decided only by the cognitive episode's
//! own state (`CognitiveEpisode::correction_route`); which episodes a
//! post-seal correction names, and whether a later episode learns it, are
//! derived from what those episodes actually sealed
//! (`is_affected_by`/`learns_correction`), never asserted by this fixture.

use panshi_character_domain::{
    Digest, Id,
    cognition::{
        ActionIntentRef, ActionKind as DomainActionKind, AttentionRef, CandidateFact,
        CognitiveEpisode, CognitiveEpisodeError, CorrectionRoute, FactCorrection, SealInputRequest,
    },
    fallback::FALLBACK_POLICY_REVISION,
    gateway::{
        AppraisalResolution, FallbackReason, SchemaRevisions, SealedCognitionInput,
        resolve_appraisal_once,
    },
    memory::{MemoryKind, MemoryLedger, MemoryRecord, MemoryVisibility},
};
use panshi_decision_kernel::Fixed;
use panshi_protocol::{character, common::v2 as common_v2, world};

use crate::{CanonicalEventRecord, derive_id, payload_digest, push_event};

const SCHEMA: SchemaRevisions = SchemaRevisions {
    input_schema_revision: "cognition-input/v1",
    output_schema_revision: "cognition-appraisal/v1",
};

/// Fictional manifests and fact revisions used by both scenarios.
pub const ORIGINAL_MANIFEST_ID: &str = "wfm-v5-correction-001";
pub const ORIGINAL_FACT_REVISION_ID: &str = "fact-v5-correction-001-r1";
pub const CORRECTION_MANIFEST_ID: &str = "wfm-v5-correction-002";
pub const CORRECTED_FACT_REVISION_ID: &str = "fact-v5-correction-001-r2";
/// A later manifest that does not carry the corrected revision (counterexample).
pub const UNRELATED_MANIFEST_ID: &str = "wfm-v5-correction-003";
pub const UNRELATED_FACT_REVISION_ID: &str = "fact-v5-correction-003-r1";

const CORRECTION: FactCorrection<'static> = FactCorrection {
    superseded_manifest_id: ORIGINAL_MANIFEST_ID,
    superseded_fact_revision_id: ORIGINAL_FACT_REVISION_ID,
    correction_manifest_id: CORRECTION_MANIFEST_ID,
    corrected_fact_revision_id: CORRECTED_FACT_REVISION_ID,
};

/// Stable identifiers for the mini fixture's streams.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CorrectionIds {
    pub world_session_id: Id,
    pub character_id: Id,
    pub paper_account_id: Id,
    pub fact_revision_chain_id: Id,
    pub first_episode_id: Id,
    pub next_episode_id: Id,
    pub fact_correction_id: Id,
    pub learned_memory_id: Id,
}

impl CorrectionIds {
    #[must_use]
    pub fn v1() -> Self {
        Self {
            world_session_id: derive_id("v5-correction/world-session"),
            character_id: derive_id("v5-correction/character"),
            paper_account_id: derive_id("v5-correction/paper-account"),
            fact_revision_chain_id: derive_id("v5-correction/fact-revision-chain/001"),
            first_episode_id: derive_id("v5-correction/cognitive-episode/001"),
            next_episode_id: derive_id("v5-correction/cognitive-episode/002"),
            fact_correction_id: derive_id("v5-correction/fact-correction/001"),
            learned_memory_id: derive_id("v5-correction/memory/correction-learned-001"),
        }
    }
}

/// The input digest binds the manifest and the exact candidate revisions, so
/// rebinding to a correcting manifest necessarily yields a new digest.
#[must_use]
pub fn cognition_input_digest(
    episode_id: Id,
    manifest_id: &str,
    candidate_facts: &[CandidateFact<'_>],
) -> Digest {
    let mut material = b"v5-correction-cognition-input/v1\0".to_vec();
    material.extend_from_slice(&episode_id);
    material.extend_from_slice(manifest_id.as_bytes());
    material.push(0);
    for fact in candidate_facts {
        material.extend_from_slice(fact.fact_revision_id.as_bytes());
        material.push(0);
        material.extend_from_slice(&fact.available_at_unix_micros.to_be_bytes());
    }
    payload_digest(&material)
}

/// Result of the correction-before-seal scenario.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PreSealOutcome {
    pub ids: CorrectionIds,
    pub events: Vec<CanonicalEventRecord>,
    /// The episode after it sealed the corrected input.
    pub episode: CognitiveEpisode,
    /// Route the episode reported when the correction arrived.
    pub route_on_arrival: CorrectionRoute,
    /// The digest the original (now stale) pack would have sealed.
    pub stale_pack_digest: Digest,
    /// Sealing the original manifest and revision after the correction.
    pub stale_manifest_rejection: Result<(), CognitiveEpisodeError>,
    /// Sealing the superseded revision under the correcting manifest id.
    pub stale_pack_rejection: Result<(), CognitiveEpisodeError>,
}

/// Correction arrives after `FactManifestAccepted` but before
/// `CognitionInputSealed`: the unsealed input is rebuilt against the
/// correcting manifest; the old manifest and old pack are refused.
///
/// # Panics
///
/// Only on a defect in this fixture's fixed sequence.
#[must_use]
pub fn correction_before_seal() -> PreSealOutcome {
    let ids = CorrectionIds::v1();
    let mut events = Vec::new();
    push_manifest(
        &mut events,
        &ids,
        ORIGINAL_MANIFEST_ID,
        ORIGINAL_FACT_REVISION_ID,
        100_000,
    );
    push_visible(
        &mut events,
        &ids,
        ORIGINAL_MANIFEST_ID,
        ORIGINAL_FACT_REVISION_ID,
        10_000,
    );
    push_observed(
        &mut events,
        &ids,
        ids.first_episode_id,
        ORIGINAL_MANIFEST_ID,
        ORIGINAL_FACT_REVISION_ID,
        11_000,
    );

    let mut episode = CognitiveEpisode::open(ids.first_episode_id, ids.character_id, 100_000);
    episode
        .bind_manifest(ORIGINAL_MANIFEST_ID)
        .expect("fixed sequence: manifest bound");
    let stale_pack = [CandidateFact {
        fact_revision_id: ORIGINAL_FACT_REVISION_ID,
        available_at_unix_micros: 10_000,
    }];
    let stale_pack_digest =
        cognition_input_digest(ids.first_episode_id, ORIGINAL_MANIFEST_ID, &stale_pack);

    // The correction lands before seal: it goes into a new manifest.
    push_manifest(
        &mut events,
        &ids,
        CORRECTION_MANIFEST_ID,
        CORRECTED_FACT_REVISION_ID,
        100_000,
    );
    push_visible(
        &mut events,
        &ids,
        CORRECTION_MANIFEST_ID,
        CORRECTED_FACT_REVISION_ID,
        12_000,
    );
    let route_on_arrival = episode.correction_route();
    assert_eq!(route_on_arrival, CorrectionRoute::RebindBeforeSeal);
    episode
        .apply_pre_seal_correction(&CORRECTION)
        .expect("fixed sequence: unsealed episode rebinds");

    let stale_manifest_rejection = episode.seal_input(
        0,
        &SealInputRequest {
            manifest_id: ORIGINAL_MANIFEST_ID,
            candidate_facts: &stale_pack,
            character_world_time_unix_micros: 16_000,
            sealed_at_unix_micros: 16_000,
            input_digest: stale_pack_digest,
        },
    );
    let stale_pack_rejection = episode.seal_input(
        0,
        &SealInputRequest {
            manifest_id: CORRECTION_MANIFEST_ID,
            candidate_facts: &stale_pack,
            character_world_time_unix_micros: 16_000,
            sealed_at_unix_micros: 16_000,
            input_digest: stale_pack_digest,
        },
    );

    let corrected_pack = [CandidateFact {
        fact_revision_id: CORRECTED_FACT_REVISION_ID,
        available_at_unix_micros: 12_000,
    }];
    push_sealed(
        &mut events,
        &ids,
        &mut episode,
        CORRECTION_MANIFEST_ID,
        &corrected_pack,
        16_000,
    );
    PreSealOutcome {
        ids,
        events,
        episode,
        route_on_arrival,
        stale_pack_digest,
        stale_manifest_rejection,
        stale_pack_rejection,
    }
}

/// Knobs for the post-seal scenario; the two defaults describe the main
/// path, the others build its counterexample and its baseline.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct PostSealConfig {
    /// Whether the correction arrives at all (false = baseline world).
    pub correction_arrives: bool,
    /// Whether the next episode's manifest carries the corrected revision.
    pub next_episode_sees_correction: bool,
}

impl PostSealConfig {
    pub const MAIN: Self = Self {
        correction_arrives: true,
        next_episode_sees_correction: true,
    };
}

/// Result of the correction-after-seal scenario.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PostSealOutcome {
    pub ids: CorrectionIds,
    pub events: Vec<CanonicalEventRecord>,
    /// Number of events that existed before the correction arrived.
    pub events_before_correction: usize,
    pub first_episode: CognitiveEpisode,
    /// Route the first episode reported when the correction arrived.
    pub route_on_arrival: Option<CorrectionRoute>,
    /// Attempting to push the late correction into the sealed episode.
    pub late_apply_rejection: Option<Result<(), CognitiveEpisodeError>>,
    pub next_episode: Option<CognitiveEpisode>,
}

/// Correction arrives after the first episode sealed its input and decided:
/// the sealed digest and decision stay as they were, a
/// `FactCorrectionObserved` world event is appended, and the next episode
/// seals the corrected revision and learns it (`MemoryFormed` then
/// `CharacterCorrectionLearned`).
#[must_use]
pub fn correction_after_seal() -> PostSealOutcome {
    post_seal_scenario(PostSealConfig::MAIN)
}

/// # Panics
///
/// Only on a defect in this fixture's fixed sequence.
#[must_use]
#[allow(clippy::too_many_lines)]
pub fn post_seal_scenario(config: PostSealConfig) -> PostSealOutcome {
    let ids = CorrectionIds::v1();
    let mut events = Vec::new();
    push_manifest(
        &mut events,
        &ids,
        ORIGINAL_MANIFEST_ID,
        ORIGINAL_FACT_REVISION_ID,
        100_000,
    );
    push_visible(
        &mut events,
        &ids,
        ORIGINAL_MANIFEST_ID,
        ORIGINAL_FACT_REVISION_ID,
        10_000,
    );
    push_observed(
        &mut events,
        &ids,
        ids.first_episode_id,
        ORIGINAL_MANIFEST_ID,
        ORIGINAL_FACT_REVISION_ID,
        15_000,
    );

    // -- first episode: sealed and decided on the original revision ---------
    let mut first = CognitiveEpisode::open(ids.first_episode_id, ids.character_id, 100_000);
    first
        .bind_manifest(ORIGINAL_MANIFEST_ID)
        .expect("fixed sequence: manifest bound");
    push_sealed(
        &mut events,
        &ids,
        &mut first,
        ORIGINAL_MANIFEST_ID,
        &[CandidateFact {
            fact_revision_id: ORIGINAL_FACT_REVISION_ID,
            available_at_unix_micros: 10_000,
        }],
        16_000,
    );
    first
        .commit_attention(
            2,
            AttentionRef {
                attention_digest: payload_digest(b"v5-correction-attention/001"),
                attention_policy_revision: "attention-policy/v1",
            },
        )
        .expect("fixed sequence: AppraisalResolved -> AttentionCommitted");
    push_event(
        &mut events,
        "AttentionCommitted",
        "CognitiveEpisode",
        ids.first_episode_id,
        &character::v1::AttentionCommittedV1 {
            cognitive_episode_id: ids.first_episode_id.to_vec(),
            selected_fact_revision_ids: vec![ORIGINAL_FACT_REVISION_ID.to_owned()],
            missed_high_salience_fact_revision_ids: Vec::new(),
            attention_policy_revision: "attention-policy/v1".to_owned(),
            tie_break_seed_ref: payload_digest(b"v5-correction-attention-seed/001").to_vec(),
        },
    );
    first
        .commit_action_intent(
            3,
            ActionIntentRef {
                action: DomainActionKind::Wait,
                action_digest: payload_digest(b"v5-correction-action/001"),
                behavior_policy_revision: "behavior-policy/v1",
            },
        )
        .expect("fixed sequence: AttentionCommitted -> ActionIntentCommitted");
    push_event(
        &mut events,
        "AutonomousActionIntentCommitted",
        "CognitiveEpisode",
        ids.first_episode_id,
        &character::v1::AutonomousActionIntentCommittedV1 {
            cognitive_episode_id: ids.first_episode_id.to_vec(),
            character_id: ids.character_id.to_vec(),
            paper_account_ref: ids.paper_account_id.to_vec(),
            paper_account_version: 0,
            action: (character::v1::ActionKind::Wait as i32),
            security_id: String::new(),
            quantity_or_target_weight_fixed: 0,
            committed_at_unix_micros: 18_000,
            expires_at_unix_micros: 90_000,
            thesis_revision: String::new(),
            perceived_fact_revision_ids: vec![ORIGINAL_FACT_REVISION_ID.to_owned()],
            confidence_bp: 5_000,
            behavior_policy_revision: "behavior-policy/v1".to_owned(),
            first_utility_fixed_be: Fixed::ZERO.raw().to_be_bytes().to_vec(),
            second_utility_fixed_be: Fixed::ZERO.raw().to_be_bytes().to_vec(),
        },
    );
    first
        .close(4)
        .expect("fixed sequence: ActionIntentCommitted -> Closed");

    let events_before_correction = events.len();
    if !config.correction_arrives {
        return PostSealOutcome {
            ids,
            events,
            events_before_correction,
            first_episode: first,
            route_on_arrival: None,
            late_apply_rejection: None,
            next_episode: None,
        };
    }

    // -- the correction arrives after seal ----------------------------------
    let route_on_arrival = first.correction_route();
    assert_eq!(route_on_arrival, CorrectionRoute::ObserveAfterSeal);
    let late_apply_rejection = first.clone().apply_pre_seal_correction(&CORRECTION);
    push_manifest(
        &mut events,
        &ids,
        CORRECTION_MANIFEST_ID,
        CORRECTED_FACT_REVISION_ID,
        300_000,
    );
    push_visible(
        &mut events,
        &ids,
        CORRECTION_MANIFEST_ID,
        CORRECTED_FACT_REVISION_ID,
        150_000,
    );
    let affected_cognitive_episode_ids = [&first]
        .into_iter()
        .filter(|episode| episode.is_affected_by(&CORRECTION))
        .map(|episode| episode.cognitive_episode_id.to_vec())
        .collect();
    push_event(
        &mut events,
        "FactCorrectionObserved",
        "FactRevisionChain",
        ids.fact_revision_chain_id,
        &world::v1::FactCorrectionObservedV1 {
            fact_correction_id: ids.fact_correction_id.to_vec(),
            original_manifest_id: ORIGINAL_MANIFEST_ID.to_owned(),
            original_fact_revision_id: ORIGINAL_FACT_REVISION_ID.to_owned(),
            correction_manifest_id: CORRECTION_MANIFEST_ID.to_owned(),
            corrected_fact_revision_id: CORRECTED_FACT_REVISION_ID.to_owned(),
            observed_at_unix_micros: 150_000,
            affected_cognitive_episode_ids,
        },
    );

    // -- next episode: sees whatever its own manifest carries ---------------
    let (next_manifest_id, next_fact_revision_id) = if config.next_episode_sees_correction {
        (CORRECTION_MANIFEST_ID, CORRECTED_FACT_REVISION_ID)
    } else {
        push_manifest(
            &mut events,
            &ids,
            UNRELATED_MANIFEST_ID,
            UNRELATED_FACT_REVISION_ID,
            300_000,
        );
        push_visible(
            &mut events,
            &ids,
            UNRELATED_MANIFEST_ID,
            UNRELATED_FACT_REVISION_ID,
            155_000,
        );
        (UNRELATED_MANIFEST_ID, UNRELATED_FACT_REVISION_ID)
    };
    let next_available_at = if config.next_episode_sees_correction {
        150_000
    } else {
        155_000
    };
    push_observed(
        &mut events,
        &ids,
        ids.next_episode_id,
        next_manifest_id,
        next_fact_revision_id,
        160_000,
    );
    let mut next = CognitiveEpisode::open(ids.next_episode_id, ids.character_id, 300_000);
    next.bind_manifest(next_manifest_id)
        .expect("fixed sequence: manifest bound");
    push_sealed(
        &mut events,
        &ids,
        &mut next,
        next_manifest_id,
        &[CandidateFact {
            fact_revision_id: next_fact_revision_id,
            available_at_unix_micros: next_available_at,
        }],
        170_000,
    );

    if next.learns_correction(&CORRECTION) {
        let mut memory_ledger = MemoryLedger::new();
        let memory_record = MemoryRecord {
            memory_id: ids.learned_memory_id,
            character_id: ids.character_id,
            kind: MemoryKind::Belief,
            source_event_digest: payload_digest(&ids.fact_correction_id),
            formed_at_unix_micros: 171_000,
            salience_bp: 5_000,
            confidence_bp: 8_000,
            valence_bp: 0,
            visibility: MemoryVisibility::CanonicalRestricted,
        };
        memory_ledger
            .form(memory_record)
            .expect("fixed sequence: first memory in this fixture");
        push_event(
            &mut events,
            "MemoryFormed",
            "MemoryLedger",
            ids.character_id,
            &character::v1::MemoryFormedV1 {
                memory_id: ids.learned_memory_id.to_vec(),
                character_id: ids.character_id.to_vec(),
                kind: (character::v1::MemoryKind::Belief as i32),
                source_event_ids: vec![
                    ids.fact_correction_id.to_vec(),
                    ids.next_episode_id.to_vec(),
                ],
                formed_at_unix_micros: memory_record.formed_at_unix_micros,
                salience_bp: memory_record.salience_bp,
                confidence_bp: memory_record.confidence_bp,
                valence_bp: memory_record.valence_bp,
                decay_policy_revision: "memory-decay-policy/v1".to_owned(),
                visibility: (character::v1::memory_formed_v1::Visibility::CanonicalRestricted
                    as i32),
            },
        );
        push_event(
            &mut events,
            "CharacterCorrectionLearned",
            "CharacterLife",
            ids.character_id,
            &character::v1::CharacterCorrectionLearnedV1 {
                character_id: ids.character_id.to_vec(),
                fact_correction_id: ids.fact_correction_id.to_vec(),
                cognitive_episode_id: ids.next_episode_id.to_vec(),
                memory_id: ids.learned_memory_id.to_vec(),
                learned_at_unix_micros: 171_000,
            },
        );
    }

    PostSealOutcome {
        ids,
        events,
        events_before_correction,
        first_episode: first,
        route_on_arrival: Some(route_on_arrival),
        late_apply_rejection: Some(late_apply_rejection),
        next_episode: Some(next),
    }
}

fn push_manifest(
    events: &mut Vec<CanonicalEventRecord>,
    ids: &CorrectionIds,
    manifest_id: &str,
    fact_revision_id: &str,
    interaction_cutoff_unix_micros: i64,
) {
    push_event(
        events,
        "FactManifestAccepted",
        "FactManifestMirror",
        ids.world_session_id,
        &world::v1::FactManifestAcceptedV1 {
            manifest_id: manifest_id.to_owned(),
            manifest_hash: payload_digest(manifest_id.as_bytes()).to_vec(),
            market_session_id: "session-v5-correction-001".to_owned(),
            market_date_taipei: "2026-07-23".to_owned(),
            interaction_cutoff_unix_micros,
            evidence_cutoff_unix_micros: interaction_cutoff_unix_micros + 100_000,
            rights_manifest_id: "rights-v5-correction-001".to_owned(),
            interaction_fact_revision_ids: vec![fact_revision_id.to_owned()],
            interaction_fact_set_digest: payload_digest(fact_revision_id.as_bytes()).to_vec(),
            outcome_evidence_revision_ids: vec![fact_revision_id.to_owned()],
            outcome_evidence_set_digest: payload_digest(fact_revision_id.as_bytes()).to_vec(),
        },
    );
}

fn push_visible(
    events: &mut Vec<CanonicalEventRecord>,
    ids: &CorrectionIds,
    manifest_id: &str,
    fact_revision_id: &str,
    available_at_unix_micros: i64,
) {
    push_event(
        events,
        "FactBecameVisible",
        "WorldSession",
        ids.world_session_id,
        &world::v1::FactBecameVisibleV1 {
            manifest_id: manifest_id.to_owned(),
            fact_revision_id: fact_revision_id.to_owned(),
            world_session_id: ids.world_session_id.to_vec(),
            available_at_unix_micros,
        },
    );
}

fn fact_ref(manifest_id: &str, fact_revision_id: &str) -> common_v2::FactRevisionRef {
    common_v2::FactRevisionRef {
        fact_manifest_id: manifest_id.to_owned(),
        fact_revision_id: fact_revision_id.to_owned(),
        allowlist: (common_v2::fact_revision_ref::Allowlist::Interaction as i32),
    }
}

fn push_observed(
    events: &mut Vec<CanonicalEventRecord>,
    ids: &CorrectionIds,
    cognitive_episode_id: Id,
    manifest_id: &str,
    fact_revision_id: &str,
    observed_at_unix_micros: i64,
) {
    push_event(
        events,
        "ObservedClueRegistered",
        "CognitiveEpisode",
        cognitive_episode_id,
        &character::v1::ObservedClueRegisteredV1 {
            character_id: ids.character_id.to_vec(),
            cognitive_episode_id: cognitive_episode_id.to_vec(),
            fact_ref: Some(fact_ref(manifest_id, fact_revision_id)),
            observed_at_unix_micros,
            exposure_channel: "device_notification".to_owned(),
            exposure_depth: (character::v1::observed_clue_registered_v1::ExposureDepth::FullRead
                as i32),
        },
    );
}

/// Seals `episode` (the episode enforces cutoff and manifest binding), then
/// resolves its appraisal through the gateway contract with no gateway
/// (`NO_NETWORK` fallback) and emits both events.
fn push_sealed(
    events: &mut Vec<CanonicalEventRecord>,
    ids: &CorrectionIds,
    episode: &mut CognitiveEpisode,
    manifest_id: &str,
    candidate_facts: &[CandidateFact<'_>],
    sealed_at_unix_micros: i64,
) {
    let input_digest =
        cognition_input_digest(episode.cognitive_episode_id, manifest_id, candidate_facts);
    episode
        .seal_input(
            0,
            &SealInputRequest {
                manifest_id,
                candidate_facts,
                character_world_time_unix_micros: sealed_at_unix_micros,
                sealed_at_unix_micros,
                input_digest,
            },
        )
        .expect("fixed sequence: Opened -> InputSealed within the cutoff");
    push_event(
        events,
        "CognitionInputSealed",
        "CognitiveEpisode",
        episode.cognitive_episode_id,
        &character::v1::CognitionInputSealedV1 {
            cognitive_episode_id: episode.cognitive_episode_id.to_vec(),
            character_id: ids.character_id.to_vec(),
            interaction_fact_refs: candidate_facts
                .iter()
                .map(|fact| fact_ref(manifest_id, fact.fact_revision_id))
                .collect(),
            admitted_memory_ids: Vec::new(),
            paper_account_ref: ids.paper_account_id.to_vec(),
            paper_account_version: 0,
            interaction_cutoff_unix_micros: episode.interaction_cutoff_unix_micros,
            sealed_at_unix_micros,
            input_digest: input_digest.to_vec(),
        },
    );

    let resolution = {
        let input = SealedCognitionInput::from_sealed_episode(episode, SCHEMA)
            .expect("fixed sequence: input just sealed");
        resolve_appraisal_once(None, &input)
    };
    let AppraisalResolution::FallbackUsed {
        appraisal,
        reason: FallbackReason::NoNetwork,
    } = &resolution
    else {
        unreachable!("no gateway is offered, so only the NO_NETWORK fallback can resolve");
    };
    episode
        .resolve_appraisal(1, resolution.appraisal_ref())
        .expect("fixed sequence: InputSealed -> AppraisalResolved");
    push_event(
        events,
        "CoreAppraisalFallbackUsed",
        "CognitiveEpisode",
        episode.cognitive_episode_id,
        &character::v1::CoreAppraisalFallbackUsedV1 {
            cognitive_episode_id: episode.cognitive_episode_id.to_vec(),
            appraisal: Some(character::v1::CognitionAppraisalV1 {
                contract_version: SCHEMA.output_schema_revision.to_owned(),
                fact_appraisals: appraisal
                    .fact_revision_ids
                    .iter()
                    .map(|fact_revision_id| character::v1::FactAppraisal {
                        fact_revision_id: fact_revision_id.clone(),
                        relevance_bp: appraisal.relevance_bp,
                        reliability_bp: appraisal.reliability_bp,
                        uncertainty_bp: appraisal.uncertainty_bp,
                        supports_proposition_ids: Vec::new(),
                        challenges_proposition_ids: Vec::new(),
                    })
                    .collect(),
                interpretation_candidates: Vec::new(),
                social_interpretation_codes: Vec::new(),
                attention_proposal_refs: appraisal.fact_revision_ids.clone(),
            }),
            reason_code: (character::v1::FallbackReasonCode::NoNetwork as i32),
            fallback_policy_revision: FALLBACK_POLICY_REVISION.to_owned(),
        },
    );
}
