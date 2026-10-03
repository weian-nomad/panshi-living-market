// 角色美術的執行期載入與 fail closed：
// - store：沒有清單、清單無效、角色 id 不符、缺圖或尺寸不符 → `unavailable`；
//   世界小圖與近景 rig 分開判定。
// - 畫面：有美術時世界換成小圖、近景換成分層 rig；其餘一律是原本的幾何佔位，
//   且居民按鈕（點擊／按住入口與無障礙名稱）與命中區域完全不變。
// - reduced motion：近景顯示靜態母版，淡入淡出不超過 `motion.reduced_fade_max`。
// apps/web 沒有 jsdom：一律 `renderToStaticMarkup`，美術狀態由注入的 store 決定。

import { readFileSync } from "node:fs";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CharacterRig } from "./CharacterRig";
import { CloseUpScreen } from "./CloseUpScreen";
import { WorldScreen } from "./WorldScreen";
import {
  characterArtFileUrl,
  characterArtManifestPath,
  rigImages,
  spritePlacement,
  validateCharacterArtManifest,
  type CharacterArtManifest,
} from "./characterArt";
import { createCharacterArtStore, type ArtLoader, type ArtSurface, type CharacterArtStore } from "./characterArtStore";
import { REDUCED_FADE_MAX_MS } from "./motion";
import { SLICE_CHARACTER_ID, sliceCloseUp, sliceWorld } from "./testing/sliceFixtures";
import { CharacterArtContext } from "./useCharacterArt";

const CONTRACT_FIXTURES = new URL("../../../../contracts/character-art/v1/fixtures/", import.meta.url);

function contractFixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(name, CONTRACT_FIXTURES), "utf8")) as unknown;
}

const BASE = contractFixture("valid/luyanzhi-rig-v1.json") as CharacterArtManifest;

function validManifest(): CharacterArtManifest {
  const result = validateCharacterArtManifest(BASE, SLICE_CHARACTER_ID);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result.manifest;
}

type FakeArt = {
  manifests?: Record<string, unknown>;
  /** url -> decoded size; missing url = the image does not load. */
  images?: Record<string, { width: number; height: number }>;
};

function fakeLoader(art: FakeArt) {
  const calls = { manifest: [] as string[], image: [] as string[] };
  const loader: ArtLoader = {
    async fetchManifest(path) {
      calls.manifest.push(path);
      return art.manifests?.[path] ?? null;
    },
    async decodeImage(url) {
      calls.image.push(url);
      return art.images?.[url] ?? null;
    },
  };
  return { loader, calls };
}

/** Every image of a manifest at its declared size. */
function allImages(manifest: CharacterArtManifest, characterId = SLICE_CHARACTER_ID) {
  const images: Record<string, { width: number; height: number }> = {};
  const sprite = manifest.worldSprite;
  images[characterArtFileUrl(characterId, sprite.file)] = { width: sprite.width, height: sprite.height };
  for (const image of rigImages(manifest)) {
    images[characterArtFileUrl(characterId, image.file)] = { width: image.width, height: image.height };
  }
  return images;
}

async function settled(store: CharacterArtStore, surface: ArtSurface, characterId = SLICE_CHARACTER_ID) {
  store.request(characterId, surface);
  for (let attempt = 0; attempt < 50 && store.status(characterId, surface).phase === "pending"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return store.status(characterId, surface);
}

async function storeWith(art: FakeArt) {
  const { loader, calls } = fakeLoader(art);
  const store = createCharacterArtStore(loader);
  return { store, calls };
}

function withoutStyles(markup: string): string {
  return markup.replace(/<style>[\s\S]*?<\/style>/g, "");
}

function render(element: ReactElement, store?: CharacterArtStore): string {
  return withoutStyles(
    renderToStaticMarkup(
      store === undefined ? element : <CharacterArtContext.Provider value={store}>{element}</CharacterArtContext.Provider>,
    ),
  );
}

function worldMarkup(store?: CharacterArtStore): string {
  return render(<WorldScreen snapshot={sliceWorld()} onOpenCloseUp={() => {}} />, store);
}

function closeUpMarkup(store?: CharacterArtStore): string {
  return render(<CloseUpScreen closeUp={sliceCloseUp()} onOpenJournal={() => {}} onBackToWorld={() => {}} />, store);
}

const MANIFEST_PATH = characterArtManifestPath(SLICE_CHARACTER_ID);

describe("character art store (fail closed)", () => {
  it("reads the same-origin manifest path for the requested character", () => {
    expect(MANIFEST_PATH).toBe(`/art/characters/${SLICE_CHARACTER_ID}/manifest.json`);
    expect(characterArtFileUrl(SLICE_CHARACTER_ID, "rig/torso.png")).toBe(
      `/art/characters/${SLICE_CHARACTER_ID}/rig/torso.png`,
    );
  });

  it("no manifest -> both surfaces unavailable, manifest read once, no image requested", async () => {
    const { store, calls } = await storeWith({});
    expect((await settled(store, "sprite")).phase).toBe("unavailable");
    expect((await settled(store, "rig")).phase).toBe("unavailable");
    expect(calls.manifest).toEqual([MANIFEST_PATH]);
    expect(calls.image).toEqual([]);
  });

  it("an invalid manifest -> unavailable", async () => {
    for (const name of ["negative/gaze-to-the-right.json", "negative/sprite-file-parent-traversal.json", "negative-cross-field/missing-lid-closed.json"]) {
      const { store, calls } = await storeWith({
        manifests: { [MANIFEST_PATH]: contractFixture(name) },
        images: allImages(validManifest()),
      });
      expect((await settled(store, "sprite")).phase, name).toBe("unavailable");
      expect((await settled(store, "rig")).phase, name).toBe("unavailable");
      expect(calls.image, name).toEqual([]);
    }
  });

  it("a manifest for another character -> unavailable", async () => {
    const otherId = "00000000-0000-4000-8000-000000000000";
    const { store } = await storeWith({
      manifests: { [characterArtManifestPath(otherId)]: BASE },
      images: allImages(validManifest(), otherId),
    });
    expect((await settled(store, "sprite", otherId)).phase).toBe("unavailable");
  });

  it("a valid manifest with every image -> ready on both surfaces", async () => {
    const { store, calls } = await storeWith({
      manifests: { [MANIFEST_PATH]: BASE },
      images: allImages(validManifest()),
    });
    const sprite = await settled(store, "sprite");
    const rig = await settled(store, "rig");
    expect(sprite.phase).toBe("ready");
    expect(rig.phase).toBe("ready");
    expect(calls.manifest).toEqual([MANIFEST_PATH]);
    // 小圖一張；rig 是每一層加靜態母版。
    expect(calls.image.length).toBe(1 + validManifest().closeUpRig.layers.length + 1);
  });

  it("one missing rig layer -> the close-up falls back, the world sprite still shows", async () => {
    const images = allImages(validManifest());
    delete images[characterArtFileUrl(SLICE_CHARACTER_ID, "rig/lid_closed.png")];
    const { store } = await storeWith({ manifests: { [MANIFEST_PATH]: BASE }, images });
    expect((await settled(store, "sprite")).phase).toBe("ready");
    expect((await settled(store, "rig")).phase).toBe("unavailable");
  });

  it("a decoded size that differs from the manifest -> unavailable", async () => {
    const images = allImages(validManifest());
    images[characterArtFileUrl(SLICE_CHARACTER_ID, "world-sprite.png")] = { width: 103, height: 256 };
    images[characterArtFileUrl(SLICE_CHARACTER_ID, "rig/master_static.png")] = { width: 512, height: 768 };
    const { store } = await storeWith({ manifests: { [MANIFEST_PATH]: BASE }, images });
    expect((await settled(store, "sprite")).phase).toBe("unavailable");
    expect((await settled(store, "rig")).phase).toBe("unavailable");
  });

  it("a broken image after display falls back for good and notifies subscribers", async () => {
    const { store } = await storeWith({ manifests: { [MANIFEST_PATH]: BASE }, images: allImages(validManifest()) });
    expect((await settled(store, "rig")).phase).toBe("ready");
    let notified = 0;
    const unsubscribe = store.subscribe(() => {
      notified += 1;
    });
    store.markBroken(SLICE_CHARACTER_ID, "rig");
    store.request(SLICE_CHARACTER_ID, "rig");
    expect(store.status(SLICE_CHARACTER_ID, "rig").phase).toBe("unavailable");
    expect(notified).toBe(1);
    unsubscribe();
  });

  it("a broken mark during loading is not overwritten by a late ready", async () => {
    const { store } = await storeWith({ manifests: { [MANIFEST_PATH]: BASE }, images: allImages(validManifest()) });
    store.request(SLICE_CHARACTER_ID, "sprite");
    store.markBroken(SLICE_CHARACTER_ID, "sprite");
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(store.status(SLICE_CHARACTER_ID, "sprite").phase).toBe("unavailable");
  });
});

describe("world screen with character art", () => {
  const residentButton = (markup: string) => markup.match(/<button[^>]*class="v5-stage__resident-hit"[\s\S]*?<\/button>/)?.[0];

  it("without art (pending, missing or invalid) draws the geometric placeholder and no image", async () => {
    const missing = await storeWith({});
    await settled(missing.store, "sprite");
    const invalid = await storeWith({ manifests: { [MANIFEST_PATH]: contractFixture("negative/gaze-to-the-right.json") } });
    await settled(invalid.store, "sprite");
    for (const markup of [worldMarkup(), worldMarkup(missing.store), worldMarkup(invalid.store)]) {
      expect(markup).not.toContain("<image");
      expect(markup).not.toContain('data-art="sprite"');
      expect(markup).toContain("<circle");
    }
  });

  it("with art swaps the figure for the sprite, keeping the button, its name and its hit area", async () => {
    const plain = worldMarkup();
    const { store } = await storeWith({ manifests: { [MANIFEST_PATH]: BASE }, images: allImages(validManifest()) });
    await settled(store, "sprite");
    const withArt = worldMarkup(store);

    expect(withArt).toContain('data-art="sprite"');
    expect(withArt).toContain(`href="/art/characters/${SLICE_CHARACTER_ID}/world-sprite.png"`);
    expect(withArt).toContain('data-asset-pack="luyanzhi-rig-v1"');
    // 圖只是外觀：小圖群組對輔助科技隱藏，名稱仍在按鈕上。
    expect(withArt).toMatch(/<g class="v5-stage__breath panshi-motion"[^>]*aria-hidden="true"[^>]*data-art="sprite"/);
    const button = residentButton(withArt);
    expect(button).toBeDefined();
    expect(button).toBe(residentButton(plain));
    expect(button).toContain('aria-haspopup="true"');
    // 操作提示不因美術而改變；命中判定（`worldTargets`）只讀世界幾何，不讀美術。
    expect(withArt).toContain("按住一個人，跟他走一段。點一下他也可以。");
  });

  it("places the sprite on the resident's foot point at the resident's height", () => {
    const sprite = validManifest().worldSprite;
    const placement = spritePlacement(sprite, 30, 40, 20);
    const scale = 20 / sprite.standingHeightPx;
    expect(placement.x + sprite.footAnchor.x * scale).toBeCloseTo(30, 10);
    expect(placement.y + sprite.footAnchor.y * scale).toBeCloseTo(40, 10);
    // 頭頂落在腳底往上一個全身高。
    expect(placement.y + (sprite.footAnchor.y - sprite.standingHeightPx) * scale).toBeCloseTo(20, 10);
    expect(placement.width / placement.height).toBeCloseTo(sprite.width / sprite.height, 10);
  });
});

describe("close-up with the layered rig", () => {
  it("without art keeps the geometric close-up", async () => {
    const missing = await storeWith({});
    await settled(missing.store, "rig");
    const partial = await storeWith({ manifests: { [MANIFEST_PATH]: BASE }, images: {} });
    await settled(partial.store, "rig");
    for (const markup of [closeUpMarkup(), closeUpMarkup(missing.store), closeUpMarkup(partial.store)]) {
      expect(markup).toContain('viewBox="0 0 80 100"');
      expect(markup).not.toContain("<img");
      expect(markup).not.toContain("v5-rig");
    }
  });

  it("with art renders every layer and, under reduced motion, the static master", async () => {
    const { store } = await storeWith({ manifests: { [MANIFEST_PATH]: BASE }, images: allImages(validManifest()) });
    await settled(store, "rig");
    // 伺服器端快照把 reduced motion 當成開啟（判不出來就最安靜）。
    const markup = closeUpMarkup(store);
    expect(markup).not.toContain('viewBox="0 0 80 100"');
    expect(markup).toContain('data-rig-state="static"');
    expect(markup).toMatch(/class="v5-rig"[^>]*aria-hidden="true"/);
    for (const layer of validManifest().closeUpRig.layers) {
      expect(markup).toContain(`src="/art/characters/${SLICE_CHARACTER_ID}/${layer.file}"`);
    }
    expect(markup).toMatch(/class="v5-rig__static"[^>]*style="opacity:1;transition:opacity 80ms ease-in-out"/);
    // 文字層照舊：reduced motion 的狀態文字仍在。
    expect(markup).toContain("靜態畫面：他");
  });

  it("the rig starts at rest with motion allowed, and every fade stays within the token", () => {
    const manifest = validManifest();
    const markup = render(
      <CharacterRig characterId={SLICE_CHARACTER_ID} manifest={manifest} reducedMotion={false} onBroken={() => {}} />,
    );
    expect(markup).toContain('data-rig-state="paused"');
    expect(markup).toMatch(/class="v5-rig__static"[^>]*style="opacity:0;/);
    // 只有睜眼層一開始可見。
    expect(markup).toMatch(/data-part="lidHalf" style="opacity:0"/);
    expect(markup).toMatch(/data-part="lidClosed" style="opacity:0"/);
    expect(markup).not.toMatch(/data-part="lidOpen" style="opacity:0"/);
    // 拇指以 pivot 為軸。
    expect(markup).toMatch(/data-part="thumb" style="transform-origin:17\.6097\d*% 65\.5769\d*%/);
    // 呼吸縮放以腰線為錨（torso：(776 - 369) / 415）。
    expect(markup).toMatch(/data-breath="scale" style="[^"]*transform-origin:0 98\.0722\d*%/);
    expect(manifest.closeUpRig.motion.reducedFadeMs).toBeLessThanOrEqual(REDUCED_FADE_MAX_MS);
    expect(markup).toContain(`animation:v5-rig-in ${manifest.closeUpRig.motion.reducedFadeMs}ms ease-out`);
  });
});
