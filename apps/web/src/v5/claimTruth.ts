// 逐項資料身分的讀取閘門（public-v2.yaml 2.1.0：每一項對外可見的宣稱自己帶 truth class）。
//
// 規則（AGENTS.md「Product invariants」：每一項對外可見的宣稱剛好帶一個 `truth_class`）：
//
// 1. **身分由投影決定，前端不決定。** 一項宣稱的身分只從它自己的欄位讀：
//    同層的 `<欄位>TruthClass`、它所在物件的 `truthClass`，或清單的平行
//    `<單數>TruthClasses[i]`。前端不再有「哪一種宣稱該掛哪一種身分」的對照表。
// 2. **缺了就 fail closed。** 值不是五種之一、或不在投影 envelope 的 `truthClasses`
//    裡，就回 `null`；呼叫端必須**不顯示那一項**並寫出原因
//    （`MISSING_CLAIM_TRUTH_CLASS_TEXT`），不得改掛別的身分、不得沿用整頁的身分。
// 3. 只在這一項缺；同一頁其他帶身分的宣稱照常顯示。
//
// 本檔是純函式：不碰 DOM、不打 API、不讀時鐘。

import type { TruthClass } from "../api/generated-v2/types.gen";
import { DATA_UNAVAILABLE_LABEL, TRUTH_CLASSES } from "./format";

/** 一項宣稱沒有標出資料身分、因此不顯示時的固定說明（未經 copy-taste 審稿）。 */
export const MISSING_CLAIM_TRUTH_CLASS_TEXT = `${DATA_UNAVAILABLE_LABEL}：這一項沒有標出資料身分，所以不顯示。`;

/**
 * 一項宣稱自己帶的資料身分。
 *
 * `value` 是那一項的 truth class 欄位原值（型別上可能是 `undefined`：舊版或被竄改的
 * 投影就是會缺）。`declared` 是投影 envelope 的 `truthClasses`；有給時，一項宣稱的
 * 身分必須是投影自己宣告過的其中之一。
 */
export function claimTruthClassOf(
  value: unknown,
  declared?: readonly TruthClass[],
): TruthClass | null {
  if (typeof value !== "string") return null;
  const known = TRUTH_CLASSES.find((truthClass) => truthClass === value);
  if (known === undefined) return null;
  if (declared !== undefined && !declared.includes(known)) return null;
  return known;
}

/** 一組已經過閘門的身分，去重後依 `TRUTH_CLASSES` 的固定順序排列（同一行多個欄位共用標籤時用）。 */
export function distinctTruthClasses(classes: readonly (TruthClass | null)[]): TruthClass[] {
  return TRUTH_CLASSES.filter((truthClass) => classes.includes(truthClass));
}

/**
 * 一組巢狀紙上數字（lot、成交）能不能併進它上層那一項一起顯示（public-v2.yaml 2.2.0）。
 *
 * 巢狀數字自己帶身分，不從上層借。它們在畫面上是掛在上層那一項的標籤底下（例如部位的
 * 「成本」是各 lot 成本相加、掛部位的標籤），所以巢狀那一項的身分必須自己過閘門，而且
 * 必須和上層那一項**相同**；缺了、不合法、或和上層不同，就不併進去（呼叫端改顯示
 * 「資料未到」），不改掛別的身分。
 */
export function nestedFiguresUsable(
  nestedTruthClass: unknown,
  parentTruthClass: unknown,
  declared?: readonly TruthClass[],
): boolean {
  const nested = claimTruthClassOf(nestedTruthClass, declared);
  const parent = claimTruthClassOf(parentTruthClass, declared);
  return nested !== null && parent !== null && nested === parent;
}
