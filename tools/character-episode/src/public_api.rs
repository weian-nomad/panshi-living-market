#![allow(clippy::too_many_lines)]

//! The public read-side projection: it folds the one-character slice's
//! canonical event log into the ten response objects
//! `contracts/openapi/public-v2.yaml` defines, serialized as the exact JSON
//! a browser would receive from `/api/v2/*`.
//!
//! Relationship to `crate::projection`: that module is the minimal
//! replay-fidelity proof (three domain structs, no envelope). This module is
//! its public extension -- same discipline, same "fold the WHOLE ordered log
//! into a fresh value on every call, carry no state between calls", but
//! shaped field for field to the published contract so the web client can
//! call a real route path and receive the final API shape, not a demo struct
//! that has to be thrown away later.
//!
//! Rules this module holds itself to:
//!
//! - **A projection only restates what a canonical event already said.**
//!   Every number, timestamp, quantity, price, artifact id and verbatim
//!   utterance below is decoded out of `slice.events`. Nothing is recomputed
//!   from a more convenient source and nothing is invented. The stable
//!   labels that have no canonical event of their own (display name,
//!   occupation, and the presentation-only scene and story-hook identities)
//!   come from the frozen chassis in `crate::slice::seed` or from a
//!   `derive_id` tag, and each one is called out at its construction site.
//! - **Fail closed.** A missing fact is rendered as its own absence, never
//!   as a zero. `relationshipDyadRefs` carries a dyad id only on a chapter
//!   whose session actually appended a `RelationshipSignalObserved` to that
//!   stream, and `influencedByCharacterRefs` stays empty because no sealed
//!   influence exists, rather than carrying a plausible-looking id.
//! - **The as-of fence.** Every currently-visible paper figure is dated by
//!   the price source the canonical mark actually cited, which for today's
//!   in-session mark is the previous session's accepted close
//!   (2026-04-13T13:30:00+08:00). A settled journal chapter is dated by its
//!   own accepted close, because that is the moment its number was true. No
//!   paper figure anywhere is dated 2026-04-14, whose finality is pending.
//! - **Per-day copy is derived, not tabled.** A chapter's scene summary is
//!   the observable segment its own `StoryChapterComposed` sealed; its action,
//!   rationale and open-question sentences are composed from what the fold
//!   decoded for that session (action kind, fill, cited thesis revision,
//!   missed facts, invalidation, the structured outcome attribution). There
//!   is no per-session copy table to drift from the log.
//! - **Integer money only.** Amounts are currency minor units; quantities
//!   and per-unit prices are `*Fixed6` integers. No floating point enters
//!   this module (the workspace lints deny it outright), and a value that
//!   does not divide exactly panics instead of being rounded into public
//!   view.
//! - **`truth_class` integrity.** This slice's market facts are a
//!   repo-local synthetic fixture, so the only classes a response may carry
//!   are `fictional_setting`, `symbolic_interpretation` and
//!   `simulated_narrative`. `real_fact` may never appear in any field. Each
//!   visible claim carries its own class (a sibling `<field>TruthClass`, or
//!   `truthClass` on an object that is one claim), set here from what the
//!   claim is; the envelope `truthClasses` is the set of all of them.
//!   Since public-v2 2.2.0 no visible field borrows its class from an
//!   object further up (nested people, quoted sentences, lots and fills
//!   carry their own). Fixed system sentences (`*EmptyReason`,
//!   `*NullReason`, `heldReasonLabel`) are not claims and carry no class;
//!   each one this projection can emit is listed, per field, in
//!   `contracts/openapi/public-v2-system-labels.json`, and
//!   `tests/slice_claim_truth_classes.rs` holds every emitted document to
//!   that list.
//!
//! Key order in the emitted JSON is `serde_json`'s stable alphabetical map
//! order, which is what makes two runs byte-identical. The nine-segment
//! reading order of `docs/v5/experience-spec.md` §8.1 is a rendering
//! concern for the client, not a wire concern.
//!
//! Product copy in this file is engineering fixture copy for the slice, not
//! reviewed product text; the repository's `copy-taste` routing rule must
//! run over all of it before any of it reaches a viewer. It carries no
//! ranking, win rate, leaderboard, or call to action.

use std::collections::BTreeSet;

use serde_json::{Map, Value, json};

use panshi_character_domain::{
    bias::{BiasKind, is_recurring_at, recurrence_count},
    thesis::{InvalidationState, evaluate_invalidation, newly_supported_facts},
};
use panshi_protocol::{character, decode_canonical, portfolio, story, world};

mod archive_sections;
mod evidence;
mod gate;
pub mod kill_switch;

use crate::{
    derive_id, payload_digest,
    slice::{
        CharacterSlice, INTENDED_HORIZON_DAYS, seed,
        sessions::{
            FACT_COUNTER_INVENTORY, FACT_ISSUER_CORRECTION, FACT_MOMENTUM_S1, ManifestModeDomain,
        },
    },
};
use gate::Gate;
use kill_switch::ProjectionKillSwitch;

// -- kill-switch system labels ---------------------------------------------
//
// Fixed system sentences (`x-panshi-system-label`), listed per field in
// `contracts/openapi/public-v2-system-labels.json`. They describe the system,
// name nothing that was withheld (naming the closed company or day would
// itself be the signal the switch exists to stop), and carry no truth class.
// "人物的生活、關係與記憶照常" is true wherever these are emitted: a switch only
// ever withholds market-derived objects (`gate.rs`), and every non-market
// item stays -- `tests/projection_kill_switch.rs` holds that on every page
// that carries the sentence.
// Engineering placeholder copy, 未經 copy-taste 審稿.

/// `heldReasonLabel` of a chapter withheld by a kill switch.
const KILL_SWITCH_HELD_REASON_LABEL: &str =
    "這一章的市場內容依發布規則暫停公開；人物的生活、關係與記憶照常。";

/// `marketClosureReasonLabel`: present on a world, close-up, archive index,
/// paper archive or archive section document exactly when a kill switch
/// withheld at least one of its objects.
const MARKET_CLOSURE_REASON_LABEL: &str =
    "這一頁有部分市場內容依發布規則暫停顯示；人物的生活、關係與記憶照常。";

/// `summaryHeldReasonLabel` of an archive index section whose one-line
/// summary a kill switch withheld.
const SUMMARY_HELD_REASON_LABEL: &str = "這一節的摘要含有依發布規則暫停顯示的市場內容。";

/// The audience scope this slice resolves each public route at. The world
/// snapshot and the life journal are the anonymous public surface; the deep
/// archive is the subscriber surface (`docs/v5/experience-spec.md` §9).
const PUBLIC_SCOPE: &str = "public_current";
const ARCHIVE_SCOPE: &str = "subscriber_archive";

const ARCHIVE_SCHEMA_REVISION: &str = "character-archive/v1";

/// The occupation label for `occupation_group: "corporate_research_assistant"`.
const OCCUPATION_LABEL: &str = "企業研究助理";

/// `Fixed` carries six decimals of one TWD; one TWD is 100 minor units.
const FIXED_RAW_PER_MINOR_UNIT: i64 = 10_000;

/// One whole share, in `Fixed` raw.
const FIXED_RAW_PER_UNIT: i64 = 1_000_000;

/// The six deep-archive sections, in `ArchiveSectionKey` order. Each one has
/// its own endpoint.
const ARCHIVE_SECTION_KEYS: [&str; 6] =
    ["paper", "relations", "chart", "traits", "memories", "life"];

/// The correction the upstream fixture published mid-session on S7
/// (2026-03-10).
const CORRECTION_FACT_REVISION_ID: &str = FACT_ISSUER_CORRECTION;

// -- per-claim truth classes ----------------------------------------------
//
// Every visible claim carries its own `truth_class` (public-v2 2.1.0), chosen
// here by what the claim IS, never by the client. The mapping follows
// `docs/v5/product-constitution.md` "角色資料的五種身分":
//
// - His attention, inner state, actions, words, paper trading, and every
//   sentence composed from them are `simulated_narrative`.
// - The chassis he was authored with (name, age, occupation, the
//   acquaintance, the backstory) is `fictional_setting`. Age and occupation
//   would be `statistical_sample` only if they had been drawn from a sealed
//   statistical distribution; this slice's chassis is the hand-authored
//   worked example of `docs/v5/character-story-engine.md`, so they are not.
// - A market fact takes the class of its source. Every market fact here is
//   the repo-owned synthetic historical fixture, whose records are sealed
//   `fictional_setting` (`contracts/world-fact-manifest/historical-v1/`).
// - The natal motif's cultural reading is `symbolic_interpretation`.
//
// `real_fact` is never a value here: nothing in this slice is one.

/// His attention, actions, words, paper figures and the prose composed from
/// them.
const SIMULATED_NARRATIVE: &str = "simulated_narrative";

/// The authored chassis.
const FICTIONAL_SETTING: &str = "fictional_setting";

/// The natal motif's cultural reading.
const SYMBOLIC_INTERPRETATION: &str = "symbolic_interpretation";

/// A market fact, by its source: the synthetic historical fixture.
const SYNTHETIC_FACT_TRUTH_CLASS: &str = FICTIONAL_SETTING;

/// The truth class of each archive section's one-line index summary.
fn section_summary_truth_class(key: &str) -> &'static str {
    match key {
        // Paper figures; his public attributions of the loss; how many
        // memories the simulated life has sealed; how far his story has run.
        "paper" | "relations" | "memories" | "life" => SIMULATED_NARRATIVE,
        "chart" => SYMBOLIC_INTERPRETATION,
        // The authored four-axis and blood-type chassis and its fixed zero
        // market weight.
        "traits" => FICTIONAL_SETTING,
        other => unreachable!("unknown archive section key {other}"),
    }
}

// -- per-item classes of nested items (2.2.0) -----------------------------
//
// The section and evidence builders emit a few nested items whose readable
// fields 2.1.0 left covered only by the object above them: the people a
// memory involves, the name and relation label on a relationship signal
// (whose own class is `simulated_narrative`, because the signal is his act),
// and the verbatim sentence inside a signal. Each gets its own class here,
// next to the rest of the class mapping, so that no visible field borrows a
// class from its parent. A shape these functions do not recognise panics:
// silently skipping it would publish an unclassified claim.

/// The people a memory involves are chassis: `ArchivePersonLabel.truthClass`.
fn classify_person_label(person: &mut Value) {
    let person = person
        .as_object_mut()
        .expect("an involved person is an object");
    assert!(
        person.contains_key("displayName") && person.contains_key("relationLabel"),
        "an involved person carries a display name and a relation label"
    );
    person.insert("truthClass".to_owned(), json!(FICTIONAL_SETTING));
}

/// A `RelationshipSignalView`: the signal is his act (`simulated_narrative`,
/// set by its builder), the counterpart's name and relation label are
/// chassis, and the sentence that caused it is his words.
fn classify_signal_view(signal: &mut Value) {
    let signal = signal
        .as_object_mut()
        .expect("a relationship signal is an object");
    assert!(
        signal.contains_key("displayName") && signal.contains_key("relationLabel"),
        "a relationship signal names its counterpart"
    );
    signal.insert("displayNameTruthClass".to_owned(), json!(FICTIONAL_SETTING));
    signal.insert("relationLabelTruthClass".to_owned(), json!(FICTIONAL_SETTING));
    signal
        .get_mut("utterance")
        .and_then(Value::as_object_mut)
        .expect("a relationship signal quotes its sealed utterance")
        .insert("truthClass".to_owned(), json!(SIMULATED_NARRATIVE));
}

/// Classify the nested items of one archive detail section document.
fn classify_section_nested_items(key: &str, mut document: Value) -> Value {
    match key {
        "memories" => {
            for memory in document["memories"]
                .as_array_mut()
                .expect("the memories section lists memories")
            {
                for person in memory["involvedPeople"]
                    .as_array_mut()
                    .expect("a memory lists the people it involves")
                {
                    classify_person_label(person);
                }
            }
        }
        "relations" => {
            for acquaintance in document["acquaintances"]
                .as_array_mut()
                .expect("the relations section lists acquaintances")
            {
                for signal in acquaintance["relationshipSignals"]
                    .as_array_mut()
                    .expect("an acquaintance lists her relationship signals")
                {
                    classify_signal_view(signal);
                }
            }
        }
        _ => {}
    }
    document
}

// -- folded state ---------------------------------------------------------

/// Where a canonical event sits in the log: its type, its 1-based global
/// position (the same coordinate `sourceGlobalPosition` counts in), and the
/// stream it was appended to. This is what every archive `sourceRefs` entry
/// that points at the log is built from.
#[derive(Clone, Copy, Debug)]
struct EventRef {
    event_type: &'static str,
    global_position: u64,
    stream_id: [u8; 16],
}

#[derive(Clone, Debug)]
struct FoldedUtterance {
    artifact_id: Vec<u8>,
    canonical_text_utf8: String,
    canonical_text_sha256_hex: String,
    /// `SurfaceKind`: a self-acknowledgement belongs in 現在怎麼說, a public
    /// claim in 他當時怎麼說.
    surface_kind: i32,
    replies_to: Option<Vec<u8>>,
    event_ref: EventRef,
    /// The 1-based session the artifact was sealed in, if any.
    session_index: Option<usize>,
}

impl FoldedUtterance {
    fn is_self_acknowledged(&self) -> bool {
        self.surface_kind == character::v1::SurfaceKind::SelfAcknowledged as i32
    }
}

#[derive(Clone, Debug)]
struct FoldedLot {
    lot_id: Vec<u8>,
    quantity_fixed: i64,
    /// Per unit, in `Fixed` raw.
    cost_basis_fixed: i64,
    /// The upstream manifest hash that sealed the price this lot opened at,
    /// mirrored as received in `FactManifestAcceptedV1` -- this repository
    /// never recomputes an upstream digest.
    sealed_price_manifest_hash_hex: String,
}

#[derive(Clone, Debug)]
struct FoldedPosition {
    position_id: Vec<u8>,
    instrument_label: String,
    lots: Vec<FoldedLot>,
    realized_pnl_fixed: i64,
    unrealized_pnl_fixed: i64,
    stream_version: u64,
    opened_at_unix_micros: i64,
    /// The `PaperPositionOpened` event.
    opened_ref: EventRef,
}

#[derive(Clone, Debug)]
struct FoldedOrder {
    order_id: Vec<u8>,
    stream_version: u64,
}

#[derive(Clone, Debug)]
struct FoldedFill {
    sealed_price_fixed: i64,
    sealed_price_manifest_hash_hex: String,
    filled_at_unix_micros: i64,
    filled_quantity_fixed: i64,
    fee_fixed: i64,
    tax_fixed: i64,
    event_ref: EventRef,
    /// The session whose manifest sealed that price, when mirrored.
    price_session_index: Option<usize>,
}

#[derive(Clone, Debug)]
struct FoldedMark {
    unrealized_pnl_fixed: i64,
    /// The observation time of the price the mark cited -- not the time the
    /// mark ran. For today's mark those differ, and the cited one is the
    /// honest as-of.
    price_observed_at_unix_micros: i64,
    /// The cost basis the mark was computed against, in minor units, as the
    /// lot book stood at that moment.
    cost_basis_minor_units: i64,
    /// The mirrored hash of the manifest whose sealed close the mark cited.
    price_manifest_hash_hex: String,
    event_ref: EventRef,
    /// The session whose manifest sealed that price, when mirrored.
    price_session_index: Option<usize>,
}

#[derive(Clone, Debug)]
struct FoldedFact {
    fact_revision_id: String,
    market_date_taipei: String,
    available_at_unix_micros: i64,
    /// The session whose manifest made the fact visible.
    session_index: usize,
}

/// One segment of a sealed `StoryChapterComposed`, restated as decoded.
#[derive(Clone, Debug)]
enum FoldedSegmentBody {
    Narrator {
        truth_class: &'static str,
        text: String,
    },
    Claim {
        artifact_id: Vec<u8>,
        canonical_text_sha256_hex: String,
    },
}

#[derive(Clone, Debug)]
struct FoldedSegment {
    segment_id: String,
    body: FoldedSegmentBody,
    /// The segment's own sealed `source_refs`: what it was composed from.
    source_refs: Vec<String>,
}

/// `CharacterOriginSealedV1`, the fields the archive restates.
#[derive(Clone, Debug)]
struct FoldedOrigin {
    birth_date: String,
    birth_region: String,
    /// social, information, decision, closure -- in `FourAxisPreference`
    /// field order.
    four_axis_bp: [i32; 4],
    event_ref: EventRef,
}

/// `MemoryFormedV1`, as sealed.
#[derive(Clone, Debug)]
struct FoldedMemory {
    memory_id: Vec<u8>,
    kind: i32,
    source_event_ids: Vec<Vec<u8>>,
    formed_at_unix_micros: i64,
    salience_bp: i32,
    confidence_bp: i32,
    valence_bp: i32,
    visibility: i32,
    /// `None` for the bootstrap memories sealed before the first session.
    session_index: Option<usize>,
    event_ref: EventRef,
}

/// `RelationshipSignalObservedV1`, as sealed.
#[derive(Clone, Debug)]
struct FoldedSignal {
    signal_id: Vec<u8>,
    dyad_id: Vec<u8>,
    counterpart_ref: String,
    signal_kind: i32,
    utterance_artifact_id: Vec<u8>,
    canonical_text_sha256_hex: String,
    observed_at_unix_micros: i64,
    session_index: usize,
    event_ref: EventRef,
}

#[derive(Clone, Debug)]
struct FoldedSession {
    session_index: usize,
    manifest_id: String,
    manifest_hash_hex: String,
    /// `FactManifestAcceptedV1.market_session_id`.
    market_session_id: String,
    /// The manifest's `modeDomain`, from the mirrored fixture; a manifest
    /// the mirror does not know is treated as `Current` (fail closed: its
    /// provenance as synthetic history is not established).
    mode_domain: ManifestModeDomain,
    /// `AutonomousActionIntentCommittedV1.security_id`; empty for a
    /// non-paper action.
    intent_security_id: String,
    /// `AutonomousActionIntentCommittedV1.perceived_fact_revision_ids`.
    intent_perceived_fact_revision_ids: Vec<String>,
    market_date_taipei: String,
    interaction_cutoff_unix_micros: i64,
    evidence_cutoff_unix_micros: i64,
    finality_accepted: bool,
    cognitive_episode_id: Vec<u8>,
    selected_fact_revision_ids: Vec<String>,
    missed_fact_revision_ids: Vec<String>,
    action: i32,
    quantity_fixed: i64,
    confidence_bp: i32,
    utterance_index: Option<usize>,
    /// `AutonomousActionIntentCommittedV1.thesis_revision`.
    thesis_revision: String,
    /// `SemanticSpeechActCommittedV1.outcome_attribution.target_kind`, when
    /// he made a statement about a loss this session.
    outcome_attribution_kind: Option<i32>,
    /// The dyad stream a `RelationshipSignalObserved` was appended to.
    relationship_dyad_id: Option<Vec<u8>>,
    /// `PaperPositionAdjustedV1.realized_pnl_delta_fixed`, summed.
    realized_pnl_delta_fixed: i64,
    /// The observable segment the session's own chapter sealed.
    observable_text: Option<String>,
    memory_ids: Vec<Vec<u8>>,
    fill: Option<FoldedFill>,
    marks: Vec<FoldedMark>,
    /// Whether the position's own lot book changed in this session (opened
    /// or reduced). A mark is a valuation, not a change.
    position_changed: bool,
    chapter_id: Option<Vec<u8>>,
    manifest_ref: EventRef,
    attention_ref: Option<EventRef>,
    intent_ref: Option<EventRef>,
    adjustment_ref: Option<EventRef>,
    chapter_ref: Option<EventRef>,
    /// Every segment the session's own chapter sealed, in sealed order.
    segments: Vec<FoldedSegment>,
    /// Index into `Fold::signals`, when this session appended one.
    signal_index: Option<usize>,
}

impl FoldedSession {
    fn last_mark(&self) -> Option<&FoldedMark> {
        self.marks.last()
    }
}

#[derive(Clone, Debug, Default)]
struct Fold {
    character_id: Vec<u8>,
    paper_account_id: Vec<u8>,
    initial_cash_fixed: i64,
    cash_fixed: i64,
    account_version: u64,
    orders: Vec<FoldedOrder>,
    position: Option<FoldedPosition>,
    sessions: Vec<FoldedSession>,
    utterances: Vec<FoldedUtterance>,
    facts: Vec<FoldedFact>,
    /// Every `MemoryFormed`, bootstrap memories included.
    memory_count: usize,
    memories: Vec<FoldedMemory>,
    signals: Vec<FoldedSignal>,
    origin: Option<FoldedOrigin>,
    visibility_epoch: u64,
    /// The exact aggregate versions `PaperOutcomeRecognizedV1` sealed, kept
    /// so a test can check this fold against what the ledger itself wrote.
    recognized_account_version: Option<u64>,
    recognized_order_version: Option<u64>,
}

impl Fold {
    fn current_session_mut(&mut self) -> &mut FoldedSession {
        self.sessions
            .last_mut()
            .expect("a market session is open before any per-session event")
    }

    fn last_settled_session(&self) -> &FoldedSession {
        self.sessions
            .iter()
            .rev()
            .find(|session| session.finality_accepted)
            .expect("the slice always has at least one settled session")
    }

    fn today(&self) -> &FoldedSession {
        self.sessions.last().expect("the slice always has sessions")
    }

    /// Today's mark: the open position valued against the last ACCEPTED
    /// close, which is where every currently-visible paper figure gets both
    /// its number and its as-of.
    fn current_mark(&self) -> &FoldedMark {
        self.today()
            .last_mark()
            .expect("today marks the open position against the last accepted close")
    }

    fn position(&self) -> &FoldedPosition {
        self.position
            .as_ref()
            .expect("the slice opens exactly one paper position")
    }

    /// The close of the last session in which the position's lot book
    /// actually changed AND whose finality was later accepted. Today's
    /// in-session mark is a valuation against yesterday's close, so it must
    /// not drag this timestamp into an unsettled day.
    fn last_settled_position_change_unix_micros(&self) -> i64 {
        self.sessions
            .iter()
            .filter(|session| session.position_changed && session.finality_accepted)
            .map(|session| session.evidence_cutoff_unix_micros)
            .next_back()
            .expect("the slice opens its position in a settled session")
    }

    fn manifest_hash_of(&self, manifest_id: &str) -> String {
        self.sessions
            .iter()
            .find(|session| session.manifest_id == manifest_id)
            .map_or_else(
                || panic!("price source cites unmirrored manifest {manifest_id}"),
                |session| session.manifest_hash_hex.clone(),
            )
    }

    fn fact(&self, fact_revision_id: &str) -> Option<&FoldedFact> {
        self.facts
            .iter()
            .find(|fact| fact.fact_revision_id == fact_revision_id)
    }

    /// The 1-based index of the session whose manifest is `manifest_id`.
    fn session_index_of(&self, manifest_id: &str) -> Option<usize> {
        self.sessions
            .iter()
            .find(|session| session.manifest_id == manifest_id)
            .map(|session| session.session_index)
    }

    fn session(&self, session_index: usize) -> Option<&FoldedSession> {
        session_index
            .checked_sub(1)
            .and_then(|position| self.sessions.get(position))
    }
}

/// Replays the whole ordered canonical log into the folded read model.
///
/// # Panics
///
/// Panics if a canonical payload fails to decode as its own declared message
/// type, or if a per-session event arrives before its session's manifest.
/// Either would mean the log is not the log this slice emits.
fn fold(slice: &CharacterSlice) -> Fold {
    let mut fold = Fold {
        visibility_epoch: 1,
        ..Fold::default()
    };

    for (offset, event) in slice.events.iter().enumerate() {
        let bytes = event.payload_bytes.as_slice();
        let event_ref = EventRef {
            event_type: event.event_type,
            global_position: u64::try_from(offset + 1).expect("log position fits u64"),
            stream_id: event.stream_id,
        };
        match event.event_type {
            "CharacterOriginSealed" => {
                let decoded = decode_canonical::<character::v1::CharacterOriginSealedV1>(bytes)
                    .expect("canonical CharacterOriginSealedV1");
                let four_axis = decoded
                    .four_axis
                    .expect("a sealed origin always carries its four-axis preference");
                fold.origin = Some(FoldedOrigin {
                    birth_date: decoded.birth_date,
                    birth_region: decoded.birth_region,
                    four_axis_bp: [
                        four_axis.social_orientation_bp,
                        four_axis.information_orientation_bp,
                        four_axis.decision_orientation_bp,
                        four_axis.closure_orientation_bp,
                    ],
                    event_ref,
                });
                fold.character_id = decoded.character_id;
            }
            "PaperAccountOpened" => {
                let decoded = decode_canonical::<portfolio::v1::PaperAccountOpenedV1>(bytes)
                    .expect("canonical PaperAccountOpenedV1");
                fold.paper_account_id = decoded.paper_account_id;
            }
            "PaperCashInitialized" => {
                let decoded = decode_canonical::<portfolio::v1::PaperCashInitializedV1>(bytes)
                    .expect("canonical PaperCashInitializedV1");
                fold.initial_cash_fixed = decoded.initial_cash_fixed;
                fold.cash_fixed = decoded.initial_cash_fixed;
                fold.account_version += 1;
            }
            "FactManifestAccepted" => {
                let decoded = decode_canonical::<world::v1::FactManifestAcceptedV1>(bytes)
                    .expect("canonical FactManifestAcceptedV1");
                let mode_domain = slice
                    .sessions
                    .iter()
                    .find(|mirrored| mirrored.manifest_id == decoded.manifest_id)
                    .map_or(ManifestModeDomain::Current, |mirrored| mirrored.mode_domain);
                fold.sessions.push(FoldedSession {
                    session_index: fold.sessions.len() + 1,
                    manifest_id: decoded.manifest_id,
                    manifest_hash_hex: hex(&decoded.manifest_hash),
                    market_session_id: decoded.market_session_id,
                    mode_domain,
                    intent_security_id: String::new(),
                    intent_perceived_fact_revision_ids: Vec::new(),
                    market_date_taipei: decoded.market_date_taipei,
                    interaction_cutoff_unix_micros: decoded.interaction_cutoff_unix_micros,
                    evidence_cutoff_unix_micros: decoded.evidence_cutoff_unix_micros,
                    finality_accepted: false,
                    cognitive_episode_id: Vec::new(),
                    selected_fact_revision_ids: Vec::new(),
                    missed_fact_revision_ids: Vec::new(),
                    action: 0,
                    quantity_fixed: 0,
                    confidence_bp: 0,
                    utterance_index: None,
                    thesis_revision: String::new(),
                    outcome_attribution_kind: None,
                    relationship_dyad_id: None,
                    realized_pnl_delta_fixed: 0,
                    observable_text: None,
                    memory_ids: Vec::new(),
                    fill: None,
                    marks: Vec::new(),
                    position_changed: false,
                    chapter_id: None,
                    manifest_ref: event_ref,
                    attention_ref: None,
                    intent_ref: None,
                    adjustment_ref: None,
                    chapter_ref: None,
                    segments: Vec::new(),
                    signal_index: None,
                });
            }
            "FactBecameVisible" => {
                let decoded = decode_canonical::<world::v1::FactBecameVisibleV1>(bytes)
                    .expect("canonical FactBecameVisibleV1");
                let session = fold.current_session_mut();
                let market_date_taipei = session.market_date_taipei.clone();
                let session_index = session.session_index;
                fold.facts.push(FoldedFact {
                    fact_revision_id: decoded.fact_revision_id,
                    market_date_taipei,
                    available_at_unix_micros: decoded.available_at_unix_micros,
                    session_index,
                });
            }
            "MarketSessionFinalityAccepted" => {
                fold.current_session_mut().finality_accepted = true;
            }
            "AttentionCommitted" => {
                let decoded = decode_canonical::<character::v1::AttentionCommittedV1>(bytes)
                    .expect("canonical AttentionCommittedV1");
                let session = fold.current_session_mut();
                session.attention_ref = Some(event_ref);
                session.cognitive_episode_id = decoded.cognitive_episode_id;
                session.selected_fact_revision_ids = decoded.selected_fact_revision_ids;
                session.missed_fact_revision_ids = decoded.missed_high_salience_fact_revision_ids;
            }
            "AutonomousActionIntentCommitted" => {
                let decoded =
                    decode_canonical::<character::v1::AutonomousActionIntentCommittedV1>(bytes)
                        .expect("canonical AutonomousActionIntentCommittedV1");
                let session = fold.current_session_mut();
                session.intent_ref = Some(event_ref);
                session.action = decoded.action;
                session.quantity_fixed = decoded.quantity_or_target_weight_fixed;
                session.confidence_bp = decoded.confidence_bp;
                session.thesis_revision = decoded.thesis_revision;
                session.intent_security_id = decoded.security_id;
                session.intent_perceived_fact_revision_ids = decoded.perceived_fact_revision_ids;
            }
            "SemanticSpeechActCommitted" => {
                let decoded =
                    decode_canonical::<character::v1::SemanticSpeechActCommittedV1>(bytes)
                        .expect("canonical SemanticSpeechActCommittedV1");
                fold.current_session_mut().outcome_attribution_kind = decoded
                    .outcome_attribution
                    .map(|attribution| attribution.target_kind);
            }
            "PublicClaimMade" => {
                let decoded = decode_canonical::<character::v1::UtteranceArtifactV1>(bytes)
                    .expect("canonical UtteranceArtifactV1");
                let index = fold.utterances.len();
                let session_index = fold.sessions.last().map(|session| session.session_index);
                fold.utterances.push(FoldedUtterance {
                    artifact_id: decoded.utterance_artifact_id,
                    canonical_text_utf8: decoded.canonical_text_utf8,
                    canonical_text_sha256_hex: hex(&decoded.canonical_text_sha256),
                    surface_kind: decoded.surface_kind,
                    replies_to: decoded.replies_to_utterance_artifact_id,
                    event_ref,
                    session_index,
                });
                fold.current_session_mut().utterance_index = Some(index);
            }
            "RelationshipSignalObserved" => {
                let decoded =
                    decode_canonical::<character::v1::RelationshipSignalObservedV1>(bytes)
                        .expect("canonical RelationshipSignalObservedV1");
                let signal_index = fold.signals.len();
                let session = fold.current_session_mut();
                session.relationship_dyad_id = Some(decoded.relationship_dyad_id.clone());
                session.signal_index = Some(signal_index);
                let session_index = session.session_index;
                fold.signals.push(FoldedSignal {
                    signal_id: decoded.relationship_signal_id,
                    dyad_id: decoded.relationship_dyad_id,
                    counterpart_ref: decoded.counterpart_ref,
                    signal_kind: decoded.signal_kind,
                    utterance_artifact_id: decoded.utterance_artifact_id,
                    canonical_text_sha256_hex: hex(&decoded.canonical_text_sha256),
                    observed_at_unix_micros: decoded.observed_at_unix_micros,
                    session_index,
                    event_ref,
                });
            }
            "MemoryFormed" => {
                let decoded = decode_canonical::<character::v1::MemoryFormedV1>(bytes)
                    .expect("canonical MemoryFormedV1");
                fold.memory_count += 1;
                // The three bootstrap memories are sealed before the first
                // manifest; they belong to no chapter.
                let session_index = if fold.sessions.is_empty() {
                    None
                } else {
                    let session = fold.current_session_mut();
                    session.memory_ids.push(decoded.memory_id.clone());
                    Some(session.session_index)
                };
                fold.memories.push(FoldedMemory {
                    memory_id: decoded.memory_id,
                    kind: decoded.kind,
                    source_event_ids: decoded.source_event_ids,
                    formed_at_unix_micros: decoded.formed_at_unix_micros,
                    salience_bp: decoded.salience_bp,
                    confidence_bp: decoded.confidence_bp,
                    valence_bp: decoded.valence_bp,
                    visibility: decoded.visibility,
                    session_index,
                    event_ref,
                });
            }
            "PaperOrderSubmitted" => {
                let decoded = decode_canonical::<portfolio::v1::PaperOrderSubmittedV1>(bytes)
                    .expect("canonical PaperOrderSubmittedV1");
                fold.orders.push(FoldedOrder {
                    order_id: decoded.paper_order_id,
                    stream_version: 0,
                });
            }
            "PaperOrderFilled" => {
                let decoded = decode_canonical::<portfolio::v1::PaperOrderFilledV1>(bytes)
                    .expect("canonical PaperOrderFilledV1");
                let price_source = decoded
                    .price_source
                    .expect("a canonical fill always names its sealed price source");
                let manifest_hash = fold.manifest_hash_of(&price_source.fact_manifest_id);
                let price_session_index = fold.session_index_of(&price_source.fact_manifest_id);
                if let Some(order) = fold
                    .orders
                    .iter_mut()
                    .find(|order| order.order_id == decoded.paper_order_id)
                {
                    order.stream_version += 1;
                }
                fold.current_session_mut().fill = Some(FoldedFill {
                    sealed_price_fixed: price_source.sealed_price_fixed,
                    sealed_price_manifest_hash_hex: manifest_hash,
                    filled_at_unix_micros: price_source.price_observed_at_unix_micros,
                    filled_quantity_fixed: decoded.filled_quantity_fixed,
                    fee_fixed: decoded.fee_fixed,
                    tax_fixed: decoded.tax_fixed,
                    event_ref,
                    price_session_index,
                });
            }
            "PaperAccountJournalPosted" => {
                let decoded = decode_canonical::<portfolio::v1::PaperAccountJournalPostedV1>(bytes)
                    .expect("canonical PaperAccountJournalPostedV1");
                fold.cash_fixed = decoded.cash_after_fixed;
                fold.account_version += 1;
            }
            "PaperPositionOpened" => {
                let decoded = decode_canonical::<portfolio::v1::PaperPositionOpenedV1>(bytes)
                    .expect("canonical PaperPositionOpenedV1");
                let lot = decoded
                    .initial_lot
                    .expect("a canonical position always opens with a lot");
                let session = fold.current_session_mut();
                session.position_changed = true;
                let sealed_price_manifest_hash_hex = session
                    .fill
                    .as_ref()
                    .expect("an opening lot follows its own fill")
                    .sealed_price_manifest_hash_hex
                    .clone();
                fold.position = Some(FoldedPosition {
                    position_id: decoded.paper_position_id,
                    instrument_label: decoded.security_id,
                    lots: vec![FoldedLot {
                        lot_id: lot.lot_id,
                        quantity_fixed: lot.quantity_fixed,
                        cost_basis_fixed: lot.cost_basis_fixed,
                        sealed_price_manifest_hash_hex,
                    }],
                    realized_pnl_fixed: 0,
                    unrealized_pnl_fixed: 0,
                    stream_version: 0,
                    opened_at_unix_micros: lot.opened_at_unix_micros,
                    opened_ref: event_ref,
                });
            }
            "PaperPositionAdjusted" => {
                let decoded = decode_canonical::<portfolio::v1::PaperPositionAdjustedV1>(bytes)
                    .expect("canonical PaperPositionAdjustedV1");
                // `PaperPositionAdjustedV1` carries the realized delta but
                // not the closed quantity; the quantity comes from this
                // session's own sell fill, which is where the ledger got it.
                let session = fold.current_session_mut();
                session.position_changed = true;
                session.adjustment_ref = Some(event_ref);
                let closed_quantity_fixed = session.quantity_fixed;
                session.realized_pnl_delta_fixed += decoded.realized_pnl_delta_fixed;
                let position = fold
                    .position
                    .as_mut()
                    .expect("an adjustment always follows an opened position");
                reduce_lots_fifo(&mut position.lots, closed_quantity_fixed);
                position.realized_pnl_fixed += decoded.realized_pnl_delta_fixed;
                position.unrealized_pnl_fixed = decoded.unrealized_pnl_after_fixed;
                position.stream_version += 1;
            }
            "PaperOutcomeRecognized" => {
                let decoded = decode_canonical::<portfolio::v1::PaperOutcomeRecognizedV1>(bytes)
                    .expect("canonical PaperOutcomeRecognizedV1");
                fold.recognized_account_version = be_u64(&decoded.paper_account_version_ref);
                fold.recognized_order_version = be_u64(&decoded.paper_order_version_ref);
            }
            "PaperMarkApplied" => {
                let decoded = decode_canonical::<portfolio::v1::PaperMarkAppliedV1>(bytes)
                    .expect("canonical PaperMarkAppliedV1");
                let price_source = decoded
                    .mark_price_source
                    .expect("a canonical mark always names its sealed price source");
                let cost_basis_minor_units = fold
                    .position()
                    .lots
                    .iter()
                    .map(lot_cost_basis_minor)
                    .sum::<i64>();
                let price_manifest_hash_hex = fold.manifest_hash_of(&price_source.fact_manifest_id);
                let price_session_index = fold.session_index_of(&price_source.fact_manifest_id);
                fold.current_session_mut().marks.push(FoldedMark {
                    unrealized_pnl_fixed: decoded.unrealized_pnl_fixed,
                    price_observed_at_unix_micros: price_source.price_observed_at_unix_micros,
                    cost_basis_minor_units,
                    price_manifest_hash_hex,
                    event_ref,
                    price_session_index,
                });
                let position = fold
                    .position
                    .as_mut()
                    .expect("a mark always follows an opened position");
                position.unrealized_pnl_fixed = decoded.unrealized_pnl_fixed;
                position.stream_version += 1;
            }
            "StoryChapterComposed" => {
                let decoded = decode_canonical::<story::v1::StoryChapterComposedV1>(bytes)
                    .expect("canonical StoryChapterComposedV1");
                let observable_text = decoded.segments.iter().find_map(|segment| {
                    match (&segment.segment_id[..], &segment.variant) {
                        (
                            "segment-observable",
                            Some(story::v1::narrative_segment_v1::Variant::NarratorText(text)),
                        ) => Some(text.text.clone()),
                        _ => None,
                    }
                });
                let segments = decoded.segments.iter().map(fold_segment).collect();
                let session = fold.current_session_mut();
                session.chapter_id = Some(decoded.chapter_id);
                session.chapter_ref = Some(event_ref);
                session.observable_text = observable_text;
                session.segments = segments;
            }
            "StoryChapterPublished" => {
                let decoded = decode_canonical::<story::v1::StoryChapterPublishedV1>(bytes)
                    .expect("canonical StoryChapterPublishedV1");
                fold.visibility_epoch = decoded.visibility_epoch;
            }
            _ => {}
        }
    }

    fold
}

/// Restates one sealed narrative segment. A segment that carries a truth
/// class this synthetic slice may not claim (or none at all) panics: it is
/// not the log this slice emits, and rendering it anyway would put an
/// unlabelled or falsely-labelled sentence in front of a viewer.
fn fold_segment(segment: &story::v1::NarrativeSegmentV1) -> FoldedSegment {
    let (body, source_refs) = match &segment.variant {
        Some(story::v1::narrative_segment_v1::Variant::NarratorText(text)) => (
            FoldedSegmentBody::Narrator {
                truth_class: sealed_truth_class_label(text.truth_class),
                text: text.text.clone(),
            },
            text.source_refs.clone(),
        ),
        Some(story::v1::narrative_segment_v1::Variant::CharacterClaim(claim)) => (
            FoldedSegmentBody::Claim {
                artifact_id: claim.utterance_artifact_id.clone(),
                canonical_text_sha256_hex: hex(&claim.canonical_text_sha256),
            },
            claim.source_refs.clone(),
        ),
        None => panic!("sealed segment {} has no variant", segment.segment_id),
    };
    FoldedSegment {
        segment_id: segment.segment_id.clone(),
        body,
        source_refs,
    }
}

/// `common.v2.TruthClass` -> the public `TruthClass` label, restricted to
/// the three classes a repo-local synthetic fixture may carry.
fn sealed_truth_class_label(truth_class: i32) -> &'static str {
    use panshi_protocol::common::v2::TruthClass;
    if truth_class == TruthClass::FictionalSetting as i32 {
        "fictional_setting"
    } else if truth_class == TruthClass::SymbolicInterpretation as i32 {
        "symbolic_interpretation"
    } else if truth_class == TruthClass::SimulatedNarrative as i32 {
        "simulated_narrative"
    } else {
        panic!("a synthetic slice may not seal truth class {truth_class}")
    }
}

/// FIFO reduction, mirroring `panshi_paper_ledger::position::PaperPosition::reduce`.
fn reduce_lots_fifo(lots: &mut Vec<FoldedLot>, mut quantity_to_close_fixed: i64) {
    for lot in lots.iter_mut() {
        if quantity_to_close_fixed == 0 {
            break;
        }
        let closing = lot.quantity_fixed.min(quantity_to_close_fixed);
        lot.quantity_fixed -= closing;
        quantity_to_close_fixed -= closing;
    }
    lots.retain(|lot| lot.quantity_fixed > 0);
}

// -- documents ------------------------------------------------------------

/// Read-side failures a test can inject into the projection, to prove what a
/// viewer still sees when a chapter's rich narrative is unavailable or a
/// chapter is held back. Chapters are addressed by their 1-based market
/// session index (the same index `slice::sessions::SESSIONS` uses).
///
/// Nothing here touches the canonical log: the events are the same bytes,
/// only the read model treats the named chapters as degraded. The default
/// value injects nothing and is exactly what `public_api_documents` renders.
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct ProjectionFaults {
    /// Chapters whose composed narrative is treated as failed: the entry
    /// renders `narrativeState: evidence_card_only`, no narrative segments,
    /// and keeps its typed evidence card, verbatim artifacts and summaries
    /// that are derived from canonical facts.
    pub narrative_failed_chapters: BTreeSet<usize>,
    /// Chapters withheld from the public journal: they appear only as a
    /// `HeldLifeJournalEntry` carrying an id, a date and a reason label.
    pub held_chapters: BTreeSet<usize>,
}

/// The five deep-archive sections that have their own endpoint besides
/// `paper`, in `ArchiveSectionKey` order.
const ARCHIVE_DETAIL_SECTION_KEYS: [&str; 5] = ["relations", "chart", "traits", "memories", "life"];

/// Folds the canonical event log into the ten `public-v2.yaml` response
/// objects plus a route index, as `(relative path, JSON text)` pairs.
///
/// Calling it twice on the same slice produces byte-identical output: the
/// fold is pure, the serializer emits map keys in a stable order, and no
/// clock, randomness, environment or network is consulted.
///
/// # Panics
///
/// Panics if the slice does not have the one-character shape this projection
/// is written against -- no sealed character, no paper position, or a money
/// value that is not a whole currency minor unit. Rendering a rounded or
/// invented public figure instead is exactly what the fail-closed rule
/// exists to prevent.
///
/// Projected under `ProjectionKillSwitch::release_gate_default()`: the
/// current-market projection is closed, as it is until every release gate
/// passes. The slice's market content is the synthetic historical fixture,
/// so nothing in it is withheld.
#[must_use]
pub fn public_api_documents(slice: &CharacterSlice) -> Vec<(String, String)> {
    public_api_documents_with(slice, &ProjectionFaults::default())
}

/// `public_api_documents`, with read-side failures injected. See
/// `ProjectionFaults`.
///
/// # Panics
///
/// As `public_api_documents`.
#[must_use]
pub fn public_api_documents_with(
    slice: &CharacterSlice,
    faults: &ProjectionFaults,
) -> Vec<(String, String)> {
    public_api_documents_gated(slice, faults, &ProjectionKillSwitch::release_gate_default())
}

/// `public_api_documents_with`, projected under an explicit kill-switch set
/// (`docs/v5/market-safety.md` "Kill switch"). Every object a closed switch
/// covers is withheld whole: a chapter moves to `heldEntries` with a fixed
/// `heldReasonLabel`; an archive index section's summary is replaced by a
/// `HeldArchiveSectionIndexEntry`; every other object is simply absent and
/// its document carries the fixed `marketClosureReasonLabel`. Nothing is
/// rewritten, and the character-world documents (relations, chart, traits,
/// memories, life) are never touched.
///
/// # Panics
///
/// As `public_api_documents`.
#[must_use]
pub fn public_api_documents_gated(
    slice: &CharacterSlice,
    faults: &ProjectionFaults,
    switches: &ProjectionKillSwitch,
) -> Vec<(String, String)> {
    let fold = fold(slice);
    let gate = Gate::new(switches, slice, &fold);
    let character_id = uuid(&fold.character_id);

    let mut documents = vec![
        (
            "/api/v2/world".to_owned(),
            "v2/world.json".to_owned(),
            world_snapshot(slice, &fold, &gate),
        ),
        (
            format!("/api/v2/characters/{character_id}/close-up"),
            format!("v2/characters/{character_id}/close-up.json"),
            close_up(slice, &fold, &gate),
        ),
        (
            format!("/api/v2/characters/{character_id}/life-journal"),
            format!("v2/characters/{character_id}/life-journal.json"),
            life_journal(slice, &fold, faults, &gate),
        ),
        (
            format!("/api/v2/characters/{character_id}/archive"),
            format!("v2/characters/{character_id}/archive.json"),
            archive_index(slice, &fold, &gate),
        ),
        (
            format!("/api/v2/characters/{character_id}/archive/paper"),
            format!("v2/characters/{character_id}/archive/paper.json"),
            paper_archive(slice, &fold, &gate),
        ),
    ];
    for key in ARCHIVE_DETAIL_SECTION_KEYS {
        documents.push((
            format!("/api/v2/characters/{character_id}/archive/{key}"),
            format!("v2/characters/{character_id}/archive/{key}.json"),
            classify_section_nested_items(
                key,
                archive_sections::section_document(key, slice, &fold, &gate),
            ),
        ));
    }

    let mut routes = Map::new();
    for (route, path, _) in &documents {
        routes.insert(route.clone(), json!(path));
    }
    let index = json!({ "characterId": character_id, "routes": Value::Object(routes) });

    let mut out: Vec<(String, String)> = documents
        .into_iter()
        .map(|(_, path, value)| (path, pretty(&value)))
        .collect();
    out.push(("index.json".to_owned(), pretty(&index)));
    out
}

/// The envelope every projection response in `public-v2.yaml` carries
/// (`docs/v5/system-design.md` §11.3).
fn envelope(
    slice: &CharacterSlice,
    fold: &Fold,
    gate: &Gate,
    truth_classes: &[&str],
) -> Map<String, Value> {
    // Under a kill-switch horizon the response reports the last log
    // position before it: the whole log's length would grow with every
    // withheld event, and two days' difference would tell a trading day
    // (more events) from a quiet one.
    let log_length = u64::try_from(slice.events.len()).expect("slice log length fits u64");
    let position = gate.reported_position(log_length);
    let mut envelope = Map::new();
    envelope.insert("projectionVersion".to_owned(), json!(position));
    envelope.insert("sourceGlobalPosition".to_owned(), json!(position));
    // The slice's world clock, not a wall clock: today's session is open,
    // and this projection is computed at the same in-session moment (10:30
    // Taipei) every time it runs.
    envelope.insert(
        "serverNow".to_owned(),
        json!(taipei_datetime(
            fold.today().interaction_cutoff_unix_micros + 5_400 * MICROS_PER_SECOND
        )),
    );
    envelope.insert("dataState".to_owned(), json!("READY"));
    // The canonical visibility epoch, untouched. The kill-switch set is a
    // second, independent coordinate recorded in `sourceRevisionSet`; a
    // cache keys on the pair (see `public-v2.yaml` 3.0.0).
    envelope.insert("visibilityEpoch".to_owned(), json!(fold.visibility_epoch));
    envelope.insert("truthClasses".to_owned(), json!(truth_classes));
    envelope.insert("sourceRevisionSet".to_owned(), source_revision_set(fold, gate));
    envelope
}

/// The `refKind` under which every response records the kill-switch set it
/// was projected under; the `refId` says where the set came from
/// (`KillSwitchOrigin::ref_id`) and the `revision` which revision it was.
const KILL_SWITCH_REF_KIND: &str = "projection_kill_switch";

/// Every revision the visible content of this projection was computed from:
/// the mirrored manifests of the sessions still shown, the paper aggregates'
/// exact stream versions when today's paper view is shown, and the
/// kill-switch set the projection ran under. A withheld session's manifest
/// and the paper versions (which count the paper actions) are not listed
/// once their content is withheld: a version number is itself a count of
/// what happened.
fn source_revision_set(fold: &Fold, gate: &Gate) -> Value {
    let mut refs: Vec<Value> = fold
        .sessions
        .iter()
        .filter(|session| gate.session_visible(session.session_index))
        .map(|session| {
            json!({
                "refId": session.manifest_id,
                "refKind": "world_fact_manifest",
                "revision": i64::try_from(session.session_index).expect("session index fits i64"),
            })
        })
        .collect();
    if gate.today_visible() {
        refs.push(json!({
            "refId": uuid(&fold.paper_account_id),
            "refKind": "paper_account",
            "revision": fold.account_version,
        }));
        refs.push(json!({
            "refId": uuid(&fold.position().position_id),
            "refKind": "paper_position",
            "revision": fold.position().stream_version,
        }));
    }
    refs.push(json!({
        "refId": gate.switches().origin.ref_id(),
        "refKind": KILL_SWITCH_REF_KIND,
        "revision": gate.switches().revision,
    }));
    Value::Array(refs)
}

/// Marks a document whose objects a kill switch withheld.
fn mark_market_closure(document: &mut Map<String, Value>, withheld: bool) {
    if withheld {
        document.insert(
            "marketClosureReasonLabel".to_owned(),
            json!(MARKET_CLOSURE_REASON_LABEL),
        );
    }
}

fn world_snapshot(slice: &CharacterSlice, fold: &Fold, gate: &Gate) -> Value {
    let today = fold.today();
    let settled = fold.last_settled_session();
    let mut snapshot = envelope(slice, fold, gate, &["fictional_setting", "simulated_narrative"]);

    snapshot.insert(
        "marketClock".to_owned(),
        json!({
            "marketDate": today.market_date_taipei,
            // Today has accepted no finality, so the world is mid-session
            // and every visible paper figure is dated to the last accepted
            // close instead.
            "sessionPhase": if today.finality_accepted { "after_session" } else { "in_session" },
            "asOfTradingDate": settled.market_date_taipei,
            "nextBoundaryAt": taipei_datetime(today.evidence_cutoff_unix_micros),
        }),
    );
    snapshot.insert(
        "worldTickId".to_owned(),
        json!(i64::try_from(fold.sessions.len()).expect("session count fits i64")),
    );
    // Presentation identities: the slice has no scene aggregate of its own,
    // so the opening hall and its one story hook are derived from stable
    // tags rather than borrowed from an unrelated canonical id.
    let scene_id = uuid(&derive_id("v5-slice/scene/opening-hall"));
    snapshot.insert(
        "scene".to_owned(),
        json!({
            "sceneId": scene_id,
            // The world never nominates a protagonist
            // (`docs/v5/experience-spec.md` §5.2), so nothing here is given
            // audiovisual priority.
            "activePriorityEventRefs": Value::Array(Vec::new()),
        }),
    );
    // Exactly one canonical resident. Decorative silhouettes elsewhere in
    // the scene are a rendering concern and never enter the contract. The
    // resident stays in the world under any kill switch; what he is
    // attending to today (the two meetings and his own records) is a
    // statement folded from his whole history, so it is withdrawn with the
    // today layer -- `null`, with the page's closure label -- and so is the
    // ref to today's cognitive episode.
    let today_shown = gate.today_visible();
    snapshot.insert(
        "characterPositions".to_owned(),
        json!([{
            "characterId": uuid(&fold.character_id),
            "worldX": 12,
            "worldY": 7,
            "poseState": "examining",
            "poseStateTruthClass": SIMULATED_NARRATIVE,
            "focusHint": if today_shown { json!("兩次組會那兩天自己留下的紀錄") } else { Value::Null },
            // What he is attending to is his attention: simulated.
            "focusHintTruthClass": if today_shown { json!(SIMULATED_NARRATIVE) } else { Value::Null },
            "zOrder": 0,
            "sceneLayer": "foreground",
            "detailTier": "high_detail",
            "sourceEventRefs": if today_shown {
                json!([uuid(&today.cognitive_episode_id)])
            } else {
                json!([])
            },
        }]),
    );
    // At most five, and carrying no rank, score, ticker or performance
    // figure (`docs/v5/market-safety.md` 今日五幕). Each one is an act a
    // kill switch can close by its `hookId`; a closed act is absent, and the
    // 0-act page is a legal state.
    let hooks = [json!({
        "hookId": uuid(&derive_id("v5-slice/story-hook/opening-hall-1")),
        "characterId": uuid(&fold.character_id),
        "sceneRef": scene_id,
        "label": "開盤廳裡有人在對照自己兩次組會的紀錄",
        "labelTruthClass": SIMULATED_NARRATIVE,
    })];
    let (open, closed): (Vec<Value>, Vec<Value>) = hooks.into_iter().partition(|hook| {
        gate.story_act_visible(hook["hookId"].as_str().expect("a hook has an id"))
    });
    snapshot.insert("storyHooks".to_owned(), Value::Array(open));
    mark_market_closure(&mut snapshot, !closed.is_empty() || !today_shown);
    Value::Object(snapshot)
}

fn close_up(slice: &CharacterSlice, fold: &Fold, gate: &Gate) -> Value {
    let position = fold.position();
    let mark = fold.current_mark();
    let mut close_up = envelope(
        slice,
        fold,
        gate,
        &[
            "fictional_setting",
            "symbolic_interpretation",
            "simulated_narrative",
        ],
    );

    // Who he is and where he stands: authored chassis and a neutral pose.
    // These stay under every kill switch.
    close_up.insert("characterId".to_owned(), json!(uuid(&fold.character_id)));
    close_up.insert("displayName".to_owned(), json!(seed::DISPLAY_NAME));
    close_up.insert("displayNameTruthClass".to_owned(), json!(FICTIONAL_SETTING));
    close_up.insert("ageYears".to_owned(), json!(seed::AGE_YEARS));
    close_up.insert("ageYearsTruthClass".to_owned(), json!(FICTIONAL_SETTING));
    close_up.insert("occupationLabel".to_owned(), json!(OCCUPATION_LABEL));
    close_up.insert("occupationLabelTruthClass".to_owned(), json!(FICTIONAL_SETTING));
    close_up.insert(
        "sceneRef".to_owned(),
        json!(uuid(&derive_id("v5-slice/scene/opening-hall"))),
    );
    close_up.insert("poseState".to_owned(), json!("examining"));
    close_up.insert("poseStateTruthClass".to_owned(), json!(SIMULATED_NARRATIVE));

    // Everything else on this page is a statement about today folded from
    // his whole history: what he is doing about the two meetings, the
    // tension between them ("still not retracted" is a claim about every
    // later session), the latest sentence of each kind, and the position as
    // it stands now. Under any closed session all of it is withdrawn whole,
    // and the page says so; nothing older is promoted in its place.
    if !gate.today_visible() {
        close_up.insert("unresolvedCommitments".to_owned(), Value::Array(Vec::new()));
        mark_market_closure(&mut close_up, true);
        return Value::Object(close_up);
    }
    close_up.insert(
        "currentVerbPhrase".to_owned(),
        json!("正在對照兩次組會那兩天自己留下的紀錄"),
    );
    close_up.insert(
        "currentVerbPhraseTruthClass".to_owned(),
        json!(SIMULATED_NARRATIVE),
    );
    close_up.insert(
        "currentAttention".to_owned(),
        json!({
            "targetKind": "object",
            // Engineering fixture copy, 未經 copy-taste 審稿.
            "label": "兩次組會那兩天的持股紀錄",
            "truthClass": SIMULATED_NARRATIVE,
        }),
    );
    close_up.insert(
        "unresolvedTensionSummary".to_owned(),
        json!(tension_summary(fold)),
    );
    close_up.insert(
        "unresolvedTensionSummaryTruthClass".to_owned(),
        json!(SIMULATED_NARRATIVE),
    );
    // The sealed artifacts, verbatim: the latest public claim and the latest
    // self-acknowledgement, chosen by their sealed surface. Nothing is
    // paraphrased alongside them.
    if let Some(utterance) = fold
        .utterances
        .iter()
        .rev()
        .find(|utterance| !utterance.is_self_acknowledged())
        .filter(|utterance| gate.utterance_visible(utterance))
    {
        close_up.insert("publicClaim".to_owned(), utterance_value(utterance));
    }
    if let Some(utterance) = fold
        .utterances
        .iter()
        .rev()
        .find(|utterance| utterance.is_self_acknowledged())
        .filter(|utterance| gate.utterance_visible(utterance))
    {
        close_up.insert("selfAcknowledgement".to_owned(), utterance_value(utterance));
    }
    // One consequence fragment, not a holdings table
    // (`docs/v5/experience-spec.md` §7.1).
    close_up.insert(
        "recentConsequenceHighlight".to_owned(),
        json!({
            "kind": "paper_position",
            "positionArchiveRef": uuid(&position.position_id),
            "unrealizedPnlPercentFixed2": percent_fixed2(
                minor_units(mark.unrealized_pnl_fixed),
                mark.cost_basis_minor_units,
            ),
            "asOf": taipei_datetime(mark.price_observed_at_unix_micros),
            "truthClass": SIMULATED_NARRATIVE,
        }),
    );
    let latest_thesis = slice
        .thesis_chain
        .latest()
        .expect("the slice seals a thesis chain");
    close_up.insert(
        "unresolvedCommitments".to_owned(),
        json!([{
            "commitmentId": uuid(&derive_id(&format!("v5-slice/{}", latest_thesis.thesis_revision_id))),
            "rationaleSummary": format!(
                "改寫後的理由（{}）：長期治理價值。失效條件仍然是兩個交易日內沒有新證據，新增支持事實 0 筆。",
                latest_thesis.thesis_revision_id
            ),
            "sealedAt": taipei_datetime(latest_thesis.opened_at_unix_micros),
            "stillOpen": true,
            "truthClass": SIMULATED_NARRATIVE,
        }]),
    );
    Value::Object(close_up)
}

fn life_journal(
    slice: &CharacterSlice,
    fold: &Fold,
    faults: &ProjectionFaults,
    gate: &Gate,
) -> Value {
    let position = fold.position();
    let mut page = envelope(
        slice,
        fold,
        gate,
        &[
            "fictional_setting",
            "symbolic_interpretation",
            "simulated_narrative",
        ],
    );
    page.insert("characterId".to_owned(), json!(uuid(&fold.character_id)));
    page.insert("appliedAudienceScope".to_owned(), json!(PUBLIC_SCOPE));

    // Only a session whose finality has been accepted has a published
    // chapter. Today is in session, so today is not in the journal. A held
    // chapter is not in `entries` at all: it is listed in `heldEntries` with
    // an id, a date and a reason label, and nothing else -- so no client can
    // render its content by forgetting to check a flag.
    //
    // A chapter at or after the kill-switch horizon is held the same way,
    // with its own fixed reason label: its market-derived content is one
    // unit folded from every earlier session (holdings, P&L, held days, the
    // habit count, the open question), and nothing in it is rewritten. Its
    // sealed segments whose own provenance is not market-derived (the natal
    // motif's reading) stay readable on the held entry, verbatim, under
    // `nonMarketSegments`.
    let mut entries = Vec::new();
    let mut held = Vec::new();
    for session in fold.sessions.iter().filter(|session| session.finality_accepted) {
        if faults.held_chapters.contains(&session.session_index) {
            held.push(evidence::held_entry(session, evidence::HELD_REASON_LABEL));
        } else if !gate.session_visible(session.session_index) {
            let mut entry = evidence::held_entry(session, KILL_SWITCH_HELD_REASON_LABEL);
            let segments = evidence::non_market_segments(session, gate);
            if !segments.is_empty() {
                entry
                    .as_object_mut()
                    .expect("a held entry is an object")
                    .insert("nonMarketSegments".to_owned(), Value::Array(segments));
            }
            held.push(entry);
        } else {
            let narrative_failed = faults
                .narrative_failed_chapters
                .contains(&session.session_index);
            entries.push(journal_entry(slice, fold, session, position, narrative_failed));
        }
    }
    page.insert("entries".to_owned(), Value::Array(entries));
    page.insert("heldEntries".to_owned(), Value::Array(held));
    page.insert("nextCursor".to_owned(), Value::Null);
    Value::Object(page)
}

/// One day-chapter, carrying the nine segments of
/// `docs/v5/experience-spec.md` §8.1 (segments 2, 4 and 8 are conditional
/// and are simply absent when their condition is not met).
fn journal_entry(
    slice: &CharacterSlice,
    fold: &Fold,
    session: &FoldedSession,
    position: &FoldedPosition,
    narrative_failed: bool,
) -> Value {
    let index = session.session_index;
    let mut entry = Map::new();
    entry.insert("entryVisibility".to_owned(), json!("PUBLIC"));
    entry.insert(
        "entryId".to_owned(),
        json!(uuid(
            session
                .chapter_id
                .as_ref()
                .expect("a settled session publishes a chapter")
        )),
    );
    entry.insert("chapterDate".to_owned(), json!(session.market_date_taipei));

    // The composed narrative, or its typed absence. When the chapter's rich
    // narrative is unavailable the canonical world does not wait for it:
    // the entry says so, carries no segments, and the evidence card below
    // still carries the whole consequence
    // (`docs/v5/system-design.md` "Story generation failure").
    let composed = !narrative_failed && session.observable_text.is_some();
    entry.insert(
        "narrativeState".to_owned(),
        json!(if composed { "composed" } else { "evidence_card_only" }),
    );
    entry.insert(
        "narrativeSegments".to_owned(),
        if composed {
            evidence::narrative_segments(fold, session)
        } else {
            Value::Array(Vec::new())
        },
    );
    entry.insert(
        "evidenceCard".to_owned(),
        evidence::evidence_card(fold, session, position),
    );
    let (mut relationship_consequence, relationship_null_reason) =
        evidence::relationship_consequence(fold, session);
    if !relationship_consequence.is_null() {
        classify_signal_view(&mut relationship_consequence);
    }
    entry.insert("relationshipConsequence".to_owned(), relationship_consequence);
    entry.insert(
        "relationshipConsequenceNullReason".to_owned(),
        relationship_null_reason,
    );

    // 1. 今天他怎麼了 -- the observable segment this session's own chapter
    // sealed, restated verbatim; without a composed narrative, a fixed
    // system label that makes no claim about him.
    entry.insert(
        "sceneSummary".to_owned(),
        json!(if composed {
            session
                .observable_text
                .as_deref()
                .expect("a composed chapter seals an observable segment")
        } else {
            evidence::NARRATIVE_UNAVAILABLE_SCENE_LABEL
        }),
    );
    // The class the sealed observable segment itself carries; the fixed
    // fallback label stands in for the story projection that did not arrive.
    entry.insert(
        "sceneSummaryTruthClass".to_owned(),
        json!(if composed {
            observable_segment_truth_class(session)
        } else {
            SIMULATED_NARRATIVE
        }),
    );

    // 2. 他當時怎麼說 -- only where a sealed PUBLIC claim exists. A
    // self-acknowledgement belongs in segment 7, not here.
    let session_utterance = session
        .utterance_index
        .and_then(|utterance_index| fold.utterances.get(utterance_index));
    if let Some(utterance) = session_utterance
        && !utterance.is_self_acknowledged()
    {
        entry.insert("contemporaneousClaim".to_owned(), utterance_value(utterance));
    }

    // 3. 他其實知道什麼
    entry.insert(
        "knownAtTheTimeSummary".to_owned(),
        json!(known_summary(fold, session)),
    );
    // What he took in is his attention, even where the facts it names are
    // fixture facts.
    entry.insert(
        "knownAtTheTimeSummaryTruthClass".to_owned(),
        json!(SIMULATED_NARRATIVE),
    );

    // 4. 他漏掉了什麼 -- only ever on a session whose finality has been
    // accepted; before that, what he missed is not yet a public fact.
    if session.finality_accepted {
        entry.insert(
            "missedFactsSummary".to_owned(),
            json!(missed_summary(fold, session)),
        );
        entry.insert(
            "missedFactsSummaryTruthClass".to_owned(),
            json!(SIMULATED_NARRATIVE),
        );
    }

    // 5. 他做了什麼
    entry.insert(
        "actionSummary".to_owned(),
        json!(action_summary(slice, fold, session, position)),
    );
    entry.insert("actionSummaryTruthClass".to_owned(), json!(SIMULATED_NARRATIVE));

    // 6. 這個決定留下什麼
    entry.insert("consequence".to_owned(), journal_consequence(session, position));

    // 7. 現在怎麼說 -- verbatim only where a SELF_ACKNOWLEDGED artifact
    // exists; otherwise the documented unquoted fallback, and while the
    // motive is still unacknowledged that fallback is 暫時不知道
    // (`docs/v5/experience-spec.md` §8.2), never a third-person diagnosis.
    entry.insert(
        "currentSelfNarration".to_owned(),
        match session_utterance {
            Some(utterance) if utterance.is_self_acknowledged() => json!({
                "kind": "utterance",
                "utteranceArtifactId": uuid(&utterance.artifact_id),
                "canonicalTextSha256": utterance.canonical_text_sha256_hex,
                "canonicalTextUtf8": utterance.canonical_text_utf8,
                "truthClass": SIMULATED_NARRATIVE,
            }),
            _ => json!({
                "kind": "summary",
                // Engineering fixture copy, 未經 copy-taste 審稿.
                "summaryText": "暫時不知道",
                "truthClass": SIMULATED_NARRATIVE,
            }),
        },
    );

    // 8. 老毛病又回來了 -- only on a session where the pattern was observed
    // AGAIN, and only once it had already been observed at least twice
    // before this chapter was written. A chapter may not count its own
    // session's observation as prior history, and a day on which he finally
    // read the counter-evidence does not say the habit came back.
    let observed_here = slice.bias_observations.iter().any(|observation| {
        observation.kind == BiasKind::ConfirmationBias && observation.session_index == index
    });
    if observed_here
        && is_recurring_at(&slice.bias_observations, BiasKind::ConfirmationBias, index)
    {
        entry.insert(
            "recurringPatternRef".to_owned(),
            json!(uuid(&derive_id(
                "v5-slice/recurring-pattern/confirmation-bias"
            ))),
        );
        entry.insert(
            "recurringPatternTruthClass".to_owned(),
            json!(SIMULATED_NARRATIVE),
        );
    }

    // 9. 還沒完
    entry.insert(
        "openQuestionSummary".to_owned(),
        json!(open_question_summary(slice, fold, session, position)),
    );
    entry.insert(
        "openQuestionSummaryTruthClass".to_owned(),
        json!(SIMULATED_NARRATIVE),
    );

    entry.insert(
        "archiveRefs".to_owned(),
        json!({
            "paperPositionRefs": if session.marks.is_empty() {
                Vec::new()
            } else {
                vec![Value::String(uuid(&position.position_id))]
            },
            // Only a session that actually appended to a dyad stream points
            // at one. Fail closed rather than mint a plausible id.
            "relationshipDyadRefs": session
                .relationship_dyad_id
                .iter()
                .map(|id| Value::String(uuid(id)))
                .collect::<Vec<Value>>(),
            // A `canonical_restricted` memory is not referenced, even by id.
            "memoryRefs": evidence::session_memories(fold, session)
                .into_iter()
                .map(|memory| Value::String(uuid(&memory.memory_id)))
                .collect::<Vec<Value>>(),
        }),
    );
    Value::Object(entry)
}

/// 這個決定留下什麼. A paper figure appears only where the session actually
/// marked a position; a session with no position says what it does have
/// instead of showing a forced-empty performance number.
fn journal_consequence(session: &FoldedSession, position: &FoldedPosition) -> Value {
    let Some(mark) = session.last_mark() else {
        return json!({
            "nonPaperConsequenceSummary":
                "他沒有部位，所以這一天沒有損益。留下的是一段他自己記下來、當時沒有讀的早盤。",
            "nonPaperConsequenceSummaryTruthClass": SIMULATED_NARRATIVE,
        });
    };
    // A settled chapter's paper figure is dated by the close it was computed
    // against, which for every accepted session is that session's own close.
    json!({
        "paperConsequence": {
            "positionArchiveRef": uuid(&position.position_id),
            "heldDays": held_days(
                position.opened_at_unix_micros,
                session.evidence_cutoff_unix_micros,
            ),
            "unrealizedPnlMinorUnits": minor_units(mark.unrealized_pnl_fixed),
            "unrealizedPnlPercentFixed2": percent_fixed2(
                minor_units(mark.unrealized_pnl_fixed),
                mark.cost_basis_minor_units,
            ),
            "asOf": taipei_datetime(mark.price_observed_at_unix_micros),
            "truthClass": SIMULATED_NARRATIVE,
        },
    })
}

/// The truth class the chapter's sealed observable segment carries, as
/// sealed. A composed chapter without one is not the log this slice emits.
fn observable_segment_truth_class(session: &FoldedSession) -> &'static str {
    session
        .segments
        .iter()
        .find_map(|segment| match (&segment.segment_id[..], &segment.body) {
            ("segment-observable", FoldedSegmentBody::Narrator { truth_class, .. }) => {
                Some(*truth_class)
            }
            _ => None,
        })
        .expect("a composed chapter seals a classified observable segment")
}

/// The archive index sections whose one-line summary is authored chassis
/// rather than folded from his sessions (the natal motif and its sealed
/// expiry; the four-axis and blood-type chassis). Every other summary
/// counts or restates what his sessions left, so it is withdrawn with the
/// today layer.
const CHASSIS_SECTION_KEYS: [&str; 2] = ["chart", "traits"];

fn archive_index(slice: &CharacterSlice, fold: &Fold, gate: &Gate) -> Value {
    let character_id = uuid(&fold.character_id);
    let position = fold.position();
    let as_of = taipei_datetime(fold.current_mark().price_observed_at_unix_micros);
    let today_shown = gate.today_visible();
    let epoch = fold.visibility_epoch;
    let mut index = envelope(
        slice,
        fold,
        gate,
        &[
            "fictional_setting",
            "symbolic_interpretation",
            "simulated_narrative",
        ],
    );
    index.insert("characterId".to_owned(), json!(character_id));
    index.insert(
        "archiveSchemaRevision".to_owned(),
        json!(ARCHIVE_SCHEMA_REVISION),
    );
    // The long-term tension ("N sessions in a row") and 最近留下的三件事 (a
    // paper figure, a change of his stated reason, what he said at two
    // meetings) are all folded from his whole history: shown only when no
    // session is closed, withdrawn whole otherwise.
    let mut highlights = Vec::new();
    if today_shown {
        index.insert(
            "longTermTensionSummary".to_owned(),
            json!(format!(
                "他說自己靠證據做事，卻連續 {} 個交易時段沒有打開同一份反面資料。",
                recurrence_count(&slice.bias_observations, BiasKind::ConfirmationBias)
            )),
        );
        index.insert(
            "longTermTensionSummaryTruthClass".to_owned(),
            json!(SIMULATED_NARRATIVE),
        );
        highlights.push(format!(
            "模擬紀錄：1 個部位仍在，原始失效條件已發生，已實現虧損 {} 元。",
            format_whole_currency(minor_units(position.realized_pnl_fixed).abs()),
        ));
        highlights.push(format!(
            "說法：引用的理由換過 {} 次，新增支持事實 0 筆。",
            slice.thesis_chain.len().saturating_sub(1)
        ));
        highlights.push(relationship_highlight(fold));
    }
    index.insert(
        "recentHighlightTruthClasses".to_owned(),
        json!(vec![SIMULATED_NARRATIVE; highlights.len()]),
    );
    index.insert("recentHighlights".to_owned(), json!(highlights));

    let sections: Vec<Value> = ARCHIVE_SECTION_KEYS
        .iter()
        .map(|key| {
            // Every section has its own endpoint in this slice, so every
            // entrance links to a page that exists -- also when its summary
            // is withheld.
            let section_path = format!("/api/v2/characters/{character_id}/archive/{key}");
            if !today_shown && !CHASSIS_SECTION_KEYS.contains(key) {
                return json!({
                    "sectionKey": key,
                    "viewerAudienceScope": ARCHIVE_SCOPE,
                    "entryVisibility": "HELD",
                    "summaryHeldReasonLabel": SUMMARY_HELD_REASON_LABEL,
                    "asOf": as_of,
                    "visibilityEpoch": epoch,
                    "sectionPath": section_path,
                });
            }
            json!({
                "sectionKey": key,
                "viewerAudienceScope": ARCHIVE_SCOPE,
                "summary": section_summary(key, fold, position),
                "summaryTruthClass": section_summary_truth_class(key),
                "asOf": as_of,
                "visibilityEpoch": epoch,
                "sectionPath": section_path,
            })
        })
        .collect();
    index.insert("sections".to_owned(), Value::Array(sections));
    mark_market_closure(&mut index, !today_shown);
    Value::Object(index)
}

fn section_summary(key: &str, fold: &Fold, position: &FoldedPosition) -> String {
    let signals = fold
        .sessions
        .iter()
        .filter(|session| session.relationship_dyad_id.is_some())
        .count();
    match key {
        "paper" => format!(
            "目前 1 個部位（{}），原始失效條件已發生。",
            position.instrument_label
        ),
        "relations" => format!(
            "同組同事一人。他在公開場合把虧損歸到她身上 {signals} 次；她沒有被封存成角色，所以這裡只記得下他自己的可觀察動作與那一次留下的關係訊號。"
        ),
        "chart" => "單一象徵主題「控制與認可」，已在 2026-03-05 收盤到期。".to_owned(),
        "traits" => "四軸偏好與血型只影響自述與社交語氣，對市場項的權重固定為 0。".to_owned(),
        "memories" => format!(
            "{} 則已封存記憶，其中三則在第一個交易時段之前就存在。",
            fold.memory_count
        ),
        "life" => format!(
            "{} 個交易時段，{} 章已出版；今天還沒有結束。",
            fold.sessions.len(),
            fold.sessions
                .iter()
                .filter(|session| session.chapter_id.is_some())
                .count()
        ),
        other => unreachable!("unknown archive section key {other}"),
    }
}

/// The relationship line of 最近留下的三件事, from the relationship signal
/// and the structured attributions the fold decoded.
fn relationship_highlight(fold: &Fold) -> String {
    let named = fold
        .sessions
        .iter()
        .find(|session| session.relationship_dyad_id.is_some());
    let owned_later = named.and_then(|named| {
        fold.sessions.iter().find(|session| {
            session.session_index > named.session_index
                && session.outcome_attribution_kind
                    == Some(character::v1::OutcomeAttributionTargetKind::SelfOwn as i32)
        })
    });
    match (named, owned_later) {
        (Some(named), Some(owned)) => format!(
            "關係：{} 的組會上他把虧損歸到同組同事身上；{} 的組會上他說是自己判斷錯了。",
            named.market_date_taipei, owned.market_date_taipei
        ),
        (Some(named), None) => format!(
            "關係：{} 的組會上他把虧損歸到同組同事身上。",
            named.market_date_taipei
        ),
        _ => "關係：這段期間沒有留下關係訊號。".to_owned(),
    }
}

fn paper_archive(slice: &CharacterSlice, fold: &Fold, gate: &Gate) -> Value {
    let position = fold.position();
    let as_of = taipei_datetime(fold.current_mark().price_observed_at_unix_micros);
    let today_shown = gate.today_visible();

    let mut archive = envelope(
        slice,
        fold,
        gate,
        &[
            "fictional_setting",
            "symbolic_interpretation",
            "simulated_narrative",
        ],
    );
    archive.insert("characterId".to_owned(), json!(uuid(&fold.character_id)));
    archive.insert("appliedAudienceScope".to_owned(), json!(ARCHIVE_SCOPE));
    archive.insert("asOf".to_owned(), json!(as_of));
    // Today's paper view -- the position, the account cash and the exact
    // stream versions -- accumulates every paper action ever taken: cash
    // moves by each fill, and a version counts each change. Under any closed
    // session all three are withdrawn whole (the account and the version set
    // are absent, `positions` is empty) and the page carries the closure
    // label, so no figure here can be differenced against a visible one.
    if today_shown {
        archive.insert("paperVersionSet".to_owned(), paper_version_set(fold));
        archive.insert(
            "account".to_owned(),
            json!({
                "currency": "TWD",
                "cashMinorUnits": minor_units(fold.cash_fixed),
                "reservedCashMinorUnits": 0,
                "initialCapitalMinorUnits": minor_units(fold.initial_cash_fixed),
                "correctionRefs": Value::Array(Vec::new()),
                "asOf": as_of,
                "truthClass": SIMULATED_NARRATIVE,
            }),
        );
    }
    let positions = if today_shown {
        vec![paper_position(slice, fold, position, &as_of)]
    } else {
        Vec::new()
    };
    archive.insert("positions".to_owned(), Value::Array(positions));
    // One record per session before the horizon, exactly as it would read
    // without any switch; from the horizon on there is no record at all --
    // not a shell, whose state would mark the day.
    let records: Vec<Value> = fold
        .sessions
        .iter()
        .filter(|session| gate.session_visible(session.session_index))
        .map(|session| action_fill_record(slice, fold, session, position, session.finality_accepted))
        .collect();
    archive.insert("historicalActionFills".to_owned(), Value::Array(records));
    // A revision note restates a fact the session that published it made
    // visible; it follows that session.
    let revisions: Vec<Value> = data_revisions(fold, position)
        .into_iter()
        .filter(|note| {
            fold.fact(note["revisionId"].as_str().expect("a revision note has an id"))
                .is_some_and(|fact| gate.session_visible(fact.session_index))
        })
        .collect();
    archive.insert("dataRevisions".to_owned(), Value::Array(revisions));
    mark_market_closure(&mut archive, !today_shown);
    Value::Object(archive)
}

/// The three-aggregate exact version set from
/// `docs/v5/system-design.md` §9.1: parallel arrays of equal length, ordered
/// pairwise by stable aggregate id byte order.
fn paper_version_set(fold: &Fold) -> Value {
    let mut orders = fold.orders.clone();
    orders.sort_by(|left, right| left.order_id.cmp(&right.order_id));
    let position = fold.position();

    let order_refs: Vec<Value> = orders
        .iter()
        .map(|order| Value::String(uuid(&order.order_id)))
        .collect();
    let order_versions: Vec<Value> = orders
        .iter()
        .map(|order| json!(order.stream_version))
        .collect();

    let digest_input = format!(
        "paper-version-set/v1\u{0}{}:{}\u{0}{}\u{0}{}:{}",
        uuid(&fold.paper_account_id),
        fold.account_version,
        orders
            .iter()
            .map(|order| format!("{}:{}", uuid(&order.order_id), order.stream_version))
            .collect::<Vec<String>>()
            .join(","),
        uuid(&position.position_id),
        position.stream_version,
    );

    json!({
        "paperAccountRef": uuid(&fold.paper_account_id),
        "paperAccountVersion": fold.account_version,
        "paperOrderRefs": order_refs,
        "paperOrderVersions": order_versions,
        "paperPositionRefs": [uuid(&position.position_id)],
        "paperPositionVersions": [position.stream_version],
        "paperVersionSetDigest": hex(&payload_digest(digest_input.as_bytes())),
    })
}

fn paper_position(
    slice: &CharacterSlice,
    fold: &Fold,
    position: &FoldedPosition,
    as_of: &str,
) -> Value {
    let original = slice
        .thesis_chain
        .first()
        .expect("the slice seals an original thesis");
    let latest = slice
        .thesis_chain
        .latest()
        .expect("the slice seals a rewritten thesis");
    // Evaluated against the ORIGINAL commitment at the last ACCEPTED close:
    // rewriting the reason does not restart the clock he set himself, and an
    // unsettled session may never settle a horizon.
    let invalidation = evaluate_invalidation(
        original,
        fold.last_settled_session().evidence_cutoff_unix_micros,
        0,
    );
    let mark = fold.current_mark();

    let mut value = Map::new();
    value.insert("positionId".to_owned(), json!(uuid(&position.position_id)));
    // His paper position's own figures and states.
    value.insert("truthClass".to_owned(), json!(SIMULATED_NARRATIVE));
    value.insert(
        "instrumentLabel".to_owned(),
        json!(position.instrument_label),
    );
    value.insert(
        "instrumentLabelTruthClass".to_owned(),
        json!(SYNTHETIC_FACT_TRUTH_CLASS),
    );
    value.insert(
        "status".to_owned(),
        json!(if position.lots.is_empty() {
            "closed"
        } else {
            "open"
        }),
    );
    value.insert(
        "openedAt".to_owned(),
        json!(taipei_datetime(position.opened_at_unix_micros)),
    );
    // The last SETTLED change. Today's in-session mark cites yesterday's
    // close and does not move this timestamp forward into an unsettled day.
    value.insert(
        "lastChangedAt".to_owned(),
        json!(taipei_datetime(fold.last_settled_position_change_unix_micros())),
    );
    value.insert("closedAt".to_owned(), Value::Null);
    value.insert(
        "lots".to_owned(),
        Value::Array(
            position
                .lots
                .iter()
                .map(|lot| {
                    json!({
                        "lotId": uuid(&lot.lot_id),
                        "quantityFixed6": lot.quantity_fixed,
                        "sealedPriceMinorUnitsFixed6": minor_units_fixed6(lot.cost_basis_fixed),
                        "costBasisMinorUnits": lot_cost_basis_minor(lot),
                        "sealedPriceRevisionRef": lot.sealed_price_manifest_hash_hex,
                        // 2.2.0: a lot's quantity, price and cost basis are
                        // his paper figures, the same class as the position's
                        // own figures on this page -- carried here, not
                        // inherited from the position.
                        "truthClass": SIMULATED_NARRATIVE,
                    })
                })
                .collect(),
        ),
    );
    // The loss is complete and stays visible; there is no recovery arc.
    value.insert(
        "realizedPnlMinorUnits".to_owned(),
        json!(minor_units(position.realized_pnl_fixed)),
    );
    value.insert(
        "unrealizedPnlMinorUnits".to_owned(),
        json!(minor_units(position.unrealized_pnl_fixed)),
    );
    value.insert(
        "unrealizedPnlPercentFixed2".to_owned(),
        json!(percent_fixed2(
            minor_units(mark.unrealized_pnl_fixed),
            mark.cost_basis_minor_units,
        )),
    );
    value.insert("markAsOf".to_owned(), json!(as_of));
    value.insert(
        "invalidationCondition".to_owned(),
        json!(invalidation_label(invalidation)),
    );
    // Structured and unquoted: this is what he wrote down, not what he said.
    value.insert(
        "rationaleSummary".to_owned(),
        json!(format!(
            "建倉時封存的理由（{}）：預期兩個交易日內動能延續。失效條件是兩個交易日內沒有新證據，預定期限到 {} 收盤，當時信心 50%。",
            original.thesis_revision_id,
            taipei_date(original.intended_horizon_unix_micros),
        )),
    );
    value.insert(
        "rationaleSummaryTruthClass".to_owned(),
        json!(SIMULATED_NARRATIVE),
    );
    // 同時原話: U1, verbatim, and only because a sealed artifact exists.
    if let Some(utterance) = fold.utterances.first() {
        value.insert("concurrentClaim".to_owned(), utterance_value(utterance));
    }
    // 現在說法: the latest claim that answers the concurrent claim in place
    // (the rewritten reason), also verbatim.
    let concurrent_id = fold.utterances.first().map(|utterance| utterance.artifact_id.clone());
    if let Some(utterance) = fold
        .utterances
        .iter()
        .rev()
        .find(|utterance| utterance.replies_to.is_some() && utterance.replies_to == concurrent_id)
    {
        value.insert(
            "currentNarration".to_owned(),
            json!({
                "kind": "utterance",
                "utteranceArtifactId": uuid(&utterance.artifact_id),
                "canonicalTextSha256": utterance.canonical_text_sha256_hex,
                "canonicalTextUtf8": utterance.canonical_text_utf8,
                "truthClass": SIMULATED_NARRATIVE,
            }),
        );
    }
    // No sealed event records anyone shaping this position's decisions, so
    // no influence can be evidenced. Empty, not guessed -- and the readable
    // list says why it is empty instead of looking like missing data. His
    // public claim that a colleague was the reason is HIS claim; it lives in
    // the relations section as his claim, never here as a fact.
    value.insert(
        "influencedByCharacterRefs".to_owned(),
        Value::Array(Vec::new()),
    );
    value.insert("influencedBy".to_owned(), Value::Array(Vec::new()));
    value.insert(
        "influencedByEmptyReason".to_owned(),
        json!(evidence::NO_SEALED_INFLUENCE_LABEL),
    );
    value.insert(
        "consequenceSummary".to_owned(),
        json!(format!(
            "持有 {} 天後減碼 400 股，實現虧損 {} 元；剩下 {} 股仍在，未實現虧損 {} 元。引用的理由換過一次，{}。",
            held_days(
                position.opened_at_unix_micros,
                fold.last_settled_position_change_unix_micros(),
            ),
            format_whole_currency(minor_units(position.realized_pnl_fixed).abs()),
            position
                .lots
                .iter()
                .map(|lot| lot.quantity_fixed)
                .sum::<i64>()
                / FIXED_RAW_PER_UNIT,
            format_whole_currency(minor_units(position.unrealized_pnl_fixed).abs()),
            if latest.thesis_revision_id == original.thesis_revision_id {
                "支持事實未變"
            } else {
                "新增支持事實 0 筆"
            },
        )),
    );
    value.insert(
        "consequenceSummaryTruthClass".to_owned(),
        json!(SIMULATED_NARRATIVE),
    );
    Value::Object(value)
}

/// One paper action record. `disclose` is true only for a session whose
/// finality has been accepted (records at or after the kill-switch horizon
/// are not built at all).
fn action_fill_record(
    slice: &CharacterSlice,
    fold: &Fold,
    session: &FoldedSession,
    position: &FoldedPosition,
    disclose: bool,
) -> Value {
    let mut record = Map::new();
    record.insert(
        "recordId".to_owned(),
        json!(uuid(&derive_id(&format!(
            "v5-slice/paper-action-record/{}",
            session.market_date_taipei
        )))),
    );
    record.insert("positionRef".to_owned(), json!(uuid(&position.position_id)));
    record.insert("tradingDate".to_owned(), json!(session.market_date_taipei));
    record.insert(
        "marketSessionFinalityState".to_owned(),
        json!(if session.finality_accepted {
            "accepted"
        } else {
            "pending"
        }),
    );
    record.insert(
        "recordDataState".to_owned(),
        json!(if disclose { "READY" } else { "HELD" }),
    );
    // The finality fence, made mechanical: until this trading day's
    // `MarketSessionFinalityAccepted` has landed, the disclosure key is not
    // serialized at all -- never present with nulled-out fields
    // (`docs/v5/market-safety.md` 當期交易時段不得公開). A post-close
    // disclosure a kill switch covers is absent the same way.
    if disclose {
        let mut disclosure = Map::new();
        // His disclosed paper action and fill.
        disclosure.insert("truthClass".to_owned(), json!(SIMULATED_NARRATIVE));
        disclosure.insert(
            "instrumentLabel".to_owned(),
            json!(position.instrument_label),
        );
        disclosure.insert(
            "instrumentLabelTruthClass".to_owned(),
            json!(SYNTHETIC_FACT_TRUTH_CLASS),
        );
        disclosure.insert("action".to_owned(), json!(action_kind_label(session.action)));
        disclosure.insert(
            "direction".to_owned(),
            json!(direction_label(session.action)),
        );
        disclosure.insert("quantityFixed6".to_owned(), json!(session.quantity_fixed));
        // A confidence in basis points and a percentage scaled by 100 are
        // the same unit.
        disclosure.insert(
            "confidencePercentFixed2".to_owned(),
            json!(session.confidence_bp),
        );
        disclosure.insert(
            "fill".to_owned(),
            session.fill.as_ref().map_or(Value::Null, |fill| {
                json!({
                    "sealedPriceMinorUnitsFixed6": minor_units_fixed6(fill.sealed_price_fixed),
                    "sealedPriceRevisionRef": fill.sealed_price_manifest_hash_hex,
                    "filledAt": taipei_datetime(fill.filled_at_unix_micros),
                    // 2.2.0: his paper fill, the same class as the
                    // disclosure's other paper figures.
                    "truthClass": SIMULATED_NARRATIVE,
                })
            }),
        );
        disclosure.insert(
            "rationaleSummary".to_owned(),
            json!(daily_rationale_summary(slice, fold, session)),
        );
        disclosure.insert(
            "rationaleSummaryTruthClass".to_owned(),
            json!(SIMULATED_NARRATIVE),
        );
        if let Some(index) = session.utterance_index
            && let Some(utterance) = fold.utterances.get(index)
        {
            disclosure.insert("concurrentClaim".to_owned(), utterance_value(utterance));
        }
        record.insert(
            "dailyActionDisclosure".to_owned(),
            Value::Object(disclosure),
        );
    }
    Value::Object(record)
}

fn data_revisions(fold: &Fold, position: &FoldedPosition) -> Vec<Value> {
    let Some(correction) = fold.fact(CORRECTION_FACT_REVISION_ID) else {
        // No mirrored correction, so nothing to report. An empty list is the
        // honest answer; a placeholder note would not be.
        return Vec::new();
    };
    vec![json!({
        "revisionId": correction.fact_revision_id,
        "appliedAt": taipei_datetime(correction.available_at_unix_micros),
        "kind": "fact_correction",
        "affectedRefs": [uuid(&position.position_id)],
        "summary": format!(
            "{} 盤中發布的發行人更正公告。它在該時段的互動截止之後才出現，所以只是該時段的結果證據，下一個交易時段才進入他讀得到的範圍。",
            correction.market_date_taipei,
        ),
        // A note about a fixture fact takes the fact's source class.
        "truthClass": SYNTHETIC_FACT_TRUTH_CLASS,
    })]
}

// -- derived per-day copy -------------------------------------------------
//
// Engineering fixture copy for the slice, 未經 copy-taste 審稿. Nothing here
// is keyed by session index: every sentence is composed from what the fold
// decoded for that session, so it restates something a canonical event
// already recorded. None of it ranks, scores, or suggests an action.

/// Plain restatement of a sealed thesis revision's structured reason. An
/// unknown revision id is rendered as itself rather than described.
fn thesis_reason(thesis_revision_id: &str) -> &str {
    match thesis_revision_id {
        "thesis-hist-001" => "兩個交易日內動能延續",
        "thesis-hist-002" => "長期治理價值",
        other => other,
    }
}

/// The thesis revision the previous session's intent cited, if any.
fn previous_thesis<'a>(fold: &'a Fold, session: &FoldedSession) -> Option<&'a str> {
    session
        .session_index
        .checked_sub(2)
        .and_then(|position| fold.sessions.get(position))
        .map(|previous| previous.thesis_revision.as_str())
        .filter(|thesis| !thesis.is_empty())
}

/// How many supporting facts the cited revision added over the original.
fn newly_supported_count(slice: &CharacterSlice, thesis_revision_id: &str) -> Option<usize> {
    let first = slice.thesis_chain.first()?;
    let cited = slice
        .thesis_chain
        .revisions()
        .iter()
        .find(|revision| revision.thesis_revision_id == thesis_revision_id)?;
    Some(newly_supported_facts(first, cited).len())
}

/// Whole shares held after `session`, from the fills the fold decoded up to
/// and including it.
fn shares_held_after(fold: &Fold, session: &FoldedSession) -> i64 {
    fold.sessions
        .iter()
        .take(session.session_index)
        .filter(|earlier| earlier.fill.is_some())
        .map(|earlier| {
            if earlier.action == character::v1::ActionKind::PaperSell as i32 {
                -earlier.quantity_fixed
            } else {
                earlier.quantity_fixed
            }
        })
        .sum::<i64>()
        / FIXED_RAW_PER_UNIT
}

fn is_action(session: &FoldedSession, action: character::v1::ActionKind) -> bool {
    session.action == action as i32
}

fn action_summary(
    slice: &CharacterSlice,
    fold: &Fold,
    session: &FoldedSession,
    position: &FoldedPosition,
) -> String {
    let held = shares_held_after(fold, session);
    if let Some(fill) = &session.fill {
        let shares = session.quantity_fixed / FIXED_RAW_PER_UNIT;
        let price = format_price(fill.sealed_price_fixed);
        if is_action(session, character::v1::ActionKind::PaperBuy) {
            let notional_minor = minor_units(fill.sealed_price_fixed) * shares;
            let initial_minor = minor_units(fold.initial_cash_fixed);
            let cap_minor = initial_minor * i64::from(seed::PERSONAL_EXPOSURE_CAP_BP) / 10_000;
            return format!(
                "模擬買進 {} {} 股，成交價 {price}，名目金額 {} 元；占模擬資產 {}%，也是他自己寫下的曝險上限的 {}%。",
                position.instrument_label,
                group_digits(shares),
                format_whole_currency(notional_minor),
                notional_minor * 100 / initial_minor,
                (notional_minor * 10_000 / cap_minor + 50) / 100,
            );
        }
        let realized_minor = minor_units(session.realized_pnl_delta_fixed);
        return format!(
            "模擬賣出 {} {} 股，成交價 {price}，實現{} {} 元；剩下 {} 股仍在。",
            position.instrument_label,
            group_digits(shares),
            if realized_minor < 0 { "虧損" } else { "獲利" },
            format_whole_currency(realized_minor.abs()),
            group_digits(held),
        );
    }
    if held == 0 {
        return "沒有下單，也還沒有部位。他選擇繼續等。".to_owned();
    }
    if let Some(previous) = previous_thesis(fold, session)
        && previous != session.thesis_revision
    {
        return format!(
            "沒有下單。他把引用的理由從 {previous} 換成 {}，新增支持事實 {} 筆。",
            session.thesis_revision,
            newly_supported_count(slice, &session.thesis_revision)
                .expect("a cited thesis revision is in the sealed chain"),
        );
    }
    if is_action(session, character::v1::ActionKind::ReadOrVerify) {
        return format!("沒有下單。他重看了資料，繼續持有 {} 股。", group_digits(held));
    }
    format!("沒有下單。他繼續持有 {} 股。", group_digits(held))
}

fn daily_rationale_summary(slice: &CharacterSlice, fold: &Fold, session: &FoldedSession) -> String {
    if session.thesis_revision.is_empty() {
        return "沒有部位，也沒有下單意圖。".to_owned();
    }
    let reason = thesis_reason(&session.thesis_revision);
    if is_action(session, character::v1::ActionKind::PaperBuy) {
        return format!("預期{reason}；失效條件是兩個交易日內沒有新證據。");
    }
    if is_action(session, character::v1::ActionKind::PaperSell) {
        return "他寫下原本的理由已經不成立，並依此減碼。".to_owned();
    }
    if let Some(previous) = previous_thesis(fold, session)
        && previous != session.thesis_revision
    {
        let added = newly_supported_count(slice, &session.thesis_revision)
            .expect("a cited thesis revision is in the sealed chain");
        return format!("引用的理由改成{reason}；支持事實與建倉當時相比新增 {added} 筆。");
    }
    if is_action(session, character::v1::ActionKind::ReadOrVerify) {
        return format!("理由未變，仍然是{reason}；他重看了已公開的資料，沒有新增支持資料。");
    }
    format!("理由未變，仍然是{reason}；他沒有補上新的支持資料。")
}

/// How many consecutive sessions, ending with `session`, left the
/// counter-evidence in `missed`.
fn counter_evidence_run(fold: &Fold, session: &FoldedSession) -> usize {
    fold.sessions[..session.session_index]
        .iter()
        .rev()
        .take_while(|earlier| {
            earlier
                .missed_fact_revision_ids
                .iter()
                .any(|fact| fact == FACT_COUNTER_INVENTORY)
        })
        .count()
}

fn open_question_summary(
    slice: &CharacterSlice,
    fold: &Fold,
    session: &FoldedSession,
    position: &FoldedPosition,
) -> String {
    match session.outcome_attribution_kind {
        Some(kind) if kind == character::v1::OutcomeAttributionTargetKind::SelfOwn as i32 => {
            return "這一次他把虧損算在自己頭上。下一次被問到時呢？".to_owned();
        }
        Some(_) => return "他在組會上把虧損歸到別人身上。他會收回那句話嗎？".to_owned(),
        None => {}
    }
    if session.fill.is_some() && is_action(session, character::v1::ActionKind::PaperSell) {
        return format!(
            "他還沒有說，為什麼撐了 {} 天。",
            held_days(position.opened_at_unix_micros, session.evidence_cutoff_unix_micros)
        );
    }
    if session.fill.is_some() {
        return format!(
            "他寫下的失效條件是{}個交易日內沒有新證據。{}個交易日之後呢？",
            chinese_count(INTENDED_HORIZON_DAYS),
            chinese_count(INTENDED_HORIZON_DAYS),
        );
    }
    // Evaluated just after this session's close: the first settled session
    // past his own horizon is the one whose chapter can say it ran out.
    if let Some(original) = slice.thesis_chain.first() {
        let now = evaluate_invalidation(original, session.evidence_cutoff_unix_micros + 1, 0);
        let before = session
            .session_index
            .checked_sub(2)
            .and_then(|position| fold.sessions.get(position))
            .map(|previous| {
                evaluate_invalidation(original, previous.evidence_cutoff_unix_micros + 1, 0)
            });
        if now == InvalidationState::Occurred && before != Some(InvalidationState::Occurred) {
            return "他自己寫的期限在這個時段收盤到期了。他會改動作，還是改說法？".to_owned();
        }
    }
    let held = shares_held_after(fold, session);
    if held == 0 && !session.missed_fact_revision_ids.is_empty() {
        return "他會怎麼處理這個他自己記下來的錯過？".to_owned();
    }
    let run = counter_evidence_run(fold, session);
    if run > 0 {
        return format!("同一份反面資料已經連續 {run} 個交易時段沒有被打開。他要到什麼時候才會讀它？");
    }
    // Between a public statement that named someone else and a later one in
    // which he names himself, the earlier sentence is still standing.
    let earlier = &fold.sessions[..session.session_index];
    let last_external = earlier.iter().rev().find(|earlier| {
        earlier.outcome_attribution_kind.is_some_and(|kind| {
            kind != character::v1::OutcomeAttributionTargetKind::SelfOwn as i32
        })
    });
    if let Some(named) = last_external
        && !earlier.iter().any(|later| {
            later.session_index > named.session_index
                && later.outcome_attribution_kind
                    == Some(character::v1::OutcomeAttributionTargetKind::SelfOwn as i32)
        })
    {
        return format!(
            "他在 {} 組會上的那句話還沒有收回。剩下的 {} 股還在。",
            named.market_date_taipei,
            group_digits(held)
        );
    }
    format!("剩下的 {} 股還在。下一次被問到時，他會怎麼說明它們？", group_digits(held))
}

/// The close-up's one unresolved contradiction, from the structured
/// attributions the fold decoded.
fn tension_summary(fold: &Fold) -> String {
    let attributions: Vec<(&str, i32)> = fold
        .sessions
        .iter()
        .filter_map(|session| {
            session
                .outcome_attribution_kind
                .map(|kind| (session.market_date_taipei.as_str(), kind))
        })
        .collect();
    let external = attributions
        .iter()
        .find(|(_, kind)| *kind != character::v1::OutcomeAttributionTargetKind::SelfOwn as i32);
    let owned_later = external.and_then(|(external_date, _)| {
        attributions.iter().find(|(date, kind)| {
            date > external_date
                && *kind == character::v1::OutcomeAttributionTargetKind::SelfOwn as i32
        })
    });
    match (external, owned_later) {
        (Some((external_date, _)), Some((owned_date, _))) => format!(
            "他在 {external_date} 的組會上把虧損說成別人的關係，{owned_date} 又在組會上說是自己判斷錯了；第一次那句話，他還沒有收回。"
        ),
        (Some((external_date, _)), None) => {
            format!("他在 {external_date} 的組會上把虧損說成別人的關係，還沒有收回那句話。")
        }
        _ => "他終於減碼，但還沒說為什麼撐了那麼久。".to_owned(),
    }
}

fn chinese_count(value: u32) -> &'static str {
    match value {
        1 => "一",
        2 => "兩",
        3 => "三",
        _ => unreachable!("the slice's own horizon is a small fixed count"),
    }
}

fn known_summary(fold: &Fold, session: &FoldedSession) -> String {
    if session.selected_fact_revision_ids.is_empty() {
        return "這一天他沒有把注意力放在任何一則當時已公開的資料上；他讀的是前一個交易時段的公告附註。"
            .to_owned();
    }
    format!(
        "他當時確實讀進去的公開資料：{}。",
        fact_labels(fold, &session.selected_fact_revision_ids).join("、")
    )
}

fn missed_summary(fold: &Fold, session: &FoldedSession) -> String {
    if session.missed_fact_revision_ids.is_empty() {
        return "這一天他沒有漏掉任何一則當時已公開的高顯著性資料。".to_owned();
    }
    format!(
        "收盤結果被接受之後才看得出來：{}當時就在他讀得到的清單裡，他沒有打開。",
        fact_labels(fold, &session.missed_fact_revision_ids).join("、")
    )
}

fn fact_labels(fold: &Fold, fact_revision_ids: &[String]) -> Vec<String> {
    fact_revision_ids
        .iter()
        .map(|id| fact_label(fold, id))
        .collect()
}

/// A readable label for a sealed fact revision. An unrecognized id is
/// rendered as itself rather than described, because describing a fact this
/// repository has not mirrored would be inventing one.
fn fact_label(fold: &Fold, fact_revision_id: &str) -> String {
    match fact_revision_id {
        FACT_MOMENTUM_S1 => "早盤那一段動能事實".to_owned(),
        FACT_COUNTER_INVENTORY => "同業存貨天數上升到 64.5 天的反面事實".to_owned(),
        CORRECTION_FACT_REVISION_ID => "發行人更正公告".to_owned(),
        other => fold.fact(other).map_or_else(
            || other.to_owned(),
            |fact| format!("{} 的封存收盤價", fact.market_date_taipei),
        ),
    }
}

// -- value helpers --------------------------------------------------------

/// A standalone verbatim claim (`ClassifiedCharacterUtterance`): his words,
/// so `simulated_narrative`.
fn utterance_value(utterance: &FoldedUtterance) -> Value {
    json!({
        "utteranceArtifactId": uuid(&utterance.artifact_id),
        "canonicalTextSha256": utterance.canonical_text_sha256_hex,
        "canonicalTextUtf8": utterance.canonical_text_utf8,
        "truthClass": SIMULATED_NARRATIVE,
    })
}

const fn invalidation_label(state: InvalidationState) -> &'static str {
    match state {
        InvalidationState::NotYetOccurred => "not_yet_occurred",
        InvalidationState::Occurred => "occurred",
        InvalidationState::UnknownAtTheTime => "unknown_at_the_time",
    }
}

/// `character::v1::ActionKind` -> `PaperActionKind`.
fn action_kind_label(action: i32) -> &'static str {
    if action == character::v1::ActionKind::PaperBuy as i32 {
        "BUY"
    } else if action == character::v1::ActionKind::PaperSell as i32 {
        "SELL"
    } else if action == character::v1::ActionKind::Wait as i32 {
        "HOLD"
    } else {
        "NO_ACTION"
    }
}

fn direction_label(action: i32) -> &'static str {
    if action == character::v1::ActionKind::PaperBuy as i32 {
        "upside"
    } else if action == character::v1::ActionKind::PaperSell as i32 {
        "downside"
    } else {
        "no_action"
    }
}

/// `Fixed` raw -> whole currency minor units. Fails closed on a value that is
/// not a whole minor unit: a public figure is never silently rounded.
fn minor_units(fixed_raw: i64) -> i64 {
    assert!(
        fixed_raw % FIXED_RAW_PER_MINOR_UNIT == 0,
        "money value {fixed_raw} is not a whole currency minor unit"
    );
    fixed_raw / FIXED_RAW_PER_MINOR_UNIT
}

/// `Fixed` raw (six decimals of one TWD) -> minor units scaled by 1,000,000.
const fn minor_units_fixed6(fixed_raw: i64) -> i64 {
    fixed_raw * 100
}

fn lot_cost_basis_minor(lot: &FoldedLot) -> i64 {
    assert!(
        lot.quantity_fixed % FIXED_RAW_PER_UNIT == 0,
        "this slice trades whole shares only"
    );
    minor_units(lot.cost_basis_fixed) * (lot.quantity_fixed / FIXED_RAW_PER_UNIT)
}

/// Signed percentage scaled by 100. Exact division only -- a public
/// percentage that does not divide out is a defect to surface, not something
/// to round away.
fn percent_fixed2(numerator_minor: i64, denominator_minor: i64) -> i64 {
    assert!(denominator_minor != 0, "a percentage needs a cost basis");
    let scaled = numerator_minor * 10_000;
    assert!(
        scaled % denominator_minor == 0,
        "percentage {scaled}/{denominator_minor} does not divide exactly"
    );
    scaled / denominator_minor
}

/// Calendar days held, counting the purchase day as day one.
fn held_days(opened_at_unix_micros: i64, at_unix_micros: i64) -> i64 {
    taipei_day_index(at_unix_micros) - taipei_day_index(opened_at_unix_micros) + 1
}

/// Whole currency units from minor units, thousands-separated.
fn format_whole_currency(minor: i64) -> String {
    group_digits(minor / 100)
}

/// A per-unit sealed price in `Fixed` raw, as `100.00`.
fn format_price(fixed_raw: i64) -> String {
    let minor = minor_units(fixed_raw);
    format!("{}.{:02}", minor / 100, minor % 100)
}

/// A non-negative integer, thousands-separated.
fn group_digits(value: i64) -> String {
    let digits = value.to_string();
    let mut grouped = String::with_capacity(digits.len() + digits.len() / 3);
    for (offset, digit) in digits.chars().enumerate() {
        if offset > 0 && (digits.len() - offset).is_multiple_of(3) {
            grouped.push(',');
        }
        grouped.push(digit);
    }
    grouped
}

// -- encoding helpers -----------------------------------------------------

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut value = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        value.push(char::from(DIGITS[usize::from(byte >> 4)]));
        value.push(char::from(DIGITS[usize::from(byte & 0x0f)]));
    }
    value
}

/// A canonical 16-byte id as a lowercase hyphenated UUID string.
///
/// # Panics
///
/// Panics on anything that is not 16 bytes: an id that does not round trip
/// is not an id.
fn uuid(bytes: &[u8]) -> String {
    assert!(bytes.len() == 16, "canonical ids are 16 bytes");
    let text = hex(bytes);
    format!(
        "{}-{}-{}-{}-{}",
        &text[0..8],
        &text[8..12],
        &text[12..16],
        &text[16..20],
        &text[20..32]
    )
}

fn be_u64(bytes: &[u8]) -> Option<u64> {
    <[u8; 8]>::try_from(bytes).ok().map(u64::from_be_bytes)
}

const MICROS_PER_SECOND: i64 = 1_000_000;
const SECONDS_PER_DAY: i64 = 86_400;
const TAIPEI_OFFSET_SECONDS: i64 = 8 * 3_600;

fn taipei_day_index(unix_micros: i64) -> i64 {
    (unix_micros.div_euclid(MICROS_PER_SECOND) + TAIPEI_OFFSET_SECONDS).div_euclid(SECONDS_PER_DAY)
}

/// Civil date from a days-since-epoch count (Howard Hinnant's algorithm,
/// integer arithmetic only).
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let shifted = days + 719_468;
    let era = if shifted >= 0 {
        shifted
    } else {
        shifted - 146_096
    } / 146_097;
    let day_of_era = shifted - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_position = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_position + 2) / 5 + 1;
    let month = if month_position < 10 {
        month_position + 3
    } else {
        month_position - 9
    };
    (if month <= 2 { year + 1 } else { year }, month, day)
}

fn taipei_date(unix_micros: i64) -> String {
    let (year, month, day) = civil_from_days(taipei_day_index(unix_micros));
    format!("{year:04}-{month:02}-{day:02}")
}

/// Asia/Taipei (UTC+8) RFC 3339. Every public timestamp in this slice is
/// written with its offset, so a reader never has to guess which market day
/// a figure belongs to.
fn taipei_datetime(unix_micros: i64) -> String {
    let taipei_seconds = unix_micros.div_euclid(MICROS_PER_SECOND) + TAIPEI_OFFSET_SECONDS;
    let seconds_of_day = taipei_seconds.rem_euclid(SECONDS_PER_DAY);
    let (year, month, day) = civil_from_days(taipei_seconds.div_euclid(SECONDS_PER_DAY));
    let hour = seconds_of_day / 3_600;
    let minute = (seconds_of_day % 3_600) / 60;
    let second = seconds_of_day % 60;
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}+08:00")
}

fn pretty(value: &Value) -> String {
    let mut text = serde_json::to_string_pretty(value).expect("projection values are serializable");
    text.push('\n');
    text
}

#[cfg(test)]
mod tests {
    use super::{
        civil_from_days, fold, held_days, minor_units, percent_fixed2, public_api_documents,
        taipei_date, taipei_datetime, uuid,
    };
    use crate::slice::one_character_slice;

    #[test]
    fn taipei_calendar_helpers_round_trip_the_fixture_dates() {
        // 2026-03-17 13:30 Taipei == 1_773_725_400 seconds.
        let close = 1_773_725_400_i64 * 1_000_000;
        assert_eq!(taipei_datetime(close), "2026-03-17T13:30:00+08:00");
        assert_eq!(taipei_date(close), "2026-03-17");
        assert_eq!(civil_from_days(0), (1970, 1, 1));
    }

    #[test]
    fn held_days_counts_the_purchase_day_as_day_one() {
        let opened = 1_772_515_800_i64 * 1_000_000; // 2026-03-03 13:30 +08:00
        let closed = 1_773_725_400_i64 * 1_000_000; // 2026-03-17 13:30 +08:00
        assert_eq!(held_days(opened, opened), 1);
        assert_eq!(held_days(opened, closed), 15);
    }

    #[test]
    fn money_helpers_refuse_to_round() {
        assert_eq!(minor_units(-4_720 * 1_000_000), -472_000);
        assert_eq!(percent_fixed2(-708_000, 6_000_000), -1_180);
    }

    #[test]
    fn the_fold_matches_the_versions_the_ledger_itself_sealed() {
        let folded = fold(&one_character_slice());
        // `PaperOutcomeRecognizedV1` sealed the exact aggregate versions at
        // the moment of the reduction; the fold must reach the same numbers
        // from the log alone.
        assert_eq!(folded.recognized_account_version, Some(folded.account_version));
        let sell_order = folded
            .orders
            .last()
            .expect("the slice submits a sell order");
        assert_eq!(folded.recognized_order_version, Some(sell_order.stream_version));
    }

    #[test]
    fn every_document_has_a_distinct_path_and_parses_as_json() {
        let documents = public_api_documents(&one_character_slice());
        // Ten public-v2 documents (world, close-up, life journal, archive
        // index and its six sections) plus the route index.
        assert_eq!(documents.len(), 11);
        let mut paths: Vec<&str> = documents.iter().map(|(path, _)| path.as_str()).collect();
        paths.sort_unstable();
        paths.dedup();
        assert_eq!(paths.len(), 11);
        for (path, text) in &documents {
            serde_json::from_str::<serde_json::Value>(text)
                .unwrap_or_else(|error| panic!("{path} is not valid JSON: {error}"));
        }
    }

    #[test]
    fn ids_render_as_lowercase_hyphenated_uuids() {
        let rendered = uuid(&[0x0a; 16]);
        assert_eq!(rendered.len(), 36);
        assert_eq!(rendered, "0a0a0a0a-0a0a-0a0a-0a0a-0a0a0a0a0a0a");
    }
}
