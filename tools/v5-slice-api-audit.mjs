import assert from "node:assert/strict";
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
    const keys = [];
    allKeys(document.value, keys);
    for (const key of keys) {
      const lower = key.toLowerCase();
      for (const fragment of BANNED_KEY_FRAGMENTS) {
        check(!lower.includes(fragment), `${label}: ranking-shaped field ${JSON.stringify(key)}`);
      }
    }
  }
  for (const banned of BANNED_SUBSTRINGS) {
    check(
      !index.raw.includes(banned),
      `index.json: contains the banned string ${JSON.stringify(banned)}`,
    );
  }
}

if (errors.length > 0) {
  console.error("v5-slice-api-audit failed:");
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

assert.equal(errors.length, 0);
console.log(
  `v5-slice-api-audit: ok (${expectedRoutes.length} public-v2 documents + index for character ${characterId})`,
);
