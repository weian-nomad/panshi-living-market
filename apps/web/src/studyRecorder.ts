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
  private sequence = 1;
  private pending: Promise<void> = Promise.resolve();
  private ended = false;
  private failed = false;

  private constructor(
    private readonly store: StudyEventStore,
    private readonly config: StudyRunConfig,
    private readonly attemptOrdinal: number,
    private readonly runId: string,
    private readonly monotonicOrigin: number,
    private readonly dependencies: RecorderDependencies,
  ) {}

  static async start(
    store: StudyEventStore,
    config: StudyRunConfig,
    dependencies: RecorderDependencies = browserDependencies,
  ): Promise<StudyRecorder> {
    const attemptOrdinal = await store.allocateAttempt(config.participantCode, config.visitOrdinal);
    const runId = dependencies.createId();
    const monotonicOrigin = dependencies.monotonicNow();
    const recorder = new StudyRecorder(
      store,
      config,
      attemptOrdinal,
      runId,
      monotonicOrigin,
      dependencies,
    );

    await store.append({
      ...recorder.header(0, 0),
      type: "run_started",
      consentVersion: STUDY_CONSENT_VERSION,
      appBuildId: config.appBuildId,
    });
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

  end(sceneSecond: number, reason: Extract<StudyEvent, { type: "run_ended" }>['reason']) {
    if (this.ended) return;
    const sequence = this.sequence;
    this.sequence += 1;
    this.record({
      ...this.header(sequence, sceneSecond),
      type: "run_ended",
      reason,
    });
    this.ended = true;
  }

  flush(): Promise<void> {
    return this.pending;
  }
}
