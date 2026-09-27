// 人生誌九段的純 mapper：`LifeJournalEntry` → 固定順序的 view model。
//
// 順序與段名逐字取自 `docs/v5/experience-spec.md` §8.1，不得重排、不得增段。
//
// 三條硬規則：
// 1. **原話只能逐字引用**。有 `UtteranceArtifactV1` 才產生 `quote`，並一併帶出
//    artifact id 與 `canonical_text_sha256` 前 8 碼供核對；沒有 artifact 就是
//    系統摘要（`summary`），**一律不加引號**（experience-spec §8.2、
//    character-story-engine.md「完整例子」開頭的警告）。
// 2. **缺欄位 fail closed**：缺、空字串、或 digest 格式不合，回傳該段 `absent`，
//    不補值也不改用相鄰欄位頂替。
// 3. `老毛病又回來了` 只有 `recurringPatternRef` 存在時才出現（同類模式至少兩次）；
//    `現在怎麼說` 缺席代表角色還沒承認內在動機，介面固定寫「暫時不知道」，
//    不顯示第三人稱全知答案。
// 4. **每一段帶它自己的資料身分**（public-v2.yaml 2.1.0：`<欄位>TruthClass`、原話與
//    自述的 `truthClass`、紙上後果的 `truthClass`）。身分只從投影讀；有內容但缺身分、
//    或身分不在投影 `truthClasses` 裡，那一段回 `absent`／`unlabelled`：不顯示內容，
//    畫面寫出原因。本檔不替任何一段決定身分。
//
// 本檔是純函式：不碰 DOM、不打 API、不讀時鐘。

import type {
  CharacterUtterance,
  LifeJournalEntry,
  PaperConsequenceFragment,
  TruthClass,
} from "../api/generated-v2/types.gen";
import { claimTruthClassOf } from "./claimTruth";
import {
  DATA_UNAVAILABLE_LABEL,
  formatAsOfIntraday,
  minorUnitsToTwd,
  percentFixed2ToString,
} from "./format";

export type JournalSectionKey =
  | "sceneSummary"
  | "contemporaneousClaim"
  | "knownAtTheTime"
  | "missedFacts"
  | "action"
  | "consequence"
  | "currentSelfNarration"
  | "recurringPattern"
  | "openQuestion";

/** experience-spec §8.1 的固定順序與固定段名。 */
export const JOURNAL_SECTION_ORDER: readonly { key: JournalSectionKey; title: string }[] = [
  { key: "sceneSummary", title: "今天他怎麼了" },
  { key: "contemporaneousClaim", title: "他當時怎麼說" },
  { key: "knownAtTheTime", title: "他其實知道什麼" },
  { key: "missedFacts", title: "他漏掉了什麼" },
  { key: "action", title: "他做了什麼" },
  { key: "consequence", title: "這個決定留下什麼" },
  { key: "currentSelfNarration", title: "現在怎麼說" },
  { key: "recurringPattern", title: "老毛病又回來了" },
  { key: "openQuestion", title: "還沒完" },
];

/** 內在動機尚未被角色承認時的固定用語（experience-spec §8.1 結尾）。 */
export const UNACKNOWLEDGED_MOTIVE_LABEL = "暫時不知道";

export type JournalAbsentReason =
  /** 投影根本沒有這個欄位：那一天就是沒有這件事。 */
  | "missing"
  /** 有欄位但無法核對（digest 格式不合）：寧可不顯示，也不顯示無法追溯的原話。 */
  | "unverifiable"
  /** 有內容但投影沒有替它標出資料身分：不顯示，並寫出原因。 */
  | "unlabelled";

export type JournalPaperConsequenceView = {
  positionArchiveRef: string;
  heldDays: number;
  /** 已含千分位與 U+2212 負號；無法格式化時是 `DATA_UNAVAILABLE_LABEL`。 */
  unrealizedPnlText: string;
  unrealizedPnlPercentText: string;
  /** 「截至前一交易日收盤（YYYY-MM-DD）」。 */
  asOfLabel: string;
  /** 這組紙上數字自己的資料身分。 */
  truthClass: TruthClass;
};

export type JournalSectionBody =
  | { kind: "absent"; reason: JournalAbsentReason }
  /** 系統摘要：結構化敘述，永遠不加引號。 */
  | { kind: "summary"; text: string; truthClass: TruthClass }
  /** 逐字原話：一定帶 artifact id 與 digest 前 8 碼。 */
  | {
      kind: "quote";
      text: string;
      utteranceArtifactId: string;
      canonicalTextSha256: string;
      digestPrefix: string;
      truthClass: TruthClass;
    }
  | {
      kind: "consequence";
      paper: JournalPaperConsequenceView | null;
      nonPaperSummary: string | null;
      nonPaperTruthClass: TruthClass | null;
      /** 有一項後果因為缺資料身分而不顯示（其餘照常顯示）。 */
      withheld: boolean;
    }
  | { kind: "unacknowledgedMotive"; text: typeof UNACKNOWLEDGED_MOTIVE_LABEL }
  | { kind: "recurringPattern"; patternRef: string; truthClass: TruthClass };

export type JournalSectionView = {
  key: JournalSectionKey;
  title: string;
  body: JournalSectionBody;
};

/** digest 前 8 碼供人眼核對（experience-spec §9.10 的資料身分標籤同源）。 */
export const DIGEST_PREFIX_LENGTH = 8;

const SHA256_HEX = /^[0-9a-f]{64}$/;

function textOrNull(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

type Declared = readonly TruthClass[] | undefined;

const UNLABELLED: JournalSectionBody = { kind: "absent", reason: "unlabelled" };

function summaryOrAbsent(value: string | undefined, truthClass: unknown, declared: Declared): JournalSectionBody {
  const text = textOrNull(value);
  if (text === null) return { kind: "absent", reason: "missing" };
  const labelled = claimTruthClassOf(truthClass, declared);
  return labelled === null ? UNLABELLED : { kind: "summary", text, truthClass: labelled };
}

function quoteBody(
  utterance: CharacterUtterance | undefined,
  truthClass: unknown,
  declared: Declared,
): JournalSectionBody {
  if (!utterance) return { kind: "absent", reason: "missing" };

  const text = textOrNull(utterance.canonicalTextUtf8);
  if (text === null) return { kind: "absent", reason: "missing" };

  const digest = utterance.canonicalTextSha256;
  if (typeof digest !== "string" || !SHA256_HEX.test(digest)) {
    // 無法核對的「原話」不顯示：這是 fail closed，不是排版問題。
    return { kind: "absent", reason: "unverifiable" };
  }

  const labelled = claimTruthClassOf(truthClass, declared);
  if (labelled === null) return UNLABELLED;

  return {
    kind: "quote",
    truthClass: labelled,
    // 逐字：artifact 的 canonical bytes 原封不動，不 trim、不改寫、不截斷、不補標點
    //（`Utterance.tsx` 會把這串文字放進元素並附 digest，任何人都能重算核對）。
    text: utterance.canonicalTextUtf8,
    utteranceArtifactId: utterance.utteranceArtifactId,
    canonicalTextSha256: digest,
    digestPrefix: digest.slice(0, DIGEST_PREFIX_LENGTH),
  };
}

function formatOrUnavailable(render: () => string): string {
  try {
    return render();
  } catch {
    return DATA_UNAVAILABLE_LABEL;
  }
}

function paperConsequenceView(
  fragment: PaperConsequenceFragment,
  truthClass: TruthClass,
): JournalPaperConsequenceView {
  return {
    truthClass,
    positionArchiveRef: fragment.positionArchiveRef,
    heldDays: fragment.heldDays,
    unrealizedPnlText: formatOrUnavailable(() => minorUnitsToTwd(fragment.unrealizedPnlMinorUnits)),
    unrealizedPnlPercentText: formatOrUnavailable(() =>
      percentFixed2ToString(fragment.unrealizedPnlPercentFixed2),
    ),
    asOfLabel: formatOrUnavailable(() => formatAsOfIntraday(fragment.asOf)),
  };
}

function consequenceBody(entry: LifeJournalEntry, declared: Declared): JournalSectionBody {
  const consequence = entry.consequence;
  const fragment = consequence?.paperConsequence;
  const nonPaperText = textOrNull(consequence?.nonPaperConsequenceSummary);
  if (!fragment && nonPaperText === null) return { kind: "absent", reason: "missing" };

  // 兩項後果各自過身分閘門：缺身分的那一項不顯示，另一項照常顯示。
  const paperClass = fragment ? claimTruthClassOf(fragment.truthClass, declared) : null;
  const paper = fragment && paperClass !== null ? paperConsequenceView(fragment, paperClass) : null;
  const nonPaperClass =
    nonPaperText === null ? null : claimTruthClassOf(consequence?.nonPaperConsequenceSummaryTruthClass, declared);
  const nonPaperSummary = nonPaperClass === null ? null : nonPaperText;
  const withheld = (fragment !== undefined && paper === null) || (nonPaperText !== null && nonPaperSummary === null);

  if (paper === null && nonPaperSummary === null) return UNLABELLED;
  return { kind: "consequence", paper, nonPaperSummary, nonPaperTruthClass: nonPaperClass, withheld };
}

function currentSelfNarrationBody(entry: LifeJournalEntry, declared: Declared): JournalSectionBody {
  const narration = entry.currentSelfNarration;
  if (!narration) {
    // 還沒承認的動機不由系統代答。
    return { kind: "unacknowledgedMotive", text: UNACKNOWLEDGED_MOTIVE_LABEL };
  }
  if (narration.kind === "utterance") {
    return quoteBody(
      {
        utteranceArtifactId: narration.utteranceArtifactId,
        canonicalTextSha256: narration.canonicalTextSha256,
        canonicalTextUtf8: narration.canonicalTextUtf8,
      },
      narration.truthClass,
      declared,
    );
  }
  const text = textOrNull(narration.summaryText);
  if (text === null) return { kind: "unacknowledgedMotive", text: UNACKNOWLEDGED_MOTIVE_LABEL };
  const labelled = claimTruthClassOf(narration.truthClass, declared);
  return labelled === null ? UNLABELLED : { kind: "summary", text, truthClass: labelled };
}

function bodyFor(key: JournalSectionKey, entry: LifeJournalEntry, declared: Declared): JournalSectionBody | null {
  switch (key) {
    case "sceneSummary":
      return summaryOrAbsent(entry.sceneSummary, entry.sceneSummaryTruthClass, declared);
    case "contemporaneousClaim":
      return quoteBody(entry.contemporaneousClaim, entry.contemporaneousClaim?.truthClass, declared);
    case "knownAtTheTime":
      return summaryOrAbsent(entry.knownAtTheTimeSummary, entry.knownAtTheTimeSummaryTruthClass, declared);
    case "missedFacts":
      return summaryOrAbsent(entry.missedFactsSummary, entry.missedFactsSummaryTruthClass, declared);
    case "action":
      return summaryOrAbsent(entry.actionSummary, entry.actionSummaryTruthClass, declared);
    case "consequence":
      return consequenceBody(entry, declared);
    case "currentSelfNarration":
      return currentSelfNarrationBody(entry, declared);
    case "recurringPattern": {
      // 只有同類模式至少發生兩次（＝投影給了 ref）才出現這一段；否則整段不存在。
      const ref = textOrNull(entry.recurringPatternRef);
      if (ref === null) return null;
      const labelled = claimTruthClassOf(entry.recurringPatternTruthClass, declared);
      return labelled === null ? UNLABELLED : { kind: "recurringPattern", patternRef: ref, truthClass: labelled };
    }
    case "openQuestion":
      return summaryOrAbsent(entry.openQuestionSummary, entry.openQuestionSummaryTruthClass, declared);
  }
}

/**
 * 一日章節 → 九段 view model。
 *
 * 回傳順序永遠是 `JOURNAL_SECTION_ORDER`；唯一可能整段消失的是
 * `老毛病又回來了`。其餘段落即使沒有資料也會回傳 `absent`，讓畫面顯示
 * 「這一天沒有這件事」而不是安靜地少一塊。
 */
export function journalSections(
  entry: LifeJournalEntry,
  /** 投影 envelope 的 `truthClasses`；有給時，每一段的身分必須在裡面。 */
  declared?: readonly TruthClass[],
): JournalSectionView[] {
  const sections: JournalSectionView[] = [];
  for (const { key, title } of JOURNAL_SECTION_ORDER) {
    const body = bodyFor(key, entry, declared);
    if (body === null) continue;
    sections.push({ key, title, body });
  }
  return sections;
}
