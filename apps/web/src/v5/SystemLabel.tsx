// 系統說明（public-v2.yaml 2.2.0 `x-panshi-system-label`）：`*EmptyReason`、`*NullReason`、
// `heldReasonLabel` 這類固定句。
//
// 系統說明**不是宣稱**：它講的是系統（這份清單為什麼是空的、這個值為什麼是 null、這一章
// 為什麼暫不公開），不講角色、也不講市場，所以**不帶資料身分、旁邊不掛 `TruthTag`**。
// 為了不被讀成角色的一句話，它用和宣稱不同的樣式呈現：資料字族、左側虛線、句首固定
// 標出「系統說明」（`panshi-system-label`，樣式在 `tokens.css`）。
//
// 允許的固定句全集在 `contracts/openapi/public-v2-system-labels.json`，由 Rust 投影測試與
// 切片 audit 守門；本元件只負責呈現。值不是非空字串時，一樣用系統說明樣式寫「資料未到」，
// 不補一句別的話。
//
// 說明文字是工程 placeholder，未經 copy-taste 審稿。

import { DATA_UNAVAILABLE_LABEL } from "./format";

/** 系統說明句首的固定標記（未經 copy-taste 審稿）。 */
export const SYSTEM_LABEL_KIND_TEXT = "系統說明";

export function SystemLabel({
  field,
  text,
  className,
}: {
  /** 投影裡的欄位名（例如 `placementsEmptyReason`），寫進 `data-system-label` 供測試與除錯。 */
  field: string;
  text: unknown;
  className?: string;
}) {
  const shown = typeof text === "string" && text.length > 0 ? text : DATA_UNAVAILABLE_LABEL;
  return (
    <p className={className ? `panshi-system-label ${className}` : "panshi-system-label"} data-system-label={field}>
      <span className="panshi-system-label__kind">{SYSTEM_LABEL_KIND_TEXT}</span>
      <span className="panshi-system-label__text">{shown}</span>
    </p>
  );
}
