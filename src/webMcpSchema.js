function schemaError(issues) {
  const error = new Error("WebMCP input does not match the registered tool schema.");
  error.code = "WEBMCP_INVALID_INPUT";
  error.phase = "input-validation";
  error.issues = issues.slice(0, 20);
  return error;
}

function valueType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  if (typeof value === "number") return "number";
  return typeof value;
}

function matchesType(value, expected) {
  if (expected === "number") return typeof value === "number" && Number.isFinite(value);
  if (expected === "integer") return Number.isInteger(value);
  if (expected === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (expected === "array") return Array.isArray(value);
  if (expected === "null") return value === null;
  return typeof value === expected;
}

function isEqual(left, right) {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

function validateNode(schema, value, path, issues) {
  if (!schema || typeof schema !== "object") return;

  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter((candidate) => {
      const candidateIssues = [];
      validateNode(candidate, value, path, candidateIssues);
      return candidateIssues.length === 0;
    });
    if (matches.length !== 1) issues.push({ path, code: "oneOf" });
  }

  if (Object.prototype.hasOwnProperty.call(schema, "const") && !isEqual(value, schema.const)) {
    issues.push({ path, code: "const" });
    return;
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => isEqual(item, value))) {
    issues.push({ path, code: "enum" });
    return;
  }

  const expectedTypes = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (expectedTypes.length && !expectedTypes.some((expected) => matchesType(value, expected))) {
    issues.push({ path, code: "type", expected: expectedTypes, actual: valueType(value) });
    return;
  }

  if (typeof value === "string") {
    if (Number.isInteger(schema.minLength) && value.length < schema.minLength) issues.push({ path, code: "minLength" });
    if (Number.isInteger(schema.maxLength) && value.length > schema.maxLength) issues.push({ path, code: "maxLength" });
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    if (typeof schema.minimum === "number" && value < schema.minimum) issues.push({ path, code: "minimum" });
    if (typeof schema.maximum === "number" && value > schema.maximum) issues.push({ path, code: "maximum" });
    if (typeof schema.exclusiveMinimum === "number" && value <= schema.exclusiveMinimum) issues.push({ path, code: "exclusiveMinimum" });
    if (typeof schema.exclusiveMaximum === "number" && value >= schema.exclusiveMaximum) issues.push({ path, code: "exclusiveMaximum" });
  }

  if (Array.isArray(value)) {
    if (Number.isInteger(schema.minItems) && value.length < schema.minItems) issues.push({ path, code: "minItems" });
    if (Number.isInteger(schema.maxItems) && value.length > schema.maxItems) issues.push({ path, code: "maxItems" });
    if (schema.uniqueItems === true && value.some((item, index) => value.slice(0, index).some((previous) => isEqual(previous, item)))) {
      issues.push({ path, code: "uniqueItems" });
    }
    if (schema.items) value.forEach((item, index) => validateNode(schema.items, item, `${path}[${index}]`, issues));
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const properties = schema.properties && typeof schema.properties === "object" ? schema.properties : {};
    for (const required of schema.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(value, required)) issues.push({ path: `${path}.${required}`, code: "required" });
    }
    for (const [key, item] of Object.entries(value)) {
      if (Object.prototype.hasOwnProperty.call(properties, key)) {
        validateNode(properties[key], item, `${path}.${key}`, issues);
      } else if (schema.additionalProperties === false) {
        issues.push({ path: `${path}.${key}`, code: "additionalProperties" });
      } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        validateNode(schema.additionalProperties, item, `${path}.${key}`, issues);
      }
    }
  }
}

export function assertWebMcpInput(schema, input) {
  const issues = [];
  validateNode(schema, input, "$", issues);
  if (issues.length) throw schemaError(issues);
  return input;
}
