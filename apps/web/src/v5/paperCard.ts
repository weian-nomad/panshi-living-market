// 模擬紀錄「持股主卡」的純 mapper：`PaperArchiveProjection` → 固定七段 view model。
//
// 段序逐字取自 `docs/v5/visual-system.md`「持股與績效」：
//   1 人物動詞／2 資料截至時間／3 持有數量、成本、現值、曝險與天數／
//   4 已實現或未實現損益／5 原始理由與退出條件／6 現在說法／7 關係、記憶與資料節點。
// 不得重排、不得增段、不得因為某一段沒有資料就整段消失（消失會讓虧損看起來不存在）。
//
// 四條硬規則：
//
// 1. **as_of fence**：`marketSessionFinalityState` 還是 `pending` 的交易時段，
//    人物動詞只能描述「前一個交易日已公開」的狀態，不得出現同日 ticker-specific
//    動詞（visual-system.md：「『她追進去了』『他終於減碼』這類同日 ticker-specific
//    動詞只出現在盤後 finality 通過的回顧」）。
// 2. **缺 key 就是缺事實**：`dailyActionDisclosure` 在 finality 通過前整個 key 不存在
//    （public-v2.yaml `PaperActionFillRecord`）。缺 key 的紀錄一律不產生任何數字，
//    也不推測方向或數量。
// 3. **虧損不可隱藏**：已實現與未實現兩項永遠都出現；缺值時顯示「資料未到」，
//    不得整項省略。獲利與虧損的 view model 完全對稱，方向同時帶文字與符號，
//    不靠顏色單獨表意（visual-system.md「獲利與虧損使用同等視覺重量」）。
// 4. **不做浮點運算**：金額、數量、百分比全部走整數／BigInt。
//
// 本檔是純函式：不碰 DOM、不打 API、不讀時鐘。

import type {
  CharacterUtterance,
  InvalidationCondition,
  PaperActionFillRecord,
  PaperArchiveProjection,
  PaperPositionPublic,
} from "../api/generated-v2/types.gen";
import {
  DATA_UNAVAILABLE_LABEL,
  formatAsOfIntraday,
  groupThousandDigits,
  minorUnitsToTwdOrNull,
  percentFixed2ToString,
} from "./format";
import { DIGEST_PREFIX_LENGTH } from "./journalSections";

/** visual-system.md「持股與績效」的七段固定順序與段名。 */
export const PAPER_CARD_SECTION_ORDER: readonly { key: PaperCardSectionKey; title: string }[] = [
  { key: "actorVerb", title: "他現在的樣子" },
  { key: "asOf", title: "資料截至" },
  { key: "holding", title: "持有、成本、現值、曝險與天數" },
  { key: "pnl", title: "已實現與未實現損益" },
  { key: "originalRationale", title: "原始理由與退出條件" },
  { key: "currentClaim", title: "現在說法" },
  { key: "archiveNodes", title: "關係、記憶與資料節點" },
];

export type PaperCardSectionKey =
  | "actorVerb"
  | "asOf"
  | "holding"
  | "pnl"
  | "originalRationale"
  | "currentClaim"
  | "archiveNodes";

/**
 * 這份投影目前落在 as_of fence 的哪一側。
 *
 * - `intraday_previous_session`：最新一個交易時段還沒 finality accepted，
 *   對外只能講前一個交易日收盤時的狀態。
 * - `post_session`：全部交易時段都已 accepted，才允許同日回顧動詞。
 */
export type PaperDisclosureMode = "intraday_previous_session" | "post_session";

/** 一格市場數字：`label` 是欄名，`text` 已格式化完成（含 U+2212 與千分位）。 */
export type PaperFigure = { label: string; text: string };

export type PaperQuoteView = {
  text: string;
  utteranceArtifactId: string;
  canonicalTextSha256: string;
  digestPrefix: string;
};

export type PaperPnlDirection = "negative" | "positive" | "flat" | "unknown";

export type PaperPnlView = {
  label: string;
  /** 已格式化金額；`null` 代表投影沒有給值（fail closed，不補 0）。 */
  amountText: string | null;
  percentText: string | null;
  /** 方向的文字說法，讓顏色不是唯一訊號。 */
  directionLabel: string;
  direction: PaperPnlDirection;
};

export type PaperCardBody =
  | { kind: "verb"; text: string; disclosureMode: PaperDisclosureMode; tickerSpecific: boolean }
  | { kind: "asOf"; text: string; disclosureMode: PaperDisclosureMode }
  | { kind: "figures"; figures: PaperFigure[] }
  | { kind: "pnl"; entries: PaperPnlView[] }
  | {
      kind: "rationale";
      /** 結構化原始理由摘要，**不加引號**。 */
      summary: string;
      invalidationLabel: string;
      invalidationOccurred: boolean;
      /** 當時原話（U1）：有 artifact 才逐字顯示。 */
      concurrentClaim: PaperQuoteView | null;
      concurrentClaimAbsenceText: string | null;
    }
  | {
      kind: "currentClaim";
      /** 現在說法（U2）：逐字引用。 */
      quote: PaperQuoteView | null;
      /** 沒有 artifact 時的結構化摘要，**不加引號**。 */
      summaryText: string | null;
      absenceText: string | null;
      /** 改口是否新增了支持事實。 */
      newlySupportedFactsText: string;
    }
  | { kind: "refs"; items: PaperFigure[] };

export type PaperCardSectionView = {
  key: PaperCardSectionKey;
  title: string;
  body: PaperCardBody;
};

/** 交易紀錄一列。`withheld` 這一側**完全不帶市場數字**。 */
export type PaperActionRowView =
  | {
      kind: "disclosed";
      tradingDate: string;
      actionLabel: string;
      directionLabel: string;
      instrumentLabel: string;
      figures: PaperFigure[];
      rationaleSummary: string;
      concurrentClaim: PaperQuoteView | null;
    }
  | { kind: "withheld"; tradingDate: string; statusText: string };

const SHA256_HEX = /^[0-9a-f]{64}$/;

const INVALIDATION_LABEL: Readonly<Record<InvalidationCondition, string>> = {
  not_yet_occurred: "尚未發生",
  occurred: "已發生",
  unknown_at_the_time: "當時未知",
};

const ACTION_LABEL: Readonly<Record<string, string>> = {
  BUY: "建立部位",
  SELL: "減碼或結束部位",
  HOLD: "續抱",
  NO_ACTION: "沒有動作",
};

const DIRECTION_LABEL: Readonly<Record<string, string>> = {
  no_action: "沒有方向",
  upside: "看多",
  downside: "看空",
};

/** 盤中還沒收盤定案時，這一列固定顯示這句；句中不得出現任何數字。 */
export const PENDING_SESSION_STATUS_TEXT =
  "這個交易時段還沒收盤定案。標的、方向、數量、信心與理由都不在這份投影裡，介面也不推測。";

/** 沒有任何模擬持倉時的固定空狀態（experience-spec §9.2）。 */
export const EMPTY_POSITION_TEXT = "他目前沒有模擬持倉。沒下手，也是今天的一部分。";

/**
 * 台幣 minor units → 含千分位與 U+2212 負號的金額字串（不含 `NT$` 前綴）。
 *
 * 本檔**不再自己換算金額**：唯一一份 minor-unit → 元的邏輯在
 * `format.ts` 的 `minorUnitsToTwd()`（`TWD_MINOR_UNIT_DECIMALS = 2`，
 * 依 `tools/character-episode/src/public_api.rs` 的
 * `FIXED_RAW_PER_MINOR_UNIT = 10_000` ÷ `Fixed::SCALE = 1_000_000` ＝ 1/100 元）。
 * 這裡只保留這個名字，因為模擬紀錄頁與其測試用它；行為是純轉呼叫。
 */
export const minorUnitsToTwdText = minorUnitsToTwdOrNull;

/** `*Fixed6` 的數量 → 整數股數字串（本切片只做整股，尾數不為 0 時 fail closed）。 */
export function quantityFixed6ToText(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return null;
  if (value % 1_000_000 !== 0) return null;
  return groupThousandDigits(Math.abs(value / 1_000_000).toString());
}

/** 每股價格：minor units 再乘 1,000,000，換算回「元」的兩位小數字串。 */
export function unitPriceFixed6ToText(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return null;
  const minorUnits = BigInt(value) / 1_000_000n;
  if (BigInt(value) % 1_000_000n !== 0n) return null;
  return minorUnitsToTwdOrNull(Number(minorUnits));
}

function quoteOrNull(utterance: CharacterUtterance | undefined): PaperQuoteView | null {
  if (!utterance) return null;
  const text = utterance.canonicalTextUtf8?.trim() ?? "";
  const digest = utterance.canonicalTextSha256 ?? "";
  const artifactId = utterance.utteranceArtifactId ?? "";
  // 無法核對的原話寧可不顯示，也不顯示一句追溯不到 artifact 的第一人稱台詞。
  if (text.length === 0 || artifactId.length === 0 || !SHA256_HEX.test(digest)) return null;
  return {
    text,
    utteranceArtifactId: artifactId,
    canonicalTextSha256: digest,
    digestPrefix: digest.slice(0, DIGEST_PREFIX_LENGTH),
  };
}

/** 只接受 `+08:00`（Asia/Taipei 交易時段）的 ISO 字串，取它的曆日序號。 */
function taipeiDayIndex(iso: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}:\d{2}\+08:00$/.exec(iso.trim());
  if (!match) return null;
  const [, year = "", month = "", day = ""] = match;
  const days = Date.UTC(Number(year), Number(month) - 1, Number(day)) / 86_400_000;
  return Number.isSafeInteger(days) ? days : null;
}

/**
 * 持有天數：建倉當天算第 1 天，與 `public_api.rs` 的 `held_days()` 同定義。
 * 兩端任一個無法解析就回傳 `null`，不推算。
 */
export function heldDays(openedAt: string, markAsOf: string): number | null {
  const from = taipeiDayIndex(openedAt);
  const to = taipeiDayIndex(markAsOf);
  if (from === null || to === null || to < from) return null;
  return to - from + 1;
}

/** 這份投影是否還有沒收盤定案的交易時段。 */
export function paperDisclosureMode(projection: PaperArchiveProjection): PaperDisclosureMode {
  const pending = projection.historicalActionFills.some(
    (record) => record.marketSessionFinalityState !== "accepted",
  );
  return pending ? "intraday_previous_session" : "post_session";
}

function lastAcceptedRecord(projection: PaperArchiveProjection): PaperActionFillRecord | null {
  let latest: PaperActionFillRecord | null = null;
  for (const record of projection.historicalActionFills) {
    if (record.marketSessionFinalityState !== "accepted") continue;
    if (latest === null || record.tradingDate.localeCompare(latest.tradingDate) > 0) {
      latest = record;
    }
  }
  return latest;
}

function sumCostBasisMinorUnits(position: PaperPositionPublic): number | null {
  let total = 0;
  for (const lot of position.lots) {
    if (!Number.isSafeInteger(lot.costBasisMinorUnits)) return null;
    total += lot.costBasisMinorUnits;
  }
  return Number.isSafeInteger(total) ? total : null;
}

function sumQuantityFixed6(position: PaperPositionPublic): number | null {
  let total = 0;
  for (const lot of position.lots) {
    if (!Number.isSafeInteger(lot.quantityFixed6)) return null;
    total += lot.quantityFixed6;
  }
  return Number.isSafeInteger(total) ? total : null;
}

/** 曝險＝這個部位的現值 ÷ 模擬總資產（現金＋現值），整數 BigInt 運算。 */
function exposurePercentFixed2(marketValue: number, cashMinorUnits: number): number | null {
  if (!Number.isSafeInteger(marketValue) || !Number.isSafeInteger(cashMinorUnits)) return null;
  const assets = BigInt(marketValue) + BigInt(cashMinorUnits);
  if (assets <= 0n) return null;
  const scaled = (BigInt(marketValue) * 10_000n) / assets;
  return Number(scaled);
}

function pnlView(
  label: string,
  amountMinorUnits: number | null | undefined,
  percentFixed2: number | null | undefined,
): PaperPnlView {
  const amountText = minorUnitsToTwdOrNull(amountMinorUnits ?? null);
  if (amountText === null) {
    return {
      label,
      amountText: null,
      percentText: null,
      directionLabel: DATA_UNAVAILABLE_LABEL,
      direction: "unknown",
    };
  }

  const amount = amountMinorUnits as number;
  const direction: PaperPnlDirection = amount < 0 ? "negative" : amount > 0 ? "positive" : "flat";
  const directionLabel = amount < 0 ? "虧損" : amount > 0 ? "獲利" : "持平";

  let percentText: string | null = null;
  if (typeof percentFixed2 === "number" && Number.isSafeInteger(percentFixed2)) {
    percentText = percentFixed2ToString(percentFixed2);
  }

  return { label, amountText, percentText, directionLabel, direction };
}

/**
 * 「新增支持事實」目前只存在於投影自己封存的 `consequenceSummary` 文字裡
 * （public-v2.yaml 還沒有結構化欄位）。這裡只做嚴格擷取：投影沒有寫，就 fail closed，
 * 絕不由介面代算一個數字。
 */
export function newlySupportedFactCount(position: PaperPositionPublic): number | null {
  const match = /新增支持事實\s*(\d+)\s*筆/.exec(position.consequenceSummary ?? "");
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * 人物動詞。
 *
 * 盤中（`intraday_previous_session`）只允許描述前一個交易日已公開的狀態，
 * 而且句子裡不得帶標的名稱——`tickerSpecific` 永遠是 `false`。
 */
function actorVerbBody(
  projection: PaperArchiveProjection,
  position: PaperPositionPublic,
): PaperCardBody {
  const mode = paperDisclosureMode(projection);
  const accepted = lastAcceptedRecord(projection);
  const acceptedAction = accepted?.dailyActionDisclosure?.action ?? null;

  if (mode === "intraday_previous_session") {
    if (position.status !== "open") {
      return {
        kind: "verb",
        text: "他在前一個交易日結束時已經沒有這個部位了。",
        disclosureMode: mode,
        tickerSpecific: false,
      };
    }
    const text =
      acceptedAction === "SELL"
        ? "他還抱著前一個交易日減碼後剩下的部位。"
        : "他還抱著前一個交易日收盤時的部位。";
    return { kind: "verb", text, disclosureMode: mode, tickerSpecific: false };
  }

  // 盤後回顧才允許同日 ticker-specific 動詞。
  const text =
    acceptedAction === "SELL"
      ? "他終於減碼。"
      : acceptedAction === "BUY"
        ? "他追了進去。"
        : acceptedAction === "HOLD"
          ? "他還在撐。"
          : "他這個交易時段沒有動作。";
  return { kind: "verb", text, disclosureMode: mode, tickerSpecific: acceptedAction !== null };
}

function holdingBody(
  projection: PaperArchiveProjection,
  position: PaperPositionPublic,
): PaperCardBody {
  const figures: PaperFigure[] = [];

  const quantity = quantityFixed6ToText(sumQuantityFixed6(position));
  figures.push({ label: "持有數量", text: quantity === null ? DATA_UNAVAILABLE_LABEL : quantity });

  const costBasis = sumCostBasisMinorUnits(position);
  const costText = minorUnitsToTwdOrNull(costBasis);
  figures.push({ label: "成本", text: costText === null ? DATA_UNAVAILABLE_LABEL : costText });

  const unrealized = position.unrealizedPnlMinorUnits;
  const marketValue =
    costBasis !== null && typeof unrealized === "number" && Number.isSafeInteger(unrealized)
      ? costBasis + unrealized
      : null;
  const marketValueText = minorUnitsToTwdOrNull(marketValue);
  figures.push({
    label: "現值",
    text: marketValueText === null ? DATA_UNAVAILABLE_LABEL : marketValueText,
  });

  const exposure =
    marketValue === null ? null : exposurePercentFixed2(marketValue, projection.account.cashMinorUnits);
  figures.push({
    label: "曝險",
    text: exposure === null ? DATA_UNAVAILABLE_LABEL : percentFixed2ToString(exposure),
  });

  const days = heldDays(position.openedAt, position.markAsOf);
  figures.push({
    label: "持有天數",
    text: days === null ? DATA_UNAVAILABLE_LABEL : `${days}`,
  });

  return { kind: "figures", figures };
}

function rationaleBody(position: PaperPositionPublic): PaperCardBody {
  const summary = position.rationaleSummary?.trim() ?? "";
  const quote = quoteOrNull(position.concurrentClaim);
  return {
    kind: "rationale",
    summary: summary.length > 0 ? summary : DATA_UNAVAILABLE_LABEL,
    invalidationLabel: INVALIDATION_LABEL[position.invalidationCondition],
    invalidationOccurred: position.invalidationCondition === "occurred",
    concurrentClaim: quote,
    concurrentClaimAbsenceText:
      quote === null ? "當時沒有可核對的公開原話，這裡留白，不補一句第一人稱台詞。" : null,
  };
}

function currentClaimBody(position: PaperPositionPublic): PaperCardBody {
  const narration = position.currentNarration;
  const count = newlySupportedFactCount(position);
  const newlySupportedFactsText =
    count === null
      ? `新增支持事實：${DATA_UNAVAILABLE_LABEL}`
      : `新增支持事實：${count} 筆`;

  if (narration === undefined) {
    return {
      kind: "currentClaim",
      quote: null,
      summaryText: null,
      absenceText: "他還沒有新的公開說法。",
      newlySupportedFactsText,
    };
  }

  if (narration.kind === "utterance") {
    const quote = quoteOrNull({
      utteranceArtifactId: narration.utteranceArtifactId,
      canonicalTextSha256: narration.canonicalTextSha256,
      canonicalTextUtf8: narration.canonicalTextUtf8,
    });
    return {
      kind: "currentClaim",
      quote,
      summaryText: null,
      absenceText:
        quote === null ? `${DATA_UNAVAILABLE_LABEL}：這句話無法核對，因此不顯示。` : null,
      newlySupportedFactsText,
    };
  }

  const summaryText = narration.summaryText?.trim() ?? "";
  return {
    kind: "currentClaim",
    quote: null,
    summaryText: summaryText.length > 0 ? summaryText : null,
    absenceText: summaryText.length > 0 ? null : DATA_UNAVAILABLE_LABEL,
    newlySupportedFactsText,
  };
}

function archiveNodesBody(
  projection: PaperArchiveProjection,
  position: PaperPositionPublic,
): PaperCardBody {
  const items: PaperFigure[] = [];

  items.push({
    label: "關係",
    text:
      position.influencedByCharacterRefs.length === 0
        ? "沒有其他角色被記為影響來源。"
        : position.influencedByCharacterRefs.join("、"),
  });

  items.push({
    label: "記憶",
    text: "這份投影不帶記憶節點；記憶在深層檔案索引的「記憶」節。",
  });

  items.push({ label: "部位識別碼", text: position.positionId });
  items.push({
    label: "紙上版本集",
    text: projection.paperVersionSet.paperVersionSetDigest.slice(0, DIGEST_PREFIX_LENGTH),
  });

  for (const ref of projection.sourceRevisionSet) {
    items.push({ label: "來源", text: `${ref.refKind}／${ref.refId}／rev ${ref.revision}` });
  }

  for (const revision of projection.dataRevisions) {
    items.push({ label: `更正（${revision.kind}）`, text: revision.summary });
  }

  return { kind: "refs", items };
}

/** 固定七段。段序與段名永遠不變，缺資料只換內容，不換順序、不刪段。 */
export function paperCardSections(
  projection: PaperArchiveProjection,
  position: PaperPositionPublic,
): PaperCardSectionView[] {
  const mode = paperDisclosureMode(projection);

  return PAPER_CARD_SECTION_ORDER.map(({ key, title }) => {
    switch (key) {
      case "actorVerb":
        return { key, title, body: actorVerbBody(projection, position) };
      case "asOf":
        return {
          key,
          title,
          body: {
            kind: "asOf",
            text:
              mode === "intraday_previous_session"
                ? formatAsOfIntraday(projection.asOf)
                : `資料截至 ${projection.asOf}`,
            disclosureMode: mode,
          },
        };
      case "holding":
        return { key, title, body: holdingBody(projection, position) };
      case "pnl":
        return {
          key,
          title,
          body: {
            kind: "pnl",
            // 兩項永遠都在：虧損不得因為「不好看」而消失。
            entries: [
              pnlView("已實現損益", position.realizedPnlMinorUnits, null),
              pnlView(
                "未實現損益",
                position.unrealizedPnlMinorUnits,
                position.unrealizedPnlPercentFixed2,
              ),
            ],
          },
        };
      case "originalRationale":
        return { key, title, body: rationaleBody(position) };
      case "currentClaim":
        return { key, title, body: currentClaimBody(position) };
      case "archiveNodes":
        return { key, title, body: archiveNodesBody(projection, position) };
    }
  });
}

/**
 * 交易紀錄列表（experience-spec §9.4）。canonical 時序由舊到新。
 *
 * `dailyActionDisclosure` 這個 key 不存在時，這一列只留交易日與一句狀態說明，
 * **不產生任何市場數字**。
 */
export function paperActionRows(projection: PaperArchiveProjection): PaperActionRowView[] {
  return [...projection.historicalActionFills]
    .sort((left, right) => left.tradingDate.localeCompare(right.tradingDate))
    .map((record): PaperActionRowView => {
      const disclosure = record.dailyActionDisclosure;
      if (disclosure === undefined || record.marketSessionFinalityState !== "accepted") {
        return {
          kind: "withheld",
          tradingDate: record.tradingDate,
          statusText: PENDING_SESSION_STATUS_TEXT,
        };
      }

      const figures: PaperFigure[] = [];
      const quantity = quantityFixed6ToText(disclosure.quantityFixed6);
      figures.push({
        label: "數量",
        text: quantity === null ? DATA_UNAVAILABLE_LABEL : quantity,
      });

      const price =
        disclosure.fill === null ? null : unitPriceFixed6ToText(disclosure.fill.sealedPriceMinorUnitsFixed6);
      figures.push({
        label: "模擬成交價",
        text: disclosure.fill === null ? "未成交" : price === null ? DATA_UNAVAILABLE_LABEL : price,
      });

      figures.push({
        label: "信心",
        text: percentFixed2ToString(disclosure.confidencePercentFixed2),
      });

      if (disclosure.fill !== null) {
        figures.push({ label: "資料時間", text: disclosure.fill.filledAt });
      }

      return {
        kind: "disclosed",
        tradingDate: record.tradingDate,
        actionLabel: ACTION_LABEL[disclosure.action] ?? DATA_UNAVAILABLE_LABEL,
        directionLabel: DIRECTION_LABEL[disclosure.direction] ?? DATA_UNAVAILABLE_LABEL,
        instrumentLabel: disclosure.instrumentLabel,
        figures,
        rationaleSummary: disclosure.rationaleSummary,
        concurrentClaim: quoteOrNull(disclosure.concurrentClaim),
      };
    });
}
