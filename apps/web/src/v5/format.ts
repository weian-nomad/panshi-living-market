// V5 定點數與資料身分的呈現層格式化工具。
//
// 規則（`docs/v5/product-constitution.md`、`contracts/openapi/public-v2.yaml`）：
//
// 1. 金額、數量與百分比一律是整數定點數，**永遠不做 float 運算**。public-v2 的
//    `*MinorUnits`、`*Fixed6`、`*PercentFixed2` 全是 integer；本檔只在整數與
//    BigInt 上運算，Number 的浮點路徑只留給 UI 佈局，不碰錢與百分比。
// 2. 負號使用 U+2212 MINUS SIGN，不用 ASCII hyphen。tabular-nums 下 U+2212 的
//    字寬與數字對齊，`.panshi-data` 網格才不會抖（tokens.css）。
// 3. 缺漏或格式不合的輸入一律 fail closed：丟出 RangeError，由呼叫端顯示
//    `DATA_UNAVAILABLE_LABEL`。任何情況都不得補一個看起來合理的值。
//
// 本檔是純函式，不讀 DOM、不讀時鐘、不打 API。

import type { RecentConsequenceHighlight, TruthClass } from "../api/generated-v2/types.gen";

/** U+2212 MINUS SIGN。 */
export const MINUS_SIGN = "−";

/** 事實缺漏、過期或未封存時的對外文字（fail closed，不得改成猜測值）。 */
export const DATA_UNAVAILABLE_LABEL = "資料未到";

/**
 * public-v2 `*Fixed6` 欄位的隱含小數位（scaled by 1,000,000）。
 */
const FIXED6_DECIMALS = 6;

/**
 * 台幣 minor unit 的小數位＝2，也就是 **1 minor unit ＝ 1/100 元**（ISO 4217 TWD
 * exponent 2）。這不是選擇，是發射端的既成語意，前端只能對齊：
 *
 * - `tools/character-episode/src/public_api.rs:81` `FIXED_RAW_PER_MINOR_UNIT = 10_000`
 *   對上 `crates/decision-kernel/src/fixed.rs` 的 `Fixed::SCALE = 1_000_000`
 *   （六位小數的「元」），10_000 / 1_000_000 ＝ 0.01 元。
 * - 同檔 `minor_units()`（:1486）與其單元測試（:1656）：
 *   `minor_units(-4_720 * 1_000_000) == -472_000`，即 −4,720 元 ＝ −472,000 minor units。
 * - 同檔 `format_whole_currency()`（:1526）印整數元時先 `minor / 100`。
 * - `crates/paper-ledger/src/account.rs:56` `PaperAccountPolicy::V1` 起始本金
 *   NT$1,000,000，對上 fixture 的 `initialCapitalMinorUnits: 100_000_000`。
 *
 * 曾經寫成 0 位小數，會把 fixture 的 `unrealizedPnlMinorUnits: -708000`
 * 印成「−708,000」，而旁邊的 `unrealizedPnlPercentFixed2: -1180` 仍是 −11.80%
 * ——同一畫面自相矛盾，且對外金額失真 100 倍。
 */
export const TWD_MINOR_UNIT_DECIMALS = 2;

/** 盤中資料截至時間的固定用語（`docs/v5/visual-system.md`、experience-spec §7.2）。 */
export const AS_OF_INTRADAY_PREFIX = "截至前一交易日收盤";

const TRUTH_CLASS_LABELS: Record<TruthClass, string> = {
  real_fact: "真實資料",
  statistical_sample: "統計取樣",
  fictional_setting: "虛構設定",
  symbolic_interpretation: "象徵解讀",
  simulated_narrative: "模擬敘事",
};

const TRUTH_CLASS_GLYPH_IDS: Record<TruthClass, string> = {
  real_fact: "panshi-truth-glyph-real-fact",
  statistical_sample: "panshi-truth-glyph-statistical-sample",
  fictional_setting: "panshi-truth-glyph-fictional-setting",
  symbolic_interpretation: "panshi-truth-glyph-symbolic-interpretation",
  simulated_narrative: "panshi-truth-glyph-simulated-narrative",
};

function toIntegerBigInt(value: number | bigint, field: string): bigint {
  if (typeof value === "bigint") return value;
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${field} must be a safe integer fixed-point value, received ${value}`);
  }
  return BigInt(value);
}

function assertSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`${field} must be a safe integer, received ${value}`);
  }
}

/**
 * 千分位分組。輸入必須已經是純數字字串（無正負號、無小數點）。
 *
 * 全站唯一一份分組實作：金額、百分比與股數共用它，避免同一種數字在不同畫面
 * 長得不一樣。
 */
export function groupThousandDigits(digits: string): string {
  let grouped = "";
  for (let index = 0; index < digits.length; index += 1) {
    const remaining = digits.length - index;
    grouped += digits[index];
    if (remaining > 1 && remaining % 3 === 1) grouped += ",";
  }
  return grouped;
}

/**
 * 把 scaled-by-1,000,000 的整數定點數印成固定小數位字串。
 *
 * 小於 6 位時以「遠離零的四捨五入」收斂（整數運算，無 float）；大於 6 位時補零。
 * 不加千分位——價格欄位（`100.00`、`88.20`）不分組；要分組的金額走
 * `minorUnitsToTwd()`。
 */
export function fixed6ToDecimalString(v: number | bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new RangeError(`decimals must be an integer in [0, 18], received ${decimals}`);
  }

  const raw = toIntegerBigInt(v, "fixed6 value");
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;

  let scaled: bigint;
  if (decimals >= FIXED6_DECIMALS) {
    scaled = abs * 10n ** BigInt(decimals - FIXED6_DECIMALS);
  } else {
    const divisor = 10n ** BigInt(FIXED6_DECIMALS - decimals);
    const quotient = abs / divisor;
    const remainder = abs % divisor;
    scaled = remainder * 2n >= divisor ? quotient + 1n : quotient;
  }

  const unit = 10n ** BigInt(decimals);
  const whole = (scaled / unit).toString();
  const text =
    decimals === 0 ? whole : `${whole}.${(scaled % unit).toString().padStart(decimals, "0")}`;

  // 捨入後剛好是零時不印 −0.00。
  return negative && scaled !== 0n ? `${MINUS_SIGN}${text}` : text;
}

/**
 * 把台幣 minor units 印成含千分位的金額字串（不含 `NT$` 前綴，由呼叫端決定）。
 */
export function minorUnitsToTwd(v: number): string {
  assertSafeInteger(v, "minor units");

  const negative = v < 0;
  const abs = negative ? -v : v;
  const digits = abs.toString().padStart(TWD_MINOR_UNIT_DECIMALS + 1, "0");
  const cut = digits.length - TWD_MINOR_UNIT_DECIMALS;
  const whole = groupThousandDigits(digits.slice(0, cut));
  const text = TWD_MINOR_UNIT_DECIMALS > 0 ? `${whole}.${digits.slice(cut)}` : whole;

  return negative && abs !== 0 ? `${MINUS_SIGN}${text}` : text;
}

/**
 * `minorUnitsToTwd()` 的 nullable 版本：輸入不是安全整數（缺值、NaN、小數）時回
 * `null`，由呼叫端顯示 `DATA_UNAVAILABLE_LABEL`。
 *
 * 這是同一份換算的唯一另一個入口，**不是另一套實作**——它只是把 fail closed 的
 * 表達方式從 throw 換成 null，讓 mapper 不必包 try/catch。金額換算邏輯全站只在
 * `minorUnitsToTwd()` 裡出現一次。
 */
export function minorUnitsToTwdOrNull(v: number | null | undefined): string | null {
  if (typeof v !== "number" || !Number.isSafeInteger(v)) return null;
  return minorUnitsToTwd(v);
}

/**
 * 把 `*PercentFixed2`（百分比乘以 100 的整數）印成百分比字串。
 *
 * public-v2.yaml: 「Signed percentage scaled by 100 (2 implied decimal places);
 * e.g. -840 represents -8.40%.」
 */
export function percentFixed2ToString(v: number): string {
  assertSafeInteger(v, "percent (fixed2)");

  const negative = v < 0;
  const abs = negative ? -v : v;
  const fraction = abs % 100;
  const whole = (abs - fraction) / 100; // 整數除法，無 float 誤差
  const text = `${groupThousandDigits(whole.toString())}.${fraction.toString().padStart(2, "0")}%`;

  return negative && abs !== 0 ? `${MINUS_SIGN}${text}` : text;
}

/**
 * 盤中資料截至時間。輸入是 public-v2 的 `asOf`（盤中即前一交易日收盤時間），
 * 只取它的日期，不做時區換算、不推算「前一天」——推算等於捏值。
 */
export function formatAsOfIntraday(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(iso.trim());
  if (!match) {
    throw new RangeError(`asOf must be an ISO-8601 date or date-time, received ${iso}`);
  }

  const [, year = "", month = "", day = ""] = match;
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  if (monthNumber < 1 || monthNumber > 12 || dayNumber < 1 || dayNumber > 31) {
    throw new RangeError(`asOf carries an impossible calendar date: ${iso}`);
  }

  return `${AS_OF_INTRADAY_PREFIX}（${year}-${month}-${day}）`;
}

/** `truth_class` 的產品用語（`docs/v5/product-constitution.md`「角色資料的五種身分」）。 */
export function truthClassLabel(tc: TruthClass): string {
  return TRUTH_CLASS_LABELS[tc];
}

/**
 * `truth_class` 的圖形標記 id。五種身分五個互異幾何圖形，因為
 * visual-system.md 規定「不能只靠顏色、位置、聲音或動態表達狀態」。
 */
export function truthClassGlyphId(tc: TruthClass): string {
  return TRUTH_CLASS_GLYPH_IDS[tc];
}

/**
 * 對外可見宣稱的種類 → 它**應該**掛哪一個 `truth_class`。
 *
 * 這張表是 `docs/v5/product-constitution.md`「角色資料的五種身分」的唯一前端副本：
 * 紙上部位、紙上損益與故事投影＝`simulated_narrative`；姓名、職業、關係、記憶與
 * 人生事件＝`fictional_setting`；命盤的文化詮釋＝`symbolic_interpretation`。
 * `ArchiveIndexScreen.tsx` 的 `SECTION_TRUTH_CLASS` 逐格對得上這張表。
 *
 * 注意 `paper_figure`：紙上數字**不是** `fictional_setting`。把它掛成虛構設定，
 * 等於對外宣稱一份由已封存事件 fold 出來的模擬帳本只是設定文案。
 */
const CLAIM_TRUTH_CLASS = {
  /** 姓名、年齡、職業、姿態、未解矛盾。 */
  character_scene: "fictional_setting",
  /** 紙上部位、損益、成交紀錄與由它們編成的敘事。 */
  paper_figure: "simulated_narrative",
  relationship: "fictional_setting",
  occupation: "fictional_setting",
  memory: "fictional_setting",
  natal_chart: "symbolic_interpretation",
} as const satisfies Record<string, TruthClass>;

export type VisibleClaimKind = keyof typeof CLAIM_TRUTH_CLASS;

/** 一種對外可見宣稱應有的資料身分（身分歸屬，不代表已經可以掛）。 */
export function claimTruthClass(kind: VisibleClaimKind): TruthClass {
  return CLAIM_TRUTH_CLASS[kind];
}

/**
 * 近景／世界的「後果碎片」該掛哪一種身分。
 *
 * 碎片缺席時畫面講的仍然是紙上持倉（「他目前沒有模擬持倉」），所以一樣是
 * `simulated_narrative`，不會因為沒有數字就降級成設定文案。
 */
export function consequenceHighlightTruthClass(
  kind: RecentConsequenceHighlight["kind"] | undefined,
): TruthClass {
  switch (kind) {
    case undefined:
    case "paper_position":
      return claimTruthClass("paper_figure");
    case "relationship":
      return claimTruthClass("relationship");
    case "occupation":
      return claimTruthClass("occupation");
    case "memory":
      return claimTruthClass("memory");
  }
}

/**
 * 資料身分的 fail-closed 閘門：只有投影**自己宣告過**的身分才掛得上標籤。
 *
 * `wanted` 不在 `declared` 裡時回 `null`，呼叫端必須**不掛標籤**，不得改掛一個
 * 比較好講的身分，也不得猜。AGENTS.md「Product invariants」：每一項對外可見的
 * 宣稱剛好帶一個 `truth_class`；投影沒宣告就是事實缺漏，不是排版問題。
 */
export function declaredTruthClass(
  declared: readonly TruthClass[],
  wanted: TruthClass,
): TruthClass | null {
  return declared.includes(wanted) ? wanted : null;
}

/** 供列舉用的完整 `truth_class` 清單（順序同 product-constitution.md 的表）。 */
export const TRUTH_CLASSES: readonly TruthClass[] = [
  "real_fact",
  "statistical_sample",
  "fictional_setting",
  "symbolic_interpretation",
  "simulated_narrative",
];
