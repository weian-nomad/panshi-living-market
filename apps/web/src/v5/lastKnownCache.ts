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
// - public-v2 3.0.0：每份投影的可見性座標是一對值——正史 `visibilityEpoch`，加上
//   `sourceRevisionSet` 裡 `projection_kill_switch` 那一筆的 `refId`＋`revision`。
//   最新一次成功取得的投影決定「目前座標」；座標不同的舊快取一律當作沒有（不只比大小：
//   設定壞掉時 fail-closed 是 revision 0，排在較高的已發布 revision 之後）。所以 kill
//   switch 一換版，其他頁在別的座標下快取的內容離線時也不會再出現。

const STORAGE_PREFIX = "panshi.v5.lastKnown:";
const CURRENT_KEY = "panshi.v5.lastKnown#visibility";

/**
 * 一份投影的可見性座標（canonical epoch ＋ kill-switch ref）。讀不出來時回 `null`：
 * 這種投影不進快取比對（呼叫端的契約驗證本來就會擋掉）。
 */
export function visibilityKeyOf(projection: unknown): string | null {
  if (typeof projection !== "object" || projection === null) return null;
  const record = projection as Record<string, unknown>;
  const epoch = record["visibilityEpoch"];
  const refs = record["sourceRevisionSet"];
  if (typeof epoch !== "number" || !Array.isArray(refs)) return null;
  const kill = refs.filter(
    (ref): ref is Record<string, unknown> =>
      typeof ref === "object" && ref !== null && (ref as Record<string, unknown>)["refKind"] === "projection_kill_switch",
  );
  if (kill.length !== 1) return null;
  const only = kill[0] as Record<string, unknown>;
  if (typeof only["refId"] !== "string" || typeof only["revision"] !== "number") return null;
  return `${epoch}|${only["refId"]}|${only["revision"]}`;
}

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
  let currentKey: string | null = null;

  function knownCurrentKey(): string | null {
    if (currentKey !== null) return currentKey;
    try {
      return getStorage()?.getItem(CURRENT_KEY) ?? null;
    } catch {
      return null;
    }
  }

  /** 只交出和目前座標相同的快取；目前座標不明時一律不交出（fail closed）。 */
  function current(value: unknown | null): unknown | null {
    if (value === null) return null;
    const expected = knownCurrentKey();
    return expected !== null && visibilityKeyOf(value) === expected ? value : null;
  }

  return {
    remember(path, projection) {
      let raw: string;
      try {
        raw = JSON.stringify(projection);
      } catch {
        return;
      }
      if (typeof raw !== "string") return;
      const key = visibilityKeyOf(projection);
      if (key !== null && key !== currentKey) {
        // 座標換了：記憶體裡其他座標下的快取全部丟掉。storage 裡的舊項目留著也沒關係，
        // `recall` 會因為座標不同而不交出。
        memory.clear();
        currentKey = key;
        try {
          getStorage()?.setItem(CURRENT_KEY, key);
        } catch {
          // storage 不可用：座標只留在記憶體。
        }
      }
      memory.set(path, raw);
      try {
        getStorage()?.setItem(STORAGE_PREFIX + path, raw);
      } catch {
        // storage 不可用：只留在記憶體，不影響畫面。
      }
    },

    recall(path) {
      const inMemory = current(parse(memory.get(path)));
      if (inMemory !== null) return inMemory;
      try {
        return current(parse(getStorage()?.getItem(STORAGE_PREFIX + path)));
      } catch {
        return null;
      }
    },
  };
}

/** 整個 SPA 共用的一份快取。 */
export const lastKnownCache: LastKnownCache = createLastKnownCache();
