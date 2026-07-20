import { describe, expect, it } from "vitest";

import {
  createStudyExport,
  evaluateCohort,
  evaluateParticipant,
  isNextCalendarDay,
  normalizeParticipantCode,
  STUDY_CONSENT_VERSION,
  STUDY_SCHEMA_VERSION,
  type StudyEvent,
  type StudyFollowInput,
  type StudyVisitOrdinal,
} from "./study";

type EventHeaderKey =
  | "schemaVersion"
  | "eventId"
  | "participantCode"
  | "visitOrdinal"
  | "attemptOrdinal"
  | "runId"
  | "sequence"
  | "occurredAt";

type EventInput = StudyEvent extends infer Event
  ? Event extends StudyEvent
    ? Omit<Event, EventHeaderKey>
    : never
  : never;

function makeRun(
  inputs: readonly EventInput[],
  options: {
    participantCode?: string;
    visitOrdinal?: StudyVisitOrdinal;
    attemptOrdinal?: number;
    runId?: string;
    occurredAt?: string;
  } = {},
): StudyEvent[] {
  const participantCode = options.participantCode ?? "P01";
  const visitOrdinal = options.visitOrdinal ?? 1;
  const attemptOrdinal = options.attemptOrdinal ?? 1;
  const runId = options.runId ?? `${participantCode}-${visitOrdinal}-${attemptOrdinal}`;
  const occurredAt = options.occurredAt ?? "2026-07-20T00:00:00.000Z";

  const start: StudyEvent = {
    schemaVersion: STUDY_SCHEMA_VERSION,
    eventId: `${runId}:000000`,
    participantCode,
    visitOrdinal,
    attemptOrdinal,
    runId,
    sequence: 0,
    monotonicMs: 0,
    occurredAt,
    sceneSecond: 0,
    type: "run_started",
    consentVersion: STUDY_CONSENT_VERSION,
    appBuildId: "test",
  };

  return [
    start,
    ...inputs.map((input, index) => ({
      ...input,
      schemaVersion: STUDY_SCHEMA_VERSION,
      eventId: `${runId}:${(index + 1).toString().padStart(6, "0")}`,
      participantCode,
      visitOrdinal,
      attemptOrdinal,
      runId,
      sequence: index + 1,
      occurredAt,
    }) as StudyEvent),
  ];
}

function follow(monotonicMs: number, residentId: string, input: StudyFollowInput = "hold"): EventInput {
  return { type: "follow_started", monotonicMs, sceneSecond: 1, residentId, input };
}

function handoff(monotonicMs: number, fromId: string, toId: string): EventInput {
  return { type: "handoff_completed", monotonicMs, sceneSecond: 2, fromId, toId, input: "drag" };
}

function sample(
  monotonicMs: number,
  sceneSecond: number,
  options: { visible?: boolean; playing?: boolean; focusedResidentId?: string | null } = {},
): EventInput {
  return {
    type: "watch_sample",
    monotonicMs,
    sceneSecond,
    visible: options.visible ?? true,
    playing: options.playing ?? true,
    focusedResidentId: options.focusedResidentId ?? null,
  };
}

function fullCycleSamples(focusId = "resident-a"): EventInput[] {
  return Array.from({ length: 601 }, (_, index) =>
    sample(index * 1_000, index === 600 ? 0 : index, { focusedResidentId: focusId }),
  );
}

function fullCycleWithDuration(durationMs: number, startSceneSecond = 0): EventInput[] {
  return Array.from({ length: 601 }, (_, index) =>
    sample(
      Math.floor((index * durationMs) / 600),
      index === 600 ? 0 : (startSceneSecond + index) % 600,
      { focusedResidentId: "resident-a" },
    ),
  );
}

describe("study evaluator", () => {
  it("normalizes only short anonymous participant codes", () => {
    expect(normalizeParticipantCode(" p-01 ")).toBe("P-01");
    expect(normalizeParticipantCode("x")).toBeNull();
    expect(normalizeParticipantCode("姓名 01")).toBeNull();
  });

  it("requires a hold before a drag handoff", () => {
    expect(evaluateParticipant(makeRun([follow(100, "a"), handoff(500, "a", "b")])).completedHoldAndDrag).toBe(true);
    expect(evaluateParticipant(makeRun([follow(100, "a", "tap"), handoff(500, "a", "b")])).completedHoldAndDrag).toBe(false);
  });

  it("accepts one uninterrupted visible and playing ten-minute cycle", () => {
    expect(evaluateParticipant(makeRun(fullCycleSamples())).completedFullForegroundCycle).toBe(true);
  });

  it("rejects a hidden interval even when the scene later wraps", () => {
    const samples = fullCycleSamples();
    samples[300] = sample(300_000, 300, { visible: false, focusedResidentId: "resident-a" });
    expect(evaluateParticipant(makeRun(samples)).completedFullForegroundCycle).toBe(false);
  });

  it("rejects a paused interval even when the scene later wraps", () => {
    const samples = fullCycleSamples();
    samples[300] = sample(300_000, 300, { playing: false, focusedResidentId: "resident-a" });
    expect(evaluateParticipant(makeRun(samples)).completedFullForegroundCycle).toBe(false);
  });

  it("rejects a sub-second hidden interruption between regular ticks", () => {
    const samples = fullCycleSamples();
    samples.splice(
      251,
      0,
      sample(250_400, 250, { visible: false, focusedResidentId: "resident-a" }),
      sample(250_700, 250, { focusedResidentId: "resident-a" }),
    );
    expect(evaluateParticipant(makeRun(samples)).completedFullForegroundCycle).toBe(false);
  });

  it("rejects a suspended timer gap", () => {
    const samples = fullCycleSamples();
    for (let index = 301; index < samples.length; index += 1) {
      const event = samples[index];
      if (event) samples[index] = { ...event, monotonicMs: event.monotonicMs + 10_000 };
    }
    expect(evaluateParticipant(makeRun(samples)).completedFullForegroundCycle).toBe(false);
  });

  it("uses accumulated day-one focus and immutable earliest day-two selection", () => {
    const dayOne = makeRun([
      sample(1_000, 1, { focusedResidentId: "a" }),
      sample(2_000, 2, { focusedResidentId: "a" }),
      sample(3_000, 3, { focusedResidentId: "b" }),
      sample(5_000, 5, { focusedResidentId: "b" }),
    ]);
    const dayTwoFirst = makeRun([follow(100, "b", "tap")], { visitOrdinal: 2, attemptOrdinal: 1, runId: "d2-first", occurredAt: "2026-07-21T00:00:00.000Z" });
    const dayTwoRetry = makeRun([follow(100, "a")], { visitOrdinal: 2, attemptOrdinal: 2, runId: "d2-retry", occurredAt: "2026-07-21T01:00:00.000Z" });
    const result = evaluateParticipant([...dayOne, ...dayTwoRetry, ...dayTwoFirst]);

    expect(result.dayOneTopResidentId).toBe("a");
    expect(result.dayTwoFirstResidentId).toBe("b");
    expect(result.returnedToTopResident).toBe(false);
  });

  it("ignores bottom-control focus when choosing the first day-two resident", () => {
    const dayOne = makeRun([
      sample(1_000, 1, { focusedResidentId: "a" }),
      sample(2_000, 2, { focusedResidentId: "a" }),
    ]);
    const dayTwo = makeRun(
      [follow(100, "b", "control"), follow(200, "a", "tap")],
      { visitOrdinal: 2, runId: "d2-controls", occurredAt: "2026-07-21T00:00:00.000Z" },
    );
    expect(evaluateParticipant([...dayOne, ...dayTwo]).dayTwoFirstResidentId).toBe("a");
  });

  it("does not invent a top resident when focused time is tied", () => {
    const events = makeRun([
      sample(1_000, 1, { focusedResidentId: "a" }),
      sample(2_000, 2, { focusedResidentId: "a" }),
      sample(3_000, 3, { focusedResidentId: "b" }),
      sample(4_000, 4, { focusedResidentId: "b" }),
    ]);
    expect(evaluateParticipant(events).dayOneTopResidentId).toBeNull();
  });

  it("uses the fixed study timezone for next-day validation, including DST zones", () => {
    expect(isNextCalendarDay("2026-07-20T15:59:59.000Z", "2026-07-20T16:00:01.000Z")).toBe(true);
    expect(isNextCalendarDay("2026-07-20T01:00:00.000Z", "2026-07-20T12:00:00.000Z")).toBe(false);
    expect(
      isNextCalendarDay(
        "2026-03-08T04:30:00.000Z",
        "2026-03-08T05:30:00.000Z",
        "America/New_York",
      ),
    ).toBe(true);
  });

  it("rejects same-day visit two and accepts only the next Taipei calendar day", () => {
    const dayOne = makeRun([
      sample(1_000, 1, { focusedResidentId: "a" }),
      sample(2_000, 2, { focusedResidentId: "a" }),
    ]);
    const sameDay = makeRun([follow(100, "a", "tap")], {
      visitOrdinal: 2,
      runId: "same-day",
      occurredAt: "2026-07-20T08:00:00.000Z",
    });
    const nextDay = makeRun([follow(100, "a", "tap")], {
      visitOrdinal: 2,
      runId: "next-day",
      occurredAt: "2026-07-21T00:00:00.000Z",
    });

    expect(evaluateParticipant([...dayOne, ...sameDay]).dayTwoDateStatus).toBe("wrong_day");
    expect(evaluateParticipant([...dayOne, ...sameDay]).returnedToTopResident).toBe(false);
    expect(evaluateParticipant([...dayOne, ...nextDay]).dayTwoDateStatus).toBe("next_day");
    expect(evaluateParticipant([...dayOne, ...nextDay]).returnedToTopResident).toBe(true);
  });

  it("keeps the full-cycle boundary at exactly 598000 monotonic milliseconds", () => {
    expect(evaluateParticipant(makeRun(fullCycleWithDuration(597_999))).completedFullForegroundCycle).toBe(false);
    expect(evaluateParticipant(makeRun(fullCycleWithDuration(598_000))).completedFullForegroundCycle).toBe(true);
    expect(evaluateParticipant(makeRun(fullCycleWithDuration(598_000, 2))).completedFullForegroundCycle).toBe(false);
  });

  it("quarantines a run with a reversed monotonic clock", () => {
    const events = makeRun([follow(500, "a"), handoff(400, "a", "b")]);
    const result = evaluateParticipant(events);
    expect(result.completedHoldAndDrag).toBe(false);
    expect(result.invalidRunIds).toEqual(["P01-1-1"]);
  });

  it("quarantines a run with a missing append-only sequence", () => {
    const events = makeRun([follow(100, "a"), handoff(500, "a", "b")]);
    const second = events[2];
    if (!second) throw new Error("missing fixture event");
    events[2] = { ...second, sequence: 3, eventId: `${second.runId}:000003` };
    const result = evaluateParticipant(events);
    expect(result.completedHoldAndDrag).toBe(false);
    expect(result.invalidRunIds).toEqual(["P01-1-1"]);
  });

  it("does not pass a cohort before all 24 participants exist", () => {
    const events = makeRun([follow(100, "a"), handoff(500, "a", "b")]);
    const result = evaluateCohort(events);
    expect(result.readyForDecision).toBe(false);
    expect(result.passed).toBe(false);
  });

  it("does not issue a verdict after the fixed cohort grows past 24 people", () => {
    const events = Array.from({ length: 25 }, (_, index) =>
      makeRun([follow(100, "a")], { participantCode: `P${String(index + 1).padStart(2, "0")}` }),
    ).flat();
    const result = evaluateCohort(events);
    expect(result.participantCount).toBe(25);
    expect(result.readyForDecision).toBe(false);
    expect(result.passed).toBe(false);
  });

  it("withholds the cohort verdict when any recorded visit two is on the wrong day", () => {
    const events = Array.from({ length: 24 }, (_, index) => {
      const participantCode = `P${String(index + 1).padStart(2, "0")}`;
      const dayOne = makeRun([follow(100, "a")], { participantCode });
      if (index !== 0) return dayOne;
      return [
        ...dayOne,
        ...makeRun([follow(100, "a", "tap")], {
          participantCode,
          visitOrdinal: 2,
          runId: `${participantCode}-same-day`,
          occurredAt: "2026-07-20T08:00:00.000Z",
        }),
      ];
    }).flat();

    const result = evaluateCohort(events);
    expect(result.participantCount).toBe(24);
    expect(result.invalidVisitDayCount).toBe(1);
    expect(result.readyForDecision).toBe(false);
    expect(result.passed).toBe(false);
  });

  it("does not count a participant whose only run is invalid", () => {
    const valid = makeRun([follow(100, "a")], { participantCode: "P01" });
    const invalid = makeRun([follow(100, "b")], { participantCode: "P02" });
    const event = invalid[1];
    if (!event) throw new Error("missing fixture event");
    invalid[1] = { ...event, sequence: 3, eventId: `${event.runId}:000003` };

    const result = evaluateCohort([...valid, ...invalid]);
    expect(result.participantCount).toBe(1);
    expect(result.participants.map((participant) => participant.participantCode)).toEqual(["P01"]);
  });

  it("still counts a participant who has one valid run beside a quarantined retry", () => {
    const valid = makeRun([follow(100, "a")], { participantCode: "P01", runId: "valid" });
    const invalid = makeRun([follow(100, "b")], {
      participantCode: "P01",
      attemptOrdinal: 2,
      runId: "invalid",
    });
    const event = invalid[1];
    if (!event) throw new Error("missing fixture event");
    invalid[1] = { ...event, monotonicMs: -1 };

    const result = evaluateCohort([...valid, ...invalid]);
    expect(result.participantCount).toBe(1);
    expect(result.participants[0]?.invalidRunIds).toEqual(["invalid"]);
  });

  it("exports the immutable thresholds beside the raw events and derived result", () => {
    const events = makeRun([follow(100, "a"), handoff(500, "a", "b")]);
    const exported = createStudyExport(events, "2026-07-20T12:00:00.000Z");
    expect(exported.exportedAt).toBe("2026-07-20T12:00:00.000Z");
    expect(exported.thresholds).toEqual({
      participantCount: 24,
      holdAndDragCount: 20,
      fullForegroundCycleCount: 10,
      returnedToTopResidentCount: 6,
    });
    expect(exported.events).toBe(events);
    expect(exported.result.participantCount).toBe(1);
  });

  it("passes only when all three fixed cohort counts are reached", () => {
    const events = Array.from({ length: 24 }, (_, index) => {
      const participantCode = `P${String(index + 1).padStart(2, "0")}`;
      const dayOneInputs: EventInput[] = [
        ...(index < 10
          ? fullCycleSamples("resident-a")
          : [
              sample(1_000, 1, { focusedResidentId: "resident-a" }),
              sample(2_000, 2, { focusedResidentId: "resident-a" }),
            ]),
        ...(index < 20
          ? [follow(601_000, "resident-a"), handoff(601_400, "resident-a", "resident-b")]
          : []),
      ];
      const dayOne = makeRun(dayOneInputs, { participantCode, runId: `${participantCode}-day-1` });
      const dayTwo = makeRun([follow(100, index < 6 ? "resident-a" : "resident-b", "tap")], {
        participantCode,
        visitOrdinal: 2,
        runId: `${participantCode}-day-2`,
        occurredAt: "2026-07-21T00:00:00.000Z",
      });
      return [...dayOne, ...dayTwo];
    }).flat();

    const result = evaluateCohort(events);
    expect(result).toMatchObject({
      participantCount: 24,
      holdAndDragCount: 20,
      fullForegroundCycleCount: 10,
      returnedToTopResidentCount: 6,
      invalidVisitDayCount: 0,
      readyForDecision: true,
      passed: true,
    });
  });
});
