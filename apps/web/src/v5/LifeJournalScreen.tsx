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

import type { LifeJournalEntry, LifeJournalPage, TruthClass } from "../api/generated-v2/types.gen";
import { TruthTag } from "./TruthTag";
import { DATA_UNAVAILABLE_LABEL } from "./format";
import { journalSections, type JournalSectionBody } from "./journalSections";

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

const ABSENT_LABEL: Readonly<Record<"missing" | "unverifiable", string>> = {
  missing: "這一天沒有這件事。",
  unverifiable: `${DATA_UNAVAILABLE_LABEL}：這句話無法核對，因此不顯示。`,
};

function SectionBody({ body }: { body: JournalSectionBody }) {
  switch (body.kind) {
    case "absent":
      return <p className="v5-journal__absent panshi-paper">{ABSENT_LABEL[body.reason]}</p>;

    case "summary":
      // 系統摘要：無引號。
      return <p className="panshi-paper">{body.text}</p>;

    case "quote":
      return (
        <>
          <p className="v5-journal__quote panshi-paper">「{body.text}」</p>
          <p className="v5-journal__attr panshi-data">
            {body.utteranceArtifactId}／sha256 {body.digestPrefix}
          </p>
        </>
      );

    case "consequence":
      return (
        <>
          {body.paper === null ? null : (
            <p className="v5-journal__figures">
              <span className="panshi-data">模擬損益 {body.paper.unrealizedPnlText}</span>
              <span className="panshi-data">{body.paper.unrealizedPnlPercentText}</span>
              <span className="panshi-data">持有 {body.paper.heldDays} 個交易日</span>
              <span className="v5-journal__attr panshi-data">{body.paper.asOfLabel}</span>
            </p>
          )}
          {body.nonPaperSummary === null ? null : (
            <p className="panshi-paper">{body.nonPaperSummary}</p>
          )}
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
        </>
      );
  }
}

function Chapter({ entry }: { entry: LifeJournalEntry }) {
  const sections = journalSections(entry);

  return (
    <article className="v5-journal__chapter" aria-label={`${entry.chapterDate} 的章節`}>
      <h3 className="v5-journal__date panshi-data">{entry.chapterDate}</h3>
      {sections.map((section) => (
        <section className="v5-journal__section" key={`${entry.entryId}-${section.key}`}>
          <h4>{section.title}</h4>
          <SectionBody body={section.body} />
        </section>
      ))}
    </article>
  );
}

export type LifeJournalScreenProps = {
  page: LifeJournalPage;
  onBackToCloseUp: () => void;
  onOpenArchive: () => void;
};

export function LifeJournalScreen({ page, onBackToCloseUp, onOpenArchive }: LifeJournalScreenProps) {
  // canonical 時間順序：由舊到新，讓「後來改口」永遠排在「當時怎麼說」之後。
  const chapters = [...page.entries].sort((left, right) =>
    left.chapterDate.localeCompare(right.chapterDate),
  );

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
        <p className="panshi-paper">
          {DATA_UNAVAILABLE_LABEL}：還沒有出版任何章節。第一章出版後會留在這裡。
        </p>
      ) : (
        chapters.map((entry) => <Chapter entry={entry} key={entry.entryId} />)
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
