import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

// ---------------------------------------------------------------------------
// Audits the generated one-character-slice public API fixture
// (`fixtures/v5/one-character-slice/api`, written by
// `cargo run -p panshi-character-episode -- --write-public-api`).
//
// Same hand-rolled style as tools/world-fact-manifest-audit.mjs: ajv is not
// in this workspace and this check does not warrant adding a dependency. It
// deliberately does NOT re-derive the numbers -- the Rust side owns that and
// proves it with its own tests. What this script guards is the contract
// surface a browser actually sees: that every documented route has a file,
// that each file carries the required fields its `public-v2.yaml` schema
// declares, that the slice's fixed cardinalities hold, that the same-day
// disclosure key is structurally absent while finality is pending, that every
// deep-archive section item carries a truth class and a source, that every
// journal chapter carries its typed evidence card, and that no banned string
// or ranking-shaped field ever reaches a viewer.
//
// The action-call rule below (a structural sentence rule over trading verbs,
// with the banned-phrase list and the older phrase SHAPES folded into it) is
// the LAST line of defence, not the primary control. The primary control is
// the generation pipeline itself: prose is rendered from approved structured
// state through versioned deterministic templates and a policy gate that the
// model does not decide (AGENTS.md "Data, AI, and privacy"). A rule over
// Traditional Chinese cannot tell every urging sentence from every story
// sentence: urging without a listed trading verb, and an urging clause that
// carries its own third-person subject, get through. That residual risk is
// recorded in docs/v5/one-character-slice-runbook.md section 3.1 -- do not
// treat a green audit as proof that no copy reads as trading advice.
// ---------------------------------------------------------------------------

const apiRoot = new URL("../fixtures/v5/one-character-slice/api/", import.meta.url);

// The slice's market calendar is the repo-owned synthetic historical fixture.
// The expected chapter dates, today's date and the previous close are read
// from it rather than restated here, so the two cannot drift apart.
const historicalManifests = JSON.parse(
  await readFile(
    new URL(
      "../contracts/world-fact-manifest/historical-v1/fixtures/synthetic-historical-001.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const SESSION_COUNT = historicalManifests.length;
const SETTLED_DATES = historicalManifests
  .filter((manifest) => manifest.outcomeEvidenceRevisionIds.length > 0)
  .map((manifest) => manifest.marketDateTaipei);
const TODAY = historicalManifests[SESSION_COUNT - 1].marketDateTaipei;
const PREVIOUS_CLOSE_DATE = SETTLED_DATES[SETTLED_DATES.length - 1];

// 老毛病又回來了: the counter-evidence stays unread from 2026-03-03 through
// 2026-03-16, so the pattern may be called recurring on the sessions where it
// was observed again after two earlier occurrences -- 2026-03-05 through
// 2026-03-16 -- and on no other chapter (not on the day he finally read it).
const RECURRING_PATTERN_DATES = [
  "2026-03-05",
  "2026-03-06",
  "2026-03-09",
  "2026-03-10",
  "2026-03-11",
  "2026-03-12",
  "2026-03-13",
  "2026-03-16",
];

const errors = [];

function check(condition, message) {
  if (!condition) errors.push(message);
}

// `contracts/openapi/public-v2-system-labels.json`: the fixed sentences each
// `x-panshi-system-label` field may hold, and the numeric keys that are
// provenance / versioning / scene layout rather than claims. The field-level
// truth-class walker below reads both lists from here, exactly as
// `tools/character-episode/tests/slice_claim_truth_classes.rs` does, so the
// audit and the Rust test cannot disagree about what counts as "not a claim".
// A missing or malformed list fails closed: without it nothing can be
// exempted, and the audit refuses rather than guessing.
const SYSTEM_LABEL_CONTRACT_PATH = "contracts/openapi/public-v2-system-labels.json";
let systemLabelAllowlist = null;
try {
  const contract = JSON.parse(await readFile(new URL(`../${SYSTEM_LABEL_CONTRACT_PATH}`, import.meta.url), "utf8"));
  const labels = new Map();
  for (const [field, texts] of Object.entries(contract.systemLabels ?? {})) {
    if (!Array.isArray(texts) || !texts.every((text) => typeof text === "string")) {
      throw new Error(`systemLabels.${field} is not a list of strings`);
    }
    labels.set(field, new Set(texts));
  }
  if (contract.nonClaimNumberKeys === null || typeof contract.nonClaimNumberKeys !== "object") {
    throw new Error("nonClaimNumberKeys is not an object");
  }
  if (labels.size === 0) throw new Error("systemLabels is empty");
  systemLabelAllowlist = { labels, nonClaimNumbers: new Set(Object.keys(contract.nonClaimNumberKeys)) };
} catch (error) {
  errors.push(`${SYSTEM_LABEL_CONTRACT_PATH}: cannot read or parse the system-label allowlist (${error.message})`);
}

// Sibling truth classes that may NOT fall back to the object's `truthClass`.
//
// Where a public-v2.yaml schema gives a property `x` its own sibling
// `xTruthClass`, the contract has said that `x` is a separate claim from the
// object it sits on -- a relationship signal's `truthClass` is his act
// (`simulated_narrative`), while the counterpart's `displayName` is authored
// chassis (`fictional_setting`). The generic walker rule ("a sibling class
// wins if present, else the object's `truthClass`") would let a deleted
// sibling silently borrow the object's class, which is exactly what 2.2.0
// forbids. So for these keys the sibling is mandatory and, where the map
// pins one, its value is fixed.
//
// WHERE THE MAP LIVES, and why: `requiredSiblingTruthClasses` in
// contracts/openapi/public-v2-system-labels.json, not re-derived from the
// YAML alone. The YAML does declare every `xTruthClass` property, but the
// class a person's name must carry is only written in description prose
// ("the counterpart is authored chassis, `fictional_setting`"), which no
// machine can read; and the JSON is the file this audit and the Rust walker
// already share for "what counts as a claim". The YAML is still the source of
// WHICH keys need a sibling: `siblingContract` below re-derives the
// schema/property pairs from public-v2.yaml and the audit refuses if the JSON
// map lists a pair the contract does not declare or misses one it does. The
// YAML also tells the walker which schema an object is: a property that
// exactly one schema declares identifies that schema.
//
// Equivalent to `tools/character-episode/tests/slice_claim_truth_classes.rs`,
// whose `covered_here` also derives schema identity from `public-v2.yaml`
// and reads this same `requiredSiblingTruthClasses.schemas` map, not just a
// `RelationshipSignalView`-only table.
const PUBLIC_V2_CONTRACT_PATH = "contracts/openapi/public-v2.yaml";
let siblingContract = null;
try {
  const contract = JSON.parse(await readFile(new URL(`../${SYSTEM_LABEL_CONTRACT_PATH}`, import.meta.url), "utf8"));
  const declared = contract.requiredSiblingTruthClasses?.schemas;
  if (declared === null || typeof declared !== "object" || Array.isArray(declared)) {
    throw new Error("requiredSiblingTruthClasses.schemas is not an object");
  }
  const bySchema = new Map();
  for (const [schema, fields] of Object.entries(declared)) {
    if (fields === null || typeof fields !== "object" || Array.isArray(fields)) {
      throw new Error(`requiredSiblingTruthClasses.schemas.${schema} is not an object`);
    }
    const map = new Map();
    for (const [key, cls] of Object.entries(fields)) {
      if (cls !== null && typeof cls !== "string") {
        throw new Error(`requiredSiblingTruthClasses.schemas.${schema}.${key} must be a class name or null`);
      }
      map.set(key, cls);
    }
    bySchema.set(schema, map);
  }
  if (bySchema.size === 0) throw new Error("requiredSiblingTruthClasses.schemas is empty");

  const yaml = await readFile(new URL(`../${PUBLIC_V2_CONTRACT_PATH}`, import.meta.url), "utf8");
  const properties = schemaPropertiesFromContract(yaml);
  if (properties.size < 50) throw new Error(`only ${properties.size} schemas parsed from ${PUBLIC_V2_CONTRACT_PATH}`);
  const owners = new Map();
  for (const [schema, props] of properties) {
    for (const prop of props) owners.set(prop, [...(owners.get(prop) ?? []), schema]);
  }
  const identifyingProperty = new Map();
  for (const [prop, schemas] of owners) if (schemas.length === 1) identifyingProperty.set(prop, schemas[0]);

  // The pairs the YAML declares: `x` and `xTruthClass` both properties of
  // the same schema. (`recurringPatternTruthClass` pairs with
  // `recurringPatternRef` through dependentRequired, not by name; its base is
  // not a property, and a UUID is not a claim.)
  const yamlPairs = new Map();
  for (const [schema, props] of properties) {
    for (const prop of props) {
      if (prop === "truthClass" || !prop.endsWith("TruthClass")) continue;
      const base = prop.slice(0, -"TruthClass".length);
      if (props.has(base)) yamlPairs.set(schema, new Set([...(yamlPairs.get(schema) ?? []), base]));
    }
  }
  if (yamlPairs.size < 5) throw new Error(`only ${yamlPairs.size} schemas with sibling truth classes parsed`);
  for (const [schema, bases] of yamlPairs) {
    const listed = bySchema.get(schema);
    for (const base of bases) {
      if (!listed?.has(base)) {
        errors.push(
          `${SYSTEM_LABEL_CONTRACT_PATH}: requiredSiblingTruthClasses misses ${schema}.${base}, which ${PUBLIC_V2_CONTRACT_PATH} pairs with ${base}TruthClass`,
        );
      }
    }
  }
  for (const [schema, fields] of bySchema) {
    for (const key of fields.keys()) {
      if (!yamlPairs.get(schema)?.has(key)) {
        errors.push(
          `${SYSTEM_LABEL_CONTRACT_PATH}: requiredSiblingTruthClasses lists ${schema}.${key}, but ${PUBLIC_V2_CONTRACT_PATH} declares no ${key}TruthClass sibling there`,
        );
      }
    }
  }
  siblingContract = { bySchema, identifyingProperty };
} catch (error) {
  errors.push(
    `${SYSTEM_LABEL_CONTRACT_PATH}: cannot read the required sibling truth-class map or check it against ${PUBLIC_V2_CONTRACT_PATH} (${error.message})`,
  );
}

/**
 * `components.schemas.<Name>.properties.<prop>` names from public-v2.yaml.
 * A deliberately narrow line reader (the workspace has no YAML parser and
 * this does not warrant one): it relies on the contract's fixed two-space
 * layout -- schema names at 4 spaces, `properties:` at 6, property names at
 * 8. Properties of inline nested objects (deeper) are not collected. If the
 * layout changes the floors above fail closed rather than silently finding
 * nothing.
 */
function schemaPropertiesFromContract(yaml) {
  const schemas = new Map();
  let inSchemas = false;
  let schema = null;
  let block = null;
  for (const line of yaml.split("\n")) {
    if (/^  schemas:\s*$/.test(line)) {
      inSchemas = true;
      continue;
    }
    if (inSchemas && /^ {0,3}\S/.test(line)) inSchemas = false;
    if (!inSchemas) continue;
    let match = /^ {4}([A-Za-z0-9_]+):\s*$/.exec(line);
    if (match) {
      schema = match[1];
      schemas.set(schema, new Set());
      block = null;
      continue;
    }
    match = /^ {6}([A-Za-z0-9_]+):/.exec(line);
    if (match) {
      block = match[1];
      continue;
    }
    match = /^ {8}([A-Za-z0-9_]+):/.exec(line);
    if (match && block === "properties" && schema !== null) schemas.get(schema).add(match[1]);
  }
  return schemas;
}

async function readJson(relativePath) {
  const url = new URL(relativePath, apiRoot);
  try {
    return { value: JSON.parse(await readFile(url, "utf8")), raw: await readFile(url, "utf8") };
  } catch (error) {
    errors.push(`${relativePath}: cannot read or parse (${error.message})`);
    return null;
  }
}

function requireFields(label, object, required) {
  if (object === null || typeof object !== "object" || Array.isArray(object)) {
    check(false, `${label}: expected an object`);
    return;
  }
  for (const field of required) {
    check(
      Object.hasOwn(object, field),
      `${label}: missing required field ${JSON.stringify(field)}`,
    );
  }
}

// The envelope every projection response in public-v2.yaml requires.
const ENVELOPE_REQUIRED = [
  "projectionVersion",
  "sourceGlobalPosition",
  "serverNow",
  "dataState",
  "visibilityEpoch",
  "truthClasses",
  "sourceRevisionSet",
];

// Required-field lists, copied from contracts/openapi/public-v2.yaml.
// The schema each list belongs to is named above it.
const REQUIRED = {
  // components.schemas.WorldSnapshot.required
  WorldSnapshot: [
    "projectionVersion",
    "sourceGlobalPosition",
    "serverNow",
    "dataState",
    "visibilityEpoch",
    "truthClasses",
    "sourceRevisionSet",
    "marketClock",
    "worldTickId",
    "scene",
    "characterPositions",
    "storyHooks",
  ],
  // components.schemas.WorldMarketClock.required
  WorldMarketClock: ["marketDate", "sessionPhase", "asOfTradingDate", "nextBoundaryAt"],
  // components.schemas.WorldSceneState.required
  WorldSceneState: ["sceneId", "activePriorityEventRefs"],
  // components.schemas.CharacterWorldPosition.required
  CharacterWorldPosition: [
    "characterId",
    "worldX",
    "worldY",
    "poseState",
    "focusHint",
    "zOrder",
    "sceneLayer",
    "detailTier",
    "sourceEventRefs",
  ],
  // components.schemas.WorldStoryHookRef.required
  WorldStoryHookRef: ["hookId", "characterId", "sceneRef", "label"],
  // components.schemas.CharacterCloseUp.required
  CharacterCloseUp: [
    "projectionVersion",
    "sourceGlobalPosition",
    "serverNow",
    "dataState",
    "visibilityEpoch",
    "truthClasses",
    "sourceRevisionSet",
    "characterId",
    "displayName",
    "ageYears",
    "occupationLabel",
    "sceneRef",
    "poseState",
    "currentVerbPhrase",
    "unresolvedTensionSummary",
    "unresolvedCommitments",
  ],
  // components.schemas.PaperPositionConsequenceHighlight.required
  PaperPositionConsequenceHighlight: [
    "kind",
    "positionArchiveRef",
    "unrealizedPnlPercentFixed2",
    "asOf",
  ],
  // components.schemas.UnresolvedCommitment.required
  UnresolvedCommitment: ["commitmentId", "rationaleSummary", "sealedAt", "stillOpen"],
  // components.schemas.LifeJournalPage.required
  LifeJournalPage: [
    "projectionVersion",
    "sourceGlobalPosition",
    "serverNow",
    "dataState",
    "visibilityEpoch",
    "truthClasses",
    "sourceRevisionSet",
    "characterId",
    "appliedAudienceScope",
    "entries",
    "heldEntries",
    "nextCursor",
  ],
  // components.schemas.LifeJournalEntry.required
  LifeJournalEntry: [
    "entryId",
    "chapterDate",
    "entryVisibility",
    "narrativeState",
    "narrativeSegments",
    "sceneSummary",
    "knownAtTheTimeSummary",
    "actionSummary",
    "consequence",
    "evidenceCard",
    "relationshipConsequence",
    "relationshipConsequenceNullReason",
    "openQuestionSummary",
    "archiveRefs",
  ],
  // components.schemas.HeldLifeJournalEntry.required (also its only keys)
  HeldLifeJournalEntry: ["entryId", "chapterDate", "entryVisibility", "heldReasonLabel"],
  // components.schemas.EvidenceCard.required
  EvidenceCard: [
    "action",
    "paperOutcome",
    "paperOutcomeNullReason",
    "quotedUtterances",
    "memoryRefs",
    "relationshipRefs",
  ],
  // components.schemas.EvidencePaperOutcome.required
  EvidencePaperOutcome: [
    "positionRef",
    "filledQuantityFixed6",
    "sealedPriceMinorUnitsFixed6",
    "fillPriceSourceRef",
    "markPriceSourceRef",
    "realizedPnlMinorUnits",
    "unrealizedPnlMinorUnits",
    "feeMinorUnits",
    "taxMinorUnits",
    "asOf",
    "truthClass",
    "sourceRefs",
  ],
  // components.schemas.RelationshipSignalView.required
  RelationshipSignalView: [
    "dyadRef",
    "relationshipSignalRef",
    "displayName",
    "relationLabel",
    "signalKind",
    "summary",
    "utterance",
    "consequenceMemoryRefs",
    "observedAt",
    "sessionDate",
    "journalEntryRef",
    "truthClass",
    "sourceRefs",
  ],
  // components.schemas.InfluenceRef.required
  InfluenceRef: ["displayName", "relationLabel", "influenceSummary", "truthClass", "sourceRefs"],
  // components.schemas.ArchiveSourceRef.required
  ArchiveSourceRef: ["kind", "eventType", "globalPosition", "refId"],
  // components.schemas.LifeJournalArchiveRefs.required
  LifeJournalArchiveRefs: ["paperPositionRefs", "relationshipDyadRefs", "memoryRefs"],
  // components.schemas.PaperConsequenceFragment.required
  PaperConsequenceFragment: [
    "positionArchiveRef",
    "heldDays",
    "unrealizedPnlMinorUnits",
    "unrealizedPnlPercentFixed2",
    "asOf",
  ],
  // components.schemas.CharacterUtterance.required
  CharacterUtterance: ["utteranceArtifactId", "canonicalTextSha256", "canonicalTextUtf8"],
  // components.schemas.CharacterArchiveIndex.required
  CharacterArchiveIndex: [
    "projectionVersion",
    "sourceGlobalPosition",
    "serverNow",
    "dataState",
    "visibilityEpoch",
    "truthClasses",
    "sourceRevisionSet",
    "characterId",
    "archiveSchemaRevision",
    "longTermTensionSummary",
    "recentHighlights",
    "sections",
  ],
  // components.schemas.ArchiveSectionIndexEntry.required
  ArchiveSectionIndexEntry: [
    "sectionKey",
    "viewerAudienceScope",
    "summary",
    "asOf",
    "visibilityEpoch",
    "sectionPath",
  ],
  // components.schemas.PaperArchiveProjection.required
  PaperArchiveProjection: [
    "projectionVersion",
    "sourceGlobalPosition",
    "serverNow",
    "dataState",
    "visibilityEpoch",
    "truthClasses",
    "sourceRevisionSet",
    "characterId",
    "appliedAudienceScope",
    "asOf",
    "paperVersionSet",
    "account",
    "positions",
    "historicalActionFills",
    "dataRevisions",
  ],
  // components.schemas.PaperVersionSet.required
  PaperVersionSet: [
    "paperAccountRef",
    "paperAccountVersion",
    "paperOrderRefs",
    "paperOrderVersions",
    "paperPositionRefs",
    "paperPositionVersions",
    "paperVersionSetDigest",
  ],
  // components.schemas.PaperAccountPublicSummary.required
  PaperAccountPublicSummary: [
    "currency",
    "cashMinorUnits",
    "reservedCashMinorUnits",
    "initialCapitalMinorUnits",
    "correctionRefs",
    "asOf",
  ],
  // components.schemas.PaperPositionPublic.required
  PaperPositionPublic: [
    "positionId",
    "instrumentLabel",
    "status",
    "openedAt",
    "lastChangedAt",
    "closedAt",
    "lots",
    "realizedPnlMinorUnits",
    "unrealizedPnlMinorUnits",
    "unrealizedPnlPercentFixed2",
    "markAsOf",
    "invalidationCondition",
    "rationaleSummary",
    "influencedByCharacterRefs",
    "influencedBy",
    "influencedByEmptyReason",
    "consequenceSummary",
  ],
  // components.schemas.PaperLotPublic.required
  PaperLotPublic: [
    "lotId",
    "quantityFixed6",
    "sealedPriceMinorUnitsFixed6",
    "costBasisMinorUnits",
    "sealedPriceRevisionRef",
  ],
  // components.schemas.PaperActionFillRecord.required
  PaperActionFillRecord: [
    "recordId",
    "positionRef",
    "tradingDate",
    "marketSessionFinalityState",
    "recordDataState",
  ],
  // components.schemas.PaperDailyActionDisclosure.required
  PaperDailyActionDisclosure: [
    "instrumentLabel",
    "action",
    "direction",
    "quantityFixed6",
    "confidencePercentFixed2",
    "fill",
    "rationaleSummary",
  ],
  // components.schemas.DataRevisionNote.required
  DataRevisionNote: ["revisionId", "appliedAt", "kind", "affectedRefs", "summary"],
  // components.schemas.SourceRevisionRef.required
  SourceRevisionRef: ["refId", "refKind", "revision"],
  // components.schemas.RelationsArchiveProjection.required
  RelationsArchiveProjection: [
    ...ENVELOPE_REQUIRED,
    "characterId",
    "appliedAudienceScope",
    "sectionKey",
    "asOf",
    "acquaintances",
    "acquaintancesEmptyReason",
  ],
  // components.schemas.ChartArchiveProjection.required
  ChartArchiveProjection: [
    ...ENVELOPE_REQUIRED,
    "characterId",
    "appliedAudienceScope",
    "sectionKey",
    "asOf",
    "birthIdentity",
    "placements",
    "placementsEmptyReason",
    "motifs",
  ],
  // components.schemas.TraitsArchiveProjection.required
  TraitsArchiveProjection: [
    ...ENVELOPE_REQUIRED,
    "characterId",
    "appliedAudienceScope",
    "sectionKey",
    "asOf",
    "fourAxis",
    "coreNeed",
    "coreFear",
    "bloodType",
    "selfDescription",
    "habits",
    "biasOccurrences",
    "biasOccurrencesEmptyReason",
    "counterExamples",
    "counterExamplesEmptyReason",
  ],
  // components.schemas.MemoriesArchiveProjection.required
  MemoriesArchiveProjection: [
    ...ENVELOPE_REQUIRED,
    "characterId",
    "appliedAudienceScope",
    "sectionKey",
    "asOf",
    "memories",
    "memoriesEmptyReason",
  ],
  // components.schemas.LifeArchiveProjection.required
  LifeArchiveProjection: [
    ...ENVELOPE_REQUIRED,
    "characterId",
    "appliedAudienceScope",
    "sectionKey",
    "asOf",
    "identity",
    "milestones",
    "originMemories",
    "unrecordedFacets",
    "joinedWorldOn",
    "chapterTimeline",
  ],
};

// The five section pages beside archive/paper, with the schema each one's
// required list comes from.
const ARCHIVE_DETAIL_SECTIONS = {
  relations: "RelationsArchiveProjection",
  chart: "ChartArchiveProjection",
  traits: "TraitsArchiveProjection",
  memories: "MemoriesArchiveProjection",
  life: "LifeArchiveProjection",
};

// Helper lists inside archive items that are not items themselves: session
// pointers, people labels and bare id lists. Everything else that is an
// array element object, or a top-level content object, is an item and must
// carry `truthClass` and non-empty `sourceRefs`.
const NON_ITEM_KEYS = new Set([
  "sourceRevisionSet",
  "truthClasses",
  "sourceRefs",
  "evidenceSessions",
  "activeSessions",
  "involvedPeople",
  "consequenceMemoryRefs",
]);

function archiveItems(value, topLevel, items) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return;
  for (const [key, child] of Object.entries(value)) {
    if (NON_ITEM_KEYS.has(key)) continue;
    if (Array.isArray(child)) {
      for (const element of child) {
        if (element !== null && typeof element === "object" && !Array.isArray(element)) {
          items.push({ key, item: element });
          archiveItems(element, false, items);
        }
      }
    } else if (child !== null && typeof child === "object") {
      if (topLevel) items.push({ key, item: child });
      archiveItems(child, false, items);
    }
  }
}

// Field names that would make a page look like a ranking or a scoreboard.
// Checked case-insensitively as substrings of every key in every document.
const BANNED_KEY_FRAGMENTS = ["ticker", "rank", "score", "winrate", "leaderboard", "total", "菜度", "勝率"];

function allKeys(value, keys) {
  if (Array.isArray(value)) {
    for (const item of value) allKeys(item, keys);
  } else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      keys.push(key);
      allKeys(child, keys);
    }
  }
}

function checkSourceRefs(label, refs) {
  check(Array.isArray(refs) && refs.length > 0, `${label}: sourceRefs must be a non-empty array`);
  for (const ref of Array.isArray(refs) ? refs : []) {
    requireFields(`${label} sourceRefs[]`, ref, REQUIRED.ArchiveSourceRef);
    if (ref?.kind === "canonical_event") {
      check(
        typeof ref.eventType === "string" &&
          Number.isInteger(ref.globalPosition) &&
          ref.globalPosition >= 1 &&
          UUID_PATTERN.test(ref.refId ?? ""),
        `${label}: a canonical_event source needs an event type, a global position and a stream id`,
      );
    } else if (ref?.kind === "character_seed") {
      check(
        ref.eventType === null &&
          ref.globalPosition === null &&
          typeof ref.refId === "string" &&
          ref.refId.startsWith("character-seed/v1#"),
        `${label}: a character_seed source is a named chassis anchor with no event coordinates`,
      );
    } else {
      check(false, `${label}: unknown source kind ${JSON.stringify(ref?.kind)}`);
    }
  }
}

function checkTruthClassed(label, item, declared) {
  check(
    ALLOWED_TRUTH_CLASSES.includes(item?.truthClass),
    `${label}: item truthClass ${JSON.stringify(item?.truthClass)} is missing or not allowed`,
  );
  if (declared) {
    check(
      declared.includes(item?.truthClass),
      `${label}: item truthClass ${JSON.stringify(item?.truthClass)} is not declared in truthClasses`,
    );
  }
  checkSourceRefs(label, item?.sourceRefs);
}

// components.schemas.ArchiveSectionKey.enum, in contract order.
const ARCHIVE_SECTION_KEYS = ["paper", "relations", "chart", "traits", "memories", "life"];

// components.schemas.TruthClass.enum, minus `real_fact` and
// `statistical_sample`: a repo-local synthetic fixture may claim neither.
const ALLOWED_TRUTH_CLASSES = [
  "fictional_setting",
  "symbolic_interpretation",
  "simulated_narrative",
];

// Strings that must never reach a viewer: `real_fact` because this fixture is
// synthetic, and the rest because V5 has no global performance leaderboard,
// no win rate, and no "菜度" ranking (AGENTS.md, docs/v5/decision-record.md).
const BANNED_SUBSTRINGS = ["real_fact", "排行", "勝率", "菜度", "leaderboard"];

// The character's own paper-trade record narrates what he did ("模擬買進 500
// 股…", "模擬賣出 400 股…", read in `evidenceCard.action.label` and
// `actionSummary`). That is evidence, not an instruction, so these two exact
// labels are stripped out of a document's raw text before the action-call
// scan below runs -- otherwise the bare characters 買進/賣出 inside them would
// never be able to appear anywhere else either.
const CHARACTER_OWN_TRADE_LABELS = ["模擬買進", "模擬賣出"];

// Traditional-Chinese buy/sell instructions and action-call phrases: text
// that reads as personalized trading advice or a call to copy the
// character's paper trade. `docs/v5/market-safety.md` and AGENTS.md's
// "Finance and legal safety" ban calls to action that resemble personalized
// trading advice; this is the same rule applied to the slice's own copy.
// These literal strings are NOT refused unconditionally any more: each one is
// one more "shape" below and goes through the same sentence rule as every
// other trading verb, so "陸硯之那晚跟同事說，他打算明天開盤就減碼。" (his own
// plan, told in his own story) passes while "開盤就減碼。" with no narrative
// subject does not. A JSON key that contains one is still refused outright:
// a key has no sentence and no subject.
const BANNED_ACTION_CALL_PHRASES = [
  "建議買進",
  "建議賣出",
  "建議加碼",
  "建議減碼",
  "建議進場",
  "建議出場",
  "建議跟單",
  "建議跟進",
  "開盤就買進",
  "開盤就賣出",
  "開盤就加碼",
  "開盤就減碼",
  "跟著他買進",
  "跟著他賣出",
  "跟著他加碼",
  "跟著他減碼",
  "跟著買進",
  "跟著賣出",
  "跟單",
  "跟進買",
  "抄底進場",
  "現在買進",
  "現在賣出",
  "現在加碼",
  "現在減碼",
  "馬上買進",
  "馬上賣出",
  "立刻買進",
  "立刻賣出",
];

function stripCharacterOwnTradeLabels(text) {
  let stripped = text;
  for (const label of CHARACTER_OWN_TRADE_LABELS) stripped = stripped.split(label).join("");
  return stripped;
}

// ---------------------------------------------------------------------------
// Action-call rule (last line of defence -- see the file header).
//
// A blacklist of phrasings cannot be completed, so the rule is STRUCTURAL:
// a trading verb may reach a viewer only inside a sentence that is visibly
// somebody's story, never inside one that talks to the reader.
//
// (1) Unit = one sentence, cut at 。！？!?；; or a newline. Whatever sits
//     inside 「」 or 『』 is lifted out and judged as its own independent
//     unit (nested quotes too; an unclosed quote runs to the end of the
//     string and is still judged alone): a character's quoted imperative is
//     refused exactly like narration would be -- fail closed. In the outer
//     sentence the quote leaves an empty 「」 behind.
// (2) Every trading verb in a sentence (ACTION_VERB, after stripping the
//     character's own "模擬買進/模擬賣出" labels; 買氣/賣場/買單… and a bare
//     跟 that is not sentence-final are not verbs) must pass, in order:
//       a. reader address: if the SENTENCE addresses the reader anywhere
//          (你/你們/您/我們/咱們/大家/各位/朋友們/想賺的…) it is refused,
//          with no exemption of any kind;
//       b. narrative subject: somewhere BEFORE the verb there must be a
//          narrative subject -- 他/她/他們/她們 or a character displayName
//          that the projection itself carries (read from the documents,
//          never hard-coded; an invented name is not a subject). 我 counts
//          only inside a quote (the character speaking of himself), and the
//          quote itself is still judged by (1). The subject may be:
//            - earlier in the same sentence, across commas (a topic chain:
//              "他看到收盤又往下，覺得應該加碼攤平，最後還是沒動。"), or
//            - in the PREVIOUS sentence of the same field and paragraph, when
//              this sentence carries on that subject's predicate -- it must
//              open (after an optional narrative adverb) with a verb of
//              thinking, perceiving, deciding or not-doing (覺得/心想/打算/
//              決定/看到/沒有…, NARRATIVE_OPENER). "他收盤前看了一眼。覺得該
//              減碼，但沒動。" continues; "他還沒有收回。可以買進。" does not
//              -- a sentence that opens on a modal, a verb, an adverb of
//              time or a reader is a new utterance, not a continuation.
//              Quotes never continue a subject into or out of themselves.
//            - structural, for exactly two field kinds whose speaker is
//              fixed by the contract rather than by the prose: an
//              utterance artifact's `canonicalTextUtf8` (the character's own
//              sealed words; the elided subject is 我) and a paper position's
//              `consequenceSummary` (the ledger of his own position). A
//              structural subject covers a bare verb only -- never a verb
//              inside one of the shapes or literal phrases below, and never
//              one in an imperative-mood sentence (c).
//          No subject -> refused.
//       c. imperative mood: if the sentence carries an urging or
//          rhetorical-urging marker (吧/啦/！, 何不, 是時候, 快+verb, 趕快,
//          再不…就晚了, 現在不…就來不及, …會後悔, 別錯過, 為什麼不… -- see
//          IMPERATIVE_MOOD) the subject must sit in the verb's OWN clause
//          (cut at commas, colons and quote marks). A subject borrowed from
//          an earlier clause, the previous sentence or the field's structure
//          does not cover an urging clause: "他看了一眼，快進場吧！" is
//          refused, "他覺得再不進場就晚了。" is his thought and passes.
// (3) The older phrase SHAPES (second person / follow-him / modal /
//     timing / rhetorical x trading verb) and the literal list above are
//     still matched, so a refusal can name the shape; they obey (2) exactly
//     like a bare verb does, except that a structural subject does not cover
//     them. A verb that is not inside any refused shape is judged on its own
//     and reported as shape "trading-verb".
// Nouns built on a trading verb (建倉時封存的理由, 與建倉當時相比: the verb
// followed by 時 -- not 時機/時候 -- or 當時) name a moment, not an action,
// and skip (2b)/(2c); a reader-addressed sentence is refused even then.
// Every refusal names the field path, the shape, the reason
// (reader-address / no-narrative-subject / imperative-mood) and the sentence.
// ---------------------------------------------------------------------------
const CLAUSE_BOUNDARY_CHARS = "。！？!?；;：:，,、「」『』\\n";
const SENTENCE_END = /[。！？!?；;]/u;
// Bare 買/賣 are verbs only when they are not the first half of a noun
// (買氣, 賣場, 賣命, 買單…) or a relative clause (你買的咖啡). A bare 跟 is a
// verb ("不跟會後悔", "快跟！") only right before a mood/tense particle or at a
// clause end, never as the preposition in "跟同事說".
const ACTION_VERB =
  "(?:買進|買入|買回|賣出|賣掉|賣了|加碼|減碼|加倉|減倉|建倉|清倉|砍倉|出清|回補|放空|做空|做多|作多|進場|出場|上車|下車|抄底|撿便宜|停損|停利|布局|佈局|卡位|跟單|跟進|跟風|追高|攤平|梭哈|(?<![A-Za-z])[Aa][Ll][Ll][- ]?[Ii][Nn](?![A-Za-z])|買(?![氣家方盤的單帳])|賣(?![場家方盤命力的弄萌關])|跟(?=[吧啦就會才。！？!?；;，,]|$))";
const TRADE_VERB = new RegExp(ACTION_VERB, "gu");
// A trading verb used as a moment ("建倉時", "建倉當時"), not an action.
const NOMINAL_TAIL = /^(?:時(?![機候])|當時)/u;
// Modal, imperative and urging words. `要` excludes 重要/主要/只要/將要, where
// the character is not an addressee of an order.
const ACTION_MODAL =
  "(?:可以|應該|應當|該|(?<![重主只將])要|必須|值得|建議|不妨|最好|務必|趕快|趕緊|快點|馬上|立刻|立即|現在就|現在|今天就|明天就|開盤就|記得|請|千萬要|一定要|不要)";
// Adverbs that may sit between the modal and the verb, and a short 把 object
// ("該把它賣了").
const ACTION_FILLER = `(?:先|再|就|也|都|趁早|趁低|逢低|大膽|分批|一起|全部|直接|立刻|馬上|趕快|快點|跟著|把[^${CLAUSE_BOUNDARY_CHARS}]{1,4}?)`;
const READER_SUBJECT =
  "(?:你們|你|妳|您|大家|各位|諸位|朋友們|讀者們|讀者|觀眾們|想賺錢的|想賺的|想發財的|我們|咱們)";
// What may sit between a reader subject and the verb: adverbs, modals, and
// "follow (him)" -- "你也跟著他加碼", "大家現在就可以進場".
const READER_GAP =
  "(?:也|就|還|都|可以|應該|要|該|得|不妨|最好|趕快|趕緊|快|現在|今天|明天|開盤|馬上|立刻|跟著|照著|跟|他們|她們|他|她|一起|先|再|趁早|趁低|逢低|分批|大膽)";
const TIMING_LEAD = "(?:逢低|逢高|趁低|趁高|趁早|趁現在|閉著眼睛|閉著眼|閉眼|無腦)";
const TIMING_TAIL = "(?:就對了|正是時候|正當時|更待何時|還來得及|不嫌晚)";
const RHETORICAL_TAIL = "(?:更待何時|還等什麼|等什麼|要等到何時|要等到什麼時候)";
// 他/她 inside 其他/他人 is not a person in the story.
const PRONOUN_NARRATORS = ["他們", "她們", "(?<!其)他(?!人)", "(?<!其)她(?!人)"];
// The character speaking of himself -- a subject only inside a quote.
const QUOTE_SELF_NARRATOR = "我(?!們)";
const CLAUSE_BOUNDARY = new RegExp(`[${CLAUSE_BOUNDARY_CHARS}]`, "u");
const READER_ADDRESS = new RegExp(READER_SUBJECT, "u");
// A sentence that carries on the previous sentence's subject opens with that
// subject's predicate: a verb of thinking, perceiving, deciding, or not doing.
const NARRATIVE_OPENER = new RegExp(
  "^(?:又|也|還是|仍然|仍|卻|便|才|一度|當時|那時|那天|那晚|隔天|後來|最後|終於|其實|原本|本來|始終|一直|默默|暗自|反覆|再次)?" +
    "(?:覺得|心想|想著|想到|認為|以為|打算|決定|猶豫|考慮|盤算|告訴自己|說服自己|寫下|記下|看到|看了|看著|盯著|算了算|知道|明白|懷疑|擔心|沒有)",
  "u",
);
// Urging and rhetorical-urging markers (2c). Matched against the sentence.
const IMPERATIVE_MOOD = new RegExp(
  [
    "[吧啦！!]",
    "何不|何妨",
    "是時候|時候到了|正是時候|機會來了",
    "(?:別|不要|不能)錯過",
    `(?:再|現在|今天|此時|這時)不[^${CLAUSE_BOUNDARY_CHARS}]{0,8}?(?:晚了|太晚|來不及|後悔|沒機會|錯過)`,
    "(?:會|一定|肯定|以後|將來|到時)會?後悔",
    "(?:為什麼|為何|怎麼|幹嘛)不",
    `(?<![很最越愈太趕加儘盡飛])快(?:點|一點)?${ACTION_VERB}`,
    "趕快|趕緊",
  ].join("|"),
  "u",
);

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The shapes and the narrator tests for one set of character names. The
 * names are the projection's own `displayName` values (see
 * `characterDisplayNames`), so a real character's name is a narrative
 * subject and an invented name is not.
 */
function actionCallMatcher(characterNames) {
  const names = [...new Set(characterNames)]
    .filter((name) => typeof name === "string" && name.length >= 2)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp);
  const person = `(?:他們|她們|他|她${names.map((name) => `|${name}`).join("")})`;
  const gap = `(?:${READER_GAP.slice(3, -1)}${names.map((name) => `|${name}`).join("")})`;
  const narrators = [...names, ...PRONOUN_NARRATORS];
  const literal = [...BANNED_ACTION_CALL_PHRASES].sort((a, b) => b.length - a.length).map(escapeRegExp);
  return {
    narrator: new RegExp(narrators.join("|"), "u"),
    quoteNarrator: new RegExp([...narrators, QUOTE_SELF_NARRATOR].join("|"), "u"),
    shapes: [
      { kind: "literal", pattern: new RegExp(literal.join("|"), "gu") },
      { kind: "second-person", pattern: new RegExp(`${READER_SUBJECT}${gap}{0,4}${ACTION_VERB}`, "gu") },
      { kind: "follow-him", pattern: new RegExp(`(?:跟著|照著|學)${person}?(?:一起|也)?${ACTION_VERB}`, "gu") },
      { kind: "modal-or-imperative", pattern: new RegExp(`${ACTION_MODAL}${ACTION_FILLER}*${ACTION_VERB}`, "gu") },
      { kind: "timing", pattern: new RegExp(`${TIMING_LEAD}${ACTION_FILLER}*${ACTION_VERB}`, "gu") },
      { kind: "timing", pattern: new RegExp(`${ACTION_VERB}[^${CLAUSE_BOUNDARY_CHARS}]{0,6}?${TIMING_TAIL}`, "gu") },
      { kind: "rhetorical", pattern: new RegExp(`(?:為什麼|為何|怎麼|幹嘛)?還不(?:趕快|趕緊|快點|快)?${ACTION_VERB}`, "gu") },
      { kind: "rhetorical", pattern: new RegExp(`(?:不|沒)${ACTION_VERB}[^。！？!?；;\\n]{0,6}?${RHETORICAL_TAIL}`, "gu") },
    ],
  };
}

/** Every `displayName` string anywhere in the walked projections. */
function characterDisplayNames(documents) {
  const names = [];
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value !== null && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        if (key === "displayName" && typeof child === "string") names.push(child);
        else visit(child);
      }
    }
  };
  for (const [, value] of documents) visit(value);
  return names;
}

/**
 * (1): the outer text, with every quote replaced by an empty 「」, followed
 * by the content of each quote as its own unit (innermost first).
 */
function quoteUnits(text) {
  const units = [];
  const stack = [[]];
  for (const character of text) {
    if (character === "「" || character === "『") {
      stack[stack.length - 1].push("「");
      stack.push([]);
    } else if ((character === "」" || character === "』") && stack.length > 1) {
      units.push({ text: stack.pop().join(""), quote: true });
      stack[stack.length - 1].push("」");
    } else {
      stack[stack.length - 1].push(character);
    }
  }
  // An unclosed quote runs to the end of the string: still judged alone.
  while (stack.length > 1) units.push({ text: stack.pop().join(""), quote: true });
  return [{ text: stack[0].join(""), quote: false }, ...units];
}

/** A paragraph cut after each run of sentence-final punctuation. */
function sentencesOf(paragraph) {
  const sentences = [];
  let current = "";
  for (let position = 0; position < paragraph.length; position += 1) {
    current += paragraph[position];
    const next = paragraph[position + 1];
    if (SENTENCE_END.test(paragraph[position]) && (next === undefined || !SENTENCE_END.test(next))) {
      sentences.push(current);
      current = "";
    }
  }
  if (current.length > 0) sentences.push(current);
  return sentences;
}

function clauseStartBefore(sentence, index) {
  let from = index;
  while (from > 0 && !CLAUSE_BOUNDARY.test(sentence[from - 1])) from -= 1;
  return from;
}

/** (2) and (3) for one sentence; `previous` is null when no continuation is possible. */
function sentenceActionCallHits(sentence, previous, { matcher, quote, structural }) {
  const narrator = quote ? matcher.quoteNarrator : matcher.narrator;
  const readerAddressed = READER_ADDRESS.test(sentence);
  const urging = IMPERATIVE_MOOD.test(sentence);
  const continued = previous !== null && narrator.test(previous) && NARRATIVE_OPENER.test(sentence.trimStart());
  const judge = (start, shaped) => {
    if (readerAddressed) return "reader-address";
    const ownClause = narrator.test(sentence.slice(clauseStartBefore(sentence, start), start));
    const topicChain = ownClause || narrator.test(sentence.slice(0, start));
    if (!topicChain && !continued && !(structural && !shaped)) return "no-narrative-subject";
    if (urging && !ownClause) return "imperative-mood";
    return null;
  };
  const hits = [];
  const refusedSpans = [];
  for (const { kind, pattern } of matcher.shapes) {
    for (const match of sentence.matchAll(pattern)) {
      const reason = judge(match.index, true);
      if (reason === null) continue;
      hits.push({ kind, reason, phrase: match[0], sentence, quote });
      refusedSpans.push([match.index, match.index + match[0].length]);
    }
  }
  for (const match of sentence.matchAll(TRADE_VERB)) {
    const end = match.index + match[0].length;
    if (refusedSpans.some(([from, to]) => match.index >= from && end <= to)) continue;
    if (!readerAddressed && NOMINAL_TAIL.test(sentence.slice(end))) continue;
    const reason = judge(match.index, false);
    if (reason !== null) hits.push({ kind: "trading-verb", reason, phrase: match[0], sentence, quote });
  }
  return hits;
}

/** Every refused trading verb or action-call shape in one string value. */
function actionCallHits(text, matcher, field = {}) {
  const hits = [];
  quoteUnits(stripCharacterOwnTradeLabels(text)).forEach((unit, index) => {
    // The outer unit of an utterance artifact is itself the character's quote.
    const quote = unit.quote || (index === 0 && field.utterance === true);
    const structural = index === 0 && field.structural === true;
    for (const paragraph of unit.text.split("\n")) {
      const sentences = sentencesOf(paragraph);
      sentences.forEach((sentence, position) => {
        const previous = position > 0 && !quote ? sentences[position - 1] : null;
        hits.push(...sentenceActionCallHits(sentence, previous, { matcher, quote, structural }));
      });
    }
  });
  return hits;
}

/** A JSON key has no sentence and no subject: a literal phrase in one is refused outright. */
function checkActionCallPhraseKeys(label, keys) {
  for (const key of keys) {
    const stripped = stripCharacterOwnTradeLabels(key);
    for (const phrase of BANNED_ACTION_CALL_PHRASES) {
      check(!stripped.includes(phrase), `${label}: field name ${JSON.stringify(key)} contains a buy/sell action-call phrase ${JSON.stringify(phrase)}`);
    }
  }
}

/** The two field kinds whose speaker is fixed by the contract (2b). */
function structuralSubjectField(owner, key) {
  if (key === "canonicalTextUtf8" && typeof owner.utteranceArtifactId === "string") {
    return { structural: true, utterance: true };
  }
  if (key === "consequenceSummary" && typeof owner.positionId === "string") return { structural: true };
  return {};
}

function auditActionCalls(value, file, path, matcher, field = {}) {
  if (typeof value === "string") {
    for (const hit of actionCallHits(value, matcher, field)) {
      check(
        false,
        `${file}: ${path} contains a buy/sell action-call phrase shape (${hit.kind}) ${JSON.stringify(hit.phrase)} [${hit.reason}] in ${hit.quote ? "quoted " : ""}sentence ${JSON.stringify(hit.sentence)}`,
      );
    }
  } else if (Array.isArray(value)) {
    value.forEach((item, position) => auditActionCalls(item, file, `${path}[${position}]`, matcher));
  } else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      auditActionCalls(child, file, `${path}.${key}`, matcher, structuralSubjectField(value, key));
    }
  }
}

// ---------------------------------------------------------------------------
// Field-level truth-class identity: the same walk as
// `tools/character-episode/tests/slice_claim_truth_classes.rs`
// (`walk` / `covered_here` / `is_system_label` / `has_cjk` / `CLAIM_KEYS`),
// ported rule for rule so the front end's fail-closed rendering is not the
// only place a missing class is caught. Every human-readable string (any
// CJK character), every claim-shaped key and EVERY number must be covered on
// its own object: a sibling `<key>TruthClass` (which wins if present, even
// when null), else the object's own `truthClass`; a list of readable strings
// needs a parallel `<singular>TruthClasses` entry at each index. Nothing
// inherits from an ancestor. The only ways through without a class are a
// system-label field holding one of its listed sentences, or a number whose
// key is in `nonClaimNumberKeys`. Every class value seen must be an allowed
// synthetic class and declared by the envelope; `real_fact` is counted
// separately and must be zero.
// ---------------------------------------------------------------------------
const CLAIM_KEYS = new Set([
  "displayName",
  "ageYears",
  "occupationLabel",
  "poseState",
  "instrumentLabel",
  "status",
  "invalidationCondition",
  "action",
  "direction",
  "heldDays",
  "confidencePercentFixed2",
  "label",
]);

function isSystemLabelKey(key) {
  return (
    key.endsWith("EmptyReason") ||
    key.endsWith("NullReason") ||
    key === "heldReasonLabel" ||
    key === "tombstoneReasonLabel"
  );
}

function hasCjk(text) {
  for (const character of text) {
    const code = character.codePointAt(0);
    if (
      (code >= 0x3000 && code <= 0x303f) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0xff00 && code <= 0xffef)
    ) {
      return true;
    }
  }
  return false;
}

// `siblingOnly` holds the keys of this object whose schema declares a
// sibling `<key>TruthClass` (requiredSiblingTruthClasses): for those the
// sibling is the only thing that can cover the key -- no fallback to the
// object's `truthClass`.
function coveredHere(object, key, siblingOnly) {
  const sibling = `${key}TruthClass`;
  if (siblingOnly.has(key)) return object[sibling] !== undefined && object[sibling] !== null;
  const cls = Object.hasOwn(object, sibling) ? object[sibling] : object.truthClass;
  return cls !== undefined && cls !== null;
}

/**
 * The schemas `object` is an instance of, by the properties only one schema
 * declares, and the sibling rules they impose. Checks each rule here: a
 * non-null `x` needs its own non-null `xTruthClass`, equal to the pinned class
 * if there is one; a null `x` has a null or absent sibling. Returns the keys
 * that `coveredHere` must not let fall back to the object class.
 */
function requiredSiblings(file, path, object, walk) {
  const siblingOnly = new Set();
  if (siblingContract === null) return siblingOnly;
  const schemas = new Set();
  for (const key of Object.keys(object)) {
    const schema = siblingContract.identifyingProperty.get(key);
    if (schema !== undefined) schemas.add(schema);
  }
  for (const schema of schemas) {
    for (const [key, pinned] of siblingContract.bySchema.get(schema) ?? []) {
      if (!Object.hasOwn(object, key)) continue;
      const sibling = `${key}TruthClass`;
      const cls = object[sibling];
      walk.siblingRules += 1;
      if (object[key] === null) {
        check(
          cls === undefined || cls === null,
          `${file}: ${path}.${sibling} must be null when ${key} is null (${PUBLIC_V2_CONTRACT_PATH} ${schema})`,
        );
        continue;
      }
      siblingOnly.add(key);
      if (cls === undefined || cls === null) {
        check(
          false,
          `${file}: ${path}.${key} requires its own ${sibling} (${PUBLIC_V2_CONTRACT_PATH} ${schema}); the object's truthClass does not stand in for it`,
        );
      } else if (pinned !== null) {
        check(
          cls === pinned,
          `${file}: ${path}.${sibling} must be ${JSON.stringify(pinned)} (${SYSTEM_LABEL_CONTRACT_PATH} requiredSiblingTruthClasses ${schema}.${key}), found ${JSON.stringify(cls)}`,
        );
      }
    }
  }
  return siblingOnly;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function newIdentityWalk() {
  return { claims: 0, numbers: 0, classesSeen: 0, realFact: 0, systemLabels: 0, nonClaimNumbers: 0, siblingRules: 0 };
}

function identityClass(file, path, value, declared, walk) {
  if (value === "real_fact") walk.realFact += 1;
  check(
    typeof value === "string" && ALLOWED_TRUTH_CLASSES.includes(value),
    `${file}: ${path} truth class ${JSON.stringify(value)} may not appear in a synthetic slice`,
  );
  if (declared) {
    check(
      declared.includes(value),
      `${file}: ${path} truth class ${JSON.stringify(value)} is not declared by the envelope truthClasses`,
    );
  }
  walk.classesSeen += 1;
}

function identityWalk(file, path, value, declared, allow, walk) {
  if (Array.isArray(value)) {
    value.forEach((item, position) => identityWalk(file, `${path}[${position}]`, item, declared, allow, walk));
    return;
  }
  if (!isPlainObject(value)) return;
  const siblingOnly = requiredSiblings(file, path, value, walk);
  for (const [key, child] of Object.entries(value)) {
    const here = `${path}.${key}`;
    if (key === "truthClass" || key.endsWith("TruthClass")) {
      if (child !== null) identityClass(file, here, child, declared, walk);
      continue;
    }
    if (key.endsWith("TruthClasses")) {
      (Array.isArray(child) ? child : []).forEach((cls, position) =>
        identityClass(file, `${here}[${position}]`, cls, declared, walk),
      );
      continue;
    }
    if (isSystemLabelKey(key)) {
      if (child === null) continue;
      const listed = allow.labels.get(key);
      if (listed === undefined) {
        check(false, `${file}: ${here} is a system-label field not listed in ${SYSTEM_LABEL_CONTRACT_PATH}`);
      } else if (typeof child === "string" && listed.has(child)) {
        walk.systemLabels += 1;
      } else {
        check(
          false,
          `${file}: ${here} = ${JSON.stringify(child)} is not a listed system label for ${key} in ${SYSTEM_LABEL_CONTRACT_PATH}`,
        );
      }
      continue;
    }
    const own = coveredHere(value, key, siblingOnly);
    if (typeof child === "string") {
      if (hasCjk(child) || CLAIM_KEYS.has(key)) {
        walk.claims += 1;
        check(own, `${file}: ${here} = ${JSON.stringify(child)} is not covered by a truth class on its own object`);
      }
    } else if (typeof child === "number") {
      walk.numbers += 1;
      if (allow.nonClaimNumbers.has(key)) {
        walk.nonClaimNumbers += 1;
      } else {
        walk.claims += 1;
        check(own, `${file}: ${here} = ${child} (number) is not covered by a truth class on its own object`);
      }
    } else if (Array.isArray(child) && child.length > 0 && child.every((item) => typeof item === "string")) {
      if (child.some(hasCjk)) {
        const singular = key.endsWith("s") ? key.slice(0, -1) : key;
        const parallel = value[`${singular}TruthClasses`];
        child.forEach((item, position) => {
          walk.claims += 1;
          check(
            Array.isArray(parallel) && position < parallel.length,
            `${file}: ${here}[${position}] = ${JSON.stringify(item)} is not covered by a parallel ${singular}TruthClasses entry`,
          );
        });
      }
    } else {
      identityWalk(file, here, child, declared, allow, walk);
    }
  }
}

// `canonicalTextSha256` is not a plain sha256 of the text: per
// `docs/v5/character-story-engine.md` ("`canonicalTextUtf8` 經 NFC／LF
// 正規化，再計 `canonicalTextSha256`") and `UtteranceArtifact::canonical_text_sha256`
// in `crates/character-domain/src/utterance.rs`, it is sha256 of a fixed
// domain tag followed by the UTF-8 text bytes. This mirrors that exact
// construction -- a documented digest-format contract, the same kind of
// structural check this audit already makes for `paperVersionSetDigest`,
// not a re-derivation of a business number.
const UTTERANCE_TEXT_DOMAIN_TAG = Buffer.from("PSZS/UTTERANCE_TEXT/v1\0", "utf8");

function canonicalUtteranceSha256(text) {
  return createHash("sha256").update(UTTERANCE_TEXT_DOMAIN_TAG).update(Buffer.from(text, "utf8")).digest("hex");
}

// Every `CharacterUtterance` (an `utteranceArtifactId` paired with a
// `canonicalTextSha256` and its `canonicalTextUtf8`) is checked twice: the
// digest must actually be the canonical hash of that text, and every later
// appearance of the same artifact id anywhere in the fixture must repeat the
// same text and digest -- the same quote cannot read differently in two
// places (the contemporaneous chapter, a later "回到原話" reference, a
// relationship signal, an evidence card...).
const utteranceRegistry = new Map();

function auditUtterances(value, label) {
  if (Array.isArray(value)) {
    for (const element of value) auditUtterances(element, label);
    return;
  }
  if (value === null || typeof value !== "object") return;
  if (
    typeof value.utteranceArtifactId === "string" &&
    typeof value.canonicalTextSha256 === "string" &&
    typeof value.canonicalTextUtf8 === "string"
  ) {
    const computedSha256 = canonicalUtteranceSha256(value.canonicalTextUtf8);
    check(
      computedSha256 === value.canonicalTextSha256,
      `${label}: utterance ${value.utteranceArtifactId} canonicalTextSha256 does not match the canonical hash of canonicalTextUtf8`,
    );
    const earlier = utteranceRegistry.get(value.utteranceArtifactId);
    if (earlier === undefined) {
      utteranceRegistry.set(value.utteranceArtifactId, {
        canonicalTextUtf8: value.canonicalTextUtf8,
        canonicalTextSha256: value.canonicalTextSha256,
        label,
      });
    } else {
      check(
        earlier.canonicalTextUtf8 === value.canonicalTextUtf8 &&
          earlier.canonicalTextSha256 === value.canonicalTextSha256,
        `${label}: utterance ${value.utteranceArtifactId} does not match its earlier appearance in ${earlier.label}`,
      );
    }
  }
  for (const child of Object.values(value)) auditUtterances(child, label);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;

const index = await readJson("index.json");
if (index === null) {
  console.error("v5-slice-api-audit: fixtures/v5/one-character-slice/api/index.json is missing.");
  console.error("Regenerate it with: pnpm slice:emit");
  process.exit(1);
}

const characterId = index.value.characterId;
check(
  typeof characterId === "string" && UUID_PATTERN.test(characterId),
  `index.json: characterId ${JSON.stringify(characterId)} is not a lowercase UUID`,
);

const expectedRoutes = [
  "/api/v2/world",
  `/api/v2/characters/${characterId}/close-up`,
  `/api/v2/characters/${characterId}/life-journal`,
  `/api/v2/characters/${characterId}/archive`,
  `/api/v2/characters/${characterId}/archive/paper`,
  ...Object.keys(ARCHIVE_DETAIL_SECTIONS).map(
    (key) => `/api/v2/characters/${characterId}/archive/${key}`,
  ),
];
const routes = index.value.routes ?? {};
check(
  Object.keys(routes).length === expectedRoutes.length,
  `index.json: expected ${expectedRoutes.length} routes, found ${Object.keys(routes).length}`,
);
for (const route of expectedRoutes) {
  check(typeof routes[route] === "string", `index.json: no file mapped for route ${route}`);
}

let fieldIdentitySummary = null;
const loaded = {};
for (const route of expectedRoutes) {
  if (typeof routes[route] !== "string") continue;
  const document = await readJson(routes[route]);
  if (document !== null) loaded[route] = document;
}

if (errors.length === 0) {
  // -- world ---------------------------------------------------------------
  const world = loaded["/api/v2/world"].value;
  requireFields("world.json", world, REQUIRED.WorldSnapshot);
  requireFields("world.json marketClock", world.marketClock, REQUIRED.WorldMarketClock);
  requireFields("world.json scene", world.scene, REQUIRED.WorldSceneState);
  check(
    Array.isArray(world.characterPositions) && world.characterPositions.length === 1,
    "world.json: exactly one canonical character position is expected in this slice",
  );
  for (const position of world.characterPositions ?? []) {
    requireFields("world.json characterPositions[]", position, REQUIRED.CharacterWorldPosition);
  }
  check(
    Array.isArray(world.storyHooks) && world.storyHooks.length <= 5,
    "world.json: storyHooks must be an array of at most five entries",
  );
  for (const hook of world.storyHooks ?? []) {
    requireFields("world.json storyHooks[]", hook, REQUIRED.WorldStoryHookRef);
    // A hook is a pointer, never a ranked or scored recommendation.
    for (const forbidden of ["rank", "score", "order", "priority", "weight", "ticker"]) {
      check(
        !Object.hasOwn(hook, forbidden),
        `world.json: storyHooks[] must not carry a ${forbidden} field`,
      );
    }
  }
  check(
    world.marketClock?.marketDate === TODAY &&
      world.marketClock?.sessionPhase === "in_session" &&
      world.marketClock?.asOfTradingDate === PREVIOUS_CLOSE_DATE,
    `world.json: marketClock must show ${TODAY} in session with paper figures as of ${PREVIOUS_CLOSE_DATE}`,
  );
  check(world.dataState === "READY", "world.json: dataState must be READY");

  // -- close-up ------------------------------------------------------------
  const closeUp = loaded[`/api/v2/characters/${characterId}/close-up`].value;
  requireFields("close-up.json", closeUp, REQUIRED.CharacterCloseUp);
  if (closeUp.recentConsequenceHighlight) {
    requireFields(
      "close-up.json recentConsequenceHighlight",
      closeUp.recentConsequenceHighlight,
      REQUIRED.PaperPositionConsequenceHighlight,
    );
  }
  for (const commitment of closeUp.unresolvedCommitments ?? []) {
    requireFields("close-up.json unresolvedCommitments[]", commitment, REQUIRED.UnresolvedCommitment);
  }
  for (const key of ["publicClaim", "selfAcknowledgement"]) {
    if (closeUp[key]) requireFields(`close-up.json ${key}`, closeUp[key], REQUIRED.CharacterUtterance);
  }
  // A close-up shows one consequence fragment, never the holdings table.
  check(
    !Object.hasOwn(closeUp, "positions") && !Object.hasOwn(closeUp, "lots"),
    "close-up.json: a close-up must not carry a full holdings table",
  );

  // -- life journal --------------------------------------------------------
  const journal = loaded[`/api/v2/characters/${characterId}/life-journal`].value;
  requireFields("life-journal.json", journal, REQUIRED.LifeJournalPage);
  check(
    SETTLED_DATES.length === 29 && SESSION_COUNT === 30,
    `historical fixture: expected 30 sessions with 29 settled, found ${SESSION_COUNT}/${SETTLED_DATES.length}`,
  );
  check(
    Array.isArray(journal.entries) && journal.entries.length === SETTLED_DATES.length,
    `life-journal.json: expected ${SETTLED_DATES.length} entries, found ${journal.entries?.length}`,
  );
  check(journal.nextCursor === null, "life-journal.json: nextCursor must be null");
  const expectedChapterDates = SETTLED_DATES;
  let chaptersWithDyad = 0;
  (journal.entries ?? []).forEach((entry, position) => {
    const label = `life-journal.json entries[${position}]`;
    requireFields(label, entry, REQUIRED.LifeJournalEntry);
    check(entry.entryVisibility === "PUBLIC", `${label}: an entry is always PUBLIC`);
    check(
      entry.narrativeState === "composed" || entry.narrativeState === "evidence_card_only",
      `${label}: narrativeState must be composed or evidence_card_only`,
    );
    check(
      Array.isArray(entry.narrativeSegments) &&
        (entry.narrativeState === "composed") === entry.narrativeSegments.length > 0,
      `${label}: a composed chapter has segments and an evidence-card-only chapter has none`,
    );
    for (const segment of entry.narrativeSegments ?? []) {
      checkTruthClassed(`${label}.narrativeSegments[]`, segment, null);
    }
    // The typed evidence card, every part of which carries a truth class.
    const card = entry.evidenceCard;
    requireFields(`${label}.evidenceCard`, card, REQUIRED.EvidenceCard);
    checkTruthClassed(`${label}.evidenceCard.action`, card?.action, null);
    check(
      (card?.paperOutcome === null) === (typeof card?.paperOutcomeNullReason === "string"),
      `${label}.evidenceCard: paperOutcomeNullReason must be set exactly when paperOutcome is null`,
    );
    if (card?.paperOutcome) {
      requireFields(`${label}.evidenceCard.paperOutcome`, card.paperOutcome, REQUIRED.EvidencePaperOutcome);
      checkTruthClassed(`${label}.evidenceCard.paperOutcome`, card.paperOutcome, null);
      for (const field of ["realizedPnlMinorUnits", "feeMinorUnits", "taxMinorUnits"]) {
        check(Number.isInteger(card.paperOutcome[field]), `${label}.evidenceCard: ${field} must be an integer`);
      }
    }
    for (const listKey of ["quotedUtterances", "memoryRefs", "relationshipRefs"]) {
      check(Array.isArray(card?.[listKey]), `${label}.evidenceCard: ${listKey} must be an array`);
      for (const item of card?.[listKey] ?? []) {
        checkTruthClassed(`${label}.evidenceCard.${listKey}[]`, item, null);
      }
    }
    for (const quote of card?.quotedUtterances ?? []) {
      requireFields(`${label}.evidenceCard.quotedUtterances[]`, quote, REQUIRED.CharacterUtterance);
    }
    check(
      (entry.relationshipConsequence === null) ===
        (typeof entry.relationshipConsequenceNullReason === "string"),
      `${label}: relationshipConsequenceNullReason must be set exactly when relationshipConsequence is null`,
    );
    if (entry.relationshipConsequence) {
      requireFields(
        `${label}.relationshipConsequence`,
        entry.relationshipConsequence,
        REQUIRED.RelationshipSignalView,
      );
      checkTruthClassed(`${label}.relationshipConsequence`, entry.relationshipConsequence, null);
    }
    check(
      entry.chapterDate === expectedChapterDates[position],
      `${label}: expected chapterDate ${expectedChapterDates[position]}, found ${entry.chapterDate}`,
    );
    requireFields(`${label}.archiveRefs`, entry.archiveRefs, REQUIRED.LifeJournalArchiveRefs);
    if (entry.consequence?.paperConsequence) {
      requireFields(
        `${label}.consequence.paperConsequence`,
        entry.consequence.paperConsequence,
        REQUIRED.PaperConsequenceFragment,
      );
    } else {
      check(
        typeof entry.consequence?.nonPaperConsequenceSummary === "string",
        `${label}: consequence needs a paper fragment or a non-paper summary`,
      );
    }
    if (entry.contemporaneousClaim) {
      requireFields(
        `${label}.contemporaneousClaim`,
        entry.contemporaneousClaim,
        REQUIRED.CharacterUtterance,
      );
    }
    const narration = entry.currentSelfNarration;
    check(
      narration?.kind === "utterance" || narration?.kind === "summary",
      `${label}: currentSelfNarration must be an utterance or a summary`,
    );
    if (narration?.kind === "utterance") {
      requireFields(`${label}.currentSelfNarration`, narration, [
        "kind",
        "utteranceArtifactId",
        "canonicalTextSha256",
        "canonicalTextUtf8",
      ]);
    }
    // 老毛病又回來了 only appears where the pattern came back after two
    // earlier occurrences.
    check(
      Object.hasOwn(entry, "recurringPatternRef") ===
        RECURRING_PATTERN_DATES.includes(entry.chapterDate),
      `${label}: recurringPatternRef presence does not match the recurrence threshold`,
    );
    if (position > 0) {
      check(
        journal.entries[position - 1].chapterDate < entry.chapterDate,
        `${label}: chapterDate must strictly increase`,
      );
    }
    if ((entry.archiveRefs?.relationshipDyadRefs ?? []).length > 0) chaptersWithDyad += 1;
  });
  // One public statement put a loss on the colleague, and only that chapter
  // points at the relationship stream it left behind.
  check(
    chaptersWithDyad === 1,
    `life-journal.json: expected exactly one chapter with a relationship dyad ref, found ${chaptersWithDyad}`,
  );
  check(
    (journal.entries ?? []).filter((entry) => entry.relationshipConsequence).length === 1,
    "life-journal.json: exactly one chapter carries a readable relationship consequence",
  );
  // A held chapter is an id, a date and a label; the checked-in fixture holds none.
  check(Array.isArray(journal.heldEntries), "life-journal.json: heldEntries must be an array");
  for (const held of journal.heldEntries ?? []) {
    check(
      JSON.stringify(Object.keys(held).sort()) ===
        JSON.stringify([...REQUIRED.HeldLifeJournalEntry].sort()) && held.entryVisibility === "HELD",
      "life-journal.json: a held entry may carry only entryId, chapterDate, entryVisibility and heldReasonLabel",
    );
  }

  // -- archive index -------------------------------------------------------
  const archive = loaded[`/api/v2/characters/${characterId}/archive`].value;
  requireFields("archive.json", archive, REQUIRED.CharacterArchiveIndex);
  check(
    Array.isArray(archive.sections) && archive.sections.length === 6,
    `archive.json: expected 6 sections, found ${archive.sections?.length}`,
  );
  check(
    Array.isArray(archive.recentHighlights) && archive.recentHighlights.length <= 3,
    "archive.json: recentHighlights must be an array of at most three entries",
  );
  (archive.sections ?? []).forEach((section, position) => {
    const label = `archive.json sections[${position}]`;
    requireFields(label, section, REQUIRED.ArchiveSectionIndexEntry);
    check(
      section.sectionKey === ARCHIVE_SECTION_KEYS[position],
      `${label}: expected sectionKey ${ARCHIVE_SECTION_KEYS[position]}, found ${section.sectionKey}`,
    );
    // Every section has its own page, so no entrance is a dead end.
    check(
      section.sectionPath === `/api/v2/characters/${characterId}/archive/${section.sectionKey}`,
      `${label}: ${section.sectionKey} must link to its own endpoint (sectionPath must not be null)`,
    );
  });

  // -- paper archive -------------------------------------------------------
  const paper = loaded[`/api/v2/characters/${characterId}/archive/paper`].value;
  requireFields("archive/paper.json", paper, REQUIRED.PaperArchiveProjection);
  requireFields("archive/paper.json paperVersionSet", paper.paperVersionSet, REQUIRED.PaperVersionSet);
  requireFields("archive/paper.json account", paper.account, REQUIRED.PaperAccountPublicSummary);

  const versionSet = paper.paperVersionSet ?? {};
  check(
    Array.isArray(versionSet.paperOrderRefs) &&
      Array.isArray(versionSet.paperOrderVersions) &&
      versionSet.paperOrderRefs.length === versionSet.paperOrderVersions.length,
    "archive/paper.json: paperOrderRefs and paperOrderVersions must be equal-length parallel arrays",
  );
  check(
    Array.isArray(versionSet.paperPositionRefs) &&
      Array.isArray(versionSet.paperPositionVersions) &&
      versionSet.paperPositionRefs.length === versionSet.paperPositionVersions.length,
    "archive/paper.json: paperPositionRefs and paperPositionVersions must be equal-length parallel arrays",
  );
  const sortedOrderRefs = [...(versionSet.paperOrderRefs ?? [])].sort();
  check(
    JSON.stringify(sortedOrderRefs) === JSON.stringify(versionSet.paperOrderRefs ?? []),
    "archive/paper.json: paperOrderRefs must be ordered by aggregate id byte order",
  );
  check(
    DIGEST_PATTERN.test(versionSet.paperVersionSetDigest ?? ""),
    "archive/paper.json: paperVersionSetDigest must be a lowercase sha256 hex digest",
  );

  check(
    Array.isArray(paper.positions) && paper.positions.length === 1,
    `archive/paper.json: expected 1 position, found ${paper.positions?.length}`,
  );
  for (const position of paper.positions ?? []) {
    requireFields("archive/paper.json positions[]", position, REQUIRED.PaperPositionPublic);
    for (const lot of position.lots ?? []) {
      requireFields("archive/paper.json positions[].lots[]", lot, REQUIRED.PaperLotPublic);
      check(
        Number.isInteger(lot.quantityFixed6) && Number.isInteger(lot.costBasisMinorUnits),
        "archive/paper.json: lot quantities and amounts must be integers, never floats",
      );
    }
    if (position.concurrentClaim) {
      requireFields(
        "archive/paper.json positions[].concurrentClaim",
        position.concurrentClaim,
        REQUIRED.CharacterUtterance,
      );
    }
    // Influence is shown by name and relationship label, never as a bare id,
    // and an empty list says why it is empty.
    check(Array.isArray(position.influencedBy), "archive/paper.json: influencedBy must be an array");
    for (const influence of position.influencedBy ?? []) {
      requireFields("archive/paper.json positions[].influencedBy[]", influence, REQUIRED.InfluenceRef);
      check(
        typeof influence.displayName === "string" && influence.displayName.length > 0,
        "archive/paper.json: influencedBy[] must carry a displayName",
      );
      checkTruthClassed("archive/paper.json positions[].influencedBy[]", influence, null);
    }
    check(
      ((position.influencedBy ?? []).length === 0) === (typeof position.influencedByEmptyReason === "string"),
      "archive/paper.json: influencedByEmptyReason must be set exactly when influencedBy is empty",
    );
    // The complete loss stays visible.
    check(
      Number.isInteger(position.realizedPnlMinorUnits) &&
        Number.isInteger(position.unrealizedPnlMinorUnits) &&
        Number.isInteger(position.unrealizedPnlPercentFixed2),
      "archive/paper.json: P&L figures must be integer minor units / fixed-point",
    );
    // `consequenceSummary` is prose derived from the same numbers; it must
    // never launder a realized or unrealized loss into something neutral
    // like "持有中。" -- whichever side of the P&L is negative must be named.
    const summary = position.consequenceSummary;
    if (Number.isInteger(position.realizedPnlMinorUnits) && position.realizedPnlMinorUnits < 0) {
      check(
        typeof summary === "string" && summary.includes("虧損"),
        "archive/paper.json: positions[].consequenceSummary must name the realized loss when realizedPnlMinorUnits is negative",
      );
    }
    if (Number.isInteger(position.unrealizedPnlMinorUnits) && position.unrealizedPnlMinorUnits < 0) {
      check(
        typeof summary === "string" && summary.includes("未實現虧損"),
        "archive/paper.json: positions[].consequenceSummary must name the unrealized loss when unrealizedPnlMinorUnits is negative",
      );
    }
  }

  check(
    Array.isArray(paper.historicalActionFills) && paper.historicalActionFills.length === SESSION_COUNT,
    `archive/paper.json: expected ${SESSION_COUNT} daily records, found ${paper.historicalActionFills?.length}`,
  );
  check(
    paper.historicalActionFills?.at(-1)?.tradingDate === TODAY,
    `archive/paper.json: the last daily record must be today (${TODAY})`,
  );
  let pendingRecords = 0;
  for (const record of paper.historicalActionFills ?? []) {
    const label = `archive/paper.json historicalActionFills[${record.tradingDate}]`;
    requireFields(label, record, REQUIRED.PaperActionFillRecord);
    if (record.marketSessionFinalityState === "accepted") {
      check(
        Object.hasOwn(record, "dailyActionDisclosure"),
        `${label}: an accepted trading day must carry its disclosure`,
      );
      requireFields(
        `${label}.dailyActionDisclosure`,
        record.dailyActionDisclosure,
        REQUIRED.PaperDailyActionDisclosure,
      );
    } else {
      pendingRecords += 1;
      // Structurally absent, not present-and-null.
      check(
        !Object.hasOwn(record, "dailyActionDisclosure"),
        `${label}: same-day disclosure leaked before finality was accepted`,
      );
    }
  }
  check(
    pendingRecords === 1,
    `archive/paper.json: expected exactly one pending trading day, found ${pendingRecords}`,
  );
  for (const revision of paper.dataRevisions ?? []) {
    requireFields("archive/paper.json dataRevisions[]", revision, REQUIRED.DataRevisionNote);
  }

  // -- the five detail sections -------------------------------------------
  for (const [key, schema] of Object.entries(ARCHIVE_DETAIL_SECTIONS)) {
    const route = `/api/v2/characters/${characterId}/archive/${key}`;
    const label = `archive/${key}.json`;
    const section = loaded[route]?.value;
    requireFields(label, section, REQUIRED[schema]);
    if (!section) continue;
    check(section.sectionKey === key, `${label}: sectionKey must be ${key}`);
    check(
      section.appliedAudienceScope === "subscriber_archive",
      `${label}: a deep-archive section resolves at subscriber_archive`,
    );
    const items = [];
    archiveItems(section, true, items);
    check(items.length > 0, `${label}: a section page must carry items`);
    for (const { key: itemKey, item } of items) {
      checkTruthClassed(`${label} ${itemKey}`, item, section.truthClasses ?? []);
    }
    for (const field of Object.keys(section)) {
      if (field.endsWith("EmptyReason")) {
        const listKey = field.slice(0, -"EmptyReason".length);
        check(
          (Array.isArray(section[listKey]) && section[listKey].length === 0) ===
            (typeof section[field] === "string"),
          `${label}: ${field} must be set exactly when ${listKey} is empty`,
        );
      }
    }
    // A raw acquaintance key is canonical plumbing, never viewer copy.
    check(!/"acq-[^"]*"/.test(loaded[route].raw), `${label}: exposes a raw acquaintance key`);
  }
  const chart = loaded[`/api/v2/characters/${characterId}/archive/chart`]?.value;
  for (const motif of chart?.motifs ?? []) {
    check(
      motif.truthClass === "symbolic_interpretation" &&
        typeof motif.effectScopeLabel === "string" &&
        motif.effectScopeLabel.includes("不影響價格或績效"),
      "archive/chart.json: a motif is symbolic_interpretation and says it does not affect price or performance",
    );
  }
  const memories = loaded[`/api/v2/characters/${characterId}/archive/memories`]?.value;
  for (const memory of memories?.memories ?? []) {
    check(
      memory.visibility === "subscriber_archive" || memory.visibility === "public_edition",
      "archive/memories.json: a canonical_restricted memory may never be listed",
    );
  }
  const traits = loaded[`/api/v2/characters/${characterId}/archive/traits`]?.value;
  check(
    Array.isArray(traits?.biasOccurrences) && traits.biasOccurrences.length > 0,
    "archive/traits.json: the slice's detected patterns must be listed per occurrence",
  );
  // Every character is a fictional adult (AGENTS.md "Product invariants").
  // The floor here is stricter than the runbook's advertised "at least 18":
  // this audit also requires the identity to be explicitly marked as an
  // adult fictional resident, not merely to clear a numeric age.
  const life = loaded[`/api/v2/characters/${characterId}/archive/life`]?.value;
  const identity = life?.identity;
  check(
    identity?.adultFictionalResident === true,
    "archive/life.json: identity.adultFictionalResident must be present and true",
  );
  check(
    Number.isInteger(identity?.ageYears) && identity.ageYears >= 20,
    `archive/life.json: identity.ageYears must be at least 20, found ${JSON.stringify(identity?.ageYears)}`,
  );

  // -- cross-cutting -------------------------------------------------------
  for (const [route, document] of Object.entries(loaded)) {
    const label = routes[route];
    for (const truthClass of document.value.truthClasses ?? []) {
      check(
        ALLOWED_TRUTH_CLASSES.includes(truthClass),
        `${label}: truthClasses may not include ${JSON.stringify(truthClass)}`,
      );
    }
    for (const reference of document.value.sourceRevisionSet ?? []) {
      requireFields(`${label} sourceRevisionSet[]`, reference, REQUIRED.SourceRevisionRef);
    }
    for (const banned of BANNED_SUBSTRINGS) {
      check(
        !document.raw.includes(banned),
        `${label}: contains the banned string ${JSON.stringify(banned)}`,
      );
    }
    auditUtterances(document.value, label);
    const keys = [];
    allKeys(document.value, keys);
    for (const key of keys) {
      const lower = key.toLowerCase();
      for (const fragment of BANNED_KEY_FRAGMENTS) {
        check(!lower.includes(fragment), `${label}: ranking-shaped field ${JSON.stringify(key)}`);
      }
    }
    checkActionCallPhraseKeys(label, keys);
  }
  for (const banned of BANNED_SUBSTRINGS) {
    check(
      !index.raw.includes(banned),
      `index.json: contains the banned string ${JSON.stringify(banned)}`,
    );
  }
  const indexKeys = [];
  allKeys(index.value, indexKeys);
  checkActionCallPhraseKeys("index.json", indexKeys);

  // -- action-call rule, per string value (literal list included) ------------
  const walkedDocuments = [
    ...Object.entries(loaded).map(([route, document]) => [routes[route], document.value]),
    ["index.json", index.value],
  ];
  const shapeMatcher = actionCallMatcher(characterDisplayNames(walkedDocuments));
  for (const [file, value] of walkedDocuments) auditActionCalls(value, file, "$", shapeMatcher);

  // -- field-level truth-class identity -------------------------------------
  if (systemLabelAllowlist !== null) {
    const identity = newIdentityWalk();
    for (const [file, value] of walkedDocuments) {
      let declared = null;
      if (Object.hasOwn(value, "truthClasses")) {
        check(Array.isArray(value.truthClasses), `${file}: envelope truthClasses must be a list`);
        declared = Array.isArray(value.truthClasses) ? value.truthClasses : [];
      }
      identityWalk(file, "$", value, declared, systemLabelAllowlist, identity);
    }
    check(
      identity.realFact === 0,
      `field-level truth classes: found ${identity.realFact} real_fact class value(s); a synthetic slice must have 0`,
    );
    // Not a vacuous pass (same floors as the Rust walker's on-disk test): the
    // eleven files carry hundreds of claims and numbers, the reviewed reason
    // fields are all visited as listed system labels, and the non-claim
    // number list is actually exercised.
    check(identity.claims >= 400, `field-level truth classes: only ${identity.claims} claims visited (expected >= 400)`);
    check(identity.numbers >= 400, `field-level truth classes: only ${identity.numbers} numbers visited (expected >= 400)`);
    check(
      identity.classesSeen >= 400,
      `field-level truth classes: only ${identity.classesSeen} class values visited (expected >= 400)`,
    );
    check(
      identity.systemLabels >= 30,
      `field-level truth classes: only ${identity.systemLabels} system labels visited (expected >= 30)`,
    );
    check(identity.nonClaimNumbers > 0, "field-level truth classes: no non-claim number was visited");
    // The sibling map is actually applied: 29 chapters x 5 prose siblings,
    // 30 daily disclosures x 2, the close-up, the relationship signals...
    check(
      siblingContract === null || identity.siblingRules >= 200,
      `field-level truth classes: only ${identity.siblingRules} required-sibling rules applied (expected >= 200)`,
    );
    fieldIdentitySummary = identity;
  }
}

// The field-level walk is not optional: if nothing else failed, it must have run.
check(errors.length > 0 || fieldIdentitySummary !== null, "field-level truth classes: the walker did not run");

if (errors.length > 0) {
  console.error("v5-slice-api-audit failed:");
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

assert.equal(errors.length, 0);
console.log(
  `v5-slice-api-audit: ok (${expectedRoutes.length} public-v2 documents + index for character ${characterId})`,
);
console.log(
  `v5-slice-api-audit: field-level truth classes ok (${fieldIdentitySummary.claims} claims, ${fieldIdentitySummary.numbers} numbers, ${fieldIdentitySummary.classesSeen} class values, ${fieldIdentitySummary.systemLabels} listed system labels, ${fieldIdentitySummary.nonClaimNumbers} non-claim numbers, ${fieldIdentitySummary.siblingRules} required-sibling rules, ${fieldIdentitySummary.realFact} real_fact)`,
);
