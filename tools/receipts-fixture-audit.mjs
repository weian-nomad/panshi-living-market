// Audits contracts/receipts/v1/*.
//
// Two independent things are checked:
//
// 1. Structural: the envelope schema and all three TBody schemas are
//    draft 2020-12, additionalProperties:false, declare exactly the required
//    fields the spec lists, and none of the three body schemas leaks a
//    digest/signature/append-position/event-ref/provenance field into the
//    body (system-design.md §5.3's "body never contains its own envelope's
//    bodyDigest, signature, ... or other provenance field" invariant).
// 2. The one fixture: contracts/receipts/v1/fixtures/command-admission-receipt-example.json
//    is validated against the envelope + CommandAdmissionReceiptBodyV1
//    schemas field-by-field, and its `bodyDigest` is independently
//    recomputed from its own `body` (RFC 8785 JCS-style canonical bytes,
//    same convention as contracts/sealed-facts/v1) and asserted to match
//    the pinned value -- a corrupted body must fail this check closed.
//
// This repo is not wiring real signing keys yet: `signature` is only
// checked for presence as a non-empty string below. This script never
// attempts to cryptographically verify it.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const dir = new URL("../contracts/receipts/v1/", import.meta.url);

async function loadJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, dir), "utf8"));
}

const envelopeSchema = await loadJson("envelope.schema.json");
const commandAdmissionSchema = await loadJson("command-admission-receipt-body.schema.json");
const introductionReadySchema = await loadJson("introduction-ready-receipt-body.schema.json");
const sceneSeedValidatedSchema = await loadJson("scene-seed-validated-receipt-body.schema.json");
const fixture = await loadJson("fixtures/command-admission-receipt-example.json");

const bodySchemaIds = {
  commandAdmission: "panshi.receipts.command-admission-receipt-body/v1",
  introductionReady: "panshi.receipts.introduction-ready-receipt-body/v1",
  sceneSeedValidated: "panshi.receipts.scene-seed-validated-receipt-body/v1",
};

// Fields that must never appear inside any TBody -- they belong to the
// envelope, to the append-only event log, or to a different domain-side
// artifact (system-design.md §5.3, §12).
const prohibitedBodyFields = [
  "bodyDigest",
  "signature",
  "signingKeyId",
  "envelopeVersion",
  "bodySchema",
  "eventId",
  "eventHash",
  "eventRef",
  "appendPosition",
  "streamPosition",
  "sequenceNumber",
  "provenance",
  "domainAcceptedAt",
];

// ---------------------------------------------------------------------------
// 1. Structural checks on all four schemas.
// ---------------------------------------------------------------------------

function assertDraft2020(schema, name) {
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema", `${name}: wrong $schema`);
}

function assertBodySchemaShape(schema, name, expectedRequired) {
  assertDraft2020(schema, name);
  assert.equal(schema.type, "object", `${name}: must be type object`);
  assert.equal(schema.additionalProperties, false, `${name}: must set additionalProperties:false`);
  assert.deepEqual(
    [...schema.required].sort(),
    [...expectedRequired].sort(),
    `${name}: required fields drifted from spec`,
  );
  assert.deepEqual(
    Object.keys(schema.properties).sort(),
    [...expectedRequired].sort(),
    `${name}: properties must be exactly the required fields (no optional extras, no additionalProperties escape hatch)`,
  );
  for (const field of prohibitedBodyFields) {
    assert.equal(
      schema.properties[field],
      undefined,
      `${name}: prohibited envelope/provenance field leaked into body: ${field}`,
    );
  }
}

assertDraft2020(envelopeSchema, "envelope.schema.json");
assert.equal(envelopeSchema.additionalProperties, false, "envelope: must set additionalProperties:false");
assert.deepEqual(
  [...envelopeSchema.required].sort(),
  ["body", "bodyDigest", "bodySchema", "envelopeVersion", "signature", "signingKeyId"].sort(),
  "envelope: required fields drifted",
);
assert.equal(
  envelopeSchema.properties.envelopeVersion.const,
  "cross-context-receipt-envelope/v1",
  "envelope: envelopeVersion const drifted",
);
assert.deepEqual(
  [...envelopeSchema.properties.bodySchema.enum].sort(),
  Object.values(bodySchemaIds).sort(),
  "envelope: bodySchema enum must list exactly the three body schema identifiers",
);
assert.match(envelopeSchema.properties.bodyDigest.pattern, /sha256/, "envelope: bodyDigest must document sha256 form");

assertBodySchemaShape(commandAdmissionSchema, "command-admission-receipt-body.schema.json", [
  "commandId",
  "commandKind",
  "quotaKey",
  "quotaWindowId",
  "quotaWindowStartsAt",
  "quotaWindowEndsAt",
  "commandAcceptedAt",
  "entitlementRevision",
  "authoringWindowStartsAt",
  "authoringWindowEndExclusiveAt",
  "idempotencyKeyDigest",
  "quotaReservationId",
]);
assert.ok(
  /server DB-transaction time/.test(commandAdmissionSchema.properties.commandAcceptedAt.description),
  "command-admission-receipt-body.schema.json: commandAcceptedAt must carry the prominent single-meaning description",
);

assertBodySchemaShape(introductionReadySchema, "introduction-ready-receipt-body.schema.json", [
  "introductionId",
  "characterId",
  "commandAdmissionBodyDigest",
  "commandAcceptedAt",
  "originDigest",
  "modelCoreAssignmentDigest",
  "assetPackDigest",
  "capacityReservationId",
  "quotaWindowId",
  "policyRevisionSet",
  "rightsSnapshotRefs",
  "readyAt",
]);

assertBodySchemaShape(sceneSeedValidatedSchema, "scene-seed-validated-receipt-body.schema.json", [
  "sceneSeedId",
  "normalizedPayloadBodyDigest",
  "commandAdmissionBodyDigest",
  "quotaWindowId",
  "policyRevisionSetDigest",
  "templateRevision",
  "rightsSnapshotDigest",
  "deadlineAt",
]);

// ---------------------------------------------------------------------------
// 2. Fixture: envelope-shape + CommandAdmissionReceiptBodyV1-shape validation.
// ---------------------------------------------------------------------------

assert.deepEqual(
  Object.keys(fixture).sort(),
  [...envelopeSchema.required].sort(),
  "fixture: envelope top level must be exactly the envelope's required fields",
);
assert.equal(fixture.envelopeVersion, "cross-context-receipt-envelope/v1", "fixture: envelopeVersion drifted");
assert.equal(fixture.bodySchema, bodySchemaIds.commandAdmission, "fixture: bodySchema must select the command-admission body");
assert.match(fixture.bodyDigest, /^sha256:[a-f0-9]{64}$/, "fixture: bodyDigest must be sha256:<hex>");
assert.equal(typeof fixture.signingKeyId, "string", "fixture: signingKeyId must be a string");
assert.ok(fixture.signingKeyId.length > 0, "fixture: signingKeyId must be non-empty");
// signature: presence-only check. Real signing keys are not wired in this
// repo yet (see README.md), so this is intentionally NOT a cryptographic
// verification of the signature bytes against signingKeyId.
assert.equal(typeof fixture.signature, "string", "fixture: signature must be a string");
assert.ok(fixture.signature.length > 0, "fixture: signature must be non-empty");

const body = fixture.body;
assert.deepEqual(
  Object.keys(body).sort(),
  [...commandAdmissionSchema.required].sort(),
  "fixture body: keys must be exactly CommandAdmissionReceiptBodyV1's required fields",
);
assert.deepEqual(
  [body.commandKind, body.quotaKey],
  ["resident_introduction", "resident_introduction"],
  "fixture body: commandKind/quotaKey must be one of the two allowed literals and agree",
);
for (const field of prohibitedBodyFields) {
  assert.equal(body[field], undefined, `fixture body: prohibited field present: ${field}`);
}
for (const field of [
  "quotaWindowStartsAt",
  "quotaWindowEndsAt",
  "commandAcceptedAt",
]) {
  assert.ok(!Number.isNaN(Date.parse(body[field])), `fixture body: ${field} must be a parseable date-time`);
}
for (const field of ["authoringWindowStartsAt", "authoringWindowEndExclusiveAt"]) {
  assert.ok(
    body[field] === null || !Number.isNaN(Date.parse(body[field])),
    `fixture body: ${field} must be null or a parseable date-time`,
  );
}
assert.match(body.idempotencyKeyDigest, /^sha256:[a-f0-9]{64}$/, "fixture body: idempotencyKeyDigest must be sha256:<hex>");
assert.ok(
  new Date(body.quotaWindowStartsAt).getTime() <= new Date(body.commandAcceptedAt).getTime() &&
    new Date(body.commandAcceptedAt).getTime() < new Date(body.quotaWindowEndsAt).getTime(),
  "fixture body: commandAcceptedAt must fall inside [quotaWindowStartsAt, quotaWindowEndsAt)",
);

// ---------------------------------------------------------------------------
// 3. Recompute bodyDigest from the fixture's own body and assert it matches
//    the pinned value -- this is the fail-closed check a corrupted byte
//    must break.
// ---------------------------------------------------------------------------

// RFC 8785 (JCS)-style canonicalization: object keys sorted by UTF-16 code
// unit order, arrays keep declared order, no float/map ambiguity in these
// bodies. Same convention this repo already uses in
// contracts/sealed-facts/v1 (see tools/sealed-fact-audit.mjs).
function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function computeBodyDigest(bodySchema, bodyValue) {
  // body_bytes = deterministic_encode(bodySchema, body)
  const bodyBytes = Buffer.from(canonicalize(bodyValue), "utf8");
  // bodyDigest = HASH("panshi.cross-context-receipt/v1" || bodySchema || body_bytes)
  const hashInput = Buffer.concat([
    Buffer.from("panshi.cross-context-receipt/v1", "utf8"),
    Buffer.from(bodySchema, "utf8"),
    bodyBytes,
  ]);
  return `sha256:${createHash("sha256").update(hashInput).digest("hex")}`;
}

const recomputedDigest = computeBodyDigest(fixture.bodySchema, fixture.body);
assert.equal(
  recomputedDigest,
  fixture.bodyDigest,
  "fixture: bodyDigest does not match a fresh recomputation from body -- fixture body or pinned digest drifted",
);

console.log("receipts-fixture audit passed: envelope + 3 TBody schemas structurally sound, fixture bodyDigest verified");
