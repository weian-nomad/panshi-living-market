#![allow(clippy::too_many_lines)]

//! The one-character vertical slice: 陸硯之 across six synthetic historical
//! market sessions (`docs/v5/decision-record.md` 後續約束: "可以先做一名角色的
//! 完整垂直切片；資料形狀仍要是最終事件、帳本與人生誌").
//!
//! Relationship to `golden_episode()`: that fixture proves ONE cognition ->
//! action -> ledger -> chapter chain replays byte-identically across native,
//! WASI and `PostgreSQL`. This module proves the same chain survives being a
//! *life*: six sessions, a position that is opened, marked down, argued
//! about, re-labelled and finally reduced at a real loss, four fallible
//! patterns that fall out of state and history, and five published journal
//! chapters. `golden_episode()` is not touched, imported for reuse, or
//! generalized -- its twenty sealed payloads are a frozen parity artifact.
//!
//! Same discipline as `golden_episode()`: pure computation, no I/O, no
//! clock, no randomness, no model call, no network. Cognition runs only the
//! versioned deterministic fallback (`panshi_character_domain::fallback`).
//! Every money and quantity value comes out of `panshi_paper_ledger`; this
//! module never computes a P&L number of its own.
//!
//! What is deliberately absent, because the slice must not fake depth:
//! there is no second character, so `RelationshipDyad` does not exist here
//! and 陳小雨 never speaks -- she appears only through his one-way
//! observable actions. Session 6 ("today") is in progress, so it accepts no
//! finality, publishes no chapter, and discloses no same-day action; its
//! mark cites the previous session's sealed close as its price source
//! instead of inventing a live one.

pub mod seed;
pub mod sessions;

use panshi_character_domain::{
    bias::{BiasObservation, SessionSignals, observe},
    character::{CommitmentRationale, DynamicState},
    cognition::{
        ActionIntentRef, ActionKind as DomainActionKind, AppraisalRef, AppraisalSource,
        AttentionRef, CognitiveEpisode, SpeechActOutcome, fact_is_interaction_eligible,
    },
    fallback::{
        FALLBACK_POLICY_REVISION, deterministic_appraisal_fallback, deterministic_speech_act_template,
        fallback_appraisal_digest,
    },
    memory::{MemoryLedger, MemoryRecord},
    story::{StoryChapter, StorySourceSet},
    utterance::{
        GenerationMode, SealUtteranceRequest, SealingEventType, SurfaceKind, UtteranceArtifact,
    },
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
use panshi_protocol::{character, common::v2 as common_v2, portfolio, story, world};

use panshi_character_domain::thesis::{
    InvalidationState, ThesisRevision, ThesisRevisionChain, evaluate_invalidation,
    newly_supported_facts,
};

use crate::{CanonicalEventRecord, derive_id, hex_id, payload_digest, push_event};
use seed::SeedMemory;
use sessions::{
    EXECUTION_RULESET_REVISION, FACT_CORRECTION_S4, FACT_COUNTER_INVENTORY, FACT_MOMENTUM_S1,
    FACT_PRICE_S1, FACT_PRICE_S2, FACT_PRICE_S3, FACT_PRICE_S4, FACT_PRICE_S5,
    FINALITY_POLICY_REVISION, LAST_FINAL_SESSION_INDEX, MarketSession, RIGHTS_MANIFEST_ID,
    SECURITY_ID, SESSION_COUNT, SESSIONS, fact_available_at, last_final_session,
};

/// How many memories this slice seals in total: three at bootstrap plus one
/// each in S1, S2, S4 and S5.
pub const MEMORY_COUNT: usize = 7;

/// U1 (S2 public claim), U2 (S4 public claim replying to U1), U3 (S5 first
/// self-acknowledgement).
pub const UTTERANCE_COUNT: usize = 3;

/// One chapter per final session: S1..S5. S6 publishes nothing.
pub const CHAPTER_COUNT: usize = LAST_FINAL_SESSION_INDEX;

/// The horizon he wrote down himself: momentum continuing within two trading
/// sessions. Held days beyond this are days he chose, not days the market
/// imposed.
pub const INTENDED_HORIZON_DAYS: u32 = 2;

/// Paper trading fee per fill, in whole TWD. A flat fixture value; a real
/// fee schedule is an execution-ruleset concern, not a character one.
const FILL_FEE: Fixed = Fixed::from_raw(20 * Fixed::SCALE);

/// The soft cost mask applied to every action-utility candidate
/// (time/money/body/social). Hard limits are enforced separately by
/// `PaperAccount::validate_commit`, never by making a candidate look
/// expensive.
const ACTION_COST_MASK: Fixed = Fixed::from_raw(50_000);

/// Stable stream identities for every aggregate the slice touches.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct SliceIds {
    pub character_id: [u8; 16],
    pub paper_account_id: [u8; 16],
    pub paper_position_id: [u8; 16],
    pub buy_order_id: [u8; 16],
    pub sell_order_id: [u8; 16],
    pub world_session_ids: [[u8; 16]; SESSION_COUNT],
    pub cognitive_episode_ids: [[u8; 16]; SESSION_COUNT],
    pub memory_ids: [[u8; 16]; MEMORY_COUNT],
    pub semantic_speech_act_ids: [[u8; 16]; UTTERANCE_COUNT],
    pub utterance_artifact_ids: [[u8; 16]; UTTERANCE_COUNT],
    pub chapter_ids: [[u8; 16]; CHAPTER_COUNT],
}

impl SliceIds {
    #[must_use]
    pub fn v1() -> Self {
        let mut world_session_ids = [[0_u8; 16]; SESSION_COUNT];
        let mut cognitive_episode_ids = [[0_u8; 16]; SESSION_COUNT];
        for (position, slot) in world_session_ids.iter_mut().enumerate() {
            *slot = derive_id(&format!("v5-slice/world-session/s{}", position + 1));
        }
        for (position, slot) in cognitive_episode_ids.iter_mut().enumerate() {
            *slot = derive_id(&format!("v5-slice/cognitive-episode/s{}", position + 1));
        }
        let mut memory_ids = [[0_u8; 16]; MEMORY_COUNT];
        for (position, slot) in memory_ids.iter_mut().enumerate() {
            *slot = derive_id(&format!("v5-slice/memory/mem-{:03}", position + 1));
        }
        let mut semantic_speech_act_ids = [[0_u8; 16]; UTTERANCE_COUNT];
        let mut utterance_artifact_ids = [[0_u8; 16]; UTTERANCE_COUNT];
        for (position, slot) in semantic_speech_act_ids.iter_mut().enumerate() {
            *slot = derive_id(&format!("v5-slice/speech-act/u{}", position + 1));
        }
        for (position, slot) in utterance_artifact_ids.iter_mut().enumerate() {
            *slot = derive_id(&format!("v5-slice/utterance-artifact/u{}", position + 1));
        }
        let mut chapter_ids = [[0_u8; 16]; CHAPTER_COUNT];
        for (position, slot) in chapter_ids.iter_mut().enumerate() {
            *slot = derive_id(&format!("v5-slice/story-chapter/s{}", position + 1));
        }
        Self {
            character_id: derive_id(seed::CHARACTER_TAG),
            paper_account_id: derive_id(seed::PAPER_ACCOUNT_TAG),
            paper_position_id: derive_id(seed::PAPER_POSITION_TAG),
            buy_order_id: derive_id(seed::BUY_ORDER_TAG),
            sell_order_id: derive_id(seed::SELL_ORDER_TAG),
            world_session_ids,
            cognitive_episode_ids,
            memory_ids,
            semantic_speech_act_ids,
            utterance_artifact_ids,
            chapter_ids,
        }
    }
}

/// The complete slice: canonical events in fixed emission order, plus the
/// two derived structures the life journal reads (the thesis chain and the
/// bias observations). Both are derived from the same sealed state the
/// events carry -- neither is a second, editable source of truth.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CharacterSlice {
    pub ids: SliceIds,
    pub sessions: [MarketSession; SESSION_COUNT],
    pub events: Vec<CanonicalEventRecord>,
    pub thesis_chain: ThesisRevisionChain,
    pub bias_observations: Vec<BiasObservation>,
}

/// What the character does in one session, frozen. This is the behaviour
/// script; `sessions::SESSIONS` is the market fixture. Keeping them apart is
/// what makes "the natal motif never touched a price" checkable by reading
/// two files instead of auditing one.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct SessionScript {
    /// Facts he actually attended to.
    selected_fact_revision_ids: &'static [&'static str],
    /// Facts that were available and high-salience and that he did not
    /// attend to. This is the field confirmation bias is decided from, and
    /// it is written by attention, never by a narrator.
    missed_fact_revision_ids: &'static [&'static str],
    action: DomainActionKind,
    fomo_before_bp: i32,
    fomo_after_bp: i32,
    confidence_bp: i32,
    uncertainty_load_bp: i32,
    valence_bp: i32,
    stress_bp: i32,
    /// Salience of the memory this session reactivates, in basis points.
    memory_trigger_bp: i32,
    /// Cognitive-pattern activation term for action utility, in basis points.
    pattern_activation_bp: i32,
    /// Calendar days the position has been open, counting the purchase day
    /// as day one. Zero before the position exists.
    held_days: u32,
    unrealized_pnl_worsened: bool,
    /// The thesis revision this session's action intent cites.
    thesis_revision_id: &'static str,
    /// Whether the cited thesis differs from the previous session's.
    thesis_changed: bool,
    /// `(index into SliceIds::memory_ids, memory)` if this session seals one.
    memory: Option<(usize, SeedMemory)>,
    /// Engineering placeholder narration. Every string below is fixture copy
    /// for the canonical event payload, NOT reviewed product text; the
    /// repository's `copy-taste` routing rule must run over all of it before
    /// any of it reaches a viewer.
    observable_line: &'static str,
    market_line: &'static str,
    /// Symbolic reading, rendered with `truth_class`
    /// `SYMBOLIC_INTERPRETATION`. `None` once the motif has expired.
    motif_line: Option<&'static str>,
}

const NO_FACTS: &[&str] = &[];

const SCRIPT: [SessionScript; SESSION_COUNT] = [
    // S1 -- he is reading yesterday's footnotes. He reads the counter
    // evidence (peer inventory days rising) and misses the early move.
    // FOMO 1_100 -> 4_600. No position, no thesis, no paper action.
    SessionScript {
        selected_fact_revision_ids: NO_FACTS,
        missed_fact_revision_ids: &[FACT_MOMENTUM_S1],
        action: DomainActionKind::Wait,
        fomo_before_bp: 1_100,
        fomo_after_bp: 4_600,
        confidence_bp: 3_000,
        uncertainty_load_bp: 4_800,
        valence_bp: -1_200,
        stress_bp: 3_000,
        memory_trigger_bp: 0,
        pattern_activation_bp: 1_200,
        held_days: 0,
        unrealized_pnl_worsened: false,
        thesis_revision_id: "",
        thesis_changed: false,
        memory: Some((3, seed::MEMORY_MISSED_THE_OPENING_MOVE)),
        observable_line: "他把昨天的附註看完，早盤那一段結束之後才抬頭。",
        market_line: "PSZS-DEMO 這個時段收在 96.00。",
        motif_line: Some("控制與認可這個主題，讓這件事在他心裡變重，沒有讓價格變好。"),
    },
    // S2 -- the chase. mem-002 (being teased for waiting) reactivates, the
    // position is opened at 10:42, and the structured rationale is sealed.
    SessionScript {
        selected_fact_revision_ids: &[FACT_MOMENTUM_S1, FACT_PRICE_S1],
        missed_fact_revision_ids: &[FACT_COUNTER_INVENTORY],
        action: DomainActionKind::PaperBuy,
        fomo_before_bp: 4_600,
        fomo_after_bp: 4_200,
        confidence_bp: 5_000,
        uncertainty_load_bp: 6_000,
        valence_bp: 400,
        stress_bp: 3_600,
        memory_trigger_bp: 6_000,
        pattern_activation_bp: 5_000,
        held_days: 1,
        unrealized_pnl_worsened: false,
        thesis_revision_id: "thesis-hist-001",
        thesis_changed: false,
        memory: Some((4, seed::MEMORY_OPENED_THE_POSITION)),
        observable_line: "他先把同事的提醒滑掉，下單之後才回頭補看昨天的材料。",
        market_line: "PSZS-DEMO 這個時段收在 100.00。",
        motif_line: Some("控制與認可這個主題仍在作用中。"),
    },
    // S3 -- the horizon he wrote down runs out at this session's close and
    // the paper loss widens. He waits.
    SessionScript {
        selected_fact_revision_ids: &[FACT_PRICE_S2],
        missed_fact_revision_ids: &[FACT_COUNTER_INVENTORY],
        action: DomainActionKind::Wait,
        fomo_before_bp: 4_200,
        fomo_after_bp: 4_400,
        confidence_bp: 4_200,
        uncertainty_load_bp: 6_600,
        valence_bp: -1_800,
        stress_bp: 4_400,
        memory_trigger_bp: 0,
        pattern_activation_bp: 4_000,
        held_days: 3,
        unrealized_pnl_worsened: true,
        thesis_revision_id: "thesis-hist-001",
        thesis_changed: false,
        memory: None,
        observable_line: "他把持股頁面開著，沒有動作，也沒有再打開那份同業存貨的資料。",
        market_line: "PSZS-DEMO 這個時段收在 93.50。",
        motif_line: Some("控制與認可這個主題在這個時段收盤後到期。"),
    },
    // S4 -- the switch. The stated reason moves from momentum to long-term
    // governance; the supporting facts do not move at all.
    SessionScript {
        selected_fact_revision_ids: &[FACT_PRICE_S3],
        missed_fact_revision_ids: &[FACT_COUNTER_INVENTORY],
        action: DomainActionKind::Wait,
        fomo_before_bp: 4_400,
        fomo_after_bp: 4_800,
        confidence_bp: 4_600,
        uncertainty_load_bp: 7_000,
        valence_bp: -2_400,
        stress_bp: 5_200,
        memory_trigger_bp: 3_000,
        pattern_activation_bp: 4_600,
        held_days: 8,
        unrealized_pnl_worsened: true,
        thesis_revision_id: "thesis-hist-002",
        thesis_changed: true,
        memory: Some((5, seed::MEMORY_RETITLED_THE_NOTE)),
        observable_line: "他繞開同事的座位，把筆記標題改掉，支持資料沒有增加。",
        market_line: "PSZS-DEMO 這個時段收在 91.60，同時發布一則更正公告。",
        motif_line: None,
    },
    // S5 -- the first admission and the first reduction. The loss is
    // realized in full and stays visible; there is no recovery arc.
    SessionScript {
        selected_fact_revision_ids: &[FACT_CORRECTION_S4, FACT_COUNTER_INVENTORY, FACT_PRICE_S4],
        missed_fact_revision_ids: NO_FACTS,
        action: DomainActionKind::PaperSell,
        fomo_before_bp: 4_800,
        fomo_after_bp: 2_600,
        confidence_bp: 3_400,
        uncertainty_load_bp: 5_400,
        valence_bp: -1_600,
        stress_bp: 4_000,
        memory_trigger_bp: 7_000,
        pattern_activation_bp: 2_000,
        held_days: 15,
        unrealized_pnl_worsened: true,
        thesis_revision_id: "thesis-hist-002",
        thesis_changed: false,
        memory: Some((6, seed::MEMORY_FIRST_ADMISSION)),
        observable_line: "他重看了那份同業存貨的資料，減碼四百股，然後主動走回同事的座位旁。",
        market_line: "PSZS-DEMO 這個時段收在 88.20。",
        motif_line: None,
    },
    // S6 -- today. In session, finality pending. He re-reads the data he
    // finally acted on yesterday. Nothing about today is settled, so this
    // session publishes no chapter and discloses no same-day action.
    SessionScript {
        selected_fact_revision_ids: &[FACT_COUNTER_INVENTORY, FACT_PRICE_S5],
        missed_fact_revision_ids: NO_FACTS,
        action: DomainActionKind::ReadOrVerify,
        fomo_before_bp: 2_600,
        fomo_after_bp: 2_400,
        confidence_bp: 3_200,
        uncertainty_load_bp: 5_000,
        valence_bp: -800,
        stress_bp: 3_200,
        memory_trigger_bp: 0,
        pattern_activation_bp: 1_000,
        held_days: 16,
        unrealized_pnl_worsened: false,
        thesis_revision_id: "thesis-hist-002",
        thesis_changed: false,
        memory: None,
        observable_line: "他正在重看他昨天終於減碼的那批資料。",
        market_line: "這個交易時段還沒有結束，今天的收盤價還沒有被接受為正式結果。",
        motif_line: None,
    },
];

/// The original commitment. Its horizon is S3's close and its invalidation
/// condition is his own: no new evidence within two trading sessions.
const THESIS_001_SUPPORT: [&str; 2] = [FACT_MOMENTUM_S1, FACT_PRICE_S1];

/// The rewritten commitment. Same supporting facts, verbatim -- which is
/// exactly why `newly_supported_facts` returns nothing for it.
const THESIS_002_SUPPORT: [&str; 2] = [FACT_MOMENTUM_S1, FACT_PRICE_S1];

/// Builds the one-character slice deterministically. Calling it twice
/// produces byte-identical payloads for every event, the same thesis chain
/// and the same bias observations.
///
/// # Panics
///
/// Panics only on a build-time invariant violation in this frozen fixture --
/// a fixed-point overflow, a domain state-machine transition this fixed
/// sequence should never reach, or a ledger policy gate this fixture's own
/// numbers should always pass. Any of those would be a defect in this file,
/// not recoverable runtime input; this matches `golden_episode()`'s existing
/// convention.
#[must_use]
pub fn one_character_slice() -> CharacterSlice {
    let ids = SliceIds::v1();
    let mut events: Vec<CanonicalEventRecord> = Vec::new();

    // -- S0 bootstrap ------------------------------------------------------
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

    let origin_digest = payload_digest(b"v5-slice-character-origin/v1");
    push_event(
        &mut events,
        "CharacterOriginSealed",
        "Character",
        ids.character_id,
        &character::v1::CharacterOriginSealedV1 {
            character_id: ids.character_id.to_vec(),
            origin_seed_commitment: seed::ORIGIN_SEED_COMMITMENT.to_owned(),
            generation_policy_revision: seed::GENERATION_POLICY_REVISION.to_owned(),
            statistical_pack_revision: seed::STATISTICAL_PACK_REVISION.to_owned(),
            birth_date: seed::BIRTH_DATE.to_owned(),
            birth_region: seed::BIRTH_REGION.to_owned(),
            occupation_group: seed::OCCUPATION_GROUP.to_owned(),
            income_band: seed::INCOME_BAND.to_owned(),
            four_axis: Some(character::v1::FourAxisPreference {
                social_orientation_bp: seed::FOUR_AXIS.social_orientation_bp,
                information_orientation_bp: seed::FOUR_AXIS.information_orientation_bp,
                decision_orientation_bp: seed::FOUR_AXIS.decision_orientation_bp,
                closure_orientation_bp: seed::FOUR_AXIS.closure_orientation_bp,
            }),
            model_core_id: seed::MODEL_CORE_ID.to_owned(),
            origin_digest: origin_digest.to_vec(),
        },
    );

    // The three memories he arrives with. They are sealed before any market
    // session so that nothing later can claim a convenient new backstory.
    let mut memory_ledger = MemoryLedger::new();
    let bootstrap_at = SESSIONS[0].open_unix_micros() - 1;
    for (position, memory) in seed::ORIGIN_MEMORIES.iter().enumerate() {
        seal_memory(
            &mut events,
            &mut memory_ledger,
            &ids,
            position,
            *memory,
            bootstrap_at,
            &[ids.character_id],
        );
    }

    // -- rolling state across the six sessions -----------------------------
    let mut position: Option<PaperPosition> = None;
    let mut thesis_chain = ThesisRevisionChain::new();
    let mut sealed_memory_ids: Vec<[u8; 16]> = ids.memory_ids[..seed::ORIGIN_MEMORIES.len()].to_vec();
    let mut utterances: Vec<UtteranceArtifact> = Vec::new();
    let mut utterance_support: Vec<Vec<String>> = Vec::new();
    let mut signals: Vec<SessionSignals> = Vec::new();
    let mut prior_state = DynamicState {
        fomo_bp: SCRIPT[0].fomo_before_bp,
        confidence_bp: 3_000,
        uncertainty_load_bp: 4_000,
        ..DynamicState::NEUTRAL
    };

    for (position_index, session) in SESSIONS.iter().enumerate() {
        let script = SCRIPT[position_index];
        let world_session_id = ids.world_session_ids[position_index];
        let cognitive_episode_id = ids.cognitive_episode_ids[position_index];

        // -- market evidence gateway ---------------------------------------
        push_event(
            &mut events,
            "FactManifestAccepted",
            "FactManifestMirror",
            world_session_id,
            // Mirrored as received: the upstream manifest hash and both set
            // digests are copied, never recomputed on this side
            // (`contracts/proto/panshi/world/v1/world.proto`).
            &world::v1::FactManifestAcceptedV1 {
                manifest_id: session.manifest_id.to_owned(),
                manifest_hash: hex_bytes(session.manifest_hash_hex),
                market_session_id: session.market_session_id.to_owned(),
                market_date_taipei: session.market_date_taipei.to_owned(),
                interaction_cutoff_unix_micros: session.interaction_cutoff_unix_micros(),
                evidence_cutoff_unix_micros: session.evidence_cutoff_unix_micros(),
                rights_manifest_id: RIGHTS_MANIFEST_ID.to_owned(),
                interaction_fact_revision_ids: owned(session.interaction_fact_revision_ids),
                interaction_fact_set_digest: hex_bytes(session.interaction_fact_set_digest_hex),
                outcome_evidence_revision_ids: owned(session.outcome_evidence_revision_ids),
                outcome_evidence_set_digest: hex_bytes(session.outcome_evidence_set_digest_hex),
            },
        );
        for fact_revision_id in session.newly_visible_fact_revision_ids {
            push_event(
                &mut events,
                "FactBecameVisible",
                "WorldSession",
                world_session_id,
                &world::v1::FactBecameVisibleV1 {
                    manifest_id: session.manifest_id.to_owned(),
                    fact_revision_id: (*fact_revision_id).to_owned(),
                    world_session_id: world_session_id.to_vec(),
                    available_at_unix_micros: fact_available_at(fact_revision_id),
                },
            );
        }

        // -- exposure ------------------------------------------------------
        // The anchor fact he was pushed at this session. Every other fact in
        // the session's interaction allowlist still reaches cognition through
        // the sealed input below -- exposure is not attention, and attention
        // is where the misses are recorded.
        let anchor_fact = session.interaction_fact_revision_ids[0];
        push_event(
            &mut events,
            "ObservedClueRegistered",
            "CognitiveEpisode",
            cognitive_episode_id,
            &character::v1::ObservedClueRegisteredV1 {
                character_id: ids.character_id.to_vec(),
                cognitive_episode_id: cognitive_episode_id.to_vec(),
                fact_ref: Some(common_v2::FactRevisionRef {
                    fact_manifest_id: session.manifest_id.to_owned(),
                    fact_revision_id: anchor_fact.to_owned(),
                    allowlist: (common_v2::fact_revision_ref::Allowlist::Interaction as i32),
                }),
                observed_at_unix_micros: session.observed_at_unix_micros(),
                exposure_channel: "device_notification".to_owned(),
                exposure_depth: (character::v1::observed_clue_registered_v1::ExposureDepth::FullRead
                    as i32),
            },
        );

        // -- cognition: Opened -> InputSealed -------------------------------
        let mut episode = CognitiveEpisode::open(
            cognitive_episode_id,
            ids.character_id,
            session.interaction_cutoff_unix_micros(),
        );
        let input_digest = payload_digest(
            format!("v5-slice-cognition-input/s{}", session.session_index).as_bytes(),
        );
        episode
            .seal_input(0, input_digest)
            .expect("fixed episode sequence: Opened -> InputSealed");

        // The upstream manifest's interaction allowlist, re-checked here
        // against the three-way cutoff rather than trusted. A fact that
        // failed would be dropped, never back-dated -- and because the
        // fixture is built so none of them fail, a future edit that broke
        // the fence would trip this assertion instead of silently letting
        // post-cutoff evidence into what he "knew".
        let admitted_facts: Vec<&'static str> = session
            .interaction_fact_revision_ids
            .iter()
            .copied()
            .filter(|fact_revision_id| {
                fact_is_interaction_eligible(
                    fact_available_at(fact_revision_id),
                    session.input_sealed_at_unix_micros(),
                    session.interaction_cutoff_unix_micros(),
                    session.input_sealed_at_unix_micros(),
                )
            })
            .collect();
        assert_eq!(
            admitted_facts.len(),
            session.interaction_fact_revision_ids.len(),
            "every fact in the sealed interaction allowlist must pass the cutoff"
        );
        push_event(
            &mut events,
            "CognitionInputSealed",
            "CognitiveEpisode",
            cognitive_episode_id,
            &character::v1::CognitionInputSealedV1 {
                cognitive_episode_id: cognitive_episode_id.to_vec(),
                character_id: ids.character_id.to_vec(),
                interaction_fact_refs: admitted_facts
                    .iter()
                    .map(|fact_revision_id| common_v2::FactRevisionRef {
                        fact_manifest_id: session.manifest_id.to_owned(),
                        fact_revision_id: (*fact_revision_id).to_owned(),
                        allowlist: (common_v2::fact_revision_ref::Allowlist::Interaction as i32),
                    })
                    .collect(),
                admitted_memory_ids: sealed_memory_ids.iter().copied().map(hex_id).collect(),
                paper_account_ref: ids.paper_account_id.to_vec(),
                paper_account_version: paper_account.stream_version,
                interaction_cutoff_unix_micros: session.interaction_cutoff_unix_micros(),
                sealed_at_unix_micros: session.input_sealed_at_unix_micros(),
                input_digest: input_digest.to_vec(),
            },
        );

        // -- cognition: deterministic appraisal fallback ---------------------
        let fallback_appraisal =
            deterministic_appraisal_fallback(admitted_facts.iter().map(|id| (*id).to_owned()).collect());
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
        push_event(
            &mut events,
            "CoreAppraisalFallbackUsed",
            "CognitiveEpisode",
            cognitive_episode_id,
            &character::v1::CoreAppraisalFallbackUsedV1 {
                cognitive_episode_id: cognitive_episode_id.to_vec(),
                appraisal: Some(character::v1::CognitionAppraisalV1 {
                    contract_version: seed::COGNITION_INPUT_SCHEMA_REVISION.to_owned(),
                    fact_appraisals: admitted_facts
                        .iter()
                        .map(|fact_revision_id| character::v1::FactAppraisal {
                            fact_revision_id: (*fact_revision_id).to_owned(),
                            relevance_bp: fallback_appraisal.relevance_bp,
                            reliability_bp: fallback_appraisal.reliability_bp,
                            uncertainty_bp: fallback_appraisal.uncertainty_bp,
                            supports_proposition_ids: Vec::new(),
                            challenges_proposition_ids: Vec::new(),
                        })
                        .collect(),
                    interpretation_candidates: Vec::new(),
                    social_interpretation_codes: Vec::new(),
                    attention_proposal_refs: owned(script.selected_fact_revision_ids),
                }),
                reason_code: (character::v1::FallbackReasonCode::NoNetwork as i32),
                fallback_policy_revision: FALLBACK_POLICY_REVISION.to_owned(),
            },
        );

        // -- cognition: attention -------------------------------------------
        // The natal motif reaches behaviour through exactly one slot, and
        // only while it has not expired. Social transmission stays at zero:
        // this slice has no second character and no sealed dyad, so there is
        // nothing to source a social signal from -- fail closed rather than
        // invent one.
        let motif_component = if session.decision_at_unix_micros()
            <= seed::MOTIF_CONTROL_AND_RECOGNITION.expires_at_unix_micros
        {
            bp_component(seed::MOTIF_CONTROL_AND_RECOGNITION.strength_bp)
        } else {
            Fixed::ZERO
        };
        let attention_components = AttentionComponents {
            core_appraisal: bp_component(fallback_appraisal.relevance_bp),
            current_goal_and_need: bp_component(script.fomo_after_bp),
            occupation_skill_and_existing_focus: Fixed::from_raw(300_000),
            memory_trigger: bp_component(script.memory_trigger_bp),
            social_transmission_and_source_trust: Fixed::ZERO,
            natal_symbolic_motif: motif_component,
            scene_accessibility: Fixed::ONE,
            seeded_tie_noise: Fixed::ZERO,
        };
        let attention_total = attention_score(attention_components, AttentionWeights::V1)
            .expect("fixture components stay within representable range");
        episode
            .commit_attention(
                2,
                AttentionRef {
                    attention_digest: payload_digest(&attention_total.raw().to_be_bytes()),
                    attention_policy_revision: seed::ATTENTION_POLICY_REVISION,
                },
            )
            .expect("fixed episode sequence: AppraisalResolved -> AttentionCommitted");
        push_event(
            &mut events,
            "AttentionCommitted",
            "CognitiveEpisode",
            cognitive_episode_id,
            &character::v1::AttentionCommittedV1 {
                cognitive_episode_id: cognitive_episode_id.to_vec(),
                selected_fact_revision_ids: owned(script.selected_fact_revision_ids),
                missed_high_salience_fact_revision_ids: owned(script.missed_fact_revision_ids),
                attention_policy_revision: seed::ATTENTION_POLICY_REVISION.to_owned(),
                tie_break_seed_ref: payload_digest(
                    format!("v5-slice-attention-seed/s{}", session.session_index).as_bytes(),
                )
                .to_vec(),
            },
        );

        // -- cognition: action intent ----------------------------------------
        let utility_components = ActionUtilityComponents {
            evidence_and_belief_fit: bp_component(fallback_appraisal.relevance_bp),
            current_goal_and_need_fit: bp_component(script.fomo_after_bp),
            dynamic_emotion_and_agency: Fixed::from_raw(i64::from(script.fomo_after_bp) * 80),
            activated_memory: bp_component(script.memory_trigger_bp),
            relationship_impulse: Fixed::ZERO,
            cognitive_pattern_activation: bp_component(script.pattern_activation_bp),
            habit_and_skill_fluency: Fixed::from_raw(300_000),
        };
        let chosen_utility =
            action_utility_v1(utility_components, ActionUtilityWeights::V1, ACTION_COST_MASK)
                .expect("fixture utility stays within representable range");
        let runner_up_utility = Fixed::ZERO; // NO_ACTION is always a legal candidate
        assert!(
            chosen_utility > runner_up_utility,
            "fixture is designed so the scripted action is the highest-utility legal candidate"
        );
        episode
            .commit_action_intent(
                3,
                ActionIntentRef {
                    action: script.action,
                    action_digest: payload_digest(&chosen_utility.raw().to_be_bytes()),
                    behavior_policy_revision: seed::BEHAVIOR_POLICY_REVISION,
                },
            )
            .expect("fixed episode sequence: AttentionCommitted -> ActionIntentCommitted");
        let (order_quantity, order_side) = match script.action {
            DomainActionKind::PaperBuy => (Fixed::from_raw(1_000 * Fixed::SCALE), Some(OrderSide::Buy)),
            DomainActionKind::PaperSell => {
                (Fixed::from_raw(400 * Fixed::SCALE), Some(OrderSide::Sell))
            }
            _ => (Fixed::ZERO, None),
        };
        push_event(
            &mut events,
            "AutonomousActionIntentCommitted",
            "CognitiveEpisode",
            cognitive_episode_id,
            &character::v1::AutonomousActionIntentCommittedV1 {
                cognitive_episode_id: cognitive_episode_id.to_vec(),
                character_id: ids.character_id.to_vec(),
                paper_account_ref: ids.paper_account_id.to_vec(),
                paper_account_version: paper_account.stream_version,
                action: (wire_action(script.action) as i32),
                security_id: if order_side.is_some() {
                    SECURITY_ID.to_owned()
                } else {
                    String::new()
                },
                quantity_or_target_weight_fixed: order_quantity.raw(),
                committed_at_unix_micros: session.order_committed_at_unix_micros(),
                expires_at_unix_micros: session.order_expires_at_unix_micros(),
                thesis_revision: script.thesis_revision_id.to_owned(),
                perceived_fact_revision_ids: owned(script.selected_fact_revision_ids),
                confidence_bp: script.confidence_bp,
                behavior_policy_revision: seed::BEHAVIOR_POLICY_REVISION.to_owned(),
                first_utility_fixed_be: chosen_utility.raw().to_be_bytes().to_vec(),
                second_utility_fixed_be: runner_up_utility.raw().to_be_bytes().to_vec(),
            },
        );

        // -- S2 only: the structured, quote-free rationale --------------------
        let next_state = DynamicState {
            valence_bp: script.valence_bp,
            arousal_bp: 0,
            stress_bp: script.stress_bp,
            fatigue_bp: 0,
            confidence_bp: script.confidence_bp,
            fomo_bp: script.fomo_after_bp,
            uncertainty_load_bp: script.uncertainty_load_bp,
        };
        if script.action == DomainActionKind::PaperBuy {
            let rationale = CommitmentRationale {
                thesis_id: derive_id("v5-slice/thesis-hist-001"),
                security_id_hash: payload_digest(SECURITY_ID.as_bytes()),
                opened_at_unix_micros: session.order_committed_at_unix_micros(),
                intended_horizon_unix_micros: SESSIONS[2].close_unix_micros(),
                confidence: Fixed::from_raw(500_000),
                invalidation_condition_code: "two_session_momentum_expired",
            };
            thesis_chain
                .push(ThesisRevision {
                    thesis_revision_id: "thesis-hist-001",
                    opened_at_unix_micros: rationale.opened_at_unix_micros,
                    intended_horizon_unix_micros: rationale.intended_horizon_unix_micros,
                    invalidation_condition_code: rationale.invalidation_condition_code,
                    support_fact_revision_ids: &THESIS_001_SUPPORT,
                    confidence: rationale.confidence,
                })
                .expect("fixed sequence: first thesis revision");
            push_event(
                &mut events,
                "CommitmentRationaleSealed",
                "CharacterLife",
                ids.character_id,
                &character::v1::CharacterStateAdvancedV1 {
                    character_id: ids.character_id.to_vec(),
                    prior_state: Some(wire_state(prior_state)),
                    next_state: Some(wire_state(next_state)),
                    trigger_source_event_ids: vec![hex_id(cognitive_episode_id)],
                    state_policy_revision: seed::STATE_POLICY_REVISION.to_owned(),
                },
            );
        }
        // -- S4 only: the rewritten reason, appended not edited ---------------
        if script.thesis_changed {
            thesis_chain
                .push(ThesisRevision {
                    thesis_revision_id: "thesis-hist-002",
                    opened_at_unix_micros: session.decision_at_unix_micros(),
                    intended_horizon_unix_micros: SESSIONS[SESSION_COUNT - 1].close_unix_micros(),
                    invalidation_condition_code: "two_session_momentum_expired",
                    // Confidence went UP while the evidence stayed put. That
                    // pairing is the whole finding; it is not smoothed over.
                    support_fact_revision_ids: &THESIS_002_SUPPORT,
                    confidence: Fixed::from_raw(550_000),
                })
                .expect("fixed sequence: second thesis revision");
        }

        // -- speech act + sealed utterance -------------------------------------
        let speech_slot = match session.session_index {
            2 => Some(0_usize),
            4 => Some(1),
            5 => Some(2),
            _ => None,
        };
        if let Some(slot) = speech_slot {
            let semantic_speech_act_id = ids.semantic_speech_act_ids[slot];
            let utterance_artifact_id = ids.utterance_artifact_ids[slot];
            // S5's admission is a self-acknowledgement surface; S2 and S4 are
            // public claims. The template text itself comes from the
            // versioned deterministic fallback policy -- no model is called,
            // and no narrator writes a line for him.
            let (template_text, _) = deterministic_speech_act_template(script.action);
            let surface_kind = if slot == 2 {
                SurfaceKind::SelfAcknowledged
            } else {
                SurfaceKind::PublicSpeech
            };
            let sealing_event_type = match surface_kind {
                SurfaceKind::SelfAcknowledged => SealingEventType::SelfAcknowledgementMade,
                SurfaceKind::PublicSpeech | SurfaceKind::PublicWriting => {
                    SealingEventType::PublicClaimMade
                }
            };
            // U2 cites exactly the facts U1 cited. The set difference is what
            // the journal shows as "新增支持資料：0"; it is never inferred
            // from how the sentence reads.
            let support: Vec<String> = if slot == 1 {
                utterance_support[0].clone()
            } else {
                owned(script.selected_fact_revision_ids)
            };
            push_event(
                &mut events,
                "SemanticSpeechActCommitted",
                "CognitiveEpisode",
                cognitive_episode_id,
                &character::v1::SemanticSpeechActCommittedV1 {
                    semantic_speech_act_id: semantic_speech_act_id.to_vec(),
                    character_id: ids.character_id.to_vec(),
                    cognitive_episode_id: cognitive_episode_id.to_vec(),
                    act_kind: (if slot == 2 {
                        character::v1::SpeechActKind::Admit
                    } else {
                        character::v1::SpeechActKind::Assert
                    } as i32),
                    surface_kind: (wire_surface(surface_kind) as i32),
                    proposition_refs: vec![script.thesis_revision_id.to_owned()],
                    support_fact_revision_ids: support.clone(),
                    recipient_character_ids: Vec::new(),
                    audience_scope: audience_scope(surface_kind).to_owned(),
                    world_time_unix_micros: session.speech_at_unix_micros(),
                    source_state_digest: payload_digest(
                        format!("v5-slice-source-state/s{}", session.session_index).as_bytes(),
                    )
                    .to_vec(),
                    behavior_policy_revision: seed::BEHAVIOR_POLICY_REVISION.to_owned(),
                },
            );

            let artifact = UtteranceArtifact::seal(SealUtteranceRequest {
                utterance_artifact_id,
                character_id: ids.character_id,
                semantic_speech_act_event_id: semantic_speech_act_id,
                sealing_event_type,
                surface_kind,
                canonical_text_utf8: template_text.to_owned(),
                generation_mode: GenerationMode::DeterministicFallback,
                sealed_at_unix_micros: session.speech_at_unix_micros() + 60_000_000,
            });
            let stream_id =
                UtteranceArtifact::stream_id_for(semantic_speech_act_id, artifact.surface_kind);
            push_event(
                &mut events,
                "PublicClaimMade",
                "UtteranceArtifact",
                stream_id,
                &character::v1::UtteranceArtifactV1 {
                    utterance_artifact_id: artifact.utterance_artifact_id.to_vec(),
                    character_id: artifact.character_id.to_vec(),
                    semantic_speech_act_event_id: artifact.semantic_speech_act_event_id.to_vec(),
                    sealing_event_type: (wire_sealing(sealing_event_type) as i32),
                    surface_kind: (wire_surface(surface_kind) as i32),
                    canonical_text_utf8: artifact.canonical_text_utf8.clone(),
                    canonical_text_sha256: artifact.canonical_text_sha256.to_vec(),
                    language_tag: seed::LANGUAGE_TAG.to_owned(),
                    truth_class: (common_v2::TruthClass::SimulatedNarrative as i32),
                    proposition_refs: vec![script.thesis_revision_id.to_owned()],
                    visible_fact_revision_ids: support.clone(),
                    recipient_character_ids: Vec::new(),
                    audience_scope: audience_scope(surface_kind).to_owned(),
                    cognitive_episode_id: cognitive_episode_id.to_vec(),
                    cognition_input_seal_event_id: cognitive_episode_id.to_vec(),
                    appraisal_event_id: cognitive_episode_id.to_vec(),
                    source_state_digest: payload_digest(
                        format!("v5-slice-source-state/s{}", session.session_index).as_bytes(),
                    )
                    .to_vec(),
                    world_time_unix_micros: session.speech_at_unix_micros(),
                    generation_mode: (character::v1::GenerationMode::DeterministicFallback as i32),
                    utterance_request_id: derive_id(&format!(
                        "v5-slice/utterance-request/u{}",
                        slot + 1
                    ))
                    .to_vec(),
                    model_core_id: None,
                    model_snapshot_revision: None,
                    adapter_revision: None,
                    prompt_revision: None,
                    input_schema_revision: seed::COGNITION_INPUT_SCHEMA_REVISION.to_owned(),
                    output_schema_revision: seed::UTTERANCE_OUTPUT_SCHEMA_REVISION.to_owned(),
                    fallback_policy_revision: Some(FALLBACK_POLICY_REVISION.to_owned()),
                    raw_output_digest: None,
                    semantic_verifier_revision: seed::SEMANTIC_VERIFIER_REVISION.to_owned(),
                    safety_policy_revision: seed::SAFETY_POLICY_REVISION.to_owned(),
                    source_ref_set_digest: fact_set_digest(script.selected_fact_revision_ids)
                        .to_vec(),
                    sealed_at_unix_micros: artifact.sealed_at_unix_micros,
                    // U2 answers U1 in place: the earlier claim is never
                    // rewritten, it is replied to.
                    replies_to_utterance_artifact_id: if slot == 1 {
                        Some(ids.utterance_artifact_ids[0].to_vec())
                    } else {
                        None
                    },
                    retracts_utterance_artifact_id: None,
                },
            );
            episode
                .commit_speech_act(
                    4,
                    SpeechActOutcome::Sealed {
                        utterance_artifact_id,
                    },
                )
                .expect("fixed episode sequence: ActionIntentCommitted -> SpeechActCommitted");
            episode
                .close(5)
                .expect("fixed episode sequence: SpeechActCommitted -> Closed");
            utterances.push(artifact);
            utterance_support.push(support);
        } else {
            episode
                .close(4)
                .expect("fixed episode sequence: ActionIntentCommitted -> Closed");
        }

        // -- paper portfolio ---------------------------------------------------
        if script.action == DomainActionKind::PaperBuy {
            let quantity = order_quantity;
            let notional = session
                .sealed_close
                .checked_mul(quantity)
                .expect("fixture notional fits Fixed");
            paper_account
                .validate_commit(
                    notional,
                    PaperAccountPolicy::V1.initial_cash,
                    paper_account
                        .cash
                        .checked_sub(notional)
                        .and_then(|value| value.checked_sub(FILL_FEE))
                        .expect("fixture stays within Fixed range"),
                )
                .expect("fixture respects the 25%/5% account policy gates");

            let fill_transaction_id = derive_id("v5-slice/fill/s2-buy");
            let mut order = PaperOrder::submit(
                ids.buy_order_id,
                ids.paper_account_id,
                payload_digest(SECURITY_ID.as_bytes()),
                OrderSide::Buy,
                quantity,
                session.order_committed_at_unix_micros(),
                session.order_expires_at_unix_micros(),
            );
            push_event(
                &mut events,
                "PaperOrderSubmitted",
                "PaperOrder",
                ids.buy_order_id,
                &portfolio::v1::PaperOrderSubmittedV1 {
                    paper_order_id: ids.buy_order_id.to_vec(),
                    paper_account_id: ids.paper_account_id.to_vec(),
                    autonomous_action_intent_event_ref: hex_id(cognitive_episode_id).into_bytes(),
                    security_id: SECURITY_ID.to_owned(),
                    side: (portfolio::v1::OrderSide::Buy as i32),
                    order_type: (portfolio::v1::OrderType::MarketNextEligiblePrice as i32),
                    quantity_fixed: quantity.raw(),
                    committed_at_unix_micros: session.order_committed_at_unix_micros(),
                    expires_at_unix_micros: session.order_expires_at_unix_micros(),
                    execution_ruleset_revision: EXECUTION_RULESET_REVISION.to_owned(),
                },
            );
            // The first eligible sealed price after the commit is this
            // session's own close. No intraday price is invented.
            order
                .fill(0, session.close_unix_micros())
                .expect("fixed sequence: the sealed close arrives after the commit");
            push_event(
                &mut events,
                "PaperOrderFilled",
                "PaperOrder",
                ids.buy_order_id,
                &portfolio::v1::PaperOrderFilledV1 {
                    fill_transaction_id: fill_transaction_id.to_vec(),
                    paper_order_id: ids.buy_order_id.to_vec(),
                    paper_account_id: ids.paper_account_id.to_vec(),
                    filled_quantity_fixed: quantity.raw(),
                    price_source: Some(price_source_for(session)),
                    fee_fixed: FILL_FEE.raw(),
                    tax_fixed: 0,
                    execution_ruleset_revision: EXECUTION_RULESET_REVISION.to_owned(),
                },
            );

            let postings = [
                JournalPosting {
                    kind: JournalEntryKind::Cash,
                    amount: notional
                        .checked_add(FILL_FEE)
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
                    amount: FILL_FEE,
                },
            ];
            let account_version_before = paper_account.stream_version;
            let (cash_before, cash_after) = paper_account
                .post_journal(account_version_before, &postings)
                .expect("fixture postings balance to zero and cash stays non-negative");
            push_event(
                &mut events,
                "PaperAccountJournalPosted",
                "PaperAccount",
                ids.paper_account_id,
                &portfolio::v1::PaperAccountJournalPostedV1 {
                    paper_account_id: ids.paper_account_id.to_vec(),
                    fill_transaction_id: fill_transaction_id.to_vec(),
                    postings: postings.iter().map(wire_posting).collect(),
                    cash_before_fixed: cash_before.raw(),
                    cash_after_fixed: cash_after.raw(),
                    reserved_cash_before_fixed: 0,
                    reserved_cash_after_fixed: 0,
                    paper_order_event_ref: hex_id(ids.buy_order_id).into_bytes(),
                    paper_position_event_ref: hex_id(ids.paper_position_id).into_bytes(),
                },
            );

            let lot_id = derive_id("v5-slice/lot/s2-001");
            position = Some(PaperPosition::open(
                ids.paper_position_id,
                ids.paper_account_id,
                payload_digest(SECURITY_ID.as_bytes()),
                Lot {
                    lot_id,
                    quantity,
                    cost_basis: session.sealed_close,
                    opened_at_unix_micros: session.close_unix_micros(),
                },
            ));
            push_event(
                &mut events,
                "PaperPositionOpened",
                "PaperPosition",
                ids.paper_position_id,
                &portfolio::v1::PaperPositionOpenedV1 {
                    paper_position_id: ids.paper_position_id.to_vec(),
                    paper_account_id: ids.paper_account_id.to_vec(),
                    security_id: SECURITY_ID.to_owned(),
                    initial_lot: Some(portfolio::v1::Lot {
                        lot_id: lot_id.to_vec(),
                        quantity_fixed: quantity.raw(),
                        cost_basis_fixed: session.sealed_close.raw(),
                        opened_at_unix_micros: session.close_unix_micros(),
                        opening_fill_transaction_id: fill_transaction_id.to_vec(),
                    }),
                    fill_transaction_id: fill_transaction_id.to_vec(),
                },
            );
        } else if script.action == DomainActionKind::PaperSell {
            let held = position
                .as_mut()
                .expect("fixture: S5 reduces a position opened in S2");
            let quantity = order_quantity;
            let fill_transaction_id = derive_id("v5-slice/fill/s5-sell");
            let mut order = PaperOrder::submit(
                ids.sell_order_id,
                ids.paper_account_id,
                payload_digest(SECURITY_ID.as_bytes()),
                OrderSide::Sell,
                quantity,
                session.order_committed_at_unix_micros(),
                session.order_expires_at_unix_micros(),
            );
            push_event(
                &mut events,
                "PaperOrderSubmitted",
                "PaperOrder",
                ids.sell_order_id,
                &portfolio::v1::PaperOrderSubmittedV1 {
                    paper_order_id: ids.sell_order_id.to_vec(),
                    paper_account_id: ids.paper_account_id.to_vec(),
                    autonomous_action_intent_event_ref: hex_id(cognitive_episode_id).into_bytes(),
                    security_id: SECURITY_ID.to_owned(),
                    side: (portfolio::v1::OrderSide::Sell as i32),
                    order_type: (portfolio::v1::OrderType::MarketNextEligiblePrice as i32),
                    quantity_fixed: quantity.raw(),
                    committed_at_unix_micros: session.order_committed_at_unix_micros(),
                    expires_at_unix_micros: session.order_expires_at_unix_micros(),
                    execution_ruleset_revision: EXECUTION_RULESET_REVISION.to_owned(),
                },
            );
            order
                .fill(0, session.close_unix_micros())
                .expect("fixed sequence: the sealed close arrives after the commit");
            push_event(
                &mut events,
                "PaperOrderFilled",
                "PaperOrder",
                ids.sell_order_id,
                &portfolio::v1::PaperOrderFilledV1 {
                    fill_transaction_id: fill_transaction_id.to_vec(),
                    paper_order_id: ids.sell_order_id.to_vec(),
                    paper_account_id: ids.paper_account_id.to_vec(),
                    filled_quantity_fixed: quantity.raw(),
                    price_source: Some(price_source_for(session)),
                    fee_fixed: FILL_FEE.raw(),
                    tax_fixed: 0,
                    execution_ruleset_revision: EXECUTION_RULESET_REVISION.to_owned(),
                },
            );

            // Every number below comes out of the ledger. The realized loss
            // is whatever `reduce()` says it is.
            let position_version_before = held.stream_version;
            let realized = held
                .reduce(position_version_before, quantity, session.sealed_close)
                .expect("fixture reduces less than the held quantity");
            let unrealized_after = held
                .apply_mark(position_version_before + 1, session.sealed_close)
                .expect("fixture marks the surviving lot at the same sealed close");

            let proceeds = session
                .sealed_close
                .checked_mul(quantity)
                .expect("fixture proceeds fit Fixed");
            let cost_removed = proceeds
                .checked_sub(realized)
                .expect("fixture cost basis fits Fixed");
            let postings = [
                JournalPosting {
                    kind: JournalEntryKind::Cash,
                    amount: proceeds
                        .checked_sub(FILL_FEE)
                        .expect("fixture fits Fixed"),
                },
                JournalPosting {
                    kind: JournalEntryKind::Position,
                    amount: cost_removed
                        .checked_mul(Fixed::NEG_ONE)
                        .expect("fixture fits Fixed"),
                },
                JournalPosting {
                    kind: JournalEntryKind::FeeExpense,
                    amount: FILL_FEE,
                },
                JournalPosting {
                    kind: JournalEntryKind::RealizedPnl,
                    amount: realized
                        .checked_mul(Fixed::NEG_ONE)
                        .expect("fixture fits Fixed"),
                },
            ];
            let account_version_before = paper_account.stream_version;
            let (cash_before, cash_after) = paper_account
                .post_journal(account_version_before, &postings)
                .expect("fixture postings balance to zero and cash stays non-negative");
            push_event(
                &mut events,
                "PaperAccountJournalPosted",
                "PaperAccount",
                ids.paper_account_id,
                &portfolio::v1::PaperAccountJournalPostedV1 {
                    paper_account_id: ids.paper_account_id.to_vec(),
                    fill_transaction_id: fill_transaction_id.to_vec(),
                    postings: postings.iter().map(wire_posting).collect(),
                    cash_before_fixed: cash_before.raw(),
                    cash_after_fixed: cash_after.raw(),
                    reserved_cash_before_fixed: 0,
                    reserved_cash_after_fixed: 0,
                    paper_order_event_ref: hex_id(ids.sell_order_id).into_bytes(),
                    paper_position_event_ref: hex_id(ids.paper_position_id).into_bytes(),
                },
            );
            push_event(
                &mut events,
                "PaperPositionAdjusted",
                "PaperPosition",
                ids.paper_position_id,
                &portfolio::v1::PaperPositionAdjustedV1 {
                    paper_position_id: ids.paper_position_id.to_vec(),
                    fill_transaction_id: fill_transaction_id.to_vec(),
                    lots_added: Vec::new(),
                    // The opening lot survives at a reduced quantity; a
                    // partial reduction removes no lot.
                    lot_ids_removed: Vec::new(),
                    realized_pnl_delta_fixed: realized.raw(),
                    unrealized_pnl_after_fixed: unrealized_after.raw(),
                },
            );
            push_event(
                &mut events,
                "PaperOutcomeRecognized",
                "PaperPosition",
                ids.paper_position_id,
                &portfolio::v1::PaperOutcomeRecognizedV1 {
                    paper_position_id: ids.paper_position_id.to_vec(),
                    paper_account_id: ids.paper_account_id.to_vec(),
                    paper_order_id: ids.sell_order_id.to_vec(),
                    // His own stated condition broke and the result was a
                    // loss. The attribution is about the reason, not about
                    // whether the market agreed with him.
                    attribution: (portfolio::v1::OutcomeAttributionKind::ThesisBrokenLoss as i32),
                    paper_account_version_ref: paper_account.stream_version.to_be_bytes().to_vec(),
                    paper_order_version_ref: order.stream_version.to_be_bytes().to_vec(),
                    paper_position_version_ref: held.stream_version.to_be_bytes().to_vec(),
                    paper_version_set_digest: payload_digest(
                        format!(
                            "v5-slice-version-set/{}/{}/{}",
                            paper_account.stream_version,
                            order.stream_version,
                            held.stream_version
                        )
                        .as_bytes(),
                    )
                    .to_vec(),
                },
            );
            push_event(
                &mut events,
                "PaperMarkApplied",
                "PaperPosition",
                ids.paper_position_id,
                &portfolio::v1::PaperMarkAppliedV1 {
                    paper_position_id: ids.paper_position_id.to_vec(),
                    mark_price_source: Some(price_source_for(session)),
                    unrealized_pnl_fixed: unrealized_after.raw(),
                    marked_at_unix_micros: session.close_unix_micros(),
                },
            );
        }

        // -- mark, for every session in which a position already exists -------
        // S1 has no position, so it emits no mark. A zero-valued mark for a
        // position that does not exist would be a fabricated number.
        // S5 already marked itself above, inside the reduction transaction.
        if script.action != DomainActionKind::PaperSell
            && let Some(held) = position.as_mut()
        {
            // Today's session has accepted no finality, so its mark cites the
            // last SEALED close (S5's) rather than a live price. This is the
            // as-of fence made mechanical: the number is real, and it is
            // openly yesterday's.
            let source_session = if session.finality_accepted {
                session
            } else {
                // `fact-hist-001-price-s6` exists and reads 88.20, but its
                // finality is still `pending`, so it is not an eligible mark
                // source. Mark against the last ACCEPTED close instead.
                last_final_session()
            };
            let unrealized = held
                .apply_mark(held.stream_version, source_session.sealed_close)
                .expect("fixture marks an open position at a sealed close");
            push_event(
                &mut events,
                "PaperMarkApplied",
                "PaperPosition",
                ids.paper_position_id,
                &portfolio::v1::PaperMarkAppliedV1 {
                    paper_position_id: ids.paper_position_id.to_vec(),
                    mark_price_source: Some(price_source_for(source_session)),
                    unrealized_pnl_fixed: unrealized.raw(),
                    marked_at_unix_micros: session.close_unix_micros(),
                },
            );
        }

        // -- memory ------------------------------------------------------------
        if let Some((memory_slot, memory)) = script.memory {
            seal_memory(
                &mut events,
                &mut memory_ledger,
                &ids,
                memory_slot,
                memory,
                session.close_unix_micros() + 600_000_000,
                &[cognitive_episode_id],
            );
            sealed_memory_ids.push(ids.memory_ids[memory_slot]);
        }

        // -- character state ----------------------------------------------------
        push_event(
            &mut events,
            "CharacterStateAdvanced",
            "CharacterLife",
            ids.character_id,
            &character::v1::CharacterStateAdvancedV1 {
                character_id: ids.character_id.to_vec(),
                prior_state: Some(wire_state(prior_state)),
                next_state: Some(wire_state(next_state)),
                trigger_source_event_ids: vec![hex_id(cognitive_episode_id)],
                state_policy_revision: seed::STATE_POLICY_REVISION.to_owned(),
            },
        );
        prior_state = next_state;

        // -- bias signals -------------------------------------------------------
        // Invalidation is always evaluated against the ORIGINAL commitment.
        // Rewriting the reason does not restart the clock he set himself.
        let evaluated_at = if session.finality_accepted {
            session.chapter_composed_at_unix_micros()
        } else {
            session.decision_at_unix_micros()
        };
        let invalidation = thesis_chain.first().map_or(
            InvalidationState::UnknownAtTheTime,
            |original| evaluate_invalidation(original, evaluated_at, 0),
        );
        let newly_supported = match (thesis_chain.first(), thesis_chain.latest()) {
            (Some(first), Some(latest)) if script.thesis_changed => {
                newly_supported_facts(first, latest).len()
            }
            _ => 0,
        };
        signals.push(SessionSignals {
            session_index: session.session_index,
            missed_high_salience_count: script.missed_fact_revision_ids.len(),
            missed_fact_ids: script.missed_fact_revision_ids.to_vec(),
            selected_fact_ids: script.selected_fact_revision_ids.to_vec(),
            fomo_bp_before: script.fomo_before_bp,
            fomo_bp_after: script.fomo_after_bp,
            invalidation,
            held_days: script.held_days,
            intended_horizon_days: INTENDED_HORIZON_DAYS,
            unrealized_pnl_worsened: script.unrealized_pnl_worsened,
            action: script.action,
            thesis_changed: script.thesis_changed,
            newly_supported_fact_count: newly_supported,
        });

        // -- finality and the journal chapter -----------------------------------
        if !session.finality_accepted {
            continue;
        }
        push_event(
            &mut events,
            "MarketSessionFinalityAccepted",
            "FactManifestMirror",
            world_session_id,
            &world::v1::MarketSessionFinalityAcceptedV1 {
                market_session_id: session.market_session_id.to_owned(),
                market_date_taipei: session.market_date_taipei.to_owned(),
                finality_policy_revision: FINALITY_POLICY_REVISION.to_owned(),
                accepted_at_unix_micros: session.finality_accepted_at_unix_micros(),
            },
        );

        let chapter_id = ids.chapter_ids[position_index];
        let mut source_event_ids: Vec<[u8; 16]> = vec![cognitive_episode_id];
        match script.action {
            DomainActionKind::PaperBuy => source_event_ids.push(ids.buy_order_id),
            DomainActionKind::PaperSell => source_event_ids.push(ids.sell_order_id),
            _ => {}
        }
        if let Some((memory_slot, _)) = script.memory {
            source_event_ids.push(ids.memory_ids[memory_slot]);
        }
        let chapter_utterance = speech_slot.map(|slot| &utterances[slot]);
        let source_set = StorySourceSet {
            chapter_id,
            character_ids: vec![ids.character_id],
            source_event_ids: source_event_ids.clone(),
            utterance_artifact_ids: chapter_utterance
                .map(|artifact| vec![artifact.utterance_artifact_id])
                .unwrap_or_default(),
            source_set_digest: payload_digest(
                format!("v5-slice-story-source-set/s{}", session.session_index).as_bytes(),
            ),
        };
        let mut chapter =
            StoryChapter::compose(chapter_id, source_set.clone()).expect("non-empty source set");

        let mut segments: Vec<story::v1::NarrativeSegmentV1> = Vec::new();
        segments.push(narrator_segment(
            "segment-market",
            common_v2::TruthClass::FictionalSetting,
            script.market_line,
            vec![session.manifest_id.to_owned()],
        ));
        if let Some(artifact) = chapter_utterance {
            segments.push(story::v1::NarrativeSegmentV1 {
                segment_id: "segment-claim".to_owned(),
                variant: Some(story::v1::narrative_segment_v1::Variant::CharacterClaim(
                    story::v1::narrative_segment_v1::CharacterClaim {
                        utterance_artifact_id: artifact.utterance_artifact_id.to_vec(),
                        canonical_text_sha256: artifact.canonical_text_sha256.to_vec(),
                        source_refs: vec![hex_id(artifact.semantic_speech_act_event_id)],
                    },
                )),
            });
        }
        segments.push(narrator_segment(
            "segment-observable",
            common_v2::TruthClass::SimulatedNarrative,
            script.observable_line,
            vec![hex_id(cognitive_episode_id)],
        ));
        if let Some(motif_line) = script.motif_line {
            segments.push(narrator_segment(
                "segment-motif",
                common_v2::TruthClass::SymbolicInterpretation,
                motif_line,
                vec![seed::MOTIF_CONTROL_AND_RECOGNITION.motif_id.to_owned()],
            ));
        }

        push_event(
            &mut events,
            "StoryChapterComposed",
            "StoryChapter",
            chapter_id,
            &story::v1::StoryChapterComposedV1 {
                chapter_id: chapter_id.to_vec(),
                source_set: Some(story::v1::StorySourceSetV1 {
                    chapter_id: chapter_id.to_vec(),
                    character_ids: vec![ids.character_id.to_vec()],
                    source_event_ids: source_event_ids
                        .iter()
                        .map(|id| id.to_vec())
                        .collect(),
                    utterance_artifact_refs: chapter_utterance
                        .map(|artifact| {
                            vec![story::v1::UtteranceArtifactRef {
                                utterance_artifact_id: artifact.utterance_artifact_id.to_vec(),
                                canonical_text_sha256: artifact.canonical_text_sha256.to_vec(),
                            }]
                        })
                        .unwrap_or_default(),
                    source_set_digest: source_set.source_set_digest.to_vec(),
                    market_fact_refs: owned(session.outcome_evidence_revision_ids),
                    time_range_from_unix_micros: session.open_unix_micros(),
                    time_range_to_unix_micros: session.finality_accepted_at_unix_micros(),
                    visibility_epoch: 1,
                    narrative_policy_revision: seed::NARRATIVE_POLICY_REVISION.to_owned(),
                }),
                segments,
                chapter_revision: chapter.revision,
            },
        );
        chapter
            .publish(0)
            .expect("fixed sequence: Composed -> Published");
        push_event(
            &mut events,
            "StoryChapterPublished",
            "StoryChapter",
            chapter_id,
            &story::v1::StoryChapterPublishedV1 {
                chapter_id: chapter_id.to_vec(),
                chapter_revision: chapter.revision,
                source_set_digest: source_set.source_set_digest.to_vec(),
                visibility_epoch: 1,
                published_at_unix_micros: session.chapter_published_at_unix_micros(),
            },
        );
    }

    let bias_observations = observe(&signals);

    CharacterSlice {
        ids,
        sessions: SESSIONS,
        events,
        thesis_chain,
        bias_observations,
    }
}

// -- helpers -------------------------------------------------------------------

fn seal_memory(
    events: &mut Vec<CanonicalEventRecord>,
    ledger: &mut MemoryLedger,
    ids: &SliceIds,
    slot: usize,
    memory: SeedMemory,
    formed_at_unix_micros: i64,
    source_event_ids: &[[u8; 16]],
) {
    let memory_id = ids.memory_ids[slot];
    ledger
        .form(MemoryRecord {
            memory_id,
            character_id: ids.character_id,
            kind: memory.kind,
            source_event_digest: payload_digest(memory.tag.as_bytes()),
            formed_at_unix_micros,
            salience_bp: memory.salience_bp,
            confidence_bp: memory.confidence_bp,
            valence_bp: memory.valence_bp,
            visibility: memory.visibility,
        })
        .expect("fixed sequence: each memory id is sealed once");
    push_event(
        events,
        "MemoryFormed",
        "MemoryLedger",
        ids.character_id,
        &character::v1::MemoryFormedV1 {
            memory_id: memory_id.to_vec(),
            character_id: ids.character_id.to_vec(),
            kind: (wire_memory_kind(memory.kind) as i32),
            source_event_ids: source_event_ids.iter().map(|id| id.to_vec()).collect(),
            formed_at_unix_micros,
            salience_bp: memory.salience_bp,
            confidence_bp: memory.confidence_bp,
            valence_bp: memory.valence_bp,
            decay_policy_revision: seed::MEMORY_DECAY_POLICY_REVISION.to_owned(),
            visibility: (wire_visibility(memory.visibility) as i32),
        },
    );
}

fn narrator_segment(
    segment_id: &str,
    truth_class: common_v2::TruthClass,
    text: &str,
    source_refs: Vec<String>,
) -> story::v1::NarrativeSegmentV1 {
    story::v1::NarrativeSegmentV1 {
        segment_id: segment_id.to_owned(),
        variant: Some(story::v1::narrative_segment_v1::Variant::NarratorText(
            story::v1::narrative_segment_v1::ObservableOrEditorialBridge {
                perspective: (story::v1::SegmentPerspective::Observable as i32),
                truth_class: (truth_class as i32),
                text: text.to_owned(),
                source_refs,
            },
        )),
    }
}

/// The price source for a fill or a mark. It always names the sealed close
/// revision it came from, so a number on screen can always be traced to the
/// exact fact -- and to the exact day -- it was taken from. Callers pass the
/// session whose close is being cited, which is not always the session being
/// rendered: today's mark cites yesterday's accepted close.
fn price_source_for(session: &MarketSession) -> portfolio::v1::PriceSourceRef {
    portfolio::v1::PriceSourceRef {
        fact_manifest_id: session.manifest_id.to_owned(),
        fact_revision_id: session.close_price_fact_revision_id.to_owned(),
        sealed_price_fixed: session.sealed_close.raw(),
        price_observed_at_unix_micros: fact_available_at(session.close_price_fact_revision_id),
    }
}

/// Decodes a lowercase hex digest from the upstream contract.
///
/// # Panics
///
/// Panics on a malformed digest -- a mirrored manifest with an unreadable
/// hash must fail closed rather than be stored with a guessed value.
fn hex_bytes(hex: &str) -> Vec<u8> {
    assert!(hex.len().is_multiple_of(2), "hex digest must have even length");
    hex.as_bytes()
        .chunks(2)
        .map(|pair| {
            let text = core::str::from_utf8(pair).expect("ascii hex");
            u8::from_str_radix(text, 16).expect("valid hex digest")
        })
        .collect()
}

fn owned(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_owned()).collect()
}

fn fact_set_digest(values: &[&str]) -> [u8; 32] {
    payload_digest(values.join("\u{0}").as_bytes())
}

/// Converts a basis-point reading into the `[-1, 1]`-bounded component the
/// attention/utility math expects: 10,000bp maps to `Fixed::ONE`.
fn bp_component(value_bp: i32) -> Fixed {
    Fixed::from_raw(i64::from(value_bp) * 100)
}

fn wire_state(state: DynamicState) -> character::v1::DynamicStateV1 {
    character::v1::DynamicStateV1 {
        valence_bp: state.valence_bp,
        arousal_bp: state.arousal_bp,
        stress_bp: state.stress_bp,
        fatigue_bp: state.fatigue_bp,
        confidence_bp: state.confidence_bp,
        fomo_bp: state.fomo_bp,
        uncertainty_load_bp: state.uncertainty_load_bp,
    }
}

fn wire_action(action: DomainActionKind) -> character::v1::ActionKind {
    match action {
        DomainActionKind::NoAction => character::v1::ActionKind::NoAction,
        DomainActionKind::ReadOrVerify => character::v1::ActionKind::ReadOrVerify,
        DomainActionKind::Wait => character::v1::ActionKind::Wait,
        DomainActionKind::PaperBuy => character::v1::ActionKind::PaperBuy,
        DomainActionKind::PaperSell => character::v1::ActionKind::PaperSell,
    }
}

fn wire_surface(surface: SurfaceKind) -> character::v1::SurfaceKind {
    match surface {
        SurfaceKind::PublicSpeech => character::v1::SurfaceKind::PublicSpeech,
        SurfaceKind::PublicWriting => character::v1::SurfaceKind::PublicWriting,
        SurfaceKind::SelfAcknowledged => character::v1::SurfaceKind::SelfAcknowledged,
    }
}

fn wire_sealing(sealing: SealingEventType) -> character::v1::SealingEventType {
    match sealing {
        SealingEventType::PublicClaimMade => character::v1::SealingEventType::PublicClaimMade,
        SealingEventType::SelfAcknowledgementMade => {
            character::v1::SealingEventType::SelfAcknowledgementMade
        }
    }
}

fn wire_memory_kind(kind: panshi_character_domain::memory::MemoryKind) -> character::v1::MemoryKind {
    use panshi_character_domain::memory::MemoryKind;
    match kind {
        MemoryKind::Episodic => character::v1::MemoryKind::Episodic,
        MemoryKind::Belief => character::v1::MemoryKind::Belief,
        MemoryKind::RelationshipMemory => character::v1::MemoryKind::Relationship,
        MemoryKind::SelfNarrative => character::v1::MemoryKind::SelfNarrative,
    }
}

fn wire_visibility(
    visibility: panshi_character_domain::memory::MemoryVisibility,
) -> character::v1::memory_formed_v1::Visibility {
    use panshi_character_domain::memory::MemoryVisibility;
    match visibility {
        MemoryVisibility::CanonicalRestricted => {
            character::v1::memory_formed_v1::Visibility::CanonicalRestricted
        }
        MemoryVisibility::SubscriberArchive => {
            character::v1::memory_formed_v1::Visibility::SubscriberArchive
        }
        MemoryVisibility::PublicEdition => {
            character::v1::memory_formed_v1::Visibility::PublicEdition
        }
    }
}

fn wire_posting(posting: &JournalPosting) -> portfolio::v1::JournalPostingV1 {
    portfolio::v1::JournalPostingV1 {
        kind: (crate::to_wire_journal_kind(posting.kind) as i32),
        security_id: if posting.kind == JournalEntryKind::Position {
            SECURITY_ID.to_owned()
        } else {
            String::new()
        },
        amount_fixed: posting.amount.raw(),
    }
}

const fn audience_scope(surface: SurfaceKind) -> &'static str {
    match surface {
        SurfaceKind::SelfAcknowledged => seed::AUDIENCE_SCOPE_SELF,
        SurfaceKind::PublicSpeech | SurfaceKind::PublicWriting => seed::AUDIENCE_SCOPE_PUBLIC,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        CHAPTER_COUNT, SESSIONS, one_character_slice,
        sessions::{FACT_COUNTER_INVENTORY, LAST_FINAL_SESSION_INDEX},
    };
    use panshi_character_domain::bias::{BiasKind, recurrence_count};
    use panshi_character_domain::thesis::newly_supported_facts;
    use panshi_decision_kernel::Fixed;
    use panshi_protocol::{character, decode_canonical, portfolio, story, world};

    fn count_of(event_type: &str) -> usize {
        one_character_slice()
            .events
            .iter()
            .filter(|event| event.event_type == event_type)
            .count()
    }

    #[test]
    fn slice_is_deterministic_across_calls() {
        let first = one_character_slice();
        let second = one_character_slice();
        assert_eq!(first.events.len(), second.events.len());
        for (left, right) in first.events.iter().zip(second.events.iter()) {
            assert_eq!(left.event_type, right.event_type);
            assert_eq!(left.stream_type, right.stream_type);
            assert_eq!(left.stream_id, right.stream_id);
            assert_eq!(left.payload_bytes, right.payload_bytes);
            assert_eq!(left.payload_digest, right.payload_digest);
        }
        assert_eq!(first.thesis_chain, second.thesis_chain);
        assert_eq!(first.bias_observations, second.bias_observations);
    }

    #[test]
    fn slice_emits_six_market_sessions() {
        let slice = one_character_slice();
        let dates: Vec<String> = slice
            .events
            .iter()
            .filter(|event| event.event_type == "FactManifestAccepted")
            .map(|event| {
                decode_canonical::<world::v1::FactManifestAcceptedV1>(&event.payload_bytes)
                    .expect("canonical manifest")
                    .market_date_taipei
            })
            .collect();
        assert_eq!(
            dates,
            vec![
                "2026-03-02", "2026-03-03", "2026-03-05", "2026-03-10", "2026-03-17", "2026-03-18",
            ]
        );
        assert_eq!(slice.sessions.len(), SESSIONS.len());
    }

    #[test]
    fn slice_publishes_five_story_chapters() {
        assert_eq!(count_of("StoryChapterPublished"), CHAPTER_COUNT);
        assert_eq!(count_of("StoryChapterComposed"), CHAPTER_COUNT);
        assert_eq!(CHAPTER_COUNT, 5);
    }

    /// Session 6 is "today": in session, finality pending. It must accept no
    /// finality and publish no chapter, so the same screen can show a
    /// settled number beside an explicitly unsettled one.
    #[test]
    fn slice_emits_finality_for_first_five_sessions_only() {
        let slice = one_character_slice();
        let finalized: Vec<String> = slice
            .events
            .iter()
            .filter(|event| event.event_type == "MarketSessionFinalityAccepted")
            .map(|event| {
                decode_canonical::<world::v1::MarketSessionFinalityAcceptedV1>(&event.payload_bytes)
                    .expect("canonical finality")
                    .market_date_taipei
            })
            .collect();
        assert_eq!(finalized.len(), LAST_FINAL_SESSION_INDEX);
        assert_eq!(
            finalized,
            vec!["2026-03-02", "2026-03-03", "2026-03-05", "2026-03-10", "2026-03-17"]
        );
        assert!(!finalized.contains(&"2026-03-18".to_owned()));
    }

    /// The S4 switch is only evidence of rationalization because the set
    /// difference is empty. Checked at both layers it is visible in: the
    /// thesis chain, and the two sealed utterances.
    #[test]
    fn rationalization_switch_adds_zero_new_supporting_facts() {
        let slice = one_character_slice();
        assert_eq!(slice.thesis_chain.len(), 2);
        let first = slice.thesis_chain.first().expect("original thesis");
        let latest = slice.thesis_chain.latest().expect("rewritten thesis");
        assert_ne!(first.thesis_revision_id, latest.thesis_revision_id);
        assert!(newly_supported_facts(first, latest).is_empty());

        let claims: Vec<character::v1::UtteranceArtifactV1> = slice
            .events
            .iter()
            .filter(|event| event.event_type == "PublicClaimMade")
            .map(|event| {
                decode_canonical::<character::v1::UtteranceArtifactV1>(&event.payload_bytes)
                    .expect("canonical utterance")
            })
            .collect();
        assert_eq!(claims.len(), 3);
        let u1 = &claims[0];
        let u2 = &claims[1];
        assert_eq!(
            u2.replies_to_utterance_artifact_id.as_deref(),
            Some(u1.utterance_artifact_id.as_slice())
        );
        let added: Vec<&String> = u2
            .visible_fact_revision_ids
            .iter()
            .filter(|fact| !u1.visible_fact_revision_ids.contains(fact))
            .collect();
        assert!(added.is_empty(), "U2 cites no fact U1 did not already cite");

        assert_eq!(
            recurrence_count(&slice.bias_observations, BiasKind::RationalizationSwitch),
            1
        );
    }

    #[test]
    fn confirmation_bias_recurs_at_least_twice() {
        let slice = one_character_slice();
        let occurrences: Vec<usize> = slice
            .bias_observations
            .iter()
            .filter(|observation| observation.kind == BiasKind::ConfirmationBias)
            .map(|observation| observation.session_index)
            .collect();
        assert!(occurrences.len() >= 2);
        assert_eq!(occurrences, vec![2, 3, 4]);

        // The same counter-evidence was public from S1 and never selected
        // again until S5. He could see it every one of those days.
        let missed: Vec<Vec<String>> = slice
            .events
            .iter()
            .filter(|event| event.event_type == "AttentionCommitted")
            .map(|event| {
                decode_canonical::<character::v1::AttentionCommittedV1>(&event.payload_bytes)
                    .expect("canonical attention")
                    .missed_high_salience_fact_revision_ids
            })
            .collect();
        for (offset, session_missed) in missed[1..4].iter().enumerate() {
            assert!(
                session_missed.contains(&FACT_COUNTER_INVENTORY.to_owned()),
                "S{} must carry the counter-evidence in missed",
                offset + 2
            );
        }
        assert!(missed[4].is_empty(), "S5 misses nothing");
    }

    #[test]
    fn sunk_cost_escalation_holds_after_invalidation_occurred() {
        let slice = one_character_slice();
        let occurrences: Vec<usize> = slice
            .bias_observations
            .iter()
            .filter(|observation| observation.kind == BiasKind::SunkCostEscalation)
            .map(|observation| observation.session_index)
            .collect();
        assert_eq!(occurrences, vec![3, 4]);
        // S5 has the same expired thesis and a worse loss, but he sold --
        // so nothing is observed there, and nothing is observed today either.
        assert!(!occurrences.contains(&5));
        assert!(!occurrences.contains(&6));
    }

    #[test]
    fn fomo_chase_requires_a_missed_high_salience_fact() {
        let slice = one_character_slice();
        let chases: Vec<usize> = slice
            .bias_observations
            .iter()
            .filter(|observation| observation.kind == BiasKind::FomoChase)
            .map(|observation| observation.session_index)
            .collect();
        assert_eq!(chases, vec![2]);
        let evidence = &slice
            .bias_observations
            .iter()
            .find(|observation| observation.kind == BiasKind::FomoChase)
            .expect("one chase")
            .evidence_session_indices;
        assert_eq!(evidence, &vec![1, 2]);

        let missed_at_s1 = slice
            .events
            .iter()
            .filter(|event| event.event_type == "AttentionCommitted")
            .map(|event| {
                decode_canonical::<character::v1::AttentionCommittedV1>(&event.payload_bytes)
                    .expect("canonical attention")
            })
            .next()
            .expect("S1 attention");
        assert!(!missed_at_s1.missed_high_salience_fact_revision_ids.is_empty());
    }

    #[test]
    fn fomo_chase_does_not_trigger_when_new_evidence_arrives() {
        let slice = one_character_slice();
        assert_eq!(recurrence_count(&slice.bias_observations, BiasKind::FomoChase), 1);
        for observation in &slice.bias_observations {
            if observation.kind == BiasKind::FomoChase {
                assert_ne!(
                    observation.session_index, 6,
                    "the session after the acknowledgement is not a chase"
                );
            }
        }
    }

    /// The loss is realized, complete, and stays visible: 400 shares closed
    /// at 88.20 against a 100.00 cost basis is -4,720, and the surviving 600
    /// shares carry -7,080 unrealized.
    #[test]
    fn slice_realizes_a_loss_on_the_final_reduction() {
        let slice = one_character_slice();
        let adjusted = slice
            .events
            .iter()
            .find(|event| event.event_type == "PaperPositionAdjusted")
            .expect("the S5 reduction");
        let payload =
            decode_canonical::<portfolio::v1::PaperPositionAdjustedV1>(&adjusted.payload_bytes)
                .expect("canonical adjustment");
        assert_eq!(payload.realized_pnl_delta_fixed, -4_720 * Fixed::SCALE);
        assert_eq!(payload.unrealized_pnl_after_fixed, -7_080 * Fixed::SCALE);
        assert!(payload.realized_pnl_delta_fixed < 0, "the loss is not hidden");

        let outcome = slice
            .events
            .iter()
            .find(|event| event.event_type == "PaperOutcomeRecognized")
            .expect("the outcome");
        let outcome =
            decode_canonical::<portfolio::v1::PaperOutcomeRecognizedV1>(&outcome.payload_bytes)
                .expect("canonical outcome");
        assert_eq!(
            outcome.attribution,
            portfolio::v1::OutcomeAttributionKind::ThesisBrokenLoss as i32
        );
    }

    /// Regression guard: the frozen twenty-payload parity fixture must be
    /// untouched by anything in this module.
    #[test]
    fn golden_episode_still_emits_twenty_events() {
        assert_eq!(crate::golden_episode().events.len(), 20);
    }

    /// Every narrator-written segment declares a `truth_class`, and market
    /// facts in this synthetic fixture are never `REAL_FACT`.
    #[test]
    fn every_narrated_segment_declares_a_truth_class_and_none_claims_real_fact() {
        let slice = one_character_slice();
        let mut narrated = 0_usize;
        for event in slice
            .events
            .iter()
            .filter(|event| event.event_type == "StoryChapterComposed")
        {
            let chapter =
                decode_canonical::<story::v1::StoryChapterComposedV1>(&event.payload_bytes)
                    .expect("canonical chapter");
            for segment in &chapter.segments {
                if let Some(story::v1::narrative_segment_v1::Variant::NarratorText(text)) =
                    &segment.variant
                {
                    narrated += 1;
                    assert_ne!(
                        text.truth_class,
                        panshi_protocol::common::v2::TruthClass::Unspecified as i32
                    );
                    assert_ne!(
                        text.truth_class,
                        panshi_protocol::common::v2::TruthClass::RealFact as i32,
                        "a synthetic fixture may never label itself a real fact"
                    );
                }
            }
        }
        assert!(narrated >= 10);
    }

    /// The self-imposed cap is what makes "只是小部位" checkable: NT$100,000
    /// of a NT$1,000,000 account is 82% of his own 12.20% limit.
    #[test]
    fn the_position_sits_at_eighty_two_percent_of_his_own_cap() {
        let notional = 100_000_i64;
        let cap = 1_000_000_i64 * i64::from(super::seed::PERSONAL_EXPOSURE_CAP_BP) / 10_000;
        assert_eq!(cap, 122_000);
        let used_bp = notional * 10_000 / cap;
        assert_eq!(used_bp, 8_196);
        assert_eq!((used_bp + 50) / 100, 82);
    }
}
