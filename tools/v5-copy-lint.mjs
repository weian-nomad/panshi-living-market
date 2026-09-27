#!/usr/bin/env node
// ---------------------------------------------------------------------------
// V5 copy lint (docs/v5/market-safety.md, section 「文案 lint」 and release
// gate 4).
//
// The blocked-word list has exactly one source: the fenced code block in the
// market-safety document's 文案 lint section. This tool parses it at run time
// and never keeps a second copy; a missing section, a missing block or an
// empty block fails closed. The allowed exception terms are parsed from the
// paragraph that follows the block, and must have the 紙上 + listed-word form.
//
// Matching runs on normalised text: NFKC, whitespace and format characters
// removed, punctuation / symbols / separators removed between two CJK
// characters, and a character-level glyph fold (simplified, Japanese and one
// Taiwan variant form onto the list's own characters; see GLYPH_FOLD).
//
// What is checked:
//
//   1. Contract copy surfaces. `contracts/openapi/public-v2.yaml` registers a
//      field with `x-panshi-copy-surface: <kind>` (or a whole schema at object
//      level). Every JSON document under `fixtures/v5` is walked; an object
//      that structurally matches a registered schema (its keys within the
//      schema's properties, the schema's required keys present) has the
//      registered values checked. An object that carries an identifying field
//      of a registered schema (one of its copy fields, or a property no other
//      schema has) but does not match that schema, nor another schema that
//      declares the field, fails closed and is still checked as that surface.
//   2. Surfaces the slice does not serve yet (notification, paywall, share
//      card, short video, life-journal post-close review):
//      `contracts/openapi/public-v2-copy-surfaces.json` registers their field
//      rules; any object with a `copySurfaceType` discriminator is checked
//      against them, and a contract schema whose name reads as one of those
//      surfaces must be registered at object level.
//   3. Front-end copy: every non-test `.ts` / `.tsx` file under `apps/web/src`
//      (tests, test helpers, declaration files and `api/generated-v2`
//      excluded). Each string literal, each static part of a template literal
//      and each JSX text that contains a CJK character is checked, whatever
//      element or prop it ends up in; adjacent static JSX children and `+`
//      chains of literals are also checked joined. Module specifiers are not
//      copy and are skipped.
//
// Kinds `headline`, `notification`, `paywall`, `share`, `short_video`,
// `alt_text`, `sse_event`, `journal_review_body` and `frontend_static` are
// checked on every value, whether or not it is ticker-specific. That is
// stricter than the market-safety document, which names ticker-specific
// titles, notifications, paywalls and share cards. `caption` is checked when
// ticker-specific: the object or its document has `instrumentLabel` /
// `instrumentId`, or the text names a fixture instrument.
//
// The one exception (紙上 + a listed word, as the document quotes it) belongs
// to a character life journal reviewing a final paper action after the close,
// and may not be pulled out as a call to action. So it applies only to the
// `journal_review_body` kind (the only kind this tool lets the registry mark
// eligible), outside a CTA role, on an object that declares the life-journal
// post-close review context and carries time, simulation label, original
// reason and consequence itself. Headlines, notifications, paywalls, share
// cards, short videos, alt text, SSE frames, CTAs and front-end literals are
// never eligible.
//
// Usage: node tools/v5-copy-lint.mjs [--root <repo-root>]
// Engineering tool; the messages it prints are not product copy.
// ---------------------------------------------------------------------------

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const LEXICON_DOC = "docs/v5/market-safety.md";
const LEXICON_SECTION = "文案 lint";
const CONTRACT = "contracts/openapi/public-v2.yaml";
const REGISTRY = "contracts/openapi/public-v2-copy-surfaces.json";
const FIXTURE_ROOT = "fixtures/v5";
const INSTRUMENT_SOURCES = ["contracts/world-fact-manifest", "contracts/sealed-facts", "fixtures/v5"];
const INSTRUMENT_KEY = /^instrument(Label|Id|Code|Name)$/;
const TICKER_KEY = /^instrument(Label|Id)$/;
const MARKER = "x-panshi-copy-surface";
const EXCEPTION_PREFIX = "紙上";
// The only kind the registry may mark exception-eligible: the body of a
// life-journal post-close review. Hard-coded so the registry cannot widen it.
const EXCEPTION_KIND = "journal_review_body";
const FRONTEND_KIND = "frontend_static";

// -- lexicon -----------------------------------------------------------------

// Han, kana and hangul: the scripts between which separators are dropped.
const CJK_CLASS = "\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}";
const CJK = new RegExp(`[${CJK_CLASS}]`, "u");
// Punctuation (P*), symbols (S*), separators (Z*), format characters (Cf) and
// whitespace sitting between two CJK characters.
const BETWEEN_CJK = new RegExp(`(?<=[${CJK_CLASS}])[\\p{P}\\p{S}\\p{Z}\\p{Cf}\\s]+(?=[${CJK_CLASS}])`, "gu");

/**
 * Glyph fold: single characters only, each mapped to the character the
 * market-safety word list uses. This table holds no words (the list lives
 * only in that document); a row whose target no listed word uses is inactive.
 * Sources, per row: the PRC 《简化字总表》 (1986), Japan's 《常用漢字表》 (2010)
 * shinjitai, and the Taiwan MOE 《重編國語辭典修訂本》, which carries both
 * spellings of the one variant pair it is cited for.
 */
export const GLYPH_FOLD = [
  ["买", "買", "simplified, 简化字总表 1986"],
  ["卖", "賣", "simplified, 简化字总表 1986"],
  ["进", "進", "simplified, 简化字总表 1986"],
  ["场", "場", "simplified, 简化字总表 1986"],
  ["码", "碼", "simplified, 简化字总表 1986"],
  ["单", "單", "simplified, 简化字总表 1986"],
  ["标", "標", "simplified, 简化字总表 1986"],
  ["价", "價", "simplified, 简化字总表 1986"],
  ["胜", "勝", "simplified, 简化字总表 1986"],
  ["涨", "漲", "simplified, 简化字总表 1986"],
  ["关", "關", "simplified, 简化字总表 1986"],
  ["准", "準", "simplified (merged form), 简化字总表 1986"],
  ["周", "週", "simplified (merged form), 简化字总表 1986"],
  ["売", "賣", "Japanese shinjitai, 常用漢字表 2010"],
  ["単", "單", "Japanese shinjitai, 常用漢字表 2010"],
  ["価", "價", "Japanese shinjitai, 常用漢字表 2010"],
  ["関", "關", "Japanese shinjitai, 常用漢字表 2010"],
  ["値", "值", "Japanese form U+5024 of U+503C, 常用漢字表 2010"],
  ["佈", "布", "Taiwan variant spelling, 重編國語辭典修訂本 lists both"],
];
let activeFold = new Map(GLYPH_FOLD.map(([from, to]) => [from, to]));

/** Restricts the fold to rows whose target a listed word actually uses. */
function activateFold(words) {
  const used = new Set(words.join(""));
  activeFold = new Map(GLYPH_FOLD.filter(([, to]) => used.has(to)).map(([from, to]) => [from, to]));
}

/** True when the text has at least one Han, kana or hangul character. */
export function hasCjk(text) {
  return CJK.test(String(text));
}

/**
 * Normalises text for matching: NFKC; whitespace and invisible format
 * characters dropped everywhere; punctuation, symbols and separators dropped
 * between two CJK characters (so a dot, a full stop or an emoji spliced into
 * a word does not hide it); then
 * the glyph fold. Matching never sees the raw text.
 */
const JSX_NAMED_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
/** Decode the HTML character references JSX would render; unknown names stay as written. */
export function decodeJsxEntities(text) {
  return String(text).replace(/&(?:#[xX]([0-9a-fA-F]+)|#([0-9]+)|([A-Za-z][A-Za-z0-9]*));/g, (raw, hex, dec, name) => {
    if (hex !== undefined || dec !== undefined) {
      const codePoint = hex !== undefined ? Number.parseInt(hex, 16) : Number.parseInt(dec, 10);
      return codePoint >= 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : raw;
    }
    return Object.hasOwn(JSX_NAMED_ENTITIES, name) ? JSX_NAMED_ENTITIES[name] : raw;
  });
}

export function normalizeForMatch(text) {
  // Default_Ignorable covers the invisible characters that are not Cf (variation
  // selectors, U+034F combining grapheme joiner, U+3164 Hangul filler).
  const base = String(text)
    .normalize("NFKC")
    .replace(/[\s\p{Cf}\p{Default_Ignorable_Code_Point}]/gu, "")
    .replace(BETWEEN_CJK, "");
  let out = "";
  for (const char of base) out += activeFold.get(char) ?? char;
  return out;
}

/**
 * Parses the blocked words and the allowed exception terms from the
 * market-safety document. Throws (fail closed) when the section, the fenced
 * block or its words are missing.
 */
export function parseLexicon(markdown) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^##\\s+${LEXICON_SECTION}\\s*$`).test(line));
  if (start === -1) throw new Error(`${LEXICON_DOC}: no "## ${LEXICON_SECTION}" section`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const section = lines.slice(start + 1, end);
  const open = section.findIndex((line) => /^```/.test(line.trim()));
  if (open === -1) throw new Error(`${LEXICON_DOC}: section ${LEXICON_SECTION} has no fenced word list`);
  const close = section.findIndex((line, i) => i > open && /^```\s*$/.test(line.trim()));
  if (close === -1) throw new Error(`${LEXICON_DOC}: section ${LEXICON_SECTION} has an unterminated word list`);
  const words = [
    ...new Set(
      section
        .slice(open + 1, close)
        .map((line) => normalizeForMatch(line))
        .filter((word) => word.length > 0),
    ),
  ];
  if (words.length === 0) throw new Error(`${LEXICON_DOC}: section ${LEXICON_SECTION} word list is empty`);
  activateFold(words);

  const after = section.slice(close + 1).join("\n");
  const exceptionTerms = [];
  for (const match of after.matchAll(/「([^」]+)」/g)) {
    const term = normalizeForMatch(match[1]);
    const listed = words.filter((word) => term.includes(word));
    if (listed.length === 0) continue;
    if (!term.startsWith(EXCEPTION_PREFIX) || !words.includes(term.slice(EXCEPTION_PREFIX.length))) {
      throw new Error(
        `${LEXICON_DOC}: exception term 「${match[1]}」 is not of the form ${EXCEPTION_PREFIX} + a listed word; this lint does not know how to scope it`,
      );
    }
    if (!exceptionTerms.includes(term)) exceptionTerms.push(term);
  }
  return { words, exceptionTerms };
}

/**
 * Every listed word in `text`. A hit that is part of an exception term is
 * returned with `viaException: true`; the caller decides whether the
 * surface may use it.
 */
export function findHits(text, lexicon) {
  const normalized = normalizeForMatch(text);
  const hits = [];
  for (const word of lexicon.words) {
    let index = normalized.indexOf(word);
    while (index !== -1) {
      const term = lexicon.exceptionTerms.find((candidate) => {
        const offset = candidate.indexOf(word);
        return offset !== -1 && index - offset >= 0 && normalized.startsWith(candidate, index - offset);
      });
      hits.push({ word, term: term ?? null, viaException: term !== undefined });
      index = normalized.indexOf(word, index + 1);
    }
  }
  return hits;
}

// -- contract ----------------------------------------------------------------

/**
 * `components.schemas` of public-v2.yaml, read with the same narrow line
 * reader the slice audit uses (two-space layout: schema names at 4 spaces,
 * schema keywords at 6, property names at 8, a property's keywords at 10).
 * Every copy-surface marker in the file must be one this reader places, so a
 * marker at an unexpected depth fails closed instead of being ignored.
 */
export function parseContract(yaml) {
  const schemas = new Map();
  const markers = [];
  let inSchemas = false;
  let schema = null;
  let block = null;
  let property = null;
  let requiredList = false;
  const lines = yaml.split("\n");
  for (let n = 0; n < lines.length; n += 1) {
    const line = lines[n];
    if (/^  schemas:\s*$/.test(line)) {
      inSchemas = true;
      continue;
    }
    if (inSchemas && /^ {0,3}\S/.test(line)) inSchemas = false;
    if (!inSchemas) continue;
    let match = /^ {4}([A-Za-z0-9_]+):\s*$/.exec(line);
    if (match) {
      schema = {
        name: match[1],
        properties: new Set(),
        required: new Set(),
        closed: false,
        objectKind: null,
        fieldKinds: new Map(),
      };
      schemas.set(schema.name, schema);
      block = null;
      property = null;
      requiredList = false;
      continue;
    }
    if (schema === null) continue;
    match = /^ {6}([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (match) {
      block = match[1];
      property = null;
      requiredList = false;
      const value = match[2].trim();
      if (block === "required") {
        const inline = /^\[(.*)\]$/.exec(value);
        if (inline) {
          for (const item of inline[1].split(",")) if (item.trim()) schema.required.add(item.trim());
        } else if (value === "") {
          requiredList = true;
        }
      } else if (block === "additionalProperties" && value === "false") {
        schema.closed = true;
      } else if (block === MARKER) {
        schema.objectKind = value;
        markers.push({ line: n + 1, schema: schema.name, field: null, kind: value });
      }
      continue;
    }
    match = /^ {8}- ([A-Za-z0-9_]+)\s*$/.exec(line);
    if (match && requiredList) {
      schema.required.add(match[1]);
      continue;
    }
    match = /^ {8}([A-Za-z0-9_]+):/.exec(line);
    if (match && block === "properties") {
      property = match[1];
      schema.properties.add(property);
      continue;
    }
    match = new RegExp(`^ {10}${MARKER}:\\s*(\\S+)\\s*$`).exec(line);
    if (match && block === "properties" && property !== null) {
      schema.fieldKinds.set(property, match[1]);
      markers.push({ line: n + 1, schema: schema.name, field: property, kind: match[1] });
    }
  }
  const markerLines = lines.filter((line) => line.trimStart().startsWith(`${MARKER}:`)).length;
  return { schemas, markers, markerLines };
}

// -- helpers -----------------------------------------------------------------

function walkFiles(dir, predicate, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) walkFiles(path, predicate, out);
    else if (predicate(path)) out.push(path);
  }
  return out;
}

function stringsUnder(value, path, out = []) {
  if (typeof value === "string") out.push({ path, text: value });
  else if (Array.isArray(value)) value.forEach((item, i) => stringsUnder(item, `${path}[${i}]`, out));
  else if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) stringsUnder(child, `${path}.${key}`, out);
  }
  return out;
}

function hasKeyDeep(value, pattern) {
  if (Array.isArray(value)) return value.some((item) => hasKeyDeep(item, pattern));
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value).some(([key, child]) => pattern.test(key) || hasKeyDeep(child, pattern));
}

function excerpt(text) {
  const flat = String(text).replace(/\s+/g, " ");
  return flat.length > 60 ? `${flat.slice(0, 57)}...` : flat;
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

// -- lint --------------------------------------------------------------------

export function lintRepo(root) {
  const errors = [];
  const stats = { words: 0, contractValues: 0, plannedValues: 0, frontendValues: 0, frontendFiles: 0, fixtureFiles: 0 };
  const rel = (path) => relative(root, path);

  // Lexicon: the single source, fail closed.
  let lexicon;
  try {
    lexicon = parseLexicon(readFileSync(join(root, LEXICON_DOC), "utf8"));
  } catch (error) {
    return { errors: [`lexicon: cannot read the blocked-word list (${error.message}); failing closed`], stats };
  }
  stats.words = lexicon.words.length;

  // Registry.
  let registry;
  try {
    registry = JSON.parse(readFileSync(join(root, REGISTRY), "utf8"));
    if (registry.lexiconSource?.document !== LEXICON_DOC || registry.lexiconSource?.section !== LEXICON_SECTION) {
      throw new Error(`lexiconSource must name ${LEXICON_DOC} section ${LEXICON_SECTION}`);
    }
    if (registry.surfaceKinds === null || typeof registry.surfaceKinds !== "object") throw new Error("surfaceKinds missing");
    for (const [kind, spec] of Object.entries(registry.surfaceKinds)) {
      if (spec.checkPolicy !== "always" && spec.checkPolicy !== "ticker_specific") {
        throw new Error(`surfaceKinds.${kind}.checkPolicy must be "always" or "ticker_specific"`);
      }
      if (typeof spec.exceptionEligible !== "boolean") throw new Error(`surfaceKinds.${kind}.exceptionEligible must be true or false`);
      if (spec.exceptionEligible && kind !== EXCEPTION_KIND) {
        throw new Error(`surfaceKinds.${kind} is marked exception-eligible; only ${EXCEPTION_KIND} (a life-journal post-close review body) may be`);
      }
    }
    for (const kind of [EXCEPTION_KIND, FRONTEND_KIND]) {
      if (registry.surfaceKinds[kind] === undefined) throw new Error(`surfaceKinds.${kind} missing`);
    }
    if (registry.surfaceKinds[FRONTEND_KIND].checkPolicy !== "always" || registry.surfaceKinds[FRONTEND_KIND].exceptionEligible !== false) {
      throw new Error(`surfaceKinds.${FRONTEND_KIND} must be checked always and never exception-eligible`);
    }
    if (typeof registry.plannedSurfaceTypes?.discriminatorField !== "string") throw new Error("plannedSurfaceTypes.discriminatorField missing");
    if (typeof registry.exception?.contextField !== "string") throw new Error("exception.contextField missing");
    if (typeof registry.exception?.contextValue !== "string") throw new Error("exception.contextValue missing");
    for (const [name, type] of Object.entries(registry.plannedSurfaceTypes.types ?? {})) {
      for (const [field, kind] of Object.entries(type.fields ?? {})) {
        if (kind !== EXCEPTION_KIND) continue;
        if (type.constFields?.[registry.exception.contextField] !== registry.exception.contextValue) {
          throw new Error(
            `plannedSurfaceTypes.types.${name}.${field} uses ${EXCEPTION_KIND}, but the type does not fix ${registry.exception.contextField} to ${registry.exception.contextValue}`,
          );
        }
        if (type.roles?.[field] !== undefined) throw new Error(`plannedSurfaceTypes.types.${name}.${field} is ${EXCEPTION_KIND} and cannot carry a role`);
      }
    }
    for (const key of ["time", "simulationLabel", "originalReason", "consequence"]) {
      if (!Array.isArray(registry.exception?.sameObjectRequires?.[key]) || registry.exception.sameObjectRequires[key].length === 0) {
        throw new Error(`exception.sameObjectRequires.${key} missing`);
      }
    }
  } catch (error) {
    return { errors: [`${REGISTRY}: unreadable or malformed (${error.message}); failing closed`], stats };
  }
  // Nothing in the registry may restate the word list.
  for (const { path, text } of stringsUnder(registry, "registry")) {
    for (const hit of findHits(text, lexicon)) {
      if (!hit.viaException) errors.push(`${REGISTRY}: ${path} restates the blocked word 「${hit.word}」; the list lives only in ${LEXICON_DOC}`);
    }
  }
  const kinds = registry.surfaceKinds;
  const neverRoles = new Set(registry.neverExceptionRoles ?? []);
  const exception = registry.exception;

  // Fixture instrument names (the ticker-specific test for captions).
  const instruments = new Set();
  for (const source of INSTRUMENT_SOURCES) {
    for (const file of walkFiles(join(root, source), (path) => path.endsWith(".json"))) {
      let value;
      try {
        value = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        continue;
      }
      (function collect(node) {
        if (Array.isArray(node)) node.forEach(collect);
        else if (node !== null && typeof node === "object") {
          for (const [key, child] of Object.entries(node)) {
            if (INSTRUMENT_KEY.test(key) && nonEmptyString(child)) instruments.add(normalizeForMatch(child));
            collect(child);
          }
        }
      })(value);
    }
  }
  if (instruments.size === 0) {
    errors.push(`instruments: no fixture instrument names found under ${INSTRUMENT_SOURCES.join(", ")}; the ticker-specific test cannot run (failing closed)`);
  }
  const namesInstrument = (text) => {
    const normalized = normalizeForMatch(text);
    for (const name of instruments) if (normalized.includes(name)) return true;
    return false;
  };

  /** Checks one value; `context` is the object that carries it. */
  function checkValue({ where, kind, role, text, context, docTicker }) {
    const spec = kinds[kind];
    if (spec === undefined) {
      errors.push(`${where}: unknown copy-surface kind ${JSON.stringify(kind)}`);
      return;
    }
    if (spec.checkPolicy === "ticker_specific") {
      const ticker =
        docTicker ||
        (context !== null && typeof context === "object" && Object.keys(context).some((key) => TICKER_KEY.test(key))) ||
        namesInstrument(text);
      if (!ticker) return;
    }
    const hits = findHits(text, lexicon);
    if (hits.length === 0) return;
    let eligibility = null;
    const exceptionMissing = () => {
      if (eligibility !== null) return eligibility;
      const missing = [];
      if (spec.exceptionEligible !== true) missing.push(`kind ${kind} is never eligible (only a ${EXCEPTION_KIND} is)`);
      if (role !== null && neverRoles.has(role)) missing.push(`role ${role} is never eligible (no call to action)`);
      if (context === null || typeof context !== "object") {
        missing.push("static literal cannot carry the same-screen facts");
      } else {
        if (context[exception.contextField] !== exception.contextValue) {
          missing.push(`${exception.contextField} is not ${exception.contextValue}`);
        }
        const req = exception.sameObjectRequires;
        if (!req.time.some((key) => nonEmptyString(context[key]) && /^\d{4}-\d{2}-\d{2}/.test(context[key]))) missing.push("time");
        if (
          !req.simulationLabel.some(
            (key) => nonEmptyString(context[key]) && exception.simulationLabelMustContainOneOf.some((mark) => context[key].includes(mark)),
          )
        ) {
          missing.push("simulation label");
        }
        if (!req.originalReason.some((key) => nonEmptyString(context[key]))) missing.push("original reason");
        if (!req.consequence.some((key) => nonEmptyString(context[key]))) missing.push("consequence");
      }
      eligibility = missing;
      return missing;
    };
    for (const hit of hits) {
      if (hit.viaException) {
        const missing = exceptionMissing();
        if (missing.length === 0) continue;
        errors.push(`${where} [${kind}] 「${hit.term}」 outside its allowed context (missing: ${missing.join(", ")}): "${excerpt(text)}"`);
      } else {
        errors.push(`${where} [${kind}] blocked word 「${hit.word}」: "${excerpt(text)}"`);
      }
    }
  }

  // Contract registrations.
  let contract;
  try {
    contract = parseContract(readFileSync(join(root, CONTRACT), "utf8"));
  } catch (error) {
    return { errors: [...errors, `${CONTRACT}: unreadable (${error.message}); failing closed`], stats };
  }
  if (contract.schemas.size < 50) errors.push(`${CONTRACT}: only ${contract.schemas.size} schemas parsed; failing closed`);
  if (contract.markers.length === 0) errors.push(`${CONTRACT}: no ${MARKER} markers found; failing closed`);
  if (contract.markers.length !== contract.markerLines) {
    errors.push(`${CONTRACT}: ${contract.markerLines} ${MARKER} lines but only ${contract.markers.length} at a schema or property position; failing closed`);
  }
  for (const marker of contract.markers) {
    if (kinds[marker.kind] === undefined) {
      errors.push(`${CONTRACT}:${marker.line}: ${marker.schema}${marker.field ? `.${marker.field}` : ""} has unknown kind ${JSON.stringify(marker.kind)}`);
    }
  }
  const futurePattern = new RegExp(registry.futureSurfaceSchemaNamePattern ?? "$^");
  for (const schema of contract.schemas.values()) {
    if (futurePattern.test(schema.name) && schema.objectKind === null) {
      errors.push(`${CONTRACT}: schema ${schema.name} reads as a notification/paywall/share/video surface but has no object-level ${MARKER}`);
    }
  }
  const registered = [...contract.schemas.values()].filter((schema) => schema.objectKind !== null || schema.fieldKinds.size > 0);
  const allSchemas = [...contract.schemas.values()].filter((schema) => schema.properties.size > 0);
  // Identifying fields of a registered surface: its registered copy fields,
  // plus every property no other schema declares.
  const identifying = new Map(
    registered.map((schema) => [
      schema.name,
      [
        ...new Set([
          ...schema.fieldKinds.keys(),
          ...[...schema.properties].filter((key) => allSchemas.every((other) => other === schema || !other.properties.has(key))),
        ]),
      ],
    ]),
  );
  for (const [name, keys] of identifying) {
    if (keys.length === 0) errors.push(`${CONTRACT}: registered copy surface ${name} has no identifying field; the lint could not tell a damaged copy of it apart (failing closed)`);
  }
  const matchedCount = new Map(registered.map((schema) => [schema.name, 0]));

  const planned = registry.plannedSurfaceTypes;
  const discriminator = planned.discriminatorField;

  const fixtureFiles = walkFiles(join(root, FIXTURE_ROOT), (path) => path.endsWith(".json"));
  for (const file of fixtureFiles) {
    let doc;
    try {
      doc = JSON.parse(readFileSync(file, "utf8"));
    } catch (error) {
      errors.push(`${rel(file)}: cannot parse (${error.message}); failing closed`);
      continue;
    }
    stats.fixtureFiles += 1;
    const docTicker = hasKeyDeep(doc, TICKER_KEY);
    (function visit(node, path) {
      if (Array.isArray(node)) {
        node.forEach((item, i) => visit(item, `${path}[${i}]`));
        return;
      }
      if (node === null || typeof node !== "object") return;
      const keys = Object.keys(node);
      const where = `${rel(file)}:${path}`;

      if (Object.hasOwn(node, discriminator)) {
        const type = planned.types[node[discriminator]];
        if (type === undefined) {
          errors.push(`${where}: unregistered ${discriminator} ${JSON.stringify(node[discriminator])}`);
        } else {
          for (const field of type.requiredFields ?? []) {
            if (!Object.hasOwn(node, field)) errors.push(`${where}: ${node[discriminator]} is missing required field ${field}`);
          }
          for (const [field, value] of Object.entries(type.constFields ?? {})) {
            if (node[field] !== value) errors.push(`${where}: ${node[discriminator]} must have ${field} ${JSON.stringify(value)}, got ${JSON.stringify(node[field])}`);
          }
          for (const key of keys) {
            if (!Object.hasOwn(type.fields, key)) {
              errors.push(`${where}: ${node[discriminator]} has undeclared field ${key}; register it in ${REGISTRY} first`);
              for (const value of stringsUnder(node[key], `${path}.${key}`)) {
                stats.plannedValues += 1;
                checkValue({ where: `${rel(file)}:${value.path}`, kind: type.kind, role: null, text: value.text, context: node, docTicker });
              }
              continue;
            }
            const kind = type.fields[key];
            if (kind === null) continue;
            for (const value of stringsUnder(node[key], `${path}.${key}`)) {
              stats.plannedValues += 1;
              checkValue({
                where: `${rel(file)}:${value.path}`,
                kind,
                role: type.roles?.[key] ?? null,
                text: value.text,
                context: node,
                docTicker,
              });
            }
          }
        }
      } else {
        const full = allSchemas.filter(
          (schema) => keys.every((key) => schema.properties.has(key)) && [...schema.required].every((key) => Object.hasOwn(node, key)),
        );
        const hits = full.filter((schema) => schema.objectKind !== null || schema.fieldKinds.size > 0);
        // Fail closed on a damaged copy of a registered surface: it carries an
        // identifying field of that surface, yet neither matches it nor any
        // other schema that declares the field. It is still checked as that
        // surface, so its copy is not skipped.
        const damaged = [];
        for (const schema of registered) {
          if (full.includes(schema)) continue;
          const own = identifying.get(schema.name).filter((key) => Object.hasOwn(node, key));
          if (own.length === 0) continue;
          if (own.every((key) => full.some((other) => other.properties.has(key)))) continue;
          const extra = keys.filter((key) => !schema.properties.has(key));
          const absent = [...schema.required].filter((key) => !Object.hasOwn(node, key));
          damaged.push(
            `${schema.name} (identified by ${own.join(", ")}; ${extra.length > 0 ? `undeclared ${extra.join(", ")}` : "no undeclared key"}; ${absent.length > 0 ? `missing ${absent.join(", ")}` : "no missing key"})`,
          );
          hits.push(schema);
        }
        if (damaged.length > 0) {
          errors.push(`${where}: carries identifying fields of copy surface ${damaged.join(" / ")} but matches no schema declaring them; failing closed`);
        }
        const kindsSeen = new Set();
        for (const schema of hits) {
          matchedCount.set(schema.name, (matchedCount.get(schema.name) ?? 0) + 1);
          if (schema.objectKind !== null && !kindsSeen.has(`*:${schema.objectKind}`)) {
            kindsSeen.add(`*:${schema.objectKind}`);
            for (const value of stringsUnder(node, path)) {
              stats.contractValues += 1;
              checkValue({ where: `${rel(file)}:${value.path}`, kind: schema.objectKind, role: null, text: value.text, context: node, docTicker });
            }
          }
          for (const [field, kind] of schema.fieldKinds) {
            if (!Object.hasOwn(node, field) || kindsSeen.has(`${field}:${kind}`)) continue;
            kindsSeen.add(`${field}:${kind}`);
            for (const value of stringsUnder(node[field], `${path}.${field}`)) {
              stats.contractValues += 1;
              checkValue({ where: `${rel(file)}:${value.path}`, kind, role: null, text: value.text, context: node, docTicker });
            }
          }
        }
      }
      for (const key of keys) visit(node[key], `${path}.${key}`);
    })(doc, "$");
  }
  const withoutFixture = new Set(registry.contractSurfacesWithoutFixture ?? []);
  for (const name of withoutFixture) {
    if (!matchedCount.has(name)) errors.push(`${REGISTRY}: contractSurfacesWithoutFixture names ${name}, which ${CONTRACT} does not register`);
  }
  for (const [name, count] of matchedCount) {
    if (count === 0 && !withoutFixture.has(name)) {
      errors.push(`${CONTRACT}: registered copy surface ${name} matched no object under ${FIXTURE_ROOT}; the lint would be running empty (list it in contractSurfacesWithoutFixture if it truly has no fixture yet)`);
    }
  }
  if (stats.contractValues === 0) errors.push(`${FIXTURE_ROOT}: no registered copy-surface value was checked; failing closed`);

  // Front-end copy: every CJK-bearing literal in every non-test source file.
  const frontend = registry.frontend ?? {};
  const roots = Array.isArray(frontend.roots) ? frontend.roots : [];
  const extensions = Array.isArray(frontend.fileExtensions) ? frontend.fileExtensions : [];
  if (roots.length === 0 || !extensions.includes(".ts") || !extensions.includes(".tsx")) {
    errors.push(`${REGISTRY}: frontend must name its roots and scan both .ts and .tsx; failing closed`);
  }
  const exclude = new RegExp(frontend.excludeFilePattern ?? "$^");
  const posix = (path) => rel(path).split(sep).join("/");
  const frontendFiles = roots.flatMap((dir) =>
    walkFiles(join(root, dir), (path) => extensions.some((ext) => path.endsWith(ext)) && !exclude.test(posix(path))),
  );
  if (frontendFiles.length === 0) errors.push(`frontend: no source files under ${roots.join(", ")}; failing closed`);

  /** Word counts of the hits in `text` that are not part of an exception term. */
  const countWords = (text) => {
    const counts = new Map();
    for (const hit of findHits(text, lexicon)) counts.set(hit.word, (counts.get(hit.word) ?? 0) + 1);
    return counts;
  };

  for (const file of frontendFiles) {
    stats.frontendFiles += 1;
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const at = (node) => {
      const { line, character } = source.getLineAndCharacterOfPosition(node.getStart(source));
      return `${rel(file)}:${line + 1}:${character + 1}`;
    };
    const check = (node, text) => {
      if (!hasCjk(text)) return;
      stats.frontendValues += 1;
      checkValue({ where: at(node), kind: FRONTEND_KIND, role: null, text, context: null, docTicker: false });
    };
    /** A joined run of rendered-adjacent literals: only hits no single part has. */
    const checkJoined = (node, parts) => {
      if (parts.length < 2) return;
      const joined = parts.join("");
      if (!hasCjk(joined)) return;
      stats.frontendValues += 1;
      const partCounts = new Map();
      for (const part of parts) for (const [word, count] of countWords(part)) partCounts.set(word, (partCounts.get(word) ?? 0) + count);
      for (const [word, count] of countWords(joined)) {
        if (count > (partCounts.get(word) ?? 0)) {
          errors.push(`${at(node)} [${FRONTEND_KIND}] blocked word 「${word}」 across adjacent literals: "${excerpt(joined)}"`);
        }
      }
    };
    const isModuleSpecifier = (node) => {
      const parent = node.parent;
      if (parent === undefined) return false;
      return (
        ((ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) && parent.moduleSpecifier === node) ||
        ts.isExternalModuleReference(parent) ||
        (ts.isCallExpression(parent) && parent.expression.kind === ts.SyntaxKind.ImportKeyword && parent.arguments[0] === node) ||
        (ts.isLiteralTypeNode(parent) && ts.isImportTypeNode(parent.parent)) ||
        (ts.isModuleDeclaration(parent) && parent.name === node)
      );
    };
    const isStaticString = (node) => ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
    /** JSX renders HTML character references in text and attribute strings; the AST keeps them raw. */
    const jsxRendered = (node, text) =>
      ts.isJsxText(node) || (node.parent !== undefined && ts.isJsxAttribute(node.parent)) ? decodeJsxEntities(text) : text;
    /** <wbr /> renders nothing, so text on both sides of it reads as one run. */
    const isInvisibleJsxElement = (node) => ts.isJsxSelfClosingElement(node) && node.tagName.getText() === "wbr";
    /** The literal parts of a `+` chain made only of static strings, or null. */
    const plusChain = (node) => {
      if (ts.isParenthesizedExpression(node)) return plusChain(node.expression);
      if (isStaticString(node)) return [node.text];
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        const left = plusChain(node.left);
        const right = plusChain(node.right);
        return left !== null && right !== null ? [...left, ...right] : null;
      }
      return null;
    };
    (function visit(node) {
      if (isStaticString(node)) {
        if (!isModuleSpecifier(node)) check(node, jsxRendered(node, node.text));
      } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
        check(node, node.text);
      } else if (ts.isJsxText(node)) {
        if (node.text.trim().length > 0) check(node, jsxRendered(node, node.text));
      } else if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
        // Children rendered next to each other: JSX text and literal
        // expressions join until an element or a dynamic expression breaks the run.
        let run = [];
        let first = null;
        for (const child of node.children) {
          let text = null;
          if (isInvisibleJsxElement(child)) continue;
          if (ts.isJsxText(child)) text = jsxRendered(child, child.text);
          else if (ts.isJsxExpression(child) && child.expression !== undefined && isStaticString(child.expression)) text = child.expression.text;
          if (text !== null) {
            if (run.length === 0) first = child;
            run.push(text);
            continue;
          }
          if (run.length > 0) checkJoined(first, run);
          run = [];
        }
        if (run.length > 0) checkJoined(first, run);
      } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        let parent = node.parent;
        while (ts.isParenthesizedExpression(parent)) parent = parent.parent;
        const isTop = !(ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.PlusToken);
        if (isTop) {
          const parts = plusChain(node);
          if (parts !== null) checkJoined(node, parts);
        }
      }
      ts.forEachChild(node, visit);
    })(source);
  }
  if (stats.frontendValues === 0) errors.push("frontend: no CJK string, template or JSX text literal was checked; failing closed");

  return { errors, stats };
}

// -- main --------------------------------------------------------------------

const invokedDirectly = process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  const args = process.argv.slice(2);
  const rootFlag = args.indexOf("--root");
  const root = rootFlag !== -1 && args[rootFlag + 1] ? args[rootFlag + 1] : fileURLToPath(new URL("..", import.meta.url));
  const { errors, stats } = lintRepo(root);
  if (errors.length > 0) {
    process.stderr.write(`v5 copy lint FAILED (${errors.length}):\n${errors.map((error) => `  - ${error}`).join("\n")}\n`);
    process.exit(1);
  }
  process.stdout.write(
    `v5 copy lint OK — ${stats.words} blocked words from ${LEXICON_DOC}; ` +
      `${stats.contractValues} contract values in ${stats.fixtureFiles} fixture files, ` +
      `${stats.plannedValues} planned-surface values, ` +
      `${stats.frontendValues} front-end literals in ${stats.frontendFiles} files; 0 hits.\n`,
  );
}
