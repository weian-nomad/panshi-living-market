// 跟拍層（experience-spec.md §6.2、§6.3）。
//
// 鏡頭只顯示「鏡頭能知道的東西」：
//   - 姓名 ＋ 一個當下動詞
//   - 已封存 `UtteranceArtifactV1` 的**逐字**原話；沒有 artifact 就不補台詞
//   - 他正在看的人或物
//   - `SELF_ACKNOWLEDGED` 自述（若有）
//   - 事實來源入口（資料身分、資料時間、版本）
//   - 「再靠近一點」
//
// **不顯示**完整人格值、隱藏動機、持股明細或長段模型文字；離開跟拍也不提供
// 全知倒帶（§6.3）。跟拍的資訊代價由 `OFFSCREEN_DIM_OPACITY` 表現：鏡頭外的
// 世界降到 22% 明度、遠處姓名與字幕退場，觀眾知道別處仍在發生事情，但不能同時監看。
//
// 時間與明度常數一律 import `./motion`，本檔不寫任何字面數值。

import { useEffect, useState } from "react";

import type { CharacterCloseUp, CharacterUtterance } from "../api/generated-v2/types.gen";
import { TruthTag } from "./TruthTag";
import { fetchCloseUp, type UnavailableReason } from "./apiClient";
import { DATA_UNAVAILABLE_LABEL, formatAsOfIntraday } from "./format";
import { DIGEST_PREFIX_LENGTH } from "./journalSections";
import { CAMERA_FOLLOW_IN_MS, OFFSCREEN_DIM_OPACITY, REDUCED_FADE_MAX_MS } from "./motion";

const STYLES = `
.v5-follow {
  position: relative;
  margin: 12px 0 0;
  padding: 14px 16px;
  border: 1px solid var(--rule-paper);
  border-left: 3px solid var(--signal-420);
  background: var(--surface-panel);
  color: var(--paper-100);
  transition-property: opacity;
  transition-duration: var(--v5-follow-in, 0ms);
}
.v5-follow[data-phase="releasing"] { opacity: .82; }
.v5-follow__name { font-size: 1.05rem; margin: 0; font-weight: 500; }
.v5-follow__verb { margin: .15rem 0 .6rem; color: var(--paper-260); }
.v5-follow__quote {
  margin: 0 0 .35rem;
  padding-inline-start: .75rem;
  border-inline-start: 2px solid var(--copper-500);
}
.v5-follow__attr { margin: 0 0 .8rem; font-size: .75rem; color: var(--paper-260); }
.v5-follow__row { margin: 0 0 .4rem; }
.v5-follow__label { color: var(--paper-260); margin-inline-end: .5em; }
.v5-follow__foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
}
.v5-follow__cta {
  min-height: 44px;
  padding: .35em 1em;
  border: 1px solid var(--copper-500);
  border-radius: 2px;
  background: transparent;
  color: var(--paper-100);
  font: inherit;
  cursor: pointer;
}
.v5-follow__cta:focus-visible { outline: 2px solid var(--signal-420); outline-offset: 2px; }
.v5-follow__note { margin: .6rem 0 0; font-size: .8rem; color: var(--paper-260); }
`;

/**
 * 鏡頭外世界的明度（`OFFSCREEN_DIM_OPACITY`）。由世界畫面套在「非鏡頭主體」的
 * 圖層上，跟拍層自己不改別人的樣式。
 */
export function offscreenDimStyle(cameraOnSubject: boolean): React.CSSProperties {
  return {
    "--v5-offscreen-dim": cameraOnSubject ? String(OFFSCREEN_DIM_OPACITY) : "1",
    "--v5-follow-in": `${CAMERA_FOLLOW_IN_MS}ms`,
    "--v5-reduced-fade": `${REDUCED_FADE_MAX_MS}ms`,
  } as React.CSSProperties;
}

type FollowContent =
  | { phase: "loading" }
  | { phase: "ready"; closeUp: CharacterCloseUp }
  | { phase: "unavailable"; reasonCode: UnavailableReason }
  | { phase: "error" };

const REASON_LABEL: Readonly<Record<UnavailableReason, string>> = {
  UNKNOWN_RESOURCE: "這個人現在沒有可公開的鏡頭。",
  VISIBILITY_HELD: "這一段正在人工覆核中。",
  WITHDRAWN: "這名居民已退出世界。",
  RIGHTS_REVOKED: "這一段引用的來源授權已收回。",
  PROJECTION_LAGGING: "投影落後於事件流。",
  CANONICAL_RESTRICTED: "這份資料不對外開放。",
  MALFORMED_CURSOR: "翻頁位置無效。",
  UNRECOGNIZED_RESPONSE: "回應格式無法辨識。",
  MALFORMED_PAYLOAD: "回應不是合法的 JSON。",
  INCOMPLETE_PROJECTION: "回應缺少契約必填欄位。",
};

function isLiveCloseUp(value: unknown): value is CharacterCloseUp {
  return typeof value === "object" && value !== null && !("tombstoneReasonLabel" in value);
}

function digestPrefix(utterance: CharacterUtterance): string {
  return utterance.canonicalTextSha256.slice(0, DIGEST_PREFIX_LENGTH);
}

function asOfLabel(asOfTradingDate: string | null): string {
  if (asOfTradingDate === null) return DATA_UNAVAILABLE_LABEL;
  try {
    return formatAsOfIntraday(asOfTradingDate);
  } catch {
    return DATA_UNAVAILABLE_LABEL;
  }
}

function versionLabel(closeUp: CharacterCloseUp): string {
  const first = closeUp.sourceRevisionSet[0];
  if (!first) return DATA_UNAVAILABLE_LABEL;
  return `${first.refKind} r${first.revision}`;
}

/** 一句逐字原話：一定同時標出 artifact id 與 digest 前 8 碼，才能被核對。 */
function Utterance({ utterance, label }: { utterance: CharacterUtterance; label: string }) {
  return (
    <>
      <p className="v5-follow__quote panshi-paper">「{utterance.canonicalTextUtf8}」</p>
      <p className="v5-follow__attr panshi-data">
        {label}／{utterance.utteranceArtifactId}／sha256 {digestPrefix(utterance)}
      </p>
    </>
  );
}

export type FollowLayerProps = {
  characterId: string;
  /** 鏡頭階段；`releasing` 時畫面仍保留這個人，只是準備回全景。 */
  phase: "following" | "handoff" | "releasing";
  /** 世界時鐘的資料截至交易日；沒有就顯示「資料未到」，不推算。 */
  asOfTradingDate: string | null;
  onOpenCloseUp: (characterId: string) => void;
};

export function FollowLayer({
  characterId,
  phase,
  asOfTradingDate,
  onOpenCloseUp,
}: FollowLayerProps) {
  const [content, setContent] = useState<FollowContent>({ phase: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setContent({ phase: "loading" });

    fetchCloseUp(characterId, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.status === "ready") {
          setContent(
            isLiveCloseUp(result.data)
              ? { phase: "ready", closeUp: result.data }
              : { phase: "unavailable", reasonCode: "WITHDRAWN" },
          );
          return;
        }
        setContent(
          result.status === "unavailable"
            ? { phase: "unavailable", reasonCode: result.reasonCode }
            : { phase: "error" },
        );
      })
      .catch(() => {
        if (!controller.signal.aborted) setContent({ phase: "error" });
      });

    return () => controller.abort();
  }, [characterId]);

  return (
    <section
      className="v5-follow panshi-motion"
      data-phase={phase}
      aria-label="跟拍鏡頭"
      aria-live="polite"
    >
      <style>{STYLES}</style>

      {content.phase === "loading" ? (
        <p className="v5-follow__row">正在接回鏡頭前的這個人。</p>
      ) : null}

      {content.phase === "error" ? (
        <p className="v5-follow__row">{DATA_UNAVAILABLE_LABEL}：連線中斷，鏡頭停在最後的靜態狀態。</p>
      ) : null}

      {content.phase === "unavailable" ? (
        <p className="v5-follow__row">
          {DATA_UNAVAILABLE_LABEL}：{REASON_LABEL[content.reasonCode]}
        </p>
      ) : null}

      {content.phase === "ready" ? (
        <>
          <p className="v5-follow__name">{content.closeUp.displayName}</p>
          <p className="v5-follow__verb panshi-paper">{content.closeUp.currentVerbPhrase}</p>

          {content.closeUp.publicClaim ? (
            <Utterance utterance={content.closeUp.publicClaim} label="他當場說的話" />
          ) : (
            // 沒有已封存的原話就不補台詞（§6.2）。
            <p className="v5-follow__row panshi-paper">他沒有說話。</p>
          )}

          {content.closeUp.currentAttention ? (
            <p className="v5-follow__row panshi-paper">
              <span className="v5-follow__label">他正在看</span>
              {content.closeUp.currentAttention.label}
            </p>
          ) : null}

          {content.closeUp.selfAcknowledgement ? (
            <Utterance utterance={content.closeUp.selfAcknowledgement} label="他對自己說的話" />
          ) : null}

          <div className="v5-follow__foot">
            <TruthTag
              truthClass="fictional_setting"
              explanation="這個世界的市場事實是 repo 內自有的合成歷史 fixture，不是真實行情。"
              asOfLabel={asOfLabel(asOfTradingDate)}
              versionLabel={versionLabel(content.closeUp)}
            />
            <button
              type="button"
              className="v5-follow__cta"
              onClick={() => onOpenCloseUp(characterId)}
            >
              再靠近一點
            </button>
          </div>

          <p className="v5-follow__note panshi-paper">
            鏡頭只帶得走看得見的東西。離開跟拍不會有全知倒帶。
          </p>
        </>
      ) : null}
    </section>
  );
}
