#!/usr/bin/env node
/**
 * Proves that `tools/v5-copy-lint.mjs` refuses what docs/v5/market-safety.md
 * (「文案 lint」 and release gate 4) says CI must refuse, with negative
 * fixtures on every surface gate 4 names: world, close-up, SSE, notification,
 * share, short video and accessible alternative text (two or more tampered
 * cases each), plus every front-end literal (whatever element, prop or file
 * type carries it), rewritten spellings (separators between the characters,
 * simplified / Japanese / variant forms), the 紙上 exception (allowed only in
 * a life-journal post-close review body, with time, simulation label,
 * original reason and consequence on the same object, and refused on every
 * other surface), damaged copies of registered contract objects, and
 * fail-closed behaviour when the single word-list source or the surface
 * registration is damaged.
 *
 * Every case works on a scratch copy of the files the lint reads; nothing in
 * the repository is modified. The notification / paywall / share / short-
 * video / SSE samples below exist only inside the scratch copy (the slice
 * serves none of those surfaces yet), and so does the life-journal
 * post-close review sample. Their Chinese sentences, and the words the
 * front-end cases splice into scratch copies of the sources, are test
 * placeholders, 未經 copy-taste 審稿, and are not product copy.
 *
 * Each refusal case names fragments the lint's message must contain, so a
 * case cannot pass because of an unrelated crash.
 *
 * Usage: node tools/v5-copy-lint.test.mjs
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const LINT = join(REPO_ROOT, "tools", "v5-copy-lint.mjs");
const SLICE_API = join("fixtures", "v5", "one-character-slice", "api");
const COPIED = [
  join("docs", "v5", "market-safety.md"),
  join("contracts", "openapi", "public-v2.yaml"),
  join("contracts", "openapi", "public-v2-copy-surfaces.json"),
  join("contracts", "world-fact-manifest"),
  SLICE_API,
  join("apps", "web", "src"),
];

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const writeJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

const CHARACTER_ID = readJson(join(REPO_ROOT, SLICE_API, "index.json")).characterId;
if (typeof CHARACTER_ID !== "string") throw new Error("fixture shape drifted: api/index.json has no characterId");
const characterFile = (root, name) => join(root, SLICE_API, "v2", "characters", CHARACTER_ID, name);
const worldFile = (root) => join(root, SLICE_API, "v2", "world.json");
const sampleFile = (root, name) => join(root, "fixtures", "v5", "copy-surface-samples", name);

// -- clean samples of the surfaces the slice does not serve yet --------------
// Test placeholders, 未經 copy-taste 審稿.
const SAMPLES = {
  "sse-frame.json": () => ({
    eventKind: "character_event",
    resourceRef: `/api/v2/characters/${CHARACTER_ID}/close-up`,
    checkpointCursor: "cursor-000393",
    visibilityEpoch: 1,
    serverNow: "2026-04-14T13:31:00+08:00",
  }),
  "notification.json": () => ({
    copySurfaceType: "notification",
    notificationId: "notification-001",
    characterId: CHARACTER_ID,
    sentAt: "2026-04-14T18:00:00+08:00",
    title: "陸硯之",
    body: "陸硯之剛把昨天那句話收回去了。",
    deepLinkPath: `/people/${CHARACTER_ID}/journal`,
    altText: "陸硯之的幾何佔位肖像",
  }),
  "paywall.json": () => ({
    copySurfaceType: "paywall",
    paywallId: "paywall-001",
    planId: "pro",
    headline: "完整人物歷史",
    body: "Pro 收的是完整人物歷史、收藏與無廣告，市場資訊的時間邊界和免費版相同。",
    ctaLabel: "了解 Pro",
    altText: "人生誌書架的幾何佔位圖",
  }),
  "share-card.json": () => ({
    copySurfaceType: "share_card",
    shareCardId: "share-001",
    characterId: CHARACTER_ID,
    sourceContext: "life_journal_post_close_review",
    dataAsOf: "2026-04-13T13:30:00+08:00",
    sessionDate: "2026-04-08",
    characterDisplayName: "陸硯之",
    headline: "他昨天勸別人別追，今天自己追進去了。",
    body: "組會上他先說是別人的關係，後來又說是自己判斷錯了。",
    instrumentLabel: "PSZS-DEMO",
    fictionalAdultLabel: "成年虛構角色",
    simulationLabel: "紙上模擬",
    originalReason: "他原本以為同業存貨天數會回落。",
    consequenceSummary: "未實現虧損 7,680 元，理由換過一次，新增支持事實 0 筆。",
    linkPath: `/people/${CHARACTER_ID}/journal#chapter-2026-04-08`,
    altText: "陸硯之在組會後翻看自己的紀錄",
  }),
  "short-video.json": () => ({
    copySurfaceType: "short_video",
    shortVideoId: "short-001",
    characterId: CHARACTER_ID,
    sourceContext: "life_journal_post_close_review",
    dataAsOf: "2026-04-13T13:30:00+08:00",
    sessionDate: "2026-04-08",
    characterDisplayName: "陸硯之",
    title: "兩次組會，兩種說法",
    captionLines: ["第一次，他說是旁邊的人。", "第二次，他說是自己。"],
    instrumentLabel: "PSZS-DEMO",
    fictionalAdultLabel: "成年虛構角色",
    simulationLabel: "紙上模擬",
    originalReason: "他原本以為同業存貨天數會回落。",
    consequenceSummary: "未實現虧損 7,680 元。",
    linkPath: `/people/${CHARACTER_ID}/journal#chapter-2026-04-08`,
    altText: "開盤廳裡一名成年居民低頭看紀錄",
  }),
  "journal-review.json": () => ({
    copySurfaceType: "life_journal_review",
    reviewId: "review-2026-04-08",
    characterId: CHARACTER_ID,
    chapterId: "chapter-2026-04-08",
    sourceContext: "life_journal_post_close_review",
    sessionDate: "2026-04-08",
    reviewedAt: "2026-04-08T14:10:00+08:00",
    headline: "兩次組會，兩種說法",
    body: "收盤後回看這一天：他原本的理由還在紙上，後來的說法換過一次。",
    instrumentLabel: "PSZS-DEMO",
    simulationLabel: "紙上模擬",
    originalReason: "他原本以為同業存貨天數會回落。",
    consequenceSummary: "未實現虧損 7,680 元，理由換過一次，新增支持事實 0 筆。",
    altText: "陸硯之在收盤後翻看自己的紀錄",
  }),
};

const scratchBase = mkdtempSync(join(tmpdir(), "v5-copy-lint-"));
let serial = 0;
function scratchCopy({ samples = true } = {}) {
  serial += 1;
  const root = join(scratchBase, `case-${String(serial).padStart(3, "0")}`);
  for (const path of COPIED) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    cpSync(join(REPO_ROOT, path), join(root, path), { recursive: true });
  }
  if (samples) for (const [name, make] of Object.entries(SAMPLES)) writeJson(sampleFile(root, name), make());
  return root;
}

function editJson(path, mutate) {
  const value = readJson(path);
  mutate(value);
  writeJson(path, value);
}

function editText(path, from, to) {
  const text = readFileSync(path, "utf8");
  if (!text.includes(from)) throw new Error(`fixture shape drifted: ${path} no longer contains ${JSON.stringify(from)}`);
  writeFileSync(path, text.replace(from, to));
}

const tsx = (root, name) => join(root, "apps", "web", "src", "v5", name);
const webSrc = (root, ...parts) => join(root, "apps", "web", "src", ...parts);
const doc = (root) => join(root, "docs", "v5", "market-safety.md");
const yaml = (root) => join(root, "contracts", "openapi", "public-v2.yaml");
const registry = (root) => join(root, "contracts", "openapi", "public-v2-copy-surfaces.json");

/** The fenced word-list block in the scratch copy's market-safety document. */
function lexiconBlock(root) {
  const text = readFileSync(doc(root), "utf8");
  const heading = text.indexOf("## 文案 lint");
  const open = text.indexOf("```text\n", heading);
  const close = text.indexOf("```\n", open + 8);
  if (heading === -1 || open === -1 || close === -1) throw new Error("fixture shape drifted: market-safety.md has no 文案 lint block");
  return { text, open, close };
}

function runLint(root) {
  try {
    const stdout = execFileSync(process.execPath, [LINT, "--root", root], { stdio: ["ignore", "pipe", "pipe"] }).toString("utf8");
    return { code: 0, output: stdout };
  } catch (error) {
    return { code: error.status ?? 1, output: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  }
}

/** Share card with the 紙上 exception term and every same-screen fact. */
function exceptionShareCard(root, mutate = () => {}) {
  editJson(sampleFile(root, "share-card.json"), (card) => {
    card.body = "2026-04-08 收盤後回看：他紙上買進 PSZS-DEMO 1,000 股，理由與後果寫在下面。";
    mutate(card);
  });
}

/** Life-journal post-close review whose body uses the 紙上 exception term. */
function exceptionReview(root, mutate = () => {}) {
  editJson(sampleFile(root, "journal-review.json"), (review) => {
    review.body = "2026-04-08 收盤後回看：他那天紙上買進 PSZS-DEMO 1,000 股，理由與後果寫在下面。";
    mutate(review);
  });
}

/** A world story-hook headline carrying `text` (the rewritten-spelling cases). */
const hookLabel = (text) => (root) => editJson(worldFile(root), (w) => (w.storyHooks[0].label = text));

const CASES = [
  // -- baselines ------------------------------------------------------------
  { name: "0a. pristine copy of the repo passes", pass: true, tamper: () => {}, samples: false },
  { name: "0b. clean SSE / notification / paywall / share / short-video samples pass", pass: true, tamper: () => {} },

  // -- world ----------------------------------------------------------------
  {
    name: "W1. world story-hook label (今日五幕 headline) names a pick",
    expects: ["world.json", "[headline]", "「看好」"],
    tamper: (root) => editJson(worldFile(root), (w) => (w.storyHooks[0].label = "今日五幕：她最看好的上漲機會")),
  },
  {
    name: "W2. world focus hint names a fixture instrument and a listed word",
    expects: ["world.json", "focusHint", "[caption]", "「加碼」"],
    tamper: (root) => editJson(worldFile(root), (w) => (w.characterPositions[0].focusHint = "盯著 PSZS-DEMO，準備加碼")),
  },
  {
    name: "W3. a zero-width character inside the word does not hide it",
    expects: ["[headline]", "「值得關注」"],
    tamper: (root) => editJson(worldFile(root), (w) => (w.storyHooks[0].label = "開盤廳裡值​得 關注的一幕")),
  },
  {
    name: "W4. control: a headline is checked even with no ticker (stricter than the document)",
    expects: ["[headline]", "「布局」"],
    tamper: (root) => editJson(worldFile(root), (w) => (w.storyHooks[0].label = "他還在布局")),
  },
  {
    name: "W5. control: a caption with no ticker is outside the document's scope and passes",
    pass: true,
    tamper: (root) => editJson(worldFile(root), (w) => (w.characterPositions[0].focusHint = "他在想要不要加碼咖啡")),
  },

  // -- close-up ------------------------------------------------------------
  {
    name: "C1. close-up unresolved-tension sentence gains a target price",
    expects: ["close-up.json", "unresolvedTensionSummary", "[headline]", "「目標價」"],
    tamper: (root) => editJson(characterFile(root, "close-up.json"), (c) => (c.unresolvedTensionSummary += "目標價一百二。")),
  },
  {
    name: "C2. close-up attention label turns ticker-specific and bullish",
    expects: ["close-up.json", "currentAttention.label", "[caption]", "「翻多」"],
    tamper: (root) => editJson(characterFile(root, "close-up.json"), (c) => (c.currentAttention.label = "PSZS-DEMO 翻多訊號")),
  },
  {
    name: "C3. close-up identity line (display name) carries a listed word",
    expects: ["close-up.json", "displayName", "「神準」"],
    tamper: (root) => editJson(characterFile(root, "close-up.json"), (c) => (c.displayName = "神準陸硯之")),
  },
  {
    name: "C4. archive long-term tension sentence (headline) carries a listed word",
    expects: ["archive.json", "longTermTensionSummary", "「勝率」"],
    tamper: (root) => editJson(characterFile(root, "archive.json"), (a) => (a.longTermTensionSummary = "勝率很高的研究助理")),
  },

  // -- SSE ------------------------------------------------------------------
  {
    name: "S1. SSE frame resourceRef carries a listed word",
    expects: ["sse-frame.json", "resourceRef", "[sse_event]", "「跟單」"],
    tamper: (root) =>
      editJson(sampleFile(root, "sse-frame.json"), (f) => (f.resourceRef = `/api/v2/characters/${CHARACTER_ID}/close-up?hint=跟單`)),
  },
  {
    name: "S2. SSE frame gains an undeclared prose field",
    expects: ["sse-frame.json", "WorldStreamEventEnvelope", "undeclared note", "「看好」"],
    tamper: (root) => editJson(sampleFile(root, "sse-frame.json"), (f) => (f.note = "五人都看好")),
  },
  {
    name: "S3. SSE frame eventKind carries a listed word",
    expects: ["sse-frame.json", "eventKind", "「進場」"],
    tamper: (root) => editJson(sampleFile(root, "sse-frame.json"), (f) => (f.eventKind = "進場提醒")),
  },

  // -- notification ---------------------------------------------------------
  {
    name: "N1. notification title recalls by trading, not by the person",
    expects: ["notification.json", "[notification]", "「加碼」"],
    tamper: (root) => editJson(sampleFile(root, "notification.json"), (n) => (n.title = "陸硯之剛剛加碼了")),
  },
  {
    name: "N2. notification never takes the 紙上 exception, even with every same-screen fact",
    expects: ["notification.json", "「紙上買進」", "kind notification is never eligible"],
    tamper: (root) =>
      editJson(sampleFile(root, "notification.json"), (n) => {
        n.body = "2026-04-08 他紙上買進 PSZS-DEMO。";
        Object.assign(n, {
          sourceContext: "life_journal_post_close_review",
          sessionDate: "2026-04-08",
          simulationLabel: "紙上模擬",
          originalReason: "他原本以為存貨天數會回落。",
          consequenceSummary: "未實現虧損 7,680 元。",
        });
      }),
  },
  {
    name: "N3. notification gains an undeclared field",
    expects: ["notification.json", "undeclared field subtitle", "「必漲」"],
    tamper: (root) => editJson(sampleFile(root, "notification.json"), (n) => (n.subtitle = "必漲名單")),
  },

  // -- paywall --------------------------------------------------------------
  {
    name: "P1. paywall headline sells earlier picks",
    expects: ["paywall.json", "[paywall]", "「下週可買」"],
    tamper: (root) => editJson(sampleFile(root, "paywall.json"), (p) => (p.headline = "升級 Pro 先看下週可買")),
  },
  {
    name: "P2. paywall CTA carries a listed word",
    expects: ["paywall.json", "ctaLabel", "「跟單」"],
    tamper: (root) => editJson(sampleFile(root, "paywall.json"), (p) => (p.ctaLabel = "立即跟單")),
  },

  // -- share ----------------------------------------------------------------
  {
    name: "SH1. share-card headline invites copying the character",
    expects: ["share-card.json", "headline", "[share]", "「跟單」"],
    tamper: (root) => editJson(sampleFile(root, "share-card.json"), (s) => (s.headline = "跟單陸硯之")),
  },
  {
    name: "SH2. share-card CTA takes the 紙上 exception (never as a call to action)",
    expects: ["share-card.json", "ctaLabel", "「紙上買進」", "role cta is never eligible"],
    tamper: (root) => editJson(sampleFile(root, "share-card.json"), (s) => (s.ctaLabel = "一起紙上買進")),
  },
  {
    name: "SH3. share-card body wording flips to a direction call",
    expects: ["share-card.json", "body", "「翻空」"],
    tamper: (root) => editJson(sampleFile(root, "share-card.json"), (s) => (s.body = "組會之後他翻空了。")),
  },
  {
    name: "SH4. share card missing the fictional-adult label is refused",
    expects: ["share-card.json", "missing required field fictionalAdultLabel"],
    tamper: (root) => editJson(sampleFile(root, "share-card.json"), (s) => delete s.fictionalAdultLabel),
  },

  // -- short video ----------------------------------------------------------
  {
    name: "V1. short-video caption line carries a listed word",
    expects: ["short-video.json", "captionLines[1]", "[short_video]", "「下週可買」"],
    tamper: (root) => editJson(sampleFile(root, "short-video.json"), (v) => (v.captionLines[1] = "下週可買嗎？")),
  },
  {
    name: "V2. short-video title uses chart language for a price call",
    expects: ["short-video.json", "title", "「命定漲跌」"],
    tamper: (root) => editJson(sampleFile(root, "short-video.json"), (v) => (v.title = "命定漲跌：星象轉強")),
  },
  {
    name: "V3. short-video burned-in caption gains an undeclared field",
    expects: ["short-video.json", "undeclared field overlayText", "「出場」"],
    tamper: (root) => editJson(sampleFile(root, "short-video.json"), (v) => (v.overlayText = "出場訊號")),
  },

  // -- accessible alternative text ------------------------------------------
  {
    name: "A1. front-end aria-label literal (portrait) carries a listed word",
    expects: ["ArchiveIndexScreen.tsx", "[frontend_static]", "「布局」"],
    tamper: (root) =>
      editText(tsx(root, "ArchiveIndexScreen.tsx"), 'aria-label="幾何佔位肖像：一名成年居民的側身輪廓"', 'aria-label="幾何佔位肖像：一名正在布局的成年居民"'),
  },
  {
    name: "A2. front-end aria-label on the evidence card carries a listed word",
    expects: ["EvidenceCardView.tsx", "[frontend_static]", "「出場」"],
    tamper: (root) => editText(tsx(root, "EvidenceCardView.tsx"), 'aria-label="證據卡"', 'aria-label="證據卡：出場訊號"'),
  },
  {
    name: "A3. front-end label held in a same-file const map",
    expects: ["ArchiveSectionScreen.tsx", "[frontend_static]", "「進場」"],
    tamper: (root) => editText(tsx(root, "ArchiveSectionScreen.tsx"), '"本命盤"', '"本命盤進場時機"'),
  },
  {
    name: "A4. share-card altText carries a listed word",
    expects: ["share-card.json", "altText", "[alt_text]", "「勝率」"],
    tamper: (root) => editJson(sampleFile(root, "share-card.json"), (s) => (s.altText = "勝率九成的角色肖像")),
  },
  {
    name: "A5. notification altText takes the 紙上 exception (alt text is never eligible)",
    expects: ["notification.json", "altText", "kind alt_text is never eligible"],
    tamper: (root) => editJson(sampleFile(root, "notification.json"), (n) => (n.altText = "他紙上賣出的畫面")),
  },

  // -- front-end headings and buttons ---------------------------------------
  {
    name: "F1. front-end h3 literal carries a listed word",
    expects: ["ArchiveIndexScreen.tsx", "[frontend_static]", "「值得關注」"],
    tamper: (root) => editText(tsx(root, "ArchiveIndexScreen.tsx"), "<h3>最近留下的三件事</h3>", "<h3>最近值得關注的三件事</h3>"),
  },
  {
    name: "F2. front-end button literal carries a listed word",
    expects: ["CloseUpScreen.tsx", "[frontend_static]", "「跟單」"],
    tamper: (root) =>
      editText(tsx(root, "CloseUpScreen.tsx"), "\n          翻開今天的人生誌\n", "\n          跟單今天的人生誌\n"),
  },
  {
    name: "F3. a word split across a JSX text node and a string literal is still found",
    expects: ["PaperArchiveScreen.tsx", "「加碼」", "across adjacent literals"],
    tamper: (root) => editText(tsx(root, "PaperArchiveScreen.tsx"), "<h3>交易紀錄</h3>", '<h3>交易紀錄加{"碼"}</h3>'),
  },
  {
    name: "F4. a front-end literal never takes the 紙上 exception",
    expects: ["PaperArchiveScreen.tsx", "「紙上賣出」", "kind frontend_static is never eligible", "static literal cannot carry the same-screen facts"],
    tamper: (root) => editText(tsx(root, "PaperArchiveScreen.tsx"), "<h3>交易紀錄</h3>", "<h3>交易紀錄（紙上賣出）</h3>"),
  },
  {
    name: "F5. a section title passed as a prop (<Group title>) is checked",
    expects: ["ArchiveSectionScreen.tsx", "[frontend_static]", "「進場」"],
    tamper: (root) => editText(tsx(root, "ArchiveSectionScreen.tsx"), '<Group title="出生資料">', '<Group title="出生資料與進場時機">'),
  },
  {
    name: "F6. a title in a module-level section-order array rendered through a prop is checked",
    expects: ["ArchiveIndexScreen.tsx", "[frontend_static]", "「看好」"],
    tamper: (root) => editText(tsx(root, "ArchiveIndexScreen.tsx"), '{ key: "paper", title: "模擬紀錄" }', '{ key: "paper", title: "模擬紀錄（看好）" }'),
  },
  {
    name: "F7. an h4 is checked (no element allowlist)",
    expects: ["EvidenceCardView.tsx", "[frontend_static]", "「跟單」"],
    tamper: (root) => editText(tsx(root, "EvidenceCardView.tsx"), "<h4>動作</h4>", "<h4>動作：跟單</h4>"),
  },
  {
    name: "F8. a label returned by a plain .ts function (routeLabel) is checked",
    expects: ["router.ts", "[frontend_static]", "「加碼」"],
    tamper: (root) => editText(tsx(root, "router.ts"), 'return "模擬紀錄";', 'return "模擬紀錄・加碼";'),
  },
  {
    name: "F9. the static part of a template literal is checked",
    expects: ["ArchiveSectionScreen.tsx", "[frontend_static]", "「目標價」"],
    tamper: (root) =>
      editText(tsx(root, "ArchiveSectionScreen.tsx"), "（${person.relationLabel}）`", "（${person.relationLabel}）目標價`"),
  },
  {
    name: "F10. a word split across a + chain of literals is found",
    expects: ["router.ts", "「加碼」", "across adjacent literals"],
    tamper: (root) => editText(tsx(root, "router.ts"), 'return "模擬紀錄";', 'return "模擬紀錄加" + "碼";'),
  },
  {
    name: "F11. a source file outside apps/web/src/v5 is checked",
    expects: ["apps/web/src/scene.ts", "[frontend_static]", "「必漲」"],
    tamper: (root) => editText(webSrc(root, "scene.ts"), '"一筆模擬部位"', '"一筆必漲部位"'),
  },
  {
    name: "F12. control: a module specifier is not copy",
    pass: true,
    tamper: (root) => editText(tsx(root, "router.ts"), "/** Stable label used", 'import "./看好.css";\n/** Stable label used'),
  },
  {
    name: "F13. control: test files, test helpers and the generated-v2 client are not scanned",
    pass: true,
    tamper: (root) => {
      for (const path of [tsx(root, "router.test.ts"), tsx(root, "testing/fixtureFactory.ts"), webSrc(root, "api", "generated-v2", "types.gen.ts")]) {
        writeFileSync(path, `${readFileSync(path, "utf8")}\nexport const PLACEHOLDER_ONLY = "看好";\n`);
      }
    },
  },
  {
    name: "F14. an exclude pattern that swallows every source file fails closed",
    expects: ["frontend: no source files", "failing closed"],
    tamper: (root) => editJson(registry(root), (r) => (r.frontend.excludeFilePattern = ".*")),
  },
  {
    name: "F15. a registry that drops .ts from the scan fails closed",
    expects: ["public-v2-copy-surfaces.json", "scan both .ts and .tsx", "failing closed"],
    tamper: (root) => editJson(registry(root), (r) => (r.frontend.fileExtensions = [".tsx"])),
  },

  // -- rewritten spellings ------------------------------------------------------
  { name: "B1. 買・進 (middle dot between the characters)", expects: ["[headline]", "「買進」"], tamper: hookLabel("他在買・進之間來回") },
  { name: "B2. 買.進 (full stop)", expects: ["[headline]", "「買進」"], tamper: hookLabel("他想買.進去") },
  { name: "B3. 買-進 (hyphen)", expects: ["[headline]", "「買進」"], tamper: hookLabel("他想買-進去") },
  { name: "B4. 看。好 (ideographic full stop)", expects: ["[headline]", "「看好」"], tamper: hookLabel("大家都看。好") },
  { name: "B5. 看＿好 (full-width low line)", expects: ["[headline]", "「看好」"], tamper: hookLabel("大家都看＿好") },
  { name: "B6. 买进 (simplified)", expects: ["[headline]", "「買進」"], tamper: hookLabel("他今天买进了") },
  { name: "B7. 下周可买 (simplified, merged 周)", expects: ["[headline]", "「下週可買」"], tamper: hookLabel("下周可买吗") },
  { name: "B8. 佈局 (Taiwan variant spelling)", expects: ["[headline]", "「布局」"], tamper: hookLabel("他還在佈局") },
  { name: "B9. 値得関注 (Japanese forms)", expects: ["[headline]", "「值得關注」"], tamper: hookLabel("値得関注的一幕") },
  { name: "B10. 必🔥涨 (emoji between, simplified second character)", expects: ["[headline]", "「必漲」"], tamper: hookLabel("必🔥涨名單") },
  {
    name: "B11. rewritten spelling in a front-end literal",
    expects: ["router.ts", "[frontend_static]", "「目標價」"],
    tamper: (root) => editText(tsx(root, "router.ts"), 'return "模擬紀錄";', 'return "模擬紀錄：目「标」价";'),
  },
  { name: "B12. control: a Latin letter between the characters is not a separator", pass: true, tamper: hookLabel("他看 A 好幾次") },
  { name: "B13. U+FE00 variation selector between the characters", expects: ["[headline]", "「買進」"], tamper: hookLabel("他想買︀進去") },
  { name: "B14. U+034F combining grapheme joiner between the characters", expects: ["[headline]", "「看好」"], tamper: hookLabel("大家都看͏好") },
  { name: "B15. U+3164 Hangul filler between the characters", expects: ["[headline]", "「加碼」"], tamper: hookLabel("他又加ㅤ碼") },
  {
    name: "B16. a JSX character reference renders as the character and is found",
    expects: ["EvidenceCardView.tsx", "[frontend_static]", "「買進」"],
    tamper: (root) => editText(tsx(root, "EvidenceCardView.tsx"), "<h4>動作</h4>", "<h4>動作：&#x8CB7;&#36914;</h4>"),
  },
  {
    name: "B17. a JSX attribute string with a character reference is found",
    expects: ["EvidenceCardView.tsx", "[frontend_static]", "「跟單」"],
    tamper: (root) => editText(tsx(root, "EvidenceCardView.tsx"), "<h4>動作</h4>", '<h4 title="&#x8DDF;單">動作</h4>'),
  },
  {
    name: "B18. <wbr /> between the characters does not split the word",
    expects: ["EvidenceCardView.tsx", "「加碼」"],
    tamper: (root) => editText(tsx(root, "EvidenceCardView.tsx"), "<h4>動作</h4>", "<h4>動作加<wbr />碼</h4>"),
  },

  // -- the 紙上 exception: nowhere but a journal post-close review body --------
  {
    name: "E1. a share-card body with 紙上買進 and every same-screen fact is refused (share cards never take it)",
    expects: ["share-card.json", "$.body", "「紙上買進」", "kind share is never eligible"],
    tamper: (root) => exceptionShareCard(root),
  },
  {
    name: "E1b. a share-card headline with 紙上買進 and every same-screen fact is refused",
    expects: ["share-card.json", "$.headline", "「紙上買進」", "kind share is never eligible"],
    tamper: (root) => editJson(sampleFile(root, "share-card.json"), (s) => (s.headline = "2026-04-08 他紙上買進之後")),
  },
  {
    name: "E1c. a short-video title with 紙上賣出 and every same-screen fact is refused",
    expects: ["short-video.json", "$.title", "「紙上賣出」", "kind short_video is never eligible"],
    tamper: (root) => editJson(sampleFile(root, "short-video.json"), (v) => (v.title = "他紙上賣出的那一天")),
  },
  {
    name: "E1d. a contract headline (close-up verb phrase) with 紙上買進 is refused",
    expects: ["close-up.json", "currentVerbPhrase", "「紙上買進」", "kind headline is never eligible"],
    tamper: (root) => editJson(characterFile(root, "close-up.json"), (c) => (c.currentVerbPhrase = "正在回看自己紙上買進的那天")),
  },
  {
    name: "E1e. a journal review's own headline with 紙上買進 is refused (the exception is for its body)",
    expects: ["journal-review.json", "$.headline", "「紙上買進」", "kind headline is never eligible"],
    tamper: (root) => exceptionReview(root, (r) => (r.headline = "他紙上買進的那天")),
  },
  {
    name: "E0. 紙上買進 in a life-journal post-close review body with every same-screen fact passes",
    pass: true,
    tamper: (root) => exceptionReview(root),
  },
  {
    name: "E0b. 紙上賣出 in the review's consequence line passes too",
    pass: true,
    tamper: (root) => exceptionReview(root, (r) => (r.consequenceSummary = "他後來紙上賣出 400 股，實現虧損 4,720 元。")),
  },
  {
    name: "E2. the same review without the original reason is refused",
    expects: ["journal-review.json", "「紙上買進」", "missing: original reason"],
    tamper: (root) => exceptionReview(root, (r) => delete r.originalReason),
  },
  {
    name: "E3. the same review without a time is refused",
    expects: ["journal-review.json", "「紙上買進」", "missing: time"],
    tamper: (root) =>
      exceptionReview(root, (r) => {
        delete r.sessionDate;
        delete r.reviewedAt;
      }),
  },
  {
    name: "E4. the same review without the consequence is refused",
    expects: ["journal-review.json", "missing: consequence"],
    tamper: (root) => exceptionReview(root, (r) => (r.consequenceSummary = " ")),
  },
  {
    name: "E5. the same review whose simulation label does not say it is simulated is refused",
    expects: ["journal-review.json", "missing: simulation label"],
    tamper: (root) => exceptionReview(root, (r) => (r.simulationLabel = "角色紀錄")),
  },
  {
    name: "E6. the same review outside the post-close review context is refused",
    expects: ["journal-review.json", "sourceContext is not life_journal_post_close_review", "must have sourceContext"],
    tamper: (root) => exceptionReview(root, (r) => (r.sourceContext = "world_live")),
  },
  {
    name: "E7. the exception covers only the term: another listed word beside it is still refused",
    expects: ["journal-review.json", "blocked word 「看好」"],
    tamper: (root) => exceptionReview(root, (r) => (r.body += "他還是很看好。")),
  },
  {
    name: "E8. a bare 買進 next to a legitimate 紙上買進 is still refused",
    expects: ["journal-review.json", "blocked word 「買進」"],
    tamper: (root) => exceptionReview(root, (r) => (r.body += "你也可以買進。")),
  },
  {
    name: "E9. the registry marks share cards exception-eligible (fail closed)",
    expects: ["public-v2-copy-surfaces.json", "surfaceKinds.share is marked exception-eligible", "failing closed"],
    tamper: (root) => editJson(registry(root), (r) => (r.surfaceKinds.share.exceptionEligible = true)),
  },
  {
    name: "E10. the registry uses the review-body kind on a share card field (fail closed)",
    expects: ["public-v2-copy-surfaces.json", "share_card.body uses journal_review_body", "failing closed"],
    tamper: (root) => editJson(registry(root), (r) => (r.plannedSurfaceTypes.types.share_card.fields.body = "journal_review_body")),
  },
  {
    name: "E11. the review type stops fixing its context (fail closed)",
    expects: ["public-v2-copy-surfaces.json", "life_journal_review.body uses journal_review_body", "does not fix sourceContext"],
    tamper: (root) => editJson(registry(root), (r) => delete r.plannedSurfaceTypes.types.life_journal_review.constFields),
  },
  {
    name: "E12. a review-body field given a CTA role (fail closed)",
    expects: ["public-v2-copy-surfaces.json", "cannot carry a role"],
    tamper: (root) => editJson(registry(root), (r) => (r.plannedSurfaceTypes.types.life_journal_review.roles.body = "cta")),
  },

  // -- damaged copies of registered contract objects fail closed --------------
  {
    name: "M1. a close-up missing one required key is refused, and its headline is still checked",
    expects: ["close-up.json", "CharacterCloseUp", "missing sceneRef", "failing closed", "「目標價」"],
    tamper: (root) =>
      editJson(characterFile(root, "close-up.json"), (c) => {
        delete c.sceneRef;
        c.unresolvedTensionSummary += "目標價一百二。";
      }),
  },
  {
    name: "M2. a story hook missing its label truth class is refused, and its label is still checked",
    expects: ["world.json", "WorldStoryHookRef", "missing labelTruthClass", "failing closed", "「看好」"],
    tamper: (root) =>
      editJson(worldFile(root), (w) => {
        delete w.storyHooks[0].labelTruthClass;
        w.storyHooks[0].label = "她最看好的一幕";
      }),
  },
  {
    name: "M3. a world position missing zOrder is refused",
    expects: ["world.json", "CharacterWorldPosition", "missing zOrder", "failing closed"],
    tamper: (root) => editJson(worldFile(root), (w) => delete w.characterPositions[0].zOrder),
  },
  {
    name: "M4. an archive index missing its section list is refused",
    expects: ["archive.json", "CharacterArchiveIndex", "missing sections", "failing closed"],
    tamper: (root) => editJson(characterFile(root, "archive.json"), (a) => delete a.sections),
  },

  // -- single source and fail closed -----------------------------------------
  {
    name: "L1. the word list comes from the document: a word added there is enforced",
    expects: ["world.json", "blocked word 「抄底」"],
    tamper: (root) => {
      const { text, close } = lexiconBlock(root);
      writeFileSync(doc(root), `${text.slice(0, close)}抄底\n${text.slice(close)}`);
      editJson(worldFile(root), (w) => (w.storyHooks[0].label = "他在抄底"));
    },
  },
  {
    name: "L2. the word-list block is deleted from the document (fail closed)",
    expects: ["lexicon", "no fenced word list", "failing closed"],
    tamper: (root) => {
      const { text, open, close } = lexiconBlock(root);
      writeFileSync(doc(root), `${text.slice(0, open)}${text.slice(close + 4)}`);
    },
  },
  {
    name: "L3. the word-list block is emptied (fail closed)",
    expects: ["lexicon", "word list is empty", "failing closed"],
    tamper: (root) => {
      const { text, open, close } = lexiconBlock(root);
      writeFileSync(doc(root), `${text.slice(0, open + 8)}${text.slice(close)}`);
    },
  },
  {
    name: "L4. the 文案 lint section heading is gone (fail closed)",
    expects: ["lexicon", "no \"## 文案 lint\" section", "failing closed"],
    tamper: (root) => editText(doc(root), "## 文案 lint", "## 文案規則"),
  },
  {
    name: "L5. the market-safety document is missing (fail closed)",
    expects: ["lexicon", "failing closed"],
    tamper: (root) => rmSync(doc(root)),
  },
  {
    name: "L6. the document's exception is widened to another form (fail closed)",
    expects: ["lexicon", "is not of the form 紙上"],
    tamper: (root) => editText(doc(root), "「紙上賣出」", "「紙上賣出」「模擬買進」"),
  },
  {
    name: "L7. the registry restates the word list (the list has one source)",
    expects: ["public-v2-copy-surfaces.json", "restates the blocked word"],
    tamper: (root) => editJson(registry(root), (r) => (r.blockedWords = ["看好"])),
  },
  {
    name: "R1. the copy-surface registry is missing (fail closed)",
    expects: ["public-v2-copy-surfaces.json", "failing closed"],
    tamper: (root) => rmSync(registry(root)),
  },
  {
    name: "R2. a copy-surface marker at an unexpected depth is not silently ignored",
    expects: ["public-v2.yaml", "at a schema or property position"],
    tamper: (root) =>
      editText(yaml(root), "          x-panshi-copy-surface: headline\n", "            x-panshi-copy-surface: headline\n"),
  },
  {
    name: "R3. an unknown copy-surface kind is refused",
    expects: ["public-v2.yaml", "unknown kind \"banner\""],
    tamper: (root) => editText(yaml(root), "          x-panshi-copy-surface: headline\n", "          x-panshi-copy-surface: banner\n"),
  },
  {
    name: "R4. a new share schema without a copy-surface marker is refused",
    expects: ["public-v2.yaml", "ShareCardView", "no object-level x-panshi-copy-surface"],
    tamper: (root) =>
      editText(
        yaml(root),
        "    WorldStreamEventEnvelope:\n",
        "    ShareCardView:\n      type: object\n      properties:\n        headline:\n          type: string\n    WorldStreamEventEnvelope:\n",
      ),
  },
  {
    name: "R5. every marker stripped from the contract (fail closed)",
    expects: ["public-v2.yaml", "no x-panshi-copy-surface markers"],
    tamper: (root) => {
      const text = readFileSync(yaml(root), "utf8");
      writeFileSync(yaml(root), text.replace(/^ +x-panshi-copy-surface: \S+\n/gm, ""));
    },
  },
  {
    name: "R6. a registered surface disappears from the fixtures (the lint would run empty)",
    expects: ["registered copy surface WorldStoryHookRef matched no object"],
    tamper: (root) => editJson(worldFile(root), (w) => (w.storyHooks = [])),
  },
  {
    name: "R7. an unregistered copySurfaceType is refused",
    expects: ["unregistered copySurfaceType \"push_banner\""],
    tamper: (root) => writeJson(sampleFile(root, "push.json"), { copySurfaceType: "push_banner", title: "陸硯之" }),
  },
  {
    name: "R8. no fixture instrument names can be found (the ticker test cannot run)",
    expects: ["instruments", "failing closed"],
    tamper: (root) => {
      rmSync(join(root, "contracts", "world-fact-manifest"), { recursive: true });
      for (const name of ["share-card.json", "short-video.json", "journal-review.json"]) editJson(sampleFile(root, name), (s) => delete s.instrumentLabel);
      editJson(characterFile(root, "archive/paper.json"), function strip(node) {
        if (Array.isArray(node)) node.forEach(strip);
        else if (node !== null && typeof node === "object") {
          for (const key of Object.keys(node)) {
            if (/^instrument(Label|Id|Code|Name)$/.test(key)) delete node[key];
            else strip(node[key]);
          }
        }
      });
    },
  },
];

// -- the lint source keeps no copy of the list -------------------------------
const failures = [];
{
  const { parseLexicon, normalizeForMatch } = await import(LINT);
  const { words } = parseLexicon(readFileSync(join(REPO_ROOT, "docs", "v5", "market-safety.md"), "utf8"));
  const source = normalizeForMatch(readFileSync(LINT, "utf8"));
  const restated = words.filter((word) => source.includes(word));
  if (restated.length > 0) failures.push(`the lint source restates listed words ${restated.join("、")}; the list must live only in the document`);
  else process.stdout.write(`PASS  X1. tools/v5-copy-lint.mjs contains none of the ${words.length} listed words\n`);

  // The glyph fold is a character table anchored to the list: every row maps
  // one character that no listed word uses onto one that a listed word uses,
  // and names its source.
  const { GLYPH_FOLD } = await import(LINT);
  const listed = new Set(words.join(""));
  const bad = GLYPH_FOLD.filter(
    ([from, to, note]) => [...from].length !== 1 || [...to].length !== 1 || listed.has(from) || !listed.has(to) || !/\S/.test(note ?? ""),
  );
  if (GLYPH_FOLD.length === 0 || bad.length > 0) failures.push(`GLYPH_FOLD rows not anchored to the list: ${JSON.stringify(bad)}`);
  else process.stdout.write(`PASS  X2. all ${GLYPH_FOLD.length} glyph-fold rows map a non-list character onto a listed word's character\n`);
}

for (const testCase of CASES) {
  const root = scratchCopy({ samples: testCase.samples !== false });
  let result;
  try {
    testCase.tamper(root);
    result = runLint(root);
  } catch (error) {
    failures.push(`${testCase.name}: tamper failed (${error.message})`);
    continue;
  }
  if (testCase.pass) {
    if (result.code === 0) process.stdout.write(`PASS  ${testCase.name}\n`);
    else failures.push(`${testCase.name}: expected the lint to pass, got exit ${result.code}\n${result.output}`);
    continue;
  }
  const missing = testCase.expects.filter((fragment) => !result.output.includes(fragment));
  if (result.code === 0) failures.push(`${testCase.name}: expected a refusal, but the lint passed`);
  else if (missing.length > 0) failures.push(`${testCase.name}: refused, but the message lacks ${JSON.stringify(missing)}\n${result.output}`);
  else process.stdout.write(`PASS  ${testCase.name}\n`);
}

rmSync(scratchBase, { recursive: true, force: true });
if (failures.length > 0) {
  process.stderr.write(`v5 copy lint test FAILED (${failures.length}):\n${failures.map((f) => `  - ${f}`).join("\n")}\n`);
  process.exit(1);
}
process.stdout.write(`v5 copy lint test OK — ${CASES.length + 2} cases.\n`);
