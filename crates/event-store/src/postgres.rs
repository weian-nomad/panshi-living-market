use serde_json::{Value, json};
use sqlx::{PgPool, migrate::MigrateError, postgres::PgDatabaseError};
use uuid::Uuid;

use crate::{
    AppendError, AppendReceipt, AppendRequest, Digest, EventReceipt, EventStore, ModeDomain,
    validate_request,
};

#[derive(Clone, Debug)]
pub struct PostgresEventStore {
    pool: PgPool,
}

impl PostgresEventStore {
    #[must_use]
    pub const fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Applies the embedded canonical event-store migration.
    ///
    /// # Errors
    ///
    /// Returns the database migration failure without weakening invariants.
    pub async fn migrate(pool: &PgPool) -> Result<(), MigrateError> {
        sqlx::migrate!("./migrations").run(pool).await
    }
}

impl EventStore for PostgresEventStore {
    async fn append(&self, request: AppendRequest) -> Result<AppendReceipt, AppendError> {
        validate_request(&request)?;
        let wire_request = request_json(&request);
        let receipt: Value =
            sqlx::query_scalar("SELECT receipt FROM event_store.append_batch($1::jsonb)")
                .bind(wire_request)
                .fetch_one(&self.pool)
                .await
                .map_err(|error| map_database_error(&error))?;
        parse_receipt(&receipt)
    }
}

fn request_json(request: &AppendRequest) -> Value {
    json!({
        "commandId": uuid(request.command_id),
        "commandOwner": request.command_owner,
        "idempotencyKey": request.idempotency_key,
        "requestHashHex": hex(&request.command_digest),
        "preconditions": request.preconditions.iter().map(|condition| json!({
            "logicalCellId": uuid(condition.logical_cell_id),
            "streamType": condition.stream_type,
            "streamId": uuid(condition.stream_id),
            "expectedVersion": condition.expected_version,
            "ownershipEpoch": condition.ownership_epoch,
        })).collect::<Vec<_>>(),
        "events": request.events.iter().map(|event| json!({
            "eventId": uuid(event.event_id),
            "eventType": event.event_type,
            "schemaVersion": event.schema_version,
            "streamType": event.stream_type,
            "streamId": uuid(event.stream_id),
            "logicalCellId": uuid(event.logical_cell_id),
            "ownershipEpoch": event.ownership_epoch,
            "modeDomain": match event.mode_domain { ModeDomain::Historical => "HISTORICAL" },
            "causationId": uuid(event.causation_id),
            "correlationId": uuid(event.correlation_id),
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

fn parse_receipt(value: &Value) -> Result<AppendReceipt, AppendError> {
    let command_id = parse_uuid(value.get("commandId").and_then(Value::as_str))?;
    let deduplicated = value
        .get("deduplicated")
        .and_then(Value::as_bool)
        .ok_or(AppendError::Persistence)?;
    let events = value
        .get("events")
        .and_then(Value::as_array)
        .ok_or(AppendError::Persistence)?
        .iter()
        .map(|event| {
            Ok(EventReceipt {
                event_id: parse_uuid(event.get("eventId").and_then(Value::as_str))?,
                stream_version: event
                    .get("streamVersion")
                    .and_then(Value::as_u64)
                    .ok_or(AppendError::Persistence)?,
                global_position: event
                    .get("globalPosition")
                    .and_then(Value::as_u64)
                    .ok_or(AppendError::Persistence)?,
                payload_hash: parse_digest(event.get("payloadHashHex").and_then(Value::as_str))?,
                event_hash: parse_digest(event.get("eventHashHex").and_then(Value::as_str))?,
            })
        })
        .collect::<Result<Vec<_>, AppendError>>()?;
    Ok(AppendReceipt {
        command_id,
        deduplicated,
        events,
    })
}

fn map_database_error(error: &sqlx::Error) -> AppendError {
    let Some(database) = error.as_database_error() else {
        return AppendError::Persistence;
    };
    match database.code().as_deref() {
        Some("23505") => AppendError::IdempotencyDigestConflict,
        Some("40001") => parse_conflict(
            database
                .try_downcast_ref::<PgDatabaseError>()
                .and_then(PgDatabaseError::detail),
        ),
        _ => AppendError::Persistence,
    }
}

fn parse_conflict(detail: Option<&str>) -> AppendError {
    let Some(detail) = detail.and_then(|value| serde_json::from_str::<Value>(value).ok()) else {
        return AppendError::Persistence;
    };
    if detail.get("kind").and_then(Value::as_str) == Some("ownershipEpoch") {
        return AppendError::OwnershipEpochConflict;
    }
    let Some(stream_type) = detail.get("streamType").and_then(Value::as_str) else {
        return AppendError::Persistence;
    };
    let Ok(stream_id) = parse_uuid(detail.get("streamId").and_then(Value::as_str)) else {
        return AppendError::Persistence;
    };
    let Some(expected) = detail.get("expected").and_then(Value::as_u64) else {
        return AppendError::Persistence;
    };
    let Some(actual) = detail.get("actual").and_then(Value::as_u64) else {
        return AppendError::Persistence;
    };
    AppendError::VersionConflict {
        stream_type: stream_type.to_owned(),
        stream_id,
        expected,
        actual,
    }
}

fn uuid(value: [u8; 16]) -> String {
    Uuid::from_bytes(value).to_string()
}

fn parse_uuid(value: Option<&str>) -> Result<[u8; 16], AppendError> {
    let parsed = value
        .ok_or(AppendError::Persistence)?
        .parse::<Uuid>()
        .map_err(|_| AppendError::Persistence)?;
    Ok(*parsed.as_bytes())
}

fn parse_digest(value: Option<&str>) -> Result<Digest, AppendError> {
    let value = value.ok_or(AppendError::Persistence)?;
    if value.len() != 64 {
        return Err(AppendError::Persistence);
    }
    let mut digest = [0; 32];
    for (index, byte) in digest.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&value[index * 2..index * 2 + 2], 16)
            .map_err(|_| AppendError::Persistence)?;
    }
    Ok(digest)
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut value = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        value.push(char::from(DIGITS[usize::from(byte >> 4)]));
        value.push(char::from(DIGITS[usize::from(byte & 0x0f)]));
    }
    value
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::parse_receipt;

    #[test]
    fn parses_a_database_receipt_without_lossy_numbers() {
        let receipt = json!({
            "commandId": "01010101-0101-0101-0101-010101010101",
            "deduplicated": false,
            "events": [{
                "eventId": "02020202-0202-0202-0202-020202020202",
                "streamVersion": 8,
                "globalPosition": 9,
                "payloadHashHex": "03".repeat(32),
                "eventHashHex": "04".repeat(32)
            }]
        });
        let parsed = parse_receipt(&receipt).expect("canonical receipt");
        assert_eq!(parsed.events[0].stream_version, 8);
        assert_eq!(parsed.events[0].event_hash, [4; 32]);
    }
}
