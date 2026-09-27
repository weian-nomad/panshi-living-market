// 七種資料狀態渲染測試專用的最小投影工廠。
//
// 只用 generated-v2 型別組出**最終形狀**的文件，不讀 `fixtures/v5`（那些檔案由
// 切片產生器擁有，測試不能依賴它們的當下內容）。每個工廠都能指定 `dataState`、
// 空集合與任意欄位；`tombstone()` 產生退出後的穩定深連結投影。
//
// 人物、標的與文字全部是虛構的測試資料，角色是成年人。

import type {
  CharacterArchiveIndex,
  CharacterCloseUp,
  CharacterWorldPosition,
  DataRevisionNote,
  DataState,
  LifeJournalEntry,
  LifeJournalPage,
  PaperArchiveProjection,
  PaperPositionPublic,
  SourceRevisionRef,
  TruthClass,
  WithdrawnCharacterProjection,
  WorldSnapshot,
} from "../../api/generated-v2/types.gen";

export const TEST_CHARACTER_ID = "7d2b9c1e-4f3a-4e8b-9c0d-1a2b3c4d5e6f";
export const TEST_SERVER_NOW = "2026-03-18T10:30:00+08:00";
export const TEST_AS_OF = "2026-03-17T13:30:00+08:00";

const DIGEST = "1f3a5c7e9b2d4f6a8c0e1b3d5f7a9c2e4b6d8f0a1c3e5b7d9f2a4c6e8b0d1f3a";

const TRUTH_CLASSES: TruthClass[] = ["fictional_setting", "simulated_narrative"];

const SOURCE_REVISIONS: SourceRevisionRef[] = [
  { refId: "wfm_test_s5", refKind: "world_fact_manifest", revision: 5 },
];

type Envelope = {
  projectionVersion: number;
  sourceGlobalPosition: number;
  serverNow: string;
  dataState: DataState;
  visibilityEpoch: number;
  truthClasses: TruthClass[];
  sourceRevisionSet: SourceRevisionRef[];
};

function envelope(dataState: DataState = "READY"): Envelope {
  return {
    projectionVersion: 12,
    sourceGlobalPosition: 340,
    serverNow: TEST_SERVER_NOW,
    dataState,
    visibilityEpoch: 3,
    truthClasses: [...TRUTH_CLASSES],
    sourceRevisionSet: SOURCE_REVISIONS.map((ref) => ({ ...ref })),
  };
}

export function worldPosition(overrides: Partial<CharacterWorldPosition> = {}): CharacterWorldPosition {
  return {
    characterId: TEST_CHARACTER_ID,
    worldX: 40,
    worldY: 30,
    poseState: "examining",
    poseStateTruthClass: "simulated_narrative",
    focusHint: null,
    focusHintTruthClass: null,
    zOrder: 1,
    sceneLayer: "midground",
    detailTier: "high_detail",
    sourceEventRefs: [],
    ...overrides,
  };
}

export function world(overrides: Partial<WorldSnapshot> = {}): WorldSnapshot {
  return {
    ...envelope(),
    marketClock: {
      marketDate: "2026-03-18",
      sessionPhase: "in_session",
      asOfTradingDate: "2026-03-17",
      nextBoundaryAt: "2026-03-18T13:30:00+08:00",
    },
    worldTickId: 88,
    scene: { sceneId: "0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f", activePriorityEventRefs: [] },
    characterPositions: [worldPosition()],
    storyHooks: [
      {
        hookId: "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b",
        characterId: TEST_CHARACTER_ID,
        sceneRef: "0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f",
        label: "測試居民在開盤廳又翻開了同一份資料。",
        labelTruthClass: "simulated_narrative",
      },
    ],
    ...overrides,
  };
}

export function closeUp(overrides: Partial<CharacterCloseUp> = {}): CharacterCloseUp {
  return {
    ...envelope(),
    characterId: TEST_CHARACTER_ID,
    displayName: "測試居民",
    displayNameTruthClass: "fictional_setting",
    ageYears: 34,
    ageYearsTruthClass: "fictional_setting",
    occupationLabel: "測試用職業",
    occupationLabelTruthClass: "fictional_setting",
    sceneRef: "0c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f",
    poseState: "examining",
    poseStateTruthClass: "simulated_narrative",
    currentVerbPhrase: "正在重看一份測試資料",
    currentVerbPhraseTruthClass: "simulated_narrative",
    unresolvedTensionSummary: "他說不在意，卻又看了第三次。",
    unresolvedTensionSummaryTruthClass: "simulated_narrative",
    unresolvedCommitments: [],
    ...overrides,
  };
}

export function journalEntry(overrides: Partial<LifeJournalEntry> = {}): LifeJournalEntry {
  return {
    entryId: "3f6f8b6e-8f3c-4a67-9d6d-0f3f7f1f2a11",
    chapterDate: "2026-03-17",
    entryVisibility: "PUBLIC",
    narrativeState: "composed",
    narrativeSegments: [],
    sceneSummary: "他在開盤後又打開了同一份測試資料。",
    sceneSummaryTruthClass: "simulated_narrative",
    knownAtTheTimeSummary: "他當時看過昨天的公告附註。",
    knownAtTheTimeSummaryTruthClass: "simulated_narrative",
    actionSummary: "他沒有新增紙上動作。",
    actionSummaryTruthClass: "simulated_narrative",
    consequence: {},
    evidenceCard: {
      action: {
        kind: "NO_ACTION",
        label: "沒有下單",
        truthClass: "simulated_narrative",
        sourceRefs: [
          {
            kind: "canonical_event",
            eventType: "AutonomousActionIntentCommitted",
            globalPosition: 1,
            refId: "4c1d2e3f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
          },
        ],
      },
      paperOutcome: null,
      paperOutcomeNullReason: "測試：這一天沒有紙上後果。",
      quotedUtterances: [],
      memoryRefs: [],
      relationshipRefs: [],
    },
    relationshipConsequence: null,
    relationshipConsequenceNullReason: "測試：這一天沒有關係訊號。",
    openQuestionSummary: "他還沒說為什麼一直等。",
    openQuestionSummaryTruthClass: "simulated_narrative",
    archiveRefs: { paperPositionRefs: [], relationshipDyadRefs: [], memoryRefs: [] },
    ...overrides,
  };
}

export function lifeJournal(overrides: Partial<LifeJournalPage> = {}): LifeJournalPage {
  return {
    ...envelope(),
    characterId: TEST_CHARACTER_ID,
    appliedAudienceScope: "public_current",
    entries: [journalEntry()],
    heldEntries: [],
    nextCursor: null,
    ...overrides,
  };
}

export function archiveIndex(overrides: Partial<CharacterArchiveIndex> = {}): CharacterArchiveIndex {
  const section = (
    sectionKey: CharacterArchiveIndex["sections"][number]["sectionKey"],
    summary: string,
  ): CharacterArchiveIndex["sections"][number] => ({
    sectionKey,
    viewerAudienceScope: "public_current",
    summary,
    summaryTruthClass: sectionKey === "chart" ? "symbolic_interpretation" : "simulated_narrative",
    asOf: TEST_AS_OF,
    visibilityEpoch: 3,
    sectionPath:
      sectionKey === "paper" ? `/api/v2/characters/${TEST_CHARACTER_ID}/archive/paper` : null,
  });

  return {
    ...envelope(),
    characterId: TEST_CHARACTER_ID,
    archiveSchemaRevision: "archive-test.1",
    longTermTensionSummary: "他一直說自己只看長期，卻每天盯著同一個數字。",
    longTermTensionSummaryTruthClass: "simulated_narrative",
    recentHighlights: ["他延後了一次決定。"],
    recentHighlightTruthClasses: ["simulated_narrative"],
    sections: [
      section("paper", "目前 1 個部位。"),
      section("relations", "和一位同事的關係還沒說開。"),
      section("chart", "命盤的解讀只影響他注意什麼。"),
      section("traits", "習慣先等別人開口。"),
      section("memories", "記得第一次看錯的那天。"),
      section("life", "在這座城市住了十年。"),
    ],
    ...overrides,
  };
}

export function paperPosition(overrides: Partial<PaperPositionPublic> = {}): PaperPositionPublic {
  return {
    positionId: "a243c129-0297-4b54-a16f-256452eab596",
    truthClass: "simulated_narrative",
    instrumentLabel: "TEST-DEMO",
    instrumentLabelTruthClass: "fictional_setting",
    status: "open",
    openedAt: "2026-03-03T13:30:00+08:00",
    lastChangedAt: TEST_AS_OF,
    closedAt: null,
    lots: [
      {
        lotId: "2c0f86ae-898a-4e81-92f7-d5c706175959",
        quantityFixed6: 600_000_000,
        sealedPriceMinorUnitsFixed6: 10_000_000_000,
        costBasisMinorUnits: 6_000_000,
        sealedPriceRevisionRef: DIGEST,
        truthClass: "simulated_narrative",
      },
    ],
    realizedPnlMinorUnits: null,
    unrealizedPnlMinorUnits: -120_000,
    unrealizedPnlPercentFixed2: -200,
    markAsOf: TEST_AS_OF,
    invalidationCondition: "not_yet_occurred",
    rationaleSummary: "建倉時封存的理由：等兩個交易日看有沒有新證據。",
    rationaleSummaryTruthClass: "simulated_narrative",
    influencedByCharacterRefs: [],
    influencedBy: [],
    influencedByEmptyReason: "測試：沒有封存事件顯示別人影響這個部位。",
    consequenceSummary: "持有到現在，還沒有新證據。",
    consequenceSummaryTruthClass: "simulated_narrative",
    ...overrides,
  };
}

export function dataRevision(overrides: Partial<DataRevisionNote> = {}): DataRevisionNote {
  return {
    revisionId: "rev-test-001",
    appliedAt: "2026-03-18T09:00:00+08:00",
    kind: "accounting_correction",
    affectedRefs: ["a243c129-0297-4b54-a16f-256452eab596"],
    summary: "測試更正：成本基礎少算一筆手續費，已重算。",
    truthClass: "simulated_narrative",
    ...overrides,
  };
}

export function paperArchive(overrides: Partial<PaperArchiveProjection> = {}): PaperArchiveProjection {
  return {
    ...envelope(),
    truthClasses: ["fictional_setting", "simulated_narrative"],
    characterId: TEST_CHARACTER_ID,
    appliedAudienceScope: "public_current",
    asOf: TEST_AS_OF,
    paperVersionSet: {
      paperAccountRef: "345fea46-1f2a-4bcd-898a-29d944fec75a",
      paperAccountVersion: 3,
      paperOrderRefs: [],
      paperOrderVersions: [],
      paperPositionRefs: [],
      paperPositionVersions: [],
      paperVersionSetDigest: DIGEST,
    },
    account: {
      currency: "TWD",
      cashMinorUnits: 94_000_000,
      reservedCashMinorUnits: 0,
      initialCapitalMinorUnits: 100_000_000,
      correctionRefs: [],
      asOf: TEST_AS_OF,
      truthClass: "simulated_narrative",
    },
    positions: [],
    historicalActionFills: [],
    dataRevisions: [],
    ...overrides,
  };
}

export function tombstone(
  overrides: Partial<WithdrawnCharacterProjection> = {},
): WithdrawnCharacterProjection {
  return {
    ...envelope("WITHDRAWN"),
    dataState: "WITHDRAWN",
    characterId: TEST_CHARACTER_ID,
    tombstoneReasonLabel: "測試退出說明：這名居民依設定離開了這座城市。",
    ...overrides,
  };
}
