// 人生誌單章的證據卡（public-v2.yaml `EvidenceCard`；system-design.md
// 「Story generation failure」）。
//
// 一章的完整敘事沒有到（`narrativeState: evidence_card_only`）時，這一章**只**渲染
// 證據卡：他做了什麼（固定動作標籤）、紙上後果的數字，以及封存原話的逐字引用。
// 不渲染任何 narrative segment、不渲染九段、不補一句「他當時可能在想」。
//
// 數字規則沿用模擬紀錄頁：金額走 `format.ts` 的 `minorUnitsToTwd()`，方向同時有
// 文字（虧損／獲利／持平）與符號，顏色只是輔助；缺值寫「資料未到」，不補 0。
//
// 說明句是工程 placeholder，未經 copy-taste 審稿。

import type { EvidenceCard } from "../api/generated-v2/types.gen";
import { ItemTruthTag } from "./ItemTruthTag";
import { SystemLabel } from "./SystemLabel";
import { Utterance } from "./Utterance";
import { DATA_UNAVAILABLE_LABEL, minorUnitsToTwdOrNull } from "./format";
import { quantityFixed6ToText, unitPriceFixed6ToText } from "./paperCard";

export type SignedMoneyView = {
  /** 已格式化金額（含 U+2212 與千分位）；缺值時是「資料未到」。 */
  text: string;
  /** 方向的文字說法，讓顏色不是唯一訊號。 */
  directionLabel: string;
  direction: "negative" | "positive" | "flat" | "unknown";
};

/** 有號金額 → 文字與方向標籤。缺值或不是安全整數時 fail closed。 */
export function signedMoneyView(amountMinorUnits: number | null | undefined): SignedMoneyView {
  const text = minorUnitsToTwdOrNull(amountMinorUnits ?? null);
  if (text === null || typeof amountMinorUnits !== "number") {
    return { text: DATA_UNAVAILABLE_LABEL, directionLabel: DATA_UNAVAILABLE_LABEL, direction: "unknown" };
  }
  if (amountMinorUnits < 0) return { text, directionLabel: "虧損", direction: "negative" };
  if (amountMinorUnits > 0) return { text, directionLabel: "獲利", direction: "positive" };
  return { text, directionLabel: "持平", direction: "flat" };
}

/** 一格有號金額：標籤、金額與方向文字三者同一行，獲利與虧損同字級同版位。 */
export function SignedMoney({ label, amountMinorUnits }: { label: string; amountMinorUnits: number | null | undefined }) {
  const view = signedMoneyView(amountMinorUnits);
  return (
    <p className="v5-money" data-direction={view.direction}>
      <span className="v5-money__label panshi-data">{label}</span>{" "}
      <span className="v5-money__amount panshi-data">{view.text}</span>{" "}
      <span className="panshi-data">（{view.directionLabel}）</span>
    </p>
  );
}

const STYLES = `
.v5-evidence { margin: 0 0 .6rem; }
.v5-evidence__note { font-size: .85rem; color: var(--copper-500); margin: 0 0 .4rem; }
.v5-evidence__block { margin: 0 0 .7rem; }
.v5-evidence__block h4 { margin: 0 0 .25rem; font-size: .8rem; font-weight: 500; color: var(--copper-500); }
.v5-evidence__figures { display: grid; grid-template-columns: auto 1fr; gap: .1rem .9rem; margin: 0 0 .3rem; }
.v5-evidence__figures dt { color: var(--copper-500); }
.v5-evidence__figures dd { margin: 0; }
.v5-evidence__list { margin: 0; padding-inline-start: 1.1rem; }
.v5-money { margin: 0 0 .15rem; }
.v5-money[data-direction="negative"] .v5-money__amount { color: var(--value-negative); }
.v5-money[data-direction="positive"] .v5-money__amount { color: var(--value-positive); }
.v5-money[data-direction="unknown"] .v5-money__amount { color: var(--value-pending); }
`;

/** 證據卡只顯示封存事件本身；固定說明（placeholder，未經 copy-taste 審稿）。 */
export const EVIDENCE_CARD_ONLY_NOTE =
  "這一章的完整敘事沒有出版，只留下由封存事件組成的證據卡：動作、紙上後果與原話。";

export function EvidenceCardView({
  card,
  versionLabel,
  asOfFallback,
}: {
  card: EvidenceCard | undefined;
  versionLabel: string;
  /** 沒有紙上後果時，標籤用的資料時間（投影時間）。 */
  asOfFallback: string;
}) {
  if (card === undefined || card === null) {
    return <p className="v5-evidence__note panshi-paper">{DATA_UNAVAILABLE_LABEL}：這一章沒有證據卡。</p>;
  }

  const outcome = card.paperOutcome;
  const quantity = outcome ? quantityFixed6ToText(outcome.filledQuantityFixed6) : null;
  const price = outcome ? unitPriceFixed6ToText(outcome.sealedPriceMinorUnitsFixed6) : null;

  return (
    <section className="v5-evidence" aria-label="證據卡" data-evidence-card="true">
      <style>{STYLES}</style>
      <p className="v5-evidence__note panshi-paper">{EVIDENCE_CARD_ONLY_NOTE}</p>

      <section className="v5-evidence__block">
        <h4>動作</h4>
        <p className="panshi-data">{card.action.label}</p>
        <ItemTruthTag truthClass={card.action.truthClass} asOfLabel={asOfFallback} versionLabel={versionLabel} />
      </section>

      <section className="v5-evidence__block">
        <h4>紙上後果</h4>
        {outcome ? (
          <>
            <dl className="v5-evidence__figures panshi-data">
              <dt>成交數量</dt>
              <dd>{outcome.filledQuantityFixed6 === null ? "這一天沒有成交" : (quantity ?? DATA_UNAVAILABLE_LABEL)}</dd>
              <dt>封存成交價</dt>
              <dd>{outcome.sealedPriceMinorUnitsFixed6 === null ? "這一天沒有成交" : (price ?? DATA_UNAVAILABLE_LABEL)}</dd>
              <dt>手續費</dt>
              <dd>{minorUnitsToTwdOrNull(outcome.feeMinorUnits) ?? DATA_UNAVAILABLE_LABEL}</dd>
              <dt>交易稅</dt>
              <dd>{minorUnitsToTwdOrNull(outcome.taxMinorUnits) ?? DATA_UNAVAILABLE_LABEL}</dd>
              <dt>資料截至</dt>
              <dd>{outcome.asOf}</dd>
            </dl>
            <SignedMoney label="已實現損益" amountMinorUnits={outcome.realizedPnlMinorUnits} />
            <SignedMoney label="未實現損益" amountMinorUnits={outcome.unrealizedPnlMinorUnits} />
            <ItemTruthTag truthClass={outcome.truthClass} asOfLabel={outcome.asOf} versionLabel={versionLabel} />
          </>
        ) : (
          <SystemLabel field="paperOutcomeNullReason" text={card.paperOutcomeNullReason} />
        )}
      </section>

      <section className="v5-evidence__block">
        <h4>他說過的話</h4>
        {card.quotedUtterances.length === 0 ? (
          <p className="panshi-paper">這一章沒有封存任何原話。</p>
        ) : (
          card.quotedUtterances.map((quoted) => (
            <div key={quoted.utteranceArtifactId}>
              <p>
                <Utterance utterance={quoted} />
              </p>
              <ItemTruthTag truthClass={quoted.truthClass} asOfLabel={asOfFallback} versionLabel={versionLabel} />
            </div>
          ))
        )}
      </section>

      {card.memoryRefs.length === 0 && card.relationshipRefs.length === 0 ? null : (
        <section className="v5-evidence__block">
          <h4>留下的紀錄</h4>
          <ul className="v5-evidence__list">
            {card.memoryRefs.map((memory) => (
              <li key={memory.memoryRef}>
                <span className="panshi-paper">一則記憶（細節在深層檔案的「記憶」節）</span>{" "}
                <ItemTruthTag truthClass={memory.truthClass} asOfLabel={asOfFallback} versionLabel={versionLabel} />
              </li>
            ))}
            {card.relationshipRefs.map((relationship) => (
              <li key={relationship.relationshipSignalRef}>
                <span className="panshi-paper">一筆關係訊號（細節在深層檔案的「關係」節）</span>{" "}
                <ItemTruthTag truthClass={relationship.truthClass} asOfLabel={asOfFallback} versionLabel={versionLabel} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
