// 逐項資料身分標籤：每一項對外可見的宣稱自己帶的 truth class（public-v2.yaml 2.1.0：
// archive item 的 `truthClass`、宣稱欄位同層的 `<欄位>TruthClass`、單一宣稱物件的
// `truthClass`）直接掛成一顆 `TruthTag`。
//
// 身分只從投影讀，前端不決定。深層檔案五節的 item 在 apiClient 進門時已驗過
// `truthClass` 與 `sourceRefs`；其餘宣稱（近景、人生誌、模擬紀錄、索引、世界）在這裡
// 逐項過 `claimTruthClassOf()`：缺身分的那一項**不顯示**，改寫一句原因
// （`ClaimWithTruth`），同一頁其他項目照常顯示。
//
// 說明文字是工程 placeholder，未經 copy-taste 審稿。

import type { ReactNode } from "react";

import type { TruthClass } from "../api/generated-v2/types.gen";
import { TruthTag } from "./TruthTag";
import { MISSING_CLAIM_TRUTH_CLASS_TEXT, claimTruthClassOf } from "./claimTruth";

export const ITEM_TRUTH_CLASS_EXPLANATION: Readonly<Record<TruthClass, string>> = {
  real_fact: "已封存並可回溯到外部來源的事實。",
  statistical_sample: "依分布取樣的統計結果，不是單一個案的事實。",
  fictional_setting: "虛構設定：這個人、他身邊的人、他的人生事件，以及這個切片自有的合成市場事實。",
  symbolic_interpretation: "命盤與象徵的文化詮釋，只影響他的注意與解讀，不改動價格、不改動績效。",
  simulated_narrative: "由已封存事件編成的模擬敘事，包含他的注意、行動、紙上交易與他說過的話。",
};

export function ItemTruthTag({
  truthClass,
  asOfLabel,
  versionLabel,
}: {
  truthClass: TruthClass;
  asOfLabel: string;
  versionLabel: string;
}) {
  return (
    <TruthTag
      truthClass={truthClass}
      explanation={ITEM_TRUTH_CLASS_EXPLANATION[truthClass]}
      asOfLabel={asOfLabel}
      versionLabel={versionLabel}
      className="v5-item-truth"
    />
  );
}

/** 一項宣稱因為缺資料身分而不顯示時的可見原因。 */
export function WithheldClaim({ className }: { className?: string }) {
  return (
    <p
      className={className ? `v5-claim-withheld panshi-paper ${className}` : "v5-claim-withheld panshi-paper"}
      data-claim-withheld="missing_truth_class"
    >
      {MISSING_CLAIM_TRUTH_CLASS_TEXT}
    </p>
  );
}

/**
 * 一項宣稱與它自己的資料身分。
 *
 * `truthClass` 是那一項的 truth class 欄位原值；過得了 `claimTruthClassOf()` 才渲染
 * `children` 與標籤，否則整項換成 `WithheldClaim`——不顯示內容、不掛別的身分。
 */
export function ClaimWithTruth({
  truthClass,
  declared,
  asOfLabel,
  versionLabel,
  children,
  withheldClassName,
}: {
  truthClass: unknown;
  declared?: readonly TruthClass[];
  asOfLabel: string;
  versionLabel: string;
  children: ReactNode;
  withheldClassName?: string;
}) {
  const labelled = claimTruthClassOf(truthClass, declared);
  if (labelled === null) return <WithheldClaim className={withheldClassName} />;
  return (
    <>
      {children}
      <ItemTruthTag truthClass={labelled} asOfLabel={asOfLabel} versionLabel={versionLabel} />
    </>
  );
}
