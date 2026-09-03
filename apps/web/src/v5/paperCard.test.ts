import { describe, expect, it } from "vitest";

import type {
  PaperActionFillRecord,
  PaperArchiveProjection,
  PaperPositionPublic,
} from "../api/generated-v2/types.gen";
import {
  DATA_UNAVAILABLE_LABEL,
  MINUS_SIGN,
  minorUnitsToTwd,
  minorUnitsToTwdOrNull,
} from "./format";
import {
  PAPER_CARD_SECTION_ORDER,
  PENDING_SESSION_STATUS_TEXT,
  heldDays,
  minorUnitsToTwdText,
  newlySupportedFactCount,
  paperActionRows,
  paperCardSections,
  paperDisclosureMode,
  type PaperCardSectionKey,
} from "./paperCard";

const DIGEST_U1 = "63788173170b52c6b78a36df6b4dc0d324e7dc13f71a48055dc9175b6a4046c2";
const DIGEST_U2 = "97d3e7281cce7aae83e0397c20ceac0f3ee61c84cacc4fb24295d508d6349976";
const PRICE_DIGEST = "8ce7af7a463e83b9557ff47221f2b117986269cfd8cffa3216cdd0373b93e4a5";
const POSITION_ID = "a243c129-0297-7b54-e16f-256452eab596";

/** 切片的實際部位：1,000 股 @100.00，S5 減碼 400 股 @88.20，剩 600 股。 */
function position(overrides: Partial<PaperPositionPublic> = {}): PaperPositionPublic {
  return {
    positionId: POSITION_ID,
    instrumentLabel: "PSZS-DEMO",
    status: "open",
    openedAt: "2026-03-03T13:30:00+08:00",
    lastChangedAt: "2026-03-17T13:30:00+08:00",
    closedAt: null,
    lots: [
      {
        lotId: "2c0f86ae-898a-be81-12f7-d5c706175959",
        quantityFixed6: 600_000_000,
        sealedPriceMinorUnitsFixed6: 10_000_000_000,
        costBasisMinorUnits: 6_000_000,
        sealedPriceRevisionRef: PRICE_DIGEST,
      },
    ],
    realizedPnlMinorUnits: -472_000,
    unrealizedPnlMinorUnits: -708_000,
    unrealizedPnlPercentFixed2: -1_180,
    markAsOf: "2026-03-17T13:30:00+08:00",
    invalidationCondition: "occurred",
    rationaleSummary:
      "建倉時封存的理由（thesis-hist-001）：預期兩個交易日內動能延續。失效條件是兩個交易日內沒有新證據。",
    concurrentClaim: {
      utteranceArtifactId: "412501f5-f4fc-36fd-a17b-eefa9b711baa",
      canonicalTextSha256: DIGEST_U1,
      canonicalTextUtf8: "看到新的公開資訊，先小部位觀察。",
    },
    currentNarration: {
      kind: "utterance",
      utteranceArtifactId: "6e647275-9839-89f0-457d-2942728c9ac2",
      canonicalTextSha256: DIGEST_U2,
      canonicalTextUtf8: "目前沒有新的公開資訊，先維持原本的觀察。",
    },
    influencedByCharacterRefs: [],
    consequenceSummary:
      "持有 15 天後減碼 400 股，實現虧損 4,720 元；剩下 600 股仍在。引用的理由換過一次，新增支持事實 0 筆。",
    ...overrides,
  };
}

const ACCEPTED_SELL: PaperActionFillRecord = {
  recordId: "3feda030-cb03-03b1-483d-af4e96629d61",
  positionRef: POSITION_ID,
  tradingDate: "2026-03-17",
  marketSessionFinalityState: "accepted",
  recordDataState: "READY",
  dailyActionDisclosure: {
    instrumentLabel: "PSZS-DEMO",
    action: "SELL",
    direction: "downside",
    quantityFixed6: 400_000_000,
    confidencePercentFixed2: 3_400,
    fill: {
      sealedPriceMinorUnitsFixed6: 8_820_000_000,
      sealedPriceRevisionRef: PRICE_DIGEST,
      filledAt: "2026-03-17T13:30:00+08:00",
    },
    rationaleSummary: "他寫下原本的理由已經不成立，並依此減碼。",
  },
};

/** 今天（2026-03-18）盤中：`dailyActionDisclosure` 整個 key 不存在。 */
const PENDING_TODAY: PaperActionFillRecord = {
  recordId: "9baac0fa-47b0-ad6b-e459-89a74993114a",
  positionRef: POSITION_ID,
  tradingDate: "2026-03-18",
  marketSessionFinalityState: "pending",
  recordDataState: "HELD",
};

function projection(
  overrides: Partial<PaperArchiveProjection> = {},
): PaperArchiveProjection {
  return {
    projectionVersion: 97,
    sourceGlobalPosition: 97,
    serverNow: "2026-03-18T10:30:00+08:00",
    dataState: "READY",
    visibilityEpoch: 1,
    truthClasses: ["fictional_setting", "symbolic_interpretation", "simulated_narrative"],
    sourceRevisionSet: [{ refId: "wfm_hist_001_s5", refKind: "world_fact_manifest", revision: 5 }],
    characterId: "96450815-0db8-f735-a139-5ba222da86b2",
    appliedAudienceScope: "subscriber_archive",
    asOf: "2026-03-17T13:30:00+08:00",
    paperVersionSet: {
      paperAccountRef: "345fea46-1f2a-8bcd-c98c-29d944fec75a",
      paperAccountVersion: 3,
      paperOrderRefs: [],
      paperOrderVersions: [],
      paperPositionRefs: [POSITION_ID],
      paperPositionVersions: [6],
      paperVersionSetDigest:
        "8921a848344d4cb9947209f8157ccd013dc7cd1eded7173e67a7908c32de5551",
    },
    account: {
      currency: "TWD",
      cashMinorUnits: 93_524_000,
      reservedCashMinorUnits: 0,
      initialCapitalMinorUnits: 100_000_000,
      correctionRefs: [],
      asOf: "2026-03-17T13:30:00+08:00",
    },
    positions: [position()],
    historicalActionFills: [ACCEPTED_SELL, PENDING_TODAY],
    dataRevisions: [],
    ...overrides,
  };
}

function keysOf(sections: readonly { key: PaperCardSectionKey }[]): PaperCardSectionKey[] {
  return sections.map((section) => section.key);
}

describe("持股主卡七段", () => {
  it("段序與段名逐字照 visual-system.md「持股與績效」，且永遠是七段", () => {
    expect(keysOf(PAPER_CARD_SECTION_ORDER)).toEqual([
      "actorVerb",
      "asOf",
      "holding",
      "pnl",
      "originalRationale",
      "currentClaim",
      "archiveNodes",
    ]);

    expect(keysOf(paperCardSections(projection(), position()))).toEqual(
      PAPER_CARD_SECTION_ORDER.map((entry) => entry.key),
    );
  });

  it("缺欄位不會讓某一段消失，只會換成資料未到", () => {
    const bare = position({
      lots: [],
      realizedPnlMinorUnits: null,
      unrealizedPnlMinorUnits: null,
      unrealizedPnlPercentFixed2: null,
      concurrentClaim: undefined,
      currentNarration: undefined,
      consequenceSummary: "他持有這個部位。",
    });
    const sections = paperCardSections(projection({ positions: [bare] }), bare);

    expect(sections).toHaveLength(7);
    expect(keysOf(sections)).toEqual(PAPER_CARD_SECTION_ORDER.map((entry) => entry.key));
  });
});

describe("as_of fence：pending 交易時段", () => {
  it("最新時段還沒定案時，模式是盤中，人物動詞不帶標的也不是同日動詞", () => {
    const proj = projection();
    expect(paperDisclosureMode(proj)).toBe("intraday_previous_session");

    const verb = paperCardSections(proj, position())[0]?.body;
    expect(verb?.kind).toBe("verb");
    if (verb?.kind !== "verb") throw new Error("unreachable");

    expect(verb.disclosureMode).toBe("intraday_previous_session");
    expect(verb.tickerSpecific).toBe(false);
    expect(verb.text).not.toContain("PSZS-DEMO");
    // 「他終於減碼」「她追進去了」是盤後回顧才有的同日動詞。
    expect(verb.text).not.toBe("他終於減碼。");
    expect(verb.text).not.toBe("他追了進去。");
    expect(verb.text).toContain("前一個交易日");
  });

  it("資料截至時間在盤中固定寫「截至前一交易日收盤」", () => {
    const asOf = paperCardSections(projection(), position())[1]?.body;
    expect(asOf?.kind).toBe("asOf");
    if (asOf?.kind !== "asOf") throw new Error("unreachable");
    expect(asOf.text).toBe("截至前一交易日收盤（2026-03-17）");
  });

  it("所有時段都定案後才允許同日動詞", () => {
    const proj = projection({ historicalActionFills: [ACCEPTED_SELL] });
    expect(paperDisclosureMode(proj)).toBe("post_session");

    const verb = paperCardSections(proj, position())[0]?.body;
    if (verb?.kind !== "verb") throw new Error("unreachable");
    expect(verb.text).toBe("他終於減碼。");
    expect(verb.tickerSpecific).toBe(true);
  });
});

describe("缺 dailyActionDisclosure 的交易紀錄", () => {
  it("整個 key 不存在時只留交易日與狀態說明，不產生任何數字", () => {
    const rows = paperActionRows(projection());
    const today = rows.find((row) => row.tradingDate === "2026-03-18");

    expect(today?.kind).toBe("withheld");
    if (today?.kind !== "withheld") throw new Error("unreachable");
    expect(today.statusText).toBe(PENDING_SESSION_STATUS_TEXT);
    // 狀態說明裡沒有任何數字：沒有數量、沒有價格、沒有信心、也沒有方向。
    expect(/\d/.test(today.statusText)).toBe(false);
    expect(today).not.toHaveProperty("figures");
    expect(today).not.toHaveProperty("instrumentLabel");
  });

  it("已定案的時段才輸出標的、方向、數量與模擬成交價", () => {
    const rows = paperActionRows(projection());
    const sell = rows.find((row) => row.tradingDate === "2026-03-17");

    expect(sell?.kind).toBe("disclosed");
    if (sell?.kind !== "disclosed") throw new Error("unreachable");
    expect(sell.instrumentLabel).toBe("PSZS-DEMO");
    expect(sell.actionLabel).toBe("減碼或結束部位");
    expect(sell.figures.find((figure) => figure.label === "數量")?.text).toBe("400");
    expect(sell.figures.find((figure) => figure.label === "模擬成交價")?.text).toBe("88.20");
  });

  it("紀錄依 canonical 時序由舊到新", () => {
    expect(paperActionRows(projection()).map((row) => row.tradingDate)).toEqual([
      "2026-03-17",
      "2026-03-18",
    ]);
  });
});

describe("損益兩項都必須出現", () => {
  it("已實現與未實現同時在場，虧損完整可見", () => {
    const pnl = paperCardSections(projection(), position())[3]?.body;
    expect(pnl?.kind).toBe("pnl");
    if (pnl?.kind !== "pnl") throw new Error("unreachable");

    expect(pnl.entries.map((entry) => entry.label)).toEqual(["已實現損益", "未實現損益"]);
    expect(pnl.entries[0]?.amountText).toBe(`${MINUS_SIGN}4,720.00`);
    expect(pnl.entries[0]?.directionLabel).toBe("虧損");
    expect(pnl.entries[1]?.amountText).toBe(`${MINUS_SIGN}7,080.00`);
    expect(pnl.entries[1]?.percentText).toBe(`${MINUS_SIGN}11.80%`);
    // 方向同時有文字，不只靠顏色。
    expect(pnl.entries.every((entry) => entry.directionLabel.length > 0)).toBe(true);
  });

  it("缺值時仍然保留兩項，只是寫資料未到", () => {
    const bare = position({ realizedPnlMinorUnits: null, unrealizedPnlMinorUnits: null });
    const pnl = paperCardSections(projection({ positions: [bare] }), bare)[3]?.body;
    if (pnl?.kind !== "pnl") throw new Error("unreachable");

    expect(pnl.entries).toHaveLength(2);
    expect(pnl.entries[0]?.amountText).toBeNull();
    expect(pnl.entries[0]?.directionLabel).toBe(DATA_UNAVAILABLE_LABEL);
    expect(pnl.entries[1]?.amountText).toBeNull();
  });
});

describe("原始理由、失效條件與現在說法", () => {
  it("原始理由不加引號，失效條件標成已發生，同時原話逐字引用", () => {
    const body = paperCardSections(projection(), position())[4]?.body;
    if (body?.kind !== "rationale") throw new Error("unreachable");

    expect(body.summary).toContain("thesis-hist-001");
    expect(body.summary).not.toContain("「");
    expect(body.invalidationLabel).toBe("已發生");
    expect(body.invalidationOccurred).toBe(true);
    expect(body.concurrentClaim?.text).toBe("看到新的公開資訊，先小部位觀察。");
    expect(body.concurrentClaim?.digestPrefix).toBe(DIGEST_U1.slice(0, 8));
  });

  it("現在說法逐字引用，並標明新增支持事實 0 筆", () => {
    const body = paperCardSections(projection(), position())[5]?.body;
    if (body?.kind !== "currentClaim") throw new Error("unreachable");

    expect(body.quote?.text).toBe("目前沒有新的公開資訊，先維持原本的觀察。");
    expect(body.newlySupportedFactsText).toBe("新增支持事實：0 筆");
  });

  it("投影沒寫新增支持事實時 fail closed，不代算", () => {
    const bare = position({ consequenceSummary: "他持有這個部位。" });
    expect(newlySupportedFactCount(bare)).toBeNull();

    const body = paperCardSections(projection({ positions: [bare] }), bare)[5]?.body;
    if (body?.kind !== "currentClaim") throw new Error("unreachable");
    expect(body.newlySupportedFactsText).toBe(`新增支持事實：${DATA_UNAVAILABLE_LABEL}`);
  });

  it("原話無法核對時留白，不補第一人稱台詞", () => {
    const bare = position({
      concurrentClaim: {
        utteranceArtifactId: "412501f5-f4fc-36fd-a17b-eefa9b711baa",
        canonicalTextSha256: "not-a-digest",
        canonicalTextUtf8: "看到新的公開資訊，先小部位觀察。",
      },
    });
    const body = paperCardSections(projection({ positions: [bare] }), bare)[4]?.body;
    if (body?.kind !== "rationale") throw new Error("unreachable");

    expect(body.concurrentClaim).toBeNull();
    expect(body.concurrentClaimAbsenceText).not.toBeNull();
  });
});

describe("持有、成本、現值、曝險與天數", () => {
  it("五格都在，且數字由投影推導而來", () => {
    const body = paperCardSections(projection(), position())[2]?.body;
    if (body?.kind !== "figures") throw new Error("unreachable");

    expect(body.figures.map((figure) => figure.label)).toEqual([
      "持有數量",
      "成本",
      "現值",
      "曝險",
      "持有天數",
    ]);
    expect(body.figures[0]?.text).toBe("600");
    expect(body.figures[1]?.text).toBe("60,000.00");
    // 現值＝成本＋未實現損益＝60,000.00 − 7,080.00。
    expect(body.figures[2]?.text).toBe("52,920.00");
    expect(body.figures[4]?.text).toBe("15");
  });

  it("持有天數把建倉當天算第 1 天；時區不是 +08:00 就 fail closed", () => {
    expect(heldDays("2026-03-03T13:30:00+08:00", "2026-03-17T13:30:00+08:00")).toBe(15);
    expect(heldDays("2026-03-03T13:30:00+08:00", "2026-03-03T13:30:00+08:00")).toBe(1);
    expect(heldDays("2026-03-03T05:30:00Z", "2026-03-17T13:30:00+08:00")).toBeNull();
  });
});

describe("金額格式", () => {
  it("minor unit 帶兩位小數，負號是 U+2212", () => {
    expect(minorUnitsToTwdText(-472_000)).toBe(`${MINUS_SIGN}4,720.00`);
    expect(minorUnitsToTwdText(100_000_000)).toBe("1,000,000.00");
    expect(minorUnitsToTwdText(0)).toBe("0.00");
    expect(minorUnitsToTwdText(null)).toBeNull();
    expect(minorUnitsToTwdText(1.5)).toBeNull();
  });

  it("全站只有一份 minor unit 換算：本檔的名字是 format.ts 的同一個函式", () => {
    // 這裡不是風格檢查，是防漂移：兩份實作總有一天會分岔，
    // 而分岔的代價是對外金額差 100 倍。
    expect(minorUnitsToTwdText).toBe(minorUnitsToTwdOrNull);
    expect(minorUnitsToTwdOrNull(-708_000)).toBe(minorUnitsToTwd(-708_000));
  });
});
