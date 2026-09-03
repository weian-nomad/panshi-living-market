#!/usr/bin/env node
/**
 * Consumer-side conformance verifier for the pinned `fact-manifest/v1` release.
 *
 * WHAT THIS IS
 * ------------
 * A standalone, zero-dependency, READ-ONLY check that this repository's pinned
 * mirror of the producer's contract (`pinned/`) still verifies under an
 * INDEPENDENT implementation of the contract's rules. It is the consumer half of
 * ADR-0001's producer/consumer split: the research repo owns the schema and
 * emits the sealed bytes; this repo pins an exact release, mirrors it read-only,
 * and proves — with its own code, not the producer's — that it reaches the same
 * verdict over the same bytes.
 *
 * HARD CONSTRAINTS, all deliberate:
 *
 *  - Node builtins only (`node:fs`, `node:path`, `node:crypto`, `node:url`).
 *    No package import, no workspace import, no `crates/protocol`, no generated
 *    transport types, no database, no network. Run it with plain `node`.
 *  - It NEVER fetches `objectUri`. The bundle it hashes is the pinned sibling
 *    file. Fetching would make a CI check depend on a live host and would drag
 *    in the SSRF/redirect/punycode obligations of README MUST item 15 (a)-(c),
 *    which belong to a real ingest path, not to a contract check.
 *  - It is NOT a lenient parser. Every failure is fatal: the process exits
 *    non-zero and the release is treated as quarantined. There is no
 *    "warn and continue" path, no field it skips because it does not recognise
 *    it, and no schema keyword it silently ignores — an unimplemented keyword or
 *    an unsupported keyword value shape is a LOUD failure, because a validator
 *    that quietly drops a keyword reports green on constraints it never checked.
 *
 * WHAT IT PROVES, AND WHAT IT DOES NOT
 * ------------------------------------
 * Proves: the pinned bytes are internally self-consistent and structurally
 * conformant — schema-valid, hash-consistent, allowlist-consistent, and
 * compliant with the producer README's cross-field MUST list.
 *
 * Does NOT prove authenticity. `fact-manifest/v1` has `signatureKeyId` but no
 * signature VALUE field, so nothing here can distinguish the producer from
 * anyone who controls the publication channel. Source trust rests entirely on
 * how the mirror was obtained. This is recorded in the consumer risk note in
 * `README.md` and must not be overstated downstream.
 *
 * Does NOT prove the fixtures describe real market days. The pinned release
 * v0.1.0 was sealed from SYNTHETIC inputs — see `pinned/fixtures/v0.1.0/README.md`.
 * Shape and hash arithmetic are conformance-grade; market content is not.
 *
 * USAGE
 * -----
 *   node contracts/fact-manifest-consumer/verify.mjs
 *   node contracts/fact-manifest-consumer/verify.mjs --root <dir>   # verify a copy
 *   node contracts/fact-manifest-consumer/verify.mjs --quiet
 *
 * Exit codes: 0 = every pinned manifest verified. 1 = at least one check failed;
 * the release is quarantined and must not be ingested.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------------ *
 * Consumer-side allowlists (README MUST items 12, 13, 14, 15d)
 *
 * These are the consumer's OWN pins. They are the point of the exercise: an
 * unrecognised purpose, licence class, signing key or publication origin is a
 * quarantine, never a shrug.
 * ------------------------------------------------------------------ */

const PINNED_CONTRACT_VERSION = "fact-manifest/v1";
const PINNED_MODE_DOMAIN = "historical";
const PINNED_JURISDICTION = "TW";

const ALLOWED_PURPOSES = new Set(["sealed_world_state_ingest", "paper_outcome_settlement"]);

const ALLOWED_LICENSE_CLASSES = new Set(["panshi.sealed-market-facts.tw.synthetic-conformance"]);

const ALLOWED_SIGNATURE_KEY_IDS = new Set(["panshi-conformance-synthetic-signing-2026-09"]);

/** MUST 15(d): the producer origin this consumer pins. Compared, never fetched. */
const ALLOWED_OBJECT_ORIGINS = new Set(["https://panshi.nomadsustaintech.com"]);

/** Warn this many days before the pinned rights window closes. */
const RIGHTS_EXPIRY_WARNING_DAYS = 90;

/* ------------------------------------------------------------------ *
 * Failure collection — every failure is fatal; none is suppressed
 * ------------------------------------------------------------------ */

const failures = [];
const notes = [];

function fail(subject, detail) {
  failures.push(`${subject}: ${detail}`);
}

function check(condition, subject, detail) {
  if (!condition) fail(subject, detail);
  return condition;
}

/* ------------------------------------------------------------------ *
 * Canonicalisation and digests (RFC 8785 JCS + SHA-256)
 *
 * Written from the contract README's stated conventions, independently of the
 * producer's implementation. That independence is what makes agreement mean
 * something.
 * ------------------------------------------------------------------ */

const sha256Prefixed = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

function canonicalize(value, path = "$") {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${path}: ${String(value)} has no JCS serialisation`);
    return Object.is(value, -0) ? "0" : JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item, i) => canonicalize(item, `${path}[${i}]`)).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key], `${path}.${key}`)}`)
      .join(",")}}`;
  }
  throw new Error(`${path}: unsupported value type ${typeof value}`);
}

/** Set digest: dedupe, sort by UTF-8 byte order, join with a single "\n", SHA-256. */
function setDigest(ids) {
  const joined = [...new Set(ids)]
    .sort((a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")))
    .join("\n");
  return sha256Prefixed(Buffer.from(joined, "utf8"));
}

/** manifestHash excludes ONLY itself; objectHash stays inside the hashed bytes. */
function manifestHashOf(envelope) {
  const hashed = { ...envelope };
  delete hashed.manifestHash;
  return sha256Prefixed(Buffer.from(canonicalize(hashed), "utf8"));
}

/* ------------------------------------------------------------------ *
 * Zero-dependency JSON Schema 2020-12 subset validator
 *
 * `format` is treated as an ANNOTATION, not an assertion — the spec default.
 * Every string constraint the contract relies on must therefore hold through
 * `pattern`/`minLength` alone, which is exactly what the producer's own guard
 * asserts. Anything this validator does not implement throws instead of being
 * skipped: a subset validator that ignores keywords is a false-green machine.
 * ------------------------------------------------------------------ */

const ANNOTATION_KEYWORDS = new Set(["$schema", "$id", "title", "description", "format", "$comment", "examples"]);
const MAP_OF_SCHEMAS = new Set(["properties", "$defs"]);
const LIST_OF_SCHEMAS = new Set(["allOf", "anyOf", "oneOf"]);
const SINGLE_SCHEMA = new Set(["items", "not", "if", "then", "else"]);
const ASSERTION_KEYWORDS = new Set([
  "type",
  "const",
  "enum",
  "pattern",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "uniqueItems",
  "required",
  "additionalProperties",
  "$ref",
]);
const TYPE_NAMES = new Set(["null", "boolean", "object", "array", "number", "integer", "string"]);

const isSchemaObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * Refuses, by path, any keyword this validator does not implement and any value
 * shape it would mishandle (draft-07 tuple `items`, boolean subschemas,
 * `additionalProperties: true`, remote `$ref`). Runs before validation, so a
 * schema this code cannot fully evaluate can never produce a green run.
 */
function assertSchemaIsSupported(node, path, seen = new Set()) {
  if (!isSchemaObject(node)) throw new Error(`${path}: subschema must be an object`);
  if (seen.has(node)) return;
  seen.add(node);
  for (const [keyword, value] of Object.entries(node)) {
    if (ANNOTATION_KEYWORDS.has(keyword)) continue;
    if (MAP_OF_SCHEMAS.has(keyword)) {
      if (!isSchemaObject(value)) throw new Error(`${path}/${keyword}: must be a map of subschemas`);
      for (const [key, child] of Object.entries(value)) assertSchemaIsSupported(child, `${path}/${keyword}/${key}`, seen);
      continue;
    }
    if (LIST_OF_SCHEMAS.has(keyword)) {
      if (!Array.isArray(value) || value.length === 0) throw new Error(`${path}/${keyword}: must be a non-empty array`);
      value.forEach((child, i) => assertSchemaIsSupported(child, `${path}/${keyword}/${i}`, seen));
      continue;
    }
    if (SINGLE_SCHEMA.has(keyword)) {
      // Tuple-form `items: [ … ]` and boolean subschemas are draft-07 shapes a
      // naive `typeof === "object"` check accepts vacuously. Refuse both.
      if (!isSchemaObject(value)) throw new Error(`${path}/${keyword}: must be a single subschema object`);
      assertSchemaIsSupported(value, `${path}/${keyword}`, seen);
      continue;
    }
    if (!ASSERTION_KEYWORDS.has(keyword)) {
      throw new Error(`${path}/${keyword}: keyword is not implemented by this validator`);
    }
    if (keyword === "type" && !TYPE_NAMES.has(value)) {
      throw new Error(`${path}/type: only a single known type name is supported, got ${JSON.stringify(value)}`);
    }
    if (keyword === "additionalProperties" && value !== false) {
      throw new Error(`${path}/additionalProperties: only \`false\` is supported`);
    }
    if (keyword === "$ref" && (typeof value !== "string" || !value.startsWith("#/"))) {
      throw new Error(`${path}/$ref: only local refs are supported, got ${JSON.stringify(value)}`);
    }
    if (keyword === "pattern") new RegExp(value, "u");
    if (["minLength", "maxLength", "minItems", "maxItems"].includes(keyword)) {
      if (!Number.isInteger(value) || value < 0) throw new Error(`${path}/${keyword}: must be a non-negative integer`);
    }
    if (keyword === "required" && (!Array.isArray(value) || value.some((k) => typeof k !== "string"))) {
      throw new Error(`${path}/required: must be an array of property names`);
    }
  }
}

function resolveRef(ref, root) {
  const segments = ref.slice(2).split("/");
  let current = root;
  for (const segment of segments) {
    const key = segment.replaceAll("~1", "/").replaceAll("~0", "~");
    if (!isSchemaObject(current) || !(key in current)) throw new Error(`unresolvable $ref ${ref}`);
    current = current[key];
  }
  return current;
}

const jsonTypeOf = (value) => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
};

const typeMatches = (expected, value) => {
  const actual = jsonTypeOf(value);
  return expected === "number" ? actual === "number" || actual === "integer" : actual === expected;
};

const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function validate(node, value, root, path, errors) {
  if (node.$ref) {
    validate(resolveRef(node.$ref, root), value, root, path, errors);
  }
  for (const [keyword, expected] of Object.entries(node)) {
    switch (keyword) {
      case "type":
        if (!typeMatches(expected, value)) errors.push(`${path}: expected ${expected}, got ${jsonTypeOf(value)}`);
        break;
      case "const":
        if (!deepEqual(value, expected)) errors.push(`${path}: must equal ${JSON.stringify(expected)}`);
        break;
      case "enum":
        if (!expected.some((option) => deepEqual(value, option))) errors.push(`${path}: not one of the allowed values`);
        break;
      case "pattern":
        if (typeof value === "string" && !new RegExp(expected, "u").test(value)) {
          errors.push(`${path}: does not match ${expected}`);
        }
        break;
      case "minLength":
        if (typeof value === "string" && [...value].length < expected) errors.push(`${path}: shorter than ${expected}`);
        break;
      case "maxLength":
        if (typeof value === "string" && [...value].length > expected) errors.push(`${path}: longer than ${expected}`);
        break;
      case "minItems":
        if (Array.isArray(value) && value.length < expected) errors.push(`${path}: fewer than ${expected} items`);
        break;
      case "maxItems":
        if (Array.isArray(value) && value.length > expected) errors.push(`${path}: more than ${expected} items`);
        break;
      case "uniqueItems":
        if (expected === true && Array.isArray(value)) {
          const seen = new Set(value.map((item) => JSON.stringify(item)));
          if (seen.size !== value.length) errors.push(`${path}: items must be unique`);
        }
        break;
      case "required":
        if (isSchemaObject(value)) {
          for (const key of expected) {
            if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(`${path}: missing required ${key}`);
          }
        }
        break;
      case "properties":
        if (isSchemaObject(value)) {
          for (const [key, child] of Object.entries(expected)) {
            if (Object.prototype.hasOwnProperty.call(value, key)) {
              validate(child, value[key], root, `${path}.${key}`, errors);
            }
          }
        }
        break;
      case "additionalProperties":
        if (isSchemaObject(value)) {
          const declared = new Set(Object.keys(node.properties ?? {}));
          for (const key of Object.keys(value)) {
            if (!declared.has(key)) errors.push(`${path}.${key}: unknown field (the envelope is fail-closed)`);
          }
        }
        break;
      case "items":
        if (Array.isArray(value)) {
          value.forEach((item, i) => validate(expected, item, root, `${path}[${i}]`, errors));
        }
        break;
      case "allOf":
        expected.forEach((child, i) => validate(child, value, root, `${path}/allOf/${i}`, errors));
        break;
      case "anyOf":
        if (!expected.some((child) => subschemaMatches(child, value, root))) {
          errors.push(`${path}: matches none of the anyOf branches`);
        }
        break;
      case "oneOf": {
        const matched = expected.filter((child) => subschemaMatches(child, value, root)).length;
        if (matched !== 1) errors.push(`${path}: must match exactly one oneOf branch, matched ${matched}`);
        break;
      }
      case "not":
        if (subschemaMatches(expected, value, root)) errors.push(`${path}: must not match the "not" subschema`);
        break;
      case "if":
        if (subschemaMatches(expected, value, root)) {
          if (node.then) validate(node.then, value, root, `${path}/then`, errors);
        } else if (node.else) {
          validate(node.else, value, root, `${path}/else`, errors);
        }
        break;
      case "then":
      case "else":
        break; // driven by "if"
      case "$defs":
      case "$ref":
        break; // handled above / not an in-place assertion
      default:
        if (!ANNOTATION_KEYWORDS.has(keyword)) {
          // Unreachable once assertSchemaIsSupported has run, but a validator
          // must never fall through to "ignore" on an unknown keyword.
          throw new Error(`${path}: unimplemented keyword ${keyword}`);
        }
    }
  }
}

function subschemaMatches(node, value, root) {
  const errors = [];
  validate(node, value, root, "$", errors);
  return errors.length === 0;
}

/* ------------------------------------------------------------------ *
 * Real-instant parsing (README MUST item 16)
 *
 * `Date.parse` alone is not enough: it rolls non-existent days over (Feb 30 ->
 * Mar 2), so every component is round-tripped against the original string.
 * ------------------------------------------------------------------ */

function parsesToRealInstant(value) {
  if (typeof value !== "string") return false;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/.exec(value);
  if (!parts) return false;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return false;
  const parsed = new Date(ms);
  return (
    parsed.getUTCFullYear() === Number(parts[1]) &&
    parsed.getUTCMonth() + 1 === Number(parts[2]) &&
    parsed.getUTCDate() === Number(parts[3]) &&
    parsed.getUTCHours() === Number(parts[4]) &&
    parsed.getUTCMinutes() === Number(parts[5]) &&
    parsed.getUTCSeconds() === Number(parts[6])
  );
}

const parsesToRealDate = (value) =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && parsesToRealInstant(`${value}T00:00:00Z`);

/** Asia/Taipei is a fixed UTC+8 offset with no DST, so no tz database is needed. */
const taipeiDateOf = (instant) => new Date(Date.parse(instant) + 8 * 3600 * 1000).toISOString().slice(0, 10);

const INSTANT_FIELDS = ["sealedAt", "interactionCutoffAt", "evidenceCutoffAt", "rightsValidFrom", "rightsValidUntil"];

/* ------------------------------------------------------------------ *
 * Verification of one pinned manifest
 * ------------------------------------------------------------------ */

function verifyManifest(root, schema, entry, now) {
  const label = entry.manifestPath;
  const manifestFile = join(root, "fixtures", entry.release, entry.manifestPath);
  const bundleFile = join(root, "fixtures", entry.release, entry.bundlePath);

  if (!existsSync(manifestFile)) return fail(label, "pinned manifest file is missing");
  if (!existsSync(bundleFile)) return fail(label, `pinned bundle ${entry.bundlePath} is missing`);

  const manifestBytes = readFileSync(manifestFile);
  const bundleBytes = readFileSync(bundleFile);

  // -- 0. The pinned INDEX is the anchor: bytes must be the bytes we pinned. --
  check(
    sha256Prefixed(manifestBytes) === entry.manifestFileHash,
    label,
    `manifest bytes differ from the pinned INDEX hash (expected ${entry.manifestFileHash}, got ${sha256Prefixed(manifestBytes)})`,
  );
  check(
    sha256Prefixed(bundleBytes) === entry.bundleFileHash,
    label,
    `bundle bytes differ from the pinned INDEX hash (expected ${entry.bundleFileHash}, got ${sha256Prefixed(bundleBytes)})`,
  );

  let envelope;
  let bundle;
  try {
    envelope = JSON.parse(manifestBytes.toString("utf8"));
    bundle = JSON.parse(bundleBytes.toString("utf8"));
  } catch (error) {
    return fail(label, `not parseable JSON: ${error.message}`);
  }

  // -- 1. Structural validation against the PINNED schema. -------------------
  const errors = [];
  validate(schema, envelope, schema, "$", errors);
  for (const error of errors) fail(label, `schema: ${error}`);

  // -- 2. Version pins: an unratified mode/jurisdiction is quarantined. ------
  check(envelope.contractVersion === PINNED_CONTRACT_VERSION, label, `contractVersion is ${envelope.contractVersion}`);
  check(envelope.modeDomain === PINNED_MODE_DOMAIN, label, `modeDomain is ${envelope.modeDomain}, not the pinned historical`);
  check(envelope.jurisdiction === PINNED_JURISDICTION, label, `jurisdiction is ${envelope.jurisdiction}`);

  // -- 3. Field-by-field comparison against the pinned INDEX. ----------------
  for (const field of ["manifestId", "manifestHash", "objectHash", "interactionFactSetDigest", "outcomeEvidenceSetDigest"]) {
    check(
      envelope[field] === entry[field],
      label,
      `${field} is ${JSON.stringify(envelope[field])}, pinned INDEX says ${JSON.stringify(entry[field])}`,
    );
  }
  check(
    envelope.interactionFactRevisionIds.length === entry.interactionFactCount,
    label,
    `interaction allowlist has ${envelope.interactionFactRevisionIds.length} ids, pinned INDEX says ${entry.interactionFactCount}`,
  );
  check(
    envelope.outcomeEvidenceRevisionIds.length === entry.outcomeEvidenceCount,
    label,
    `outcome allowlist has ${envelope.outcomeEvidenceRevisionIds.length} ids, pinned INDEX says ${entry.outcomeEvidenceCount}`,
  );

  // -- 4. Recompute every digest the contract defines (MUST 10, 11). ---------
  const recomputedManifestHash = manifestHashOf(envelope);
  check(
    recomputedManifestHash === envelope.manifestHash,
    label,
    `manifestHash does not recompute (declared ${envelope.manifestHash}, recomputed ${recomputedManifestHash}); the rule excludes ONLY manifestHash and keeps objectHash inside`,
  );
  check(
    setDigest(envelope.interactionFactRevisionIds) === envelope.interactionFactSetDigest,
    label,
    "interactionFactSetDigest does not recompute",
  );
  check(
    setDigest(envelope.outcomeEvidenceRevisionIds) === envelope.outcomeEvidenceSetDigest,
    label,
    "outcomeEvidenceSetDigest does not recompute",
  );
  check(
    sha256Prefixed(bundleBytes) === envelope.objectHash,
    label,
    `objectHash does not match the sealed bundle bytes (declared ${envelope.objectHash}, computed ${sha256Prefixed(bundleBytes)})`,
  );

  // The published bytes must BE the JCS canonical form: if they are not, a
  // reformatting step exists somewhere and `sha256(file) === objectHash` was a
  // coincidence of this particular file rather than a property of the contract.
  try {
    check(bundleBytes.toString("utf8") === canonicalize(bundle), label, "bundle file is not its own JCS canonical form");
    check(manifestBytes.toString("utf8") === canonicalize(envelope), label, "manifest file is not its own JCS canonical form");
  } catch (error) {
    fail(label, `canonicalisation refused: ${error.message}`);
  }

  // -- 5. Cross-field MUST list (producer README). ---------------------------
  for (const field of INSTANT_FIELDS) {
    const value = envelope[field];
    if (field === "rightsValidUntil" && value === null) continue;
    check(parsesToRealInstant(value), label, `MUST 16: ${field} ${JSON.stringify(value)} is not a real instant`);
  }
  check(parsesToRealDate(envelope.marketDateTaipei), label, `MUST 16: marketDateTaipei is not a real calendar date`);

  const at = (field) => Date.parse(envelope[field]);
  check(at("rightsValidFrom") <= at("sealedAt"), label, "MUST 1: rights were not yet in force at sealing time");
  if (envelope.rightsValidUntil !== null) {
    check(at("rightsValidFrom") < at("rightsValidUntil"), label, "MUST 2: the rights window is empty");
    check(at("sealedAt") <= at("rightsValidUntil"), label, "MUST 2: rights had already expired at sealing time");
  }
  check(at("interactionCutoffAt") <= at("evidenceCutoffAt"), label, "MUST 4: interactionCutoffAt is later than evidenceCutoffAt");
  check(at("evidenceCutoffAt") <= at("sealedAt"), label, "MUST 5: sealed before its own evidence cutoff");
  for (const field of ["interactionCutoffAt", "evidenceCutoffAt"]) {
    check(
      taipeiDateOf(envelope[field]) >= envelope.marketDateTaipei,
      label,
      `MUST 6: ${field} falls before ${envelope.marketDateTaipei} in Asia/Taipei`,
    );
  }

  // MUST 3 — a BIND-TIME gate, re-run on every bind. Expired rights are fatal:
  // this is not softened into a warning, because "expired but ingested anyway"
  // is precisely the fail-open the contract exists to prevent. A separate
  // early warning fires while the window is still open.
  if (envelope.rightsValidUntil !== null) {
    const until = at("rightsValidUntil");
    check(
      now <= until,
      label,
      `MUST 3: the pinned rights window closed on ${envelope.rightsValidUntil}; pin a newer contract release rather than relaxing this check`,
    );
    const daysLeft = Math.floor((until - now) / 86400000);
    if (daysLeft >= 0 && daysLeft <= RIGHTS_EXPIRY_WARNING_DAYS) {
      notes.push(`${label}: rights window closes in ${daysLeft} day(s) (${envelope.rightsValidUntil}) — re-pin before then`);
    }
  }

  // MUST 12, 13, 14 — the consumer's own allowlists. Unknown means stop.
  for (const purpose of envelope.permittedPurposes) {
    check(ALLOWED_PURPOSES.has(purpose), label, `MUST 12: permitted purpose "${purpose}" is not on this consumer's allowlist`);
  }
  check(
    ALLOWED_LICENSE_CLASSES.has(envelope.licenseClass),
    label,
    `MUST 13: licenceClass "${envelope.licenseClass}" is not on this consumer's allowlist`,
  );
  check(
    ALLOWED_SIGNATURE_KEY_IDS.has(envelope.signatureKeyId),
    label,
    `MUST 14: signatureKeyId "${envelope.signatureKeyId}" is not on this consumer's pinned key list`,
  );

  // MUST 15(d) — the publication origin is pinned. (a)-(c) are network-time
  // obligations of a real ingest; this verifier never fetches, so it asserts
  // only what it can decide offline, and says so rather than implying more.
  const origin = /^(https:\/\/[^/]+)/.exec(envelope.objectUri)?.[1];
  check(
    origin !== undefined && ALLOWED_OBJECT_ORIGINS.has(origin),
    label,
    `MUST 15(d): objectUri origin ${JSON.stringify(origin)} is not the pinned producer origin`,
  );
  check(
    envelope.objectUri.endsWith(`/${entry.bundlePath}`),
    label,
    `objectUri does not name the sibling bundle ${entry.bundlePath}`,
  );

  // -- 6. Bundle-side invariants (MUST 8, 9). --------------------------------
  if (!Array.isArray(bundle.revisions)) return fail(label, "bundle has no revisions array");
  const interaction = envelope.interactionFactRevisionIds;
  const outcome = envelope.outcomeEvidenceRevisionIds;
  const inBundle = bundle.revisions.map((revision) => revision.factRevisionId);

  check(new Set(inBundle).size === inBundle.length, label, "bundle contains duplicate fact revision ids");
  check(inBundle.length === entry.sealedFactCount, label, `bundle holds ${inBundle.length} revisions, pinned INDEX says ${entry.sealedFactCount}`);
  check(
    interaction.filter((id) => outcome.includes(id)).length === 0,
    label,
    "the two allowlists overlap; interaction and outcome refs are never interchangeable",
  );
  for (const id of [...interaction, ...outcome]) {
    check(inBundle.includes(id), label, `MUST 9: allowlisted ${id} does not resolve inside the sealed bundle`);
  }
  for (const id of inBundle) {
    check(
      interaction.includes(id) || outcome.includes(id),
      label,
      `MUST 9: bundle revision ${id} is on neither allowlist and must not be used`,
    );
  }
  for (const revision of bundle.revisions) {
    check(
      parsesToRealInstant(revision.worldPublishedAt) && Date.parse(revision.worldPublishedAt) <= at("evidenceCutoffAt"),
      label,
      `MUST 8: ${revision.factRevisionId} was not knowable at the evidence cutoff (platform_received_at never advances it)`,
    );
  }

  check(bundle.marketDateTaipei === envelope.marketDateTaipei, label, "bundle market date disagrees with the envelope");
  check(bundle.manifestRevision === entry.manifestRevision, label, "bundle revision number disagrees with the pinned INDEX");
  check(
    (bundle.supersedesManifestId ?? null) === (entry.supersedesManifestId ?? null),
    label,
    "bundle supersedesManifestId disagrees with the pinned INDEX",
  );
  // A correction must name what it supersedes, and that manifest must still be
  // present: corrections supersede, they never overwrite.
  if (bundle.manifestRevision > 1) {
    check(
      typeof bundle.supersedesManifestId === "string" && bundle.supersedesManifestId.length > 0,
      label,
      "a correction must name the manifest it supersedes",
    );
  }

  // The attestation block is the producer's pinned statement that no direction,
  // ranking or interpretation crossed. A different value is a different
  // contract, so it is compared to a literal rather than merely inspected.
  const attestations = bundle.attestations ?? {};
  check(attestations.securityDirectionWeight === 0, label, "attestations.securityDirectionWeight must be exactly 0");
  check(attestations.editorialCategoryUse === "tag-only", label, "attestations.editorialCategoryUse must be tag-only");
  check(
    attestations.symbolicScope === "company-static-natal-longitude-only",
    label,
    "attestations.symbolicScope must be company-static-natal-longitude-only",
  );
  check(
    attestations.outcomeEvidenceUse === "paper-outcome-and-correction-only",
    label,
    "attestations.outcomeEvidenceUse must be paper-outcome-and-correction-only",
  );

  return undefined;
}

/* ------------------------------------------------------------------ *
 * Entry point
 * ------------------------------------------------------------------ */

function main(argv) {
  const quiet = argv.includes("--quiet");
  const rootFlag = argv.indexOf("--root");
  const root = rootFlag === -1 ? join(HERE, "pinned") : argv[rootFlag + 1];

  const indexPath = join(root, "INDEX.json");
  if (!existsSync(indexPath)) {
    process.stderr.write(`fact-manifest consumer verify: no pinned INDEX.json under ${root}\n`);
    return 1;
  }
  const index = JSON.parse(readFileSync(indexPath, "utf8"));

  const schemaPath = join(root, "schema.json");
  if (!existsSync(schemaPath)) {
    process.stderr.write(`fact-manifest consumer verify: no pinned schema.json under ${root}\n`);
    return 1;
  }
  const schemaBytes = readFileSync(schemaPath);
  if (sha256Prefixed(schemaBytes) !== index.schemaFileHash) {
    fail("pinned/schema.json", `bytes differ from the pinned INDEX hash (${index.schemaFileHash})`);
  }
  const schema = JSON.parse(schemaBytes.toString("utf8"));

  // A schema this validator cannot fully evaluate must never yield a green run.
  try {
    assertSchemaIsSupported(schema, "#");
  } catch (error) {
    process.stderr.write(`fact-manifest consumer verify: pinned schema is not fully supported — ${error.message}\n`);
    return 1;
  }

  // Nothing outside the pinned INDEX is verified, and nothing pinned may be
  // absent: an extra manifest lying around the mirror is itself a finding.
  const release = index.contractRelease;
  const fixtureRoot = join(root, "fixtures", release);
  const onDisk = [];
  if (existsSync(fixtureRoot)) {
    for (const day of readdirSync(fixtureRoot).sort()) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      for (const file of readdirSync(join(fixtureRoot, day)).sort()) {
        if (/^manifest\.v1(\.r\d+)?\.json$/.test(file)) onDisk.push(`${day}/${file}`);
      }
    }
  } else {
    fail(`fixtures/${release}`, "the pinned fixture release directory is missing");
  }
  const pinnedPaths = new Set(index.manifests.map((entry) => entry.manifestPath));
  for (const path of onDisk) {
    if (!pinnedPaths.has(path)) fail(path, "manifest is present in the mirror but absent from the pinned INDEX");
  }

  const now = Date.now();
  for (const entry of index.manifests) {
    verifyManifest(root, schema, { ...entry, release }, now);
  }

  if (failures.length > 0) {
    process.stderr.write(
      `fact-manifest consumer verify FAILED — ${failures.length} problem(s); the pinned release ${release} is QUARANTINED and must not be ingested:\n`,
    );
    for (const failure of failures) process.stderr.write(`  - ${failure}\n`);
    return 1;
  }

  if (!quiet) {
    process.stdout.write(
      `fact-manifest consumer verify OK — ${index.manifests.length} pinned manifest(s) of ${index.contractVersion} release ${release} verified against ${onDisk.length} mirrored file(s).\n` +
        "This proves self-consistency of the pinned bytes, NOT authenticity (v1 has no signature value field) and NOT that the fixtures describe real market days (release v0.1.0 was sealed from synthetic inputs).\n",
    );
    for (const note of notes) process.stdout.write(`  ! ${note}\n`);
  }
  return 0;
}

process.exitCode = main(process.argv.slice(2));
