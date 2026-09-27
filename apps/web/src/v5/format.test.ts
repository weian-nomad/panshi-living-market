import { describe, expect, it } from "vitest";

import {
  AS_OF_INTRADAY_PREFIX,
  DATA_UNAVAILABLE_LABEL,
  MINUS_SIGN,
  TRUTH_CLASSES,
  TWD_MINOR_UNIT_DECIMALS,
  fixed6ToDecimalString,
  formatAsOfIntraday,
  minorUnitsToTwd,
  minorUnitsToTwdOrNull,
  percentFixed2ToString,
  truthClassGlyphId,
  truthClassLabel,
} from "./format";

describe("fixed6 decimal rendering", () => {
  it("renders sealed prices at the quoted precision", () => {
    // 陸硯之的建倉價 100.00 與 S5 減碼價 88.20（sealedPriceMinorUnitsFixed6）。
    expect(fixed6ToDecimalString(100_000_000, 2)).toBe("100.00");
    expect(fixed6ToDecimalString(88_200_000, 2)).toBe("88.20");
  });

  it("renders quantity fixed6 without a decimal point when asked for none", () => {
    expect(fixed6ToDecimalString(1_000_000_000, 0)).toBe("1000");
    expect(fixed6ToDecimalString(400_000_000, 0)).toBe("400");
  });

  it("uses U+2212 for negative values", () => {
    expect(fixed6ToDecimalString(-11_800_000, 2)).toBe(`${MINUS_SIGN}11.80`);
    expect(MINUS_SIGN).toBe("−");
  });

  it("rounds away from zero with integer arithmetic only", () => {
    expect(fixed6ToDecimalString(1_005_000, 2)).toBe("1.01");
    expect(fixed6ToDecimalString(-1_005_000, 2)).toBe(`${MINUS_SIGN}1.01`);
    expect(fixed6ToDecimalString(1_004_999, 2)).toBe("1.00");
  });

  it("never prints a signed zero", () => {
    expect(fixed6ToDecimalString(-1, 2)).toBe("0.00");
  });

  it("accepts bigint fixed-point input and pads beyond six decimals", () => {
    expect(fixed6ToDecimalString(1_000_000n, 8)).toBe("1.00000000");
  });

  it("fails closed on unsafe or malformed input", () => {
    expect(() => fixed6ToDecimalString(1.5, 2)).toThrow(RangeError);
    expect(() => fixed6ToDecimalString(1_000_000, -1)).toThrow(RangeError);
  });
});

describe("TWD minor unit rendering", () => {
  it("treats one minor unit as 1/100 TWD, matching the Rust emitter", () => {
    // `tools/character-episode/src/public_api.rs`：
    //   FIXED_RAW_PER_MINOR_UNIT = 10_000 ÷ Fixed::SCALE = 1_000_000 ＝ 0.01 元，
    //   minor_units(-4_720 * 1_000_000) == -472_000，
    //   format_whole_currency() 印整數元時先除以 100。
    // `crates/paper-ledger/src/account.rs` 的 PaperAccountPolicy::V1 起始本金
    // NT$1,000,000 → fixture 的 initialCapitalMinorUnits: 100_000_000。
    expect(TWD_MINOR_UNIT_DECIMALS).toBe(2);
    expect(minorUnitsToTwd(100_000_000)).toBe("1,000,000.00");
    expect(minorUnitsToTwd(100)).toBe("1.00");
    expect(minorUnitsToTwd(0)).toBe("0.00");
  });

  it("groups thousands", () => {
    expect(minorUnitsToTwd(600_000_000)).toBe("6,000,000.00");
    expect(minorUnitsToTwd(10_000_000)).toBe("100,000.00");
    expect(minorUnitsToTwd(99_999)).toBe("999.99");
  });

  it("renders the slice's sealed losses at the right magnitude, not 100x", () => {
    // fixture `.../archive/paper.json`：realizedPnlMinorUnits -472000、
    // unrealizedPnlMinorUnits -708000；`archive.json` 的摘要文字寫
    // 「實現虧損 4,720 元」「未實現虧損 7,080 元」。
    expect(minorUnitsToTwd(-472_000)).toBe(`${MINUS_SIGN}4,720.00`);
    expect(minorUnitsToTwd(-708_000)).toBe(`${MINUS_SIGN}7,080.00`);
    // 成本 60,000.00、現值 52,920.00（＝成本＋未實現）。
    expect(minorUnitsToTwd(6_000_000)).toBe("60,000.00");
    expect(minorUnitsToTwd(6_000_000 - 708_000)).toBe("52,920.00");
  });

  it("keeps the unrealised amount and its percentage arithmetically consistent", () => {
    // 同一畫面同時印出的兩個數字必須指向同一件事：
    //   −708,000 minor units ÷ 6,000,000 minor units 成本 ＝ −11.80%。
    const unrealizedMinorUnits = -708_000;
    const costBasisMinorUnits = 6_000_000;
    const percentFixed2 = (unrealizedMinorUnits * 10_000) / costBasisMinorUnits;

    expect(percentFixed2).toBe(-1_180);
    expect(minorUnitsToTwd(unrealizedMinorUnits)).toBe(`${MINUS_SIGN}7,080.00`);
    expect(percentFixed2ToString(percentFixed2)).toBe(`${MINUS_SIGN}11.80%`);
    // 舊的 0 位小數常數會印成 −708,000，與 −11.80% 自相矛盾。
    expect(minorUnitsToTwd(unrealizedMinorUnits)).not.toBe(`${MINUS_SIGN}708,000`);
  });

  it("fails closed on non-integer amounts", () => {
    expect(() => minorUnitsToTwd(4720.5)).toThrow(RangeError);
  });

  it("returns null instead of throwing in the nullable variant", () => {
    expect(minorUnitsToTwdOrNull(-708_000)).toBe(`${MINUS_SIGN}7,080.00`);
    expect(minorUnitsToTwdOrNull(null)).toBeNull();
    expect(minorUnitsToTwdOrNull(undefined)).toBeNull();
    expect(minorUnitsToTwdOrNull(Number.NaN)).toBeNull();
    expect(minorUnitsToTwdOrNull(1.5)).toBeNull();
  });
});

describe("percent fixed2 rendering", () => {
  it("renders the public-v2 worked example", () => {
    expect(percentFixed2ToString(-840)).toBe("−8.40%");
  });

  it("renders the slice's unrealised P&L percentage", () => {
    expect(percentFixed2ToString(-1180)).toBe(`${MINUS_SIGN}11.80%`);
  });

  it("keeps two implied decimals and gives gains no extra weight", () => {
    expect(percentFixed2ToString(0)).toBe("0.00%");
    expect(percentFixed2ToString(5)).toBe("0.05%");
    expect(percentFixed2ToString(1180)).toBe("11.80%");
    expect(percentFixed2ToString(123_456)).toBe("1,234.56%");
  });

  it("fails closed on non-integer percentages", () => {
    expect(() => percentFixed2ToString(-8.4)).toThrow(RangeError);
  });
});

describe("as_of fence copy", () => {
  it("renders the fixed intraday wording with the sealed date", () => {
    const rendered = formatAsOfIntraday("2026-03-17T13:30:00+08:00");
    expect(rendered).toContain("截至前一交易日收盤");
    expect(rendered).toBe("截至前一交易日收盤（2026-03-17）");
    expect(rendered).toContain(AS_OF_INTRADAY_PREFIX);
  });

  it("accepts a bare ISO date", () => {
    expect(formatAsOfIntraday("2026-03-17")).toBe("截至前一交易日收盤（2026-03-17）");
  });

  it("does not shift the date across time zones", () => {
    expect(formatAsOfIntraday("2026-03-17T23:59:59Z")).toBe("截至前一交易日收盤（2026-03-17）");
  });

  it("fails closed instead of inventing a date", () => {
    expect(() => formatAsOfIntraday("")).toThrow(RangeError);
    expect(() => formatAsOfIntraday("昨天")).toThrow(RangeError);
    expect(() => formatAsOfIntraday("2026-13-01")).toThrow(RangeError);
    expect(DATA_UNAVAILABLE_LABEL).toBe("資料未到");
  });
});

describe("truth_class presentation", () => {
  it("labels every truth class with the constitution wording", () => {
    expect(truthClassLabel("real_fact")).toBe("真實資料");
    expect(truthClassLabel("statistical_sample")).toBe("統計取樣");
    expect(truthClassLabel("fictional_setting")).toBe("虛構設定");
    expect(truthClassLabel("symbolic_interpretation")).toBe("象徵解讀");
    expect(truthClassLabel("simulated_narrative")).toBe("模擬敘事");
  });

  it("keeps all five labels distinct", () => {
    const labels = TRUTH_CLASSES.map(truthClassLabel);
    expect(labels).toHaveLength(5);
    expect(new Set(labels).size).toBe(5);
  });

  it("keeps all five glyph ids distinct", () => {
    const glyphIds = TRUTH_CLASSES.map(truthClassGlyphId);
    expect(glyphIds).toHaveLength(5);
    expect(new Set(glyphIds).size).toBe(5);
    for (const glyphId of glyphIds) {
      expect(glyphId).toMatch(/^panshi-truth-glyph-[a-z-]+$/);
    }
  });
});
