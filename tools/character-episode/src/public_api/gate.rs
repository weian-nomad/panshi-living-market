//! Applies a `ProjectionKillSwitch` to the folded read model.
//!
//! **The rule.** An object a kill switch withdraws must not be recoverable
//! from anything that stays public -- not its quantity, direction, date or
//! existence. Everything market-derived that depends on, quotes or
//! accumulates from it is withdrawn whole and a fixed system label stands in
//! its place. What is not market-derived keeps running
//! (`docs/v5/market-safety.md`: 關閉市場投影後，公共世界仍可運行生活、關係、記憶、
//! 合成歷史 fixture 和非方向性場景；不得因市場 gate 失敗回頭刪掉角色人生誌).
//!
//! **1. A world-level horizon.** Every switch is reduced to the earliest
//! market session in which the closed object appears **anywhere in the
//! world** (`world_horizon`): the session a closed fact became visible, the
//! first session carrying a fact about, or a paper action in, a closed
//! company, the closed session itself, the closed reveal day (whether or not
//! anything traded on it -- so the switch is no oracle for trading), the
//! first current-mode session, or -- for a missing or invalid set -- the
//! first session. The horizon is the same for every character: computing it
//! per character would mark, by who carries a closure label, which
//! characters ever touched the closed company.
//!
//! **2. Causal provenance, not wording.** `MarketProvenance` walks the
//! canonical log in order and marks every event that is market-derived: a
//! market or paper event by type, or an event whose payload cites a fact, a
//! security or a market-derived event, stream or artifact
//! (`docs/v5/system-design.md` causation is carried in those ids). An event
//! type this walker does not know, or an id it cannot resolve, counts as
//! market-derived (fail closed). The authored chassis (`crate::slice::seed`
//! anchors) and the origin it sealed are not market-derived.
//!
//! **3. What is withheld.** From the horizon on, every market-derived
//! object is withheld: chapters (their non-market segments, by the
//! segment's own sealed `source_refs`, stay readable on the held entry),
//! every view folded from the whole log ("today": paper figures, account,
//! stream versions, the close-up's current claims, the archive index's
//! summaries and highlights, the world's focus hint and story hooks -- none
//! of which carries provenance, so they fail closed), and every archive item
//! whose `sourceRefs` cite a market-derived event, or that has none. Items
//! whose provenance is the chassis alone -- the one-way observable actions,
//! the natal motif's readings, the memories he arrived with, his identity --
//! stay, on every page. A sealed sentence is visible exactly when its own
//! session is before the horizon, on every surface that quotes it.
//!
//! The log position (`sourceGlobalPosition`, `projectionVersion`) under a
//! horizon is the last position before it, and no visible object cites an
//! event from the horizon on, so no counter can be differenced to tell
//! whether a withheld session traded.

use std::collections::BTreeSet;

use serde_json::Value;

use panshi_protocol::{character, decode_canonical, story};

use super::{Fold, FoldedSegment, FoldedUtterance, kill_switch::ProjectionKillSwitch};
use crate::slice::{
    CharacterSlice, seed,
    sessions::{FACTS, ManifestModeDomain},
};

// -- causal provenance over the canonical log ------------------------------

/// Which canonical events (by 0-based log offset) are market-derived, and the
/// ids that make an event citing them market-derived.
#[derive(Clone, Debug)]
pub(super) struct MarketProvenance {
    market_event: Vec<bool>,
    market_ids: BTreeSet<Vec<u8>>,
    /// Ids known to be chassis: the character the origin sealed.
    chassis_ids: BTreeSet<Vec<u8>>,
    manifest_ids: BTreeSet<String>,
}

const MARKET_EVENT_TYPES: [&str; 4] = [
    "FactManifestAccepted",
    "FactBecameVisible",
    "FactCorrectionObserved",
    "MarketSessionFinalityAccepted",
];

fn decode_hex(text: &str) -> Option<Vec<u8>> {
    if !text.len().is_multiple_of(2) || !text.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    (0..text.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&text[index..index + 2], 16).ok())
        .collect()
}

impl MarketProvenance {
    #[allow(clippy::too_many_lines)]
    pub(super) fn compute(slice: &CharacterSlice) -> Self {
        let mut provenance = Self {
            market_event: Vec::with_capacity(slice.events.len()),
            market_ids: BTreeSet::new(),
            chassis_ids: BTreeSet::new(),
            manifest_ids: BTreeSet::new(),
        };
        for event in &slice.events {
            let bytes = event.payload_bytes.as_slice();
            let stream = event.stream_id.to_vec();
            // `(market, own ids to record when it is)`.
            let (market, own): (bool, Vec<Vec<u8>>) = match event.event_type {
                kind if MARKET_EVENT_TYPES.contains(&kind) => {
                    if kind == "FactManifestAccepted"
                        && let Ok(decoded) =
                            decode_canonical::<panshi_protocol::world::v1::FactManifestAcceptedV1>(bytes)
                    {
                        provenance.manifest_ids.insert(decoded.manifest_id);
                    }
                    (true, vec![stream])
                }
                kind if kind.starts_with("Paper") => (true, vec![stream]),
                "CharacterOriginSealed" => {
                    provenance.chassis_ids.insert(stream.clone());
                    (false, Vec::new())
                }
                "MemoryFormed" => match decode_canonical::<character::v1::MemoryFormedV1>(bytes) {
                    Ok(decoded) => (
                        decoded.source_event_ids.is_empty()
                            || decoded
                                .source_event_ids
                                .iter()
                                .any(|id| provenance.is_market_id(id)),
                        vec![decoded.memory_id],
                    ),
                    Err(_) => (true, Vec::new()),
                },
                "ObservedClueRegistered" => {
                    match decode_canonical::<character::v1::ObservedClueRegisteredV1>(bytes) {
                        Ok(decoded) => (
                            decoded.fact_ref.is_some() || provenance.is_market_id(&decoded.cognitive_episode_id),
                            vec![stream, decoded.cognitive_episode_id],
                        ),
                        Err(_) => (true, vec![stream]),
                    }
                }
                "CognitionInputSealed" => {
                    match decode_canonical::<character::v1::CognitionInputSealedV1>(bytes) {
                        Ok(decoded) => (
                            !decoded.interaction_fact_refs.is_empty()
                                || !decoded.paper_account_ref.is_empty()
                                || provenance.is_market_id(&decoded.cognitive_episode_id),
                            vec![stream],
                        ),
                        Err(_) => (true, vec![stream]),
                    }
                }
                "CoreAppraisalFallbackUsed" => {
                    match decode_canonical::<character::v1::CoreAppraisalFallbackUsedV1>(bytes) {
                        Ok(decoded) => (provenance.is_market_id(&decoded.cognitive_episode_id), vec![stream]),
                        Err(_) => (true, vec![stream]),
                    }
                }
                "AttentionCommitted" => {
                    match decode_canonical::<character::v1::AttentionCommittedV1>(bytes) {
                        Ok(decoded) => (
                            !decoded.selected_fact_revision_ids.is_empty()
                                || !decoded.missed_high_salience_fact_revision_ids.is_empty()
                                || provenance.is_market_id(&decoded.cognitive_episode_id),
                            vec![stream],
                        ),
                        Err(_) => (true, vec![stream]),
                    }
                }
                "AutonomousActionIntentCommitted" => {
                    match decode_canonical::<character::v1::AutonomousActionIntentCommittedV1>(bytes) {
                        Ok(decoded) => (
                            !decoded.security_id.is_empty()
                                || !decoded.perceived_fact_revision_ids.is_empty()
                                || !decoded.paper_account_ref.is_empty()
                                || provenance.is_market_id(&decoded.cognitive_episode_id),
                            vec![stream],
                        ),
                        Err(_) => (true, vec![stream]),
                    }
                }
                // Both seal a `CharacterStateAdvancedV1`; the stream is the
                // character's life stream, so only the triggers decide.
                "CharacterStateAdvanced" | "CommitmentRationaleSealed" => {
                    match decode_canonical::<character::v1::CharacterStateAdvancedV1>(bytes) {
                        Ok(decoded) => (
                            decoded.trigger_source_event_ids.iter().any(|hex| {
                                decode_hex(hex).is_none_or(|id| provenance.is_market_id(&id))
                            }),
                            Vec::new(),
                        ),
                        Err(_) => (true, Vec::new()),
                    }
                }
                "SemanticSpeechActCommitted" => {
                    match decode_canonical::<character::v1::SemanticSpeechActCommittedV1>(bytes) {
                        Ok(decoded) => (
                            !decoded.support_fact_revision_ids.is_empty()
                                || decoded.outcome_attribution.is_some()
                                || provenance.is_market_id(&decoded.cognitive_episode_id),
                            vec![stream, decoded.semantic_speech_act_id],
                        ),
                        Err(_) => (true, vec![stream]),
                    }
                }
                "PublicClaimMade" => match decode_canonical::<character::v1::UtteranceArtifactV1>(bytes) {
                    Ok(decoded) => (
                        !decoded.visible_fact_revision_ids.is_empty()
                            || provenance.is_market_id(&decoded.cognitive_episode_id)
                            || provenance.is_market_id(&decoded.semantic_speech_act_event_id),
                        vec![stream, decoded.utterance_artifact_id, decoded.semantic_speech_act_event_id],
                    ),
                    Err(_) => (true, vec![stream]),
                },
                "RelationshipSignalObserved" => {
                    match decode_canonical::<character::v1::RelationshipSignalObservedV1>(bytes) {
                        Ok(decoded) => (
                            provenance.is_market_id(&decoded.utterance_artifact_id)
                                || provenance.is_market_id(&decoded.public_claim_event_ref),
                            vec![decoded.relationship_signal_id],
                        ),
                        Err(_) => (true, Vec::new()),
                    }
                }
                "StoryChapterComposed" => match decode_canonical::<story::v1::StoryChapterComposedV1>(bytes) {
                    Ok(decoded) => {
                        let source = decoded.source_set.unwrap_or_default();
                        (
                            !source.market_fact_refs.is_empty()
                                || source.source_event_ids.iter().any(|id| provenance.is_market_id(id)),
                            vec![stream, decoded.chapter_id],
                        )
                    }
                    Err(_) => (true, vec![stream]),
                },
                "StoryChapterPublished" => match decode_canonical::<story::v1::StoryChapterPublishedV1>(bytes) {
                    Ok(decoded) => (provenance.is_market_id(&decoded.chapter_id), vec![stream]),
                    Err(_) => (true, vec![stream]),
                },
                // An event type this walker does not know: fail closed.
                _ => (true, vec![stream]),
            };
            if market {
                provenance.market_ids.extend(own);
            }
            provenance.market_event.push(market);
        }
        provenance
    }

    /// A cited id is market-derived unless it is a known chassis id; an id
    /// that resolves to nothing known fails closed.
    fn is_market_id(&self, id: &[u8]) -> bool {
        self.market_ids.contains(id) || !self.chassis_ids.contains(id)
    }

    /// Whether the event at a 1-based log position is market-derived; an
    /// unknown position fails closed.
    pub(super) fn event_at(&self, global_position: u64) -> bool {
        global_position
            .checked_sub(1)
            .and_then(|offset| usize::try_from(offset).ok())
            .and_then(|offset| self.market_event.get(offset))
            .copied()
            .unwrap_or(true)
    }

    /// Whether a sealed chapter segment is market-derived, by its own sealed
    /// `source_refs`: a chassis anchor (the natal motif) is not; a manifest,
    /// a market-derived id, or anything unresolvable is.
    pub(super) fn segment(&self, segment: &FoldedSegment) -> bool {
        segment.source_refs.is_empty()
            || segment.source_refs.iter().any(|reference| {
                if reference == seed::MOTIF_CONTROL_AND_RECOGNITION.motif_id {
                    false
                } else if self.manifest_ids.contains(reference) {
                    true
                } else {
                    decode_hex(reference).is_none_or(|id| self.is_market_id(&id))
                }
            })
    }

    /// Whether an emitted archive item is market-derived, by its own
    /// `sourceRefs`: any cited market-derived event makes it so, and so does
    /// citing nothing (unknown provenance fails closed). A chassis anchor is
    /// not market-derived.
    pub(super) fn item(&self, item: &Value) -> bool {
        let Some(refs) = item.get("sourceRefs").and_then(Value::as_array) else {
            return true;
        };
        refs.is_empty()
            || refs.iter().any(|reference| match reference["kind"].as_str() {
                Some("character_seed") => false,
                Some("canonical_event") => reference["globalPosition"].as_u64().is_none_or(|position| self.event_at(position)),
                _ => true,
            })
    }
}

// -- the world-level horizon -------------------------------------------------

/// The earliest session in the whole world in which a closed object appears.
fn world_horizon(switches: &ProjectionKillSwitch, fold: &Fold) -> Option<usize> {
    let first = fold.sessions.first().map(|session| session.session_index);
    if switches.withdraws_all_market() {
        return first;
    }
    let mut candidates: Vec<usize> = Vec::new();
    let instrument_of = |fact_revision_id: &str| {
        FACTS
            .iter()
            .find(|fact| fact.fact_revision_id == fact_revision_id)
            .map(|fact| fact.instrument_label)
    };
    let instrument_closed = |instrument: Option<&str>| {
        // A fact the fixture does not attribute counts as any closed company.
        instrument.map_or(!switches.closed_instruments.is_empty(), |instrument| {
            switches.closed_instruments.contains(instrument)
        })
    };
    for session in &fold.sessions {
        let index = session.session_index;
        if switches.closed_market_session_ids.contains(&session.market_session_id)
            || switches
                .closed_paper_action_reveal_dates
                .contains(&session.market_date_taipei)
            || (switches.current_market_closed() && session.mode_domain == ManifestModeDomain::Current)
        {
            candidates.push(index);
        }
        // A company appears in the world through a fact about it or a paper
        // action in it, by any character.
        if !session.intent_security_id.is_empty()
            && switches.closed_instruments.contains(&session.intent_security_id)
        {
            candidates.push(index);
        }
        if (session.fill.is_some() || !session.marks.is_empty())
            && fold
                .position
                .as_ref()
                .is_some_and(|position| switches.closed_instruments.contains(&position.instrument_label))
        {
            candidates.push(index);
        }
        // A price whose manifest the log does not mirror: provenance unknown.
        let unmirrored = session.fill.as_ref().is_some_and(|fill| fill.price_session_index.is_none())
            || session.marks.iter().any(|mark| mark.price_session_index.is_none());
        if unmirrored && switches.current_market_closed() {
            candidates.push(index);
        }
        // Facts this session references that never became visible in the
        // world: fail closed at this session.
        let referenced = session
            .selected_fact_revision_ids
            .iter()
            .chain(&session.missed_fact_revision_ids)
            .chain(&session.intent_perceived_fact_revision_ids);
        for fact in referenced {
            if fold.fact(fact).is_none()
                && (switches.closed_fact_revision_ids.contains(fact)
                    || switches.current_market_closed()
                    || instrument_closed(instrument_of(fact)))
            {
                candidates.push(index);
            }
        }
    }
    for fact in &fold.facts {
        if switches.closed_fact_revision_ids.contains(&fact.fact_revision_id)
            || (!switches.closed_instruments.is_empty() && instrument_closed(instrument_of(&fact.fact_revision_id)))
        {
            candidates.push(fact.session_index);
        }
    }
    // A sentence sealed outside every mirrored session has no established
    // provenance.
    if switches.current_market_closed() && fold.utterances.iter().any(|utterance| utterance.session_index.is_none()) {
        candidates.extend(first);
    }
    candidates.into_iter().min()
}

/// A kill-switch set, reduced to a world-level horizon and read against the
/// causal provenance of one log.
#[derive(Clone, Debug)]
pub(super) struct Gate<'a> {
    switches: &'a ProjectionKillSwitch,
    horizon: Option<usize>,
    /// The 1-based log position of the horizon session's first event.
    horizon_position: Option<u64>,
    provenance: MarketProvenance,
}

impl<'a> Gate<'a> {
    pub(super) fn new(switches: &'a ProjectionKillSwitch, slice: &CharacterSlice, fold: &Fold) -> Self {
        let horizon = world_horizon(switches, fold);
        let horizon_position = horizon
            .and_then(|index| fold.session(index))
            .map(|session| session.manifest_ref.global_position);
        Self {
            switches,
            horizon,
            horizon_position,
            provenance: MarketProvenance::compute(slice),
        }
    }

    pub(super) const fn switches(&self) -> &ProjectionKillSwitch {
        self.switches
    }

    /// The log position a response may report: the last position before
    /// the horizon, or the whole log when nothing is withheld.
    pub(super) fn reported_position(&self, log_length: u64) -> u64 {
        self.horizon_position.map_or(log_length, |position| position - 1)
    }

    /// Whether anything computed as of this session may be shown.
    pub(super) fn session_visible(&self, session_index: usize) -> bool {
        self.horizon.is_none_or(|horizon| session_index < horizon)
    }

    /// Whether a view computed as of today -- folded from the whole log --
    /// may be shown: only when no session is withheld at all.
    pub(super) const fn today_visible(&self) -> bool {
        self.horizon.is_none()
    }

    /// Whether a 今日五幕 act may be shown: not closed itself, and its label
    /// (a statement about today's scene, with no provenance) not withdrawn
    /// with the today layer.
    pub(super) fn story_act_visible(&self, hook_id: &str) -> bool {
        !self.switches.closed_story_act_ids.contains(hook_id) && self.today_visible()
    }

    /// One decision per sealed sentence, shared by every surface.
    pub(super) fn utterance_visible(&self, utterance: &FoldedUtterance) -> bool {
        utterance
            .session_index
            .map_or_else(|| self.today_visible(), |index| self.session_visible(index))
    }

    /// Whether an archive item pointing at these sessions may be shown:
    /// always before the horizon; from it on only if its own provenance is
    /// not market-derived and cites no event from the horizon on.
    pub(super) fn item_visible(&self, sessions: &[usize], item: &Value) -> bool {
        sessions.iter().all(|&index| self.session_visible(index))
            || (!self.provenance.item(item) && self.cites_nothing_after_horizon(item))
    }

    fn cites_nothing_after_horizon(&self, item: &Value) -> bool {
        let Some(horizon) = self.horizon_position else {
            return true;
        };
        item["sourceRefs"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|reference| reference["globalPosition"].as_u64())
            .all(|position| position < horizon)
    }

    /// Whether a sealed chapter segment is free of market provenance.
    pub(super) fn segment_is_non_market(&self, segment: &FoldedSegment) -> bool {
        !self.provenance.segment(segment)
    }
}
