//! Shared helpers for the one-character slice's `PostgreSQL` integration
//! tests (`postgres_slice_replay.rs`, `postgres_model_worker_permissions.rs`).
//!
//! Everything here is test scaffolding over the public
//! `panshi_character_episode::slice` output and the public
//! `panshi_event_store` port. It adds no production behavior: the slice's
//! canonical bytes are computed by `one_character_slice()` exactly as the
//! native and WASI builds compute them, and this module only decides how
//! those already-sealed events are grouped into atomic append commands.

// Each integration-test binary compiles its own copy of this module and uses
// a different subset of it.
#![allow(dead_code)]

use std::{
    collections::{HashMap, HashSet},
    io::Write as _,
};

use panshi_character_episode::{CanonicalEventRecord, derive_id, slice::CharacterSlice};
use panshi_event_store::{
    AppendRequest, ModeDomain, NewEvent, PostgresEventStore, StreamPrecondition,
};
use serde_json::{Value, json};
use sha2::{Digest as _, Sha256};
use sqlx::{PgPool, postgres::PgPoolOptions};

/// Returns the test database URL, or prints the workspace's standard
/// "skipped" line and returns `None` when it is unset.
///
/// The line is written straight to the process's stderr rather than through
/// `eprintln!`, which libtest captures and discards for a passing test: a
/// skip must stay visible in a plain `cargo test` run, never silent.
pub fn database_url_or_skip() -> Option<String> {
    let url = std::env::var("PANSHI_TEST_DATABASE_URL").ok();
    if url.is_none() {
        let _ = writeln!(
            std::io::stderr().lock(),
            "PANSHI_TEST_DATABASE_URL is unset; PostgreSQL integration test skipped"
        );
    }
    url
}

/// One connection, so session-level settings (`SET ROLE`) and the reads that
/// follow them are guaranteed to run on the same backend.
pub async fn connect_and_migrate(url: &str) -> PgPool {
    let pool = PgPoolOptions::new()
        .max_connections(1)
        .connect(url)
        .await
        .expect("connect test database");
    PostgresEventStore::migrate(&pool)
        .await
        .expect("apply canonical migrations");
    pool
}

/// Every test appends into its own logical cell. Stream heads, event IDs and
/// command IDs all derive from it, so tests in the same binary (which
/// `cargo test` runs concurrently against one database) never share a
/// stream head, an event ID or an idempotency record.
#[must_use]
pub fn logical_cell_for(scope: &str) -> [u8; 16] {
    derive_id(&format!("v5-slice-postgres-test/logical-cell/{scope}"))
}

/// The paper events that belong to the fill they follow
/// (`docs/v5/system-design.md` §5.3 `ApplyPaperFill`: `PaperOrder` lifecycle,
/// the `PaperAccount` journal, and the `PaperPosition` lot／quantity／outcome
/// event, all in one transaction).
const FILL_FOLLOWERS: [&str; 4] = [
    "PaperAccountJournalPosted",
    "PaperPositionOpened",
    "PaperPositionAdjusted",
    "PaperOutcomeRecognized",
];

/// One atomic append command over a contiguous run of slice events.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CommandGroup {
    pub command_name: &'static str,
    pub idempotency_key: String,
    /// Indices into `CharacterSlice::events`, in emission order.
    pub event_indices: Vec<usize>,
}

/// Groups the whole slice into atomic commands, in emission order:
///
/// - every `PaperOrderFilled` plus the account journal and position
///   events directly after it is one `ApplyPaperFill` command; the plan
///   refuses (panics) unless that group touches exactly the three streams
///   `PaperOrder`, `PaperAccount` and `PaperPosition`, with exactly one
///   journal posting;
/// - an `AutonomousActionIntentCommitted` immediately followed by its
///   `CommitmentRationaleSealed` is one command, as in `postgres_replay.rs`;
/// - every other event is its own single-event command.
///
/// Fails closed: the plan must cover every event exactly once, in order,
/// with unique idempotency keys.
#[must_use]
pub fn slice_command_plan(slice: &CharacterSlice) -> Vec<CommandGroup> {
    let events = &slice.events;
    let mut plan = Vec::new();
    let mut index = 0;
    while index < events.len() {
        let first = &events[index];
        let (command_name, end) = match first.event_type {
            "PaperOrderFilled" => {
                let mut end = index + 1;
                while end < events.len() && FILL_FOLLOWERS.contains(&events[end].event_type) {
                    end += 1;
                }
                ("ApplyPaperFill", end)
            }
            "AutonomousActionIntentCommitted"
                if events
                    .get(index + 1)
                    .is_some_and(|next| next.event_type == "CommitmentRationaleSealed") =>
            {
                ("CommitAutonomousPaperAction", index + 2)
            }
            other => (other, index + 1),
        };
        if command_name == "ApplyPaperFill" {
            assert_three_way_fill(&events[index..end], index);
        }
        plan.push(CommandGroup {
            command_name,
            idempotency_key: format!("v5-slice/{index:03}/{command_name}"),
            event_indices: (index..end).collect(),
        });
        index = end;
    }

    let covered: Vec<usize> = plan
        .iter()
        .flat_map(|group| group.event_indices.iter().copied())
        .collect();
    assert_eq!(
        covered,
        (0..events.len()).collect::<Vec<_>>(),
        "the command plan must cover every slice event exactly once, in emission order"
    );
    let keys: HashSet<&str> = plan
        .iter()
        .map(|group| group.idempotency_key.as_str())
        .collect();
    assert_eq!(keys.len(), plan.len(), "idempotency keys must be unique");
    let fills = events
        .iter()
        .filter(|event| event.event_type == "PaperOrderFilled")
        .count();
    let fill_groups = plan
        .iter()
        .filter(|group| group.command_name == "ApplyPaperFill")
        .count();
    assert!(fills > 0, "the slice must contain at least one paper fill");
    assert_eq!(
        fills, fill_groups,
        "every PaperOrderFilled must open its own ApplyPaperFill command"
    );
    plan
}

fn assert_three_way_fill(group: &[CanonicalEventRecord], first_index: usize) {
    let streams: HashSet<&str> = group.iter().map(|event| event.stream_type).collect();
    let expected: HashSet<&str> = ["PaperOrder", "PaperAccount", "PaperPosition"]
        .into_iter()
        .collect();
    assert_eq!(
        streams, expected,
        "fill at slice index {first_index} must write PaperOrder, PaperAccount and PaperPosition in one transaction"
    );
    let journals = group
        .iter()
        .filter(|event| event.event_type == "PaperAccountJournalPosted")
        .count();
    assert_eq!(
        journals, 1,
        "fill at slice index {first_index} must post exactly one journal entry"
    );
}

fn id_from(tag: &[u8], parts: &[&[u8]]) -> [u8; 16] {
    let mut hasher = Sha256::new();
    hasher.update(tag);
    for part in parts {
        hasher.update(
            u64::try_from(part.len())
                .expect("part length fits u64")
                .to_be_bytes(),
        );
        hasher.update(part);
    }
    let digest: [u8; 32] = hasher.finalize().into();
    let mut id = [0_u8; 16];
    id.copy_from_slice(&digest[..16]);
    id
}

/// The command digest covers what the command actually writes (the logical
/// cell, and every event's type, stream and payload bytes), not only its key
/// -- so the same key reused for different content, or for another cell, is
/// a digest conflict rather than a silent deduplication, and an exact resend
/// is not.
#[must_use]
pub fn command_digest(
    slice: &CharacterSlice,
    group: &CommandGroup,
    logical_cell_id: [u8; 16],
) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(b"PSZS/V5_SLICE_TEST_COMMAND_DIGEST/v1\0");
    hasher.update(logical_cell_id);
    hasher.update(group.command_name.as_bytes());
    hasher.update([0]);
    for &index in &group.event_indices {
        let event = &slice.events[index];
        hasher.update(event.event_type.as_bytes());
        hasher.update([0]);
        hasher.update(event.stream_type.as_bytes());
        hasher.update([0]);
        hasher.update(event.stream_id);
        hasher.update(Sha256::digest(&event.payload_bytes));
    }
    hasher.finalize().into()
}

/// Builds every append request for the plan, tracking each stream's
/// expected version so a request only succeeds after every earlier command
/// in the plan has been committed.
///
/// Idempotency records are keyed by (command owner, idempotency key) across
/// the whole database, so callers that append the same plan into several
/// logical cells concurrently must pass a distinct `command_owner` per cell.
#[must_use]
pub fn build_requests(
    slice: &CharacterSlice,
    plan: &[CommandGroup],
    logical_cell_id: [u8; 16],
    command_owner: &str,
) -> Vec<AppendRequest> {
    let mut next_version: HashMap<(&'static str, [u8; 16]), u64> = HashMap::new();
    plan.iter()
        .map(|group| {
            let mut preconditions: Vec<StreamPrecondition> = Vec::new();
            let mut events = Vec::new();
            for &index in &group.event_indices {
                let record = &slice.events[index];
                let key = (record.stream_type, record.stream_id);
                let version = next_version.entry(key).or_insert(0);
                // One precondition per stream in the batch, pinned at the
                // version the stream had before this command.
                if !preconditions.iter().any(|condition| {
                    condition.stream_type == record.stream_type
                        && condition.stream_id == record.stream_id
                }) {
                    preconditions.push(StreamPrecondition {
                        logical_cell_id,
                        stream_type: record.stream_type.into(),
                        stream_id: record.stream_id,
                        expected_version: *version,
                        ownership_epoch: 1,
                    });
                }
                *version += 1;
                events.push(new_event(record, index, logical_cell_id));
            }
            AppendRequest {
                command_id: id_from(
                    b"PSZS/V5_SLICE_TEST_COMMAND_ID/v1\0",
                    &[
                        &logical_cell_id,
                        command_owner.as_bytes(),
                        group.idempotency_key.as_bytes(),
                    ],
                ),
                command_owner: command_owner.into(),
                idempotency_key: group.idempotency_key.clone(),
                command_digest: command_digest(slice, group, logical_cell_id),
                preconditions,
                events,
            }
        })
        .collect()
}

fn new_event(record: &CanonicalEventRecord, index: usize, logical_cell_id: [u8; 16]) -> NewEvent {
    let index_bytes = u64::try_from(index)
        .expect("slice index fits u64")
        .to_be_bytes();
    NewEvent {
        event_id: id_from(
            b"PSZS/V5_SLICE_TEST_EVENT_ID/v1\0",
            &[&logical_cell_id, &index_bytes, record.event_type.as_bytes()],
        ),
        event_type: record.event_type.into(),
        schema_version: record.schema_version,
        stream_type: record.stream_type.into(),
        stream_id: record.stream_id,
        logical_cell_id,
        ownership_epoch: 1,
        mode_domain: ModeDomain::Current,
        causation_id: [1; 16],
        correlation_id: [2; 16],
        trace_id: "v5-one-character-slice".into(),
        actor_bytes: vec![0],
        occurred_at_unix_micros: i64::try_from(index).expect("slice index fits i64") * 1_000,
        policy_revision: "v5-one-character-slice/v1".into(),
        model_revision: None,
        fact_revision: Some("synthetic-historical-001".into()),
        engine_artifact_digest: Some(record.payload_digest),
        rights_scope: "synthetic-fixture".into(),
        data_class: "fictional_canonical".into(),
        visibility_epoch: 1,
        payload_bytes: record.payload_bytes.clone(),
    }
}

/// The exact `event_store.append_batch(jsonb)` wire request the
/// `PostgresEventStore` adapter sends (mirrors its private `request_json`),
/// for tests that must call the SQL function directly on one connection to
/// observe the raw SQLSTATE the adapter would otherwise fold into
/// `AppendError::Persistence`.
#[must_use]
pub fn append_batch_json(request: &AppendRequest) -> Value {
    json!({
        "commandId": uuid_text(request.command_id),
        "commandOwner": request.command_owner,
        "idempotencyKey": request.idempotency_key,
        "requestHashHex": hex(&request.command_digest),
        "preconditions": request.preconditions.iter().map(|condition| json!({
            "logicalCellId": uuid_text(condition.logical_cell_id),
            "streamType": condition.stream_type,
            "streamId": uuid_text(condition.stream_id),
            "expectedVersion": condition.expected_version,
            "ownershipEpoch": condition.ownership_epoch,
        })).collect::<Vec<_>>(),
        "events": request.events.iter().map(|event| json!({
            "eventId": uuid_text(event.event_id),
            "eventType": event.event_type,
            "schemaVersion": event.schema_version,
            "streamType": event.stream_type,
            "streamId": uuid_text(event.stream_id),
            "logicalCellId": uuid_text(event.logical_cell_id),
            "ownershipEpoch": event.ownership_epoch,
            "modeDomain": match event.mode_domain {
                ModeDomain::Historical => "HISTORICAL",
                ModeDomain::Current => "CURRENT",
            },
            "causationId": uuid_text(event.causation_id),
            "correlationId": uuid_text(event.correlation_id),
            "traceId": event.trace_id,
            "actorHex": hex(&event.actor_bytes),
            "occurredAtUnixMicros": event.occurred_at_unix_micros,
            "policyRevision": event.policy_revision,
            "modelRevision": event.model_revision,
            "factRevision": event.fact_revision,
            "engineArtifactDigestHex": event.engine_artifact_digest.map(|value| hex(&value)),
            "rightsScope": event.rights_scope,
            "dataClass": event.data_class,
            "visibilityEpoch": event.visibility_epoch,
            "payloadHex": hex(&event.payload_bytes),
        })).collect::<Vec<_>>(),
    })
}

#[must_use]
pub fn uuid(value: [u8; 16]) -> uuid::Uuid {
    uuid::Uuid::from_bytes(value)
}

fn uuid_text(value: [u8; 16]) -> String {
    uuid(value).to_string()
}

#[must_use]
pub fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut value = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        value.push(char::from(DIGITS[usize::from(byte >> 4)]));
        value.push(char::from(DIGITS[usize::from(byte & 0x0f)]));
    }
    value
}
