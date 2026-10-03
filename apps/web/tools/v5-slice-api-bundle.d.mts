import type { Plugin } from "vite";

/** `dist`-relative file a public `/api/v2/*` route is bundled at (`api/v2/<rest>.json`). */
export declare function bundleFileForRoute(route: string): string;

/** Every slice route with its bundled file name and the fixture bytes; throws instead of returning a partial list. */
export declare function collectSliceApiBundle(): Promise<{ route: string; fileName: string; source: string }[]>;

/** Vite plugin that emits the slice API into `dist/api/v2/` during `vite build`. */
export declare function v5SliceApiBundle(): Plugin;
