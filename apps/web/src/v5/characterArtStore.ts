// 角色美術的執行期載入（同源 `/art/characters/<characterId>/manifest.json`）。
//
// 一位角色的美術只有三種狀態：
// - `pending`：還沒載完。畫面維持原本的幾何佔位。
// - `ready`：清單通過 `validateCharacterArtManifest`，而且這個畫面要用的每一張圖都已
//   解碼成功、解碼後尺寸與清單宣告一致。
// - `unavailable`：清單不存在（404）、讀不到、不是 JSON、驗證不過、角色 id 不符，
//   或任何一張圖載入失敗或尺寸不符。畫面永遠留在佔位，不顯示破圖、不顯示半套 rig。
//
// 世界只需要小圖，近景需要整套 rig；兩者分開判定，所以世界小圖可用而 rig 缺圖時，
// 近景仍會退回佔位。一個 session 內不重試：結果在重新整理前不變。
//
// 本檔不 import React；React 端的 hook 在 `useCharacterArt.ts`。

import {
  characterArtFileUrl,
  characterArtManifestPath,
  rigImages,
  validateCharacterArtManifest,
  type CharacterArtManifest,
} from "./characterArt";

export type ArtStatus =
  | { readonly phase: "pending" }
  | { readonly phase: "ready"; readonly manifest: CharacterArtManifest }
  | { readonly phase: "unavailable" };

export type ArtSurface = "sprite" | "rig";

/** 載入的兩個副作用；測試以假物件注入，瀏覽器用 `browserArtLoader()`。 */
export type ArtLoader = {
  /** 讀清單；不存在、非 2xx、讀不到或不是 JSON 都回 `null`。 */
  fetchManifest(path: string): Promise<unknown>;
  /** 解碼一張圖；失敗回 `null`，成功回解碼後的實際尺寸。 */
  decodeImage(url: string): Promise<{ width: number; height: number } | null>;
};

export type CharacterArtStore = {
  subscribe(listener: () => void): () => void;
  status(characterId: string, surface: ArtSurface): ArtStatus;
  /** 開始載入（已在載入或已有結果時不做事）。 */
  request(characterId: string, surface: ArtSurface): void;
  /** 已顯示的圖之後仍載入失敗：這一位在這個畫面退回佔位，不再重試。 */
  markBroken(characterId: string, surface: ArtSurface): void;
};

const PENDING: ArtStatus = { phase: "pending" };
const UNAVAILABLE: ArtStatus = { phase: "unavailable" };

export function createCharacterArtStore(loader: ArtLoader): CharacterArtStore {
  const listeners = new Set<() => void>();
  const manifests = new Map<string, Promise<CharacterArtManifest | null>>();
  const statuses = new Map<string, ArtStatus>();

  const key = (characterId: string, surface: ArtSurface) => `${surface}:${characterId}`;

  function set(characterId: string, surface: ArtSurface, next: ArtStatus): void {
    statuses.set(key(characterId, surface), next);
    for (const listener of listeners) listener();
  }

  function manifestFor(characterId: string): Promise<CharacterArtManifest | null> {
    let pending = manifests.get(characterId);
    if (pending === undefined) {
      pending = loader
        .fetchManifest(characterArtManifestPath(characterId))
        .then((value) => {
          if (value === null) return null;
          const result = validateCharacterArtManifest(value, characterId);
          return result.ok ? result.manifest : null;
        })
        .catch(() => null);
      manifests.set(characterId, pending);
    }
    return pending;
  }

  async function imagesDecode(
    characterId: string,
    images: readonly { file: string; width: number; height: number }[],
  ): Promise<boolean> {
    const decoded = await Promise.all(
      images.map((image) => loader.decodeImage(characterArtFileUrl(characterId, image.file)).catch(() => null)),
    );
    return decoded.every(
      (size, index) => size !== null && size.width === images[index]!.width && size.height === images[index]!.height,
    );
  }

  async function load(characterId: string, surface: ArtSurface): Promise<ArtStatus> {
    const manifest = await manifestFor(characterId);
    if (manifest === null) return UNAVAILABLE;
    const images =
      surface === "sprite"
        ? [
            {
              file: manifest.worldSprite.file,
              width: manifest.worldSprite.width,
              height: manifest.worldSprite.height,
            },
          ]
        : rigImages(manifest);
    return (await imagesDecode(characterId, images)) ? { phase: "ready", manifest } : UNAVAILABLE;
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    status(characterId, surface) {
      return statuses.get(key(characterId, surface)) ?? PENDING;
    },
    request(characterId, surface) {
      if (statuses.has(key(characterId, surface))) return;
      statuses.set(key(characterId, surface), PENDING);
      load(characterId, surface)
        .catch(() => UNAVAILABLE)
        .then((next) => {
          // 已被 `markBroken` 判成不可用的就不要再蓋回 ready。
          if (statuses.get(key(characterId, surface)) === PENDING) set(characterId, surface, next);
        });
    },
    markBroken(characterId, surface) {
      if (statuses.get(key(characterId, surface)) === UNAVAILABLE) return;
      set(characterId, surface, UNAVAILABLE);
    },
  };
}

/** 瀏覽器實作：同源 fetch（`no-cache`：清單永遠重新驗證）與 `Image.decode()`。 */
export function browserArtLoader(): ArtLoader {
  return {
    async fetchManifest(path) {
      try {
        const response = await fetch(path, {
          headers: { Accept: "application/json" },
          cache: "no-cache",
          credentials: "same-origin",
        });
        if (!response.ok) return null;
        return (await response.json()) as unknown;
      } catch {
        return null;
      }
    },
    async decodeImage(url) {
      const image = new Image();
      image.decoding = "async";
      const loaded =
        typeof image.decode === "function"
          ? () => image.decode()
          : () =>
              new Promise<void>((resolve, reject) => {
                image.onload = () => resolve();
                image.onerror = () => reject(new Error("image failed to load"));
              });
      image.src = url;
      try {
        await loaded();
      } catch {
        return null;
      }
      return { width: image.naturalWidth, height: image.naturalHeight };
    },
  };
}
