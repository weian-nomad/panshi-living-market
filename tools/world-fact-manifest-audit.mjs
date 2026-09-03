import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const schemaUrl = new URL("../contracts/world-fact-manifest/v1/schema.json", import.meta.url);
const factRevisionSchemaUrl = new URL(
  "../contracts/world-fact-manifest/v1/fact-revision.schema.json",
  import.meta.url,
);
const manifestUrl = new URL(
  "../contracts/world-fact-manifest/v1/fixtures/synthetic-manifest-001.json",
  import.meta.url,
);
const factRevisionsUrl = new URL(
  "../contracts/world-fact-manifest/v1/fixtures/synthetic-manifest-001-fact-revisions.json",
  import.meta.url,
);

const [schema, factRevisionSchema, manifest, factRevisions] = await Promise.all(
  [schemaUrl, factRevisionSchemaUrl, manifestUrl, factRevisionsUrl].map(async (url) =>
    JSON.parse(await readFile(url, "utf8")),
  ),
);

// ---------------------------------------------------------------------------
// Minimal hand-rolled JSON Schema (draft 2020-12 subset) validator.
// ajv is not present in this workspace (checked: not in package.json, not in
// pnpm-lock.yaml, not in node_modules) and this contract does not warrant
// adding a new dependency, so this validator supports exactly the keyword
// subset both schema.json and fact-revision.schema.json use: type (incl.
// nullable via an array of types), const, enum, pattern, format
// (date / date-time / uri, checked structurally), minLength, maxLength,
// minItems, uniqueItems, items, properties, additionalProperties, required.
// ---------------------------------------------------------------------------

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function validate(instance, node, path, errors) {
  if (node.const !== undefined && instance !== node.const) {
    errors.push(`${path}: expected const ${JSON.stringify(node.const)}, got ${JSON.stringify(instance)}`);
  }
  if (node.enum !== undefined && !node.enum.includes(instance)) {
    errors.push(`${path}: ${JSON.stringify(instance)} is not one of ${JSON.stringify(node.enum)}`);
  }
  if (node.type !== undefined) {
    const allowed = Array.isArray(node.type) ? node.type : [node.type];
    if (!allowed.includes(typeOf(instance))) {
      errors.push(`${path}: expected type ${allowed.join("|")}, got ${typeOf(instance)}`);
      return;
    }
  }
  if (instance === null) return;
  if (typeof instance === "string") {
    if (node.pattern && !new RegExp(node.pattern).test(instance)) {
      errors.push(`${path}: ${JSON.stringify(instance)} fails pattern ${node.pattern}`);
    }
    if (node.minLength !== undefined && instance.length < node.minLength) {
      errors.push(`${path}: shorter than minLength ${node.minLength}`);
    }
    if (node.maxLength !== undefined && instance.length > node.maxLength) {
      errors.push(`${path}: longer than maxLength ${node.maxLength}`);
    }
    if (node.format === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(instance)) {
      errors.push(`${path}: ${JSON.stringify(instance)} is not a date`);
    }
    if (node.format === "date-time" && Number.isNaN(Date.parse(instance))) {
      errors.push(`${path}: ${JSON.stringify(instance)} is not a date-time`);
    }
    if (node.format === "uri") {
      try {
        new URL(instance);
      } catch {
        errors.push(`${path}: ${JSON.stringify(instance)} is not a URI`);
      }
    }
  }
  if (Array.isArray(instance)) {
    if (node.minItems !== undefined && instance.length < node.minItems) {
      errors.push(`${path}: fewer than minItems ${node.minItems}`);
    }
    if (node.uniqueItems && new Set(instance.map((v) => JSON.stringify(v))).size !== instance.length) {
      errors.push(`${path}: items are not unique`);
    }
    if (node.items) {
      instance.forEach((item, i) => validate(item, node.items, `${path}[${i}]`, errors));
    }
  }
  if (typeOf(instance) === "object") {
    const props = node.properties ?? {};
    for (const key of node.required ?? []) {
      if (!(key in instance)) errors.push(`${path}: missing required property "${key}"`);
    }
    for (const [key, value] of Object.entries(instance)) {
      if (node.additionalProperties === false && !(key in props)) {
        errors.push(`${path}: unexpected additional property "${key}"`);
        continue;
      }
      if (props[key]) validate(value, props[key], `${path}.${key}`, errors);
    }
  }
}

function assertSchemaValid(instance, node, label) {
  const errors = [];
  validate(instance, node, label, errors);
  if (errors.length > 0) {
    throw new Error(`${label} failed schema validation:\n  ${errors.join("\n  ")}`);
  }
}

assertSchemaValid(manifest, schema, "synthetic-manifest-001.json");
factRevisions.forEach((revision, i) =>
  assertSchemaValid(revision, factRevisionSchema, `synthetic-manifest-001-fact-revisions.json[${i}]`),
);

// ---------------------------------------------------------------------------
// Structural conformance: schema.json must carry exactly the WorldFactManifestV1
// TS shape from docs/v5/system-design.md §6.2 — no more, no fewer top-level fields.
// ---------------------------------------------------------------------------

const expectedTopLevelFields = [
  "contractVersion",
  "modeDomain",
  "jurisdiction",
  "manifestId",
  "manifestHash",
  "signatureKeyId",
  "sealedAt",
  "marketSessionId",
  "marketDateTaipei",
  "marketCalendarRevision",
  "interactionCutoffAt",
  "evidenceCutoffAt",
  "finalityPolicyRevision",
  "clockAuthorityRevision",
  "rightsManifestId",
  "licenseClass",
  "rightsValidFrom",
  "rightsValidUntil",
  "permittedPurposes",
  "interactionFactRevisionIds",
  "interactionFactSetDigest",
  "outcomeEvidenceRevisionIds",
  "outcomeEvidenceSetDigest",
  "objectUri",
  "objectHash",
];
assert.deepEqual(
  Object.keys(schema.properties).sort(),
  [...expectedTopLevelFields].sort(),
  "schema.json top-level fields drifted from the WorldFactManifestV1 TS shape",
);
assert.deepEqual(schema.required.slice().sort(), [...expectedTopLevelFields].sort(), "schema.json required list drifted");
assert.equal(schema.additionalProperties, false, "schema.json must stay additionalProperties: false");
assert.equal(schema.properties.contractVersion.const, "world-fact-manifest/v1");
assert.equal(schema.properties.modeDomain.const, "current");
assert.equal(schema.properties.jurisdiction.const, "TW");

// ---------------------------------------------------------------------------
// Digest / hash recompute — the consumer conformance proof, same spirit as
// tools/sealed-fact-audit.mjs's JCS + hash round-trip check.
//
// Convention (documented in README.md):
//   manifestHash            = sha256 hex of RFC 8785 JCS canonical UTF-8 bytes
//                              of the manifest with manifestHash + objectHash
//                              removed, prefixed "sha256:".
//   {interaction,outcome}*SetDigest
//                            = sha256 hex of the UTF-8-byte-sorted, deduped,
//                              newline-joined revision IDs in that list,
//                              prefixed "sha256:". Order-independent by design.
//   objectHash               = sha256 hex of RFC 8785 JCS canonical UTF-8 bytes
//                              of the sibling *-fact-revisions.json array
//                              (the mirrored object at objectUri).
// ---------------------------------------------------------------------------

function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function jcsCanonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(jcsCanonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${jcsCanonicalize(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digestRevisionIdSet(ids, label) {
  const sortedUnique = [...new Set(ids)].sort((a, b) =>
    Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")),
  );
  assert.equal(sortedUnique.length, ids.length, `${label} contains duplicate revision ids`);
  return `sha256:${sha256Hex(Buffer.from(sortedUnique.join("\n"), "utf8"))}`;
}

const { manifestHash: pinnedManifestHash, objectHash: pinnedObjectHash, ...manifestForHash } = manifest;
const recomputedManifestHash = `sha256:${sha256Hex(Buffer.from(jcsCanonicalize(manifestForHash), "utf8"))}`;
assert.equal(recomputedManifestHash, pinnedManifestHash, "manifestHash drifted from fixture content");

const recomputedInteractionDigest = digestRevisionIdSet(
  manifest.interactionFactRevisionIds,
  "interactionFactRevisionIds",
);
assert.equal(
  recomputedInteractionDigest,
  manifest.interactionFactSetDigest,
  "interactionFactSetDigest drifted from interactionFactRevisionIds",
);

const recomputedOutcomeDigest = digestRevisionIdSet(
  manifest.outcomeEvidenceRevisionIds,
  "outcomeEvidenceRevisionIds",
);
assert.equal(
  recomputedOutcomeDigest,
  manifest.outcomeEvidenceSetDigest,
  "outcomeEvidenceSetDigest drifted from outcomeEvidenceRevisionIds",
);

const recomputedObjectHash = `sha256:${sha256Hex(Buffer.from(jcsCanonicalize(factRevisions), "utf8"))}`;
assert.equal(recomputedObjectHash, pinnedObjectHash, "objectHash drifted from the mirrored fact-revision bundle");

// ---------------------------------------------------------------------------
// Two-allowlist physical separation + eligibility (system-design.md §6.2).
// Not the full ingest state machine — just: both lists resolve to real fact
// revisions, each revision's rights_scope permits the pipeline it is used in,
// and available_at clears the correct cutoff for that pipeline.
// ---------------------------------------------------------------------------

const revisionById = new Map(factRevisions.map((revision) => [revision.fact_id, revision]));

function requireRevision(id, listName) {
  const revision = revisionById.get(id);
  if (!revision) {
    throw new Error(`${listName} references fact_id ${id} which is not in the fact-revisions fixture`);
  }
  return revision;
}

function availableAt(revision) {
  return Math.max(Date.parse(revision.world_published_at), Date.parse(revision.platform_received_at));
}

const interactionCutoffAt = Date.parse(manifest.interactionCutoffAt);
const evidenceCutoffAt = Date.parse(manifest.evidenceCutoffAt);

for (const id of manifest.interactionFactRevisionIds) {
  const revision = requireRevision(id, "interactionFactRevisionIds");
  assert.ok(
    revision.rights_scope === "interaction" || revision.rights_scope === "interaction_and_outcome",
    `${id} is used via interactionFactRevisionIds but rights_scope is "${revision.rights_scope}"`,
  );
  assert.ok(
    availableAt(revision) <= interactionCutoffAt,
    `${id} available_at is after interactionCutoffAt (interaction eligibility failed)`,
  );
}

for (const id of manifest.outcomeEvidenceRevisionIds) {
  const revision = requireRevision(id, "outcomeEvidenceRevisionIds");
  assert.ok(
    revision.rights_scope === "outcome" || revision.rights_scope === "interaction_and_outcome",
    `${id} is used via outcomeEvidenceRevisionIds but rights_scope is "${revision.rights_scope}"`,
  );
  assert.ok(
    availableAt(revision) <= evidenceCutoffAt,
    `${id} available_at is after evidenceCutoffAt (outcome eligibility failed)`,
  );
}

// The physical-separation guarantee, checked from the revision side too: an
// interaction-only revision must never leak into the outcome allowlist, and
// an outcome-only revision must never leak into the interaction allowlist.
const interactionSet = new Set(manifest.interactionFactRevisionIds);
const outcomeSet = new Set(manifest.outcomeEvidenceRevisionIds);
for (const revision of factRevisions) {
  if (revision.rights_scope === "interaction") {
    assert.ok(
      !outcomeSet.has(revision.fact_id),
      `${revision.fact_id} has rights_scope "interaction" but appears in outcomeEvidenceRevisionIds`,
    );
  }
  if (revision.rights_scope === "outcome") {
    assert.ok(
      !interactionSet.has(revision.fact_id),
      `${revision.fact_id} has rights_scope "outcome" but appears in interactionFactRevisionIds`,
    );
  }
}

console.log(
  `world-fact-manifest audit passed: ${manifest.manifestId} ` +
    `(${manifest.interactionFactRevisionIds.length} interaction / ${manifest.outcomeEvidenceRevisionIds.length} outcome revision refs, ` +
    `${factRevisions.length} fact revisions, digests verified)`,
);
