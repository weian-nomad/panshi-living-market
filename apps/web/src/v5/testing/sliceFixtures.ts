// 測試專用：讀取切片產生器輸出的**真** fixture（`fixtures/v5/one-character-slice/api`）。
//
// 用途和 `fixtureFactory.ts` 相反：工廠做最小合法形狀、測資料狀態；這裡用真的
// 三十個交易日投影，證明畫面在最終形狀上走得通（改口導航、三次內到帳本、五節真頁、
// 原話逐字）。只讀不寫；檔案缺了就讓測試直接失敗，不補一份假資料。
//
// 只能由 `*.test.ts(x)` import（它用 node 內建模組，不能進瀏覽器 bundle）。

import { readFileSync } from "node:fs";

import type {
  CharacterArchiveIndex,
  CharacterCloseUp,
  ChartArchiveProjection,
  LifeArchiveProjection,
  LifeJournalPage,
  MemoriesArchiveProjection,
  PaperArchiveProjection,
  RelationsArchiveProjection,
  TraitsArchiveProjection,
  WorldSnapshot,
} from "../../api/generated-v2/types.gen";

const API_ROOT = new URL("../../../../../fixtures/v5/one-character-slice/api/", import.meta.url);

type SliceIndex = { characterId: string; routes: Record<string, string> };

function readJson<T>(relative: string): T {
  return JSON.parse(readFileSync(new URL(relative, API_ROOT), "utf8")) as T;
}

const index = readJson<SliceIndex>("index.json");

/** 切片唯一一名居民的 id（由 fixture index 決定，不寫死）。 */
export const SLICE_CHARACTER_ID = index.characterId;

function route<T>(apiPath: string): T {
  const file = index.routes[apiPath];
  if (file === undefined) throw new Error(`fixture index has no route for ${apiPath}`);
  return readJson<T>(file);
}

const base = `/api/v2/characters/${SLICE_CHARACTER_ID}`;

export function sliceWorld(): WorldSnapshot {
  return route<WorldSnapshot>("/api/v2/world");
}
export function sliceCloseUp(): CharacterCloseUp {
  return route<CharacterCloseUp>(`${base}/close-up`);
}
export function sliceJournal(): LifeJournalPage {
  return route<LifeJournalPage>(`${base}/life-journal`);
}
export function sliceArchiveIndex(): CharacterArchiveIndex {
  return route<CharacterArchiveIndex>(`${base}/archive`);
}
export function slicePaper(): PaperArchiveProjection {
  return route<PaperArchiveProjection>(`${base}/archive/paper`);
}
export function sliceRelations(): RelationsArchiveProjection {
  return route<RelationsArchiveProjection>(`${base}/archive/relations`);
}
export function sliceChart(): ChartArchiveProjection {
  return route<ChartArchiveProjection>(`${base}/archive/chart`);
}
export function sliceTraits(): TraitsArchiveProjection {
  return route<TraitsArchiveProjection>(`${base}/archive/traits`);
}
export function sliceMemories(): MemoriesArchiveProjection {
  return route<MemoriesArchiveProjection>(`${base}/archive/memories`);
}
export function sliceLife(): LifeArchiveProjection {
  return route<LifeArchiveProjection>(`${base}/archive/life`);
}

/** 把 `renderToStaticMarkup` 的文字節點還原成原字（React 只跳脫這五個字元）。 */
export function unescapeHtml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&");
}
