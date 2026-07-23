export const SEALED_STUDY_BUILD_ID = "study-2026-07-23.5" as const;
export const STUDY_ORIGIN = "https://world.panshi.app" as const;

export function resolveStudyBuildId(value: string | undefined, isDevelopment: boolean): string | null {
  const candidate = value?.trim();
  if (isDevelopment) return candidate || "local-dev";
  return candidate === SEALED_STUDY_BUILD_ID ? candidate : null;
}

export function isApprovedStudyRuntime(options: {
  origin: string;
  isSecureContext: boolean;
  isDevelopment: boolean;
}): boolean {
  return options.isDevelopment || (options.origin === STUDY_ORIGIN && options.isSecureContext);
}
