import {
  STUDY_CONSENT_VERSION,
  STUDY_SCHEMA_VERSION,
  type StudyEvent,
  type StudyFollowInput,
  type StudyVisitOrdinal,
} from "./study";
import type { StudyEventStore } from "./studyStorage";

export type StudyRunConfig = {
  participantCode: string;
  visitOrdinal: StudyVisitOrdinal;
  appBuildId: string;
  onStorageFailure?: () => void;
  onRunCompleted?: () => void;
};

type RecorderDependencies = {
  monotonicNow: () => number;
  occurredAt: () => string;
  createId: () => string;
};

const browserDependencies: RecorderDependencies = {
  monotonicNow: () => performance.now(),
  occurredAt: () => new Date().toISOString(),
  createId: () => crypto.randomUUID(),
};

export class StudyRecorder {
  private pending: Promise<void> = Promise.resolve();
  private ended = false;
  private failed = false;

  private constructor(
    private readonly store: StudyEventStore,
    private readonly config: StudyRunConfig,
    private readonly attemptOrdinal: number,
    private readonly runId: string,
    private readonly monotonicOrigin: number,
    private readonly monotonicBaseMs: number,
    private sequence: number,
    private readonly dependencies: RecorderDependencies,
  ) {}

  static async start(
    store: StudyEventStore,
    config: StudyRunConfig,
    dependencies: RecorderDependencies = browserDependencies,
  ): Promise<StudyRecorder> {
    const attemptOrdinal = 1;
    const runId = dependencies.createId();
    const monotonicOrigin = dependencies.monotonicNow();
    const startEvent: Extract<StudyEvent, { type: "run_started" }> = {
      schemaVersion: STUDY_SCHEMA_VERSION,
      eventId: `${runId}:000000`,
      participantCode: config.participantCode,
      visitOrdinal: config.visitOrdinal,
      attemptOrdinal,
      runId,
      sequence: 0,
      monotonicMs: 0,
      occurredAt: dependencies.occurredAt(),
      sceneSecond: 0,
      type: "run_started",
      consentVersion: STUDY_CONSENT_VERSION,
      appBuildId: config.appBuildId,
    };
    const created = await store.beginUniqueRun(startEvent);
    if (created) {
      return new StudyRecorder(
        store,
        config,
        attemptOrdinal,
        runId,
        monotonicOrigin,
        0,
        1,
        dependencies,
      );
    }

    const existing = (await store.readRun(
      config.participantCode,
      config.visitOrdinal,
      config.appBuildId,
    )).sort((left, right) => left.sequence - right.sequence);
    const first = existing[0];
    const last = existing.at(-1);
    if (!first || first.type !== "run_started" || !last) {
      throw new Error("Existing study run could not be resumed");
    }
    if (
      existing.some(
        (event) =>
          event.type === "run_ended" &&
          (event.reason === "cycle_completed" || event.reason === "participant_ended"),
      )
    ) {
      throw new StudyRunAlreadyCompletedError();
    }

    const recorder = new StudyRecorder(
      store,
      config,
      first.attemptOrdinal,
      first.runId,
      monotonicOrigin,
      last.monotonicMs + 1,
      last.sequence + 1,
      dependencies,
    );
    recorder.sample(last.sceneSecond, {
      visible: false,
      playing: false,
      focusedResidentId: null,
    });
    await recorder.flush();
    return recorder;
  }

  private header(sequence: number, sceneSecond: number) {
    return {
      schemaVersion: STUDY_SCHEMA_VERSION,
      eventId: `${this.runId}:${sequence.toString().padStart(6, "0")}`,
      participantCode: this.config.participantCode,
      visitOrdinal: this.config.visitOrdinal,
      attemptOrdinal: this.attemptOrdinal,
      runId: this.runId,
      sequence,
      monotonicMs: Math.max(
        0,
        this.monotonicBaseMs +
          Math.round(this.dependencies.monotonicNow() - this.monotonicOrigin),
      ),
      occurredAt: this.dependencies.occurredAt(),
      sceneSecond: Math.min(599, Math.max(0, Math.floor(sceneSecond))),
    } as const;
  }

  private record(event: StudyEvent) {
    if (this.ended || this.failed) return;
    this.pending = this.pending
      .then(() => this.store.append(event))
      .catch(() => {
        this.failed = true;
        this.config.onStorageFailure?.();
      });
  }

  sample(
    sceneSecond: number,
    state: { visible: boolean; playing: boolean; focusedResidentId: string | null },
  ) {
    const sequence = this.sequence;
    this.sequence += 1;
    this.record({
      ...this.header(sequence, sceneSecond),
      type: "watch_sample",
      ...state,
    });
  }

  followStarted(sceneSecond: number, residentId: string, input: StudyFollowInput) {
    const sequence = this.sequence;
    this.sequence += 1;
    this.record({
      ...this.header(sequence, sceneSecond),
      type: "follow_started",
      residentId,
      input,
    });
    if (this.config.visitOrdinal === 2 && (input === "hold" || input === "tap")) {
      this.end(sceneSecond, "participant_ended");
    }
  }

  handoffCompleted(sceneSecond: number, fromId: string, toId: string) {
    const sequence = this.sequence;
    this.sequence += 1;
    this.record({
      ...this.header(sequence, sceneSecond),
      type: "handoff_completed",
      fromId,
      toId,
      input: "drag",
    });
  }

  completeCycle(
    sceneSecond: number,
    state: { visible: boolean; playing: boolean; focusedResidentId: string | null },
  ) {
    this.sample(sceneSecond, state);
    this.end(sceneSecond, "cycle_completed");
  }

  private end(sceneSecond: number, reason: Extract<StudyEvent, { type: "run_ended" }>["reason"]) {
    if (this.ended) return;
    const sequence = this.sequence;
    this.sequence += 1;
    this.record({
      ...this.header(sequence, sceneSecond),
      type: "run_ended",
      reason,
    });
    this.ended = true;
    void this.flush().then(() => {
      if (!this.failed) this.config.onRunCompleted?.();
    });
  }

  flush(): Promise<void> {
    return this.pending;
  }
}

export class StudyRunAlreadyCompletedError extends Error {
  constructor() {
    super("Study run already completed");
    this.name = "StudyRunAlreadyCompletedError";
  }
}
