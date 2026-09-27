// V5 公共世界（開盤廳）的幾何場景層：純資料＋純函式。
//
// 邊界（重要）：
// - 本檔不 import React、不碰 DOM、不打 API、不讀時鐘。畫面只負責把這裡的
//   幾何吐成 SVG。
// - **不引用任何圖片資產**。角色與場景一律是 CSS/SVG 幾何造型佔位；正式的
//   identity master 由另案生圖流程產出（`docs/v5/experience-spec.md` §2.2）。
// - 顏色一律用 `tokens.css` 的變數名（本檔只回傳變數名字串，不寫死色碼），
//   冷色 `--signal-420` 只在「新市場事實抵達」時使用（visual-system.md「色彩」）。
//
// 產品不變式（experience-spec.md §5.2、market-safety.md）：
// - 沒有「今日主角」、沒有自動切鏡、沒有光圈或聚光。
// - 沒有績效榜、持股表、選股器；場景裡不出現任何市場數字。
// - 剪影（`edge_silhouette`）不承擔姓名、台詞與跟拍入口（visual-system.md）。
//
// 世界座標契約：`CharacterWorldPosition.worldX` / `worldY` 是 0–100 的世界格座標
//（public-v2.yaml：「World-space grid coordinate」）。落在範圍外或非有限數的位置
// 視為壞資料，**直接略過並回報**，不夾到邊界上假裝存在（fail closed）。
//
// 取景（`worldCamera`）：舞台不是把 0–100 整格硬塞進畫面，而是一台固定鏡頭框住
// 「有人住的那一塊」。它對**所有**居民套同一組平移與縮放，不放大任何個人、不加光圈、
// 不改變任何人的相對位置或前後關係，因此不構成「今日主角」（experience-spec §5.2）。
// 沒有可繪製的居民時退回整格取景。

import type {
  CharacterPoseState,
  CharacterWorldPosition,
  DetailTier,
  SceneLayer,
  TruthClass,
  WorldSnapshot,
} from "../api/generated-v2/types.gen";
import type { WorldHitTarget } from "../interaction";
import { claimTruthClassOf } from "./claimTruth";
import { WORLD_RESIDENTS_EDGE_SILHOUETTE_MAX } from "./motion";

/** 舞台座標系（SVG viewBox 單位）。畫面容器以同比例鎖定，指標座標才能直接換算。 */
export const STAGE_WIDTH = 100;
export const STAGE_HEIGHT = 62;

/**
 * `character.proportion.heads` = 3.5–4.5 頭身（visual-system.md「Production token
 * source」）。本場景取 4.0：頭部足以在手機辨識，肩頸、手掌與步態仍是成人比例。
 */
export const FIGURE_HEAD_COUNT = 4;

/** 世界格座標的合法範圍（含端點）。 */
const GRID_MIN = 0;
const GRID_MAX = 100;

/**
 * 視平線：後牆與地板的交界，也是鏡頭高度。站在地板上的成年人，眼睛就落在這條線
 * 附近；越靠近鏡頭的人腳底越低、身體越高，一點透視才會成立。
 */
export const HORIZON_Y = 12;

/** 後牆下緣的左右內縮，讓兩道側牆收進消失點（一點透視）。 */
const WALL_INSET = 14;

/** 站立帶：最遠與最近的腳底舞台 Y。人只會站在這一帶，不會散到整片地板。 */
const STAND_BACK_Y = 30;
const STAND_FRONT_Y = 46;

/** 前景長桌的上緣：這條線以下是近景陳設，不是空地板。 */
const FOREGROUND_TOP_Y = 47;

/**
 * 全身高 ＝（腳底到視平線的距離）× 這個比例。用透視關係推身高，而不是另外設一組
 * 常數，居民才不會在畫面裡「浮起來」或縮成一顆點。
 */
const FIGURE_PERSPECTIVE_RATIO = 0.95;

/** 肩寬相對身高的比例；成人比例，不做幼態放大。 */
const FIGURE_SHOULDER_RATIO = 0.34;

/** 命中判定的額外裕度（舞台單位），讓手指不必壓在正中央。 */
const HIT_SLOP = 1.4;

/** 取景框的最小世界格跨距：只有一個人時也不會把鏡頭推到荒謬的倍率。 */
const CAMERA_MIN_SPAN = 46;

/** 取景框在人群外圍留的世界格邊界。 */
const CAMERA_PADDING = 12;

/** 字幕距離舞台左右邊緣至少留這麼多（百分比），避免被裁掉。 */
export const CAPTION_EDGE_MARGIN_PERCENT = 3;

/** 錨點離邊緣小於這個百分比就翻邊：不再置中，改成靠邊對齊往內展開。 */
export const CAPTION_FLIP_MARGIN_PERCENT = 26;

/** 靠邊對齊時，字幕比人物再往外挪一點點，讓文字壓在腳邊而不是穿過身體。 */
const CAPTION_STEM_PERCENT = 4;

export type SceneFigureKind = "resident" | "silhouette";

/** 一個可繪製的世界人物。剪影另走 `EDGE_SILHOUETTES`，不進這個型別。 */
export type SceneFigure = {
  characterId: string;
  kind: SceneFigureKind;
  /** 舞台座標：腳底中心點。 */
  footX: number;
  footY: number;
  /** 全身高（舞台單位）。頭高 = height / FIGURE_HEAD_COUNT。 */
  height: number;
  poseState: CharacterPoseState;
  sceneLayer: SceneLayer;
  detailTier: DetailTier;
  zOrder: number;
  /**
   * 只與當下故事有關的可觀察線索；沒有、或投影沒有替它標出資料身分時是 null，不補字
   *（public-v2.yaml 2.1.0 `focusHintTruthClass`）。
   */
  focusHint: string | null;
  /** `focusHint` 自己的資料身分；`focusHint` 是 null 時也是 null。 */
  focusHintTruthClass: TruthClass | null;
  /**
   * 世界快照裡這個人的故事線索標題（`WorldStoryHookRef.label`）。
   * 世界快照不含姓名，所以介面**不得**自行編一個名字；沒有 label、或 label 沒有
   * 資料身分（`labelTruthClass`）就用中性稱呼。
   */
  hookLabel: string | null;
  /** `hookLabel` 自己的資料身分；`hookLabel` 是 null 時也是 null。 */
  hookTruthClass: TruthClass | null;
  /** 這個人身上有幾項線索因為缺資料身分而不顯示（畫面要寫出原因）。 */
  withheldClaimCount: number;
};

/** 純裝飾剪影：無姓名、無資料、不可跟拍，也不進 `characterPositions`。 */
export type EdgeSilhouette = {
  id: string;
  footX: number;
  footY: number;
  height: number;
  /** 左右朝向，只影響輪廓，不代表任何狀態。 */
  facing: "left" | "right";
};

export type ScenePolygon = {
  id: string;
  /** SVG polygon points（舞台單位）。 */
  points: string;
  /** tokens.css 的色彩變數名。 */
  fillVar: string;
  opacity: number;
};

export type SceneRule = {
  id: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
};

/** 取景框（世界格單位）。所有居民共用同一個框，不做個人化縮放。 */
export type WorldCamera = {
  originX: number;
  spanX: number;
  originY: number;
  spanY: number;
};

/** 遠處字幕的貼邊方式：碰到舞台左右邊緣就翻邊，永遠不被裁掉。 */
export type CaptionAnchor = {
  side: "start" | "center" | "end";
  /** `start` 與 `center` 是距左緣、`end` 是距右緣的百分比。 */
  offsetPercent: number;
};

/** 剪影的幾何：一體成形的深色柱體，刻意與居民的關節骨架不同型。 */
export type SilhouetteGeometry = {
  /** SVG path `d`（舞台單位）。 */
  body: string;
  contact: { cx: number; cy: number; rx: number; ry: number };
};

/** 世界人物的骨架幾何（純數字，交給 SVG 直接畫）。 */
export type FigureGeometry = {
  head: { cx: number; cy: number; r: number };
  /** 軀幹（大衣）梯形。 */
  torso: string;
  /** 兩條腿。 */
  legs: readonly { x: number; y: number; width: number; height: number }[];
  /** 一隻手臂的折線（拿著生活物件那一側）。 */
  arm: string;
  /** 生活物件（保溫杯／紙張），成人生活線索，不是道具特效。 */
  prop: { x: number; y: number; width: number; height: number };
  /** 落在地板上的接地陰影，維持 2.5D 站立感（不是光圈）。 */
  contact: { cx: number; cy: number; rx: number; ry: number };
};

function isGridCoordinate(value: number): boolean {
  return Number.isFinite(value) && value >= GRID_MIN && value <= GRID_MAX;
}

function isRenderablePosition(position: CharacterWorldPosition): boolean {
  return (
    isGridCoordinate(position.worldX) &&
    isGridCoordinate(position.worldY) &&
    position.characterId.length > 0
  );
}

/**
 * 取景框：框住所有畫得出來的居民，並在外圍留 `CAMERA_PADDING`。
 * 只有一個人時，他會落在框正中央——這是鏡頭置中，不是把他標成主角：
 * 框對每個人都是同一組平移與縮放，沒有人被單獨放大或加亮。
 */
export function worldCamera(positions: readonly CharacterWorldPosition[]): WorldCamera {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let seen = 0;

  for (const position of positions) {
    if (!isRenderablePosition(position)) continue;
    seen += 1;
    minX = Math.min(minX, position.worldX);
    maxX = Math.max(maxX, position.worldX);
    minY = Math.min(minY, position.worldY);
    maxY = Math.max(maxY, position.worldY);
  }

  // 沒有人可畫時退回整格取景：畫面仍是同一間廳，只是沒有人站在裡面。
  if (seen === 0) {
    return { originX: GRID_MIN, spanX: GRID_MAX, originY: GRID_MIN, spanY: GRID_MAX };
  }

  const spanX = Math.max(maxX - minX + CAMERA_PADDING * 2, CAMERA_MIN_SPAN);
  const spanY = Math.max(maxY - minY + CAMERA_PADDING * 2, CAMERA_MIN_SPAN);

  return {
    originX: (minX + maxX) / 2 - spanX / 2,
    spanX,
    originY: (minY + maxY) / 2 - spanY / 2,
    spanY,
  };
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function stageX(worldX: number, camera: WorldCamera): number {
  return ((worldX - camera.originX) / camera.spanX) * STAGE_WIDTH;
}

/** 景深 0＝站立帶最遠處，1＝最靠近鏡頭。 */
function depthOf(worldY: number, camera: WorldCamera): number {
  return clamp01((worldY - camera.originY) / camera.spanY);
}

function stageY(worldY: number, camera: WorldCamera): number {
  return STAND_BACK_Y + depthOf(worldY, camera) * (STAND_FRONT_Y - STAND_BACK_Y);
}

/** 身高由腳底與視平線的距離決定，同一條透視關係也套在剪影上。 */
export function figureHeight(footY: number): number {
  return Math.max(0, (footY - HORIZON_Y) * FIGURE_PERSPECTIVE_RATIO);
}

/**
 * 遠處字幕的錨點。靠近左右邊緣時翻邊（改成靠邊對齊並往內展開），中間才置中；
 * 靠邊時再夾一層 `CAPTION_EDGE_MARGIN_PERCENT`，所以字幕永遠不會被舞台裁掉。
 */
export function captionAnchor(footX: number): CaptionAnchor {
  const percent = clamp01(footX / STAGE_WIDTH) * 100;

  if (percent <= CAPTION_FLIP_MARGIN_PERCENT) {
    return {
      side: "start",
      offsetPercent: Math.max(CAPTION_EDGE_MARGIN_PERCENT, percent - CAPTION_STEM_PERCENT),
    };
  }

  if (percent >= 100 - CAPTION_FLIP_MARGIN_PERCENT) {
    return {
      side: "end",
      offsetPercent: Math.max(CAPTION_EDGE_MARGIN_PERCENT, 100 - percent - CAPTION_STEM_PERCENT),
    };
  }

  return { side: "center", offsetPercent: percent };
}

/** 左半場的剪影朝右、右半場朝左，視線收向廳中央；只影響輪廓，不代表任何狀態。 */
export function facingFromX(footX: number): EdgeSilhouette["facing"] {
  return footX < STAGE_WIDTH / 2 ? "right" : "left";
}

type LabelledClaim = { text: string | null; truthClass: TruthClass | null; withheld: boolean };

/** 一項世界線索與它自己的身分；有字但缺身分就不顯示，並記為 withheld。 */
function labelledClaim(text: string | null | undefined, truthClass: unknown, declared: readonly TruthClass[]): LabelledClaim {
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (trimmed.length === 0) return { text: null, truthClass: null, withheld: false };
  const labelled = claimTruthClassOf(truthClass, declared);
  return labelled === null
    ? { text: null, truthClass: null, withheld: true }
    : { text: trimmed, truthClass: labelled, withheld: false };
}

function hookFor(snapshot: WorldSnapshot, characterId: string): LabelledClaim {
  const hook = snapshot.storyHooks.find((entry) => entry.characterId === characterId);
  if (!hook) return { text: null, truthClass: null, withheld: false };
  return labelledClaim(hook.label, hook.labelTruthClass, snapshot.truthClasses);
}

/**
 * 世界快照 → 可繪製人物，依 `zOrder` 由後往前排序（後畫的蓋在前面）。
 * 壞座標直接略過：畫面另外顯示「有幾個人這一輪畫不出來」，不假裝他們站在角落。
 */
export function worldFigures(snapshot: WorldSnapshot): SceneFigure[] {
  const camera = worldCamera(snapshot.characterPositions);

  return snapshot.characterPositions
    .filter(isRenderablePosition)
    .map((position) => {
      const hook = hookFor(snapshot, position.characterId);
      const focus = labelledClaim(position.focusHint, position.focusHintTruthClass, snapshot.truthClasses);
      return {
        characterId: position.characterId,
        kind: position.detailTier === "edge_silhouette" ? ("silhouette" as const) : ("resident" as const),
        footX: stageX(position.worldX, camera),
        footY: stageY(position.worldY, camera),
        height: figureHeight(stageY(position.worldY, camera)),
        poseState: position.poseState,
        sceneLayer: position.sceneLayer,
        detailTier: position.detailTier,
        zOrder: position.zOrder,
        focusHint: focus.text,
        focusHintTruthClass: focus.truthClass,
        hookLabel: hook.text,
        hookTruthClass: hook.truthClass,
        withheldClaimCount: (hook.withheld ? 1 : 0) + (focus.withheld ? 1 : 0),
      };
    })
    .sort((left, right) => left.zOrder - right.zOrder);
}

/** 座標壞掉、因此這一輪畫不出來的人數（fail closed 的可見說明用）。 */
export function unrenderablePositionCount(snapshot: WorldSnapshot): number {
  return snapshot.characterPositions.filter((position) => !isRenderablePosition(position)).length;
}

/**
 * 跟拍命中目標。型別直接取自既有的 `../interaction`，命中判定沿用同檔的
 * `hitTestWorldPoint`（system-design.md §18.2 明列為保留的 follow-camera primitive）。
 *
 * 剪影不承擔跟拍入口，所以 `edge_silhouette` 不進目標集合。
 */
export function worldTargets(snapshot: WorldSnapshot): WorldHitTarget[] {
  return worldFigures(snapshot)
    .filter((figure) => figure.kind === "resident")
    .map((figure) => {
      const shoulders = figure.height * FIGURE_SHOULDER_RATIO;
      return {
        id: figure.characterId,
        x: figure.footX,
        y: figure.footY - figure.height / 2,
        radiusX: shoulders / 2 + HIT_SLOP,
        radiusY: figure.height / 2 + HIT_SLOP,
        // 靠前的人先被命中：重疊時鏡頭跟住觀眾看得見的那一個。
        priority: figure.zOrder,
      };
    });
}

/**
 * 純裝飾剪影：遠景邊緣的生活密度。上限沿用 motion.ts 的
 * `WORLD_RESIDENTS_EDGE_SILHOUETTE_MAX`（= 4）。
 * 它們沒有 characterId、沒有姓名、沒有資料，也不可被跟拍。
 */
export const EDGE_SILHOUETTES: readonly EdgeSilhouette[] = (
  [
    { id: "edge-west-back", footX: 26, footY: 26, height: figureHeight(26), facing: "right" },
    { id: "edge-east-back", footX: 76, footY: 28, height: figureHeight(28), facing: "left" },
    { id: "edge-west-front", footX: 4, footY: 42, height: figureHeight(42), facing: "right" },
    { id: "edge-east-front", footX: 96, footY: 44, height: figureHeight(44), facing: "left" },
  ] satisfies readonly EdgeSilhouette[]
).slice(0, WORLD_RESIDENTS_EDGE_SILHOUETTE_MAX);

/**
 * 開盤廳的底層：後牆、兩道側牆、墨黑地板 ＋ 兩道窗光。
 * 窗光是窗，不是聚光燈：它不跟著任何人移動，也不標示誰重要。
 * 一點透視——後牆下緣內縮、側牆往前張開、地板往鏡頭放大，畫面才讀得出是一個房間。
 */
export const BACKDROP_SHAPES: readonly ScenePolygon[] = [
  {
    id: "floor-ink",
    points: `${WALL_INSET},${HORIZON_Y} ${STAGE_WIDTH - WALL_INSET},${HORIZON_Y} ${STAGE_WIDTH},${STAGE_HEIGHT} 0,${STAGE_HEIGHT}`,
    fillVar: "--ink-900",
    opacity: 1,
  },
  {
    id: "wall-back",
    points: `0,0 ${STAGE_WIDTH},0 ${STAGE_WIDTH - WALL_INSET},${HORIZON_Y} ${WALL_INSET},${HORIZON_Y}`,
    fillVar: "--ink-1000",
    opacity: 1,
  },
  {
    id: "wall-west",
    points: `0,0 ${WALL_INSET},${HORIZON_Y} 0,${STAGE_HEIGHT}`,
    fillVar: "--ink-1000",
    opacity: 0.72,
  },
  {
    id: "wall-east",
    points: `${STAGE_WIDTH},0 ${STAGE_WIDTH - WALL_INSET},${HORIZON_Y} ${STAGE_WIDTH},${STAGE_HEIGHT}`,
    fillVar: "--ink-1000",
    opacity: 0.72,
  },
  // 後牆上的兩扇高窗。
  { id: "window-west", points: `23,1.6 43,1.6 43,10.4 23,10.4`, fillVar: "--paper-100", opacity: 0.11 },
  { id: "window-east", points: `57,1.6 77,1.6 77,10.4 57,10.4`, fillVar: "--paper-100", opacity: 0.11 },
  // 窗光落在地板上的兩塊光池，隨透視往鏡頭張開。
  {
    id: "floor-light-west",
    points: `23,${HORIZON_Y} 43,${HORIZON_Y} 50,${STAND_FRONT_Y} 13,${STAND_FRONT_Y}`,
    fillVar: "--paper-100",
    opacity: 0.06,
  },
  {
    id: "floor-light-east",
    points: `57,${HORIZON_Y} 77,${HORIZON_Y} 88,${STAND_FRONT_Y} 51,${STAND_FRONT_Y}`,
    fillVar: "--paper-100",
    opacity: 0.06,
  },
];

/**
 * 前景陳設：一張橫過鏡頭前緣的長桌與桌上的紙與杯。
 * 它畫在人物**之後**（蓋住最前排的腳），所以下緣不是一片空地板，而是一個有縱深的房間。
 */
export const FOREGROUND_SHAPES: readonly ScenePolygon[] = [
  {
    id: "desk-front",
    points: `6,${FOREGROUND_TOP_Y} ${STAGE_WIDTH - 6},${FOREGROUND_TOP_Y} ${STAGE_WIDTH},${STAGE_HEIGHT} 0,${STAGE_HEIGHT}`,
    fillVar: "--ink-1000",
    opacity: 1,
  },
  { id: "desk-sheet-west", points: `15,51.5 30,50.6 32,57 16,58.2`, fillVar: "--paper-100", opacity: 0.5 },
  { id: "desk-sheet-east", points: `67,50.8 81,51.8 80.5,57.6 65.5,56.6`, fillVar: "--paper-100", opacity: 0.42 },
  { id: "desk-cup", points: `46,49.6 50.4,49.6 49.8,55.4 46.6,55.4`, fillVar: "--copper-500", opacity: 0.65 },
];

/** 氧化銅細線：欄杆與地板分隔。只是空間結構，不連到漲跌方向。 */
export const COPPER_RULES: readonly SceneRule[] = [
  { id: "rail-back", x1: WALL_INSET, y1: HORIZON_Y, x2: STAGE_WIDTH - WALL_INSET, y2: HORIZON_Y },
  { id: "post-west", x1: 18, y1: HORIZON_Y, x2: 4, y2: STAND_FRONT_Y },
  { id: "post-east", x1: 82, y1: HORIZON_Y, x2: 96, y2: STAND_FRONT_Y },
  { id: "seam-stand-back", x1: 8, y1: STAND_BACK_Y, x2: 92, y2: STAND_BACK_Y },
];

/** 前景長桌的檯面邊；畫在長桌之後，才不會被自己的填色蓋掉。 */
export const FOREGROUND_RULES: readonly SceneRule[] = [
  { id: "desk-edge", x1: 6, y1: FOREGROUND_TOP_Y, x2: STAGE_WIDTH - 6, y2: FOREGROUND_TOP_Y },
];

/**
 * 冷色市場訊號：**只**表示「有新的市場事實抵達這個場景」，不表示漲跌好壞，也不是
 * 某個人的高光（market-safety.md、visual-system.md）。回傳 null 代表這一刻沒有
 * 新事實，畫面就不畫這道冷色。
 */
export function marketSignal(snapshot: WorldSnapshot): { activeEventCount: number } | null {
  const count = snapshot.scene.activePriorityEventRefs.length;
  return count > 0 ? { activeEventCount: count } : null;
}

/** 世界人物骨架。純幾何，沒有臉部細節與表情資產。 */
export function figureGeometry(footX: number, footY: number, height: number): FigureGeometry {
  const headDiameter = height / FIGURE_HEAD_COUNT;
  const headRadius = headDiameter / 2;
  const shoulders = height * FIGURE_SHOULDER_RATIO;
  const torsoTop = footY - height + headDiameter;
  const hipY = footY - height * 0.42;
  const legWidth = shoulders * 0.3;

  return {
    head: { cx: footX, cy: footY - height + headRadius, r: headRadius },
    torso: [
      `${footX - shoulders / 2},${torsoTop}`,
      `${footX + shoulders / 2},${torsoTop}`,
      `${footX + shoulders * 0.58},${hipY}`,
      `${footX - shoulders * 0.58},${hipY}`,
    ].join(" "),
    legs: [
      { x: footX - shoulders * 0.36, y: hipY, width: legWidth, height: footY - hipY },
      { x: footX + shoulders * 0.06, y: hipY, width: legWidth, height: footY - hipY },
    ],
    arm: [
      `${footX + shoulders * 0.46},${torsoTop + headDiameter * 0.35}`,
      `${footX + shoulders * 0.72},${torsoTop + headDiameter * 0.95}`,
      `${footX + shoulders * 0.5},${torsoTop + headDiameter * 1.35}`,
    ].join(" "),
    prop: {
      x: footX + shoulders * 0.36,
      y: torsoTop + headDiameter * 1.35,
      width: shoulders * 0.34,
      height: headDiameter * 0.5,
    },
    contact: { cx: footX, cy: footY, rx: shoulders * 0.62, ry: shoulders * 0.16 },
  };
}

/** 剪影身形相對身高的比例：比居民窄，且整條是一塊，不分頭與腿。 */
const SILHOUETTE_WIDTH_RATIO = 0.3;
/** 頭肩合成的圓帽高度（相對身高）。 */
const SILHOUETTE_CAP_RATIO = 0.2;
/** 朝向造成的傾斜量（相對身高）。 */
const SILHOUETTE_LEAN_RATIO = 0.05;

/**
 * 剪影幾何。刻意與 `figureGeometry` **不同型**：沒有獨立頭部圓、沒有分開的兩條腿、
 * 沒有手臂與生活物件，整個人是一塊往下微張的深色柱體加一頂圓帽。
 * 這樣即使在小尺寸、即使明度接近，觀眾也一眼分得出「這是背景密度，不是可跟拍的人」。
 */
export function silhouetteGeometry(
  footX: number,
  footY: number,
  height: number,
  facing: EdgeSilhouette["facing"],
): SilhouetteGeometry {
  const halfBase = (height * SILHOUETTE_WIDTH_RATIO) / 2;
  const capHeight = height * SILHOUETTE_CAP_RATIO;
  const capHalf = halfBase * 0.86;
  const lean = height * SILHOUETTE_LEAN_RATIO * (facing === "right" ? 1 : -1);
  const capY = footY - height + capHeight;

  return {
    body: [
      `M ${footX - capHalf + lean} ${capY}`,
      `A ${capHalf} ${capHeight} 0 0 1 ${footX + capHalf + lean} ${capY}`,
      `L ${footX + halfBase} ${footY}`,
      `L ${footX - halfBase} ${footY}`,
      "Z",
    ].join(" "),
    contact: { cx: footX, cy: footY, rx: halfBase * 1.05, ry: halfBase * 0.28 },
  };
}
