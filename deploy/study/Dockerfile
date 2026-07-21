FROM caddy:2.11.4-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648

ARG RELEASE_REVISION=unknown
LABEL org.opencontainers.image.title="Panshi Living Market study"
LABEL org.opencontainers.image.revision=$RELEASE_REVISION

RUN addgroup -S -g 10001 panshi \
    && adduser -S -D -H -u 10001 -G panshi panshi \
    && mkdir -p /srv /data/caddy /config/caddy \
    && chown -R panshi:panshi /srv /data /config \
    && command -v getcap >/dev/null \
    && command -v setcap >/dev/null \
    && getcap /usr/bin/caddy | grep -q 'cap_net_bind_service' \
    && setcap -r /usr/bin/caddy \
    && test -z "$(getcap /usr/bin/caddy)" \
    && apk del libcap

COPY --chown=10001:10001 deploy/study/Caddyfile /etc/caddy/Caddyfile
COPY --chown=10001:10001 apps/web/dist/ /srv/

USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:8080/healthz >/dev/null || exit 1
