// 近景待機微動作排程：用假的計時器跑幾分鐘，檢查節奏、方向、互斥與停止。
// 參數直接讀 `contracts/character-art/v1` 的基準清單（陸硯之 rig v1）。

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { validateCharacterArtManifest, type IdleMotion } from "./characterArt";
import {
  blinkTotalMs,
  breathFollowDy,
  createIdleRigScheduler,
  mulberry32,
  thumbGazeHoldMs,
  type BlinkEvent,
  type GazeEvent,
  type RigTimers,
  type ThumbEvent,
} from "./rigMotion";

const BASE = JSON.parse(
  readFileSync(new URL("../../../../contracts/character-art/v1/fixtures/valid/luyanzhi-rig-v1.json", import.meta.url), "utf8"),
) as { characterId: string };

function baseMotion(): IdleMotion {
  const result = validateCharacterArtManifest(BASE, BASE.characterId);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result.manifest.closeUpRig.motion;
}

/** 依觸發時間執行的假計時器。 */
class FakeClock implements RigTimers {
  now = 0;
  private next = 1;
  private queue = new Map<number, { at: number; callback: () => void }>();

  setTimeout(callback: () => void, ms: number): number {
    const handle = this.next++;
    this.queue.set(handle, { at: this.now + ms, callback });
    return handle;
  }

  clearTimeout(handle: number): void {
    this.queue.delete(handle);
  }

  get pending(): number {
    return this.queue.size;
  }

  advanceTo(until: number): void {
    for (;;) {
      let first: [number, { at: number; callback: () => void }] | null = null;
      for (const entry of this.queue) {
        if (entry[1].at <= until && (first === null || entry[1].at < first[1].at)) first = entry;
      }
      if (first === null) break;
      this.queue.delete(first[0]);
      this.now = first[1].at;
      first[1].callback();
    }
    this.now = until;
  }
}

type Recorded =
  | { kind: "breath"; at: number }
  | { kind: "blink"; at: number; event: BlinkEvent }
  | { kind: "gaze"; at: number; event: GazeEvent }
  | { kind: "thumb"; at: number; event: ThumbEvent }
  | { kind: "stop"; at: number };

function run(motion: IdleMotion, untilMs: number, hasThumb = true) {
  const clock = new FakeClock();
  const log: Recorded[] = [];
  const scheduler = createIdleRigScheduler(motion, {
    hasThumb,
    timers: clock,
    actions: {
      startBreath: () => log.push({ kind: "breath", at: clock.now }),
      blink: (event) => log.push({ kind: "blink", at: clock.now, event }),
      gaze: (event) => log.push({ kind: "gaze", at: clock.now, event }),
      thumb: (event) => log.push({ kind: "thumb", at: clock.now, event }),
      stopAll: () => log.push({ kind: "stop", at: clock.now }),
    },
  });
  scheduler.start();
  clock.advanceTo(untilMs);
  return { clock, log, scheduler };
}

const TEN_MINUTES = 10 * 60 * 1000;

describe("idle rig scheduler", () => {
  const motion = baseMotion();

  it("starts one breath cycle and replays the same irregular schedule for the same seed", () => {
    const first = run(motion, TEN_MINUTES).log;
    const second = run(motion, TEN_MINUTES).log;
    expect(first.filter((item) => item.kind === "breath")).toEqual([{ kind: "breath", at: 0 }]);
    expect(second).toEqual(first);
    const reseeded = run({ ...motion, seed: motion.seed + 1 }, TEN_MINUTES).log;
    expect(reseeded).not.toEqual(first);
  });

  it("blinks irregularly: lids closed ~130-150 ms, gaps from the base/jitter or a double blink", () => {
    const blinks = run(motion, TEN_MINUTES).log.filter(
      (item): item is Extract<Recorded, { kind: "blink" }> => item.kind === "blink",
    );
    expect(blinks.length).toBeGreaterThan(80);
    const [firstLow, firstHigh] = motion.blink.firstMs;
    expect(blinks[0]!.at).toBeGreaterThanOrEqual(firstLow);
    expect(blinks[0]!.at).toBeLessThanOrEqual(firstHigh);

    let doubles = 0;
    const gaps = new Set<number>();
    for (let index = 1; index < blinks.length; index += 1) {
      const previous = blinks[index - 1]!;
      const current = blinks[index]!;
      const total = blinkTotalMs(previous.event);
      expect(total).toBeGreaterThanOrEqual(130);
      expect(total).toBeLessThanOrEqual(150);
      const gap = current.at - previous.at - total;
      if (current.event.double) {
        doubles += 1;
        // 連眨只接在單次眨眼後，不會三連。
        expect(previous.event.double).toBe(false);
        expect(gap).toBeGreaterThanOrEqual(motion.blink.doubleGapMs[0]);
        expect(gap).toBeLessThanOrEqual(motion.blink.doubleGapMs[1]);
      } else {
        expect(gap).toBeGreaterThanOrEqual(motion.blink.baseMs - motion.blink.jitterMs);
        expect(gap).toBeLessThanOrEqual(motion.blink.baseMs + motion.blink.jitterMs);
        gaps.add(Math.round(gap / 250));
      }
    }
    // 偶爾連眨，不是每次。
    expect(doubles).toBeGreaterThan(0);
    expect(doubles).toBeLessThan(blinks.length / 2);
    // 不規則：間隔分散在很多個 250 ms 的格子裡，不是固定節拍。
    expect(gaps.size).toBeGreaterThan(8);
  });

  it("only ever glances left, and the thumb waits for the eyes", () => {
    const log = run(motion, TEN_MINUTES).log;
    const gazes = log.filter((item): item is Extract<Recorded, { kind: "gaze" }> => item.kind === "gaze");
    const thumbs = log.filter((item): item is Extract<Recorded, { kind: "thumb" }> => item.kind === "thumb");
    expect(gazes.length).toBeGreaterThan(40);
    for (const gaze of gazes) {
      expect(gaze.event.nearDx).toBeLessThanOrEqual(0);
      expect(gaze.event.farDx).toBeLessThanOrEqual(0);
    }
    expect(thumbs.length).toBeGreaterThan(20);
    for (const thumb of thumbs) {
      expect(thumb.event.angleDeg).toBe(-5);
      // 眼睛先看向杯子：同一次動作的視線剛好在 leadMs 之前開始。
      const lead = gazes.find((gaze) => Math.abs(gaze.at - (thumb.at - motion.thumb.leadMs)) < 1e-6);
      expect(lead?.event.holdMs).toBe(thumbGazeHoldMs(motion));
    }
  });

  it("spaces thumb actions 15-25 s start to start (plus a busy retry at most)", () => {
    const thumbs = run(motion, TEN_MINUTES).log.filter((item) => item.kind === "thumb");
    const [firstLow, firstHigh] = motion.thumb.firstMs;
    expect(thumbs[0]!.at - motion.thumb.leadMs).toBeGreaterThanOrEqual(firstLow);
    for (let index = 1; index < thumbs.length; index += 1) {
      const interval = thumbs[index]!.at - thumbs[index - 1]!.at;
      expect(interval).toBeGreaterThanOrEqual(motion.thumb.baseMs - motion.thumb.jitterMs);
      // 撞上視線時以 600 ms 為單位延後，最多等完一次視線（≤ 2.6 s）。
      expect(interval).toBeLessThanOrEqual(motion.thumb.baseMs + motion.thumb.jitterMs + 3000);
    }
    expect(firstHigh).toBeGreaterThan(firstLow);
  });

  it("never overlaps two glances or a glance with the thumb", () => {
    const log = run(motion, TEN_MINUTES).log;
    const busy: { from: number; to: number }[] = [];
    for (const item of log) {
      if (item.kind === "gaze") {
        busy.push({ from: item.at, to: item.at + motion.gaze.outMs + item.event.holdMs + motion.gaze.backMs });
      }
    }
    for (let index = 1; index < busy.length; index += 1) {
      expect(busy[index]!.from).toBeGreaterThanOrEqual(busy[index - 1]!.to);
    }
  });

  it("does not schedule the thumb when the rig has no thumb layer", () => {
    const log = run(motion, TEN_MINUTES, false).log;
    expect(log.some((item) => item.kind === "thumb")).toBe(false);
    expect(log.some((item) => item.kind === "gaze")).toBe(true);
  });

  it("stop clears every timer and cancels the animations; start replays from the seed", () => {
    const { clock, log, scheduler } = run(motion, 60_000);
    expect(clock.pending).toBeGreaterThan(0);
    scheduler.stop();
    expect(scheduler.isRunning()).toBe(false);
    expect(clock.pending).toBe(0);
    expect(log.at(-1)).toEqual({ kind: "stop", at: 60_000 });

    const before = log.length;
    clock.advanceTo(TEN_MINUTES);
    expect(log.length).toBe(before);

    scheduler.start();
    clock.advanceTo(TEN_MINUTES + 60_000);
    const replay = log.slice(before).map((item) => ({ ...item, at: item.at - TEN_MINUTES }));
    expect(replay).toEqual(log.slice(0, before - 1));
  });

  it("keeps the breath at most 1% about the waist and the follow offsets proportional", () => {
    expect(motion.breath.scaleYMax).toBeLessThanOrEqual(0.01);
    // 頭（下巴 y=440）跟著腰線（y=776）上方 336 px 的 1% 位移。
    expect(breathFollowDy(motion, 776, 440)).toBeCloseTo(-3.36, 5);
    expect(breathFollowDy(motion, 776, 776)).toBeCloseTo(0, 10);
  });

  it("uses pairwise coprime base periods", () => {
    const periods = [motion.breath.periodMs, motion.blink.baseMs, motion.gaze.baseMs, motion.thumb.baseMs];
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    for (let i = 0; i < periods.length; i += 1) {
      for (let j = i + 1; j < periods.length; j += 1) expect(gcd(periods[i]!, periods[j]!)).toBe(1);
    }
  });

  it("mulberry32 is deterministic and uniform enough for jitter", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const values = Array.from({ length: 1000 }, () => a());
    expect(Array.from({ length: 1000 }, () => b())).toEqual(values);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
  });
});
