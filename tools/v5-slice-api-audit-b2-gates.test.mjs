#!/usr/bin/env node
/**
 * Proves that `tools/v5-slice-api-audit.mjs` actually refuses the four B2
 * audit gates it is supposed to enforce:
 *
 *   1. buy/sell action-call phrases reaching a viewer
 *   2. the age floor (identity.ageYears < 20, or adultFictionalResident unset)
 *   3. utterance text/sha256 consistency (its own hash, and across every
 *      later appearance of the same utteranceArtifactId)
 *   4. P&L summary consistency (a loss cannot be worded away)
 *
 * and the two C2 gates layered on top of them:
 *
 *   5. field-level truth-class identity (the Rust walker in
 *      tools/character-episode/tests/slice_claim_truth_classes.rs, ported):
 *      a claim field without its own class, a system-label field holding a
 *      sentence outside contracts/openapi/public-v2-system-labels.json, a
 *      `real_fact` class, an unclassified paper number, a readable string
 *      list without its parallel classes, and a missing allowlist file
 *   6. action-call phrase SHAPES (modal / imperative / second person /
 *      "follow him" x trading verb), with negative controls proving the
 *      character's own third-person narration is not flagged
 *
 * and the two gaps a reviewer found in those C2 gates:
 *
 *   7. five reader-directed sentences that went through the shapes (verbs
 *      outside the verb list, a timing cue with no modal, a rhetorical
 *      "不…更待何时"), a named-character subject that was wrongly refused, an
 *      invented name that must NOT exempt, and a vocative before a comma
 *   8. sibling truth classes falling back to the object's `truthClass`: a
 *      relationship signal's `displayNameTruthClass` / `relationLabelTruthClass`
 *      deleted (in archive/relations and in the journal chapter's
 *      relationshipConsequence), re-classed away from `fictional_setting`, and
 *      the sibling map drifting from public-v2.yaml
 *
 * and the review of the phrase shapes that led to the structural
 * action-call rule (a trading verb needs a narrative subject before it, a
 * reader-addressed sentence is always refused, quotes are judged alone):
 *
 *   9.  six reader-directed sentences the shapes let through
 *   10. three families, three sentences each: verb + 吧/！, fear-of-missing-
 *       out conditionals, and 何不 / 是時候 / 快
 *   11. a quoted imperative attributed to someone else
 *   12. a borrowed subject (topic chain, previous sentence, an utterance's
 *       structural speaker) never covering an urging clause or a listed shape
 *
 *   with negative controls for the narrative side: topic chains across
 *   commas, a subject carried from the previous sentence, a listed phrase
 *   inside his own story, an urging thought with its own subject, and 我
 *   inside a quote
 *
 * WHY THIS EXISTS
 * ---------------
 * Same reasoning as `contracts/fact-manifest-consumer/self-test.mjs`: an
 * audit that passes the checked-in fixture proves nothing on its own — a
 * script that exits 0 unconditionally passes it too. So each case below
 * copies the real, checked-in `fixtures/v5/one-character-slice/api` tree (plus
 * the historical-manifest fixture the audit reads for its expected dates)
 * into a scratch directory under `os.tmpdir()`, tampers ONE field in that
 * copy, runs the real `tools/v5-slice-api-audit.mjs` against it as a child
 * process, and asserts a non-zero exit whose message names the actual reason.
 * The repo's own checked-in fixture is never touched.
 *
 * `v5-slice-api-audit.mjs` resolves its fixture paths relative to its own
 * `import.meta.url`, not via a --root flag, so the scratch directory mirrors
 * the repo's relative layout (`tools/`, `fixtures/v5/one-character-slice/api`,
 * `contracts/world-fact-manifest/historical-v1/fixtures/...`) and the copied
 * script is invoked from inside it.
 *
 * Usage: node tools/v5-slice-api-audit-b2-gates.test.mjs
 * Exit codes: 0 = the untouched control passed AND every tamper case was
 * correctly refused for its named reason. 1 = the audit let something
 * through, or refused for the wrong reason, or wrongly refused the control.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..");
const AUDIT_SCRIPT_SOURCE = join(REPO_ROOT, "tools", "v5-slice-api-audit.mjs");
const API_FIXTURE_SOURCE = join(REPO_ROOT, "fixtures", "v5", "one-character-slice", "api");
const HISTORICAL_MANIFEST_SOURCE = join(
  REPO_ROOT,
  "contracts",
  "world-fact-manifest",
  "historical-v1",
  "fixtures",
  "synthetic-historical-001.json",
);
const SYSTEM_LABELS_SOURCE = join(REPO_ROOT, "contracts", "openapi", "public-v2-system-labels.json");
const PUBLIC_V2_SOURCE = join(REPO_ROOT, "contracts", "openapi", "public-v2.yaml");
const CHARACTER_ID = "96450815-0db8-f735-a139-5ba222da86b2";

// Independent re-implementation of UtteranceArtifact::canonical_text_sha256
// (crates/character-domain/src/utterance.rs): sha256 of a fixed domain tag
// followed by the UTF-8 text bytes. Kept separate from the audit's own copy
// of this formula so a case that needs a *correct* hash for new text (to
// isolate the cross-occurrence check from the own-hash check) is not simply
// calling the code under test.
const UTTERANCE_TEXT_DOMAIN_TAG = Buffer.from("PSZS/UTTERANCE_TEXT/v1\0", "utf8");
function canonicalUtteranceSha256(text) {
  return createHash("sha256").update(UTTERANCE_TEXT_DOMAIN_TAG).update(Buffer.from(text, "utf8")).digest("hex");
}

function apiFile(scratchRoot, relative) {
  return join(scratchRoot, "fixtures", "v5", "one-character-slice", "api", "v2", "characters", CHARACTER_ID, relative);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2), { mode: 0o644 });
}

/** A writable copy of the checked-in fixture tree, laid out the way the
 * audit script expects to find it relative to its own copied location. */
function scratchCopy(scratch, name) {
  const root = join(scratch, name);
  mkdirSync(join(root, "tools"), { recursive: true });
  cpSync(AUDIT_SCRIPT_SOURCE, join(root, "tools", "v5-slice-api-audit.mjs"));
  mkdirSync(join(root, "fixtures", "v5", "one-character-slice", "api"), { recursive: true });
  cpSync(API_FIXTURE_SOURCE, join(root, "fixtures", "v5", "one-character-slice", "api"), { recursive: true });
  mkdirSync(join(root, "contracts", "world-fact-manifest", "historical-v1", "fixtures"), { recursive: true });
  cpSync(
    HISTORICAL_MANIFEST_SOURCE,
    join(root, "contracts", "world-fact-manifest", "historical-v1", "fixtures", "synthetic-historical-001.json"),
  );
  mkdirSync(join(root, "contracts", "openapi"), { recursive: true });
  cpSync(SYSTEM_LABELS_SOURCE, join(root, "contracts", "openapi", "public-v2-system-labels.json"));
  cpSync(PUBLIC_V2_SOURCE, join(root, "contracts", "openapi", "public-v2.yaml"));
  return root;
}

/** Appends `suffix` to close-up.json's unresolvedTensionSummary, a classed
 * (simulated_narrative) prose field no other gate inspects. */
function appendToTensionSummary(root, suffix) {
  const path = apiFile(root, "close-up.json");
  const closeUp = readJson(path);
  if (typeof closeUp.unresolvedTensionSummaryTruthClass !== "string") {
    throw new Error("fixture shape drifted: close-up unresolvedTensionSummary lost its own truth class");
  }
  closeUp.unresolvedTensionSummary += suffix;
  writeJson(path, closeUp);
}

/** The character's own name, read from the fixture rather than restated. */
function characterName() {
  const name = readJson(apiFile(REPO_ROOT, "close-up.json")).displayName;
  if (typeof name !== "string" || name.length < 2) throw new Error("fixture shape drifted: close-up has no displayName");
  return name;
}

/** The one relationship signal in archive/relations.json, for tampering. */
function tamperRelationsSignal(root, mutate) {
  const path = apiFile(root, "archive/relations.json");
  const relations = readJson(path);
  const signal = relations.acquaintances?.[0]?.relationshipSignals?.[0];
  if (signal?.displayNameTruthClass !== "fictional_setting" || signal?.relationLabelTruthClass !== "fictional_setting") {
    throw new Error("fixture shape drifted: acquaintances[0].relationshipSignals[0] lost its fictional_setting name/label classes");
  }
  if (signal.truthClass === "fictional_setting") {
    throw new Error("fixture shape drifted: the signal's own truthClass would no longer differ from its name's class");
  }
  mutate(signal);
  writeJson(path, relations);
}

/** The journal chapter's relationshipConsequence (entries[19]), for tampering. */
function tamperJournalRelationshipConsequence(root, mutate) {
  const path = apiFile(root, "life-journal.json");
  const journal = readJson(path);
  const consequence = journal.entries?.[19]?.relationshipConsequence;
  if (consequence?.displayNameTruthClass !== "fictional_setting" || consequence?.relationLabelTruthClass !== "fictional_setting") {
    throw new Error("fixture shape drifted: entries[19].relationshipConsequence lost its fictional_setting name/label classes");
  }
  mutate(consequence);
  writeJson(path, journal);
}

function runAudit(root) {
  try {
    execFileSync(process.execPath, [join(root, "tools", "v5-slice-api-audit.mjs")], {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: root,
    });
    return { code: 0, stderr: "" };
  } catch (error) {
    return { code: error.status ?? 1, stderr: (error.stderr ?? Buffer.alloc(0)).toString("utf8") };
  }
}

/**
 * Each case returns the scratch copy it tampered with. `expects` names a
 * fragment the refusal message must contain, so a case cannot pass for the
 * wrong reason -- e.g. an unrelated crash would also be non-zero.
 */
const CASES = [
  // -- (1) buy/sell action-call phrases -------------------------------------
  {
    name: "1a. close-up unresolvedTensionSummary gains a buy recommendation",
    expects: "action-call phrase",
    tamper: (root) => {
      const path = apiFile(root, "close-up.json");
      const closeUp = readJson(path);
      closeUp.unresolvedTensionSummary += " 建議明天開盤就買進。";
      writeJson(path, closeUp);
    },
  },
  {
    name: "1b. journal entry openQuestionSummary tells the viewer to follow him",
    expects: "action-call phrase",
    tamper: (root) => {
      const path = apiFile(root, "life-journal.json");
      const journal = readJson(path);
      journal.entries[0].openQuestionSummary += " 跟著他加碼。";
      writeJson(path, journal);
    },
  },
  {
    name: "1c. the character's own trade label alone must NOT be flagged (negative control)",
    // Not a CASES-loop tamper: exercised separately below as a sanity check
    // that the exclusion for the character's own "模擬買進/模擬賣出" record
    // does not make the whole action-call gate a no-op.
    skip: true,
  },

  // -- (2) age floor ----------------------------------------------------------
  {
    name: "2a. identity.ageYears dropped under 20",
    expects: "ageYears must be at least 20",
    tamper: (root) => {
      const path = apiFile(root, "archive/life.json");
      const life = readJson(path);
      life.identity.ageYears = 17;
      writeJson(path, life);
    },
  },
  {
    name: "2b. identity.adultFictionalResident removed",
    expects: "adultFictionalResident must be present and true",
    tamper: (root) => {
      const path = apiFile(root, "archive/life.json");
      const life = readJson(path);
      delete life.identity.adultFictionalResident;
      writeJson(path, life);
    },
  },

  // -- (3) utterance text / sha256 consistency ---------------------------------
  {
    name: "3a. an utterance's own text changed without recomputing its digest",
    expects: "does not match the canonical hash of canonicalTextUtf8",
    tamper: (root) => {
      const path = apiFile(root, "close-up.json");
      const closeUp = readJson(path);
      // canonicalTextSha256 is left as-is: now stale for the new text.
      closeUp.publicClaim.canonicalTextUtf8 = "其實整件事都是同事的錯，我沒有判斷錯。";
      writeJson(path, closeUp);
    },
  },
  {
    name: "3b. same utteranceArtifactId reads differently in a later appearance (self-consistent hash)",
    expects: "does not match its earlier appearance",
    tamper: (root) => {
      const path = apiFile(root, "life-journal.json");
      const journal = readJson(path);
      const segment = journal.entries[25].narrativeSegments[1];
      if (segment?.utteranceArtifactId !== "4431acbb-338d-854d-d14c-699be8e6a31e") {
        throw new Error("fixture shape drifted: entries[25].narrativeSegments[1] is no longer the expected utterance");
      }
      const rewrittenText = "後來想想，其實我早就知道會這樣。";
      segment.canonicalTextUtf8 = rewrittenText;
      // The digest IS recomputed correctly for the new text, so case 3a's
      // check passes here -- only the cross-occurrence check (this utterance
      // artifact id already read differently in close-up.json's publicClaim,
      // and in this same file's entries[25].contemporaneousClaim, processed
      // first) can catch it.
      segment.canonicalTextSha256 = canonicalUtteranceSha256(rewrittenText);
      writeJson(path, journal);
    },
  },

  // -- (4) P&L summary consistency ---------------------------------------------
  {
    name: "4. consequenceSummary laundered into a neutral 'holding' line",
    expects: "consequenceSummary must name the realized loss",
    tamper: (root) => {
      const path = apiFile(root, "archive/paper.json");
      const paper = readJson(path);
      if (!(paper.positions[0].realizedPnlMinorUnits < 0)) {
        throw new Error("fixture shape drifted: positions[0] no longer has a realized loss to hide");
      }
      paper.positions[0].consequenceSummary = "持有中。";
      writeJson(path, paper);
    },
  },

  // The Traditional-Chinese strings below (5b, 6a-6d, 7a-7g, 9a-12d and the
  // negative controls) are adversarial test inputs, never shown to anyone:
  // 未經 copy-taste 審稿, and deliberately so.

  // -- (5) field-level truth-class identity ---------------------------------
  {
    name: "5a. close-up currentVerbPhraseTruthClass deleted (the front end fails closed; the audit must too)",
    expects: ["$.currentVerbPhrase = ", "is not covered by a truth class on its own object"],
    tamper: (root) => {
      const path = apiFile(root, "close-up.json");
      const closeUp = readJson(path);
      if (typeof closeUp.currentVerbPhraseTruthClass !== "string" || Object.hasOwn(closeUp, "truthClass")) {
        throw new Error("fixture shape drifted: close-up currentVerbPhrase is no longer covered only by its sibling");
      }
      delete closeUp.currentVerbPhraseTruthClass;
      writeJson(path, closeUp);
    },
  },
  {
    name: "5b. a system-label field carries a sentence outside the contract allowlist",
    expects: ["relationshipConsequenceNullReason = ", "is not a listed system label for relationshipConsequenceNullReason"],
    tamper: (root) => {
      const path = apiFile(root, "life-journal.json");
      const journal = readJson(path);
      const entry = journal.entries.find((candidate) => typeof candidate.relationshipConsequenceNullReason === "string");
      if (!entry) throw new Error("fixture shape drifted: no chapter carries relationshipConsequenceNullReason");
      entry.relationshipConsequenceNullReason = "這一天沒有留下關係訊號，但他其實很在意她。";
      writeJson(path, journal);
    },
  },
  {
    name: "5c. a claim is re-classed as real_fact",
    expects: ['$.currentVerbPhraseTruthClass truth class "real_fact" may not appear', "found 1 real_fact class value(s)"],
    tamper: (root) => {
      const path = apiFile(root, "close-up.json");
      const closeUp = readJson(path);
      closeUp.currentVerbPhraseTruthClass = "real_fact";
      writeJson(path, closeUp);
    },
  },
  {
    name: "5d. a paper figure loses its object's truthClass (numbers are claims too)",
    expects: ["$.recentConsequenceHighlight.unrealizedPnlPercentFixed2 = ", "(number) is not covered"],
    tamper: (root) => {
      const path = apiFile(root, "close-up.json");
      const closeUp = readJson(path);
      if (!Number.isInteger(closeUp.recentConsequenceHighlight?.unrealizedPnlPercentFixed2)) {
        throw new Error("fixture shape drifted: close-up has no consequence highlight figure");
      }
      delete closeUp.recentConsequenceHighlight.truthClass;
      writeJson(path, closeUp);
    },
  },
  {
    name: "5e. a readable string list loses its parallel per-item class",
    expects: ["$.recentHighlights[2] = ", "is not covered by a parallel recentHighlightTruthClasses entry"],
    tamper: (root) => {
      const path = apiFile(root, "archive.json");
      const archive = readJson(path);
      if (!(archive.recentHighlights?.length === 3 && archive.recentHighlightTruthClasses?.length === 3)) {
        throw new Error("fixture shape drifted: archive recentHighlights no longer has 3 classed items");
      }
      archive.recentHighlightTruthClasses.pop();
      writeJson(path, archive);
    },
  },
  {
    name: "5f. the system-label allowlist file is missing (fail closed, nothing exempted)",
    expects: ["public-v2-system-labels.json: cannot read or parse the system-label allowlist"],
    tamper: (root) => {
      rmSync(join(root, "contracts", "openapi", "public-v2-system-labels.json"));
    },
  },

  // -- (6) action-call phrase shapes (none of these is in the literal list) --
  {
    name: '6a. "可以買進" (modal x buy) reaches a viewer',
    expects: ["action-call phrase shape (modal-or-imperative)", '"可以買進"'],
    tamper: (root) => appendToTensionSummary(root, "可以買進。"),
  },
  {
    name: '6b. "現在進場" (imperative time x enter) reaches a viewer',
    expects: ["$.entries[0].openQuestionSummary", "action-call phrase shape (modal-or-imperative)", '"現在進場"'],
    tamper: (root) => {
      const path = apiFile(root, "life-journal.json");
      const journal = readJson(path);
      journal.entries[0].openQuestionSummary += "現在進場。";
      writeJson(path, journal);
    },
  },
  {
    name: '6c. "你也跟著他布局" (second person x follow) reaches a viewer',
    expects: ["action-call phrase shape (second-person)", '"你也跟著他布局"'],
    tamper: (root) => appendToTensionSummary(root, "你也跟著他布局。"),
  },
  {
    name: '6d. third-person subject does NOT exempt a clause that addresses the reader ("他說你現在該停損")',
    expects: ["action-call phrase shape (second-person)", '"你現在該停損"'],
    tamper: (root) => appendToTensionSummary(root, "他說你現在該停損。"),
  },

  // -- (7) reader-directed sentences that used to pass every shape ------------
  {
    name: '7a. "還不趕快上車？" (上車 was not a trading verb)',
    expects: ["action-call phrase shape (modal-or-imperative)", '"趕快上車"', "action-call phrase shape (rhetorical)"],
    tamper: (root) => appendToTensionSummary(root, "還不趕快上車？"),
  },
  {
    name: '7b. "這個價位閉眼買就對了。" (bare 買, a timing cue and no modal)',
    expects: ["action-call phrase shape (timing)", '"閉眼買"', '"買就對了"'],
    tamper: (root) => appendToTensionSummary(root, "這個價位閉眼買就對了。"),
  },
  {
    name: '7c. "逢低買進正是時候。" (逢低 with no modal)',
    expects: ["action-call phrase shape (timing)", '"逢低買進"', '"買進正是時候"'],
    tamper: (root) => appendToTensionSummary(root, "逢低買進正是時候。"),
  },
  {
    name: '7d. "想賺的，現在就該把它賣了。" (a 把 object and 賣了)',
    expects: ["action-call phrase shape (modal-or-imperative)", '"該把它賣了"'],
    tamper: (root) => appendToTensionSummary(root, "想賺的，現在就該把它賣了。"),
  },
  {
    name: '7e. "此時不進場，更待何時？" (negated rhetorical question across a comma)',
    expects: ["action-call phrase shape (rhetorical)", '"不進場，更待何時"'],
    tamper: (root) => appendToTensionSummary(root, "此時不進場，更待何時？"),
  },
  {
    name: '7f. an invented name is not a projection character and exempts nothing ("王大明那天覺得應該加碼。")',
    expects: ["action-call phrase shape (modal-or-imperative)", '"應該加碼"'],
    tamper: (root) => appendToTensionSummary(root, "王大明那天覺得應該加碼。"),
  },
  {
    name: "7g. a vocative before the comma blocks the character-name exemption (想賺的，<name>說現在就該加碼。)",
    expects: ["action-call phrase shape (modal-or-imperative)", '"該加碼"'],
    tamper: (root) => appendToTensionSummary(root, `想賺的，${characterName()}說現在就該加碼。`),
  },

  // -- (8) sibling truth classes never fall back to the object class ----------
  {
    name: "8a. archive/relations signal loses displayNameTruthClass (would borrow the signal's simulated_narrative)",
    expects: [
      "$.acquaintances[0].relationshipSignals[0].displayName requires its own displayNameTruthClass",
      "is not covered by a truth class on its own object",
    ],
    tamper: (root) => tamperRelationsSignal(root, (signal) => delete signal.displayNameTruthClass),
  },
  {
    name: "8b. archive/relations signal loses relationLabelTruthClass",
    expects: ["$.acquaintances[0].relationshipSignals[0].relationLabel requires its own relationLabelTruthClass"],
    tamper: (root) => tamperRelationsSignal(root, (signal) => delete signal.relationLabelTruthClass),
  },
  {
    name: "8c. life-journal entries[19].relationshipConsequence loses displayNameTruthClass",
    expects: ["$.entries[19].relationshipConsequence.displayName requires its own displayNameTruthClass"],
    tamper: (root) => tamperJournalRelationshipConsequence(root, (consequence) => delete consequence.displayNameTruthClass),
  },
  {
    name: "8d. life-journal entries[19].relationshipConsequence loses relationLabelTruthClass",
    expects: ["$.entries[19].relationshipConsequence.relationLabel requires its own relationLabelTruthClass"],
    tamper: (root) => tamperJournalRelationshipConsequence(root, (consequence) => delete consequence.relationLabelTruthClass),
  },
  {
    name: "8e. a counterpart's displayNameTruthClass re-classed to simulated_narrative (allowed class, wrong identity)",
    expects: ['$.acquaintances[0].relationshipSignals[0].displayNameTruthClass must be "fictional_setting"', 'found "simulated_narrative"'],
    tamper: (root) =>
      tamperRelationsSignal(root, (signal) => {
        signal.displayNameTruthClass = "simulated_narrative";
      }),
  },
  {
    name: "8f. the sibling map drops a pair public-v2.yaml declares (map cannot drift from the contract)",
    expects: ["requiredSiblingTruthClasses misses RelationshipSignalView.relationLabel"],
    tamper: (root) => {
      const path = join(root, "contracts", "openapi", "public-v2-system-labels.json");
      const contract = readJson(path);
      delete contract.requiredSiblingTruthClasses.schemas.RelationshipSignalView.relationLabel;
      writeJson(path, contract);
    },
  },
  {
    name: "8g. public-v2.yaml is missing (fail closed: no schema can be identified)",
    expects: ["cannot read the required sibling truth-class map or check it against contracts/openapi/public-v2.yaml"],
    tamper: (root) => rmSync(join(root, "contracts", "openapi", "public-v2.yaml")),
  },

  // -- (9)-(12) the structural action-call rule --------------------------------
  // Every sentence below is appended to close-up unresolvedTensionSummary,
  // whose last fixture sentence ("第一次那句話，他還沒有收回。") already has 他 --
  // so each case also proves that a previous sentence's subject is NOT
  // borrowed by a sentence that opens on a verb, modal or urging word.
  // (9) six reader-directed sentences that went through the phrase shapes
  ...[
    ["9a", "進場吧！", '(trading-verb) "進場" [no-narrative-subject] in sentence "進場吧！"'],
    ["9b", "何不加碼？", '(trading-verb) "加碼" [no-narrative-subject] in sentence "何不加碼？"'],
    ["9c", "是時候出場了。", '(trading-verb) "出場" [no-narrative-subject] in sentence "是時候出場了。"'],
    ["9d", "這種價位不買，以後一定後悔。", '(trading-verb) "買" [no-narrative-subject] in sentence "這種價位不買，以後一定後悔。"'],
    ["9e", "各位先卡位再說。", '(second-person) "各位先卡位" [reader-address] in sentence "各位先卡位再說。"'],
    ["9f", "快進場！", '(trading-verb) "進場" [no-narrative-subject] in sentence "快進場！"'],
    // (10) the three families: verb + 吧/！, fear-of-missing-out conditionals,
    // and 何不 / 是時候 / 快
    ["10a", "加碼吧。", '(trading-verb) "加碼" [no-narrative-subject] in sentence "加碼吧。"'],
    ["10b", "停損吧！", '(trading-verb) "停損" [no-narrative-subject] in sentence "停損吧！"'],
    ["10c", "上車吧。", '(trading-verb) "上車" [no-narrative-subject] in sentence "上車吧。"'],
    ["10d", "再不進場就晚了。", '(trading-verb) "進場" [no-narrative-subject] in sentence "再不進場就晚了。"'],
    ["10e", "現在不上車就來不及了。", '(trading-verb) "上車" [no-narrative-subject] in sentence "現在不上車就來不及了。"'],
    ["10f", "不跟會後悔。", '(trading-verb) "跟" [no-narrative-subject] in sentence "不跟會後悔。"'],
    ["10g", "何不停損？", '(trading-verb) "停損" [no-narrative-subject] in sentence "何不停損？"'],
    ["10h", "是時候上車了。", '(trading-verb) "上車" [no-narrative-subject] in sentence "是時候上車了。"'],
    ["10i", "快加碼！", '(trading-verb) "加碼" [no-narrative-subject] in sentence "快加碼！"'],
    // (11) a quoted imperative is judged on its own, whoever says it
    ["11a", "「快進場！」他同事說。", '(trading-verb) "進場" [no-narrative-subject] in quoted sentence "快進場！"'],
    // (12) a borrowed subject (topic chain, previous sentence) never covers an
    // urging clause
    ["12a", "他看了一眼，快進場吧！", '(trading-verb) "進場" [imperative-mood] in sentence "他看了一眼，快進場吧！"'],
    ["12b", "他收盤前看了一眼。覺得該加碼吧！", '(modal-or-imperative) "該加碼" [imperative-mood] in sentence "覺得該加碼吧！"'],
  ].map(([id, sentence, fragment]) => ({
    name: `${id}. ${JSON.stringify(sentence)} is refused`,
    expects: ["close-up.json: $.unresolvedTensionSummary contains a buy/sell action-call phrase shape ", fragment],
    tamper: (root) => appendToTensionSummary(root, sentence),
  })),
  // (12) the structural subject of an utterance artifact (the character's own
  // words: the fixture's "原本的理由已經不成立，先減碼。" passes on it) covers a
  // bare verb only -- not an urging sentence, not a listed phrase or shape.
  {
    name: '12c. the character\'s own utterance turned urging ("…，快減碼！") is refused despite its structural speaker',
    expects: ['$.selfAcknowledgement.canonicalTextUtf8 contains a buy/sell action-call phrase shape (trading-verb) "減碼" [imperative-mood] in quoted sentence "原本的理由已經不成立，快減碼！"'],
    tamper: (root) => rewriteSelfAcknowledgement(root, "原本的理由已經不成立，快減碼！"),
  },
  {
    name: '12d. the character\'s own utterance carrying a listed phrase ("…，現在減碼。") is refused despite its structural speaker',
    expects: ['$.selfAcknowledgement.canonicalTextUtf8 contains a buy/sell action-call phrase shape (literal) "現在減碼" [no-narrative-subject]'],
    tamper: (root) => rewriteSelfAcknowledgement(root, "原本的理由已經不成立，現在減碼。"),
  },
];

/** Rewrites close-up selfAcknowledgement (an utterance artifact) with a
 * correct own hash, so the refusal under test is the action-call one. */
function rewriteSelfAcknowledgement(root, text) {
  const path = apiFile(root, "close-up.json");
  const closeUp = readJson(path);
  if (typeof closeUp.selfAcknowledgement?.utteranceArtifactId !== "string") {
    throw new Error("fixture shape drifted: close-up selfAcknowledgement is no longer an utterance artifact");
  }
  closeUp.selfAcknowledgement.canonicalTextUtf8 = text;
  closeUp.selfAcknowledgement.canonicalTextSha256 = canonicalUtteranceSha256(text);
  writeJson(path, closeUp);
}

/** Tampers the audit must ACCEPT: without these, a shape gate that flags
 * every trading verb would pass every refusal case above. */
const NEGATIVE_CASES = [
  {
    name: '"他當時決定賣出" (third-person narration of his own decision, no modal)',
    tamper: (root) => appendToTensionSummary(root, "他當時決定賣出。"),
  },
  {
    name: '"他當時覺得現在進場還來得及" (a modal inside his own third-person thought)',
    tamper: (root) => appendToTensionSummary(root, "他當時覺得現在進場還來得及。"),
  },
  {
    name: '"<the character\'s displayName>那天覺得應該加碼。" (a projection character as the subject, not only a pronoun)',
    tamper: (root) => appendToTensionSummary(root, `${characterName()}那天覺得應該加碼。`),
  },
  // The structural rule's narrative side: a subject across commas (topic
  // chain), a subject carried from the previous sentence of the same
  // paragraph, a subject inside the urging clause itself, and 我 inside a
  // quote. None of these may be refused.
  {
    name: '"他看到收盤又往下，覺得應該加碼攤平，最後還是沒動。" (topic chain: the comma keeps 他)',
    tamper: (root) => appendToTensionSummary(root, "他看到收盤又往下，覺得應該加碼攤平，最後還是沒動。"),
  },
  {
    name: '"他盯著盤，覺得可以攤平。" (topic chain)',
    tamper: (root) => appendToTensionSummary(root, "他盯著盤，覺得可以攤平。"),
  },
  {
    name: '"她看了一眼報價，心想該停損了，卻沒有按下去。" (topic chain)',
    tamper: (root) => appendToTensionSummary(root, "她看了一眼報價，心想該停損了，卻沒有按下去。"),
  },
  {
    name: '"<displayName>那晚跟同事說，他打算明天開盤就減碼。" (a listed phrase inside his own story)',
    tamper: (root) => appendToTensionSummary(root, `${characterName()}那晚跟同事說，他打算明天開盤就減碼。`),
  },
  {
    name: '"她勸他趁早停損，他沒有聽。" (a timing cue inside someone\'s story)',
    tamper: (root) => appendToTensionSummary(root, "她勸他趁早停損，他沒有聽。"),
  },
  {
    name: '"他收盤前看了一眼。覺得該減碼，但沒動。" (the previous sentence\'s subject carried on)',
    tamper: (root) => appendToTensionSummary(root, "他收盤前看了一眼。覺得該減碼，但沒動。"),
  },
  {
    name: '"他覺得再不進場就晚了。" (an urging thought whose subject sits in its own clause)',
    tamper: (root) => appendToTensionSummary(root, "他覺得再不進場就晚了。"),
  },
  {
    name: '"「我明天開盤就減碼。」他說。" (我 is a subject inside a quote)',
    tamper: (root) => appendToTensionSummary(root, "「我明天開盤就減碼。」他說。"),
  },
];

function main() {
  const scratch = mkdtempSync(join(tmpdir(), "v5-slice-api-audit-b2-selftest-"));
  const problems = [];
  try {
    // Control: an untouched copy of the checked-in fixture must pass, or
    // every refusal below is meaningless (an audit that refuses everything
    // also "catches" tampering).
    const controlRoot = scratchCopy(scratch, "control");
    const controlResult = runAudit(controlRoot);
    if (controlResult.code !== 0) {
      problems.push(`control: an untouched copy of the fixture was refused\n${controlResult.stderr}`);
    } else {
      process.stdout.write("  ok   control — an untouched copy of the checked-in fixture passes\n");
    }

    // Negative control for (1): the character's own paper-trade labels must
    // survive untouched, or the exclusion in stripCharacterOwnTradeLabels()
    // has drifted and the whole action-call gate would be trivially true
    // (every response already legitimately contains the strings 買進/賣出).
    const negativeRoot = scratchCopy(scratch, "negative-control-own-trade-labels");
    const negativeResult = runAudit(negativeRoot);
    if (negativeResult.code !== 0) {
      problems.push(
        `negative control: the checked-in fixture's own "模擬買進/模擬賣出" labels were wrongly flagged as an action-call phrase\n${negativeResult.stderr}`,
      );
    } else {
      process.stdout.write(
        '  ok   negative control — "模擬買進/模擬賣出" (the character\'s own trade record) is not flagged\n',
      );
    }

    CASES.filter((testCase) => !testCase.skip).forEach((testCase, index) => {
      const root = scratchCopy(scratch, `case-${index}`);
      testCase.tamper(root);
      const result = runAudit(root);
      if (result.code === 0) {
        problems.push(`case "${testCase.name}": the audit ACCEPTED a tampered fixture (exit 0)`);
        return;
      }
      const expected = Array.isArray(testCase.expects) ? testCase.expects : [testCase.expects];
      const missing = expected.filter((fragment) => !result.stderr.includes(fragment));
      if (missing.length > 0) {
        problems.push(
          `case "${testCase.name}": refused (exit ${result.code}) but for the wrong reason — expected a message containing ${missing.map((fragment) => JSON.stringify(fragment)).join(" and ")}, got:\n${result.stderr}`,
        );
        return;
      }
      process.stdout.write(`  ok   refused (exit ${result.code}) — ${testCase.name}\n`);
    });

    NEGATIVE_CASES.forEach((testCase, index) => {
      const root = scratchCopy(scratch, `negative-${index}`);
      testCase.tamper(root);
      const result = runAudit(root);
      if (result.code !== 0) {
        problems.push(`negative case ${testCase.name}: wrongly refused (exit ${result.code})\n${result.stderr}`);
        return;
      }
      process.stdout.write(`  ok   accepted — negative control ${testCase.name}\n`);
    });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }

  if (problems.length > 0) {
    process.stderr.write("v5-slice-api-audit B2-gates self-test FAILED — the audit is not fail-closed:\n");
    for (const problem of problems) process.stderr.write(`  - ${problem}\n`);
    process.exit(1);
  }
  process.stdout.write(
    `v5-slice-api-audit B2-gates self-test OK — control + ${1 + NEGATIVE_CASES.length} negative control(s) accepted + ${CASES.filter((c) => !c.skip).length} tamper case(s) correctly refused.\n`,
  );
}

main();
