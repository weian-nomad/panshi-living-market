#![allow(clippy::too_many_lines)]

//! The public read-side projection: it folds the one-character slice's
//! canonical event log into the five response objects
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
//!   as a zero. A one-character slice has no `RelationshipDyad` aggregate,
//!   so `relationshipDyadRefs` and `influencedByCharacterRefs` stay empty
//!   rather than carrying a plausible-looking id.
//! - **The as-of fence.** Every currently-visible paper figure is dated by
//!   the price source the canonical mark actually cited, which for today's
//!   in-session mark is the previous session's accepted close
//!   (2026-03-17T13:30:00+08:00). A settled journal chapter is dated by its
//!   own accepted close, because that is the moment its number was true. No
//!   paper figure anywhere is dated 2026-03-18, whose finality is pending.
//! - **Integer money only.** Amounts are currency minor units; quantities
//!   and per-unit prices are `*Fixed6` integers. No floating point enters
//!   this module (the workspace lints deny it outright), and a value that
//!   does not divide exactly panics instead of being rounded into public
//!   view.
//! - **`truth_class` integrity.** This slice's market facts are a
//!   repo-local synthetic fixture, so the only classes a response may carry
//!   are `fictional_setting`, `symbolic_interpretation` and
//!   `simulated_narrative`. `real_fact` may never appear in any field.
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

use serde_json::{Map, Value, json};

use panshi_character_domain::{
    bias::{BiasKind, is_recurring_at},
    thesis::{InvalidationState, evaluate_invalidation},
};
use panshi_protocol::{character, decode_canonical, portfolio, story, world};

use crate::{
    derive_id, payload_digest,
    slice::{CharacterSlice, seed},
};

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

/// The six deep-archive sections, in `ArchiveSectionKey` order. Only `paper`
/// has a dedicated endpoint in this phase; the other five are entrances.
const ARCHIVE_SECTION_KEYS: [&str; 6] =
    ["paper", "relations", "chart", "traits", "memories", "life"];

/// The correction the upstream fixture published mid-session on S4.
const CORRECTION_FACT_REVISION_ID: &str = "fact-hist-001-correction-s4";

// -- folded state ---------------------------------------------------------

#[derive(Clone, Debug)]
struct FoldedUtterance {
    artifact_id: Vec<u8>,
    canonical_text_utf8: String,
    canonical_text_sha256_hex: String,
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
}

#[derive(Clone, Debug)]
struct FoldedFact {
    fact_revision_id: String,
    market_date_taipei: String,
    available_at_unix_micros: i64,
}

#[derive(Clone, Debug)]
struct FoldedSession {
    session_index: usize,
    manifest_id: String,
    manifest_hash_hex: String,
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
    memory_ids: Vec<Vec<u8>>,
    fill: Option<FoldedFill>,
    marks: Vec<FoldedMark>,
    /// Whether the position's own lot book changed in this session (opened
    /// or reduced). A mark is a valuation, not a change.
    position_changed: bool,
    chapter_id: Option<Vec<u8>>,
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

    for event in &slice.events {
        let bytes = event.payload_bytes.as_slice();
        match event.event_type {
            "CharacterOriginSealed" => {
                let decoded = decode_canonical::<character::v1::CharacterOriginSealedV1>(bytes)
                    .expect("canonical CharacterOriginSealedV1");
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
                fold.sessions.push(FoldedSession {
                    session_index: fold.sessions.len() + 1,
                    manifest_id: decoded.manifest_id,
                    manifest_hash_hex: hex(&decoded.manifest_hash),
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
                    memory_ids: Vec::new(),
                    fill: None,
                    marks: Vec::new(),
                    position_changed: false,
                    chapter_id: None,
                });
            }
            "FactBecameVisible" => {
                let decoded = decode_canonical::<world::v1::FactBecameVisibleV1>(bytes)
                    .expect("canonical FactBecameVisibleV1");
                let market_date_taipei = fold.current_session_mut().market_date_taipei.clone();
                fold.facts.push(FoldedFact {
                    fact_revision_id: decoded.fact_revision_id,
                    market_date_taipei,
                    available_at_unix_micros: decoded.available_at_unix_micros,
                });
            }
            "MarketSessionFinalityAccepted" => {
                fold.current_session_mut().finality_accepted = true;
            }
            "AttentionCommitted" => {
                let decoded = decode_canonical::<character::v1::AttentionCommittedV1>(bytes)
                    .expect("canonical AttentionCommittedV1");
                let session = fold.current_session_mut();
                session.cognitive_episode_id = decoded.cognitive_episode_id;
                session.selected_fact_revision_ids = decoded.selected_fact_revision_ids;
                session.missed_fact_revision_ids = decoded.missed_high_salience_fact_revision_ids;
            }
            "AutonomousActionIntentCommitted" => {
                let decoded =
                    decode_canonical::<character::v1::AutonomousActionIntentCommittedV1>(bytes)
                        .expect("canonical AutonomousActionIntentCommittedV1");
                let session = fold.current_session_mut();
                session.action = decoded.action;
                session.quantity_fixed = decoded.quantity_or_target_weight_fixed;
                session.confidence_bp = decoded.confidence_bp;
            }
            "PublicClaimMade" => {
                let decoded = decode_canonical::<character::v1::UtteranceArtifactV1>(bytes)
                    .expect("canonical UtteranceArtifactV1");
                let index = fold.utterances.len();
                fold.utterances.push(FoldedUtterance {
                    artifact_id: decoded.utterance_artifact_id,
                    canonical_text_utf8: decoded.canonical_text_utf8,
                    canonical_text_sha256_hex: hex(&decoded.canonical_text_sha256),
                });
                fold.current_session_mut().utterance_index = Some(index);
            }
            "MemoryFormed" => {
                let decoded = decode_canonical::<character::v1::MemoryFormedV1>(bytes)
                    .expect("canonical MemoryFormedV1");
                // The three bootstrap memories are sealed before the first
                // manifest; they belong to no chapter.
                if !fold.sessions.is_empty() {
                    fold.current_session_mut().memory_ids.push(decoded.memory_id);
                }
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
                let closed_quantity_fixed = session.quantity_fixed;
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
                fold.current_session_mut().marks.push(FoldedMark {
                    unrealized_pnl_fixed: decoded.unrealized_pnl_fixed,
                    price_observed_at_unix_micros: price_source.price_observed_at_unix_micros,
                    cost_basis_minor_units,
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
                fold.current_session_mut().chapter_id = Some(decoded.chapter_id);
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

/// Folds the canonical event log into the five `public-v2.yaml` response
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
#[must_use]
pub fn public_api_documents(slice: &CharacterSlice) -> Vec<(String, String)> {
    let fold = fold(slice);
    let character_id = uuid(&fold.character_id);

    let documents = vec![
        ("v2/world.json".to_owned(), world_snapshot(slice, &fold)),
        (
            format!("v2/characters/{character_id}/close-up.json"),
            close_up(slice, &fold),
        ),
        (
            format!("v2/characters/{character_id}/life-journal.json"),
            life_journal(slice, &fold),
        ),
        (
            format!("v2/characters/{character_id}/archive.json"),
            archive_index(slice, &fold),
        ),
        (
            format!("v2/characters/{character_id}/archive/paper.json"),
            paper_archive(slice, &fold),
        ),
    ];

    let mut routes = Map::new();
    routes.insert("/api/v2/world".to_owned(), json!(documents[0].0));
    routes.insert(
        format!("/api/v2/characters/{character_id}/close-up"),
        json!(documents[1].0),
    );
    routes.insert(
        format!("/api/v2/characters/{character_id}/life-journal"),
        json!(documents[2].0),
    );
    routes.insert(
        format!("/api/v2/characters/{character_id}/archive"),
        json!(documents[3].0),
    );
    routes.insert(
        format!("/api/v2/characters/{character_id}/archive/paper"),
        json!(documents[4].0),
    );
    let index = json!({ "characterId": character_id, "routes": Value::Object(routes) });

    let mut out: Vec<(String, String)> = documents
        .into_iter()
        .map(|(path, value)| (path, pretty(&value)))
        .collect();
    out.push(("index.json".to_owned(), pretty(&index)));
    out
}

/// The envelope every projection response in `public-v2.yaml` carries
/// (`docs/v5/system-design.md` §11.3).
fn envelope(slice: &CharacterSlice, fold: &Fold, truth_classes: &[&str]) -> Map<String, Value> {
    let global_position = i64::try_from(slice.events.len()).expect("slice log length fits i64");
    let mut envelope = Map::new();
    envelope.insert("projectionVersion".to_owned(), json!(global_position));
    envelope.insert("sourceGlobalPosition".to_owned(), json!(global_position));
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
    envelope.insert("visibilityEpoch".to_owned(), json!(fold.visibility_epoch));
    envelope.insert("truthClasses".to_owned(), json!(truth_classes));
    envelope.insert("sourceRevisionSet".to_owned(), source_revision_set(fold));
    envelope
}

/// Every canonical revision this projection was computed from: the six
/// mirrored manifests plus the paper aggregates' exact stream versions.
fn source_revision_set(fold: &Fold) -> Value {
    let mut refs: Vec<Value> = fold
        .sessions
        .iter()
        .map(|session| {
            json!({
                "refId": session.manifest_id,
                "refKind": "world_fact_manifest",
                "revision": i64::try_from(session.session_index).expect("session index fits i64"),
            })
        })
        .collect();
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
    Value::Array(refs)
}

fn world_snapshot(slice: &CharacterSlice, fold: &Fold) -> Value {
    let today = fold.today();
    let settled = fold.last_settled_session();
    let mut snapshot = envelope(slice, fold, &["fictional_setting", "simulated_narrative"]);

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
    // the scene are a rendering concern and never enter the contract.
    snapshot.insert(
        "characterPositions".to_owned(),
        json!([{
            "characterId": uuid(&fold.character_id),
            "worldX": 12,
            "worldY": 7,
            "poseState": "examining",
            "focusHint": "他昨天終於減碼的那批資料",
            "zOrder": 0,
            "sceneLayer": "foreground",
            "detailTier": "high_detail",
            "sourceEventRefs": [uuid(&today.cognitive_episode_id)],
        }]),
    );
    // At most five, and carrying no rank, score, ticker or performance
    // figure (`docs/v5/market-safety.md` 今日五幕).
    snapshot.insert(
        "storyHooks".to_owned(),
        json!([{
            "hookId": uuid(&derive_id("v5-slice/story-hook/opening-hall-1")),
            "characterId": uuid(&fold.character_id),
            "sceneRef": scene_id,
            "label": "開盤廳裡有人在重看昨天的資料",
        }]),
    );
    Value::Object(snapshot)
}

fn close_up(slice: &CharacterSlice, fold: &Fold) -> Value {
    let position = fold.position();
    let mark = fold.current_mark();
    let mut close_up = envelope(
        slice,
        fold,
        &[
            "fictional_setting",
            "symbolic_interpretation",
            "simulated_narrative",
        ],
    );

    close_up.insert("characterId".to_owned(), json!(uuid(&fold.character_id)));
    close_up.insert("displayName".to_owned(), json!(seed::DISPLAY_NAME));
    close_up.insert("ageYears".to_owned(), json!(seed::AGE_YEARS));
    close_up.insert("occupationLabel".to_owned(), json!(OCCUPATION_LABEL));
    close_up.insert(
        "sceneRef".to_owned(),
        json!(uuid(&derive_id("v5-slice/scene/opening-hall"))),
    );
    close_up.insert("poseState".to_owned(), json!("examining"));
    close_up.insert(
        "currentVerbPhrase".to_owned(),
        json!("正在重看他昨天終於減碼的那批資料"),
    );
    close_up.insert(
        "currentAttention".to_owned(),
        json!({ "targetKind": "object", "label": "同業存貨天數上升的那份資料" }),
    );
    close_up.insert(
        "unresolvedTensionSummary".to_owned(),
        json!("他昨天終於減碼，但還沒說為什麼撐了十五天。"),
    );
    // The sealed artifacts, verbatim: U2 is the latest public claim, U3 the
    // first self-acknowledgement. Nothing is paraphrased alongside them.
    if let Some(utterance) = fold.utterances.get(1) {
        close_up.insert("publicClaim".to_owned(), utterance_value(utterance));
    }
    if let Some(utterance) = fold.utterances.get(2) {
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
        }]),
    );
    Value::Object(close_up)
}

fn life_journal(slice: &CharacterSlice, fold: &Fold) -> Value {
    let position = fold.position();
    let mut page = envelope(
        slice,
        fold,
        &[
            "fictional_setting",
            "symbolic_interpretation",
            "simulated_narrative",
        ],
    );
    page.insert("characterId".to_owned(), json!(uuid(&fold.character_id)));
    page.insert("appliedAudienceScope".to_owned(), json!(PUBLIC_SCOPE));

    // Only a session whose finality has been accepted has a published
    // chapter. Today is in session, so today is not in the journal.
    let entries: Vec<Value> = fold
        .sessions
        .iter()
        .filter(|session| session.finality_accepted)
        .map(|session| journal_entry(slice, fold, session, position))
        .collect();
    page.insert("entries".to_owned(), Value::Array(entries));
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
) -> Value {
    let index = session.session_index;
    let mut entry = Map::new();
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

    // 1. 今天他怎麼了
    entry.insert("sceneSummary".to_owned(), json!(scene_summary(index)));

    // 2. 他當時怎麼說 -- only where a sealed PUBLIC claim exists. S5's
    // artifact is a self-acknowledgement, so it belongs in segment 7, not
    // here.
    if index != 5
        && let Some(utterance_index) = session.utterance_index
        && let Some(utterance) = fold.utterances.get(utterance_index)
    {
        entry.insert("contemporaneousClaim".to_owned(), utterance_value(utterance));
    }

    // 3. 他其實知道什麼
    entry.insert(
        "knownAtTheTimeSummary".to_owned(),
        json!(known_summary(fold, session)),
    );

    // 4. 他漏掉了什麼 -- only ever on a session whose finality has been
    // accepted; before that, what he missed is not yet a public fact.
    if session.finality_accepted {
        entry.insert(
            "missedFactsSummary".to_owned(),
            json!(missed_summary(fold, session)),
        );
    }

    // 5. 他做了什麼
    entry.insert("actionSummary".to_owned(), json!(action_summary(index)));

    // 6. 這個決定留下什麼
    entry.insert("consequence".to_owned(), journal_consequence(session, position));

    // 7. 現在怎麼說 -- verbatim only where a SELF_ACKNOWLEDGED artifact
    // exists; otherwise the documented unquoted fallback, and while the
    // motive is still unacknowledged that fallback is 暫時不知道
    // (`docs/v5/experience-spec.md` §8.2), never a third-person diagnosis.
    entry.insert(
        "currentSelfNarration".to_owned(),
        match fold.utterances.get(2) {
            Some(utterance) if index == 5 => json!({
                "kind": "utterance",
                "utteranceArtifactId": uuid(&utterance.artifact_id),
                "canonicalTextSha256": utterance.canonical_text_sha256_hex,
                "canonicalTextUtf8": utterance.canonical_text_utf8,
            }),
            _ => json!({ "kind": "summary", "summaryText": "暫時不知道" }),
        },
    );

    // 8. 老毛病又回來了 -- only once the same pattern had ALREADY recurred at
    // least twice before this chapter was written. A chapter may not count
    // its own session's observation as prior history.
    if is_recurring_at(&slice.bias_observations, BiasKind::ConfirmationBias, index) {
        entry.insert(
            "recurringPatternRef".to_owned(),
            json!(uuid(&derive_id(
                "v5-slice/recurring-pattern/confirmation-bias"
            ))),
        );
    }

    // 9. 還沒完
    entry.insert(
        "openQuestionSummary".to_owned(),
        json!(open_question_summary(index)),
    );

    entry.insert(
        "archiveRefs".to_owned(),
        json!({
            "paperPositionRefs": if session.marks.is_empty() {
                Vec::new()
            } else {
                vec![Value::String(uuid(&position.position_id))]
            },
            // One character, so no RelationshipDyad aggregate exists to
            // point at. Fail closed rather than mint a plausible id.
            "relationshipDyadRefs": Value::Array(Vec::new()),
            "memoryRefs": session
                .memory_ids
                .iter()
                .map(|id| Value::String(uuid(id)))
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
        },
    })
}

fn archive_index(slice: &CharacterSlice, fold: &Fold) -> Value {
    let character_id = uuid(&fold.character_id);
    let position = fold.position();
    let as_of = taipei_datetime(fold.current_mark().price_observed_at_unix_micros);
    let mut index = envelope(
        slice,
        fold,
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
    index.insert(
        "longTermTensionSummary".to_owned(),
        json!("他說自己靠證據做事，卻連續三個交易時段沒有打開同一份反面資料。"),
    );
    // 最近留下的三件事: at most three, each checkable against a canonical
    // event rather than against a mood.
    index.insert(
        "recentHighlights".to_owned(),
        json!([
            format!(
                "模擬紀錄：1 個部位仍在，原始失效條件已發生，已實現虧損 {} 元。",
                format_whole_currency(minor_units(position.realized_pnl_fixed).abs()),
            ),
            "說法：引用的理由換過一次，新增支持事實 0 筆。".to_owned(),
            "關係：他在前一個交易時段主動走回同組同事的座位旁。".to_owned(),
        ]),
    );

    let sections: Vec<Value> = ARCHIVE_SECTION_KEYS
        .iter()
        .map(|key| {
            json!({
                "sectionKey": key,
                "viewerAudienceScope": ARCHIVE_SCOPE,
                "summary": section_summary(key, position),
                "asOf": as_of,
                "visibilityEpoch": fold.visibility_epoch,
                // Only 模擬紀錄 has a real page in this slice. The other five
                // are entrances, and an entrance with no endpoint says so
                // rather than linking somewhere that does not exist.
                "sectionPath": if *key == "paper" {
                    Value::String(format!("/api/v2/characters/{character_id}/archive/paper"))
                } else {
                    Value::Null
                },
            })
        })
        .collect();
    index.insert("sections".to_owned(), Value::Array(sections));
    Value::Object(index)
}

fn section_summary(key: &str, position: &FoldedPosition) -> String {
    match key {
        "paper" => format!(
            "目前 1 個部位（{}），原始失效條件已發生。",
            position.instrument_label
        ),
        "relations" => {
            "同組同事一人。這個切片只封存了他一個人，所以這裡只記得下他自己的可觀察動作。".to_owned()
        }
        "chart" => "單一象徵主題「控制與認可」，已在 2026-03-05 收盤到期。".to_owned(),
        "traits" => "四軸偏好與血型只影響自述與社交語氣，對市場項的權重固定為 0。".to_owned(),
        "memories" => "七則已封存記憶，其中三則在第一個交易時段之前就存在。".to_owned(),
        "life" => "六個交易時段，五章已出版；今天還沒有結束。".to_owned(),
        other => unreachable!("unknown archive section key {other}"),
    }
}

fn paper_archive(slice: &CharacterSlice, fold: &Fold) -> Value {
    let position = fold.position();
    let as_of = taipei_datetime(fold.current_mark().price_observed_at_unix_micros);

    let mut archive = envelope(
        slice,
        fold,
        &[
            "fictional_setting",
            "symbolic_interpretation",
            "simulated_narrative",
        ],
    );
    archive.insert("characterId".to_owned(), json!(uuid(&fold.character_id)));
    archive.insert("appliedAudienceScope".to_owned(), json!(ARCHIVE_SCOPE));
    archive.insert("asOf".to_owned(), json!(as_of));
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
        }),
    );
    archive.insert(
        "positions".to_owned(),
        json!([paper_position(slice, fold, position, &as_of)]),
    );
    archive.insert(
        "historicalActionFills".to_owned(),
        Value::Array(
            fold.sessions
                .iter()
                .map(|session| action_fill_record(fold, session, position))
                .collect(),
        ),
    );
    archive.insert("dataRevisions".to_owned(), data_revisions(fold, position));
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
    value.insert(
        "instrumentLabel".to_owned(),
        json!(position.instrument_label),
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
    // 同時原話: U1, verbatim, and only because a sealed artifact exists.
    if let Some(utterance) = fold.utterances.first() {
        value.insert("concurrentClaim".to_owned(), utterance_value(utterance));
    }
    // 現在說法: U2, the rewritten reason, also verbatim.
    if let Some(utterance) = fold.utterances.get(1) {
        value.insert(
            "currentNarration".to_owned(),
            json!({
                "kind": "utterance",
                "utteranceArtifactId": uuid(&utterance.artifact_id),
                "canonicalTextSha256": utterance.canonical_text_sha256_hex,
                "canonicalTextUtf8": utterance.canonical_text_utf8,
            }),
        );
    }
    // No RelationshipDyad aggregate exists in a one-character slice, so no
    // influence can be evidenced. Empty, not guessed.
    value.insert(
        "influencedByCharacterRefs".to_owned(),
        Value::Array(Vec::new()),
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
    Value::Object(value)
}

fn action_fill_record(fold: &Fold, session: &FoldedSession, position: &FoldedPosition) -> Value {
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
        json!(if session.finality_accepted {
            "READY"
        } else {
            "HELD"
        }),
    );
    // The finality fence, made mechanical: until this trading day's
    // `MarketSessionFinalityAccepted` has landed, the disclosure key is not
    // serialized at all -- never present with nulled-out fields
    // (`docs/v5/market-safety.md` 當期交易時段不得公開).
    if session.finality_accepted {
        let mut disclosure = Map::new();
        disclosure.insert(
            "instrumentLabel".to_owned(),
            json!(position.instrument_label),
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
                })
            }),
        );
        disclosure.insert(
            "rationaleSummary".to_owned(),
            json!(daily_rationale_summary(session.session_index)),
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

fn data_revisions(fold: &Fold, position: &FoldedPosition) -> Value {
    let Some(correction) = fold.fact(CORRECTION_FACT_REVISION_ID) else {
        // No mirrored correction, so nothing to report. An empty list is the
        // honest answer; a placeholder note would not be.
        return Value::Array(Vec::new());
    };
    json!([{
        "revisionId": correction.fact_revision_id,
        "appliedAt": taipei_datetime(correction.available_at_unix_micros),
        "kind": "fact_correction",
        "affectedRefs": [uuid(&position.position_id)],
        "summary": format!(
            "{} 盤中發布的發行人更正公告。它在該時段的互動截止之後才出現，所以只是該時段的結果證據，下一個交易時段才進入他讀得到的範圍。",
            correction.market_date_taipei,
        ),
    }])
}

// -- copy tables ----------------------------------------------------------
//
// Engineering fixture copy for the slice, keyed by session index. Every
// sentence restates something a canonical event already recorded; none of it
// ranks, scores, or suggests an action.

fn scene_summary(session_index: usize) -> &'static str {
    match session_index {
        1 => "他整個早盤都在補前一天的公告附註，抬頭的時候那一段已經結束了。",
        2 => "十點四十二分，他先把同組同事的提醒滑掉，下單之後才回頭補看前一天的材料。",
        3 => "他把持股頁面開著，沒有動作，也沒有再打開那份同業存貨的資料。",
        4 => "他繞開同組同事的座位，把筆記標題改掉；支持資料一份也沒有增加。",
        5 => "他重看了那份同業存貨的資料，減碼四百股，然後主動走回同組同事的座位旁。",
        other => unreachable!("session {other} publishes no chapter"),
    }
}

fn action_summary(session_index: usize) -> &'static str {
    match session_index {
        1 => "沒有下單，也還沒有部位。他選擇繼續等。",
        2 => "模擬買進 PSZS-DEMO 1,000 股，成交價 100.00，名目金額 100,000 元；占模擬資產 10%，也是他自己寫下的曝險上限的 82%。",
        3 => "沒有下單。他繼續持有 1,000 股。",
        4 => "沒有下單。他把引用的理由從 thesis-hist-001 換成 thesis-hist-002，新增支持事實 0 筆。",
        5 => "模擬賣出 PSZS-DEMO 400 股，成交價 88.20，實現虧損 4,720 元；剩下 600 股仍在。",
        other => unreachable!("session {other} publishes no chapter"),
    }
}

fn open_question_summary(session_index: usize) -> &'static str {
    match session_index {
        1 => "他會怎麼處理這個他自己記下來的錯過？",
        2 => "他寫下的失效條件是兩個交易日內沒有新證據。兩個交易日之後呢？",
        3 => "他自己寫的期限在這個時段收盤到期了。他會改動作，還是改說法？",
        4 => "同一份反面資料已經第三次沒有被打開。他要到什麼時候才會讀它？",
        5 => "他還沒有說，為什麼撐了十五天。",
        other => unreachable!("session {other} publishes no chapter"),
    }
}

fn daily_rationale_summary(session_index: usize) -> &'static str {
    match session_index {
        1 => "沒有部位，也沒有下單意圖；他把注意力放在前一天的公告附註上。",
        2 => "預期兩個交易日內動能延續；失效條件是兩個交易日內沒有新證據。",
        3 => "理由未變，仍然是兩個交易日內動能延續；他沒有補上新的支持資料。",
        4 => "引用的理由改成長期治理價值；支持事實與建倉當時完全相同，新增 0 筆。",
        5 => "他寫下原本的理由已經不成立，並依此減碼。",
        other => unreachable!("session {other} has no accepted finality"),
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
        "fact-hist-001-momentum-s1" => "早盤那一段動能事實".to_owned(),
        "fact-hist-001-counter-inventory" => "同業存貨天數上升到 64.5 天的反面事實".to_owned(),
        CORRECTION_FACT_REVISION_ID => "發行人更正公告".to_owned(),
        other => fold.fact(other).map_or_else(
            || other.to_owned(),
            |fact| format!("{} 的封存收盤價", fact.market_date_taipei),
        ),
    }
}

// -- value helpers --------------------------------------------------------

fn utterance_value(utterance: &FoldedUtterance) -> Value {
    json!({
        "utteranceArtifactId": uuid(&utterance.artifact_id),
        "canonicalTextSha256": utterance.canonical_text_sha256_hex,
        "canonicalTextUtf8": utterance.canonical_text_utf8,
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
    let digits = (minor / 100).to_string();
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
        assert_eq!(documents.len(), 6);
        let mut paths: Vec<&str> = documents.iter().map(|(path, _)| path.as_str()).collect();
        paths.sort_unstable();
        paths.dedup();
        assert_eq!(paths.len(), 6);
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
