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
 * 非模擬紀錄頁的更正橫幅：`SourceRevisionRef.refKind` 是後端自由字串（contracts/openapi/
 * public-v2.yaml `SourceRevisionRef`），不是窮舉的 enum。這裡只收錄目前切片實際出現過的
 * 幾種，換成人話說法；沒收錄的種類落 fallback，不臆測新詞。原始 `refKind`／`refId` 不在
 * 這裡顯示，只放進下面可展開的稽核抽屜（one-character-slice-runbook.md 相關走查）。
 * 未經 copy-taste 審稿。
 */
export const SOURCE_REF_KIND_LABEL: Readonly<Record<string, string>> = {
  world_fact_manifest: "世界事實清單",
  paper_account: "模擬帳戶",
  paper_position: "模擬部位",
};

/** `SOURCE_REF_KIND_LABEL` 沒收錄時的說法（未經 copy-taste 審稿）。 */
export const SOURCE_REF_KIND_FALLBACK = "其他來源資料";

/** 依人話標籤分組後的一個更正分類（`summarizeSourceRevisions` 的輸出）。 */
export type SourceRevisionCategory = {
  label: string;
  count: number;
};

/** `summarizeSourceRevisions` 的完整輸出；`refs.length === 0` 時上層另有 fail-closed 文案，不叫這個函式。 */
export type SourceRevisionSummary = {
  totalCount: number;
  /** 所有 ref 裡最大的 `revision`（「最新第 M 版」的 M）。 */
  latestRevision: number;
  /** 依筆數由多到少；筆數相同時保留第一次出現的順序（`Array.prototype.sort` 穩定排序）。 */
  categories: readonly SourceRevisionCategory[];
  /** 橫幅本體的一句摘要（未經 copy-taste 審稿）。 */
  sentence: string;
};

/**
 * 把一份文件的 `sourceRevisionSet`（可能有幾十筆，例如世界頁一次帶 30 筆
 * `world_fact_manifest`）收成橫幅本體用得到的一句摘要 ＋ 分類計數，原始
 * `refKind`／`refId` 不在這裡出現，交給呼叫端放進稽核抽屜。
 *
 * 分類用**人話標籤**分組，不是原始 `refKind`：兩種沒收錄的 `refKind` 都會落到
 * 同一個 `SOURCE_REF_KIND_FALLBACK`，分類計數要把它們合併成一筆，不能顯示兩行
 * 一樣的標籤。
 *
 * `refs.length === 0` 回傳 `null`；呼叫端維持既有的「沒有附上可核對的來源版本」
 * fail-closed 文案，不用這個函式生句子。
 */
export function summarizeSourceRevisions(
  refs: readonly SourceRevisionRef[],
): SourceRevisionSummary | null {
  if (refs.length === 0) return null;

  const order: string[] = [];
  const counts = new Map<string, number>();
  // `noUncheckedIndexedAccess`：用 for-of 逐一累計最大版本號，不索引 `refs[0]`。
  let latestRevision = -Infinity;
  for (const ref of refs) {
    const label = SOURCE_REF_KIND_LABEL[ref.refKind] ?? SOURCE_REF_KIND_FALLBACK;
    if (!counts.has(label)) {
      order.push(label);
      counts.set(label, 0);
    }
    counts.set(label, (counts.get(label) ?? 0) + 1);
    if (ref.revision > latestRevision) latestRevision = ref.revision;
  }

  const categories: SourceRevisionCategory[] = order.map((label) => ({
    label,
    count: counts.get(label) ?? 0,
  }));
  // 穩定排序（ES2019 起 Array#sort 保證穩定）：筆數相同時保留上面 for-of 的出現順序。
  categories.sort((a, b) => b.count - a.count);

  // `refs.length > 0` 已在上面 return 過，所以 `categories` 至少有一筆；這裡仍走一次
  // `undefined` 檢查是配合 `noUncheckedIndexedAccess`，不是真的可能發生。
  const primaryCategory = categories[0];
  if (primaryCategory === undefined) {
    return {
      totalCount: refs.length,
      latestRevision,
      categories,
      sentence: `${refs.length} 項資料有更正，最新第 ${latestRevision} 版。`,
    };
  }
  const primaryLabel = primaryCategory.label;
  // 未經 copy-taste 審稿：只有一種分類時不用「等」，避免「A 共 A 有更正」這種怪句。
  const sentence =
    categories.length === 1
      ? `${primaryLabel}共 ${refs.length} 項資料有更正，最新第 ${latestRevision} 版。`
      : `${primaryLabel}等 ${refs.length} 項資料有更正，最新第 ${latestRevision} 版。`;

  return { totalCount: refs.length, latestRevision, categories, sentence };
}

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

/**
 * 「其他頁」更正橫幅的本體：一句人話摘要 ＋ 依來源種類的分類計數 ＋「看全部更正」
 * 展開；展開後才看得到逐筆列表，而逐筆列表裡也只有人話標籤，原始 `refKind`／
 * `refId` 再往下收進巢狀的稽核 `<details>`（一路 fail closed，不臆測、不省略）。
 *
 * 用原生 `<details>`／`<summary>` 做展開收合，沒有另外掛 CSS 動畫或
 * transition，所以 reduced motion 不需要任何額外處理：展開本來就沒有動畫可關。
 * 這個檔案本來就是純呈現元件（見檔頭），不需要 hook 或 `window.matchMedia`。
 */
function SourceRevisionCorrections({ refs }: { refs: readonly SourceRevisionRef[] }) {
  const summary = summarizeSourceRevisions(refs);
  if (summary === null) {
    return <p className="v5-meta">這份文件沒有附上可核對的來源版本。{FAIL_CLOSED_NOTE}</p>;
  }
  return (
    <>
      {/* 人話摘要句＋分類計數給一般讀者；原始 refKind／refId 完全不在這裡出現。 */}
      <p className="panshi-paper">{summary.sentence}</p>
      <ul className="v5-corrections__counts" aria-label="依來源種類分類計數">
        {summary.categories.map((category) => (
          <li key={category.label}>
            {category.label}
            <span className="panshi-data">（{category.count} 筆）</span>
          </li>
        ))}
      </ul>
      <details className="v5-corrections__full">
        <summary>看全部更正</summary>
        <ul className="v5-corrections" aria-label="這頁依據的來源版本">
          {refs.map((ref) => (
            <li key={`${ref.refKind}-${ref.refId}`}>
              <span className="panshi-paper">{SOURCE_REF_KIND_LABEL[ref.refKind] ?? SOURCE_REF_KIND_FALLBACK}</span>
              <span className="panshi-data">（第 {ref.revision} 版）</span>
            </li>
          ))}
        </ul>
        <details className="v5-corrections__audit">
          <summary>稽核用原始識別碼</summary>
          <ul className="v5-corrections panshi-data" aria-label="原始來源識別碼">
            {refs.map((ref) => (
              <li key={`audit-${ref.refKind}-${ref.refId}`}>
                {ref.refKind}／{ref.refId}／第 {ref.revision} 版
              </li>
            ))}
          </ul>
        </details>
      </details>
    </>
  );
}

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
          <SourceRevisionCorrections refs={props.refs} />
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
