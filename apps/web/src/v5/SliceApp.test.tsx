// 七種資料狀態（loading／empty／stale／held／corrected／withdrawn／offline）的 node 端
// 渲染測試。apps/web 沒有 jsdom、也不加依賴，所以一律用 `react-dom/server` 的
// `renderToStaticMarkup` 渲染純呈現的 `SliceView`，資料全部來自 `testing/fixtureFactory`。

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EMPTY_POSITION_TEXT } from "./paperCard";
import { SliceApp, SliceView, dataTimeOf, loadRoute, type Loadable, type SliceData } from "./SliceApp";
import { createLastKnownCache } from "./lastKnownCache";
import type { Route } from "./router";
import {
  DATA_REVISION_KIND_LABEL,
  DATA_STATE_LABEL,
  EMPTY_STATE_COPY,
  FAIL_CLOSED_NOTE,
  PAPER_CORRECTIONS_ANCHOR,
  STATE_HEADING_ID,
} from "./statePanels";
import {
  TEST_AS_OF,
  TEST_CHARACTER_ID,
  TEST_SERVER_NOW,
  archiveIndex,
  closeUp,
  dataRevision,
  journalEntry,
  lifeJournal,
  paperArchive,
  paperPosition,
  tombstone,
  world,
  worldPosition,
} from "./testing/fixtureFactory";

const SENTINEL = "SENTINEL-不得出現-7f3c";

const ROUTES = {
  world: { kind: "world" },
  closeUp: { kind: "closeUp", characterId: TEST_CHARACTER_ID },
  journal: { kind: "journal", characterId: TEST_CHARACTER_ID },
  archive: { kind: "archive", characterId: TEST_CHARACTER_ID },
  archivePaper: { kind: "archivePaper", characterId: TEST_CHARACTER_ID },
  archiveRelations: { kind: "archiveRelations", characterId: TEST_CHARACTER_ID },
  archiveChart: { kind: "archiveChart", characterId: TEST_CHARACTER_ID },
  archiveTraits: { kind: "archiveTraits", characterId: TEST_CHARACTER_ID },
  archiveMemories: { kind: "archiveMemories", characterId: TEST_CHARACTER_ID },
  archiveLife: { kind: "archiveLife", characterId: TEST_CHARACTER_ID },
} as const satisfies Record<SliceData["kind"], Route>;

function render(
  state: Loadable,
  options: { route?: Route; online?: boolean; reducedMotion?: boolean } = {},
): string {
  const route =
    options.route ??
    (state.phase === "ready" || state.phase === "offline" ? ROUTES[state.value.kind] : ROUTES.world);
  return withoutStyles(
    renderToStaticMarkup(
      <SliceView
        route={route}
        state={state}
        online={options.online ?? true}
        reducedMotion={options.reducedMotion ?? false}
        navigate={() => {}}
      />,
    ),
  );
}

/** `<style>` 內的 CSS 選擇器也含 class 名；斷言只看真正的元素。 */
function withoutStyles(markup: string): string {
  return markup.replace(/<style>[\s\S]*?<\/style>/g, "");
}

function ready(value: SliceData): Loadable {
  return { phase: "ready", value };
}

/** 外殼唯一的 live region 裡播報的文字。 */
function announcementOf(markup: string): string {
  const match = /<p aria-live="polite" role="status" class="v5-meta">([^<]*)<\/p>/.exec(markup);
  if (match === null) throw new Error("missing aria-live status region");
  return match[1] ?? "";
}

function indexOfOrFail(markup: string, needle: string): number {
  const index = markup.indexOf(needle);
  expect(index, `expected markup to contain ${needle}`).toBeGreaterThanOrEqual(0);
  return index;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("[state:loading] 載入中", () => {
  it("[state:loading] aria-busy、標題「載入中」、live region 播報，標題可聚焦", () => {
    const markup = render({ phase: "loading" });
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain(`id="${STATE_HEADING_ID}" tabindex="-1"`);
    expect(markup).toMatch(/<h2[^>]*>載入中<\/h2>/);
    expect(announcementOf(markup)).toBe("公共世界：載入中。");
  });

  it("[state:loading] 動效開啟時才有 v5-busy；reduced motion 不加動畫 class", () => {
    expect(render({ phase: "loading" }, { reducedMotion: false })).toContain('class="v5-busy"');
    const reduced = render({ phase: "loading" }, { reducedMotion: true });
    expect(reduced).not.toContain("v5-busy");
    expect(reduced).toMatch(/<h2[^>]*>載入中<\/h2>/);
  });

  it("[state:loading] SliceApp 初次 render 不碰 window／matchMedia（node 無 window）", () => {
    expect(typeof window).toBe("undefined");
    const markup = withoutStyles(renderToStaticMarkup(<SliceApp />));
    expect(markup).toContain('aria-busy="true"');
    expect(announcementOf(markup)).toBe("公共世界：載入中。");
  });
});

describe("[state:empty] 本來就是空的", () => {
  it("[state:empty] 人生誌沒有章節：typed 空狀態並說明為什麼", () => {
    const markup = render(ready({ kind: "journal", data: lifeJournal({ entries: [] }) }));
    expect(markup).toContain('data-empty-reason="journal_no_chapters"');
    expect(markup).toContain(EMPTY_STATE_COPY.journal_no_chapters.why);
    expect(markup).not.toContain("v5-journal__chapter");
    expect(announcementOf(markup)).toContain(EMPTY_STATE_COPY.journal_no_chapters.title);
  });

  it("[state:empty] 有章節時不是空狀態（反例）", () => {
    const markup = render(ready({ kind: "journal", data: lifeJournal() }));
    expect(markup).not.toContain('data-state="empty"');
    expect(markup).toContain("v5-journal__chapter");
  });

  it("[state:empty] 世界沒有居民位置：專門的空世界面板，不畫空舞台", () => {
    const markup = render(ready({ kind: "world", data: world({ characterPositions: [] }) }));
    expect(markup).toContain('data-empty-reason="world_no_residents"');
    expect(markup).toContain(EMPTY_STATE_COPY.world_no_residents.why);
    expect(markup).not.toContain('class="v5-stage"');
    expect(announcementOf(markup)).toContain(EMPTY_STATE_COPY.world_no_residents.title);

    const populated = render(
      ready({ kind: "world", data: world({ characterPositions: [worldPosition()] }) }),
    );
    expect(populated).not.toContain('data-state="empty"');
    expect(populated).toContain('class="v5-stage"');
  });

  it("[state:empty] 模擬紀錄沒有部位：用 EMPTY_POSITION_TEXT 並說明為什麼，不用 0 冒充", () => {
    const markup = render(ready({ kind: "archivePaper", data: paperArchive({ positions: [] }) }));
    expect(markup).toContain('data-empty-reason="paper_no_positions"');
    expect(markup).toContain(EMPTY_POSITION_TEXT);
    expect(markup).toContain(EMPTY_STATE_COPY.paper_no_positions.why);
    expect(markup).not.toContain("v5-paper__card");
  });
});

describe("[state:stale] 過期", () => {
  it("[state:stale] 過期橫幅排在第一個內容標題與鉤子句之前，並顯示資料時間", () => {
    const markup = render(ready({ kind: "journal", data: lifeJournal({ dataState: "STALE" }) }));
    const banner = indexOfOrFail(markup, 'data-state="stale"');
    const firstContentHeading = indexOfOrFail(markup, '<h3 class="v5-journal__date');
    const hook = indexOfOrFail(markup, 'class="v5-hook');
    expect(banner).toBeLessThan(firstContentHeading);
    expect(banner).toBeLessThan(hook);
    expect(markup).toContain(TEST_SERVER_NOW);
    expect(markup).toContain(DATA_STATE_LABEL.STALE);
    expect(announcementOf(markup)).toContain(`資料時間 ${TEST_SERVER_NOW}`);
  });

  it("[state:stale] 模擬紀錄用整份的 asOf 當資料時間", () => {
    const markup = render(
      ready({ kind: "archivePaper", data: paperArchive({ dataState: "STALE", serverNow: TEST_SERVER_NOW }) }),
    );
    const banner = indexOfOrFail(markup, 'data-state="stale"');
    expect(banner).toBeLessThan(indexOfOrFail(markup, "<h3>模擬帳戶</h3>"));
    expect(markup.slice(banner, markup.indexOf("</section>", banner))).toContain(TEST_AS_OF);
  });

  it("[state:stale] READY 沒有過期橫幅（反例）", () => {
    expect(render(ready({ kind: "journal", data: lifeJournal() }))).not.toContain('data-state="stale"');
  });

  it("[state:stale] 世界用 marketClock.asOfTradingDate 當資料時間，不是 serverNow", () => {
    // 世界快照的 `asOfTradingDate`（前一個定案交易日）才是「資料本身」凍結在哪一天；
    // `serverNow` 只是回應當下的時鐘，過期橫幅講的是前者（one-character-slice-runbook.md §6.6）。
    const markup = render(ready({ kind: "world", data: world({ dataState: "STALE" }) }));
    const banner = indexOfOrFail(markup, 'data-state="stale"');
    const bannerMarkup = markup.slice(banner, markup.indexOf("</section>", banner));
    expect(bannerMarkup).toContain("2026-03-17");
    expect(bannerMarkup).not.toContain(TEST_SERVER_NOW);
  });

  it("[state:stale] dataTimeOf：世界沒有任何定案交易日（asOfTradingDate 為 null）才退回 serverNow", () => {
    expect(
      dataTimeOf({ kind: "world", data: world({ dataState: "STALE", marketClock: { marketDate: "2026-03-18", sessionPhase: "pre_market", asOfTradingDate: null, nextBoundaryAt: "2026-03-18T09:00:00+08:00" } }) }),
    ).toBe(TEST_SERVER_NOW);
  });
});

describe("[state:held] 頁面層級覆核", () => {
  const heldCases: readonly SliceData[] = [
    {
      kind: "world",
      data: world({
        dataState: "HELD",
        storyHooks: [
          {
            hookId: "h-1",
            characterId: TEST_CHARACTER_ID,
            sceneRef: "s-1",
            label: SENTINEL,
            labelTruthClass: "simulated_narrative",
          },
        ],
      }),
    },
    {
      kind: "closeUp",
      data: closeUp({
        dataState: "HELD",
        displayName: SENTINEL,
        currentVerbPhrase: SENTINEL,
        unresolvedTensionSummary: SENTINEL,
      }),
    },
    {
      kind: "journal",
      data: lifeJournal({
        dataState: "HELD",
        entries: [journalEntry({ sceneSummary: SENTINEL, actionSummary: SENTINEL })],
      }),
    },
    {
      kind: "archive",
      data: archiveIndex({ dataState: "HELD", longTermTensionSummary: SENTINEL, recentHighlights: [SENTINEL] }),
    },
    {
      kind: "archivePaper",
      data: paperArchive({
        dataState: "HELD",
        positions: [paperPosition({ consequenceSummary: SENTINEL, rationaleSummary: SENTINEL })],
        dataRevisions: [dataRevision({ summary: SENTINEL })],
      }),
    },
  ];

  it.each(heldCases.map((value) => [value.kind, value] as const))(
    "[state:held] %s：不渲染任何內容（sentinel 不出現），只有覆核說明與 FAIL_CLOSED_NOTE",
    (_kind, value) => {
      const markup = render(ready(value));
      expect(markup).not.toContain(SENTINEL);
      expect(markup).toContain('data-state="held"');
      expect(markup).toContain(DATA_STATE_LABEL.HELD);
      expect(markup).toContain(FAIL_CLOSED_NOTE);
      expect(markup).not.toContain("v5-hook");
      expect(markup).not.toContain("資料稽核資訊");
      expect(announcementOf(markup)).toContain(DATA_STATE_LABEL.HELD);
    },
  );

  it("[state:held] 同一份資料在 READY 時 sentinel 會出現（證明 sentinel 真的放在內容欄位）", () => {
    const value: SliceData = { kind: "closeUp", data: closeUp({ currentVerbPhrase: SENTINEL }) };
    expect(render(ready(value))).toContain(SENTINEL);
  });
});

describe("[state:corrected] 更正", () => {
  it("[state:corrected] 模擬紀錄：頂部橫幅列出 dataRevisions 的 kind 與 summary，並有更正段落錨點", () => {
    const revision = dataRevision({ kind: "fact_correction", summary: "測試更正：一筆公告日期已改正。" });
    const markup = render(
      ready({ kind: "archivePaper", data: paperArchive({ dataState: "CORRECTED", dataRevisions: [revision] }) }),
    );
    const banner = indexOfOrFail(markup, 'data-state="corrected"');
    expect(banner).toBeLessThan(indexOfOrFail(markup, "<h3>模擬帳戶</h3>"));
    const bannerMarkup = markup.slice(banner, markup.indexOf("</section>", banner));
    expect(bannerMarkup).toContain(DATA_REVISION_KIND_LABEL.fact_correction);
    expect(bannerMarkup).toContain(revision.summary);
    expect(markup).toContain(`id="${PAPER_CORRECTIONS_ANCHOR}"`);
    expect(markup).toContain(`href="#${PAPER_CORRECTIONS_ANCHOR}"`);
    expect(announcementOf(markup)).toContain(DATA_STATE_LABEL.CORRECTED);
  });

  it("[state:corrected] 模擬紀錄標記更正卻沒有附說明：fail closed", () => {
    const markup = render(
      ready({ kind: "archivePaper", data: paperArchive({ dataState: "CORRECTED", dataRevisions: [] }) }),
    );
    expect(markup).toContain("沒有附上更正說明");
    expect(markup).toContain(FAIL_CLOSED_NOTE);
  });

  it("[state:corrected] 近景：橫幅本體是人話說法，原始 refKind／refId 只在可展開的稽核抽屜裡", () => {
    const markup = render(
      ready({
        kind: "closeUp",
        data: closeUp({
          dataState: "CORRECTED",
          sourceRevisionSet: [{ refId: "wfm_corrected_s6", refKind: "world_fact_manifest", revision: 6 }],
        }),
      }),
    );
    const banner = indexOfOrFail(markup, 'data-state="corrected"');
    expect(banner).toBeLessThan(indexOfOrFail(markup, 'class="v5-hook'));

    const detailsStart = indexOfOrFail(markup, "<details");
    const detailsEnd = indexOfOrFail(markup, "</details>");
    // 人話說法在 <details> 之外就看得到；原始 id 只出現在 <details> 裡面。
    expect(markup.slice(banner, detailsStart)).toContain("世界事實清單");
    expect(markup.slice(banner, detailsStart)).not.toContain("wfm_corrected_s6");
    expect(markup.indexOf("wfm_corrected_s6")).toBeGreaterThan(detailsStart);
    expect(markup.indexOf("wfm_corrected_s6")).toBeLessThan(detailsEnd);
    expect(markup).toContain(
      `href="/people/${TEST_CHARACTER_ID}/archive/paper#${PAPER_CORRECTIONS_ANCHOR}"`,
    );
  });

  it("[state:corrected] 沒收錄過的 refKind 落 fallback 說法，不是原始字串", () => {
    const markup = render(
      ready({
        kind: "closeUp",
        data: closeUp({
          dataState: "CORRECTED",
          sourceRevisionSet: [{ refId: "future-ref-001", refKind: "not_yet_known_kind", revision: 1 }],
        }),
      }),
    );
    const banner = indexOfOrFail(markup, 'data-state="corrected"');
    const detailsStart = indexOfOrFail(markup, "<details");
    expect(markup.slice(banner, detailsStart)).toContain("其他來源資料");
    expect(markup.slice(banner, detailsStart)).not.toContain("not_yet_known_kind");
  });

  it("[state:corrected] 世界不屬於某一位人物：橫幅本體是人話說法，原始 id 只在稽核抽屜裡", () => {
    const markup = render(ready({ kind: "world", data: world({ dataState: "CORRECTED" }) }));
    expect(markup).toContain('data-state="corrected"');
    const detailsStart = indexOfOrFail(markup, "<details");
    expect(markup.slice(0, detailsStart)).toContain("世界事實清單");
    expect(markup.indexOf("wfm_test_s5")).toBeGreaterThan(detailsStart);
    expect(markup).not.toContain(`#${PAPER_CORRECTIONS_ANCHOR}`);
  });
});

describe("[state:withdrawn] 退出", () => {
  const labels = [
    "測試退出說明：這名居民依設定離開了這座城市。",
    "另一段測試退出說明：他把店收了，搬去南部。",
  ];

  it.each(labels)("[state:withdrawn] 逐字渲染 tombstoneReasonLabel：%s", (label) => {
    for (const kind of ["closeUp", "journal", "archive", "archivePaper"] as const) {
      const markup = render(ready({ kind, data: tombstone({ tombstoneReasonLabel: label }) }));
      expect(markup).toContain(label);
      expect(markup).toContain('data-state="withdrawn"');
      expect(markup).toContain(FAIL_CLOSED_NOTE);
      // 不渲染任何 live 內容：沒有鉤子句、沒有任何畫面本體。
      expect(markup).not.toContain("v5-hook");
      expect(markup).not.toMatch(/class="v5-(closeup|journal|archive|paper)"/);
      expect(announcementOf(markup)).toContain(DATA_STATE_LABEL.WITHDRAWN);
    }
  });

  it("[state:withdrawn] 資料身分仍在（每個對外宣稱帶 truth_class）", () => {
    const markup = render(ready({ kind: "closeUp", data: tombstone() }));
    expect(markup).toContain('aria-label="本頁事實類別"');
    expect(markup).toContain("虛構設定");
  });
});

describe("[state:offline] 離線與上次載入的版本", () => {
  const route = ROUTES.journal;

  it("[state:offline] 有快取：顯示快取內容，最前面加「離線中，顯示你上次載入的版本（截至 …）」", async () => {
    const cache = createLastKnownCache(memoryStorage);
    const cachedPage = lifeJournal({ entries: [journalEntry({ sceneSummary: "上次載入時看到的那一章。" })] });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse(cachedPage)));
    const first = await loadRoute(route, new AbortController().signal, cache);
    expect(first?.phase).toBe("ready");

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network down")));
    const state = await loadRoute(route, new AbortController().signal, cache);
    expect(state?.phase).toBe("offline");
    if (state === null) throw new Error("unreachable");

    const markup = render(state);
    const banner = indexOfOrFail(markup, `離線中，顯示你上次載入的版本（截至 ${TEST_SERVER_NOW}）`);
    const content = indexOfOrFail(markup, "上次載入時看到的那一章。");
    expect(banner).toBeLessThan(content);
    expect(banner).toBeLessThan(indexOfOrFail(markup, '<h3 class="v5-journal__date'));
    expect(markup).not.toContain("讀取失敗");
    expect(announcementOf(markup)).toContain("離線中，顯示你上次載入的版本");
  });

  it("[state:offline] 沒有快取：才顯示讀取失敗面板", async () => {
    const cache = createLastKnownCache(memoryStorage);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network down")));
    const state = await loadRoute(route, new AbortController().signal, cache);
    expect(state).toEqual({ phase: "error" });
    if (state === null) throw new Error("unreachable");

    const markup = render(state);
    expect(markup).toMatch(/<h2[^>]*>讀取失敗<\/h2>/);
    expect(markup).not.toContain("顯示你上次載入的版本");
    expect(announcementOf(markup)).toContain("讀取失敗");
  });

  it("[state:offline] 快取內容不再符合契約（被竄改或舊版形狀）：當作沒有快取", async () => {
    const storage = memoryStorage();
    storage.setItem(`panshi.v5.lastKnown:/people/${TEST_CHARACTER_ID}/journal`, JSON.stringify({ entries: [] }));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network down")));
    const state = await loadRoute(route, new AbortController().signal, createLastKnownCache(() => storage));
    expect(state).toEqual({ phase: "error" });
  });

  it("[state:offline] 伺服器明確說不可見（410 WITHDRAWN）時不得用快取蓋過去", async () => {
    const cache = createLastKnownCache(memoryStorage);
    cache.remember(`/people/${TEST_CHARACTER_ID}/journal`, lifeJournal());
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ type: "t", title: "gone", status: 410, reasonCode: "WITHDRAWN", traceId: "x" }, 410),
      ),
    );
    const state = await loadRoute(route, new AbortController().signal, cache);
    expect(state).toEqual({ phase: "unavailable", reasonCode: "WITHDRAWN", httpStatus: 410 });
  });

  it("[state:offline] 裝置離線但畫面上還是上次載入的內容：同樣加離線橫幅在最前面", () => {
    const markup = render(ready({ kind: "journal", data: lifeJournal() }), { online: false });
    const banner = indexOfOrFail(markup, "離線中，顯示你上次載入的版本");
    expect(banner).toBeLessThan(indexOfOrFail(markup, '<h3 class="v5-journal__date'));
    expect(markup).not.toContain("目前沒有連線。世界仍在繼續");
  });

  it("[state:offline] 裝置離線又沒有任何版本：離線面板加讀取失敗面板", () => {
    const markup = render({ phase: "error" }, { online: false });
    expect(markup).toContain("目前沒有連線。世界仍在繼續");
    expect(markup).toMatch(/<h2[^>]*>讀取失敗<\/h2>/);
    expect(announcementOf(markup)).toContain("離線，沒有取得投影");
  });

  it("[state:offline] storage unavailable：sessionStorage 丟例外時照常渲染（有記憶體快取就用、沒有就讀取失敗）", async () => {
    const throwing = {
      getItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("quota", "QuotaExceededError");
      },
    };

    // 同一個實例：寫 storage 失敗但記憶體仍有，離線時照樣讀得到。
    const cache = createLastKnownCache(() => throwing);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(jsonResponse(lifeJournal())));
    expect((await loadRoute(route, new AbortController().signal, cache))?.phase).toBe("ready");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network down")));
    const recovered = await loadRoute(route, new AbortController().signal, cache);
    expect(recovered?.phase).toBe("offline");

    // 新的實例（等同重新整理），storage 取用本身就丟例外：沒有快取 → 讀取失敗面板。
    const fresh = createLastKnownCache(() => {
      throw new DOMException("storage disabled", "SecurityError");
    });
    const state = await loadRoute(route, new AbortController().signal, fresh);
    expect(state).toEqual({ phase: "error" });
    if (state === null) throw new Error("unreachable");
    expect(render(state)).toMatch(/<h2[^>]*>讀取失敗<\/h2>/);
  });
});

describe("a11y：每種狀態都走 live region，狀態不只靠顏色", () => {
  it("非 READY 狀態都有文字標題與 data-state，標題可聚焦", () => {
    const cases: readonly [string, string][] = [
      [render({ phase: "loading" }), "loading"],
      [render(ready({ kind: "journal", data: lifeJournal({ dataState: "STALE" }) })), "stale"],
      [render(ready({ kind: "journal", data: lifeJournal({ dataState: "HELD" }) })), "held"],
      [render(ready({ kind: "journal", data: lifeJournal({ dataState: "CORRECTED" }) })), "corrected"],
      [render(ready({ kind: "journal", data: tombstone() })), "withdrawn"],
      [render({ phase: "offline", value: { kind: "journal", data: lifeJournal() } }), "offline"],
    ];
    for (const [markup, state] of cases) {
      expect(markup).toContain(`data-state="${state}"`);
      expect(markup).toMatch(new RegExp(`data-state="${state}"[^>]*><h2 id="${STATE_HEADING_ID}" tabindex="-1"[^>]*>[^<]+</h2>`));
      expect(announcementOf(markup).length).toBeGreaterThan(0);
    }
  });
});
