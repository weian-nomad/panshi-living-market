// 資料身分標籤（`docs/v5/experience-spec.md` §9.10：「標籤平時以小圖形加短詞顯示，
// 點開才看說明、時間與版本。」）。
//
// 邊界：本元件**不內建任何市場宣稱**。說明文字、資料時間與版本字串全部由 props 傳入，
// 元件只負責 truth_class 的短詞、幾何圖形與展開行為。這樣同一顆標籤才能同時服務
// 公共世界、近景、人生誌與深層檔案，而不會偷偷替某一頁補一句沒有 artifact 的話。
//
// 圖形是 inline SVG 幾何：不用 emoji、不用圖片檔，也不靠顏色分辨
//（visual-system.md：「不能只靠顏色、位置、聲音或動態表達狀態」）。
//
// 樣式在 `tokens.css`（class 前綴 `panshi-truth-tag`），由頁面 entry 一併載入，
// 沿用本 repo「CSS 在 entry import」的既有慣例。

import { useId, useState, useSyncExternalStore } from "react";

import type { TruthClass } from "../api/generated-v2/types.gen";
import { truthClassGlyphId, truthClassLabel } from "./format";
import { REDUCED_FADE_MAX_MS } from "./motion";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onStoreChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => {};
  }
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", onStoreChange);
  return () => query.removeEventListener("change", onStoreChange);
}

function readReducedMotion(): boolean {
  // 判不出來就當成「使用者要求減少動態」：fail closed 到最安靜的一邊。
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return true;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function TruthGlyph({ truthClass }: { truthClass: TruthClass }): React.ReactElement {
  const glyphId = truthClassGlyphId(truthClass);
  return (
    <svg
      className="panshi-truth-tag__glyph"
      data-glyph-id={glyphId}
      viewBox="0 0 12 12"
      aria-hidden="true"
      focusable="false"
    >
      {truthClass === "real_fact" ? (
        // 實心方形：已封存、可核對的外部事實。
        <rect x="2" y="2" width="8" height="8" fill="currentColor" />
      ) : null}
      {truthClass === "statistical_sample" ? (
        // 三根不等高柱：依分布取樣。
        <g fill="currentColor">
          <rect x="1.5" y="7" width="2" height="4" />
          <rect x="5" y="4.5" width="2" height="6.5" />
          <rect x="8.5" y="2" width="2" height="9" />
        </g>
      ) : null}
      {truthClass === "fictional_setting" ? (
        // 空心圓：設定，內部留白。
        <circle cx="6" cy="6" r="4" fill="none" stroke="currentColor" strokeWidth="1.4" />
      ) : null}
      {truthClass === "symbolic_interpretation" ? (
        // 菱形加中心點：命盤與象徵的文化詮釋。
        <g fill="none" stroke="currentColor" strokeWidth="1.2">
          <polygon points="6,1 11,6 6,11 1,6" />
          <circle cx="6" cy="6" r="0.9" fill="currentColor" stroke="none" />
        </g>
      ) : null}
      {truthClass === "simulated_narrative" ? (
        // 虛線方框：模擬產生的敘事，邊界不封閉。
        <rect
          x="1.7"
          y="1.7"
          width="8.6"
          height="8.6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeDasharray="2.6 1.9"
        />
      ) : null}
    </svg>
  );
}

export type TruthTagProps = {
  truthClass: TruthClass;
  /** 這一項資料身分的說明文字；由呼叫端提供，元件不自行編寫。 */
  explanation: string;
  /** 資料時間，例如 `formatAsOfIntraday()` 的輸出或封存時間。 */
  asOfLabel: string;
  /** 版本字串：policy／schema／manifest revision，由呼叫端提供。 */
  versionLabel: string;
  /** 額外 class，讓外層決定排版位置。 */
  className?: string;
};

export function TruthTag({
  truthClass,
  explanation,
  asOfLabel,
  versionLabel,
  className,
}: TruthTagProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const reducedMotion = useSyncExternalStore(subscribeReducedMotion, readReducedMotion, () => true);
  const popoverId = `${useId()}-truth-tag`;
  const label = truthClassLabel(truthClass);

  // 動態時間唯一來源是 motion.ts；reduced motion 分支直接不淡入。
  const fadeMs = reducedMotion ? 0 : REDUCED_FADE_MAX_MS;

  return (
    <span
      className={className ? `panshi-truth-tag ${className}` : "panshi-truth-tag"}
      data-truth-class={truthClass}
      data-reduced-motion={reducedMotion ? "true" : "false"}
      style={{ "--panshi-fade": `${fadeMs}ms` } as React.CSSProperties}
      onKeyDown={(event) => {
        if (event.key === "Escape" && expanded) {
          event.stopPropagation();
          setExpanded(false);
        }
      }}
    >
      <button
        type="button"
        className="panshi-truth-tag__toggle panshi-data"
        aria-expanded={expanded}
        aria-controls={popoverId}
        onClick={() => setExpanded((previous) => !previous)}
      >
        <TruthGlyph truthClass={truthClass} />
        <span>{label}</span>
      </button>
      {expanded ? (
        <span className="panshi-truth-tag__popover" id={popoverId} role="note">
          <span className="panshi-truth-tag__explanation panshi-paper">{explanation}</span>
          <span className="panshi-truth-tag__meta panshi-data">
            <span className="panshi-truth-tag__meta-key">資料時間</span>
            <span>{asOfLabel}</span>
            <span className="panshi-truth-tag__meta-key">版本</span>
            <span>{versionLabel}</span>
          </span>
        </span>
      ) : null}
    </span>
  );
}
