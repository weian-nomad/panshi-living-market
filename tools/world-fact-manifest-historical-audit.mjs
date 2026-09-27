import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const fix = process.argv.slice(2).includes("--fix");

const schemaUrl = new URL(
  "../contracts/world-fact-manifest/historical-v1/schema.json",
  import.meta.url,
);
const factRevisionSchemaUrl = new URL(
  "../contracts/world-fact-manifest/historical-v1/fact-revision.schema.json",
  import.meta.url,
);
const manifestsUrl = new URL(
  "../contracts/world-fact-manifest/historical-v1/fixtures/synthetic-historical-001.json",
  import.meta.url,
);
const factRevisionsUrl = new URL(
  "../contracts/world-fact-manifest/historical-v1/fixtures/synthetic-historical-001-fact-revisions.json",
  import.meta.url,
);

const [manifestsRaw, factRevisionsRaw] = await Promise.all(
  [manifestsUrl, factRevisionsUrl].map((url) => readFile(url, "utf8")),
);
const [schema, factRevisionSchema] = await Promise.all(
  [schemaUrl, factRevisionSchemaUrl].map(async (url) => JSON.parse(await readFile(url, "utf8"))),
);
const manifests = JSON.parse(manifestsRaw);
const factRevisions = JSON.parse(factRevisionsRaw);

// ---------------------------------------------------------------------------
// Minimal hand-rolled JSON Schema (draft 2020-12 subset) validator, kept
// deliberately identical in style and keyword coverage to
// tools/world-fact-manifest-audit.mjs. ajv is still not present in this
// workspace and this contract does not warrant adding a dependency, so this
// supports exactly the keyword subset the two historical-v1 schemas use:
// type (incl. nullable via an array of types and "integer"), const, enum,
// pattern, format (date / date-time / uri, checked structurally), minLength,
// maxLength, minItems, uniqueItems, items, properties, additionalProperties,
// required.
// ---------------------------------------------------------------------------

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function matchesType(instance, allowed) {
  if (allowed.includes(typeOf(instance))) return true;
  return allowed.includes("integer") && typeof instance === "number" && Number.isInteger(instance);
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
    if (!matchesType(instance, allowed)) {
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

// ---------------------------------------------------------------------------
// Digest / hash convention — identical to world-fact-manifest/v1 (README.md
// §Digest convention), except objectHash covers this manifest's own slice of
// the shared fact-revision bundle rather than the whole file, because the
// historical manifests are mirrored side by side in one fixture.
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

function manifestSlice(manifestId) {
  return factRevisions.filter((revision) => revision.manifestId === manifestId);
}

function computeManifestHash(manifest) {
  const { manifestHash: _ignoredHash, objectHash: _ignoredObject, ...rest } = manifest;
  return `sha256:${sha256Hex(Buffer.from(jcsCanonicalize(rest), "utf8"))}`;
}

// ---------------------------------------------------------------------------
// --fix: recompute the four derived fields from the fixtures' own content and
// write them back. Everything below still runs afterwards, so --fix can never
// "repair" a fixture into passing a semantic rule — only the derived digests.
// ---------------------------------------------------------------------------

if (fix) {
  for (const manifest of manifests) {
    manifest.interactionFactSetDigest = digestRevisionIdSet(
      manifest.interactionFactRevisionIds,
      `${manifest.manifestId}.interactionFactRevisionIds`,
    );
    manifest.outcomeEvidenceSetDigest = digestRevisionIdSet(
      manifest.outcomeEvidenceRevisionIds,
      `${manifest.manifestId}.outcomeEvidenceRevisionIds`,
    );
    manifest.objectHash = `sha256:${sha256Hex(
      Buffer.from(jcsCanonicalize(manifestSlice(manifest.manifestId)), "utf8"),
    )}`;
    manifest.manifestHash = computeManifestHash(manifest);
  }
  await writeFile(manifestsUrl, `${JSON.stringify(manifests, null, 2)}\n`, "utf8");
  await writeFile(factRevisionsUrl, `${JSON.stringify(factRevisions, null, 2)}\n`, "utf8");
  console.log("world-fact-manifest-historical audit: --fix rewrote derived digests and hashes");
}

// ---------------------------------------------------------------------------
// Schema validation.
// ---------------------------------------------------------------------------

manifests.forEach((manifest, i) =>
  assertSchemaValid(manifest, schema, `synthetic-historical-001.json[${i}]`),
);
factRevisions.forEach((revision, i) =>
  assertSchemaValid(revision, factRevisionSchema, `synthetic-historical-001-fact-revisions.json[${i}]`),
);

// ---------------------------------------------------------------------------
// Structural conformance: the historical manifest is the current-mode
// WorldFactManifestV1 field set (docs/v5/system-design.md §6.2) plus exactly
// the two labels historical mode adds.
// ---------------------------------------------------------------------------

const expectedTopLevelFields = [
  "contractVersion",
  "modeDomain",
  "jurisdiction",
  "provenanceClass",
  "truthClass",
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
  "schema.json top-level fields drifted from WorldFactManifestV1 + the two historical labels",
);
assert.deepEqual(
  schema.required.slice().sort(),
  [...expectedTopLevelFields].sort(),
  "schema.json required list drifted",
);
assert.equal(schema.additionalProperties, false, "schema.json must stay additionalProperties: false");
assert.equal(schema.properties.contractVersion.const, "world-fact-manifest-historical/v1");
assert.equal(schema.properties.modeDomain.const, "historical");
assert.equal(schema.properties.jurisdiction.const, "TW");
assert.equal(schema.properties.provenanceClass.const, "synthetic_fixture");
assert.equal(schema.properties.truthClass.const, "fictional_setting");
assert.equal(schema.properties.manifestId.pattern, "^wfm_[a-z0-9][a-z0-9._-]{7,127}$");
assert.equal(
  factRevisionSchema.properties.truthClass.const,
  "fictional_setting",
  "fact-revision.schema.json must pin truthClass to fictional_setting",
);
assert.equal(factRevisionSchema.properties.provenanceClass.const, "synthetic_fixture");
assert.equal(factRevisionSchema.additionalProperties, false);

// ---------------------------------------------------------------------------
// truth_class integrity (docs/v5/product-constitution.md 「角色資料的五種身分」,
// AGENTS.md "Every visible claim carries one truth_class"). These fixtures are
// synthesised in this repository; calling any of them 真實資料 would be a false
// claim, so real_fact must be absent from the contract and from the data.
// ---------------------------------------------------------------------------

// Structural, not textual: collect every value either schema can actually
// admit (const / enum), so prose that merely names real_fact does not trip the
// check while a schema that made it a legal value would.
function admissibleValues(node, seen = []) {
  if (!node || typeof node !== "object") return seen;
  if (node.const !== undefined) seen.push(node.const);
  if (Array.isArray(node.enum)) seen.push(...node.enum);
  for (const value of Object.values(node)) {
    if (value && typeof value === "object") admissibleValues(value, seen);
  }
  return seen;
}
for (const [label, node] of [
  ["schema.json", schema],
  ["fact-revision.schema.json", factRevisionSchema],
]) {
  assert.ok(
    !admissibleValues(node).includes("real_fact"),
    `${label} must not make real_fact representable in historical mode`,
  );
}
for (const manifest of manifests) {
  assert.notEqual(manifest.truthClass, "real_fact", `${manifest.manifestId} claims truthClass real_fact`);
  assert.equal(manifest.truthClass, "fictional_setting");
  assert.equal(manifest.provenanceClass, "synthetic_fixture");
  assert.equal(manifest.modeDomain, "historical", `${manifest.manifestId} is not modeDomain historical`);
}
for (const revision of factRevisions) {
  assert.notEqual(
    revision.truthClass,
    "real_fact",
    `${revision.factRevisionId} claims truthClass real_fact; synthetic fixtures are fictional_setting`,
  );
  assert.equal(revision.truthClass, "fictional_setting");
  assert.equal(revision.provenanceClass, "synthetic_fixture");
}

// No floating-point literal may appear anywhere in either fixture: every
// quantity in this contract is an integer in a declared fixed-point or
// basis-point scale (prices are minor units scaled by 1,000,000).
for (const [label, raw] of [
  ["synthetic-historical-001.json", manifestsRaw],
  ["synthetic-historical-001-fact-revisions.json", factRevisionsRaw],
]) {
  // Anchored to a JSON key's closing quote so a digest string such as
  // "sha256:193845e4…" is not mistaken for the number 193845e4.
  const floatLiteral = raw.match(/"\s*:\s*-?\d+(\.\d+|[eE][+-]?\d+)/);
  assert.equal(floatLiteral, null, `${label} contains a floating-point literal: ${floatLiteral?.[0]}`);
}

// ---------------------------------------------------------------------------
// The thirty-session historical timeline this fixture exists to pin
// (ADR-PRODUCT-005 「可以先做一名角色的完整垂直切片」; delivery-plan M2 「30 個交易
// 日 fixture」). Prices are TWD minor units (分) further scaled by 1,000,000,
// matching public-v2.yaml's sealedPriceMinorUnitsFixed6.
//
// The dates follow a SYNTHETIC calendar (`synthetic-historical-calendar/v2`):
// consecutive weekdays from 2026-03-02, minus the two declared synthetic
// market holidays below. It is not, and does not claim to be, a real
// exchange calendar.
// ---------------------------------------------------------------------------

const SYNTHETIC_CALENDAR_REVISION = "synthetic-historical-calendar/v2";
const SYNTHETIC_MARKET_HOLIDAYS = ["2026-04-03", "2026-04-06"];

const expectedSessions = [
  { manifestId: "wfm_hist_001_s01", marketSessionId: "session-hist-001-s01", marketDateTaipei: "2026-03-02", closeFixed6: 9_600_000_000, finality: "accepted" },
  { manifestId: "wfm_hist_001_s02", marketSessionId: "session-hist-001-s02", marketDateTaipei: "2026-03-03", closeFixed6: 10_000_000_000, finality: "accepted" },
  { manifestId: "wfm_hist_001_s03", marketSessionId: "session-hist-001-s03", marketDateTaipei: "2026-03-04", closeFixed6: 9_640_000_000, finality: "accepted" },
  { manifestId: "wfm_hist_001_s04", marketSessionId: "session-hist-001-s04", marketDateTaipei: "2026-03-05", closeFixed6: 9_350_000_000, finality: "accepted" },
  { manifestId: "wfm_hist_001_s05", marketSessionId: "session-hist-001-s05", marketDateTaipei: "2026-03-06", closeFixed6: 9_410_000_000, finality: "accepted" },
  { manifestId: "wfm_hist_001_s06", marketSessionId: "session-hist-001-s06", marketDateTaipei: "2026-03-09", closeFixed6: 9_280_000_000, finality: "accepted" },
  { manifestId: "wfm_hist_001_s07", marketSessionId: "session-hist-001-s07", marketDateTaipei: "2026-03-10", closeFixed6: 9_160_000_000, finality: "accepted" },
  { manifestId: "wfm_hist_001_s08", marketSessionId: "session-hist-001-s08", marketDateTaipei: "2026-03-11", closeFixed6: 9_090_000_000, finality: "accepted" },
  { manifestId: "wfm_hist_001_s09", marketSessionId: "session-hist-001-s09", marketDateTaipei: "2026-03-12", closeFixed6: 9_130_000_000, finality: "accepted" },
  { manifestId: "wfm_hist_001_s10", marketSessionId: "session-hist-001-s10", marketDateTaipei: "2026-03-13", closeFixed6: 9_020_000_000, finality: "accepted" },
  { manifestId: "wfm_hist_001_s11", marketSessionId: "session-hist-001-s11", marketDateTaipei: "2026-03-16", closeFixed6: 8_940_000_000, finality: "accepted" },
  { manifestId: "wfm_hist_001_s12", marketSessionId: "session-hist-001-s12", marketDateTaipei: "2026-03-17", closeFixed6: 8_820_000_000, finality: "accepted" },
  { manifestId: "wfm_hist_001_s13", marketSessionId: "session-hist-001-s13", marketDateTaipei: "2026-03-18", closeFixed6: 8_860_000_000, finality: "accepted" },
  { manifestId: "wfm_hist_001_s14", marketSessionId: "session-hist-001-s14", marketDateTaipei: "2026-03-19", closeFixed6: 8_910_000_000, finality: "accepted" },
  { manifestId: "wfm_hist_001_s15", marketSessionId: "session-hist-001-s15", marketDateTaipei: "2026-03-20", closeFixed6: 8_890_000_000, finality: "accepted" },
  { manifestId: "wfm_hist_001_s16", marketSessionId: "session-hist-001-s16", marketDateTaipei: "2026-03-23", closeFixed6: 8_830_000_000, finality: "accepted" },
  { manifestId: "wfm_hist_001_s17", marketSessionId: "session-hist-001-s17", marketDateTaipei: "2026-03-24", closeFixed6: 8_760_000_000, finality: "accepted" },
  { manifestId: "wfm_hist_001_s18", marketSessionId: "session-hist-001-s18", marketDateTaipei: "2026-03-25", closeFixed6: 8_690_000_000, finality: "accepted" },
  { manifestId: "wfm_hist_001_s19", marketSessionId: "session-hist-001-s19", marketDateTaipei: "2026-03-26", closeFixed6: 8_610_000_000, finality: "accepted" },
  { manifestId: "wfm_hist_001_s20", marketSessionId: "session-hist-001-s20", marketDateTaipei: "2026-03-27", closeFixed6: 8_570_000_000, finality: "accepted" },
  { manifestId: "wfm_hist_001_s21", marketSessionId: "session-hist-001-s21", marketDateTaipei: "2026-03-30", closeFixed6: 8_620_000_000, finality: "accepted" },
  { manifestId: "wfm_hist_001_s22", marketSessionId: "session-hist-001-s22", marketDateTaipei: "2026-03-31", closeFixed6: 8_680_000_000, finality: "accepted" },
  { manifestId: "wfm_hist_001_s23", marketSessionId: "session-hist-001-s23", marketDateTaipei: "2026-04-01", closeFixed6: 8_710_000_000, finality: "accepted" },
  { manifestId: "wfm_hist_001_s24", marketSessionId: "session-hist-001-s24", marketDateTaipei: "2026-04-02", closeFixed6: 8_750_000_000, finality: "accepted" },
  { manifestId: "wfm_hist_001_s25", marketSessionId: "session-hist-001-s25", marketDateTaipei: "2026-04-07", closeFixed6: 8_680_000_000, finality: "accepted" },
  { manifestId: "wfm_hist_001_s26", marketSessionId: "session-hist-001-s26", marketDateTaipei: "2026-04-08", closeFixed6: 8_640_000_000, finality: "accepted" },
  { manifestId: "wfm_hist_001_s27", marketSessionId: "session-hist-001-s27", marketDateTaipei: "2026-04-09", closeFixed6: 8_690_000_000, finality: "accepted" },
  { manifestId: "wfm_hist_001_s28", marketSessionId: "session-hist-001-s28", marketDateTaipei: "2026-04-10", closeFixed6: 8_740_000_000, finality: "accepted" },
  { manifestId: "wfm_hist_001_s29", marketSessionId: "session-hist-001-s29", marketDateTaipei: "2026-04-13", closeFixed6: 8_720_000_000, finality: "accepted" },
  { manifestId: "wfm_hist_001_s30", marketSessionId: "session-hist-001-s30", marketDateTaipei: "2026-04-14", closeFixed6: 8_720_000_000, finality: "pending" },
];

assert.equal(manifests.length, expectedSessions.length, "expected exactly thirty historical session manifests");
assert.equal(
  expectedSessions.filter((expected) => expected.finality === "pending").length,
  1,
  "exactly one session (today) may still be pending",
);
assert.equal(expectedSessions.at(-1).finality, "pending", "only the last session may be pending");
expectedSessions.forEach((expected, i) => {
  const manifest = manifests[i];
  assert.equal(manifest.manifestId, expected.manifestId, `manifest ${i} id drifted`);
  assert.equal(manifest.marketSessionId, expected.marketSessionId, `${expected.manifestId} marketSessionId drifted`);
  assert.equal(manifest.marketDateTaipei, expected.marketDateTaipei, `${expected.manifestId} marketDateTaipei drifted`);
  if (i > 0) {
    assert.ok(
      manifests[i - 1].marketDateTaipei < manifest.marketDateTaipei,
      `marketDateTaipei must strictly increase: ${manifests[i - 1].marketDateTaipei} then ${manifest.marketDateTaipei}`,
    );
  }
  const day = expected.marketDateTaipei;
  assert.equal(
    manifest.marketCalendarRevision,
    SYNTHETIC_CALENDAR_REVISION,
    `${expected.manifestId} must name the synthetic calendar that decided its trading day`,
  );
  const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
  assert.ok(weekday !== 0 && weekday !== 6, `${expected.manifestId} falls on a weekend (${day})`);
  assert.ok(
    !SYNTHETIC_MARKET_HOLIDAYS.includes(day),
    `${expected.manifestId} falls on a declared synthetic market holiday (${day})`,
  );
  if (i > 0) {
    // Consecutive trading days: every weekday strictly between two adjacent
    // sessions must be a declared synthetic holiday, so no session is
    // silently skipped.
    const cursor = new Date(`${manifests[i - 1].marketDateTaipei}T00:00:00Z`);
    for (cursor.setUTCDate(cursor.getUTCDate() + 1); cursor.toISOString().slice(0, 10) < day; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      const gap = cursor.toISOString().slice(0, 10);
      const gapWeekday = cursor.getUTCDay();
      assert.ok(
        gapWeekday === 0 || gapWeekday === 6 || SYNTHETIC_MARKET_HOLIDAYS.includes(gap),
        `${gap} is a weekday between ${manifests[i - 1].manifestId} and ${expected.manifestId} but is not a declared synthetic holiday`,
      );
    }
  }
  assert.equal(
    Date.parse(manifest.interactionCutoffAt),
    Date.parse(`${day}T09:00:00+08:00`),
    `${expected.manifestId} interactionCutoffAt must be the Asia/Taipei session open`,
  );
  assert.equal(
    Date.parse(manifest.evidenceCutoffAt),
    Date.parse(`${day}T13:30:00+08:00`),
    `${expected.manifestId} evidenceCutoffAt must be the Asia/Taipei session close`,
  );
});

assert.equal(new Set(manifests.map((m) => m.manifestId)).size, manifests.length, "duplicate manifestId");
assert.equal(
  new Set(factRevisions.map((r) => r.factRevisionId)).size,
  factRevisions.length,
  "duplicate factRevisionId",
);

// objectUri must stay a repository-relative, authority-less fixture URI: no
// real host, no internal hostname, no private path may enter this contract.
const manifestById = new Map(manifests.map((manifest) => [manifest.manifestId, manifest]));
for (const manifest of manifests) {
  const uri = new URL(manifest.objectUri);
  assert.equal(uri.protocol, "panshi-fixture:", `${manifest.manifestId} objectUri must use the panshi-fixture scheme`);
  assert.equal(uri.host, "", `${manifest.manifestId} objectUri must not carry a host component`);
  assert.ok(
    !manifest.objectUri.includes("//"),
    `${manifest.manifestId} objectUri must not open an authority component`,
  );
  assert.equal(
    uri.hash,
    `#${manifest.manifestId}`,
    `${manifest.manifestId} objectUri fragment must select its own manifest slice`,
  );
  assert.ok(
    uri.pathname.startsWith("contracts/world-fact-manifest/historical-v1/"),
    `${manifest.manifestId} objectUri must be a repository-relative contracts path`,
  );
}

// ---------------------------------------------------------------------------
// Digest / hash recompute.
// ---------------------------------------------------------------------------

for (const manifest of manifests) {
  assert.equal(
    computeManifestHash(manifest),
    manifest.manifestHash,
    `${manifest.manifestId} manifestHash drifted from fixture content`,
  );
  assert.equal(
    digestRevisionIdSet(manifest.interactionFactRevisionIds, `${manifest.manifestId}.interactionFactRevisionIds`),
    manifest.interactionFactSetDigest,
    `${manifest.manifestId} interactionFactSetDigest drifted`,
  );
  assert.equal(
    digestRevisionIdSet(manifest.outcomeEvidenceRevisionIds, `${manifest.manifestId}.outcomeEvidenceRevisionIds`),
    manifest.outcomeEvidenceSetDigest,
    `${manifest.manifestId} outcomeEvidenceSetDigest drifted`,
  );
  const slice = manifestSlice(manifest.manifestId);
  assert.ok(slice.length > 0, `${manifest.manifestId} seals no fact revision of its own`);
  assert.equal(
    `sha256:${sha256Hex(Buffer.from(jcsCanonicalize(slice), "utf8"))}`,
    manifest.objectHash,
    `${manifest.manifestId} objectHash drifted from its mirrored fact-revision slice`,
  );
}

// ---------------------------------------------------------------------------
// Two-allowlist physical separation + eligibility (system-design.md §6.2),
// evaluated once per manifest. In historical mode interactionCutoffAt is the
// session open, so a revision that first became available intraday in session
// S is interaction-eligible only from session S+1 onwards — that is the fence,
// not a bug.
// ---------------------------------------------------------------------------

const revisionById = new Map(factRevisions.map((revision) => [revision.factRevisionId, revision]));

function requireRevision(id, listName) {
  const revision = revisionById.get(id);
  if (!revision) {
    throw new Error(`${listName} references factRevisionId ${id} which is not in the fact-revisions fixture`);
  }
  return revision;
}

function availableAt(revision) {
  return Math.max(Date.parse(revision.worldPublishedAt), Date.parse(revision.platformReceivedAt));
}

for (const manifest of manifests) {
  const interactionCutoffAt = Date.parse(manifest.interactionCutoffAt);
  const evidenceCutoffAt = Date.parse(manifest.evidenceCutoffAt);

  for (const id of manifest.interactionFactRevisionIds) {
    const revision = requireRevision(id, `${manifest.manifestId}.interactionFactRevisionIds`);
    assert.ok(
      revision.rightsScope === "interaction" || revision.rightsScope === "interaction_and_outcome",
      `${id} is used via ${manifest.manifestId}.interactionFactRevisionIds but rightsScope is "${revision.rightsScope}"`,
    );
    assert.ok(
      availableAt(revision) <= interactionCutoffAt,
      `${id} available_at is after ${manifest.manifestId}.interactionCutoffAt (interaction eligibility failed)`,
    );
  }

  for (const id of manifest.outcomeEvidenceRevisionIds) {
    const revision = requireRevision(id, `${manifest.manifestId}.outcomeEvidenceRevisionIds`);
    assert.ok(
      revision.rightsScope === "outcome" || revision.rightsScope === "interaction_and_outcome",
      `${id} is used via ${manifest.manifestId}.outcomeEvidenceRevisionIds but rightsScope is "${revision.rightsScope}"`,
    );
    assert.ok(
      availableAt(revision) <= evidenceCutoffAt,
      `${id} available_at is after ${manifest.manifestId}.evidenceCutoffAt (outcome eligibility failed)`,
    );
  }
}

const interactionSet = new Set(manifests.flatMap((manifest) => manifest.interactionFactRevisionIds));
const outcomeSet = new Set(manifests.flatMap((manifest) => manifest.outcomeEvidenceRevisionIds));
for (const revision of factRevisions) {
  const id = revision.factRevisionId;
  if (revision.rightsScope === "interaction") {
    assert.ok(!outcomeSet.has(id), `${id} has rightsScope "interaction" but appears in an outcome allowlist`);
  }
  if (revision.rightsScope === "outcome") {
    assert.ok(!interactionSet.has(id), `${id} has rightsScope "outcome" but appears in an interaction allowlist`);
  }
  const owner = manifestById.get(revision.manifestId);
  assert.ok(owner, `${id} names manifestId ${revision.manifestId}, which is not one of the fixture's manifests`);
  assert.ok(
    availableAt(revision) <= Date.parse(owner.evidenceCutoffAt),
    `${id} became available after its own session's evidenceCutoffAt; it belongs to a later session`,
  );
  if (revision.supersedesFactRevisionId) {
    const superseded = requireRevision(revision.supersedesFactRevisionId, `${id}.supersedesFactRevisionId`);
    assert.ok(
      availableAt(superseded) < availableAt(revision),
      `${id} supersedes ${superseded.factRevisionId}, which is not strictly earlier`,
    );
  }
}

// ---------------------------------------------------------------------------
// Payload integrity + the finality fence. A session whose
// MarketSessionFinality is not accepted publishes no outcome evidence at all —
// the fence is an absent allowlist entry, never a nulled placeholder
// (docs/v5/market-safety.md 「當期交易時段不得公開」).
// ---------------------------------------------------------------------------

const requiredPayloadFields = {
  sealed_close_price: ["currency", "minorUnitScale", "sealedClosePriceMinorUnitsFixed6", "marketSessionFinalityState"],
  market_momentum_signal: ["sessionMoveBasisPoints"],
  peer_group_inventory_days: ["peerGroupLabel", "inventoryDaysFixed6", "inventoryDaysChangeFixed6"],
  issuer_correction_notice: ["correctsFactRevisionId"],
};

for (const revision of factRevisions) {
  const { payload } = revision;
  const required = requiredPayloadFields[payload.kind];
  assert.ok(required, `${revision.factRevisionId} has unknown payload kind ${payload.kind}`);
  for (const field of required) {
    assert.ok(field in payload, `${revision.factRevisionId} payload kind ${payload.kind} is missing ${field}`);
  }
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === "number") {
      assert.ok(Number.isInteger(value), `${revision.factRevisionId} payload.${key} must be an integer`);
    }
  }
  if (payload.kind === "issuer_correction_notice") {
    assert.equal(
      payload.correctsFactRevisionId,
      revision.supersedesFactRevisionId,
      `${revision.factRevisionId} correctsFactRevisionId must equal supersedesFactRevisionId`,
    );
  }
  if (payload.kind === "sealed_close_price" && payload.marketSessionFinalityState !== "accepted") {
    assert.ok(
      !outcomeSet.has(revision.factRevisionId),
      `${revision.factRevisionId} has finality "${payload.marketSessionFinalityState}" but is published as outcome evidence`,
    );
    assert.ok(
      payload.carriedForwardFromFactRevisionId,
      `${revision.factRevisionId} is pending finality, so it must declare the accepted close it carries forward`,
    );
    const source = requireRevision(
      payload.carriedForwardFromFactRevisionId,
      `${revision.factRevisionId}.carriedForwardFromFactRevisionId`,
    );
    assert.equal(source.payload.marketSessionFinalityState, "accepted");
    assert.equal(
      source.payload.sealedClosePriceMinorUnitsFixed6,
      payload.sealedClosePriceMinorUnitsFixed6,
      `${revision.factRevisionId} carries forward a price that differs from ${source.factRevisionId}`,
    );
  }
}

for (const expected of expectedSessions) {
  const closes = factRevisions.filter(
    (revision) => revision.manifestId === expected.manifestId && revision.payload.kind === "sealed_close_price",
  );
  assert.equal(closes.length, 1, `${expected.manifestId} must seal exactly one close price`);
  const [close] = closes;
  assert.equal(
    close.payload.sealedClosePriceMinorUnitsFixed6,
    expected.closeFixed6,
    `${expected.manifestId} close price drifted`,
  );
  assert.equal(close.payload.marketSessionFinalityState, expected.finality, `${expected.manifestId} finality drifted`);
  const manifest = manifestById.get(expected.manifestId);
  if (expected.finality === "accepted") {
    assert.ok(
      manifest.outcomeEvidenceRevisionIds.includes(close.factRevisionId),
      `${expected.manifestId} accepted its finality but does not publish its own close as outcome evidence`,
    );
  } else {
    assert.deepEqual(
      manifest.outcomeEvidenceRevisionIds,
      [],
      `${expected.manifestId} has pending finality, so it must publish no outcome evidence at all`,
    );
  }
}

// The counter-evidence revision the slice's confirmation-bias predicate reads
// must stay reachable in every session after the one that first published it;
// if it silently dropped out of an allowlist the bias would look like a random
// quirk instead of a repeated, checkable miss.
const counterId = "fact-hist-001-s01-counter-inventory";
const counterOrigin = requireRevision(counterId, "counter-evidence check");
assert.equal(
  counterOrigin.manifestId,
  manifests[0].manifestId,
  `${counterId} must originate in the first session, so every later session has already had it available`,
);
for (const manifest of manifests.slice(1)) {
  assert.ok(
    manifest.interactionFactRevisionIds.includes(counterId),
    `${manifest.manifestId} drops ${counterId} from its interaction allowlist; the counter evidence must stay available`,
  );
}

console.log(
  `world-fact-manifest-historical audit passed: ${manifests.length} sessions ` +
    `${manifests[0].marketDateTaipei}..${manifests[manifests.length - 1].marketDateTaipei}, ` +
    `${factRevisions.length} fact revisions, all truthClass fictional_setting, ` +
    `digests verified, finality fence held (${manifests[manifests.length - 1].manifestId} publishes no outcome evidence)`,
);
