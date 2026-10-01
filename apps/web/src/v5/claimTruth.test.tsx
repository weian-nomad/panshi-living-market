// 逐項資料身分（public-v2.yaml 2.1.0）的前端守門測試。
//
// 四件事：
// 1. 閘門本身：只收五種之一、且在投影宣告的 `truthClasses` 裡的身分。
// 2. 真 fixture：每一個對外可見宣稱欄位都帶逐項 truth class，且沒有任何 `real_fact`。
// 3. 渲染：畫面掛的是投影在那一項上給的身分（換掉投影的值，畫面跟著換）；某一項缺身分時
//    **只有那一項**不顯示並寫出原因，其餘照常。
// 4. 原始碼：前端沒有任何寫死的 truth class 挑選。
// 5. 2.2.0：巢狀項目（記憶裡的人、關係訊號裡的原話、關係後果的對方、lot、成交）讀自己的
//    身分，缺了只扣那一項；系統說明以系統說明樣式呈現、不掛身分。
//
// apps/web 沒有 jsdom：一律 `renderToStaticMarkup`，資料用切片產生器輸出的真 fixture。

import { readFileSync, readdirSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type {
  CharacterArchiveIndex,
  CharacterCloseUp,
  LifeJournalPage,
  MemoriesArchiveProjection,
  PaperArchiveProjection,
  RelationsArchiveProjection,
  TruthClass,
  WorldSnapshot,
} from "../api/generated-v2/types.gen";
import { SliceView, type SliceData } from "./SliceApp";
import { SYSTEM_LABEL_KIND_TEXT } from "./SystemLabel";
import {
  MISSING_CLAIM_TRUTH_CLASS_TEXT,
  claimTruthClassOf,
  distinctTruthClasses,
  nestedFiguresUsable,
} from "./claimTruth";
import { DATA_UNAVAILABLE_LABEL } from "./format";
import { claimRevisions } from "./journalRevisions";
import type { Route } from "./router";
import {
  SLICE_CHARACTER_ID,
  sliceArchiveIndex,
  sliceChart,
  sliceCloseUp,
  sliceJournal,
  sliceMemories,
  slicePaper,
  sliceRelations,
  sliceWorld,
  unescapeHtml,
} from "./testing/sliceFixtures";

const ID = SLICE_CHARACTER_ID;

const ROUTES: Partial<Record<SliceData["kind"], Route>> = {
  world: { kind: "world" },
  closeUp: { kind: "closeUp", characterId: ID },
  journal: { kind: "journal", characterId: ID },
  archive: { kind: "archive", characterId: ID },
  archivePaper: { kind: "archivePaper", characterId: ID },
  archiveRelations: { kind: "archiveRelations", characterId: ID },
  archiveChart: { kind: "archiveChart", characterId: ID },
  archiveMemories: { kind: "archiveMemories", characterId: ID },
};

function render(value: SliceData): string {
  const route = ROUTES[value.kind];
  if (route === undefined) throw new Error(`no route for ${value.kind}`);
  const markup = renderToStaticMarkup(
    <SliceView route={route} state={{ phase: "ready", value }} online reducedMotion navigate={() => {}} />,
  );
  return markup.replace(/<style>[\s\S]*?<\/style>/g, "");
}

function visibleText(markup: string): string {
  return unescapeHtml(markup.replace(/<[^>]+>/g, " "));
}

function truthTags(markup: string): string[] {
  return [...markup.matchAll(/class="panshi-truth-tag[^"]*" data-truth-class="([a-z_]+)"/g)].map(
    (match) => match[1] ?? "",
  );
}

function withheldCount(markup: string): number {
  return [...markup.matchAll(/data-claim-withheld="missing_truth_class"/g)].length;
}

/** 深拷貝後刪掉一個欄位：模擬舊版或被竄改、缺了逐項身分的投影。 */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function drop(object: object, key: string): void {
  delete (object as Record<string, unknown>)[key];
}

// ---------------------------------------------------------------------------

describe("claimTruthClassOf：逐項身分的閘門", () => {
  it("只收五種之一", () => {
    expect(claimTruthClassOf("simulated_narrative")).toBe("simulated_narrative");
    expect(claimTruthClassOf("fictional_setting")).toBe("fictional_setting");
    expect(claimTruthClassOf(undefined)).toBeNull();
    expect(claimTruthClassOf(null)).toBeNull();
    expect(claimTruthClassOf("")).toBeNull();
    expect(claimTruthClassOf("rumour")).toBeNull();
    expect(claimTruthClassOf(3)).toBeNull();
  });

  it("有給投影宣告時，身分必須是宣告過的其中之一，不改掛別的", () => {
    const declared: TruthClass[] = ["fictional_setting", "simulated_narrative"];
    expect(claimTruthClassOf("simulated_narrative", declared)).toBe("simulated_narrative");
    expect(claimTruthClassOf("symbolic_interpretation", declared)).toBeNull();
    expect(claimTruthClassOf("real_fact", declared)).toBeNull();
    expect(claimTruthClassOf("simulated_narrative", [])).toBeNull();
  });

  it("去重並依固定順序排列，null 不算一種身分", () => {
    expect(distinctTruthClasses(["simulated_narrative", null, "fictional_setting", "simulated_narrative"])).toEqual([
      "fictional_setting",
      "simulated_narrative",
    ]);
    expect(distinctTruthClasses([null, null])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

function asRecord(value: unknown, where: string): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${where} is not an object`);
  }
  return value as Json;
}

function expectSibling(object: Json, field: string, where: string): void {
  expect(object[field], `${where}.${field} is missing`).toBeDefined();
  expect(claimTruthClassOf(object[`${field}TruthClass`]), `${where}.${field}TruthClass`).not.toBeNull();
}

function expectOwn(value: unknown, where: string): void {
  expect(claimTruthClassOf(asRecord(value, where)["truthClass"]), `${where}.truthClass`).not.toBeNull();
}

describe("真 fixture：每一個對外可見宣稱欄位都帶逐項 truth class", () => {
  it("世界：線索與姿態", () => {
    const world = sliceWorld() as unknown as Json;
    for (const [index, position] of (world["characterPositions"] as Json[]).entries()) {
      expectSibling(position, "poseState", `characterPositions[${index}]`);
      if (position["focusHint"] !== null) expectSibling(position, "focusHint", `characterPositions[${index}]`);
    }
    for (const [index, hook] of (world["storyHooks"] as Json[]).entries()) {
      expectSibling(hook, "label", `storyHooks[${index}]`);
    }
  });

  it("近景：身分、姿態、動詞、矛盾、原話、注意、後果與承諾", () => {
    const closeUp = sliceCloseUp() as unknown as Json;
    for (const field of [
      "displayName",
      "ageYears",
      "occupationLabel",
      "poseState",
      "currentVerbPhrase",
      "unresolvedTensionSummary",
    ]) {
      expectSibling(closeUp, field, "close-up");
    }
    for (const field of ["publicClaim", "selfAcknowledgement", "currentAttention", "recentConsequenceHighlight"]) {
      expectOwn(closeUp[field], `close-up.${field}`);
    }
    for (const commitment of closeUp["unresolvedCommitments"] as unknown[]) expectOwn(commitment, "commitment");
  });

  it("人生誌：每章的九段宣稱", () => {
    const entries = (sliceJournal() as unknown as Json)["entries"] as Json[];
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      const where = `chapter ${String(entry["chapterDate"])}`;
      for (const field of ["sceneSummary", "knownAtTheTimeSummary", "actionSummary", "openQuestionSummary"]) {
        expectSibling(entry, field, where);
      }
      if (entry["missedFactsSummary"] !== undefined) expectSibling(entry, "missedFactsSummary", where);
      if (entry["recurringPatternRef"] !== undefined) {
        expect(claimTruthClassOf(entry["recurringPatternTruthClass"]), `${where}.recurringPatternTruthClass`).not.toBeNull();
      }
      if (entry["contemporaneousClaim"] !== undefined) expectOwn(entry["contemporaneousClaim"], `${where}.claim`);
      expectOwn(entry["currentSelfNarration"], `${where}.currentSelfNarration`);
      const consequence = asRecord(entry["consequence"], `${where}.consequence`);
      if (consequence["paperConsequence"] !== undefined) expectOwn(consequence["paperConsequence"], `${where}.paper`);
      if (consequence["nonPaperConsequenceSummary"] !== undefined) {
        expectSibling(consequence, "nonPaperConsequenceSummary", `${where}.consequence`);
      }
    }
  });

  it("索引：長期矛盾、最近三件事（逐件）與六節摘要", () => {
    const index = sliceArchiveIndex() as unknown as Json;
    expectSibling(index, "longTermTensionSummary", "archive");
    const highlights = index["recentHighlights"] as unknown[];
    const classes = index["recentHighlightTruthClasses"] as unknown[];
    expect(highlights.length).toBeGreaterThan(0);
    expect(classes).toHaveLength(highlights.length);
    for (const truthClass of classes) expect(claimTruthClassOf(truthClass)).not.toBeNull();
    for (const section of index["sections"] as Json[]) expectSibling(section, "summary", `section ${String(section["sectionKey"])}`);
  });

  it("模擬紀錄：帳戶、部位、理由、原話、說法、每列交易與每則更正", () => {
    const paper = slicePaper() as unknown as Json;
    expectOwn(paper["account"], "account");
    for (const position of paper["positions"] as Json[]) {
      expectOwn(position, "position");
      for (const field of ["instrumentLabel", "rationaleSummary", "consequenceSummary"]) {
        expectSibling(position, field, "position");
      }
      expectOwn(position["concurrentClaim"], "position.concurrentClaim");
      expectOwn(position["currentNarration"], "position.currentNarration");
    }
    let disclosed = 0;
    for (const record of paper["historicalActionFills"] as Json[]) {
      const disclosure = record["dailyActionDisclosure"];
      if (disclosure === undefined) continue;
      disclosed += 1;
      const where = `record ${String(record["tradingDate"])}`;
      expectOwn(disclosure, where);
      expectSibling(asRecord(disclosure, where), "instrumentLabel", where);
      expectSibling(asRecord(disclosure, where), "rationaleSummary", where);
    }
    expect(disclosed).toBeGreaterThan(0);
    const revisions = paper["dataRevisions"] as unknown[];
    expect(revisions.length).toBeGreaterThan(0);
    for (const revision of revisions) expectOwn(revision, "dataRevision");
  });

  it("整份 fixture 沒有任何 `real_fact`（值或文字都沒有）", () => {
    const root = new URL("../../../../fixtures/v5/one-character-slice/api/", import.meta.url);
    const index = JSON.parse(readFileSync(new URL("index.json", root), "utf8")) as { routes: Record<string, string> };
    const files = Object.values(index.routes);
    expect(files.length).toBe(10);
    for (const file of files) {
      const text = readFileSync(new URL(file, root), "utf8");
      expect(text.includes("real_fact"), file).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------

describe("渲染：畫面掛投影給的身分，缺身分的那一項 fail closed", () => {
  it("近景的每一項都掛自己的身分，且真 fixture 沒有任何一項被扣住", () => {
    const markup = render({ kind: "closeUp", data: sliceCloseUp() });
    expect(withheldCount(markup)).toBe(0);
    // 靜態渲染停在揭露節奏的第一拍：第一屏那句、姿態、姓名／年齡／職業（同為虛構設定，
    // 共用一顆）與當下動詞，各自一顆。
    expect(truthTags(markup).length).toBeGreaterThanOrEqual(4);
    expect(truthTags(markup)).not.toContain("real_fact");
  });

  it("身分跟著投影走：投影換成另一種身分，畫面就掛那一種，介面不自己挑", () => {
    const data = clone(sliceCloseUp()) as CharacterCloseUp;
    data.truthClasses = ["symbolic_interpretation"];
    data.displayNameTruthClass = "symbolic_interpretation";
    data.ageYearsTruthClass = "symbolic_interpretation";
    data.occupationLabelTruthClass = "symbolic_interpretation";
    data.poseStateTruthClass = "symbolic_interpretation";
    data.currentVerbPhraseTruthClass = "symbolic_interpretation";
    data.unresolvedTensionSummaryTruthClass = "symbolic_interpretation";
    if (data.recentConsequenceHighlight) data.recentConsequenceHighlight.truthClass = "symbolic_interpretation";

    const tags = truthTags(render({ kind: "closeUp", data }));
    expect(tags.length).toBeGreaterThanOrEqual(4);
    expect(new Set(tags)).toEqual(new Set(["symbolic_interpretation"]));
  });

  it("近景：姿態那一句缺身分 → 那句不顯示並寫原因，姓名與動詞照常", () => {
    const data = clone(sliceCloseUp()) as CharacterCloseUp;
    drop(data, "poseStateTruthClass");
    const markup = render({ kind: "closeUp", data });
    const text = visibleText(markup);

    expect(text).not.toContain("在端詳一份資料");
    expect(text).toContain(MISSING_CLAIM_TRUTH_CLASS_TEXT);
    expect(withheldCount(markup)).toBe(1);
    expect(text).toContain(data.displayName);
    expect(text).toContain(data.currentVerbPhrase);
  });

  it("近景：身分不在投影宣告的 `truthClasses` 裡，一樣扣住", () => {
    const data = clone(sliceCloseUp()) as CharacterCloseUp;
    data.currentVerbPhraseTruthClass = "statistical_sample";
    const text = visibleText(render({ kind: "closeUp", data }));
    expect(text).not.toContain(data.currentVerbPhrase);
    expect(text).toContain(MISSING_CLAIM_TRUTH_CLASS_TEXT);
  });

  it("模擬紀錄：原始理由與一則更正缺身分 → 只有那兩項不顯示", () => {
    const data = clone(slicePaper()) as PaperArchiveProjection;
    const position = data.positions[0];
    const revision = data.dataRevisions[0];
    if (position === undefined || revision === undefined) throw new Error("fixture shape changed");
    drop(position, "rationaleSummaryTruthClass");
    drop(revision, "truthClass");
    const markup = render({ kind: "archivePaper", data });
    const text = visibleText(markup);

    expect(text).not.toContain(position.rationaleSummary);
    expect(text).not.toContain(revision.summary);
    expect(withheldCount(markup)).toBeGreaterThanOrEqual(2);
    // 其他帶身分的宣稱照常顯示。
    expect(text).toContain(position.consequenceSummary);

    const intact = render({ kind: "archivePaper", data: slicePaper() });
    expect(withheldCount(intact)).toBe(0);
    expect(visibleText(intact)).toContain(slicePaper().positions[0]?.rationaleSummary ?? "∅");
  });

  it("人生誌：一章的「他做了什麼」缺身分 → 那一段寫原因，同章其他段照常", () => {
    const page = clone(sliceJournal()) as LifeJournalPage;
    const entry = page.entries.find((candidate) => candidate.narrativeState === "composed");
    if (entry === undefined) throw new Error("fixture has no composed chapter");
    const action = entry.actionSummary;
    const unique = page.entries.filter((candidate) => candidate.actionSummary === action).length === 1;
    drop(entry, "actionSummaryTruthClass");
    const markup = render({ kind: "journal", data: page });

    expect(withheldCount(markup)).toBe(1);
    if (unique) expect(visibleText(markup)).not.toContain(action);
    expect(visibleText(markup)).toContain(entry.openQuestionSummary);
    expect(withheldCount(render({ kind: "journal", data: sliceJournal() }))).toBe(0);
  });

  it("索引：最近三件事逐件讀平行身分，缺的那一格只寫原因；節摘要缺身分也扣住", () => {
    const data = clone(sliceArchiveIndex()) as CharacterArchiveIndex;
    const [first, second] = data.recentHighlights;
    if (first === undefined || second === undefined) throw new Error("fixture shape changed");
    data.recentHighlightTruthClasses = data.recentHighlightTruthClasses.slice(1);
    const paperSection = data.sections.find((section) => section.sectionKey === "paper");
    if (paperSection === undefined || !("summary" in paperSection)) throw new Error("fixture shape changed");
    drop(paperSection, "summaryTruthClass");
    const text = visibleText(render({ kind: "archive", data }));

    // 平行身分陣列少了一格：第三件在它的位置上沒有身分，就只寫原因。
    expect(text).toContain(first);
    expect(text).toContain(second);
    expect(text).not.toContain(data.recentHighlights[2] ?? "∅");
    expect(text).not.toContain(paperSection.summary);
    expect(text).toContain(MISSING_CLAIM_TRUTH_CLASS_TEXT);
  });

  it("世界：線索缺身分就不上字幕，並寫出有幾項不顯示", () => {
    const data = clone(sliceWorld()) as WorldSnapshot;
    const hook = data.storyHooks[0];
    if (hook === undefined) throw new Error("fixture shape changed");
    drop(hook, "labelTruthClass");
    const markup = render({ kind: "world", data });
    expect(visibleText(markup)).not.toContain(hook.label);
    // 同一句出現在兩處（第一屏那句與舞台字幕），兩處都扣住、各自寫原因。
    expect(withheldCount(markup)).toBe(2);
    expect(visibleText(markup)).toContain("有 1 項世界線索不顯示");

    const intact = render({ kind: "world", data: sliceWorld() });
    expect(visibleText(intact)).toContain(hook.label);
    expect(withheldCount(intact)).toBe(0);
  });
});

// ---------------------------------------------------------------------------

/** 一個 `data-system-label` 元素的完整 markup（系統說明）。 */
function systemLabels(markup: string, field: string): string[] {
  return [...markup.matchAll(new RegExp(`<p class="panshi-system-label[^"]*" data-system-label="${field}">[\\s\\S]*?</p>`, "g"))].map(
    (match) => match[0],
  );
}

describe("2.2.0：巢狀項目讀自己的身分，缺了只扣那一項", () => {
  it("閘門：巢狀數字的身分要合法、在宣告內，而且和上層相同", () => {
    const declared: TruthClass[] = ["fictional_setting", "simulated_narrative"];
    expect(nestedFiguresUsable("simulated_narrative", "simulated_narrative", declared)).toBe(true);
    expect(nestedFiguresUsable(undefined, "simulated_narrative", declared)).toBe(false);
    expect(nestedFiguresUsable("fictional_setting", "simulated_narrative", declared)).toBe(false);
    expect(nestedFiguresUsable("symbolic_interpretation", "symbolic_interpretation", declared)).toBe(false);
    expect(nestedFiguresUsable("simulated_narrative", undefined, declared)).toBe(false);
  });

  it("記憶：提到的人各掛自己的身分；某個人缺身分 → 只有那個人不顯示，記憶本身照常", () => {
    const intactData = sliceMemories();
    const memory = intactData.memories.find((candidate) => candidate.involvedPeople.length > 0);
    const person = memory?.involvedPeople[0];
    if (memory === undefined || person === undefined) throw new Error("fixture has no involved person");
    const line = `${person.displayName}（${person.relationLabel}）`;
    const intact = render({ kind: "archiveMemories", data: intactData });
    expect(visibleText(intact)).toContain(line);
    expect(withheldCount(intact)).toBe(0);

    const data = clone(intactData) as MemoriesArchiveProjection;
    for (const candidate of data.memories) {
      for (const involved of candidate.involvedPeople) drop(involved, "truthClass");
    }
    const markup = render({ kind: "archiveMemories", data });
    const people = intactData.memories.reduce((total, candidate) => total + candidate.involvedPeople.length, 0);
    expect(visibleText(markup)).not.toContain(line);
    expect(withheldCount(markup)).toBe(people);
    expect(visibleText(markup)).toContain(memory.note);
  });

  it("關係：訊號裡的原話讀自己的身分；缺了 → 原話不顯示，訊號摘要照常", () => {
    const intactData = sliceRelations();
    const signal = intactData.acquaintances[0]?.relationshipSignals[0];
    if (signal === undefined) throw new Error("fixture has no relationship signal");
    const intact = render({ kind: "archiveRelations", data: intactData });
    expect(visibleText(intact)).toContain(signal.utterance.canonicalTextUtf8);
    expect(withheldCount(intact)).toBe(0);

    const data = clone(intactData) as RelationsArchiveProjection;
    const broken = data.acquaintances[0]?.relationshipSignals[0];
    if (broken === undefined) throw new Error("fixture shape changed");
    drop(broken.utterance, "truthClass");
    const markup = render({ kind: "archiveRelations", data });
    expect(visibleText(markup)).not.toContain(signal.utterance.canonicalTextUtf8);
    expect(withheldCount(markup)).toBe(1);
    expect(visibleText(markup)).toContain(signal.summary);
  });

  it("人生誌：關係後果的對方名字缺身分 → 那一行不顯示，後果摘要照常", () => {
    const page = clone(sliceJournal()) as LifeJournalPage;
    const entry = page.entries.find((candidate) => candidate.relationshipConsequence);
    const relationship = entry?.relationshipConsequence;
    if (relationship === undefined || relationship === null) throw new Error("fixture has no relationship consequence");
    const intact = render({ kind: "journal", data: sliceJournal() });
    expect(withheldCount(intact)).toBe(0);
    // 完整投影時，對方那一行確實以「名字（關係）」一行上畫面，而且掛自己的身分。
    expect(intact).toMatch(/<p class="panshi-paper">\S+（\S+）<\/p>/);

    // 對方那一行只在改口章節的四欄並排裡上畫面：那一章就是帶關係後果的那一章。
    const inComparison = [...claimRevisions(page.entries, page.heldEntries).values()].filter(
      (revision) => revision.entry.entryId === entry?.entryId,
    ).length;
    expect(inComparison).toBe(1);
    drop(relationship, "displayNameTruthClass");
    const markup = render({ kind: "journal", data: page });
    expect(withheldCount(markup)).toBe(inComparison);
    // 後果摘要（它自己帶身分）照常；摘要句子裡本來就寫著對方名字，那是摘要這一項的內容。
    expect(visibleText(markup)).toContain(relationship.summary);
    expect(markup).not.toMatch(/<p class="panshi-paper">\S+（\S+）<\/p>/);
  });

  it("模擬紀錄：lot 缺身分或與部位身分不同 → 成本與持有數量寫「資料未到」，不借部位的身分", () => {
    const intactText = visibleText(render({ kind: "archivePaper", data: slicePaper() }));
    expect(intactText).toContain("成本 60,000.00");

    for (const breakLot of [
      (lot: Record<string, unknown>) => delete lot["truthClass"],
      (lot: Record<string, unknown>) => (lot["truthClass"] = "fictional_setting"),
    ]) {
      const data = clone(slicePaper()) as PaperArchiveProjection;
      const lot = data.positions[0]?.lots[0];
      if (lot === undefined) throw new Error("fixture has no lot");
      breakLot(lot as unknown as Record<string, unknown>);
      const text = visibleText(render({ kind: "archivePaper", data }));
      expect(text).not.toContain("60,000.00");
      expect(text).toContain(`成本 ${DATA_UNAVAILABLE_LABEL}`);
    }
  });

  it("模擬紀錄：成交缺身分 → 那一列的成交價寫「資料未到」，其他列照常", () => {
    const data = clone(slicePaper()) as PaperArchiveProjection;
    const filled = data.historicalActionFills.filter((record) => record.dailyActionDisclosure?.fill);
    const first = filled[0]?.dailyActionDisclosure?.fill;
    if (first === undefined || first === null || filled.length < 2) throw new Error("fixture shape changed");
    const intactUnavailable = visibleText(render({ kind: "archivePaper", data: slicePaper() })).split(DATA_UNAVAILABLE_LABEL).length;
    drop(first, "truthClass");
    const brokenUnavailable = visibleText(render({ kind: "archivePaper", data })).split(DATA_UNAVAILABLE_LABEL).length;
    expect(brokenUnavailable - intactUnavailable).toBe(1);
  });
});

describe("2.2.0：系統說明不是宣稱，用系統說明樣式呈現、不掛身分", () => {
  it("本命盤的 `placementsEmptyReason`", () => {
    const chart = sliceChart();
    const markup = render({ kind: "archiveChart", data: chart });
    const labels = systemLabels(markup, "placementsEmptyReason");
    expect(labels).toHaveLength(1);
    expect(visibleText(labels[0] ?? "")).toContain(SYSTEM_LABEL_KIND_TEXT);
    expect(visibleText(labels[0] ?? "")).toContain(chart.placementsEmptyReason ?? "∅");
    expect(labels[0]).not.toContain("panshi-truth-tag");
  });

  it("人生誌的 `paperOutcomeNullReason`（證據卡）與 `relationshipConsequenceNullReason`（並排比較）", () => {
    // 沒有紙上後果的那一章改成只剩證據卡，證據卡就會寫出原因。
    const page = clone(sliceJournal()) as LifeJournalPage;
    const noPaper = page.entries.filter((entry) => entry.evidenceCard.paperOutcome === null);
    expect(noPaper.length).toBeGreaterThan(0);
    for (const entry of noPaper) {
      entry.narrativeState = "evidence_card_only";
      entry.narrativeSegments = [];
    }
    const markup = render({ kind: "journal", data: page });
    const revisions = [...claimRevisions(page.entries, page.heldEntries).values()];
    const expectedPaper =
      noPaper.length + revisions.filter((revision) => revision.entry.evidenceCard.paperOutcome === null).length;
    const expectedRelationship = revisions.filter((revision) => !revision.entry.relationshipConsequence).length;

    const paperLabels = systemLabels(markup, "paperOutcomeNullReason");
    const relationshipLabels = systemLabels(markup, "relationshipConsequenceNullReason");
    expect(paperLabels).toHaveLength(expectedPaper);
    expect(relationshipLabels).toHaveLength(expectedRelationship);
    expect(paperLabels.length + relationshipLabels.length).toBeGreaterThan(0);
    for (const label of [...paperLabels, ...relationshipLabels]) {
      expect(visibleText(label)).toContain(SYSTEM_LABEL_KIND_TEXT);
      expect(label).not.toContain("panshi-truth-tag");
    }
    // 系統說明不會以紙頁（角色說法）樣式出現。
    const reason = noPaper[0]?.evidenceCard.paperOutcomeNullReason;
    expect(markup).not.toContain(`<p class="panshi-paper">${reason}</p>`);
  });
});

// ---------------------------------------------------------------------------

describe("原始碼：前端沒有寫死的 truth class 挑選", () => {
  const LITERAL = /["'`](real_fact|statistical_sample|fictional_setting|symbolic_interpretation|simulated_narrative)["'`]/g;
  // 只有「列舉五種身分」與「依身分畫圖形」可以寫出身分字面值；兩者都不替任何宣稱挑身分。
  const ALLOWED_LITERALS: Readonly<Record<string, number>> = {
    "format.ts": 5, // `TRUTH_CLASSES` 列舉
    "apiClient.ts": 5, // 進門驗證用的列舉
    "TruthTag.tsx": 5, // 每種身分一個幾何圖形
  };

  it("非測試原始碼裡的身分字面值只出現在列舉與圖形", () => {
    const directory = new URL("./", import.meta.url);
    const offenders: string[] = [];
    for (const file of readdirSync(directory)) {
      if (!/\.(ts|tsx)$/.test(file) || /\.test\.tsx?$/.test(file)) continue;
      // 註解裡提到身分名稱不算挑選；只數程式碼。
      const source = readFileSync(new URL(file, directory), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      const count = [...source.matchAll(LITERAL)].length;
      if (count !== (ALLOWED_LITERALS[file] ?? 0)) offenders.push(`${file}: ${count}`);
    }
    expect(offenders).toEqual([]);
  });
});
