import { classifyColumnSemantics } from "./dataPrivacy.js";

export const FIELD_ROLES = Object.freeze(["identifier", "dimension", "measure", "timestamp", "status", "free-text", "attribute"]);
export const FIELD_SENSITIVITIES = Object.freeze(["public", "internal", "pii", "financial", "secret"]);
export const AGGREGATIONS = Object.freeze(["count", "count-distinct", "sum", "average", "median", "percentile", "min", "max"]);

function now() {
  return new Date().toISOString();
}

function inferredRole(column, semantics) {
  const name = String(column.name ?? "").toLowerCase();
  const type = String(column.type ?? "").toUpperCase();
  if (/DATE|TIME/.test(type)) return "timestamp";
  if (/(^|[_\s])(status|state|stage)([_\s]|$)/.test(name)) return "status";
  if (semantics.semanticRole === "identifier") return "identifier";
  if (semantics.semanticRole === "measure") return "measure";
  if (semantics.category === "free-text") return "free-text";
  return semantics.semanticRole === "dimension" ? "dimension" : "attribute";
}

function inferredSensitivity(semantics) {
  if (semantics.category === "financial") return "financial";
  if (semantics.category === "credential") return "secret";
  if (semantics.sensitivity === "sensitive" || semantics.sensitivity === "potentially-sensitive") return "pii";
  return "internal";
}

function allowedAggregations(role) {
  if (role === "measure") return [...AGGREGATIONS];
  if (role === "identifier") return ["count", "count-distinct"];
  return ["count", "count-distinct", "min", "max"];
}

export function inferFieldDefinition(column) {
  const semantics = classifyColumnSemantics(column.name, column.type);
  const role = inferredRole(column, semantics);
  return {
    name: column.name,
    businessName: column.name,
    description: "",
    dataType: column.type ?? null,
    role,
    unit: null,
    sensitivity: inferredSensitivity(semantics),
    allowedAggregations: allowedAggregations(role),
    provenance: { kind: "source", column: column.name },
    inferred: true,
  };
}

export function createSemanticModel(targetId, schema = []) {
  return {
    targetId,
    revision: 1,
    fields: schema.map(inferFieldDefinition),
    metrics: [],
    entities: [],
    updatedAt: now(),
  };
}

export function reconcileSemanticModel(model, targetId, schema = []) {
  const current = model?.targetId === targetId ? model : createSemanticModel(targetId, []);
  const existing = new Map((current.fields ?? []).map((field) => [field.name, field]));
  const fields = schema.map((column) => {
    const previous = existing.get(column.name);
    return previous ? { ...previous, dataType: column.type ?? previous.dataType ?? null } : inferFieldDefinition(column);
  });
  return { ...current, targetId, fields, revision: Math.max(1, Number(current.revision) || 1), updatedAt: current.updatedAt ?? now() };
}

export function updateSemanticField(model, fieldName, changes) {
  const fields = model.fields.map((field) => {
    if (field.name !== fieldName) return field;
    const role = changes.role ?? field.role;
    if (!FIELD_ROLES.includes(role)) throw new Error(`Unsupported semantic role: ${role}`);
    const sensitivity = changes.sensitivity ?? field.sensitivity;
    if (!FIELD_SENSITIVITIES.includes(sensitivity)) throw new Error(`Unsupported sensitivity: ${sensitivity}`);
    const aggregations = changes.allowedAggregations ?? field.allowedAggregations;
    if (!Array.isArray(aggregations) || aggregations.some((item) => !AGGREGATIONS.includes(item))) throw new Error("Unsupported field aggregation.");
    if (role !== "measure" && aggregations.some((item) => ["sum", "average", "median", "percentile"].includes(item))) {
      throw new Error("Only measures can use numeric aggregations.");
    }
    return {
      ...field,
      ...changes,
      businessName: String(changes.businessName ?? field.businessName).trim() || field.name,
      role,
      sensitivity,
      allowedAggregations: [...new Set(aggregations)],
      inferred: false,
    };
  });
  if (!fields.some((field) => field.name === fieldName)) throw new Error(`Semantic field not found: ${fieldName}`);
  return { ...model, fields, revision: model.revision + 1, updatedAt: now() };
}

export function semanticFieldMap(model) {
  return new Map((model?.fields ?? []).map((field) => [field.name, field]));
}

export function ensureAnalyticsState(graph) {
  return {
    ...graph,
    semanticModels: graph.semanticModels && typeof graph.semanticModels === "object" ? graph.semanticModels : {},
    validationRules: Array.isArray(graph.validationRules) ? graph.validationRules : [],
    validationRuns: Array.isArray(graph.validationRuns) ? graph.validationRuns : [],
    analyses: Array.isArray(graph.analyses) ? graph.analyses : [],
  };
}
