BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS event_store;

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'panshi_event_store_owner') THEN
    CREATE ROLE panshi_event_store_owner NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'panshi_event_writer') THEN
    CREATE ROLE panshi_event_writer NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'panshi_event_reader') THEN
    CREATE ROLE panshi_event_reader NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'panshi_game_core') THEN
    CREATE ROLE panshi_game_core NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'panshi_decision_runner') THEN
    CREATE ROLE panshi_decision_runner NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'panshi_projection_worker') THEN
    CREATE ROLE panshi_projection_worker NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'panshi_bootstrap') THEN
    CREATE ROLE panshi_bootstrap NOLOGIN NOINHERIT;
  END IF;
END
$roles$;

CREATE TABLE event_store.stream_heads (
  logical_cell_id uuid NOT NULL,
  stream_type text NOT NULL CHECK (stream_type <> ''),
  stream_id uuid NOT NULL,
  stream_version bigint NOT NULL CHECK (stream_version >= 0),
  last_event_hash bytea,
  ownership_epoch bigint NOT NULL CHECK (ownership_epoch > 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (logical_cell_id, stream_type, stream_id),
  CHECK (
    (stream_version = 0 AND last_event_hash IS NULL)
    OR (stream_version > 0 AND octet_length(last_event_hash) = 32)
  )
);

CREATE TABLE event_store.command_journal (
  command_owner text NOT NULL CHECK (command_owner <> ''),
  idempotency_key text NOT NULL CHECK (idempotency_key <> ''),
  idempotency_hash bytea NOT NULL CHECK (octet_length(idempotency_hash) = 32),
  command_id uuid NOT NULL UNIQUE,
  command_kind text NOT NULL CHECK (command_kind <> ''),
  command_bytes bytea NOT NULL,
  request_hash bytea NOT NULL CHECK (octet_length(request_hash) = 32),
  command_state text NOT NULL DEFAULT 'PENDING'
    CHECK (command_state IN ('PENDING', 'COMMITTED', 'REJECTED')),
  canonical_version bigint CHECK (canonical_version IS NULL OR canonical_version >= 0),
  retryable boolean NOT NULL DEFAULT true,
  reason_code text,
  status_resource text NOT NULL CHECK (status_resource <> ''),
  result_hash bytea CHECK (result_hash IS NULL OR octet_length(result_hash) = 32),
  receipt_bytes bytea,
  event_ids uuid[],
  lease_owner text,
  lease_until timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_infra_class text,
  first_recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  PRIMARY KEY (command_owner, idempotency_key),
  UNIQUE (command_owner, command_id),
  UNIQUE (command_owner, idempotency_hash),
  CHECK (
    (command_state = 'PENDING' AND result_hash IS NULL AND receipt_bytes IS NULL
      AND event_ids IS NULL AND completed_at IS NULL AND retryable)
    OR (
      command_state = 'COMMITTED' AND result_hash IS NOT NULL AND receipt_bytes IS NOT NULL
      AND event_ids IS NOT NULL AND cardinality(event_ids) > 0
      AND completed_at IS NOT NULL AND NOT retryable AND reason_code IS NULL
    )
    OR (
      command_state = 'REJECTED' AND result_hash IS NOT NULL AND receipt_bytes IS NOT NULL
      AND event_ids = ARRAY[]::uuid[] AND completed_at IS NOT NULL
      AND NOT retryable AND reason_code IS NOT NULL
    )
  ),
  CHECK (
    result_hash IS NULL OR result_hash = public.digest(
      convert_to('PSZS/APPEND_RECEIPT/v1', 'UTF8') || decode('00', 'hex') || receipt_bytes,
      'sha256'
    )
  )
);

CREATE OR REPLACE FUNCTION event_store.frame(value bytea)
RETURNS bytea
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $function$
  SELECT int8send(CASE WHEN value IS NULL THEN -1 ELSE octet_length(value) END::bigint)
         || COALESCE(value, ''::bytea)
$function$;

CREATE OR REPLACE FUNCTION event_store.canonical_event_hash(
  previous_event_hash bytea,
  event_id uuid,
  event_type text,
  schema_version integer,
  stream_type text,
  stream_id uuid,
  stream_version bigint,
  logical_cell_id uuid,
  ownership_epoch bigint,
  command_id uuid,
  causation_id uuid,
  correlation_id uuid,
  trace_id text,
  actor_bytes bytea,
  occurred_at_unix_micros bigint,
  policy_revision text,
  model_revision text,
  fact_revision text,
  engine_artifact_digest bytea,
  rights_scope text,
  data_class text,
  visibility_epoch bigint,
  payload_hash bytea
)
RETURNS bytea
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $function$
  SELECT public.digest(
    convert_to('PSZS/EVENT/v1', 'UTF8') || decode('00', 'hex')
    || event_store.frame(previous_event_hash)
    || event_store.frame(uuid_send(event_id))
    || event_store.frame(convert_to(event_type, 'UTF8'))
    || event_store.frame(int4send(schema_version))
    || event_store.frame(convert_to(stream_type, 'UTF8'))
    || event_store.frame(uuid_send(stream_id))
    || event_store.frame(int8send(stream_version))
    || event_store.frame(uuid_send(logical_cell_id))
    || event_store.frame(int8send(ownership_epoch))
    || event_store.frame(uuid_send(command_id))
    || event_store.frame(uuid_send(causation_id))
    || event_store.frame(uuid_send(correlation_id))
    || event_store.frame(convert_to(trace_id, 'UTF8'))
    || event_store.frame(actor_bytes)
    || event_store.frame(int8send(occurred_at_unix_micros))
    || event_store.frame(convert_to(policy_revision, 'UTF8'))
    || event_store.frame(convert_to(model_revision, 'UTF8'))
    || event_store.frame(convert_to(fact_revision, 'UTF8'))
    || event_store.frame(engine_artifact_digest)
    || event_store.frame(convert_to(rights_scope, 'UTF8'))
    || event_store.frame(convert_to(data_class, 'UTF8'))
    || event_store.frame(int8send(visibility_epoch))
    || event_store.frame(payload_hash),
    'sha256'
  )
$function$;

CREATE TABLE event_store.events (
  global_position bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id uuid NOT NULL UNIQUE,
  event_type text NOT NULL CHECK (event_type <> ''),
  schema_version integer NOT NULL CHECK (schema_version > 0),
  stream_type text NOT NULL CHECK (stream_type <> ''),
  stream_id uuid NOT NULL,
  stream_version bigint NOT NULL CHECK (stream_version > 0),
  logical_cell_id uuid NOT NULL,
  ownership_epoch bigint NOT NULL CHECK (ownership_epoch > 0),
  mode_domain text NOT NULL CHECK (mode_domain = 'HISTORICAL'),
  command_id uuid NOT NULL REFERENCES event_store.command_journal(command_id),
  causation_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  trace_id text NOT NULL CHECK (trace_id <> ''),
  actor_bytes bytea NOT NULL,
  occurred_at_unix_micros bigint NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  policy_revision text NOT NULL CHECK (policy_revision <> ''),
  model_revision text,
  fact_revision text,
  engine_artifact_digest bytea,
  rights_scope text NOT NULL CHECK (rights_scope <> ''),
  data_class text NOT NULL CHECK (data_class <> ''),
  visibility_epoch bigint NOT NULL CHECK (visibility_epoch >= 0),
  payload_bytes bytea NOT NULL,
  payload_hash bytea GENERATED ALWAYS AS (public.digest(payload_bytes, 'sha256')) STORED,
  previous_event_hash bytea,
  event_hash bytea NOT NULL,
  UNIQUE (logical_cell_id, stream_type, stream_id, stream_version),
  UNIQUE (event_id, global_position),
  CHECK (engine_artifact_digest IS NULL OR octet_length(engine_artifact_digest) = 32),
  CHECK (
    (stream_version = 1 AND previous_event_hash IS NULL)
    OR (stream_version > 1 AND octet_length(previous_event_hash) = 32)
  ),
  CHECK (octet_length(event_hash) = 32),
  CHECK (event_hash = event_store.canonical_event_hash(
    previous_event_hash, event_id, event_type, schema_version, stream_type,
    stream_id, stream_version, logical_cell_id, ownership_epoch, command_id,
    causation_id, correlation_id, trace_id, actor_bytes, occurred_at_unix_micros,
    policy_revision, model_revision, fact_revision, engine_artifact_digest,
    rights_scope, data_class, visibility_epoch, payload_hash
  ))
);

CREATE INDEX events_stream_replay_idx
  ON event_store.events (logical_cell_id, stream_type, stream_id, stream_version);
CREATE INDEX events_global_projection_idx ON event_store.events (global_position);

CREATE TABLE event_store.outbox (
  event_id uuid NOT NULL,
  global_position bigint NOT NULL,
  command_id uuid NOT NULL REFERENCES event_store.command_journal(command_id),
  command_ordinal integer NOT NULL CHECK (command_ordinal > 0),
  command_count integer NOT NULL CHECK (command_count > 0),
  event_hash bytea NOT NULL CHECK (octet_length(event_hash) = 32),
  logical_cell_id uuid NOT NULL,
  ownership_epoch bigint NOT NULL CHECK (ownership_epoch > 0),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (event_id),
  UNIQUE (global_position),
  UNIQUE (command_id, command_ordinal),
  CHECK (command_ordinal <= command_count),
  FOREIGN KEY (event_id, global_position)
    REFERENCES event_store.events(event_id, global_position)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX outbox_claim_idx
  ON event_store.outbox (available_at, global_position)
  INCLUDE (command_id, command_ordinal, command_count);

CREATE OR REPLACE FUNCTION event_store.require_outbox_pair()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM event_store.outbox
    WHERE event_id = NEW.event_id AND global_position = NEW.global_position
  ) THEN
    RAISE EXCEPTION 'canonical event requires exactly one outbox row' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END
$function$;

CREATE CONSTRAINT TRIGGER every_event_has_one_outbox
AFTER INSERT ON event_store.events
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION event_store.require_outbox_pair();

CREATE TABLE event_store.consumer_inbox (
  consumer_id text NOT NULL CHECK (consumer_id <> ''),
  event_id uuid NOT NULL,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  delivery_state text NOT NULL DEFAULT 'PENDING'
    CHECK (delivery_state IN ('PENDING', 'PROCESSING', 'APPLIED', 'QUARANTINED')),
  lease_owner text,
  lease_until timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error_class text,
  completed_at timestamptz,
  result_digest bytea,
  PRIMARY KEY (consumer_id, event_id),
  FOREIGN KEY (event_id) REFERENCES event_store.outbox(event_id),
  CHECK (
    (delivery_state IN ('PENDING', 'PROCESSING') AND completed_at IS NULL)
    OR (delivery_state IN ('APPLIED', 'QUARANTINED') AND completed_at IS NOT NULL)
  ),
  CHECK (result_digest IS NULL OR octet_length(result_digest) = 32)
);

CREATE INDEX consumer_inbox_claim_idx
  ON event_store.consumer_inbox (consumer_id, delivery_state, lease_until, received_at);

CREATE TABLE event_store.consumer_checkpoints (
  consumer_id text NOT NULL CHECK (consumer_id <> ''),
  logical_cell_id uuid NOT NULL,
  stream_type text NOT NULL CHECK (stream_type <> ''),
  stream_id uuid NOT NULL,
  stream_version bigint NOT NULL CHECK (stream_version >= 0),
  event_hash bytea CHECK (event_hash IS NULL OR octet_length(event_hash) = 32),
  global_position bigint NOT NULL CHECK (global_position >= 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (consumer_id, logical_cell_id, stream_type, stream_id),
  CHECK (
    (stream_version = 0 AND event_hash IS NULL)
    OR (stream_version > 0 AND octet_length(event_hash) = 32)
  )
);

CREATE SCHEMA IF NOT EXISTS projection;
CREATE SCHEMA IF NOT EXISTS content;

CREATE TABLE content.revisions (
  revision_id uuid PRIMARY KEY,
  artifact_kind text NOT NULL CHECK (artifact_kind <> ''),
  schema_version integer NOT NULL CHECK (schema_version > 0),
  payload_bytes bytea NOT NULL,
  payload_digest bytea GENERATED ALWAYS AS (public.digest(payload_bytes, 'sha256')) STORED,
  rights_scope text NOT NULL CHECK (rights_scope <> ''),
  data_class text NOT NULL CHECK (data_class <> ''),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (artifact_kind, payload_digest)
);

CREATE TABLE projection.round_desks (
  round_id uuid PRIMARY KEY,
  logical_cell_id uuid NOT NULL,
  ownership_epoch bigint NOT NULL CHECK (ownership_epoch > 0),
  canonical_version bigint NOT NULL CHECK (canonical_version >= 0),
  projection_version bigint NOT NULL CHECK (projection_version >= 0),
  layout_digest bytea CHECK (layout_digest IS NULL OR octet_length(layout_digest) = 32),
  decision_session_id uuid,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE projection.legal_action_previews (
  round_id uuid NOT NULL,
  canonical_version bigint NOT NULL CHECK (canonical_version >= 0),
  layout_digest bytea NOT NULL CHECK (octet_length(layout_digest) = 32),
  projection_version bigint NOT NULL CHECK (projection_version >= 0),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (round_id, canonical_version, layout_digest)
);

CREATE TABLE projection.decision_reveals (
  decision_session_id uuid PRIMARY KEY,
  canonical_version bigint NOT NULL CHECK (canonical_version >= 0),
  projection_version bigint NOT NULL CHECK (projection_version >= 0),
  action_digest bytea NOT NULL CHECK (octet_length(action_digest) = 32),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE projection.quarantine (
  consumer_id text NOT NULL,
  event_id uuid NOT NULL,
  error_class text NOT NULL CHECK (error_class <> ''),
  event_hash bytea NOT NULL CHECK (octet_length(event_hash) = 32),
  quarantined_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (consumer_id, event_id)
);

CREATE TABLE event_store.immutable_snapshots (
  snapshot_id uuid PRIMARY KEY,
  snapshot_type text NOT NULL CHECK (snapshot_type <> ''),
  schema_version integer NOT NULL CHECK (schema_version > 0),
  logical_cell_id uuid NOT NULL,
  stream_type text NOT NULL CHECK (stream_type <> ''),
  stream_id uuid NOT NULL,
  stream_version bigint NOT NULL CHECK (stream_version >= 0),
  payload_bytes bytea NOT NULL,
  payload_digest bytea GENERATED ALWAYS AS (public.digest(payload_bytes, 'sha256')) STORED,
  policy_revision text NOT NULL,
  algorithm_id text NOT NULL,
  kernel_abi text NOT NULL,
  engine_artifact_digest bytea NOT NULL CHECK (octet_length(engine_artifact_digest) = 32),
  model_revision text,
  fact_revision text,
  normalizer_revision text,
  rights_revision text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (snapshot_type, logical_cell_id, stream_type, stream_id, stream_version)
);

CREATE OR REPLACE FUNCTION event_store.reject_immutable_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'canonical rows are append-only' USING ERRCODE = '55000';
END
$function$;

CREATE TRIGGER events_are_immutable
BEFORE UPDATE OR DELETE ON event_store.events
FOR EACH ROW EXECUTE FUNCTION event_store.reject_immutable_mutation();

CREATE TRIGGER snapshots_are_immutable
BEFORE UPDATE OR DELETE ON event_store.immutable_snapshots
FOR EACH ROW EXECUTE FUNCTION event_store.reject_immutable_mutation();

CREATE TRIGGER content_revisions_are_immutable
BEFORE UPDATE OR DELETE ON content.revisions
FOR EACH ROW EXECUTE FUNCTION event_store.reject_immutable_mutation();

CREATE OR REPLACE FUNCTION event_store.require_complete_command_result()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  canonical_event_ids uuid[];
BEGIN
  IF NEW.command_state = 'COMMITTED' THEN
    SELECT array_agg(event_id ORDER BY global_position)
      INTO canonical_event_ids
      FROM event_store.events
      WHERE command_id = NEW.command_id;
    IF canonical_event_ids IS DISTINCT FROM NEW.event_ids THEN
      RAISE EXCEPTION 'command receipt event IDs do not match committed events' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER completed_command_result_is_exact
BEFORE UPDATE ON event_store.command_journal
FOR EACH ROW EXECUTE FUNCTION event_store.require_complete_command_result();

CREATE OR REPLACE FUNCTION event_store.reject_terminal_command_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.command_state IN ('COMMITTED', 'REJECTED') THEN
    RAISE EXCEPTION 'terminal command journal rows are immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.command_owner <> OLD.command_owner
     OR NEW.idempotency_key <> OLD.idempotency_key
     OR NEW.command_id <> OLD.command_id
     OR NEW.command_kind <> OLD.command_kind
     OR NEW.command_bytes <> OLD.command_bytes
     OR NEW.request_hash <> OLD.request_hash
     OR NEW.status_resource <> OLD.status_resource THEN
    RAISE EXCEPTION 'command identity and payload are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER terminal_command_is_immutable
BEFORE UPDATE OR DELETE ON event_store.command_journal
FOR EACH ROW EXECUTE FUNCTION event_store.reject_terminal_command_mutation();

CREATE OR REPLACE FUNCTION event_store.register_command_v1(request jsonb)
RETURNS TABLE (record jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, event_store, pg_temp
AS $function$
DECLARE
  command_owner_value text := request->>'commandOwner';
  idempotency_key_value text := request->>'idempotencyKey';
  command_id_value uuid := (request->>'commandId')::uuid;
  command_kind_value text := request->>'commandKind';
  command_bytes_value bytea := decode(request->>'commandHex', 'hex');
  request_hash_value bytea := decode(request->>'requestHashHex', 'hex');
  status_resource_value text := request->>'statusResource';
  row_value event_store.command_journal%ROWTYPE;
  inserted_count integer;
BEGIN
  IF command_owner_value IS NULL OR command_owner_value = ''
     OR idempotency_key_value IS NULL OR idempotency_key_value = ''
     OR command_kind_value IS NULL OR command_kind_value = ''
     OR status_resource_value IS NULL OR status_resource_value = ''
     OR octet_length(request_hash_value) <> 32 THEN
    RAISE EXCEPTION 'invalid command registration' USING ERRCODE = '22023';
  END IF;

  INSERT INTO event_store.command_journal (
    command_owner, idempotency_key, idempotency_hash,
    command_id, command_kind, command_bytes,
    request_hash, status_resource
  ) VALUES (
    command_owner_value, idempotency_key_value,
    public.digest(convert_to(idempotency_key_value, 'UTF8'), 'sha256'),
    command_id_value, command_kind_value,
    command_bytes_value, request_hash_value, status_resource_value
  ) ON CONFLICT (command_owner, idempotency_key) DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  SELECT * INTO row_value
    FROM event_store.command_journal
    WHERE command_owner = command_owner_value AND idempotency_key = idempotency_key_value
    FOR UPDATE;
  IF row_value.command_id <> command_id_value
     OR row_value.request_hash <> request_hash_value
     OR row_value.command_kind <> command_kind_value
     OR row_value.command_bytes <> command_bytes_value
     OR row_value.status_resource <> status_resource_value THEN
    RAISE EXCEPTION 'idempotency identity or digest conflict' USING ERRCODE = '23505';
  END IF;

  RETURN QUERY SELECT jsonb_build_object(
    'commandId', row_value.command_id,
    'commandKind', row_value.command_kind,
    'commandHex', encode(row_value.command_bytes, 'hex'),
    'requestHashHex', encode(row_value.request_hash, 'hex'),
    'state', row_value.command_state,
    'isReplay', inserted_count = 0,
    'canonicalVersion', row_value.canonical_version,
    'retryable', row_value.retryable,
    'reasonCode', row_value.reason_code,
    'statusResource', row_value.status_resource,
    'receiptHex', CASE WHEN row_value.receipt_bytes IS NULL THEN NULL
                       ELSE encode(row_value.receipt_bytes, 'hex') END
  );
END
$function$;

CREATE OR REPLACE FUNCTION event_store.claim_command_v1(
  owner_value text,
  command_id_value uuid,
  worker_value text,
  lease_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, event_store, pg_temp
AS $function$
DECLARE
  claimed integer;
BEGIN
  IF worker_value = '' OR lease_seconds < 1 OR lease_seconds > 300 THEN
    RAISE EXCEPTION 'invalid command lease' USING ERRCODE = '22023';
  END IF;
  UPDATE event_store.command_journal
    SET lease_owner = worker_value,
        lease_until = clock_timestamp() + make_interval(secs => lease_seconds),
        attempt_count = attempt_count + 1,
        updated_at = clock_timestamp()
    WHERE command_owner = owner_value AND command_id = command_id_value
      AND command_state = 'PENDING'
      AND (lease_until IS NULL OR lease_until < clock_timestamp() OR lease_owner = worker_value);
  GET DIAGNOSTICS claimed = ROW_COUNT;
  RETURN claimed = 1;
END
$function$;

CREATE OR REPLACE FUNCTION event_store.reject_command_v1(request jsonb)
RETURNS TABLE (receipt jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, event_store, pg_temp
AS $function$
DECLARE
  owner_value text := request->>'commandOwner';
  command_id_value uuid := (request->>'commandId')::uuid;
  request_hash_value bytea := decode(request->>'requestHashHex', 'hex');
  version_value bigint := (request->>'canonicalVersion')::bigint;
  reason_value text := request->>'reasonCode';
  row_value event_store.command_journal%ROWTYPE;
  receipt_value jsonb;
  receipt_bytes_value bytea;
BEGIN
  SELECT * INTO row_value FROM event_store.command_journal
    WHERE command_owner = owner_value AND command_id = command_id_value FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'command is not registered' USING ERRCODE = '22023';
  END IF;
  IF row_value.request_hash <> request_hash_value THEN
    RAISE EXCEPTION 'idempotency digest conflict' USING ERRCODE = '23505';
  END IF;
  IF row_value.command_state = 'COMMITTED' THEN
    RAISE EXCEPTION 'committed command cannot be rejected' USING ERRCODE = '55000';
  END IF;
  IF row_value.command_state = 'REJECTED' THEN
    RETURN QUERY SELECT convert_from(row_value.receipt_bytes, 'UTF8')::jsonb;
    RETURN;
  END IF;
  IF version_value < 0 OR reason_value IS NULL OR reason_value = '' THEN
    RAISE EXCEPTION 'invalid rejection' USING ERRCODE = '22023';
  END IF;

  receipt_value := jsonb_build_object(
    'commandId', command_id_value,
    'disposition', 'rejected',
    'canonicalVersion', version_value,
    'retryable', false,
    'reasonCode', reason_value,
    'statusResource', row_value.status_resource
  );
  receipt_bytes_value := convert_to(receipt_value::text, 'UTF8');
  UPDATE event_store.command_journal
    SET command_state = 'REJECTED', canonical_version = version_value,
        retryable = false, reason_code = reason_value,
        result_hash = public.digest(
          convert_to('PSZS/APPEND_RECEIPT/v1', 'UTF8') || decode('00', 'hex') || receipt_bytes_value,
          'sha256'
        ),
        receipt_bytes = receipt_bytes_value, event_ids = ARRAY[]::uuid[],
        completed_at = clock_timestamp(), updated_at = clock_timestamp(),
        lease_owner = NULL, lease_until = NULL
    WHERE command_owner = owner_value AND command_id = command_id_value;
  RETURN QUERY SELECT receipt_value;
END
$function$;

CREATE OR REPLACE FUNCTION event_store.append_batch(request jsonb)
RETURNS TABLE (receipt jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, event_store, pg_temp
AS $function$
DECLARE
  command_owner_value text := request->>'commandOwner';
  idempotency_key_value text := request->>'idempotencyKey';
  command_id_value uuid := (request->>'commandId')::uuid;
  request_hash_value bytea := decode(request->>'requestHashHex', 'hex');
  stored_hash bytea;
  stored_receipt bytea;
  stored_command_id uuid;
  stored_state text;
  precondition jsonb;
  event_value jsonb;
  current_version bigint;
  current_epoch bigint;
  previous_hash bytea;
  next_version bigint;
  payload_bytes_value bytea;
  payload_hash_value bytea;
  event_hash_value bytea;
  event_position bigint;
  event_ids_value uuid[] := ARRAY[]::uuid[];
  receipt_value jsonb := '[]'::jsonb;
  receipt_bytes_value bytea;
  canonical_version_value bigint := 0;
  event_ordinal_value integer := 0;
  event_count_value integer := jsonb_array_length(request->'events');
BEGIN
  IF jsonb_typeof(request->'preconditions') <> 'array'
     OR jsonb_array_length(request->'preconditions') = 0
     OR jsonb_typeof(request->'events') <> 'array'
     OR jsonb_array_length(request->'events') = 0
     OR octet_length(request_hash_value) <> 32 THEN
    RAISE EXCEPTION 'invalid append request' USING ERRCODE = '22023';
  END IF;

  SELECT command_id, request_hash, command_state, receipt_bytes
    INTO stored_command_id, stored_hash, stored_state, stored_receipt
    FROM event_store.command_journal
    WHERE command_owner = command_owner_value AND idempotency_key = idempotency_key_value
    FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'command must be durably registered before append' USING ERRCODE = '22023';
  END IF;
  IF stored_command_id <> command_id_value OR stored_hash <> request_hash_value THEN
    RAISE EXCEPTION 'idempotency identity or digest conflict' USING ERRCODE = '23505';
  END IF;
  IF stored_state = 'COMMITTED' THEN
    RETURN QUERY SELECT jsonb_set(
      convert_from(stored_receipt, 'UTF8')::jsonb,
      '{deduplicated}',
      'true'::jsonb
    );
    RETURN;
  END IF;
  IF stored_state = 'REJECTED' THEN
    RAISE EXCEPTION 'rejected command cannot append events' USING ERRCODE = '55000';
  END IF;

  FOR precondition IN
    SELECT value FROM jsonb_array_elements(request->'preconditions')
    ORDER BY value->>'logicalCellId', value->>'streamType', value->>'streamId'
  LOOP
    IF (precondition->>'ownershipEpoch')::bigint <= 0
       OR (precondition->>'expectedVersion')::bigint < 0 THEN
      RAISE EXCEPTION 'invalid stream precondition' USING ERRCODE = '22023';
    END IF;
    INSERT INTO event_store.stream_heads (
      logical_cell_id, stream_type, stream_id, stream_version, ownership_epoch
    ) VALUES (
      (precondition->>'logicalCellId')::uuid,
      precondition->>'streamType',
      (precondition->>'streamId')::uuid,
      0,
      (precondition->>'ownershipEpoch')::bigint
    ) ON CONFLICT DO NOTHING;

    SELECT stream_version, ownership_epoch
      INTO current_version, current_epoch
      FROM event_store.stream_heads
      WHERE logical_cell_id = (precondition->>'logicalCellId')::uuid
        AND stream_type = precondition->>'streamType'
        AND stream_id = (precondition->>'streamId')::uuid
      FOR UPDATE;
    IF current_version <> (precondition->>'expectedVersion')::bigint THEN
      RAISE EXCEPTION 'stream version conflict' USING
        ERRCODE = '40001',
        DETAIL = jsonb_build_object(
          'kind', 'version',
          'streamType', precondition->>'streamType',
          'streamId', precondition->>'streamId',
          'expected', (precondition->>'expectedVersion')::bigint,
          'actual', current_version
        )::text;
    END IF;
    IF current_epoch <> (precondition->>'ownershipEpoch')::bigint THEN
      RAISE EXCEPTION 'ownership epoch conflict' USING
        ERRCODE = '40001',
        DETAIL = jsonb_build_object(
          'kind', 'ownershipEpoch',
          'expected', (precondition->>'ownershipEpoch')::bigint,
          'actual', current_epoch
        )::text;
    END IF;
  END LOOP;

  FOR event_value IN SELECT value FROM jsonb_array_elements(request->'events')
  LOOP
    event_ordinal_value := event_ordinal_value + 1;
    SELECT stream_version, ownership_epoch, last_event_hash
      INTO current_version, current_epoch, previous_hash
      FROM event_store.stream_heads
      WHERE logical_cell_id = (event_value->>'logicalCellId')::uuid
        AND stream_type = event_value->>'streamType'
        AND stream_id = (event_value->>'streamId')::uuid
      FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'event has no stream precondition' USING ERRCODE = '22023';
    END IF;
    IF current_epoch <> (event_value->>'ownershipEpoch')::bigint THEN
      RAISE EXCEPTION 'event ownership epoch conflict' USING
        ERRCODE = '40001',
        DETAIL = jsonb_build_object(
          'kind', 'ownershipEpoch',
          'expected', (event_value->>'ownershipEpoch')::bigint,
          'actual', current_epoch
        )::text;
    END IF;

    next_version := current_version + 1;
    canonical_version_value := greatest(canonical_version_value, next_version);
    payload_bytes_value := decode(event_value->>'payloadHex', 'hex');
    payload_hash_value := public.digest(payload_bytes_value, 'sha256');
    event_hash_value := event_store.canonical_event_hash(
      previous_hash,
      (event_value->>'eventId')::uuid,
      event_value->>'eventType',
      (event_value->>'schemaVersion')::integer,
      event_value->>'streamType',
      (event_value->>'streamId')::uuid,
      next_version,
      (event_value->>'logicalCellId')::uuid,
      (event_value->>'ownershipEpoch')::bigint,
      command_id_value,
      (event_value->>'causationId')::uuid,
      (event_value->>'correlationId')::uuid,
      event_value->>'traceId',
      decode(event_value->>'actorHex', 'hex'),
      (event_value->>'occurredAtUnixMicros')::bigint,
      event_value->>'policyRevision',
      event_value->>'modelRevision',
      event_value->>'factRevision',
      CASE WHEN event_value->>'engineArtifactDigestHex' IS NULL THEN NULL
           ELSE decode(event_value->>'engineArtifactDigestHex', 'hex') END,
      event_value->>'rightsScope',
      event_value->>'dataClass',
      (event_value->>'visibilityEpoch')::bigint,
      payload_hash_value
    );

    INSERT INTO event_store.events (
      event_id, event_type, schema_version, stream_type, stream_id, stream_version,
      logical_cell_id, ownership_epoch, mode_domain, command_id, causation_id,
      correlation_id, trace_id, actor_bytes, occurred_at_unix_micros,
      policy_revision, model_revision, fact_revision, engine_artifact_digest,
      rights_scope, data_class, visibility_epoch, payload_bytes,
      previous_event_hash, event_hash
    ) VALUES (
      (event_value->>'eventId')::uuid, event_value->>'eventType',
      (event_value->>'schemaVersion')::integer, event_value->>'streamType',
      (event_value->>'streamId')::uuid, next_version,
      (event_value->>'logicalCellId')::uuid, (event_value->>'ownershipEpoch')::bigint,
      event_value->>'modeDomain', command_id_value,
      (event_value->>'causationId')::uuid, (event_value->>'correlationId')::uuid,
      event_value->>'traceId', decode(event_value->>'actorHex', 'hex'),
      (event_value->>'occurredAtUnixMicros')::bigint, event_value->>'policyRevision',
      event_value->>'modelRevision', event_value->>'factRevision',
      CASE WHEN event_value->>'engineArtifactDigestHex' IS NULL THEN NULL
           ELSE decode(event_value->>'engineArtifactDigestHex', 'hex') END,
      event_value->>'rightsScope', event_value->>'dataClass',
      (event_value->>'visibilityEpoch')::bigint, payload_bytes_value,
      previous_hash, event_hash_value
    ) RETURNING global_position INTO event_position;

    INSERT INTO event_store.outbox (
      event_id, global_position, command_id, command_ordinal, command_count,
      event_hash, logical_cell_id, ownership_epoch
    ) VALUES (
      (event_value->>'eventId')::uuid, event_position, command_id_value,
      event_ordinal_value, event_count_value, event_hash_value,
      (event_value->>'logicalCellId')::uuid,
      (event_value->>'ownershipEpoch')::bigint
    );

    UPDATE event_store.stream_heads
      SET stream_version = next_version, last_event_hash = event_hash_value,
          updated_at = clock_timestamp()
      WHERE logical_cell_id = (event_value->>'logicalCellId')::uuid
        AND stream_type = event_value->>'streamType'
        AND stream_id = (event_value->>'streamId')::uuid;

    event_ids_value := array_append(event_ids_value, (event_value->>'eventId')::uuid);
    receipt_value := receipt_value || jsonb_build_array(jsonb_build_object(
      'eventId', event_value->>'eventId',
      'streamVersion', next_version,
      'globalPosition', event_position,
      'payloadHashHex', encode(payload_hash_value, 'hex'),
      'eventHashHex', encode(event_hash_value, 'hex')
    ));
  END LOOP;

  receipt_value := jsonb_build_object(
    'commandId', command_id_value,
    'deduplicated', false,
    'events', receipt_value
  );
  receipt_bytes_value := convert_to(receipt_value::text, 'UTF8');
  UPDATE event_store.command_journal
    SET command_state = 'COMMITTED', canonical_version = canonical_version_value,
        retryable = false, reason_code = NULL,
        result_hash = public.digest(
          convert_to('PSZS/APPEND_RECEIPT/v1', 'UTF8') || decode('00', 'hex') || receipt_bytes_value,
          'sha256'
        ),
        receipt_bytes = receipt_bytes_value,
        event_ids = event_ids_value,
        completed_at = clock_timestamp(), updated_at = clock_timestamp(),
        lease_owner = NULL, lease_until = NULL
    WHERE command_owner = command_owner_value AND idempotency_key = idempotency_key_value;

  RETURN QUERY SELECT receipt_value;
END
$function$;

CREATE OR REPLACE FUNCTION event_store.claim_outbox_batch_v1(
  consumer_value text,
  worker_value text,
  lease_seconds integer,
  event_type_filter text,
  whole_command boolean
)
RETURNS TABLE (batch jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, event_store, pg_temp
AS $function$
DECLARE
  command_id_value uuid;
  claimed_ids uuid[];
BEGIN
  IF consumer_value = '' OR worker_value = '' OR lease_seconds < 1 OR lease_seconds > 300 THEN
    RAISE EXCEPTION 'invalid consumer lease' USING ERRCODE = '22023';
  END IF;

  SELECT outbox.command_id INTO command_id_value
    FROM event_store.outbox AS outbox
    JOIN event_store.events AS event ON event.event_id = outbox.event_id
    LEFT JOIN event_store.consumer_inbox AS inbox
      ON inbox.consumer_id = consumer_value AND inbox.event_id = outbox.event_id
    WHERE (event_type_filter IS NULL OR event.event_type = event_type_filter)
      AND (
        inbox.event_id IS NULL OR inbox.delivery_state = 'PENDING'
        OR (inbox.delivery_state = 'PROCESSING' AND inbox.lease_until < clock_timestamp())
      )
    ORDER BY outbox.global_position
    FOR UPDATE OF outbox SKIP LOCKED
    LIMIT 1;

  IF command_id_value IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO event_store.consumer_inbox (consumer_id, event_id)
    SELECT consumer_value, outbox.event_id
      FROM event_store.outbox AS outbox
      JOIN event_store.events AS event ON event.event_id = outbox.event_id
      WHERE outbox.command_id = command_id_value
        AND (whole_command OR event.event_type = event_type_filter)
    ON CONFLICT (consumer_id, event_id) DO NOTHING;

  UPDATE event_store.consumer_inbox AS inbox
    SET delivery_state = 'PROCESSING', lease_owner = worker_value,
        lease_until = clock_timestamp() + make_interval(secs => lease_seconds),
        attempt_count = attempt_count + 1, last_error_class = NULL
    FROM event_store.outbox AS outbox, event_store.events AS event
    WHERE inbox.consumer_id = consumer_value AND inbox.event_id = outbox.event_id
      AND event.event_id = outbox.event_id AND outbox.command_id = command_id_value
      AND (whole_command OR event.event_type = event_type_filter)
      AND (
        inbox.delivery_state = 'PENDING'
        OR (inbox.delivery_state = 'PROCESSING'
            AND (inbox.lease_until < clock_timestamp() OR inbox.lease_owner = worker_value))
      );

  SELECT array_agg(inbox.event_id ORDER BY outbox.command_ordinal) INTO claimed_ids
    FROM event_store.consumer_inbox AS inbox
    JOIN event_store.outbox AS outbox ON outbox.event_id = inbox.event_id
    WHERE inbox.consumer_id = consumer_value AND outbox.command_id = command_id_value
      AND inbox.delivery_state = 'PROCESSING' AND inbox.lease_owner = worker_value;
  IF claimed_ids IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT jsonb_build_object(
      'commandId', command_id_value,
      'eventIds', to_jsonb(claimed_ids),
      'events', jsonb_agg(jsonb_build_object(
        'eventId', event.event_id,
        'eventType', event.event_type,
        'schemaVersion', event.schema_version,
        'streamType', event.stream_type,
        'streamId', event.stream_id,
        'streamVersion', event.stream_version,
        'logicalCellId', event.logical_cell_id,
        'ownershipEpoch', event.ownership_epoch,
        'globalPosition', event.global_position,
        'eventHashHex', encode(event.event_hash, 'hex'),
        'payloadHashHex', encode(event.payload_hash, 'hex'),
        'payloadHex', encode(event.payload_bytes, 'hex'),
        'commandOrdinal', outbox.command_ordinal,
        'commandCount', outbox.command_count
      ) ORDER BY outbox.command_ordinal)
    )
    FROM event_store.outbox AS outbox
    JOIN event_store.events AS event ON event.event_id = outbox.event_id
    WHERE outbox.event_id = ANY(claimed_ids);
END
$function$;

CREATE OR REPLACE FUNCTION event_store.complete_outbox_batch_v1(
  consumer_value text,
  worker_value text,
  event_ids_value uuid[],
  terminal_state text,
  result_digest_value bytea,
  error_class_value text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, event_store, pg_temp
AS $function$
DECLARE
  completed integer;
BEGIN
  IF terminal_state NOT IN ('APPLIED', 'QUARANTINED')
     OR cardinality(event_ids_value) = 0
     OR (result_digest_value IS NOT NULL AND octet_length(result_digest_value) <> 32)
     OR (terminal_state = 'QUARANTINED' AND COALESCE(error_class_value, '') = '') THEN
    RAISE EXCEPTION 'invalid consumer completion' USING ERRCODE = '22023';
  END IF;
  UPDATE event_store.consumer_inbox
    SET delivery_state = terminal_state, completed_at = clock_timestamp(),
        result_digest = result_digest_value, last_error_class = error_class_value,
        lease_owner = NULL, lease_until = NULL
    WHERE consumer_id = consumer_value AND event_id = ANY(event_ids_value)
      AND delivery_state = 'PROCESSING' AND lease_owner = worker_value;
  GET DIAGNOSTICS completed = ROW_COUNT;
  IF completed <> cardinality(event_ids_value) THEN
    RAISE EXCEPTION 'consumer lease lost before completion' USING ERRCODE = '40001';
  END IF;
END
$function$;

REVOKE ALL ON ALL TABLES IN SCHEMA event_store FROM PUBLIC, panshi_event_writer, panshi_event_reader;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA event_store FROM PUBLIC, panshi_event_writer, panshi_event_reader;
REVOKE ALL ON FUNCTION event_store.append_batch(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION event_store.register_command_v1(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION event_store.reject_command_v1(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION event_store.claim_command_v1(text, uuid, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION event_store.claim_outbox_batch_v1(text, text, integer, text, boolean)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION event_store.complete_outbox_batch_v1(text, text, uuid[], text, bytea, text)
  FROM PUBLIC;
GRANT USAGE ON SCHEMA event_store TO panshi_event_store_owner, panshi_event_writer, panshi_event_reader;
GRANT SELECT, INSERT, UPDATE ON event_store.stream_heads, event_store.command_journal
  TO panshi_event_store_owner;
GRANT SELECT, INSERT ON event_store.events TO panshi_event_store_owner;
GRANT SELECT, INSERT, UPDATE ON event_store.outbox TO panshi_event_store_owner;
GRANT SELECT, INSERT, UPDATE ON event_store.consumer_inbox,
  event_store.consumer_checkpoints TO panshi_event_store_owner;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA event_store TO panshi_event_store_owner;
ALTER FUNCTION event_store.append_batch(jsonb) OWNER TO panshi_event_store_owner;
ALTER FUNCTION event_store.register_command_v1(jsonb) OWNER TO panshi_event_store_owner;
ALTER FUNCTION event_store.reject_command_v1(jsonb) OWNER TO panshi_event_store_owner;
ALTER FUNCTION event_store.claim_command_v1(text, uuid, text, integer) OWNER TO panshi_event_store_owner;
ALTER FUNCTION event_store.claim_outbox_batch_v1(text, text, integer, text, boolean)
  OWNER TO panshi_event_store_owner;
ALTER FUNCTION event_store.complete_outbox_batch_v1(text, text, uuid[], text, bytea, text)
  OWNER TO panshi_event_store_owner;
GRANT EXECUTE ON FUNCTION event_store.append_batch(jsonb) TO panshi_event_writer;
GRANT EXECUTE ON FUNCTION event_store.register_command_v1(jsonb) TO panshi_event_writer;
GRANT EXECUTE ON FUNCTION event_store.reject_command_v1(jsonb) TO panshi_event_writer;
GRANT EXECUTE ON FUNCTION event_store.claim_command_v1(text, uuid, text, integer)
  TO panshi_event_writer;
GRANT EXECUTE ON FUNCTION event_store.claim_outbox_batch_v1(text, text, integer, text, boolean)
  TO panshi_event_reader;
GRANT EXECUTE ON FUNCTION event_store.complete_outbox_batch_v1(text, text, uuid[], text, bytea, text)
  TO panshi_event_reader;
GRANT SELECT ON event_store.events, event_store.stream_heads, event_store.outbox,
  event_store.consumer_inbox, event_store.consumer_checkpoints,
  event_store.immutable_snapshots,
  event_store.command_journal TO panshi_event_reader;

REVOKE ALL ON ALL TABLES IN SCHEMA projection FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA content FROM PUBLIC;
GRANT USAGE ON SCHEMA projection TO panshi_game_core, panshi_projection_worker;
GRANT USAGE ON SCHEMA content TO panshi_game_core, panshi_projection_worker, panshi_bootstrap;
GRANT SELECT ON content.revisions TO panshi_game_core, panshi_projection_worker;
GRANT SELECT, INSERT ON content.revisions TO panshi_bootstrap;
GRANT SELECT ON projection.round_desks, projection.legal_action_previews,
  projection.decision_reveals TO panshi_game_core;
GRANT SELECT, INSERT, UPDATE, DELETE ON projection.round_desks,
  projection.legal_action_previews, projection.decision_reveals,
  projection.quarantine TO panshi_projection_worker;

COMMIT;
