#![forbid(unsafe_code)]

use std::{net::SocketAddr, sync::Arc};

use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post, put},
};
use panshi_application::{
    CommandReceipt, DECISION_STREAM, ROUND_STREAM, SaveSeatPlanBody, SealSeatPlanBody,
    algorithm_digest, build_decision_input, command_digest, database_now_unix_micros,
    kernel_abi_digest, load_content, load_round, parse_digest, save_command_bytes,
};
use panshi_decision_kernel::{ALGORITHM_ID, KERNEL_ABI};
use panshi_domain::round_desk::RoundDeskError;
use panshi_event_store::{
    AppendError, AppendRequest, CommandRecord, CommandRegistration, CommandRejection, CommandState,
    EventStore, ModeDomain, NewEvent, PostgresEventStore, StreamPrecondition,
};
use panshi_protocol::{canonical_bytes, game::v1};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, postgres::PgPoolOptions};
use tower_http::{
    cors::{Any, CorsLayer},
    trace::TraceLayer,
};
use tracing::info;
use uuid::Uuid;

#[derive(Clone, Debug)]
struct AppState {
    pool: PgPool,
    store: PostgresEventStore,
    beta_token: Option<Arc<str>>,
    allow_anonymous: bool,
    worker_id: Arc<str>,
}

#[derive(Debug)]
struct ApiError {
    status: StatusCode,
    reason: &'static str,
    title: &'static str,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (
            self.status,
            Json(json!({
                "type": format!("https://panshi.app/problems/{}", self.reason.to_ascii_lowercase()),
                "title": self.title,
                "status": self.status.as_u16(),
                "reasonCode": self.reason,
                "traceId": "request-boundary"
            })),
        )
            .into_response()
    }
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PreviewQuery {
    canonical_version: u64,
    layout_digest: String,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "panshi_game_core=info,tower_http=info".into()),
        )
        .init();
    let database_url = std::env::var("DATABASE_URL")?;
    let bind: SocketAddr = std::env::var("PANSHI_BIND")
        .unwrap_or_else(|_| "127.0.0.1:8080".into())
        .parse()?;
    let pool = PgPoolOptions::new()
        .max_connections(16)
        .connect(&database_url)
        .await?;
    PostgresEventStore::migrate(&pool).await?;
    let state = AppState {
        store: PostgresEventStore::new(pool.clone()),
        pool,
        beta_token: std::env::var("PANSHI_BETA_TOKEN").ok().map(Arc::from),
        allow_anonymous: std::env::var("PANSHI_ALLOW_ANONYMOUS").as_deref() == Ok("true"),
        worker_id: Arc::from(
            std::env::var("PANSHI_GAME_CORE_ID").unwrap_or_else(|_| "game-core-local".into()),
        ),
    };
    let mut app = Router::new()
        .route("/healthz", get(|| async { StatusCode::NO_CONTENT }))
        .route("/v1/rounds/{round_id}", get(get_round))
        .route("/v1/rounds/{round_id}/seat-plan", put(save_seat_plan))
        .route(
            "/v1/rounds/{round_id}/seat-plan/preview",
            get(get_preview),
        )
        .route("/v1/rounds/{round_id}/seat-plan/seal", post(seal_seat_plan))
        .route("/v1/commands/{command_id}", get(get_command))
        .route(
            "/v1/decision-sessions/{decision_session_id}/reveal",
            get(get_reveal),
        )
        .layer(TraceLayer::new_for_http())
        .with_state(state.clone());
    if std::env::var("PANSHI_DEV_CORS").as_deref() == Ok("true") {
        app = app.layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any)
                .expose_headers([header::ETAG]),
        );
    }
    let listener = tokio::net::TcpListener::bind(bind).await?;
    info!(%bind, "game core listening");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
}

fn require_auth(state: &AppState, headers: &HeaderMap) -> Result<(), ApiError> {
    if state.allow_anonymous {
        return Ok(());
    }
    let expected = state.beta_token.as_deref().ok_or(ApiError {
        status: StatusCode::SERVICE_UNAVAILABLE,
        reason: "TEMPORARY_UNAVAILABLE",
        title: "封測驗證尚未設定",
    })?;
    let supplied = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "));
    if supplied != Some(expected) {
        return Err(ApiError {
            status: StatusCode::UNAUTHORIZED,
            reason: "AUTH_REQUIRED",
            title: "需要封測通行憑證",
        });
    }
    Ok(())
}

async fn get_round(
    State(state): State<AppState>,
    Path(round_id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    require_auth(&state, &headers)?;
    let row: Option<(Value, i64)> = sqlx::query_as(
        "SELECT payload, projection_version FROM projection.round_desks WHERE round_id = $1",
    )
    .bind(round_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| unavailable())?;
    let (payload, version) = row.ok_or_else(not_found)?;
    let mut response = Json(payload).into_response();
    response.headers_mut().insert(
        header::ETAG,
        HeaderValue::from_str(&format!("\"projection:{version}\""))
            .map_err(|_| unavailable())?,
    );
    Ok(response)
}

async fn get_preview(
    State(state): State<AppState>,
    Path(round_id): Path<Uuid>,
    Query(query): Query<PreviewQuery>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    require_auth(&state, &headers)?;
    let digest = parse_digest(&query.layout_digest).map_err(|_| invalid_request())?;
    let payload: Option<Value> = sqlx::query_scalar(
        "SELECT payload FROM projection.legal_action_previews \
         WHERE round_id = $1 AND canonical_version = $2 AND layout_digest = $3",
    )
    .bind(round_id)
    .bind(i64::try_from(query.canonical_version).map_err(|_| invalid_request())?)
    .bind(digest.to_vec())
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| unavailable())?;
    payload
        .map(|value| Json(value).into_response())
        .ok_or(ApiError {
            status: StatusCode::CONFLICT,
            reason: "PROJECTION_LAGGING",
            title: "合法行為仍在整理",
        })
}

async fn get_command(
    State(state): State<AppState>,
    Path(command_id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    require_auth(&state, &headers)?;
    let record = state
        .store
        .command(*command_id.as_bytes())
        .await
        .map_err(|_| unavailable())?
        .ok_or_else(not_found)?;
    Ok(Json(command_receipt(record, false)).into_response())
}

async fn get_reveal(
    State(state): State<AppState>,
    Path(decision_session_id): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    require_auth(&state, &headers)?;
    let payload: Option<Value> = sqlx::query_scalar(
        "SELECT payload FROM projection.decision_reveals WHERE decision_session_id = $1",
    )
    .bind(decision_session_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| unavailable())?;
    if let Some(payload) = payload {
        return Ok(Json(payload).into_response());
    }
    let canonical: Option<(i64, i64)> = sqlx::query_as(
        "SELECT stream_version, COALESCE((SELECT max(projection_version) \
           FROM projection.round_desks WHERE decision_session_id = $1), 0) \
         FROM event_store.stream_heads \
         WHERE stream_type = 'DecisionSession' AND stream_id = $1",
    )
    .bind(decision_session_id)
    .fetch_optional(&state.pool)
    .await
    .map_err(|_| unavailable())?;
    canonical.map_or_else(
        || Err(not_found()),
        |(canonical_version, projection_version)| {
            Ok((
                StatusCode::ACCEPTED,
                Json(json!({
                    "decisionSessionId": decision_session_id,
                    "canonicalVersion": canonical_version,
                    "projectionVersion": projection_version,
                    "reasonCode": "PROJECTION_LAGGING"
                })),
            )
                .into_response())
        },
    )
}

async fn save_seat_plan(
    State(state): State<AppState>,
    Path(round_id): Path<Uuid>,
    headers: HeaderMap,
    Json(body): Json<SaveSeatPlanBody>,
) -> Result<Response, ApiError> {
    require_auth(&state, &headers)?;
    let command_id = required_uuid_header(&headers, "x-command-id")?;
    let idempotency_key = required_header(&headers, "idempotency-key")?;
    if idempotency_key.len() < 8 || idempotency_key.len() > 160 {
        return Err(invalid_request());
    }
    let expected = parse_if_match(required_header(&headers, "if-match")?)?;
    if expected != body.base_version {
        return Err(invalid_request());
    }
    let (plan, layout_digest, command_bytes) =
        save_command_bytes(*round_id.as_bytes(), &body).map_err(|error| ApiError {
            status: StatusCode::UNPROCESSABLE_ENTITY,
            reason: if matches!(error, panshi_application::ApplicationError::InvalidDigest) {
                "LAYOUT_DIGEST_MISMATCH"
            } else {
                "INVALID_PLACEMENT"
            },
            title: "五席配置不完整",
        })?;
    let owner = format!("round-desk/{round_id}");
    let request_hash = command_digest("SaveSeatPlan", &command_bytes);
    let registered = state
        .store
        .register_command(CommandRegistration {
            command_id: *command_id.as_bytes(),
            command_owner: owner.clone(),
            idempotency_key: idempotency_key.to_owned(),
            command_kind: "SaveSeatPlan".into(),
            command_bytes,
            request_hash,
            status_resource: format!("/v1/commands/{command_id}"),
        })
        .await
        .map_err(map_registration_error)?;
    if registered.state != CommandState::Pending {
        let status = if registered.state == CommandState::Committed {
            StatusCode::OK
        } else {
            rejection_status(registered.reason_code.as_deref())
        };
        return Ok((status, Json(command_receipt(registered, true))).into_response());
    }
    let claimed = state
        .store
        .claim_command(&owner, *command_id.as_bytes(), &state.worker_id, 30)
        .await
        .map_err(|_| unavailable())?;
    if !claimed {
        let is_replay = registered.is_replay;
        return Ok((
            StatusCode::ACCEPTED,
            Json(command_receipt(registered, is_replay)),
        )
            .into_response());
    }

    let mut loaded = match load_round(&state.pool, *round_id.as_bytes()).await {
        Ok(value) => value,
        Err(_) => {
            return reject(
                &state,
                &owner,
                command_id,
                request_hash,
                0,
                "UNKNOWN_RESOURCE",
            )
            .await;
        }
    };
    let now = match database_now_unix_micros(&state.pool).await {
        Ok(value) => value,
        Err(_) => return pending_response(registered),
    };
    let event_id = derived_id(b"PSZS/EVENT/SeatPlanSaved/v1\0", command_id.as_bytes());
    if let Err(error) = loaded.desk.save_seat_plan(
        body.base_version,
        now,
        plan.clone(),
        layout_digest,
        event_id,
    ) {
        let (reason, status) = match error {
            RoundDeskError::VersionConflict { actual, .. } => {
                return reject(
                    &state,
                    &owner,
                    command_id,
                    request_hash,
                    actual,
                    "VERSION_CONFLICT",
                )
                .await;
            }
            RoundDeskError::CutoffPassed => ("CUTOFF_PASSED", StatusCode::CONFLICT),
            RoundDeskError::LayoutDigestMismatch => {
                ("LAYOUT_DIGEST_MISMATCH", StatusCode::UNPROCESSABLE_ENTITY)
            }
            _ => ("SESSION_HELD", StatusCode::CONFLICT),
        };
        let response = reject(
            &state,
            &owner,
            command_id,
            request_hash,
            loaded.desk.stream_version,
            reason,
        )
        .await?;
        return Ok((status, response).into_response());
    }
    let payload = v1::SeatPlanSaved {
        round_id: round_id.as_bytes().to_vec(),
        layout_digest: layout_digest.to_vec(),
        placements: plan
            .placements()
            .iter()
            .map(|placement| v1::Placement {
                seat_id: placement.seat_id as i32 + 1,
                character_id: placement.character_id.0.to_vec(),
                dossier_id: placement.dossier_id.0.to_vec(),
            })
            .collect(),
        base_version: body.base_version,
        replay_patch: None,
    };
    let append = state
        .store
        .append_registered(AppendRequest {
            command_id: *command_id.as_bytes(),
            command_owner: owner.clone(),
            idempotency_key: idempotency_key.to_owned(),
            command_digest: request_hash,
            preconditions: vec![StreamPrecondition {
                logical_cell_id: loaded.desk.logical_cell_id,
                stream_type: ROUND_STREAM.into(),
                stream_id: *round_id.as_bytes(),
                expected_version: body.base_version,
                ownership_epoch: loaded.desk.ownership_epoch,
            }],
            events: vec![NewEvent {
                event_id,
                event_type: "SeatPlanSaved".into(),
                schema_version: 1,
                stream_type: ROUND_STREAM.into(),
                stream_id: *round_id.as_bytes(),
                logical_cell_id: loaded.desk.logical_cell_id,
                ownership_epoch: loaded.desk.ownership_epoch,
                mode_domain: ModeDomain::Historical,
                causation_id: *command_id.as_bytes(),
                correlation_id: *round_id.as_bytes(),
                trace_id: command_id.to_string(),
                actor_bytes: b"beta-player".to_vec(),
                occurred_at_unix_micros: now,
                policy_revision: "historical-beta/1".into(),
                model_revision: None,
                fact_revision: Some("synthetic-historical/1".into()),
                engine_artifact_digest: None,
                rights_scope: "synthetic-fixture".into(),
                data_class: "fictional".into(),
                visibility_epoch: 1,
                payload_bytes: canonical_bytes(&payload),
            }],
        })
        .await;
    match append {
        Ok(receipt) => Ok((
            StatusCode::OK,
            Json(CommandReceipt {
                command_id,
                disposition: if receipt.deduplicated {
                    "duplicate".into()
                } else {
                    "committed".into()
                },
                canonical_version: receipt.events[0].stream_version,
                retryable: false,
                reason_code: None,
                status_resource: format!("/v1/commands/{command_id}"),
            }),
        )
            .into_response()),
        Err(AppendError::VersionConflict { actual, .. }) => {
            reject(
                &state,
                &owner,
                command_id,
                request_hash,
                actual,
                "VERSION_CONFLICT",
            )
            .await
        }
        Err(_) => pending_response(registered),
    }
}

async fn reject(
    state: &AppState,
    owner: &str,
    command_id: Uuid,
    request_hash: [u8; 32],
    canonical_version: u64,
    reason: &str,
) -> Result<Response, ApiError> {
    let record = state
        .store
        .reject_command(CommandRejection {
            command_id: *command_id.as_bytes(),
            command_owner: owner.to_owned(),
            request_hash,
            canonical_version,
            reason_code: reason.to_owned(),
        })
        .await
        .map_err(|_| unavailable())?;
    Ok((
        rejection_status(Some(reason)),
        Json(command_receipt(record, false)),
    )
        .into_response())
}

async fn seal_seat_plan(
    State(state): State<AppState>,
    Path(round_id): Path<Uuid>,
    headers: HeaderMap,
    Json(body): Json<SealSeatPlanBody>,
) -> Result<Response, ApiError> {
    require_auth(&state, &headers)?;
    let command_id = required_uuid_header(&headers, "x-command-id")?;
    let idempotency_key = required_header(&headers, "idempotency-key")?;
    if idempotency_key.len() < 8 || idempotency_key.len() > 160 {
        return Err(invalid_request());
    }
    let expected = parse_if_match(required_header(&headers, "if-match")?)?;
    if expected != body.canonical_version {
        return Err(invalid_request());
    }
    let layout_digest = parse_digest(&body.layout_digest).map_err(|_| invalid_request())?;
    let command_message = v1::SealSeatPlan {
        round_id: round_id.as_bytes().to_vec(),
        content_session_id: Vec::new(),
        layout_digest: layout_digest.to_vec(),
        canonical_version: body.canonical_version,
    };
    let command_bytes = canonical_bytes(&command_message);
    let request_hash = command_digest("SealSeatPlan", &command_bytes);
    let owner = format!("round-desk/{round_id}");
    let registered = state
        .store
        .register_command(CommandRegistration {
            command_id: *command_id.as_bytes(),
            command_owner: owner.clone(),
            idempotency_key: idempotency_key.to_owned(),
            command_kind: "SealSeatPlan".into(),
            command_bytes,
            request_hash,
            status_resource: format!("/v1/commands/{command_id}"),
        })
        .await
        .map_err(map_registration_error)?;
    if registered.state != CommandState::Pending {
        let status = if registered.state == CommandState::Committed {
            StatusCode::OK
        } else {
            rejection_status(registered.reason_code.as_deref())
        };
        return Ok((status, Json(command_receipt(registered, true))).into_response());
    }
    if !state
        .store
        .claim_command(&owner, *command_id.as_bytes(), &state.worker_id, 30)
        .await
        .map_err(|_| unavailable())?
    {
        return pending_response(registered);
    }

    let mut loaded = match load_round(&state.pool, *round_id.as_bytes()).await {
        Ok(value) => value,
        Err(_) => {
            return reject(
                &state,
                &owner,
                command_id,
                request_hash,
                0,
                "UNKNOWN_RESOURCE",
            )
            .await;
        }
    };
    let now = match database_now_unix_micros(&state.pool).await {
        Ok(value) => value,
        Err(_) => return pending_response(registered),
    };
    let seat_plan_event_id =
        derived_id(b"PSZS/EVENT/SeatPlanSealed/v1\0", command_id.as_bytes());
    let decision_event_id =
        derived_id(b"PSZS/EVENT/DecisionInputSealed/v1\0", command_id.as_bytes());
    let sealed = match loaded.desk.seal_seat_plan(
        body.canonical_version,
        now,
        loaded.content_session_id,
        layout_digest,
        seat_plan_event_id,
    ) {
        Ok(value) => value,
        Err(RoundDeskError::VersionConflict { actual, .. }) => {
            return reject(
                &state,
                &owner,
                command_id,
                request_hash,
                actual,
                "VERSION_CONFLICT",
            )
            .await;
        }
        Err(RoundDeskError::CutoffNotReached) => {
            return reject(
                &state,
                &owner,
                command_id,
                request_hash,
                loaded.desk.stream_version,
                "CUTOFF_NOT_REACHED",
            )
            .await;
        }
        Err(RoundDeskError::LayoutDigestMismatch) => {
            return reject(
                &state,
                &owner,
                command_id,
                request_hash,
                loaded.desk.stream_version,
                "LAYOUT_DIGEST_MISMATCH",
            )
            .await;
        }
        Err(_) => {
            return reject(
                &state,
                &owner,
                command_id,
                request_hash,
                loaded.desk.stream_version,
                "SESSION_HELD",
            )
            .await;
        }
    };
    let decision_version: i64 = sqlx::query_scalar(
        "SELECT COALESCE((SELECT stream_version FROM event_store.stream_heads \
           WHERE logical_cell_id = $1 AND stream_type = 'DecisionSession' AND stream_id = $2), 0)",
    )
    .bind(Uuid::from_bytes(loaded.desk.logical_cell_id))
    .bind(Uuid::from_bytes(loaded.decision_session_id))
    .fetch_one(&state.pool)
    .await
    .map_err(|_| unavailable())?;
    if decision_version != 0 {
        return reject(
            &state,
            &owner,
            command_id,
            request_hash,
            loaded.desk.stream_version,
            "SESSION_HELD",
        )
        .await;
    }
    let content = load_content(&state.pool, loaded.content_revision_id)
        .await
        .map_err(|_| unavailable())?;
    let (kernel_input, input_digest) =
        build_decision_input(&loaded, &content, decision_event_id, 1)
            .map_err(|_| unavailable())?;
    let input_bytes = canonical_bytes(&kernel_input);
    let snapshot_digest: [u8; 32] = kernel_input
        .snapshot_digest
        .as_slice()
        .try_into()
        .map_err(|_| unavailable())?;
    let algorithm = algorithm_digest();
    let kernel = kernel_abi_digest();
    let saved_event_id = loaded
        .desk
        .saved_plan
        .as_ref()
        .map(|value| value.saved_event_id)
        .ok_or_else(unavailable)?;
    let seat_plan_payload = v1::SeatPlanSealed {
        round_id: round_id.as_bytes().to_vec(),
        content_session_id: loaded.content_session_id.to_vec(),
        layout_digest: layout_digest.to_vec(),
        interaction_cutoff_unix_micros: loaded.desk.interaction_cutoff_unix_micros,
        database_committed_at_unix_micros: now,
        replay_patch: None,
        saved_event_id: saved_event_id.to_vec(),
    };
    let decision_payload = v1::DecisionInputSealed {
        decision_session_id: loaded.decision_session_id.to_vec(),
        seat_plan_digest: layout_digest.to_vec(),
        crew_snapshot_digest: content.digest.to_vec(),
        score_snapshot_digest: snapshot_digest.to_vec(),
        fact_pack_id: loaded.content_revision_id.to_vec(),
        appraisal_pack_id: loaded.content_revision_id.to_vec(),
        pack_bind_permit_id: loaded.content_session_id.to_vec(),
        benchmark_pack_id: loaded.content_revision_id.to_vec(),
        action_mask_digest: layout_digest.to_vec(),
        engine_digest: algorithm.to_vec(),
        snapshot_digest: snapshot_digest.to_vec(),
        kernel_abi: KERNEL_ABI.into(),
        algorithm_id: ALGORITHM_ID.into(),
        replay_patch: None,
        input_digest: input_digest.to_vec(),
        kernel_abi_digest: kernel.to_vec(),
        kernel_input_bytes: input_bytes,
        round_id: round_id.as_bytes().to_vec(),
        content_session_id: loaded.content_session_id.to_vec(),
        logical_cell_id: loaded.desk.logical_cell_id.to_vec(),
        ownership_epoch: loaded.desk.ownership_epoch,
        seat_plan_sealed_event_id: seat_plan_event_id.to_vec(),
        round_desk_version: sealed.stream_version,
        layout_digest: layout_digest.to_vec(),
        algorithm_digest: algorithm.to_vec(),
    };
    let append = state
        .store
        .append_registered(AppendRequest {
            command_id: *command_id.as_bytes(),
            command_owner: owner.clone(),
            idempotency_key: idempotency_key.to_owned(),
            command_digest: request_hash,
            preconditions: vec![
                StreamPrecondition {
                    logical_cell_id: loaded.desk.logical_cell_id,
                    stream_type: ROUND_STREAM.into(),
                    stream_id: *round_id.as_bytes(),
                    expected_version: body.canonical_version,
                    ownership_epoch: loaded.desk.ownership_epoch,
                },
                StreamPrecondition {
                    logical_cell_id: loaded.desk.logical_cell_id,
                    stream_type: DECISION_STREAM.into(),
                    stream_id: loaded.decision_session_id,
                    expected_version: 0,
                    ownership_epoch: loaded.desk.ownership_epoch,
                },
            ],
            events: vec![
                canonical_event(
                    seat_plan_event_id,
                    "SeatPlanSealed",
                    ROUND_STREAM,
                    *round_id.as_bytes(),
                    &loaded,
                    *command_id.as_bytes(),
                    now,
                    canonical_bytes(&seat_plan_payload),
                ),
                canonical_event(
                    decision_event_id,
                    "DecisionInputSealed",
                    DECISION_STREAM,
                    loaded.decision_session_id,
                    &loaded,
                    *command_id.as_bytes(),
                    now,
                    canonical_bytes(&decision_payload),
                ),
            ],
        })
        .await;
    match append {
        Ok(receipt) => Ok((
            StatusCode::OK,
            Json(CommandReceipt {
                command_id,
                disposition: if receipt.deduplicated {
                    "duplicate".into()
                } else {
                    "committed".into()
                },
                canonical_version: receipt.events[0].stream_version,
                retryable: false,
                reason_code: None,
                status_resource: format!("/v1/commands/{command_id}"),
            }),
        )
            .into_response()),
        Err(AppendError::VersionConflict { actual, .. }) => {
            reject(
                &state,
                &owner,
                command_id,
                request_hash,
                actual,
                "VERSION_CONFLICT",
            )
            .await
        }
        Err(_) => pending_response(registered),
    }
}

fn canonical_event(
    event_id: [u8; 16],
    event_type: &str,
    stream_type: &str,
    stream_id: [u8; 16],
    loaded: &panshi_application::LoadedRound,
    command_id: [u8; 16],
    now: i64,
    payload_bytes: Vec<u8>,
) -> NewEvent {
    NewEvent {
        event_id,
        event_type: event_type.into(),
        schema_version: 1,
        stream_type: stream_type.into(),
        stream_id,
        logical_cell_id: loaded.desk.logical_cell_id,
        ownership_epoch: loaded.desk.ownership_epoch,
        mode_domain: ModeDomain::Historical,
        causation_id: command_id,
        correlation_id: loaded.desk.round_id,
        trace_id: Uuid::from_bytes(command_id).to_string(),
        actor_bytes: b"system/sealer".to_vec(),
        occurred_at_unix_micros: now,
        policy_revision: "historical-beta/1".into(),
        model_revision: None,
        fact_revision: Some("synthetic-historical/1".into()),
        engine_artifact_digest: Some(algorithm_digest()),
        rights_scope: "synthetic-fixture".into(),
        data_class: "fictional".into(),
        visibility_epoch: 1,
        payload_bytes,
    }
}

fn command_receipt(record: CommandRecord, duplicate: bool) -> CommandReceipt {
    CommandReceipt {
        command_id: Uuid::from_bytes(record.command_id),
        disposition: match record.state {
            CommandState::Pending => "pending",
            CommandState::Committed if duplicate || record.is_replay => "duplicate",
            CommandState::Committed => "committed",
            CommandState::Rejected => "rejected",
        }
        .into(),
        canonical_version: record.canonical_version.unwrap_or(0),
        retryable: record.retryable,
        reason_code: record.reason_code,
        status_resource: record.status_resource,
    }
}

fn pending_response(record: CommandRecord) -> Result<Response, ApiError> {
    Ok((StatusCode::ACCEPTED, Json(command_receipt(record, false))).into_response())
}

fn rejection_status(reason: Option<&str>) -> StatusCode {
    if matches!(reason, Some("INVALID_PLACEMENT" | "LAYOUT_DIGEST_MISMATCH")) {
        StatusCode::UNPROCESSABLE_ENTITY
    } else {
        StatusCode::CONFLICT
    }
}

fn map_registration_error(error: AppendError) -> ApiError {
    if error == AppendError::IdempotencyDigestConflict {
        ApiError {
            status: StatusCode::CONFLICT,
            reason: "IDEMPOTENCY_KEY_REUSED",
            title: "這個重送識別已用於另一份配置",
        }
    } else {
        unavailable()
    }
}

fn parse_if_match(value: &str) -> Result<u64, ApiError> {
    value
        .strip_prefix("\"round:")
        .and_then(|value| value.strip_suffix('"'))
        .and_then(|value| value.parse().ok())
        .ok_or_else(invalid_request)
}

fn required_header<'a>(headers: &'a HeaderMap, name: &str) -> Result<&'a str, ApiError> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(invalid_request)
}

fn required_uuid_header(headers: &HeaderMap, name: &str) -> Result<Uuid, ApiError> {
    required_header(headers, name)?
        .parse()
        .map_err(|_| invalid_request())
}

fn derived_id(tag: &[u8], source: &[u8]) -> [u8; 16] {
    let mut hasher = Sha256::new();
    hasher.update(tag);
    hasher.update(source);
    let digest: [u8; 32] = hasher.finalize().into();
    let mut id: [u8; 16] = digest[..16].try_into().expect("fixed digest slice");
    id[6] = (id[6] & 0x0f) | 0x50;
    id[8] = (id[8] & 0x3f) | 0x80;
    id
}

fn invalid_request() -> ApiError {
    ApiError {
        status: StatusCode::BAD_REQUEST,
        reason: "INVALID_REQUEST",
        title: "請重新載入桌面後再送出",
    }
}

fn not_found() -> ApiError {
    ApiError {
        status: StatusCode::NOT_FOUND,
        reason: "UNKNOWN_RESOURCE",
        title: "找不到這一局封存劇本",
    }
}

fn unavailable() -> ApiError {
    ApiError {
        status: StatusCode::SERVICE_UNAVAILABLE,
        reason: "TEMPORARY_UNAVAILABLE",
        title: "這次操作還沒完成，配置已保留",
    }
}
