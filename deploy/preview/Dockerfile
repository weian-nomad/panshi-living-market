FROM caddy:2.11.4-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648

ARG RELEASE_REVISION=unknown
LABEL org.opencontainers.image.title="Panshi Living Market private preview"
LABEL org.opencontainers.image.revision=$RELEASE_REVISION

RUN addgroup -S -g 10001 panshi \
    && adduser -S -D -H -u 10001 -G panshi panshi \
    && mkdir -p /srv/art/characters /data/caddy /config/caddy \
    && chown -R panshi:panshi /srv /data /config \
    && command -v getcap >/dev/null \
    && command -v setcap >/dev/null \
    && getcap /usr/bin/caddy | grep -q 'cap_net_bind_service' \
    && setcap -r /usr/bin/caddy \
    && test -z "$(getcap /usr/bin/caddy)" \
    && apk del libcap

COPY --chown=10001:10001 deploy/preview/Caddyfile /etc/caddy/Caddyfile
COPY --chmod=0555 deploy/preview/entrypoint.sh /usr/local/bin/preview-entrypoint
COPY --chown=10001:10001 apps/web/dist/ /srv/

# Fail the image build, not the first page view: the world shell and the
# bundled slice API must be present. The research-v4 study files are not part
# of the preview (the Caddyfile also refuses to serve them).
RUN test -f /srv/world.html \
    && test -f /srv/api/v2/world.json \
    && rm -f /srv/index.html /srv/study-sw.js /srv/study-release.json /srv/manifest.webmanifest

USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O - http://127.0.0.1:8080/healthz >/dev/null || exit 1

# Character art is mounted read-only at /srv/art/characters at run time (see README).
ENTRYPOINT ["/usr/local/bin/preview-entrypoint"]
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
