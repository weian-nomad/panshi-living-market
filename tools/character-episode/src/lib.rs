#![forbid(unsafe_code)]

//! The V5 one-character canonical golden episode
//! (`IMPLEMENTATION-HANDOFF.md` "Build the one-character canonical spine",
//! `docs/v5/system-design.md` §19 Phase 2). Fully synthetic: one adult
//! fictional character, one synthetic sealed market episode.
//!
//! This crate's pure computation (`golden_episode()`) has no I/O, no clock,
//! and no dependence on `panshi-event-store`/`sqlx`/`tokio` -- exactly like
//! `panshi-simulator`'s `sealed_episode_001()`, it is meant to be built and
//! run identically for native and `wasm32-wasip1` targets
//! (`tools/verify-v5-kernel-parity.sh`) to prove canonical byte parity.
//! Appending the produced events to `PostgreSQL` and rebuilding projections
//! from them is a separate, `std`/`tokio`/`sqlx`-only concern exercised by
//! this crate's integration tests, not by `golden_episode()` itself.
//!
//! Cognition in this slice exercises ONLY the deterministic fallback path
//! (`panshi_character_domain::fallback`): no live model call is made,
//! because heavy model inference belongs on approved external capacity, not
//! this coordination machine (`IMPLEMENTATION-HANDOFF.md` "Before touching
//! the worktree" item 7). "Deterministic no-network fallback without
//! retrying for a preferred result" is itself a required Phase-2 slice
//! property, not a shortcut around one.

use panshi_character_domain::{
    character::{CommitmentRationale, DynamicState, FourAxisPreference},
    cognition::{
        ActionIntentRef, ActionKind as DomainActionKind, AppraisalRef, AppraisalSource,
        AttentionRef, CandidateFact, CognitiveEpisode, SealInputRequest, SpeechActOutcome,
    },
    fallback::{
        FALLBACK_POLICY_REVISION, SealFallbackUtteranceRequest, deterministic_appraisal_fallback,
        fallback_appraisal_digest, seal_fallback_utterance,
    },
    memory::{MemoryKind, MemoryLedger, MemoryRecord, MemoryVisibility},
    story::{StoryChapter, StorySourceSet},
    utterance::UtteranceArtifact,
};
use panshi_decision_kernel::{
    Fixed,
    character_action::{
        ActionUtilityComponents, ActionUtilityWeights, AttentionComponents, AttentionWeights,
        action_utility_v1, attention_score,
    },
};
use panshi_paper_ledger::{
    account::{JournalEntryKind, JournalPosting, PaperAccount, PaperAccountPolicy},
    order::{OrderSide, PaperOrder},
    position::{Lot, PaperPosition},
};
use panshi_protocol::{canonical_bytes, character, common::v2 as common_v2, portfolio, story, world};
use prost::Message;
use sha2::{Digest as _, Sha256};

pub mod correction;
pub mod projection;
pub mod public_api;
pub mod slice;

/// Derives a deterministic 16-byte ID from a stable tag string, matching the
/// tagged-SHA-256 convention already used across this codebase's canonical
/// digests (e.g. `panshi_protocol::domain_digest`).
#[must_use]
pub fn derive_id(tag: &str) -> [u8; 16] {
    let mut hasher = Sha256::new();
    hasher.update(b"PSZS/V5_GOLDEN_ID/v1\0");
    hasher.update(tag.as_bytes());
    let digest: [u8; 32] = hasher.finalize().into();
    let mut id = [0_u8; 16];
    id.copy_from_slice(&digest[..16]);
    id
}

fn payload_digest(payload: &[u8]) -> [u8; 32] {
    panshi_protocol::domain_digest(b"PSZS/V5_GOLDEN_EVENT_PAYLOAD/v1\0", payload)
}

/// One canonical event in the golden episode's fixed emission order.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CanonicalEventRecord {
    pub event_type: &'static str,
    pub stream_type: &'static str,
    pub stream_id: [u8; 16],
    pub schema_version: u32,
    pub payload_bytes: Vec<u8>,
    pub payload_digest: [u8; 32],
}

/// Stable identifiers for every aggregate stream this episode touches, so
/// integration tests and projections can address them without recomputing
/// `derive_id` tags themselves.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct EpisodeIds {
    pub logical_cell_id: [u8; 16],
    pub world_session_id: [u8; 16],
    pub character_id: [u8; 16],
    pub cognitive_episode_id: [u8; 16],
    pub paper_account_id: [u8; 16],
    pub paper_order_id: [u8; 16],
    pub paper_position_id: [u8; 16],
    pub semantic_speech_act_id: [u8; 16],
    pub utterance_artifact_id: [u8; 16],
    pub chapter_id: [u8; 16],
}

impl EpisodeIds {
    #[must_use]
    pub fn v1() -> Self {
        Self {
            logical_cell_id: derive_id("v5-golden/logical-cell"),
            world_session_id: derive_id("v5-golden/world-session"),
            character_id: derive_id("v5-golden/character"),
            cognitive_episode_id: derive_id("v5-golden/cognitive-episode"),
            paper_account_id: derive_id("v5-golden/paper-account"),
            paper_order_id: derive_id("v5-golden/paper-order"),
            paper_position_id: derive_id("v5-golden/paper-position"),
            semantic_speech_act_id: derive_id("v5-golden/speech-act"),
            utterance_artifact_id: derive_id("v5-golden/utterance-artifact"),
            chapter_id: derive_id("v5-golden/story-chapter"),
        }
    }
}

/// The synthetic sealed market episode this fixture consumes. All fields are
/// fully fictional; the "company" is not a real security
/// (`docs/v5/system-design.md` §6 requires this repo to consume only
/// released, versioned sealed-fact contracts -- for this Phase-2 slice we
/// stand in a self-contained fixture rather than reaching any real or
/// separate-repo upstream).
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SyntheticMarketEpisode {
    pub manifest_id: &'static str,
    pub fact_revision_id: &'static str,
    pub interaction_cutoff_unix_micros: i64,
    pub evidence_cutoff_unix_micros: i64,
    pub sealed_reference_price: Fixed,
    pub price_observed_at_unix_micros: i64,
}

impl SyntheticMarketEpisode {
    #[must_use]
    pub const fn v1() -> Self {
        Self {
            manifest_id: "wfm-v5-golden-001",
            fact_revision_id: "fact-v5-golden-001",
            interaction_cutoff_unix_micros: 100_000,
            evidence_cutoff_unix_micros: 200_000,
            sealed_reference_price: Fixed::from_raw(100 * Fixed::SCALE),
            price_observed_at_unix_micros: 20_000,
        }
    }
}

/// The full golden episode: every canonical event in fixed emission order,
/// plus the aggregate IDs and market fixture used to build them.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GoldenEpisode {
    pub ids: EpisodeIds,
    pub market: SyntheticMarketEpisode,
    pub events: Vec<CanonicalEventRecord>,
}

/// Builds the one-character canonical golden episode deterministically.
/// Calling this twice always returns byte-identical `payload_bytes` for
/// every event -- this is the property `tools/verify-v5-kernel-parity.sh`
/// checks across native and WASI builds.
///
/// # Panics
///
/// Panics only on a build-time invariant violation (fixed-point overflow in
/// this fixture's frozen inputs, or a domain state-machine transition this
/// fixture's own fixed sequence should never hit). Either would be a defect
/// in this crate, not recoverable runtime input, matching
/// `panshi-simulator`'s existing convention for its own golden fixture.
#[must_use]
#[allow(clippy::too_many_lines)]
pub fn golden_episode() -> GoldenEpisode {
    let ids = EpisodeIds::v1();
    let market = SyntheticMarketEpisode::v1();
    let mut events = Vec::new();

    // -- 1. manifest accepted -----------------------------------------------
    let manifest_event = world::v1::FactManifestAcceptedV1 {
        manifest_id: market.manifest_id.to_owned(),
        manifest_hash: payload_digest(market.manifest_id.as_bytes()).to_vec(),
        market_session_id: "session-v5-golden-001".to_owned(),
        market_date_taipei: "2026-07-23".to_owned(),
        interaction_cutoff_unix_micros: market.interaction_cutoff_unix_micros,
        evidence_cutoff_unix_micros: market.evidence_cutoff_unix_micros,
        rights_manifest_id: "rights-v5-golden-001".to_owned(),
        interaction_fact_revision_ids: vec![market.fact_revision_id.to_owned()],
        interaction_fact_set_digest: payload_digest(market.fact_revision_id.as_bytes()).to_vec(),
        outcome_evidence_revision_ids: vec![market.fact_revision_id.to_owned()],
        outcome_evidence_set_digest: payload_digest(market.fact_revision_id.as_bytes()).to_vec(),
    };
    push_event(
        &mut events,
        "FactManifestAccepted",
        "FactManifestMirror",
        ids.world_session_id,
        &manifest_event,
    );

    // -- 2. fact visible ------------------------------------------------------
    let fact_visible = world::v1::FactBecameVisibleV1 {
        manifest_id: market.manifest_id.to_owned(),
        fact_revision_id: market.fact_revision_id.to_owned(),
        world_session_id: ids.world_session_id.to_vec(),
        available_at_unix_micros: 10_000,
    };
    push_event(
        &mut events,
        "FactBecameVisible",
        "WorldSession",
        ids.world_session_id,
        &fact_visible,
    );

    // -- Character origin (out of the fixed episode chain proper, but the
    // character must exist before it can observe anything) -----------------
    let four_axis = FourAxisPreference {
        social_orientation_bp: -3_600, // introspective, matches character-story-engine.md's worked example (內省 68 => low/introspective end)
        information_orientation_bp: 2_200,
        decision_orientation_bp: 4_800,
        closure_orientation_bp: 1_400,
    };
    let origin_digest = payload_digest(b"v5-golden-character-origin/v1");
    let character_origin = character::v1::CharacterOriginSealedV1 {
        character_id: ids.character_id.to_vec(),
        origin_seed_commitment: "seed-v5-golden-001".to_owned(),
        generation_policy_revision: "character-generation-policy/v1".to_owned(),
        statistical_pack_revision: "statistical-pack/v1".to_owned(),
        birth_date: "1998-03-14".to_owned(),
        birth_region: "TW-synthetic".to_owned(),
        occupation_group: "corporate_research_assistant".to_owned(),
        income_band: "median".to_owned(),
        four_axis: Some(character::v1::FourAxisPreference {
            social_orientation_bp: four_axis.social_orientation_bp,
            information_orientation_bp: four_axis.information_orientation_bp,
            decision_orientation_bp: four_axis.decision_orientation_bp,
            closure_orientation_bp: four_axis.closure_orientation_bp,
        }),
        model_core_id: "gemma4-26b".to_owned(),
        origin_digest: origin_digest.to_vec(),
    };
    push_event(
        &mut events,
        "CharacterOriginSealed",
        "Character",
        ids.character_id,
        &character_origin,
    );

    // -- 3. observed clue -----------------------------------------------------
    let observed_clue = character::v1::ObservedClueRegisteredV1 {
        character_id: ids.character_id.to_vec(),
        cognitive_episode_id: ids.cognitive_episode_id.to_vec(),
        fact_ref: Some(common_v2::FactRevisionRef {
            fact_manifest_id: market.manifest_id.to_owned(),
            fact_revision_id: market.fact_revision_id.to_owned(),
            allowlist: (common_v2::fact_revision_ref::Allowlist::Interaction as i32),
        }),
        observed_at_unix_micros: 15_000,
        exposure_channel: "device_notification".to_owned(),
        exposure_depth: (character::v1::observed_clue_registered_v1::ExposureDepth::FullRead as i32),
    };
    push_event(
        &mut events,
        "ObservedClueRegistered",
        "CognitiveEpisode",
        ids.cognitive_episode_id,
        &observed_clue,
    );

    let mut episode = CognitiveEpisode::open(
        ids.cognitive_episode_id,
        ids.character_id,
        market.interaction_cutoff_unix_micros,
    );

    // -- CognitionInputSealed --------------------------------------------------
    // The episode enforces the three-way cutoff itself: the character's world
    // time at seal is the seal instant, and the one candidate fact is the one
    // `FactBecameVisible` above made available.
    let input_digest = payload_digest(b"v5-golden-cognition-input/v1");
    episode
        .bind_manifest(market.manifest_id)
        .expect("fixed episode sequence: manifest bound before seal");
    episode
        .seal_input(
            0,
            &SealInputRequest {
                manifest_id: market.manifest_id,
                candidate_facts: &[CandidateFact {
                    fact_revision_id: market.fact_revision_id,
                    available_at_unix_micros: fact_visible.available_at_unix_micros,
                }],
                character_world_time_unix_micros: 16_000,
                sealed_at_unix_micros: 16_000,
                input_digest,
            },
        )
        .expect("fixed episode sequence: Opened -> InputSealed");
    let cognition_input_sealed = character::v1::CognitionInputSealedV1 {
        cognitive_episode_id: ids.cognitive_episode_id.to_vec(),
        character_id: ids.character_id.to_vec(),
        interaction_fact_refs: vec![common_v2::FactRevisionRef {
            fact_manifest_id: market.manifest_id.to_owned(),
            fact_revision_id: market.fact_revision_id.to_owned(),
            allowlist: (common_v2::fact_revision_ref::Allowlist::Interaction as i32),
        }],
        admitted_memory_ids: Vec::new(),
        paper_account_ref: ids.paper_account_id.to_vec(),
        paper_account_version: 0,
        interaction_cutoff_unix_micros: market.interaction_cutoff_unix_micros,
        sealed_at_unix_micros: 16_000,
        input_digest: input_digest.to_vec(),
    };
    push_event(
        &mut events,
        "CognitionInputSealed",
        "CognitiveEpisode",
        ids.cognitive_episode_id,
        &cognition_input_sealed,
    );

    // -- 4. structured appraisal or deterministic fallback ----------------------
    let fallback_appraisal =
        deterministic_appraisal_fallback(vec![market.fact_revision_id.to_owned()]);
    let appraisal_digest = fallback_appraisal_digest(&fallback_appraisal);
    episode
        .resolve_appraisal(
            1,
            AppraisalRef {
                source: AppraisalSource::DeterministicFallback,
                appraisal_digest,
            },
        )
        .expect("fixed episode sequence: InputSealed -> AppraisalResolved");
    let appraisal_wire = character::v1::CognitionAppraisalV1 {
        contract_version: "cognition-appraisal/v1".to_owned(),
        fact_appraisals: vec![character::v1::FactAppraisal {
            fact_revision_id: market.fact_revision_id.to_owned(),
            relevance_bp: fallback_appraisal.relevance_bp,
            reliability_bp: fallback_appraisal.reliability_bp,
            uncertainty_bp: fallback_appraisal.uncertainty_bp,
            supports_proposition_ids: Vec::new(),
            challenges_proposition_ids: Vec::new(),
        }],
        interpretation_candidates: Vec::new(),
        social_interpretation_codes: Vec::new(),
        attention_proposal_refs: vec![market.fact_revision_id.to_owned()],
    };
    let core_appraisal_fallback_used = character::v1::CoreAppraisalFallbackUsedV1 {
        cognitive_episode_id: ids.cognitive_episode_id.to_vec(),
        appraisal: Some(appraisal_wire),
        reason_code: (character::v1::FallbackReasonCode::NoNetwork as i32),
        fallback_policy_revision: FALLBACK_POLICY_REVISION.to_owned(),
    };
    push_event(
        &mut events,
        "CoreAppraisalFallbackUsed",
        "CognitiveEpisode",
        ids.cognitive_episode_id,
        &core_appraisal_fallback_used,
    );

    // -- attention -------------------------------------------------------------
    // FOMO-elevated dynamic state, matching the shape of
    // docs/v5/character-story-engine.md's worked example (missing the first
    // move raises FOMO); this Phase-2 fixture starts the character already at
    // an elevated FOMO reading rather than simulating the miss itself.
    let dynamic_state = DynamicState {
        fomo_bp: 4_600,
        confidence_bp: 2_000,
        uncertainty_load_bp: 6_000,
        ..DynamicState::NEUTRAL
    };
    let attention_components = AttentionComponents {
        core_appraisal: Fixed::from_raw(i64::from(fallback_appraisal.relevance_bp) * 100),
        current_goal_and_need: Fixed::from_raw(i64::from(dynamic_state.fomo_bp) * 100),
        occupation_skill_and_existing_focus: Fixed::from_raw(300_000),
        memory_trigger: Fixed::ZERO,
        social_transmission_and_source_trust: Fixed::ZERO,
        natal_symbolic_motif: Fixed::from_raw(200_000),
        scene_accessibility: Fixed::ONE,
        seeded_tie_noise: Fixed::ZERO,
    };
    let attention_total = attention_score(attention_components, AttentionWeights::V1)
        .expect("fixture components stay within representable range");
    let attention_digest = payload_digest(&attention_total.raw().to_be_bytes());
    episode
        .commit_attention(
            2,
            AttentionRef {
                attention_digest,
                attention_policy_revision: "attention-policy/v1",
            },
        )
        .expect("fixed episode sequence: AppraisalResolved -> AttentionCommitted");
    let attention_committed = character::v1::AttentionCommittedV1 {
        cognitive_episode_id: ids.cognitive_episode_id.to_vec(),
        selected_fact_revision_ids: vec![market.fact_revision_id.to_owned()],
        missed_high_salience_fact_revision_ids: Vec::new(),
        attention_policy_revision: "attention-policy/v1".to_owned(),
        tie_break_seed_ref: payload_digest(b"v5-golden-attention-seed").to_vec(),
    };
    push_event(
        &mut events,
        "AttentionCommitted",
        "CognitiveEpisode",
        ids.cognitive_episode_id,
        &attention_committed,
    );

    // -- 5. autonomous action intent / semantic speech act ----------------------
    let utility_components = ActionUtilityComponents {
        evidence_and_belief_fit: Fixed::from_raw(
            i64::from(fallback_appraisal.relevance_bp) * 100,
        ),
        current_goal_and_need_fit: Fixed::from_raw(i64::from(dynamic_state.fomo_bp) * 100),
        dynamic_emotion_and_agency: Fixed::from_raw(i64::from(dynamic_state.fomo_bp) * 80),
        activated_memory: Fixed::ZERO,
        relationship_impulse: Fixed::ZERO,
        cognitive_pattern_activation: Fixed::from_raw(500_000), // FOMO pattern trigger active
        habit_and_skill_fluency: Fixed::from_raw(300_000),
    };
    let buy_cost = Fixed::from_raw(50_000); // time/money/body/social cost mask, well under the hard limits
    let buy_utility = action_utility_v1(utility_components, ActionUtilityWeights::V1, buy_cost)
        .expect("fixture utility stays within representable range");
    let no_action_utility = Fixed::ZERO;
    assert!(
        buy_utility > no_action_utility,
        "fixture is designed so PAPER_BUY is the highest-utility legal candidate"
    );

    let action_digest = payload_digest(&buy_utility.raw().to_be_bytes());
    episode
        .commit_action_intent(
            3,
            ActionIntentRef {
                action: DomainActionKind::PaperBuy,
                action_digest,
                behavior_policy_revision: "behavior-policy/v1",
            },
        )
        .expect("fixed episode sequence: AttentionCommitted -> ActionIntentCommitted");
    let action_intent_committed = character::v1::AutonomousActionIntentCommittedV1 {
        cognitive_episode_id: ids.cognitive_episode_id.to_vec(),
        character_id: ids.character_id.to_vec(),
        paper_account_ref: ids.paper_account_id.to_vec(),
        paper_account_version: 0,
        action: (character::v1::ActionKind::PaperBuy as i32),
        security_id: "PSZS-DEMO".to_owned(),
        quantity_or_target_weight_fixed: 1_000 * Fixed::SCALE,
        committed_at_unix_micros: 18_000,
        expires_at_unix_micros: 90_000,
        thesis_revision: "thesis-v5-golden-001".to_owned(),
        perceived_fact_revision_ids: vec![market.fact_revision_id.to_owned()],
        confidence_bp: 5_000,
        behavior_policy_revision: "behavior-policy/v1".to_owned(),
        first_utility_fixed_be: buy_utility.raw().to_be_bytes().to_vec(),
        second_utility_fixed_be: no_action_utility.raw().to_be_bytes().to_vec(),
    };
    push_event(
        &mut events,
        "AutonomousActionIntentCommitted",
        "CognitiveEpisode",
        ids.cognitive_episode_id,
        &action_intent_committed,
    );

    // CommitmentRationaleSealed: structured, quote-free (CharacterLife owns
    // this, not CognitiveEpisode).
    let rationale = CommitmentRationale {
        thesis_id: derive_id("v5-golden/thesis-001"),
        security_id_hash: payload_digest(b"PSZS-DEMO"),
        opened_at_unix_micros: 18_000,
        intended_horizon_unix_micros: 90_000,
        confidence: Fixed::from_raw(500_000),
        invalidation_condition_code: "two_session_momentum_expired",
    };
    let commitment_rationale_sealed = character::v1::CharacterStateAdvancedV1 {
        character_id: ids.character_id.to_vec(),
        prior_state: None,
        next_state: Some(character::v1::DynamicStateV1 {
            valence_bp: dynamic_state.valence_bp,
            arousal_bp: dynamic_state.arousal_bp,
            stress_bp: dynamic_state.stress_bp,
            fatigue_bp: dynamic_state.fatigue_bp,
            confidence_bp: dynamic_state.confidence_bp,
            fomo_bp: dynamic_state.fomo_bp,
            uncertainty_load_bp: dynamic_state.uncertainty_load_bp,
        }),
        trigger_source_event_ids: vec![hex_id(ids.cognitive_episode_id)],
        state_policy_revision: "character-state-policy/v1".to_owned(),
    };
    push_event(
        &mut events,
        "CommitmentRationaleSealed",
        "CharacterLife",
        ids.character_id,
        &commitment_rationale_sealed,
    );
    let _ = rationale; // carried for documentation/tests; the wire payload above is its canonical projection for this fixture

    // -- semantic speech act + immutable utterance seal --------------------------
    let semantic_speech_act = character::v1::SemanticSpeechActCommittedV1 {
        semantic_speech_act_id: ids.semantic_speech_act_id.to_vec(),
        character_id: ids.character_id.to_vec(),
        cognitive_episode_id: ids.cognitive_episode_id.to_vec(),
        act_kind: (character::v1::SpeechActKind::Assert as i32),
        surface_kind: (character::v1::SurfaceKind::PublicSpeech as i32),
        proposition_refs: vec!["thesis-v5-golden-001".to_owned()],
        support_fact_revision_ids: vec![market.fact_revision_id.to_owned()],
        recipient_character_ids: Vec::new(),
        audience_scope: "public_current".to_owned(),
        world_time_unix_micros: 18_500,
        source_state_digest: payload_digest(b"v5-golden-source-state").to_vec(),
        behavior_policy_revision: "behavior-policy/v1".to_owned(),
        // Unset on purpose: the golden speech act attributes no outcome, and
        // an unset message field encodes to zero bytes, so the frozen parity
        // payload is unchanged.
        outcome_attribution: None,
    };
    push_event(
        &mut events,
        "SemanticSpeechActCommitted",
        "CognitiveEpisode",
        ids.cognitive_episode_id,
        &semantic_speech_act,
    );

    let utterance_artifact = seal_fallback_utterance(SealFallbackUtteranceRequest {
        utterance_artifact_id: ids.utterance_artifact_id,
        character_id: ids.character_id,
        semantic_speech_act_event_id: ids.semantic_speech_act_id,
        action: DomainActionKind::PaperBuy,
        sealed_at_unix_micros: 18_600,
    });
    let utterance_stream_id = UtteranceArtifact::stream_id_for(
        ids.semantic_speech_act_id,
        utterance_artifact.surface_kind,
    );
    let public_claim_made = to_wire_utterance(&utterance_artifact, &ids, &market);
    push_event(
        &mut events,
        "PublicClaimMade",
        "UtteranceArtifact",
        utterance_stream_id,
        &public_claim_made,
    );

    episode
        .commit_speech_act(
            4,
            SpeechActOutcome::Sealed {
                utterance_artifact_id: ids.utterance_artifact_id,
            },
        )
        .expect("fixed episode sequence: ActionIntentCommitted -> SpeechActCommitted");
    episode
        .close(5)
        .expect("fixed episode sequence: SpeechActCommitted -> Closed");

    // -- paper account bootstrap, order, fill --------------------------------
    let mut paper_account =
        PaperAccount::open(ids.paper_account_id, ids.character_id, PaperAccountPolicy::V1);
    push_event(
        &mut events,
        "PaperAccountOpened",
        "PaperAccount",
        ids.paper_account_id,
        &portfolio::v1::PaperAccountOpenedV1 {
            paper_account_id: ids.paper_account_id.to_vec(),
            character_id: ids.character_id.to_vec(),
            currency: "TWD".to_owned(),
            account_policy_revision: "paper-account-policy/v1".to_owned(),
        },
    );
    paper_account
        .initialize_cash(0)
        .expect("fixed sequence: freshly opened account");
    push_event(
        &mut events,
        "PaperCashInitialized",
        "PaperAccount",
        ids.paper_account_id,
        &portfolio::v1::PaperCashInitializedV1 {
            paper_account_id: ids.paper_account_id.to_vec(),
            initial_cash_fixed: paper_account.cash.raw(),
        },
    );

    let quantity = Fixed::from_raw(1_000 * Fixed::SCALE);
    let notional = market
        .sealed_reference_price
        .checked_mul(quantity)
        .expect("fixture notional fits Fixed");
    let fee = Fixed::from_raw(20 * Fixed::SCALE);
    paper_account
        .validate_commit(
            notional,
            PaperAccountPolicy::V1.initial_cash,
            paper_account
                .cash
                .checked_sub(notional)
                .and_then(|value| value.checked_sub(fee))
                .expect("fixture stays within Fixed range"),
        )
        .expect("fixture respects the 25%/5% policy gates");

    let mut paper_order = PaperOrder::submit(
        ids.paper_order_id,
        ids.paper_account_id,
        payload_digest(b"PSZS-DEMO"),
        OrderSide::Buy,
        quantity,
        18_000,
        90_000,
    );
    push_event(
        &mut events,
        "PaperOrderSubmitted",
        "PaperOrder",
        ids.paper_order_id,
        &portfolio::v1::PaperOrderSubmittedV1 {
            paper_order_id: ids.paper_order_id.to_vec(),
            paper_account_id: ids.paper_account_id.to_vec(),
            autonomous_action_intent_event_ref: hex_id(ids.cognitive_episode_id).into_bytes(),
            security_id: "PSZS-DEMO".to_owned(),
            side: (portfolio::v1::OrderSide::Buy as i32),
            order_type: (portfolio::v1::OrderType::MarketNextEligiblePrice as i32),
            quantity_fixed: quantity.raw(),
            committed_at_unix_micros: 18_000,
            expires_at_unix_micros: 90_000,
            execution_ruleset_revision: "execution-ruleset/v1".to_owned(),
        },
    );

    // ApplyPaperFill: PaperOrder + PaperAccount + PaperPosition atomically
    // (docs/v5/system-design.md §5.3).
    paper_order
        .fill(0, market.price_observed_at_unix_micros)
        .expect("fixed sequence: first eligible price arrives after commit");
    push_event(
        &mut events,
        "PaperOrderFilled",
        "PaperOrder",
        ids.paper_order_id,
        &portfolio::v1::PaperOrderFilledV1 {
            fill_transaction_id: derive_id("v5-golden/fill-001").to_vec(),
            paper_order_id: ids.paper_order_id.to_vec(),
            paper_account_id: ids.paper_account_id.to_vec(),
            filled_quantity_fixed: quantity.raw(),
            price_source: Some(portfolio::v1::PriceSourceRef {
                fact_manifest_id: market.manifest_id.to_owned(),
                fact_revision_id: market.fact_revision_id.to_owned(),
                sealed_price_fixed: market.sealed_reference_price.raw(),
                price_observed_at_unix_micros: market.price_observed_at_unix_micros,
            }),
            fee_fixed: fee.raw(),
            tax_fixed: 0,
            execution_ruleset_revision: "execution-ruleset/v1".to_owned(),
        },
    );

    let postings = [
        JournalPosting {
            kind: JournalEntryKind::Cash,
            amount: notional
                .checked_add(fee)
                .expect("fixture fits Fixed")
                .checked_mul(Fixed::NEG_ONE)
                .expect("fixture fits Fixed"),
        },
        JournalPosting {
            kind: JournalEntryKind::Position,
            amount: notional,
        },
        JournalPosting {
            kind: JournalEntryKind::FeeExpense,
            amount: fee,
        },
    ];
    let (cash_before, cash_after) = paper_account
        .post_journal(1, &postings)
        .expect("fixture postings balance to zero and cash stays non-negative");
    push_event(
        &mut events,
        "PaperAccountJournalPosted",
        "PaperAccount",
        ids.paper_account_id,
        &portfolio::v1::PaperAccountJournalPostedV1 {
            paper_account_id: ids.paper_account_id.to_vec(),
            fill_transaction_id: derive_id("v5-golden/fill-001").to_vec(),
            postings: postings
                .iter()
                .map(|posting| portfolio::v1::JournalPostingV1 {
                    kind: (to_wire_journal_kind(posting.kind) as i32),
                    security_id: if posting.kind == JournalEntryKind::Position {
                        "PSZS-DEMO".to_owned()
                    } else {
                        String::new()
                    },
                    amount_fixed: posting.amount.raw(),
                })
                .collect(),
            cash_before_fixed: cash_before.raw(),
            cash_after_fixed: cash_after.raw(),
            reserved_cash_before_fixed: 0,
            reserved_cash_after_fixed: 0,
            paper_order_event_ref: hex_id(ids.paper_order_id).into_bytes(),
            paper_position_event_ref: hex_id(ids.paper_position_id).into_bytes(),
        },
    );

    let paper_position = PaperPosition::open(
        ids.paper_position_id,
        ids.paper_account_id,
        payload_digest(b"PSZS-DEMO"),
        Lot {
            lot_id: derive_id("v5-golden/lot-001"),
            quantity,
            cost_basis: market.sealed_reference_price,
            opened_at_unix_micros: market.price_observed_at_unix_micros,
        },
    );
    push_event(
        &mut events,
        "PaperPositionOpened",
        "PaperPosition",
        ids.paper_position_id,
        &portfolio::v1::PaperPositionOpenedV1 {
            paper_position_id: ids.paper_position_id.to_vec(),
            paper_account_id: ids.paper_account_id.to_vec(),
            security_id: "PSZS-DEMO".to_owned(),
            initial_lot: Some(portfolio::v1::Lot {
                lot_id: derive_id("v5-golden/lot-001").to_vec(),
                quantity_fixed: quantity.raw(),
                cost_basis_fixed: market.sealed_reference_price.raw(),
                opened_at_unix_micros: market.price_observed_at_unix_micros,
                opening_fill_transaction_id: derive_id("v5-golden/fill-001").to_vec(),
            }),
            fill_transaction_id: derive_id("v5-golden/fill-001").to_vec(),
        },
    );
    let _ = paper_position; // carried for documentation/tests; wire payload above is canonical

    // -- memory update --------------------------------------------------------
    let memory_id = derive_id("v5-golden/memory-001");
    let mut memory_ledger = MemoryLedger::new();
    let memory_record = MemoryRecord {
        memory_id,
        character_id: ids.character_id,
        kind: MemoryKind::Episodic,
        source_event_digest: payload_digest(&hex_id(ids.paper_order_id).into_bytes()),
        formed_at_unix_micros: 19_000,
        salience_bp: 6_000,
        confidence_bp: 7_000,
        valence_bp: -1_000,
        visibility: MemoryVisibility::SubscriberArchive,
    };
    memory_ledger
        .form(memory_record)
        .expect("fixed sequence: first memory for this fixture");
    push_event(
        &mut events,
        "MemoryFormed",
        "MemoryLedger",
        ids.character_id,
        &character::v1::MemoryFormedV1 {
            memory_id: memory_id.to_vec(),
            character_id: ids.character_id.to_vec(),
            kind: (character::v1::MemoryKind::Episodic as i32),
            source_event_ids: vec![ids.paper_order_id.to_vec()],
            formed_at_unix_micros: 19_000,
            salience_bp: memory_record.salience_bp,
            confidence_bp: memory_record.confidence_bp,
            valence_bp: memory_record.valence_bp,
            decay_policy_revision: "memory-decay-policy/v1".to_owned(),
            visibility: (character::v1::memory_formed_v1::Visibility::SubscriberArchive as i32),
        },
    );

    // -- story chapter ----------------------------------------------------------
    let source_set = StorySourceSet {
        chapter_id: ids.chapter_id,
        character_ids: vec![ids.character_id],
        source_event_ids: vec![ids.cognitive_episode_id, ids.paper_order_id, memory_id],
        utterance_artifact_ids: vec![ids.utterance_artifact_id],
        source_set_digest: payload_digest(b"v5-golden-story-source-set"),
    };
    let story_chapter =
        StoryChapter::compose(ids.chapter_id, source_set.clone()).expect("non-empty source set");
    let story_source_set_wire = story::v1::StorySourceSetV1 {
        chapter_id: ids.chapter_id.to_vec(),
        character_ids: vec![ids.character_id.to_vec()],
        source_event_ids: vec![
            ids.cognitive_episode_id.to_vec(),
            ids.paper_order_id.to_vec(),
            memory_id.to_vec(),
        ],
        utterance_artifact_refs: vec![story::v1::UtteranceArtifactRef {
            utterance_artifact_id: ids.utterance_artifact_id.to_vec(),
            canonical_text_sha256: utterance_artifact.canonical_text_sha256.to_vec(),
        }],
        source_set_digest: source_set.source_set_digest.to_vec(),
        market_fact_refs: vec![market.fact_revision_id.to_owned()],
        time_range_from_unix_micros: 10_000,
        time_range_to_unix_micros: 19_000,
        visibility_epoch: 1,
        narrative_policy_revision: "narrative-policy/v1".to_owned(),
    };
    let story_chapter_composed = story::v1::StoryChapterComposedV1 {
        chapter_id: ids.chapter_id.to_vec(),
        source_set: Some(story_source_set_wire),
        segments: vec![
            story::v1::NarrativeSegmentV1 {
                segment_id: "segment-1".to_owned(),
                variant: Some(story::v1::narrative_segment_v1::Variant::CharacterClaim(
                    story::v1::narrative_segment_v1::CharacterClaim {
                        utterance_artifact_id: ids.utterance_artifact_id.to_vec(),
                        canonical_text_sha256: utterance_artifact.canonical_text_sha256.to_vec(),
                        source_refs: vec![hex_id(ids.semantic_speech_act_id)],
                    },
                )),
            },
            story::v1::NarrativeSegmentV1 {
                segment_id: "segment-2".to_owned(),
                variant: Some(story::v1::narrative_segment_v1::Variant::NarratorText(
                    story::v1::narrative_segment_v1::ObservableOrEditorialBridge {
                        perspective: (story::v1::SegmentPerspective::Observable as i32),
                        truth_class: (common_v2::TruthClass::SimulatedNarrative as i32),
                        text: "He built a small paper position after the new public data landed."
                            .to_owned(),
                        source_refs: vec![hex_id(ids.paper_order_id)],
                    },
                )),
            },
        ],
        chapter_revision: story_chapter.revision,
    };
    push_event(
        &mut events,
        "StoryChapterComposed",
        "StoryChapter",
        ids.chapter_id,
        &story_chapter_composed,
    );

    let mut story_chapter = story_chapter;
    story_chapter.publish(0).expect("fixed sequence: Composed -> Published");
    push_event(
        &mut events,
        "StoryChapterPublished",
        "StoryChapter",
        ids.chapter_id,
        &story::v1::StoryChapterPublishedV1 {
            chapter_id: ids.chapter_id.to_vec(),
            chapter_revision: story_chapter.revision,
            source_set_digest: source_set.source_set_digest.to_vec(),
            visibility_epoch: 1,
            published_at_unix_micros: 20_000,
        },
    );

    GoldenEpisode { ids, market, events }
}

fn push_event<M: Message>(
    events: &mut Vec<CanonicalEventRecord>,
    event_type: &'static str,
    stream_type: &'static str,
    stream_id: [u8; 16],
    message: &M,
) {
    let payload_bytes = canonical_bytes(message);
    let digest = payload_digest(&payload_bytes);
    events.push(CanonicalEventRecord {
        event_type,
        stream_type,
        stream_id,
        schema_version: 1,
        payload_bytes,
        payload_digest: digest,
    });
}

fn hex_id(id: [u8; 16]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut value = String::with_capacity(32);
    for byte in id {
        value.push(char::from(DIGITS[usize::from(byte >> 4)]));
        value.push(char::from(DIGITS[usize::from(byte & 0x0f)]));
    }
    value
}

fn to_wire_journal_kind(kind: JournalEntryKind) -> portfolio::v1::JournalEntryKind {
    match kind {
        JournalEntryKind::Cash => portfolio::v1::JournalEntryKind::Cash,
        JournalEntryKind::Position => portfolio::v1::JournalEntryKind::Position,
        JournalEntryKind::FeeExpense => portfolio::v1::JournalEntryKind::FeeExpense,
        JournalEntryKind::TaxExpense => portfolio::v1::JournalEntryKind::TaxExpense,
        JournalEntryKind::RealizedPnl => portfolio::v1::JournalEntryKind::RealizedPnl,
        JournalEntryKind::CorporateAction => portfolio::v1::JournalEntryKind::CorporateAction,
    }
}

fn to_wire_utterance(
    artifact: &UtteranceArtifact,
    ids: &EpisodeIds,
    market: &SyntheticMarketEpisode,
) -> character::v1::UtteranceArtifactV1 {
    character::v1::UtteranceArtifactV1 {
        utterance_artifact_id: artifact.utterance_artifact_id.to_vec(),
        character_id: artifact.character_id.to_vec(),
        semantic_speech_act_event_id: artifact.semantic_speech_act_event_id.to_vec(),
        sealing_event_type: (character::v1::SealingEventType::PublicClaimMade as i32),
        surface_kind: (character::v1::SurfaceKind::PublicSpeech as i32),
        canonical_text_utf8: artifact.canonical_text_utf8.clone(),
        canonical_text_sha256: artifact.canonical_text_sha256.to_vec(),
        language_tag: "zh-Hant-TW".to_owned(),
        truth_class: (common_v2::TruthClass::SimulatedNarrative as i32),
        proposition_refs: vec!["thesis-v5-golden-001".to_owned()],
        visible_fact_revision_ids: vec![market.fact_revision_id.to_owned()],
        recipient_character_ids: Vec::new(),
        audience_scope: "public_current".to_owned(),
        cognitive_episode_id: ids.cognitive_episode_id.to_vec(),
        cognition_input_seal_event_id: ids.cognitive_episode_id.to_vec(),
        appraisal_event_id: ids.cognitive_episode_id.to_vec(),
        source_state_digest: payload_digest(b"v5-golden-source-state").to_vec(),
        world_time_unix_micros: 18_500,
        generation_mode: (character::v1::GenerationMode::DeterministicFallback as i32),
        utterance_request_id: derive_id("v5-golden/utterance-request-001").to_vec(),
        model_core_id: None,
        model_snapshot_revision: None,
        adapter_revision: None,
        prompt_revision: None,
        input_schema_revision: "cognition-appraisal/v1".to_owned(),
        output_schema_revision: "utterance-artifact/v1".to_owned(),
        fallback_policy_revision: Some(FALLBACK_POLICY_REVISION.to_owned()),
        raw_output_digest: None,
        semantic_verifier_revision: "semantic-verifier/v1".to_owned(),
        safety_policy_revision: "safety-policy/v1".to_owned(),
        source_ref_set_digest: payload_digest(b"v5-golden-source-ref-set").to_vec(),
        sealed_at_unix_micros: artifact.sealed_at_unix_micros,
        replies_to_utterance_artifact_id: None,
        retracts_utterance_artifact_id: None,
    }
}

#[cfg(test)]
mod tests {
    use super::golden_episode;
    use panshi_protocol::decode_canonical;

    /// Golden failure set: full-surface artifact hash equality
    /// (`docs/v5/character-story-engine.md`: "World、close-up、journal、
    /// archive、search、分享、notification、video、字幕與 screen reader 對同一
    /// 原話回報相同 artifact ID 與 `canonicalTextSha256`"). This Phase-2
    /// slice implements two of those surfaces -- the sealed utterance event
    /// itself and the story chapter's `character_claim` narrative segment
    /// that references it; the remaining surfaces (search, share, video,
    /// captions, accessibility) are UI-layer work explicitly deferred to the
    /// next handoff. Both implemented surfaces must resolve the identical
    /// `utterance_artifact_id` and `canonical_text_sha256` -- this test
    /// fails if a future edit ever lets the story chapter's segment
    /// construction drift into re-deriving its own hash instead of copying
    /// the sealed artifact's.
    #[test]
    fn utterance_hash_is_identical_across_the_sealed_event_and_the_story_segment() {
        use panshi_protocol::{character, story};

        let episode = golden_episode();
        let public_claim = episode
            .events
            .iter()
            .find(|event| event.event_type == "PublicClaimMade")
            .expect("public claim exists");
        let artifact = decode_canonical::<character::v1::UtteranceArtifactV1>(&public_claim.payload_bytes)
            .expect("canonical utterance artifact");

        let chapter_composed = episode
            .events
            .iter()
            .find(|event| event.event_type == "StoryChapterComposed")
            .expect("story chapter composed exists");
        let chapter = decode_canonical::<story::v1::StoryChapterComposedV1>(&chapter_composed.payload_bytes)
            .expect("canonical story chapter");

        let character_claim_segment = chapter
            .segments
            .iter()
            .find_map(|segment| match &segment.variant {
                Some(story::v1::narrative_segment_v1::Variant::CharacterClaim(claim)) => Some(claim),
                _ => None,
            })
            .expect("story chapter has a character_claim segment");

        assert_eq!(
            character_claim_segment.utterance_artifact_id,
            artifact.utterance_artifact_id
        );
        assert_eq!(
            character_claim_segment.canonical_text_sha256,
            artifact.canonical_text_sha256
        );
    }

    #[test]
    fn golden_episode_is_deterministic_across_calls() {
        let first = golden_episode();
        let second = golden_episode();
        assert_eq!(first.events.len(), second.events.len());
        for (left, right) in first.events.iter().zip(second.events.iter()) {
            assert_eq!(left.event_type, right.event_type);
            assert_eq!(left.payload_bytes, right.payload_bytes);
            assert_eq!(left.payload_digest, right.payload_digest);
        }
    }

    #[test]
    fn golden_episode_covers_the_full_handoff_chain() {
        let episode = golden_episode();
        let event_types: Vec<&str> = episode.events.iter().map(|event| event.event_type).collect();
        for required in [
            "FactManifestAccepted",
            "FactBecameVisible",
            "ObservedClueRegistered",
            "CognitionInputSealed",
            "CoreAppraisalFallbackUsed",
            "AttentionCommitted",
            "AutonomousActionIntentCommitted",
            "SemanticSpeechActCommitted",
            "PublicClaimMade",
            "PaperOrderSubmitted",
            "PaperOrderFilled",
            "PaperAccountJournalPosted",
            "PaperPositionOpened",
            "MemoryFormed",
            "StoryChapterComposed",
            "StoryChapterPublished",
        ] {
            assert!(
                event_types.contains(&required),
                "golden episode is missing required event {required}"
            );
        }
    }

    #[test]
    fn utterance_artifact_hash_is_stable_and_matches_across_two_builds() {
        let first = golden_episode();
        let second = golden_episode();
        let claim_a = first
            .events
            .iter()
            .find(|event| event.event_type == "PublicClaimMade")
            .expect("public claim exists");
        let claim_b = second
            .events
            .iter()
            .find(|event| event.event_type == "PublicClaimMade")
            .expect("public claim exists");
        assert_eq!(claim_a.payload_bytes, claim_b.payload_bytes);
    }
}
