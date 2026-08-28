import { classifyColumnSemantics } from "./dataPrivacy.js";

export const SEMANTIC_ROLES = Object.freeze(["identifier", "dimension", "measure", "timestamp", "status", "free-text", "attribute"]);
export const SEMANTIC_SENSITIVITIES = Object.freeze(["public", "internal", "pii", "financial", "secret"]);
export const METRIC_FUNCTIONS = Object.freeze(["count", "count-distinct", "sum", "average", "min", "max", "median", "percentile"]);

const SENSITIVITY_RANK = Object.freeze({ public: 0, internal: 1, financial: 2, pii: 3, secret: 4 });

function inferredSensitivity(value, category) {
  if (category === "credential") return "secret";
  if (category === "financial") return "financial";
  if (value === "sensitive") return "pii";
  if (value === "potentially-sensitive") return "internal";
  return "public";
}

export function inferFieldSemantic(column, provenance = null) {
  const inferred = classifyColumnSemantics(column?.name, column?.type);
  return {
    businessName: column?.name ?? "",
    role: inferred.semanticRole ?? "attribute",
    unit: null,
    sensitivity: inferredSensitivity(inferred.sensitivity, inferred.category),
    allowedAggregations: inferred.semanticRole === "measure"
      ? ["sum", "average", "min", "max", "median", "percentile"]
      : inferred.semanticRole === "identifier"
        ? ["count", "count-distinct"]
        : ["count", "count-distinct"],
    provenance,
    source: "inferred",
  };
}

export function resolveFieldSemantic(column, provenance = null) {
  return {
    ...inferFieldSemantic(column, provenance),
    ...(column?.semantic ?? {}),
    provenance: column?.semantic?.provenance ?? column?.provenance ?? provenance,
  };
}

export function createSemanticModel(targetId, schema = []) {
  return {
    targetId,
    revision: 0,
    fields: Object.fromEntries(schema.map((column) => [column.name, resolveFieldSemantic(column, {
      kind: "source",
      targetId,
      column: column.name,
    })])),
  };
}

export function reconcileSemanticModel(model, targetId, schema = []) {
  const current = model?.fields ?? {};
  return {
    targetId,
    revision: Number(model?.revision ?? 0),
    fields: Object.fromEntries(schema.map((column) => [column.name, {
      ...resolveFieldSemantic(column, { kind: "source", targetId, column: column.name }),
      ...(current[column.name] ?? {}),
    }])),
  };
}

export function updateSemanticField(model, fieldName, changes = {}) {
  if (!model?.fields?.[fieldName]) throw new Error(`Semantic field not found: ${fieldName}`);
  const role = changes.role ?? model.fields[fieldName].role;
  const sensitivity = changes.sensitivity ?? model.fields[fieldName].sensitivity;
  if (!SEMANTIC_ROLES.includes(role)) throw new Error(`Unsupported semantic role: ${role}`);
  if (!SEMANTIC_SENSITIVITIES.includes(sensitivity)) throw new Error(`Unsupported semantic sensitivity: ${sensitivity}`);
  return {
    ...model,
    revision: Number(model.revision ?? 0) + 1,
    fields: {
      ...model.fields,
      [fieldName]: {
        ...model.fields[fieldName],
        ...changes,
        role,
        sensitivity,
        source: "override",
      },
    },
  };
}

export function applySemanticModelToSchema(schema = [], model = null) {
  return schema.map((column) => ({
    ...column,
    semantic: {
      ...resolveFieldSemantic(column),
      ...(model?.fields?.[column.name] ?? {}),
    },
  }));
}

export function strictestSensitivity(semantics = []) {
  return semantics.reduce((current, item) => {
    const candidate = item?.sensitivity ?? "public";
    return (SENSITIVITY_RANK[candidate] ?? 0) > (SENSITIVITY_RANK[current] ?? 0) ? candidate : current;
  }, "public");
}

export function mergeFieldSemantics(columns = [], provenance = null) {
  const resolved = columns.filter(Boolean).map((column) => resolveFieldSemantic(column));
  if (!resolved.length) return resolveFieldSemantic({ name: provenance?.column ?? "derived", type: null }, provenance);
  const primary = resolved[0];
  return {
    ...primary,
    sensitivity: strictestSensitivity(resolved),
    provenance,
    source: "derived",
  };
}

export function normalizeMetricDefinition(definition, schema = []) {
  const id = String(definition?.id ?? globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
  const name = String(definition?.name ?? "").trim();
  const fn = String(definition?.function ?? "count").toLowerCase();
  if (!name) throw new Error("Metric definition requires a name.");
  if (!METRIC_FUNCTIONS.includes(fn)) throw new Error(`Unsupported metric function: ${fn}`);
  const column = definition?.column ? String(definition.column) : null;
  if (fn !== "count" && !schema.some((item) => item.name === column)) throw new Error(`Metric column not found: ${column}`);
  const percentile = fn === "percentile" ? Number(definition?.percentile ?? 0.9) : null;
  if (fn === "percentile" && (!Number.isFinite(percentile) || percentile <= 0 || percentile >= 1)) {
    throw new Error("Metric percentile must be greater than 0 and less than 1.");
  }
  return {
    id,
    name,
    function: fn,
    column,
    percentile,
    description: String(definition?.description ?? "").trim(),
    unit: definition?.unit ?? null,
    format: definition?.format ?? null,
    updatedAt: new Date().toISOString(),
  };
}
