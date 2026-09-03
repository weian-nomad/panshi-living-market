# V5 Implementation Report — Phase 0–2

_Prepared 2026-07-23, following `IMPLEMENTATION-HANDOFF.md`_

## Scope claim

This report covers Phase 0 (legacy freeze), Phase 1 (V5 contracts beside V1),
and Phase 2 (one-character canonical vertical slice) as scoped by
`IMPLEMENTATION-HANDOFF.md`. **UI work has not started**, per the handoff's
explicit instruction. The dirty worktree present at handoff time (V5
specification files, historical-router edits) was preserved unmodified except
for the one new file explicitly authorized inside `docs/v5/` (item 6 below).

Toolchain used: Rust `1.97.1` (exact workspace match, no change needed), Node
`24.18.0` + pnpm `11.15.0` (installed this session via Homebrew/corepack —
approved), PostgreSQL `16.14` (scratch, local, torn down at the end of this
session — approved for the parity/replay proofs below), `wasmtime 47.0.2`
(installed this session via Homebrew — approved), `buf 1.72.0` (pre-existing
pinned binary at `.tools/bin/buf`).

## 1. Phase 0 — Freeze and boundary-enforce legacy code

- Moved `fixtures/historical/episode-001/` → `fixtures/legacy-v2/episode-001/`
  (git-tracked rename) and updated every consumer:
  `tools/fixture-audit.rb`, `tools/simulator/src/{lib,main}.rs`,
  `tools/verify-kernel-parity.sh`, `adr/0002-canonical-decision-and-event-bytes.md`.
- Tagged every `legacy-v2` location with a doc comment pointing at
  `LEGACY-V2-RESEARCH-V4.md`: `crates/domain/src/{lib,seat,round_desk,decision_session}.rs`,
  `crates/scoring/src/lib.rs`, `crates/decision-kernel/src/decision.rs`,
  `contracts/proto/panshi/game/v1/{desk,decision}.proto`,
  `contracts/policy/command-transition-map.yaml`. Did **not** touch
  `contracts/policy/decision-v1.json` (its bytes are hashed directly by
  `tools/simulator`'s golden fixture) — its classification is recorded in
  `LEGACY-V2-RESEARCH-V4.md` instead.
- Tagged every `research-v4` location the same way:
  `apps/web/src/{App.tsx,StudyRoot.tsx,scene.ts,study.ts,studyRecorder.ts,
  studyRoutes.ts,studyExportValidation.ts,studyStorage.ts,studyRelease.ts}`.
  Left `apps/web/src/interaction.ts` untagged as legacy — it is explicitly
  a kept V5 presentation primitive per `system-design.md` §18.2, marked as
  such instead.
- New `LEGACY-V2-RESEARCH-V4.md`: single registry of every marker above.
- New CI gate: extended `tools/contracts/check-boundaries.sh` (previously
  only checked `panshi-domain`/`panshi-decision-kernel`/`panshi-scoring` don't
  depend on `panshi-protocol`) to also fail if **any** non-legacy workspace
  crate depends on `panshi-domain` or `panshi-scoring`. Negative-tested by
  temporarily adding a fake dependency and confirming the script fails
  closed, then reverting. Wired into `package.json` as `audit:boundaries`.

## 2. Phase 1 — V5 contracts beside V1

### Protobuf (`contracts/proto/panshi/`)

New packages, none of which mutate `common/v1` or `game/v1` semantics
(`buf breaking --against '.git#ref=HEAD'` passes; `buf lint` passes):

- `common/v2/envelope.proto` — `ModeDomain` (adds `CURRENT`), `TruthClass`,
  `FactRevisionRef` (interaction/outcome-evidence allowlist tag),
  `EventEnvelope`/`CommandEnvelope` (system-design §5.1's fuller field set),
  `CrossContextReceiptEnvelopeV1`.
- `character/v1/character.proto` — `CognitionAppraisalV1`,
  `SemanticSpeechActCommittedV1`, `UtteranceArtifactV1` (transcribed
  field-for-field from `character-story-engine.md`), plus minimal
  `CharacterOriginSealedV1`/`CharacterStateAdvancedV1`/`CognitionInputSealedV1`/
  `ObservedClueRegisteredV1`/`AttentionCommittedV1`/
  `AutonomousActionIntentCommittedV1`/`MemoryFormedV1`.
- `portfolio/v1/portfolio.proto` — the full `PaperAccount`/`PaperOrder`/
  `PaperPosition` event set (14 events, matching `canonical-owner-map.yaml`'s
  4/4/6 route split exactly).
- `world/v1/world.proto` — `FactManifestAcceptedV1`, `FactBecameVisibleV1`,
  `MarketSessionFinalityAcceptedV1`, scene-exposure and world-tick events
  (minimal scope: no `WorldCell`/`Scene`/`EncounterWindow`/`SceneSeed` —
  Phase 3 territory).
- `story/v1/story.proto` — `StorySourceSetV1`, `NarrativeSegmentV1` (a `oneof`
  making `character_claim` structurally unable to carry free text — only an
  artifact ID + hash), `StoryChapterComposed/Published/Superseded/WithdrawnV1`.

### Other contracts

- `contracts/world-fact-manifest/v1/` — JSON Schema for `WorldFactManifestV1`
  (system-design §6.2, verbatim field-for-field), a synthetic sealed fixture,
  and `tools/world-fact-manifest-audit.mjs` (hash/digest recompute +
  two-allowlist eligibility checks — no `ajv` dependency added, hand-rolled
  validator since `ajv` isn't already in this workspace).
- `contracts/openapi/public-v2.yaml` — `GET /api/v2/world`,
  `/characters/{id}/close-up`, `/life-journal`, `/archive`, `/archive/paper`,
  plus documented `/events/v2/world` SSE. `redocly lint` passes.
  `openapi-ts.config.ts` extended to a two-target array; v1's generated
  output is byte-unchanged, v2 generates cleanly into a sibling
  `apps/web/src/api/generated-v2/` directory.
- `contracts/receipts/v1/` — JSON Schemas for `CrossContextReceiptEnvelopeV1`
  and all three receipt bodies (`CommandAdmissionReceiptBodyV1`,
  `IntroductionReadyReceiptBodyV1`, `SceneSeedValidatedReceiptBodyV1`), a
  worked fixture, and `tools/receipts-fixture-audit.mjs`.
- `docs/v5/contracts/command-transition-map.yaml` — **new** artifact (the one
  file this session added inside `docs/v5/`, explicitly authorized by the
  handoff as a Phase-1 deliverable, not a baseline-doc edit): 132 commands,
  covering all 143 canonical events, with owner/legal-source-states/
  idempotency-scope/target-aggregate/emits per row. 42 commands honestly
  record `n/a` source states where the specification prose doesn't define an
  explicit lifecycle (listed in full in the file itself) rather than
  fabricating one. `tools/command-map-audit.rb` proves completeness (143/143)
  and uniqueness.
- `tools/owner-map-audit.rb` — proves `docs/v5/contracts/canonical-owner-map.yaml`'s
  exact machine baseline: 14 bounded contexts (13 canonical-write), 38
  aggregates, 13 event families, 143 globally-unique events, 10 non-canonical
  projections (all declaring `may_accept_commands: false`/
  `may_write_back: false`), and the Paper Account/Order/Position 4/4/6 route
  split.

All nine `pnpm audit:*` scripts plus `contracts:lint` plus
`pnpm --recursive --if-present check` (which runs `tsc -b` and the web app's
54 existing Vitest tests) pass via a single `pnpm check` — the exact
pre-existing `package.json` script, now covering the new V5 gates too.

## 3. Phase 2 — One-character canonical vertical slice

### New Rust crates

- `crates/character-domain` (`panshi-character-domain`) — `Character`,
  `CharacterLife` (dynamic state, quote-free `CommitmentRationale`),
  `CognitiveEpisode` (fixed state machine:
  `Opened → InputSealed → AppraisalResolved → AttentionCommitted →
  ActionIntentCommitted → [SpeechActCommitted] → Closed`), `MemoryLedger`,
  `UtteranceArtifact` (sealed-once, with the `(semantic_speech_act_event_id,
  surface_kind)` stream-id derivation the event-store CAS enforces),
  `StoryChapter`, and a `fallback` module (the deterministic, versioned,
  no-network appraisal/speech-act/utterance-template policy). 22 unit tests.
- `crates/paper-ledger` (`panshi-paper-ledger`) — `PaperAccount` (double-entry
  journal, policy gates), `PaperOrder` (submit/fill/reject/expire), `PaperPosition`
  (FIFO lots, partial/full reduction, marks) — three genuinely non-overlapping
  aggregates, no shared authoritative fields. 13 unit tests.
- `crates/decision-kernel/src/character_action.rs` — new module (kept
  `no_std`, alongside but not calling the legacy `decision.rs`): the V5
  attention-weight table (2200/1800/1500/1200/1200/800/800/500 bp, compile-time
  asserted to sum to 10,000) and the `U(action) = 30%evidence + 18%goal +
  15%emotion + 10%memory + 10%relationship + 10%pattern + 7%habit − cost`
  action-utility formula, both on checked `Fixed`-point arithmetic. Builds
  clean for `wasm32-wasip1`.
- `crates/event-store` — added `ModeDomain::Current` (additive; the Postgres
  `mode_domain` CHECK constraint is *widened*, not replaced, by
  `migrations/0002_v5_mode_domain_current.sql` — proven against a real
  Postgres 16 instance that both migrations apply cleanly and the legacy
  `HISTORICAL`-only test still passes unmodified) and
  `promotion_fence.rs` (region-loss decision-gate, see §5).

### `tools/character-episode` — the golden episode

`golden_episode()` builds one fully synthetic adult character and one
synthetic sealed market episode, running the complete handoff chain as 20
canonical events in fixed order: `FactManifestAccepted →
FactBecameVisible → CharacterOriginSealed → ObservedClueRegistered →
CognitionInputSealed → CoreAppraisalFallbackUsed → AttentionCommitted →
AutonomousActionIntentCommitted → CommitmentRationaleSealed →
SemanticSpeechActCommitted → PublicClaimMade → PaperAccountOpened →
PaperCashInitialized → PaperOrderSubmitted → PaperOrderFilled →
PaperAccountJournalPosted → PaperPositionOpened → MemoryFormed →
StoryChapterComposed → StoryChapterPublished`.

Cognition in this slice exercises **only the deterministic fallback path**
(`CoreAppraisalFallbackUsed`, reason `NO_NETWORK`) — no live model call is
made, per the handoff's own rule that heavy model inference belongs on
approved external capacity, not this coordination machine. This is not a
shortcut: "deterministic no-network fallback without retrying for a
preferred result" is itself a required Phase-2 property.

**Proven, not just asserted:**

- **Determinism**: two independent calls to `golden_episode()` produce
  byte-identical payloads for all 20 events (unit test).
- **Native/WASI parity**: `tools/verify-v5-kernel-parity.sh` builds the
  episode runner for native and `wasm32-wasip1`, runs both, and `cmp`s the
  emitted event-byte stream — identical — and also `cmp`s both against the
  checked-in `fixtures/v5/character-episode-001/*.pb` golden files.
- **PostgreSQL parity**: `tools/character-episode/tests/postgres_replay.rs`
  appends all 20 events (grouped into 17 `AppendRequest`s, with the
  `ApplyPaperFill` three-way atomic transaction and a `CommitAutonomousPaperAction`
  two-way group exercising real multi-stream CAS) to a real PostgreSQL 16
  instance, reads every payload back, and asserts byte-for-byte equality
  against the natively computed bytes — combined with the WASI proof above,
  this closes all three legs of "native／WASI／PostgreSQL execution produces
  identical canonical bytes."
- **Replay determinism & idempotency**: the same test replays the projection
  digest twice (identical), then re-submits the entire command plan a second
  time and confirms zero duplicate canonical events and an unchanged
  projection digest.
- **Projection rebuild**: `tools/character-episode/src/projection.rs` folds
  the canonical log into typed `CharacterCloseUpProjection`,
  `LifeJournalProjection`, `PortfolioProjection` structs from scratch on every
  call (no persistent projection state to even reset) — proven both from the
  natively-computed events and, in `postgres_replay.rs`, from bytes read back
  out of PostgreSQL, with matching concrete field assertions (open thesis
  revision, sealed claim text, position quantity, fill price, published
  chapter).
- **Full-surface artifact hash equality** (for the two surfaces this slice
  implements — the sealed utterance event and the story chapter's
  `character_claim` segment; search/share/video/caption/accessibility are
  explicitly deferred UI-layer work): a dedicated test fails if a future edit
  ever lets the story segment re-derive its own hash instead of copying the
  sealed artifact's.

### Golden failure set (`IMPLEMENTATION-HANDOFF.md` "Add the golden failure set")

| Required scenario | Where proven |
| --- | --- |
| Duplicate command / duplicate delivery | `postgres_v5_multi_stream.rs` (idempotent replay), `postgres_replay.rs` (full-plan re-submission) |
| Stream CAS conflict | `postgres_v5_multi_stream.rs` (`VersionConflict`, whole batch rejected, row counts unchanged) |
| Late model result overriding a sealed fallback | `utterance.rs` (in-process registry), `postgres_golden_failure_set.rs` (real event-store CAS: late attempt rejected, exactly one artifact persisted) |
| Model timeout → deterministic fallback | The entire golden episode exercises only this path (see above) |
| Invalid schema / prose injection | `crates/protocol/src/lib.rs`: `prose_injection_into_cognition_appraisal_is_rejected` — an injected free-text field fails `decode_canonical`'s round-trip check |
| Fact correction before seal / after seal | `cognition.rs`: before-seal correction is sealed directly; after-seal, `seal_input` structurally cannot be called again — `WrongState` |
| Missing eligible fill price → expiry | `order.rs`: `fill_before_commit_time_is_rejected`, `expire_and_reject_are_terminal` |
| Partial fill, fees, marks | `position.rs`: `partial_reduction_realizes_only_the_closed_portion_and_stays_open`; `account.rs`: fee-inclusive balanced fill |
| Accounting correction | `account.rs`: `accounting_correction_is_an_additional_balanced_batch_not_a_rewrite` — proves correction is an additive posting batch, never a rewrite |
| Projection deletion and rebuild | `projection.rs`: empty-input fold, two independent full-log folds compared |
| Visibility epoch mismatch / withdrawn-source tombstone | `postgres_golden_failure_set.rs`: a projection query bound to the post-withdrawal epoch excludes the old-epoch row entirely; the canonical log itself still holds both rows |
| Region-loss promotion fence | `crates/event-store/src/promotion_fence.rs` — pure decision-table proof: **explicitly at the contract/test-double level only**, see §5 |

## 4. Test-isolation fix (found and fixed, not a regression)

Adding V5 Postgres integration tests exposed that
`postgres_vertical_slice.rs` (pre-existing, untouched) asserts *unscoped*
whole-table row counts, which only held because it used to be the only
PostgreSQL integration test in the workspace. It still passes correctly and
unmodified in isolation. Rather than edit that test (or leave a
sometimes-flaky suite), this session added
`tools/run-postgres-integration-tests.sh`, which gives every Postgres
integration test target (both the legacy one and the three new ones) its own
freshly created, then dropped, database. All four pass cleanly through it.
`postgres_v5_multi_stream.rs`'s own row-count assertion was also tightened to
scope by `logical_cell_id` (a fix to a test *I* wrote this session, not the
legacy one).

## 5. Explicit evidence gates — NOT claimed as passed

Per the handoff's definition of done, the following are **not** claimed:

- **Region-loss / regional RPO**: only a contract/test-double-level decision
  gate is implemented and tested (§3 table, last row). No real multi-region
  PostgreSQL replication, AZ/region kill switch, or fault-injection drill was
  performed. A real drill is required before any regional SLO claim.
- **Utterance atomic-write crash injection**: proven via Postgres ACID
  transaction guarantees plus application-level conflict rejection (no
  orphaned artifact after a rejected concurrent attempt), not via literal
  process-kill fault injection against a running server.
- **Rights, Taiwan securities-law review, external legal/security/capacity
  sign-off, Figma visual masters**: entirely out of scope for this pass; none
  of `market-safety.md`'s publication gates, the 1,850-person capacity
  qualification, or the visual system have been touched.
- **1,850-person population / cost qualification, 30-day beta acceptance**:
  not attempted — this slice is one character, not a populated world.

## 6. Scoping simplifications made under "decision discipline" (smallest option, documented)

- `CommitAutonomousPaperAction`'s Postgres append grouping includes
  `AutonomousActionIntentCommitted` + `CommitmentRationaleSealed` but not
  `PaperOrderSubmitted` (the fixture's narrative order opens the paper
  account after the speech/utterance steps). Documented in
  `postgres_replay.rs`'s module doc comment. `ApplyPaperFill`'s three-way
  atomicity — the hardest, most failure-prone boundary — is implemented and
  tested exactly as specified, twice (unit + Postgres levels).
- `world.v1`/`character.v1` proto packages cover only what the one-character
  slice's golden path needs. `WorldCell`/`Scene`/`EncounterWindow`/`SceneSeed`
  (multi-character scene scheduling), the full `Introduction` saga wire
  shapes, `RelationshipDyad`, and Identity/Entitlement/Viewer-Library/
  Governance event payloads are declared in the owner map and command map but
  not yet given protobuf bodies — Phase 3 territory.
- `MemoryReframed`/`MemoryLinked`/`MemorySalienceChanged`/
  `MemoryVisibilityChanged` are declared in the owner map but not
  domain-modeled; only `MemoryFormed` (episodic formation) is implemented,
  sufficient for the one-character slice's single memory event.
- Utterance canonical-text NFC normalization is asserted (LF-normalization
  invariant checked, panics if violated) but not itself implemented — no
  Unicode-normalization dependency was added without a license/maintenance
  review; callers must pass already-normalized text. Documented in
  `utterance.rs`.

## 7. A documentation drift noted, not resolved by editing either document

`docs/repository-boundary.md` (ADR-0001, 2026-07-20, "Accepted") still
describes an older, more generic `FactManifestEnvelope` shape (single
`evidenceRevisionIds`, no interaction/outcome split) that differs from the
refined `WorldFactManifestV1` in `system-design.md` §6.2 (which this
implementation follows, since `docs/v5/README.md`'s document-priority order
ranks `system-design.md` above "Repository 層級的跨產品契約"). This is a
priority-resolved evolution, not a genuine unresolved contradiction, and
`docs/repository-boundary.md` was left untouched.

## 8. Exact next vertical slice

Per `docs/v5/system-design.md` §19 Phase 3 and this handoff's own "Next
handoff: UI work" section:

1. **Phase 3 backend**: `RelationshipDyad`, encounter mailbox, scene
   scheduler; scale the one-character slice to the 50-seed/three-scene
   runtime qualification; wire `WorldCell`/`Scene`/`SceneSeed` protobuf bodies
   the command map already declares.
2. **First UI slice** (only after this report is reviewed, per the handoff):
   `/world`, `/people/:id`, `/people/:id/journal`, `/people/:id/archive`,
   `/people/:id/archive/paper`, built from the `contracts/openapi/public-v2.yaml`
   fixtures first, then the real APIs — `services/game-core` and
   `services/projection-worker` are still stubs and need the command
   handlers this session's domain crates make possible.
3. Real `WorldFactManifestV1` producer integration (currently a fully
   synthetic fixture, by design, per repository-boundary rules).

## Files changed

See `git status` for the complete list. Summary: Phase 0 touched 25 existing
files (tags + fixture path updates) and added 2 new files (`LEGACY-V2-RESEARCH-V4.md`,
this file's sibling). Phase 1 added 5 new proto packages, 3 new contract
directories (`world-fact-manifest/v1`, `receipts/v1`, plus `public-v2.yaml`),
1 new `docs/v5/contracts/` artifact, and 5 new audit scripts. Phase 2 added 2
new domain crates, 1 new tool crate (7 source/test files), 1 new event-store
module, 1 new migration, and 2 new shell scripts. No file under `docs/v5/`
other than the one new `command-transition-map.yaml` was modified.
