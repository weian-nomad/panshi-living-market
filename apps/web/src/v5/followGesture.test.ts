import { describe, expect, it } from "vitest";

import {
  TAP_MOVE_TOLERANCE_PX,
  classifyPointerGesture,
  closeUpCtaCharacterId,
  initialFollowState,
  isCameraOnSubject,
  isPrimaryPointerButton,
  menuChoiceOpensCloseUp,
  nextFollowDeadline,
  pointerTravelPx,
  reduceFollow,
  type FollowEvent,
  type FollowState,
  type PointerGestureSample,
} from "./followGesture";
import {
  CLOSEUP_CTA_PERSIST_MS,
  FOLLOW_HANDOFF_MS,
  FOLLOW_HOLD_MS,
  FOLLOW_RELEASE_HOLD_MS,
} from "./motion";

const SUBJECT = "lu-yanzhi";
const OTHER = "chen-xiaoyu";

function run(events: readonly FollowEvent[], from: FollowState = initialFollowState()): FollowState {
  return events.reduce(reduceFollow, from);
}

/** 長按成立跟拍後的狀態（很多案例的共同起點）。 */
function following(at = FOLLOW_HOLD_MS): FollowState {
  return run([
    { kind: "press", characterId: SUBJECT, at: 0 },
    { kind: "tick", at },
  ]);
}

describe("跟拍手勢狀態機", () => {
  it("按住未達 follow_hold 不成立跟拍", () => {
    const state = run([
      { kind: "press", characterId: SUBJECT, at: 0 },
      { kind: "tick", at: FOLLOW_HOLD_MS - 1 },
    ]);

    expect(state.phase).toBe("pressing");
    expect(isCameraOnSubject(state)).toBe(false);
  });

  it("按住達 follow_hold 才成立跟拍", () => {
    const state = following();

    expect(state.phase).toBe("following");
    expect(state.subjectId).toBe(SUBJECT);
    expect(isCameraOnSubject(state)).toBe(true);
  });

  it("未達門檻就放開：不跟拍、也不留下入口", () => {
    const state = run([
      { kind: "press", characterId: SUBJECT, at: 0 },
      { kind: "tick", at: FOLLOW_HOLD_MS - 1 },
      { kind: "release", at: FOLLOW_HOLD_MS - 1 },
    ]);

    expect(state.phase).toBe("idle");
    expect(state.subjectId).toBeNull();
    expect(closeUpCtaCharacterId(state)).toBeNull();
  });

  it("放開後保留當前人物 follow_release_hold，再回全景", () => {
    const released = reduceFollow(following(), { kind: "release", at: 1_000 });
    expect(released.phase).toBe("releasing");
    expect(released.subjectId).toBe(SUBJECT);

    const stillHeld = reduceFollow(released, {
      kind: "tick",
      at: 1_000 + FOLLOW_RELEASE_HOLD_MS - 1,
    });
    expect(stillHeld.phase).toBe("releasing");
    expect(stillHeld.subjectId).toBe(SUBJECT);

    const wide = reduceFollow(released, { kind: "tick", at: 1_000 + FOLLOW_RELEASE_HOLD_MS });
    expect(wide.phase).toBe("idle");
    expect(wide.subjectId).toBeNull();
  });

  it("回全景後保留「再靠近一點」，closeup_cta_persist 之後消失", () => {
    const wide = run(
      [
        { kind: "release", at: 1_000 },
        { kind: "tick", at: 1_000 + FOLLOW_RELEASE_HOLD_MS },
      ],
      following(),
    );
    const ctaSince = 1_000 + FOLLOW_RELEASE_HOLD_MS;

    expect(closeUpCtaCharacterId(wide)).toBe(SUBJECT);

    const stillThere = reduceFollow(wide, { kind: "tick", at: ctaSince + CLOSEUP_CTA_PERSIST_MS - 1 });
    expect(closeUpCtaCharacterId(stillThere)).toBe(SUBJECT);

    const gone = reduceFollow(wide, { kind: "tick", at: ctaSince + CLOSEUP_CTA_PERSIST_MS });
    expect(closeUpCtaCharacterId(gone)).toBeNull();
  });

  it("交接：拖向第二個人達 follow_handoff 才換鏡頭主體", () => {
    const dragging = reduceFollow(following(), { kind: "dragTo", characterId: OTHER, at: 500 });
    expect(dragging.phase).toBe("handoff");
    expect(dragging.subjectId).toBe(SUBJECT);
    expect(dragging.handoffTargetId).toBe(OTHER);

    const tooEarly = reduceFollow(dragging, { kind: "tick", at: 500 + FOLLOW_HANDOFF_MS - 1 });
    expect(tooEarly.subjectId).toBe(SUBJECT);

    const handed = reduceFollow(dragging, { kind: "tick", at: 500 + FOLLOW_HANDOFF_MS });
    expect(handed.phase).toBe("following");
    expect(handed.subjectId).toBe(OTHER);
    expect(handed.handoffTargetId).toBeNull();
  });

  it("單角切片沒有第二個目標：交接是安全 no-op，鏡頭不掉人", () => {
    const camera = following();

    // 拖到空處。
    expect(reduceFollow(camera, { kind: "dragTo", characterId: null, at: 500 })).toBe(camera);
    // 拖回自己。
    expect(reduceFollow(camera, { kind: "dragTo", characterId: SUBJECT, at: 500 })).toBe(camera);
    // 還沒成立跟拍時的拖曳也不得偷偷交接。
    const pressing = reduceFollow(initialFollowState(), {
      kind: "press",
      characterId: SUBJECT,
      at: 0,
    });
    expect(reduceFollow(pressing, { kind: "dragTo", characterId: OTHER, at: 10 })).toBe(pressing);
  });

  it("鍵盤／AT 的選取列與長按導向完全相同的狀態", () => {
    const byHold = run([
      { kind: "press", characterId: SUBJECT, at: 0 },
      { kind: "tick", at: FOLLOW_HOLD_MS },
    ]);
    const byKeyboard = run([
      { kind: "openMenu", characterId: SUBJECT, at: 0 },
      { kind: "menuChoice", choice: "follow", at: FOLLOW_HOLD_MS },
    ]);

    expect(byKeyboard).toEqual(byHold);
  });

  it("選取列的另外兩個選項只關掉選單，不自行導覽", () => {
    const opened = reduceFollow(initialFollowState(), {
      kind: "openMenu",
      characterId: SUBJECT,
      at: 0,
    });
    expect(opened.menuFor).toBe(SUBJECT);

    const cancelled = reduceFollow(opened, { kind: "menuChoice", choice: "cancel", at: 5 });
    expect(cancelled.menuFor).toBeNull();
    expect(cancelled.phase).toBe("idle");

    const closeUp = reduceFollow(opened, { kind: "menuChoice", choice: "closeUp", at: 5 });
    expect(closeUp.menuFor).toBeNull();
    expect(closeUp.phase).toBe("idle");
    expect(menuChoiceOpensCloseUp("closeUp")).toBe(true);
    expect(menuChoiceOpensCloseUp("follow")).toBe(false);
    expect(menuChoiceOpensCloseUp("cancel")).toBe(false);
  });

  it("Escape 取消跟拍時仍走放開後的保留期，不瞬間跳回全景", () => {
    const cancelled = reduceFollow(following(), { kind: "cancel", at: 900 });
    expect(cancelled.phase).toBe("releasing");
    expect(cancelled.subjectId).toBe(SUBJECT);
  });

  it("下一個門檻可預先排程，跟拍中沒有待判定門檻", () => {
    const pressing = reduceFollow(initialFollowState(), {
      kind: "press",
      characterId: SUBJECT,
      at: 100,
    });
    expect(nextFollowDeadline(pressing)).toBe(100 + FOLLOW_HOLD_MS);
    expect(nextFollowDeadline(following())).toBeNull();
    expect(nextFollowDeadline(initialFollowState())).toBeNull();
  });
});

/**
 * 指標手勢判定。
 *
 * 這一組存在的原因是一個真的把產品玩不動的 bug：舞台在 pointerdown 抓走指標之後，
 * 瀏覽器把 `click` 改派給舞台，居民按鈕的 onClick 再也不會觸發，於是「點一下開選取列」
 * 這條 experience-spec §6.1 明文的等價路徑整條斷掉，而全部 127 個純函式測試都是綠的。
 * 判定改成純函式之後，這條路徑就有了不依賴瀏覽器行為的守門測試。
 */
describe("指標手勢判定（tap／長按）", () => {
  const BASE: PointerGestureSample = {
    downAt: 1_000,
    upAt: 1_000,
    travelPx: 0,
    pointerType: "touch",
    button: 0,
    hitCharacterId: SUBJECT,
    cancelled: false,
  };

  function heldFor(ms: number, overrides: Partial<PointerGestureSample> = {}) {
    return classifyPointerGesture({ ...BASE, upAt: BASE.downAt + ms, ...overrides });
  }

  it("179 ms 是點一下，180 ms 起是長按（門檻與狀態機同一條線）", () => {
    expect(FOLLOW_HOLD_MS).toBe(180);
    expect(heldFor(FOLLOW_HOLD_MS - 1)).toBe("tap");
    expect(heldFor(FOLLOW_HOLD_MS)).toBe("follow");
    expect(heldFor(FOLLOW_HOLD_MS + 1)).toBe("follow");
  });

  it("按下即放開（0 ms）也是點一下", () => {
    expect(heldFor(0)).toBe("tap");
  });

  it("位移剛好在容許值內仍是點一下，超過就不是", () => {
    expect(heldFor(50, { travelPx: TAP_MOVE_TOLERANCE_PX })).toBe("tap");
    expect(heldFor(50, { travelPx: TAP_MOVE_TOLERANCE_PX + 0.01 })).toBe("cancel");
    expect(heldFor(50, { travelPx: TAP_MOVE_TOLERANCE_PX * 4 })).toBe("cancel");
  });

  it("按滿門檻就是跟拍，拖多遠都不影響（拖曳交接本來就要一直移動）", () => {
    expect(heldFor(FOLLOW_HOLD_MS, { travelPx: 400 })).toBe("follow");
  });

  it("滑鼠右鍵與中鍵不開始任何手勢", () => {
    expect(heldFor(10, { pointerType: "mouse", button: 2 })).toBe("cancel");
    expect(heldFor(10, { pointerType: "mouse", button: 1 })).toBe("cancel");
    expect(heldFor(FOLLOW_HOLD_MS, { pointerType: "mouse", button: 2 })).toBe("cancel");
    expect(heldFor(10, { pointerType: "mouse", button: 0 })).toBe("tap");
  });

  it("觸控與觸控筆的主要接觸點（button 0 或 -1）算主鍵", () => {
    expect(isPrimaryPointerButton("touch", 0)).toBe(true);
    expect(isPrimaryPointerButton("pen", -1)).toBe(true);
    expect(isPrimaryPointerButton("mouse", -1)).toBe(false);
    expect(isPrimaryPointerButton("pen", 5)).toBe(false);
  });

  it("pointercancel／視窗失焦一律取消，不會補成點一下或跟拍", () => {
    expect(heldFor(10, { cancelled: true })).toBe("cancel");
    expect(heldFor(FOLLOW_HOLD_MS + 500, { cancelled: true })).toBe("cancel");
  });

  it("沒按在任何居民身上就不是這條路徑的事", () => {
    expect(heldFor(10, { hitCharacterId: null })).toBe("cancel");
    expect(heldFor(FOLLOW_HOLD_MS, { hitCharacterId: null })).toBe("cancel");
  });

  it("時鐘倒退或位移判不出來時 fail closed，不猜成點一下", () => {
    expect(heldFor(-5)).toBe("cancel");
    expect(heldFor(10, { travelPx: Number.NaN })).toBe("cancel");
    expect(classifyPointerGesture({ ...BASE, upAt: Number.NaN })).toBe("cancel");
  });

  it("位移用兩點距離；座標壞掉就當成走了無限遠", () => {
    expect(pointerTravelPx(0, 0, 3, 4)).toBe(5);
    expect(pointerTravelPx(10, 10, 10, 10)).toBe(0);
    expect(pointerTravelPx(0, 0, Number.NaN, 0)).toBe(Number.POSITIVE_INFINITY);
    expect(classifyPointerGesture({ ...BASE, travelPx: pointerTravelPx(0, 0, Number.NaN, 0) })).toBe(
      "cancel",
    );
  });

  it("判成 tap 之後接上狀態機，得到與鍵盤選取列相同的結果", () => {
    // 畫面層在 pointerup 做的事：先 release，再依判定送 openMenu。
    const at = 120;
    const outcome = classifyPointerGesture({ ...BASE, downAt: 0, upAt: at });
    expect(outcome).toBe("tap");

    const afterTap = run([
      { kind: "press", characterId: SUBJECT, at: 0 },
      { kind: "release", at },
      { kind: "openMenu", characterId: SUBJECT, at },
    ]);
    const byKeyboard = run([{ kind: "openMenu", characterId: SUBJECT, at }]);

    expect(afterTap.menuFor).toBe(SUBJECT);
    expect(afterTap.phase).toBe("idle");
    // `phaseSince` 只記錄「何時進到 idle」，短按多走了一次 press／release 所以會不同；
    // 對使用者可見的結果（選取列開在誰身上、鏡頭在哪）兩條路徑完全一致。
    expect({ ...afterTap, phaseSince: 0 }).toEqual({ ...byKeyboard, phaseSince: 0 });
  });

  it("判成 follow 時不會誤開選取列：openMenu 在非 idle 是 no-op", () => {
    const camera = run([
      { kind: "press", characterId: SUBJECT, at: 0 },
      { kind: "tick", at: FOLLOW_HOLD_MS },
      { kind: "release", at: FOLLOW_HOLD_MS + 10 },
    ]);
    expect(camera.phase).toBe("releasing");
    expect(reduceFollow(camera, { kind: "openMenu", characterId: SUBJECT, at: 300 })).toBe(camera);
  });
});
