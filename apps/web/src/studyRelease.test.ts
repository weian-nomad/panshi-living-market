import { describe, expect, it } from "vitest";

import {
  isApprovedStudyRuntime,
  resolveStudyBuildId,
  SEALED_STUDY_BUILD_ID,
  STUDY_ORIGIN,
} from "./studyRelease";

describe("sealed study release", () => {
  it("accepts only the sealed production build", () => {
    expect(resolveStudyBuildId(SEALED_STUDY_BUILD_ID, false)).toBe(SEALED_STUDY_BUILD_ID);
    expect(resolveStudyBuildId("study-wrong", false)).toBeNull();
    expect(resolveStudyBuildId(undefined, false)).toBeNull();
  });

  it("keeps local development explicit and the release on the world origin", () => {
    expect(resolveStudyBuildId(undefined, true)).toBe("local-dev");
    expect(STUDY_ORIGIN).toBe("https://world.panshi.app");
  });

  it("allows production study data only on the secure sealed origin", () => {
    expect(
      isApprovedStudyRuntime({
        origin: STUDY_ORIGIN,
        isSecureContext: true,
        isDevelopment: false,
      }),
    ).toBe(true);
    expect(
      isApprovedStudyRuntime({
        origin: "https://temporary-host.example",
        isSecureContext: true,
        isDevelopment: false,
      }),
    ).toBe(false);
    expect(
      isApprovedStudyRuntime({
        origin: STUDY_ORIGIN,
        isSecureContext: false,
        isDevelopment: false,
      }),
    ).toBe(false);
    expect(
      isApprovedStudyRuntime({
        origin: "http://localhost:4173",
        isSecureContext: false,
        isDevelopment: true,
      }),
    ).toBe(true);
  });
});
