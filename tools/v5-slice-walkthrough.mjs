#!/usr/bin/env node
// V5 一名角色垂直切片的端到端走查。
//
// 它啟動 `apps/web` 的 vite dev server（子行程，127.0.0.1:4173），等它就緒，
// 然後沿著實際的公開路徑走完 公共世界 → 角色近景 → 人生誌 → 深層檔案索引 →
// 模擬紀錄，逐條斷言最終 API 形狀。
//
// 為什麼是這六條：這條路徑就是產品結構本身（experience-spec §3）。任何一條斷了，
// 切片就不再是「可玩的垂直切片」，只是一堆各自能跑的檔案。
//
// 兩條硬規則：
// - 這個切片的市場事實全部是 repo 內自有的合成歷史 fixture，因此每一份回應裡
//   都不得出現 `real_fact`。標成 real_fact 就是說謊。
// - 今天（最後一個交易時段）還沒收盤定案，那筆紀錄的 `dailyActionDisclosure`
//   整個 key 必須不存在，而不是存在但填 null。
//
// 零相依：只用 node 內建模組與 global fetch（Node 24）。

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..");
const WEB_DIR = path.join(REPO_ROOT, "apps", "web");
const VITE_BIN = path.join(WEB_DIR, "node_modules", ".bin", "vite");

const HOST = "127.0.0.1";
const PORT = 4173;
const ORIGIN = `http://${HOST}:${PORT}`;

const READY_TIMEOUT_MS = 90_000;
const READY_POLL_MS = 250;

const TOTAL_CHECKS = 6;

/** 這個切片的市場事實一律是合成 fixture，永遠不得標成真實事實。 */
const FORBIDDEN_TRUTH_CLASS = "real_fact";

const failures = [];
const scannedBodies = [];
let checkIndex = 0;

function pass(label) {
  checkIndex += 1;
  console.log(`PASS [${checkIndex}/${TOTAL_CHECKS}] ${label}`);
}

function fail(label, detail) {
  checkIndex += 1;
  failures.push(`${label}：${detail}`);
  console.log(`FAIL [${checkIndex}/${TOTAL_CHECKS}] ${label} —— ${detail}`);
}

function assertAll(label, assertions) {
  const broken = assertions.filter((entry) => !entry.ok).map((entry) => entry.detail);
  if (broken.length === 0) {
    pass(label);
    return true;
  }
  fail(label, broken.join("；"));
  return false;
}

async function get(pathname) {
  const response = await fetch(`${ORIGIN}${pathname}`, { headers: { Accept: "*/*" } });
  const text = await response.text();
  scannedBodies.push(text);
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return {
    status: response.status,
    contentType: response.headers.get("content-type") ?? "",
    text,
    json,
  };
}

/** 每一份回應都就地掃一次；六條檢查一起把整個切片的 truth_class 掃過。 */
function truthClassAssertion(response) {
  return {
    ok: !response.text.includes(FORBIDDEN_TRUTH_CLASS),
    detail: `回應含 "${FORBIDDEN_TRUTH_CLASS}"，但本切片的市場事實是合成 fixture`,
  };
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function startDevServer() {
  const child = spawn(VITE_BIN, ["--host", HOST, "--port", String(PORT), "--strictPort"], {
    cwd: WEB_DIR,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

  const log = [];
  const keep = (chunk) => {
    log.push(chunk.toString());
    if (log.length > 200) log.shift();
  };
  child.stdout.on("data", keep);
  child.stderr.on("data", keep);

  return { child, log };
}

async function waitForServer(server) {
  const deadline = Date.now() + READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    if (server.child.exitCode !== null) {
      throw new Error(
        `dev server 在就緒前結束（exit ${server.child.exitCode}）：\n${server.log.join("")}`,
      );
    }
    try {
      const response = await fetch(`${ORIGIN}/world`, { headers: { Accept: "text/html" } });
      if (response.ok) {
        await response.arrayBuffer();
        return;
      }
    } catch {
      // 尚未監聽，繼續等。
    }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }

  throw new Error(`dev server 在 ${READY_TIMEOUT_MS}ms 內沒有就緒：\n${server.log.join("")}`);
}

function stopDevServer(server) {
  if (!server || server.child.exitCode !== null) return;
  server.child.kill("SIGTERM");
}

async function runChecks() {
  // 1. 公共世界的 HTML 外殼。
  const shell = await get("/world");
  assertAll("GET /world 回傳切片外殼", [
    { ok: shell.status === 200, detail: `HTTP ${shell.status}` },
    {
      ok: shell.contentType.includes("text/html"),
      detail: `content-type 是 ${shell.contentType || "（空）"}`,
    },
    truthClassAssertion(shell),
  ]);

  // 2. 世界投影：切片只有一名居民。
  const world = await get("/api/v2/world");
  const positions = Array.isArray(world.json?.characterPositions)
    ? world.json.characterPositions
    : [];
  assertAll("GET /api/v2/world 只有一名居民", [
    { ok: world.status === 200, detail: `HTTP ${world.status}` },
    { ok: positions.length === 1, detail: `characterPositions.length = ${positions.length}` },
    truthClassAssertion(world),
  ]);

  const characterId = positions[0]?.characterId;
  if (!isNonEmptyString(characterId)) {
    // 沒有角色 id 就走不下去：其餘四條直接記為失敗，不猜一個 id。
    for (const label of [
      "GET /api/v2/characters/{id}/close-up",
      "GET /api/v2/characters/{id}/life-journal",
      "GET /api/v2/characters/{id}/archive",
      "GET /api/v2/characters/{id}/archive/paper",
    ]) {
      fail(label, "世界投影沒有給出 characterId，後續路徑無法走查");
    }
    return;
  }

  const base = `/api/v2/characters/${encodeURIComponent(characterId)}`;

  // 3. 角色近景：一句未解矛盾 ＋ 一項後果碎片（截至前一交易日收盤）。
  const closeUp = await get(`${base}/close-up`);
  const highlightAsOf = closeUp.json?.recentConsequenceHighlight?.asOf;
  assertAll("GET /api/v2/characters/{id}/close-up 有未解矛盾與後果碎片", [
    { ok: closeUp.status === 200, detail: `HTTP ${closeUp.status}` },
    {
      ok: isNonEmptyString(closeUp.json?.unresolvedTensionSummary),
      detail: "缺 unresolvedTensionSummary",
    },
    {
      ok: isNonEmptyString(highlightAsOf) && highlightAsOf.startsWith("2026-03-17"),
      detail: `recentConsequenceHighlight.asOf = ${highlightAsOf ?? "（缺）"}`,
    },
    truthClassAssertion(closeUp),
  ]);

  // 4. 人生誌：五章，S2 有當時原話，S4 有重複模式。
  const journal = await get(`${base}/life-journal`);
  const entries = Array.isArray(journal.json?.entries) ? journal.json.entries : [];
  assertAll("GET /api/v2/characters/{id}/life-journal 五章，含原話與重複模式", [
    { ok: journal.status === 200, detail: `HTTP ${journal.status}` },
    { ok: entries.length === 5, detail: `entries.length = ${entries.length}` },
    {
      ok: entries[1]?.contemporaneousClaim !== undefined,
      detail: "entries[1] 沒有 contemporaneousClaim（S2 應該有當時原話）",
    },
    {
      ok: entries[3]?.recurringPatternRef !== undefined,
      detail: "entries[3] 沒有 recurringPatternRef（S4 應該出現老毛病）",
    },
    truthClassAssertion(journal),
  ]);

  // 5. 深層檔案索引：六節，只有模擬紀錄有真頁。
  const archive = await get(`${base}/archive`);
  const sections = Array.isArray(archive.json?.sections) ? archive.json.sections : [];
  const withPage = sections.filter((section) => section?.sectionPath !== null);
  assertAll("GET /api/v2/characters/{id}/archive 六節，只有模擬紀錄有真頁", [
    { ok: archive.status === 200, detail: `HTTP ${archive.status}` },
    { ok: sections.length === 6, detail: `sections.length = ${sections.length}` },
    {
      ok: withPage.length === 1 && withPage[0]?.sectionKey === "paper",
      detail: `有 sectionPath 的節：${withPage.map((section) => section?.sectionKey).join("、") || "（無）"}`,
    },
    truthClassAssertion(archive),
  ]);

  // 6. 模擬紀錄：完整紙上承擔 ＋ 同日不揭露。
  const paper = await get(`${base}/archive/paper`);
  const position = Array.isArray(paper.json?.positions) ? paper.json.positions[0] : undefined;
  const fills = Array.isArray(paper.json?.historicalActionFills)
    ? paper.json.historicalActionFills
    : [];
  const lastFill = fills[fills.length - 1];
  assertAll("GET /api/v2/characters/{id}/archive/paper 有完整紙上承擔與同日不揭露", [
    { ok: paper.status === 200, detail: `HTTP ${paper.status}` },
    { ok: position !== undefined, detail: "positions 是空的" },
    { ok: isNonEmptyString(position?.rationaleSummary), detail: "缺 rationaleSummary" },
    { ok: position?.concurrentClaim !== undefined, detail: "缺 concurrentClaim（當時原話）" },
    { ok: position?.currentNarration !== undefined, detail: "缺 currentNarration（現在說法）" },
    {
      ok: position?.invalidationCondition === "occurred",
      detail: `invalidationCondition = ${position?.invalidationCondition ?? "（缺）"}`,
    },
    {
      ok: typeof position?.realizedPnlMinorUnits === "number" && position.realizedPnlMinorUnits < 0,
      detail: `realizedPnlMinorUnits = ${position?.realizedPnlMinorUnits ?? "（缺）"}`,
    },
    {
      ok: lastFill !== undefined && !Object.hasOwn(lastFill, "dailyActionDisclosure"),
      detail: "最後一筆紀錄仍帶著 dailyActionDisclosure key（今天盤中不得揭露）",
    },
    truthClassAssertion(paper),
  ]);
}

async function main() {
  let server = null;
  try {
    server = startDevServer();
    await waitForServer(server);
    await runChecks();
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
    console.log(`FAIL 走查中止 —— ${failures[failures.length - 1]}`);
  } finally {
    stopDevServer(server);
  }

  const combined = scannedBodies.join("\n");
  const leaked = combined.includes(FORBIDDEN_TRUTH_CLASS);
  if (leaked) failures.push(`合併回應含 "${FORBIDDEN_TRUTH_CLASS}"`);

  if (failures.length === 0) {
    console.log(
      `ALL ${TOTAL_CHECKS} CHECKS PASSED（${scannedBodies.length} 份回應合計 0 處 "${FORBIDDEN_TRUTH_CLASS}"）`,
    );
    process.exitCode = 0;
    return;
  }

  console.log("");
  console.log(`走查失敗 ${failures.length} 項：`);
  for (const detail of failures) console.log(`- ${detail}`);
  process.exitCode = 1;
}

await main();
