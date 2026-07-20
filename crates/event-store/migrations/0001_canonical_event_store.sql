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

CREATE TABLE event_store.command_dedup (
  command_owner text NOT NULL CHECK (command_owner <> ''),
  idempotency_key text NOT NULL CHECK (idempotency_key <> ''),
  command_id uuid NOT NULL UNIQUE,
  request_hash bytea NOT NULL CHECK (octet_length(request_hash) = 32),
  result_hash bytea CHECK (result_hash IS NULL OR octet_length(result_hash) = 32),
  receipt_bytes bytea,
  event_ids uuid[],
  first_recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  PRIMARY KEY (command_owner, idempotency_key),
  CHECK (
    (result_hash IS NULL AND receipt_bytes IS NULL AND event_ids IS NULL AND completed_at IS NULL)
    OR (
      result_hash IS NOT NULL AND receipt_bytes IS NOT NULL AND event_ids IS NOT NULL
      AND cardinality(event_ids) > 0 AND completed_at IS NOT NULL
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
  command_id uuid NOT NULL REFERENCES event_store.command_dedup(command_id),
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
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  claimed_at timestamptz,
  claimed_by text,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  delivered_at timestamptz,
  last_error_class text,
  PRIMARY KEY (event_id),
  UNIQUE (global_position),
  FOREIGN KEY (event_id, global_position)
    REFERENCES event_store.events(event_id, global_position)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX outbox_claim_idx
  ON event_store.outbox (available_at, global_position)
  WHERE delivered_at IS NULL;

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
  completed_at timestamptz,
  result_digest bytea,
  PRIMARY KEY (consumer_id, event_id),
  CHECK (result_digest IS NULL OR octet_length(result_digest) = 32)
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

CREATE OR REPLACE FUNCTION event_store.require_complete_command_result()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  canonical_event_ids uuid[];
BEGIN
  IF NEW.completed_at IS NOT NULL THEN
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
BEFORE UPDATE ON event_store.command_dedup
FOR EACH ROW EXECUTE FUNCTION event_store.require_complete_command_result();

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
  inserted_count integer;
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
BEGIN
  IF jsonb_typeof(request->'preconditions') <> 'array'
     OR jsonb_array_length(request->'preconditions') = 0
     OR jsonb_typeof(request->'events') <> 'array'
     OR jsonb_array_length(request->'events') = 0
     OR octet_length(request_hash_value) <> 32 THEN
    RAISE EXCEPTION 'invalid append request' USING ERRCODE = '22023';
  END IF;

  INSERT INTO event_store.command_dedup (
    command_owner, idempotency_key, command_id, request_hash
  ) VALUES (
    command_owner_value, idempotency_key_value, command_id_value, request_hash_value
  ) ON CONFLICT (command_owner, idempotency_key) DO NOTHING;
  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  IF inserted_count = 0 THEN
    SELECT request_hash, receipt_bytes
      INTO stored_hash, stored_receipt
      FROM event_store.command_dedup
      WHERE command_owner = command_owner_value AND idempotency_key = idempotency_key_value
      FOR UPDATE;
    IF stored_hash <> request_hash_value THEN
      RAISE EXCEPTION 'idempotency digest conflict' USING ERRCODE = '23505';
    END IF;
    IF stored_receipt IS NULL THEN
      RAISE EXCEPTION 'incomplete idempotency record' USING ERRCODE = '40001';
    END IF;
    RETURN QUERY SELECT jsonb_set(
      convert_from(stored_receipt, 'UTF8')::jsonb,
      '{deduplicated}',
      'true'::jsonb
    );
    RETURN;
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

    INSERT INTO event_store.outbox (event_id, global_position)
    VALUES ((event_value->>'eventId')::uuid, event_position);

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
  UPDATE event_store.command_dedup
    SET result_hash = public.digest(
          convert_to('PSZS/APPEND_RECEIPT/v1', 'UTF8') || decode('00', 'hex') || receipt_bytes_value,
          'sha256'
        ),
        receipt_bytes = receipt_bytes_value,
        event_ids = event_ids_value,
        completed_at = clock_timestamp()
    WHERE command_owner = command_owner_value AND idempotency_key = idempotency_key_value;

  RETURN QUERY SELECT receipt_value;
END
$function$;

REVOKE ALL ON ALL TABLES IN SCHEMA event_store FROM PUBLIC, panshi_event_writer, panshi_event_reader;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA event_store FROM PUBLIC, panshi_event_writer, panshi_event_reader;
REVOKE ALL ON FUNCTION event_store.append_batch(jsonb) FROM PUBLIC;
GRANT USAGE ON SCHEMA event_store TO panshi_event_store_owner, panshi_event_writer, panshi_event_reader;
GRANT SELECT, INSERT, UPDATE ON event_store.stream_heads, event_store.command_dedup
  TO panshi_event_store_owner;
GRANT SELECT, INSERT ON event_store.events, event_store.outbox TO panshi_event_store_owner;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA event_store TO panshi_event_store_owner;
ALTER FUNCTION event_store.append_batch(jsonb) OWNER TO panshi_event_store_owner;
GRANT EXECUTE ON FUNCTION event_store.append_batch(jsonb) TO panshi_event_writer;
GRANT SELECT ON event_store.events, event_store.stream_heads, event_store.outbox,
  event_store.consumer_inbox, event_store.immutable_snapshots TO panshi_event_reader;

COMMIT;
