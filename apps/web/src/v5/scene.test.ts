// 世界場景幾何的守門測試。
//
// 這一份存在的原因是玩家視角的可讀性回報：居民小到看不出是人、字幕被舞台左緣裁掉、
// 剪影與居民只差 opacity 在該尺寸分不出來、下半是一片空地板。這些都是純幾何問題，
// 所以都可以在沒有 DOM 的情況下被釘住。

import { describe, expect, it } from "vitest";

import type { CharacterWorldPosition, WorldSnapshot } from "../api/generated-v2/types.gen";
import { WORLD_RESIDENTS_EDGE_SILHOUETTE_MAX } from "./motion";
import {
  BACKDROP_SHAPES,
  CAPTION_EDGE_MARGIN_PERCENT,
  EDGE_SILHOUETTES,
  FOREGROUND_SHAPES,
  HORIZON_Y,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  captionAnchor,
  facingFromX,
  figureGeometry,
  figureHeight,
  silhouetteGeometry,
  unrenderablePositionCount,
  worldCamera,
  worldFigures,
  worldTargets,
} from "./scene";

const RESIDENT = "96450815-0db8-f735-a139-5ba222da86b2";

function position(overrides: Partial<CharacterWorldPosition> = {}): CharacterWorldPosition {
  return {
    characterId: RESIDENT,
    worldX: 12,
    worldY: 7,
    poseState: "examining",
    focusHint: "他昨天終於減碼的那批資料",
    zOrder: 0,
    sceneLayer: "foreground",
    detailTier: "high_detail",
    sourceEventRefs: [],
    ...overrides,
  };
}

function snapshot(positions: readonly CharacterWorldPosition[]): WorldSnapshot {
  return {
    projectionVersion: 97,
    sourceGlobalPosition: 97,
    serverNow: "2026-03-18T10:30:00+08:00",
    dataState: "READY",
    visibilityEpoch: 1,
    truthClasses: ["fictional_setting"],
    sourceRevisionSet: [],
    marketClock: {
      marketDate: "2026-03-18",
      sessionPhase: "in_session",
      asOfTradingDate: "2026-03-17",
      nextBoundaryAt: "2026-03-18T13:30:00+08:00",
    },
    worldTickId: 6,
    scene: { sceneId: "e9ce0d21-2f4d-07cd-af52-ecdfd02ca0cb", activePriorityEventRefs: [] },
    characterPositions: [...positions],
    storyHooks: [],
  };
}

describe("取景", () => {
  it("只有一名居民時，他落在取景框正中央（鏡頭置中，不是把他標成主角）", () => {
    const camera = worldCamera([position()]);

    expect((12 - camera.originX) / camera.spanX).toBeCloseTo(0.5, 10);
    expect((7 - camera.originY) / camera.spanY).toBeCloseTo(0.5, 10);
  });

  it("取景框對每個人是同一組平移縮放：沒有人被單獨放大或往前挪", () => {
    const figures = worldFigures(
      snapshot([
        position({ characterId: "a", worldX: 20, worldY: 20, zOrder: 0 }),
        position({ characterId: "b", worldX: 60, worldY: 20, zOrder: 1 }),
        position({ characterId: "c", worldX: 40, worldY: 60, zOrder: 2 }),
      ]),
    );
    const byId = new Map(figures.map((figure) => [figure.characterId, figure]));
    const a = byId.get("a");
    const b = byId.get("b");
    const c = byId.get("c");
    if (!a || !b || !c) throw new Error("三個人都應該畫得出來");

    // 同一個 worldY 的兩個人身高與腳底完全相同。
    expect(a.height).toBeCloseTo(b.height, 10);
    expect(a.footY).toBeCloseTo(b.footY, 10);
    // 靠鏡頭的人比較大、腳底比較低——這是透視，不是特權。
    expect(c.height).toBeGreaterThan(a.height);
    expect(c.footY).toBeGreaterThan(a.footY);
    // 左右順序保持。
    expect(a.footX).toBeLessThan(c.footX);
    expect(c.footX).toBeLessThan(b.footX);
  });

  it("沒有任何可繪製的人時退回整格取景，不會除以零", () => {
    const camera = worldCamera([]);
    expect(camera.spanX).toBeGreaterThan(0);
    expect(camera.spanY).toBeGreaterThan(0);
    expect(worldFigures(snapshot([]))).toEqual([]);
  });

  it("壞座標略過並計數，不夾到邊界假裝存在", () => {
    const world = snapshot([
      position(),
      position({ characterId: "bad-x", worldX: Number.NaN }),
      position({ characterId: "bad-y", worldY: 140 }),
    ]);

    expect(worldFigures(world).map((figure) => figure.characterId)).toEqual([RESIDENT]);
    expect(unrenderablePositionCount(world)).toBe(2);
  });
});

describe("居民在舞台上的可讀性", () => {
  it("切片的那一名居民占舞台高度三成以上，且站在中前景", () => {
    const figures = worldFigures(snapshot([position()]));
    const figure = figures[0];
    if (!figure) throw new Error("應該畫得出這名居民");

    const heightRatio = figure.height / STAGE_HEIGHT;
    expect(heightRatio).toBeGreaterThan(0.3);
    // 不能大到塞滿整格：世界仍要看得到環境（experience-spec §6.3 的資訊代價）。
    expect(heightRatio).toBeLessThan(0.6);

    // 腳底落在舞台中段偏下，不是黏在最上緣的一顆點。
    expect(figure.footY / STAGE_HEIGHT).toBeGreaterThan(0.5);
    // 頭頂仍在畫面內。
    expect(figure.footY - figure.height).toBeGreaterThan(0);
  });

  it("腳底以下的空地板收斂在一成半以內：下緣是前景陳設，不是空白", () => {
    const figures = worldFigures(snapshot([position()]));
    const figure = figures[0];
    if (!figure) throw new Error("應該畫得出這名居民");

    // 前景長桌的上緣＝所有前景多邊形裡最小的 y。
    const foregroundTop = Math.min(
      ...FOREGROUND_SHAPES.flatMap((shape) =>
        shape.points.split(" ").map((pair) => Number(pair.split(",")[1])),
      ),
    );
    expect(Number.isFinite(foregroundTop)).toBe(true);

    const bareFloor = (foregroundTop - figure.footY) / STAGE_HEIGHT;
    expect(bareFloor).toBeGreaterThan(0);
    expect(bareFloor).toBeLessThan(0.15);
  });

  it("身高由透視關係推出：越靠鏡頭越高，視平線上為零", () => {
    expect(figureHeight(HORIZON_Y)).toBe(0);
    expect(figureHeight(HORIZON_Y - 5)).toBe(0);
    expect(figureHeight(40)).toBeGreaterThan(figureHeight(30));
  });

  it("命中範圍跟著人物一起放大，手指不必壓在正中央", () => {
    const targets = worldTargets(snapshot([position()]));
    const target = targets[0];
    const figure = worldFigures(snapshot([position()]))[0];
    if (!target || !figure) throw new Error("應該有一個可跟拍目標");

    expect(target.id).toBe(RESIDENT);
    expect(target.radiusY * 2).toBeGreaterThan(figure.height);
    expect(target.radiusX).toBeGreaterThan(0);
  });

  it("剪影不承擔跟拍入口", () => {
    const targets = worldTargets(
      snapshot([position({ characterId: "edge", detailTier: "edge_silhouette" })]),
    );
    expect(targets).toEqual([]);
  });
});

describe("遠處字幕的貼邊", () => {
  it("靠左緣時翻邊：改成靠左對齊，且至少離邊緣一個安全距離", () => {
    const anchor = captionAnchor(0);
    expect(anchor.side).toBe("start");
    expect(anchor.offsetPercent).toBe(CAPTION_EDGE_MARGIN_PERCENT);
  });

  it("靠右緣時翻邊：改成靠右對齊，且至少離邊緣一個安全距離", () => {
    const anchor = captionAnchor(STAGE_WIDTH);
    expect(anchor.side).toBe("end");
    expect(anchor.offsetPercent).toBe(CAPTION_EDGE_MARGIN_PERCENT);
  });

  it("回報中的那個位置（left:12% 配 translate(-50%)）不再置中，因此不會被裁掉", () => {
    const anchor = captionAnchor(12);
    expect(anchor.side).not.toBe("center");
    expect(anchor.offsetPercent).toBeGreaterThanOrEqual(CAPTION_EDGE_MARGIN_PERCENT);
  });

  it("舞台中段才置中，錨點就是人物本身", () => {
    const anchor = captionAnchor(50);
    expect(anchor).toEqual({ side: "center", offsetPercent: 50 });
  });

  it("任何錨點都留得住安全距離，也不會落在舞台外", () => {
    for (let x = -20; x <= STAGE_WIDTH + 20; x += 1) {
      const anchor = captionAnchor(x);
      expect(anchor.offsetPercent).toBeGreaterThanOrEqual(CAPTION_EDGE_MARGIN_PERCENT);
      expect(anchor.offsetPercent).toBeLessThanOrEqual(100 - CAPTION_EDGE_MARGIN_PERCENT);
    }
  });
});

describe("剪影與居民是不同形狀，不是同一個形狀降透明度", () => {
  it("剪影是一塊帶圓帽的柱體：沒有獨立頭部圓、沒有分開的兩條腿、沒有物件", () => {
    const silhouette = silhouetteGeometry(50, 40, 26, "right");
    const resident = figureGeometry(50, 40, 26);

    // 剪影只有一條 path，居民有頭、軀幹、兩條腿、手臂與生活物件。
    expect(silhouette.body.startsWith("M ")).toBe(true);
    expect(silhouette.body).toContain("A ");
    expect(Object.keys(silhouette)).toEqual(["body", "contact"]);
    expect(resident.legs.length).toBe(2);
    expect(resident.head.r).toBeGreaterThan(0);
    expect(resident.prop.width).toBeGreaterThan(0);
  });

  it("朝向只改輪廓：左右兩版的 path 不同，但站位與高度一樣", () => {
    const right = silhouetteGeometry(50, 40, 26, "right");
    const left = silhouetteGeometry(50, 40, 26, "left");

    expect(right.body).not.toBe(left.body);
    expect(right.contact).toEqual(left.contact);
  });

  it("左半場朝右、右半場朝左", () => {
    expect(facingFromX(10)).toBe("right");
    expect(facingFromX(90)).toBe("left");
  });

  it("剪影比居民窄，在同一個高度也一眼分得出量體", () => {
    const silhouette = silhouetteGeometry(50, 40, 26, "right");
    const resident = figureGeometry(50, 40, 26);
    const silhouetteWidth = silhouette.contact.rx * 2;
    const residentWidth = resident.contact.rx * 2;

    expect(silhouetteWidth).toBeLessThan(residentWidth);
  });
});

describe("場景資料本身", () => {
  it("剪影數量不超過 visual-system 的上限，朝向是字面型別", () => {
    expect(EDGE_SILHOUETTES.length).toBeLessThanOrEqual(WORLD_RESIDENTS_EDGE_SILHOUETTE_MAX);
    for (const silhouette of EDGE_SILHOUETTES) {
      expect(["left", "right"]).toContain(silhouette.facing);
      // 剪影一律站在地板上，且身高與居民同一條透視關係。
      expect(silhouette.footY).toBeGreaterThan(HORIZON_Y);
      expect(silhouette.height).toBeCloseTo(figureHeight(silhouette.footY), 10);
    }
  });

  it("場景只用 tokens.css 的色彩變數名，沒有寫死色碼", () => {
    for (const shape of [...BACKDROP_SHAPES, ...FOREGROUND_SHAPES]) {
      expect(shape.fillVar.startsWith("--")).toBe(true);
      expect(shape.fillVar).not.toContain("#");
      expect(shape.opacity).toBeGreaterThan(0);
      expect(shape.opacity).toBeLessThanOrEqual(1);
    }
  });

  it("後牆、地板與前景長桌都在舞台範圍內", () => {
    for (const shape of [...BACKDROP_SHAPES, ...FOREGROUND_SHAPES]) {
      for (const pair of shape.points.trim().split(/\s+/)) {
        const [rawX, rawY] = pair.split(",");
        const x = Number(rawX);
        const y = Number(rawY);
        expect(Number.isFinite(x)).toBe(true);
        expect(Number.isFinite(y)).toBe(true);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(STAGE_WIDTH);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(STAGE_HEIGHT);
      }
    }
  });
});
