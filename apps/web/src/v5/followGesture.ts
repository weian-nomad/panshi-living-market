// 跟拍手勢狀態機（純函式，不碰 DOM、不讀時鐘、不打 API）。
//
// 規則逐條來自 `docs/v5/experience-spec.md` §6.1；所有時間常數一律 import
// `./motion`，本檔不自訂任何毫秒數字。
//
//   按住居民達 `FOLLOW_HOLD_MS`            → 成立跟拍
//   保持按住並拖向他正在注意的人 `FOLLOW_HANDOFF_MS` → 交接鏡頭
//   放開後保留 `FOLLOW_RELEASE_HOLD_MS`     → 再回全景
//   回全景後保留 `CLOSEUP_CTA_PERSIST_MS`   → 「再靠近一點」入口
//
// 鍵盤／螢幕閱讀器／Switch Control 走同一顆狀態機：點一下（或 Enter／Space）開啟
// `[開始跟拍][看他的近況][取消]` 選取列，選「開始跟拍」得到**與長按完全相同**的
// 狀態（experience-spec §6.1：「這是等價操作，不是較低階版本」）。單元測試把兩條
// 路徑的結果直接對拍。
//
// 時間由呼叫端傳入（`at`），這樣測試不需要假時鐘，元件則用單調時鐘。

import {
  CLOSEUP_CTA_PERSIST_MS,
  FOLLOW_HANDOFF_MS,
  FOLLOW_HOLD_MS,
  FOLLOW_RELEASE_HOLD_MS,
} from "./motion";

/** experience-spec §6.1 的五個鏡頭階段。選取列是覆蓋層，不是第六個階段。 */
export type FollowPhase = "idle" | "pressing" | "following" | "handoff" | "releasing";

export type FollowMenuChoice = "follow" | "closeUp" | "cancel";

export type FollowState = {
  phase: FollowPhase;
  /** 鏡頭目前跟住的人；`idle` 時為 null。 */
  subjectId: string | null;
  /** 進入目前 phase 的時間（呼叫端的單調時鐘，毫秒）。 */
  phaseSince: number;
  /** 交接目標；只有 `handoff` 階段非 null。 */
  handoffTargetId: string | null;
  /** 選取列開在誰身上（鍵盤／AT 等價路徑）。 */
  menuFor: string | null;
  /** 回全景後暫時保留的「再靠近一點」入口。 */
  cta: { characterId: string; since: number } | null;
};

export type FollowEvent =
  | { kind: "press"; characterId: string; at: number }
  /** 按住不放並拖向另一個人；拖到空處或拖回自己時 `characterId` 為 null／同一人。 */
  | { kind: "dragTo"; characterId: string | null; at: number }
  | { kind: "release"; at: number }
  /** 時間推進；所有門檻只在 tick 時判定，狀態機本身不讀時鐘。 */
  | { kind: "tick"; at: number }
  | { kind: "openMenu"; characterId: string; at: number }
  | { kind: "menuChoice"; choice: FollowMenuChoice; at: number }
  /** Escape、指標取消、視窗失焦。 */
  | { kind: "cancel"; at: number };

export const INITIAL_FOLLOW_STATE: FollowState = {
  phase: "idle",
  subjectId: null,
  phaseSince: 0,
  handoffTargetId: null,
  menuFor: null,
  cta: null,
};

export function initialFollowState(): FollowState {
  return INITIAL_FOLLOW_STATE;
}

function startFollowing(characterId: string, at: number): FollowState {
  return {
    phase: "following",
    subjectId: characterId,
    phaseSince: at,
    handoffTargetId: null,
    menuFor: null,
    // 已經在跟拍時，不需要同時掛著「再靠近一點」的殘影。
    cta: null,
  };
}

function goIdle(at: number, cta: FollowState["cta"]): FollowState {
  return {
    phase: "idle",
    subjectId: null,
    phaseSince: at,
    handoffTargetId: null,
    menuFor: null,
    cta,
  };
}

function expireCta(state: FollowState, at: number): FollowState {
  if (state.cta === null) return state;
  if (at - state.cta.since < CLOSEUP_CTA_PERSIST_MS) return state;
  return { ...state, cta: null };
}

/**
 * 純 reducer。沒有任何狀態改變時**回傳同一個 reference**，元件才能安全地把
 * state 當成 effect 依賴（交接 no-op 也靠這個性質被測到）。
 */
export function reduceFollow(state: FollowState, event: FollowEvent): FollowState {
  switch (event.kind) {
    case "press": {
      // 按下就是新的一次跟拍嘗試：關掉選取列，也收掉上一次的 CTA。
      if (state.phase !== "idle") return state;
      return {
        phase: "pressing",
        subjectId: event.characterId,
        phaseSince: event.at,
        handoffTargetId: null,
        menuFor: null,
        cta: null,
      };
    }

    case "tick": {
      switch (state.phase) {
        case "pressing": {
          if (state.subjectId === null) return state;
          if (event.at - state.phaseSince < FOLLOW_HOLD_MS) return state;
          return startFollowing(state.subjectId, event.at);
        }
        case "handoff": {
          if (state.handoffTargetId === null) return state;
          if (event.at - state.phaseSince < FOLLOW_HANDOFF_MS) return state;
          return startFollowing(state.handoffTargetId, event.at);
        }
        case "releasing": {
          if (event.at - state.phaseSince < FOLLOW_RELEASE_HOLD_MS) return state;
          // 回到全景，剛跟拍的人身旁保留「再靠近一點」。
          const cta = state.subjectId === null ? null : { characterId: state.subjectId, since: event.at };
          return goIdle(event.at, cta);
        }
        case "idle":
          return expireCta(state, event.at);
        case "following":
          return state;
      }
      return state;
    }

    case "dragTo": {
      // 只有「按住並拖向他正在注意的人」才交接。單角切片沒有第二個目標，
      // 這條路徑必須是安全 no-op：回傳原 state，不改階段、不清掉鏡頭主體。
      if (state.phase !== "following") return state;
      if (event.characterId === null) return state;
      if (event.characterId === state.subjectId) return state;
      return {
        ...state,
        phase: "handoff",
        phaseSince: event.at,
        handoffTargetId: event.characterId,
      };
    }

    case "release": {
      switch (state.phase) {
        case "pressing":
          // 沒按滿就放開：不成立跟拍，也不留 CTA（那是點一下的選取列職責）。
          return goIdle(event.at, state.cta);
        case "following":
        case "handoff":
          // 放開後仍保留當前人物一段時間，再回全景。
          return { ...state, phase: "releasing", phaseSince: event.at, handoffTargetId: null };
        default:
          return state;
      }
    }

    case "openMenu": {
      if (state.phase !== "idle") return state;
      if (state.menuFor === event.characterId) return state;
      return { ...state, menuFor: event.characterId };
    }

    case "menuChoice": {
      if (state.menuFor === null) return state;
      if (event.choice === "follow") {
        return startFollowing(state.menuFor, event.at);
      }
      // 「看他的近況」的導覽由畫面層處理（見 `menuChoiceOpensCloseUp`）；
      // 狀態機只負責關掉選取列，不替路由做決定。
      return { ...state, menuFor: null };
    }

    case "cancel": {
      switch (state.phase) {
        case "pressing":
          return goIdle(event.at, state.cta);
        case "following":
        case "handoff":
          return { ...state, phase: "releasing", phaseSince: event.at, handoffTargetId: null, menuFor: null };
        default:
          return state.menuFor === null ? state : { ...state, menuFor: null };
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 指標手勢判定（純函式）
//
// 為什麼要自己判、而不是靠瀏覽器原生 click：舞台在 pointerdown 就
// `setPointerCapture`（否則指標移出視窗後收不到 pointerup，長按會卡在 pressing，
// 之後還會被計時器誤判成跟拍）。但一旦抓住指標，Chromium 會把接下來的 `click`
// 改派給舞台而不是居民 `<button>`，居民的 onClick 永遠不會觸發——短按開選取列這條路
// 就整條斷掉。所以「按下↔放開」由這裡判定，畫面層再據此直接送 `openMenu`。
//
// 鍵盤／螢幕閱讀器不經過這裡：Enter／Space 直接觸發按鈕的 click，與指標無關。
// ---------------------------------------------------------------------------

/**
 * 短按容許的最大位移（CSS px）。超過就不是「點一下」——手指或滑鼠已經在拖了。
 * 觸控的抖動通常在數 px 內，取 10 px 讓不穩的手也點得到，又不會把拖曳讀成點擊。
 */
export const TAP_MOVE_TOLERANCE_PX = 10;

export type PointerGestureOutcome = "tap" | "follow" | "cancel";

export type PointerGestureSample = {
  /** pointerdown 的單調時鐘毫秒。 */
  downAt: number;
  /** pointerup 的單調時鐘毫秒。 */
  upAt: number;
  /** 按下點到放開點之間走過的最大距離（CSS px）。 */
  travelPx: number;
  /** `PointerEvent.pointerType`：mouse／touch／pen。 */
  pointerType: string;
  /** pointerdown 當下的 `PointerEvent.button`。 */
  button: number;
  /** 按下當時命中的居民；沒命中就是 null。 */
  hitCharacterId: string | null;
  /** 收到 pointercancel、視窗失焦，或指標被系統收走。 */
  cancelled: boolean;
};

/**
 * 只有主鍵能開始一次手勢。滑鼠右鍵／中鍵／側鍵一律不算——右鍵是叫出系統選單，
 * 不是「跟這個人走一段」。觸控與觸控筆的主要接觸點回報 button 0（部分實作回報 -1）。
 */
export function isPrimaryPointerButton(pointerType: string, button: number): boolean {
  return pointerType === "mouse" ? button === 0 : button <= 0;
}

/** 兩點距離。任何一個座標不是有限數就當成「走了無限遠」，寧可不判成點擊。 */
export function pointerTravelPx(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): number {
  const distance = Math.hypot(toX - fromX, toY - fromY);
  return Number.isFinite(distance) ? distance : Number.POSITIVE_INFINITY;
}

/**
 * 一次指標互動的結果：
 *   `follow` —— 按滿 `FOLLOW_HOLD_MS`，長按成立（拖曳交接也在這一類）。
 *   `tap`    —— 沒按滿、也幾乎沒移動：等價於點一下，畫面層開選取列。
 *   `cancel` —— 其餘一切：非主鍵、沒命中人、短按但已經在拖、被取消、時鐘倒退。
 *
 * 門檻沿用 `motion.ts` 的 `FOLLOW_HOLD_MS`，本檔不另設毫秒數字：
 * 恰好 180 ms 就是長按（與狀態機 `tick` 的 `>=` 判定同一條線），179 ms 是點一下。
 */
export function classifyPointerGesture(sample: PointerGestureSample): PointerGestureOutcome {
  if (sample.cancelled) return "cancel";
  if (!isPrimaryPointerButton(sample.pointerType, sample.button)) return "cancel";
  if (sample.hitCharacterId === null) return "cancel";

  const heldMs = sample.upAt - sample.downAt;
  if (!Number.isFinite(heldMs) || heldMs < 0) return "cancel";
  if (heldMs >= FOLLOW_HOLD_MS) return "follow";

  // NaN 的位移也走這裡：判不出來就不當成點擊（fail closed）。
  if (!(sample.travelPx <= TAP_MOVE_TOLERANCE_PX)) return "cancel";

  return "tap";
}

/** 「看他的近況」是唯一會離開世界畫面的選項。 */
export function menuChoiceOpensCloseUp(choice: FollowMenuChoice): boolean {
  return choice === "closeUp";
}

/** 鏡頭是否正貼著某個人（跟拍中、交接中或放開後的保留期）。 */
export function isCameraOnSubject(state: FollowState): boolean {
  return state.phase === "following" || state.phase === "handoff" || state.phase === "releasing";
}

/** 目前應該顯示「再靠近一點」的對象：跟拍中是主體，回全景後是剛剛那個人。 */
export function closeUpCtaCharacterId(state: FollowState): string | null {
  if (isCameraOnSubject(state)) return state.subjectId;
  return state.cta?.characterId ?? null;
}

/**
 * 下一個時間門檻（呼叫端據此排一次 timeout，不需要每幀輪詢）。
 * 沒有待判定門檻時回傳 null。
 */
export function nextFollowDeadline(state: FollowState): number | null {
  switch (state.phase) {
    case "pressing":
      return state.phaseSince + FOLLOW_HOLD_MS;
    case "handoff":
      return state.phaseSince + FOLLOW_HANDOFF_MS;
    case "releasing":
      return state.phaseSince + FOLLOW_RELEASE_HOLD_MS;
    case "idle":
      return state.cta === null ? null : state.cta.since + CLOSEUP_CTA_PERSIST_MS;
    case "following":
      return null;
  }
}
