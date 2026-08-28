import { quoteIdentifier } from "./transformations.js";

export const VALIDATION_OPERATORS = Object.freeze(["equals", "not-equals", "greater-than", "greater-or-equal", "less-than", "less-or-equal", "is-null", "is-not-null", "is-empty", "is-not-empty"]);
export const VALIDATION_SEVERITIES = Object.freeze(["info", "warning", "critical"]);

function sqlLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Validation value must be finite.");
    return String(value);
  }
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function assertColumn(schema, name) {
  if (!schema.some((column) => column.name === name)) throw new Error(`Validation column not found: ${name}`);
  return quoteIdentifier(name);
}

function compileLeaf(condition, schema) {
  const left = assertColumn(schema, condition.field);
  const operator = condition.operator;
  if (!VALIDATION_OPERATORS.includes(operator)) throw new Error(`Unsupported validation operator: ${operator}`);
  if (operator === "is-null") return `${left} IS NULL`;
  if (operator === "is-not-null") return `${left} IS NOT NULL`;
  if (operator === "is-empty") return `(${left} IS NULL OR TRIM(CAST(${left} AS VARCHAR)) = '')`;
  if (operator === "is-not-empty") return `(${left} IS NOT NULL AND TRIM(CAST(${left} AS VARCHAR)) <> '')`;
  const right = condition.rightField ? assertColumn(schema, condition.rightField) : sqlLiteral(condition.value);
  if (!condition.rightField && condition.value === undefined) throw new Error(`Validation operator ${operator} requires a value or rightField.`);
  if (operator === "equals") return `${left} IS NOT DISTINCT FROM ${right}`;
  if (operator === "not-equals") return `${left} IS DISTINCT FROM ${right}`;
  if (operator === "greater-than") return `${left} > ${right}`;
  if (operator === "greater-or-equal") return `${left} >= ${right}`;
  if (operator === "less-than") return `${left} < ${right}`;
  return `${left} <= ${right}`;
}

export function compileValidationCondition(condition, schema) {
  if (Array.isArray(condition?.all)) {
    if (!condition.all.length) throw new Error("Validation all group cannot be empty.");
    return `(${condition.all.map((item) => compileValidationCondition(item, schema)).join(" AND ")})`;
  }
  if (Array.isArray(condition?.any)) {
    if (!condition.any.length) throw new Error("Validation any group cannot be empty.");
    return `(${condition.any.map((item) => compileValidationCondition(item, schema)).join(" OR ")})`;
  }
  return compileLeaf(condition ?? {}, schema);
}

export function validationFields(condition, result = new Set()) {
  if (Array.isArray(condition?.all)) condition.all.forEach((item) => validationFields(item, result));
  else if (Array.isArray(condition?.any)) condition.any.forEach((item) => validationFields(item, result));
  else {
    if (condition?.field) result.add(condition.field);
    if (condition?.rightField) result.add(condition.rightField);
  }
  return [...result];
}

export function normalizeValidationRule(rule, schema) {
  const severity = VALIDATION_SEVERITIES.includes(rule.severity) ? rule.severity : "warning";
  compileValidationCondition(rule.condition, schema);
  return {
    id: String(rule.id ?? globalThis.crypto?.randomUUID?.() ?? `rule-${Date.now()}`),
    targetId: rule.targetId ?? null,
    name: String(rule.name ?? "Validation rule").trim() || "Validation rule",
    severity,
    enabled: rule.enabled !== false,
    condition: structuredClone(rule.condition),
    recommendation: String(rule.recommendation ?? "").trim(),
    exception: rule.exception ?? null,
  };
}

export function qualityGateStatus(rules = [], results = []) {
  if (!results.length) return "not-evaluated";
  const resultById = new Map(results.map((result) => [result.ruleId, result]));
  const criticalOpen = rules.some((rule) => rule.enabled !== false && rule.severity === "critical" && !rule.exception && (resultById.get(rule.id)?.impactedCount ?? 0) > 0);
  if (criticalOpen) return "issues-found";
  const hasExceptions = rules.some((rule) => rule.exception && (resultById.get(rule.id)?.impactedCount ?? 0) > 0);
  return hasExceptions ? "ready-with-exceptions" : "analysis-ready";
}
