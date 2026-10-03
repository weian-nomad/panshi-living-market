// 近景分層 rig 的待機微動作排程（純邏輯，不碰 DOM）。
//
// 移植自美術端的 rig v1 預覽頁：同一組參數、同一個可重播的偽亂數（mulberry32）、同一套
// 排程規則。參數全部來自角色美術清單（`contracts/character-art/v1` 的 `motion`），本檔
// 不另設動作時間；唯一的本地常數是「忙碌時延後重試」的排程間隔，它不是畫面上的動作長度。
//
// 規則（docs/v5/visual-system.md「人物微動作」：眼神先動，接著才是手）：
// - 呼吸：一個無限循環，以腰線為錨縱向縮放 ≤1%；頭與手跟著位移，不變形。
// - 眨眼：上一次眨完後 baseMs ± jitterMs 再眨；開→半→閉→半→開以換圖完成；
//   單次眨完後有 doubleProbability 機率在 doubleGapMs 內連眨一次。
// - 視線：只往左（near／far 位移都 ≤ 0），停一下再回來；起點到起點 baseMs ± jitterMs。
// - 拇指：眼睛先看向杯子，leadMs 後拇指抬起再壓回；起點到起點 baseMs ± jitterMs。
//   拇指與視線互斥，撞上就延後重試。
//
// 呼叫端（`CharacterRig.tsx`）負責把事件變成 Web Animations（只動 transform／opacity），
// 並在 reduced motion 或分頁不可見時 `stop()`。

import type { IdleMotion } from "./characterArt";

/** 視線或拇指正在進行時，下一次嘗試延後的排程間隔（rig v1 同值）。 */
export const RIG_BUSY_RETRY_MS = 600;

export type BlinkEvent = { readonly halfMs: number; readonly closedMs: number; readonly double: boolean };
export type GazeEvent = { readonly nearDx: number; readonly farDx: number; readonly holdMs: number };
export type ThumbEvent = {
  readonly angleDeg: number;
  readonly liftMs: number;
  readonly holdMs: number;
  readonly pressMs: number;
};

export type RigMotionActions = {
  /** 開始呼吸循環（無限）。 */
  startBreath(): void;
  blink(event: BlinkEvent): void;
  gaze(event: GazeEvent): void;
  thumb(event: ThumbEvent): void;
  /** 取消所有進行中的動畫，回到靜止姿勢。 */
  stopAll(): void;
};

export type RigTimers = {
  setTimeout(callback: () => void, ms: number): number;
  clearTimeout(handle: number): void;
};

export type IdleRigScheduler = {
  start(): void;
  stop(): void;
  isRunning(): boolean;
};

/** mulberry32：同一個 seed 重播同一份不規則排程。 */
export function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 一次眨眼的總長：半閉、全閉、半閉。 */
export function blinkTotalMs(event: BlinkEvent): number {
  return 2 * event.halfMs + event.closedMs;
}

/** 一次視線來回的總長。 */
export function gazeTotalMs(motion: IdleMotion, holdMs: number): number {
  return motion.gaze.outMs + holdMs + motion.gaze.backMs;
}

/** 拇指動作期間，眼睛要停在杯子上的時間（眼睛先到、最後才回）。 */
export function thumbGazeHoldMs(motion: IdleMotion): number {
  const thumb = motion.thumb;
  return thumb.leadMs + thumb.liftMs + thumb.holdMs + thumb.pressMs + thumb.tailMs - motion.gaze.outMs;
}

/** 呼吸時，畫布第 `attachY` 列的縱向位移（px，向上為負）。 */
export function breathFollowDy(motion: IdleMotion, waistY: number, attachY: number): number {
  return -motion.breath.scaleYMax * (waistY - attachY);
}

export function createIdleRigScheduler(
  motion: IdleMotion,
  options: { hasThumb: boolean; actions: RigMotionActions; timers: RigTimers },
): IdleRigScheduler {
  const { actions, timers, hasThumb } = options;
  let running = false;
  let random = mulberry32(motion.seed);
  let pending: number[] = [];
  let busy = { gaze: false, thumb: false };

  const between = (low: number, high: number) => low + (high - low) * random();
  const jittered = (block: { baseMs: number; jitterMs: number }) =>
    block.baseMs + (2 * random() - 1) * block.jitterMs;

  function later(callback: () => void, ms: number): void {
    const handle = timers.setTimeout(() => {
      pending = pending.filter((item) => item !== handle);
      if (running) callback();
    }, ms);
    pending.push(handle);
  }

  function blink(isDouble: boolean): void {
    const config = motion.blink;
    const event: BlinkEvent = {
      halfMs: config.halfMs,
      closedMs: between(config.closedMs[0], config.closedMs[1]),
      double: isDouble,
    };
    actions.blink(event);
    later(() => {
      if (!isDouble && random() < config.doubleProbability) {
        later(() => blink(true), between(config.doubleGapMs[0], config.doubleGapMs[1]));
      } else {
        later(() => blink(false), jittered(config));
      }
    }, blinkTotalMs(event));
  }

  function gaze(): void {
    if (busy.thumb || busy.gaze) {
      later(gaze, RIG_BUSY_RETRY_MS);
      return;
    }
    busy.gaze = true;
    const holdMs = between(motion.gaze.holdMs[0], motion.gaze.holdMs[1]);
    // 下一次從這次的起點起算（起點到起點）。
    later(gaze, jittered(motion.gaze));
    actions.gaze({ nearDx: motion.gaze.nearDx, farDx: motion.gaze.farDx, holdMs });
    later(() => {
      busy.gaze = false;
    }, gazeTotalMs(motion, holdMs));
  }

  function thumb(): void {
    if (busy.gaze || busy.thumb) {
      later(thumb, RIG_BUSY_RETRY_MS);
      return;
    }
    busy.thumb = true;
    const config = motion.thumb;
    later(thumb, jittered(config));
    // 眼睛先看向杯子，手才動。
    actions.gaze({ nearDx: motion.gaze.nearDx, farDx: motion.gaze.farDx, holdMs: thumbGazeHoldMs(motion) });
    later(() => {
      actions.thumb({
        angleDeg: config.angleDeg,
        liftMs: config.liftMs,
        holdMs: config.holdMs,
        pressMs: config.pressMs,
      });
    }, config.leadMs);
    later(
      () => {
        busy.thumb = false;
      },
      config.leadMs + config.liftMs + config.holdMs + config.pressMs + config.tailMs + motion.gaze.backMs,
    );
  }

  return {
    start() {
      if (running) return;
      running = true;
      random = mulberry32(motion.seed);
      busy = { gaze: false, thumb: false };
      actions.startBreath();
      later(() => blink(false), between(motion.blink.firstMs[0], motion.blink.firstMs[1]));
      later(gaze, between(motion.gaze.firstMs[0], motion.gaze.firstMs[1]));
      if (hasThumb) later(thumb, between(motion.thumb.firstMs[0], motion.thumb.firstMs[1]));
    },
    stop() {
      running = false;
      for (const handle of pending) timers.clearTimeout(handle);
      pending = [];
      actions.stopAll();
    },
    isRunning() {
      return running;
    },
  };
}
