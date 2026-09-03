#!/bin/sh
set -eu

base_url=${1:-http://127.0.0.1:8080}
headers=$(mktemp)
body=$(mktemp)
trap 'rm -f "$headers" "$body"' EXIT

curl -fsS --retry 10 --retry-all-errors --retry-delay 1 "$base_url/healthz" | grep -qx "ok"

# The bare origin is the public world (V5 slice shell), still noindex while the
# research release is live.
curl -fsS -D "$headers" "$base_url/" -o "$body"
grep -qi '^content-security-policy:.*connect-src '\''self' "$headers"
grep -qi '^cache-control:.*no-store' "$headers"
grep -q '<title>盤勢・眾生</title>' "$body"
grep -q '<meta name="robots" content="noindex, nofollow, noarchive"' "$body"

# A slice route reaches the same world shell.
curl -fsS "$base_url/people/lu-yanzhi" -o "$body"
grep -q '<title>盤勢・眾生</title>' "$body"

# The sealed V4 study answers on /study, no longer on the root. Its document,
# consent flow, export and service worker are unchanged.
curl -fsS -D "$headers" "$base_url/study/P01?visit=1" -o "$body"
grep -qi '^cache-control:.*no-store' "$headers"
grep -q '<div id="root"></div>' "$body"
grep -q '<meta name="robots" content="noindex, nofollow, noarchive"' "$body"
grep -q '<link rel="canonical" href="https://world.panshi.app/"' "$body"
curl -fsS "$base_url/research" | grep -q '<div id="root"></div>'

# An unknown path is a 404, not a silent landing in either app.
test "$(curl -s -o /dev/null -w '%{http_code}' "$base_url/journal")" = "404"
test "$(curl -s -o /dev/null -w '%{http_code}' "$base_url/archive")" = "404"

curl -fsS "$base_url/study-release.json" | grep -q '"buildId": "study-2026-07-23.5"'
curl -fsS "$base_url/study-release.json" | grep -q '"consentVersion": "2026-07-21.v4"'
curl -fsS "$base_url/manifest.webmanifest" | grep -q '"start_url": "/"'
curl -fsS "$base_url/study-sw.js" | grep -q 'panshi-v4-study-2026-07-23-5'
curl -fsS -I "$base_url/icons/panshi-world-192.png" | grep -qi '^cache-control:.*immutable'

echo "study release smoke passed: $base_url"
