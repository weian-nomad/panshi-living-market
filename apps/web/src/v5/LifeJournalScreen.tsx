// 單角人生誌（experience-spec.md §8）。
//
// 每一日章節依 `journalSections()` 的固定九段順序展開；本檔只負責排版，不決定
// 哪一段出現、也不改寫任何文字。
//
// 三層聲音的排版規則（§8.2、§8.4）：
// - 逐字原話用引號，並附 artifact id 與 `canonical_text_sha256` 前 8 碼供核對。
// - 系統摘要**一律不加引號**，不得看起來像角色說過的話。
// - 紙上數字用 `.panshi-data` 網格並帶 as_of；角色說法與長文用 `.panshi-paper`。
//   兩種字面不得混用（tokens.css）。
//
// 「打開完整人生檔案」只在**頁面最底部**出現（§3.2：深層檔案不是全站入口）。
//
// 單章的三種呈現（public-v2.yaml `LifeJournalEntry`／`HeldLifeJournalEntry`）：
// - `composed`：九段 ＋（有改口時）「回到原話」連結與四欄並排比較。
// - `evidence_card_only`：**只**渲染證據卡（動作、紙上後果數字、原話逐字），
//   不渲染任何 narrative segment，也不渲染九段。
// - `HELD`：只渲染 `heldReasonLabel`，這個形狀本來就沒有內容欄位。
//
// `heldReasonLabel`、`paperOutcomeNullReason`、`relationshipConsequenceNullReason` 是系統說明
// （public-v2.yaml 2.2.0 `x-panshi-system-label`），不是宣稱：以 `SystemLabel` 呈現、不掛身分。
// 關係後果裡對方的名字與關係讀它們自己的 `displayNameTruthClass`／`relationLabelTruthClass`
// （人物設定），不沿用整筆訊號的身分。
//
// 九段裡每一段掛它自己在投影裡的資料身分（public-v2.yaml 2.1.0）。有內容但缺身分的
// 那一段不顯示並寫出原因（`journalSections()` 的 `unlabelled`）；本檔不替任何一段決定身分。
//
// 每章都有錨點 `id="chapter-YYYY-MM-DD"`。改口旁的「回到原話」指向原話那一章的錨點，
// 那一章同時有當時的逐字原話、「他其實知道什麼」與「他漏掉了什麼」：一次點擊就到。
// 深層檔案各節用 `/people/{id}/journal#chapter-YYYY-MM-DD` 連回來。

import { useEffect, type ReactNode } from "react";

import type {
  ClassifiedCharacterUtterance,
  HeldLifeJournalEntry,
  LifeJournalEntry,
  LifeJournalPage,
  TruthClass,
} from "../api/generated-v2/types.gen";
import { ClaimComparison } from "./ClaimComparison";
import { EvidenceCardView, SignedMoney } from "./EvidenceCardView";
import { ClaimWithTruth, ItemTruthTag, WithheldClaim } from "./ItemTruthTag";
import { SystemLabel } from "./SystemLabel";
import { TruthTag } from "./TruthTag";
import { Utterance } from "./Utterance";
import { MISSING_CLAIM_TRUTH_CLASS_TEXT, claimTruthClassOf, distinctTruthClasses } from "./claimTruth";
import { DATA_UNAVAILABLE_LABEL } from "./format";
import { chapterAnchorId, claimRevisions, type ClaimRevision } from "./journalRevisions";
import { journalSections, type JournalSectionBody } from "./journalSections";
import { EmptyStatePanel } from "./statePanels";

const STYLES = `
.v5-journal { margin: 0 0 16px; }
.v5-journal__truth { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 16px; }
.v5-journal__chapter {
  margin: 0 0 22px;
  padding: 0 0 14px;
  border-bottom: 1px solid var(--rule-paper);
}
.v5-journal__date { margin: 0 0 10px; font-size: .85rem; color: var(--copper-500); }
.v5-journal__section { margin: 0 0 12px; }
.v5-journal__section h4 {
  margin: 0 0 .25rem;
  font-size: .8rem;
  font-weight: 500;
  color: var(--copper-500);
}
.v5-journal__section p { margin: 0 0 .2rem; }
.v5-journal__quote {
  margin: 0 0 .25rem;
  padding-inline-start: .75rem;
  border-inline-start: 2px solid var(--copper-500);
}
.v5-journal__attr { font-size: .72rem; color: var(--copper-500); }
.v5-journal__absent { font-size: .85rem; color: var(--copper-500); }
.v5-journal__figures { display: flex; flex-wrap: wrap; gap: .2rem 1.2rem; margin: 0 0 .2rem; }
.v5-journal__back { margin: .15rem 0 .2rem; font-size: .85rem; }
.v5-journal__back a { min-height: 44px; display: inline-flex; align-items: center; }
.v5-journal__held { font-size: .9rem; }
.v5-journal__foot { margin: 18px 0 0; display: flex; flex-wrap: wrap; gap: 10px; }
.v5-journal__foot button {
  min-height: 44px;
  padding: .4em 1.1em;
  border: 1px solid var(--copper-500);
  border-radius: 2px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.v5-journal__foot button:focus-visible { outline: 2px solid var(--signal-420); outline-offset: 2px; }
`;

const TRUTH_CLASS_EXPLANATION: Readonly<Record<TruthClass, string>> = {
  real_fact: "已封存並可回溯到外部來源的事實。",
  statistical_sample: "依分布取樣的統計結果，不是單一個案的事實。",
  fictional_setting: "虛構設定：角色、標的與市場事實都是 repo 內自有的合成歷史 fixture。",
  symbolic_interpretation: "命盤與象徵的文化詮釋，只影響他的注意與解讀，不改動價格資料。",
  simulated_narrative: "由已封存事件編成的敘事，不是角色親口說的話。",
};

const ABSENT_LABEL: Readonly<Record<"missing" | "unverifiable" | "unlabelled", string>> = {
  missing: "這一天沒有這件事。",
  unverifiable: `${DATA_UNAVAILABLE_LABEL}：這句話無法核對，因此不顯示。`,
  unlabelled: MISSING_CLAIM_TRUTH_CLASS_TEXT,
};

/** 「回到原話」：同一頁的章節錨點，一次點擊（說明文字未經 copy-taste 審稿）。 */
function BackToOriginal({ revision }: { revision: ClaimRevision }) {
  const date = revision.original.chapterDate;
  return (
    <p className="v5-journal__back">
      <a href={`#${chapterAnchorId(date)}`} data-nav="reply-to-original">
        回到原話（{date}）
      </a>
    </p>
  );
}

function SectionBody({
  body,
  beside,
  asOfLabel,
  versionLabel,
}: {
  body: JournalSectionBody;
  beside?: ReactNode;
  asOfLabel: string;
  versionLabel: string;
}) {
  switch (body.kind) {
    case "absent":
      return (
        <p
          className="v5-journal__absent panshi-paper"
          data-claim-withheld={body.reason === "unlabelled" ? "missing_truth_class" : undefined}
        >
          {ABSENT_LABEL[body.reason]}
        </p>
      );

    case "summary":
      // 系統摘要：無引號。
      return (
        <>
          <p className="panshi-paper">{body.text}</p>
          <ItemTruthTag truthClass={body.truthClass} asOfLabel={asOfLabel} versionLabel={versionLabel} />
        </>
      );

    case "quote":
      return (
        <>
          <p className="v5-journal__quote">
            <Utterance
              utterance={{
                utteranceArtifactId: body.utteranceArtifactId,
                canonicalTextSha256: body.canonicalTextSha256,
                canonicalTextUtf8: body.text,
              }}
            />
          </p>
          <p className="v5-journal__attr panshi-data">
            {body.utteranceArtifactId}／sha256 {body.digestPrefix}
          </p>
          <ItemTruthTag truthClass={body.truthClass} asOfLabel={asOfLabel} versionLabel={versionLabel} />
          {beside}
        </>
      );

    case "consequence":
      return (
        <>
          {body.paper === null ? null : (
            <>
              <p className="v5-journal__figures">
                <span className="panshi-data">模擬損益 {body.paper.unrealizedPnlText}</span>
                <span className="panshi-data">{body.paper.unrealizedPnlPercentText}</span>
                <span className="panshi-data">持有 {body.paper.heldDays} 個交易日</span>
                <span className="v5-journal__attr panshi-data">{body.paper.asOfLabel}</span>
              </p>
              <ItemTruthTag truthClass={body.paper.truthClass} asOfLabel={body.paper.asOfLabel} versionLabel={versionLabel} />
            </>
          )}
          {body.nonPaperSummary === null || body.nonPaperTruthClass === null ? null : (
            <>
              <p className="panshi-paper">{body.nonPaperSummary}</p>
              <ItemTruthTag truthClass={body.nonPaperTruthClass} asOfLabel={asOfLabel} versionLabel={versionLabel} />
            </>
          )}
          {body.withheld ? <WithheldClaim className="v5-journal__absent" /> : null}
        </>
      );

    case "unacknowledgedMotive":
      // 他還沒承認的動機，介面不代答。
      return <p className="v5-journal__absent panshi-paper">{body.text}</p>;

    case "recurringPattern":
      return (
        <>
          <p className="panshi-paper">同一種模式又出現了一次。</p>
          <p className="v5-journal__attr panshi-data">模式 {body.patternRef}</p>
          <ItemTruthTag truthClass={body.truthClass} asOfLabel={asOfLabel} versionLabel={versionLabel} />
        </>
      );
  }
}

/** 並排比較裡的一句原話：身分讀那一句自己的 `truthClass`，缺了就整句不顯示。 */
function QuotedWithTag({
  entry,
  utterance,
  caption,
  versionLabel,
  declared,
}: {
  entry: LifeJournalEntry;
  utterance: ClassifiedCharacterUtterance;
  caption: string;
  versionLabel: string;
  declared: readonly TruthClass[];
}) {
  return (
    <ClaimWithTruth
      truthClass={utterance.truthClass}
      declared={declared}
      asOfLabel={entry.chapterDate}
      versionLabel={versionLabel}
      withheldClassName="v5-journal__absent"
    >
      <p>
        <Utterance utterance={utterance} />
      </p>
      <p className="v5-journal__attr panshi-data">{caption}</p>
    </ClaimWithTruth>
  );
}

/**
 * 關係後果裡的「對方（關係）」一行：名字與關係各讀自己的身分（2.2.0）。任一個缺或不合法，
 * 整行不顯示並寫原因；兩個身分相同時只掛一顆標籤。
 */
function CounterpartLine({
  displayName,
  displayNameTruthClass,
  relationLabel,
  relationLabelTruthClass,
  declared,
  asOfLabel,
  versionLabel,
}: {
  displayName: string;
  displayNameTruthClass: unknown;
  relationLabel: string;
  relationLabelTruthClass: unknown;
  declared: readonly TruthClass[];
  asOfLabel: string;
  versionLabel: string;
}) {
  const nameClass = claimTruthClassOf(displayNameTruthClass, declared);
  const labelClass = claimTruthClassOf(relationLabelTruthClass, declared);
  if (nameClass === null || labelClass === null) return <WithheldClaim />;
  return (
    <>
      <p className="panshi-paper">
        {displayName}（{relationLabel}）
      </p>
      {distinctTruthClasses([nameClass, labelClass]).map((truthClass) => (
        <ItemTruthTag key={truthClass} truthClass={truthClass} asOfLabel={asOfLabel} versionLabel={versionLabel} />
      ))}
    </>
  );
}

/** 改口章節的四欄並排：原本理由｜現在說法｜紙上代價｜關係後果。 */
function RevisionComparison({
  revision,
  versionLabel,
  declared,
}: {
  revision: ClaimRevision;
  versionLabel: string;
  declared: readonly TruthClass[];
}) {
  const { entry, original } = revision;
  const outcome = entry.evidenceCard?.paperOutcome ?? null;
  const relationship = entry.relationshipConsequence;

  return (
    <ClaimComparison
      title={`和 ${original.chapterDate} 的原話並排`}
      columns={{
        originalReason: (
          <QuotedWithTag
            entry={original}
            utterance={revision.originalClaim}
            caption={`${original.chapterDate} 當時的原話`}
            versionLabel={versionLabel}
            declared={declared}
          />
        ),
        currentClaim: (
          <QuotedWithTag
            entry={entry}
            utterance={revision.revision}
            caption={`${entry.chapterDate} 的說法`}
            versionLabel={versionLabel}
            declared={declared}
          />
        ),
        paperCost:
          outcome === null ? (
            <SystemLabel field="paperOutcomeNullReason" text={entry.evidenceCard?.paperOutcomeNullReason} />
          ) : (
            <>
              <SignedMoney label="已實現損益" amountMinorUnits={outcome.realizedPnlMinorUnits} />
              <SignedMoney label="未實現損益" amountMinorUnits={outcome.unrealizedPnlMinorUnits} />
              <p className="v5-journal__attr panshi-data">資料截至 {outcome.asOf}</p>
              <ItemTruthTag truthClass={outcome.truthClass} asOfLabel={outcome.asOf} versionLabel={versionLabel} />
            </>
          ),
        relationship:
          relationship === null || relationship === undefined ? (
            <SystemLabel field="relationshipConsequenceNullReason" text={entry.relationshipConsequenceNullReason} />
          ) : (
            <>
              <CounterpartLine
                displayName={relationship.displayName}
                displayNameTruthClass={relationship.displayNameTruthClass}
                relationLabel={relationship.relationLabel}
                relationLabelTruthClass={relationship.relationLabelTruthClass}
                declared={declared}
                asOfLabel={relationship.observedAt}
                versionLabel={versionLabel}
              />
              <ClaimWithTruth
                truthClass={relationship.truthClass}
                declared={declared}
                asOfLabel={relationship.observedAt}
                versionLabel={versionLabel}
              >
                <p className="panshi-paper">{relationship.summary}</p>
              </ClaimWithTruth>
            </>
          ),
      }}
    />
  );
}

function Chapter({
  entry,
  revision,
  versionLabel,
  serverNow,
  declared,
}: {
  entry: LifeJournalEntry;
  revision: ClaimRevision | undefined;
  versionLabel: string;
  serverNow: string;
  declared: readonly TruthClass[];
}) {
  const anchor = chapterAnchorId(entry.chapterDate);

  if (entry.narrativeState === "evidence_card_only") {
    // 敘事沒有到：只剩證據卡。不渲染九段，也不渲染任何 narrative segment。
    return (
      <article
        className="v5-journal__chapter"
        id={anchor}
        tabIndex={-1}
        aria-label={`${entry.chapterDate} 的章節`}
        data-narrative-state="evidence_card_only"
      >
        <h3 className="v5-journal__date panshi-data">{entry.chapterDate}</h3>
        <EvidenceCardView card={entry.evidenceCard} versionLabel={versionLabel} asOfFallback={serverNow} />
      </article>
    );
  }

  const sections = journalSections(entry, declared);
  const revisionArtifactId = revision?.revision.utteranceArtifactId ?? null;

  return (
    <article
      className="v5-journal__chapter"
      id={anchor}
      tabIndex={-1}
      aria-label={`${entry.chapterDate} 的章節`}
      data-narrative-state="composed"
    >
      <h3 className="v5-journal__date panshi-data">{entry.chapterDate}</h3>
      {sections.map((section) => (
        <section className="v5-journal__section" key={`${entry.entryId}-${section.key}`}>
          <h4>{section.title}</h4>
          <SectionBody
            body={section.body}
            asOfLabel={entry.chapterDate}
            versionLabel={versionLabel}
            beside={
              revision !== undefined &&
              section.body.kind === "quote" &&
              section.body.utteranceArtifactId === revisionArtifactId ? (
                <BackToOriginal revision={revision} />
              ) : undefined
            }
          />
        </section>
      ))}
      {revision === undefined ? null : (
        <RevisionComparison revision={revision} versionLabel={versionLabel} declared={declared} />
      )}
    </article>
  );
}

/** 被 HELD 的一章：只有日期與原因標籤，這個形狀沒有任何內容欄位。 */
function HeldChapter({ held }: { held: HeldLifeJournalEntry }) {
  return (
    <article
      className="v5-journal__chapter"
      id={chapterAnchorId(held.chapterDate)}
      tabIndex={-1}
      aria-label={`${held.chapterDate} 的章節`}
      data-entry-visibility="HELD"
    >
      <h3 className="v5-journal__date panshi-data">{held.chapterDate}</h3>
      <SystemLabel field="heldReasonLabel" text={held.heldReasonLabel} className="v5-journal__held" />
    </article>
  );
}

type JournalItem =
  | { kind: "published"; chapterDate: string; entry: LifeJournalEntry }
  | { kind: "held"; chapterDate: string; held: HeldLifeJournalEntry };

export type LifeJournalScreenProps = {
  page: LifeJournalPage;
  onBackToCloseUp: () => void;
  onOpenArchive: () => void;
};

export function LifeJournalScreen({ page, onBackToCloseUp, onOpenArchive }: LifeJournalScreenProps) {
  const heldEntries = page.heldEntries ?? [];
  // canonical 時間順序：由舊到新，讓「後來改口」永遠排在「當時怎麼說」之後。
  // HELD 的章節依 `chapterDate` 併進同一條時間軸（public-v2.yaml `heldEntries`）。
  const chapters: JournalItem[] = [
    ...page.entries.map((entry): JournalItem => ({ kind: "published", chapterDate: entry.chapterDate, entry })),
    ...heldEntries.map((held): JournalItem => ({ kind: "held", chapterDate: held.chapterDate, held })),
  ].sort((left, right) => left.chapterDate.localeCompare(right.chapterDate));
  const revisions = claimRevisions(page.entries, heldEntries);
  const versionLabel = `projection v${page.projectionVersion}`;

  // 從深層檔案連過來（`#chapter-YYYY-MM-DD`）時內容是非同步載入的，瀏覽器自己的
  // 錨點捲動已經錯過；掛載後補一次捲動與焦點。
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (!hash.startsWith("chapter-")) return;
    const target = document.getElementById(hash);
    if (target === null) return;
    target.scrollIntoView?.();
    target.focus();
  }, []);

  return (
    <section className="v5-journal" aria-label="人生誌">
      <style>{STYLES}</style>

      <div className="v5-journal__truth">
        {page.truthClasses.map((truthClass) => (
          <TruthTag
            key={truthClass}
            truthClass={truthClass}
            explanation={TRUTH_CLASS_EXPLANATION[truthClass]}
            asOfLabel={page.serverNow}
            versionLabel={`projection v${page.projectionVersion}`}
          />
        ))}
      </div>

      {chapters.length === 0 ? (
        // typed 空狀態：說明為什麼是空的，不是讀取失敗。
        <EmptyStatePanel reason="journal_no_chapters" />
      ) : (
        chapters.map((item) =>
          item.kind === "held" ? (
            <HeldChapter held={item.held} key={item.held.entryId} />
          ) : (
            <Chapter
              entry={item.entry}
              revision={revisions.get(item.entry.entryId)}
              versionLabel={versionLabel}
              serverNow={page.serverNow}
              declared={page.truthClasses}
              key={item.entry.entryId}
            />
          ),
        )
      )}

      {/* 深層檔案入口只在最底部，且只有這一個。 */}
      <div className="v5-journal__foot">
        <button type="button" onClick={onBackToCloseUp}>
          回到他的近況
        </button>
        <button type="button" onClick={onOpenArchive}>
          打開完整人生檔案
        </button>
      </div>
    </section>
  );
}
