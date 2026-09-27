// 模擬紀錄頁（`docs/v5/experience-spec.md` §9.2、§9.4；版面規則見
// `docs/v5/visual-system.md`「持股與績效」）。
//
// 這一頁是完整的紙上承擔：持股主卡固定七段，下面接按 canonical 時序排列的交易紀錄。
// 本檔只負責排版，段序、數字與文字全部來自 `paperCard.ts` 的純 mapper。
//
// 排版硬規則：
// - 所有市場數字走 `.panshi-data`（tabular figures）；角色說法與長文走 `.panshi-paper`。
// - 獲利與虧損視覺重量相同：同字級、同字重、同版位；方向同時有文字與符號，
//   顏色只是輔助，不是唯一訊號。
// - 不用煙火、金幣、皇冠或任何慶祝物件。
// - 逐字原話走 `Utterance`（CSS 產生引號、逐字不改寫）並附 artifact id 與 digest 前 8 碼；
//   結構化摘要一律不加引號。
// - 每張主卡下面接一組「原本理由｜現在說法｜紙上代價｜關係後果」並排比較，
//   讓成本、損益、原始理由與退出條件在同一個視線裡。

import { useEffect } from "react";

import type {
  PaperArchiveProjection,
  PaperPositionPublic,
  TruthClass,
} from "../api/generated-v2/types.gen";
import { ClaimComparison } from "./ClaimComparison";
import { SignedMoney } from "./EvidenceCardView";
import { ItemTruthTag } from "./ItemTruthTag";
import { TruthTag } from "./TruthTag";
import { Utterance } from "./Utterance";
import { DATA_UNAVAILABLE_LABEL, declaredTruthClass, minorUnitsToTwdOrNull, truthClassLabel } from "./format";
import {
  minorUnitsToTwdText,
  paperActionRows,
  paperCardSections,
  type PaperCardBody,
  type PaperQuoteView,
} from "./paperCard";
import { DATA_REVISION_KIND_LABEL, EmptyStatePanel, PAPER_CORRECTIONS_ANCHOR } from "./statePanels";

const TRUTH_CLASS_EXPLANATION: Readonly<Record<TruthClass, string>> = {
  real_fact: "已封存並可回溯到外部來源的事實。",
  statistical_sample: "依分布取樣的統計結果，不是單一個案的事實。",
  fictional_setting: "虛構設定：標的與市場事實都是這個 repo 自有的合成歷史 fixture。",
  symbolic_interpretation: "命盤與象徵的文化詮釋，只影響他的注意與解讀，不改動價格資料。",
  simulated_narrative: "由已封存事件編成的模擬敘事，包含他的紙上交易與故事投影。",
};

const STYLES = `
.v5-paper { margin: 0 0 16px; }
.v5-paper__truth { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 16px; }
.v5-paper__account { margin: 0 0 20px; }
.v5-paper__account dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: .15rem .9rem;
  margin: 0;
}
.v5-paper__account dt { color: var(--copper-500); }
.v5-paper__account dd { margin: 0; }
.v5-paper__card {
  margin: 0 0 24px;
  padding: 0 0 14px;
  border-bottom: 1px solid var(--rule-paper);
}
.v5-paper__card h3 { margin: 0 0 .5rem; font-size: 1rem; font-weight: 500; }
.v5-paper__step { margin: 0 0 14px; }
.v5-paper__step h4 {
  margin: 0 0 .25rem;
  font-size: .8rem;
  font-weight: 500;
  color: var(--copper-500);
}
.v5-paper__step p { margin: 0 0 .2rem; }
.v5-paper__figures {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
  gap: .35rem .9rem;
  margin: 0;
}
.v5-paper__figure { display: flex; flex-direction: column; }
.v5-paper__figure-label { font-size: .72rem; color: var(--copper-500); }
/* 獲利與虧損同字級、同字重、同版位：只有文字與符號不同。 */
.v5-paper__pnl { display: grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); gap: .35rem .9rem; margin: 0; }
.v5-paper__pnl-item { display: flex; flex-direction: column; font-size: 1rem; font-weight: 400; }
.v5-paper__pnl-item[data-direction="negative"] .v5-paper__pnl-amount { color: var(--value-negative); }
.v5-paper__pnl-item[data-direction="positive"] .v5-paper__pnl-amount { color: var(--value-positive); }
.v5-paper__pnl-item[data-direction="unknown"] .v5-paper__pnl-amount { color: var(--value-pending); }
.v5-paper__pnl-label { font-size: .72rem; color: var(--copper-500); }
.v5-paper__quote {
  margin: 0 0 .25rem;
  padding-inline-start: .75rem;
  border-inline-start: 2px solid var(--copper-500);
}
.v5-paper__attr { font-size: .72rem; color: var(--copper-500); }
.v5-paper__refs { margin: 0; display: grid; grid-template-columns: auto 1fr; gap: .15rem .9rem; }
.v5-paper__refs dt { color: var(--copper-500); }
.v5-paper__refs dd { margin: 0; overflow-wrap: anywhere; }
.v5-paper__rows { margin: 0; padding: 0; list-style: none; }
.v5-paper__row {
  margin: 0 0 12px;
  padding: 0 0 10px;
  border-bottom: 1px solid var(--rule-paper);
}
.v5-paper__row-date { font-size: .8rem; color: var(--copper-500); }
.v5-paper__foot { margin: 18px 0 0; display: flex; flex-wrap: wrap; gap: 10px; }
.v5-paper__foot button {
  min-height: 44px;
  padding: .4em 1.1em;
  border: 1px solid var(--copper-500);
  border-radius: 2px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.v5-paper__foot button:focus-visible { outline: 2px solid var(--signal-420); outline-offset: 2px; }
@media (max-width: 600px) {
  .v5-paper__figures { grid-template-columns: 1fr 1fr; }
}
`;

function Quote({ quote }: { quote: PaperQuoteView }) {
  return (
    <>
      <p className="v5-paper__quote">
        <Utterance
          utterance={{
            utteranceArtifactId: quote.utteranceArtifactId,
            canonicalTextSha256: quote.canonicalTextSha256,
            canonicalTextUtf8: quote.text,
          }}
        />
      </p>
      <p className="v5-paper__attr panshi-data">
        {quote.utteranceArtifactId}／sha256 {quote.digestPrefix}
      </p>
    </>
  );
}

function CardBody({ body }: { body: PaperCardBody }) {
  switch (body.kind) {
    case "verb":
      return (
        <>
          <p className="panshi-paper">{body.text}</p>
          {body.disclosureMode === "intraday_previous_session" ? (
            <p className="v5-paper__attr panshi-data">
              今天的交易時段還沒收盤定案，所以這一句只描述前一個交易日已公開的狀態。
            </p>
          ) : null}
        </>
      );

    case "asOf":
      return <p className="panshi-data">{body.text}</p>;

    case "figures":
      return (
        <div className="v5-paper__figures">
          {body.figures.map((figure) => (
            <span className="v5-paper__figure" key={figure.label}>
              <span className="v5-paper__figure-label panshi-data">{figure.label}</span>
              <span className="panshi-data">{figure.text}</span>
            </span>
          ))}
        </div>
      );

    case "pnl":
      return (
        <div className="v5-paper__pnl">
          {body.entries.map((entry) => (
            <span className="v5-paper__pnl-item" data-direction={entry.direction} key={entry.label}>
              <span className="v5-paper__pnl-label panshi-data">{entry.label}</span>
              <span className="v5-paper__pnl-amount panshi-data">
                {entry.amountText === null ? DATA_UNAVAILABLE_LABEL : entry.amountText}
                {entry.percentText === null ? "" : `　${entry.percentText}`}
              </span>
              {/* 方向的文字說法：顏色不是唯一訊號。 */}
              <span className="panshi-data">{entry.directionLabel}</span>
            </span>
          ))}
        </div>
      );

    case "rationale":
      return (
        <>
          {/* 結構化理由：不加引號。 */}
          <p className="panshi-paper">{body.summary}</p>
          <p className="panshi-data">
            退出條件（失效條件）：{body.invalidationLabel}
            {body.invalidationOccurred ? "（已觸發）" : ""}
          </p>
          {body.concurrentClaim === null ? (
            <p className="v5-paper__attr panshi-paper">{body.concurrentClaimAbsenceText}</p>
          ) : (
            <Quote quote={body.concurrentClaim} />
          )}
        </>
      );

    case "currentClaim":
      return (
        <>
          {body.quote === null ? null : <Quote quote={body.quote} />}
          {body.summaryText === null ? null : <p className="panshi-paper">{body.summaryText}</p>}
          {body.absenceText === null ? null : (
            <p className="v5-paper__attr panshi-paper">{body.absenceText}</p>
          )}
          <p className="panshi-data">{body.newlySupportedFactsText}</p>
        </>
      );

    case "refs":
      return (
        <dl className="v5-paper__refs panshi-data">
          {body.items.map((item, index) => (
            <div style={{ display: "contents" }} key={`${item.label}-${index}`}>
              <dt>{item.label}</dt>
              <dd>{item.text}</dd>
            </div>
          ))}
        </dl>
      );
  }
}

/** 模擬紀錄的紙上數字與故事投影＝模擬敘事；投影沒宣告就不掛（同 `declaredTruthClass()`）。 */
function PaperClaimTag({ archive }: { archive: PaperArchiveProjection }) {
  const truthClass = declaredTruthClass(archive.truthClasses, "simulated_narrative");
  if (truthClass === null) {
    return (
      <p className="v5-paper__attr panshi-paper">
        {DATA_UNAVAILABLE_LABEL}：投影沒有宣告「{truthClassLabel("simulated_narrative")}」這個資料身分，所以這裡不掛標籤。
      </p>
    );
  }
  return (
    <ItemTruthTag
      truthClass={truthClass}
      asOfLabel={archive.asOf}
      versionLabel={`projection v${archive.projectionVersion}`}
    />
  );
}

/** 一個部位的四欄並排比較（欄內說明未經 copy-taste 審稿）。 */
function PositionComparison({
  archive,
  position,
}: {
  archive: PaperArchiveProjection;
  position: PaperPositionPublic;
}) {
  const versionLabel = `projection v${archive.projectionVersion}`;
  const narration = position.currentNarration;
  let costBasis: number | null = 0;
  for (const lot of position.lots) {
    costBasis =
      costBasis !== null && Number.isSafeInteger(lot.costBasisMinorUnits)
        ? costBasis + lot.costBasisMinorUnits
        : null;
  }
  const costText = minorUnitsToTwdOrNull(costBasis);

  return (
    <ClaimComparison
      title={`${position.instrumentLabel}：當時和現在並排`}
      columns={{
        originalReason: (
          <>
            {/* 結構化理由：不加引號。 */}
            <p className="panshi-paper">{position.rationaleSummary}</p>
            {position.concurrentClaim === undefined ? (
              <p className="v5-paper__attr panshi-paper">當時沒有可核對的公開原話。</p>
            ) : (
              <p>
                <Utterance utterance={position.concurrentClaim} />
              </p>
            )}
            <PaperClaimTag archive={archive} />
          </>
        ),
        currentClaim: (
          <>
            {narration === undefined ? (
              <p className="v5-paper__attr panshi-paper">他還沒有新的公開說法。</p>
            ) : narration.kind === "utterance" ? (
              <p>
                <Utterance utterance={narration} />
              </p>
            ) : (
              <p className="panshi-paper">{narration.summaryText}</p>
            )}
            <PaperClaimTag archive={archive} />
          </>
        ),
        paperCost: (
          <>
            <p className="panshi-data">成本 {costText ?? DATA_UNAVAILABLE_LABEL}</p>
            <SignedMoney label="已實現損益" amountMinorUnits={position.realizedPnlMinorUnits} />
            <SignedMoney label="未實現損益" amountMinorUnits={position.unrealizedPnlMinorUnits} />
            <p className="v5-paper__attr panshi-data">資料截至 {position.markAsOf}</p>
            <PaperClaimTag archive={archive} />
          </>
        ),
        relationship:
          position.influencedBy.length === 0 ? (
            <p className="panshi-paper">{position.influencedByEmptyReason ?? DATA_UNAVAILABLE_LABEL}</p>
          ) : (
            position.influencedBy.map((influence, index) => (
              <div key={`${influence.displayName}-${index}`}>
                <p className="panshi-paper">
                  {influence.displayName}（{influence.relationLabel}）：{influence.influenceSummary}
                </p>
                <ItemTruthTag truthClass={influence.truthClass} asOfLabel={archive.asOf} versionLabel={versionLabel} />
              </div>
            ))
          ),
      }}
    />
  );
}

export type PaperArchiveScreenProps = {
  archive: PaperArchiveProjection;
  onBackToArchiveIndex: () => void;
};

export function PaperArchiveScreen({ archive, onBackToArchiveIndex }: PaperArchiveScreenProps) {
  const rows = paperActionRows(archive);

  // 從其他頁的更正橫幅連過來（`#paper-corrections`）時，內容是非同步載入的，
  // 瀏覽器自己的錨點捲動已經錯過；掛載後補一次焦點。
  useEffect(() => {
    if (window.location.hash !== `#${PAPER_CORRECTIONS_ANCHOR}`) return;
    document.getElementById(PAPER_CORRECTIONS_ANCHOR)?.focus();
  }, []);
  const initialCapital = minorUnitsToTwdText(archive.account.initialCapitalMinorUnits);
  const cash = minorUnitsToTwdText(archive.account.cashMinorUnits);

  return (
    <section className="v5-paper" aria-label="模擬紀錄">
      <style>{STYLES}</style>

      <div className="v5-paper__truth">
        {archive.truthClasses.map((truthClass) => (
          <TruthTag
            key={truthClass}
            truthClass={truthClass}
            explanation={TRUTH_CLASS_EXPLANATION[truthClass]}
            asOfLabel={archive.asOf}
            versionLabel={`projection v${archive.projectionVersion}`}
          />
        ))}
      </div>

      <section className="v5-paper__account" aria-label="模擬帳戶">
        <h3>模擬帳戶</h3>
        <dl className="panshi-data">
          <dt>幣別</dt>
          <dd>{archive.account.currency}</dd>
          <dt>起始本金</dt>
          <dd>{initialCapital ?? DATA_UNAVAILABLE_LABEL}</dd>
          <dt>現金</dt>
          <dd>{cash ?? DATA_UNAVAILABLE_LABEL}</dd>
          <dt>資料截至</dt>
          <dd>{archive.account.asOf}</dd>
        </dl>
      </section>

      <h3>持股</h3>
      {archive.positions.length === 0 ? (
        <EmptyStatePanel reason="paper_no_positions" />
      ) : (
        archive.positions.map((position) => (
          <article
            className="v5-paper__card"
            key={position.positionId}
            aria-label={`${position.instrumentLabel} 的持股主卡`}
          >
            <h3 className="panshi-data">
              {position.instrumentLabel}／{position.status}
            </h3>
            {paperCardSections(archive, position).map((section) => (
              <section className="v5-paper__step" key={section.key}>
                <h4>{section.title}</h4>
                <CardBody body={section.body} />
              </section>
            ))}
            <p className="panshi-paper">{position.consequenceSummary}</p>
            <PositionComparison archive={archive} position={position} />
          </article>
        ))
      )}

      <h3>交易紀錄</h3>
      <ul className="v5-paper__rows">
        {rows.map((row) => (
          <li className="v5-paper__row" key={`${row.tradingDate}-${row.kind}`}>
            <p className="v5-paper__row-date panshi-data">{row.tradingDate}</p>
            {row.kind === "withheld" ? (
              <p className="panshi-paper">{row.statusText}</p>
            ) : (
              <>
                <p className="panshi-data">
                  {row.instrumentLabel}／{row.actionLabel}／{row.directionLabel}
                </p>
                <div className="v5-paper__figures">
                  {row.figures.map((figure) => (
                    <span className="v5-paper__figure" key={figure.label}>
                      <span className="v5-paper__figure-label panshi-data">{figure.label}</span>
                      <span className="panshi-data">{figure.text}</span>
                    </span>
                  ))}
                </div>
                {/* 行動前封存的結構化理由：不加引號。 */}
                <p className="panshi-paper">{row.rationaleSummary}</p>
                {row.concurrentClaim === null ? null : <Quote quote={row.concurrentClaim} />}
              </>
            )}
          </li>
        ))}
      </ul>

      {/* 更正紀錄：舊版保留，更正以新增節點出現（experience-spec §17.2 `EVENT_CORRECTED`）。
          更正前後的並排比較不在本切片。說明句未經 copy-taste 審稿。 */}
      <section className="v5-paper__corrections" aria-labelledby={PAPER_CORRECTIONS_ANCHOR}>
        <h3 id={PAPER_CORRECTIONS_ANCHOR} tabIndex={-1}>
          更正紀錄
        </h3>
        {archive.dataRevisions.length === 0 ? (
          <p className="panshi-paper">這份模擬紀錄沒有附上任何更正紀錄。</p>
        ) : (
          <ul className="v5-paper__rows">
            {archive.dataRevisions.map((revision) => (
              <li className="v5-paper__row" key={revision.revisionId}>
                <p className="v5-paper__row-date panshi-data">
                  {revision.appliedAt}／{DATA_REVISION_KIND_LABEL[revision.kind]}
                </p>
                <p className="panshi-paper">{revision.summary}</p>
                <p className="v5-paper__attr panshi-data">
                  {revision.revisionId}
                  {revision.affectedRefs.length === 0 ? "" : `／影響 ${revision.affectedRefs.join("、")}`}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="v5-paper__foot">
        <button type="button" onClick={onBackToArchiveIndex}>
          回到完整人生檔案
        </button>
      </div>
    </section>
  );
}
