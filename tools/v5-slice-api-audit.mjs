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
// disclosure key is structurally absent while finality is pending, and that
// no banned string ever reaches a viewer.
// ---------------------------------------------------------------------------

const apiRoot = new URL("../fixtures/v5/one-character-slice/api/", import.meta.url);

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
    "nextCursor",
  ],
  // components.schemas.LifeJournalEntry.required
  LifeJournalEntry: [
    "entryId",
    "chapterDate",
    "sceneSummary",
    "knownAtTheTimeSummary",
    "actionSummary",
    "consequence",
    "openQuestionSummary",
    "archiveRefs",
  ],
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
};

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
    world.marketClock?.marketDate === "2026-03-18" &&
      world.marketClock?.sessionPhase === "in_session" &&
      world.marketClock?.asOfTradingDate === "2026-03-17",
    "world.json: marketClock must show today in session with paper figures as of the previous close",
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
    Array.isArray(journal.entries) && journal.entries.length === 5,
    `life-journal.json: expected 5 entries, found ${journal.entries?.length}`,
  );
  check(journal.nextCursor === null, "life-journal.json: nextCursor must be null");
  const expectedChapterDates = ["2026-03-02", "2026-03-03", "2026-03-05", "2026-03-10", "2026-03-17"];
  (journal.entries ?? []).forEach((entry, position) => {
    const label = `life-journal.json entries[${position}]`;
    requireFields(label, entry, REQUIRED.LifeJournalEntry);
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
    // 老毛病又回來了 only appears once the pattern already recurred twice,
    // which in this slice is the fourth and fifth chapters.
    check(
      Object.hasOwn(entry, "recurringPatternRef") === position >= 3,
      `${label}: recurringPatternRef presence does not match the recurrence threshold`,
    );
  });

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
    if (section.sectionKey === "paper") {
      check(
        section.sectionPath === `/api/v2/characters/${characterId}/archive/paper`,
        `${label}: 模擬紀錄 must link to its own endpoint`,
      );
    } else {
      check(
        section.sectionPath === null,
        `${label}: ${section.sectionKey} has no endpoint in this phase and must be null`,
      );
    }
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
    // The complete loss stays visible.
    check(
      Number.isInteger(position.realizedPnlMinorUnits) &&
        Number.isInteger(position.unrealizedPnlMinorUnits) &&
        Number.isInteger(position.unrealizedPnlPercentFixed2),
      "archive/paper.json: P&L figures must be integer minor units / fixed-point",
    );
  }

  check(
    Array.isArray(paper.historicalActionFills) && paper.historicalActionFills.length === 6,
    `archive/paper.json: expected 6 daily records, found ${paper.historicalActionFills?.length}`,
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
