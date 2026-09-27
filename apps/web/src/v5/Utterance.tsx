// 角色原話的唯一渲染元件（system-design.md §11.1、§11.4；experience-spec §8.2）。
//
// 原話是一份封存的 `UtteranceArtifactV1`：畫面只能**逐字**顯示它的 canonical bytes。
// 本元件因此只做三件事：
//
// 1. 把 `canonicalTextUtf8` 原封不動放進 `<q>`——不 trim、不截斷、不換字、不補標點。
//    引號由 CSS 的 `quotes` 產生（tokens.css `.panshi-utterance`），不寫進文字節點，
//    所以元素的文字內容就是 artifact 的原文，可以直接拿去算 sha256。
// 2. 在元素上輸出 `data-artifact-id` 與 `data-text-sha256`，讓任何人（包含測試）都能
//    拿畫面上的字重算 digest，核對它就是那份 artifact。digest 的定義在
//    crates/character-domain/src/utterance.rs：sha256(`PSZS/UTTERANCE_TEXT/v1\0` ＋ UTF-8 原文)。
// 3. digest 格式不合或原文是空的：fail closed，不顯示一句追溯不到 artifact 的台詞。
//
// 瀏覽器端沒有同步的 sha256，所以「文字 → digest」的逐字核對放在 node 端測試
//（`archiveNavigation.test.tsx` 的 `[utterance:verbatim]`），本元件只保證不改字。

import type { CharacterUtterance } from "../api/generated-v2/types.gen";
import { DATA_UNAVAILABLE_LABEL } from "./format";

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** 無法核對的原話不顯示時的固定說明（未經 copy-taste 審稿）。 */
export const UNVERIFIABLE_UTTERANCE_TEXT = `${DATA_UNAVAILABLE_LABEL}：這句話無法核對，因此不顯示。`;

export type UtteranceSource = Pick<
  CharacterUtterance,
  "utteranceArtifactId" | "canonicalTextSha256" | "canonicalTextUtf8"
>;

/** 這份 artifact 能不能逐字顯示：原文非空、有 artifact id、digest 是 64 位小寫十六進位。 */
export function isVerifiableUtterance(utterance: UtteranceSource | null | undefined): boolean {
  if (!utterance) return false;
  return (
    typeof utterance.canonicalTextUtf8 === "string" &&
    utterance.canonicalTextUtf8.length > 0 &&
    typeof utterance.utteranceArtifactId === "string" &&
    utterance.utteranceArtifactId.length > 0 &&
    typeof utterance.canonicalTextSha256 === "string" &&
    SHA256_HEX.test(utterance.canonicalTextSha256)
  );
}

export function Utterance({
  utterance,
  className,
}: {
  utterance: UtteranceSource | null | undefined;
  className?: string;
}) {
  if (!utterance || !isVerifiableUtterance(utterance)) {
    return <span className="panshi-utterance-absent panshi-paper">{UNVERIFIABLE_UTTERANCE_TEXT}</span>;
  }

  return (
    <q
      className={className ? `panshi-utterance panshi-paper ${className}` : "panshi-utterance panshi-paper"}
      data-artifact-id={utterance.utteranceArtifactId}
      data-text-sha256={utterance.canonicalTextSha256}
    >
      {utterance.canonicalTextUtf8}
    </q>
  );
}
