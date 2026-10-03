import type { Plugin } from "vite";

/** `/api/v2/` -- the public API prefix the slice fixtures are served under. */
export declare const API_PREFIX: string;

/** The slice route table (public path -> fixture-relative file), or `null` when unreadable. */
export declare function readRouteTable(): Promise<Record<string, unknown> | null>;

/** Absolute fixture path for a route-table entry, or `null` when it leaves the fixture root. */
export declare function resolveFixtureFile(relativePath: unknown): string | null;

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
