// 測試專用：apps/web 沒有 @types/node，也不為了測試新增依賴。
// 這裡只宣告 node 端渲染測試實際用到的內建函式（讀切片 fixture、列出原始碼檔、重算原話 sha256），
// 讓 `tsc -b` 看得懂 `*.test.ts(x)` 與 `testing/sliceFixtures.ts`。產品程式碼不得 import 它們。

declare module "node:fs" {
  export function readFileSync(path: URL | string, encoding: "utf8"): string;
  export function readdirSync(path: URL | string): string[];
}

declare module "node:crypto" {
  interface Hash {
    update(data: string, inputEncoding: "utf8"): Hash;
    digest(encoding: "hex"): string;
  }
  export function createHash(algorithm: "sha256"): Hash;
}
