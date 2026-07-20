#!/usr/bin/env sh
set -eu

cargo_command="${CARGO:-cargo}"

for package in panshi-domain panshi-decision-kernel panshi-scoring; do
  if "${cargo_command}" tree --package "${package}" --edges normal | grep -q 'panshi-protocol'; then
    echo "${package} must not depend on generated transport types" >&2
    exit 1
  fi
done
