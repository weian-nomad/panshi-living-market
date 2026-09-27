// 深層檔案五節真頁、讀者路徑與原話逐字的 node 端渲染測試。
//
// apps/web 沒有 jsdom、也不加依賴：一律 `renderToStaticMarkup(<SliceView …/>)`，
// 資料用切片產生器輸出的**真** fixture（`testing/sliceFixtures.ts`）；只有 evidence
// card 與 HELD 這兩種真 fixture 裡沒有出現的狀態，才在真章節上改最少的欄位。

import { createHash } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type {
  HeldLifeJournalEntry,
  LifeJournalEntry,
  LifeJournalPage,
} from "../api/generated-v2/types.gen";
import { CHART_SCOPE_NOTICE } from "./ArchiveSectionScreen";
import { SYSTEM_LABEL_KIND_TEXT } from "./SystemLabel";
import { CLAIM_COMPARISON_COLUMNS } from "./ClaimComparison";
import { EVIDENCE_CARD_ONLY_NOTE } from "./EvidenceCardView";
import { SliceView, type SliceData } from "./SliceApp";
import { menuChoiceOpensCloseUp } from "./followGesture";
import { chapterAnchorId, claimRevisions } from "./journalRevisions";
import { JOURNAL_SECTION_ORDER } from "./journalSections";
import { routeToPath, type Route } from "./router";
import {
  SLICE_CHARACTER_ID,
  sliceArchiveIndex,
  sliceChart,
  sliceCloseUp,
  sliceJournal,
  sliceLife,
  sliceMemories,
  slicePaper,
  sliceRelations,
  sliceTraits,
  sliceWorld,
  unescapeHtml,
} from "./testing/sliceFixtures";

const ID = SLICE_CHARACTER_ID;

const ROUTE_OF: Readonly<Record<SliceData["kind"], Route>> = {
  world: { kind: "world" },
  closeUp: { kind: "closeUp", characterId: ID },
  journal: { kind: "journal", characterId: ID },
  archive: { kind: "archive", characterId: ID },
  archivePaper: { kind: "archivePaper", characterId: ID },
  archiveRelations: { kind: "archiveRelations", characterId: ID },
  archiveChart: { kind: "archiveChart", characterId: ID },
  archiveTraits: { kind: "archiveTraits", characterId: ID },
  archiveMemories: { kind: "archiveMemories", characterId: ID },
  archiveLife: { kind: "archiveLife", characterId: ID },
};

function render(value: SliceData): string {
  const markup = renderToStaticMarkup(
    <SliceView
      route={ROUTE_OF[value.kind]}
      state={{ phase: "ready", value }}
      online
      reducedMotion
      navigate={() => {}}
    />,
  );
  // `<style>` 內的 CSS 選擇器也含 class 名；斷言只看真正的元素。
  return markup.replace(/<style>[\s\S]*?<\/style>/g, "");
}

/** 畫面上看得到的文字（去掉標籤與屬性）。 */
function visibleText(markup: string): string {
  return unescapeHtml(markup.replace(/<[^>]+>/g, " "));
}

function escapeText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function count(markup: string, needle: string): number {
  return markup.split(needle).length - 1;
}

function articleById(markup: string, id: string): string | null {
  const match = new RegExp(`<article[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)</article>`).exec(markup);
  return match === null ? null : (match[1] ?? "");
}

/**
 * `canonicalTextSha256` 的定義（crates/character-domain/src/utterance.rs
 * `UtteranceArtifact::canonical_text_sha256`）：sha256 over 網域分隔前綴
 * `PSZS/UTTERANCE_TEXT/v1\0` 加上 UTF-8 原文。這裡用 node:crypto 獨立重算。
 */
function sha256(text: string): string {
  return createHash("sha256")
    .update("PSZS/UTTERANCE_TEXT/v1\u0000", "utf8")
    .update(text, "utf8")
    .digest("hex");
}

function articleOpenTag(markup: string, id: string): string {
  return new RegExp(`<article[^>]*\\bid="${id}"[^>]*>`).exec(markup)?.[0] ?? "";
}

type RenderedUtterance = { artifactId: string; digest: string; text: string };

function renderedUtterances(markup: string): RenderedUtterance[] {
  const found: RenderedUtterance[] = [];
  for (const match of markup.matchAll(/<q([^>]*)>([^<]*)<\/q>/g)) {
    const attrs = match[1] ?? "";
    const artifactId = /data-artifact-id="([^"]*)"/.exec(attrs)?.[1];
    const digest = /data-text-sha256="([^"]*)"/.exec(attrs)?.[1];
    if (artifactId === undefined || digest === undefined) {
      throw new Error(`<q> without artifact attributes: ${match[0]}`);
    }
    found.push({ artifactId, digest, text: unescapeHtml(match[2] ?? "") });
  }
  return found;
}

/** 走遍整份 fixture，收集每一份 utterance artifact 的原文與 digest。 */
function fixtureUtterances(...documents: unknown[]): Map<string, { digest: string; text: string }> {
  const byId = new Map<string, { digest: string; text: string }>();
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== "object" || value === null) return;
    const record = value as Record<string, unknown>;
    if (
      typeof record["utteranceArtifactId"] === "string" &&
      typeof record["canonicalTextSha256"] === "string" &&
      typeof record["canonicalTextUtf8"] === "string"
    ) {
      byId.set(record["utteranceArtifactId"], {
        digest: record["canonicalTextSha256"],
        text: record["canonicalTextUtf8"],
      });
    }
    Object.values(record).forEach(visit);
  };
  documents.forEach(visit);
  return byId;
}

function entryOn(page: LifeJournalPage, date: string): LifeJournalEntry {
  const entry = page.entries.find((candidate) => candidate.chapterDate === date);
  if (entry === undefined) throw new Error(`fixture journal has no chapter on ${date}`);
  return entry;
}

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
const DIGEST_PATTERN = /\b[0-9a-f]{64}\b/;

// ---------------------------------------------------------------------------

describe("[nav:reply-to-original] 從一句改口一次點擊回到原話與當時資料", () => {
  const page = sliceJournal();
  const markup = render({ kind: "journal", data: page });
  const links = [...markup.matchAll(/<a href="#(chapter-[0-9-]+)" data-nav="reply-to-original">([^<]*(?:<!-- -->[^<]*)*)<\/a>/g)];

  it("[nav:reply-to-original] 每一章都有 chapter-YYYY-MM-DD 錨點", () => {
    for (const entry of page.entries) {
      expect(markup).toContain(`id="${chapterAnchorId(entry.chapterDate)}"`);
    }
  });

  it("[nav:reply-to-original] 每個「回到原話」的錨點都在同一份頁面上，目標章節有原話與當時已知／漏掉的資料", () => {
    const revisions = claimRevisions(page.entries, page.heldEntries);
    expect(revisions.size).toBeGreaterThan(0);
    expect(links.length).toBe(revisions.size);

    for (const link of links) {
      const anchor = link[1] ?? "";
      expect(visibleText(link[2] ?? "")).toContain("回到原話");
      expect(count(markup, `id="${anchor}"`), `anchor ${anchor} must exist exactly once`).toBe(1);

      const target = articleById(markup, anchor);
      expect(target, `article ${anchor}`).not.toBeNull();
      const original = entryOn(page, anchor.slice("chapter-".length));
      const claim = original.contemporaneousClaim;
      expect(claim).toBeDefined();
      expect(target).toContain(`data-artifact-id="${claim?.utteranceArtifactId}"`);
      expect(target).toContain(escapeText(claim?.canonicalTextUtf8 ?? "∅"));
      expect(target).toContain(escapeText(original.knownAtTheTimeSummary));
      expect(target).toContain(escapeText(original.missedFactsSummary ?? "∅"));
    }
  });

  it("[nav:reply-to-original] 連結就在改口那一句旁邊（同一段、在那句原話之後）", () => {
    for (const revision of claimRevisions(page.entries, page.heldEntries).values()) {
      const article = articleById(markup, chapterAnchorId(revision.entry.chapterDate)) ?? "";
      const quoteAt = article.indexOf(`data-artifact-id="${revision.revision.utteranceArtifactId}"`);
      const linkAt = article.indexOf('data-nav="reply-to-original"');
      expect(quoteAt).toBeGreaterThanOrEqual(0);
      expect(linkAt).toBeGreaterThan(quoteAt);
      // 同一段：兩者之間沒有下一段的段名。
      expect(article.slice(quoteAt, linkAt)).not.toContain("<h4>");
      expect(revision.revision.utteranceArtifactId).not.toBe(revision.originalClaim.utteranceArtifactId);
    }
  });

  it("[nav:reply-to-original] 改口章節有四欄並排比較，欄序固定", () => {
    const revisions = [...claimRevisions(page.entries, page.heldEntries).values()];
    for (const revision of revisions) {
      const article = articleById(markup, chapterAnchorId(revision.entry.chapterDate)) ?? "";
      const titles = [...article.matchAll(/<h5>([^<]*)<\/h5>/g)].map((match) => match[1]);
      expect(titles).toEqual(CLAIM_COMPARISON_COLUMNS.map((column) => column.title));
    }
  });

  it("[nav:reply-to-original] 反例：原話之前有被 HELD 的章節時，不指向一個可能不是第一句的地方", () => {
    const held: HeldLifeJournalEntry = {
      entryId: "00000000-0000-4000-8000-000000000001",
      chapterDate: "2026-03-02",
      entryVisibility: "HELD",
      heldReasonLabel: "測試：這一章暫不公開。",
    };
    const withHeld: LifeJournalPage = {
      ...page,
      entries: page.entries.filter((entry) => entry.chapterDate !== "2026-03-02"),
      heldEntries: [held],
    };
    expect(claimRevisions(withHeld.entries, withHeld.heldEntries).size).toBe(0);
    expect(render({ kind: "journal", data: withHeld })).not.toContain('data-nav="reply-to-original"');
  });
});

describe("[nav:reply-to-original] 反例：原話那一章只剩證據卡", () => {
  it("[nav:reply-to-original] 原話章節是 evidence_card_only 時不產生改口連結（那裡看不到當時資料）", () => {
    const page = sliceJournal();
    const entries = page.entries.map((entry) =>
      entry.chapterDate === "2026-03-03" ? { ...entry, narrativeState: "evidence_card_only" as const } : entry,
    );
    const revisions = claimRevisions(entries, []);
    for (const revision of revisions.values()) {
      expect(revision.original.chapterDate).not.toBe("2026-03-03");
    }
    const markup = render({ kind: "journal", data: { ...page, entries } });
    expect(markup).not.toContain('href="#chapter-2026-03-03" data-nav="reply-to-original"');
  });
});

describe("[nav:ledger-in-three] 從世界出發三次操作內找到成本、損益、原始理由與退出條件", () => {
  it("[nav:ledger-in-three] 世界 →（1）居民 →（2）看他的近況 → 近景", () => {
    const world = render({ kind: "world", data: sliceWorld() });
    expect(world).toMatch(/<button[^>]*class="v5-stage__resident-hit"[^>]*aria-haspopup="true"/);
    expect(menuChoiceOpensCloseUp("closeUp")).toBe(true);
  });

  it("[nav:ledger-in-three] 近景 →（3）「持股與理由」直接連到 /archive/paper", () => {
    const closeUp = render({ kind: "closeUp", data: sliceCloseUp() });
    const paperPath = routeToPath({ kind: "archivePaper", characterId: ID });
    expect(paperPath).toBe(`/people/${ID}/archive/paper`);
    expect(closeUp).toMatch(new RegExp(`<a href="${paperPath}" data-nav="ledger">持股與理由</a>`));
  });

  it("[nav:ledger-in-three] 模擬紀錄同一頁看得到成本、已實現與未實現損益、原始理由與退出條件", () => {
    const archive = slicePaper();
    const paper = render({ kind: "archivePaper", data: archive });
    const text = visibleText(paper);
    const position = archive.positions[0];
    expect(position).toBeDefined();
    expect(text).toContain("成本");
    expect(text).toContain("60,000.00");
    expect(text).toContain("已實現損益");
    expect(text).toContain("−4,720.00");
    expect(text).toContain("未實現損益");
    expect(text).toContain("−7,680.00");
    expect(text).toContain(position?.rationaleSummary ?? "∅");
    expect(text).toContain("退出條件");
    expect(text).toContain("已發生");
    // 四欄並排：原本理由｜現在說法｜紙上代價｜關係後果。
    const titles = [...paper.matchAll(/<h5>([^<]*)<\/h5>/g)].map((match) => match[1]);
    expect(titles).toEqual(CLAIM_COMPARISON_COLUMNS.map((column) => column.title));
  });
});

// ---------------------------------------------------------------------------

type SectionCase = {
  key: "relations" | "chart" | "traits" | "memories" | "life";
  value: SliceData;
  /**
   * 這一節畫面上應該恰好掛幾顆 item 標籤（每一項宣稱一顆）。外殼第一屏那句人的句子
   *（`HUMAN_HOOK_TAG`）也是一項宣稱，掛它自己的身分，所以有那一句的節多一顆。
   */
  expectedTags: number;
  mustContain: string[];
};

/** 外殼第一屏那句（關係、性格與習慣、記憶三節有；命盤與生平沒有）自己的那顆標籤。 */
const HUMAN_HOOK_TAG = 1;

function sectionCases(): SectionCase[] {
  const relations = sliceRelations();
  const chart = sliceChart();
  const traits = sliceTraits();
  const memories = sliceMemories();
  const life = sliceLife();
  return [
    {
      key: "relations",
      value: { kind: "archiveRelations", data: relations },
      expectedTags:
        HUMAN_HOOK_TAG +
        relations.acquaintances.reduce(
          // 每筆關係訊號兩顆（2.2.0）：訊號本身，和它引用的那句原話自己的身分。
          (total, person) =>
            total + 2 + person.observedInteractions.length + 2 * person.relationshipSignals.length,
          0,
        ),
      mustContain: relations.acquaintances.flatMap((person) => [
        person.displayName,
        person.relationNote,
        person.counterpartAccount.reasonLabel,
        ...person.observedInteractions.map((interaction) => interaction.observableAction),
        ...person.relationshipSignals.flatMap((signal) => [signal.summary, signal.utterance.canonicalTextUtf8]),
      ]),
    },
    {
      key: "chart",
      value: { kind: "archiveChart", data: chart },
      expectedTags:
        1 +
        chart.placements.length +
        chart.motifs.reduce((total, motif) => total + 1 + motif.invocations.length, 0),
      mustContain: [
        "只影響注意與解讀",
        CHART_SCOPE_NOTICE,
        chart.birthIdentity.birthRegionLabel,
        ...(chart.placementsEmptyReason === null ? [] : [chart.placementsEmptyReason]),
        ...chart.motifs.flatMap((motif) => [
          motif.motifLabel,
          motif.effectScopeLabel,
          ...motif.invocations.map((invocation) => invocation.readingText),
        ]),
      ],
    },
    {
      key: "traits",
      value: { kind: "archiveTraits", data: traits },
      expectedTags:
        HUMAN_HOOK_TAG +
        4 +
        4 +
        traits.habits.length +
        traits.biasOccurrences.length +
        traits.counterExamples.length,
      mustContain: [
        traits.coreNeed.label,
        traits.coreFear.label,
        traits.bloodType.effectScopeLabel,
        traits.selfDescription.label,
        ...traits.fourAxis.map((axis) => axis.leaningLabel),
        ...traits.habits.map((habit) => habit.label),
        ...traits.biasOccurrences.map((occurrence) => occurrence.biasLabel),
        ...traits.counterExamples.map((example) => example.observedLabel),
      ],
    },
    {
      key: "memories",
      value: { kind: "archiveMemories", data: memories },
      expectedTags:
        HUMAN_HOOK_TAG +
        // 記憶裡提到的每一個人也掛自己的身分（2.2.0），不沿用那則記憶的。
        memories.memories.reduce(
          (total, memory) => total + 1 + memory.reinterpretations.length + memory.involvedPeople.length,
          0,
        ),
      mustContain: memories.memories.flatMap((memory) => [
        memory.note,
        ...memory.involvedPeople.map((person) => `${person.displayName}（${person.relationLabel}）`),
      ]),
    },
    {
      key: "life",
      value: { kind: "archiveLife", data: life },
      expectedTags:
        1 +
        life.milestones.length +
        life.originMemories.length +
        life.unrecordedFacets.length +
        life.chapterTimeline.length,
      mustContain: [
        life.identity.displayName,
        life.identity.occupationLabel,
        "虛構的成年居民",
        ...life.milestones.map((milestone) => milestone.label),
        ...life.unrecordedFacets.map((facet) => facet.reasonLabel),
      ],
    },
  ];
}

describe("深層檔案五節真頁", () => {
  for (const testCase of sectionCases()) {
    it(`[archive:${testCase.key}] 真 fixture 渲染：內容到位、每一項都掛自己的資料身分`, () => {
      const markup = render(testCase.value);
      expect(markup).toContain(`data-archive-section="${testCase.key}"`);
      const text = visibleText(markup);
      expect(testCase.mustContain.length).toBeGreaterThan(0);
      for (const needle of testCase.mustContain) {
        expect(text, `missing: ${needle}`).toContain(needle);
      }
      expect(count(markup, 'class="panshi-truth-tag v5-item-truth"')).toBe(testCase.expectedTags);
      expect(markup).not.toContain('data-truth-class="real_fact"');
    });

    it(`[archive:${testCase.key}] 畫面上不出現原始 ID 或 digest`, () => {
      const text = visibleText(render(testCase.value));
      expect(text).not.toMatch(UUID_PATTERN);
      expect(text).not.toMatch(DIGEST_PATTERN);
    });

    it(`[archive:${testCase.key}] 章節連結都指向人生誌的日期錨點`, () => {
      const markup = render(testCase.value);
      const hrefs = [...markup.matchAll(/<a class="v5-section__link" href="([^"]+)"/g)].map(
        (match) => match[1] ?? "",
      );
      expect(hrefs.length).toBeGreaterThan(0);
      for (const href of hrefs) {
        expect(href).toMatch(new RegExp(`^/people/${ID}/journal#chapter-\\d{4}-\\d{2}-\\d{2}$`));
      }
    });
  }

  it("[archive:traits] 偏誤逐次列出、依日期排列、每一次都能回到章節；沒有次數、分數或排名", () => {
    const traits = sliceTraits();
    const markup = render({ kind: "archiveTraits", data: traits });
    const list = /<ul class="v5-section__items" data-list="bias-occurrences">([\s\S]*?)<\/ul>/.exec(markup)?.[1] ?? "";
    const items = list.split("<li ").slice(1);
    expect(items.length).toBe(traits.biasOccurrences.length);
    const dates = items.map((item) => /v5-section__date panshi-data">([0-9-]+)</.exec(item)?.[1] ?? "");
    expect(dates).toEqual([...dates].sort());
    const linked = traits.biasOccurrences.filter((occurrence) => occurrence.journalEntryRef !== null).length;
    expect(count(list, 'data-nav="chapter"')).toBe(linked);
    const text = visibleText(markup);
    expect(text).not.toMatch(/\d+\s*次|\d+\s*分(?!鐘)|第\s*\d+\s*名|勝率|排行/);
    // 反例與發生同一頁。
    expect(markup).toContain('data-list="counter-examples"');
  });

  it("[archive:chart] 本命盤頁首明示只影響注意與解讀", () => {
    const markup = render({ kind: "archiveChart", data: sliceChart() });
    expect(markup).toMatch(/data-chart-scope="attention-only">[^<]*只影響注意與解讀/);
  });

  it("[archive:relations] 深層檔案索引六節都能打開，入口句已移除", () => {
    const markup = render({ kind: "archive", data: sliceArchiveIndex() });
    for (const title of ["模擬紀錄", "關係", "本命盤", "性格與習慣", "記憶", "生平"]) {
      expect(markup).toContain(`>打開${title}</button>`);
    }
    expect(markup).not.toContain("還沒有出版");
  });
});

// ---------------------------------------------------------------------------

describe("[utterance:verbatim] 原話逐字渲染", () => {
  const journal = sliceJournal();
  const relations = sliceRelations();
  const paper = slicePaper();
  const known = fixtureUtterances(journal, relations, paper);

  const pages: { name: string; markup: string }[] = [
    { name: "journal", markup: render({ kind: "journal", data: journal }) },
    { name: "relations", markup: render({ kind: "archiveRelations", data: relations }) },
    { name: "paper", markup: render({ kind: "archivePaper", data: paper }) },
  ];

  for (const { name, markup } of pages) {
    it(`[utterance:verbatim] ${name}：畫面文字的 sha256 等於 data-text-sha256，也等於 fixture 的 canonicalTextSha256`, () => {
      const utterances = renderedUtterances(markup);
      expect(utterances.length).toBeGreaterThan(0);
      for (const utterance of utterances) {
        const source = known.get(utterance.artifactId);
        expect(source, `artifact ${utterance.artifactId} must exist in the fixture`).toBeDefined();
        expect(sha256(utterance.text)).toBe(utterance.digest);
        expect(utterance.digest).toBe(source?.digest);
        expect(utterance.text).toBe(source?.text);
      }
    });
  }

  it("[utterance:verbatim] 前後有空白的原文也原封不動（不 trim、不改字）", () => {
    const base = entryOn(journal, "2026-03-03");
    const text = "  看到新的公開資訊，先小部位觀察。\n";
    const claim = {
      utteranceArtifactId: base.contemporaneousClaim?.utteranceArtifactId ?? "∅",
      canonicalTextSha256: sha256(text),
      canonicalTextUtf8: text,
      truthClass: "simulated_narrative" as const,
    };
    const page: LifeJournalPage = {
      ...journal,
      entries: [{ ...base, contemporaneousClaim: claim }],
    };
    const utterances = renderedUtterances(render({ kind: "journal", data: page }));
    const rendered = utterances.find((utterance) => utterance.digest === claim.canonicalTextSha256);
    expect(rendered?.text).toBe(text);
    expect(sha256(rendered?.text ?? "")).toBe(claim.canonicalTextSha256);
  });
});

// ---------------------------------------------------------------------------

describe("[evidence-card] 敘事沒有到的章節只渲染證據卡", () => {
  const journal = sliceJournal();
  // 2026-03-17：減碼那天。敘事段刻意保留（違約的輸入），證明畫面不會渲染它們。
  const base = entryOn(journal, "2026-03-17");
  const evidenceOnly: LifeJournalEntry = { ...base, narrativeState: "evidence_card_only" };
  const page: LifeJournalPage = { ...journal, entries: [evidenceOnly] };
  const markup = render({ kind: "journal", data: page });
  const article = articleById(markup, chapterAnchorId("2026-03-17")) ?? "";

  it("[evidence-card] 後果數字與原話逐字都在", () => {
    expect(articleOpenTag(markup, chapterAnchorId("2026-03-17"))).toContain(
      'data-narrative-state="evidence_card_only"',
    );
    expect(article).toContain('data-evidence-card="true"');
    const text = visibleText(article);
    expect(text).toContain(EVIDENCE_CARD_ONLY_NOTE);
    expect(text).toContain(base.evidenceCard.action.label);
    expect(text).toContain("−4,720.00");
    expect(text).toContain("−7,080.00");
    expect(text).toContain("虧損");
    expect(text).toContain("400");
    expect(text).toContain("88.20");
    expect(text).toContain("20.00");
    const utterances = renderedUtterances(article);
    expect(utterances.map((utterance) => utterance.artifactId)).toEqual(
      base.evidenceCard.quotedUtterances.map((quoted) => quoted.utteranceArtifactId),
    );
    for (const utterance of utterances) expect(sha256(utterance.text)).toBe(utterance.digest);
  });

  it("[evidence-card] 不渲染任何 narrative segment、九段或場景摘要", () => {
    expect(base.narrativeSegments.length).toBeGreaterThan(0);
    const text = visibleText(article);
    for (const segment of base.narrativeSegments) {
      if (segment.kind === "narrator") expect(text).not.toContain(segment.text);
    }
    expect(text).not.toContain(base.sceneSummary);
    expect(text).not.toContain(base.knownAtTheTimeSummary);
    expect(text).not.toContain(base.actionSummary);
    for (const { title } of JOURNAL_SECTION_ORDER) {
      expect(article).not.toContain(`<h4>${title}</h4>`);
    }
  });

  it("[evidence-card] 反例：同一章 composed 時九段與敘事都在，證據卡不單獨出現", () => {
    const composed = render({ kind: "journal", data: { ...journal, entries: [base] } });
    const composedArticle = articleById(composed, chapterAnchorId("2026-03-17")) ?? "";
    expect(articleOpenTag(composed, chapterAnchorId("2026-03-17"))).toContain(
      'data-narrative-state="composed"',
    );
    expect(composedArticle).not.toContain('data-evidence-card="true"');
    expect(visibleText(composedArticle)).toContain(base.sceneSummary);
  });
});

describe("[entry-held] 單章 HELD 只渲染原因標籤", () => {
  const journal = sliceJournal();
  const held: HeldLifeJournalEntry = {
    entryId: "00000000-0000-4000-8000-000000000002",
    chapterDate: "2026-03-18",
    entryVisibility: "HELD",
    heldReasonLabel: "測試：這一章因權利審查暫不公開。",
  };
  const page: LifeJournalPage = {
    ...journal,
    entries: journal.entries.filter((entry) => entry.chapterDate !== held.chapterDate),
    heldEntries: [held],
  };
  const markup = render({ kind: "journal", data: page });

  it("[entry-held] 依日期併進時間軸，只有日期與原因標籤", () => {
    const article = articleById(markup, chapterAnchorId(held.chapterDate));
    expect(article).not.toBeNull();
    expect(markup).toMatch(new RegExp(`<article[^>]*id="${chapterAnchorId(held.chapterDate)}"[^>]*data-entry-visibility="HELD"`));
    // 原因是系統說明（2.2.0）：句首固定標出「系統說明」，不掛資料身分。
    expect(visibleText(article ?? "").replace(/\s+/g, " ").trim()).toBe(
      `${held.chapterDate} ${SYSTEM_LABEL_KIND_TEXT} ${held.heldReasonLabel}`,
    );
    expect(article ?? "").toContain('data-system-label="heldReasonLabel"');
    expect(article ?? "").not.toContain("panshi-truth-tag");
    // 排在前一天之後、後一天之前。
    const before = markup.indexOf(`id="${chapterAnchorId("2026-03-17")}"`);
    const at = markup.indexOf(`id="${chapterAnchorId(held.chapterDate)}"`);
    const after = markup.indexOf(`id="${chapterAnchorId("2026-03-19")}"`);
    expect(before).toBeLessThan(at);
    expect(at).toBeLessThan(after);
  });

  it("[entry-held] 被移走的那一章內容一個字都不出現", () => {
    const removed = entryOn(journal, held.chapterDate);
    const text = visibleText(markup);
    expect(text).not.toContain(removed.sceneSummary);
    expect(text).not.toContain(removed.actionSummary);
  });
});

// ---------------------------------------------------------------------------

describe("[a11y] 無障礙等價結構", () => {
  const values: SliceData[] = [
    { kind: "world", data: sliceWorld() },
    { kind: "closeUp", data: sliceCloseUp() },
    { kind: "journal", data: sliceJournal() },
    { kind: "archive", data: sliceArchiveIndex() },
    { kind: "archivePaper", data: slicePaper() },
    { kind: "archiveRelations", data: sliceRelations() },
    { kind: "archiveChart", data: sliceChart() },
    { kind: "archiveTraits", data: sliceTraits() },
    { kind: "archiveMemories", data: sliceMemories() },
    { kind: "archiveLife", data: sliceLife() },
  ];

  for (const value of values) {
    it(`[a11y] ${value.kind}：恰好一個 h1 主標題；每個按鈕與連結都有可讀名稱；數字是文字`, () => {
      const markup = render(value);
      expect(count(markup, "<h1")).toBe(1);

      for (const match of markup.matchAll(/<(button|a)\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
        const attrs = match[2] ?? "";
        const name = visibleText(match[3] ?? "").trim() || /aria-label="([^"]+)"/.exec(attrs)?.[1] || "";
        expect(name, `unnamed control: ${match[0].slice(0, 120)}`).not.toBe("");
      }

      expect(markup).not.toMatch(/<(canvas|meter|progress)\b/);

      // 方向不只靠顏色：每個帶 data-direction 的元素裡都有方向文字。
      const chunks = markup.split('data-direction="').slice(1);
      for (const chunk of chunks) {
        // 從這個元素開始、到它的第一個區塊結尾之前，要有方向文字。
        const element = chunk.slice(0, chunk.search(/<\/p>|<\/span><\/span>/) + 1);
        expect(visibleText(element), chunk.slice(0, 160)).toMatch(/虧損|獲利|持平|資料未到/);
      }
    });
  }

  it("[a11y] 五節與人生誌的畫面元件不再放 h1／h2 與外殼的頁名競爭", () => {
    for (const value of values.filter((candidate) =>
      ["journal", "archive", "archivePaper", "archiveRelations", "archiveChart", "archiveTraits", "archiveMemories", "archiveLife"].includes(candidate.kind),
    )) {
      const markup = render(value);
      expect(count(markup, "<h1") + count(markup, "<h2"), value.kind).toBe(1);
    }
  });

  it("[a11y] 並排比較窄螢幕同順序堆疊：DOM 順序就是閱讀順序，每欄保留欄標題", () => {
    const markup = render({ kind: "archivePaper", data: slicePaper() });
    const columns = [...markup.matchAll(/data-column="([a-zA-Z]+)"><h5>([^<]*)<\/h5>/g)].map((match) => [
      match[1],
      match[2],
    ]).slice(0, CLAIM_COMPARISON_COLUMNS.length);
    expect(markup).toContain('data-compare="claim"');
    expect(columns).toEqual(CLAIM_COMPARISON_COLUMNS.map((column) => [column.key, column.title]));
  });
});
