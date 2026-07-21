import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const schemaUrl = new URL("../contracts/sealed-facts/v1/schema.json", import.meta.url);
const schema = JSON.parse(await readFile(schemaUrl, "utf8"));
const vectorUrl = new URL("../contracts/sealed-facts/v1/test-vector.json", import.meta.url);
const vector = JSON.parse(await readFile(vectorUrl, "utf8"));

const expectedRequired = [
  "fact_id",
  "schema_version",
  "source",
  "market_date_taipei",
  "symbol",
  "fact_type",
  "payload",
  "provenance",
  "content_hash",
];
const prohibitedTopLevel = [
  "character",
  "narrative",
  "symbolic",
  "astrology",
  "win_rate",
  "prediction",
  "forecast",
  "recommendation",
  "price_target",
  "signal",
];

assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
assert.equal(schema.additionalProperties, false);
assert.deepEqual(schema.required, expectedRequired);
assert.equal(schema.properties.schema_version.const, "sealed-fact/v1");
assert.match(schema.properties.content_hash.pattern, /sha256/);
assert.ok(schema.properties.supersedes, "append-only correction field is required in the contract");
for (const field of prohibitedTopLevel) {
  assert.equal(schema.properties[field], undefined, `prohibited top-level field: ${field}`);
}

function canonicalizeVector(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalizeVector).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalizeVector(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

const canonical = canonicalizeVector(vector.input);
assert.equal(canonical, vector.canonical_jcs_utf8, "RFC 8785 test-vector bytes drifted");
assert.equal(
  `sha256:${createHash("sha256").update(Buffer.from(canonical, "utf8")).digest("hex")}`,
  vector.content_hash,
  "sealed-fact content hash test vector drifted",
);

console.log("sealed-fact audit passed: immutable v1 evidence boundary and hash vector");
