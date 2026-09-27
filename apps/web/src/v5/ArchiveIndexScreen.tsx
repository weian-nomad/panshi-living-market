// 深層人生檔案索引（`docs/v5/experience-spec.md` §9.1）。
//
// 這一頁不是卡片牆，是一本長期人物誌的索引：
//   1. 人物肖像與一句長期自我矛盾。
//   2. 「最近留下的三件事」。
//   3-8. 模擬紀錄／關係／本命盤／性格與習慣／記憶／生平，每項一句具體摘要。
//   9. 資料身分與版本入口。
//
// 三條硬規則：
//
// 1. **順序固定**：六節依 `ARCHIVE_SECTION_ORDER` 排列，不依投影回傳順序，
//    也不依「有沒有真頁」重排。缺某一節就顯示缺，不補、不遞補。
// 2. **只有真頁可以點**：六節都有自己的頁面，`sectionPath` 非 null 就是一顆「打開」按鈕。
//    投影若給了 `null`（契約保留給未來新增的節），不做成 disabled 假按鈕，也不自己
//    組一個路徑，而是一段可讀的說明。
// 3. **每一項都掛它自己的 truth_class**：長期矛盾、最近三件事的每一件、每一節的摘要，
//    各自讀投影在那一項上給的身分（public-v2.yaml 2.1.0 的 `summaryTruthClass`、
//    `longTermTensionSummaryTruthClass`、`recentHighlightTruthClasses[i]`）。本檔沒有
//    「哪一節該是哪一種身分」的對照表；缺身分的那一項不顯示並寫出原因。
//
// 肖像是 CSS／SVG 幾何佔位；正式角色美術另案處理，這裡不生圖。

import type {
  ArchiveSectionIndexEntry,
  ArchiveSectionKey,
  CharacterArchiveIndex,
  TruthClass,
} from "../api/generated-v2/types.gen";
import { ClaimWithTruth } from "./ItemTruthTag";
import { TruthTag } from "./TruthTag";
import { DATA_UNAVAILABLE_LABEL } from "./format";

/** experience-spec §9.1 的固定索引順序與段名。 */
export const ARCHIVE_SECTION_ORDER: readonly { key: ArchiveSectionKey; title: string }[] = [
  { key: "paper", title: "模擬紀錄" },
  { key: "relations", title: "關係" },
  { key: "chart", title: "本命盤" },
  { key: "traits", title: "性格與習慣" },
  { key: "memories", title: "記憶" },
  { key: "life", title: "生平" },
];

const TRUTH_CLASS_EXPLANATION: Readonly<Record<TruthClass, string>> = {
  real_fact: "已封存並可回溯到外部來源的事實。",
  statistical_sample: "依分布取樣的統計結果，不是單一個案的事實。",
  fictional_setting: "虛構設定：角色、關係與人生事件都是這個世界自己的設定。",
  symbolic_interpretation: "命盤與象徵的文化詮釋，只影響他的注意與解讀，不改動價格資料。",
  simulated_narrative: "由已封存事件編成的模擬敘事，包含他的紙上交易與故事投影。",
};

/** 投影沒有給這一節頁面路徑時的說明（未經 copy-taste 審稿）。 */
const NO_SECTION_PATH_TEXT = "這份投影沒有給這一節的頁面路徑，介面不自己組一個。";

const STYLES = `
.v5-archive { margin: 0 0 16px; }
.v5-archive__head { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start; }
.v5-archive__portrait { flex: none; width: 96px; height: 128px; }
.v5-archive__tension { flex: 1 1 18rem; min-width: 14rem; margin: 0; }
.v5-archive__truth { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0 20px; }
.v5-archive__highlights { margin: 0 0 22px; padding: 0; list-style: none; }
.v5-archive__highlights li {
  margin: 0 0 .35rem;
  padding-inline-start: .75rem;
  border-inline-start: 2px solid var(--copper-500);
}
.v5-archive__section {
  margin: 0 0 18px;
  padding: 0 0 14px;
  border-bottom: 1px solid var(--rule-paper);
}
.v5-archive__section h3 { margin: 0 0 .3rem; font-size: 1rem; font-weight: 500; }
.v5-archive__section p { margin: 0 0 .3rem; }
.v5-archive__meta { font-size: .72rem; color: var(--copper-500); }
.v5-archive__entry-only { font-size: .85rem; color: var(--copper-500); }
.v5-archive__open {
  min-height: 44px;
  padding: .4em 1.1em;
  border: 1px solid var(--copper-500);
  border-radius: 2px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.v5-archive__open:focus-visible { outline: 2px solid var(--signal-420); outline-offset: 2px; }
.v5-archive__foot { margin: 18px 0 0; display: flex; flex-wrap: wrap; gap: 10px; }
.v5-archive__foot button {
  min-height: 44px;
  padding: .4em 1.1em;
  border: 1px solid var(--copper-500);
  border-radius: 2px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.v5-archive__foot button:focus-visible { outline: 2px solid var(--signal-420); outline-offset: 2px; }
@media (max-width: 600px) {
  .v5-archive__portrait { width: 72px; height: 96px; }
}
`;

/** 幾何佔位肖像：一名坐著的成年人側身輪廓，不是 chibi，也不是頭像照。 */
function Portrait() {
  return (
    <svg
      className="v5-archive__portrait"
      viewBox="0 0 48 64"
      role="img"
      aria-label="幾何佔位肖像：一名成年居民的側身輪廓"
    >
      <rect x="0" y="0" width="48" height="64" fill="var(--surface-panel-2)" />
      <circle cx="24" cy="19" r="8" fill="none" stroke="var(--paper-260)" strokeWidth="1.4" />
      <path
        d="M10 56 C10 42 16 34 24 34 C32 34 38 42 38 56 Z"
        fill="none"
        stroke="var(--paper-260)"
        strokeWidth="1.4"
      />
      <line x1="8" y1="56" x2="40" y2="56" stroke="var(--copper-500)" strokeWidth="1.2" />
    </svg>
  );
}

function SectionEntry({
  entry,
  title,
  declaredTruthClasses,
  onOpen,
}: {
  entry: ArchiveSectionIndexEntry | null;
  title: string;
  declaredTruthClasses: readonly TruthClass[];
  onOpen: (() => void) | null;
}) {
  if (entry === null) {
    return (
      <section className="v5-archive__section">
        <h3>{title}</h3>
        <p className="v5-archive__entry-only panshi-paper">
          {DATA_UNAVAILABLE_LABEL}：這份投影沒有這一節的索引，介面不補一句摘要。
        </p>
      </section>
    );
  }

  return (
    <section className="v5-archive__section">
      <h3>{title}</h3>
      {/* 摘要的身分是投影在這一節上給的 `summaryTruthClass`；缺了就不顯示摘要。 */}
      <ClaimWithTruth
        truthClass={entry.summaryTruthClass}
        declared={declaredTruthClasses}
        asOfLabel={entry.asOf}
        versionLabel={`visibility epoch ${entry.visibilityEpoch}`}
        withheldClassName="v5-archive__entry-only"
      >
        <p className="panshi-paper">{entry.summary}</p>
      </ClaimWithTruth>

      {onOpen === null ? (
        <p className="v5-archive__entry-only panshi-paper">{NO_SECTION_PATH_TEXT}</p>
      ) : (
        <p>
          <button type="button" className="v5-archive__open" onClick={onOpen}>
            打開{title}
          </button>
        </p>
      )}

      <p className="v5-archive__meta panshi-data">
        可見範圍 {entry.viewerAudienceScope}／資料時間 {entry.asOf}
      </p>
    </section>
  );
}

export type ArchiveIndexScreenProps = {
  index: CharacterArchiveIndex;
  /** 只有 `sectionPath` 非 null 的節會被呼叫。 */
  onOpenSection: (sectionKey: ArchiveSectionKey) => void;
  onBackToJournal: () => void;
};

export function ArchiveIndexScreen({
  index,
  onOpenSection,
  onBackToJournal,
}: ArchiveIndexScreenProps) {
  const highlightVersion = `${index.archiveSchemaRevision}／projection v${index.projectionVersion}`;
  const bySectionKey = new Map<ArchiveSectionKey, ArchiveSectionIndexEntry>();
  for (const entry of index.sections) {
    if (!bySectionKey.has(entry.sectionKey)) bySectionKey.set(entry.sectionKey, entry);
  }

  return (
    <section className="v5-archive" aria-label="深層人生檔案索引">
      <style>{STYLES}</style>

      <div className="v5-archive__head">
        <Portrait />
        <div className="v5-archive__tension">
          <ClaimWithTruth
            truthClass={index.longTermTensionSummaryTruthClass}
            declared={index.truthClasses}
            asOfLabel={index.serverNow}
            versionLabel={highlightVersion}
            withheldClassName="v5-archive__entry-only"
          >
            <p className="panshi-paper">{index.longTermTensionSummary}</p>
          </ClaimWithTruth>
        </div>
      </div>

      <div className="v5-archive__truth">
        {index.truthClasses.map((truthClass) => (
          <TruthTag
            key={truthClass}
            truthClass={truthClass}
            explanation={TRUTH_CLASS_EXPLANATION[truthClass]}
            asOfLabel={index.serverNow}
            versionLabel={`${index.archiveSchemaRevision}／projection v${index.projectionVersion}`}
          />
        ))}
      </div>

      <h3>最近留下的三件事</h3>
      {index.recentHighlights.length === 0 ? (
        <p className="v5-archive__entry-only panshi-paper">
          {DATA_UNAVAILABLE_LABEL}：這份投影沒有留下近期事項。
        </p>
      ) : (
        <ul className="v5-archive__highlights">
          {index.recentHighlights.map((highlight, position) => (
            // 第 i 件的身分是 `recentHighlightTruthClasses[i]`；那一格缺了就只寫原因。
            <li className="panshi-paper" key={`${position}-${highlight}`}>
              <ClaimWithTruth
                truthClass={index.recentHighlightTruthClasses?.[position]}
                declared={index.truthClasses}
                asOfLabel={index.serverNow}
                versionLabel={highlightVersion}
                withheldClassName="v5-archive__entry-only"
              >
                {highlight}
              </ClaimWithTruth>
            </li>
          ))}
        </ul>
      )}

      {ARCHIVE_SECTION_ORDER.map(({ key, title }) => {
        const entry = bySectionKey.get(key) ?? null;
        const openable = entry !== null && entry.sectionPath !== null;
        return (
          <SectionEntry
            key={key}
            entry={entry}
            title={title}
            declaredTruthClasses={index.truthClasses}
            onOpen={openable ? () => onOpenSection(key) : null}
          />
        );
      })}

      <section className="v5-archive__section">
        <h3>資料身分與版本</h3>
        <p className="v5-archive__meta panshi-data">
          檔案結構 {index.archiveSchemaRevision}／投影版本 {index.projectionVersion}／來源位置{" "}
          {index.sourceGlobalPosition}／可見性紀元 {index.visibilityEpoch}
        </p>
        <p className="v5-archive__meta panshi-data">
          來源修訂 {index.sourceRevisionSet.length} 筆：
          {index.sourceRevisionSet
            .map((ref) => `${ref.refKind}／${ref.refId}／rev ${ref.revision}`)
            .join("；")}
        </p>
      </section>

      <div className="v5-archive__foot">
        <button type="button" onClick={onBackToJournal}>
          回到人生誌
        </button>
      </div>
    </section>
  );
}
