#!/usr/bin/env bash
set -euo pipefail

# V5 sibling of tools/verify-kernel-parity.sh: proves the one-character
# golden episode (tools/character-episode) produces byte-identical canonical
# event payloads in native and WASI builds, and that those bytes match the
# checked-in golden fixture in fixtures/v5/character-episode-001/.
#
# This does not by itself prove the PostgreSQL leg of the three-way parity
# requirement (docs/v5/system-design.md's "native／WASI／PostgreSQL
# execution produces identical canonical bytes") -- that is proven by
# tools/character-episode/tests/postgres_replay.rs, which re-derives each
# event's canonical bytes independently and compares them against what was
# actually persisted and read back from PostgreSQL.

if ! command -v wasmtime >/dev/null 2>&1; then
  echo "wasmtime is required for native/WASI byte parity" >&2
  exit 1
fi

workspace="$(cd "$(dirname "$0")/.." && pwd)"
temporary="$(mktemp -d)"
trap 'rm -rf "$temporary"' EXIT

cd "$workspace"
cargo build --locked -p panshi-character-episode
cargo build --locked -p panshi-character-episode --target wasm32-wasip1
target/debug/panshi-character-episode --emit-events > "$temporary/native.bin"
wasmtime -C cache=n target/wasm32-wasip1/debug/panshi-character-episode.wasm --emit-events > "$temporary/wasi.bin"
cmp "$temporary/native.bin" "$temporary/wasi.bin"

target/debug/panshi-character-episode --write-golden "$temporary/golden"
for fixture_file in fixtures/v5/character-episode-001/*.pb; do
  file_name="$(basename "$fixture_file")"
  cmp "$fixture_file" "$temporary/golden/$file_name"
done

echo "V5 kernel parity passed: native, WASI, and the checked-in golden episode fixture are byte-identical"
