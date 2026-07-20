use panshi_protocol::{decode_canonical, game::v1};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::{fixed, hex, load_content, uuid};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaimedBatch {
    event_ids: Vec<Uuid>,
    events: Vec<ClaimedEvent>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClaimedEvent {
    event_id: Uuid,
    event_type: String,
    stream_type: String,
    stream_id: Uuid,
    stream_version: u64,
    logical_cell_id: Uuid,
    ownership_epoch: u64,
    global_position: u64,
    event_hash_hex: String,
    payload_hex: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProjectionError {
    InvalidBatch,
    Gap,
    UnsupportedEvent,
    Persistence,
}

impl std::fmt::Display for ProjectionError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "{self:?}")
    }
}

impl std::error::Error for ProjectionError {}

pub async fn claim_batch(
    pool: &PgPool,
    worker: &str,
) -> Result<Option<Value>, ProjectionError> {
    sqlx::query_scalar(
        "SELECT batch FROM event_store.claim_outbox_batch_v1( \
           'public-projection-v1', $1, 30, NULL, true)",
    )
    .bind(worker)
    .fetch_optional(pool)
    .await
    .map_err(|_| ProjectionError::Persistence)
}

pub async fn project_batch(
    pool: &PgPool,
    worker: &str,
    value: Value,
) -> Result<(), ProjectionError> {
    let batch: ClaimedBatch =
        serde_json::from_value(value).map_err(|_| ProjectionError::InvalidBatch)?;
    if batch.events.is_empty() || batch.event_ids.len() != batch.events.len() {
        return Err(ProjectionError::InvalidBatch);
    }
    let mut tx = pool
        .begin()
        .await
        .map_err(|_| ProjectionError::Persistence)?;
    for event in &batch.events {
        require_next_checkpoint(&mut tx, event).await?;
        apply_event(&mut tx, pool, event).await?;
        advance_checkpoint(&mut tx, event).await?;
    }
    let updated = sqlx::query(
        "UPDATE event_store.consumer_inbox \
         SET delivery_state = 'APPLIED', completed_at = clock_timestamp(), \
             lease_owner = NULL, lease_until = NULL \
         WHERE consumer_id = 'public-projection-v1' AND event_id = ANY($1) \
           AND delivery_state = 'PROCESSING' AND lease_owner = $2",
    )
    .bind(&batch.event_ids)
    .bind(worker)
    .execute(&mut *tx)
    .await
    .map_err(|_| ProjectionError::Persistence)?;
    if updated.rows_affected() != batch.event_ids.len() as u64 {
        return Err(ProjectionError::Gap);
    }
    tx.commit()
        .await
        .map_err(|_| ProjectionError::Persistence)
}

pub async fn quarantine_batch(
    pool: &PgPool,
    worker: &str,
    value: &Value,
    error_class: &str,
) -> Result<(), ProjectionError> {
    let batch: ClaimedBatch =
        serde_json::from_value(value.clone()).map_err(|_| ProjectionError::InvalidBatch)?;
    let mut tx = pool
        .begin()
        .await
        .map_err(|_| ProjectionError::Persistence)?;
    for event in &batch.events {
        sqlx::query(
            "INSERT INTO projection.quarantine \
             (consumer_id, event_id, error_class, event_hash) \
             VALUES ('public-projection-v1', $1, $2, decode($3, 'hex')) \
             ON CONFLICT (consumer_id, event_id) DO NOTHING",
        )
        .bind(event.event_id)
        .bind(error_class)
        .bind(&event.event_hash_hex)
        .execute(&mut *tx)
        .await
        .map_err(|_| ProjectionError::Persistence)?;
    }
    let updated = sqlx::query(
        "UPDATE event_store.consumer_inbox \
         SET delivery_state = 'QUARANTINED', completed_at = clock_timestamp(), \
             last_error_class = $3, lease_owner = NULL, lease_until = NULL \
         WHERE consumer_id = 'public-projection-v1' AND event_id = ANY($1) \
           AND delivery_state = 'PROCESSING' AND lease_owner = $2",
    )
    .bind(&batch.event_ids)
    .bind(worker)
    .bind(error_class)
    .execute(&mut *tx)
    .await
    .map_err(|_| ProjectionError::Persistence)?;
    if updated.rows_affected() != batch.event_ids.len() as u64 {
        return Err(ProjectionError::Gap);
    }
    tx.commit()
        .await
        .map_err(|_| ProjectionError::Persistence)
}

async fn require_next_checkpoint(
    tx: &mut Transaction<'_, Postgres>,
    event: &ClaimedEvent,
) -> Result<(), ProjectionError> {
    let current: Option<i64> = sqlx::query_scalar(
        "SELECT stream_version FROM event_store.consumer_checkpoints \
         WHERE consumer_id = 'public-projection-v1' AND logical_cell_id = $1 \
           AND stream_type = $2 AND stream_id = $3 FOR UPDATE",
    )
    .bind(event.logical_cell_id)
    .bind(&event.stream_type)
    .bind(event.stream_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|_| ProjectionError::Persistence)?;
    let expected = current.map_or(1, |value| value + 1);
    let actual = i64::try_from(event.stream_version).map_err(|_| ProjectionError::InvalidBatch)?;
    if expected != actual {
        return Err(ProjectionError::Gap);
    }
    Ok(())
}

async fn advance_checkpoint(
    tx: &mut Transaction<'_, Postgres>,
    event: &ClaimedEvent,
) -> Result<(), ProjectionError> {
    sqlx::query(
        "INSERT INTO event_store.consumer_checkpoints ( \
           consumer_id, logical_cell_id, stream_type, stream_id, stream_version, \
           event_hash, global_position) \
         VALUES ('public-projection-v1', $1, $2, $3, $4, decode($5, 'hex'), $6) \
         ON CONFLICT (consumer_id, logical_cell_id, stream_type, stream_id) \
         DO UPDATE SET stream_version = EXCLUDED.stream_version, \
           event_hash = EXCLUDED.event_hash, global_position = EXCLUDED.global_position, \
           updated_at = clock_timestamp()",
    )
    .bind(event.logical_cell_id)
    .bind(&event.stream_type)
    .bind(event.stream_id)
    .bind(i64::try_from(event.stream_version).map_err(|_| ProjectionError::InvalidBatch)?)
    .bind(&event.event_hash_hex)
    .bind(i64::try_from(event.global_position).map_err(|_| ProjectionError::InvalidBatch)?)
    .execute(&mut **tx)
    .await
    .map_err(|_| ProjectionError::Persistence)?;
    Ok(())
}

async fn apply_event(
    tx: &mut Transaction<'_, Postgres>,
    pool: &PgPool,
    event: &ClaimedEvent,
) -> Result<(), ProjectionError> {
    let payload = decode_hex(&event.payload_hex)?;
    match event.event_type.as_str() {
        "HistoricalRoundOpened" => {
            let opened = decode_canonical::<v1::HistoricalRoundOpened>(&payload)
                .map_err(|_| ProjectionError::InvalidBatch)?;
            let content_id = fixed::<16>(&opened.content_revision_id)
                .map_err(|_| ProjectionError::InvalidBatch)?;
            let content = load_content(pool, content_id)
                .await
                .map_err(|_| ProjectionError::Persistence)?;
            let projection = initial_projection(&content.payload, &opened, event)?;
            sqlx::query(
                "INSERT INTO projection.round_desks ( \
                   round_id, logical_cell_id, ownership_epoch, canonical_version, \
                   projection_version, decision_session_id, payload) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7) \
                 ON CONFLICT (round_id) DO NOTHING",
            )
            .bind(event.stream_id)
            .bind(event.logical_cell_id)
            .bind(i64::try_from(event.ownership_epoch).map_err(|_| ProjectionError::InvalidBatch)?)
            .bind(i64::try_from(event.stream_version).map_err(|_| ProjectionError::InvalidBatch)?)
            .bind(i64::try_from(event.global_position).map_err(|_| ProjectionError::InvalidBatch)?)
            .bind(uuid(fixed::<16>(&opened.decision_session_id).map_err(|_| ProjectionError::InvalidBatch)?))
            .bind(projection)
            .execute(&mut **tx)
            .await
            .map_err(|_| ProjectionError::Persistence)?;
        }
        "SeatPlanSaved" => {
            let saved = decode_canonical::<v1::SeatPlanSaved>(&payload)
                .map_err(|_| ProjectionError::InvalidBatch)?;
            let placements = saved
                .placements
                .iter()
                .map(api_placement)
                .collect::<Result<Vec<_>, ProjectionError>>()?;
            let mut current = round_payload(tx, event.stream_id).await?;
            current["canonicalVersion"] = json!(event.stream_version);
            current["projectionVersion"] = json!(event.global_position);
            current["placements"] = json!(placements);
            current["pendingBoundaryTransition"] = Value::Null;
            current["canSubmit"] = json!(true);
            let digest = fixed::<32>(&saved.layout_digest).map_err(|_| ProjectionError::InvalidBatch)?;
            sqlx::query(
                "UPDATE projection.round_desks SET canonical_version = $2, \
                   projection_version = $3, layout_digest = $4, payload = $5, \
                   updated_at = clock_timestamp() WHERE round_id = $1",
            )
            .bind(event.stream_id)
            .bind(i64::try_from(event.stream_version).map_err(|_| ProjectionError::InvalidBatch)?)
            .bind(i64::try_from(event.global_position).map_err(|_| ProjectionError::InvalidBatch)?)
            .bind(digest.to_vec())
            .bind(&current)
            .execute(&mut **tx)
            .await
            .map_err(|_| ProjectionError::Persistence)?;
            let preview = legal_preview(&current, event.stream_id, event.stream_version, &digest)?;
            sqlx::query(
                "INSERT INTO projection.legal_action_previews ( \
                   round_id, canonical_version, layout_digest, projection_version, payload) \
                 VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING",
            )
            .bind(event.stream_id)
            .bind(i64::try_from(event.stream_version).map_err(|_| ProjectionError::InvalidBatch)?)
            .bind(digest.to_vec())
            .bind(i64::try_from(event.global_position).map_err(|_| ProjectionError::InvalidBatch)?)
            .bind(preview)
            .execute(&mut **tx)
            .await
            .map_err(|_| ProjectionError::Persistence)?;
        }
        "SeatPlanSealed" => {
            update_round_state(tx, event, "seat_plan_sealed", "pending", false).await?;
        }
        "DecisionInputSealed" => {
            let sealed = decode_canonical::<v1::DecisionInputSealed>(&payload)
                .map_err(|_| ProjectionError::InvalidBatch)?;
            let round_id = uuid(fixed::<16>(&sealed.round_id).map_err(|_| ProjectionError::InvalidBatch)?);
            update_round_state_for_id(tx, round_id, event, "input_sealed", "pending", false).await?;
        }
        "ActionsCommitted" => {
            let committed = decode_canonical::<v1::ActionsCommitted>(&payload)
                .map_err(|_| ProjectionError::InvalidBatch)?;
            let session_id = uuid(
                fixed::<16>(&committed.decision_session_id)
                    .map_err(|_| ProjectionError::InvalidBatch)?,
            );
            let reveal = reveal_payload(&committed, event)?;
            sqlx::query(
                "INSERT INTO projection.decision_reveals ( \
                   decision_session_id, canonical_version, projection_version, action_digest, payload) \
                 VALUES ($1, $2, $3, $4, $5) \
                 ON CONFLICT (decision_session_id) DO UPDATE SET \
                   canonical_version = EXCLUDED.canonical_version, \
                   projection_version = EXCLUDED.projection_version, \
                   action_digest = EXCLUDED.action_digest, payload = EXCLUDED.payload, \
                   updated_at = clock_timestamp()",
            )
            .bind(session_id)
            .bind(i64::try_from(event.stream_version).map_err(|_| ProjectionError::InvalidBatch)?)
            .bind(i64::try_from(event.global_position).map_err(|_| ProjectionError::InvalidBatch)?)
            .bind(&committed.action_digest)
            .bind(reveal)
            .execute(&mut **tx)
            .await
            .map_err(|_| ProjectionError::Persistence)?;
            sqlx::query(
                "UPDATE projection.round_desks SET \
                   payload = jsonb_set(jsonb_set(jsonb_set( \
                     payload, '{authoritativeState}', to_jsonb('action_committed'::text)), \
                     '{revealState}', to_jsonb('available'::text)), \
                     '{canSubmit}', 'false'::jsonb), \
                   projection_version = greatest(projection_version, $2), updated_at = clock_timestamp() \
                 WHERE decision_session_id = $1",
            )
            .bind(session_id)
            .bind(i64::try_from(event.global_position).map_err(|_| ProjectionError::InvalidBatch)?)
            .execute(&mut **tx)
            .await
            .map_err(|_| ProjectionError::Persistence)?;
        }
        _ => return Err(ProjectionError::UnsupportedEvent),
    }
    Ok(())
}

fn initial_projection(
    content: &Value,
    opened: &v1::HistoricalRoundOpened,
    event: &ClaimedEvent,
) -> Result<Value, ProjectionError> {
    Ok(json!({
        "mode": "historical",
        "authoritativeState": "open",
        "canonicalVersion": event.stream_version,
        "projectionVersion": event.global_position,
        "serverNow": unix_micros_rfc3339(opened.evidence_cutoff_unix_micros),
        "interactionCutoffAt": unix_micros_rfc3339(opened.interaction_cutoff_unix_micros),
        "evidenceCutoffAt": unix_micros_rfc3339(opened.evidence_cutoff_unix_micros),
        "controlState": "controlled",
        "pendingBoundaryTransition": null,
        "dataState": "ready",
        "revealState": "hidden",
        "canSubmit": true,
        "blockingReasonCodes": [],
        "truthClasses": ["statistical_sample", "fictional_setting", "simulated_narrative"],
        "logicalCellId": event.logical_cell_id,
        "ownershipEpoch": event.ownership_epoch,
        "roundId": event.stream_id,
        "decisionSessionId": uuid(fixed::<16>(&opened.decision_session_id).map_err(|_| ProjectionError::InvalidBatch)?),
        "episodeLabel": content["episodeLabel"],
        "maskedSessionLabel": content["maskedSessionLabel"],
        "previousKeyCause": content["previousKeyCause"],
        "characters": content["characters"],
        "dossiers": content["dossiers"],
        "seats": content["seats"],
        "placements": content["placements"]
    }))
}

async fn round_payload(
    tx: &mut Transaction<'_, Postgres>,
    round_id: Uuid,
) -> Result<Value, ProjectionError> {
    sqlx::query_scalar("SELECT payload FROM projection.round_desks WHERE round_id = $1 FOR UPDATE")
        .bind(round_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|_| ProjectionError::Persistence)?
        .ok_or(ProjectionError::Gap)
}

async fn update_round_state(
    tx: &mut Transaction<'_, Postgres>,
    event: &ClaimedEvent,
    state: &str,
    reveal: &str,
    can_submit: bool,
) -> Result<(), ProjectionError> {
    update_round_state_for_id(tx, event.stream_id, event, state, reveal, can_submit).await
}

async fn update_round_state_for_id(
    tx: &mut Transaction<'_, Postgres>,
    round_id: Uuid,
    event: &ClaimedEvent,
    state: &str,
    reveal: &str,
    can_submit: bool,
) -> Result<(), ProjectionError> {
    let mut payload = round_payload(tx, round_id).await?;
    payload["authoritativeState"] = json!(state);
    payload["revealState"] = json!(reveal);
    payload["canSubmit"] = json!(can_submit);
    payload["projectionVersion"] = json!(event.global_position);
    if event.stream_type == "RoundDesk" {
        payload["canonicalVersion"] = json!(event.stream_version);
    }
    sqlx::query(
        "UPDATE projection.round_desks SET canonical_version = \
           CASE WHEN $3 = 'RoundDesk' THEN $2 ELSE canonical_version END, \
           projection_version = $4, payload = $5, updated_at = clock_timestamp() \
         WHERE round_id = $1",
    )
    .bind(round_id)
    .bind(i64::try_from(event.stream_version).map_err(|_| ProjectionError::InvalidBatch)?)
    .bind(&event.stream_type)
    .bind(i64::try_from(event.global_position).map_err(|_| ProjectionError::InvalidBatch)?)
    .bind(payload)
    .execute(&mut **tx)
    .await
    .map_err(|_| ProjectionError::Persistence)?;
    Ok(())
}

fn legal_preview(
    round: &Value,
    round_id: Uuid,
    version: u64,
    digest: &[u8; 32],
) -> Result<Value, ProjectionError> {
    let placements = round["placements"]
        .as_array()
        .ok_or(ProjectionError::InvalidBatch)?;
    let dossiers = round["dossiers"]
        .as_array()
        .ok_or(ProjectionError::InvalidBatch)?;
    let seats = round["seats"]
        .as_array()
        .ok_or(ProjectionError::InvalidBatch)?;
    let projected = seats
        .iter()
        .map(|seat| {
            let seat_id = seat["seatId"].as_str().ok_or(ProjectionError::InvalidBatch)?;
            let placement = placements
                .iter()
                .find(|value| value["seatId"] == seat_id)
                .ok_or(ProjectionError::InvalidBatch)?;
            let dossier = dossiers
                .iter()
                .find(|value| value["id"] == placement["dossierId"])
                .ok_or(ProjectionError::InvalidBatch)?;
            Ok(json!({
                "seatId": seat_id,
                "companies": dossier["companies"],
                "qmax": seat["qmax"],
                "informationPerspective": seat["informationPerspective"],
                "peerSourceSeatId": seat["peerSourceSeatId"]
            }))
        })
        .collect::<Result<Vec<_>, ProjectionError>>()?;
    Ok(json!({
        "roundId": round_id,
        "canonicalVersion": version,
        "layoutDigest": hex(digest),
        "seats": projected
    }))
}

fn reveal_payload(
    committed: &v1::ActionsCommitted,
    event: &ClaimedEvent,
) -> Result<Value, ProjectionError> {
    let actions = committed
        .actions
        .iter()
        .map(|action| {
            let direction = match action.direction {
                1 => "no-action",
                2 => "upside",
                3 => "downside",
                _ => return Err(ProjectionError::InvalidBatch),
            };
            Ok(json!({
                "seatId": seat_name(action.seat_id)?,
                "characterId": uuid(fixed::<16>(&action.character_id).map_err(|_| ProjectionError::InvalidBatch)?),
                "fictionalCompanyId": if action.fictional_company_id.is_empty() { Value::Null } else {
                    json!(uuid(fixed::<16>(&action.fictional_company_id).map_err(|_| ProjectionError::InvalidBatch)?))
                },
                "direction": direction,
                "confidence": fixed_string(action.confidence_fixed),
                "firstUtility": fixed_string(action.first_utility_fixed),
                "secondUtility": fixed_string(action.second_utility_fixed),
                "utilityGap": fixed_string(action.utility_gap_fixed),
                "truthClasses": ["fictional_setting", "simulated_narrative"]
            }))
        })
        .collect::<Result<Vec<_>, ProjectionError>>()?;
    Ok(json!({
        "decisionSessionId": uuid(fixed::<16>(&committed.decision_session_id).map_err(|_| ProjectionError::InvalidBatch)?),
        "currentRevision": event.stream_version,
        "previousRevisions": [],
        "adjudicationReasonClass": null,
        "scoreChanged": false,
        "crewHistoryChanged": false,
        "riskBrakeCarry": true,
        "actionDigest": hex(&committed.action_digest),
        "actions": actions
    }))
}

fn api_placement(value: &v1::Placement) -> Result<Value, ProjectionError> {
    Ok(json!({
        "seatId": seat_name(value.seat_id)?,
        "characterId": uuid(fixed::<16>(&value.character_id).map_err(|_| ProjectionError::InvalidBatch)?),
        "dossierId": uuid(fixed::<16>(&value.dossier_id).map_err(|_| ProjectionError::InvalidBatch)?)
    }))
}

fn seat_name(value: i32) -> Result<&'static str, ProjectionError> {
    match value {
        1 => Ok("gatekeeper"),
        2 => Ok("core-a"),
        3 => Ok("core-b"),
        4 => Ok("flank"),
        5 => Ok("explore"),
        _ => Err(ProjectionError::InvalidBatch),
    }
}

fn fixed_string(value: i64) -> String {
    let negative = value < 0;
    let absolute = value.unsigned_abs();
    format!(
        "{}{}.{:06}",
        if negative { "-" } else { "" },
        absolute / 1_000_000,
        absolute % 1_000_000
    )
}

fn decode_hex(value: &str) -> Result<Vec<u8>, ProjectionError> {
    if !value.len().is_multiple_of(2) {
        return Err(ProjectionError::InvalidBatch);
    }
    (0..value.len())
        .step_by(2)
        .map(|index| {
            u8::from_str_radix(&value[index..index + 2], 16)
                .map_err(|_| ProjectionError::InvalidBatch)
        })
        .collect()
}

fn unix_micros_rfc3339(value: i64) -> String {
    let seconds = value.div_euclid(1_000_000);
    let micros = value.rem_euclid(1_000_000);
    let days = seconds.div_euclid(86_400);
    let day_seconds = seconds.rem_euclid(86_400);
    let (year, month, day) = civil_from_days(days);
    let hour = day_seconds / 3_600;
    let minute = day_seconds % 3_600 / 60;
    let second = day_seconds % 60;
    format!(
        "{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{micros:06}Z"
    )
}

fn civil_from_days(days_since_epoch: i64) -> (i64, i64, i64) {
    let shifted = days_since_epoch + 719_468;
    let era = if shifted >= 0 { shifted } else { shifted - 146_096 } / 146_097;
    let day_of_era = shifted - era * 146_097;
    let year_of_era = (day_of_era - day_of_era / 1_460 + day_of_era / 36_524
        - day_of_era / 146_096)
        / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    year += i64::from(month <= 2);
    (year, month, day)
}
