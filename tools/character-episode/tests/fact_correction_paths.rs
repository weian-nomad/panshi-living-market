//! The two fact-correction paths of `docs/v5/system-design.md` §6.3 and
//! §9.3, exercised against the self-contained mini fixture in
//! `panshi_character_episode::correction` (never the golden episode or the
//! 30-session slice, whose bytes stay frozen).
//!
//! - Before seal: the unsealed input is rebuilt against the correcting
//!   manifest with a new digest; the old manifest and the old pack are
//!   refused by the episode itself.
//! - After seal: the sealed digest and the decision knowledge stay as they
//!   were; a later `FactCorrectionObserved` world event is appended; the
//!   next episode seals the corrected revision and the character learns it
//!   (`MemoryFormed` + `CharacterCorrectionLearned`). No earlier event is
//!   rewritten.

use panshi_character_domain::cognition::{
    CandidateFact, CognitiveEpisodeError, CognitiveEpisodeState, CorrectionRoute,
};
use panshi_character_episode::{
    CanonicalEventRecord,
    correction::{
        CORRECTED_FACT_REVISION_ID, CORRECTION_MANIFEST_ID, ORIGINAL_FACT_REVISION_ID,
        ORIGINAL_MANIFEST_ID, PostSealConfig, UNRELATED_FACT_REVISION_ID, cognition_input_digest,
        correction_after_seal, correction_before_seal, post_seal_scenario,
    },
};
use panshi_protocol::{character::v1 as character, world::v1 as world};
use prost::Message;

fn events_of<'a>(
    events: &'a [CanonicalEventRecord],
    event_type: &'a str,
) -> impl Iterator<Item = &'a CanonicalEventRecord> + 'a {
    events
        .iter()
        .filter(move |event| event.event_type == event_type)
}

fn decode<M: Message + Default>(record: &CanonicalEventRecord) -> M {
    M::decode(record.payload_bytes.as_slice()).expect("canonical payload decodes")
}

fn sealed_inputs(events: &[CanonicalEventRecord]) -> Vec<character::CognitionInputSealedV1> {
    events_of(events, "CognitionInputSealed")
        .map(decode)
        .collect()
}

fn sealed_revisions(sealed: &character::CognitionInputSealedV1) -> Vec<(&str, &str)> {
    sealed
        .interaction_fact_refs
        .iter()
        .map(|fact| {
            (
                fact.fact_manifest_id.as_str(),
                fact.fact_revision_id.as_str(),
            )
        })
        .collect()
}

#[test]
fn correction_before_seal_binds_new_manifest_and_rejects_old_pack() {
    let outcome = correction_before_seal();

    assert_eq!(outcome.route_on_arrival, CorrectionRoute::RebindBeforeSeal);
    assert_eq!(
        outcome.stale_manifest_rejection,
        Err(CognitiveEpisodeError::SupersededManifest),
        "the superseded manifest can no longer be sealed"
    );
    assert_eq!(
        outcome.stale_pack_rejection,
        Err(CognitiveEpisodeError::SupersededManifest),
        "the superseded revision is refused even under the new manifest id"
    );

    // The episode sealed exactly once, bound to the correcting manifest.
    let episode = &outcome.episode;
    assert_eq!(
        episode.bound_manifest_id.as_deref(),
        Some(CORRECTION_MANIFEST_ID)
    );
    assert_eq!(
        episode.sealed_fact_revision_ids,
        vec![CORRECTED_FACT_REVISION_ID.to_owned()]
    );
    assert_eq!(episode.state, CognitiveEpisodeState::AppraisalResolved);
    let expected_digest = cognition_input_digest(
        outcome.ids.first_episode_id,
        CORRECTION_MANIFEST_ID,
        &[CandidateFact {
            fact_revision_id: CORRECTED_FACT_REVISION_ID,
            available_at_unix_micros: 12_000,
        }],
    );
    assert_eq!(episode.input_digest, Some(expected_digest));
    assert_ne!(
        expected_digest, outcome.stale_pack_digest,
        "rebinding to the correcting manifest yields a new digest"
    );

    let sealed = sealed_inputs(&outcome.events);
    assert_eq!(sealed.len(), 1, "rejected seals emit nothing");
    assert_eq!(
        sealed_revisions(&sealed[0]),
        vec![(CORRECTION_MANIFEST_ID, CORRECTED_FACT_REVISION_ID)]
    );
    assert_eq!(sealed[0].input_digest, expected_digest.to_vec());

    // Before seal the correction goes into a new manifest, not a
    // FactCorrectionObserved, and nobody learns anything later.
    let manifests: Vec<world::FactManifestAcceptedV1> =
        events_of(&outcome.events, "FactManifestAccepted")
            .map(decode)
            .collect();
    assert_eq!(
        manifests
            .iter()
            .map(|manifest| manifest.manifest_id.as_str())
            .collect::<Vec<_>>(),
        vec![ORIGINAL_MANIFEST_ID, CORRECTION_MANIFEST_ID]
    );
    assert_eq!(
        events_of(&outcome.events, "FactCorrectionObserved").count(),
        0
    );
    assert_eq!(
        events_of(&outcome.events, "CharacterCorrectionLearned").count(),
        0
    );
}

#[test]
fn correction_after_seal_preserves_sealed_knowledge_and_emits_fact_correction_observed() {
    let main = correction_after_seal();
    let baseline = post_seal_scenario(PostSealConfig {
        correction_arrives: false,
        next_episode_sees_correction: true,
    });

    assert_eq!(
        main.route_on_arrival,
        Some(CorrectionRoute::ObserveAfterSeal)
    );
    assert_eq!(
        main.late_apply_rejection,
        Some(Err(CognitiveEpisodeError::WrongState)),
        "a late correction cannot be pushed into the sealed episode"
    );

    // What the character knew at seal time is exactly what he knew in the
    // world where the correction never came.
    assert_eq!(main.first_episode, baseline.first_episode);
    assert_eq!(
        main.first_episode.sealed_fact_revision_ids,
        vec![ORIGINAL_FACT_REVISION_ID.to_owned()]
    );
    let first_sealed = &sealed_inputs(&main.events)[0];
    assert_eq!(
        sealed_revisions(first_sealed),
        vec![(ORIGINAL_MANIFEST_ID, ORIGINAL_FACT_REVISION_ID)]
    );
    let decision: character::AutonomousActionIntentCommittedV1 = decode(
        events_of(&main.events, "AutonomousActionIntentCommitted")
            .next()
            .expect("first episode decided"),
    );
    assert_eq!(
        decision.perceived_fact_revision_ids,
        vec![ORIGINAL_FACT_REVISION_ID.to_owned()]
    );

    // Exactly one FactCorrectionObserved, appended after the sealed episode,
    // naming the episode whose sealed allowlist carried the old revision.
    let observed: Vec<(usize, &CanonicalEventRecord)> = main
        .events
        .iter()
        .enumerate()
        .filter(|(_, event)| event.event_type == "FactCorrectionObserved")
        .collect();
    assert_eq!(observed.len(), 1);
    let (position, record) = observed[0];
    assert!(position >= main.events_before_correction);
    assert_eq!(record.stream_type, "FactRevisionChain");
    let correction: world::FactCorrectionObservedV1 = decode(record);
    assert_eq!(
        correction.fact_correction_id,
        main.ids.fact_correction_id.to_vec()
    );
    assert_eq!(correction.original_manifest_id, ORIGINAL_MANIFEST_ID);
    assert_eq!(
        correction.original_fact_revision_id,
        ORIGINAL_FACT_REVISION_ID
    );
    assert_eq!(correction.correction_manifest_id, CORRECTION_MANIFEST_ID);
    assert_eq!(
        correction.corrected_fact_revision_id,
        CORRECTED_FACT_REVISION_ID
    );
    assert_eq!(
        correction.affected_cognitive_episode_ids,
        vec![main.ids.first_episode_id.to_vec()]
    );

    // Counterexample: without a correction there is no such event.
    assert_eq!(
        events_of(&baseline.events, "FactCorrectionObserved").count(),
        0
    );
}

#[test]
fn next_episode_after_post_seal_correction_sees_corrected_revision_and_learns() {
    let main = correction_after_seal();
    let next = main.next_episode.as_ref().expect("next episode ran");
    assert_eq!(
        next.sealed_fact_revision_ids,
        vec![CORRECTED_FACT_REVISION_ID.to_owned()]
    );
    let sealed = sealed_inputs(&main.events);
    assert_eq!(sealed.len(), 2);
    assert_eq!(
        sealed[1].cognitive_episode_id,
        main.ids.next_episode_id.to_vec()
    );
    assert_eq!(
        sealed_revisions(&sealed[1]),
        vec![(CORRECTION_MANIFEST_ID, CORRECTED_FACT_REVISION_ID)]
    );

    // The learning memory is formed first, then CharacterCorrectionLearned
    // references it, the correction and the learning episode.
    let position_of = |event_type: &str| {
        main.events
            .iter()
            .position(|event| event.event_type == event_type)
            .unwrap_or_else(|| panic!("{event_type} emitted"))
    };
    let observed_at = position_of("FactCorrectionObserved");
    let learned_at = position_of("CharacterCorrectionLearned");
    let memory_at = main
        .events
        .iter()
        .rposition(|event| event.event_type == "MemoryFormed")
        .expect("learning memory formed");
    assert!(observed_at < memory_at && memory_at < learned_at);
    assert_eq!(
        events_of(&main.events, "CharacterCorrectionLearned").count(),
        1
    );

    let memory: character::MemoryFormedV1 = decode(&main.events[memory_at]);
    assert_eq!(memory.memory_id, main.ids.learned_memory_id.to_vec());
    assert_eq!(memory.character_id, main.ids.character_id.to_vec());
    assert!(
        memory
            .source_event_ids
            .contains(&main.ids.fact_correction_id.to_vec())
    );

    let record = &main.events[learned_at];
    assert_eq!(record.stream_type, "CharacterLife");
    let learned: character::CharacterCorrectionLearnedV1 = decode(record);
    assert_eq!(learned.character_id, main.ids.character_id.to_vec());
    assert_eq!(
        learned.fact_correction_id,
        main.ids.fact_correction_id.to_vec()
    );
    assert_eq!(
        learned.cognitive_episode_id,
        main.ids.next_episode_id.to_vec()
    );
    assert_eq!(learned.memory_id, main.ids.learned_memory_id.to_vec());

    // Counterexample: a next episode whose manifest does not carry the
    // corrected revision learns nothing, even though the correction was
    // observed.
    let blind = post_seal_scenario(PostSealConfig {
        correction_arrives: true,
        next_episode_sees_correction: false,
    });
    let blind_next = blind.next_episode.as_ref().expect("next episode ran");
    assert_eq!(
        blind_next.sealed_fact_revision_ids,
        vec![UNRELATED_FACT_REVISION_ID.to_owned()]
    );
    assert_eq!(
        events_of(&blind.events, "FactCorrectionObserved").count(),
        1
    );
    assert_eq!(
        events_of(&blind.events, "CharacterCorrectionLearned").count(),
        0
    );
    assert_eq!(events_of(&blind.events, "MemoryFormed").count(), 0);
}

#[test]
fn post_seal_correction_never_rewrites_earlier_event_bytes() {
    let main = correction_after_seal();
    let baseline = post_seal_scenario(PostSealConfig {
        correction_arrives: false,
        next_episode_sees_correction: true,
    });
    let blind = post_seal_scenario(PostSealConfig {
        correction_arrives: true,
        next_episode_sees_correction: false,
    });

    assert_eq!(baseline.events.len(), main.events_before_correction);
    assert!(main.events.len() > main.events_before_correction);
    // Every event that existed before the correction is byte-identical,
    // position by position, to the world where no correction came.
    assert_eq!(
        &main.events[..main.events_before_correction],
        baseline.events.as_slice()
    );
    assert_eq!(
        &blind.events[..blind.events_before_correction],
        baseline.events.as_slice()
    );
    for (earlier, unchanged) in main.events.iter().zip(&baseline.events) {
        assert_eq!(earlier.payload_bytes, unchanged.payload_bytes);
        assert_eq!(earlier.payload_digest, unchanged.payload_digest);
    }

    // Nothing after the correction re-emits an event on the first episode's
    // stream: it is closed and stays as sealed.
    assert!(
        main.events[main.events_before_correction..]
            .iter()
            .all(|event| event.stream_id != main.ids.first_episode_id),
        "post-seal correction appends only; it never writes to the sealed episode"
    );

    // Deterministic: rebuilding yields the same bytes.
    assert_eq!(correction_after_seal().events, main.events);
    assert_eq!(
        correction_before_seal().events,
        correction_before_seal().events
    );
}
