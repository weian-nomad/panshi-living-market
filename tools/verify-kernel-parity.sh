#!/usr/bin/env bash
set -euo pipefail

if ! command -v wasmtime >/dev/null 2>&1; then
  echo "wasmtime is required for native/WASI byte parity" >&2
  exit 1
fi

workspace="$(cd "$(dirname "$0")/.." && pwd)"
temporary="$(mktemp -d)"
trap 'rm -rf "$temporary"' EXIT

cd "$workspace"
cargo build --locked -p panshi-simulator
cargo build --locked -p panshi-simulator --target wasm32-wasip1
target/debug/panshi-simulator --emit-output > "$temporary/native.pb"
wasmtime -C cache=n target/wasm32-wasip1/debug/panshi-simulator.wasm --emit-output > "$temporary/wasi.pb"
cmp "$temporary/native.pb" "$temporary/wasi.pb"
cmp "$temporary/native.pb" fixtures/historical/episode-001/output.pb
echo "kernel parity passed: native, WASI, and sealed output.pb are byte-identical"
