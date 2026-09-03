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
  CharacterArchiveIndexResponse,
  CharacterCloseUpResponse,
  CharacterLifeJournalResponse,
  CharacterPaperArchiveResponse,
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
