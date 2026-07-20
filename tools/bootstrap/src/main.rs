#![forbid(unsafe_code)]

use panshi_application::{
    ROUND_STREAM, command_digest, database_now_unix_micros, parse_uuid,
};
use panshi_event_store::{
    AppendRequest, CommandRegistration, CommandState, EventStore, ModeDomain, NewEvent,
    PostgresEventStore, StreamPrecondition,
};
use panshi_protocol::{canonical_bytes, decode_canonical, game::v1::HistoricalRoundOpened};
use serde_json::Value;
use sqlx::postgres::PgPoolOptions;
use uuid::Uuid;

const FIXTURE: &str = include_str!("../../../fixtures/bootstrap/historical-round-v1.json");
const COMMAND_ID: [u8; 16] = [0x50, 0, 0, 0, 0, 0, 0x40, 0, 0x80, 0, 0, 0, 0, 0, 0, 1];
const EVENT_ID: [u8; 16] = [0x50, 0, 0, 0, 0, 0, 0x40, 0, 0x80, 0, 0, 0, 0, 0, 0, 2];

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let database_url = std::env::var("DATABASE_URL")?;
    let cutoff_seconds = std::env::var("PANSHI_BOOTSTRAP_CUTOFF_SECONDS")
        .ok()
        .and_then(|value| value.parse::<i64>().ok())
        .unwrap_or(300);
    if !(1..=86_400).contains(&cutoff_seconds) {
        return Err("PANSHI_BOOTSTRAP_CUTOFF_SECONDS must be between 1 and 86400".into());
    }

    let pool = PgPoolOptions::new()
        .max_connections(2)
        .connect(&database_url)
        .await?;
    PostgresEventStore::migrate(&pool).await?;
    let store = PostgresEventStore::new(pool.clone());

    let fixture: Value = serde_json::from_str(FIXTURE)?;
    let fixture_bytes = serde_json::to_vec(&fixture)?;
    let round_id = field_id(&fixture, "roundId")?;
    let decision_session_id = field_id(&fixture, "decisionSessionId")?;
    let content_session_id = field_id(&fixture, "contentSessionId")?;
    let content_revision_id = field_id(&fixture, "contentRevisionId")?;
    let logical_cell_id = field_id(&fixture, "logicalCellId")?;

    sqlx::query(
        "INSERT INTO content.revisions ( \
           revision_id, artifact_kind, schema_version, payload_bytes, rights_scope, data_class) \
         VALUES ($1, 'historical-round', 1, $2, 'synthetic-fixture', 'fictional') \
         ON CONFLICT (revision_id) DO NOTHING",
    )
    .bind(Uuid::from_bytes(content_revision_id))
    .bind(&fixture_bytes)
    .execute(&pool)
    .await?;
    let stored: Vec<u8> = sqlx::query_scalar(
        "SELECT payload_bytes FROM content.revisions WHERE revision_id = $1",
    )
    .bind(Uuid::from_bytes(content_revision_id))
    .fetch_one(&pool)
    .await?;
    if stored != fixture_bytes {
        return Err("content revision ID already belongs to different bytes".into());
    }

    let existing = store
        .command(COMMAND_ID)
        .await
        .map_err(|_| "bootstrap journal lookup failed")?;
    if existing
        .as_ref()
        .is_some_and(|record| record.state == CommandState::Committed)
    {
        println!(
            "bootstrapped round {} at canonical version 1 (already present)",
            Uuid::from_bytes(round_id)
        );
        return Ok(());
    }
    if existing
        .as_ref()
        .is_some_and(|record| record.state == CommandState::Rejected)
    {
        return Err("bootstrap command is terminally rejected".into());
    }

    let (opened, request_hash, should_register) = if let Some(record) = existing {
        if record.command_kind != "bootstrap-historical-round-v1" {
            return Err("bootstrap command ID belongs to another command kind".into());
        }
        let opened = decode_canonical::<HistoricalRoundOpened>(&record.command_bytes)
            .map_err(|_| "pending bootstrap command bytes are corrupt")?;
        (opened, record.request_hash, false)
    } else {
        let now = database_now_unix_micros(&pool)
            .await
            .map_err(|_| "database clock unavailable")?;
        let opened = HistoricalRoundOpened {
            round_id: round_id.to_vec(),
            decision_session_id: decision_session_id.to_vec(),
            content_session_id: content_session_id.to_vec(),
            content_revision_id: content_revision_id.to_vec(),
            logical_cell_id: logical_cell_id.to_vec(),
            ownership_epoch: 1,
            interaction_cutoff_unix_micros: now + cutoff_seconds * 1_000_000,
            evidence_cutoff_unix_micros: now,
            replay_patch: None,
        };
        let hash = command_digest("bootstrap-historical-round-v1", &canonical_bytes(&opened));
        (opened, hash, true)
    };
    let command_bytes = canonical_bytes(&opened);
    let idempotency_key = "bootstrap/historical-round-v1".to_owned();
    if should_register {
        store.register_command(CommandRegistration {
            command_id: COMMAND_ID,
            command_owner: "bootstrap".into(),
            idempotency_key: idempotency_key.clone(),
            command_kind: "bootstrap-historical-round-v1".into(),
            command_bytes,
            request_hash,
            status_resource: format!("/v1/commands/{}", Uuid::from_bytes(COMMAND_ID)),
        })
        .await
        .map_err(|_| "bootstrap command registration failed")?;
    }
    let receipt = store
        .append_registered(AppendRequest {
            command_id: COMMAND_ID,
            command_owner: "bootstrap".into(),
            idempotency_key,
            command_digest: request_hash,
            preconditions: vec![StreamPrecondition {
                logical_cell_id,
                stream_type: ROUND_STREAM.into(),
                stream_id: round_id,
                expected_version: 0,
                ownership_epoch: 1,
            }],
            events: vec![NewEvent {
                event_id: EVENT_ID,
                event_type: "HistoricalRoundOpened".into(),
                schema_version: 1,
                stream_type: ROUND_STREAM.into(),
                stream_id: round_id,
                logical_cell_id,
                ownership_epoch: 1,
                mode_domain: ModeDomain::Historical,
                causation_id: COMMAND_ID,
                correlation_id: round_id,
                trace_id: "bootstrap-historical-round-v1".into(),
                actor_bytes: b"system/bootstrap".to_vec(),
                occurred_at_unix_micros: opened.evidence_cutoff_unix_micros,
                policy_revision: "historical-beta/1".into(),
                model_revision: None,
                fact_revision: Some("synthetic-historical/1".into()),
                engine_artifact_digest: None,
                rights_scope: "synthetic-fixture".into(),
                data_class: "fictional".into(),
                visibility_epoch: 1,
                payload_bytes: canonical_bytes(&opened),
            }],
        })
        .await
        .map_err(|_| "bootstrap event append failed")?;

    println!(
        "bootstrapped round {} at canonical version {}{}",
        Uuid::from_bytes(round_id),
        receipt.events[0].stream_version,
        if receipt.deduplicated { " (already present)" } else { "" }
    );
    Ok(())
}

fn field_id(value: &Value, field: &str) -> Result<[u8; 16], Box<dyn std::error::Error>> {
    let raw = value
        .get(field)
        .and_then(Value::as_str)
        .ok_or("fixture UUID field is missing")?;
    parse_uuid(raw).map_err(|_| "fixture UUID is invalid".into())
}
