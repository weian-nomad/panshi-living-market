import type { Plugin } from "vite";

/**
 * Serves the V5 one-character slice fixtures on the real `/api/v2/*` public
 * paths, and rewrites `/world` and `/people/*` to the slice shell entry.
 * Dev and preview only; fail-closed 404 `application/problem+json` otherwise.
 */
export declare function v5ApiMiddleware(): Plugin;
