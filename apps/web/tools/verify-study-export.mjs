#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  StudyExportValidationError,
  verifyStudyExport,
} from "../src/studyExportValidation.ts";

const MAX_FILE_BYTES = 64 * 1024 * 1024;
const inputPath = process.argv[2];

if (!inputPath) {
  console.error("用法：pnpm --filter @panshi/web study:verify <匯出的 JSON>");
  process.exitCode = 2;
} else {
  try {
    const absolutePath = resolve(inputPath);
    const source = await readFile(absolutePath);
    if (source.byteLength > MAX_FILE_BYTES) {
      throw new StudyExportValidationError("export: 檔案不可超過 64 MiB");
    }

    const payload = JSON.parse(source.toString("utf8"));
    const verified = verifyStudyExport(payload);
    const hash = createHash("sha256").update(source).digest("hex");
    const { result } = verified;

    console.log(
      JSON.stringify(
        {
          ok: true,
          sha256: hash,
          exportedAt: verified.exportedAt,
          evaluatorRevision: verified.evaluatorRevision,
          studyOrigin: verified.studyOrigin,
          eventCount: verified.events.length,
          participantCount: result.participantCount,
          holdAndDragCount: result.holdAndDragCount,
          fullForegroundCycleCount: result.fullForegroundCycleCount,
          returnedToTopResidentCount: result.returnedToTopResidentCount,
          invalidVisitDayCount: result.invalidVisitDayCount,
          invalidRunCount: result.invalidRunCount,
          duplicateVisitCount: result.duplicateVisitCount,
          appBuildIds: result.appBuildIds,
          consentVersions: result.consentVersions,
          readyForDecision: result.readyForDecision,
          passed: result.passed,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "無法驗證研究匯出";
    console.error(JSON.stringify({ ok: false, error: message }, null, 2));
    process.exitCode = 1;
  }
}
