// V5 一名角色垂直切片 —— 應用外殼。
//
// 這個外殼負責三件事，其餘全部交給各層畫面：
// 1. 路由：`/world`、`/people/:id`、`/people/:id/journal`、`/people/:id/archive`、
//    `/people/:id/archive/{paper|relations|chart|traits|memories|life}`
//   （experience-spec §12.1 的 W01、C01–C04，以及 §9.1 深層檔案的其餘五節）。
// 2. 資料狀態的真相：loading／空／過期／held／退出／離線／錯誤／不可見。
//    任何一種都不補值，一律落在 `FAIL_CLOSED_NOTE`。
// 3. 元件狀態矩陣：skip link、焦點管理、aria-live 播報、reduced motion、窄寬版。
//
// 導覽刻意只有「公共世界」一項：
// experience-spec §3.1「績效、持股與交易沒有全站入口，只能從某一位人物進入」，
// §3.2「人生誌底部才出現 `打開完整人生檔案`」。深層檔案與模擬紀錄因此沒有全站
// 連結，只能從某一位人物走進去：世界 → 近景 → 人生誌 → 檔案索引 → 各節；
// 近景另有一個直接到他自己模擬紀錄的「持股與理由」入口（世界 →（1）近景 →（2）
// 模擬紀錄），那仍然是從一個人進去，不是全站入口
//（深連結仍然有效，那是 §3.3 要求的分享行為，不是站內入口）。

import { useCallback, useEffect, useMemo, useRef, useState, type Ref } from "react";

import type {
  ArchiveSectionKey,
  CharacterArchiveIndexResponse,
  CharacterChartArchiveResponse,
  CharacterCloseUpResponse,
  CharacterLifeArchiveResponse,
  CharacterLifeJournalResponse,
  CharacterMemoriesArchiveResponse,
  CharacterPaperArchiveResponse,
  CharacterRelationsArchiveResponse,
  CharacterTraitsArchiveResponse,
  TruthClass,
  WorldSnapshot,
} from "../api/generated-v2/types.gen";
import "./tokens.css";
import { ArchiveIndexScreen } from "./ArchiveIndexScreen";
import { ArchiveSectionScreen } from "./ArchiveSectionScreen";
import { CloseUpScreen } from "./CloseUpScreen";
import { LifeJournalScreen } from "./LifeJournalScreen";
import { PaperArchiveScreen } from "./PaperArchiveScreen";
import { WorldScreen } from "./WorldScreen";
import {
  fetchArchiveIndex,
  fetchChartArchive,
  fetchCloseUp,
  fetchLifeArchive,
  fetchLifeJournal,
  fetchMemoriesArchive,
  fetchPaperArchive,
  fetchRelationsArchive,
  fetchTraitsArchive,
  fetchWorld,
  isValidProjection,
  type ApiResult,
  type ProjectionKind,
  type UnavailableReason,
} from "./apiClient";
import { lastKnownCache, type LastKnownCache } from "./lastKnownCache";
import { chapterAnchorId } from "./journalRevisions";
import {
  archiveSectionRoute,
  characterIdOf,
  parsePath,
  routeLabel,
  routeToPath,
  type Route,
} from "./router";
import {
  CorrectedBanner,
  DATA_STATE_LABEL,
  EMPTY_STATE_COPY,
  FAIL_CLOSED_NOTE,
  HeldPanel,
  LoadingPanel,
  NotFoundPanel,
  OfflineCachedBanner,
  OfflinePanel,
  PAPER_CORRECTIONS_ANCHOR,
  ReadFailurePanel,
  STATE_HEADING_ID,
  StaleBanner,
  UNAVAILABLE_LABEL,
  UnavailablePanel,
  WithdrawnPanel,
  type EmptyReason,
} from "./statePanels";

export type SliceData =
  | { kind: "world"; data: WorldSnapshot }
  | { kind: "closeUp"; data: CharacterCloseUpResponse }
  | { kind: "journal"; data: CharacterLifeJournalResponse }
  | { kind: "archive"; data: CharacterArchiveIndexResponse }
  | { kind: "archivePaper"; data: CharacterPaperArchiveResponse }
  | { kind: "archiveRelations"; data: CharacterRelationsArchiveResponse }
  | { kind: "archiveChart"; data: CharacterChartArchiveResponse }
  | { kind: "archiveTraits"; data: CharacterTraitsArchiveResponse }
  | { kind: "archiveMemories"; data: CharacterMemoriesArchiveResponse }
  | { kind: "archiveLife"; data: CharacterLifeArchiveResponse };

export type Loadable =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "ready"; value: SliceData }
  /** 取不到最新投影（離線或傳輸失敗），改顯示這個路由上次成功載入的版本。 */
  | { phase: "offline"; value: SliceData }
  | { phase: "unavailable"; reasonCode: UnavailableReason; httpStatus: number }
  | { phase: "error" };

const TRUTH_CLASS_LABEL: Readonly<Record<TruthClass, string>> = {
  real_fact: "真實事實",
  statistical_sample: "統計樣本",
  fictional_setting: "虛構設定",
  symbolic_interpretation: "象徵解讀",
  simulated_narrative: "模擬敘事",
};

const STYLES = `
.v5-shell {
  background: var(--paper-100);
  color: var(--ink-900);
  font-family: var(--font-data);
  min-height: 100vh;
  padding: 24px 20px 64px;
  line-height: 1.7;
}
.v5-shell a { color: var(--copper-500); }
.v5-skip {
  position: absolute;
  left: -9999px;
}
.v5-skip:focus {
  position: static;
  display: inline-block;
  margin-bottom: 12px;
}
.v5-shell :focus-visible {
  outline: 2px solid var(--signal-420);
  outline-offset: 2px;
}
.v5-eyebrow { color: var(--copper-500); font-size: 13px; letter-spacing: .04em; }
.v5-title { font-size: 22px; margin: 4px 0 16px; font-weight: 500; }
.v5-nav { display: flex; flex-wrap: wrap; gap: 8px 16px; margin: 0 0 20px; padding: 0; list-style: none; }
.v5-nav [aria-current="page"] { font-weight: 500; text-decoration: none; border-bottom: 2px solid var(--copper-500); }
.v5-panel {
  border: 1px solid var(--rule-paper);
  border-left: 3px solid var(--signal-420);
  padding: 14px 16px;
  margin: 0 0 16px;
  background: rgba(255, 255, 255, .35);
}
.v5-panel[data-tone="warn"] { border-left-color: var(--copper-500); }
.v5-panel h2 { font-size: 15px; margin: 0 0 6px; font-weight: 500; }
.v5-panel p { margin: 0 0 4px; }
.v5-meta { color: var(--copper-500); font-size: 13px; }
.v5-corrections { margin: 6px 0 4px; padding-inline-start: 1.1rem; }
.v5-corrections li { margin: 0 0 2px; overflow-wrap: anywhere; }
.v5-truth { display: flex; flex-wrap: wrap; gap: 6px; padding: 0; margin: 8px 0 0; list-style: none; }
.v5-truth li {
  border: 1px solid var(--rule-paper);
  border-radius: 2px;
  font-size: 12px;
  padding: 1px 6px;
  color: var(--copper-500);
}
.v5-hook {
  margin: 0 0 18px;
  padding-inline-start: .75rem;
  border-inline-start: 2px solid var(--copper-500);
  font-size: 1.05rem;
}
.v5-audit {
  margin-top: 10px;
}
.v5-audit > summary {
  cursor: pointer;
  color: var(--copper-500);
  font-size: 13px;
  min-height: 44px;
  display: inline-flex;
  align-items: center;
}
.v5-audit > summary:focus-visible {
  outline: 2px solid var(--signal-420);
  outline-offset: 2px;
}
.v5-audit[open] > summary { margin-bottom: 6px; }
.v5-busy::after {
  content: "";
  display: inline-block;
  width: 8px; height: 8px;
  margin-left: 8px;
  border-radius: 50%;
  background: var(--signal-420);
  animation: v5-pulse 1.2s ease-in-out infinite;
}
@keyframes v5-pulse { 0%, 100% { opacity: .25; } 50% { opacity: 1; } }
@media (max-width: 600px) {
  .v5-shell { padding: 16px 14px 48px; }
  .v5-title { font-size: 19px; }
  .v5-nav { gap: 6px 12px; }
}
@media (min-width: 1100px) {
  .v5-shell { padding-left: max(24px, calc((100vw - 1040px) / 2)); padding-right: max(24px, calc((100vw - 1040px) / 2)); }
}
@media (prefers-reduced-motion: reduce) {
  .v5-busy::after { animation: none; opacity: .6; }
}
`;

/** 初次 render 不得假設有 `window`（node 端渲染測試、預渲染）。沒有就先當成世界。 */
function currentRoute(): Route {
  if (typeof window === "undefined") return { kind: "world" };
  return parsePath(window.location.pathname);
}

function initialLoadable(route: Route): Loadable {
  return route.kind === "notFound" ? { phase: "idle" } : { phase: "loading" };
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

function useOnline(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    setOnline(window.navigator.onLine);
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return online;
}

function toSliceData(kind: ProjectionKind, data: unknown): SliceData {
  // `data` 已經過 `isValidProjection(kind, …)` 或 apiClient 的同一道契約檢查。
  return { kind, data } as SliceData;
}

/**
 * 讀一個路由的投影。
 *
 * - 成功：把這份公開投影記進 last-known 快取（只有公開投影，沒有使用者資料）。
 * - 傳輸失敗（離線、DNS、連線中斷）：若這個路由有上次成功載入、而且**仍通過契約
 *   驗證**的版本，回 `offline` 讓外殼顯示它；否則回 `error`。
 * - `unavailable`（held、withdrawn、授權收回…）是伺服器明確說「不可見」，
 *   **不得**用快取蓋過去，否則已撤下的內容會從快取復活。
 */
export async function loadRoute(
  route: Route,
  signal: AbortSignal,
  cache: LastKnownCache = lastKnownCache,
): Promise<Loadable | null> {
  if (route.kind === "notFound") {
    // Nothing to request: an unknown address is not a missing projection.
    return null;
  }

  const kind: ProjectionKind = route.kind;
  const path = routeToPath(route);

  const wrap = <T,>(result: ApiResult<T>): Loadable => {
    if (result.status === "ready") {
      cache.remember(path, result.data);
      return { phase: "ready", value: toSliceData(kind, result.data) };
    }
    if (result.status === "unavailable") {
      return { phase: "unavailable", reasonCode: result.reasonCode, httpStatus: result.httpStatus };
    }
    const cached = cache.recall(path);
    if (cached !== null && isValidProjection(kind, cached)) {
      return { phase: "offline", value: toSliceData(kind, cached) };
    }
    return { phase: "error" };
  };

  switch (route.kind) {
    case "world":
      return wrap(await fetchWorld(signal));
    case "closeUp":
      return wrap(await fetchCloseUp(route.characterId, signal));
    case "journal":
      return wrap(await fetchLifeJournal(route.characterId, signal));
    case "archive":
      return wrap(await fetchArchiveIndex(route.characterId, signal));
    case "archivePaper":
      return wrap(await fetchPaperArchive(route.characterId, signal));
    case "archiveRelations":
      return wrap(await fetchRelationsArchive(route.characterId, signal));
    case "archiveChart":
      return wrap(await fetchChartArchive(route.characterId, signal));
    case "archiveTraits":
      return wrap(await fetchTraitsArchive(route.characterId, signal));
    case "archiveMemories":
      return wrap(await fetchMemoriesArchive(route.characterId, signal));
    case "archiveLife":
      return wrap(await fetchLifeArchive(route.characterId, signal));
  }
}

function truthClassesOf(value: SliceData): readonly TruthClass[] {
  return value.data.truthClasses;
}

/**
 * 第一屏的鉤子必須是一句人的句子，不是投影版本或伺服器時間。
 *
 * 每種投影挑一句已經是最終形狀、不需要再編字的既有欄位：世界用今日五幕的
 * `storyHooks[0].label`；其餘畫面用該角色當下最貼近「這是一個人」的既有句子。
 * 缺資料就回傳 `null`，一律 fail closed，不補一句話。held／withdrawn 沒有可
 * 顯示的內容，也回傳 `null`。
 */
function humanHookOf(value: SliceData): string | null {
  switch (value.kind) {
    case "world": {
      if (value.data.dataState === "HELD") return null;
      const hook = value.data.storyHooks[0];
      return hook ? hook.label : null;
    }
    case "closeUp": {
      const data = value.data;
      if (data.dataState === "WITHDRAWN" || data.dataState === "HELD") return null;
      return data.currentVerbPhrase;
    }
    case "journal": {
      const data = value.data;
      if (data.dataState === "WITHDRAWN" || data.dataState === "HELD") return null;
      const latest = data.entries[data.entries.length - 1];
      return latest ? latest.sceneSummary : null;
    }
    case "archive": {
      const data = value.data;
      if (data.dataState === "WITHDRAWN" || data.dataState === "HELD") return null;
      return data.longTermTensionSummary;
    }
    case "archivePaper": {
      const data = value.data;
      if (data.dataState === "WITHDRAWN" || data.dataState === "HELD") return null;
      const position = data.positions[0];
      return position ? position.consequenceSummary : null;
    }
    case "archiveRelations": {
      const data = value.data;
      if (data.dataState === "WITHDRAWN" || data.dataState === "HELD") return null;
      return data.acquaintances[0]?.relationNote ?? null;
    }
    case "archiveTraits": {
      const data = value.data;
      if (data.dataState === "WITHDRAWN" || data.dataState === "HELD") return null;
      return data.selfDescription.label;
    }
    case "archiveMemories": {
      const data = value.data;
      if (data.dataState === "WITHDRAWN" || data.dataState === "HELD") return null;
      return data.memories[0]?.note ?? null;
    }
    case "archiveChart":
    case "archiveLife":
      // 這兩節沒有一句「人的句子」可以放在第一屏：命盤的解讀不是他說的話，
      // 生平的身分欄位是資料不是鉤子。不補一句。
      return null;
  }
}

type NavItem = { route: Route; label: string };

/**
 * 全站導覽只有世界。近景、人生誌、深層檔案與模擬紀錄都必須從人物走進去
 *（experience-spec §3.1、§3.2）。
 */
const NAV_ITEMS: readonly NavItem[] = [{ route: { kind: "world" }, label: "公共世界" }];

export type Navigate = (next: Route, hash?: string) => void;

function stateFocusKey(state: Loadable): string {
  if (state.phase === "ready" || state.phase === "offline") {
    return `${state.phase}:${state.value.data.dataState}`;
  }
  return state.phase;
}

export function SliceApp() {
  const [route, setRoute] = useState<Route>(() => currentRoute());
  const [state, setState] = useState<Loadable>(() => initialLoadable(route));
  const reducedMotion = useReducedMotion();
  const online = useOnline();
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    // 同一頁內的錨點跳轉（例如人生誌的「回到原話」）也會觸發 popstate；路徑沒變就
    // 不換路由，否則整頁會重新載入、把讀者剛跳到的章節捲掉。
    const onPopState = () =>
      setRoute((previous) => {
        const next = currentRoute();
        return next.kind === previous.kind && routeToPath(next) === routeToPath(previous)
          ? previous
          : next;
      });
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback<Navigate>((next, hash) => {
    window.history.pushState({}, "", routeToPath(next) + (hash ?? ""));
    setRoute(next);
  }, []);

  useEffect(() => {
    if (route.kind === "notFound") {
      setState({ phase: "idle" });
      return;
    }

    const controller = new AbortController();
    setState({ phase: "loading" });

    loadRoute(route, controller.signal)
      .then((next) => {
        if (controller.signal.aborted || next === null) return;
        setState(next);
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ phase: "error" });
      });

    return () => controller.abort();
  }, [route]);

  useEffect(() => {
    headingRef.current?.focus();
  }, [route]);

  // 切換到非 READY 的狀態時，把焦點移到狀態標題（播報另由 live region 負責）。
  // 網址帶錨點（例如 `#paper-corrections`）時尊重錨點，不搶焦點。
  const focusKey = stateFocusKey(state);
  useEffect(() => {
    if (focusKey === "idle" || focusKey === "loading" || focusKey === "ready:READY") return;
    const hash = window.location.hash.slice(1);
    if (hash.length > 0 && document.getElementById(hash) !== null) return;
    document.getElementById(STATE_HEADING_ID)?.focus();
  }, [focusKey]);

  return (
    <SliceView
      route={route}
      state={state}
      online={online}
      reducedMotion={reducedMotion}
      navigate={navigate}
      headingRef={headingRef}
    />
  );
}

export type SliceViewProps = {
  route: Route;
  state: Loadable;
  online: boolean;
  reducedMotion: boolean;
  navigate: Navigate;
  headingRef?: Ref<HTMLHeadingElement>;
};

/**
 * 外殼的純呈現部分：沒有 effect、不碰 `window`，node 端可以直接
 * `renderToStaticMarkup(<SliceView … />)` 檢查七種狀態。
 */
export function SliceView({ route, state, online, reducedMotion, navigate, headingRef }: SliceViewProps) {
  const characterId = characterIdOf(route);
  const items = useMemo(() => NAV_ITEMS, []);

  const heading = routeLabel(route);
  const announcement = describeState(heading, state, online);
  const hasContent = state.phase === "ready" || state.phase === "offline";

  return (
    <div className="v5-shell">
      <style>{STYLES}</style>
      <a className="v5-skip" href="#v5-main">
        跳到主要內容
      </a>

      <p className="v5-eyebrow">盤勢・眾生</p>
      <h1 className="v5-title" id="v5-route-heading" ref={headingRef} tabIndex={-1}>
        {heading}
      </h1>

      <nav aria-label="切片導覽">
        <ul className="v5-nav">
          {items.map((item) => {
            const path = routeToPath(item.route);
            const isCurrent = routeToPath(route) === path && route.kind === item.route.kind;
            return (
              <li key={path}>
                <a
                  href={path}
                  aria-current={isCurrent ? "page" : undefined}
                  onClick={(event) => {
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) {
                      return;
                    }
                    event.preventDefault();
                    navigate(item.route);
                  }}
                >
                  {item.label}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      <main id="v5-main" tabIndex={-1}>
        <p aria-live="polite" role="status" className="v5-meta">
          {announcement}
        </p>

        {/* 沒有任何可顯示的版本時才用整塊離線面板；有上次版本時改用內容前的橫幅。 */}
        {!online && !hasContent ? <OfflinePanel /> : null}

        {route.kind === "notFound" ? <NotFoundPanel /> : null}

        {state.phase === "loading" ? (
          <LoadingPanel heading={heading} reducedMotion={reducedMotion} />
        ) : null}

        {state.phase === "error" ? <ReadFailurePanel /> : null}

        {state.phase === "unavailable" ? (
          <UnavailablePanel reasonCode={state.reasonCode} httpStatus={state.httpStatus} />
        ) : null}

        {hasContent ? (
          <ProjectionView
            value={state.value}
            lastKnown={state.phase === "offline" || !online}
            characterId={characterId}
            navigate={navigate}
          />
        ) : null}
      </main>
    </div>
  );
}

/**
 * 一份投影在頁面上的完整排列。順序是硬規則：
 *
 * 1. 離線橫幅（顯示的是上次載入的版本時）永遠最前面。
 * 2. held／withdrawn 只有說明面板，**不渲染任何內容**（連鉤子句都沒有）。
 * 3. 過期、更正橫幅排在第一個內容標題之前。
 * 4. 然後才是鉤子句、畫面本體與資料身分／稽核區。
 */
function ProjectionView({
  value,
  lastKnown,
  characterId,
  navigate,
}: {
  value: SliceData;
  lastKnown: boolean;
  characterId: string | null;
  navigate: Navigate;
}) {
  const { data } = value;
  const dataTime = dataTimeOf(value);
  const offlineBanner = lastKnown ? <OfflineCachedBanner dataTime={dataTime} /> : null;

  if (data.dataState === "HELD") {
    return (
      <>
        {offlineBanner}
        <HeldPanel />
      </>
    );
  }

  if (data.dataState === "WITHDRAWN") {
    return (
      <>
        {offlineBanner}
        <WithdrawnPanel
          tombstoneReasonLabel={"tombstoneReasonLabel" in data ? data.tombstoneReasonLabel : null}
          truthClasses={data.truthClasses}
        />
      </>
    );
  }

  return (
    <>
      {offlineBanner}
      {data.dataState === "STALE" ? <StaleBanner dataTime={dataTime} /> : null}
      {data.dataState === "CORRECTED" ? (
        <CorrectionNotice value={value} characterId={characterId} navigate={navigate} />
      ) : null}
      <HumanHook value={value} />
      <ReadyScreen value={value} characterId={characterId} navigate={navigate} />
      <DataStatePanel value={value} />
    </>
  );
}

function CorrectionNotice({
  value,
  characterId,
  navigate,
}: {
  value: SliceData;
  characterId: string | null;
  navigate: Navigate;
}) {
  if (value.kind === "archivePaper" && value.data.dataState !== "WITHDRAWN") {
    return <CorrectedBanner scope="paper" revisions={value.data.dataRevisions} />;
  }

  const owner = characterId ?? ("characterId" in value.data ? value.data.characterId : null);
  const paperRoute: Route | null = owner === null ? null : { kind: "archivePaper", characterId: owner };
  return (
    <CorrectedBanner
      scope="other"
      refs={value.data.sourceRevisionSet}
      correctionsHref={
        paperRoute === null ? null : `${routeToPath(paperRoute)}#${PAPER_CORRECTIONS_ANCHOR}`
      }
      onOpenCorrections={
        paperRoute === null ? undefined : () => navigate(paperRoute, `#${PAPER_CORRECTIONS_ANCHOR}`)
      }
    />
  );
}

/** 這份投影的資料時間：模擬紀錄用整份的 `asOf`，其餘用 `serverNow`。 */
export function dataTimeOf(value: SliceData): string {
  if (value.kind === "archivePaper" && value.data.dataState !== "WITHDRAWN") {
    return value.data.asOf;
  }
  return value.data.serverNow;
}

/** 本來就是空的狀態；held／withdrawn 沒有內容，不算空。 */
export function emptyReasonOf(value: SliceData): EmptyReason | null {
  const { data } = value;
  if (data.dataState === "HELD" || data.dataState === "WITHDRAWN") return null;
  switch (value.kind) {
    case "world":
      return value.data.characterPositions.length === 0 ? "world_no_residents" : null;
    case "journal":
      return value.data.dataState !== "WITHDRAWN" && value.data.entries.length === 0
        ? "journal_no_chapters"
        : null;
    case "archivePaper":
      return value.data.dataState !== "WITHDRAWN" && value.data.positions.length === 0
        ? "paper_no_positions"
        : null;
    default:
      return null;
  }
}

/**
 * 把已就緒的投影交給對應層的畫面。
 *
 * 退出（`WITHDRAWN`）與 held 都不進畫面元件：那兩種狀態沒有可畫的內容，
 * 只有一句說明，由 `ProjectionView` 換成 `HeldPanel`／`WithdrawnPanel`。
 */
function ReadyScreen({
  value,
  characterId,
  navigate,
}: {
  value: SliceData;
  characterId: string | null;
  navigate: Navigate;
}) {
  if (value.data.dataState === "WITHDRAWN" || value.data.dataState === "HELD") return null;

  switch (value.kind) {
    case "world":
      return (
        <WorldScreen
          snapshot={value.data}
          onOpenCloseUp={(id) => navigate({ kind: "closeUp", characterId: id })}
        />
      );

    case "closeUp": {
      const closeUp = value.data;
      if (closeUp.dataState === "WITHDRAWN") return null;
      return (
        <CloseUpScreen
          closeUp={closeUp}
          onOpenJournal={() =>
            navigate({ kind: "journal", characterId: closeUp.characterId })
          }
          onBackToWorld={() => navigate({ kind: "world" })}
          // 「持股與理由」：從這個人直接到他的模擬紀錄（世界 →（1）近景 →（2）模擬紀錄）。
          paperHref={routeToPath({ kind: "archivePaper", characterId: closeUp.characterId })}
          onOpenPaper={() => navigate({ kind: "archivePaper", characterId: closeUp.characterId })}
        />
      );
    }

    case "journal": {
      const page = value.data;
      if (page.dataState === "WITHDRAWN") return null;
      return (
        <LifeJournalScreen
          page={page}
          onBackToCloseUp={() => navigate({ kind: "closeUp", characterId: page.characterId })}
          // 「打開完整人生檔案」的唯一入口：人生誌底部。
          onOpenArchive={() => navigate({ kind: "archive", characterId: page.characterId })}
        />
      );
    }

    case "archive": {
      const index = value.data;
      if (index.dataState === "WITHDRAWN") return null;
      return (
        <ArchiveIndexScreen
          index={index}
          onOpenSection={(sectionKey: ArchiveSectionKey) =>
            navigate(archiveSectionRoute(sectionKey, index.characterId))
          }
          onBackToJournal={() => navigate({ kind: "journal", characterId: index.characterId })}
        />
      );
    }

    case "archivePaper": {
      const archive = value.data;
      if (archive.dataState === "WITHDRAWN") return null;
      return (
        <PaperArchiveScreen
          archive={archive}
          onBackToArchiveIndex={() =>
            navigate({
              kind: "archive",
              characterId: characterId ?? archive.characterId,
            })
          }
        />
      );
    }

    case "archiveRelations":
    case "archiveChart":
    case "archiveTraits":
    case "archiveMemories":
    case "archiveLife": {
      const section = value.data;
      if (section.dataState === "WITHDRAWN") return null;
      const owner = characterId ?? section.characterId;
      const journalRoute: Route = { kind: "journal", characterId: owner };
      return (
        <ArchiveSectionScreen
          section={section}
          journalPath={routeToPath(journalRoute)}
          onOpenChapter={(chapterDate) => navigate(journalRoute, `#${chapterAnchorId(chapterDate)}`)}
          onBackToArchiveIndex={() => navigate({ kind: "archive", characterId: owner })}
        />
      );
    }
  }
}

/**
 * 第一屏的主角是人，不是投影版本。這裡把角色當下最貼近一句真話的既有欄位
 * 顯示在標題正下方；資料未到就什麼都不畫（fail closed，不補一句話）。
 */
function HumanHook({ value }: { value: SliceData }) {
  const hook = humanHookOf(value);
  if (hook === null) return null;
  return <p className="v5-hook panshi-paper">{hook}</p>;
}

/**
 * 資料身分標籤留在第一屏（每個對外可見的宣稱都要看得到 truth_class）；
 * 投影版本、可見性紀元、伺服器時間與「介面文字是產品外殼」這句 meta 註腳
 * 收進預設收合的可展開區，不再是第一屏的主角，但也沒有被刪掉。
 */
function DataStatePanel({ value }: { value: SliceData }) {
  const { data } = value;
  const ready = data.dataState === "READY";
  // 非 READY 的狀態標題已經在內容之前的橫幅裡，這裡只留資料身分與稽核資訊。
  return (
    <section className="v5-panel" data-tone={ready ? undefined : "warn"}>
      <ul className="v5-truth" aria-label="本頁事實類別">
        {truthClassesOf(value).map((truthClass) => (
          <li key={truthClass}>{TRUTH_CLASS_LABEL[truthClass]}</li>
        ))}
      </ul>

      <details className="v5-audit">
        <summary>資料稽核資訊</summary>
        <p className="v5-meta">{DATA_STATE_LABEL[data.dataState]}</p>
        <p className="v5-meta">
          投影版本 {data.projectionVersion}／可見性紀元 {data.visibilityEpoch}／伺服器時間{" "}
          {data.serverNow}
        </p>
        <p className="v5-meta">
          介面文字（標題、按鈕、狀態說明）是產品外殼，不是對世界的宣稱；世界事實一律由投影的
          truth_class 標記。
        </p>
      </details>
    </section>
  );
}

/** 一份投影的狀態句（不含頁名），外殼的 live region 用它播報。 */
function projectionStatusText(value: SliceData): string {
  const dataState = value.data.dataState;
  const label = DATA_STATE_LABEL[dataState];
  if (dataState === "STALE") return `${label}（資料時間 ${dataTimeOf(value)}）。`;
  if (dataState === "HELD") return `${label}。${FAIL_CLOSED_NOTE}`;
  if (dataState === "WITHDRAWN") return `${label}。`;
  const empty = emptyReasonOf(value);
  return empty === null ? `${label}。` : `${label}；${EMPTY_STATE_COPY[empty].title}。`;
}

export function describeState(heading: string, state: Loadable, online: boolean): string {
  if (state.phase === "offline" || (!online && state.phase === "ready")) {
    const offline = `離線中，顯示你上次載入的版本（截至 ${dataTimeOf(state.value)}）。`;
    return `${heading}：${offline}${projectionStatusText(state.value)}`;
  }
  if (!online) return `${heading}：離線，沒有取得投影。`;
  switch (state.phase) {
    case "idle":
      return `${heading}：沒有要讀取的投影。`;
    case "loading":
      return `${heading}：載入中。`;
    case "ready":
      return `${heading}：${projectionStatusText(state.value)}`;
    case "unavailable":
      return `${heading}：${UNAVAILABLE_LABEL[state.reasonCode]}。`;
    case "error":
      return `${heading}：讀取失敗。`;
  }
}
