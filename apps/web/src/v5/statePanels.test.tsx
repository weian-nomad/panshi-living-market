// `statePanels.tsx` 專用測試：目前只覆蓋「其他頁」更正橫幅的收合邏輯
// (`summarizeSourceRevisions` ＋ `CorrectedBanner(scope: "other")`)。
//
// 七種資料狀態的整體渲染測試留在 `SliceApp.test.tsx`（透過 `SliceView`），這裡
// 只補：B3 之後這個檔案新增、SliceApp.test.tsx 沒有直接覆蓋到的收合行為——
// 一句人話摘要、依來源種類的分類計數、「看全部更正」展開，以及原始
// `refKind`／`refId` 仍然只出現在巢狀稽核抽屜裡。

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { SourceRevisionRef } from "../api/generated-v2/types.gen";
import {
  CorrectedBanner,
  FAIL_CLOSED_NOTE,
  SOURCE_REF_KIND_FALLBACK,
  summarizeSourceRevisions,
} from "./statePanels";

function ref(refKind: string, refId: string, revision: number): SourceRevisionRef {
  return { refKind, refId, revision };
}

/** 重現世界頁切片實際會出現的擁擠案例：30 筆世界事實 + 2 筆模擬紀錄，共 32 筆。 */
function crowdedRefs(): SourceRevisionRef[] {
  const refs: SourceRevisionRef[] = [];
  for (let i = 1; i <= 30; i += 1) {
    refs.push(ref("world_fact_manifest", `wfm-${i}`, i));
  }
  refs.push(ref("paper_account", "acct-1", 1));
  refs.push(ref("paper_position", "pos-1", 1));
  return refs;
}

describe("summarizeSourceRevisions", () => {
  it("空陣列回傳 null，呼叫端另外處理 fail-closed 文案", () => {
    expect(summarizeSourceRevisions([])).toBeNull();
  });

  it("只有一種分類：句子用「共」，不是「等」", () => {
    const summary = summarizeSourceRevisions([ref("world_fact_manifest", "wfm-1", 6)]);
    expect(summary).not.toBeNull();
    expect(summary?.totalCount).toBe(1);
    expect(summary?.latestRevision).toBe(6);
    expect(summary?.categories).toEqual([{ label: "世界事實清單", count: 1 }]);
    expect(summary?.sentence).toBe("世界事實清單共 1 項資料有更正，最新第 6 版。");
  });

  it("多種分類：句子用「等」，分類依筆數由多到少排序，最新版本取全體最大值", () => {
    const refs = [
      ref("world_fact_manifest", "wfm-1", 1),
      ref("world_fact_manifest", "wfm-2", 30),
      ref("paper_account", "acct-1", 3),
      ref("paper_position", "pos-1", 12),
    ];
    const summary = summarizeSourceRevisions(refs);
    expect(summary?.totalCount).toBe(4);
    expect(summary?.latestRevision).toBe(30);
    expect(summary?.categories).toEqual([
      { label: "世界事實清單", count: 2 },
      { label: "模擬帳戶", count: 1 },
      { label: "模擬部位", count: 1 },
    ]);
    expect(summary?.sentence).toBe("世界事實清單等 4 項資料有更正，最新第 30 版。");
  });

  it("重現世界頁的擁擠案例：32 筆、3 個分類，收成一句摘要而不是 32 個項目", () => {
    const summary = summarizeSourceRevisions(crowdedRefs());
    expect(summary?.totalCount).toBe(32);
    expect(summary?.latestRevision).toBe(30);
    expect(summary?.sentence).toBe("世界事實清單等 32 項資料有更正，最新第 30 版。");
  });

  it("沒收錄過的 refKind 合併進同一個 fallback 分類，不各自成一筆", () => {
    const refs = [ref("unknown_kind_a", "a-1", 1), ref("unknown_kind_b", "b-1", 2)];
    const summary = summarizeSourceRevisions(refs);
    expect(summary?.categories).toEqual([{ label: SOURCE_REF_KIND_FALLBACK, count: 2 }]);
    expect(summary?.sentence).not.toContain("unknown_kind_a");
    expect(summary?.sentence).not.toContain("unknown_kind_b");
  });
});

describe('CorrectedBanner(scope: "other") — 更正橫幅收合', () => {
  it("30+ 筆版本項目在本體收成一句摘要 ＋ 分類計數；逐筆列表與原始 id 都要展開才看得到", () => {
    const refs = crowdedRefs();
    const markup = renderToStaticMarkup(
      <CorrectedBanner scope="other" refs={refs} correctionsHref={null} />,
    );

    const detailsStart = markup.indexOf("<details");
    expect(detailsStart).toBeGreaterThan(-1);
    const bodyBeforeDetails = markup.slice(0, detailsStart);

    // 本體是摘要句 + 分類計數，不是逐筆列表。
    expect(bodyBeforeDetails).toContain("世界事實清單等 32 項資料有更正，最新第 30 版。");
    expect(bodyBeforeDetails).toContain("世界事實清單");
    expect(bodyBeforeDetails).toContain("模擬帳戶");
    expect(bodyBeforeDetails).toContain("模擬部位");
    // 30 筆 world_fact_manifest 在分類計數只留一行，本體總共只有 3 個 <li>（3 個分類），
    // 不是 32 個逐筆項目。
    expect((bodyBeforeDetails.match(/<li/g) ?? []).length).toBe(3);

    // 原始 refId 完全不在展開前的本體出現。
    expect(bodyBeforeDetails).not.toContain("wfm-1");
    expect(bodyBeforeDetails).not.toContain("acct-1");
    expect(bodyBeforeDetails).not.toContain("pos-1");

    // 有「看全部更正」可以展開逐筆列表，也有稽核抽屜。
    expect(markup).toContain("看全部更正");
    expect(markup).toContain("稽核用原始識別碼");

    // 原始 id 仍然只出現在巢狀稽核抽屜裡面（抽屜開始之後）。
    const auditStart = markup.indexOf('class="v5-corrections__audit"');
    expect(auditStart).toBeGreaterThan(-1);
    expect(markup.indexOf("wfm-1")).toBeGreaterThan(auditStart);
    expect(markup.indexOf("world_fact_manifest／wfm-1／第 1 版")).toBeGreaterThan(auditStart);

    // reduced motion：展開本身沒有掛任何 CSS transition／animation class，
    // 所以沒有東西需要在 reduced motion 下關掉。
    expect(markup).not.toMatch(/transition|animation/);
  });

  it("沒有 refs 時維持既有 fail-closed 文案，不呼叫 summarizeSourceRevisions 生句子", () => {
    const markup = renderToStaticMarkup(
      <CorrectedBanner scope="other" refs={[]} correctionsHref={null} />,
    );
    expect(markup).toContain("這份文件沒有附上可核對的來源版本");
    expect(markup).toContain(FAIL_CLOSED_NOTE);
    expect(markup).not.toContain("<details");
  });
});
