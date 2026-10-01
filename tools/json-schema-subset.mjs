// A minimal JSON Schema (draft 2020-12) validator for the keyword subset the
// repo's own contracts use. Same reasoning as the hand-rolled validators in
// tools/world-fact-manifest-audit.mjs: ajv is not in this workspace and these
// contracts do not warrant a dependency.
//
// What makes it safe to rely on:
//
// - **Unknown keywords fail closed.** A schema that uses a keyword this file
//   does not implement is rejected when it is compiled, instead of the
//   keyword being silently ignored (which would turn an assertion the
//   schema author wrote into a no-op).
// - **`format` is an annotation, never an assertion**, exactly as the 2020-12
//   default vocabulary says. Contracts validated here must express their real
//   constraints with `pattern`, `minLength`, `const`, `enum` and the bounds.
//   `title`, `description`, `$comment`, `$id` and `$schema` are annotations too.
// - String lengths count Unicode code points, as JSON Schema requires (not
//   UTF-16 units).
// - `$ref` resolves only local `#/$defs/<Name>` pointers.
//
// Supported assertions: type (one or a list; "integer" accepts only integral
// numbers), const, enum, pattern, minLength, maxLength, minimum, maximum,
// minItems, maxItems, uniqueItems, items, properties, required,
// additionalProperties (false or a schema), $ref, oneOf (exactly one branch).

const ANNOTATIONS = new Set(["$schema", "$id", "$comment", "title", "description", "format", "examples"]);
const ASSERTIONS = new Set([
  "$defs",
  "$ref",
  "type",
  "const",
  "enum",
  "pattern",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "minItems",
  "maxItems",
  "uniqueItems",
  "items",
  "properties",
  "required",
  "additionalProperties",
  "oneOf",
]);
const TYPES = new Set(["null", "boolean", "object", "array", "number", "integer", "string"]);

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function matchesType(instance, allowed) {
  const actual = typeOf(instance);
  if (allowed.includes(actual)) return true;
  return allowed.includes("integer") && actual === "number" && Number.isInteger(instance);
}

function deepEqual(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

/** Walks a schema once and throws on any keyword this validator cannot honour. */
function checkKeywords(node, path) {
  if (typeof node === "boolean") return;
  if (node === null || typeof node !== "object" || Array.isArray(node)) {
    throw new Error(`${path}: a schema must be an object or a boolean`);
  }
  for (const key of Object.keys(node)) {
    if (!ANNOTATIONS.has(key) && !ASSERTIONS.has(key)) {
      throw new Error(`${path}: keyword "${key}" is not supported by tools/json-schema-subset.mjs (fail closed)`);
    }
  }
  if (node.type !== undefined) {
    const types = Array.isArray(node.type) ? node.type : [node.type];
    for (const type of types) {
      if (!TYPES.has(type)) throw new Error(`${path}: unknown type "${type}"`);
    }
  }
  if (node.$ref !== undefined && !/^#\/\$defs\/[A-Za-z0-9_]+$/.test(node.$ref)) {
    throw new Error(`${path}: only local #/$defs/<Name> references are supported, got ${node.$ref}`);
  }
  if (node.pattern !== undefined) new RegExp(node.pattern, "u");
  for (const [name, child] of Object.entries(node.$defs ?? {})) checkKeywords(child, `${path}/$defs/${name}`);
  for (const [name, child] of Object.entries(node.properties ?? {})) checkKeywords(child, `${path}/properties/${name}`);
  if (node.items !== undefined) checkKeywords(node.items, `${path}/items`);
  if (node.oneOf !== undefined) {
    if (!Array.isArray(node.oneOf) || node.oneOf.length === 0) throw new Error(`${path}: oneOf must be a non-empty list`);
    node.oneOf.forEach((child, index) => checkKeywords(child, `${path}/oneOf/${index}`));
  }
  if (node.additionalProperties !== undefined && typeof node.additionalProperties !== "boolean") {
    checkKeywords(node.additionalProperties, `${path}/additionalProperties`);
  }
}

function validateNode(instance, node, root, path, errors) {
  if (node === true) return;
  if (node === false) {
    errors.push(`${path}: no value is allowed here`);
    return;
  }
  if (node.$ref !== undefined) {
    const name = node.$ref.slice("#/$defs/".length);
    const target = root.$defs?.[name];
    if (target === undefined) {
      errors.push(`${path}: unresolved $ref ${node.$ref}`);
      return;
    }
    validateNode(instance, target, root, path, errors);
  }
  if (node.oneOf !== undefined) {
    const branchErrors = node.oneOf.map((branch) => {
      const collected = [];
      validateNode(instance, branch, root, path, collected);
      return collected;
    });
    const matching = branchErrors.filter((collected) => collected.length === 0).length;
    if (matching !== 1) {
      errors.push(
        `${path}: must match exactly one oneOf branch, matched ${matching} (${branchErrors
          .map((collected) => collected[0] ?? "ok")
          .join(" / ")})`,
      );
    }
  }
  if (node.const !== undefined && !deepEqual(instance, node.const)) {
    errors.push(`${path}: expected const ${JSON.stringify(node.const)}, got ${JSON.stringify(instance)}`);
  }
  if (node.enum !== undefined && !node.enum.some((candidate) => deepEqual(candidate, instance))) {
    errors.push(`${path}: ${JSON.stringify(instance)} is not one of ${JSON.stringify(node.enum)}`);
  }
  if (node.type !== undefined) {
    const allowed = Array.isArray(node.type) ? node.type : [node.type];
    if (!matchesType(instance, allowed)) {
      errors.push(`${path}: expected type ${allowed.join("|")}, got ${typeOf(instance)}`);
      return;
    }
  }
  if (typeof instance === "string") {
    const length = [...instance].length;
    if (node.pattern !== undefined && !new RegExp(node.pattern, "u").test(instance)) {
      errors.push(`${path}: ${JSON.stringify(instance)} does not match ${node.pattern}`);
    }
    if (node.minLength !== undefined && length < node.minLength) {
      errors.push(`${path}: shorter than minLength ${node.minLength}`);
    }
    if (node.maxLength !== undefined && length > node.maxLength) {
      errors.push(`${path}: longer than maxLength ${node.maxLength}`);
    }
  }
  if (typeof instance === "number") {
    if (node.minimum !== undefined && instance < node.minimum) errors.push(`${path}: below minimum ${node.minimum}`);
    if (node.maximum !== undefined && instance > node.maximum) errors.push(`${path}: above maximum ${node.maximum}`);
  }
  if (Array.isArray(instance)) {
    if (node.minItems !== undefined && instance.length < node.minItems) {
      errors.push(`${path}: fewer than minItems ${node.minItems}`);
    }
    if (node.maxItems !== undefined && instance.length > node.maxItems) {
      errors.push(`${path}: more than maxItems ${node.maxItems}`);
    }
    if (node.uniqueItems === true) {
      const seen = new Set(instance.map((item) => JSON.stringify(canonical(item))));
      if (seen.size !== instance.length) errors.push(`${path}: items are not unique`);
    }
    if (node.items !== undefined) {
      instance.forEach((item, index) => validateNode(item, node.items, root, `${path}[${index}]`, errors));
    }
  }
  if (typeOf(instance) === "object") {
    const properties = node.properties ?? {};
    for (const key of node.required ?? []) {
      if (!Object.hasOwn(instance, key)) errors.push(`${path}: missing required property "${key}"`);
    }
    for (const [key, value] of Object.entries(instance)) {
      if (Object.hasOwn(properties, key)) {
        validateNode(value, properties[key], root, `${path}.${key}`, errors);
      } else if (node.additionalProperties === false) {
        errors.push(`${path}: unexpected property "${key}"`);
      } else if (node.additionalProperties !== undefined && node.additionalProperties !== true) {
        validateNode(value, node.additionalProperties, root, `${path}.${key}`, errors);
      }
    }
  }
}

/**
 * Compiles `schema` (throwing if it uses an unsupported keyword or is not a
 * draft 2020-12 schema) and returns `validate(instance, label) -> string[]`,
 * the list of violations (empty when the instance is valid).
 */
export function compileSchema(schema, name = "schema") {
  if (schema?.$schema !== "https://json-schema.org/draft/2020-12/schema") {
    throw new Error(`${name}: $schema must be https://json-schema.org/draft/2020-12/schema`);
  }
  checkKeywords(schema, name);
  return (instance, label = "instance") => {
    const errors = [];
    validateNode(instance, schema, schema, label, errors);
    return errors;
  };
}

/** UTF-8 byte order, the order every repeated set field in these contracts is written in. */
export function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

/** Whether `items` is strictly ascending in UTF-8 byte order (so also free of duplicates). */
export function isStrictlyAscendingUtf8(items) {
  for (let index = 1; index < items.length; index += 1) {
    if (compareUtf8(items[index - 1], items[index]) >= 0) return false;
  }
  return true;
}
