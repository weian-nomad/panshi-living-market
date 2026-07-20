use panshi_event_store::{
    AppendError, AppendRequest, CommandRejection, CommandState, EventStore, ModeDomain, NewEvent,
    PostgresEventStore, StreamPrecondition,
};
use sqlx::postgres::PgPoolOptions;

fn request(command_id: u8, key: &str, expected_version: u64) -> AppendRequest {
    AppendRequest {
        command_id: [command_id; 16],
        command_owner: "round-desk".into(),
        idempotency_key: key.into(),
        command_digest: [command_id + 20; 32],
        preconditions: vec![StreamPrecondition {
            logical_cell_id: [3; 16],
            stream_type: "RoundDesk".into(),
            stream_id: [2; 16],
            expected_version,
            ownership_epoch: 4,
        }],
        events: vec![NewEvent {
            event_id: [command_id + 1; 16],
            event_type: "SeatPlanSaved".into(),
            schema_version: 1,
            stream_type: "RoundDesk".into(),
            stream_id: [2; 16],
            logical_cell_id: [3; 16],
            ownership_epoch: 4,
            mode_domain: ModeDomain::Historical,
            causation_id: [5; 16],
            correlation_id: [6; 16],
            trace_id: "trace-1".into(),
            actor_bytes: vec![7],
            occurred_at_unix_micros: 8,
            policy_revision: "policy/1".into(),
            model_revision: None,
            fact_revision: None,
            engine_artifact_digest: Some([9; 32]),
            rights_scope: "synthetic-fixture".into(),
            data_class: "fictional".into(),
            visibility_epoch: 10,
            payload_bytes: vec![11],
        }],
    }
}

#[tokio::test]
async fn append_is_atomic_idempotent_and_hash_chained() {
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
        .expect("apply canonical migration");
    let store = PostgresEventStore::new(pool.clone());

    let command = request(1, "save-1", 0);
    let first = store.append(command.clone()).await.expect("first append");
    assert!(!first.deduplicated);
    assert_eq!(first.events[0].stream_version, 1);

    let replay = store
        .append(command.clone())
        .await
        .expect("idempotent replay");
    assert!(replay.deduplicated);
    assert_eq!(replay.events, first.events);

    for (consumer, worker, whole_command) in [
        ("projection-v1", "projection-test", true),
        ("runner-v1", "runner-test", false),
    ] {
        let batch: serde_json::Value = sqlx::query_scalar(
            "SELECT batch FROM event_store.claim_outbox_batch_v1($1, $2, 30, $3, $4)",
        )
        .bind(consumer)
        .bind(worker)
        .bind(if whole_command {
            None::<&str>
        } else {
            Some("SeatPlanSaved")
        })
        .bind(whole_command)
        .fetch_one(&pool)
        .await
        .expect("consumer independently claims event");
        assert_eq!(batch["events"].as_array().map(Vec::len), Some(1));
        assert_eq!(batch["events"][0]["commandOrdinal"], 1);
        assert_eq!(batch["events"][0]["commandCount"], 1);

        sqlx::query(
            "SELECT event_store.complete_outbox_batch_v1( \
               $1, $2, $3::uuid[], 'APPLIED', $4::bytea, NULL)",
        )
        .bind(consumer)
        .bind(worker)
        .bind(vec![uuid::Uuid::from_bytes(first.events[0].event_id)])
        .bind(vec![31_u8; 32])
        .execute(&pool)
        .await
        .expect("complete owned consumer lease");
    }

    let projection_delivery_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM event_store.consumer_inbox WHERE delivery_state = 'APPLIED'",
    )
    .fetch_one(&pool)
    .await
    .expect("inspect independent deliveries");
    assert_eq!(projection_delivery_count, 2);

    let mut digest_conflict = command;
    digest_conflict.command_digest = [99; 32];
    assert_eq!(
        store.append(digest_conflict).await,
        Err(AppendError::IdempotencyDigestConflict)
    );
    let stale = request(3, "stale", 0);
    assert_eq!(
        store.append(stale.clone()).await,
        Err(AppendError::VersionConflict {
            stream_type: "RoundDesk".into(),
            stream_id: [2; 16],
            expected: 0,
            actual: 1,
        })
    );
    let pending = store
        .command(stale.command_id)
        .await
        .expect("read pending command")
        .expect("registered command");
    assert_eq!(pending.state, CommandState::Pending);
    assert!(pending.retryable);

    let rejected = store
        .reject_command(CommandRejection {
            command_id: stale.command_id,
            command_owner: stale.command_owner,
            request_hash: stale.command_digest,
            canonical_version: 1,
            reason_code: "VERSION_CONFLICT".into(),
        })
        .await
        .expect("freeze deterministic rejection");
    assert_eq!(rejected.state, CommandState::Rejected);
    assert_eq!(rejected.reason_code.as_deref(), Some("VERSION_CONFLICT"));
    assert!(!rejected.retryable);
    assert_eq!(rejected.canonical_version, Some(1));

    let terminal_mutation = sqlx::query(
        "UPDATE event_store.command_journal SET reason_code = 'CUTOFF_PASSED' \
         WHERE command_id = $1",
    )
    .bind(uuid::Uuid::from_bytes(stale.command_id))
    .execute(&pool)
    .await;
    assert!(terminal_mutation.is_err());

    let (events, outbox, version, hash_length, journals): (i64, i64, i64, i32, i64) = sqlx::query_as(
        "SELECT (SELECT count(*) FROM event_store.events), \
                (SELECT count(*) FROM event_store.outbox), \
                stream_version, octet_length(last_event_hash), \
                (SELECT count(*) FROM event_store.command_journal) \
         FROM event_store.stream_heads",
    )
    .fetch_one(&pool)
    .await
    .expect("inspect committed rows");
    assert_eq!((events, outbox, version, hash_length, journals), (1, 1, 1, 32, 2));

    sqlx::query("SET ROLE panshi_event_writer")
        .execute(&pool)
        .await
        .expect("assume application writer role");
    let direct_write = sqlx::query(
        "INSERT INTO event_store.stream_heads \
         (logical_cell_id, stream_type, stream_id, stream_version, ownership_epoch) \
         VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Bypass', \
                 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 0, 1)",
    )
    .execute(&pool)
    .await;
    assert!(direct_write.is_err());
    sqlx::query("RESET ROLE")
        .execute(&pool)
        .await
        .expect("restore migration role");
}
