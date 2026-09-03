#!/usr/bin/env sh
set -eu

cargo_command="${CARGO:-cargo}"
workspace_root="$(cd "$(dirname "$0")/../.." && pwd)"

for package in panshi-domain panshi-decision-kernel panshi-scoring; do
  if "${cargo_command}" tree --package "${package}" --edges normal | grep -q 'panshi-protocol'; then
    echo "${package} must not depend on generated transport types" >&2
    exit 1
  fi
done

# V5 legacy-v2 boundary (docs/v5/system-design.md §18.3,
# IMPLEMENTATION-HANDOFF.md Phase 0, LEGACY-V2-RESEARCH-V4.md): the frozen
# five-seat domain and scoring crates are reused only as a technique
# reference, never as V5 domain semantics. No crate other than these two
# legacy crates themselves may depend on either of them.
legacy_crates="panshi-domain panshi-scoring"

is_legacy_crate() {
  candidate="$1"
  for legacy in ${legacy_crates}; do
    if [ "${candidate}" = "${legacy}" ]; then
      return 0
    fi
  done
  return 1
}

# Discover every workspace member's package name directly from its
# Cargo.toml, rather than depending on `cargo metadata`/`jq` being available
# in every CI image. This mirrors the plain grep/sed style already used by
# this script.
members="$(grep -A 200 '^members = \[' "${workspace_root}/Cargo.toml" \
  | sed -n '/^members = \[/,/^\]/p' \
  | grep -oE '"[^"]+"' \
  | tr -d '"')"

for member_dir in ${members}; do
  member_cargo_toml="${workspace_root}/${member_dir}/Cargo.toml"
  package_name="$(grep -m1 '^name = ' "${member_cargo_toml}" | sed -E 's/^name = "(.*)"$/\1/')"

  if is_legacy_crate "${package_name}"; then
    continue
  fi

  for legacy in ${legacy_crates}; do
    if "${cargo_command}" tree --package "${package_name}" --edges normal | grep -q "${legacy}\b"; then
      echo "${package_name} (${member_dir}) must not depend on legacy-v2 crate ${legacy}; see LEGACY-V2-RESEARCH-V4.md" >&2
      exit 1
    fi
  done
done

echo "boundary check passed: no V5/non-legacy crate depends on panshi-domain or panshi-scoring, and legacy-v2 domain/kernel/scoring crates do not depend on panshi-protocol"
