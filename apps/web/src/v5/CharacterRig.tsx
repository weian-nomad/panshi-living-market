// 近景分層 rig：把角色美術清單的圖層疊成 4:5 近景，並跑待機微動作。
//
// 只在 `characterArtStore` 判定整套圖都已解碼（`ready`）時才會被渲染；任何一張圖之後
// 仍載入失敗就呼叫 `onBroken`，近景退回幾何佔位。
//
// 動態規則（docs/v5/visual-system.md「動態」「Reduced motion」）：
// - 只動 transform 與 opacity；排程與參數在 `rigMotion.ts`，數值全部來自清單。
// - prefers-reduced-motion：不跑任何計時器與動畫，顯示靜態母版；切換時只用
//   ≤ `motion.reduced_fade_max` 的淡入淡出（清單的 `reducedFadeMs`，schema 上限 120 ms）。
// - 分頁不可見時停掉計時器與動畫，回來再從同一個 seed 重新開始。
//
// 版面：圖層位置全部用畫布百分比，近景框（`frame`）決定裁切；不讀容器像素尺寸。

import { useEffect, useRef, useState, type CSSProperties } from "react";

import {
  characterArtFileUrl,
  cubicBezierCss,
  type CharacterArtManifest,
  type RigLayer,
  type RigPart,
} from "./characterArt";
import { breathFollowDy, createIdleRigScheduler, type RigMotionActions } from "./rigMotion";

const STYLES = `
.v5-rig { position: absolute; inset: 0; overflow: hidden; }
.v5-rig__canvas { position: absolute; }
.v5-rig__layer { position: absolute; }
.v5-rig__layer img, .v5-rig__static {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  user-select: none;
  -webkit-user-drag: none;
  pointer-events: none;
}
.v5-rig__layer[data-breath="scale"], .v5-rig__layer[data-breath="follow"] { will-change: transform; }
@keyframes v5-rig-in { from { opacity: 0; } to { opacity: 1; } }
`;

export type RigState = "static" | "paused" | "running";

function percent(value: number, total: number): string {
  return `${(value / total) * 100}%`;
}

function canAnimate(): boolean {
  return (
    typeof document !== "undefined" &&
    typeof document.timeline !== "undefined" &&
    typeof Element !== "undefined" &&
    typeof Element.prototype.animate === "function"
  );
}

/** 一層圖片自己的初始樣式：眼皮只有睜眼層可見；拇指以 pivot 為旋轉中心。 */
function partStyle(layer: RigLayer): CSSProperties | undefined {
  if (layer.part === "lidHalf" || layer.part === "lidClosed") return { opacity: 0 };
  if (layer.part === "thumb" && layer.pivot !== null) {
    return {
      transformOrigin: `${percent(layer.pivot.x - layer.x, layer.width)} ${percent(layer.pivot.y - layer.y, layer.height)}`,
      willChange: "transform",
    };
  }
  if (layer.part === "irisNear" || layer.part === "irisFar") return { willChange: "transform" };
  return undefined;
}

/** 把排程事件變成 Web Animations。所有動畫都記下來，`stopAll` 一次取消回到靜止姿勢。 */
function domActions(
  manifest: CharacterArtManifest,
  layerElements: ReadonlyMap<string, HTMLDivElement>,
  partElements: ReadonlyMap<RigPart, HTMLImageElement>,
): RigMotionActions {
  const rig = manifest.closeUpRig;
  const motion = rig.motion;
  let animations: Animation[] = [];

  const track = (animation: Animation) => {
    animations.push(animation);
    animation.addEventListener("finish", () => {
      animations = animations.filter((item) => item !== animation);
    });
  };
  const layerOf = (part: RigPart) => rig.layers.find((layer) => layer.part === part);

  return {
    startBreath() {
      const easing = cubicBezierCss(motion.breath.easing);
      const offset = motion.breath.inhaleFraction;
      const startTime = document.timeline.currentTime;
      for (const layer of rig.layers) {
        const element = layerElements.get(layer.id);
        if (element === undefined || layer.breath === "none") continue;
        const [rest, peak] =
          layer.breath === "scale"
            ? ["scaleY(1)", `scaleY(${1 + motion.breath.scaleYMax})`]
            : [
                "translateY(0%)",
                `translateY(${percent(breathFollowDy(motion, rig.waistY, layer.attachY ?? rig.waistY), layer.height)})`,
              ];
        const animation = element.animate(
          [{ transform: rest, easing }, { transform: peak, offset, easing }, { transform: rest }],
          { duration: motion.breath.periodMs, iterations: Infinity },
        );
        // 所有呼吸層共用同一個起點，身體、頭與手才不會錯開。
        animation.startTime = startTime;
        track(animation);
      }
    },
    blink({ halfMs, closedMs }) {
      const open = partElements.get("lidOpen");
      const half = partElements.get("lidHalf");
      const closed = partElements.get("lidClosed");
      if (open === undefined || half === undefined || closed === undefined) return;
      const total = 2 * halfMs + closedMs;
      const a = halfMs / total;
      const b = (halfMs + closedMs) / total;
      const step = "step-end";
      track(open.animate([{ opacity: 0 }, { opacity: 0 }], { duration: total }));
      track(
        half.animate(
          [
            { opacity: 1, easing: step },
            { opacity: 0, offset: a, easing: step },
            { opacity: 1, offset: b, easing: step },
            { opacity: 1 },
          ],
          { duration: total },
        ),
      );
      track(
        closed.animate(
          [
            { opacity: 0, easing: step },
            { opacity: 1, offset: a, easing: step },
            { opacity: 0, offset: b, easing: step },
            { opacity: 0 },
          ],
          { duration: total },
        ),
      );
    },
    gaze({ nearDx, farDx, holdMs }) {
      const easing = cubicBezierCss(motion.gaze.easing);
      const total = motion.gaze.outMs + holdMs + motion.gaze.backMs;
      const a = motion.gaze.outMs / total;
      const b = (motion.gaze.outMs + holdMs) / total;
      const glance = (part: "irisNear" | "irisFar", dx: number) => {
        const element = partElements.get(part);
        const layer = layerOf(part);
        if (element === undefined || layer === undefined) return;
        const shifted = `translateX(${percent(dx, layer.width)})`;
        track(
          element.animate(
            [
              { transform: "translateX(0%)", easing },
              { transform: shifted, offset: a },
              { transform: shifted, offset: b, easing },
              { transform: "translateX(0%)" },
            ],
            { duration: total },
          ),
        );
      };
      glance("irisFar", farDx);
      glance("irisNear", nearDx);
    },
    thumb({ angleDeg, liftMs, holdMs, pressMs }) {
      const element = partElements.get("thumb");
      if (element === undefined) return;
      const easing = cubicBezierCss(motion.thumb.easing);
      const total = liftMs + holdMs + pressMs;
      const lifted = `rotate(${angleDeg}deg)`;
      track(
        element.animate(
          [
            { transform: "rotate(0deg)", easing },
            { transform: lifted, offset: liftMs / total },
            { transform: lifted, offset: (liftMs + holdMs) / total, easing },
            { transform: "rotate(0deg)" },
          ],
          { duration: total },
        ),
      );
    },
    stopAll() {
      for (const animation of animations.slice()) animation.cancel();
      animations = [];
    },
  };
}

export type CharacterRigProps = {
  characterId: string;
  manifest: CharacterArtManifest;
  reducedMotion: boolean;
  /** 任何一張圖在畫面上載入失敗。 */
  onBroken: () => void;
};

export function CharacterRig({ characterId, manifest, reducedMotion, onBroken }: CharacterRigProps) {
  const rig = manifest.closeUpRig;
  const { canvas, frame, motion } = rig;
  const layerElements = useRef(new Map<string, HTMLDivElement>());
  const partElements = useRef(new Map<RigPart, HTMLImageElement>());
  const [state, setState] = useState<RigState>(reducedMotion ? "static" : "paused");

  useEffect(() => {
    if (reducedMotion || !canAnimate()) {
      setState("static");
      return;
    }
    const scheduler = createIdleRigScheduler(motion, {
      hasThumb: rig.layers.some((layer) => layer.part === "thumb"),
      actions: domActions(manifest, layerElements.current, partElements.current),
      timers: {
        setTimeout: (callback, ms) => window.setTimeout(callback, ms),
        clearTimeout: (handle) => window.clearTimeout(handle),
      },
    });
    const sync = () => {
      if (document.visibilityState === "hidden") {
        scheduler.stop();
        setState("paused");
      } else {
        scheduler.start();
        setState("running");
      }
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      document.removeEventListener("visibilitychange", sync);
      scheduler.stop();
    };
  }, [manifest, motion, reducedMotion, rig.layers]);

  const fade = `${motion.reducedFadeMs}ms`;

  return (
    <div
      className="v5-rig"
      data-rig-state={state}
      data-asset-pack={manifest.assetPackId}
      aria-hidden="true"
      style={{ animation: `v5-rig-in ${fade} ease-out` }}
    >
      <style>{STYLES}</style>
      <div
        className="v5-rig__canvas"
        style={{
          left: percent(-frame.x, frame.width),
          top: percent(-frame.y, frame.height),
          width: percent(canvas.width, frame.width),
          height: percent(canvas.height, frame.height),
        }}
      >
        {rig.layers.map((layer) => (
          <div
            key={layer.id}
            className="v5-rig__layer"
            data-breath={layer.breath}
            ref={(element) => {
              if (element === null) layerElements.current.delete(layer.id);
              else layerElements.current.set(layer.id, element);
            }}
            style={{
              left: percent(layer.x, canvas.width),
              top: percent(layer.y, canvas.height),
              width: percent(layer.width, canvas.width),
              height: percent(layer.height, canvas.height),
              // 縱向縮放以腰線為錨（百分比相對於這一層自己的高度）。
              transformOrigin:
                layer.breath === "scale" ? `0 ${percent(rig.waistY - layer.y, layer.height)}` : undefined,
            }}
          >
            <img
              src={characterArtFileUrl(characterId, layer.file)}
              alt=""
              width={layer.width}
              height={layer.height}
              draggable={false}
              data-part={layer.part ?? undefined}
              ref={(element) => {
                if (layer.part === null) return;
                if (element === null) partElements.current.delete(layer.part);
                else partElements.current.set(layer.part, element);
              }}
              style={partStyle(layer)}
              onError={onBroken}
            />
          </div>
        ))}
        {/* 靜態母版：reduced motion 時蓋在 rig 上；靜止姿勢與 rig 同一個畫面，切換只淡入淡出。 */}
        <img
          className="v5-rig__static"
          src={characterArtFileUrl(characterId, rig.staticFallback.file)}
          alt=""
          width={canvas.width}
          height={canvas.height}
          draggable={false}
          style={{ opacity: state === "static" ? 1 : 0, transition: `opacity ${fade} ease-in-out` }}
          onError={onBroken}
        />
      </div>
    </div>
  );
}
