// contracts/character-art/v1: the JSON Schema and the front-end validator
// (src/v5/characterArt.ts) are held to one corpus.
//
// - fixtures/valid/                 accepted by both.
// - fixtures/negative/              rejected by the schema, and by the validator.
// - fixtures/negative-cross-field/  accepted by the schema (each one is a rule
//                                   JSON Schema cannot express) and rejected by
//                                   the validator for exactly that rule.
//
// Each negative is one defect away from fixtures/valid/luyanzhi-rig-v1.json, so
// a rejection cannot come from an unrelated typo in the base.
import { readFileSync, readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { compileSchema } from "../../../tools/json-schema-subset.mjs";
import { validateCharacterArtManifest } from "../src/v5/characterArt.ts";

const CONTRACT = new URL("../../../contracts/character-art/v1/", import.meta.url);
const schema = JSON.parse(readFileSync(new URL("schema.json", CONTRACT), "utf8"));
const validateSchema = compileSchema(schema, "character-art/v1/schema.json");

/** The character every corpus manifest is requested for (the slice's only resident). */
const REQUESTED_ID = "96450815-0db8-f735-a139-5ba222da86b2";

function corpus(folder) {
  const dir = new URL(`fixtures/${folder}/`, CONTRACT);
  return readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => ({ name, value: JSON.parse(readFileSync(new URL(name, dir), "utf8")) }));
}

/** Which rule each cross-field negative must be rejected for. */
const CROSS_FIELD_REASON = {
  "attach-y-below-canvas": "attachY: must lie inside the canvas",
  "character-id-not-requested": "is not the character this manifest was requested for",
  "duplicate-layer-id": "duplicate layer id",
  "easing-x-outside-unit": "cubic-bezier x1 must lie in [0, 1]",
  "foot-anchor-outside-sprite": "footAnchor: must lie inside the sprite",
  "frame-not-four-by-five": "must be 4:5 within 1%",
  "frame-outside-canvas": "frame: must lie inside the canvas",
  "jitter-not-smaller-than-base": "must be smaller than baseMs",
  "layer-outside-canvas": "layer box must lie inside the canvas",
  "missing-lid-closed": 'needs exactly one "lidClosed" layer',
  "periods-not-coprime": "must be coprime",
  "pivot-outside-thumb-layer": "must lie inside its own layer box",
  "range-reversed": "min <= max",
  "standing-height-over-foot-anchor": "must not exceed footAnchor.y",
  "two-iris-near": 'needs exactly one "irisNear" layer',
  "two-thumbs": 'at most one "thumb" layer',
  "waist-below-canvas": "waistY: must lie inside the canvas",
};

describe("character-art/v1 schema", () => {
  it("is a closed draft 2020-12 schema with real assertions only", () => {
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(false);
    expect([...schema.required].sort()).toEqual(Object.keys(schema.properties).sort());
    expect(JSON.stringify(schema)).not.toContain('"format"');

    // Every object node is closed and requires every property except the optional `part`.
    const walk = (node, path) => {
      if (node === null || typeof node !== "object") return;
      if (node.type === "object") {
        expect(node.additionalProperties, `${path} must be closed`).toBe(false);
        const optional = Object.keys(node.properties).filter((key) => !node.required.includes(key));
        expect(optional.every((key) => key === "part"), `${path} optional ${optional}`).toBe(true);
      }
      for (const [key, child] of Object.entries(node)) walk(child, `${path}/${key}`);
    };
    walk(schema, "#");
  });

  it("bounds the motion by the visual-system tokens and the idle guardrails", () => {
    const motion = schema.$defs.IdleMotion.properties;
    // motion.world_breath 8-12 s; motion.reduced_fade_max 120 ms.
    expect([motion.breath.properties.periodMs.minimum, motion.breath.properties.periodMs.maximum]).toEqual([8000, 12000]);
    expect(motion.reducedFadeMs.maximum).toBe(120);
    // Breath at most 1%, gaze never to the right, thumb at most 5 degrees.
    expect(motion.breath.properties.scaleYMax.maximum).toBe(0.01);
    expect(motion.gaze.properties.nearDx.maximum).toBe(0);
    expect(motion.gaze.properties.farDx.maximum).toBe(0);
    expect([motion.thumb.properties.angleDeg.minimum, motion.thumb.properties.angleDeg.maximum]).toEqual([-5, 0]);
  });
});

describe("character-art/v1 corpus", () => {
  const valid = corpus("valid");
  const negative = corpus("negative");
  const crossField = corpus("negative-cross-field");

  it("has a base and enough negatives", () => {
    expect(valid.map((item) => item.name)).toContain("luyanzhi-rig-v1.json");
    expect(negative.length).toBeGreaterThanOrEqual(35);
    expect(crossField.map((item) => item.name.replace(/\.json$/, "")).sort()).toEqual(
      Object.keys(CROSS_FIELD_REASON).sort(),
    );
  });

  it.each(valid)("valid/$name passes the schema and the validator", ({ name, value }) => {
    expect(validateSchema(value, name)).toEqual([]);
    const result = validateCharacterArtManifest(value, REQUESTED_ID);
    expect(result.ok ? [] : result.errors).toEqual([]);
  });

  it.each(negative)("negative/$name is rejected by the schema and by the validator", ({ name, value }) => {
    expect(validateSchema(value, name).length).toBeGreaterThan(0);
    expect(validateCharacterArtManifest(value, REQUESTED_ID).ok).toBe(false);
  });

  it.each(crossField)("negative-cross-field/$name passes the schema, fails the validator for its rule", ({ name, value }) => {
    expect(validateSchema(value, name)).toEqual([]);
    const result = validateCharacterArtManifest(value, REQUESTED_ID);
    expect(result.ok).toBe(false);
    const reason = CROSS_FIELD_REASON[name.replace(/\.json$/, "")];
    expect(result.ok ? [] : result.errors.join("\n")).toContain(reason);
  });
});
