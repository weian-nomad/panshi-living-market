import { normalizeParticipantCode, type StudyVisitOrdinal } from "./study";

export type ParticipantRoute = {
  kind: "participant";
  participantCode: string;
  visitOrdinal: StudyVisitOrdinal;
};

export type StudyRoute =
  | { kind: "standard" }
  | ParticipantRoute
  | { kind: "researcher" }
  | { kind: "invalid"; message: string };

export function resolveStudyRoute(url: URL): StudyRoute {
  const parameters = url.searchParams;
  const pathSegments = url.pathname.split("/").filter(Boolean);

  if (pathSegments[0] === "research" || parameters.get("research") === "1") {
    return { kind: "researcher" };
  }

  const pathParticipantCode = pathSegments[0] === "study" ? pathSegments[1] : null;
  const hasStudyRoute = pathSegments[0] === "study" || parameters.has("study");
  if (!hasStudyRoute) return { kind: "standard" };

  const participantCode = normalizeParticipantCode(pathParticipantCode ?? parameters.get("study") ?? "");
  const visit = Number(parameters.get("visit"));
  if (!participantCode) {
    return { kind: "invalid", message: "研究代碼必須是 P01 至 P24。請向研究人員取得新的連結。" };
  }
  if (visit !== 1 && visit !== 2) {
    return { kind: "invalid", message: "觀看次序缺少或不正確。請向研究人員取得新的連結。" };
  }

  return { kind: "participant", participantCode, visitOrdinal: visit };
}
