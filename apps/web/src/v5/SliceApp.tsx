// V5 一名角色垂直切片 —— 應用外殼。
//
// 這個外殼負責三件事，其餘全部交給各層畫面：
// 1. 路由：`/world`、`/people/:id`、`/people/:id/journal`、`/people/:id/archive`、
//    `/people/:id/archive/paper`（experience-spec §12.1 的 W01、C01–C04）。
// 2. 資料狀態的真相：loading／空／過期／held／退出／離線／錯誤／不可見。
//    任何一種都不補值，一律落在 `FAIL_CLOSED_NOTE`。
// 3. 元件狀態矩陣：skip link、焦點管理、aria-live 播報、reduced motion、窄寬版。
//
// 導覽刻意只有「公共世界」一項：
// experience-spec §3.1「績效、持股與交易沒有全站入口，只能從某一位人物進入」，
// §3.2「人生誌底部才出現 `打開完整人生檔案`」。深層檔案與模擬紀錄因此沒有全站
// 連結，只能沿著 世界 → 近景 → 人生誌 → 檔案索引 → 模擬紀錄 一路走進去
//（深連結仍然有效，那是 §3.3 要求的分享行為，不是站內入口）。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  ArchiveSectionKey,
  CharacterArchiveIndexResponse,
  CharacterCloseUpResponse,
  CharacterLifeJournalResponse,
  CharacterPaperArchiveResponse,
  DataState,
  TruthClass,
  WorldSnapshot,
} from "../api/generated-v2/types.gen";
import "./tokens.css";
import { ArchiveIndexScreen } from "./ArchiveIndexScreen";
import { CloseUpScreen } from "./CloseUpScreen";
import { LifeJournalScreen } from "./LifeJournalScreen";
import { PaperArchiveScreen } from "./PaperArchiveScreen";
import { WorldScreen } from "./WorldScreen";
import {
  fetchArchiveIndex,
  fetchCloseUp,
  fetchLifeJournal,
  fetchPaperArchive,
  fetchWorld,
  type ApiResult,
  type UnavailableReason,
} from "./apiClient";
import { characterIdOf, parsePath, routeLabel, routeToPath, type Route } from "./router";

type SliceData =
  | { kind: "world"; data: WorldSnapshot }
  | { kind: "closeUp"; data: CharacterCloseUpResponse }
  | { kind: "journal"; data: CharacterLifeJournalResponse }
  | { kind: "archive"; data: CharacterArchiveIndexResponse }
  | { kind: "archivePaper"; data: CharacterPaperArchiveResponse };

type Loadable =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "ready"; value: SliceData }
  | { phase: "unavailable"; reasonCode: UnavailableReason; httpStatus: number }
  | { phase: "error" };

const TRUTH_CLASS_LABEL: Readonly<Record<TruthClass, string>> = {
  real_fact: "真實事實",
  statistical_sample: "統計樣本",
  fictional_setting: "虛構設定",
  symbolic_interpretation: "象徵解讀",
  simulated_narrative: "模擬敘事",
};

const DATA_STATE_LABEL: Readonly<Record<DataState, string>> = {
  READY: "資料已就緒",
  STALE: "資料已過期，顯示的是上一次通過封存的版本",
  HELD: "這頁的內容正在人工覆核中，暫不顯示",
  CORRECTED: "這頁有更正紀錄",
  WITHDRAWN: "這名居民已退出世界，只保留退出說明",
};

const UNAVAILABLE_LABEL: Readonly<Record<UnavailableReason, string>> = {
  UNKNOWN_RESOURCE: "這個資源還沒有發布",
  VISIBILITY_HELD: "這頁的可見性正在覆核中",
  WITHDRAWN: "這名居民已退出世界",
  RIGHTS_REVOKED: "這頁引用的來源授權已收回",
  PROJECTION_LAGGING: "投影落後於事件流，暫不顯示",
  CANONICAL_RESTRICTED: "這份資料不對外開放",
  MALFORMED_CURSOR: "翻頁位置無效",
  UNRECOGNIZED_RESPONSE: "回應格式無法辨識",
  MALFORMED_PAYLOAD: "回應不是合法的 JSON",
  INCOMPLETE_PROJECTION: "回應缺少契約必填欄位",
};

// The slice never fills a gap with a guess; every failure lands on this line.
const FAIL_CLOSED_NOTE = "資料未到，這裡不補值。";

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

function currentRoute(): Route {
  return parsePath(window.location.pathname);
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

async function loadRoute(route: Route, signal: AbortSignal): Promise<Loadable | null> {
  const wrap = <T,>(result: ApiResult<T>, toData: (data: T) => SliceData): Loadable => {
    if (result.status === "ready") return { phase: "ready", value: toData(result.data) };
    if (result.status === "unavailable") {
      return { phase: "unavailable", reasonCode: result.reasonCode, httpStatus: result.httpStatus };
    }
    return { phase: "error" };
  };

  switch (route.kind) {
    case "world":
      return wrap(await fetchWorld(signal), (data) => ({ kind: "world", data }));
    case "closeUp":
      return wrap(await fetchCloseUp(route.characterId, signal), (data) => ({
        kind: "closeUp",
        data,
      }));
    case "journal":
      return wrap(await fetchLifeJournal(route.characterId, signal), (data) => ({
        kind: "journal",
        data,
      }));
    case "archive":
      return wrap(await fetchArchiveIndex(route.characterId, signal), (data) => ({
        kind: "archive",
        data,
      }));
    case "archivePaper":
      return wrap(await fetchPaperArchive(route.characterId, signal), (data) => ({
        kind: "archivePaper",
        data,
      }));
    case "notFound":
      // Nothing to request: an unknown address is not a missing projection.
      return null;
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
  }
}

type NavItem = { route: Route; label: string };

/**
 * 全站導覽只有世界。近景、人生誌、深層檔案與模擬紀錄都必須從人物走進去
 *（experience-spec §3.1、§3.2）。
 */
const NAV_ITEMS: readonly NavItem[] = [{ route: { kind: "world" }, label: "公共世界" }];

export function SliceApp() {
  const [route, setRoute] = useState<Route>(() => currentRoute());
  const [state, setState] = useState<Loadable>({ phase: "idle" });
  const reducedMotion = useReducedMotion();
  const online = useOnline();
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    const onPopState = () => setRoute(currentRoute());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback((next: Route) => {
    window.history.pushState({}, "", routeToPath(next));
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

  const characterId = characterIdOf(route);
  const items = useMemo(() => NAV_ITEMS, []);

  const heading = routeLabel(route);
  const announcement = describeState(heading, state, online);

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

        {!online ? (
          <section className="v5-panel" data-tone="warn">
            <h2>離線</h2>
            <p>目前沒有連線。世界仍在繼續，只是這台裝置看不到最新一筆。</p>
            <p className="v5-meta">{FAIL_CLOSED_NOTE}</p>
          </section>
        ) : null}

        {route.kind === "notFound" ? (
          <section className="v5-panel" data-tone="warn">
            <h2>找不到這個頁面</h2>
            <p className="v5-meta">
              這個網址不屬於切片的五個公開位址。{FAIL_CLOSED_NOTE}
            </p>
          </section>
        ) : null}

        {state.phase === "loading" ? (
          <section className="v5-panel" aria-busy="true">
            <h2 className={reducedMotion ? undefined : "v5-busy"}>載入中</h2>
            <p className="v5-meta">正在讀取 {heading} 的投影。</p>
          </section>
        ) : null}

        {state.phase === "error" ? (
          <section className="v5-panel" data-tone="warn">
            <h2>讀取失敗</h2>
            <p>連線中斷或請求被取消，沒有取得任何投影。</p>
            <p className="v5-meta">{FAIL_CLOSED_NOTE}</p>
          </section>
        ) : null}

        {state.phase === "unavailable" ? (
          <section className="v5-panel" data-tone="warn">
            <h2>這頁現在不可見</h2>
            <p>{UNAVAILABLE_LABEL[state.reasonCode]}</p>
            <p className="v5-meta">
              HTTP {state.httpStatus}／reasonCode {state.reasonCode}。{FAIL_CLOSED_NOTE}
            </p>
          </section>
        ) : null}

        {state.phase === "ready" ? (
          <>
            <HumanHook value={state.value} />
            <ReadyScreen value={state.value} characterId={characterId} navigate={navigate} />
            <DataStatePanel value={state.value} />
          </>
        ) : null}
      </main>
    </div>
  );
}

/**
 * 把已就緒的投影交給對應層的畫面。
 *
 * 退出（`WITHDRAWN`）與 held 都不進畫面元件：那兩種狀態沒有可畫的內容，
 * 只有一句說明，由 `DataStatePanel` 負責。
 */
function ReadyScreen({
  value,
  characterId,
  navigate,
}: {
  value: SliceData;
  characterId: string | null;
  navigate: (route: Route) => void;
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
          onOpenSection={(sectionKey: ArchiveSectionKey) => {
            // 本切片只有「模擬紀錄」有真頁；其餘五節在索引上就沒有可點的入口。
            if (sectionKey !== "paper") return;
            navigate({ kind: "archivePaper", characterId: index.characterId });
          }}
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
  const held = data.dataState === "HELD";
  const withdrawn = data.dataState === "WITHDRAWN";
  const ready = data.dataState === "READY";
  const tone = ready ? undefined : "warn";

  return (
    <section className="v5-panel" data-tone={tone}>
      {ready ? null : <h2>{DATA_STATE_LABEL[data.dataState]}</h2>}

      {held || withdrawn ? <p className="v5-meta">{FAIL_CLOSED_NOTE}</p> : null}

      <ul className="v5-truth" aria-label="本頁事實類別">
        {truthClassesOf(value).map((truthClass) => (
          <li key={truthClass}>{TRUTH_CLASS_LABEL[truthClass]}</li>
        ))}
      </ul>

      <details className="v5-audit">
        <summary>資料稽核資訊</summary>
        {ready ? <p className="v5-meta">{DATA_STATE_LABEL.READY}</p> : null}
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

function describeState(heading: string, state: Loadable, online: boolean): string {
  if (!online) return `${heading}：離線，沒有取得投影。`;
  switch (state.phase) {
    case "idle":
      return `${heading}：沒有要讀取的投影。`;
    case "loading":
      return `${heading}：載入中。`;
    case "ready":
      return `${heading}：${DATA_STATE_LABEL[state.value.data.dataState]}。`;
    case "unavailable":
      return `${heading}：${UNAVAILABLE_LABEL[state.reasonCode]}。`;
    case "error":
      return `${heading}：讀取失敗。`;
  }
}
