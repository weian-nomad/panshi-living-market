// Pure path <-> route mapping for the V5 one-character vertical slice.
//
// Paths are the canonical public surfaces from `docs/v5/experience-spec.md`
// §12.1 (W01, C01, C02, C03, C04) plus the five other deep-archive sections
// (`/people/{id}/archive/{relations|chart|traits|memories|life}`, §9.1). No DOM,
// no history, no fetch: this module stays testable and framework-independent.

import type { ArchiveSectionKey } from "../api/generated-v2/types.gen";

export type Route =
  | { kind: "world" }
  | { kind: "closeUp"; characterId: string }
  | { kind: "journal"; characterId: string }
  | { kind: "archive"; characterId: string }
  | { kind: "archivePaper"; characterId: string }
  | { kind: "archiveRelations"; characterId: string }
  | { kind: "archiveChart"; characterId: string }
  | { kind: "archiveTraits"; characterId: string }
  | { kind: "archiveMemories"; characterId: string }
  | { kind: "archiveLife"; characterId: string }
  | { kind: "notFound" };

/** The six deep-archive routes, keyed by their contract `ArchiveSectionKey`. */
export type ArchiveSectionRouteKind =
  | "archivePaper"
  | "archiveRelations"
  | "archiveChart"
  | "archiveTraits"
  | "archiveMemories"
  | "archiveLife";

export const ARCHIVE_SECTION_ROUTE_KIND: Readonly<Record<ArchiveSectionKey, ArchiveSectionRouteKind>> = {
  paper: "archivePaper",
  relations: "archiveRelations",
  chart: "archiveChart",
  traits: "archiveTraits",
  memories: "archiveMemories",
  life: "archiveLife",
};

const ARCHIVE_SECTION_KEY_BY_KIND: Readonly<Record<ArchiveSectionRouteKind, ArchiveSectionKey>> = {
  archivePaper: "paper",
  archiveRelations: "relations",
  archiveChart: "chart",
  archiveTraits: "traits",
  archiveMemories: "memories",
  archiveLife: "life",
};

function isArchiveSectionKey(segment: string): segment is ArchiveSectionKey {
  return Object.hasOwn(ARCHIVE_SECTION_ROUTE_KIND, segment);
}

/** The route of one deep-archive section page for a character. */
export function archiveSectionRoute(sectionKey: ArchiveSectionKey, characterId: string): Route {
  return { kind: ARCHIVE_SECTION_ROUTE_KIND[sectionKey], characterId };
}

/** The contract section key of a deep-archive section route, or `null` for any other route. */
export function archiveSectionKeyOf(route: Route): ArchiveSectionKey | null {
  return Object.hasOwn(ARCHIVE_SECTION_KEY_BY_KIND, route.kind)
    ? ARCHIVE_SECTION_KEY_BY_KIND[route.kind as ArchiveSectionRouteKind]
    : null;
}

const NOT_FOUND: Route = { kind: "notFound" };

/**
 * The path the shell falls back to when a route has no address of its own
 * (currently only `notFound`). Never used to silently rewrite a bad URL: the
 * shell still renders the not-found state.
 */
export const HOME_PATH = "/world";

function decodeSegment(segment: string): string | null {
  if (segment.length === 0) return null;
  try {
    const decoded = decodeURIComponent(segment);
    return decoded.length === 0 ? null : decoded;
  } catch {
    return null;
  }
}

function splitPath(pathname: string): string[] {
  const withoutQuery = pathname.split(/[?#]/, 1)[0] ?? "";
  return withoutQuery.split("/").filter((segment) => segment.length > 0);
}

export function parsePath(pathname: string): Route {
  const segments = splitPath(pathname);

  // The bare origin is the public world: a stranger arriving at the root sees
  // the world, not a not-found state and not the sealed research shell (which
  // now lives at `/study`). `/world` stays the canonical address, so
  // `routeToPath` keeps returning it.
  if (segments.length === 0) {
    return { kind: "world" };
  }

  if (segments.length === 1 && segments[0] === "world") {
    return { kind: "world" };
  }

  if (segments[0] !== "people" || segments.length < 2) {
    return NOT_FOUND;
  }

  const characterId = decodeSegment(segments[1] ?? "");
  if (characterId === null) return NOT_FOUND;

  if (segments.length === 2) {
    return { kind: "closeUp", characterId };
  }

  if (segments.length === 3 && segments[2] === "journal") {
    return { kind: "journal", characterId };
  }

  if (segments.length === 3 && segments[2] === "archive") {
    return { kind: "archive", characterId };
  }

  if (segments.length === 4 && segments[2] === "archive" && isArchiveSectionKey(segments[3] ?? "")) {
    return archiveSectionRoute(segments[3] as ArchiveSectionKey, characterId);
  }

  return NOT_FOUND;
}

export function routeToPath(route: Route): string {
  switch (route.kind) {
    case "world":
      return "/world";
    case "closeUp":
      return `/people/${encodeURIComponent(route.characterId)}`;
    case "journal":
      return `/people/${encodeURIComponent(route.characterId)}/journal`;
    case "archive":
      return `/people/${encodeURIComponent(route.characterId)}/archive`;
    case "archivePaper":
    case "archiveRelations":
    case "archiveChart":
    case "archiveTraits":
    case "archiveMemories":
    case "archiveLife":
      return `/people/${encodeURIComponent(route.characterId)}/archive/${ARCHIVE_SECTION_KEY_BY_KIND[route.kind]}`;
    case "notFound":
      return HOME_PATH;
  }
}

/** Stable label used by the shell and by screen-reader announcements. */
export function routeLabel(route: Route): string {
  switch (route.kind) {
    case "world":
      return "公共世界";
    case "closeUp":
      return "角色近景";
    case "journal":
      return "人生誌";
    case "archive":
      return "深層檔案索引";
    case "archivePaper":
      return "模擬紀錄";
    case "archiveRelations":
      return "關係";
    case "archiveChart":
      return "本命盤";
    case "archiveTraits":
      return "性格與習慣";
    case "archiveMemories":
      return "記憶";
    case "archiveLife":
      return "生平";
    case "notFound":
      return "找不到這個頁面";
  }
}

export function characterIdOf(route: Route): string | null {
  switch (route.kind) {
    case "closeUp":
    case "journal":
    case "archive":
    case "archivePaper":
    case "archiveRelations":
    case "archiveChart":
    case "archiveTraits":
    case "archiveMemories":
    case "archiveLife":
      return route.characterId;
    default:
      return null;
  }
}
