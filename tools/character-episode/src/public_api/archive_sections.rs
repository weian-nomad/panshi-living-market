//! The five deep-archive sections that sit beside `archive/paper`:
//! relations, chart, traits, memories and life
//! (`docs/v5/experience-spec.md` §9.5–§9.9).
//!
//! Same rules as the rest of the projection, plus the two this layer exists
//! to hold:
//!
//! - **Every item carries a `truthClass` and non-empty `sourceRefs`.** A
//!   source is either a canonical event (type + global log position) or a
//!   named anchor in the frozen chassis (`crate::slice::seed`). A value with
//!   neither is not rendered.
//! - **A missing fact is a typed absence with a reason**, never an invented
//!   filler: an empty list is paired with an `...EmptyReason` label, and a
//!   facet the chassis never sealed is listed as unrecorded rather than
//!   written.
//!
//! What each section deliberately does NOT carry: the relations page shows
//! no raw acquaintance key, no affection number and no line for 陳小雨 (she
//! has no sealed utterance); the chart shows no price, direction or
//! performance link; the traits page has no score, total or ranking -- a
//! fallible pattern is listed once per sealed occurrence, beside the
//! sessions that evidence it and the sessions that contradict it; the
//! memories page never lists a `canonical_restricted` memory, not even as a
//! count.
//!
//! Engineering placeholder copy, 未經 copy-taste 審稿.

use serde_json::{Map, Value, json};

use panshi_character_domain::bias::BiasKind;
use panshi_protocol::character;

use super::{
    ARCHIVE_SCOPE, Fold, FoldedMemory, FoldedSegmentBody, FoldedSession, OCCUPATION_LABEL,
    envelope, evidence, evidence::is_visible, taipei_datetime, uuid,
};
use crate::slice::{CharacterSlice, seed, sessions::FACT_COUNTER_INVENTORY};

/// Builds one section document by key.
///
/// # Panics
///
/// Panics on a key outside the five detail sections, or when the log does
/// not have the one-character shape this projection is written against.
pub(super) fn section_document(key: &str, slice: &CharacterSlice, fold: &Fold) -> Value {
    match key {
        "relations" => relations(slice, fold),
        "chart" => chart(slice, fold),
        "traits" => traits(slice, fold),
        "memories" => memories(slice, fold),
        "life" => life(slice, fold),
        other => unreachable!("unknown archive detail section {other}"),
    }
}

/// The envelope plus the fields every section page shares.
fn section_header(
    slice: &CharacterSlice,
    fold: &Fold,
    key: &str,
    truth_classes: &[&str],
) -> Map<String, Value> {
    let mut document = envelope(slice, fold, truth_classes);
    document.insert("characterId".to_owned(), json!(uuid(&fold.character_id)));
    document.insert("appliedAudienceScope".to_owned(), json!(ARCHIVE_SCOPE));
    document.insert("sectionKey".to_owned(), json!(key));
    document.insert(
        "asOf".to_owned(),
        json!(taipei_datetime(
            fold.current_mark().price_observed_at_unix_micros
        )),
    );
    document
}

fn session_at(fold: &Fold, session_index: usize) -> &FoldedSession {
    fold.sessions
        .iter()
        .find(|session| session.session_index == session_index)
        .unwrap_or_else(|| panic!("no session {session_index} in the log"))
}

/// `{sessionDate, journalEntryRef}` for one session.
fn session_pointer(session: &FoldedSession) -> Value {
    json!({
        "sessionDate": session.market_date_taipei,
        "journalEntryRef": evidence::journal_entry_ref(session),
    })
}

fn empty_reason(items: &[Value], reason: &str) -> Value {
    if items.is_empty() {
        json!(reason)
    } else {
        Value::Null
    }
}

// -- relations ------------------------------------------------------------

fn relations(slice: &CharacterSlice, fold: &Fold) -> Value {
    let mut document = section_header(
        slice,
        fold,
        "relations",
        &["fictional_setting", "simulated_narrative"],
    );
    let acquaintances: Vec<Value> = seed::ACQUAINTANCES
        .iter()
        .map(|node| {
            let anchor = evidence::acquaintance_anchor(node.acquaintance_id);
            let (display_name, relation_label) =
                evidence::acquaintance_labels(node.acquaintance_id);

            // One-way and observable: what he did around her, never what she
            // did, said or felt.
            let observed: Vec<Value> = node
                .observable_actions
                .iter()
                .enumerate()
                .map(|(position, (session_index, action))| {
                    let session = session_at(fold, *session_index);
                    let mut source_refs =
                        vec![evidence::seed_source(&format!("{anchor}/observable-actions/{}", position + 1))];
                    if let Some(chapter_ref) = &session.chapter_ref {
                        source_refs.push(evidence::event_source(chapter_ref));
                    }
                    json!({
                        "sessionDate": session.market_date_taipei,
                        "journalEntryRef": evidence::journal_entry_ref(session),
                        "observableAction": action,
                        "direction": "one_way_observed",
                        "truthClass": "fictional_setting",
                        "sourceRefs": source_refs,
                    })
                })
                .collect();

            let signals: Vec<Value> = fold
                .signals
                .iter()
                .filter(|signal| signal.counterpart_ref == node.acquaintance_id)
                .map(|signal| evidence::signal_value(fold, signal))
                .collect();

            json!({
                "dyadRef": uuid(&slice.ids.relationship_dyad_id),
                "displayName": display_name,
                "relationLabel": relation_label,
                "relationNote": node.relation_note,
                "truthClass": "fictional_setting",
                "sourceRefs": [evidence::seed_source(&anchor)],
                "observedInteractions": observed,
                "observedInteractionsEmptyReason":
                    empty_reason(&observed, "沒有封存任何他和她之間的可觀察互動。"),
                "relationshipSignals": signals,
                "relationshipSignalsEmptyReason":
                    empty_reason(&signals, "他沒有在公開場合留下任何指向她的關係訊號。"),
                // Everything on her side is unknown: she has no sealed
                // utterance and no state of her own in this slice.
                "counterpartAccount": {
                    "state": "unknown",
                    "reasonLabel": "她沒有被封存成角色，也沒有任何她自己的原話；她怎麼看這些事只能標未知。",
                    "truthClass": "fictional_setting",
                    "sourceRefs": [evidence::seed_source(&anchor)],
                },
            })
        })
        .collect();
    document.insert(
        "acquaintancesEmptyReason".to_owned(),
        empty_reason(&acquaintances, "人物底盤沒有任何熟人節點。"),
    );
    document.insert("acquaintances".to_owned(), Value::Array(acquaintances));
    Value::Object(document)
}

// -- chart ----------------------------------------------------------------

fn chart(slice: &CharacterSlice, fold: &Fold) -> Value {
    let mut document = section_header(
        slice,
        fold,
        "chart",
        &["fictional_setting", "symbolic_interpretation"],
    );
    let origin = fold
        .origin
        .as_ref()
        .expect("the slice seals a character origin");
    document.insert(
        "birthIdentity".to_owned(),
        json!({
            "birthDate": origin.birth_date,
            "birthRegionLabel": birth_region_label(&origin.birth_region),
            "truthClass": "fictional_setting",
            "sourceRefs": [evidence::event_source(&origin.event_ref)],
        }),
    );
    // The chassis seals one symbolic motif, not a computed chart. Placements
    // derived from the sealed birth data do not exist yet, so none are
    // written -- a hand-typed sign next to a sealed birth date would be an
    // unchecked claim.
    document.insert("placements".to_owned(), Value::Array(Vec::new()));
    document.insert(
        "placementsEmptyReason".to_owned(),
        json!("完整盤面還沒有由封存的出生資料計算；這一版人物底盤只封存了一個象徵主題，不另補星座位置。"),
    );

    let motif = seed::MOTIF_CONTROL_AND_RECOGNITION;
    let active_sessions: Vec<Value> = fold
        .sessions
        .iter()
        .filter(|session| session.evidence_cutoff_unix_micros <= motif.expires_at_unix_micros)
        .map(session_pointer)
        .collect();
    // 這些主題曾在哪些人生事件出現: the sessions whose own sealed chapter
    // carries a motif segment, quoted as sealed.
    let invocations: Vec<Value> = fold
        .sessions
        .iter()
        .filter_map(|session| {
            session.segments.iter().find_map(|segment| match &segment.body {
                FoldedSegmentBody::Narrator { truth_class, text }
                    if *truth_class == "symbolic_interpretation" =>
                {
                    Some(json!({
                        "sessionDate": session.market_date_taipei,
                        "journalEntryRef": evidence::journal_entry_ref(session),
                        "readingText": text,
                        "truthClass": "symbolic_interpretation",
                        "sourceRefs": [evidence::event_source(
                            session.chapter_ref.as_ref().expect("a segment belongs to a composed chapter"),
                        )],
                    }))
                }
                _ => None,
            })
        })
        .collect();
    let first_session = fold.sessions.first().expect("the slice has sessions");
    document.insert(
        "motifs".to_owned(),
        json!([{
            "motifLabel": motif.label,
            "effectScopeLabel": "只影響注意與解讀，不影響價格或績效。",
            "activeWindow": {
                "activeFrom": taipei_datetime(first_session.interaction_cutoff_unix_micros),
                "activeUntil": taipei_datetime(motif.expires_at_unix_micros),
            },
            "activeSessions": active_sessions,
            "invocations": invocations,
            "invocationsEmptyReason": empty_reason(&invocations, "沒有任何章節封存過這個主題的象徵解讀。"),
            "truthClass": "symbolic_interpretation",
            "sourceRefs": [evidence::seed_source("natal-motif")],
        }]),
    );
    Value::Object(document)
}

fn birth_region_label(birth_region: &str) -> String {
    match birth_region {
        "TW-synthetic" => "台灣（合成出生地，不對應任何真實個人）".to_owned(),
        other => panic!("no readable label for sealed birth region {other}"),
    }
}

// -- traits ---------------------------------------------------------------

/// `(axis key, low pole, high pole)` in `FourAxisPreference` field order
/// (`docs/v5/experience-spec.md` §9.7). A negative orientation leans to the
/// low pole.
const FOUR_AXES: [(&str, &str, &str); 4] = [
    ("social", "內省", "外顯"),
    ("information", "具體", "抽象"),
    ("decision", "關係", "分析"),
    ("closure", "彈性", "結構"),
];

fn bias_kind_key(kind: BiasKind) -> &'static str {
    match kind {
        BiasKind::FomoChase => "fomo_chase",
        BiasKind::ConfirmationBias => "confirmation_bias",
        BiasKind::SunkCostEscalation => "sunk_cost_escalation",
        BiasKind::RationalizationSwitch => "rationalization_switch",
        BiasKind::BlameShift => "blame_shift",
    }
}

fn bias_kind_label(kind: BiasKind) -> &'static str {
    match kind {
        BiasKind::FomoChase => "錯過之後追進去",
        BiasKind::ConfirmationBias => "反面資料在清單裡卻沒有打開",
        BiasKind::SunkCostEscalation => "過了自己寫的期限仍然持有",
        BiasKind::RationalizationSwitch => "換了理由，支持資料沒有增加",
        BiasKind::BlameShift => "公開把虧損歸到別人身上",
    }
}

fn traits(slice: &CharacterSlice, fold: &Fold) -> Value {
    let mut document = section_header(
        slice,
        fold,
        "traits",
        &["fictional_setting", "simulated_narrative"],
    );
    let origin = fold
        .origin
        .as_ref()
        .expect("the slice seals a character origin");

    let four_axis: Vec<Value> = FOUR_AXES
        .iter()
        .zip(origin.four_axis_bp)
        .map(|((axis_key, low, high), orientation_bp)| {
            let leaning = match orientation_bp.signum() {
                -1 => format!("偏{low}"),
                1 => format!("偏{high}"),
                _ => "兩端之間".to_owned(),
            };
            json!({
                "axisKey": axis_key,
                "lowPoleLabel": low,
                "highPoleLabel": high,
                "orientationBp": orientation_bp,
                "leaningLabel": leaning,
                "truthClass": "fictional_setting",
                "sourceRefs": [evidence::event_source(&origin.event_ref)],
            })
        })
        .collect();
    document.insert("fourAxis".to_owned(), Value::Array(four_axis));
    document.insert(
        "coreNeed".to_owned(),
        json!({
            "label": seed::CORE_NEED_LABEL,
            "truthClass": "fictional_setting",
            "sourceRefs": [evidence::seed_source("core-need")],
        }),
    );
    document.insert(
        "coreFear".to_owned(),
        json!({
            "label": seed::CORE_FEAR_LABEL,
            "truthClass": "fictional_setting",
            "sourceRefs": [evidence::seed_source("core-fear")],
        }),
    );
    document.insert(
        "bloodType".to_owned(),
        json!({
            "bloodType": seed::BLOOD_TYPE_CODE,
            "effectScopeLabel": "只影響自述與社交語氣，不當成能力判斷；對任何市場項都沒有作用。",
            "truthClass": "fictional_setting",
            "sourceRefs": [evidence::seed_source("blood-type")],
        }),
    );
    // 他怎麼形容自己: his sealed self-narrative memory, not a line for him.
    let self_narrative = fold
        .memories
        .iter()
        .filter(|memory| memory.session_index.is_none() && is_visible(memory))
        .find(|memory| memory.kind == character::v1::MemoryKind::SelfNarrative as i32)
        .expect("the chassis seals an origin self-narrative");
    document.insert(
        "selfDescription".to_owned(),
        json!({
            "label": chassis_memory(self_narrative).life_bible_note,
            "memoryRef": uuid(&self_narrative.memory_id),
            "truthClass": "fictional_setting",
            "sourceRefs": [evidence::event_source(&self_narrative.event_ref)],
        }),
    );

    let habits: Vec<Value> = seed::HABITS
        .iter()
        .map(|habit| {
            let sessions: Vec<&FoldedSession> = habit
                .evidence_session_indices
                .iter()
                .map(|index| session_at(fold, *index))
                .collect();
            let mut source_refs = vec![evidence::seed_source(&format!("habits/{}", habit.habit_id))];
            source_refs.extend(
                sessions
                    .iter()
                    .filter_map(|session| session.chapter_ref.as_ref())
                    .map(evidence::event_source),
            );
            json!({
                "label": habit.label,
                "evidenceSessions": sessions.iter().map(|session| session_pointer(session)).collect::<Vec<Value>>(),
                "truthClass": "fictional_setting",
                "sourceRefs": source_refs,
            })
        })
        .collect();
    document.insert("habits".to_owned(), Value::Array(habits));

    // One item per sealed occurrence. No count, total, score or ranking is
    // computed here; a reader sees each day and the days that evidence it.
    let occurrences: Vec<Value> = slice
        .bias_observations
        .iter()
        .map(|observation| {
            let session = session_at(fold, observation.session_index);
            let evidence_sessions: Vec<&FoldedSession> = observation
                .evidence_session_indices
                .iter()
                .map(|index| session_at(fold, *index))
                .collect();
            json!({
                "biasKind": bias_kind_key(observation.kind),
                "biasLabel": bias_kind_label(observation.kind),
                "sessionDate": session.market_date_taipei,
                "journalEntryRef": evidence::journal_entry_ref(session),
                "evidenceSessions": evidence_sessions.iter().map(|session| session_pointer(session)).collect::<Vec<Value>>(),
                "truthClass": "simulated_narrative",
                "sourceRefs": decision_refs(&evidence_sessions),
            })
        })
        .collect();
    document.insert(
        "biasOccurrencesEmptyReason".to_owned(),
        empty_reason(&occurrences, "這段期間沒有任何有事件證據的偏誤。"),
    );
    document.insert("biasOccurrences".to_owned(), Value::Array(occurrences));

    let counter_examples = counter_examples(slice, fold);
    document.insert(
        "counterExamplesEmptyReason".to_owned(),
        empty_reason(&counter_examples, "這段期間沒有可回看的反例。"),
    );
    document.insert("counterExamples".to_owned(), Value::Array(counter_examples));
    Value::Object(document)
}

/// The attention and intent events of each session -- where the selected
/// and missed facts and the committed action were sealed.
fn decision_refs(sessions: &[&FoldedSession]) -> Vec<Value> {
    sessions
        .iter()
        .flat_map(|session| [session.attention_ref, session.intent_ref])
        .flatten()
        .map(|event_ref| evidence::event_source(&event_ref))
        .collect()
}

/// 反例 (`docs/v5/experience-spec.md` §9.7: 頁面要保留這些反例): sessions where
/// a pattern he had shown did NOT happen, read off the same sealed state
/// that detects the pattern. Only patterns that were actually observed get
/// counter-examples, and only after their first occurrence.
fn counter_examples(slice: &CharacterSlice, fold: &Fold) -> Vec<Value> {
    let first_occurrence = |kind: BiasKind| {
        slice
            .bias_observations
            .iter()
            .filter(|observation| observation.kind == kind)
            .map(|observation| observation.session_index)
            .min()
    };
    let mut items = Vec::new();

    // He opened the counter-evidence he had been leaving closed.
    if let Some(first) = first_occurrence(BiasKind::ConfirmationBias) {
        for session in fold.sessions.iter().filter(|session| {
            session.session_index > first
                && session
                    .selected_fact_revision_ids
                    .iter()
                    .any(|fact| fact == FACT_COUNTER_INVENTORY)
        }) {
            items.push(counter_example(
                BiasKind::ConfirmationBias,
                session,
                "他打開了那份一直沒打開的反面資料。",
            ));
        }
    }
    // In public, about a loss, he named himself.
    if let Some(first) = first_occurrence(BiasKind::BlameShift) {
        for session in fold.sessions.iter().filter(|session| {
            session.session_index > first
                && session.outcome_attribution_kind
                    == Some(character::v1::OutcomeAttributionTargetKind::SelfOwn as i32)
        }) {
            items.push(counter_example(
                BiasKind::BlameShift,
                session,
                "被公開問到虧損時，他說是自己判斷錯了。",
            ));
        }
    }
    items
}

fn counter_example(kind: BiasKind, session: &FoldedSession, label: &str) -> Value {
    json!({
        "biasKind": bias_kind_key(kind),
        "sessionDate": session.market_date_taipei,
        "journalEntryRef": evidence::journal_entry_ref(session),
        "observedLabel": label,
        "truthClass": "simulated_narrative",
        "sourceRefs": decision_refs(&[session]),
    })
}

// -- memories -------------------------------------------------------------

fn visibility_label(memory: &FoldedMemory) -> &'static str {
    use character::v1::memory_formed_v1::Visibility;
    if memory.visibility == Visibility::PublicEdition as i32 {
        "public_edition"
    } else {
        "subscriber_archive"
    }
}

fn memory_kind(kind: i32) -> (&'static str, &'static str) {
    use character::v1::MemoryKind;
    if kind == MemoryKind::Episodic as i32 {
        ("episodic", "經歷")
    } else if kind == MemoryKind::Belief as i32 {
        ("belief", "信念")
    } else if kind == MemoryKind::Relationship as i32 {
        ("relationship", "關係")
    } else if kind == MemoryKind::SelfNarrative as i32 {
        ("self_narrative", "自我說法")
    } else {
        panic!("memory kind {kind} has no public label")
    }
}

/// The chassis entry a sealed memory was formed from, matched on its sealed
/// numeric shape.
///
/// # Panics
///
/// Panics unless exactly one chassis memory matches: a memory with no
/// chassis note, or an ambiguous one, would need an invented note.
fn chassis_memory(memory: &FoldedMemory) -> &'static seed::SeedMemory {
    let (kind_key, _) = memory_kind(memory.kind);
    let matches: Vec<&'static seed::SeedMemory> = seed::SEALED_MEMORIES
        .iter()
        .filter(|candidate| {
            memory_kind_key(candidate.kind) == kind_key
                && candidate.salience_bp == memory.salience_bp
                && candidate.confidence_bp == memory.confidence_bp
                && candidate.valence_bp == memory.valence_bp
        })
        .collect();
    assert!(
        matches.len() == 1,
        "a sealed memory must match exactly one chassis memory, matched {}",
        matches.len()
    );
    matches[0]
}

fn memory_kind_key(kind: panshi_character_domain::memory::MemoryKind) -> &'static str {
    use panshi_character_domain::memory::MemoryKind;
    match kind {
        MemoryKind::Episodic => "episodic",
        MemoryKind::Belief => "belief",
        MemoryKind::RelationshipMemory => "relationship",
        MemoryKind::SelfNarrative => "self_narrative",
    }
}

/// The canonical event a memory's sealed source id points at: a relationship
/// signal by its signal id, otherwise the first event appended to the
/// stream with that id. An id that resolves to nothing is dropped rather
/// than rendered as an unverifiable ref.
fn memory_source_refs(slice: &CharacterSlice, fold: &Fold, memory: &FoldedMemory) -> Vec<Value> {
    let mut refs = vec![evidence::event_source(&memory.event_ref)];
    for source_id in &memory.source_event_ids {
        if let Some(signal) = fold
            .signals
            .iter()
            .find(|signal| &signal.signal_id == source_id)
        {
            refs.push(evidence::event_source(&signal.event_ref));
            continue;
        }
        if let Some((offset, event)) = slice
            .events
            .iter()
            .enumerate()
            .find(|(_, event)| event.stream_id.as_slice() == source_id.as_slice())
        {
            refs.push(evidence::event_source(&super::EventRef {
                event_type: event.event_type,
                global_position: u64::try_from(offset + 1).expect("log position fits u64"),
                stream_id: event.stream_id,
            }));
        }
    }
    refs
}

fn memories(slice: &CharacterSlice, fold: &Fold) -> Value {
    let mut document = section_header(
        slice,
        fold,
        "memories",
        &["fictional_setting", "simulated_narrative"],
    );
    let items: Vec<Value> = fold
        .memories
        .iter()
        .filter(|memory| is_visible(memory))
        .map(|memory| {
            let chassis = chassis_memory(memory);
            let (kind_key, kind_label) = memory_kind(memory.kind);
            let session = memory.session_index.map(|index| session_at(fold, index));
            let involved: Vec<Value> = chassis
                .counterpart_ref
                .into_iter()
                .map(|counterpart_ref| {
                    let (display_name, relation_label) =
                        evidence::acquaintance_labels(counterpart_ref);
                    json!({ "displayName": display_name, "relationLabel": relation_label })
                })
                .collect();
            json!({
                "memoryRef": uuid(&memory.memory_id),
                "memoryKind": kind_key,
                "kindLabel": kind_label,
                "formedAt": taipei_datetime(memory.formed_at_unix_micros),
                "sessionDate": session.map(|session| session.market_date_taipei.clone()),
                "journalEntryRef": session.map_or(Value::Null, evidence::journal_entry_ref),
                "formedBeforeFirstSession": memory.session_index.is_none(),
                "note": chassis.life_bible_note,
                "involvedPeople": involved,
                "emotionalValence": match memory.valence_bp.signum() {
                    -1 => "negative",
                    1 => "positive",
                    _ => "neutral",
                },
                "confidenceBp": memory.confidence_bp,
                "visibility": visibility_label(memory),
                // No reinterpretation event exists in this slice, so every
                // memory is still the version it was formed as.
                "reinterpretations": Value::Array(Vec::new()),
                "reinterpretationsEmptyReason": "沒有封存任何重新解讀；這則記憶還是形成時的版本。",
                // The backstory he arrived with is authored chassis; what he
                // came to remember in the world is part of the simulated life.
                "truthClass": if memory.session_index.is_none() {
                    "fictional_setting"
                } else {
                    "simulated_narrative"
                },
                "sourceRefs": memory_source_refs(slice, fold, memory),
            })
        })
        .collect();
    document.insert(
        "memoriesEmptyReason".to_owned(),
        empty_reason(&items, "沒有任何可公開到這個檔案的已封存記憶。"),
    );
    document.insert("memories".to_owned(), Value::Array(items));
    Value::Object(document)
}

// -- life -----------------------------------------------------------------

fn life(slice: &CharacterSlice, fold: &Fold) -> Value {
    let mut document = section_header(
        slice,
        fold,
        "life",
        &["fictional_setting", "simulated_narrative"],
    );
    let origin = fold
        .origin
        .as_ref()
        .expect("the slice seals a character origin");
    document.insert(
        "identity".to_owned(),
        json!({
            "displayName": seed::DISPLAY_NAME,
            "ageYears": seed::AGE_YEARS,
            "occupationLabel": OCCUPATION_LABEL,
            "birthDate": origin.birth_date,
            "birthRegionLabel": birth_region_label(&origin.birth_region),
            "adultFictionalResident": true,
            "truthClass": "fictional_setting",
            "sourceRefs": [
                evidence::event_source(&origin.event_ref),
                evidence::seed_source("identity"),
            ],
        }),
    );

    let origin_memories: Vec<&FoldedMemory> = fold
        .memories
        .iter()
        .filter(|memory| memory.session_index.is_none() && is_visible(memory))
        .collect();
    let milestones: Vec<Value> = seed::LIFE_MILESTONES
        .iter()
        .map(|milestone| {
            let memory = milestone.memory_tag.and_then(|tag| {
                origin_memories
                    .iter()
                    .find(|memory| chassis_memory(memory).tag == tag)
            });
            let mut source_refs = vec![evidence::seed_source(&format!(
                "life-milestones/{}",
                milestone.milestone_id
            ))];
            if let Some(memory) = memory {
                source_refs.push(evidence::event_source(&memory.event_ref));
            }
            json!({
                "ageYears": milestone.age_years,
                "label": milestone.label,
                "memoryRef": memory.map_or(Value::Null, |memory| Value::String(uuid(&memory.memory_id))),
                "truthClass": "fictional_setting",
                "sourceRefs": source_refs,
            })
        })
        .collect();
    document.insert("milestones".to_owned(), Value::Array(milestones));

    document.insert(
        "originMemories".to_owned(),
        Value::Array(
            origin_memories
                .iter()
                .map(|memory| {
                    json!({
                        "memoryRef": uuid(&memory.memory_id),
                        "note": chassis_memory(memory).life_bible_note,
                        "formedAt": taipei_datetime(memory.formed_at_unix_micros),
                        "truthClass": "fictional_setting",
                        "sourceRefs": [evidence::event_source(&memory.event_ref)],
                    })
                })
                .collect(),
        ),
    );

    // Facets §9.9 asks for that the chassis never sealed. They are listed as
    // unrecorded, not written.
    document.insert(
        "unrecordedFacets".to_owned(),
        json!([
            {
                "facetKey": "family_structure",
                "reasonLabel": "人物底盤只封存了父親的印刷廠關掉這一件事，沒有封存完整的家庭結構。",
                "truthClass": "fictional_setting",
                "sourceRefs": [evidence::seed_source("identity")],
            },
            {
                "facetKey": "education",
                "reasonLabel": "人物底盤沒有封存教育經歷。",
                "truthClass": "fictional_setting",
                "sourceRefs": [evidence::seed_source("identity")],
            },
            {
                "facetKey": "financial_responsibility",
                "reasonLabel": "人物底盤沒有封存生活責任與經濟壓力的細節。",
                "truthClass": "fictional_setting",
                "sourceRefs": [evidence::seed_source("identity")],
            },
        ]),
    );

    document.insert(
        "joinedWorldOn".to_owned(),
        json!(
            fold.sessions
                .first()
                .expect("the slice has sessions")
                .market_date_taipei
        ),
    );
    document.insert(
        "chapterTimeline".to_owned(),
        Value::Array(
            fold.sessions
                .iter()
                .map(|session| {
                    let mut source_refs = vec![evidence::event_source(&session.manifest_ref)];
                    if let Some(chapter_ref) = &session.chapter_ref {
                        source_refs.push(evidence::event_source(chapter_ref));
                    }
                    json!({
                        "sessionDate": session.market_date_taipei,
                        "chapterState": if session.chapter_id.is_some() {
                            "published"
                        } else {
                            "in_session"
                        },
                        "journalEntryRef": evidence::journal_entry_ref(session),
                        "truthClass": "simulated_narrative",
                        "sourceRefs": source_refs,
                    })
                })
                .collect(),
        ),
    );
    Value::Object(document)
}
