#!/bin/sh
# Private-preview entrypoint: refuse to start without access control.
#
# The preview must never come up open. Caddy already fails closed on its own
# (a half-empty account line is a load error; an empty account list answers
# 401), but this guard stops the container before Caddy runs, with a message
# that names the missing variable instead of a parser error.
#
# Required environment (values come from the deployer's secret store, never
# from the image or the repository):
#   PREVIEW_AUTH_USER  basic-auth user name, [A-Za-z0-9._-], 1-64 characters
#   PREVIEW_AUTH_HASH  bcrypt hash of the password ($2a$/$2b$/$2y$, 60 characters),
#                      for example from `caddy hash-password`
#
# Everything after the checks is the image CMD (caddy run ...), exec'd as is.
set -eu

refuse() {
	echo "preview: $1; refusing to start" >&2
	exit 64
}

user=${PREVIEW_AUTH_USER:-}
hash=${PREVIEW_AUTH_HASH:-}

[ -n "$user" ] || refuse "PREVIEW_AUTH_USER is not set"
[ -n "$hash" ] || refuse "PREVIEW_AUTH_HASH is not set"

case "$user" in
*[!A-Za-z0-9._-]*) refuse "PREVIEW_AUTH_USER may only contain A-Z a-z 0-9 . _ -" ;;
esac
[ "${#user}" -le 64 ] || refuse "PREVIEW_AUTH_USER is longer than 64 characters"

# bcrypt modular crypt format: $2a$, $2b$ or $2y$, a two-digit cost, then 53
# characters of salt and digest, 60 characters on one line. Anything else (a
# plaintext password, an empty or truncated hash, extra lines that would land
# in the Caddyfile) is rejected here rather than silently never matching.
[ "${#hash}" -eq 60 ] || refuse "PREVIEW_AUTH_HASH is not a bcrypt hash"
case "$hash" in
*[!./A-Za-z0-9$]*) refuse "PREVIEW_AUTH_HASH is not a bcrypt hash" ;;
esac
if ! printf '%s\n' "$hash" | grep -Eqx '\$2[aby]\$(0[4-9]|[12][0-9]|3[01])\$[./A-Za-z0-9]{53}'; then
	refuse "PREVIEW_AUTH_HASH is not a bcrypt hash"
fi

[ "$#" -gt 0 ] || refuse "no command to run"
exec "$@"
