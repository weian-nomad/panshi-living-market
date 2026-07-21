import { useEffect, useMemo, useRef, useState } from "react";

import { App } from "./App";
import {
  createStudyExport,
  evaluateCohort,
  normalizeParticipantCode,
  STUDY_CONSENT_VERSION,
  type StudyEvent,
  type StudyVisitOrdinal,
} from "./study";
import { StudyRecorder, StudyRunAlreadyCompletedError } from "./studyRecorder";
import { isApprovedStudyRuntime, resolveStudyBuildId } from "./studyRelease";
import { IndexedDbStudyStore } from "./studyStorage";

const APP_BUILD_ID = resolveStudyBuildId(import.meta.env.VITE_STUDY_BUILD_ID, import.meta.env.DEV);
const STUDY_RUNTIME_APPROVED = isApprovedStudyRuntime({
  origin: window.location.origin,
  isSecureContext: window.isSecureContext,
  isDevelopment: import.meta.env.DEV,
});

type ParticipantRoute = {
  kind: "participant";
  participantCode: string;
  visitOrdinal: StudyVisitOrdinal;
};

type StudyRoute =
  | { kind: "standard" }
  | ParticipantRoute
  | { kind: "researcher" }
  | { kind: "invalid"; message: string };

function readStudyRoute(): StudyRoute {
  const parameters = new URLSearchParams(window.location.search);
  if (parameters.get("research") === "1") return { kind: "researcher" };
  if (!parameters.has("study")) return { kind: "standard" };

  const participantCode = normalizeParticipantCode(parameters.get("study") ?? "");
  const visit = Number(parameters.get("visit"));
  if (!participantCode) {
    return { kind: "invalid", message: "研究代碼必須是 P01 至 P24。請向研究人員取得新的連結。" };
  }
  if (visit !== 1 && visit !== 2) {
    return { kind: "invalid", message: "觀看次序缺少或不正確。請向研究人員取得新的連結。" };
  }

  return { kind: "participant", participantCode, visitOrdinal: visit };
}

function registerStudyServiceWorker() {
  if (!import.meta.env.PROD || !STUDY_RUNTIME_APPROVED || !("serviceWorker" in navigator)) return;
  void navigator.serviceWorker.register("/study-sw.js", { scope: "/" });
}

function StudyMessage({
  eyebrow,
  title,
  children,
  actions,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <main className="study-entry">
      <section className="study-card" aria-labelledby="study-title">
        <p className="study-card__eyebrow">{eyebrow}</p>
        <h1 id="study-title">{title}</h1>
        <div className="study-card__body">{children}</div>
        {actions ? <div className="study-card__actions">{actions}</div> : null}
      </section>
    </main>
  );
}

function ParticipantStudy({
  route,
  appBuildId,
}: {
  route: ParticipantRoute;
  appBuildId: string;
}) {
  const store = useMemo(() => new IndexedDbStudyStore(), []);
  const [phase, setPhase] = useState<
    "checking" | "consent" | "starting" | "active" | "completed" | "declined" | "error"
  >("checking");
  const [recorder, setRecorder] = useState<StudyRecorder | null>(null);
  const startPromiseRef = useRef<Promise<void> | null>(null);

  function startRun(recordConsent: boolean) {
    if (startPromiseRef.current) return startPromiseRef.current;
    setPhase("starting");
    startPromiseRef.current = (async () => {
      if (recordConsent) {
        await store.recordConsent(route.participantCode, STUDY_CONSENT_VERSION);
      }
      const nextRecorder = await StudyRecorder.start(store, {
        participantCode: route.participantCode,
        visitOrdinal: route.visitOrdinal,
        appBuildId,
        onStorageFailure: () => setPhase("error"),
        onRunCompleted: () => setPhase("completed"),
      });
      setRecorder(nextRecorder);
      setPhase("active");
    })().catch((error: unknown) => {
      startPromiseRef.current = null;
      setPhase(error instanceof StudyRunAlreadyCompletedError ? "completed" : "error");
    });
    return startPromiseRef.current;
  }

  useEffect(() => {
    let cancelled = false;
    void store
      .hasConsent(route.participantCode, STUDY_CONSENT_VERSION)
      .then((hasConsent) => {
        if (cancelled) return;
        if (hasConsent) void startRun(false);
        else setPhase("consent");
      })
      .catch(() => {
        if (!cancelled) setPhase("error");
      });
    return () => {
      cancelled = true;
    };
  }, [route.participantCode, store]);

  if (phase === "active" && recorder) return <App studyRecorder={recorder} />;

  if (phase === "consent") {
    return (
      <StudyMessage
        eyebrow={`觀看研究 · ${route.participantCode}`}
        title="是否加入這次觀看？"
        actions={
          <>
            <button className="study-button study-button--primary" type="button" onClick={() => void startRun(true)}>
              同意並開始
            </button>
            <button className="study-button" type="button" onClick={() => setPhase("declined")}>
              不參加
            </button>
          </>
        }
      >
        <p>應用只在這支研究手機上記錄開始、暫停、跟隨與交接時間；不記錄姓名、聯絡方式、輸入內容或完整手勢路徑。這些互動紀錄不會上傳。</p>
        <p>研究代碼（P01–P24，不含姓名或聯絡方式）會出現在網址中。開啟頁面時，完整網址會經邊緣連線服務送達靜態網站伺服器。</p>
        <p>邊緣連線服務會處理連線裝置的 IP、瀏覽器資訊與開啟時間。開啟研究頁時不會進行身分驗證，參與者也不需登入。研究團隊不在應用或靜態網站伺服器保存 HTTP 請求紀錄，也不另行啟用或匯出 HTTP 請求日誌。服務供應商仍可能依其服務與隱私政策，為 TLS、濫用防護與故障排查處理必要連線資料。這些資料不進入研究匯出，也不與手機內研究資料合併。</p>
      </StudyMessage>
    );
  }

  if (phase === "declined") {
    return (
      <StudyMessage eyebrow="已退出" title="這次不會開始記錄">
        <p>把裝置交還研究人員即可。</p>
      </StudyMessage>
    );
  }

  if (phase === "completed") {
    return (
      <StudyMessage eyebrow={`觀看完成 · ${route.participantCode}`} title="這次紀錄已封存">
        <p>不必再重新操作。請把裝置交還研究人員。</p>
      </StudyMessage>
    );
  }

  if (phase === "error") {
    return (
      <StudyMessage
        eyebrow="紀錄未開始"
        title="這台裝置無法保存研究紀錄"
        actions={
          <button className="study-button study-button--primary" type="button" onClick={() => window.location.reload()}>
            重新載入
          </button>
        }
      >
        <p>目前沒有記錄任何觀看行為。請重新載入；若仍失敗，請把裝置交還研究人員。</p>
      </StudyMessage>
    );
  }

  return (
    <StudyMessage eyebrow="觀看研究" title={phase === "starting" ? "正在準備片段" : "正在確認研究紀錄"}>
      <p>畫面準備好後會自動開始。</p>
    </StudyMessage>
  );
}

function ResearcherConsole() {
  const store = useMemo(() => new IndexedDbStudyStore(), []);
  const [events, setEvents] = useState<StudyEvent[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [participantCodeInput, setParticipantCodeInput] = useState("P01");
  const [visitOrdinal, setVisitOrdinal] = useState<StudyVisitOrdinal>(1);
  const [copyStatus, setCopyStatus] = useState("");
  const result = evaluateCohort(events);

  function refresh() {
    setPhase("loading");
    void store
      .readAll()
      .then((nextEvents) => {
        setEvents(nextEvents);
        setPhase("ready");
      })
      .catch(() => setPhase("error"));
  }

  useEffect(refresh, [store]);

  function exportJson() {
    const exportedAt = new Date().toISOString();
    const payload = createStudyExport(events, exportedAt);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `panshi-study-${exportedAt.replaceAll(":", "-")}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }

  function clearRecords() {
    void store
      .clearAll()
      .then(() => {
        setEvents([]);
        setConfirmingClear(false);
        setPhase("ready");
      })
      .catch(() => setPhase("error"));
  }

  async function copyParticipantLink() {
    const participantCode = normalizeParticipantCode(participantCodeInput);
    if (!participantCode) {
      setCopyStatus("代碼必須是 P01 至 P24。");
      return;
    }
    const url = new URL(window.location.origin);
    url.searchParams.set("study", participantCode);
    url.searchParams.set("visit", String(visitOrdinal));
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopyStatus(`${participantCode} 第 ${visitOrdinal} 次連結已複製。`);
    } catch {
      setCopyStatus(`請手動複製：${url.toString()}`);
    }
  }

  if (phase === "error") {
    return (
      <StudyMessage
        eyebrow="研究工具"
        title="無法讀取這台裝置的紀錄"
        actions={
          <button className="study-button study-button--primary" type="button" onClick={refresh}>
            重新讀取
          </button>
        }
      >
        <p>現有資料沒有被清除。重新讀取後再匯出；若仍失敗，先停止下一位測試。</p>
      </StudyMessage>
    );
  }

  return (
    <main className="research-console">
      <header className="research-console__header">
        <div>
          <p>盤勢・眾生</p>
          <h1>24 人研究紀錄</h1>
        </div>
        <span>
          {phase === "loading"
            ? "正在讀取"
            : `${APP_BUILD_ID ?? "未封存"} · ${events.length} 筆事件`}
        </span>
      </header>

      <section className="research-status" aria-live="polite">
        <p>目前裁決</p>
        <strong>
          {!APP_BUILD_ID
            ? "研究版本未封存"
            : result.invalidRunCount > 0
              ? "有無法判定的觀看紀錄"
              : result.duplicateVisitCount > 0
                ? "同一觀看次序出現重複紀錄"
              : result.appBuildIds.length > 1 || result.consentVersions.length > 1
                ? "研究版本不一致"
                : result.invalidVisitDayCount > 0
            ? "有觀看日期不符研究規則"
            : result.participantCount > 24
              ? "樣本數已超過 24 人"
              : !result.readyForDecision
                ? "尚未到 24 人"
                : result.passed
                  ? "三項門檻通過"
                  : "至少一項未通過"}
        </strong>
        <span>必須正好 24 人、同一封存版本，而且沒有損壞或錯日紀錄，才會產生正式裁決。</span>
      </section>

      <section className="research-metrics" aria-label="研究門檻">
        <article>
          <span>按住並交接</span>
          <strong>{result.holdAndDragCount}<small>/20</small></strong>
          <p>24 人中至少 20 人</p>
        </article>
        <article>
          <span>完整前景觀看</span>
          <strong>{result.fullForegroundCycleCount}<small>/10</small></strong>
          <p>不中斷看完十分鐘</p>
        </article>
        <article>
          <span>隔日先找回同一人</span>
          <strong>{result.returnedToTopResidentCount}<small>/6</small></strong>
          <p>第一位等於首日最常跟拍</p>
        </article>
      </section>

      <section className="research-panel">
        <div className="research-panel__heading">
          <div>
            <p>受測連結</p>
            <h2>設定研究代碼與觀看次序</h2>
          </div>
        </div>
        <div className="research-link-builder">
          <label>
            研究代碼
            <input
              value={participantCodeInput}
              onChange={(event) => setParticipantCodeInput(event.target.value)}
              maxLength={3}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              placeholder="P01"
            />
          </label>
          <label>
            觀看次序
            <select value={visitOrdinal} onChange={(event) => setVisitOrdinal(Number(event.target.value) as StudyVisitOrdinal)}>
              <option value={1}>第 1 次</option>
              <option value={2}>第 2 次</option>
            </select>
          </label>
          <button className="research-action" type="button" onClick={() => void copyParticipantLink()}>
            複製受測連結
          </button>
        </div>
        {copyStatus ? <p className="research-copy-status" aria-live="polite">{copyStatus}</p> : null}
      </section>

      <section className="research-panel">
        <div className="research-panel__heading">
          <div>
            <p>逐人結果</p>
            <h2>{result.participantCount} 位受測者</h2>
          </div>
          <button type="button" onClick={refresh}>重新讀取</button>
        </div>
        {result.participants.length === 0 ? (
          <p className="research-empty">還沒有研究紀錄。先複製第一位受測者連結。</p>
        ) : (
          <div className="research-table-wrap">
            <table>
              <thead>
                <tr><th>代碼</th><th>按住＋交接</th><th>完整十分鐘</th><th>隔日日期</th><th>隔日找回</th><th>異常紀錄</th></tr>
              </thead>
              <tbody>
                {result.participants.map((participant) => (
                  <tr key={participant.participantCode}>
                    <th>{participant.participantCode}</th>
                    <td>{participant.completedHoldAndDrag ? "通過" : "未通過"}</td>
                    <td>{participant.completedFullForegroundCycle ? "通過" : "未通過"}</td>
                    <td>{participant.dayTwoDateStatus === "next_day" ? "有效" : participant.dayTwoDateStatus === "wrong_day" ? "不符" : "未回訪"}</td>
                    <td>{participant.returnedToTopResident ? "通過" : "未通過"}</td>
                    <td>{participant.invalidRunIds.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="research-actions">
        <button className="research-action research-action--primary" type="button" onClick={exportJson} disabled={events.length === 0}>
          匯出單一 JSON
        </button>
        {!confirmingClear ? (
          <button className="research-action research-action--danger" type="button" onClick={() => setConfirmingClear(true)} disabled={events.length === 0}>
            準備清除紀錄
          </button>
        ) : (
          <div className="research-clear-confirm" role="group" aria-label="確認清除研究紀錄">
            <p>清除後無法復原。先確認 JSON 已下載。</p>
            <button type="button" onClick={() => setConfirmingClear(false)}>保留紀錄</button>
            <button type="button" onClick={clearRecords}>永久清除</button>
          </div>
        )}
      </section>
    </main>
  );
}

export function StudyRoot() {
  const route = useMemo(readStudyRoute, []);

  useEffect(() => {
    if (route.kind === "participant" || route.kind === "researcher") {
      registerStudyServiceWorker();
    }
  }, [route.kind]);

  if (
    (route.kind === "participant" || route.kind === "researcher") &&
    !STUDY_RUNTIME_APPROVED
  ) {
    return (
      <StudyMessage eyebrow="研究網址未通過核對" title="這裡不能讀寫研究紀錄">
        <p>這個頁面不在正式的安全研究網址上，因此沒有開啟裝置資料。請把裝置交還研究人員。</p>
      </StudyMessage>
    );
  }

  if (route.kind === "participant") {
    if (!APP_BUILD_ID) {
      return (
        <StudyMessage eyebrow="研究版本未封存" title="這個版本不能開始記錄">
          <p>這個網址沒有連到封存版本，因此不會寫入研究紀錄。請把裝置交還研究人員。</p>
        </StudyMessage>
      );
    }
    return <ParticipantStudy route={route} appBuildId={APP_BUILD_ID} />;
  }
  if (route.kind === "researcher") return <ResearcherConsole />;
  if (route.kind === "invalid") {
    return (
      <StudyMessage eyebrow="連結無法使用" title="無法開始這次觀看">
        <p>{route.message}</p>
      </StudyMessage>
    );
  }
  if (import.meta.env.PROD) {
    return (
      <StudyMessage eyebrow="受控研究階段" title="這裡不是研究入口">
        <p>本研究僅在一支受控手機上進行。只有研究人員提供的連結會開啟研究模式；此頁不會建立研究紀錄。</p>
      </StudyMessage>
    );
  }
  return <App />;
}
