import { afterEach, describe, expect, it, vi } from "vitest";

import { createLastKnownCache, visibilityKeyOf } from "./lastKnownCache";
import { lifeJournal } from "./testing/fixtureFactory";

function memoryStorage(): Pick<Storage, "getItem" | "setItem"> {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 一份帶 3.0.0 可見性座標（正史 epoch ＋ kill-switch ref）的最小投影。 */
function projected(payload: Record<string, unknown>, epoch = 1, refId = "projection-kill-switch/v1", revision = 1) {
  return {
    ...payload,
    visibilityEpoch: epoch,
    sourceRevisionSet: [{ refId, refKind: "projection_kill_switch", revision }],
  };
}

describe("[state:offline] last-known 公開投影快取", () => {
  it("[state:offline] 以 route path 為 key，讀回的是當時那一份投影", () => {
    const cache = createLastKnownCache(memoryStorage);
    const page = lifeJournal();
    cache.remember("/people/a/journal", page);
    expect(cache.recall("/people/a/journal")).toEqual(page);
    expect(cache.recall("/people/b/journal")).toBeNull();
  });

  it("[state:offline] sessionStorage 層：同一個 storage 的新實例（重新整理後）仍讀得到", () => {
    const storage = memoryStorage();
    createLastKnownCache(() => storage).remember("/world", projected({ a: 1 }));
    expect(createLastKnownCache(() => storage).recall("/world")).toEqual(projected({ a: 1 }));
  });

  it("[state:offline] 存的是 JSON 快照：之後改動原物件不會改到快取", () => {
    const cache = createLastKnownCache(memoryStorage);
    const page = lifeJournal();
    cache.remember("/people/a/journal", page);
    page.entries = [];
    expect((cache.recall("/people/a/journal") as { entries: unknown[] }).entries).toHaveLength(1);
  });

  it("[state:offline] storage 內容壞掉（不是 JSON）：當作沒有快取", () => {
    const storage = memoryStorage();
    storage.setItem("panshi.v5.lastKnown:/world", "{not json");
    expect(createLastKnownCache(() => storage).recall("/world")).toBeNull();
  });

  it("[state:offline] storage unavailable：getItem／setItem 丟例外時不丟出去", () => {
    const cache = createLastKnownCache(() => ({
      getItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("quota", "QuotaExceededError");
      },
    }));
    expect(() => cache.remember("/world", projected({ a: 1 }))).not.toThrow();
    // 記憶體層仍有。
    expect(cache.recall("/world")).toEqual(projected({ a: 1 }));
    expect(cache.recall("/elsewhere")).toBeNull();
  });

  it("[state:offline] storage unavailable：連取得 storage 本身都丟例外，預設實例也照常運作", async () => {
    vi.stubGlobal("sessionStorage", undefined);
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      get() {
        throw new DOMException("storage disabled", "SecurityError");
      },
    });
    vi.resetModules();
    const { lastKnownCache } = await import("./lastKnownCache");
    expect(() => lastKnownCache.remember("/world", projected({ a: 1 }))).not.toThrow();
    expect(lastKnownCache.recall("/world")).toEqual(projected({ a: 1 }));
    expect(lastKnownCache.recall("/other")).toBeNull();
    Reflect.deleteProperty(globalThis, "sessionStorage");
  });

  it("[state:offline] kill switch 換版：別的座標下快取的頁面離線時不再交出（記憶體與 storage 都一樣）", () => {
    const storage = memoryStorage();
    const cache = createLastKnownCache(() => storage);
    cache.remember("/people/a/archive/paper", projected({ page: "paper" }, 1, "projection-kill-switch/v1", 1));
    cache.remember("/world", projected({ page: "world" }, 1, "projection-kill-switch/v1", 2));
    expect(cache.recall("/people/a/archive/paper")).toBeNull();
    expect(createLastKnownCache(() => storage).recall("/people/a/archive/paper")).toBeNull();
    expect(cache.recall("/world")).toEqual(projected({ page: "world" }, 1, "projection-kill-switch/v1", 2));
  });

  it("[state:offline] 不只比大小：設定壞掉的 fail-closed（revision 0）在較高 revision 之後也讓舊快取失效", () => {
    const cache = createLastKnownCache(memoryStorage);
    cache.remember("/people/a/journal", projected({ page: "journal" }, 1, "projection-kill-switch/v1", 3));
    cache.remember("/world", projected({ page: "world" }, 1, "projection-kill-switch/v1#fail-closed", 0));
    expect(cache.recall("/people/a/journal")).toBeNull();
  });

  it("[state:offline] 正史 epoch 換了也一樣失效；沒有座標的投影一律不交出", () => {
    const cache = createLastKnownCache(memoryStorage);
    cache.remember("/people/a/journal", projected({ page: "journal" }, 1));
    cache.remember("/world", projected({ page: "world" }, 2));
    expect(cache.recall("/people/a/journal")).toBeNull();
    cache.remember("/legacy", { page: "legacy" });
    expect(cache.recall("/legacy")).toBeNull();
    expect(visibilityKeyOf({ page: "legacy" })).toBeNull();
    expect(visibilityKeyOf(projected({}, 4, "projection-kill-switch/v1", 7))).toBe("4|projection-kill-switch/v1|7");
  });
});
