# Device-only study release

This image serves the sealed V4 study as static files. It has no application backend, analytics collector, server event database or origin request log. Study events remain in same-origin IndexedDB on the controlled phone. The edge access layer still processes connection metadata under the separate boundary documented in `docs/v4/study-mode.md`.

Build from the repository root:

```bash
VITE_STUDY_BUILD_ID=study-2026-07-21.4 pnpm --filter @panshi/web build
docker build -f deploy/study/Dockerfile --build-arg RELEASE_REVISION="$(git rev-parse HEAD)" -t panshi-study:study-2026-07-21.4 .
docker run --rm -p 8080:8080 panshi-study:study-2026-07-21.4
deploy/study/smoke.sh http://127.0.0.1:8080
```

Release gates:

1. Build, checks, tests, export verification and this smoke test pass on the same commit.
2. `world.panshi.app` is the only production origin; TLS is valid and HTTP redirects to HTTPS at the edge.
3. The root remains unlisted and `noindex`. Do not add analytics, a sitemap or a public navigation entry during research.
4. Verify one first-load-online then offline reopen on the fixed phone.
5. Verify hold, drag handoff, a ten-minute foreground run and the Taipei next-day rule on that phone.
6. Export twice, verify both JSON files on another controlled device, compare SHA-256, then preserve the service-worker release for the full cohort.

Changing DNS, edge routing or the production service is a separate operator action. Do it only after the release artifact is frozen and the live target has been rechecked.
