// public-v2 3.0.0 kill switch：前端遇到被暫停的投影，只畫投影給的固定系統說明，
// 不能自己生出「目前沒有持股」「他目前沒有模擬持倉」「還沒有任何章節」這類中性版本，
// 也不能把缺席的宣稱畫成「缺少資料身分」。三種系統說明（`heldReasonLabel`、
// `marketClosureReasonLabel`、`summaryHeldReasonLabel`）都要畫出來。
//
// 被暫停的形狀照 `tools/character-episode/src/public_api.rs` 的產出規則，由真 fixture 改造：
// 撤下的欄位刪掉、清單清空、加上契約列出的固定句（句子直接讀
// `contracts/openapi/public-v2-system-labels.json`，不在這裡另抄一份）。
// apps/web 沒有 jsdom：一律 `renderToStaticMarkup`。

import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type {
  CharacterArchiveIndex,
  CharacterCloseUp,
  LifeJournalPage,
  PaperArchiveProjection,
  RelationsArchiveProjection,
  WorldSnapshot,
} from "../api/generated-v2/types.gen";
import { isValidProjection } from "./apiClient";
import { SliceView, emptyReasonOf, type SliceData } from "./SliceApp";
import { MISSING_CLAIM_TRUTH_CLASS_TEXT } from "./claimTruth";
import type { Route } from "./router";
import { EMPTY_STATE_COPY } from "./statePanels";
import {
  SLICE_CHARACTER_ID,
  sliceArchiveIndex,
  sliceCloseUp,
  sliceJournal,
  slicePaper,
  sliceRelations,
  sliceWorld,
  unescapeHtml,
} from "./testing/sliceFixtures";

const ID = SLICE_CHARACTER_ID;

const LABELS = JSON.parse(
  readFileSync(new URL("../../../../contracts/openapi/public-v2-system-labels.json", import.meta.url), "utf8"),
) as { systemLabels: Record<string, string[]> };

/** 契約裡 kill switch 專用的那一句（每個欄位最後加進去的句子）。 */
function contractSentence(field: string): string {
  const sentences = LABELS.systemLabels[field];
  const sentence = sentences?.[sentences.length - 1];
  if (sentence === undefined) throw new Error(`${field} has no listed sentence`);
  return sentence;
}

const CLOSURE = contractSentence("marketClosureReasonLabel");
const HELD = contractSentence("heldReasonLabel");
const SUMMARY_HELD = contractSentence("summaryHeldReasonLabel");
const LIST_CLOSED = contractSentence("relationshipSignalsEmptyReason");

const ROUTES: Partial<Record<SliceData["kind"], Route>> = {
  world: { kind: "world" },
  closeUp: { kind: "closeUp", characterId: ID },
  journal: { kind: "journal", characterId: ID },
  archive: { kind: "archive", characterId: ID },
  archivePaper: { kind: "archivePaper", characterId: ID },
  archiveRelations: { kind: "archiveRelations", characterId: ID },
};

function render(value: SliceData): string {
  const route = ROUTES[value.kind];
  if (route === undefined) throw new Error(`no route for ${value.kind}`);
  const markup = renderToStaticMarkup(
    <SliceView route={route} state={{ phase: "ready", value }} online reducedMotion navigate={() => {}} />,
  );
  return markup.replace(/<style>[\s\S]*?<\/style>/g, "");
}

function text(markup: string): string {
  return unescapeHtml(markup.replace(/<[^>]+>/g, " "));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function drop(object: object, ...keys: string[]): void {
  for (const key of keys) delete (object as Record<string, unknown>)[key];
}

function systemLabelCount(markup: string, field: string): number {
  return [...markup.matchAll(new RegExp(`data-system-label="${field}"`, "g"))].length;
}

function closedPaper(): PaperArchiveProjection {
  const data = clone(slicePaper());
  drop(data, "account", "paperVersionSet");
  data.positions = [];
  data.historicalActionFills = data.historicalActionFills.filter((record) => record.tradingDate < "2026-03-17");
  data.dataRevisions = [];
  data.marketClosureReasonLabel = CLOSURE;
  return data;
}

function closedCloseUp(): CharacterCloseUp {
  const data = clone(sliceCloseUp());
  drop(
    data,
    "currentVerbPhrase",
    "currentVerbPhraseTruthClass",
    "currentAttention",
    "unresolvedTensionSummary",
    "unresolvedTensionSummaryTruthClass",
    "publicClaim",
    "selfAcknowledgement",
    "recentConsequenceHighlight",
  );
  data.unresolvedCommitments = [];
  data.marketClosureReasonLabel = CLOSURE;
  return data;
}

function closedArchiveIndex(): CharacterArchiveIndex {
  const data = clone(sliceArchiveIndex());
  drop(data, "longTermTensionSummary", "longTermTensionSummaryTruthClass");
  data.recentHighlights = [];
  data.recentHighlightTruthClasses = [];
  data.sections = data.sections.map((section) =>
    section.sectionKey === "chart" || section.sectionKey === "traits" || !("summary" in section)
      ? section
      : {
          sectionKey: section.sectionKey,
          viewerAudienceScope: section.viewerAudienceScope,
          entryVisibility: "HELD" as const,
          summaryHeldReasonLabel: SUMMARY_HELD,
          asOf: section.asOf,
          visibilityEpoch: section.visibilityEpoch,
          sectionPath: section.sectionPath,
        },
  ) as CharacterArchiveIndex["sections"];
  data.marketClosureReasonLabel = CLOSURE;
  return data;
}

describe("kill switch：被暫停的投影只畫固定系統說明", () => {
  it("模擬紀錄：持股、帳戶與更正都被撤時，不說「目前沒有持股」、不補 0", () => {
    const data = closedPaper();
    const value: SliceData = { kind: "archivePaper", data };
    expect(emptyReasonOf(value)).toBeNull();
    const markup = render(value);
    const visible = text(markup);
    expect(systemLabelCount(markup, "marketClosureReasonLabel")).toBeGreaterThanOrEqual(3);
    expect(visible).toContain(CLOSURE);
    expect(visible).not.toContain(EMPTY_STATE_COPY.paper_no_positions.title);
    expect(visible).not.toContain(EMPTY_STATE_COPY.paper_no_positions.body);
    expect(visible).not.toContain("沒有附上任何更正紀錄");
    expect(markup).not.toContain('data-empty-reason="paper_no_positions"');
    expect(visible).not.toContain("現金");
  });

  it("近景：今天這一層被撤時，不說「他目前沒有模擬持倉」，也不寫成缺少資料身分", () => {
    const markup = render({ kind: "closeUp", data: closedCloseUp() });
    const visible = text(markup);
    expect(systemLabelCount(markup, "marketClosureReasonLabel")).toBe(1);
    expect(visible).toContain(CLOSURE);
    expect(visible).not.toContain("他目前沒有模擬持倉");
    expect(visible).not.toContain(MISSING_CLAIM_TRUTH_CLASS_TEXT);
  });

  it("深層檔案索引：摘要被撤的節畫 `summaryHeldReasonLabel`，入口照常可開", () => {
    const data = closedArchiveIndex();
    const markup = render({ kind: "archive", data });
    const visible = text(markup);
    expect(systemLabelCount(markup, "summaryHeldReasonLabel")).toBe(4);
    expect(visible).toContain(SUMMARY_HELD);
    expect(visible).toContain(CLOSURE);
    expect([...visible.matchAll(/打開/g)].length).toBe(6);
    expect(visible).not.toContain("沒有留下近期事項");
    expect(visible).not.toContain(MISSING_CLAIM_TRUTH_CLASS_TEXT);
  });

  it("人生誌：章節全被撤時不是「還沒有任何章節」，每一章畫 `heldReasonLabel`", () => {
    const data: LifeJournalPage = clone(sliceJournal());
    data.heldEntries = data.entries.map((entry) => ({
      entryId: entry.entryId,
      chapterDate: entry.chapterDate,
      entryVisibility: "HELD" as const,
      heldReasonLabel: HELD,
    }));
    data.entries = [];
    const value: SliceData = { kind: "journal", data };
    expect(emptyReasonOf(value)).toBeNull();
    const markup = render(value);
    expect(systemLabelCount(markup, "heldReasonLabel")).toBe(data.heldEntries.length);
    expect(text(markup)).not.toContain(EMPTY_STATE_COPY.journal_no_chapters.title);
  });

  it("世界：今日五幕與今天的焦點被撤時，畫固定系統說明", () => {
    const data: WorldSnapshot = clone(sliceWorld());
    data.storyHooks = [];
    for (const position of data.characterPositions) {
      position.focusHint = null;
      position.focusHintTruthClass = null;
      position.sourceEventRefs = [];
    }
    data.marketClosureReasonLabel = CLOSURE;
    const markup = render({ kind: "world", data });
    expect(systemLabelCount(markup, "marketClosureReasonLabel")).toBe(1);
    expect(text(markup)).toContain(CLOSURE);
  });

  it("關係：被撤空的清單用契約的暫停句，不說「沒有任何關係訊號」", () => {
    const data: RelationsArchiveProjection = clone(sliceRelations());
    for (const acquaintance of data.acquaintances) {
      acquaintance.relationshipSignals = [];
      acquaintance.relationshipSignalsEmptyReason = LIST_CLOSED;
    }
    data.marketClosureReasonLabel = CLOSURE;
    const markup = render({ kind: "archiveRelations", data });
    const visible = text(markup);
    expect(visible).toContain(CLOSURE);
    expect(visible).toContain(LIST_CLOSED);
    expect(visible).not.toContain("他沒有在公開場合留下任何指向她的關係訊號");
  });

  it("驗證：撤下的欄位只有在帶固定說明時才合法；沒帶就是投影不完整", () => {
    expect(isValidProjection("archivePaper", closedPaper())).toBe(true);
    expect(isValidProjection("closeUp", closedCloseUp())).toBe(true);
    expect(isValidProjection("archive", closedArchiveIndex())).toBe(true);
    for (const [kind, data] of [
      ["archivePaper", closedPaper()],
      ["closeUp", closedCloseUp()],
      ["archive", closedArchiveIndex()],
    ] as const) {
      const unlabelled = clone(data) as Record<string, unknown>;
      delete unlabelled["marketClosureReasonLabel"];
      expect(isValidProjection(kind, unlabelled)).toBe(false);
    }
  });

  it("人生誌：被暫停的章若帶來源不是市場的段落，逐字畫出來並掛自己的身分", () => {
    const data: LifeJournalPage = clone(sliceJournal());
    const [first] = data.entries;
    if (first === undefined) throw new Error("fixture shape changed");
    const motif = first.narrativeSegments.find((segment) => segment.segmentId === "segment-motif");
    if (motif === undefined || motif.kind !== "narrator") throw new Error("fixture shape changed");
    data.heldEntries = [
      {
        entryId: first.entryId,
        chapterDate: first.chapterDate,
        entryVisibility: "HELD" as const,
        heldReasonLabel: HELD,
        nonMarketSegments: [
          { ...motif, sourceRefs: [{ kind: "character_seed", eventType: null, globalPosition: null, refId: "character-seed/v1#natal-motif" }] },
        ],
      },
    ];
    data.entries = data.entries.slice(1);
    const markup = render({ kind: "journal", data });
    expect(markup).toContain(`data-non-market-segment="segment-motif"`);
    expect(text(markup)).toContain(motif.text);
    expect(systemLabelCount(markup, "heldReasonLabel")).toBe(1);
  });

  it("版本標示不帶事件數：不顯示投影版本與來源位置", () => {
    for (const value of [
      { kind: "archive", data: sliceArchiveIndex() },
      { kind: "journal", data: sliceJournal() },
      { kind: "archivePaper", data: slicePaper() },
      { kind: "closeUp", data: sliceCloseUp() },
    ] as SliceData[]) {
      const markup = render(value);
      expect(markup).not.toContain("投影版本");
      expect(markup).not.toContain("來源位置");
      expect(markup).not.toContain("projection v");
      expect(markup).not.toContain(`${value.data.projectionVersion}`);
    }
  });
});
