#!/bin/sh
# Deploy-time proof that the preview image never comes up open.
#
#   deploy/preview/fail-closed-check.sh <image>
#
# Needs a local Docker daemon. Uses only throwaway credentials generated here
# (a random password hashed by the image's own `caddy hash-password`); nothing
# is read from or written to the deployer's secret store.
#
# 1. The entrypoint refuses to start without PREVIEW_AUTH_USER / PREVIEW_AUTH_HASH,
#    with only one of them, or with a hash that is not bcrypt.
# 2. Caddy itself, with the entrypoint bypassed: the configuration does not load
#    with a half-empty account line, and with both variables missing it either
#    refuses to start or answers 401 everywhere except /healthz.
# 3. Positive control: with throwaway credentials the configuration validates,
#    the shell is 401 without them and 200 with them.
set -eu

image=${1:?usage: fail-closed-check.sh <image>}
caddy_run="run --config /etc/caddy/Caddyfile --adapter caddyfile"
caddy_validate="validate --config /etc/caddy/Caddyfile --adapter caddyfile"
containers=""

cleanup() {
	for container in $containers; do docker rm -f "$container" >/dev/null 2>&1 || true; done
}
trap cleanup EXIT

fail() {
	echo "fail-closed check FAILED: $*" >&2
	exit 1
}
pass() { echo "PASS: $*"; }

# Exit status of a container run; never aborts this script.
run_status() {
	set +e
	docker run --rm "$@" >/dev/null 2>&1
	status=$?
	set -e
	echo "$status"
}

throwaway_password=$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')
throwaway_hash=$(docker run --rm --entrypoint caddy "$image" hash-password --plaintext "$throwaway_password")
case "$throwaway_hash" in \$2*) ;; *) fail "could not generate a throwaway bcrypt hash" ;; esac

# 1. The entrypoint guard.
[ "$(run_status "$image")" = "64" ] || fail "image started without PREVIEW_AUTH_USER/PREVIEW_AUTH_HASH"
pass "no credentials -> entrypoint refuses (64)"
[ "$(run_status -e PREVIEW_AUTH_USER=preview "$image")" = "64" ] || fail "image started without PREVIEW_AUTH_HASH"
pass "user only -> entrypoint refuses (64)"
[ "$(run_status -e PREVIEW_AUTH_HASH="$throwaway_hash" "$image")" = "64" ] || fail "image started without PREVIEW_AUTH_USER"
pass "hash only -> entrypoint refuses (64)"
[ "$(run_status -e PREVIEW_AUTH_USER=preview -e PREVIEW_AUTH_HASH=plaintext-password "$image")" = "64" ] ||
	fail "image started with a non-bcrypt hash"
pass "non-bcrypt hash -> entrypoint refuses (64)"

# 2. Caddy without the entrypoint.
# shellcheck disable=SC2086
[ "$(run_status --entrypoint caddy -e PREVIEW_AUTH_USER=preview "$image" $caddy_validate)" != "0" ] ||
	fail "Caddyfile loads with a user and no hash"
pass "caddy: user without hash does not load"
# shellcheck disable=SC2086
[ "$(run_status --entrypoint caddy -e PREVIEW_AUTH_HASH="$throwaway_hash" "$image" $caddy_validate)" != "0" ] ||
	fail "Caddyfile loads with a hash and no user"
pass "caddy: hash without user does not load"

# shellcheck disable=SC2086
open_container=$(docker run -d -p 127.0.0.1::8080 --entrypoint caddy "$image" $caddy_run)
containers="$containers $open_container"
sleep 3
if [ "$(docker inspect -f '{{.State.Running}}' "$open_container")" != "true" ]; then
	pass "caddy: no credentials at all -> refuses to start"
else
	port=$(docker port "$open_container" 8080/tcp | head -n 1 | sed 's/.*://')
	base="http://127.0.0.1:$port"
	[ "$(curl -s -o /dev/null -w '%{http_code}' "$base/healthz")" = "200" ] || fail "caddy without credentials: /healthz not 200"
	for path in / /world /api/v2/world /world.html /assets/x.js /art/characters/x/manifest.json; do
		code=$(curl -s -o /dev/null -w '%{http_code}' "$base$path")
		[ "$code" = "401" ] || fail "caddy without credentials served $path with $code"
	done
	pass "caddy: no credentials at all -> 401 everywhere except /healthz"
fi

# 3. Positive control with throwaway credentials.
# shellcheck disable=SC2086
[ "$(run_status --entrypoint caddy -e PREVIEW_AUTH_USER=preview -e PREVIEW_AUTH_HASH="$throwaway_hash" "$image" $caddy_validate)" = "0" ] ||
	fail "Caddyfile does not validate with well-formed credentials"
pass "caddy: validates with well-formed credentials"

control=$(docker run -d -p 127.0.0.1::8080 -e PREVIEW_AUTH_USER=preview -e PREVIEW_AUTH_HASH="$throwaway_hash" "$image")
containers="$containers $control"
sleep 3
port=$(docker port "$control" 8080/tcp | head -n 1 | sed 's/.*://')
base="http://127.0.0.1:$port"
[ "$(curl -s -o /dev/null -w '%{http_code}' "$base/")" = "401" ] || fail "control: / without credentials is not 401"
auth=$(mktemp)
printf 'user = "preview:%s"\n' "$throwaway_password" >"$auth"
code=$(curl -s -o /dev/null -w '%{http_code}' -K "$auth" "$base/")
rm -f "$auth"
[ "$code" = "200" ] || fail "control: / with credentials is $code"
pass "control: 401 without credentials, 200 with them"

echo "fail-closed check passed: $image"
