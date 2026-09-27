import { describe, expect, it } from "vitest";

import type { LifeJournalEntry } from "../api/generated-v2/types.gen";
import { DATA_UNAVAILABLE_LABEL } from "./format";
import {
  DIGEST_PREFIX_LENGTH,
  JOURNAL_SECTION_ORDER,
  UNACKNOWLEDGED_MOTIVE_LABEL,
  journalSections,
  type JournalSectionKey,
} from "./journalSections";

const DIGEST = "9f2c4b1ad6e07835bb1c0e5f4a2d9c73e8b6410fa5d2c9037e1b845c6a0d3f92";

/** 一天的最小合法章節：所有必填欄位到齊，選填欄位全缺。 */
function minimalEntry(overrides: Partial<LifeJournalEntry> = {}): LifeJournalEntry {
  return {
    entryId: "3f6f8b6e-8f3c-4a67-9d6d-0f3f7f1f2a11",
    chapterDate: "2026-03-03",
    // 契約必填（public-v2.yaml `LifeJournalEntry`）；九段 mapper 不讀這幾個欄位。
    entryVisibility: "PUBLIC",
    narrativeState: "composed",
    narrativeSegments: [],
    evidenceCard: {
      action: {
        kind: "NO_ACTION",
        label: "沒有下單",
        truthClass: "simulated_narrative",
        sourceRefs: [{ kind: "character_seed", eventType: null, globalPosition: null, refId: "test-seed" }],
      },
      paperOutcome: null,
      paperOutcomeNullReason: "測試：這一天沒有紙上後果。",
      quotedUtterances: [],
      memoryRefs: [],
      relationshipRefs: [],
    },
    relationshipConsequence: null,
    relationshipConsequenceNullReason: "測試：這一天沒有關係訊號。",
    sceneSummary: "他在開盤後又打開了同一家公司的資料。",
    sceneSummaryTruthClass: "simulated_narrative",
    knownAtTheTimeSummary: "他當時看過昨天的公告附註與早盤那段上漲。",
    knownAtTheTimeSummaryTruthClass: "simulated_narrative",
    actionSummary: "他建立了一筆紙上部位，數量與價格記在模擬紀錄。",
    actionSummaryTruthClass: "simulated_narrative",
    consequence: {},
    openQuestionSummary: "他還沒有和小雨談這件事。",
    openQuestionSummaryTruthClass: "simulated_narrative",
    archiveRefs: { paperPositionRefs: [], relationshipDyadRefs: [], memoryRefs: [] },
    ...overrides,
  };
}

function keysOf(entry: LifeJournalEntry): JournalSectionKey[] {
  return journalSections(entry).map((section) => section.key);
}

describe("人生誌九段 mapper", () => {
  it("段落順序固定，段名逐字照 experience-spec §8.1", () => {
    const entry = minimalEntry({
      contemporaneousClaim: {
        utteranceArtifactId: "utt-001",
        canonicalTextSha256: DIGEST,
        canonicalTextUtf8: "只是小部位。",
        truthClass: "simulated_narrative",
      },
      missedFactsSummary: "同業存貨天數上升的那則資料，他當時沒有點開。",
      missedFactsSummaryTruthClass: "simulated_narrative",
      recurringPatternRef: "pattern-confirmation-bias",
      recurringPatternTruthClass: "simulated_narrative",
      currentSelfNarration: {
        kind: "summary",
        summaryText: "他把標題改成長期治理價值。",
        truthClass: "simulated_narrative",
      },
    });

    expect(journalSections(entry).map((section) => section.title)).toEqual(
      JOURNAL_SECTION_ORDER.map((section) => section.title),
    );
    expect(keysOf(entry)).toEqual(JOURNAL_SECTION_ORDER.map((section) => section.key));
  });

  it("沒有 artifact 就不生引號，只給無引號摘要或 absent", () => {
    const sections = journalSections(minimalEntry());

    for (const section of sections) {
      expect(section.body.kind).not.toBe("quote");
      if (section.body.kind === "summary") {
        expect(section.body.text.startsWith("「")).toBe(false);
        expect(section.body.text.includes("“")).toBe(false);
      }
    }

    const claim = sections.find((section) => section.key === "contemporaneousClaim");
    expect(claim?.body).toEqual({ kind: "absent", reason: "missing" });
  });

  it("有 artifact 時逐字引用，並帶出 artifact id 與 digest 前 8 碼", () => {
    const sections = journalSections(
      minimalEntry({
        contemporaneousClaim: {
          utteranceArtifactId: "utt-001",
          canonicalTextSha256: DIGEST,
          canonicalTextUtf8: "沒有新資料，我不會為了價格動。",
          truthClass: "simulated_narrative",
        },
      }),
    );

    const claim = sections.find((section) => section.key === "contemporaneousClaim");
    expect(claim?.body).toEqual({
      kind: "quote",
      text: "沒有新資料，我不會為了價格動。",
      utteranceArtifactId: "utt-001",
      canonicalTextSha256: DIGEST,
      digestPrefix: DIGEST.slice(0, DIGEST_PREFIX_LENGTH),
      truthClass: "simulated_narrative",
    });
  });

  it("digest 格式不合的原話不顯示（fail closed，不是排版問題）", () => {
    const sections = journalSections(
      minimalEntry({
        contemporaneousClaim: {
          utteranceArtifactId: "utt-001",
          canonicalTextSha256: "not-a-digest",
          canonicalTextUtf8: "只是小部位。",
          truthClass: "simulated_narrative",
        },
      }),
    );

    expect(sections.find((section) => section.key === "contemporaneousClaim")?.body).toEqual({
      kind: "absent",
      reason: "unverifiable",
    });
  });

  it("recurringPatternRef 缺席時，第八段整段不出現", () => {
    expect(keysOf(minimalEntry())).not.toContain("recurringPattern");
    expect(keysOf(minimalEntry())).toEqual(
      JOURNAL_SECTION_ORDER.map((section) => section.key).filter((key) => key !== "recurringPattern"),
    );

    const recurring = journalSections(
      minimalEntry({
        recurringPatternRef: "pattern-confirmation-bias",
        recurringPatternTruthClass: "simulated_narrative",
      }),
    ).find((section) => section.key === "recurringPattern");
    expect(recurring?.body).toEqual({
      kind: "recurringPattern",
      patternRef: "pattern-confirmation-bias",
      truthClass: "simulated_narrative",
    });
  });

  it("內在動機未被承認時固定回「暫時不知道」，不代寫全知答案", () => {
    const absent = journalSections(minimalEntry()).find(
      (section) => section.key === "currentSelfNarration",
    );
    expect(absent?.body).toEqual({
      kind: "unacknowledgedMotive",
      text: UNACKNOWLEDGED_MOTIVE_LABEL,
    });

    const blank = journalSections(
      minimalEntry({
        currentSelfNarration: { kind: "summary", summaryText: "   ", truthClass: "simulated_narrative" },
      }),
    ).find((section) => section.key === "currentSelfNarration");
    expect(blank?.body).toEqual({
      kind: "unacknowledgedMotive",
      text: UNACKNOWLEDGED_MOTIVE_LABEL,
    });
  });

  it("後果段：紙上數字帶 as_of，壞資料退回資料未到而不是猜一個數字", () => {
    const good = journalSections(
      minimalEntry({
        consequence: {
          paperConsequence: {
            positionArchiveRef: "pos-001",
            heldDays: 15,
            unrealizedPnlMinorUnits: -708_000,
            unrealizedPnlPercentFixed2: -1_180,
            asOf: "2026-03-17",
            truthClass: "simulated_narrative",
          },
          nonPaperConsequenceSummary: "他今天避開了小雨的座位。",
          nonPaperConsequenceSummaryTruthClass: "simulated_narrative",
        },
      }),
    ).find((section) => section.key === "consequence");

    expect(good?.body).toEqual({
      kind: "consequence",
      paper: {
        positionArchiveRef: "pos-001",
        heldDays: 15,
        unrealizedPnlText: "−7,080.00",
        unrealizedPnlPercentText: "−11.80%",
        asOfLabel: "截至前一交易日收盤（2026-03-17）",
        truthClass: "simulated_narrative",
      },
      nonPaperSummary: "他今天避開了小雨的座位。",
      nonPaperTruthClass: "simulated_narrative",
      withheld: false,
    });

    const broken = journalSections(
      minimalEntry({
        consequence: {
          paperConsequence: {
            positionArchiveRef: "pos-001",
            heldDays: 15,
            unrealizedPnlMinorUnits: Number.NaN,
            unrealizedPnlPercentFixed2: Number.NaN,
            asOf: "昨天",
            truthClass: "simulated_narrative",
          },
        },
      }),
    ).find((section) => section.key === "consequence");

    expect(broken?.body).toEqual({
      kind: "consequence",
      paper: {
        positionArchiveRef: "pos-001",
        heldDays: 15,
        unrealizedPnlText: DATA_UNAVAILABLE_LABEL,
        unrealizedPnlPercentText: DATA_UNAVAILABLE_LABEL,
        asOfLabel: DATA_UNAVAILABLE_LABEL,
        truthClass: "simulated_narrative",
      },
      nonPaperSummary: null,
      nonPaperTruthClass: null,
      withheld: false,
    });
  });

  it("後果段：−708,000 minor units 印成 −7,080.00 元，與同屏的 −11.80% 不矛盾", () => {
    // 這一段守的是誠實性，不是排版。
    //
    // 事實來源（發射端，不是猜的）：
    //   tools/character-episode/src/public_api.rs:81
    //     FIXED_RAW_PER_MINOR_UNIT = 10_000，對上 Fixed::SCALE = 1_000_000
    //     ⇒ 1 minor unit ＝ 1/100 元
    //   同檔 :1656 `minor_units(-4_720 * 1_000_000) == -472_000`
    //   同檔 :1526 `format_whole_currency()` 印整數元時先 `minor / 100`
    //
    // fixture：fixtures/v5/one-character-slice/api/v2/characters/{id}/life-journal.json
    //   2026-03-17 章節 unrealizedPnlMinorUnits: -708000、
    //   unrealizedPnlPercentFixed2: -1180；archive.json 的摘要文字寫
    //   「未實現虧損 7,080 元」。
    const UNREALIZED_MINOR_UNITS = -708_000;
    const COST_BASIS_MINOR_UNITS = 6_000_000; // 600 股 × 100.00
    const PERCENT_FIXED2 = -1_180;

    const section = journalSections(
      minimalEntry({
        chapterDate: "2026-03-17",
        consequence: {
          paperConsequence: {
            positionArchiveRef: "a243c129-0297-7b54-e16f-256452eab596",
            heldDays: 15,
            unrealizedPnlMinorUnits: UNREALIZED_MINOR_UNITS,
            unrealizedPnlPercentFixed2: PERCENT_FIXED2,
            asOf: "2026-03-17T13:30:00+08:00",
            truthClass: "simulated_narrative",
          },
        },
      }),
    ).find((entry) => entry.key === "consequence");

    if (section?.body.kind !== "consequence" || section.body.paper === null) {
      throw new Error("後果段必須帶出紙上碎片");
    }
    const paper = section.body.paper;

    // 1. 金額不是 100 倍。
    expect(paper.unrealizedPnlText).toBe("−7,080.00");
    expect(paper.unrealizedPnlText).not.toBe("−708,000");

    // 2. 同屏的百分比與金額指向同一件事：−708,000 ÷ 6,000,000 ＝ −11.80%。
    expect((UNREALIZED_MINOR_UNITS * 10_000) / COST_BASIS_MINOR_UNITS).toBe(PERCENT_FIXED2);
    expect(paper.unrealizedPnlPercentText).toBe("−11.80%");

    // 3. 反推：從畫面上那個金額字串回推的百分比，必須就是畫面上那個百分比。
    const amountInTwd = Number(paper.unrealizedPnlText.replace("−", "-").replace(/,/g, ""));
    expect(amountInTwd).toBe(-7_080);
    expect((amountInTwd / (COST_BASIS_MINOR_UNITS / 100)) * 100).toBeCloseTo(-11.8, 10);
  });
});

describe("人生誌九段：每一段讀它自己的資料身分，缺了就 fail closed", () => {
  // 舊版或被竄改的投影就是會缺欄位；型別上拿掉必填欄位，模擬那樣的輸入。
  function withoutKey(entry: LifeJournalEntry, key: string): LifeJournalEntry {
    const copy: Record<string, unknown> = { ...entry };
    delete copy[key];
    return copy as unknown as LifeJournalEntry;
  }

  it("每一段有內容的都帶投影給的身分，不是介面挑的", () => {
    const sections = journalSections(
      minimalEntry({ sceneSummaryTruthClass: "fictional_setting" }),
      ["fictional_setting", "simulated_narrative"],
    );
    const scene = sections.find((section) => section.key === "sceneSummary");
    // 投影說這一段是虛構設定，畫面就掛虛構設定——不因為它是「故事」就改掛模擬敘事。
    expect(scene?.body).toEqual({
      kind: "summary",
      text: "他在開盤後又打開了同一家公司的資料。",
      truthClass: "fictional_setting",
    });
  });

  it("缺 `<欄位>TruthClass` 的那一段不顯示內容，只標原因；其他段照常", () => {
    const entry = withoutKey(minimalEntry(), "actionSummaryTruthClass");
    const sections = journalSections(entry);
    const action = sections.find((section) => section.key === "action");
    expect(action?.body).toEqual({ kind: "absent", reason: "unlabelled" });
    // 內容本身不能從 view model 漏出去。
    expect(JSON.stringify(action)).not.toContain("紙上部位");

    const scene = sections.find((section) => section.key === "sceneSummary");
    expect(scene?.body.kind).toBe("summary");
  });

  it("身分不是五種之一、或不在投影宣告的 `truthClasses` 裡，一樣不顯示", () => {
    const bogus = journalSections(
      minimalEntry({ openQuestionSummaryTruthClass: "rumour" as unknown as "simulated_narrative" }),
    ).find((section) => section.key === "openQuestion");
    expect(bogus?.body).toEqual({ kind: "absent", reason: "unlabelled" });

    const undeclared = journalSections(minimalEntry(), ["fictional_setting"]).find(
      (section) => section.key === "knownAtTheTime",
    );
    expect(undeclared?.body).toEqual({ kind: "absent", reason: "unlabelled" });
  });

  it("原話缺自己的 `truthClass` 時整句不顯示（逐字引用也不例外）", () => {
    const entry = minimalEntry({
      contemporaneousClaim: {
        utteranceArtifactId: "utt-001",
        canonicalTextSha256: DIGEST,
        canonicalTextUtf8: "只是小部位。",
      } as unknown as NonNullable<LifeJournalEntry["contemporaneousClaim"]>,
    });
    const claim = journalSections(entry).find((section) => section.key === "contemporaneousClaim");
    expect(claim?.body).toEqual({ kind: "absent", reason: "unlabelled" });
  });

  it("後果兩項各自過閘：缺身分的紙上數字不顯示，另一項照常並標出有一項被扣住", () => {
    const entry = minimalEntry({
      consequence: {
        paperConsequence: {
          positionArchiveRef: "pos-001",
          heldDays: 15,
          unrealizedPnlMinorUnits: -708_000,
          unrealizedPnlPercentFixed2: -1_180,
          asOf: "2026-03-17",
        } as unknown as NonNullable<LifeJournalEntry["consequence"]["paperConsequence"]>,
        nonPaperConsequenceSummary: "他今天避開了小雨的座位。",
        nonPaperConsequenceSummaryTruthClass: "simulated_narrative",
      },
    });
    const consequence = journalSections(entry).find((section) => section.key === "consequence");
    expect(consequence?.body).toEqual({
      kind: "consequence",
      paper: null,
      nonPaperSummary: "他今天避開了小雨的座位。",
      nonPaperTruthClass: "simulated_narrative",
      withheld: true,
    });
  });
});
