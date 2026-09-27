//! A model worker has no canonical write authority: a model result is only
//! ever an input to the owning context's command path, which alone appends
//! canonical events. This proves it at the database-permission layer, not by convention: a
//! database role that stands in for the `model-runner` process -- given read
//! access to canonical events through `panshi_event_reader`, but never
//! `panshi_event_writer` -- is refused with SQLSTATE 42501
//! (`insufficient_privilege`) both when it calls
//! `event_store.append_batch` and when it tries to `INSERT` straight into
//! `event_store.events`.
//!
//! Controls keep the refusal from passing vacuously: each denial must name
//! the object it was refused on (the `append_batch` function, the `events`
//! table), the same session can `SELECT` from `event_store.events` under
//! that role (so the role is really in effect and the denial is specific to
//! writing), and the exact same `append_batch` request succeeds once the
//! role is reset (so the request itself is well-formed and only the role
//! differs).
//!
//! That positive control runs as the connecting (migrating) session, not as
//! `SET ROLE panshi_event_writer`. Observed on `PostgreSQL` 16: a session
//! whose only role is `panshi_event_writer` gets through `append_batch`
//! (SECURITY DEFINER) but is then refused with 42501 "permission denied for
//! table outbox" at COMMIT, because the deferred constraint trigger
//! `every_event_has_one_outbox` runs `event_store.require_outbox_pair()`
//! (not SECURITY DEFINER) as the session role, which has no SELECT on
//! `event_store.outbox`. That is a gap in the canonical migration's grants,
//! outside what this test may change; it does not weaken this test's claim,
//! which is only that a model worker is refused.
//!
//! The role is cluster-wide, so it gets a unique `panshi_test_model_worker_`
//! name, and the test always `RESET ROLE`s and `DROP ROLE`s it -- before any
//! assertion can fail.
//!
//! Requires `PANSHI_TEST_DATABASE_URL` for a role able to `CREATE ROLE` and
//! `SET ROLE` (the superuser connection
//! `tools/run-postgres-integration-tests.sh` derives); skipped without it.

mod support;

use std::time::{SystemTime, UNIX_EPOCH};

use panshi_character_episode::slice::one_character_slice;
// Role names cannot be bound as parameters. The only dynamic SQL here
// interpolates a role name this test builds itself from a fixed prefix, the
// process id and a clock reading (ASCII letters, digits and `_` only).
use sqlx::{AssertSqlSafe, Connection as _, PgConnection};
use support::{
    append_batch_json, build_requests, connect_and_migrate, database_url_or_skip, logical_cell_for,
    slice_command_plan, uuid,
};

const INSUFFICIENT_PRIVILEGE: &str = "42501";

/// A refused statement's SQLSTATE and message.
#[derive(Debug)]
struct Refusal {
    code: Option<String>,
    message: String,
}

/// `Ok` if the statement unexpectedly succeeded, otherwise its refusal.
fn sqlstate<T>(result: Result<T, sqlx::Error>) -> Result<(), Refusal> {
    match result {
        Ok(_) => Ok(()),
        Err(error) => Err(Refusal {
            code: error
                .as_database_error()
                .and_then(|database| database.code().map(std::borrow::Cow::into_owned)),
            message: error.to_string(),
        }),
    }
}

fn assert_refused(observed: &Result<(), Refusal>, object: &str, what: &str) {
    match observed {
        Ok(()) => panic!("{what}: the statement was accepted"),
        Err(refusal) => {
            assert_eq!(
                refusal.code.as_deref(),
                Some(INSUFFICIENT_PRIVILEGE),
                "{what}: expected SQLSTATE 42501, got {refusal:?}"
            );
            assert!(
                refusal.message.contains(object),
                "{what}: the refusal must name {object:?}, got {refusal:?}"
            );
        }
    }
}

/// What the model-worker session observed. Collected without panicking so
/// the role is always cleaned up before anything is asserted.
struct Observed {
    can_read: Result<(), Refusal>,
    append_batch: Result<(), Refusal>,
    direct_insert: Result<(), Refusal>,
}

async fn attempt_as(
    connection: &mut PgConnection,
    role: &str,
    request_json: &serde_json::Value,
) -> Result<Observed, sqlx::Error> {
    sqlx::query(AssertSqlSafe(format!("SET ROLE {role}")))
        .execute(&mut *connection)
        .await?;

    let can_read = sqlstate(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM event_store.events")
            .fetch_one(&mut *connection)
            .await,
    );
    let append_batch = sqlstate(
        sqlx::query("SELECT receipt FROM event_store.append_batch($1::jsonb)")
            .bind(request_json)
            .fetch_all(&mut *connection)
            .await,
    );
    let event = &request_json["events"][0];
    let direct_insert = sqlstate(
        sqlx::query(
            "INSERT INTO event_store.events (\
               event_id, event_type, schema_version, stream_type, stream_id, stream_version, \
               logical_cell_id, ownership_epoch, mode_domain, command_id, causation_id, \
               correlation_id, trace_id, actor_bytes, occurred_at_unix_micros, policy_revision, \
               rights_scope, data_class, visibility_epoch, payload_bytes, event_hash\
             ) VALUES (\
               $1::uuid, $2, 1, $3, $4::uuid, 1, $5::uuid, 1, 'CURRENT', $6::uuid, $6::uuid, \
               $6::uuid, 'model-worker', '\\x00', 0, 'model-worker/v1', 'synthetic-fixture', \
               'fictional_canonical', 1, decode($7, 'hex'), decode(repeat('00', 32), 'hex')\
             )",
        )
        .bind(event["eventId"].as_str())
        .bind(event["eventType"].as_str())
        .bind(event["streamType"].as_str())
        .bind(event["streamId"].as_str())
        .bind(event["logicalCellId"].as_str())
        .bind(request_json["commandId"].as_str())
        .bind(event["payloadHex"].as_str())
        .execute(&mut *connection)
        .await,
    );
    Ok(Observed {
        can_read,
        append_batch,
        direct_insert,
    })
}

#[tokio::test]
async fn model_worker_role_cannot_append_canonical_events() {
    let Some(url) = database_url_or_skip() else {
        return;
    };
    // Apply migrations first (creates the canonical roles and grants).
    drop(connect_and_migrate(&url).await);

    let slice = one_character_slice();
    let plan = slice_command_plan(&slice);
    let logical_cell_id = logical_cell_for("model-worker-permissions");
    let requests = build_requests(
        &slice,
        &plan,
        logical_cell_id,
        "v5-model-worker-permission-test",
    );
    // The slice's first command opens the paper account at stream version
    // zero, so it needs no earlier state to be a valid request.
    let request_json = append_batch_json(&requests[0]);

    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock after epoch")
        .as_nanos();
    let role = format!("panshi_test_model_worker_{}_{nanos}", std::process::id());

    let mut connection = PgConnection::connect(&url)
        .await
        .expect("connect test database");
    sqlx::query(AssertSqlSafe(format!("CREATE ROLE {role} NOLOGIN")))
        .execute(&mut connection)
        .await
        .expect("create model worker role");
    let observed = match sqlx::query(AssertSqlSafe(format!(
        "GRANT panshi_event_reader TO {role}"
    )))
    .execute(&mut connection)
    .await
    {
        Ok(_) => attempt_as(&mut connection, &role, &request_json).await,
        Err(error) => Err(error),
    };

    // Always clean up before asserting anything.
    // `DROP OWNED BY` first revokes whatever the role was granted in this
    // database, which `DROP ROLE` would otherwise refuse to drop (2BP01).
    let reset = sqlx::query("RESET ROLE").execute(&mut connection).await;
    let disowned = sqlx::query(AssertSqlSafe(format!("DROP OWNED BY {role}")))
        .execute(&mut connection)
        .await;
    let dropped = sqlx::query(AssertSqlSafe(format!("DROP ROLE IF EXISTS {role}")))
        .execute(&mut connection)
        .await;
    let observed = observed.expect("run the model worker session");
    reset.expect("reset role");
    disowned.expect("revoke model worker role privileges");
    dropped.expect("drop model worker role");

    assert!(
        observed.can_read.is_ok(),
        "the model worker role must be in effect and able to read canonical events: {:?}",
        observed.can_read
    );
    assert_refused(
        &observed.append_batch,
        "function append_batch",
        "a model worker must not be able to execute event_store.append_batch",
    );
    assert_refused(
        &observed.direct_insert,
        "table events",
        "a model worker must not be able to insert into event_store.events",
    );
    let (leftover_roles,): (i64,) =
        sqlx::query_as("SELECT count(*) FROM pg_roles WHERE rolname = $1")
            .bind(&role)
            .fetch_one(&mut connection)
            .await
            .expect("count leftover roles");
    assert_eq!(leftover_roles, 0, "the test role must be dropped");

    let (events_after_denial,): (i64,) =
        sqlx::query_as("SELECT count(*) FROM event_store.events WHERE logical_cell_id = $1")
            .bind(uuid(logical_cell_id))
            .fetch_one(&mut connection)
            .await
            .expect("count events after denial");
    assert_eq!(
        events_after_denial, 0,
        "a refused model worker must leave no canonical event behind"
    );

    // Control: once the role is reset, the identical request is accepted
    // (see the module docs for why this is not `SET ROLE panshi_event_writer`).
    sqlx::query("SELECT receipt FROM event_store.append_batch($1::jsonb)")
        .bind(&request_json)
        .fetch_all(&mut connection)
        .await
        .expect("the same request must be accepted once the model worker role is reset");
    let (events_after_control,): (i64,) =
        sqlx::query_as("SELECT count(*) FROM event_store.events WHERE logical_cell_id = $1")
            .bind(uuid(logical_cell_id))
            .fetch_one(&mut connection)
            .await
            .expect("count events after control");
    assert_eq!(
        usize::try_from(events_after_control).unwrap(),
        requests[0].events.len(),
        "the control must append exactly the request's events"
    );
}
