import { afterEach, describe, expect, it, vi } from "vitest";

import { createLastKnownCache } from "./lastKnownCache";
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
    createLastKnownCache(() => storage).remember("/world", { a: 1 });
    expect(createLastKnownCache(() => storage).recall("/world")).toEqual({ a: 1 });
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
    expect(() => cache.remember("/world", { a: 1 })).not.toThrow();
    // 記憶體層仍有。
    expect(cache.recall("/world")).toEqual({ a: 1 });
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
    expect(() => lastKnownCache.remember("/world", { a: 1 })).not.toThrow();
    expect(lastKnownCache.recall("/world")).toEqual({ a: 1 });
    expect(lastKnownCache.recall("/other")).toBeNull();
    Reflect.deleteProperty(globalThis, "sessionStorage");
  });
});
