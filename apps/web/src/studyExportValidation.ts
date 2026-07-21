import {
  evaluateCohort,
  normalizeParticipantCode,
  STUDY_EVALUATOR_REVISION,
  STUDY_SCHEMA_VERSION,
  type StudyEvent,
  type StudyExport,
} from "./study.ts";
import { STUDY_ORIGIN } from "./studyRelease.ts";

const MAX_EVENT_COUNT = 100_000;
const EVENT_BASE_KEYS = [
  "schemaVersion",
  "eventId",
  "participantCode",
  "visitOrdinal",
  "attemptOrdinal",
  "runId",
  "sequence",
  "monotonicMs",
  "occurredAt",
  "sceneSecond",
  "type",
] as const;

export class StudyExportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudyExportValidationError";
  }
}

function fail(path: string, message: string): never {
  throw new StudyExportValidationError(`${path}: ${message}`);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fail(path, "必須是物件");
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  const allowedKeys = new Set(allowed);
  const unknown = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unknown.length > 0) fail(path, `包含未定義欄位：${unknown.sort().join("、")}`);
}

function string(
  value: unknown,
  path: string,
  options: { min?: number; max?: number } = {},
): string {
  if (typeof value !== "string") return fail(path, "必須是文字");
  const min = options.min ?? 0;
  const max = options.max ?? Number.POSITIVE_INFINITY;
  if (value.length < min || value.length > max) {
    return fail(path, `長度必須介於 ${min} 與 ${max} 之間`);
  }
  return value;
}

function integer(
  value: unknown,
  path: string,
  options: { min?: number; max?: number } = {},
): number {
  if (!Number.isInteger(value)) return fail(path, "必須是整數");
  const numeric = value as number;
  if (numeric < (options.min ?? Number.NEGATIVE_INFINITY)) return fail(path, "數值太小");
  if (numeric > (options.max ?? Number.POSITIVE_INFINITY)) return fail(path, "數值太大");
  return numeric;
}

function finiteNumber(value: unknown, path: string, min = Number.NEGATIVE_INFINITY): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min) {
    return fail(path, "必須是有效數值");
  }
  return value;
}

function boolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") return fail(path, "必須是布林值");
  return value;
}

function oneOf<Value extends string>(
  value: unknown,
  allowed: readonly Value[],
  path: string,
): Value {
  if (typeof value !== "string" || !allowed.includes(value as Value)) {
    return fail(path, `必須是 ${allowed.join("、")} 之一`);
  }
  return value as Value;
}

function isoTimestamp(value: unknown, path: string): string {
  const timestamp = string(value, path, { min: 20, max: 40 });
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(timestamp) ||
    !Number.isFinite(Date.parse(timestamp)) ||
    new Date(timestamp).toISOString() !== timestamp
  ) {
    return fail(path, "必須是 UTC ISO 日期時間");
  }
  return timestamp;
}

function residentId(value: unknown, path: string): string {
  return string(value, path, { min: 1, max: 80 });
}

function parseEvent(value: unknown, index: number): StudyEvent {
  const path = `events[${index}]`;
  const event = record(value, path);
  if (event.schemaVersion !== STUDY_SCHEMA_VERSION) {
    fail(`${path}.schemaVersion`, `只接受 ${STUDY_SCHEMA_VERSION}`);
  }

  const participantCode = string(event.participantCode, `${path}.participantCode`, {
    min: 2,
    max: 16,
  });
  if (normalizeParticipantCode(participantCode) !== participantCode) {
    fail(`${path}.participantCode`, "必須是已正規化的匿名代碼");
  }

  const visitOrdinal = integer(event.visitOrdinal, `${path}.visitOrdinal`, { min: 1, max: 2 });
  const base = {
    schemaVersion: STUDY_SCHEMA_VERSION,
    eventId: string(event.eventId, `${path}.eventId`, { min: 8, max: 200 }),
    participantCode,
    visitOrdinal: visitOrdinal as 1 | 2,
    attemptOrdinal: integer(event.attemptOrdinal, `${path}.attemptOrdinal`, { min: 1 }),
    runId: string(event.runId, `${path}.runId`, { min: 1, max: 128 }),
    sequence: integer(event.sequence, `${path}.sequence`, { min: 0 }),
    monotonicMs: finiteNumber(event.monotonicMs, `${path}.monotonicMs`, 0),
    occurredAt: isoTimestamp(event.occurredAt, `${path}.occurredAt`),
    sceneSecond: integer(event.sceneSecond, `${path}.sceneSecond`, { min: 0, max: 599 }),
  };

  const type = oneOf(
    event.type,
    ["run_started", "watch_sample", "follow_started", "handoff_completed", "run_ended"] as const,
    `${path}.type`,
  );

  if (type === "run_started") {
    exactKeys(event, [...EVENT_BASE_KEYS, "consentVersion", "appBuildId"], path);
    return {
      ...base,
      type,
      consentVersion: string(event.consentVersion, `${path}.consentVersion`, {
        min: 1,
        max: 80,
      }),
      appBuildId: string(event.appBuildId, `${path}.appBuildId`, { min: 1, max: 80 }),
    };
  }
  if (type === "watch_sample") {
    exactKeys(event, [...EVENT_BASE_KEYS, "visible", "playing", "focusedResidentId"], path);
    return {
      ...base,
      type,
      visible: boolean(event.visible, `${path}.visible`),
      playing: boolean(event.playing, `${path}.playing`),
      focusedResidentId:
        event.focusedResidentId === null
          ? null
          : residentId(event.focusedResidentId, `${path}.focusedResidentId`),
    };
  }
  if (type === "follow_started") {
    exactKeys(event, [...EVENT_BASE_KEYS, "residentId", "input"], path);
    return {
      ...base,
      type,
      residentId: residentId(event.residentId, `${path}.residentId`),
      input: oneOf(event.input, ["hold", "tap", "control"] as const, `${path}.input`),
    };
  }
  if (type === "handoff_completed") {
    exactKeys(event, [...EVENT_BASE_KEYS, "fromId", "toId", "input"], path);
    const fromId = residentId(event.fromId, `${path}.fromId`);
    const toId = residentId(event.toId, `${path}.toId`);
    if (fromId === toId) fail(`${path}.toId`, "交接前後居民不可相同");
    if (event.input !== "drag") fail(`${path}.input`, "只接受 drag");
    return { ...base, type, fromId, toId, input: "drag" };
  }
  exactKeys(event, [...EVENT_BASE_KEYS, "reason"], path);
  return {
    ...base,
    type,
    reason: oneOf(
      event.reason,
      ["cycle_completed", "participant_ended"] as const,
      `${path}.reason`,
    ),
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]),
  );
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

export function verifyStudyExport(value: unknown): StudyExport {
  const payload = record(value, "export");
  exactKeys(
    payload,
    [
      "exportSchemaVersion",
      "studySchemaVersion",
      "evaluatorRevision",
      "studyOrigin",
      "exportedAt",
      "thresholds",
      "result",
      "events",
    ],
    "export",
  );
  if (payload.exportSchemaVersion !== 1) fail("export.exportSchemaVersion", "只接受 1");
  if (payload.studySchemaVersion !== STUDY_SCHEMA_VERSION) {
    fail("export.studySchemaVersion", `只接受 ${STUDY_SCHEMA_VERSION}`);
  }
  if (payload.evaluatorRevision !== STUDY_EVALUATOR_REVISION) {
    fail("export.evaluatorRevision", `只接受 ${STUDY_EVALUATOR_REVISION}`);
  }
  if (payload.studyOrigin !== STUDY_ORIGIN) {
    fail("export.studyOrigin", `只接受 ${STUDY_ORIGIN}`);
  }
  const exportedAt = isoTimestamp(payload.exportedAt, "export.exportedAt");

  const thresholds = record(payload.thresholds, "export.thresholds");
  const expectedThresholds = {
    participantCount: 24,
    holdAndDragCount: 20,
    fullForegroundCycleCount: 10,
    returnedToTopResidentCount: 6,
  } as const;
  if (!sameValue(thresholds, expectedThresholds)) {
    fail("export.thresholds", "與封存門檻不一致");
  }

  if (!Array.isArray(payload.events)) fail("export.events", "必須是陣列");
  if (payload.events.length > MAX_EVENT_COUNT) {
    fail("export.events", `不可超過 ${MAX_EVENT_COUNT} 筆`);
  }
  const events = payload.events.map(parseEvent);
  const result = evaluateCohort(events);
  if (result.duplicateVisitCount > 0) {
    fail("export.events", "同一 build、匿名代碼與觀看次序只能有一個 run");
  }
  if (!sameValue(payload.result, result)) {
    fail("export.result", "與原始事件重新計算的結果不一致");
  }

  return {
    exportSchemaVersion: 1,
    studySchemaVersion: STUDY_SCHEMA_VERSION,
    evaluatorRevision: STUDY_EVALUATOR_REVISION,
    studyOrigin: STUDY_ORIGIN,
    exportedAt,
    thresholds: expectedThresholds,
    result,
    events,
  };
}
