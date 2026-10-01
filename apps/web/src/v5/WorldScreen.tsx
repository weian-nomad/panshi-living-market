// 公共世界（開盤廳）畫面。
//
// 資料來源是 `apiClient.fetchWorld()` 的 `WorldSnapshot`（由外殼 `SliceApp` 取得後
// 傳入，整個切片只發一次請求）；幾何全部來自 `./scene`，不含任何圖片資產。
//
// 產品不變式（experience-spec.md §5.2、market-safety.md、AGENTS.md）：
// - 沒有全員總覽、排行、選股器、密集財務圖，也沒有「今日主角」與自動切鏡。
// - 世界畫面不出現任何市場數字；Ticker、漲跌與來源只在點開事實物件後才有。
// - 冷色 `--signal-420` 只在「新市場事實抵達」時亮，不表示漲跌好壞。
//
// 互動：長按進跟拍走 `./followGesture`（純狀態機），命中判定用既有的
// `../interaction` `hitTestWorldPoint`（system-design.md §18.2 保留的 primitive）。
// 點一下（滑鼠、Enter、Space、螢幕閱讀器）開啟等價的 `[開始跟拍][看他的近況][取消]`
// 選取列，兩條路徑進到同一顆狀態機、得到同一個結果。
//
// 指標路徑刻意**不依賴原生 click**：舞台在 pointerdown 就 `setPointerCapture`
//（否則指標移出視窗後收不到 pointerup，長按會卡在 pressing，計時器還會把它誤判成
// 跟拍），而抓住指標之後 Chromium 會把 `click` 改派給舞台、居民 `<button>` 的 onClick
// 永遠不會觸發。所以短按由 `classifyPointerGesture` 自行判定後直接送 `openMenu`；
// 按鈕的 onClick 只留給鍵盤與螢幕閱讀器（Enter／Space 不經過指標，不受 capture 影響）。
//
// 所有時間與明度常數 import `./motion`，本檔不寫字面數值。

import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";

import type { MarketSessionPhase, WorldSnapshot } from "../api/generated-v2/types.gen";
import { hitTestWorldPoint, type WorldPoint } from "../interaction";
import { FollowLayer, offscreenDimStyle } from "./FollowLayer";
import { ITEM_TRUTH_CLASS_EXPLANATION } from "./ItemTruthTag";
import { TruthTag } from "./TruthTag";
import { MISSING_CLAIM_TRUTH_CLASS_TEXT } from "./claimTruth";
import { DATA_UNAVAILABLE_LABEL, formatAsOfIntraday, truthClassLabel, projectionVersionLabel } from "./format";
import {
  INITIAL_FOLLOW_STATE,
  classifyPointerGesture,
  closeUpCtaCharacterId,
  isCameraOnSubject,
  isPrimaryPointerButton,
  menuChoiceOpensCloseUp,
  nextFollowDeadline,
  pointerTravelPx,
  reduceFollow,
  type FollowMenuChoice,
} from "./followGesture";
import { WORLD_BREATH_MS } from "./motion";
import { EmptyStatePanel } from "./statePanels";
import { SystemLabel } from "./SystemLabel";
import {
  BACKDROP_SHAPES,
  COPPER_RULES,
  EDGE_SILHOUETTES,
  FOREGROUND_RULES,
  FOREGROUND_SHAPES,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  captionAnchor,
  facingFromX,
  figureGeometry,
  marketSignal,
  silhouetteGeometry,
  unrenderablePositionCount,
  worldFigures,
  worldTargets,
  type EdgeSilhouette,
  type SceneFigure,
} from "./scene";

const STYLES = `
.v5-world { margin: 0 0 16px; }
.v5-stage { aspect-ratio: ${STAGE_WIDTH} / ${STAGE_HEIGHT}; }
.v5-world__banner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin: 0 0 12px;
}
.v5-world__banner p { margin: 0; }
.v5-world__clock {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 18px;
  margin: 0 0 10px;
  padding: 0;
  list-style: none;
  font-size: .8rem;
}
.v5-world__clock div { display: flex; gap: .5em; }
.v5-world__clock dt { color: var(--copper-500); }
.v5-world__clock dd { margin: 0; }
.v5-stage {
  position: relative;
  width: 100%;
  border: 1px solid var(--rule-paper);
  background: var(--surface-world);
  overflow: hidden;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}
.v5-stage__svg { display: block; width: 100%; height: 100%; }
.v5-stage__offscreen { opacity: var(--v5-offscreen-dim, 1); }
.v5-stage__breath { transform-box: fill-box; transform-origin: center bottom; }
.v5-stage__resident-hit {
  position: absolute;
  transform: translate(-50%, 0);
  padding: 0;
  border: 1px solid transparent;
  border-radius: 3px;
  background: transparent;
  color: var(--paper-100);
  font: inherit;
  cursor: pointer;
}
.v5-stage__resident-hit:hover { border-color: var(--copper-500); }
.v5-stage__resident-hit:focus-visible { outline: 2px solid var(--signal-420); outline-offset: 2px; }
/* 遠處字幕永遠夾在舞台內：靠邊時翻邊（改成靠邊對齊往內展開），中間才置中。
   max-width 用 min() 夾住，任何錨點都不會頂出舞台左右緣。 */
.v5-stage__caption {
  position: absolute;
  max-width: min(44%, 26ch);
  font-size: .72rem;
  line-height: 1.5;
  color: var(--paper-260);
  text-wrap: balance;
  pointer-events: none;
}
.v5-stage__caption[data-anchor="center"] { transform: translate(-50%, 0); text-align: center; }
.v5-stage__caption[data-anchor="start"] { text-align: start; }
.v5-stage__caption[data-anchor="end"] { text-align: end; }
.v5-stage__signal {
  position: absolute;
  inset-block-start: 8px;
  inset-inline-end: 8px;
  display: flex;
  align-items: center;
  gap: .45em;
  padding: .25em .6em;
  border: 1px solid var(--signal-420);
  border-radius: 2px;
  color: var(--signal-420);
  font-size: .72rem;
}
.v5-sr-only {
  position: absolute;
  width: 1px; height: 1px;
  margin: -1px; padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.v5-world__hint { margin: 10px 0 0; font-size: .82rem; color: var(--copper-500); }
.v5-world__menu {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin: 10px 0 0;
}
.v5-world__menu p { margin: 0; font-size: .82rem; }
.v5-world__menu button, .v5-world__cta {
  min-height: 44px;
  padding: .35em 1em;
  border: 1px solid var(--copper-500);
  border-radius: 2px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.v5-world__menu button:focus-visible,
.v5-world__cta:focus-visible { outline: 2px solid var(--signal-420); outline-offset: 2px; }
.v5-world__cta { margin: 10px 0 0; }
@keyframes v5-breath {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-.35%); }
}
`;

const SESSION_PHASE_LABEL: Readonly<Record<MarketSessionPhase, string>> = {
  pre_market: "盤前",
  in_session: "盤中",
  after_session: "收盤後",
  night: "夜間",
  non_trading_day: "休市日",
};

const MENU_CHOICES: readonly { choice: FollowMenuChoice; label: string }[] = [
  { choice: "follow", label: "開始跟拍" },
  { choice: "closeUp", label: "看他的近況" },
  { choice: "cancel", label: "取消" },
];

/** 字幕壓在腳邊下方一點，不穿過身體，也不貼到前景長桌上。 */
const CAPTION_FOOT_GAP = 1.4;

function monotonicNow(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function percent(value: number, total: number): string {
  return `${(value / total) * 100}%`;
}

function asOfText(asOfTradingDate: string | null): string {
  if (asOfTradingDate === null) return DATA_UNAVAILABLE_LABEL;
  try {
    return formatAsOfIntraday(asOfTradingDate);
  } catch {
    return DATA_UNAVAILABLE_LABEL;
  }
}

/** 世界快照沒有姓名欄位，所以介面**不得**自行編一個名字。 */
function figureLabel(figure: SceneFigure): string {
  return figure.hookLabel ?? "一名居民";
}

/**
 * 一名居民：淺色關節骨架（頭、軀幹、兩條腿、一隻手臂、一件生活物件）。
 * 剪影另走 `Silhouette`——兩者是**不同形狀**，不是同一個形狀降透明度。
 */
function Figure({ figure, breathing }: { figure: SceneFigure; breathing: boolean }) {
  const geometry = figureGeometry(figure.footX, figure.footY, figure.height);
  const fill = "var(--paper-260)";

  return (
    <g
      className={breathing ? "v5-stage__breath" : undefined}
      style={
        breathing
          ? { animation: `v5-breath ${WORLD_BREATH_MS}ms ease-in-out infinite` }
          : undefined
      }
      aria-hidden="true"
    >
      <ellipse
        cx={geometry.contact.cx}
        cy={geometry.contact.cy}
        rx={geometry.contact.rx}
        ry={geometry.contact.ry}
        fill="var(--ink-1000)"
        opacity="0.55"
      />
      <polygon points={geometry.torso} fill={fill} opacity={0.9} />
      {geometry.legs.map((leg, index) => (
        <rect
          key={`${figure.characterId}-leg-${index}`}
          x={leg.x}
          y={leg.y}
          width={leg.width}
          height={leg.height}
          fill="var(--ink-760)"
        />
      ))}
      <polyline
        points={geometry.arm}
        fill="none"
        stroke={fill}
        strokeWidth="0.5"
        strokeLinecap="round"
        opacity={0.9}
      />
      <rect
        x={geometry.prop.x}
        y={geometry.prop.y}
        width={geometry.prop.width}
        height={geometry.prop.height}
        fill="var(--copper-500)"
        opacity={0.85}
      />
      <circle cx={geometry.head.cx} cy={geometry.head.cy} r={geometry.head.r} fill={fill} />
    </g>
  );
}

/**
 * 背景剪影：一體成形的深色柱體 ＋ 一道極弱的邊光。
 * 與居民的差別是**輪廓**（沒有獨立頭部、沒有分腿、沒有手臂與物件）與**明暗方向**
 * （深色壓在地板上，居民是淺色），不是只靠 opacity——小尺寸下 opacity 分不出來。
 */
function Silhouette({
  id,
  footX,
  footY,
  height,
  facing,
}: {
  id: string;
  footX: number;
  footY: number;
  height: number;
  facing: EdgeSilhouette["facing"];
}) {
  const geometry = silhouetteGeometry(footX, footY, height, facing);

  return (
    <g aria-hidden="true" data-silhouette={id}>
      <ellipse
        cx={geometry.contact.cx}
        cy={geometry.contact.cy}
        rx={geometry.contact.rx}
        ry={geometry.contact.ry}
        fill="var(--ink-1000)"
        opacity="0.7"
      />
      <path
        d={geometry.body}
        fill="var(--ink-1000)"
        stroke="var(--paper-260)"
        strokeWidth="0.22"
        strokeOpacity="0.22"
      />
    </g>
  );
}

export type WorldScreenProps = {
  snapshot: WorldSnapshot;
  onOpenCloseUp: (characterId: string) => void;
};

/** 一次進行中的指標互動。放開時交給 `classifyPointerGesture` 判成 tap／follow／cancel。 */
type ActivePointer = {
  pointerId: number;
  characterId: string;
  downAt: number;
  downX: number;
  downY: number;
  /** 這次互動至今離按下點的最大距離（CSS px）。 */
  travelPx: number;
  pointerType: string;
  button: number;
};

export function WorldScreen({ snapshot, onOpenCloseUp }: WorldScreenProps) {
  const [follow, dispatch] = useReducer(reduceFollow, INITIAL_FOLLOW_STATE);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLButtonElement | null>(null);
  const pointerRef = useRef<ActivePointer | null>(null);

  const figures = useMemo(() => worldFigures(snapshot), [snapshot]);
  const targets = useMemo(() => worldTargets(snapshot), [snapshot]);
  const signal = marketSignal(snapshot);
  const skipped = unrenderablePositionCount(snapshot);
  const withheldClaims = figures.reduce((total, figure) => total + figure.withheldClaimCount, 0);
  const cameraOnSubject = isCameraOnSubject(follow);
  const ctaCharacterId = closeUpCtaCharacterId(follow);
  // 跟拍層只認得三個鏡頭階段；其餘階段沒有鏡頭主體可畫。
  const cameraPhase =
    follow.phase === "following" || follow.phase === "handoff" || follow.phase === "releasing"
      ? follow.phase
      : null;

  // 門檻只在需要時排一次 timeout；沒有待判定門檻就完全不跑計時器。
  useEffect(() => {
    const deadline = nextFollowDeadline(follow);
    if (deadline === null) return;
    const delay = Math.max(0, deadline - monotonicNow());
    const timer = window.setTimeout(() => dispatch({ kind: "tick", at: monotonicNow() }), delay);
    return () => window.clearTimeout(timer);
  }, [follow]);

  useEffect(() => {
    if (follow.menuFor !== null) menuRef.current?.focus();
  }, [follow.menuFor]);

  // 視窗失焦（alt-tab、切到別的 app）時，正在進行的按壓收不到 pointerup。
  // 不收掉的話狀態會卡在 pressing，計時器還會把它誤判成跟拍。
  // `FollowEvent.cancel` 的定義本來就含「視窗失焦」。
  useEffect(() => {
    const abandonPointer = () => {
      if (pointerRef.current === null) return;
      pointerRef.current = null;
      dispatch({ kind: "cancel", at: monotonicNow() });
    };
    window.addEventListener("blur", abandonPointer);
    return () => window.removeEventListener("blur", abandonPointer);
  }, []);

  const stagePoint = useCallback((clientX: number, clientY: number): WorldPoint | null => {
    const stage = stageRef.current;
    if (!stage) return null;
    const rect = stage.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: ((clientX - rect.left) / rect.width) * STAGE_WIDTH,
      y: ((clientY - rect.top) / rect.height) * STAGE_HEIGHT,
    };
  }, []);

  const hitAt = useCallback(
    (clientX: number, clientY: number): string | null => {
      const point = stagePoint(clientX, clientY);
      if (point === null) return null;
      return hitTestWorldPoint(point, targets);
    },
    [stagePoint, targets],
  );

  const header = (
    <>
      <div className="v5-world__banner">
        <p className="panshi-paper">
          一名角色垂直切片：這個世界目前只封存了一個人的完整人生，其餘是無資料的背景。
        </p>
        {/* 這份世界投影自己宣告用到的資料身分；各項線索另外逐項掛自己的身分。 */}
        {snapshot.truthClasses.map((truthClass) => (
          <TruthTag
            key={truthClass}
            truthClass={truthClass}
            explanation={ITEM_TRUTH_CLASS_EXPLANATION[truthClass]}
            asOfLabel={asOfText(snapshot.marketClock.asOfTradingDate)}
            versionLabel={projectionVersionLabel(snapshot)}
          />
        ))}
      </div>

      {/* public-v2 3.0.0：kill switch 暫停今日五幕或居民今天的焦點時，只畫投影給的固定系統說明。 */}
      {typeof snapshot.marketClosureReasonLabel === "string" ? (
        <SystemLabel field="marketClosureReasonLabel" text={snapshot.marketClosureReasonLabel} />
      ) : null}

      <dl className="v5-world__clock panshi-data">
        <div>
          <dt>場景日期</dt>
          <dd>{snapshot.marketClock.marketDate}</dd>
        </div>
        <div>
          <dt>時段</dt>
          <dd>{SESSION_PHASE_LABEL[snapshot.marketClock.sessionPhase]}</dd>
        </div>
        <div>
          <dt>資料時間</dt>
          <dd>{asOfText(snapshot.marketClock.asOfTradingDate)}</dd>
        </div>
      </dl>
    </>
  );

  // 空世界：專門的面板，不是一塊沒有人的白舞台（experience-spec §17.1 `SCENE_EMPTY`）。
  // 所有 hook 都已在上面呼叫完，這裡提早回傳不違反 hook 順序。
  if (snapshot.characterPositions.length === 0) {
    return (
      <section className="v5-world" aria-label="公共世界">
        <style>{STYLES}</style>
        {header}
        <EmptyStatePanel reason="world_no_residents" />
      </section>
    );
  }

  return (
    <section className="v5-world" aria-label="公共世界">
      <style>{STYLES}</style>

      {header}

      <div
        className="v5-stage"
        ref={stageRef}
        style={offscreenDimStyle(cameraOnSubject)}
        onPointerDown={(event) => {
          if (!isPrimaryPointerButton(event.pointerType, event.button)) return;
          const id = hitAt(event.clientX, event.clientY);
          // 沒按在人身上：這次不抓指標，原生 click 照常抵達按鈕（按鈕的可點區域比
          // 命中橢圓大一點，邊角仍要能開選取列）。
          if (id === null) return;
          pointerRef.current = {
            pointerId: event.pointerId,
            characterId: id,
            downAt: monotonicNow(),
            downX: event.clientX,
            downY: event.clientY,
            travelPx: 0,
            pointerType: event.pointerType,
            button: event.button,
          };
          // 抓住指標，移出視窗也收得到 pointerup／pointercancel；代價是原生 click
          // 會被改派給舞台，所以短按改由 onPointerUp 自行判定。
          event.currentTarget.setPointerCapture(event.pointerId);
          dispatch({ kind: "press", characterId: id, at: monotonicNow() });
        }}
        onPointerMove={(event) => {
          const active = pointerRef.current;
          if (active !== null && active.pointerId === event.pointerId) {
            active.travelPx = Math.max(
              active.travelPx,
              pointerTravelPx(active.downX, active.downY, event.clientX, event.clientY),
            );
          }
          if (follow.phase !== "following") return;
          dispatch({
            kind: "dragTo",
            characterId: hitAt(event.clientX, event.clientY),
            at: monotonicNow(),
          });
        }}
        onPointerUp={(event) => {
          const at = monotonicNow();
          const active = pointerRef.current;
          if (active === null || active.pointerId !== event.pointerId) {
            dispatch({ kind: "release", at });
            return;
          }
          pointerRef.current = null;

          const outcome = classifyPointerGesture({
            downAt: active.downAt,
            upAt: at,
            travelPx: Math.max(
              active.travelPx,
              pointerTravelPx(active.downX, active.downY, event.clientX, event.clientY),
            ),
            pointerType: active.pointerType,
            button: active.button,
            hitCharacterId: active.characterId,
            cancelled: false,
          });

          // 先收掉按壓（未達門檻→回全景；已成立→進入放開後的保留期）。
          dispatch({ kind: "release", at });
          // 短按＝點一下：開等價選取列。`openMenu` 只在 idle 生效，長按後不會誤開。
          if (outcome === "tap") {
            dispatch({ kind: "openMenu", characterId: active.characterId, at });
          }
        }}
        onPointerCancel={() => {
          pointerRef.current = null;
          dispatch({ kind: "cancel", at: monotonicNow() });
        }}
        onLostPointerCapture={() => {
          // 正常放開時 `onPointerUp` 已經把 ref 清掉；還在的話代表指標被系統收走。
          if (pointerRef.current === null) return;
          pointerRef.current = null;
          dispatch({ kind: "cancel", at: monotonicNow() });
        }}
        onContextMenu={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          if (event.key === "Escape") dispatch({ kind: "cancel", at: monotonicNow() });
        }}
      >
        <svg
          className="v5-stage__svg"
          viewBox={`0 0 ${STAGE_WIDTH} ${STAGE_HEIGHT}`}
          preserveAspectRatio="xMidYMid meet"
          role="presentation"
        >
          {/* 場景底層：後牆、兩道側牆、墨黑地板、兩扇窗與窗光、氧化銅欄杆。
              沒有光圈、沒有聚光，窗光不跟著任何人移動。 */}
          <g className={cameraOnSubject ? "v5-stage__offscreen" : undefined}>
            {BACKDROP_SHAPES.map((shape) => (
              <polygon
                key={shape.id}
                points={shape.points}
                fill={`var(${shape.fillVar})`}
                opacity={shape.opacity}
              />
            ))}
            {COPPER_RULES.map((rule) => (
              <line
                key={rule.id}
                x1={rule.x1}
                y1={rule.y1}
                x2={rule.x2}
                y2={rule.y2}
                stroke="var(--copper-500)"
                strokeWidth="0.18"
                opacity="0.7"
              />
            ))}
            {EDGE_SILHOUETTES.map((silhouette) => (
              <Silhouette
                key={silhouette.id}
                id={silhouette.id}
                footX={silhouette.footX}
                footY={silhouette.footY}
                height={silhouette.height}
                facing={silhouette.facing}
              />
            ))}
          </g>

          {figures.map((figure) => {
            const isSubject = cameraOnSubject && follow.subjectId === figure.characterId;
            return (
              <g
                key={figure.characterId}
                className={cameraOnSubject && !isSubject ? "v5-stage__offscreen" : undefined}
              >
                {figure.kind === "silhouette" ? (
                  <Silhouette
                    id={figure.characterId}
                    footX={figure.footX}
                    footY={figure.footY}
                    height={figure.height}
                    facing={facingFromX(figure.footX)}
                  />
                ) : (
                  <Figure figure={figure} breathing />
                )}
              </g>
            );
          })}

          {/* 前景長桌：畫在人物之後，蓋住最前排的腳，下緣才不是一片空地板。 */}
          <g className={cameraOnSubject ? "v5-stage__offscreen" : undefined}>
            {FOREGROUND_SHAPES.map((shape) => (
              <polygon
                key={shape.id}
                points={shape.points}
                fill={`var(${shape.fillVar})`}
                opacity={shape.opacity}
              />
            ))}
            {FOREGROUND_RULES.map((rule) => (
              <line
                key={rule.id}
                x1={rule.x1}
                y1={rule.y1}
                x2={rule.x2}
                y2={rule.y2}
                stroke="var(--copper-500)"
                strokeWidth="0.22"
                opacity="0.75"
              />
            ))}
          </g>
        </svg>

        {/* 鍵盤／螢幕閱讀器的等價入口：每位可跟拍居民一個真正的按鈕。 */}
        {figures
          .filter((figure) => figure.kind === "resident")
          .map((figure) => (
            <button
              key={figure.characterId}
              type="button"
              className="v5-stage__resident-hit"
              style={{
                left: percent(figure.footX, STAGE_WIDTH),
                top: percent(figure.footY - figure.height, STAGE_HEIGHT),
                width: percent(figure.height * 0.5, STAGE_WIDTH),
                height: percent(figure.height, STAGE_HEIGHT),
              }}
              aria-haspopup="true"
              aria-expanded={follow.menuFor === figure.characterId}
              // 鍵盤（Enter／Space）、螢幕閱讀器與 Switch Control 都只會送出 click，
              // 沒有 keydown 可以先攔。所以這條路徑**不設任何前置旗標**：
              // 誤觸的防護由狀態機自己做——`openMenu` 只在 idle 生效，長按成立後是 no-op；
              // 對同一個人重複開也回傳同一個 state。指標路徑重複送一次也不會開兩次。
              onClick={() => {
                dispatch({ kind: "openMenu", characterId: figure.characterId, at: monotonicNow() });
              }}
            >
              <span className="v5-sr-only">
                {figureLabel(figure)}
                {figure.hookTruthClass === null ? "" : `（${truthClassLabel(figure.hookTruthClass)}）`}
                {figure.focusHint === null || figure.focusHintTruthClass === null
                  ? ""
                  : `，${figure.focusHint}（${truthClassLabel(figure.focusHintTruthClass)}）`}
              </span>
            </button>
          ))}

        {/* 遠處字幕：跟拍時退場（experience-spec §6.3）。 */}
        {cameraOnSubject
          ? null
          : figures
              .filter((figure) => figure.kind === "resident" && figure.hookLabel !== null)
              .map((figure) => {
                const anchor = captionAnchor(figure.footX);
                return (
                  <p
                    key={`${figure.characterId}-caption`}
                    className="v5-stage__caption panshi-paper"
                    data-anchor={anchor.side}
                    data-truth-class={figure.hookTruthClass ?? undefined}
                    style={{
                      ...(anchor.side === "end"
                        ? { insetInlineEnd: `${anchor.offsetPercent}%` }
                        : { insetInlineStart: `${anchor.offsetPercent}%` }),
                      top: percent(figure.footY + CAPTION_FOOT_GAP, STAGE_HEIGHT),
                    }}
                  >
                    {figure.hookLabel}
                    {figure.hookTruthClass === null ? null : (
                      // 線索自己的資料身分（投影在 `labelTruthClass` 給的），短詞跟在字幕後。
                      <span className="v5-stage__caption-truth panshi-data">
                        {"　"}
                        {truthClassLabel(figure.hookTruthClass)}
                      </span>
                    )}
                  </p>
                );
              })}

        {signal === null ? null : (
          <p className="v5-stage__signal panshi-data">
            <span aria-hidden="true">◇</span>
            有新的市場事實抵達這個場景
          </p>
        )}
      </div>

      {/* 缺資料身分而不上字幕的線索數（說明句未經 copy-taste 審稿）。 */}
      {withheldClaims > 0 ? (
        <p className="v5-world__hint panshi-data" data-claim-withheld="missing_truth_class">
          有 {withheldClaims} 項世界線索不顯示。{MISSING_CLAIM_TRUTH_CLASS_TEXT}
        </p>
      ) : null}

      {skipped > 0 ? (
        <p className="v5-world__hint panshi-data">
          有 {skipped} 個世界座標無法解讀，這一輪不畫他們。{DATA_UNAVAILABLE_LABEL}，不補位置。
        </p>
      ) : null}

      <p className="v5-world__hint panshi-paper">按住一個人，跟他走一段。點一下他也可以。</p>

      {follow.menuFor !== null ? (
        <div className="v5-world__menu" role="group" aria-label="這個人的動作">
          <p className="panshi-paper">要對他做什麼？</p>
          {MENU_CHOICES.map((item, index) => (
            <button
              key={item.choice}
              type="button"
              ref={index === 0 ? menuRef : undefined}
              onClick={() => {
                const characterId = follow.menuFor;
                dispatch({ kind: "menuChoice", choice: item.choice, at: monotonicNow() });
                if (characterId !== null && menuChoiceOpensCloseUp(item.choice)) {
                  onOpenCloseUp(characterId);
                }
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}

      {cameraPhase !== null && follow.subjectId !== null ? (
        <FollowLayer
          characterId={follow.subjectId}
          phase={cameraPhase}
          asOfTradingDate={snapshot.marketClock.asOfTradingDate}
          onOpenCloseUp={onOpenCloseUp}
        />
      ) : null}

      {!cameraOnSubject && ctaCharacterId !== null ? (
        <button
          type="button"
          className="v5-world__cta"
          onClick={() => onOpenCloseUp(ctaCharacterId)}
        >
          再靠近一點
        </button>
      ) : null}
    </section>
  );
}
