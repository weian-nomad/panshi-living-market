# Private preview image: the V5 slice behind a password

This image serves the V5 one-character slice (`world.html` at `/`, `/world`, `/people/*`) to a small group of invited viewers. It is not a public release.

- **Access control.** Every path except `/healthz` requires HTTP basic auth. The user name and the bcrypt hash are read only from the environment (`PREVIEW_AUTH_USER`, `PREVIEW_AUTH_HASH`). Nothing secret is in the image or in this repository.
- **Fail closed.** The entrypoint (`entrypoint.sh`) refuses to start when either variable is missing, when the user name has characters outside `A-Z a-z 0-9 . _ -`, or when the hash is not a 60-character bcrypt hash. Caddy also fails closed on its own: a half-empty account line does not load, and an empty account list can only answer 401. `fail-closed-check.sh` proves both against a built image.
- **Not indexed.** Every response, the 401 challenge and `/healthz` included, carries `X-Robots-Tag: noindex, nofollow`; the world document also keeps its `robots` meta.
- **Not cached by shared caches.** Everything is `no-store`, except authenticated, existing hashed assets and art files (`private, max-age=31536000, immutable`) and art manifests (`private, no-cache`).
- **Slice API.** `vite build` bundles the sealed slice fixtures into `dist/api/v2/` (`apps/web/tools/v5-slice-api-bundle.mjs`). `/api/v2/<rest>` is answered from `dist/api/v2/<rest>.json` with the same rule as the dev middleware (`apps/web/tools/v5-api-middleware.mjs`): trailing slashes stripped, GET/HEAD only, `application/json`, `no-store`; anything else under `/api/v2/` is a 404 `application/problem+json`. The public study image (`deploy/study`) refuses `/api/*`.
- **No research study.** The sealed V4 study (`/study*`, `/research*`, `index.html`, its service worker and web manifest) belongs to the research origin. The preview image does not ship those files and the Caddyfile answers 404 for them.

## Build

From the repository root, on the commit being previewed:

```bash
corepack pnpm install --frozen-lockfile
VITE_STUDY_BUILD_ID=study-2026-07-23.5 corepack pnpm --filter @panshi/web build
docker build -f deploy/preview/Dockerfile --build-arg RELEASE_REVISION="$(git rev-parse HEAD)" -t panshi-preview:"$(git rev-parse --short HEAD)" .
```

The production build still requires the sealed study build id (`apps/web/vite.config.ts`), even though the preview does not serve the study. The image build fails if `dist/world.html` or the bundled `dist/api/v2/world.json` is missing.

## Credentials

Create the hash without putting the password on a command line (the prompt reads it from the terminal):

```bash
docker run --rm -it --entrypoint caddy panshi-preview:<tag> hash-password
```

Keep the user name and the hash in the deployer's secret store and hand them to the container as an env file with mode `600`:

```
PREVIEW_AUTH_USER=<user name>
PREVIEW_AUTH_HASH=<bcrypt hash>
```

`--env-file` takes values literally, so the `$` characters in a bcrypt hash need no quoting. The plaintext password goes to viewers out of band and is never stored with the deployment.

## Character art

Art is supplied by the deployer at run time and never enters the image or this repository. It is mounted read-only at `/srv/art/characters`. A runtime mount was chosen over copying at build time so that the art stays out of every image layer, can be replaced without rebuilding, and can simply be left out: without it, each resident and close-up keeps its geometric placeholder.

The deployer-provided directory has one folder per character id:

```
<art directory>/
  <characterId>/
    manifest.json      contract: contracts/character-art/v1/schema.json
    <files named by manifest.json, e.g. world-sprite.png, rig/<layer>.png, rig/<static master>.png>
```

- `manifest.json` names every file relative to its own folder: one world sprite, every close-up rig layer, and the flattened static master shown under reduced motion. The front end fails closed per character: a missing or invalid manifest, a `characterId` that differs from the folder name, or any file that does not load or whose pixel size differs from the manifest keeps the placeholder. A partial pack is never shown.
- Files must be readable by uid `10001` (for example `chmod -R a+rX <art directory>`).
- Art files are cached `immutable` for a year. Give a changed image a new file name and update `manifest.json`; the manifest itself is revalidated on every load.

## Run

```bash
docker run -d --name panshi-preview \
  --env-file <secret env file> \
  -v <art directory>:/srv/art/characters:ro \
  -p <host port>:8080 \
  panshi-preview:<tag>
```

Omit the `-v` line to run without art. TLS, the public name and the edge in front of this container are operator decisions outside this repository.

## Verify

```bash
deploy/preview/fail-closed-check.sh panshi-preview:<tag>
PREVIEW_SMOKE_USER=<user name> PREVIEW_SMOKE_PASSWORD=<password> deploy/preview/smoke.sh "$PREVIEW_BASE_URL"
```

`smoke.sh` checks: `/healthz` without credentials; 401 with a basic-auth challenge, `noindex` and `no-store` everywhere else without (or with wrong) credentials; the world shell and its assets with credentials; every bundled `/api/v2/*` route as JSON and the 404 problem for anything else; a missing art manifest as a plain 404; and that the study is not served. Set `PREVIEW_SMOKE_EXPECT_ART=1` when an art directory is mounted to also require the world character's manifest. Then open the preview in a browser, sign in, and check the world sprite and the close-up idle motion, once with the system's reduced-motion setting on.
