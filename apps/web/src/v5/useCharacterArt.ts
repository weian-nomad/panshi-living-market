// React 端讀角色美術狀態。預設用瀏覽器載入器；測試用 `CharacterArtContext` 注入
// 已載好的 store（node 端 `renderToStaticMarkup` 不跑 effect，也就不會發請求）。

import { createContext, useCallback, useContext, useEffect, useSyncExternalStore } from "react";

import {
  browserArtLoader,
  createCharacterArtStore,
  type ArtStatus,
  type ArtSurface,
  type CharacterArtStore,
} from "./characterArtStore";

export const CharacterArtContext = createContext<CharacterArtStore | null>(null);

let defaultStore: CharacterArtStore | null = null;

function useArtStore(): CharacterArtStore {
  const injected = useContext(CharacterArtContext);
  if (injected !== null) return injected;
  defaultStore ??= createCharacterArtStore(browserArtLoader());
  return defaultStore;
}

/** 這位角色在這個畫面（世界小圖或近景 rig）的美術狀態；第一次使用時開始載入。 */
export function useCharacterArt(characterId: string, surface: ArtSurface): ArtStatus {
  const store = useArtStore();
  const snapshot = useCallback(() => store.status(characterId, surface), [store, characterId, surface]);
  const status = useSyncExternalStore(store.subscribe, snapshot, snapshot);

  useEffect(() => {
    store.request(characterId, surface);
  }, [store, characterId, surface]);

  return status;
}

/** 已顯示的圖之後載入失敗時呼叫：這位角色在這個畫面退回幾何佔位。 */
export function useMarkArtBroken(): (characterId: string, surface: ArtSurface) => void {
  const store = useArtStore();
  return useCallback((characterId, surface) => store.markBroken(characterId, surface), [store]);
}
