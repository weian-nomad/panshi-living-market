# Legacy `legacy-v2` / `research-v4` boundary registry

_Written as Phase 0 of `IMPLEMENTATION-HANDOFF.md` ("Freeze and boundary-enforce
legacy code"). Source of truth for classification is
[`docs/v5/system-design.md`](docs/v5/system-design.md) §18 ("Existing
contracts: reuse vs replace") and §19 ("Migration plan"), which are read-only
normative baseline and are not modified here._

This file is the single place that lists every location carrying a
`legacy-v2` or `research-v4` marker, so a reviewer does not have to grep the
whole tree to find them. The markers themselves live as doc comments at the
top of each source file; this registry does not replace them.

## `legacy-v2`: the frozen five-seat V2 domain

Reused only as an *implementation technique* (fixed-point math, canonical
Protobuf bytes, event-store append/CAS/outbox); never reused as V5 domain
semantics. New V5 modules must not import these crates -- enforced by
`tools/contracts/check-boundaries.sh` in CI (see below).

| Location | What it is | Marker |
| --- | --- | --- |
| `crates/domain` (`panshi-domain`) | `SeatId`, `SeatPlan`, `RoundDesk`, `DecisionSession` and their error/state types | crate-level `//!` in `lib.rs`, `seat.rs`, `round_desk.rs`, `decision_session.rs` |
| `crates/scoring` (`panshi-scoring`) | DP/coverage/ranking five-seat scoring rules | crate-level `//!` in `lib.rs` |
| `crates/decision-kernel/src/decision.rs` | `decide_five_seats`, `FiveSeatDecision`, `ALGORITHM_ID = "five-seat-action-policy/1"` | module `//!` (the crate itself is *not* fully legacy -- `fixed.rs`/`utility.rs` are reused primitives, see below) |
| `contracts/proto/panshi/game/v1/desk.proto` | `SeatId`, `SeatPlan`, `SealSeatPlan` wire messages | header comment |
| `contracts/proto/panshi/game/v1/decision.proto` | five-seat/four-company decision-kernel wire messages | header comment |
| `contracts/policy/command-transition-map.yaml` | five-seat command/event transition map (audited by `tools/contract-audit.rb`) | header comment |
| `contracts/policy/decision-v1.json` | five-seat/four-company utility-numerator policy fixture | **not modified** -- its bytes are hashed directly by `tools/simulator/src/lib.rs::algorithm_bundle_digest()`; classification is recorded here instead of in the file |
| `fixtures/legacy-v2/episode-001/*` | the five-seat golden fixture (moved from `fixtures/historical/episode-001/` by this Phase-0 pass) | directory name itself is the marker; consumers updated: `tools/fixture-audit.rb`, `tools/simulator/src/{lib,main}.rs`, `tools/verify-kernel-parity.sh`, `adr/0002-canonical-decision-and-event-bytes.md` |

## `research-v4`: the sealed follow-camera study slice

This is a separately-deployed, already-isolated public research release (see
`deploy/study/README.md`, which already states "This image serves the sealed
V4 study as static files"). It keeps running independently while V5 work
proceeds (per `docs/v5/system-design.md` Phase 0). It is not the V5 production
route, root, or analytics pipeline.

| Location | What it is | Marker |
| --- | --- | --- |
| `apps/web/src/App.tsx` | the "開盤廳" follow-camera scene UI, fixed 0-599s timeline | top-of-file comment |
| `apps/web/src/StudyRoot.tsx` | consent/participant gate wrapping `App`, currently the public landing | top-of-file comment |
| `apps/web/src/scene.ts` | hard-coded 16-resident/3-ticker scene script | top-of-file comment |
| `apps/web/src/study.ts` | study evaluator logic | top-of-file comment |
| `apps/web/src/studyRecorder.ts` | IndexedDB study event recorder | top-of-file comment |
| `apps/web/src/studyRoutes.ts` | `/study/:code`, `/research` route resolver | top-of-file comment |
| `apps/web/src/studyExportValidation.ts` | study export JSON validation | top-of-file comment |
| `apps/web/src/studyStorage.ts` | IndexedDB persistence | top-of-file comment |
| `apps/web/src/studyRelease.ts` | sealed release-id constants, gated by `tools/study-release-audit.mjs` | top-of-file comment (pinned literal values themselves are unchanged) |
| `apps/web/public/art/v4/`, `apps/web/public/art/five-seat-observatory-v1.*` | V4-tagged asset folder/files (pre-existing naming, no change needed) | folder/file name itself |
| `deploy/study/*` | self-contained deployment of the sealed study release | already self-describing; no change needed |

**Reused as a presentation primitive, not legacy:** `apps/web/src/interaction.ts`
(world-space hit testing) is explicitly kept per `docs/v5/system-design.md`
§18.2 and is expected to keep being used -- and extended with
pointer/keyboard/screen-reader tests -- by V5 world/follow surfaces. It
carries a top-of-file comment saying so, not a `legacy-v2`/`research-v4`
marker.

## CI-enforced dependency boundary

`tools/contracts/check-boundaries.sh` fails the build if any workspace crate
outside the declared `legacy-v2` set (`panshi-domain`, `panshi-scoring`)
depends on one of those crates. It also keeps the pre-existing check that
`panshi-domain`, `panshi-decision-kernel`, and `panshi-scoring` never depend
on `panshi-protocol` (generated transport types must stay out of domain/
deterministic crates). There is no equivalent automated import-boundary check
for the TypeScript side yet, because no V5 web module exists in this
repository at the time of this Phase-0 pass (`docs/v5/README.md` "目前實作狀態"
confirms the current web app is entirely the V4 study slice) -- the first V5
web route added in a later handoff must not import from any file listed under
"research-v4" above, and should add an equivalent lint/CI rule (e.g. an
ESLint `no-restricted-imports` rule scoped to the files in this table) at that
time.

## What this Phase-0 pass deliberately did not touch

Per `IMPLEMENTATION-HANDOFF.md` and `docs/v5/system-design.md` §19 Phase 0:
the existing public research deployment (`deploy/study/*`) keeps running
independently until the V5 production route passes its own smoke test; its
runtime data is never seeded into V5 canon. This pass only adds
classification and a dependency-boundary CI gate -- it does not remove,
disable, or redeploy the existing study release.
