// V5 切片的資料狀態面板（experience-spec §17：loading、空、過期、held、更正、退出、離線）。
//
// 這裡全部是**純呈現元件**：沒有 hook、不碰 `window`／`matchMedia`／storage，
// 所以 `react-dom/server` 的 `renderToStaticMarkup` 在沒有 DOM 的 node 環境也能渲染，
// 七種狀態因此都有 node 端的渲染測試（`statePanels.test.tsx`、`SliceApp.test.tsx`）。
//
// 共同規則：
// - 狀態一律有文字標題與 `data-state`，不只靠顏色（visual-system.md「不能只靠顏色」）。
// - 標題 `tabIndex={-1}`，切換狀態時外殼可以把焦點移到這裡；播報由外殼唯一的
//   `role="status"` live region 負責，面板本身不再開第二個 live region。
// - 任何缺事實的狀態都落在 `FAIL_CLOSED_NOTE`，不補值、不用 0 或佔位字串冒充資料。
//
// 文案狀態：本檔新增的繁中說明句是**工程 placeholder，未經 copy-taste 審稿**；
// 既有句（`DATA_STATE_LABEL`、`UNAVAILABLE_LABEL`、讀取失敗、離線）原樣搬移。

import type {
  DataRevisionKind,
  DataRevisionNote,
  DataState,
  SourceRevisionRef,
  TruthClass,
} from "../api/generated-v2/types.gen";
import type { UnavailableReason } from "./apiClient";
import { truthClassLabel } from "./format";
import { EMPTY_POSITION_TEXT } from "./paperCard";

// The slice never fills a gap with a guess; every failure lands on this line.
export const FAIL_CLOSED_NOTE = "資料未到，這裡不補值。";

/** 狀態標題的共同 id：外殼切換狀態時把焦點移到這裡。 */
export const STATE_HEADING_ID = "v5-state-heading";

/** 模擬紀錄頁「更正紀錄」段落的錨點；其他頁的更正橫幅連到這裡。 */
export const PAPER_CORRECTIONS_ANCHOR = "paper-corrections";

export const DATA_STATE_LABEL: Readonly<Record<DataState, string>> = {
  READY: "資料已就緒",
  STALE: "資料已過期，顯示的是上一次通過封存的版本",
  HELD: "這頁的內容正在人工覆核中，暫不顯示",
  CORRECTED: "這頁有更正紀錄",
  WITHDRAWN: "這名居民已退出世界，只保留退出說明",
};

export const UNAVAILABLE_LABEL: Readonly<Record<UnavailableReason, string>> = {
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

// 未經 copy-taste 審稿。
export const DATA_REVISION_KIND_LABEL: Readonly<Record<DataRevisionKind, string>> = {
  fact_correction: "事實更正",
  accounting_correction: "帳務更正",
  position_adjustment: "部位調整",
};

/**
 * 三種「本來就是空的」狀態。空不是讀取失敗：每一種都要說出**為什麼是空的**，
 * 而且不得用 0 或佔位字串冒充資料。
 */
export type EmptyReason = "journal_no_chapters" | "world_no_residents" | "paper_no_positions";

// 未經 copy-taste 審稿（`paper_no_positions` 的 body 沿用既有 `EMPTY_POSITION_TEXT`）。
export const EMPTY_STATE_COPY: Readonly<Record<EmptyReason, { title: string; body: string; why: string }>> = {
  journal_no_chapters: {
    title: "還沒有任何章節",
    body: "還沒有出版任何章節。第一章出版後會留在這裡。",
    why: "人生誌只收已封存、通過發布的日章節；這個人目前一章都還沒有通過，所以這裡是空的，不是讀取失敗。",
  },
  world_no_residents: {
    title: "這一輪沒有居民在場",
    body: "開盤廳現在是空的。",
    why: "這一輪的世界投影沒有回傳任何居民座標；他們去了哪裡，投影沒有交代，這裡不猜位置，也不補人。",
  },
  paper_no_positions: {
    title: "目前沒有持股",
    body: EMPTY_POSITION_TEXT,
    why: "這份模擬紀錄裡沒有任何持股部位，所以持股段是空的；帳戶與交易紀錄照常顯示。",
  },
};

function StateHeading({ children, className }: { children: string; className?: string }) {
  return (
    <h2 id={STATE_HEADING_ID} tabIndex={-1} className={className}>
      {children}
    </h2>
  );
}

// ---- 1. Loading ------------------------------------------------------------

export function LoadingPanel({ heading, reducedMotion }: { heading: string; reducedMotion: boolean }) {
  return (
    <section className="v5-panel" data-state="loading" aria-busy="true">
      {/* reduced motion 時不加會動的 class，只留文字。 */}
      <StateHeading className={reducedMotion ? undefined : "v5-busy"}>載入中</StateHeading>
      <p className="v5-meta">正在讀取 {heading} 的投影。</p>
    </section>
  );
}

// ---- 2. Empty --------------------------------------------------------------

/** 畫面內的空狀態：不搶頁面層級的狀態標題，所以用 h3、不帶 `STATE_HEADING_ID`。 */
export function EmptyStatePanel({ reason }: { reason: EmptyReason }) {
  const copy = EMPTY_STATE_COPY[reason];
  return (
    <section className="v5-panel" data-state="empty" data-empty-reason={reason}>
      <h3 tabIndex={-1}>{copy.title}</h3>
      <p className="panshi-paper">{copy.body}</p>
      <p className="v5-meta">為什麼是空的：{copy.why}</p>
    </section>
  );
}

// ---- 3. Stale --------------------------------------------------------------

/** 過期橫幅：必須排在任何內容之前（外殼負責順序）。 */
export function StaleBanner({ dataTime }: { dataTime: string }) {
  return (
    <section className="v5-panel" data-tone="warn" data-state="stale">
      <StateHeading>資料已過期</StateHeading>
      <p>{DATA_STATE_LABEL.STALE}。</p>
      <p className="v5-meta">
        資料時間 <span className="panshi-data">{dataTime}</span>。新的版本通過封存前，這裡不會換成猜測的新數字。
      </p>
    </section>
  );
}

// ---- 4. Held（頁面層級） ------------------------------------------------------

export function HeldPanel() {
  return (
    <section className="v5-panel" data-tone="warn" data-state="held">
      <StateHeading>內容覆核中</StateHeading>
      <p>{DATA_STATE_LABEL.HELD}。覆核結束後會以新的版本出現，舊的內容不會先露出來。</p>
      <p className="v5-meta">{FAIL_CLOSED_NOTE}</p>
    </section>
  );
}

// ---- 5. Corrected ----------------------------------------------------------

export type CorrectedBannerProps =
  | {
      /** 模擬紀錄頁：列出本文件的 `dataRevisions`。 */
      scope: "paper";
      revisions: readonly DataRevisionNote[];
    }
  | {
      /** 其他頁：列出文件內可取得的來源版本 refs，並連到模擬紀錄的更正段落。 */
      scope: "other";
      refs: readonly SourceRevisionRef[];
      /** `null`：這頁不屬於某一位人物（例如世界），沒有可連過去的模擬紀錄。 */
      correctionsHref: string | null;
      onOpenCorrections?: () => void;
    };

export function CorrectedBanner(props: CorrectedBannerProps) {
  return (
    <section className="v5-panel" data-tone="warn" data-state="corrected">
      <StateHeading>有更正</StateHeading>
      <p>{DATA_STATE_LABEL.CORRECTED}：舊版保留，更正以新增紀錄的方式出現，不改寫當時發生的事。</p>

      {props.scope === "paper" ? (
        props.revisions.length === 0 ? (
          <p className="v5-meta">投影標記為已更正，但沒有附上更正說明。{FAIL_CLOSED_NOTE}</p>
        ) : (
          <>
            <ul className="v5-corrections">
              {props.revisions.map((revision) => (
                <li key={revision.revisionId}>
                  <span className="panshi-data">{DATA_REVISION_KIND_LABEL[revision.kind]}</span>
                  ：<span className="panshi-paper">{revision.summary}</span>
                </li>
              ))}
            </ul>
            <p className="v5-meta">
              <a href={`#${PAPER_CORRECTIONS_ANCHOR}`}>看下方完整更正紀錄</a>
            </p>
          </>
        )
      ) : (
        <>
          {props.refs.length === 0 ? (
            <p className="v5-meta">這份文件沒有附上可核對的來源版本。{FAIL_CLOSED_NOTE}</p>
          ) : (
            <ul className="v5-corrections panshi-data" aria-label="這頁依據的來源版本">
              {props.refs.map((ref) => (
                <li key={`${ref.refKind}-${ref.refId}`}>
                  {ref.refKind}／{ref.refId}／第 {ref.revision} 版
                </li>
              ))}
            </ul>
          )}
          {props.correctionsHref === null ? (
            <p className="v5-meta">這頁不屬於某一位人物，沒有對應的模擬紀錄更正段落。</p>
          ) : (
            <p className="v5-meta">
              <a
                href={props.correctionsHref}
                onClick={(event) => {
                  if (!props.onOpenCorrections) return;
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
                  event.preventDefault();
                  props.onOpenCorrections();
                }}
              >
                到模擬紀錄看更正內容
              </a>
            </p>
          )}
        </>
      )}
    </section>
  );
}

// ---- 6. Withdrawn ----------------------------------------------------------

export function WithdrawnPanel({
  tombstoneReasonLabel,
  truthClasses,
}: {
  /** 投影帶來的退出說明，逐字顯示；`null` 表示投影沒有附（例如世界層級），fail closed。 */
  tombstoneReasonLabel: string | null;
  truthClasses: readonly TruthClass[];
}) {
  return (
    <section className="v5-panel" data-tone="warn" data-state="withdrawn">
      <StateHeading>已退出世界</StateHeading>
      {tombstoneReasonLabel === null ? (
        <p>{DATA_STATE_LABEL.WITHDRAWN}。</p>
      ) : (
        <p className="panshi-paper" data-tombstone-reason="">
          {tombstoneReasonLabel}
        </p>
      )}
      <p className="v5-meta">{FAIL_CLOSED_NOTE}</p>
      <ul className="v5-truth" aria-label="本頁事實類別">
        {truthClasses.map((truthClass) => (
          <li key={truthClass}>{truthClassLabel(truthClass)}</li>
        ))}
      </ul>
    </section>
  );
}

// ---- 7. Offline ------------------------------------------------------------

/** 有上次載入的版本可讀時，排在最前面的橫幅。 */
export function OfflineCachedBanner({ dataTime }: { dataTime: string }) {
  return (
    <section className="v5-panel" data-tone="warn" data-state="offline">
      <StateHeading>離線中</StateHeading>
      <p>離線中，顯示你上次載入的版本（截至 {dataTime}）。</p>
      <p className="v5-meta">世界仍在繼續，這台裝置暫時看不到更新的版本。</p>
    </section>
  );
}

/** 沒有連線、也沒有可顯示的上次版本。 */
export function OfflinePanel() {
  return (
    <section className="v5-panel" data-tone="warn" data-state="offline">
      <h2>離線</h2>
      <p>目前沒有連線。世界仍在繼續，只是這台裝置看不到最新一筆。</p>
      <p className="v5-meta">{FAIL_CLOSED_NOTE}</p>
    </section>
  );
}

// ---- 其餘失敗 --------------------------------------------------------------

export function ReadFailurePanel() {
  return (
    <section className="v5-panel" data-tone="warn" data-state="error">
      <StateHeading>讀取失敗</StateHeading>
      <p>連線中斷或請求被取消，沒有取得任何投影。</p>
      <p className="v5-meta">{FAIL_CLOSED_NOTE}</p>
    </section>
  );
}

export function UnavailablePanel({
  reasonCode,
  httpStatus,
}: {
  reasonCode: UnavailableReason;
  httpStatus: number;
}) {
  return (
    <section className="v5-panel" data-tone="warn" data-state="unavailable">
      <StateHeading>這頁現在不可見</StateHeading>
      <p>{UNAVAILABLE_LABEL[reasonCode]}</p>
      <p className="v5-meta">
        HTTP {httpStatus}／reasonCode {reasonCode}。{FAIL_CLOSED_NOTE}
      </p>
    </section>
  );
}

export function NotFoundPanel() {
  return (
    <section className="v5-panel" data-tone="warn" data-state="not-found">
      <StateHeading>找不到這個頁面</StateHeading>
      <p className="v5-meta">這個網址不屬於切片的五個公開位址。{FAIL_CLOSED_NOTE}</p>
    </section>
  );
}
