// 深層人生檔案的其餘五節：關係、本命盤、性格與習慣、記憶、生平
//（`docs/v5/experience-spec.md` §9.1、§9.3、§9.5–§9.9；回應形狀見 public-v2.yaml
// `RelationsArchiveProjection` 等五個投影）。
//
// 本檔只負責排版，不決定任何事實。硬規則：
//
// 1. **每一項都掛自己的資料身分**：item 的 `truthClass` 直接掛成 `ItemTruthTag`。
//    apiClient 已在進門時擋掉沒有 truth_class 或沒有來源的 item（整份
//    `INCOMPLETE_PROJECTION`），所以這裡不會有「沒有標籤的宣稱」。
// 2. **不顯示原始 ID**：dyadRef、memoryRef、journalEntryRef、sourceRefs 都不上畫面；
//    人一律以顯示名稱與關係標籤出現，章節一律以日期出現並連回人生誌。
// 3. **偏誤只以逐次發生呈現**：每一次發生是一列，附回到那一章的連結。沒有次數、
//    沒有總分、沒有排名，也沒有「最常犯」這種排序——列表依日期由舊到新。
//    反例（那一次沒有發生）與發生列在同一頁，份量相同。
// 4. **本命盤只影響注意與解讀**：頁首固定明示，不改價格、不改績效；每個主題也帶著
//    投影自己的 `effectScopeLabel`。
// 5. **數字一律是文字**：年齡、日期、把握程度都以文字呈現，不畫長條、不畫量表。
// 6. **缺就寫缺**：空清單顯示投影附的 `*EmptyReason`，不補一句、不留白。這些固定句是
//    系統說明（public-v2.yaml 2.2.0 `x-panshi-system-label`），不是宣稱：以 `SystemLabel`
//    的系統說明樣式呈現，不掛資料身分。
// 7. **巢狀項目也掛自己的身分**（2.2.0）：記憶裡提到的人、關係訊號裡他的原話，各自讀
//    自己的 `truthClass`，不沿用外層那一則；缺了只扣住那一項（`ClaimWithTruth`）。
//
// 新增的繁中說明句全部是工程 placeholder，未經 copy-taste 審稿。

import type { MouseEvent, ReactNode } from "react";

import type {
  ArchiveAcquaintance,
  ArchiveMemory,
  ArchiveSessionPointer,
  ChartArchiveProjection,
  LifeArchiveProjection,
  MemoriesArchiveProjection,
  RelationsArchiveProjection,
  TraitsArchiveProjection,
  TruthClass,
} from "../api/generated-v2/types.gen";
import { ClaimWithTruth, ItemTruthTag } from "./ItemTruthTag";
import { SystemLabel } from "./SystemLabel";
import { Utterance } from "./Utterance";
import { DATA_UNAVAILABLE_LABEL } from "./format";
import { chapterAnchorId } from "./journalRevisions";

export type ArchiveSectionProjection =
  | RelationsArchiveProjection
  | ChartArchiveProjection
  | TraitsArchiveProjection
  | MemoriesArchiveProjection
  | LifeArchiveProjection;

/** 本命盤頁首的固定明示（未經 copy-taste 審稿）。 */
export const CHART_SCOPE_NOTICE =
  "本命盤只影響注意與解讀：它改變他注意什麼、怎麼讀一件事，不改價格、不改紙上績效，也不代表任何人該怎麼做。";

const STYLES = `
.v5-section { margin: 0 0 16px; }
.v5-section__scope {
  margin: 0 0 16px;
  padding: .5rem .75rem;
  border: 1px solid var(--rule-paper);
  border-left: 3px solid var(--copper-500);
}
.v5-section__group { margin: 0 0 20px; padding: 0 0 12px; border-bottom: 1px solid var(--rule-paper); }
.v5-section__group h3 { margin: 0 0 .4rem; font-size: 1rem; font-weight: 500; }
.v5-section__group h4 { margin: .6rem 0 .25rem; font-size: .8rem; font-weight: 500; color: var(--copper-500); }
.v5-section__items { margin: 0; padding: 0; list-style: none; }
.v5-section__people .v5-section__items { margin: 0 0 .2rem .75rem; }
.v5-section__item { margin: 0 0 .7rem; padding: 0 0 .5rem; border-bottom: 1px dashed var(--rule-paper); }
.v5-section__item:last-child { border-bottom: 0; }
.v5-section__item p { margin: 0 0 .2rem; }
.v5-section__date { font-size: .8rem; color: var(--copper-500); }
.v5-section__note { font-size: .85rem; color: var(--copper-500); }
.v5-section__link { min-height: 44px; display: inline-flex; align-items: center; }
.v5-section__pairs { display: grid; grid-template-columns: auto 1fr; gap: .15rem .9rem; margin: 0 0 .3rem; }
.v5-section__pairs dt { color: var(--copper-500); }
.v5-section__pairs dd { margin: 0; }
.v5-section__foot { margin: 18px 0 0; display: flex; flex-wrap: wrap; gap: 10px; }
.v5-section__foot button {
  min-height: 44px;
  padding: .4em 1.1em;
  border: 1px solid var(--copper-500);
  border-radius: 2px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.v5-section__foot button:focus-visible { outline: 2px solid var(--signal-420); outline-offset: 2px; }
`;

type SectionContext = {
  asOf: string;
  /** 這份投影 envelope 的 `truthClasses`：巢狀項目的身分必須是其中之一。 */
  declared: readonly TruthClass[];
  versionLabel: string;
  journalPath: string;
  onOpenChapter: (chapterDate: string) => void;
};

function Tag({ truthClass, context }: { truthClass: TruthClass; context: SectionContext }) {
  return <ItemTruthTag truthClass={truthClass} asOfLabel={context.asOf} versionLabel={context.versionLabel} />;
}

function isPlainLeftClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0);
}

/**
 * 回到人生誌那一章。章節沒有出版（`journalEntryRef` 是 `null`）時不做假連結，
 * 改寫一句可讀的說明。
 */
function ChapterLink({
  pointer,
  context,
}: {
  pointer: Pick<ArchiveSessionPointer, "sessionDate" | "journalEntryRef">;
  context: SectionContext;
}) {
  if (pointer.journalEntryRef === null) {
    return <span className="v5-section__note panshi-paper">（{pointer.sessionDate} 沒有出版的章節）</span>;
  }
  return (
    <a
      className="v5-section__link"
      href={`${context.journalPath}#${chapterAnchorId(pointer.sessionDate)}`}
      data-nav="chapter"
      onClick={(event) => {
        if (!isPlainLeftClick(event)) return;
        event.preventDefault();
        context.onOpenChapter(pointer.sessionDate);
      }}
    >
      回到 {pointer.sessionDate} 的章節
    </a>
  );
}

/** 空清單的原因：系統說明，不是宣稱（不掛資料身分）。 */
function EmptyReason({ field, reason }: { field: string; reason: string | null }) {
  return <SystemLabel field={field} text={reason} />;
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="v5-section__group" aria-label={title}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}

/** 依日期由舊到新，日期相同時保留投影順序（Array.prototype.sort 是穩定排序）。 */
function chronological<T extends { sessionDate: string }>(items: readonly T[]): T[] {
  return [...items].sort((left, right) => left.sessionDate.localeCompare(right.sessionDate));
}

// ---------------------------------------------------------------------------
// 關係
// ---------------------------------------------------------------------------

function Acquaintance({ person, context }: { person: ArchiveAcquaintance; context: SectionContext }) {
  return (
    <Group title={`${person.displayName}（${person.relationLabel}）`}>
      <p className="panshi-paper">{person.relationNote}</p>
      <Tag truthClass={person.truthClass} context={context} />

      <h4>他在她身邊做過的事（單向觀察）</h4>
      {person.observedInteractions.length === 0 ? (
        <EmptyReason field="observedInteractionsEmptyReason" reason={person.observedInteractionsEmptyReason} />
      ) : (
        <ul className="v5-section__items">
          {chronological(person.observedInteractions).map((interaction, index) => (
            <li className="v5-section__item" key={`${interaction.sessionDate}-${index}`}>
              <p className="v5-section__date panshi-data">{interaction.sessionDate}</p>
              <p className="panshi-paper">{interaction.observableAction}</p>
              <Tag truthClass={interaction.truthClass} context={context} />
              <p>
                <ChapterLink pointer={interaction} context={context} />
              </p>
            </li>
          ))}
        </ul>
      )}

      <h4>留下的關係訊號</h4>
      {person.relationshipSignals.length === 0 ? (
        <EmptyReason field="relationshipSignalsEmptyReason" reason={person.relationshipSignalsEmptyReason} />
      ) : (
        <ul className="v5-section__items">
          {chronological(person.relationshipSignals).map((signal, index) => (
            <li className="v5-section__item" key={`${signal.sessionDate}-${index}`}>
              <p className="v5-section__date panshi-data">{signal.sessionDate}</p>
              <p className="panshi-paper">{signal.summary}</p>
              <ClaimWithTruth
                truthClass={signal.utterance.truthClass}
                declared={context.declared}
                asOfLabel={context.asOf}
                versionLabel={context.versionLabel}
              >
                <p>
                  他當時的原話：
                  <Utterance utterance={signal.utterance} />
                </p>
              </ClaimWithTruth>
              <Tag truthClass={signal.truthClass} context={context} />
              <p>
                <ChapterLink pointer={signal} context={context} />
              </p>
            </li>
          ))}
        </ul>
      )}

      <h4>她那一側</h4>
      <p className="panshi-paper">{person.counterpartAccount.reasonLabel}</p>
      <Tag truthClass={person.counterpartAccount.truthClass} context={context} />
    </Group>
  );
}

function RelationsBody({ section, context }: { section: RelationsArchiveProjection; context: SectionContext }) {
  if (section.acquaintances.length === 0) return <EmptyReason field="acquaintancesEmptyReason" reason={section.acquaintancesEmptyReason} />;
  return (
    <>
      {section.acquaintances.map((person) => (
        <Acquaintance person={person} context={context} key={`${person.displayName}-${person.relationLabel}`} />
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------
// 本命盤
// ---------------------------------------------------------------------------

function ChartBody({ section, context }: { section: ChartArchiveProjection; context: SectionContext }) {
  return (
    <>
      <Group title="出生資料">
        <dl className="v5-section__pairs panshi-data">
          <dt>出生日期</dt>
          <dd>{section.birthIdentity.birthDate}</dd>
          <dt>出生地</dt>
          <dd>{section.birthIdentity.birthRegionLabel}</dd>
        </dl>
        <Tag truthClass={section.birthIdentity.truthClass} context={context} />
      </Group>

      <Group title="盤面位置">
        {section.placements.length === 0 ? (
          <EmptyReason field="placementsEmptyReason" reason={section.placementsEmptyReason} />
        ) : (
          <ul className="v5-section__items">
            {section.placements.map((placement) => (
              <li className="v5-section__item" key={`${placement.placementLabel}-${placement.signLabel}`}>
                <p className="panshi-paper">
                  {placement.placementLabel}：{placement.signLabel}
                </p>
                <Tag truthClass={placement.truthClass} context={context} />
              </li>
            ))}
          </ul>
        )}
      </Group>

      {section.motifs.length === 0 ? (
        <Group title="象徵主題">
          <p className="v5-section__note panshi-paper">這份投影沒有封存任何象徵主題。</p>
        </Group>
      ) : (
        section.motifs.map((motif) => (
          <Group title={`象徵主題：${motif.motifLabel}`} key={motif.motifLabel}>
            <p className="panshi-paper">{motif.effectScopeLabel}</p>
            <p className="panshi-data">
              作用期間 {motif.activeWindow.activeFrom} 到 {motif.activeWindow.activeUntil}
            </p>
            <Tag truthClass={motif.truthClass} context={context} />

            <h4>作用中的交易時段</h4>
            {motif.activeSessions.length === 0 ? (
              <p className="v5-section__note panshi-paper">沒有落在任何交易時段。</p>
            ) : (
              <ul className="v5-section__items">
                {chronological(motif.activeSessions).map((session) => (
                  <li className="v5-section__item" key={session.sessionDate}>
                    <ChapterLink pointer={session} context={context} />
                  </li>
                ))}
              </ul>
            )}

            <h4>章節裡的解讀</h4>
            {motif.invocations.length === 0 ? (
              <EmptyReason field="invocationsEmptyReason" reason={motif.invocationsEmptyReason} />
            ) : (
              <ul className="v5-section__items">
                {chronological(motif.invocations).map((invocation, index) => (
                  <li className="v5-section__item" key={`${invocation.sessionDate}-${index}`}>
                    <p className="v5-section__date panshi-data">{invocation.sessionDate}</p>
                    <p className="panshi-paper">{invocation.readingText}</p>
                    <Tag truthClass={invocation.truthClass} context={context} />
                    <p>
                      <ChapterLink pointer={invocation} context={context} />
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Group>
        ))
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// 性格與習慣
// ---------------------------------------------------------------------------

function sessionDatesText(sessions: readonly ArchiveSessionPointer[]): string {
  return sessions.length === 0
    ? "沒有對應的交易時段"
    : chronological(sessions)
        .map((session) => session.sessionDate)
        .join("、");
}

function TraitsBody({ section, context }: { section: TraitsArchiveProjection; context: SectionContext }) {
  return (
    <>
      <Group title="四軸傾向">
        <p className="v5-section__note panshi-paper">
          這是連續的偏好方向，不是類型標籤，也不是能力分數。
        </p>
        <ul className="v5-section__items">
          {section.fourAxis.map((axis) => (
            <li className="v5-section__item" key={axis.axisKey}>
              <p className="panshi-paper">
                {axis.lowPoleLabel} ↔ {axis.highPoleLabel}：{axis.leaningLabel}
              </p>
              <Tag truthClass={axis.truthClass} context={context} />
            </li>
          ))}
        </ul>
      </Group>

      <Group title="核心需求與恐懼">
        <dl className="v5-section__pairs panshi-paper">
          <dt>核心需求</dt>
          <dd>{section.coreNeed.label}</dd>
        </dl>
        <Tag truthClass={section.coreNeed.truthClass} context={context} />
        <dl className="v5-section__pairs panshi-paper">
          <dt>核心恐懼</dt>
          <dd>{section.coreFear.label}</dd>
        </dl>
        <Tag truthClass={section.coreFear.truthClass} context={context} />
      </Group>

      <Group title="血型與自述">
        <p className="panshi-paper">
          血型 {section.bloodType.bloodType}：{section.bloodType.effectScopeLabel}
        </p>
        <Tag truthClass={section.bloodType.truthClass} context={context} />
        <p className="panshi-paper">{section.selfDescription.label}</p>
        <Tag truthClass={section.selfDescription.truthClass} context={context} />
      </Group>

      <Group title="習慣">
        {section.habits.length === 0 ? (
          <p className="v5-section__note panshi-paper">這份投影沒有封存任何習慣。</p>
        ) : (
          <ul className="v5-section__items">
            {section.habits.map((habit) => (
              <li className="v5-section__item" key={habit.label}>
                <p className="panshi-paper">{habit.label}</p>
                <p className="v5-section__note panshi-data">出現在：{sessionDatesText(habit.evidenceSessions)}</p>
                <Tag truthClass={habit.truthClass} context={context} />
              </li>
            ))}
          </ul>
        )}
      </Group>

      <Group title="老毛病，逐次記下">
        <p className="v5-section__note panshi-paper">
          每一次發生各記一列，依日期排列；不算次數、不打分數、不排名。
        </p>
        {section.biasOccurrences.length === 0 ? (
          <EmptyReason field="biasOccurrencesEmptyReason" reason={section.biasOccurrencesEmptyReason} />
        ) : (
          <ul className="v5-section__items" data-list="bias-occurrences">
            {chronological(section.biasOccurrences).map((occurrence, index) => (
              <li className="v5-section__item" key={`${occurrence.sessionDate}-${occurrence.biasKind}-${index}`}>
                <p className="v5-section__date panshi-data">{occurrence.sessionDate}</p>
                <p className="panshi-paper">{occurrence.biasLabel}</p>
                <p className="v5-section__note panshi-data">
                  對照的交易時段：{sessionDatesText(occurrence.evidenceSessions)}
                </p>
                <Tag truthClass={occurrence.truthClass} context={context} />
                <p>
                  <ChapterLink pointer={occurrence} context={context} />
                </p>
              </li>
            ))}
          </ul>
        )}
      </Group>

      <Group title="那一次沒有發生">
        {section.counterExamples.length === 0 ? (
          <EmptyReason field="counterExamplesEmptyReason" reason={section.counterExamplesEmptyReason} />
        ) : (
          <ul className="v5-section__items" data-list="counter-examples">
            {chronological(section.counterExamples).map((example, index) => (
              <li className="v5-section__item" key={`${example.sessionDate}-${example.biasKind}-${index}`}>
                <p className="v5-section__date panshi-data">{example.sessionDate}</p>
                <p className="panshi-paper">{example.observedLabel}</p>
                <Tag truthClass={example.truthClass} context={context} />
                <p>
                  <ChapterLink pointer={example} context={context} />
                </p>
              </li>
            ))}
          </ul>
        )}
      </Group>
    </>
  );
}

// ---------------------------------------------------------------------------
// 記憶
// ---------------------------------------------------------------------------

const VALENCE_LABEL: Readonly<Record<ArchiveMemory["emotionalValence"], string>> = {
  negative: "負面情緒",
  neutral: "情緒中性",
  positive: "正面情緒",
};

const VISIBILITY_LABEL: Readonly<Record<ArchiveMemory["visibility"], string>> = {
  subscriber_archive: "深層檔案可見",
  public_edition: "公開版可見",
};

/** 把握程度（basis points）→ 文字百分比，整數運算。 */
export function confidenceBpText(bp: number): string {
  if (!Number.isSafeInteger(bp) || bp < 0 || bp > 10_000) return DATA_UNAVAILABLE_LABEL;
  const whole = Math.floor(bp / 100);
  const fraction = bp % 100;
  return `${whole}.${fraction.toString().padStart(2, "0")}%`;
}

function Memory({ memory, context }: { memory: ArchiveMemory; context: SectionContext }) {
  return (
    <li className="v5-section__item">
      <p className="v5-section__date panshi-data">
        {memory.kindLabel}／
        {memory.formedBeforeFirstSession
          ? "進入這座城市之前就有的記憶"
          : `形成於 ${memory.sessionDate ?? memory.formedAt}`}
      </p>
      <p className="panshi-paper">{memory.note}</p>
      {memory.involvedPeople.length === 0 ? null : (
        <div className="v5-section__people">
          <p className="panshi-paper">相關的人：</p>
          <ul className="v5-section__items">
            {memory.involvedPeople.map((person, index) => (
              <li key={`${person.displayName}-${person.relationLabel}-${index}`}>
                {/* 人名與關係是人物設定，讀這個人自己的身分，不沿用這則記憶的。 */}
                <ClaimWithTruth
                  truthClass={person.truthClass}
                  declared={context.declared}
                  asOfLabel={context.asOf}
                  versionLabel={context.versionLabel}
                >
                  <p className="panshi-paper">
                    {person.displayName}（{person.relationLabel}）
                  </p>
                </ClaimWithTruth>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="v5-section__note panshi-data">
        {VALENCE_LABEL[memory.emotionalValence]}／把握程度 {confidenceBpText(memory.confidenceBp)}／
        {VISIBILITY_LABEL[memory.visibility]}
      </p>
      {memory.reinterpretations.length === 0 ? (
        <SystemLabel field="reinterpretationsEmptyReason" text={memory.reinterpretationsEmptyReason} />
      ) : (
        memory.reinterpretations.map((reading, index) => (
          <div key={`${reading.reinterpretedAt}-${index}`}>
            <p className="panshi-paper">
              後來的解讀（{reading.reinterpretedAt}）：{reading.note}
            </p>
            <Tag truthClass={reading.truthClass} context={context} />
          </div>
        ))
      )}
      <Tag truthClass={memory.truthClass} context={context} />
      {memory.sessionDate === null ? null : (
        <p>
          <ChapterLink
            pointer={{ sessionDate: memory.sessionDate, journalEntryRef: memory.journalEntryRef }}
            context={context}
          />
        </p>
      )}
    </li>
  );
}

function MemoriesBody({ section, context }: { section: MemoriesArchiveProjection; context: SectionContext }) {
  if (section.memories.length === 0) return <EmptyReason field="memoriesEmptyReason" reason={section.memoriesEmptyReason} />;
  const before = section.memories.filter((memory) => memory.formedBeforeFirstSession);
  const during = section.memories.filter((memory) => !memory.formedBeforeFirstSession);
  return (
    <>
      <Group title="來到這裡之前">
        {before.length === 0 ? (
          <p className="v5-section__note panshi-paper">沒有封存來到這裡之前的記憶。</p>
        ) : (
          <ul className="v5-section__items">
            {before.map((memory) => (
              <Memory memory={memory} context={context} key={memory.memoryRef} />
            ))}
          </ul>
        )}
      </Group>
      <Group title="在這座城市形成的記憶">
        {during.length === 0 ? (
          <p className="v5-section__note panshi-paper">還沒有在這裡形成的記憶。</p>
        ) : (
          <ul className="v5-section__items">
            {during.map((memory) => (
              <Memory memory={memory} context={context} key={memory.memoryRef} />
            ))}
          </ul>
        )}
      </Group>
    </>
  );
}

// ---------------------------------------------------------------------------
// 生平
// ---------------------------------------------------------------------------

const FACET_LABEL: Readonly<Record<LifeArchiveProjection["unrecordedFacets"][number]["facetKey"], string>> = {
  family_structure: "家庭結構",
  education: "教育經歷",
  financial_responsibility: "生活責任與經濟壓力",
};

function LifeBody({ section, context }: { section: LifeArchiveProjection; context: SectionContext }) {
  const identity = section.identity;
  return (
    <>
      <Group title="這個人">
        <dl className="v5-section__pairs panshi-paper">
          <dt>姓名</dt>
          <dd>{identity.displayName}</dd>
          <dt>年齡</dt>
          <dd>{identity.ageYears} 歲</dd>
          <dt>職業</dt>
          <dd>{identity.occupationLabel}</dd>
          <dt>出生日期</dt>
          <dd>{identity.birthDate}</dd>
          <dt>出生地</dt>
          <dd>{identity.birthRegionLabel}</dd>
          <dt>來到這座城市</dt>
          <dd>{section.joinedWorldOn}</dd>
        </dl>
        <p className="v5-section__note panshi-paper">這是一名虛構的成年居民，不對應任何真實個人。</p>
        <Tag truthClass={identity.truthClass} context={context} />
      </Group>

      <Group title="人生節點">
        {section.milestones.length === 0 ? (
          <p className="v5-section__note panshi-paper">沒有封存任何人生節點。</p>
        ) : (
          <ul className="v5-section__items">
            {[...section.milestones]
              .sort((left, right) => left.ageYears - right.ageYears)
              .map((milestone, index) => (
                <li className="v5-section__item" key={`${milestone.ageYears}-${index}`}>
                  <p className="panshi-paper">
                    {milestone.ageYears} 歲：{milestone.label}
                  </p>
                  <Tag truthClass={milestone.truthClass} context={context} />
                </li>
              ))}
          </ul>
        )}
      </Group>

      <Group title="帶進這座城市的記憶">
        {section.originMemories.length === 0 ? (
          <p className="v5-section__note panshi-paper">沒有封存任何帶進來的記憶。</p>
        ) : (
          <ul className="v5-section__items">
            {section.originMemories.map((memory) => (
              <li className="v5-section__item" key={memory.memoryRef}>
                <p className="panshi-paper">{memory.note}</p>
                <Tag truthClass={memory.truthClass} context={context} />
              </li>
            ))}
          </ul>
        )}
      </Group>

      <Group title="沒有記下的部分">
        {section.unrecordedFacets.length === 0 ? (
          <p className="v5-section__note panshi-paper">人物底盤的每一個面向都有封存。</p>
        ) : (
          <ul className="v5-section__items">
            {section.unrecordedFacets.map((facet) => (
              <li className="v5-section__item" key={facet.facetKey}>
                <p className="panshi-paper">
                  {FACET_LABEL[facet.facetKey]}：{facet.reasonLabel}
                </p>
                <Tag truthClass={facet.truthClass} context={context} />
              </li>
            ))}
          </ul>
        )}
      </Group>

      <Group title="在這裡的每一個交易時段">
        {section.chapterTimeline.length === 0 ? (
          <p className="v5-section__note panshi-paper">還沒有任何交易時段。</p>
        ) : (
          <ul className="v5-section__items">
            {chronological(section.chapterTimeline).map((pointer) => (
              <li className="v5-section__item" key={pointer.sessionDate}>
                {pointer.chapterState === "in_session" ? (
                  <p className="panshi-paper">{pointer.sessionDate}：盤中，這一章還沒出版。</p>
                ) : (
                  <ChapterLink pointer={pointer} context={context} />
                )}{" "}
                <Tag truthClass={pointer.truthClass} context={context} />
              </li>
            ))}
          </ul>
        )}
      </Group>
    </>
  );
}

// ---------------------------------------------------------------------------

export type ArchiveSectionScreenProps = {
  section: ArchiveSectionProjection;
  /** 這名角色的人生誌路徑（`/people/{id}/journal`），章節連結用它加錨點。 */
  journalPath: string;
  onOpenChapter: (chapterDate: string) => void;
  onBackToArchiveIndex: () => void;
};

const SECTION_ARIA_LABEL: Readonly<Record<ArchiveSectionProjection["sectionKey"], string>> = {
  relations: "關係",
  chart: "本命盤",
  traits: "性格與習慣",
  memories: "記憶",
  life: "生平",
};

function SectionBody({ section, context }: { section: ArchiveSectionProjection; context: SectionContext }) {
  switch (section.sectionKey) {
    case "relations":
      return <RelationsBody section={section} context={context} />;
    case "chart":
      return <ChartBody section={section} context={context} />;
    case "traits":
      return <TraitsBody section={section} context={context} />;
    case "memories":
      return <MemoriesBody section={section} context={context} />;
    case "life":
      return <LifeBody section={section} context={context} />;
  }
}

export function ArchiveSectionScreen({
  section,
  journalPath,
  onOpenChapter,
  onBackToArchiveIndex,
}: ArchiveSectionScreenProps) {
  const context: SectionContext = {
    asOf: section.asOf,
    declared: section.truthClasses,
    versionLabel: `projection v${section.projectionVersion}`,
    journalPath,
    onOpenChapter,
  };

  return (
    <section
      className="v5-section"
      aria-label={SECTION_ARIA_LABEL[section.sectionKey]}
      data-archive-section={section.sectionKey}
    >
      <style>{STYLES}</style>

      {section.sectionKey === "chart" ? (
        <p className="v5-section__scope panshi-paper" data-chart-scope="attention-only">
          {CHART_SCOPE_NOTICE}
        </p>
      ) : null}

      <p className="v5-section__note panshi-data">資料截至 {section.asOf}</p>

      <SectionBody section={section} context={context} />

      <div className="v5-section__foot">
        <button type="button" onClick={onBackToArchiveIndex}>
          回到完整人生檔案
        </button>
      </div>
    </section>
  );
}
