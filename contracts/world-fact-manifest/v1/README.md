# World fact manifest v1

`WorldFactManifestV1` is the sealed envelope the upstream **盤勢公司市場研究** repository
publishes once per current-mode (`modeDomain: "current"`), TW-jurisdiction market
session. It is the contract this repo (《盤勢・眾生》) consumes to know which market
facts a character world is allowed to react to, and which it may only cite after the
fact. See `docs/v5/system-design.md` §6 for the normative prose this schema encodes,
and `docs/repository-boundary.md` (ADR-0001) for the cross-product boundary this
contract sits inside — that ADR's `FactManifestEnvelope` is the earlier, general
cross-product data-packet shape; `WorldFactManifestV1` is the refined, current-mode
TW envelope actually implemented here, with the two-allowlist split spelled out.

This repo only ever **consumes** a fully synthetic, self-contained, sealed fixture
for testing (`fixtures/synthetic-manifest-001.json` +
`fixtures/synthetic-manifest-001-fact-revisions.json`). The real producer of this
contract — sourcing, licensing, company events, the trading calendar, quote/news
revisions, and manifest sealing itself — lives in a separate repository. This repo
never queries that upstream system directly; it does not mount its database, share
an ORM model, use a relative import, or use a Git submodule (`docs/v5/system-design.md`
§6.1).

## Files

| File | Purpose |
| --- | --- |
| `schema.json` | JSON Schema (draft 2020-12) for `WorldFactManifestV1` itself. Exactly the TS shape in system-design.md §6.2 — no additional or missing top-level fields, `additionalProperties: false`. Does **not** reference the fact-revision schema; the manifest only carries revision ID lists. |
| `fact-revision.schema.json` | JSON Schema for one fact revision record (the six fields system-design.md §6.2 says each revision "additionally carries", plus the `fact_id` identifier the manifest's ID lists reference). Referenced by fixtures, never by `schema.json`. |
| `fixtures/synthetic-manifest-001.json` | One fully synthetic, internally-consistent, sealed `WorldFactManifestV1` fixture. All hash/digest fields are actually computed per the convention below, not placeholders. |
| `fixtures/synthetic-manifest-001-fact-revisions.json` | The fact revision records the fixture manifest's two ID lists reference. |

`tools/world-fact-manifest-audit.mjs` (repo root `tools/`) validates both fixtures
against these schemas, recomputes every hash/digest from the fixture's own content,
and checks the two-allowlist eligibility rules below. Run it with
`pnpm audit:world-fact-manifest` (or `node tools/world-fact-manifest-audit.mjs`
directly).

## Why `fact_id` is the fact-revision identifier

The six "additionally carries" fields from system-design.md §6.2 include an
*optional* `supersedes_fact_id`. That name only makes sense if every fact revision
already has a `fact_id` of its own — the same immutable identifier namespace as
`contracts/sealed-facts/v1`. This schema reuses that pattern
(`^sf_[a-z0-9][a-z0-9._-]{7,127}$`) rather than inventing a second ID scheme,
per system-design.md §6.2's instruction that the sealed-fact primitive is
"reused/extended, not replaced." A `WorldFactManifestV1`'s
`interactionFactRevisionIds` / `outcomeEvidenceRevisionIds` are therefore just
allowlists of `fact_id`s, each additionally carrying the current-mode world-time
and rights metadata this contract adds.

## The two-allowlist physical separation rule

`interactionFactRevisionIds` and `outcomeEvidenceRevisionIds` are **physically
separate allowlists, not one list reused with a filter**:

- `interactionFactRevisionIds` may **only** be used for exposure, attention,
  appraisal, and action.
- `outcomeEvidenceRevisionIds` may **only** be used for paper outcome, correction,
  and post-close editorial.
- A fact revision may be rights-cleared for both (`rights_scope:
  "interaction_and_outcome"`) and appear in both lists — but each pipeline must
  resolve it through **its own** list's explicit ref. There is no code path where
  the outcome worker reads `interactionFactRevisionIds` or vice versa. Per
  system-design.md §6.2: "Outcome worker 沒有 Cognition command credential，
  CognitionInput 也沒有 outcome evidence 欄位" — the separation is structural
  (different credentials, different input shapes), not a runtime filter over one
  shared list.

Eligibility (system-design.md §6.2), computed from each fact revision's own
`world_published_at` / `platform_received_at`, never from the manifest's
`rightsValidFrom` / `rightsValidUntil`:

```text
available_at = max(world_published_at, platform_received_at)

interaction eligibility:
  available_at <= min(character_world_time, interactionCutoffAt, CognitionInputSealed.occurred_at)

outcome/editorial evidence eligibility:
  available_at <= evidenceCutoffAt
```

`rightsValidFrom` / `rightsValidUntil` are an **ingest/bind gate only**. They
decide whether this repo may bind and mirror the manifest at all; they never
substitute for either cutoff above, and the audit script does not use them for
eligibility. The audit script also does not evaluate `character_world_time` or
`CognitionInputSealed.occurred_at` — those depend on world/cognition state this
contract doesn't own; it only checks the two timestamps it does own
(`interactionCutoffAt`, `evidenceCutoffAt`) against each revision's `available_at`.

## Digest and canonicalization convention

All canonicalization reuses the RFC 8785 JCS convention already established by
`contracts/sealed-facts/v1` (object keys sorted, compact separators, no
insignificant whitespace) and the same `sha256:<lowercase-hex>` hash string
format as that contract's `content_hash`. This contract defines three additional
digests on top of that convention:

1. **`manifestHash`** — SHA-256 hex of the RFC 8785 JCS canonical UTF-8 bytes of
   the manifest object with the `manifestHash` and `objectHash` fields removed
   (the same "hash excludes itself" rule `sealed-facts/v1` uses for
   `content_hash`), prefixed `sha256:`.

2. **`interactionFactSetDigest`** / **`outcomeEvidenceSetDigest`** — SHA-256 hex,
   prefixed `sha256:`, of the UTF-8 bytes of the revision IDs in the
   corresponding list, **deduplicated, sorted by UTF-8 byte order, and joined
   with a single `\n`** (no trailing newline). Sorting before hashing makes the
   digest a function of the *set* of IDs, independent of the order they happen
   to be stored in the JSON array. The audit script asserts the source list has
   no duplicates as part of computing this (a duplicate would silently change
   set size without changing the digest, which the script treats as a fixture
   defect, not a hash mismatch).

3. **`objectHash`** — SHA-256 hex, prefixed `sha256:`, of the RFC 8785 JCS
   canonical UTF-8 bytes of the exact JSON array in the sibling
   `*-fact-revisions.json` fixture (in this fixture's case,
   `synthetic-manifest-001-fact-revisions.json`) — i.e. the hash of the mirrored
   fact-revision bundle `objectUri` points at.

`tools/world-fact-manifest-audit.mjs` recomputes all three from the fixture's own
content and asserts they match the pinned values; it fails closed (non-zero exit,
descriptive stderr) if any digest, any schema constraint, any cross-reference
between the ID lists and the fact-revisions fixture, or any eligibility check does
not hold.

## Ingest state machine (context only)

`docs/v5/system-design.md` §6.3 defines the full ingest state machine this
manifest flows through upstream of this repo
(`RECEIVED → HASH_VERIFIED → SIGNATURE_VERIFIED → CONTRACT_VERIFIED →
RIGHTS_VERIFIED → TIME_VERIFIED → MIRRORED → AVAILABLE_TO_WORLD`, `QUARANTINED` on
any failure). This contract package (schema + fixture + audit script) is scoped to
the **contract shape and consumer conformance proof** only — it does not implement
that state machine.
