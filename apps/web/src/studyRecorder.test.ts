import { describe, expect, it } from "vitest";

import type { StudyEvent, StudyRunStarted } from "./study";
import { StudyRecorder, StudyRunAlreadyCompletedError } from "./studyRecorder";
import type { StudyEventStore } from "./studyStorage";

class MemoryStudyStore implements StudyEventStore {
  readonly events: StudyEvent[] = [];
  private readonly runs = new Map<string, string>();
  failAfter = Number.POSITIVE_INFINITY;

  async append(event: StudyEvent): Promise<void> {
    if (this.events.length >= this.failAfter) throw new Error("storage failed");
    this.events.push(event);
  }

  async beginUniqueRun(event: StudyRunStarted) {
    const key = `${event.appBuildId}/${event.participantCode}/${event.visitOrdinal}`;
    if (this.runs.has(key)) return false;
    await this.append(event);
    this.runs.set(key, event.runId);
    return true;
  }

  async readRun(participantCode: string, visitOrdinal: StudyRunStarted["visitOrdinal"], appBuildId: string) {
    const runId = this.runs.get(`${appBuildId}/${participantCode}/${visitOrdinal}`);
    return runId ? this.events.filter((event) => event.runId === runId) : [];
  }

  async readAll() {
    return [...this.events];
  }

  async clearAll() {
    this.events.length = 0;
    this.runs.clear();
  }

  async hasConsent() {
    return true;
  }

  async recordConsent() {}

}

describe("StudyRecorder", () => {
  it("serializes an append-only run with monotonic sequence numbers", async () => {
    const store = new MemoryStudyStore();
    let clock = 1_000;
    const recorder = await StudyRecorder.start(
      store,
      { participantCode: "P01", visitOrdinal: 1, appBuildId: "test" },
      {
        monotonicNow: () => clock,
        occurredAt: () => "2026-07-20T00:00:00.000Z",
        createId: () => "run-1",
      },
    );

    clock = 2_000;
    recorder.sample(1, { visible: true, playing: true, focusedResidentId: null });
    clock = 2_200;
    recorder.followStarted(1, "resident-a", "hold");
    clock = 2_500;
    recorder.handoffCompleted(2, "resident-a", "resident-b");
    await recorder.flush();

    expect(store.events.map((event) => event.sequence)).toEqual([0, 1, 2, 3]);
    expect(store.events.map((event) => event.monotonicMs)).toEqual([0, 1_000, 1_200, 1_500]);
    expect(store.events.map((event) => event.eventId)).toEqual([
      "run-1:000000",
      "run-1:000001",
      "run-1:000002",
      "run-1:000003",
    ]);
  });

  it("stops the run and reports a durable-storage failure", async () => {
    const store = new MemoryStudyStore();
    store.failAfter = 1;
    let failed = false;
    const recorder = await StudyRecorder.start(
      store,
      {
        participantCode: "P01",
        visitOrdinal: 1,
        appBuildId: "test",
        onStorageFailure: () => {
          failed = true;
        },
      },
      {
        monotonicNow: () => 100,
        occurredAt: () => "2026-07-20T00:00:00.000Z",
        createId: () => "run-failure",
      },
    );

    recorder.sample(0, { visible: true, playing: true, focusedResidentId: null });
    await recorder.flush();
    recorder.followStarted(1, "resident-a", "hold");
    await recorder.flush();

    expect(failed).toBe(true);
    expect(store.events).toHaveLength(1);
  });

  it("resumes the same unique run and inserts an interruption boundary", async () => {
    const store = new MemoryStudyStore();
    let clock = 1_000;
    const dependencies = {
      monotonicNow: () => clock,
      occurredAt: () => "2026-07-20T00:00:00.000Z",
      createId: () => "run-1",
    };
    const first = await StudyRecorder.start(
      store,
      { participantCode: "P01", visitOrdinal: 1, appBuildId: "test" },
      dependencies,
    );
    clock = 2_000;
    first.sample(10, { visible: true, playing: true, focusedResidentId: "resident-a" });
    await first.flush();

    clock = 5_000;
    const resumed = await StudyRecorder.start(
      store,
      { participantCode: "P01", visitOrdinal: 1, appBuildId: "test" },
      { ...dependencies, createId: () => "must-not-create-run-2" },
    );
    await resumed.flush();

    expect(store.events.filter((event) => event.type === "run_started")).toHaveLength(1);
    expect(store.events.map((event) => event.runId)).toEqual(["run-1", "run-1", "run-1"]);
    expect(store.events.map((event) => event.sequence)).toEqual([0, 1, 2]);
    expect(store.events[2]).toMatchObject({ type: "watch_sample", visible: false, playing: false });
  });

  it("permanently locks a completed visit instead of creating another attempt", async () => {
    const store = new MemoryStudyStore();
    const dependencies = {
      monotonicNow: () => 1_000,
      occurredAt: () => "2026-07-20T00:00:00.000Z",
      createId: () => "run-1",
    };
    const recorder = await StudyRecorder.start(
      store,
      { participantCode: "P01", visitOrdinal: 1, appBuildId: "test" },
      dependencies,
    );
    recorder.completeCycle(0, { visible: true, playing: true, focusedResidentId: null });
    await recorder.flush();

    await expect(
      StudyRecorder.start(
        store,
        { participantCode: "P01", visitOrdinal: 1, appBuildId: "test" },
        dependencies,
      ),
    ).rejects.toBeInstanceOf(StudyRunAlreadyCompletedError);
  });

  it("seals visit two immediately after its first direct resident selection", async () => {
    const store = new MemoryStudyStore();
    let completed = false;
    const recorder = await StudyRecorder.start(
      store,
      {
        participantCode: "P01",
        visitOrdinal: 2,
        appBuildId: "test",
        onRunCompleted: () => {
          completed = true;
        },
      },
      {
        monotonicNow: () => 1_000,
        occurredAt: () => "2026-07-21T00:00:00.000Z",
        createId: () => "run-visit-2",
      },
    );
    recorder.followStarted(2, "resident-a", "tap");
    await recorder.flush();
    await Promise.resolve();

    expect(completed).toBe(true);
    expect(store.events.map((event) => event.type)).toEqual([
      "run_started",
      "follow_started",
      "run_ended",
    ]);
  });
});
