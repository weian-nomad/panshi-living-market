// Audits contracts/character-lifecycle-policy/v1 (CharacterPopulationLifecycleManifestV1)
// and the one-character slice's manifest
// (fixtures/v5/one-character-slice/population-lifecycle.json).
//
// Delivery-plan lock 8 (人口延續鎖, docs/v5/delivery-plan.md) asks for every
// public resident to have a machine-verifiable CharacterLifecyclePolicy and a
// capacity reservation, and for the 1,850-resident qualification, the
// all-unsubscribed tail and the long-tail cost to have passed. The policy
// shape is docs/v5/system-design.md 7.2.1; the reservation is 7.2.2; the
// qualification is delivery-plan M4.
//
// The schema checks shape. This file checks what a schema cannot:
//
// - policy: coarseTickCadences in Visible -> Active -> Background order with
//   no tier missing or repeated; every other repeated field strictly
//   ascending in UTF-8 byte order (so also duplicate-free); the 7.2.1
//   minimum obligations all present; the policy digest recomputed from the
//   canonical JSON, never trusted as written;
// - approval: an approved policy names its approval, a draft names none;
// - capacity: the cost model is the one the policy names; while it is
//   unmeasured no obligation or cost figure appears anywhere -- not in a
//   reservation, a budget, or qualification evidence of any state (an
//   invented figure is a placeholder); once measured, every reservation is reserved with its
//   obligation and the reserved obligations fit the approved budget on every
//   horizon;
// - residents: sorted and unique; bound to this policy revision and digest;
//   every resident that is not WITHDRAWN has a reservation on this cost
//   model; a seed has no introduction id and an introduced resident has one
//   and a reserved reservation; the continuity history only walks legal
//   edges, in time order, from PUBLIC, and ends at the resident's class;
// - qualification: 50 + 60 x 5 x 6 = 1,850; not_run carries no evidence;
//   passed carries evidence of all 1,800 origins and asset packs on a
//   measured cost model;
// - the world: every resident of the public world projection is a PUBLIC
//   resident of this manifest.
//
// A manifest can be valid and still report lock 8 NOT passed -- that is the
// honest state of the slice, and this audit prints it. What it never accepts
// is a figure or a qualification the repository has not measured.
//
// Every negative fixture under fixtures/negative/ is one defect away from the
// slice's manifest and must fail with the rule code expected-violations.json
// names for it.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";

import { compileSchema, compareUtf8, isStrictlyAscendingUtf8 } from "./json-schema-subset.mjs";

const contractDir = new URL("../contracts/character-lifecycle-policy/v1/", import.meta.url);
const sliceManifestUrl = new URL("../fixtures/v5/one-character-slice/population-lifecycle.json", import.meta.url);
const sliceWorldUrl = new URL("../fixtures/v5/one-character-slice/api/v2/world.json", import.meta.url);

/** docs/v5/system-design.md 7.2.1, `type CharacterLifecyclePolicy`, in declaration order. */
export const POLICY_FIELDS = [
  "revision",
  "coarseTickCadences",
  "mandatoryFactClasses",
  "mandatoryPaperProcesses",
  "relationshipAndMemoryEligibilityRules",
  "maxBackgroundCognitionCallsPerPeriod",
  "sharedExtractionPolicyRevision",
  "visibilityHoldReasons",
  "withdrawalReasons",
  "retentionAndTombstonePolicyRevision",
  "capacityCostModelRevision",
];

export const TIER_ORDER = ["Visible", "Active", "Background"];

const SET_FIELDS = [
  "mandatoryFactClasses",
  "mandatoryPaperProcesses",
  "relationshipAndMemoryEligibilityRules",
  "visibilityHoldReasons",
  "withdrawalReasons",
];

/** 7.2.1: a PUBLIC character at least keeps holding corporate actions, marks and corrections, and relationship / memory eligibility. */
const MINIMUM_OBLIGATIONS = {
  mandatoryFactClasses: ["corporate_action", "fact_correction", "sealed_close_price"],
  mandatoryPaperProcesses: ["holding_corporate_action_application", "holding_correction_application", "holding_mark"],
  relationshipAndMemoryEligibilityRules: ["important_memory_event_eligibility", "important_relationship_event_eligibility"],
};

/** 7.2.1: PUBLIC -> WITHDRAWN only for an immediate safety or legal takedown. */
const IMMEDIATE_WITHDRAWAL_REASONS = new Set(["confirmed_legal_takedown", "confirmed_safety_violation"]);

/** The only reason a hold resolves back to the same PUBLIC character. */
const HOLD_RESOLVED = "hold_resolved";

const HORIZONS = [
  "originAndAssetOneTime",
  "activeFirst30Days",
  "backgroundThroughDay90",
  "backgroundThroughDay365",
  "fiveYearPresentValue",
  "terminalMaintenanceReserve",
];

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function policyDigest(policy) {
  return `sha256:${createHash("sha256").update(Buffer.from(canonicalJson(policy), "utf8")).digest("hex")}`;
}

const schema = JSON.parse(await readFile(new URL("schema.json", contractDir), "utf8"));
const validateSchema = compileSchema(schema, "character-lifecycle-policy/v1/schema.json");

/**
 * Every violation of the contract, as `{ code, message }`, plus the lock 8
 * verdict. Semantic rules run only on a schema-valid manifest (they assume
 * its shape); a schema failure is reported as code `schema`.
 */
export function lifecycleViolations(manifest, { worldResidentIds }) {
  const violations = [];
  const fail = (code, message) => violations.push({ code, message });
  for (const message of validateSchema(manifest, "manifest")) fail("schema", message);
  if (violations.length > 0) return { violations, lock8: { passed: false, reasons: ["manifest is not schema-valid"] } };

  const { policy } = manifest;

  // -- policy -----------------------------------------------------------------
  const tiers = policy.coarseTickCadences.map((cadence) => cadence.activityTier);
  if (JSON.stringify(tiers) !== JSON.stringify(TIER_ORDER)) {
    fail("tier_order", `coarseTickCadences tiers are ${tiers.join(",")}, must be exactly ${TIER_ORDER.join(",")}`);
  }
  for (const field of SET_FIELDS) {
    if (!isStrictlyAscendingUtf8(policy[field])) fail("unsorted", `policy.${field} is not strictly ascending in UTF-8 byte order`);
  }
  for (const [field, required] of Object.entries(MINIMUM_OBLIGATIONS)) {
    for (const value of required) {
      if (!policy[field].includes(value)) fail("mandatory_obligation_missing", `policy.${field} lacks ${value}`);
    }
  }
  const digest = policyDigest(policy);
  if (manifest.policyDigest !== digest) fail("policy_digest_mismatch", `policyDigest ${manifest.policyDigest} != recomputed ${digest}`);

  // -- approval ---------------------------------------------------------------
  if ((manifest.policyApprovalState === "approved") !== (manifest.policyApprovalRef !== null)) {
    fail("approval_incomplete", "an approved policy names its approval record, a draft names none");
  }

  // -- capacity ---------------------------------------------------------------
  const model = manifest.capacityCostModel;
  if (model.revision !== policy.capacityCostModelRevision) {
    fail("binding_mismatch", `capacityCostModel.revision ${model.revision} != policy.capacityCostModelRevision ${policy.capacityCostModelRevision}`);
  }
  const measured = model.measurementState === "measured";
  if (!measured && (model.measurementEvidenceRef !== null || manifest.capacityBudget !== null)) {
    fail("unmeasured_cost_numbers", "an unmeasured cost model has no evidence ref and no approved budget");
  }
  if (measured && (model.measurementEvidenceRef === null || manifest.capacityBudget === null)) {
    fail("cost_model_incomplete", "a measured cost model names its evidence and an approved budget");
  }

  // -- residents --------------------------------------------------------------
  const ids = manifest.residents.map((resident) => resident.characterId);
  if (new Set(ids).size !== ids.length) fail("duplicate", "residents repeat a characterId");
  else if (!isStrictlyAscendingUtf8(ids)) fail("unsorted", "residents are not in ascending characterId order");
  const reservationIds = manifest.residents
    .map((resident) => resident.capacityReservation?.capacityReservationId)
    .filter((id) => id !== undefined);
  if (new Set(reservationIds).size !== reservationIds.length) fail("duplicate", "two residents share a capacity reservation");

  const reserved = Object.fromEntries(HORIZONS.map((horizon) => [horizon, 0n]));
  for (const resident of manifest.residents) {
    const at = `resident ${resident.characterId}`;
    if (resident.lifecyclePolicyRevision !== policy.revision) {
      fail("binding_mismatch", `${at}: lifecyclePolicyRevision ${resident.lifecyclePolicyRevision} != ${policy.revision}`);
    }
    if (resident.lifecyclePolicyDigest !== digest) fail("policy_digest_mismatch", `${at}: bound to a different policy digest`);

    const reservation = resident.capacityReservation;
    if (reservation === null) {
      if (resident.continuityClass !== "WITHDRAWN") fail("reservation_missing", `${at}: ${resident.continuityClass} without a capacity reservation`);
    } else {
      if (reservation.capacityCostModelRevision !== model.revision) {
        fail("binding_mismatch", `${at}: reservation is on cost model ${reservation.capacityCostModelRevision}, not ${model.revision}`);
      }
      if ((reservation.introductionId === null) !== (resident.residentKind === "seed")) {
        fail("binding_mismatch", `${at}: introductionId must be null exactly for a seed resident`);
      }
      const isReserved = reservation.reservationState === "reserved";
      if (!measured && (isReserved || reservation.obligationMinorUnits !== null)) {
        fail("unmeasured_cost_numbers", `${at}: a reservation figure or grant without a measured cost model`);
      }
      if (measured && (!isReserved || reservation.obligationMinorUnits === null)) {
        fail("cost_model_incomplete", `${at}: on a measured cost model a reservation is reserved with its obligation`);
      }
      if (resident.residentKind === "introduced" && !isReserved) {
        fail("reservation_not_reserved", `${at}: an introduced resident activates only after CAPACITY_RESERVED`);
      }
      if (isReserved && reservation.obligationMinorUnits !== null) {
        for (const horizon of HORIZONS) reserved[horizon] += BigInt(reservation.obligationMinorUnits[horizon]);
      }
    }

    // Continuity: from PUBLIC, legal edges only, in time order, WITHDRAWN terminal.
    let current = "PUBLIC";
    let previousAt = null;
    for (const [index, step] of resident.continuityHistory.entries()) {
      const where = `${at}: continuityHistory[${index}]`;
      if (step.from !== current) fail("illegal_transition", `${where}: from ${step.from}, but the resident was ${current}`);
      if (previousAt !== null && compareUtf8(step.at, previousAt) <= 0) {
        fail("illegal_transition", `${where}: not after the previous change`);
      }
      const edge = `${step.from}->${step.to}`;
      const legal =
        (edge === "PUBLIC->VISIBILITY_HELD" && policy.visibilityHoldReasons.includes(step.reasonCode)) ||
        (edge === "VISIBILITY_HELD->PUBLIC" && step.reasonCode === HOLD_RESOLVED) ||
        (edge === "VISIBILITY_HELD->WITHDRAWN" && policy.withdrawalReasons.includes(step.reasonCode)) ||
        (edge === "PUBLIC->WITHDRAWN" &&
          policy.withdrawalReasons.includes(step.reasonCode) &&
          IMMEDIATE_WITHDRAWAL_REASONS.has(step.reasonCode));
      if (!legal) fail("illegal_transition", `${where}: ${edge} with reason ${step.reasonCode} is not a legal continuity change`);
      current = step.to;
      previousAt = step.at;
    }
    if (current !== resident.continuityClass) {
      fail("continuity_class_mismatch", `${at}: history ends at ${current}, continuityClass is ${resident.continuityClass}`);
    }
  }
  if (measured && manifest.capacityBudget !== null) {
    for (const horizon of HORIZONS) {
      const approved = BigInt(manifest.capacityBudget.approvedObligationMinorUnits[horizon]);
      if (reserved[horizon] > approved) {
        fail("capacity_exceeded", `${horizon}: reserved ${reserved[horizon]} exceeds the approved ${approved}`);
      }
    }
  }

  // -- qualification ----------------------------------------------------------
  const q = manifest.populationQualification;
  if (q.seedResidents + q.testerCount * q.introductionsPerTesterPerWindow * q.quotaWindows !== q.requiredPopulation) {
    fail("qualification_incomplete", "seed residents + testers x introductions x windows must equal the required population");
  }
  if (q.state === "not_run" && q.evidence !== null) fail("qualification_incomplete", "a qualification that has not run carries no evidence");
  // Run evidence carries cost figures (five-year present value, terminal
  // reserve). Whatever the state -- even `failed` -- they cannot exist
  // without a measured cost model.
  if (!measured && q.evidence !== null) {
    fail("unmeasured_cost_numbers", `a ${q.state} qualification carries cost figures while the cost model is unmeasured`);
  }
  if (q.state !== "not_run" && q.evidence === null) fail("qualification_incomplete", `a ${q.state} qualification carries its run evidence`);
  if (q.state === "passed" && q.evidence !== null) {
    const introduced = q.requiredPopulation - q.seedResidents;
    if (q.evidence.simulatedPopulation < q.requiredPopulation) {
      fail("qualification_incomplete", `simulated ${q.evidence.simulatedPopulation} residents, the qualification needs ${q.requiredPopulation}`);
    }
    if (q.evidence.originsBuilt !== introduced || q.evidence.assetPacksQualified !== introduced) {
      fail("qualification_incomplete", `every one of the ${introduced} origins and asset packs is built, not sampled`);
    }
    if (!measured) fail("qualification_incomplete", "a passed qualification needs a measured cost model");
  }

  // -- the world --------------------------------------------------------------
  for (const id of worldResidentIds) {
    const resident = manifest.residents.find((candidate) => candidate.characterId === id);
    if (resident === undefined || resident.continuityClass !== "PUBLIC") {
      fail("world_resident_unbound", `world resident ${id} has no PUBLIC lifecycle record`);
    }
  }

  // -- lock 8 -----------------------------------------------------------------
  const reasons = [];
  if (manifest.policyApprovalState !== "approved") reasons.push("policy is an unapproved draft");
  if (!measured) reasons.push("capacity cost model is unmeasured");
  if (q.state !== "passed") reasons.push(`1,850-resident qualification is ${q.state}`);
  const unreserved = manifest.residents.filter(
    (resident) => resident.continuityClass !== "WITHDRAWN" && resident.capacityReservation?.reservationState !== "reserved",
  ).length;
  if (unreserved > 0) reasons.push(`${unreserved} resident(s) without a reserved capacity reservation`);
  return { violations, lock8: { passed: violations.length === 0 && reasons.length === 0, reasons } };
}

// -- the schema itself, against the canonical type ------------------------------
assert.equal(schema.additionalProperties, false, "schema: top level must be closed");
assert.ok(!JSON.stringify(schema).includes('"format"'), "schema: `format` is an annotation; use real assertions");
const policyDef = schema.$defs.CharacterLifecyclePolicyV1;
assert.equal(policyDef.additionalProperties, false, "schema: the policy must be closed");
assert.deepEqual(policyDef.required, POLICY_FIELDS, "schema: policy fields drifted from system-design.md 7.2.1");
assert.deepEqual(Object.keys(policyDef.properties), POLICY_FIELDS, "schema: policy properties drifted from system-design.md 7.2.1");
assert.deepEqual(
  policyDef.properties.coarseTickCadences.items.properties.activityTier.enum,
  TIER_ORDER,
  "schema: activity tier enum must be the domain order",
);
for (const field of SET_FIELDS) {
  const items = policyDef.properties[field].items.enum;
  assert.ok(isStrictlyAscendingUtf8(items), `schema: ${field} enum must itself be in UTF-8 byte order`);
}
assert.deepEqual(schema.$defs.ContinuityClass.enum, ["PUBLIC", "VISIBILITY_HELD", "WITHDRAWN"]);

const world = JSON.parse(await readFile(sliceWorldUrl, "utf8"));
const worldResidentIds = world.characterPositions.map((position) => position.characterId);
assert.ok(worldResidentIds.length > 0, "the slice's world projection has residents to bind");

const failures = [];

// -- the slice's manifest --------------------------------------------------------
const slice = JSON.parse(await readFile(sliceManifestUrl, "utf8"));
const sliceResult = lifecycleViolations(slice, { worldResidentIds });
for (const { code, message } of sliceResult.violations) failures.push(`population-lifecycle.json [${code}] ${message}`);

// -- the negative corpus ---------------------------------------------------------
const negativeDir = new URL("fixtures/negative/", contractDir);
const expected = JSON.parse(await readFile(new URL("expected-violations.json", negativeDir), "utf8"));
const files = (await readdir(negativeDir)).filter((name) => name.endsWith(".json") && name !== "expected-violations.json").sort();
assert.deepEqual(files, Object.keys(expected).sort(), "every negative fixture has exactly one expected rule code, and every listed one exists");
assert.ok(files.length >= 25, `only ${files.length} negative fixtures`);
const codesSeen = new Set();
for (const name of files) {
  const manifest = JSON.parse(await readFile(new URL(name, negativeDir), "utf8"));
  const { violations } = lifecycleViolations(manifest, { worldResidentIds });
  const codes = new Set(violations.map((violation) => violation.code));
  codesSeen.add(expected[name]);
  if (!codes.has(expected[name])) {
    failures.push(`negative/${name}: expected ${expected[name]}, got ${[...codes].join(",") || "no violation"}`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(
  `character-lifecycle-policy audit passed: slice manifest valid (${slice.residents.length} resident(s), every world resident bound), ` +
    `${files.length} negative fixtures rejected with their expected rule (${codesSeen.size} distinct rules)`,
);
console.log(
  `delivery-plan lock 8 (人口延續鎖): ${sliceResult.lock8.passed ? "PASSED" : "NOT PASSED"}` +
    (sliceResult.lock8.reasons.length > 0 ? ` -- ${sliceResult.lock8.reasons.join("; ")}` : ""),
);
