import type { Plugin } from "vite";

/**
 * The document a route path must be served from, or `null` when the path
 * belongs to neither app (Vite then answers 404).
 */
export declare function resolveShellEntry(pathname: string): string | null;

/**
 * Serves the V5 one-character slice fixtures on the real `/api/v2/*` public
 * paths, rewrites `/`, `/world` and `/people/*` to the slice shell entry, and
 * `/study*` and `/research*` to the sealed research-v4 study document.
 * Dev and preview only; fail-closed 404 `application/problem+json` otherwise.
 */
export declare function v5ApiMiddleware(): Plugin;
