// 逐項資料身分標籤：深層檔案五節、證據卡與並排比較裡，每一項宣稱自己帶的
// `truthClass`（public-v2.yaml 每個 archive item 都有）直接掛成一顆 `TruthTag`。
//
// 和整頁標籤不同，這裡不過 `declaredTruthClass()`：item 自己的 `truthClass` 就是
// 投影對這一項的宣告，apiClient 已經在進門時驗過它是已知的五種之一、而且至少有
// 一個來源（`sourceRefs` 非空）。缺了就整份投影 `INCOMPLETE_PROJECTION`，不會走到這裡。
//
// 說明文字是工程 placeholder，未經 copy-taste 審稿。

import type { TruthClass } from "../api/generated-v2/types.gen";
import { TruthTag } from "./TruthTag";

export const ITEM_TRUTH_CLASS_EXPLANATION: Readonly<Record<TruthClass, string>> = {
  real_fact: "已封存並可回溯到外部來源的事實。",
  statistical_sample: "依分布取樣的統計結果，不是單一個案的事實。",
  fictional_setting: "虛構設定：這個人、他身邊的人與他的人生事件都是這個世界自己的設定。",
  symbolic_interpretation: "命盤與象徵的文化詮釋，只影響他的注意與解讀，不改動價格、不改動績效。",
  simulated_narrative: "由已封存事件編成的模擬敘事，包含他的紙上交易與他說過的話。",
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
