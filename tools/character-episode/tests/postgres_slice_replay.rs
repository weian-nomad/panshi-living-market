//! The `PostgreSQL` leg of native／WASI／PostgreSQL byte parity for the
//! thirty-session one-character slice (`slice::one_character_slice()`), plus
//! idempotent resend and a from-zero rebuild of the public read model.
//!
//! `tools/verify-v5-kernel-parity.sh` proves native == WASI == the checked-in
//! `fixtures/v5/one-character-slice/events/`. This file proves the third
//! leg: every slice event is appended through the real canonical
//! `event_store.append_batch` (grouped into atomic commands by
//! `support::slice_command_plan`; every paper fill is one
//! `PaperOrder` + `PaperAccount` + `PaperPosition` transaction), read back, and
//! compared byte for byte with the natively computed payloads.
//!
//! What the from-zero rebuild does and does not cover, stated plainly: the
//! public read model (`public_api_documents`) is rebuilt from the canonical
//! event records read back from `PostgreSQL` -- event type, stream, schema
//! version and payload bytes all come from the database, and each payload
//! digest is re-derived from the database bytes. The slice's
//! `thesis_chain` and `bias_observations`, its session table and its stable
//! IDs are still taken from the in-memory `one_character_slice()`; they are
//! NOT re-derived from the database in this test. There is no persistent
//! projection table either: "rebuild from an empty projection database" is
//! proven by folding from scratch on every call, as in `postgres_replay.rs`.
//!
//! Requires `PANSHI_TEST_DATABASE_URL`; skipped without it, matching this
//! workspace's existing Postgres integration test convention. Run it (with
//! its own throwaway database) through `tools/run-postgres-integration-tests.sh`.

mod support;

use panshi_character_episode::{
    CanonicalEventRecord,
    public_api::public_api_documents,
    slice::{CharacterSlice, one_character_slice},
};
use panshi_event_store::{
    AppendError, AppendReceipt, AppendRequest, EventStore, PostgresEventStore,
};
use sha2::{Digest as _, Sha256};
use sqlx::{PgPool, Row};
use support::{
    CommandGroup, build_requests, connect_and_migrate, database_url_or_skip, logical_cell_for,
    slice_command_plan, uuid,
};

const COMMAND_OWNER: &str = "v5-one-character-slice";

struct Harness {
    pool: PgPool,
    store: PostgresEventStore,
    slice: CharacterSlice,
    plan: Vec<CommandGroup>,
    requests: Vec<AppendRequest>,
    logical_cell_id: [u8; 16],
}

async fn harness(scope: &str) -> Option<Harness> {
    let url = database_url_or_skip()?;
    let pool = connect_and_migrate(&url).await;
    let store = PostgresEventStore::new(pool.clone());
    let slice = one_character_slice();
    let plan = slice_command_plan(&slice);
    let logical_cell_id = logical_cell_for(scope);
    // `cargo test` runs these tests concurrently against one database, and
    // idempotency records are database-wide: each test owns its commands.
    let command_owner = format!("{COMMAND_OWNER}/{scope}");
    let requests = build_requests(&slice, &plan, logical_cell_id, &command_owner);
    Some(Harness {
        pool,
        store,
        slice,
        plan,
        requests,
        logical_cell_id,
    })
}

async fn append_all(store: &PostgresEventStore, requests: &[AppendRequest]) -> Vec<AppendReceipt> {
    let mut receipts = Vec::with_capacity(requests.len());
    for request in requests {
        let receipt = store
            .append(request.clone())
            .await
            .unwrap_or_else(|error| panic!("append {} failed: {error:?}", request.idempotency_key));
        receipts.push(receipt);
    }
    receipts
}

/// One canonical row as read back from `event_store.events`.
struct PersistedEvent {
    event_type: String,
    stream_type: String,
    stream_id: [u8; 16],
    schema_version: u32,
    command_id: [u8; 16],
    payload_bytes: Vec<u8>,
    payload_hash: Vec<u8>,
}

async fn read_back(pool: &PgPool, logical_cell_id: [u8; 16]) -> Vec<PersistedEvent> {
    sqlx::query(
        "SELECT event_type, stream_type, stream_id, schema_version, command_id, \
                payload_bytes, payload_hash \
         FROM event_store.events \
         WHERE logical_cell_id = $1 \
         ORDER BY global_position",
    )
    .bind(uuid(logical_cell_id))
    .fetch_all(pool)
    .await
    .expect("read back slice events")
    .into_iter()
    .map(|row| PersistedEvent {
        event_type: row.get("event_type"),
        stream_type: row.get("stream_type"),
        stream_id: *row.get::<uuid::Uuid, _>("stream_id").as_bytes(),
        schema_version: u32::try_from(row.get::<i32, _>("schema_version"))
            .expect("positive schema version"),
        command_id: *row.get::<uuid::Uuid, _>("command_id").as_bytes(),
        payload_bytes: row.get("payload_bytes"),
        payload_hash: row.get("payload_hash"),
    })
    .collect()
}

async fn count(pool: &PgPool, logical_cell_id: [u8; 16], event_type: Option<&str>) -> i64 {
    sqlx::query_scalar(
        "SELECT count(*) FROM event_store.events \
         WHERE logical_cell_id = $1 AND ($2::text IS NULL OR event_type = $2)",
    )
    .bind(uuid(logical_cell_id))
    .bind(event_type)
    .fetch_one(pool)
    .await
    .expect("count slice events")
}

/// A from-scratch fold of the cell's canonical log into one digest: stream
/// identity, stream version, event type, the database-computed payload hash
/// and the chained canonical event hash, in global order. Nothing carries
/// over between calls.
async fn projection_digest(pool: &PgPool, logical_cell_id: [u8; 16]) -> [u8; 32] {
    let rows = sqlx::query(
        "SELECT stream_type, stream_id, stream_version, event_type, payload_hash, event_hash \
         FROM event_store.events \
         WHERE logical_cell_id = $1 \
         ORDER BY global_position",
    )
    .bind(uuid(logical_cell_id))
    .fetch_all(pool)
    .await
    .expect("projection query");
    let mut hasher = Sha256::new();
    hasher.update(b"PSZS/V5_SLICE_TEST_PROJECTION_DIGEST/v1\0");
    for row in &rows {
        let stream_type: String = row.get("stream_type");
        let stream_id: uuid::Uuid = row.get("stream_id");
        let stream_version: i64 = row.get("stream_version");
        let event_type: String = row.get("event_type");
        let payload_hash: Vec<u8> = row.get("payload_hash");
        let event_hash: Vec<u8> = row.get("event_hash");
        hasher.update(stream_type.as_bytes());
        hasher.update([0]);
        hasher.update(stream_id.as_bytes());
        hasher.update(stream_version.to_be_bytes());
        hasher.update(event_type.as_bytes());
        hasher.update([0]);
        hasher.update(&payload_hash);
        hasher.update(&event_hash);
    }
    hasher.finalize().into()
}

/// Rebuilds canonical event records from database rows alone. The `&'static
/// str` fields are resolved against the natively known event and stream
/// type names; an unknown name fails closed instead of being invented. Each
/// payload digest is re-derived from the database bytes (never copied from
/// the native record), with the same domain tag the slice seals under.
fn records_from_database(
    rows: &[PersistedEvent],
    native: &CharacterSlice,
) -> Vec<CanonicalEventRecord> {
    let resolve = |name: &str, pick: fn(&CanonicalEventRecord) -> &'static str| -> &'static str {
        native
            .events
            .iter()
            .map(pick)
            .find(|known| *known == name)
            .unwrap_or_else(|| panic!("database returned an unknown name {name:?}"))
    };
    rows.iter()
        .map(|row| CanonicalEventRecord {
            event_type: resolve(&row.event_type, |record| record.event_type),
            stream_type: resolve(&row.stream_type, |record| record.stream_type),
            stream_id: row.stream_id,
            schema_version: row.schema_version,
            payload_bytes: row.payload_bytes.clone(),
            payload_digest: panshi_protocol::domain_digest(
                b"PSZS/V5_GOLDEN_EVENT_PAYLOAD/v1\0",
                &row.payload_bytes,
            ),
        })
        .collect()
}

fn documents_digest(documents: &[(String, String)]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    for (path, json) in documents {
        hasher.update(path.as_bytes());
        hasher.update([0]);
        hasher.update(json.as_bytes());
        hasher.update([0]);
    }
    hasher.finalize().into()
}

#[tokio::test]
async fn slice_replays_from_postgres_byte_identical() {
    let Some(h) = harness("byte-identical").await else {
        return;
    };
    let receipts = append_all(&h.store, &h.requests).await;
    assert!(
        receipts.iter().all(|receipt| !receipt.deduplicated),
        "a first append of the slice plan must not be served from the idempotency table"
    );

    let persisted = read_back(&h.pool, h.logical_cell_id).await;
    assert_eq!(
        persisted.len(),
        h.slice.events.len(),
        "every natively computed slice event must be persisted exactly once"
    );
    for (index, (row, native)) in persisted.iter().zip(&h.slice.events).enumerate() {
        assert_eq!(
            row.event_type, native.event_type,
            "event type diverged at slice index {index}"
        );
        assert_eq!(
            row.stream_type, native.stream_type,
            "stream type diverged at slice index {index}"
        );
        assert_eq!(
            row.stream_id, native.stream_id,
            "stream id diverged at slice index {index}"
        );
        assert_eq!(
            row.schema_version, native.schema_version,
            "schema version diverged at slice index {index}"
        );
        assert_eq!(
            row.payload_bytes, native.payload_bytes,
            "persisted bytes for slice index {index} ({}) diverged from the native canonical bytes",
            native.event_type
        );
        assert_eq!(
            row.payload_hash,
            Sha256::digest(&native.payload_bytes).to_vec(),
            "the database's own payload hash for slice index {index} must match the native bytes"
        );
    }

    // Each fill really landed as ONE command spanning the three streams.
    for group in h
        .plan
        .iter()
        .filter(|group| group.command_name == "ApplyPaperFill")
    {
        let rows: Vec<&PersistedEvent> = group
            .event_indices
            .iter()
            .map(|&index| &persisted[index])
            .collect();
        let command_ids: std::collections::HashSet<[u8; 16]> =
            rows.iter().map(|row| row.command_id).collect();
        let streams: std::collections::HashSet<&str> =
            rows.iter().map(|row| row.stream_type.as_str()).collect();
        assert_eq!(
            command_ids.len(),
            1,
            "{} must commit under one command",
            group.idempotency_key
        );
        assert_eq!(
            streams,
            ["PaperOrder", "PaperAccount", "PaperPosition"]
                .into_iter()
                .collect(),
            "{} must write the order, account and position streams together",
            group.idempotency_key
        );
    }
}

#[tokio::test]
async fn resending_slice_command_plan_does_not_duplicate_fills() {
    let Some(h) = harness("resend").await else {
        return;
    };
    let first_receipts = append_all(&h.store, &h.requests).await;
    let events_before = count(&h.pool, h.logical_cell_id, None).await;
    let fills_before = count(&h.pool, h.logical_cell_id, Some("PaperOrderFilled")).await;
    let projection_before = projection_digest(&h.pool, h.logical_cell_id).await;
    let native_fills = h
        .slice
        .events
        .iter()
        .filter(|event| event.event_type == "PaperOrderFilled")
        .count();
    assert_eq!(
        usize::try_from(events_before).unwrap(),
        h.slice.events.len()
    );
    assert_eq!(usize::try_from(fills_before).unwrap(), native_fills);
    assert!(
        fills_before > 0,
        "the slice must exercise at least one fill"
    );

    // Resend the entire plan: same owner, same keys, same digests.
    let second_receipts = append_all(&h.store, &h.requests).await;
    for (first, second) in first_receipts.iter().zip(&second_receipts) {
        assert!(
            second.deduplicated,
            "an exact resend must be answered from the idempotency record"
        );
        assert_eq!(first.command_id, second.command_id);
        assert_eq!(
            first.events, second.events,
            "a resend must return the original receipt, not new events"
        );
    }

    let events_after = count(&h.pool, h.logical_cell_id, None).await;
    let fills_after = count(&h.pool, h.logical_cell_id, Some("PaperOrderFilled")).await;
    let projection_after = projection_digest(&h.pool, h.logical_cell_id).await;
    assert_eq!(
        events_before, events_after,
        "resending the plan must not duplicate canonical events"
    );
    assert_eq!(
        fills_before, fills_after,
        "resending the plan must not duplicate paper fills"
    );
    assert_eq!(
        projection_before, projection_after,
        "resending the plan must not change the projection digest"
    );

    // The public read model rebuilt from the database is unchanged as well.
    let rows = read_back(&h.pool, h.logical_cell_id).await;
    let rebuilt = CharacterSlice {
        events: records_from_database(&rows, &h.slice),
        ..h.slice.clone()
    };
    assert_eq!(
        documents_digest(&public_api_documents(&rebuilt)),
        documents_digest(&public_api_documents(&h.slice)),
    );
}

#[tokio::test]
async fn conflicting_digest_same_idempotency_key_is_rejected() {
    let Some(h) = harness("conflicting-digest").await else {
        return;
    };
    // Commit every command up to and including the first fill, so the fill
    // itself is the command whose key gets reused.
    let first_fill = h
        .plan
        .iter()
        .position(|group| group.command_name == "ApplyPaperFill")
        .expect("the slice plan has a fill");
    append_all(&h.store, &h.requests[..=first_fill]).await;
    let committed_events = count(&h.pool, h.logical_cell_id, None).await;
    let committed_projection = projection_digest(&h.pool, h.logical_cell_id).await;

    // Same owner and idempotency key as the committed fill, but the content
    // of the NEXT command (so a different digest, different events).
    let original = &h.requests[first_fill];
    let next = &h.requests[first_fill + 1];
    assert_ne!(original.command_digest, next.command_digest);
    let conflicting = AppendRequest {
        command_id: original.command_id,
        command_owner: original.command_owner.clone(),
        idempotency_key: original.idempotency_key.clone(),
        command_digest: next.command_digest,
        preconditions: next.preconditions.clone(),
        events: next.events.clone(),
    };
    assert_eq!(
        h.store.append(conflicting).await,
        Err(AppendError::IdempotencyDigestConflict),
        "reusing an idempotency key for different content must be rejected"
    );

    // Nothing was written, and the original command still answers with its
    // original receipt.
    assert_eq!(
        count(&h.pool, h.logical_cell_id, None).await,
        committed_events
    );
    assert_eq!(
        projection_digest(&h.pool, h.logical_cell_id).await,
        committed_projection
    );
    let replay = h
        .store
        .append(original.clone())
        .await
        .expect("original resend");
    assert!(replay.deduplicated);
    assert_eq!(
        count(&h.pool, h.logical_cell_id, Some("PaperOrderFilled")).await,
        1
    );
}

#[tokio::test]
async fn public_api_rebuilt_from_postgres_bytes_matches_native() {
    let Some(h) = harness("public-api-rebuild").await else {
        return;
    };
    append_all(&h.store, &h.requests).await;
    let rows = read_back(&h.pool, h.logical_cell_id).await;
    let records = records_from_database(&rows, &h.slice);
    assert_eq!(records.len(), h.slice.events.len());
    for (index, (from_database, native)) in records.iter().zip(&h.slice.events).enumerate() {
        assert_eq!(
            from_database.payload_digest, native.payload_digest,
            "payload digest re-derived from database bytes diverged at slice index {index}"
        );
    }

    // Compared with the documents this same process computes natively --
    // not with the checked-in JSON fixtures, which another workstream may be
    // regenerating concurrently.
    let native_documents = public_api_documents(&h.slice);
    let rebuilt = CharacterSlice {
        events: records,
        ..one_character_slice()
    };
    let rebuilt_documents = public_api_documents(&rebuilt);
    assert!(
        !native_documents.is_empty(),
        "the public read model must not be empty"
    );
    assert_eq!(rebuilt_documents.len(), native_documents.len());
    for ((rebuilt_path, rebuilt_json), (native_path, native_json)) in
        rebuilt_documents.iter().zip(&native_documents)
    {
        assert_eq!(rebuilt_path, native_path);
        assert_eq!(
            rebuilt_json, native_json,
            "{native_path} rebuilt from PostgreSQL bytes diverged from the native document"
        );
    }
}
