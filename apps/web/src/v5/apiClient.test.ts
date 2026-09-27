import { afterEach, describe, expect, it, vi } from "vitest";

import {
  characterPath,
  fetchArchiveIndex,
  fetchChartArchive,
  fetchCloseUp,
  fetchLifeArchive,
  fetchLifeJournal,
  fetchMemoriesArchive,
  fetchPaperArchive,
  fetchRelationsArchive,
  fetchTraitsArchive,
  fetchWorld,
  isValidProjection,
  worldPath,
  type ApiResult,
} from "./apiClient";
import {
  SLICE_CHARACTER_ID,
  sliceChart,
  sliceLife,
  sliceMemories,
  sliceRelations,
  sliceTraits,
} from "./testing/sliceFixtures";

const CHARACTER_ID = "1f0c2a5e-6a2d-4d1b-9a3f-0c9d2f5b7e41";

const envelope = {
  projectionVersion: 1,
  sourceGlobalPosition: 42,
  serverNow: "2026-03-18T05:30:00Z",
  dataState: "READY",
  visibilityEpoch: 7,
  // The slice's market facts are a repo-owned synthetic fixture, so they are
  // never labelled `real_fact`.
  truthClasses: ["fictional_setting", "simulated_narrative"],
  sourceRevisionSet: [{ refId: "wfm_hist_001_s5", refKind: "fact_manifest", revision: 5 }],
};

const worldSnapshot = {
  ...envelope,
  marketClock: { sessionPhase: "in_session" },
  worldTickId: 618,
  scene: { sceneRef: "scene-open-hall" },
  characterPositions: [],
  storyHooks: [],
};

const closeUp = {
  ...envelope,
  characterId: CHARACTER_ID,
  displayName: "陸硯之",
  ageYears: 28,
  occupationLabel: "企業研究助理",
  sceneRef: "scene-open-hall",
  poseState: "examining",
  currentVerbPhrase: "正在重看他昨天終於減碼的那批資料",
  unresolvedTensionSummary: "他昨天終於減碼，但還沒說為什麼撐了十五天",
  unresolvedCommitments: [],
};

const journalPage = {
  ...envelope,
  characterId: CHARACTER_ID,
  appliedAudienceScope: "public_current",
  entries: [],
  heldEntries: [],
  nextCursor: null,
};

const archiveIndex = {
  ...envelope,
  characterId: CHARACTER_ID,
  archiveSchemaRevision: "archive-2026-07-23.1",
  longTermTensionSummary: "他相信自己靠證據做事",
  recentHighlights: [],
  sections: [1, 2, 3, 4, 5, 6].map((index) => ({
    sectionKey: `section-${index}`,
    viewerAudienceScope: "public_current",
    summary: "",
    asOf: "2026-03-17T05:30:00Z",
    visibilityEpoch: 7,
    sectionPath: null,
  })),
};

const paperArchive = {
  ...envelope,
  characterId: CHARACTER_ID,
  appliedAudienceScope: "free_archive",
  asOf: "2026-03-17T05:30:00Z",
  paperVersionSet: { paperAccountVersion: 9 },
  account: { currency: "TWD" },
  positions: [],
  historicalActionFills: [],
  dataRevisions: [],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubFetch(handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
  const spy = vi.fn(handler);
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("v5 public api client", () => {
  it("requests the contract paths from public-v2.yaml", async () => {
    const spy = stubFetch(async () => jsonResponse(worldSnapshot));
    await fetchWorld();
    expect(spy.mock.calls[0]?.[0]).toBe("/api/v2/world");

    stubFetch(async () => jsonResponse(closeUp));
    expect(worldPath()).toBe("/api/v2/world");
    expect(characterPath(CHARACTER_ID, "/close-up")).toBe(
      `/api/v2/characters/${CHARACTER_ID}/close-up`,
    );
    expect(characterPath(CHARACTER_ID, "/life-journal")).toBe(
      `/api/v2/characters/${CHARACTER_ID}/life-journal`,
    );
    expect(characterPath(CHARACTER_ID, "/archive/paper")).toBe(
      `/api/v2/characters/${CHARACTER_ID}/archive/paper`,
    );
  });

  it("returns ready for each complete projection", async () => {
    stubFetch(async (input) => {
      const path = String(input);
      if (path.endsWith("/world")) return jsonResponse(worldSnapshot);
      if (path.endsWith("/close-up")) return jsonResponse(closeUp);
      if (path.endsWith("/life-journal")) return jsonResponse(journalPage);
      if (path.endsWith("/archive/paper")) return jsonResponse(paperArchive);
      return jsonResponse(archiveIndex);
    });

    expect(await fetchWorld()).toEqual({ status: "ready", data: worldSnapshot });
    expect((await fetchCloseUp(CHARACTER_ID)).status).toBe("ready");
    expect((await fetchLifeJournal(CHARACTER_ID)).status).toBe("ready");
    expect((await fetchArchiveIndex(CHARACTER_ID)).status).toBe("ready");
    expect((await fetchPaperArchive(CHARACTER_ID)).status).toBe("ready");
  });

  it("accepts a withdrawal tombstone without demanding live fields", async () => {
    stubFetch(async () =>
      jsonResponse({
        ...envelope,
        dataState: "WITHDRAWN",
        characterId: CHARACTER_ID,
        tombstoneReasonLabel: "這名居民已退出世界",
      }),
    );
    expect((await fetchCloseUp(CHARACTER_ID)).status).toBe("ready");
  });

  it("surfaces the contract reasonCode from a Problem body", async () => {
    stubFetch(async () =>
      new Response(
        JSON.stringify({
          type: "/problems/unknown-resource",
          title: "找不到這個資源",
          status: 404,
          reasonCode: "UNKNOWN_RESOURCE",
          traceId: "0e0b0f4d-7d0f-4d5e-9a2c-8b4c2f0a1d33",
        }),
        { status: 404, headers: { "Content-Type": "application/problem+json" } },
      ),
    );

    expect(await fetchWorld()).toEqual({
      status: "unavailable",
      reasonCode: "UNKNOWN_RESOURCE",
      httpStatus: 404,
    });
  });

  it("does not trust an unrecognised error body", async () => {
    stubFetch(async () => jsonResponse({ reasonCode: "SOMETHING_ELSE" }, 503));
    expect(await fetchWorld()).toEqual({
      status: "unavailable",
      reasonCode: "UNRECOGNIZED_RESPONSE",
      httpStatus: 503,
    });
  });

  it("reports unparseable success bodies instead of guessing", async () => {
    stubFetch(async () =>
      new Response("<html>not json</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    );
    expect(await fetchWorld()).toEqual({
      status: "unavailable",
      reasonCode: "MALFORMED_PAYLOAD",
      httpStatus: 200,
    });
  });

  it("fails closed on a projection missing a contract-required field", async () => {
    const cases: readonly [string, unknown][] = [
      ["missing dataState", { ...worldSnapshot, dataState: undefined }],
      ["unknown dataState", { ...worldSnapshot, dataState: "MAYBE" }],
      ["empty truthClasses", { ...worldSnapshot, truthClasses: [] }],
      ["unknown truthClass", { ...worldSnapshot, truthClasses: ["vibes"] }],
      ["missing scene", { ...worldSnapshot, scene: undefined }],
      ["missing sourceRevisionSet", { ...worldSnapshot, sourceRevisionSet: undefined }],
      ["empty object", {}],
      ["array body", []],
    ];

    for (const [label, body] of cases) {
      stubFetch(async () => jsonResponse(body));
      const result = await fetchWorld();
      expect(result, label).toEqual({
        status: "unavailable",
        reasonCode: "INCOMPLETE_PROJECTION",
        httpStatus: 200,
      });
    }
  });

  it("fails closed when a character projection omits its live fields", async () => {
    stubFetch(async () => jsonResponse({ ...closeUp, unresolvedTensionSummary: undefined }));
    expect((await fetchCloseUp(CHARACTER_ID)).status).toBe("unavailable");

    stubFetch(async () => jsonResponse({ ...journalPage, nextCursor: undefined }));
    expect((await fetchLifeJournal(CHARACTER_ID)).status).toBe("unavailable");

    stubFetch(async () => jsonResponse({ ...archiveIndex, sections: [] }));
    expect((await fetchArchiveIndex(CHARACTER_ID)).status).toBe("unavailable");

    stubFetch(async () => jsonResponse({ ...paperArchive, paperVersionSet: undefined }));
    expect((await fetchPaperArchive(CHARACTER_ID)).status).toBe("unavailable");
  });

  it("reports transport failure as error, not as an empty projection", async () => {
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await fetchWorld()).toEqual({ status: "error" });
  });

  it("passes the abort signal through and reports aborts as error", async () => {
    const controller = new AbortController();
    const spy = stubFetch(async (_input, init) => {
      if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      return jsonResponse(worldSnapshot);
    });

    controller.abort();
    expect(await fetchWorld(controller.signal)).toEqual({ status: "error" });
    expect(spy.mock.calls[0]?.[1]?.signal).toBe(controller.signal);
  });
});

// ---------------------------------------------------------------------------
// 深層檔案其餘五節的 fail-closed validator：用切片產生器輸出的真 fixture。
// ---------------------------------------------------------------------------

type JsonRecord = Record<string, unknown>;

/** 深拷貝後交給 `mutate` 動手腳，原 fixture 不被污染。 */
function mutated<T>(value: T, mutate: (copy: JsonRecord) => void): JsonRecord {
  const copy = JSON.parse(JSON.stringify(value)) as JsonRecord;
  mutate(copy);
  return copy;
}

function firstOf(record: JsonRecord, key: string): JsonRecord {
  const list = record[key];
  if (!Array.isArray(list) || list.length === 0) throw new Error(`fixture has no ${key}`);
  return list[0] as JsonRecord;
}

type SectionCase = {
  key: "relations" | "chart" | "traits" | "memories" | "life";
  kind: "archiveRelations" | "archiveChart" | "archiveTraits" | "archiveMemories" | "archiveLife";
  fixture: () => unknown;
  fetch: (characterId: string) => Promise<ApiResult<unknown>>;
  /** 拿掉一個 item 層級的必填欄位（truthClass／sourceRefs／內容字串）。 */
  breakItem: (copy: JsonRecord) => void;
  /** 清空一個清單卻不附原因（或反過來）。 */
  breakEmptyReason: (copy: JsonRecord) => void;
};

const SECTION_CASES: readonly SectionCase[] = [
  {
    key: "relations",
    kind: "archiveRelations",
    fixture: sliceRelations,
    fetch: fetchRelationsArchive,
    breakItem: (copy) => {
      delete firstOf(firstOf(copy, "acquaintances"), "observedInteractions")["truthClass"];
    },
    breakEmptyReason: (copy) => {
      copy["acquaintances"] = [];
      copy["acquaintancesEmptyReason"] = null;
    },
  },
  {
    key: "chart",
    kind: "archiveChart",
    fixture: sliceChart,
    fetch: fetchChartArchive,
    breakItem: (copy) => {
      firstOf(firstOf(copy, "motifs"), "invocations")["sourceRefs"] = [];
    },
    breakEmptyReason: (copy) => {
      copy["placementsEmptyReason"] = null;
    },
  },
  {
    key: "traits",
    kind: "archiveTraits",
    fixture: sliceTraits,
    fetch: fetchTraitsArchive,
    breakItem: (copy) => {
      delete firstOf(copy, "biasOccurrences")["biasLabel"];
    },
    breakEmptyReason: (copy) => {
      copy["counterExamplesEmptyReason"] = "明明有反例卻附了空清單原因";
    },
  },
  {
    key: "memories",
    kind: "archiveMemories",
    fixture: sliceMemories,
    fetch: fetchMemoriesArchive,
    breakItem: (copy) => {
      firstOf(copy, "memories")["truthClass"] = "gossip";
    },
    breakEmptyReason: (copy) => {
      firstOf(copy, "memories")["reinterpretationsEmptyReason"] = null;
    },
  },
  {
    key: "life",
    kind: "archiveLife",
    fixture: sliceLife,
    fetch: fetchLifeArchive,
    breakItem: (copy) => {
      (copy["identity"] as JsonRecord)["adultFictionalResident"] = false;
    },
    breakEmptyReason: (copy) => {
      delete copy["joinedWorldOn"];
    },
  },
];

describe("深層檔案五節的 fail-closed validator", () => {
  for (const testCase of SECTION_CASES) {
    it(`[archive:${testCase.key}] 真 fixture 通過契約檢查，打的是 /archive/${testCase.key}`, async () => {
      const fixture = testCase.fixture();
      const spy = stubFetch(async () => jsonResponse(fixture));
      const result = await testCase.fetch(SLICE_CHARACTER_ID);
      expect(result).toEqual({ status: "ready", data: fixture });
      expect(spy.mock.calls[0]?.[0]).toBe(
        `/api/v2/characters/${SLICE_CHARACTER_ID}/archive/${testCase.key}`,
      );
      expect(isValidProjection(testCase.kind, fixture)).toBe(true);
    });

    it(`[archive:${testCase.key}] 缺頂層必填欄位、item 缺身分或內容、空清單原因不一致都是 INCOMPLETE_PROJECTION`, async () => {
      const fixture = testCase.fixture();
      const broken = [
        mutated(fixture, (copy) => {
          delete copy["asOf"];
        }),
        mutated(fixture, (copy) => {
          copy["sectionKey"] = testCase.key === "life" ? "chart" : "life";
        }),
        mutated(fixture, (copy) => {
          copy["truthClasses"] = [];
        }),
        mutated(fixture, testCase.breakItem),
        mutated(fixture, testCase.breakEmptyReason),
      ];
      for (const body of broken) {
        expect(isValidProjection(testCase.kind, body)).toBe(false);
        stubFetch(async () => jsonResponse(body));
        expect(await testCase.fetch(SLICE_CHARACTER_ID)).toEqual({
          status: "unavailable",
          reasonCode: "INCOMPLETE_PROJECTION",
          httpStatus: 200,
        });
      }
    });

    it(`[archive:${testCase.key}] 退出後的 tombstone 不要求五節欄位`, async () => {
      const tombstone = {
        ...envelope,
        characterId: SLICE_CHARACTER_ID,
        dataState: "WITHDRAWN",
        tombstoneReasonLabel: "這名居民依設定離開了這座城市。",
      };
      stubFetch(async () => jsonResponse(tombstone));
      expect((await testCase.fetch(SLICE_CHARACTER_ID)).status).toBe("ready");
    });
  }
});
