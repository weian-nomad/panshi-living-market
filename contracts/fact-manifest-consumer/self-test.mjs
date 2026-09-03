#!/usr/bin/env node
/**
 * Proves that `verify.mjs` actually refuses tampered releases.
 *
 * WHY THIS EXISTS
 * ---------------
 * A verifier that passes the pinned mirror tells you almost nothing on its own:
 * a script that exits 0 unconditionally passes it too. The risk this whole work
 * package was warned against is a LENIENT PARSER — one that quietly accepts a
 * release it did not really check. So the alarm is tested directly: each case
 * below mutates a COPY of the pinned mirror in the system temp directory, runs
 * the real `verify.mjs` against that copy, and asserts a non-zero exit.
 *
 * The cases escalate deliberately. The easy ones flip a byte and expect the
 * pinned INDEX to notice. The hard ones RE-SEAL the whole chain — recomputing
 * `manifestHash`, the set digests and every INDEX hash — so the only thing left
 * to catch them is a rule the verifier genuinely evaluates. If any of those
 * passed, the verifier would be decorative.
 *
 * Nothing here writes inside the repository: every mutation happens under
 * `os.tmpdir()` and is removed afterwards. Node builtins only; no network, no
 * database, no workspace import.
 *
 * Usage: node contracts/fact-manifest-consumer/self-test.mjs
 * Exit codes: 0 = every tamper case was correctly refused. 1 = the verifier let
 * something through (or wrongly refused the untouched control).
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PINNED = join(HERE, "pinned");
const VERIFY = join(HERE, "verify.mjs");
const RELEASE = "v0.1.0";
const TARGET = "2026-07-24/manifest.v1.json";
const TARGET_BUNDLE = "2026-07-24/bundle.v1.json";

const sha256Prefixed = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

function canonicalize(value) {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Object.is(value, -0) ? "0" : JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
    .join(",")}}`;
}

function setDigest(ids) {
  const joined = [...new Set(ids)]
    .sort((a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")))
    .join("\n");
  return sha256Prefixed(Buffer.from(joined, "utf8"));
}

function manifestHashOf(envelope) {
  const hashed = { ...envelope };
  delete hashed.manifestHash;
  return sha256Prefixed(Buffer.from(canonicalize(hashed), "utf8"));
}

/** A writable copy of the pinned mirror, with a few helpers bound to it. */
function mirror(scratch, name) {
  const root = join(scratch, name, "pinned");
  cpSync(PINNED, root, { recursive: true });
  const fixture = (relative) => join(root, "fixtures", RELEASE, relative);
  const read = (relative) => JSON.parse(readFileSync(fixture(relative), "utf8"));
  const writeCanonical = (relative, value) => writeFileSync(fixture(relative), canonicalize(value), { mode: 0o644 });

  /**
   * Re-seals the pinned INDEX so it agrees with whatever is now on disk. This
   * is the "attacker also updated the index" scenario: it strips away every
   * cheap tripwire and leaves only the rules the verifier really evaluates.
   */
  const reseal = (relative) => {
    const indexPath = join(root, "INDEX.json");
    const index = JSON.parse(readFileSync(indexPath, "utf8"));
    const entry = index.manifests.find((candidate) => candidate.manifestPath === relative);
    const manifestBytes = readFileSync(fixture(relative));
    const bundleBytes = readFileSync(fixture(entry.bundlePath));
    const envelope = JSON.parse(manifestBytes.toString("utf8"));
    Object.assign(entry, {
      manifestFileHash: sha256Prefixed(manifestBytes),
      bundleFileHash: sha256Prefixed(bundleBytes),
      manifestId: envelope.manifestId,
      manifestHash: envelope.manifestHash,
      objectHash: envelope.objectHash,
      interactionFactSetDigest: envelope.interactionFactSetDigest,
      outcomeEvidenceSetDigest: envelope.outcomeEvidenceSetDigest,
      interactionFactCount: envelope.interactionFactRevisionIds.length,
      outcomeEvidenceCount: envelope.outcomeEvidenceRevisionIds.length,
    });
    writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`, { mode: 0o644 });
  };

  return { root, fixture, read, writeCanonical, reseal };
}

function runVerifier(root) {
  try {
    execFileSync(process.execPath, [VERIFY, "--root", root, "--quiet"], { stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, stderr: "" };
  } catch (error) {
    return { code: error.status ?? 1, stderr: (error.stderr ?? Buffer.alloc(0)).toString("utf8") };
  }
}

/**
 * Each case returns the mirror it tampered with. `expects` names a fragment the
 * refusal message must contain, so a case cannot pass for the wrong reason —
 * e.g. an unrelated crash would also be non-zero.
 */
const CASES = [
  {
    name: "objectHash flipped, nothing else touched",
    expects: "manifestHash does not recompute",
    tamper: (m) => {
      const envelope = m.read(TARGET);
      envelope.objectHash = `sha256:${"0".repeat(64)}`;
      m.writeCanonical(TARGET, envelope);
    },
  },
  {
    name: "objectHash flipped AND manifestHash + INDEX re-sealed (self-consistent forgery)",
    expects: "objectHash does not match the sealed bundle bytes",
    tamper: (m) => {
      const envelope = m.read(TARGET);
      envelope.objectHash = `sha256:${"0".repeat(64)}`;
      envelope.manifestHash = manifestHashOf(envelope);
      m.writeCanonical(TARGET, envelope);
      m.reseal(TARGET);
    },
  },
  {
    name: "unknown envelope field added and fully re-sealed",
    expects: "unknown field",
    tamper: (m) => {
      const envelope = m.read(TARGET);
      // A character-state field is exactly what ADR-0001 forbids crossing.
      envelope.characterMood = "hopeful";
      envelope.manifestHash = manifestHashOf(envelope);
      m.writeCanonical(TARGET, envelope);
      m.reseal(TARGET);
    },
  },
  {
    name: "one allowlist id dropped, digests and INDEX fully re-sealed",
    expects: "is on neither allowlist",
    tamper: (m) => {
      const envelope = m.read(TARGET);
      envelope.interactionFactRevisionIds = envelope.interactionFactRevisionIds.slice(1);
      envelope.interactionFactSetDigest = setDigest(envelope.interactionFactRevisionIds);
      envelope.manifestId = `fm_20260724_r1_${envelope.interactionFactSetDigest.slice(7, 19)}`;
      envelope.manifestHash = manifestHashOf(envelope);
      m.writeCanonical(TARGET, envelope);
      m.reseal(TARGET);
    },
  },
  {
    name: "shape-legal but impossible sealedAt (2026-02-30T25:61:61Z), fully re-sealed",
    expects: "is not a real instant",
    tamper: (m) => {
      const envelope = m.read(TARGET);
      envelope.sealedAt = "2026-02-30T25:61:61Z";
      envelope.manifestHash = manifestHashOf(envelope);
      m.writeCanonical(TARGET, envelope);
      m.reseal(TARGET);
    },
  },
  {
    name: "an evidence time advanced past the cutoff, bundle and whole chain re-sealed",
    expects: "was not knowable at the evidence cutoff",
    tamper: (m) => {
      const bundle = m.read(TARGET_BUNDLE);
      bundle.revisions[0].worldPublishedAt = "2026-07-25T00:00:00Z";
      m.writeCanonical(TARGET_BUNDLE, bundle);
      const envelope = m.read(TARGET);
      envelope.objectHash = sha256Prefixed(readFileSync(m.fixture(TARGET_BUNDLE)));
      envelope.manifestHash = manifestHashOf(envelope);
      m.writeCanonical(TARGET, envelope);
      m.reseal(TARGET);
    },
  },
  {
    name: "licence class swapped off the consumer allowlist, fully re-sealed",
    expects: "is not on this consumer's allowlist",
    tamper: (m) => {
      const envelope = m.read(TARGET);
      envelope.licenseClass = "some.other.licence";
      envelope.manifestHash = manifestHashOf(envelope);
      m.writeCanonical(TARGET, envelope);
      m.reseal(TARGET);
    },
  },
  {
    name: "an unlisted extra manifest dropped into the mirror",
    expects: "absent from the pinned INDEX",
    tamper: (m) => {
      const envelope = m.read(TARGET);
      writeFileSync(m.fixture("2026-07-24/manifest.v1.r9.json"), canonicalize(envelope), { mode: 0o644 });
      writeFileSync(m.fixture("2026-07-24/bundle.v1.r9.json"), canonicalize(m.read(TARGET_BUNDLE)), { mode: 0o644 });
    },
  },
  {
    name: "the pinned schema itself swapped for a relaxed one",
    expects: "schema.json",
    tamper: (m) => {
      const schemaPath = join(m.root, "schema.json");
      const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
      // The classic relaxation: stop rejecting unknown fields.
      delete schema.additionalProperties;
      writeFileSync(schemaPath, JSON.stringify(schema, null, 2), { mode: 0o644 });
    },
  },
];

function main() {
  const scratch = mkdtempSync(join(tmpdir(), "fact-manifest-consumer-selftest-"));
  const problems = [];
  try {
    // Control: the untouched mirror must verify, or every refusal below is
    // meaningless (a verifier that refuses everything also "catches" tampering).
    const control = mirror(scratch, "control");
    const controlResult = runVerifier(control.root);
    if (controlResult.code !== 0) {
      problems.push(`control: an untouched copy of the mirror was refused\n${controlResult.stderr}`);
    } else {
      process.stdout.write("  ok   control — an untouched copy of the pinned mirror verifies\n");
    }

    CASES.forEach((testCase, index) => {
      const m = mirror(scratch, `case-${index}`);
      testCase.tamper(m);
      const result = runVerifier(m.root);
      if (result.code === 0) {
        problems.push(`case "${testCase.name}": the verifier ACCEPTED a tampered release (exit 0)`);
        return;
      }
      if (!result.stderr.includes(testCase.expects)) {
        problems.push(
          `case "${testCase.name}": refused (exit ${result.code}) but for the wrong reason — expected a message containing "${testCase.expects}", got:\n${result.stderr}`,
        );
        return;
      }
      process.stdout.write(`  ok   refused (exit ${result.code}) — ${testCase.name}\n`);
    });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  if (problems.length > 0) {
    process.stderr.write("fact-manifest consumer self-test FAILED — the verifier is not fail-closed:\n");
    for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
    return 1;
  }
  process.stdout.write(`fact-manifest consumer self-test OK — ${CASES.length} tamper case(s) correctly refused.\n`);
  return 0;
}

process.exitCode = main();
