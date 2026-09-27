//! Prose never decides anything. The slice rendered with an alternate
//! wording (observable line, market line, motif line, sealed utterance text)
//! must carry byte-identical action, ledger, attention, state and sealed
//! cognition-input payloads; only narrative and spoken-text payloads may
//! differ, and they must actually differ, so the check cannot pass by
//! accident.

use panshi_character_episode::{
    CanonicalEventRecord,
    slice::{NarrationVariant, one_character_slice, one_character_slice_with_narration},
};

/// Every event type (or `*` prefix group) whose payload must not see prose.
const DECISION_PAYLOAD_GROUPS: [&str; 8] = [
    "AutonomousActionIntentCommitted",
    "PaperOrder*",
    "PaperAccountJournalPosted",
    "PaperPosition*",
    "PaperMarkApplied",
    "AttentionCommitted",
    "CharacterStateAdvanced",
    "CognitionInputSealed",
];

/// The only event types allowed to change with the wording: the chapter that
/// carries the narrator text, the sealed utterance, and the relationship
/// signal that cites the utterance's text hash.
const NARRATIVE_EVENT_TYPES: [&str; 3] = [
    "StoryChapterComposed",
    "PublicClaimMade",
    "RelationshipSignalObserved",
];

fn in_group(event_type: &str, group: &str) -> bool {
    group
        .strip_suffix('*')
        .map_or(event_type == group, |prefix| event_type.starts_with(prefix))
}

fn paired_events() -> Vec<(CanonicalEventRecord, CanonicalEventRecord)> {
    let canonical = one_character_slice_with_narration(NarrationVariant::Default).events;
    let alternate = one_character_slice_with_narration(NarrationVariant::Alternate).events;
    assert_eq!(
        canonical.len(),
        alternate.len(),
        "prose changed the event count"
    );
    canonical
        .into_iter()
        .zip(alternate)
        .map(|(left, right)| {
            assert_eq!(
                (left.event_type, left.stream_type, left.stream_id),
                (right.event_type, right.stream_type, right.stream_id),
                "prose changed the event sequence"
            );
            (left, right)
        })
        .collect()
}

#[test]
fn prose_variant_leaves_action_ledger_attention_state_payloads_byte_identical() {
    let pairs = paired_events();
    for group in DECISION_PAYLOAD_GROUPS {
        let mut compared = 0_usize;
        for (index, (canonical, alternate)) in pairs.iter().enumerate() {
            if !in_group(canonical.event_type, group) {
                continue;
            }
            compared += 1;
            assert_eq!(
                canonical.payload_bytes, alternate.payload_bytes,
                "event {index} ({}) payload changed with the prose",
                canonical.event_type
            );
            assert_eq!(canonical.payload_digest, alternate.payload_digest);
        }
        assert!(
            compared > 0,
            "the slice emitted no {group} event to compare"
        );
    }
}

#[test]
fn prose_variant_changes_only_narrative_payloads() {
    let pairs = paired_events();
    let mut changed_types: Vec<&str> = Vec::new();
    for (index, (canonical, alternate)) in pairs.iter().enumerate() {
        if canonical.payload_bytes == alternate.payload_bytes {
            continue;
        }
        assert!(
            NARRATIVE_EVENT_TYPES.contains(&canonical.event_type),
            "event {index} ({}) changed with the prose but is not a narrative payload",
            canonical.event_type
        );
        if !changed_types.contains(&canonical.event_type) {
            changed_types.push(canonical.event_type);
        }
    }
    // The variant really reached the narrator text and the spoken text, and
    // through the text hash, the one relationship signal that cites it.
    changed_types.sort_unstable();
    assert_eq!(
        changed_types,
        [
            "PublicClaimMade",
            "RelationshipSignalObserved",
            "StoryChapterComposed"
        ]
    );
    let changed_chapters = pairs
        .iter()
        .filter(|(canonical, alternate)| {
            canonical.event_type == "StoryChapterComposed"
                && canonical.payload_bytes != alternate.payload_bytes
        })
        .count();
    let chapters = pairs
        .iter()
        .filter(|(canonical, _)| canonical.event_type == "StoryChapterComposed")
        .count();
    assert_eq!(
        changed_chapters, chapters,
        "every chapter carries narrator prose"
    );
}

#[test]
fn default_narration_is_the_canonical_slice_byte_for_byte() {
    let canonical = one_character_slice();
    let default = one_character_slice_with_narration(NarrationVariant::default());
    assert_eq!(canonical, default);
}
