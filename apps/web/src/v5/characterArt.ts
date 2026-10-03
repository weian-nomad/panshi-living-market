// 角色美術清單（`contracts/character-art/v1/schema.json`）的前端型別與驗證器。
//
// 邊界：
// - 本檔是純資料＋純函式：不 import React、不碰 DOM、不打網路、不讀時鐘。載入與預解碼
//   在 `characterArtStore.ts`，畫面在 `WorldScreen.tsx`／`CharacterRig.tsx`。
// - 美術檔不進 repo。清單與圖檔由部署者放在同源 `/art/characters/<characterId>/`，
//   這裡只決定「清單能不能信」。
//
// Fail closed（AGENTS.md、docs/v5/visual-system.md「資產尚未就緒時」）：清單少欄位、
// 多欄位、型別或範圍不對、角色 id 不是要求的那一位、或下面任何一條跨欄位規則不成立，
// 一律整包不用，畫面留在原本的幾何佔位。不修正、不夾值、不挑出還能用的部分。
//
// 驗證器與 schema 必須同步：`apps/web/tools/character-art-contract.test.mjs` 讓兩者跑
// 同一份 `contracts/character-art/v1/fixtures/` 語料（schema 用 `tools/json-schema-subset.mjs`）。

export const CHARACTER_ART_CONTRACT_VERSION = "character-art/v1";

export type EyePart = "irisNear" | "irisFar" | "lidOpen" | "lidHalf" | "lidClosed";
export type RigPart = EyePart | "thumb";
export type LayerBreath = "none" | "scale" | "follow";

export type ArtPoint = { readonly x: number; readonly y: number };
export type CubicBezier = readonly [number, number, number, number];
export type MsRange = readonly [number, number];

export type RigLayer = {
  readonly id: string;
  readonly file: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly breath: LayerBreath;
  /** 只有 `breath === "follow"` 有值。 */
  readonly attachY: number | null;
  readonly part: RigPart | null;
  /** 只有拇指層有值（畫布座標）。 */
  readonly pivot: ArtPoint | null;
};

export type IdleMotion = {
  readonly seed: number;
  readonly breath: {
    readonly periodMs: number;
    readonly inhaleFraction: number;
    readonly scaleYMax: number;
    readonly easing: CubicBezier;
  };
  readonly blink: {
    readonly baseMs: number;
    readonly jitterMs: number;
    readonly halfMs: number;
    readonly closedMs: MsRange;
    readonly doubleProbability: number;
    readonly doubleGapMs: MsRange;
    readonly firstMs: MsRange;
  };
  readonly gaze: {
    readonly baseMs: number;
    readonly jitterMs: number;
    readonly nearDx: number;
    readonly farDx: number;
    readonly outMs: number;
    readonly backMs: number;
    readonly holdMs: MsRange;
    readonly firstMs: MsRange;
    readonly easing: CubicBezier;
  };
  readonly thumb: {
    readonly baseMs: number;
    readonly jitterMs: number;
    readonly angleDeg: number;
    readonly liftMs: number;
    readonly holdMs: number;
    readonly pressMs: number;
    readonly leadMs: number;
    readonly tailMs: number;
    readonly firstMs: MsRange;
    readonly easing: CubicBezier;
  };
  readonly reducedFadeMs: number;
};

export type WorldSprite = {
  readonly file: string;
  readonly width: number;
  readonly height: number;
  readonly footAnchor: ArtPoint;
  readonly standingHeightPx: number;
};

export type CloseUpRig = {
  readonly canvas: { readonly width: number; readonly height: number };
  readonly frame: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly waistY: number;
  readonly staticFallback: { readonly file: string };
  readonly layers: readonly RigLayer[];
  readonly motion: IdleMotion;
};

export type CharacterArtManifest = {
  readonly contractVersion: typeof CHARACTER_ART_CONTRACT_VERSION;
  readonly characterId: string;
  readonly assetPackId: string;
  readonly worldSprite: WorldSprite;
  readonly closeUpRig: CloseUpRig;
};

export type ManifestCheck =
  | { readonly ok: true; readonly manifest: CharacterArtManifest }
  | { readonly ok: false; readonly errors: readonly string[] };

const CHARACTER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const ASSET_PACK_ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/u;
const ART_FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}(\/[A-Za-z0-9][A-Za-z0-9_-]{0,63}){0,3}\.(png|webp)$/u;
const LAYER_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,31}$/u;

const EYE_PARTS: readonly EyePart[] = ["irisNear", "irisFar", "lidOpen", "lidHalf", "lidClosed"];

/** 近景框必須是 4:5（experience-spec §7「4:5 近景」），容許 1%。 */
const FRAME_ASPECT = 4 / 5;
const FRAME_ASPECT_TOLERANCE = 0.01;

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 收集錯誤的小工具：每個檢查回傳通過與否，錯誤一律帶 JSON 路徑。 */
class Checker {
  readonly errors: string[] = [];

  fail(path: string, message: string): false {
    this.errors.push(`${path}: ${message}`);
    return false;
  }

  /** 物件必須剛好有 `required` 的鍵，且只允許 `allowed` 裡的鍵（schema 的 additionalProperties: false）。 */
  object(value: unknown, path: string, required: readonly string[], optional: readonly string[] = []): value is Json {
    if (!isRecord(value)) return this.fail(path, "expected an object");
    let ok = true;
    for (const key of required) {
      if (!Object.hasOwn(value, key)) ok = this.fail(path, `missing required property "${key}"`);
    }
    for (const key of Object.keys(value)) {
      if (!required.includes(key) && !optional.includes(key)) ok = this.fail(path, `unexpected property "${key}"`);
    }
    return ok;
  }

  integer(value: unknown, path: string, minimum: number, maximum: number): value is number {
    if (typeof value !== "number" || !Number.isInteger(value)) return this.fail(path, "expected an integer");
    return this.bounds(value, path, minimum, maximum);
  }

  number(value: unknown, path: string, minimum: number, maximum: number): value is number {
    if (typeof value !== "number" || !Number.isFinite(value)) return this.fail(path, "expected a number");
    return this.bounds(value, path, minimum, maximum);
  }

  bounds(value: number, path: string, minimum: number, maximum: number): boolean {
    if (value < minimum) return this.fail(path, `below minimum ${minimum}`);
    if (value > maximum) return this.fail(path, `above maximum ${maximum}`);
    return true;
  }

  string(value: unknown, path: string, minLength: number, maxLength: number, pattern: RegExp): value is string {
    if (typeof value !== "string") return this.fail(path, "expected a string");
    const length = [...value].length;
    if (length < minLength || length > maxLength) return this.fail(path, `length outside ${minLength}..${maxLength}`);
    if (!pattern.test(value)) return this.fail(path, `does not match ${pattern.source}`);
    return true;
  }

  oneOf<T extends string>(value: unknown, path: string, allowed: readonly T[]): value is T {
    if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
      return this.fail(path, `must be one of ${allowed.join(", ")}`);
    }
    return true;
  }

  /** 定長數字陣列（schema 的 minItems = maxItems 與 items 範圍）。 */
  numbers(
    value: unknown,
    path: string,
    count: number,
    minimum: number,
    maximum: number,
    integer: boolean,
  ): value is number[] {
    if (!Array.isArray(value)) return this.fail(path, "expected an array");
    if (value.length !== count) return this.fail(path, `expected exactly ${count} items`);
    let ok = true;
    value.forEach((item, index) => {
      const itemOk = integer
        ? this.integer(item, `${path}[${index}]`, minimum, maximum)
        : this.number(item, `${path}[${index}]`, minimum, maximum);
      ok = ok && itemOk;
    });
    return ok;
  }
}

function checkArtFile(check: Checker, value: unknown, path: string): void {
  check.string(value, path, 5, 128, ART_FILE_PATTERN);
}

function checkPoint(check: Checker, value: unknown, path: string): void {
  if (!check.object(value, path, ["x", "y"])) return;
  check.number(value["x"], `${path}.x`, 0, 4096);
  check.number(value["y"], `${path}.y`, 0, 4096);
}

function checkCubicBezier(check: Checker, value: unknown, path: string): void {
  if (!check.numbers(value, path, 4, -2, 3, false)) return;
  // x1、x2 必須落在 [0, 1]，否則 cubic-bezier() 不是合法的 CSS easing。
  if (value[0]! < 0 || value[0]! > 1) check.fail(`${path}[0]`, "cubic-bezier x1 must lie in [0, 1]");
  if (value[2]! < 0 || value[2]! > 1) check.fail(`${path}[2]`, "cubic-bezier x2 must lie in [0, 1]");
}

function checkMsRange(check: Checker, value: unknown, path: string, minimum: number, maximum: number): void {
  if (!check.numbers(value, path, 2, minimum, maximum, true)) return;
  if (value[0]! > value[1]!) check.fail(path, "range must be [min, max] with min <= max");
}

function checkJitter(check: Checker, block: Json, path: string): void {
  const base = block["baseMs"];
  const jitter = block["jitterMs"];
  if (typeof base === "number" && typeof jitter === "number" && jitter >= base) {
    check.fail(`${path}.jitterMs`, "must be smaller than baseMs");
  }
}

function checkLayer(check: Checker, value: unknown, path: string): void {
  if (!isRecord(value)) {
    check.fail(path, "expected an object");
    return;
  }
  // 三個分支（schema 的 oneOf）由 breath 與 part 決定，互斥。
  const isThumb = value["part"] === "thumb";
  const follows = value["breath"] === "follow";
  const common = ["id", "file", "x", "y", "width", "height", "breath"];
  if (isThumb) {
    if (!check.object(value, path, [...common, "attachY", "part", "pivot"])) return;
    if (value["breath"] !== "follow") check.fail(`${path}.breath`, 'a thumb layer must be "follow"');
    checkPoint(check, value["pivot"], `${path}.pivot`);
  } else if (follows) {
    if (!check.object(value, path, [...common, "attachY"], ["part"])) return;
  } else {
    if (!check.object(value, path, common, ["part"])) return;
    check.oneOf(value["breath"], `${path}.breath`, ["none", "scale"] as const);
  }
  check.string(value["id"], `${path}.id`, 1, 32, LAYER_ID_PATTERN);
  checkArtFile(check, value["file"], `${path}.file`);
  check.integer(value["x"], `${path}.x`, 0, 4096);
  check.integer(value["y"], `${path}.y`, 0, 4096);
  check.integer(value["width"], `${path}.width`, 1, 4096);
  check.integer(value["height"], `${path}.height`, 1, 4096);
  if (isThumb || follows) check.number(value["attachY"], `${path}.attachY`, 0, 4096);
  if (!isThumb && Object.hasOwn(value, "part")) check.oneOf(value["part"], `${path}.part`, EYE_PARTS);
}

function checkMotion(check: Checker, value: unknown, path: string): void {
  if (!check.object(value, path, ["seed", "breath", "blink", "gaze", "thumb", "reducedFadeMs"])) return;
  check.integer(value["seed"], `${path}.seed`, 0, 4294967295);
  check.integer(value["reducedFadeMs"], `${path}.reducedFadeMs`, 0, 120);

  const breath = value["breath"];
  if (check.object(breath, `${path}.breath`, ["periodMs", "inhaleFraction", "scaleYMax", "easing"])) {
    check.integer(breath["periodMs"], `${path}.breath.periodMs`, 8000, 12000);
    check.number(breath["inhaleFraction"], `${path}.breath.inhaleFraction`, 0.2, 0.8);
    check.number(breath["scaleYMax"], `${path}.breath.scaleYMax`, 0, 0.01);
    checkCubicBezier(check, breath["easing"], `${path}.breath.easing`);
  }

  const blink = value["blink"];
  const blinkKeys = ["baseMs", "jitterMs", "halfMs", "closedMs", "doubleProbability", "doubleGapMs", "firstMs"];
  if (check.object(blink, `${path}.blink`, blinkKeys)) {
    check.integer(blink["baseMs"], `${path}.blink.baseMs`, 2000, 10000);
    check.integer(blink["jitterMs"], `${path}.blink.jitterMs`, 0, 5000);
    check.integer(blink["halfMs"], `${path}.blink.halfMs`, 20, 60);
    checkMsRange(check, blink["closedMs"], `${path}.blink.closedMs`, 30, 100);
    check.number(blink["doubleProbability"], `${path}.blink.doubleProbability`, 0, 0.5);
    checkMsRange(check, blink["doubleGapMs"], `${path}.blink.doubleGapMs`, 100, 400);
    checkMsRange(check, blink["firstMs"], `${path}.blink.firstMs`, 0, 10000);
    checkJitter(check, blink, `${path}.blink`);
  }

  const gaze = value["gaze"];
  const gazeKeys = ["baseMs", "jitterMs", "nearDx", "farDx", "outMs", "backMs", "holdMs", "firstMs", "easing"];
  if (check.object(gaze, `${path}.gaze`, gazeKeys)) {
    check.integer(gaze["baseMs"], `${path}.gaze.baseMs`, 4000, 20000);
    check.integer(gaze["jitterMs"], `${path}.gaze.jitterMs`, 0, 6000);
    // 視線只往左：兩眼位移都不得為正。
    check.integer(gaze["nearDx"], `${path}.gaze.nearDx`, -6, 0);
    check.integer(gaze["farDx"], `${path}.gaze.farDx`, -6, 0);
    check.integer(gaze["outMs"], `${path}.gaze.outMs`, 100, 400);
    check.integer(gaze["backMs"], `${path}.gaze.backMs`, 100, 400);
    checkMsRange(check, gaze["holdMs"], `${path}.gaze.holdMs`, 500, 4000);
    checkMsRange(check, gaze["firstMs"], `${path}.gaze.firstMs`, 0, 15000);
    checkCubicBezier(check, gaze["easing"], `${path}.gaze.easing`);
    checkJitter(check, gaze, `${path}.gaze`);
  }

  const thumb = value["thumb"];
  const thumbKeys = ["baseMs", "jitterMs", "angleDeg", "liftMs", "holdMs", "pressMs", "leadMs", "tailMs", "firstMs", "easing"];
  if (check.object(thumb, `${path}.thumb`, thumbKeys)) {
    check.integer(thumb["baseMs"], `${path}.thumb.baseMs`, 10000, 40000);
    check.integer(thumb["jitterMs"], `${path}.thumb.jitterMs`, 0, 10000);
    check.number(thumb["angleDeg"], `${path}.thumb.angleDeg`, -5, 0);
    check.integer(thumb["liftMs"], `${path}.thumb.liftMs`, 100, 600);
    check.integer(thumb["holdMs"], `${path}.thumb.holdMs`, 0, 600);
    check.integer(thumb["pressMs"], `${path}.thumb.pressMs`, 100, 600);
    check.integer(thumb["leadMs"], `${path}.thumb.leadMs`, 0, 600);
    check.integer(thumb["tailMs"], `${path}.thumb.tailMs`, 0, 600);
    checkMsRange(check, thumb["firstMs"], `${path}.thumb.firstMs`, 0, 30000);
    checkCubicBezier(check, thumb["easing"], `${path}.thumb.easing`);
    checkJitter(check, thumb, `${path}.thumb`);
  }

  // 四個基本週期兩兩互質：呼吸、眨眼、視線、拇指不會鎖成看得出來的固定循環。
  const periods: [string, unknown][] = [
    ["breath.periodMs", isRecord(breath) ? breath["periodMs"] : undefined],
    ["blink.baseMs", isRecord(blink) ? blink["baseMs"] : undefined],
    ["gaze.baseMs", isRecord(gaze) ? gaze["baseMs"] : undefined],
    ["thumb.baseMs", isRecord(thumb) ? thumb["baseMs"] : undefined],
  ];
  for (let i = 0; i < periods.length; i += 1) {
    for (let j = i + 1; j < periods.length; j += 1) {
      const [nameA, a] = periods[i]!;
      const [nameB, b] = periods[j]!;
      if (typeof a === "number" && typeof b === "number" && Number.isInteger(a) && Number.isInteger(b) && gcd(a, b) !== 1) {
        check.fail(path, `${nameA} and ${nameB} must be coprime`);
      }
    }
  }
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) [x, y] = [y, x % y];
  return x;
}

/** schema 表達不了的跨欄位規則。只在結構已通過時執行，數值都已確定是合法範圍內的數字。 */
function checkCrossField(check: Checker, manifest: CharacterArtManifest): void {
  const sprite = manifest.worldSprite;
  if (sprite.footAnchor.x > sprite.width || sprite.footAnchor.y > sprite.height) {
    check.fail("$.worldSprite.footAnchor", "must lie inside the sprite");
  }
  if (sprite.standingHeightPx > sprite.footAnchor.y) {
    check.fail("$.worldSprite.standingHeightPx", "must not exceed footAnchor.y");
  }

  const rig = manifest.closeUpRig;
  const { canvas, frame } = rig;
  if (frame.x + frame.width > canvas.width || frame.y + frame.height > canvas.height) {
    check.fail("$.closeUpRig.frame", "must lie inside the canvas");
  }
  if (Math.abs(frame.width / frame.height - FRAME_ASPECT) > FRAME_ASPECT * FRAME_ASPECT_TOLERANCE) {
    check.fail("$.closeUpRig.frame", "must be 4:5 within 1%");
  }
  if (rig.waistY > canvas.height) check.fail("$.closeUpRig.waistY", "must lie inside the canvas");

  const seenIds = new Set<string>();
  const partCount = new Map<RigPart, number>();
  rig.layers.forEach((layer, index) => {
    const path = `$.closeUpRig.layers[${index}]`;
    if (seenIds.has(layer.id)) check.fail(`${path}.id`, `duplicate layer id "${layer.id}"`);
    seenIds.add(layer.id);
    if (layer.x + layer.width > canvas.width || layer.y + layer.height > canvas.height) {
      check.fail(path, "layer box must lie inside the canvas");
    }
    if (layer.attachY !== null && layer.attachY > canvas.height) {
      check.fail(`${path}.attachY`, "must lie inside the canvas");
    }
    if (layer.pivot !== null) {
      const inside =
        layer.pivot.x >= layer.x &&
        layer.pivot.x <= layer.x + layer.width &&
        layer.pivot.y >= layer.y &&
        layer.pivot.y <= layer.y + layer.height;
      if (!inside) check.fail(`${path}.pivot`, "must lie inside its own layer box");
    }
    if (layer.part !== null) partCount.set(layer.part, (partCount.get(layer.part) ?? 0) + 1);
  });
  for (const part of EYE_PARTS) {
    if (partCount.get(part) !== 1) check.fail("$.closeUpRig.layers", `needs exactly one "${part}" layer`);
  }
  if ((partCount.get("thumb") ?? 0) > 1) check.fail("$.closeUpRig.layers", 'at most one "thumb" layer');
}

function toLayer(value: Json): RigLayer {
  return {
    id: value["id"] as string,
    file: value["file"] as string,
    x: value["x"] as number,
    y: value["y"] as number,
    width: value["width"] as number,
    height: value["height"] as number,
    breath: value["breath"] as LayerBreath,
    attachY: typeof value["attachY"] === "number" ? value["attachY"] : null,
    part: typeof value["part"] === "string" ? (value["part"] as RigPart) : null,
    pivot: isRecord(value["pivot"]) ? (value["pivot"] as ArtPoint) : null,
  };
}

/**
 * 驗證一份從 `/art/characters/<expectedCharacterId>/manifest.json` 讀到的值。
 * 通過才回傳 manifest（圖層已正規化成固定形狀）；任何一條不成立都回傳全部錯誤。
 */
export function validateCharacterArtManifest(value: unknown, expectedCharacterId: string): ManifestCheck {
  const check = new Checker();
  if (!check.object(value, "$", ["contractVersion", "characterId", "assetPackId", "worldSprite", "closeUpRig"])) {
    return { ok: false, errors: check.errors };
  }
  if (value["contractVersion"] !== CHARACTER_ART_CONTRACT_VERSION) {
    check.fail("$.contractVersion", `expected "${CHARACTER_ART_CONTRACT_VERSION}"`);
  }
  if (check.string(value["characterId"], "$.characterId", 36, 36, CHARACTER_ID_PATTERN)) {
    if (value["characterId"] !== expectedCharacterId) {
      check.fail("$.characterId", "is not the character this manifest was requested for");
    }
  }
  check.string(value["assetPackId"], "$.assetPackId", 3, 64, ASSET_PACK_ID_PATTERN);

  const sprite = value["worldSprite"];
  if (check.object(sprite, "$.worldSprite", ["file", "width", "height", "footAnchor", "standingHeightPx"])) {
    checkArtFile(check, sprite["file"], "$.worldSprite.file");
    check.integer(sprite["width"], "$.worldSprite.width", 1, 1024);
    check.integer(sprite["height"], "$.worldSprite.height", 1, 1024);
    checkPoint(check, sprite["footAnchor"], "$.worldSprite.footAnchor");
    check.number(sprite["standingHeightPx"], "$.worldSprite.standingHeightPx", 1, 1024);
  }

  const rig = value["closeUpRig"];
  if (check.object(rig, "$.closeUpRig", ["canvas", "frame", "waistY", "staticFallback", "layers", "motion"])) {
    const canvas = rig["canvas"];
    if (check.object(canvas, "$.closeUpRig.canvas", ["width", "height"])) {
      check.integer(canvas["width"], "$.closeUpRig.canvas.width", 1, 4096);
      check.integer(canvas["height"], "$.closeUpRig.canvas.height", 1, 4096);
    }
    const frame = rig["frame"];
    if (check.object(frame, "$.closeUpRig.frame", ["x", "y", "width", "height"])) {
      check.integer(frame["x"], "$.closeUpRig.frame.x", 0, 4096);
      check.integer(frame["y"], "$.closeUpRig.frame.y", 0, 4096);
      check.integer(frame["width"], "$.closeUpRig.frame.width", 1, 4096);
      check.integer(frame["height"], "$.closeUpRig.frame.height", 1, 4096);
    }
    check.number(rig["waistY"], "$.closeUpRig.waistY", 0, 4096);
    const fallback = rig["staticFallback"];
    if (check.object(fallback, "$.closeUpRig.staticFallback", ["file"])) {
      checkArtFile(check, fallback["file"], "$.closeUpRig.staticFallback.file");
    }
    const layers = rig["layers"];
    if (!Array.isArray(layers)) {
      check.fail("$.closeUpRig.layers", "expected an array");
    } else if (layers.length < 6 || layers.length > 32) {
      check.fail("$.closeUpRig.layers", "expected 6..32 layers");
    } else {
      layers.forEach((layer, index) => checkLayer(check, layer, `$.closeUpRig.layers[${index}]`));
    }
    checkMotion(check, rig["motion"], "$.closeUpRig.motion");
  }

  if (check.errors.length > 0) return { ok: false, errors: check.errors };

  // 結構全部通過：正規化圖層，再跑跨欄位規則。
  const raw = value as Json;
  const rawRig = raw["closeUpRig"] as Json;
  const manifest: CharacterArtManifest = {
    contractVersion: CHARACTER_ART_CONTRACT_VERSION,
    characterId: raw["characterId"] as string,
    assetPackId: raw["assetPackId"] as string,
    worldSprite: raw["worldSprite"] as WorldSprite,
    closeUpRig: {
      canvas: rawRig["canvas"] as CloseUpRig["canvas"],
      frame: rawRig["frame"] as CloseUpRig["frame"],
      waistY: rawRig["waistY"] as number,
      staticFallback: rawRig["staticFallback"] as CloseUpRig["staticFallback"],
      layers: (rawRig["layers"] as Json[]).map(toLayer),
      motion: rawRig["motion"] as IdleMotion,
    },
  };
  checkCrossField(check, manifest);
  if (check.errors.length > 0) return { ok: false, errors: check.errors };
  return { ok: true, manifest };
}

/** 角色美術清單的同源路徑。 */
export function characterArtManifestPath(characterId: string): string {
  return `/art/characters/${encodeURIComponent(characterId)}/manifest.json`;
}

/** 清單裡一個檔案的同源路徑；`file` 已由 `ART_FILE_PATTERN` 限定為安全的相對路徑。 */
export function characterArtFileUrl(characterId: string, file: string): string {
  return `/art/characters/${encodeURIComponent(characterId)}/${file}`;
}

export function cubicBezierCss(easing: CubicBezier): string {
  return `cubic-bezier(${easing.join(", ")})`;
}

/**
 * 世界小圖在舞台座標（SVG viewBox 單位）的位置：`standingHeightPx` 對齊居民的全身高，
 * `footAnchor` 對齊腳底點。命中判定仍用居民原本的幾何，不看圖片外框。
 */
export function spritePlacement(
  sprite: WorldSprite,
  footX: number,
  footY: number,
  standingHeight: number,
): { x: number; y: number; width: number; height: number } {
  const scale = standingHeight / sprite.standingHeightPx;
  return {
    x: footX - sprite.footAnchor.x * scale,
    y: footY - sprite.footAnchor.y * scale,
    width: sprite.width * scale,
    height: sprite.height * scale,
  };
}

/** 近景需要預先解碼的每一張圖（含靜態母版），與它宣告的尺寸。 */
export function rigImages(manifest: CharacterArtManifest): { file: string; width: number; height: number }[] {
  const rig = manifest.closeUpRig;
  return [
    { file: rig.staticFallback.file, width: rig.canvas.width, height: rig.canvas.height },
    ...rig.layers.map((layer) => ({ file: layer.file, width: layer.width, height: layer.height })),
  ];
}
