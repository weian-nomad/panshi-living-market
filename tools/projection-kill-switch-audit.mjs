// Audits contracts/projection-kill-switch/v1 and the kill-switch set the
// one-character slice is projected under
// (fixtures/v5/one-character-slice/projection-kill-switch.json).
//
// docs/v5/market-safety.md "Kill switch" lists six things that must be
// closable independently. The Rust projection reads the set at emission time
// (tools/character-episode/src/public_api/kill_switch.rs) and fails closed
// when it is missing or unreadable. This script holds the contract side:
//
// 1. The schema is draft 2020-12, closed (additionalProperties: false), makes
//    every switch mandatory (no optional knob that silently defaults open),
//    and uses no `format` assertion.
// 2. The slice's set and every fixture under fixtures/valid/ pass the schema
//    and the ordering rule JSON Schema cannot express (each list strictly
//    ascending in UTF-8 byte order, which also rules out duplicates).
// 3. Every fixture under fixtures/negative/ is rejected. Each negative is one
//    defect away from fixtures/valid/every-switch-exercised.json, so a
//    rejection cannot come from an unrelated typo in the base.
//
// The Rust loader runs over the same two fixture directories
// (tools/character-episode/tests/projection_kill_switch.rs), so the schema
// and the loader are held to one corpus.

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

import { compileSchema, isStrictlyAscendingUtf8 } from "./json-schema-subset.mjs";

const contractDir = new URL("../contracts/projection-kill-switch/v1/", import.meta.url);
const sliceSetUrl = new URL("../fixtures/v5/one-character-slice/projection-kill-switch.json", import.meta.url);

const LIST_FIELDS = [
  "closedFactRevisionIds",
  "closedInstruments",
  "closedMarketSessionIds",
  "closedPaperActionRevealDates",
  "closedStoryActIds",
];

const schema = JSON.parse(await readFile(new URL("schema.json", contractDir), "utf8"));
const validateSchema = compileSchema(schema, "projection-kill-switch/v1/schema.json");

// -- 1. the schema itself ----------------------------------------------------
assert.equal(schema.type, "object", "schema: top level must be an object");
assert.equal(schema.additionalProperties, false, "schema: must be closed (additionalProperties: false)");
assert.deepEqual(
  [...schema.required].sort(),
  Object.keys(schema.properties).sort(),
  "schema: every property must be required -- an omitted switch must not default to open",
);
assert.ok(!JSON.stringify(schema).includes('"format"'), "schema: `format` is an annotation; use pattern/length assertions");
for (const field of LIST_FIELDS) {
  const node = schema.properties[field];
  assert.equal(node.type, "array", `schema: ${field} must be an array`);
  assert.equal(node.uniqueItems, true, `schema: ${field} must be a set (uniqueItems)`);
  assert.equal(typeof node.items.pattern, "string", `schema: ${field} items must carry a real pattern`);
  assert.ok(node.items.minLength >= 1, `schema: ${field} items must have a minLength`);
}
for (const field of ["currentMarketProjection", "tickerSpecificShareAndShortVideo"]) {
  assert.deepEqual(schema.properties[field].enum, ["closed", "open"], `schema: ${field} must be closed|open`);
}
assert.equal(schema.properties.revision.minimum, 1, "schema: revision 0 is reserved for the fail-closed set");

/** Every reason `text` is not a valid kill-switch set; empty when it is. */
export function killSwitchViolations(text, label) {
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return [`${label}: not JSON (${error.message})`];
  }
  const errors = validateSchema(value, label);
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const field of LIST_FIELDS) {
      const list = value[field];
      if (Array.isArray(list) && list.every((item) => typeof item === "string") && !isStrictlyAscendingUtf8(list)) {
        errors.push(`${label}.${field}: must be strictly ascending in UTF-8 byte order`);
      }
    }
  }
  return errors;
}

const failures = [];

// -- 2. the slice's set and the valid fixtures -------------------------------
const sliceErrors = killSwitchViolations(await readFile(sliceSetUrl, "utf8"), "fixtures/v5/one-character-slice/projection-kill-switch.json");
failures.push(...sliceErrors);

const validDir = new URL("fixtures/valid/", contractDir);
const validNames = (await readdir(validDir)).filter((name) => name.endsWith(".json")).sort();
assert.ok(validNames.includes("every-switch-exercised.json"), "fixtures/valid/every-switch-exercised.json is the negatives' base");
for (const name of validNames) {
  const errors = killSwitchViolations(await readFile(new URL(name, validDir), "utf8"), `valid/${name}`);
  failures.push(...errors);
}
const base = JSON.parse(await readFile(new URL("every-switch-exercised.json", validDir), "utf8"));
for (const field of LIST_FIELDS) {
  assert.ok(base[field].length > 0, `valid/every-switch-exercised.json must exercise ${field}`);
}

// -- 3. the negative fixtures ------------------------------------------------
const negativeDir = new URL("fixtures/negative/", contractDir);
const negativeNames = (await readdir(negativeDir)).filter((name) => name.endsWith(".json")).sort();
assert.ok(negativeNames.length >= 20, `only ${negativeNames.length} negative fixtures`);
const accepted = [];
for (const name of negativeNames) {
  const errors = killSwitchViolations(await readFile(new URL(name, negativeDir), "utf8"), `negative/${name}`);
  if (errors.length === 0) accepted.push(name);
}
for (const name of accepted) failures.push(`negative/${name}: was accepted, must be rejected`);

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(
  `projection-kill-switch audit passed: slice set valid, ${validNames.length} valid fixtures accepted, ${negativeNames.length} negative fixtures rejected`,
);
