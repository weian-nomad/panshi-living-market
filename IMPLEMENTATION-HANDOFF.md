# 《盤勢・眾生》V5 Implementation Handoff

_Prepared 2026-07-23｜Repository: `panshi-living-market`_

## Mission

Implement the V5 product defined in `docs/v5/` as a production-shaped system.

This is not permission to reinterpret the product, revive the V4 research
landing page, or replace the persistent character world with a conventional
stock dashboard. The architecture has completed five pre-code reviews. The
latest verdict is:

```text
VERDICT: PRE-CODE MAXIMUM REACHED
P0 BLOCKERS: NONE
```

The review record is `docs/v5/pre-code-review.md`.

Start with the canonical spine and one-character vertical slice. Use final
contracts and ownership boundaries from the first implementation change. After
that slice is green, continue through the milestones in
`docs/v5/delivery-plan.md`; do not create a separate “temporary MVP”
architecture.

## Before touching the worktree

1. Read the parent directory's `AGENTS.md` (the shared rules for the sibling
   panshi repositories) and this repository's `AGENTS.md` in full.
2. Inspect `git status`, `git diff`, and all untracked files.
3. Preserve the current dirty worktree. The V5 specification files and the
   historical-router edits are intentional user work. Do not reset, checkout,
   clean, overwrite, or silently reformat them.
4. Treat `docs/v5/**`, `AGENTS.md`, the historical router／banner edits, and this
   handoff as a read-only baseline for the first implementation assignment.
   Do not edit normative documents to make code or tests pass. If code reveals a
   genuine contradiction, stop that affected path and report the exact
   conflicting clauses.
5. Do not stage, commit, push, deploy, create schedules, or change external
   services unless the user explicitly authorizes that action.
6. Never print or commit secrets, private runbooks, credential paths, live
   infrastructure details, runtime data, logs, generated media, or unpublished
   capacity-provider names.
7. Heavy model inference, asset generation, and rendering belong on approved
   external capacity, not this coordination Mac. Do not download Gemma,
   Hugging Face, or any other large model weights onto this machine without
   explicit approval.

## Mandatory read order

Read every selected document completely before implementation:

1. `docs/v5/product-constitution.md`
2. `docs/v5/market-safety.md`
3. `docs/v5/experience-spec.md`
4. `docs/v5/character-story-engine.md`
5. `docs/v5/system-design.md`
6. `docs/v5/contracts/canonical-owner-map.yaml`
7. `docs/v5/visual-system.md`
8. `docs/v5/delivery-plan.md`
9. `docs/v5/pre-code-review.md`
10. `docs/v5/competitive-synthesis.md`
11. `.agents/product-marketing.md`
12. `docs/repository-boundary.md`

Normative priority is defined by `docs/v5/README.md`. V2 and V3 are historical.
V4 only supplies reusable follow-camera, layered-scene, and controlled-study
evidence where V5 explicitly accepts it.

## Product contract that cannot drift

- The experience is:

  ```text
  public 2.5D world
  → follow camera
  → character close-up
  → canonical chronological life journal
  → /archive/* deep life record
  ```

- Characters are fictional adults with continuous lives. They keep living
  while viewers are away and are never rerolled after a market outcome.
- Cute adult 2.5D characters, readable fallibility, and “韭菜樣” are core
  product behavior—not comic labels, a score, or a reason to humiliate them.
- Paper holdings, lots, orders, cash, fees, P&L, drawdown, missed actions,
  original reasons, changed claims, memories, relationships, chart motifs, and
  life history must exist for each character at the specified information
  depth. There is no global performance, model, or “leek” leaderboard.
- Astrology, four-axis preferences, blood type, memory, emotion, relationships,
  life pressure, and bias affect attention, interpretation, emotion, social
  behavior, and paper action. They never alter prices, grant hidden facts, or
  directly improve expected performance.
- The beta default reasoning core is `Gemma 4 26B`. Show a selector only when
  at least two real cores pass the same contract tests. Do not expose private
  compute sources or market a core as higher-IQ or more profitable.
- Free remains usable. Registered accounts receive 30 calendar days without
  ads; this is not a Pro trial. Pro is fixed at NT$329 monthly or NT$2,790
  yearly, with five introductions and three bounded scene interventions per
  Taipei ISO week. No price, quota, or entitlement A/B is allowed in V5.
- Beta uses `beta_full_access`; payment, ads, trial countdowns, checkout,
  billing／store receipt validation, and store SDKs stay disabled. Canonical
  cross-context receipts remain mandatory.
- Unsubscribing removes authoring and complete-archive rights. It does not
  delete, freeze, reroll, or privatize existing characters; they continue in
  the public world.
- The public product does not answer whether a viewer should buy or sell.
  Same-session ticker-specific paper actions remain physically excluded from
  public projections until market finality.
- The canonical public origin is `https://panshi.app`, with same-origin
  `/api/v2/*` and `/events/v2/*`. Do not make the old study page the root.

## Architecture contract that cannot drift

- `docs/v5/contracts/canonical-owner-map.yaml` is machine-authoritative for
  aggregate and event ownership:
  - 14 bounded contexts, 13 canonical-write contexts.
  - 38 canonical aggregates.
  - 13 event families.
  - 143 globally unique canonical event names.
  - 10 non-canonical projections with no command, canonical-event, or write-back
    authority.
- Do not turn bounded contexts into thirteen network services. Beta deployment
  remains the smaller process topology in `system-design.md`; ownership is a
  module, data, credential, and transaction boundary.
- Paper Portfolio has three distinct aggregates:
  - `PaperAccount`: cash, reservation, double-entry journal, account invariants.
  - `PaperOrder`: requested terms, lifecycle, fill and price-source references.
  - `PaperPosition`: lots, quantity, cost basis, marks, position P&L, corporate
    actions, and outcome.
- A fill transaction updates the three streams atomically and seals the exact
  aggregate versions. `PaperAccountJournalPosted` is required. Projection
  arithmetic is never canonical truth.
- A character utterance is immutable. One semantic speech act produces at most
  one `UtteranceArtifactV1` per surface form. World, close-up, journal, archive,
  search, share, notification, video, caption, audio, accessibility, and replay
  must resolve the same artifact bytes and hash. Renderers may not rewrite it.
- Cross-context receipts use `CrossContextReceiptEnvelopeV1`. Quota and the
  authoring window use only
  `CommandAdmissionReceiptBodyV1.commandAcceptedAt`; `domainAcceptedAt` never
  changes quota ownership.
- `BeginAccountDeletion` writes only Identity-local intent, job state, and
  outbox. Privacy owns its lifecycle fence and visibility epoch; Identity
  completes only after immutable receipts.
- The only complete public character-record API is
  `/api/v2/characters/{id}/archive` and its six `/archive/*` children. Do not
  introduce `deep-profile`, `paper-portfolio`, or a second complete-history
  route.
- `CanonicalDurabilitySetV1` has region-level RPO 0. Canonical commands are
  acknowledged only after local quorum and a lossless cross-region durable
  record. A failover target may write only after WAL, global-position,
  hash-chain, command-idempotency, and outbox-completeness proof. Otherwise it
  remains stale read-only. RPO ≤5 minutes applies only to rebuildable
  projections, search, cache, and derivative media.

## Repository reality

The current application is a legacy V4 follow-camera study slice. It is not the
V5 implementation.

Reuse only the assets accepted by `docs/v5/system-design.md` §18:

- Event-store append batch, CAS, dedupe, hash chain, and outbox.
- Deterministic Protobuf bytes and golden parity workflow.
- Fixed-point and WASI techniques, not the old five-seat scoring rules.
- Sealed-fact hash and supersedes primitives, extended to the V5 manifest.
- Handwritten OpenAPI → generated TypeScript workflow.
- Logical-cell, ownership-epoch, visibility-epoch, and typed-deletion patterns.
- World-space hit testing, follow-camera gesture, and layered-scene workflow as
  presentation primitives.

Archive or isolate:

- `RoundDesk`, `SeatPlan`, fixed `SeatId`, `DecisionSession`, crew ownership,
  ranking, coverage, five-seat APIs, hard-coded residents, fixed timelines, and
  the public `StudyRoot`.
- Historical fake residents, fixed dialogue, study actions, and old scoring
  output must never be migrated into V5 canon.

## Immediate implementation assignment

Complete Phase 0 through Phase 2 of `docs/v5/system-design.md` as one coherent,
reviewable vertical slice. Do not begin with a cosmetic rewrite of the V4 home
page.

### 1. Freeze and boundary-enforce legacy code

- Mark V2 domain/API/fixtures as `legacy-v2` and V4 study surfaces as
  `research-v4`.
- Add a CI-auditable dependency boundary preventing new V5 modules from
  importing five-seat or study-root domain code.
- Preserve legacy decoder fixtures only in an explicit compatibility namespace.

### 2. Establish V5 contracts beside V1

- Add versioned `common.v2`, `world.v1`, `character.v1`, `portfolio.v1`, and
  `story.v1` Protobuf contracts.
- Add `WorldFactManifestV1` schema and consumer conformance fixtures. The real
  upstream producer remains a separate repository; use a fully synthetic,
  sealed fixture here.
- Add the `/api/v2` OpenAPI surface and `/events/v2/world` SSE contract. Do not
  mutate `/v1` semantics.
- Add schemas for the three cross-context receipt bodies and their shared
  envelope.
- Add a separate machine-readable command owner／transition map covering every
  V5 command, legal source state, target aggregate, idempotency scope, and
  emitted canonical events. It must have a CI completeness／uniqueness audit.
  `canonical-owner-map.yaml` does not replace this artifact.
- Turn `canonical-owner-map.yaml` into a CI gate that verifies the exact counts,
  global event-name uniqueness, aggregate owners, Paper Account/Order/Position
  routes, and projection no-write-back invariants.
- Keep canonical bytes, digest domain tags, idempotency keys, source positions,
  visibility epochs, rights scope, truth class, and revision references explicit.

### 3. Build the one-character canonical spine

Use one adult synthetic character and one synthetic sealed market episode:

```text
manifest accepted
→ fact visible
→ clue observed
→ structured appraisal or deterministic fallback
→ autonomous action intent / semantic speech act
→ immutable utterance artifact when speech exists
→ paper order
→ fill or expiry
→ account journal + position consequence
→ memory and relationship consequence
→ story chapter
→ close-up, life-journal, and /archive/paper projections
```

The slice must:

- Store every canonical mutation through the event-store boundary.
- Use append-only correction rather than overwriting history.
- Contain no model prose in canonical action-decision schemas.
- Support a deterministic no-network fallback without retrying for a preferred
  result.
- Use the first eligible sealed price after the decision; if none exists, expire
  the paper order.
- Rebuild every read model from an empty projection database.
- Produce identical canonical bytes/digests in native, WASI, and PostgreSQL
  paths. If any path is missing, implement it or report the vertical slice as
  blocked; do not claim Phase 2 completion with partial parity.
- Expose story-first projections without performance ranking.
- Keep current-session ticker action out of public payloads until finality.

### 4. Add the golden failure set

At minimum cover:

- Duplicate command, duplicate delivery, late callback, and stream CAS conflict.
- Model timeout, invalid schema, prose injection, and late model result.
- Fact correction before seal and after seal.
- Missing eligible fill price, partial fill/expiry, fees, marks, and accounting
  correction.
- Utterance atomic-write crash and full-surface artifact hash equality.
- Projection deletion and rebuild.
- Visibility epoch mismatch and withdrawn-source tombstone.
- Region-loss promotion fence at the contract/test-double level. Do not claim
  the infrastructure RPO gate has passed before a real fault-injection drill.

## Next handoff: UI work after the spine is green

The UI is not part of the first Phase 0–2 completion claim. Do not start it
until the user has reviewed the canonical-spine report. This section fixes the
next slice so a later handoff does not return to the V4 study shell.

The first client slice must use the V5 information architecture, not the V4
study shell:

```text
/world
/people/:id
/people/:id/journal
/people/:id/archive
/people/:id/archive/paper
```

Build from contract fixtures first, then the real APIs. Follow
`docs/v5/visual-system.md`:

- Ink black, warm paper, oxidized copper, and one cool market-data signal.
- Cute but visibly adult residents with recognizable silhouettes, posture,
  objects, wear, and social distance.
- No cold trading terminal, generic AI gradient, casino treatment, infantile
  chibi, decorative particle fog, card wall, or global performance dashboard.
- Use system-safe static assets until a qualified `CharacterAssetPack` exists;
  do not pretend disposable generated portraits are production identity.
- Every route needs loading, empty, stale, held, corrected, withdrawn, offline,
  narrow/wide, keyboard, screen-reader, 200% text, and reduced-motion states.

Do not write or revise Taiwan product copy without following the repository's
`copy-taste` routing rule.

## Required checks

Keep existing checks green and add V5-specific checks rather than weakening old
ones.

The repository declares Node `>=24 <25` and pnpm `11.15.0`. The current default
shell may expose an older Node/pnpm. Do not lower `package.json` requirements or
regenerate the lockfile to fit the machine. Confirm the exact toolchain first.
If an install or network download is required, request approval.

Known baseline checks:

```text
ruby tools/contract-audit.rb
ruby tools/fixture-audit.rb
node tools/sealed-fact-audit.mjs
node tools/study-release-audit.mjs
redocly lint contracts/openapi/public-v1.yaml
tsc -b apps/web/tsconfig.json --pretty false
git diff --check
```

The pre-handoff baseline passes all commands above when run with the required
Node runtime. Add tests for the new `/v2` contracts, owner map, golden episode,
ledger properties, replay equality, API projections, and legacy import boundary.

## Definition of done for the first handoff

Do not report “done” merely because schemas compile or a screen renders. The
first implementation handoff is complete only when:

1. Phase 0 legacy boundaries are enforceable in CI.
2. V5 contracts exist beside V1 and generated clients are reproducible.
3. Owner-map audit proves 14／13／38／13／143／10 and all Paper routes.
4. A separate command owner／transition audit proves every V5 command has one
   owner, legal source states, one idempotency scope, valid target aggregate,
   and declared emitted events.
5. The one-character golden episode runs end to end.
6. Native／WASI／PostgreSQL execution produces identical canonical
   bytes／digests; a missing path is a blocker, not a waived check.
7. Canonical replay and empty-database projection rebuild produce stable
   digests.
8. Paper double-entry, duplicate fill, missing price, and correction tests pass.
9. Immutable utterance bytes/hash are identical across every implemented
   surface and survive replay.
10. Current-market visibility fixtures cannot leak same-session paper action.
11. Existing V1/V4 tests still pass or any intentional isolation is documented
   without weakening production boundaries.
12. A short implementation report lists changed files, executed tests, known
    evidence gates, and the exact next vertical slice. Do not label external
    rights, legal, security, capacity, Figma, or regional-DR gates as passed
    without their actual evidence.

## Decision discipline

When the specification already answers a question, implement it. Do not ask the
user to reconfirm settled decisions.

When a field-level choice is genuinely absent:

1. Inspect adjacent V5 contracts and existing reusable infrastructure.
2. Choose the smallest option consistent with owner, replay, privacy, market
   time, and migration rules.
3. Record the decision in a focused ADR or schema comment.
4. Escalate only if the choice would change product behavior, pricing,
   entitlement, public API, canonical ownership, data rights, or an external
   system.

Never solve uncertainty by adding a second source of truth.
