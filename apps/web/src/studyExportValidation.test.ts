import { describe, expect, it } from "vitest";

import {
  createStudyExport,
  STUDY_CONSENT_VERSION,
  STUDY_SCHEMA_VERSION,
  type StudyEvent,
} from "./study";
import { StudyExportValidationError, verifyStudyExport } from "./studyExportValidation";

function runStarted(overrides: Partial<StudyEvent> = {}): StudyEvent {
  return {
    schemaVersion: STUDY_SCHEMA_VERSION,
    eventId: "run-1:000000",
    participantCode: "P01",
    visitOrdinal: 1,
    attemptOrdinal: 1,
    runId: "run-1",
    sequence: 0,
    monotonicMs: 0,
    occurredAt: "2026-07-21T00:00:00.000Z",
    sceneSecond: 0,
    type: "run_started",
    consentVersion: STUDY_CONSENT_VERSION,
    appBuildId: "study-2026-07-21.3",
    ...overrides,
  } as StudyEvent;
}

describe("study export validation", () => {
  it("accepts an untouched export and recomputes its result", () => {
    const exported = createStudyExport([runStarted()], "2026-07-21T01:00:00.000Z");
    expect(verifyStudyExport(structuredClone(exported))).toEqual(exported);
  });

  it("rejects a derived result that does not match the raw events", () => {
    const exported = structuredClone(
      createStudyExport([runStarted()], "2026-07-21T01:00:00.000Z"),
    );
    exported.result.participantCount = 24;
    expect(() => verifyStudyExport(exported)).toThrow("與原始事件重新計算的結果不一致");
  });

  it("rejects an unknown evaluator revision", () => {
    const exported = {
      ...createStudyExport([runStarted()], "2026-07-21T01:00:00.000Z"),
      evaluatorRevision: "future-revision",
    };
    expect(() => verifyStudyExport(exported)).toThrow("只接受 v4-study-3");
  });

  it("rejects an export that claims a different collection origin", () => {
    const exported = {
      ...createStudyExport([runStarted()], "2026-07-21T01:00:00.000Z"),
      studyOrigin: "https://temporary-host.example",
    };
    expect(() => verifyStudyExport(exported)).toThrow("只接受 https://world.panshi.app");
  });

  it("rejects malformed or identifying participant codes before evaluation", () => {
    const exported = createStudyExport(
      [runStarted({ participantCode: "姓名-01" })],
      "2026-07-21T01:00:00.000Z",
    );
    expect(() => verifyStudyExport(exported)).toThrow(StudyExportValidationError);
  });

  it("rejects unknown fields instead of allowing hidden identifying data", () => {
    const exported = structuredClone(
      createStudyExport([runStarted()], "2026-07-21T01:00:00.000Z"),
    ) as unknown as Record<string, unknown>;
    exported.participantNames = ["not allowed"];
    expect(() => verifyStudyExport(exported)).toThrow("包含未定義欄位");

    const eventExport = structuredClone(
      createStudyExport([runStarted()], "2026-07-21T01:00:00.000Z"),
    ) as unknown as { events: Array<Record<string, unknown>> };
    eventExport.events[0]!.email = "not-allowed@example.test";
    expect(() => verifyStudyExport(eventExport)).toThrow("包含未定義欄位");
  });

  it("rejects timestamps that are parseable but not canonical UTC evidence", () => {
    const exported = createStudyExport(
      [runStarted({ occurredAt: "2026-07-21 00:00:00Z" })],
      "2026-07-21T01:00:00.000Z",
    );
    expect(() => verifyStudyExport(exported)).toThrow("必須是 UTC ISO 日期時間");
  });

  it("rejects duplicate runs for the same sealed participant visit", () => {
    const duplicate = runStarted({ runId: "run-2", eventId: "run-2:000000" });
    const exported = createStudyExport(
      [runStarted(), duplicate],
      "2026-07-21T01:00:00.000Z",
    );
    expect(() => verifyStudyExport(exported)).toThrow(
      "同一 build、研究代碼與觀看次序只能有一個 run",
    );
  });

  it("rejects a handoff that points back to the same resident", () => {
    const start = runStarted();
    if (start.type !== "run_started") throw new Error("invalid fixture");
    const { consentVersion: _consentVersion, appBuildId: _appBuildId, ...eventBase } = start;
    const handoff: StudyEvent = {
      ...eventBase,
      eventId: "run-1:000001",
      sequence: 1,
      monotonicMs: 500,
      type: "handoff_completed",
      fromId: "resident-a",
      toId: "resident-a",
      input: "drag",
    };
    const exported = createStudyExport([start, handoff], "2026-07-21T01:00:00.000Z");
    expect(() => verifyStudyExport(exported)).toThrow("交接前後居民不可相同");
  });
});
