import { describe, expect, it } from "vitest";

import type { StudyEvent, StudyVisitOrdinal } from "./study";
import { StudyRecorder } from "./studyRecorder";
import type { StudyEventStore } from "./studyStorage";

class MemoryStudyStore implements StudyEventStore {
  readonly events: StudyEvent[] = [];
  private readonly attempts = new Map<string, number>();
  failAfter = Number.POSITIVE_INFINITY;

  async append(event: StudyEvent): Promise<void> {
    if (this.events.length >= this.failAfter) throw new Error("storage failed");
    this.events.push(event);
  }

  async readAll() {
    return [...this.events];
  }

  async clearAll() {
    this.events.length = 0;
    this.attempts.clear();
  }

  async hasConsent() {
    return true;
  }

  async recordConsent() {}

  async allocateAttempt(participantCode: string, visitOrdinal: StudyVisitOrdinal) {
    const key = `${participantCode}/${visitOrdinal}`;
    const next = (this.attempts.get(key) ?? 0) + 1;
    this.attempts.set(key, next);
    return next;
  }
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
});
