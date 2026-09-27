// 「原本理由｜現在說法｜紙上代價｜關係後果」並排比較。
//
// 用在兩個地方：人生誌裡有改口的章節，以及模擬紀錄頁的每一張持股主卡。
// 讀者要的是同一個人前後兩句話，和那兩句話之間留下的代價，放在同一個視線裡。
//
// 版面規則：
// - 四欄順序固定（`CLAIM_COMPARISON_COLUMNS`），不依內容多寡重排。
// - 寬螢幕是 grid 四欄；窄螢幕同樣順序往下堆疊，每一欄都保留欄標題，
//   所以窄版不是把表格擠掉，而是同一份結構換一種排列（螢幕報讀器讀到的順序一樣）。
// - 本元件不產生任何文字內容：四欄的內容全部由呼叫端傳入，元件只負責結構。
//   缺哪一欄，就由呼叫端傳一句可讀的缺漏說明，不留白、不補值。
//
// 欄標題與區塊說明是工程 placeholder，未經 copy-taste 審稿。

import type { ReactNode } from "react";

export type ClaimComparisonColumnKey = "originalReason" | "currentClaim" | "paperCost" | "relationship";

export const CLAIM_COMPARISON_COLUMNS: readonly { key: ClaimComparisonColumnKey; title: string }[] = [
  { key: "originalReason", title: "原本理由" },
  { key: "currentClaim", title: "現在說法" },
  { key: "paperCost", title: "紙上代價" },
  { key: "relationship", title: "關係後果" },
];

const STYLES = `
.v5-compare { margin: .4rem 0 .8rem; }
.v5-compare__title { margin: 0 0 .35rem; font-size: .8rem; font-weight: 500; color: var(--copper-500); }
.v5-compare__grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: .6rem .9rem;
  margin: 0;
}
.v5-compare__col {
  min-width: 0;
  padding: .45rem .6rem;
  border: 1px solid var(--rule-paper);
}
.v5-compare__col h5 { margin: 0 0 .3rem; font-size: .76rem; font-weight: 500; color: var(--copper-500); }
.v5-compare__col p { margin: 0 0 .2rem; }
@media (max-width: 760px) {
  /* 窄螢幕：同一個順序往下堆疊，欄標題保留。 */
  .v5-compare__grid { grid-template-columns: 1fr; }
}
`;

export type ClaimComparisonProps = {
  /** 區塊標題，例如「和 2026-03-03 的原話並排」。 */
  title: string;
  columns: Readonly<Record<ClaimComparisonColumnKey, ReactNode>>;
};

export function ClaimComparison({ title, columns }: ClaimComparisonProps) {
  return (
    <section className="v5-compare" aria-label={title} data-compare="claim">
      <style>{STYLES}</style>
      <h4 className="v5-compare__title">{title}</h4>
      <div className="v5-compare__grid">
        {CLAIM_COMPARISON_COLUMNS.map(({ key, title: columnTitle }) => (
          <section className="v5-compare__col" key={key} data-column={key}>
            <h5>{columnTitle}</h5>
            {columns[key]}
          </section>
        ))}
      </div>
    </section>
  );
}
