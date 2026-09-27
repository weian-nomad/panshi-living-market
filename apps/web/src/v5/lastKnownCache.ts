// 離線時的「上次載入的版本」快取（experience-spec §17.1 `WORLD_OFFLINE`：可讀已快取故事）。
//
// 規則：
// - key 是公開路由的 path（`/world`、`/people/:id/...`），value 是那一次成功取得的
//   公開投影 JSON 原文。只存 public-v2 讀取面的投影，不存任何使用者資料、偏好或
//   閱讀進度，也不在前端拼出 per-user 正史。
// - 兩層：module-level `Map`（同一個分頁、同一次載入內）＋ `sessionStorage`（同一分頁
//   重新整理後仍可讀，關掉分頁就消失）。
// - 每一次讀寫都包 try/catch：隱私模式、配額用完、storage 被停用或丟例外時，
//   這裡只是「沒有快取」，畫面照常渲染。
// - 讀回來的東西一律是 `unknown`；呼叫端必須再過一次契約驗證才可以顯示
//  （storage 內容可能被竄改或是舊版形狀，缺欄位就當沒有快取，fail closed）。

const STORAGE_PREFIX = "panshi.v5.lastKnown:";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export type LastKnownCache = {
  /** 記住某個路由最後一次成功取得的公開投影。失敗時靜默放棄，不影響畫面。 */
  remember(path: string, projection: unknown): void;
  /** 讀回某個路由的最後一份投影；沒有、壞掉或 storage 不可用時回 `null`。 */
  recall(path: string): unknown | null;
};

function defaultStorage(): StorageLike | null {
  // `globalThis.sessionStorage` 的 getter 本身就可能丟例外（storage 被停用時）。
  if (typeof globalThis === "undefined") return null;
  const storage = (globalThis as { sessionStorage?: StorageLike }).sessionStorage;
  return storage ?? null;
}

function parse(raw: string | null | undefined): unknown | null {
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

export function createLastKnownCache(
  getStorage: () => StorageLike | null = defaultStorage,
): LastKnownCache {
  const memory = new Map<string, string>();

  return {
    remember(path, projection) {
      let raw: string;
      try {
        raw = JSON.stringify(projection);
      } catch {
        return;
      }
      if (typeof raw !== "string") return;
      memory.set(path, raw);
      try {
        getStorage()?.setItem(STORAGE_PREFIX + path, raw);
      } catch {
        // storage 不可用：只留在記憶體，不影響畫面。
      }
    },

    recall(path) {
      const inMemory = parse(memory.get(path));
      if (inMemory !== null) return inMemory;
      try {
        return parse(getStorage()?.getItem(STORAGE_PREFIX + path));
      } catch {
        return null;
      }
    },
  };
}

/** 整個 SPA 共用的一份快取。 */
export const lastKnownCache: LastKnownCache = createLastKnownCache();
