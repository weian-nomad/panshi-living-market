// 人生誌「改口」的純 mapper：哪一章的哪一句，是對哪一句原話的後來說法。
//
// 規則全部由投影已有的欄位推出，不讀文字內容、不猜語意：
//
// 1. **原話**：一個模擬部位（`archiveRefs.paperPositionRefs` 裡的 id）第一次出現
//    可核對的當時原話（`contemporaneousClaim`）的那一章。依 canonical 日期由舊到新找。
// 2. **改口**：之後任何一章，同一個部位，出現了另一份 artifact 的公開說法——
//    先看「現在怎麼說」（`currentSelfNarration` 是逐字原話時），沒有再看那一章自己的
//    當時原話。artifact id 相同的不算改口（同一句話）。
// 3. **fail closed**：
//    - 原話那一章之前若有被 HELD 的章節，就無法確定那真的是「第一句」，這個部位
//      不產生任何改口連結（不指向一個可能不是原話的地方）。
//    - 無法核對的 artifact（digest 格式不合、原文空白）不當原話，也不當改口。
//    - 只有敘事完整（`composed`）的章節能當原話或改口：證據卡章節沒有「他其實知道什麼」
//      與「他漏掉了什麼」，連過去也看不到當時資料；它自己也只渲染證據卡。
//
// 輸出的每一筆都指向同一份頁面上存在的章節（`chapterAnchorId()`），所以「回到原話」
// 永遠是一次點擊、不會落空。
//
// 本檔是純函式：不碰 DOM、不打 API、不讀時鐘。

import type {
  CharacterUtterance,
  HeldLifeJournalEntry,
  LifeJournalEntry,
} from "../api/generated-v2/types.gen";
import { isVerifiableUtterance } from "./Utterance";

/** 人生誌每一章的錨點：`chapter-YYYY-MM-DD`。 */
export function chapterAnchorId(chapterDate: string): string {
  return `chapter-${chapterDate}`;
}

export type ClaimRevision = {
  /** 改口所在的章節。 */
  entry: LifeJournalEntry;
  /** 後來的那一句（逐字原話）。 */
  revision: CharacterUtterance;
  /** 原話所在的章節；它的當時原話與當時已知資料就是比較的左邊。 */
  original: LifeJournalEntry;
  originalClaim: CharacterUtterance;
  positionRef: string;
};

function laterUtterance(entry: LifeJournalEntry): CharacterUtterance | null {
  const narration = entry.currentSelfNarration;
  if (narration && narration.kind === "utterance") {
    const utterance: CharacterUtterance = {
      utteranceArtifactId: narration.utteranceArtifactId,
      canonicalTextSha256: narration.canonicalTextSha256,
      canonicalTextUtf8: narration.canonicalTextUtf8,
    };
    if (isVerifiableUtterance(utterance)) return utterance;
  }
  const claim = entry.contemporaneousClaim;
  return claim && isVerifiableUtterance(claim) ? claim : null;
}

/**
 * 找出整頁的改口，以改口所在章節的 `entryId` 為 key。每一章最多一筆
 *（依 `paperPositionRefs` 的順序取第一個符合的部位）。
 */
export function claimRevisions(
  entries: readonly LifeJournalEntry[],
  heldEntries: readonly HeldLifeJournalEntry[],
): Map<string, ClaimRevision> {
  const chronological = [...entries].sort((left, right) =>
    left.chapterDate.localeCompare(right.chapterDate),
  );
  const earliestHeld = heldEntries.reduce<string | null>(
    (earliest, held) =>
      earliest === null || held.chapterDate.localeCompare(earliest) < 0 ? held.chapterDate : earliest,
    null,
  );

  const originals = new Map<string, { entry: LifeJournalEntry; claim: CharacterUtterance }>();
  const blocked = new Set<string>();
  const revisions = new Map<string, ClaimRevision>();

  for (const entry of chronological) {
    for (const positionRef of entry.archiveRefs?.paperPositionRefs ?? []) {
      if (blocked.has(positionRef)) continue;
      const original = originals.get(positionRef);

      if (original === undefined) {
        const claim = entry.contemporaneousClaim;
        if (!claim || !isVerifiableUtterance(claim)) continue;
        if (
          entry.narrativeState !== "composed" ||
          (earliestHeld !== null && earliestHeld.localeCompare(entry.chapterDate) < 0)
        ) {
          // 更早的章節被 HELD：這一句不一定是第一句；證據卡章節沒有當時資料。都不當原話。
          blocked.add(positionRef);
          continue;
        }
        originals.set(positionRef, { entry, claim });
        continue;
      }

      if (original.entry.entryId === entry.entryId || revisions.has(entry.entryId)) continue;
      if (entry.narrativeState !== "composed") continue;
      const revision = laterUtterance(entry);
      if (revision === null) continue;
      if (revision.utteranceArtifactId === original.claim.utteranceArtifactId) continue;

      revisions.set(entry.entryId, {
        entry,
        revision,
        original: original.entry,
        originalClaim: original.claim,
        positionRef,
      });
    }
  }

  return revisions;
}
