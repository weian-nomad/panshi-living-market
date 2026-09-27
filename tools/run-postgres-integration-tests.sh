#!/usr/bin/env bash
set -euo pipefail

# Runs every PostgreSQL integration test target against its OWN freshly
# created, then dropped, database -- rather than one shared
# `PANSHI_TEST_DATABASE_URL` across the whole workspace test run.
#
# Why this exists: `crates/event-store/tests/postgres_vertical_slice.rs`
# (the pre-existing legacy-v2 test) asserts unscoped, whole-table row counts
# (`SELECT count(*) FROM event_store.events`), on the assumption that it is
# the only thing ever writing to that table. That assumption was true when
# it was the only PostgreSQL integration test in this workspace. Adding V5
# siblings (`postgres_v5_multi_stream.rs`, and
# `tools/character-episode/tests/{postgres_replay,
# postgres_golden_failure_set}.rs`) that legitimately need to write to the
# same canonical event-store schema breaks that assumption if all of them
# share one persistent database across one `cargo test` invocation -- not
# because any test is wrong in isolation (each one passes cleanly on its
# own, which is exactly what this script proves), but because
# `cargo test --workspace` runs every integration test binary sequentially
# against whatever `PANSHI_TEST_DATABASE_URL` already contains.
#
# This script is the fix: give every Postgres integration test target its
# own database, so the workspace's existing legacy-v2 test and its new V5
# siblings can each be run individually, then discard the ad-hoc results,
# without ever touching `postgres_vertical_slice.rs`'s assertions.
#
# Requires a `psql`-reachable PostgreSQL superuser connection able to
# CREATE/DROP DATABASE, given via PANSHI_TEST_PG_SUPERUSER_URL (e.g.
# postgres://postgres@127.0.0.1:5544/postgres). Individual test databases
# are derived from that URL by substituting the database name.
#
# The same superuser connection is what
# `tools/character-episode/tests/postgres_model_worker_permissions.rs` needs
# to CREATE ROLE / SET ROLE / DROP ROLE its throwaway
# `panshi_test_model_worker_*` role (roles are cluster-wide, so that test
# drops its role itself; dropping the database does not).
#
# Local run against a Homebrew PostgreSQL on this machine, whose default
# superuser is the local account name (never hard-code it here):
#
#   pg_isready
#   PANSHI_TEST_PG_SUPERUSER_URL="postgres://$(whoami)@127.0.0.1:5432/postgres" \
#     bash tools/run-postgres-integration-tests.sh
#
# Every target runs against its own `panshi_v5_test_<target>` database,
# which is dropped again afterwards whether the target passed or failed.

if [ -z "${PANSHI_TEST_PG_SUPERUSER_URL:-}" ]; then
  echo "PANSHI_TEST_PG_SUPERUSER_URL is required (a postgres superuser connection able to CREATE/DROP DATABASE)" >&2
  exit 1
fi

workspace="$(cd "$(dirname "$0")/.." && pwd)"
cd "$workspace"

# package:test-binary pairs, in dependency order (event-store's own tests
# first, then the higher-level character-episode tests that build on it).
targets=(
  "panshi-event-store:postgres_vertical_slice"
  "panshi-event-store:postgres_v5_multi_stream"
  "panshi-character-episode:postgres_replay"
  "panshi-character-episode:postgres_golden_failure_set"
  "panshi-character-episode:postgres_slice_replay"
  "panshi-character-episode:postgres_model_worker_permissions"
)

base_url="${PANSHI_TEST_PG_SUPERUSER_URL%/*}"
overall_status=0

for target in "${targets[@]}"; do
  package="${target%%:*}"
  test_name="${target##*:}"
  database_name="panshi_v5_test_${test_name}"

  psql "$PANSHI_TEST_PG_SUPERUSER_URL" -c "DROP DATABASE IF EXISTS ${database_name};" >/dev/null
  psql "$PANSHI_TEST_PG_SUPERUSER_URL" -c "CREATE DATABASE ${database_name};" >/dev/null

  echo "== ${package}::${test_name} (database ${database_name}) =="
  if PANSHI_TEST_DATABASE_URL="${base_url}/${database_name}" \
     cargo test --locked -p "$package" --test "$test_name" -- --nocapture; then
    echo "-- ${test_name} passed"
  else
    echo "-- ${test_name} FAILED" >&2
    overall_status=1
  fi

  psql "$PANSHI_TEST_PG_SUPERUSER_URL" -c "DROP DATABASE IF EXISTS ${database_name};" >/dev/null
done

exit "$overall_status"
