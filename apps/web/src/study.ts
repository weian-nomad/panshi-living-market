import { STUDY_ORIGIN } from "./studyRelease.ts";

export const STUDY_SCHEMA_VERSION = 1 as const;
export const STUDY_CONSENT_VERSION = "2026-07-20.v1";
export const STUDY_EVALUATOR_REVISION = "v4-study-3" as const;
export const STUDY_SAMPLE_INTERVAL_MS = 1_000;
export const STUDY_MAX_SAMPLE_GAP_MS = 1_750;
export const STUDY_MIN_FULL_CYCLE_MS = 598_000;
export const STUDY_TIME_ZONE = "Asia/Taipei";

export type StudyVisitOrdinal = 1 | 2;
export type StudyFollowInput = "hold" | "tap" | "control";

type StudyEventBase = {
  schemaVersion: typeof STUDY_SCHEMA_VERSION;
  eventId: string;
  participantCode: string;
  visitOrdinal: StudyVisitOrdinal;
  attemptOrdinal: number;
  runId: string;
  sequence: number;
  monotonicMs: number;
  occurredAt: string;
  sceneSecond: number;
};

export type StudyRunStarted = StudyEventBase & {
  type: "run_started";
  consentVersion: string;
  appBuildId: string;
};

export type StudyWatchSample = StudyEventBase & {
  type: "watch_sample";
  visible: boolean;
  playing: boolean;
  focusedResidentId: string | null;
};

export type StudyFollowStarted = StudyEventBase & {
  type: "follow_started";
  residentId: string;
  input: StudyFollowInput;
};

export type StudyHandoffCompleted = StudyEventBase & {
  type: "handoff_completed";
  fromId: string;
  toId: string;
  input: "drag";
};

export type StudyRunEnded = StudyEventBase & {
  type: "run_ended";
  reason: "cycle_completed" | "participant_ended";
};

export type StudyEvent =
  | StudyRunStarted
  | StudyWatchSample
  | StudyFollowStarted
  | StudyHandoffCompleted
  | StudyRunEnded;

export type StudyParticipantResult = {
  participantCode: string;
  completedHoldAndDrag: boolean;
  completedFullForegroundCycle: boolean;
  dayOneTopResidentId: string | null;
  dayTwoFirstResidentId: string | null;
  dayTwoDateStatus: "not_returned" | "next_day" | "wrong_day";
  returnedToTopResident: boolean;
  invalidRunIds: readonly string[];
};

export type StudyCohortResult = {
  participantCount: number;
  holdAndDragCount: number;
  fullForegroundCycleCount: number;
  returnedToTopResidentCount: number;
  invalidVisitDayCount: number;
  invalidRunCount: number;
  duplicateVisitCount: number;
  appBuildIds: readonly string[];
  consentVersions: readonly string[];
  readyForDecision: boolean;
  passed: boolean;
  participants: readonly StudyParticipantResult[];
};

export type StudyExport = {
  exportSchemaVersion: 1;
  studySchemaVersion: typeof STUDY_SCHEMA_VERSION;
  evaluatorRevision: typeof STUDY_EVALUATOR_REVISION;
  studyOrigin: typeof STUDY_ORIGIN;
  exportedAt: string;
  thresholds: {
    participantCount: 24;
    holdAndDragCount: 20;
    fullForegroundCycleCount: 10;
    returnedToTopResidentCount: 6;
  };
  result: StudyCohortResult;
  events: readonly StudyEvent[];
};

export function normalizeParticipantCode(value: string): string | null {
  const normalized = value.trim().toUpperCase();
  return /^P(?:0[1-9]|1[0-9]|2[0-4])$/.test(normalized) ? normalized : null;
}

function compareEvents(left: StudyEvent, right: StudyEvent): number {
  return (
    left.visitOrdinal - right.visitOrdinal ||
    left.attemptOrdinal - right.attemptOrdinal ||
    left.sequence - right.sequence ||
    left.eventId.localeCompare(right.eventId)
  );
}

function partitionRuns(events: readonly StudyEvent[]): Map<string, StudyEvent[]> {
  const runs = new Map<string, StudyEvent[]>();
  for (const event of events) {
    const run = runs.get(event.runId) ?? [];
    run.push(event);
    runs.set(event.runId, run);
  }
  return runs;
}

function isValidRun(events: readonly StudyEvent[]): boolean {
  const ordered = [...events].sort((left, right) => left.sequence - right.sequence);
  const first = ordered[0];
  if (
    !first ||
    first.type !== "run_started" ||
    first.sequence !== 0 ||
    normalizeParticipantCode(first.participantCode) !== first.participantCode ||
    first.attemptOrdinal !== 1 ||
    first.runId.length < 1 ||
    first.monotonicMs !== 0 ||
    !Number.isFinite(Date.parse(first.occurredAt)) ||
    first.consentVersion.trim().length < 1 ||
    first.appBuildId.trim().length < 1
  ) {
    return false;
  }

  const eventIds = new Set<string>();
  let priorMonotonicMs = -1;

  return ordered.every((event, index) => {
    if (
      event.schemaVersion !== STUDY_SCHEMA_VERSION ||
      event.runId !== first.runId ||
      event.participantCode !== first.participantCode ||
      event.visitOrdinal !== first.visitOrdinal ||
      event.attemptOrdinal !== first.attemptOrdinal ||
      event.sequence !== index ||
      event.eventId !== `${first.runId}:${index.toString().padStart(6, "0")}` ||
      !Number.isFinite(event.monotonicMs) ||
      event.monotonicMs < 0 ||
      event.monotonicMs < priorMonotonicMs ||
      !Number.isFinite(Date.parse(event.occurredAt)) ||
      !Number.isInteger(event.sceneSecond) ||
      event.sceneSecond < 0 ||
      event.sceneSecond > 599 ||
      eventIds.has(event.eventId)
    ) {
      return false;
    }
    if (
      event.type === "run_ended" &&
      (index !== ordered.length - 1 ||
        (event.visitOrdinal === 1 && event.reason !== "cycle_completed") ||
        (event.visitOrdinal === 2 && event.reason !== "participant_ended"))
    ) {
      return false;
    }

    eventIds.add(event.eventId);
    priorMonotonicMs = event.monotonicMs;
    return true;
  });
}

function isContinuousSamplePair(previous: StudyWatchSample, current: StudyWatchSample): boolean {
  const gap = current.monotonicMs - previous.monotonicMs;
  return (
    previous.visible &&
    previous.playing &&
    current.visible &&
    current.playing &&
    gap > 0 &&
    gap <= STUDY_MAX_SAMPLE_GAP_MS
  );
}

function runCompletesForegroundCycle(events: readonly StudyEvent[]): boolean {
  const samples = events
    .filter((event): event is StudyWatchSample => event.type === "watch_sample")
    .sort((left, right) => left.sequence - right.sequence);

  let chainStartedNearOpen = false;
  let chainDurationMs = 0;

  for (let index = 0; index < samples.length; index += 1) {
    const current = samples[index];
    if (!current) continue;

    if (index === 0 || !samples[index - 1] || !isContinuousSamplePair(samples[index - 1]!, current)) {
      chainStartedNearOpen = current.visible && current.playing && current.sceneSecond <= 1;
      chainDurationMs = 0;
      continue;
    }

    const previous = samples[index - 1]!;
    const gap = current.monotonicMs - previous.monotonicMs;
    const wrapped = current.sceneSecond < previous.sceneSecond;

    chainDurationMs += gap;
    if (wrapped) {
      if (chainStartedNearOpen && chainDurationMs >= STUDY_MIN_FULL_CYCLE_MS) return true;
      chainStartedNearOpen = current.sceneSecond <= 1;
      chainDurationMs = 0;
    }
  }

  return false;
}

function accumulateFocusedTime(events: readonly StudyEvent[], totals: Map<string, number>) {
  const samples = events
    .filter((event): event is StudyWatchSample => event.type === "watch_sample")
    .sort((left, right) => left.sequence - right.sequence);

  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    if (
      !previous ||
      !current ||
      !isContinuousSamplePair(previous, current) ||
      !previous.focusedResidentId ||
      previous.focusedResidentId !== current.focusedResidentId
    ) {
      continue;
    }

    const gap = current.monotonicMs - previous.monotonicMs;
    totals.set(
      previous.focusedResidentId,
      (totals.get(previous.focusedResidentId) ?? 0) + gap,
    );
  }
}

function chooseUniqueTopResident(totals: ReadonlyMap<string, number>): string | null {
  const ordered = [...totals.entries()].sort(
    ([leftId, leftDuration], [rightId, rightDuration]) =>
      rightDuration - leftDuration || leftId.localeCompare(rightId),
  );
  const first = ordered[0];
  if (!first || first[1] <= 0) return null;
  if (ordered[1]?.[1] === first[1]) return null;
  return first[0];
}

function datePartsInTimeZone(occurredAt: string, timeZone: string) {
  const date = new Date(occurredAt);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const year = Number(values.year);
  const month = Number(values.month);
  const day = Number(values.day);
  return Number.isInteger(year) && Number.isInteger(month) && Number.isInteger(day)
    ? { year, month, day }
    : null;
}

export function isNextCalendarDay(
  firstOccurredAt: string,
  secondOccurredAt: string,
  timeZone = STUDY_TIME_ZONE,
): boolean {
  const first = datePartsInTimeZone(firstOccurredAt, timeZone);
  const second = datePartsInTimeZone(secondOccurredAt, timeZone);
  if (!first || !second) return false;
  const expected = new Date(Date.UTC(first.year, first.month - 1, first.day + 1));
  return (
    second.year === expected.getUTCFullYear() &&
    second.month === expected.getUTCMonth() + 1 &&
    second.day === expected.getUTCDate()
  );
}

export function evaluateParticipant(events: readonly StudyEvent[]): StudyParticipantResult {
  const participantCode = events[0]?.participantCode ?? "";
  const participantEvents = events.filter((event) => event.participantCode === participantCode);
  const runPartitions = partitionRuns(participantEvents);
  const validRuns: StudyEvent[][] = [];
  const invalidRunIds: string[] = [];

  for (const [runId, runEvents] of runPartitions) {
    if (isValidRun(runEvents)) validRuns.push([...runEvents].sort(compareEvents));
    else invalidRunIds.push(runId);
  }

  validRuns.sort((left, right) => compareEvents(left[0]!, right[0]!));
  const dayOneRuns = validRuns.filter((run) => run[0]?.visitOrdinal === 1).slice(0, 1);
  const dayTwoRuns = validRuns.filter((run) => run[0]?.visitOrdinal === 2).slice(0, 1);

  const completedHoldAndDrag = dayOneRuns.some((run) => {
    let activeHold = false;
    for (const event of run) {
      if (
        (event.type === "watch_sample" && (!event.visible || !event.playing)) ||
        event.type === "run_ended"
      ) {
        activeHold = false;
      } else if (event.type === "follow_started" && event.input === "hold") {
        activeHold = true;
      } else if (event.type === "handoff_completed" && activeHold) {
        return true;
      }
    }
    return false;
  });

  const completedFullForegroundCycle = dayOneRuns.some(runCompletesForegroundCycle);
  const focusTotals = new Map<string, number>();
  for (const run of dayOneRuns) accumulateFocusedTime(run, focusTotals);
  const dayOneTopResidentId = chooseUniqueTopResident(focusTotals);

  const dayTwoFirstResidentId = dayTwoRuns
    .flat()
    .sort(compareEvents)
    .find(
      (event): event is StudyFollowStarted =>
        event.type === "follow_started" && (event.input === "hold" || event.input === "tap"),
    )?.residentId ?? null;
  const dayOneStart = dayOneRuns[0]?.find(
    (event): event is StudyRunStarted => event.type === "run_started",
  );
  const dayTwoStart = dayTwoRuns[0]?.find(
    (event): event is StudyRunStarted => event.type === "run_started",
  );
  const dayTwoDateStatus = !dayTwoStart
    ? "not_returned"
    : dayOneStart && isNextCalendarDay(dayOneStart.occurredAt, dayTwoStart.occurredAt)
      ? "next_day"
      : "wrong_day";

  return {
    participantCode,
    completedHoldAndDrag,
    completedFullForegroundCycle,
    dayOneTopResidentId,
    dayTwoFirstResidentId,
    dayTwoDateStatus,
    returnedToTopResident:
      dayTwoDateStatus === "next_day" &&
      dayOneTopResidentId !== null &&
      dayTwoFirstResidentId === dayOneTopResidentId,
    invalidRunIds: invalidRunIds.sort(),
  };
}

export function evaluateCohort(events: readonly StudyEvent[]): StudyCohortResult {
  const participantCodes = [...new Set(events.map((event) => event.participantCode))]
    .filter((participantCode) => {
      const participantRuns = partitionRuns(
        events.filter((event) => event.participantCode === participantCode),
      );
      return [...participantRuns.values()].some(isValidRun);
    })
    .sort();
  const participants = participantCodes.map((participantCode) =>
    evaluateParticipant(events.filter((event) => event.participantCode === participantCode)),
  );
  const holdAndDragCount = participants.filter((result) => result.completedHoldAndDrag).length;
  const fullForegroundCycleCount = participants.filter(
    (result) => result.completedFullForegroundCycle,
  ).length;
  const returnedToTopResidentCount = participants.filter(
    (result) => result.returnedToTopResident,
  ).length;
  const invalidVisitDayCount = participants.filter(
    (result) => result.dayTwoDateStatus === "wrong_day",
  ).length;
  const allRuns = [...partitionRuns(events).values()];
  const validRuns = allRuns.filter(isValidRun);
  const invalidRunCount = allRuns.length - validRuns.length;
  const validRunStarts = validRuns
    .map((run) => [...run].sort((left, right) => left.sequence - right.sequence)[0])
    .filter((event): event is StudyRunStarted => event?.type === "run_started");
  const appBuildIds = [...new Set(validRunStarts.map((event) => event.appBuildId))].sort();
  const consentVersions = [
    ...new Set(validRunStarts.map((event) => event.consentVersion)),
  ].sort();
  const visitCounts = new Map<string, number>();
  for (const event of validRunStarts) {
    const key = `${event.appBuildId}\u0000${event.participantCode}\u0000${event.visitOrdinal}`;
    visitCounts.set(key, (visitCounts.get(key) ?? 0) + 1);
  }
  const duplicateVisitCount = [...visitCounts.values()].reduce(
    (count, occurrences) => count + Math.max(0, occurrences - 1),
    0,
  );
  const readyForDecision =
    participants.length === 24 &&
    invalidVisitDayCount === 0 &&
    invalidRunCount === 0 &&
    duplicateVisitCount === 0 &&
    appBuildIds.length === 1 &&
    consentVersions.length === 1;

  return {
    participantCount: participants.length,
    holdAndDragCount,
    fullForegroundCycleCount,
    returnedToTopResidentCount,
    invalidVisitDayCount,
    invalidRunCount,
    duplicateVisitCount,
    appBuildIds,
    consentVersions,
    readyForDecision,
    passed:
      readyForDecision &&
      holdAndDragCount >= 20 &&
      fullForegroundCycleCount >= 10 &&
      returnedToTopResidentCount >= 6,
    participants,
  };
}

export function createStudyExport(events: readonly StudyEvent[], exportedAt: string): StudyExport {
  return {
    exportSchemaVersion: 1,
    studySchemaVersion: STUDY_SCHEMA_VERSION,
    evaluatorRevision: STUDY_EVALUATOR_REVISION,
    studyOrigin: STUDY_ORIGIN,
    exportedAt,
    thresholds: {
      participantCount: 24,
      holdAndDragCount: 20,
      fullForegroundCycleCount: 10,
      returnedToTopResidentCount: 6,
    },
    result: evaluateCohort(events),
    events,
  };
}
