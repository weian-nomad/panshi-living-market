#!/bin/sh
# Smoke test for a running private-preview container (deploy/preview).
#
#   PREVIEW_SMOKE_USER=<user name> PREVIEW_SMOKE_PASSWORD=<password> deploy/preview/smoke.sh <base-url>
#
# The password is the plaintext the bcrypt hash was made from. It is passed to
# curl through a private config file, never on a command line.
#
# Optional: PREVIEW_SMOKE_EXPECT_ART=1 also requires the world character's art
# manifest to be served (set it when an art directory is mounted).
set -eu

base_url=${1:?usage: smoke.sh <base-url>}
: "${PREVIEW_SMOKE_USER:?set PREVIEW_SMOKE_USER}"
: "${PREVIEW_SMOKE_PASSWORD:?set PREVIEW_SMOKE_PASSWORD}"

umask 077
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
headers="$work/headers"
body="$work/body"

fail() {
	echo "preview smoke FAILED: $*" >&2
	exit 1
}

# curl config quoting: backslash and double quote are escaped inside "...".
escape() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }
printf 'user = "%s:%s"\n' "$(escape "$PREVIEW_SMOKE_USER")" "$(escape "$PREVIEW_SMOKE_PASSWORD")" >"$work/auth"
printf 'user = "%s:%s"\n' "$(escape "$PREVIEW_SMOKE_USER")" "not-the-password-$$" >"$work/wrong"

# GET with optional extra curl args; prints the status code, keeps headers/body.
get() {
	curl -sS -D "$headers" -o "$body" -w '%{http_code}' "$@"
}
expect_status() {
	expected=$1
	shift
	actual=$(get "$@")
	[ "$actual" = "$expected" ] || fail "$* -> $actual, expected $expected"
}
header_has() {
	grep -qi "^$1" "$headers" || fail "missing header /$1/ on the last response"
}

# 1. Health answers without credentials, and is noindex too.
curl -fsS --retry 10 --retry-all-errors --retry-delay 1 "$base_url/healthz" -o "$body"
grep -qx "ok" "$body" || fail "/healthz body is not ok"
expect_status 200 "$base_url/healthz"
header_has 'x-robots-tag: noindex, nofollow'

# 2. Without credentials, or with a wrong password, everything else is 401:
#    a basic-auth challenge, noindex, not cacheable, and no page content.
for path in / /world /people/someone /world.html /api/v2/world /api/v2/nope /assets/x.js /art/characters/x/manifest.json /study /does-not-exist; do
	expect_status 401 "$base_url$path"
	header_has 'www-authenticate: basic'
	header_has 'x-robots-tag: noindex, nofollow'
	header_has 'cache-control: no-store'
	header_has 'content-security-policy:'
	header_has 'x-frame-options: deny'
	if grep -q '盤勢' "$body"; then fail "$path leaked page content without credentials"; fi
	expect_status 401 -K "$work/wrong" "$base_url$path"
done

# 3. With credentials: the world shell at the bare origin and the slice routes.
expect_status 200 -K "$work/auth" "$base_url/"
header_has 'x-robots-tag: noindex, nofollow'
header_has 'cache-control: no-store'
header_has 'content-security-policy:.*connect-src '\''self'
grep -q '<title>盤勢・眾生</title>' "$body" || fail "/ is not the world shell"
grep -q '<meta name="robots" content="noindex, nofollow, noarchive"' "$body" || fail "/ lost its robots meta"
cp "$body" "$work/world.html"
expect_status 200 -K "$work/auth" "$base_url/world"
expect_status 200 -K "$work/auth" "$base_url/people/someone/journal"

# Every script and stylesheet the shell references loads, privately cacheable.
assets=$(grep -oE '(src|href)="/assets/[^"]+"' "$work/world.html" | sed -E 's/^(src|href)="//; s/"$//')
[ -n "$assets" ] || fail "the world shell references no /assets/ files"
for asset in $assets; do
	expect_status 200 -K "$work/auth" "$base_url$asset"
	header_has 'cache-control: private, max-age=31536000, immutable'
done
expect_status 404 -K "$work/auth" "$base_url/assets/does-not-exist.js"
if grep -qi '^cache-control:.*immutable' "$headers"; then fail "a missing asset was marked immutable"; fi
# A file_server 404 is an error response, like the 401: the headers must still land.
header_has 'x-robots-tag: noindex, nofollow'
header_has 'content-security-policy:'

# 4. The bundled slice API: JSON, no-store, same rule as the dev middleware.
expect_status 200 -K "$work/auth" "$base_url/api/v2/world"
header_has 'content-type: application/json'
header_has 'cache-control: no-store'
case $(head -c 1 "$body") in "{") ;; *) fail "/api/v2/world is not a JSON object" ;; esac
character_id=$(grep -oE '"characterId": *"[0-9a-f-]{36}"' "$body" | head -n 1 | grep -oE '[0-9a-f-]{36}')
[ -n "$character_id" ] || fail "/api/v2/world names no character"
for suffix in /close-up /life-journal /archive /archive/paper /archive/relations /archive/chart /archive/traits /archive/memories /archive/life; do
	expect_status 200 -K "$work/auth" "$base_url/api/v2/characters/$character_id$suffix"
	header_has 'content-type: application/json'
	header_has 'cache-control: no-store'
done
expect_status 200 -K "$work/auth" "$base_url/api/v2/world/"
expect_status 200 -K "$work/auth" -I "$base_url/api/v2/world"
for path in /api/v2/nope /api/v2/world.json /api/v2/characters/$character_id/close-up.json /api/v2/; do
	expect_status 404 -K "$work/auth" "$base_url$path"
	header_has 'content-type: application/problem+json'
	header_has 'cache-control: no-store'
	grep -q '"reasonCode":"UNKNOWN_RESOURCE"' "$body" || fail "$path is not the unknown-resource problem"
	case $(head -c 1 "$body") in "{") ;; *) fail "$path problem body is not JSON" ;; esac
done
expect_status 404 -K "$work/auth" -X POST "$base_url/api/v2/world"
header_has 'content-type: application/problem+json'

# 5. Character art. Missing art is a plain 404 (never the HTML shell), so the
#    front end keeps its geometric placeholders; the shell itself still loads.
expect_status 404 -K "$work/auth" "$base_url/art/characters/00000000-0000-0000-0000-000000000000/manifest.json"
if grep -q '<html' "$body"; then fail "a missing art manifest answered with HTML"; fi
manifest_status=$(get -K "$work/auth" "$base_url/art/characters/$character_id/manifest.json")
case "$manifest_status" in
200)
	header_has 'cache-control: private, no-cache'
	grep -q '"contractVersion": *"character-art/v1"' "$body" || fail "the art manifest is not character-art/v1"
	;;
404)
	[ "${PREVIEW_SMOKE_EXPECT_ART:-0}" != "1" ] || fail "PREVIEW_SMOKE_EXPECT_ART=1 but no art manifest for $character_id"
	;;
*) fail "art manifest for $character_id -> $manifest_status" ;;
esac

# 6. The research-v4 study is not served by the preview.
for path in /study /study/P01 /research /index.html /study-sw.js /study-release.json /manifest.webmanifest; do
	expect_status 404 -K "$work/auth" "$base_url$path"
done
expect_status 404 -K "$work/auth" "$base_url/journal"

echo "preview smoke passed (art manifest: $manifest_status)"
