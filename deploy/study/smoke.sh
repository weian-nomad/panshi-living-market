#!/bin/sh
set -eu

base_url=${1:-http://127.0.0.1:8080}
headers=$(mktemp)
body=$(mktemp)
trap 'rm -f "$headers" "$body"' EXIT

curl -fsS --retry 10 --retry-all-errors --retry-delay 1 "$base_url/healthz" | grep -qx "ok"
curl -fsS -D "$headers" "$base_url/" -o "$body"
grep -qi '^content-security-policy:.*connect-src '\''self' "$headers"
grep -qi '^cache-control:.*no-store' "$headers"
grep -q '<meta name="robots" content="noindex, nofollow, noarchive"' "$body"
grep -q '<link rel="canonical" href="https://world.panshi.app/"' "$body"

curl -fsS "$base_url/study-release.json" | grep -q '"buildId": "study-2026-07-21.3"'
curl -fsS "$base_url/study-release.json" | grep -q '"consentVersion": "2026-07-21.v3"'
curl -fsS "$base_url/manifest.webmanifest" | grep -q '"start_url": "/"'
curl -fsS "$base_url/?study=P01&visit=1" | grep -q '<div id="root"></div>'
curl -fsS "$base_url/study-sw.js" | grep -q 'panshi-v4-study-2026-07-21-3'
curl -fsS -I "$base_url/icons/panshi-world-192.png" | grep -qi '^cache-control:.*immutable'

echo "study release smoke passed: $base_url"
