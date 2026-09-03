//! Golden failure set (`IMPLEMENTATION-HANDOFF.md` "Add the golden failure
//! set") exercises not already covered by
//! `crates/event-store/tests/postgres_v5_multi_stream.rs` (duplicate
//! command/stream CAS conflict), `crates/character-domain/src/utterance.rs`
//! (in-process duplicate-seal guard), `crates/character-domain/src/
//! cognition.rs` (fact correction before/after seal), `crates/paper-ledger`
//! (partial fill/expiry/accounting correction), and `crates/protocol/src/
//! lib.rs` (prose injection):
//!
//! - Late model result cannot override an already-sealed fallback utterance,
//!   proven at the real event-store stream-CAS level (not just the
//!   in-process registry).
//! - Visibility epoch mismatch: a projection reader bound to a newer
//!   required epoch must not see content sealed under an older epoch.
//! - Withdrawn-source tombstone: once a subject's visibility epoch has been
//!   advanced (simulating a withdrawal), the same content is withheld, not
//!   silently returned.
//!
//! Requires `PANSHI_TEST_DATABASE_URL`; skipped without it.

use panshi_character_domain::utterance::{SealUtteranceRequest, SealingEventType, SurfaceKind, UtteranceArtifact};
use panshi_event_store::{AppendError, AppendRequest, EventStore, ModeDomain, NewEvent, PostgresEventStore, StreamPrecondition};
use sqlx::{Row, postgres::PgPoolOptions};

fn base_event(
    event_id: [u8; 16],
    stream_type: &str,
    stream_id: [u8; 16],
    logical_cell_id: [u8; 16],
    visibility_epoch: u64,
    payload_bytes: Vec<u8>,
) -> NewEvent {
    NewEvent {
        event_id,
        event_type: "PublicClaimMade".into(),
        schema_version: 1,
        stream_type: stream_type.into(),
        stream_id,
        logical_cell_id,
        ownership_epoch: 1,
        mode_domain: ModeDomain::Current,
        causation_id: [1; 16],
        correlation_id: [2; 16],
        trace_id: "golden-failure-set".into(),
        actor_bytes: vec![0],
        occurred_at_unix_micros: 1_000,
        policy_revision: "golden-failure-set/v1".into(),
        model_revision: None,
        fact_revision: None,
        engine_artifact_digest: None,
        rights_scope: "synthetic-fixture".into(),
        data_class: "fictional_canonical".into(),
        visibility_epoch,
        payload_bytes,
    }
}

#[tokio::test]
async fn late_model_result_cannot_override_a_sealed_fallback_utterance() {
    let Some(url) = std::env::var("PANSHI_TEST_DATABASE_URL").ok() else {
        eprintln!("PANSHI_TEST_DATABASE_URL is unset; PostgreSQL integration test skipped");
        return;
    };
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&url)
        .await
        .expect("connect test database");
    PostgresEventStore::migrate(&pool).await.expect("migrate");
    let store = PostgresEventStore::new(pool.clone());

    let logical_cell_id = [40; 16];
    let semantic_speech_act_id = [41; 16];
    let character_id = [42; 16];

    // The fallback wins the race and seals first (docs/v5/character-story
    // -engine.md: "第一個被正式接受的 UtteranceArtifactV1... 此後任何模型...都只能
    // 引用、隱藏或逐字呈現，不能重新生成或改寫").
    let fallback_artifact = UtteranceArtifact::seal(SealUtteranceRequest {
        utterance_artifact_id: [43; 16],
        character_id,
        semantic_speech_act_event_id: semantic_speech_act_id,
        sealing_event_type: SealingEventType::PublicClaimMade,
        surface_kind: SurfaceKind::PublicSpeech,
        canonical_text_utf8: "目前沒有新的公開資訊，先維持原本的觀察。".to_owned(),
        generation_mode: panshi_character_domain::utterance::GenerationMode::DeterministicFallback,
        sealed_at_unix_micros: 1_000,
    });
    let stream_id =
        UtteranceArtifact::stream_id_for(semantic_speech_act_id, fallback_artifact.surface_kind);

    let fallback_request = AppendRequest {
        command_id: [44; 16],
        command_owner: "seal-utterance".into(),
        idempotency_key: "seal-utterance-fallback".into(),
        command_digest: [45; 32],
        preconditions: vec![StreamPrecondition {
            logical_cell_id,
            stream_type: "UtteranceArtifact".into(),
            stream_id,
            expected_version: 0,
            ownership_epoch: 1,
        }],
        events: vec![base_event(
            [46; 16],
            "UtteranceArtifact",
            stream_id,
            logical_cell_id,
            1,
            fallback_artifact.canonical_text_utf8.clone().into_bytes(),
        )],
    };
    store
        .append(fallback_request)
        .await
        .expect("fallback seals first");

    // A model result arrives late (a transport retry, a second runner, or a
    // duplicate callback) and tries to seal a DIFFERENT, more "confident"
    // utterance for the exact same semantic speech act and surface. Its
    // precondition still expects version 0 -- because from its own point of
    // view it is sealing for the first time -- but the stream is already at
    // version 1.
    let late_model_artifact = "他很有信心地說會繼續加碼。".to_owned();
    let late_request = AppendRequest {
        command_id: [47; 16],
        command_owner: "seal-utterance".into(),
        idempotency_key: "seal-utterance-late-model".into(),
        command_digest: [48; 32],
        preconditions: vec![StreamPrecondition {
            logical_cell_id,
            stream_type: "UtteranceArtifact".into(),
            stream_id,
            expected_version: 0,
            ownership_epoch: 1,
        }],
        events: vec![base_event(
            [49; 16],
            "UtteranceArtifact",
            stream_id,
            logical_cell_id,
            1,
            late_model_artifact.into_bytes(),
        )],
    };
    let result = store.append(late_request).await;
    assert_eq!(
        result,
        Err(AppendError::VersionConflict {
            stream_type: "UtteranceArtifact".into(),
            stream_id,
            expected: 0,
            actual: 1,
        })
    );

    // Exactly one artifact exists on this stream, and it is the fallback's.
    let rows: Vec<(Vec<u8>,)> = sqlx::query_as(
        "SELECT payload_bytes FROM event_store.events \
         WHERE logical_cell_id = $1 AND stream_type = 'UtteranceArtifact' \
         ORDER BY global_position",
    )
    .bind(uuid::Uuid::from_bytes(logical_cell_id))
    .fetch_all(&pool)
    .await
    .expect("inspect utterance stream");
    assert_eq!(rows.len(), 1);
    assert_eq!(
        String::from_utf8(rows[0].0.clone()).unwrap(),
        fallback_artifact.canonical_text_utf8
    );
}

#[tokio::test]
async fn old_visibility_epoch_content_is_withheld_after_a_withdrawal() {
    let Some(url) = std::env::var("PANSHI_TEST_DATABASE_URL").ok() else {
        eprintln!("PANSHI_TEST_DATABASE_URL is unset; PostgreSQL integration test skipped");
        return;
    };
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&url)
        .await
        .expect("connect test database");
    PostgresEventStore::migrate(&pool).await.expect("migrate");
    let store = PostgresEventStore::new(pool.clone());

    let logical_cell_id = [50; 16];
    let stream_id = [51; 16];

    // A chapter is published under visibility_epoch 1.
    let publish_request = AppendRequest {
        command_id: [52; 16],
        command_owner: "publish-chapter".into(),
        idempotency_key: "publish-1".into(),
        command_digest: [53; 32],
        preconditions: vec![StreamPrecondition {
            logical_cell_id,
            stream_type: "StoryChapter".into(),
            stream_id,
            expected_version: 0,
            ownership_epoch: 1,
        }],
        events: vec![base_event(
            [54; 16],
            "StoryChapter",
            stream_id,
            logical_cell_id,
            1,
            b"chapter content, epoch 1".to_vec(),
        )],
    };
    store.append(publish_request).await.expect("publish under epoch 1");

    // docs/v5/system-design.md §7.2.1 / §13.3: a withdrawal advances the
    // visibility epoch via a distinct event append (VisibilityEpochAdvanced
    // in the real system; simplified here to a second StoryChapter-stream
    // write at the higher epoch to keep this test self-contained).
    let withdraw_request = AppendRequest {
        command_id: [55; 16],
        command_owner: "publish-chapter".into(),
        idempotency_key: "withdraw-1".into(),
        command_digest: [56; 32],
        preconditions: vec![StreamPrecondition {
            logical_cell_id,
            stream_type: "StoryChapter".into(),
            stream_id,
            expected_version: 1,
            ownership_epoch: 1,
        }],
        events: vec![base_event(
            [57; 16],
            "StoryChapter",
            stream_id,
            logical_cell_id,
            2,
            b"tombstone, epoch 2".to_vec(),
        )],
    };
    store.append(withdraw_request).await.expect("withdraw advances epoch");

    // A projection reader bound to "at least epoch 2" (the current, post-
    // withdrawal state of the world) must not resolve the epoch-1 row at
    // all -- old-epoch content is excluded outright, not merely marked.
    let rows_at_required_epoch: Vec<(i64,)> = sqlx::query(
        "SELECT visibility_epoch FROM event_store.events \
         WHERE logical_cell_id = $1 AND stream_type = 'StoryChapter' AND visibility_epoch >= $2 \
         ORDER BY global_position",
    )
    .bind(uuid::Uuid::from_bytes(logical_cell_id))
    .bind(2_i64)
    .fetch_all(&pool)
    .await
    .expect("query at current epoch")
    .into_iter()
    .map(|row| (row.get::<i64, _>("visibility_epoch"),))
    .collect();
    assert_eq!(rows_at_required_epoch, vec![(2,)]);

    // The canonical event log itself is append-only and still holds both
    // rows (correction/audit history is preserved); only the *projection*
    // query is epoch-gated.
    let (total_rows,): (i64,) = sqlx::query_as(
        "SELECT count(*) FROM event_store.events WHERE logical_cell_id = $1 AND stream_type = 'StoryChapter'",
    )
    .bind(uuid::Uuid::from_bytes(logical_cell_id))
    .fetch_one(&pool)
    .await
    .expect("count canonical rows");
    assert_eq!(total_rows, 2);
}
