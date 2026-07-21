import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const releaseId = "study-2026-07-21.1";
const evaluatorRevision = "v4-study-3";
const origin = "https://world.panshi.app";
const paths = {
  application: new URL("../apps/web/src/studyRelease.ts", import.meta.url),
  evaluator: new URL("../apps/web/src/study.ts", import.meta.url),
  build: new URL("../apps/web/vite.config.ts", import.meta.url),
  publicRelease: new URL("../apps/web/public/study-release.json", import.meta.url),
  document: new URL("../apps/web/index.html", import.meta.url),
  worker: new URL("../apps/web/public/study-sw.js", import.meta.url),
};
const contents = Object.fromEntries(
  await Promise.all(
    Object.entries(paths).map(async ([name, url]) => [name, await readFile(url, "utf8")]),
  ),
);

const publicRelease = JSON.parse(contents.publicRelease);
assert.equal(publicRelease.buildId, releaseId);
assert.equal(publicRelease.evaluatorRevision, evaluatorRevision);
assert.equal(publicRelease.origin, origin);
assert.equal(publicRelease.dataMode, "device-only");
assert.equal(publicRelease.analytics, false);

for (const name of ["application", "build"]) {
  assert.ok(contents[name].includes(releaseId), `${name} release ID drifted`);
}
assert.ok(contents.evaluator.includes(evaluatorRevision), "evaluator revision drifted");
assert.ok(contents.application.includes(origin), "application origin drifted");
assert.ok(contents.document.includes(`<link rel="canonical" href="${origin}/"`), "canonical origin drifted");
assert.ok(contents.document.includes('name="robots" content="noindex, nofollow, noarchive"'), "noindex missing");
assert.ok(contents.worker.includes("panshi-v4-study-2026-07-21-1"), "worker cache release drifted");

console.log(`study release audit passed: ${releaseId}`);
