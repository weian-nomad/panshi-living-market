//! The life journal's typed evidence layer: the evidence card, the readable
//! relationship consequence, the sealed narrative segments, the held-entry
//! shape, and the `sourceRefs` builders every archive section shares.
//!
//! The evidence card is the part of a chapter that must survive the rich
//! narrative failing (`docs/v5/system-design.md` "Story generation failure":
//! 發不含第一人稱補話的 typed evidence card；既有 artifact 仍逐字引用). So it
//! is built from canonical events only -- the committed intent, the fill, the
//! mark, the realized adjustment, the sealed utterance artifact, the memories
//! and the relationship signal -- and never from a composed segment. It
//! carries no first-person sentence at all: its only prose is a fixed action
//! label and a fixed empty-reason label.
//!
//! Engineering placeholder copy, 未經 copy-taste 審稿.

use serde_json::{Value, json};

use panshi_protocol::character;

use super::{
    EventRef, Fold, FoldedMemory, FoldedPosition, FoldedSegmentBody, FoldedSession, FoldedSignal,
    FoldedUtterance, minor_units, minor_units_fixed6, taipei_datetime, uuid,
};
use crate::slice::seed;

/// `sceneSummary` when a chapter's composed narrative is unavailable. It
/// describes the system, not him (`docs/v5/character-story-engine.md` 失敗處理:
/// 敘事模型失敗 → 顯示正式動作、時間、資料標籤及允許公開的逐字 artifact).
pub(super) const NARRATIVE_UNAVAILABLE_SCENE_LABEL: &str =
    "這一章的敘事沒有產生；下面是這一天的正式紀錄。";

/// The label a chapter held for visibility review carries.
pub(super) const HELD_REASON_LABEL: &str = "這一章暫時不公開，可見性確認之後才會出現。";

/// Why `influencedBy` is empty on this slice's position.
pub(super) const NO_SEALED_INFLUENCE_LABEL: &str =
    "沒有任何封存事件記錄別人影響過這個部位的決定；他在組會上的歸因是他自己的說法，記在關係頁。";

const RELATIONSHIP_NULL_REASON: &str = "這一天沒有留下關係訊號。";

const PAPER_OUTCOME_NULL_REASON: &str = "這一天他沒有部位，也沒有成交，所以沒有紙上後果。";

// -- sourceRefs -----------------------------------------------------------

/// A `sourceRefs` entry pointing at one canonical event, by type and global
/// log position (plus the stream it was appended to).
pub(super) fn event_source(event_ref: &EventRef) -> Value {
    json!({
        "kind": "canonical_event",
        "eventType": event_ref.event_type,
        "globalPosition": event_ref.global_position,
        "refId": uuid(&event_ref.stream_id),
    })
}

/// A `sourceRefs` entry pointing at the frozen character chassis in
/// `crate::slice::seed`, for a value no canonical event carries.
pub(super) fn seed_source(anchor: &str) -> Value {
    json!({
        "kind": "character_seed",
        "eventType": Value::Null,
        "globalPosition": Value::Null,
        "refId": format!("character-seed/v1#{anchor}"),
    })
}

/// The chassis anchor for an acquaintance node: its 1-based position in
/// `seed::ACQUAINTANCES`, never its raw canonical key.
pub(super) fn acquaintance_anchor(counterpart_ref: &str) -> String {
    let position = seed::ACQUAINTANCES
        .iter()
        .position(|node| node.acquaintance_id == counterpart_ref)
        .unwrap_or_else(|| panic!("no chassis acquaintance node for a sealed counterpart"));
    format!("acquaintance-{}", position + 1)
}

/// Display name and relationship label for a sealed counterpart ref.
///
/// # Panics
///
/// Panics on a counterpart the chassis does not carry. Printing the raw
/// canonical key instead, or guessing a name, is what this rule forbids
/// (`docs/v5/character-story-engine.md`: 關係或記憶引用缺失 → 不生成該因果).
pub(super) fn acquaintance_labels(counterpart_ref: &str) -> (&'static str, &'static str) {
    let node = seed::ACQUAINTANCES
        .iter()
        .find(|node| node.acquaintance_id == counterpart_ref)
        .unwrap_or_else(|| panic!("no chassis acquaintance node for a sealed counterpart"));
    let label = seed::ACQUAINTANCE_RELATION_LABELS
        .iter()
        .find(|(id, _)| *id == counterpart_ref)
        .map_or_else(
            || panic!("no relationship label for a sealed counterpart"),
            |(_, label)| *label,
        );
    (node.display_name, label)
}

/// The journal entry a settled session published, or `null`.
pub(super) fn journal_entry_ref(session: &FoldedSession) -> Value {
    session
        .chapter_id
        .as_ref()
        .map_or(Value::Null, |chapter_id| Value::String(uuid(chapter_id)))
}

/// The one sealed utterance artifact with this id.
///
/// # Panics
///
/// Panics when no such artifact was sealed: a reference to an artifact that
/// does not exist may not be rendered as a quote.
pub(super) fn utterance_by_id<'a>(fold: &'a Fold, artifact_id: &[u8]) -> &'a FoldedUtterance {
    fold.utterances
        .iter()
        .find(|utterance| utterance.artifact_id == artifact_id)
        .unwrap_or_else(|| panic!("reference to an unsealed utterance artifact"))
}

/// The artifact reference plus its canonical bytes, verbatim.
pub(super) fn artifact_value(utterance: &FoldedUtterance) -> Value {
    json!({
        "utteranceArtifactId": uuid(&utterance.artifact_id),
        "canonicalTextSha256": utterance.canonical_text_sha256_hex,
        "canonicalTextUtf8": utterance.canonical_text_utf8,
    })
}

fn surface_label(utterance: &FoldedUtterance) -> &'static str {
    if utterance.is_self_acknowledged() {
        "self_acknowledged"
    } else {
        "public_claim"
    }
}

/// Only these two visibilities may leave the canonical store, even as a
/// bare ref; `canonical_restricted` never does (`docs/v5/experience-spec.md`
/// §9: 正史限制資料不因付費或引介關係曝光).
pub(super) fn is_visible(memory: &FoldedMemory) -> bool {
    use character::v1::memory_formed_v1::Visibility;
    memory.visibility == Visibility::SubscriberArchive as i32
        || memory.visibility == Visibility::PublicEdition as i32
}

/// Every visible memory whose sealed sources include `signal`.
pub(super) fn memories_formed_from<'a>(
    fold: &'a Fold,
    signal: &FoldedSignal,
) -> Vec<&'a FoldedMemory> {
    fold.memories
        .iter()
        .filter(|memory| is_visible(memory))
        .filter(|memory| memory.source_event_ids.contains(&signal.signal_id))
        .collect()
}

/// Every visible memory the session sealed, in sealed order.
pub(super) fn session_memories<'a>(
    fold: &'a Fold,
    session: &FoldedSession,
) -> Vec<&'a FoldedMemory> {
    fold.memories
        .iter()
        .filter(|memory| is_visible(memory))
        .filter(|memory| memory.session_index == Some(session.session_index))
        .collect()
}

// -- held entry -----------------------------------------------------------

/// A chapter withheld from the public journal: identity, date, and one
/// fixed reason label (a visibility hold, or a kill switch). No content
/// field exists on this shape at all.
pub(super) fn held_entry(session: &FoldedSession, reason_label: &'static str) -> Value {
    json!({
        "entryId": uuid(
            session
                .chapter_id
                .as_ref()
                .expect("a settled session publishes a chapter"),
        ),
        "chapterDate": session.market_date_taipei,
        "entryVisibility": "HELD",
        "heldReasonLabel": reason_label,
    })
}

/// The sealed segments of a held chapter whose own provenance is not
/// market-derived (`Gate::segment_is_non_market`), verbatim, each citing its
/// own chassis source rather than the chapter event: the chapter event's log
/// position would count the withheld session's events.
pub(super) fn non_market_segments(session: &FoldedSession, gate: &super::Gate) -> Vec<Value> {
    session
        .segments
        .iter()
        .filter(|segment| gate.segment_is_non_market(segment))
        .filter_map(|segment| match &segment.body {
            FoldedSegmentBody::Narrator { truth_class, text } => Some(json!({
                "kind": "narrator",
                "segmentId": segment.segment_id,
                "text": text,
                "truthClass": truth_class,
                "sourceRefs": segment
                    .source_refs
                    .iter()
                    .map(|reference| {
                        assert_eq!(
                            reference,
                            seed::MOTIF_CONTROL_AND_RECOGNITION.motif_id,
                            "a non-market segment cites only the chassis motif"
                        );
                        seed_source("natal-motif")
                    })
                    .collect::<Vec<Value>>(),
            })),
            FoldedSegmentBody::Claim { .. } => None,
        })
        .collect()
}

// -- narrative segments ---------------------------------------------------

/// The segments the session's own `StoryChapterComposed` sealed, in sealed
/// order. A claim segment is resolved to its artifact's canonical bytes so
/// the reader sees the one sealed sentence, never a second copy.
pub(super) fn narrative_segments(fold: &Fold, session: &FoldedSession) -> Value {
    let chapter_ref = session
        .chapter_ref
        .as_ref()
        .expect("a composed chapter has a StoryChapterComposed event");
    Value::Array(
        session
            .segments
            .iter()
            .map(|segment| match &segment.body {
                FoldedSegmentBody::Narrator { truth_class, text } => json!({
                    "segmentId": segment.segment_id,
                    "kind": "narrator",
                    "truthClass": truth_class,
                    "text": text,
                    "sourceRefs": [event_source(chapter_ref)],
                }),
                FoldedSegmentBody::Claim {
                    artifact_id,
                    canonical_text_sha256_hex,
                } => {
                    let utterance = utterance_by_id(fold, artifact_id);
                    assert_eq!(
                        &utterance.canonical_text_sha256_hex, canonical_text_sha256_hex,
                        "a chapter claim segment cites a different hash than its artifact"
                    );
                    json!({
                        "segmentId": segment.segment_id,
                        "kind": "character_claim",
                        "truthClass": "simulated_narrative",
                        "utteranceArtifactId": uuid(&utterance.artifact_id),
                        "canonicalTextSha256": utterance.canonical_text_sha256_hex,
                        "canonicalTextUtf8": utterance.canonical_text_utf8,
                        "sourceRefs": [event_source(chapter_ref), event_source(&utterance.event_ref)],
                    })
                }
            })
            .collect(),
    )
}

// -- evidence card --------------------------------------------------------

/// A fixed, readable label for the committed intent. It names the action;
/// it says nothing about why.
fn action_display_label(action: i32) -> &'static str {
    use character::v1::ActionKind;
    if action == ActionKind::PaperBuy as i32 {
        "模擬買進"
    } else if action == ActionKind::PaperSell as i32 {
        "模擬賣出"
    } else if action == ActionKind::Wait as i32 {
        "等待，沒有下單"
    } else if action == ActionKind::ReadOrVerify as i32 {
        "重看資料，沒有下單"
    } else {
        "沒有下單"
    }
}

/// The typed consequence card of one chapter, from canonical events only.
pub(super) fn evidence_card(
    fold: &Fold,
    session: &FoldedSession,
    position: &FoldedPosition,
) -> Value {
    let intent_ref = session
        .intent_ref
        .as_ref()
        .expect("every session commits an action intent");

    let (paper_outcome, paper_outcome_null_reason) = paper_outcome(session, position);

    let quoted_utterances: Vec<Value> = session
        .utterance_index
        .and_then(|index| fold.utterances.get(index))
        .map(|utterance| {
            let mut value = artifact_value(utterance);
            let object = value.as_object_mut().expect("artifact value is an object");
            object.insert("surface".to_owned(), json!(surface_label(utterance)));
            object.insert("truthClass".to_owned(), json!("simulated_narrative"));
            object.insert(
                "sourceRefs".to_owned(),
                json!([event_source(&utterance.event_ref)]),
            );
            value
        })
        .into_iter()
        .collect();

    let memory_refs: Vec<Value> = session_memories(fold, session)
        .into_iter()
        .map(|memory| {
            json!({
                "memoryRef": uuid(&memory.memory_id),
                "truthClass": "simulated_narrative",
                "sourceRefs": [event_source(&memory.event_ref)],
            })
        })
        .collect();

    let relationship_refs: Vec<Value> = session
        .signal_index
        .and_then(|index| fold.signals.get(index))
        .map(|signal| {
            json!({
                "dyadRef": uuid(&signal.dyad_id),
                "relationshipSignalRef": uuid(&signal.signal_id),
                "truthClass": "simulated_narrative",
                "sourceRefs": [event_source(&signal.event_ref)],
            })
        })
        .into_iter()
        .collect();

    json!({
        "action": {
            "kind": super::action_kind_label(session.action),
            "label": action_display_label(session.action),
            "truthClass": "simulated_narrative",
            "sourceRefs": [event_source(intent_ref)],
        },
        "paperOutcome": paper_outcome,
        "paperOutcomeNullReason": paper_outcome_null_reason,
        "quotedUtterances": quoted_utterances,
        "memoryRefs": memory_refs,
        "relationshipRefs": relationship_refs,
    })
}

/// The session's paper consequence: what it filled, at what sealed price
/// and against which manifest, what it realized, what its last mark left
/// unrealized, and what it paid. `null` with a reason when the session had
/// neither a fill nor a mark.
fn paper_outcome(session: &FoldedSession, position: &FoldedPosition) -> (Value, Value) {
    let mark = session.last_mark();
    let fill = session.fill.as_ref();
    if fill.is_none() && mark.is_none() {
        return (Value::Null, json!(PAPER_OUTCOME_NULL_REASON));
    }
    // Dated by the price the figure was computed against: the mark's cited
    // close, or the fill's sealed price when the session has no mark.
    let as_of = mark.map_or_else(
        || {
            fill.expect("a session with no mark has a fill here")
                .filled_at_unix_micros
        },
        |mark| mark.price_observed_at_unix_micros,
    );
    let mut source_refs = Vec::new();
    if let Some(fill) = fill {
        source_refs.push(event_source(&fill.event_ref));
    }
    if let Some(adjustment) = &session.adjustment_ref {
        source_refs.push(event_source(adjustment));
    }
    if let Some(mark) = mark {
        source_refs.push(event_source(&mark.event_ref));
    }
    (
        json!({
            "positionRef": uuid(&position.position_id),
            "filledQuantityFixed6": fill.map(|fill| fill.filled_quantity_fixed),
            "sealedPriceMinorUnitsFixed6": fill.map(|fill| minor_units_fixed6(fill.sealed_price_fixed)),
            "fillPriceSourceRef": fill.map(|fill| fill.sealed_price_manifest_hash_hex.clone()),
            "markPriceSourceRef": mark.map(|mark| mark.price_manifest_hash_hex.clone()),
            "realizedPnlMinorUnits": minor_units(session.realized_pnl_delta_fixed),
            "unrealizedPnlMinorUnits": mark.map(|mark| minor_units(mark.unrealized_pnl_fixed)),
            "feeMinorUnits": fill.map_or(0, |fill| minor_units(fill.fee_fixed)),
            "taxMinorUnits": fill.map_or(0, |fill| minor_units(fill.tax_fixed)),
            "asOf": taipei_datetime(as_of),
            "truthClass": "simulated_narrative",
            "sourceRefs": source_refs,
        }),
        Value::Null,
    )
}

// -- relationship consequence ---------------------------------------------

/// The readable relationship consequence of one chapter, from its
/// `RelationshipSignalObserved`: who (by display name and relationship
/// label, never by raw key), what kind of signal, the sealed sentence that
/// caused it, and the memory it left. `null` with a reason otherwise.
pub(super) fn relationship_consequence(fold: &Fold, session: &FoldedSession) -> (Value, Value) {
    let Some(signal) = session
        .signal_index
        .and_then(|index| fold.signals.get(index))
    else {
        return (Value::Null, json!(RELATIONSHIP_NULL_REASON));
    };
    (signal_value(fold, signal), Value::Null)
}

/// One relationship signal, readable, with the session and journal entry it
/// belongs to.
pub(super) fn signal_value(fold: &Fold, signal: &FoldedSignal) -> Value {
    let (display_name, relation_label) = acquaintance_labels(&signal.counterpart_ref);
    let utterance = utterance_by_id(fold, &signal.utterance_artifact_id);
    assert_eq!(
        utterance.canonical_text_sha256_hex, signal.canonical_text_sha256_hex,
        "a relationship signal cites a different hash than its artifact"
    );
    assert!(
        signal.signal_kind
            == character::v1::RelationshipSignalKind::PublicOutcomeAttribution as i32,
        "this projection only knows how to describe a public outcome attribution"
    );
    let memories = memories_formed_from(fold, signal);
    let mut source_refs = vec![
        event_source(&signal.event_ref),
        event_source(&utterance.event_ref),
    ];
    source_refs.extend(
        memories
            .iter()
            .map(|memory| event_source(&memory.event_ref)),
    );

    let session = fold
        .sessions
        .iter()
        .find(|session| session.session_index == signal.session_index)
        .expect("a signal belongs to a session");
    json!({
        "dyadRef": uuid(&signal.dyad_id),
        "relationshipSignalRef": uuid(&signal.signal_id),
        "displayName": display_name,
        "relationLabel": relation_label,
        "signalKind": "public_outcome_attribution",
        "summary": format!(
            "他在公開場合把這個部位的虧損歸到{display_name}（{relation_label}）身上。這句話在他這一側的關係紀錄留下一筆訊號{}。",
            if memories.is_empty() { "" } else { "，也形成一則關係記憶" }
        ),
        "utterance": artifact_value(utterance),
        "consequenceMemoryRefs": memories
            .iter()
            .map(|memory| Value::String(uuid(&memory.memory_id)))
            .collect::<Vec<Value>>(),
        "observedAt": taipei_datetime(signal.observed_at_unix_micros),
        "sessionDate": session.market_date_taipei,
        "journalEntryRef": journal_entry_ref(session),
        "truthClass": "simulated_narrative",
        "sourceRefs": source_refs,
    })
}
