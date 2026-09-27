// Fail-closed client for the public V5 read surfaces.
//
// Response types are the generated `contracts/openapi/public-v2.yaml` types —
// never re-declared here, so a contract change breaks the build instead of
// silently drifting.
//
// Fail-closed rules (AGENTS.md "Data, AI, and privacy",
// docs/v5/product-constitution.md): a non-200, an unparseable body, or a
// projection missing a contract-required field is reported as `unavailable`.
// The client never substitutes a default, a zero, or a placeholder string.

import type {
  ArchiveSectionKey,
  CharacterArchiveIndexResponse,
  CharacterChartArchiveResponse,
  CharacterCloseUpResponse,
  CharacterLifeArchiveResponse,
  CharacterLifeJournalResponse,
  CharacterMemoriesArchiveResponse,
  CharacterPaperArchiveResponse,
  CharacterRelationsArchiveResponse,
  CharacterTraitsArchiveResponse,
  TruthClass,
  V2ReasonCode,
  WorldSnapshot,
} from "../api/generated-v2/types.gen";

/**
 * `V2ReasonCode` values come from a contract `Problem` body. The three local
 * codes are used only when the response itself cannot be trusted.
 */
export type UnavailableReason =
  | V2ReasonCode
  | "UNRECOGNIZED_RESPONSE"
  | "MALFORMED_PAYLOAD"
  | "INCOMPLETE_PROJECTION";

export type ApiResult<T> =
  | { status: "ready"; data: T }
  | { status: "unavailable"; reasonCode: UnavailableReason; httpStatus: number }
  | { status: "error" };

const V2_REASON_CODES: readonly string[] = [
  "UNKNOWN_RESOURCE",
  "VISIBILITY_HELD",
  "WITHDRAWN",
  "RIGHTS_REVOKED",
  "PROJECTION_LAGGING",
  "CANONICAL_RESTRICTED",
  "MALFORMED_CURSOR",
];

const TRUTH_CLASSES: readonly string[] = [
  "real_fact",
  "statistical_sample",
  "fictional_setting",
  "symbolic_interpretation",
  "simulated_narrative",
];

const DATA_STATES: readonly string[] = ["READY", "STALE", "HELD", "CORRECTED", "WITHDRAWN"];

type JsonObject = Record<string, unknown>;

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasString(value: JsonObject, key: string): boolean {
  return typeof value[key] === "string" && (value[key] as string).length > 0;
}

function hasNumber(value: JsonObject, key: string): boolean {
  return typeof value[key] === "number" && Number.isFinite(value[key]);
}

function hasArray(value: JsonObject, key: string): boolean {
  return Array.isArray(value[key]);
}

function hasObject(value: JsonObject, key: string): boolean {
  return isRecord(value[key]);
}

/** Fields every public projection response must carry (public-v2.yaml). */
function hasProjectionEnvelope(value: unknown): value is JsonObject {
  if (!isRecord(value)) return false;
  if (!hasNumber(value, "projectionVersion")) return false;
  if (!hasNumber(value, "sourceGlobalPosition")) return false;
  if (!hasNumber(value, "visibilityEpoch")) return false;
  if (!hasString(value, "serverNow")) return false;
  if (!hasString(value, "dataState")) return false;
  if (!DATA_STATES.includes(value["dataState"] as string)) return false;
  if (!hasArray(value, "sourceRevisionSet")) return false;

  // Every visible claim carries a truth class; an empty or unknown set is a
  // missing claim label, not an empty state.
  const truthClasses = value["truthClasses"];
  if (!Array.isArray(truthClasses) || truthClasses.length === 0) return false;
  return truthClasses.every(
    (entry): entry is TruthClass => typeof entry === "string" && TRUTH_CLASSES.includes(entry),
  );
}

function isWithdrawnTombstone(value: JsonObject): boolean {
  return value["dataState"] === "WITHDRAWN" && hasString(value, "tombstoneReasonLabel");
}

function isWorldSnapshot(value: unknown): boolean {
  if (!hasProjectionEnvelope(value)) return false;
  return (
    hasObject(value, "marketClock") &&
    hasNumber(value, "worldTickId") &&
    hasObject(value, "scene") &&
    hasArray(value, "characterPositions") &&
    hasArray(value, "storyHooks")
  );
}

/** Character responses are either the live projection or a withdrawal tombstone. */
function isCharacterResponse(
  value: unknown,
  liveFields: (record: JsonObject) => boolean,
): value is JsonObject {
  if (!hasProjectionEnvelope(value)) return false;
  if (!hasString(value, "characterId")) return false;
  if (isWithdrawnTombstone(value)) return true;
  if (value["dataState"] === "WITHDRAWN") return false;
  return liveFields(value);
}

function isCloseUp(value: unknown): boolean {
  return isCharacterResponse(
    value,
    (record) =>
      hasString(record, "displayName") &&
      hasNumber(record, "ageYears") &&
      hasString(record, "occupationLabel") &&
      hasString(record, "sceneRef") &&
      hasString(record, "poseState") &&
      hasString(record, "currentVerbPhrase") &&
      hasString(record, "unresolvedTensionSummary") &&
      hasArray(record, "unresolvedCommitments"),
  );
}

function isLifeJournalPage(value: unknown): boolean {
  return isCharacterResponse(
    value,
    (record) =>
      hasString(record, "appliedAudienceScope") &&
      hasArray(record, "entries") &&
      hasArray(record, "heldEntries") &&
      "nextCursor" in record &&
      (record["nextCursor"] === null || typeof record["nextCursor"] === "string"),
  );
}

function isArchiveIndex(value: unknown): boolean {
  return isCharacterResponse(
    value,
    (record) =>
      hasString(record, "archiveSchemaRevision") &&
      hasString(record, "longTermTensionSummary") &&
      hasArray(record, "recentHighlights") &&
      Array.isArray(record["sections"]) &&
      (record["sections"] as unknown[]).length === 6,
  );
}

function isPaperArchive(value: unknown): boolean {
  return isCharacterResponse(
    value,
    (record) =>
      hasString(record, "appliedAudienceScope") &&
      hasString(record, "asOf") &&
      hasObject(record, "paperVersionSet") &&
      hasObject(record, "account") &&
      hasArray(record, "positions") &&
      hasArray(record, "historicalActionFills") &&
      hasArray(record, "dataRevisions"),
  );
}

// ---------------------------------------------------------------------------
// The five other deep-archive sections (relations / chart / traits / memories /
// life). Every item on these pages is a visible claim, so every item must carry
// a known `truthClass` and a non-empty `sourceRefs` (public-v2.yaml
// `ArchiveSourceRefs`: "an item with no source is not rendered"). A list and
// its `*EmptyReason` must agree: an empty list needs a reason, a non-empty
// list must not carry one. Anything else is an incomplete projection.
// ---------------------------------------------------------------------------

function isStringOrNull(value: unknown): boolean {
  return value === null || (typeof value === "string" && value.length > 0);
}

function isSourceRef(value: unknown): boolean {
  if (!isRecord(value) || !hasString(value, "refId")) return false;
  if (value["kind"] === "canonical_event") {
    return hasString(value, "eventType") && hasNumber(value, "globalPosition");
  }
  if (value["kind"] === "character_seed") {
    return value["eventType"] === null && value["globalPosition"] === null;
  }
  return false;
}

/** One visible archive claim: a known truth class and at least one source. */
function isArchiveItem(value: unknown): value is JsonObject {
  if (!isRecord(value)) return false;
  const truthClass = value["truthClass"];
  if (typeof truthClass !== "string" || !TRUTH_CLASSES.includes(truthClass)) return false;
  const sourceRefs = value["sourceRefs"];
  return Array.isArray(sourceRefs) && sourceRefs.length > 0 && sourceRefs.every(isSourceRef);
}

function hasStrings(value: JsonObject, keys: readonly string[]): boolean {
  return keys.every((key) => hasString(value, key));
}

function isArchiveItemWith(value: unknown, strings: readonly string[]): value is JsonObject {
  return isArchiveItem(value) && hasStrings(value, strings);
}

function everyItem(value: unknown, check: (item: unknown) => boolean): boolean {
  return Array.isArray(value) && value.every(check);
}

/** `list` empty ⇔ `reason` is a non-empty label. */
function listAgreesWithReason(record: JsonObject, listKey: string, reasonKey: string): boolean {
  const list = record[listKey];
  if (!Array.isArray(list) || !(reasonKey in record)) return false;
  const reason = record[reasonKey];
  return list.length === 0 ? typeof reason === "string" && reason.length > 0 : reason === null;
}

function isSessionPointer(value: unknown): boolean {
  return (
    isRecord(value) && hasString(value, "sessionDate") && isStringOrNull(value["journalEntryRef"])
  );
}

function isUtterance(value: unknown): boolean {
  return (
    isRecord(value) &&
    hasStrings(value, ["utteranceArtifactId", "canonicalTextSha256", "canonicalTextUtf8"])
  );
}

function isArchiveSection(
  value: unknown,
  sectionKey: Exclude<ArchiveSectionKey, "paper">,
  liveFields: (record: JsonObject) => boolean,
): boolean {
  return isCharacterResponse(
    value,
    (record) =>
      record["sectionKey"] === sectionKey &&
      hasString(record, "appliedAudienceScope") &&
      hasString(record, "asOf") &&
      liveFields(record),
  );
}

function isRelationshipSignal(value: unknown): boolean {
  return (
    isArchiveItemWith(value, ["displayName", "relationLabel", "summary", "sessionDate"]) &&
    isUtterance(value["utterance"]) &&
    isStringOrNull(value["journalEntryRef"])
  );
}

function isAcquaintance(value: unknown): boolean {
  if (!isArchiveItemWith(value, ["displayName", "relationLabel", "relationNote"])) return false;
  const counterpart = value["counterpartAccount"];
  return (
    everyItem(
      value["observedInteractions"],
      (item) =>
        isArchiveItemWith(item, ["sessionDate", "observableAction"]) &&
        isStringOrNull(item["journalEntryRef"]),
    ) &&
    listAgreesWithReason(value, "observedInteractions", "observedInteractionsEmptyReason") &&
    everyItem(value["relationshipSignals"], isRelationshipSignal) &&
    listAgreesWithReason(value, "relationshipSignals", "relationshipSignalsEmptyReason") &&
    isArchiveItemWith(counterpart, ["reasonLabel"]) &&
    counterpart["state"] === "unknown"
  );
}

function isRelationsArchive(value: unknown): boolean {
  return isArchiveSection(
    value,
    "relations",
    (record) =>
      everyItem(record["acquaintances"], isAcquaintance) &&
      listAgreesWithReason(record, "acquaintances", "acquaintancesEmptyReason"),
  );
}

function isChartMotif(value: unknown): boolean {
  if (!isArchiveItemWith(value, ["motifLabel", "effectScopeLabel"])) return false;
  const window = value["activeWindow"];
  return (
    isRecord(window) &&
    hasStrings(window, ["activeFrom", "activeUntil"]) &&
    everyItem(value["activeSessions"], isSessionPointer) &&
    everyItem(
      value["invocations"],
      (item) =>
        isArchiveItemWith(item, ["readingText", "sessionDate"]) &&
        isStringOrNull(item["journalEntryRef"]),
    ) &&
    listAgreesWithReason(value, "invocations", "invocationsEmptyReason")
  );
}

function isChartArchive(value: unknown): boolean {
  return isArchiveSection(
    value,
    "chart",
    (record) =>
      isArchiveItemWith(record["birthIdentity"], ["birthDate", "birthRegionLabel"]) &&
      everyItem(record["placements"], (item) =>
        isArchiveItemWith(item, ["placementLabel", "signLabel"]),
      ) &&
      listAgreesWithReason(record, "placements", "placementsEmptyReason") &&
      everyItem(record["motifs"], isChartMotif),
  );
}

function isTraitsArchive(value: unknown): boolean {
  return isArchiveSection(value, "traits", (record) => {
    const fourAxis = record["fourAxis"];
    return (
      Array.isArray(fourAxis) &&
      fourAxis.length === 4 &&
      fourAxis.every(
        (axis) =>
          isArchiveItemWith(axis, ["axisKey", "lowPoleLabel", "highPoleLabel", "leaningLabel"]) &&
          hasNumber(axis, "orientationBp"),
      ) &&
      isArchiveItemWith(record["coreNeed"], ["label"]) &&
      isArchiveItemWith(record["coreFear"], ["label"]) &&
      isArchiveItemWith(record["bloodType"], ["bloodType", "effectScopeLabel"]) &&
      isArchiveItemWith(record["selfDescription"], ["label"]) &&
      everyItem(
        record["habits"],
        (item) =>
          isArchiveItemWith(item, ["label"]) && everyItem(item["evidenceSessions"], isSessionPointer),
      ) &&
      everyItem(
        record["biasOccurrences"],
        (item) =>
          isArchiveItemWith(item, ["biasKind", "biasLabel", "sessionDate"]) &&
          isStringOrNull(item["journalEntryRef"]) &&
          everyItem(item["evidenceSessions"], isSessionPointer),
      ) &&
      listAgreesWithReason(record, "biasOccurrences", "biasOccurrencesEmptyReason") &&
      everyItem(
        record["counterExamples"],
        (item) =>
          isArchiveItemWith(item, ["biasKind", "observedLabel", "sessionDate"]) &&
          isStringOrNull(item["journalEntryRef"]),
      ) &&
      listAgreesWithReason(record, "counterExamples", "counterExamplesEmptyReason")
    );
  });
}

const MEMORY_VALENCES: readonly string[] = ["negative", "neutral", "positive"];
const MEMORY_VISIBILITIES: readonly string[] = ["subscriber_archive", "public_edition"];

function isArchiveMemory(value: unknown): boolean {
  return (
    isArchiveItemWith(value, ["memoryRef", "kindLabel", "note", "formedAt"]) &&
    typeof value["formedBeforeFirstSession"] === "boolean" &&
    isStringOrNull(value["sessionDate"]) &&
    isStringOrNull(value["journalEntryRef"]) &&
    everyItem(
      value["involvedPeople"],
      (person) => isRecord(person) && hasStrings(person, ["displayName", "relationLabel"]),
    ) &&
    MEMORY_VALENCES.includes(value["emotionalValence"] as string) &&
    hasNumber(value, "confidenceBp") &&
    MEMORY_VISIBILITIES.includes(value["visibility"] as string) &&
    everyItem(value["reinterpretations"], (item) =>
      isArchiveItemWith(item, ["reinterpretedAt", "note"]),
    ) &&
    listAgreesWithReason(value, "reinterpretations", "reinterpretationsEmptyReason")
  );
}

function isMemoriesArchive(value: unknown): boolean {
  return isArchiveSection(
    value,
    "memories",
    (record) =>
      everyItem(record["memories"], isArchiveMemory) &&
      listAgreesWithReason(record, "memories", "memoriesEmptyReason"),
  );
}

function isLifeArchive(value: unknown): boolean {
  return isArchiveSection(value, "life", (record) => {
    const identity = record["identity"];
    return (
      isArchiveItemWith(identity, ["displayName", "occupationLabel", "birthDate", "birthRegionLabel"]) &&
      hasNumber(identity, "ageYears") &&
      // 只有虛構成年居民可以有生平頁；這個欄位不是 `true` 就不渲染。
      identity["adultFictionalResident"] === true &&
      everyItem(
        record["milestones"],
        (item) => isArchiveItemWith(item, ["label"]) && hasNumber(item, "ageYears"),
      ) &&
      everyItem(record["originMemories"], (item) => isArchiveItemWith(item, ["note", "formedAt"])) &&
      everyItem(record["unrecordedFacets"], (item) =>
        isArchiveItemWith(item, ["facetKey", "reasonLabel"]),
      ) &&
      hasString(record, "joinedWorldOn") &&
      everyItem(
        record["chapterTimeline"],
        (item) =>
          isArchiveItemWith(item, ["sessionDate"]) &&
          (item["chapterState"] === "published" || item["chapterState"] === "in_session") &&
          isStringOrNull(item["journalEntryRef"]),
      )
    );
  });
}

/** The public read surfaces, keyed the same way as the slice routes. */
export type ProjectionKind =
  | "world"
  | "closeUp"
  | "journal"
  | "archive"
  | "archivePaper"
  | "archiveRelations"
  | "archiveChart"
  | "archiveTraits"
  | "archiveMemories"
  | "archiveLife";

const PROJECTION_VALIDATORS: Readonly<Record<ProjectionKind, (value: unknown) => boolean>> = {
  world: isWorldSnapshot,
  closeUp: isCloseUp,
  journal: isLifeJournalPage,
  archive: isArchiveIndex,
  archivePaper: isPaperArchive,
  archiveRelations: isRelationsArchive,
  archiveChart: isChartArchive,
  archiveTraits: isTraitsArchive,
  archiveMemories: isMemoriesArchive,
  archiveLife: isLifeArchive,
};

/**
 * Re-runs the same contract check a live response goes through. Used for a
 * projection read back from the last-known cache: stored bytes are untrusted
 * (tampered, or written by an older build), so anything that no longer
 * satisfies the contract is treated as "no cache", never patched.
 */
export function isValidProjection(kind: ProjectionKind, value: unknown): boolean {
  return PROJECTION_VALIDATORS[kind](value);
}

function problemReasonCode(body: unknown): V2ReasonCode | null {
  if (!isRecord(body)) return null;
  const reasonCode = body["reasonCode"];
  if (typeof reasonCode !== "string" || !V2_REASON_CODES.includes(reasonCode)) return null;
  return reasonCode as V2ReasonCode;
}

async function requestJson<T>(
  path: string,
  isValid: (value: unknown) => boolean,
  signal?: AbortSignal,
): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      signal,
      headers: { Accept: "application/json" },
    });
  } catch {
    // Transport failed (offline, aborted, DNS). Nothing is known about the
    // resource, so this is not reported as a resource-level unavailability.
    return { status: "error" };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {
      status: "unavailable",
      reasonCode: response.ok ? "MALFORMED_PAYLOAD" : "UNRECOGNIZED_RESPONSE",
      httpStatus: response.status,
    };
  }

  if (!response.ok) {
    return {
      status: "unavailable",
      reasonCode: problemReasonCode(body) ?? "UNRECOGNIZED_RESPONSE",
      httpStatus: response.status,
    };
  }

  if (!isValid(body)) {
    return {
      status: "unavailable",
      reasonCode: "INCOMPLETE_PROJECTION",
      httpStatus: response.status,
    };
  }

  return { status: "ready", data: body as T };
}

export function worldPath(): string {
  return "/api/v2/world";
}

export function characterPath(characterId: string, suffix = ""): string {
  return `/api/v2/characters/${encodeURIComponent(characterId)}${suffix}`;
}

export function fetchWorld(signal?: AbortSignal): Promise<ApiResult<WorldSnapshot>> {
  return requestJson<WorldSnapshot>(worldPath(), isWorldSnapshot, signal);
}

export function fetchCloseUp(
  characterId: string,
  signal?: AbortSignal,
): Promise<ApiResult<CharacterCloseUpResponse>> {
  return requestJson<CharacterCloseUpResponse>(
    characterPath(characterId, "/close-up"),
    isCloseUp,
    signal,
  );
}

export function fetchLifeJournal(
  characterId: string,
  signal?: AbortSignal,
): Promise<ApiResult<CharacterLifeJournalResponse>> {
  return requestJson<CharacterLifeJournalResponse>(
    characterPath(characterId, "/life-journal"),
    isLifeJournalPage,
    signal,
  );
}

export function fetchArchiveIndex(
  characterId: string,
  signal?: AbortSignal,
): Promise<ApiResult<CharacterArchiveIndexResponse>> {
  return requestJson<CharacterArchiveIndexResponse>(
    characterPath(characterId, "/archive"),
    isArchiveIndex,
    signal,
  );
}

export function fetchPaperArchive(
  characterId: string,
  signal?: AbortSignal,
): Promise<ApiResult<CharacterPaperArchiveResponse>> {
  return requestJson<CharacterPaperArchiveResponse>(
    characterPath(characterId, "/archive/paper"),
    isPaperArchive,
    signal,
  );
}

export function fetchRelationsArchive(
  characterId: string,
  signal?: AbortSignal,
): Promise<ApiResult<CharacterRelationsArchiveResponse>> {
  return requestJson<CharacterRelationsArchiveResponse>(
    characterPath(characterId, "/archive/relations"),
    isRelationsArchive,
    signal,
  );
}

export function fetchChartArchive(
  characterId: string,
  signal?: AbortSignal,
): Promise<ApiResult<CharacterChartArchiveResponse>> {
  return requestJson<CharacterChartArchiveResponse>(
    characterPath(characterId, "/archive/chart"),
    isChartArchive,
    signal,
  );
}

export function fetchTraitsArchive(
  characterId: string,
  signal?: AbortSignal,
): Promise<ApiResult<CharacterTraitsArchiveResponse>> {
  return requestJson<CharacterTraitsArchiveResponse>(
    characterPath(characterId, "/archive/traits"),
    isTraitsArchive,
    signal,
  );
}

export function fetchMemoriesArchive(
  characterId: string,
  signal?: AbortSignal,
): Promise<ApiResult<CharacterMemoriesArchiveResponse>> {
  return requestJson<CharacterMemoriesArchiveResponse>(
    characterPath(characterId, "/archive/memories"),
    isMemoriesArchive,
    signal,
  );
}

export function fetchLifeArchive(
  characterId: string,
  signal?: AbortSignal,
): Promise<ApiResult<CharacterLifeArchiveResponse>> {
  return requestJson<CharacterLifeArchiveResponse>(
    characterPath(characterId, "/archive/life"),
    isLifeArchive,
    signal,
  );
}
