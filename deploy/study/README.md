# Release image: public world at `/`, sealed study at `/study`

This image serves two static documents from one origin:

- `/` (and `/world`, `/people/*`) is the V5 public world slice shell. A stranger who types the bare domain lands here.
- `/study*` and `/research` are the sealed V4 study, moved off the root. Its consent flow, its device-only recording, its export and its service worker are unchanged; only its address moved.

There is no application backend, analytics collector, server event database or origin request log. Study events remain in same-origin IndexedDB on the controlled phone. The edge access layer still processes connection metadata under the separate boundary documented in `docs/v4/study-mode.md`.

Build from the repository root:

```bash
VITE_STUDY_BUILD_ID=study-2026-07-23.5 pnpm --filter @panshi/web build
docker build -f deploy/study/Dockerfile --build-arg RELEASE_REVISION="$(git rev-parse HEAD)" -t panshi-study:study-2026-07-23.5 .
docker run --rm -p 8080:8080 panshi-study:study-2026-07-23.5
deploy/study/smoke.sh http://127.0.0.1:8080
```

Participant links keep their existing shape: `https://world.panshi.app/study/P01?visit=1`. The researcher console stays at `/research`.

Release gates:

1. Build, checks, tests, export verification and this smoke test pass on the same commit.
2. `world.panshi.app` is the only production origin; TLS is valid and HTTP redirects to HTTPS at the edge. The origin root serves the public world, and the study is reachable only under `/study`.
3. The public world remains `noindex` during research; so does the study document. Do not add analytics or a sitemap during this release.
4. Verify one first-load-online then offline reopen on the fixed phone, opening the participant link `/study/P01?visit=1` (not the bare origin).
5. Verify hold, drag handoff, a ten-minute foreground run and the Taipei next-day rule on that phone.
6. Export twice, verify both JSON files on another controlled device, compare SHA-256, then preserve the service-worker release for the full cohort.

Operator notes for this move:

- `public/manifest.webmanifest` still declares `start_url` and `scope` as `/`, and `public/study-sw.js` still caches `/index.html` as its offline shell document. Both files are part of the sealed release and were left untouched. Consequence: an installed home-screen shortcut now opens the public world, and a study phone that navigates to the bare origin overwrites its cached offline shell with the world document. Participants must open their `/study/P01?visit=1` link directly. Narrowing the service-worker scope to `/study` is a separate, re-sealed release.
- The document filenames are unchanged (`index.html` is the study, `world.html` is the world). Path routing lives in `Caddyfile` here and in `apps/web/tools/v5-api-middleware.mjs` for dev/preview; those two must stay in step.
- The build also carries the bundled V5 slice API (`dist/api/v2/*.json`) for the password-protected preview in `deploy/preview`. This Caddyfile answers `/api/*` with 404, so the public research origin does not expose slice data; serving it publicly would be a separate release decision.

Changing DNS, edge routing or the production service is a separate operator action. Do it only after the release artifact is frozen and the live target has been rechecked.
