//! V5 multi-stream atomic transaction proof, using `ModeDomain::Current` and
//! three distinct stream types (`PaperOrder`, `PaperAccount`,
//! `PaperPosition`) in a single `AppendRequest`, mirroring the
//! `ApplyPaperFill` atomic boundary in `docs/v5/system-design.md` §5.3: "同
//! 一 fill transaction 分別寫 `PaperOrder` lifecycle、`PaperAccount` 的
//! `PaperAccountJournalPosted` 及 `PaperPosition` lot／quantity／outcome
//! event；三者引用同一 fill ID、source price 與 transaction digest，任一
//! stream CAS 失敗就全部不提交."
//!
//! This test requires the same `PANSHI_TEST_DATABASE_URL` environment
//! variable as `postgres_vertical_slice.rs` and is skipped without it.

use panshi_event_store::{
    AppendError, AppendRequest, EventStore, ModeDomain, NewEvent, PostgresEventStore,
    StreamPrecondition,
};
use sqlx::postgres::PgPoolOptions;

fn precondition(logical_cell_id: [u8; 16], stream_type: &str, stream_id: [u8; 16]) -> StreamPrecondition {
    StreamPrecondition {
        logical_cell_id,
        stream_type: stream_type.into(),
        stream_id,
        expected_version: 0,
        ownership_epoch: 1,
    }
}

fn event(
    event_id: u8,
    logical_cell_id: [u8; 16],
    stream_type: &str,
    stream_id: [u8; 16],
    event_type: &str,
) -> NewEvent {
    NewEvent {
        event_id: [event_id; 16],
        event_type: event_type.into(),
        schema_version: 1,
        stream_type: stream_type.into(),
        stream_id,
        logical_cell_id,
        ownership_epoch: 1,
        mode_domain: ModeDomain::Current,
        causation_id: [50; 16],
        correlation_id: [51; 16],
        trace_id: "v5-fill-trace".into(),
        actor_bytes: vec![1],
        occurred_at_unix_micros: 1_000,
        policy_revision: "paper-ledger/v1".into(),
        model_revision: None,
        fact_revision: Some("fact-rev-1".into()),
        engine_artifact_digest: Some([9; 32]),
        rights_scope: "synthetic-fixture".into(),
        data_class: "fictional_canonical".into(),
        visibility_epoch: 1,
        payload_bytes: vec![event_id],
    }
}

#[tokio::test]
#[allow(clippy::too_many_lines)]
async fn apply_paper_fill_writes_three_streams_atomically() {
    let Some(url) = std::env::var("PANSHI_TEST_DATABASE_URL").ok() else {
        eprintln!("PANSHI_TEST_DATABASE_URL is unset; PostgreSQL integration test skipped");
        return;
    };
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(&url)
        .await
        .expect("connect test database");
    PostgresEventStore::migrate(&pool)
        .await
        .expect("apply canonical migrations including 0002_v5_mode_domain_current");
    let store = PostgresEventStore::new(pool.clone());

    let logical_cell_id = [7; 16];
    let paper_account_id = [10; 16];
    let paper_order_id = [11; 16];
    let paper_position_id = [12; 16];

    let request = AppendRequest {
        // `command_id` is globally unique in `event_store.command_dedup`
        // (docs/v5/system-design.md §5.1's UUIDv7 command IDs are unique by
        // construction in production); this fixture uses the 101/102 range
        // to avoid colliding with `postgres_vertical_slice.rs`'s [1;16]/
        // [2;16]/[3;16] fixtures when both tests share one scratch database.
        command_id: [101; 16],
        command_owner: "paper-ledger".into(),
        idempotency_key: "fill-1".into(),
        command_digest: [20; 32],
        preconditions: vec![
            precondition(logical_cell_id, "PaperOrder", paper_order_id),
            precondition(logical_cell_id, "PaperAccount", paper_account_id),
            precondition(logical_cell_id, "PaperPosition", paper_position_id),
        ],
        events: vec![
            event(
                101,
                logical_cell_id,
                "PaperOrder",
                paper_order_id,
                "PaperOrderFilled",
            ),
            event(
                102,
                logical_cell_id,
                "PaperAccount",
                paper_account_id,
                "PaperAccountJournalPosted",
            ),
            event(
                103,
                logical_cell_id,
                "PaperPosition",
                paper_position_id,
                "PaperPositionOpened",
            ),
        ],
    };

    let receipt = store.append(request.clone()).await.expect("atomic fill");
    assert!(!receipt.deduplicated);
    assert_eq!(receipt.events.len(), 3);
    for event_receipt in &receipt.events {
        assert_eq!(event_receipt.stream_version, 1);
    }

    // Idempotent replay returns the identical receipt, not a second fill.
    let replay = store.append(request.clone()).await.expect("idempotent replay");
    assert!(replay.deduplicated);
    assert_eq!(replay.events, receipt.events);

    // A second, distinct fill attempt whose PaperOrder precondition is stale
    // (still expects version 0, but the order stream is now at version 1)
    // must reject the WHOLE batch -- proving partial commits are impossible.
    let mut conflicting = request;
    conflicting.command_id = [102; 16];
    conflicting.idempotency_key = "fill-2".into();
    conflicting.command_digest = [21; 32];
    conflicting.events = conflicting
        .events
        .into_iter()
        .map(|mut evt| {
            evt.event_id[0] += 100;
            evt
        })
        .collect();
    // The append_batch SQL function validates preconditions in
    // logical_cell_id/stream_type/stream_id sort order (see
    // migrations/0001_canonical_event_store.sql's `ORDER BY` on the
    // preconditions loop), so of the three now-stale preconditions,
    // "PaperAccount" sorts first alphabetically and is the one reported --
    // the point of this assertion is that the WHOLE batch is rejected
    // (proven below by the unchanged row counts), not which specific stream
    // is named in the first error.
    let conflict_result = store.append(conflicting).await;
    assert_eq!(
        conflict_result,
        Err(AppendError::VersionConflict {
            stream_type: "PaperAccount".into(),
            stream_id: paper_account_id,
            expected: 0,
            actual: 1,
        })
    );

    // Confirm no partial write happened for PaperAccount/PaperPosition from
    // the rejected attempt: still exactly one row each, at version 1. Scoped
    // to this test's own `logical_cell_id` -- other Postgres integration
    // test files in this workspace (e.g. tools/character-episode's golden
    // episode) also write PaperOrder/PaperAccount/PaperPosition rows when
    // sharing one scratch database, and an unscoped count would wrongly
    // fail from that unrelated data, not from a real regression here.
    let (order_versions, account_versions, position_versions): (i64, i64, i64) = sqlx::query_as(
        "SELECT \
           (SELECT count(*) FROM event_store.events WHERE stream_type = 'PaperOrder' AND logical_cell_id = $1), \
           (SELECT count(*) FROM event_store.events WHERE stream_type = 'PaperAccount' AND logical_cell_id = $1), \
           (SELECT count(*) FROM event_store.events WHERE stream_type = 'PaperPosition' AND logical_cell_id = $1)",
    )
    .bind(uuid::Uuid::from_bytes(logical_cell_id))
    .fetch_one(&pool)
    .await
    .expect("inspect committed rows");
    assert_eq!((order_versions, account_versions, position_versions), (1, 1, 1));

    // The CURRENT mode_domain widened by migration 0002 is what these V5
    // rows actually persisted as.
    let mode_domains: Vec<(String,)> = sqlx::query_as(
        "SELECT DISTINCT mode_domain FROM event_store.events \
         WHERE stream_type IN ('PaperOrder', 'PaperAccount', 'PaperPosition') AND logical_cell_id = $1",
    )
    .bind(uuid::Uuid::from_bytes(logical_cell_id))
    .fetch_all(&pool)
    .await
    .expect("inspect mode_domain");
    assert_eq!(mode_domains, vec![("CURRENT".to_owned(),)]);
}
