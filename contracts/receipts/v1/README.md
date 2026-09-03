# Cross-context receipt v1

This is the one generic, non-self-referential envelope every cross-context receipt in this system uses. It keeps Identity/Entitlement's quota admission, Character Origin's introduction readiness, and World's scene-seed validation portable across their separate databases without any of them faking a single cross-database atomic transaction.

Normative source: `docs/v5/system-design.md` §5.3 (envelope, digest/signature order, the ten atomic multi-stream transactions), §8.2 (`IntroductionReadyReceiptBodyV1`), and §12 / §12.2 (`CommandAdmissionReceiptBodyV1`, `SceneSeedValidatedReceiptBodyV1`). This README explains the contract; it does not re-derive it. If this README and `system-design.md` ever disagree, `system-design.md` wins.

## The envelope

```ts
type CrossContextReceiptEnvelopeV1<TBody> = {
  envelopeVersion: "cross-context-receipt-envelope/v1";
  bodySchema: string;
  body: TBody;
  bodyDigest: string;
  signingKeyId: string;
  signature: string;
};
```

`envelope.schema.json` encodes this shape. JSON Schema has no generics, so `body` is left unconstrained there (an empty subschema) and a concrete consumer narrows it to exactly one of the three body schemas in this directory by switching on `bodySchema`:

| `bodySchema` value | Body schema file | TBody |
| --- | --- | --- |
| `panshi.receipts.command-admission-receipt-body/v1` | `command-admission-receipt-body.schema.json` | `CommandAdmissionReceiptBodyV1` |
| `panshi.receipts.introduction-ready-receipt-body/v1` | `introduction-ready-receipt-body.schema.json` | `IntroductionReadyReceiptBodyV1` |
| `panshi.receipts.scene-seed-validated-receipt-body/v1` | `scene-seed-validated-receipt-body.schema.json` | `SceneSeedValidatedReceiptBodyV1` |

## The invariant: a body never contains its own envelope's provenance

Every `TBody` is deterministic, map-free, and float-free. Critically, **no `TBody` may ever contain its own envelope's `bodyDigest`, `signature`, append position, event ID/hash, or any other provenance field.** Those fields live outside the body and are correlated only by `bodyDigest`. A body may reference a *different, already-sealed* immutable artifact or receipt by a named digest field (e.g. `IntroductionReadyReceiptBodyV1.commandAdmissionBodyDigest` points at a previously-sealed `CommandAdmissionReceiptBodyV1`'s digest) -- that is a cross-reference to someone else's provenance, not a self-reference to this envelope's own.

This is also why `domainAcceptedAt` never appears inside any of these three bodies: it belongs to a different, domain-side artifact (e.g. the `ValidatedSceneSeedPayloadV1` a `SceneSeedAccepted` event seals), not to the receipt that admitted or validated it.

## Digest and signature computation order

Computation order is fixed and must not be reordered or short-circuited:

```text
body_bytes = deterministic_encode(bodySchema, body)
bodyDigest = HASH("panshi.cross-context-receipt/v1" || bodySchema || body_bytes)
signature  = SIGN(signingKeyId, envelopeVersion || bodySchema || bodyDigest)
```

`bodyDigest` and `signature` never enter `body_bytes` -- there is no self-reference. This contract pins two concrete choices system-design.md §5.3 leaves abstract:

- **`HASH` is SHA-256**, lowercase hex, formatted `sha256:<64 lowercase hex chars>` -- the same digest convention this repo already established in `contracts/sealed-facts/v1/schema.json` (`content_hash`), reused here for `bodyDigest` and for every digest-typed field inside a body (`idempotencyKeyDigest`, `commandAdmissionBodyDigest`, `originDigest`, `modelCoreAssignmentDigest`, `assetPackDigest`, `normalizedPayloadBodyDigest`, `policyRevisionSetDigest`, `rightsSnapshotDigest`).
- **`deterministic_encode(bodySchema, body)` is RFC 8785 JSON Canonicalization Scheme (JCS) applied to `body`**: object keys sorted, recursively, by code-unit order; arrays keep their declared order; the result is serialized to UTF-8 bytes. `bodySchema` parameterizes which schema the encoder validates `body` against; it is not spliced into `body_bytes` itself -- it is folded in separately, once, immediately before `body_bytes` in the `bodyDigest` HASH input, exactly as written above.
- The three byte strings inside the `bodyDigest` HASH input (`"panshi.cross-context-receipt/v1"`, `bodySchema`, `body_bytes`) are concatenated directly with no separator or length prefix, matching how `contracts/sealed-facts/v1` hashes its own canonical bytes directly. This is a literal reading of the `||` operator in system-design.md §5.3, which does not itself specify a delimiter; flagged here as an implementation choice, not a spec contradiction.

`signature` is opaque at the contract level (no algorithm pinned). Real signing keys are not wired into this repository yet, so the fixture below carries a clearly-synthetic placeholder in `signature`; `tools/receipts-fixture-audit.mjs` only asserts it is present as a non-empty string and explicitly does not attempt cryptographic verification.

## `commandAcceptedAt` has exactly one meaning

`CommandAdmissionReceiptBodyV1.commandAcceptedAt` is the server DB-transaction time at which Identity/Entitlement accepted a quota-counted command and wrote `QuotaReserved` in the *same* transaction. It is never client send time, HTTP arrival time, domain-validation-complete time, scheduled time, or execution time. It alone determines the Taipei ISO quota week and the beta authoring half-open window membership. A later `domainAcceptedAt` belongs to a different, domain-side artifact and never moves quota or window ownership -- see the field's `description` in `command-admission-receipt-body.schema.json` for the exact wording carried into the schema itself.

`IntroductionReadyReceiptBodyV1.commandAcceptedAt` is not a new timestamp: it is the same value copied verbatim from the `CommandAdmissionReceiptBodyV1` it cross-references by `commandAdmissionBodyDigest`, never re-sampled at ready time.

## Casing note on `IntroductionReadyReceiptBodyV1`

system-design.md §8.2 lists this body's fields in snake_case (`introduction_id`, `character_id`, `command_admission_body_digest`, `command_accepted_at`, `origin_digest`, `model_core_assignment_digest`, `asset_pack_digest`, `capacity_reservation_id`, `quota_window_id`, `policy_revision_set`, `rights_snapshot_refs`, `ready_at`). `introduction-ready-receipt-body.schema.json` normalizes these to camelCase for consistency with the other two bodies in this contract family (both of which are already given as TypeScript with camelCase fields in the source). No field was added, removed, or renamed beyond this casing normalization; each property's `description` states which source field it corresponds to.

The source spec gives this body only as a bare field-name list (no types). `policyRevisionSet` and `rightsSnapshotRefs` are documented as arrays of opaque string identifiers -- an inferred shape, called out in each field's `description`, rather than an invented field name.

## Worked example: `CommandAdmissionReceiptBodyV1`

`fixtures/command-admission-receipt-example.json` is a fully synthetic instance of `CrossContextReceiptEnvelopeV1<CommandAdmissionReceiptBodyV1>`. Its `body` is:

```json
{
  "commandId": "cmd_9f2c9e1e9b6a4c8d8f6b0f3a2b7c4d10",
  "commandKind": "resident_introduction",
  "quotaKey": "resident_introduction",
  "quotaWindowId": "quota-window_asia-taipei_2026-W30",
  "quotaWindowStartsAt": "2026-07-19T16:00:00.000Z",
  "quotaWindowEndsAt": "2026-07-26T16:00:00.000Z",
  "commandAcceptedAt": "2026-07-22T03:14:07.000Z",
  "entitlementRevision": "policy-bundle_beta-full-access_rev-7",
  "authoringWindowStartsAt": "2026-06-30T16:00:00.000Z",
  "authoringWindowEndExclusiveAt": "2026-08-31T16:00:00.000Z",
  "idempotencyKeyDigest": "sha256:3c69b4ce9ead3737dc595a4e31f5b4dfc2d485ad9d7368a41b7f3f44773dd9a3",
  "quotaReservationId": "quota-reservation_3d7a1f9c2e5b4680a6c9d0e1f2a3b4c5"
}
```

Step 1 -- canonicalize `body` (JCS: keys sorted, no whitespace) to get `body_bytes` as a UTF-8 string:

```text
{"authoringWindowEndExclusiveAt":"2026-08-31T16:00:00.000Z","authoringWindowStartsAt":"2026-06-30T16:00:00.000Z","commandAcceptedAt":"2026-07-22T03:14:07.000Z","commandId":"cmd_9f2c9e1e9b6a4c8d8f6b0f3a2b7c4d10","commandKind":"resident_introduction","entitlementRevision":"policy-bundle_beta-full-access_rev-7","idempotencyKeyDigest":"sha256:3c69b4ce9ead3737dc595a4e31f5b4dfc2d485ad9d7368a41b7f3f44773dd9a3","quotaKey":"resident_introduction","quotaReservationId":"quota-reservation_3d7a1f9c2e5b4680a6c9d0e1f2a3b4c5","quotaWindowEndsAt":"2026-07-26T16:00:00.000Z","quotaWindowId":"quota-window_asia-taipei_2026-W30","quotaWindowStartsAt":"2026-07-19T16:00:00.000Z"}
```

Step 2 -- `bodyDigest = sha256("panshi.cross-context-receipt/v1" || "panshi.receipts.command-admission-receipt-body/v1" || body_bytes)`, i.e. `sha256` over the direct UTF-8 concatenation of those three byte strings:

```text
sha256:c3745ff6c90d7f9924b319ca746b365396f8a4ab583ea6ac0715e9c15be3f16b
```

This is exactly the pinned `bodyDigest` in the fixture. `tools/receipts-fixture-audit.mjs` recomputes it independently from the fixture's own `body` on every run and fails closed if a single byte of `body` (or the pinned `bodyDigest`) drifts.

Step 3 -- `signature = SIGN(signingKeyId, envelopeVersion || bodySchema || bodyDigest)`. This repository has no signing keys provisioned yet, so the fixture's `signature` is a clearly-synthetic placeholder string, not a real signature; the audit script checks only that it is present and non-empty.

## Running the audit

```sh
pnpm audit:receipts
# or directly:
node tools/receipts-fixture-audit.mjs
```

It checks, in order: (1) the envelope schema and all three body schemas are draft 2020-12, `additionalProperties: false`, and declare exactly their spec-listed required fields with no digest/signature/event-ref/provenance field leaking into any body; (2) the fixture's envelope and body shapes match those schemas field-by-field; (3) the fixture's `bodyDigest` is recomputed from its own `body` and matches the pinned value.
