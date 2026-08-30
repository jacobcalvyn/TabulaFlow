import { classifyColumnSemantics } from "./dataPrivacy.js";
import { getFormulaColumnReferences } from "./formulaEngine.js";

export const SEMANTIC_ROLES = Object.freeze(["identifier", "dimension", "measure", "timestamp", "status", "free-text", "attribute", "flag"]);
export const SEMANTIC_SENSITIVITIES = Object.freeze(["public", "internal", "pii", "financial", "secret"]);
export const METRIC_FUNCTIONS = Object.freeze(["count", "count-distinct", "sum", "average", "min", "max", "median", "percentile"]);

const SENSITIVITY_RANK = Object.freeze({ public: 0, internal: 1, financial: 2, pii: 3, secret: 4 });

export function isSensitivityAtLeastAsStrict(candidate, baseline) {
  if (!Object.hasOwn(SENSITIVITY_RANK, candidate) || !Object.hasOwn(SENSITIVITY_RANK, baseline)) return false;
  return SENSITIVITY_RANK[candidate] >= SENSITIVITY_RANK[baseline];
}

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
  const semantic = column?.semantic?.source === "inferred" ? {} : (column?.semantic ?? {});
  return {
    ...inferFieldSemantic(column, provenance),
    ...semantic,
    provenance: semantic.provenance ?? column?.provenance ?? provenance,
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
    fields: Object.fromEntries(schema.map((column) => {
      const inferred = resolveFieldSemantic(column, { kind: "source", targetId, column: column.name });
      const existing = current[column.name] ?? {};
      const preserved = existing.source === "inferred"
        ? { provenance: existing.provenance ?? inferred.provenance }
        : existing;
      const incomingSemantic = column?.semantic ?? null;
      let sensitivity = incomingSemantic && preserved.sensitivity
        ? strictestSensitivity([incomingSemantic, preserved])
        : preserved.sensitivity ?? inferred.sensitivity;
      const role = preserved.role ?? inferred.role;
      const userConfirmedPublic = preserved.source === "user-override" && sensitivity === "public";
      if (role === "identifier" && !userConfirmedPublic) sensitivity = strictestSensitivity([{ sensitivity }, { sensitivity: "internal" }]);
      return [column.name, { ...inferred, ...preserved, sensitivity }];
    })),
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

function schemaField(schemaByName, name) {
  return schemaByName.get(String(name ?? "")) ?? null;
}

function derivedField(name, type, dependencies, provenance) {
  const semantic = dependencies.length
    ? mergeFieldSemantics(dependencies, provenance)
    : { ...inferFieldSemantic({ name, type }, provenance), sensitivity: "internal", source: "derived" };
  return { name, type: type ?? null, semantic: { ...semantic, businessName: name } };
}

function formulaTypePolicy(type) {
  const normalized = String(type ?? "").toUpperCase();
  if (/BOOL/.test(normalized)) return { role: "flag", allowedAggregations: ["count", "count-distinct"] };
  if (/DATE|TIME/.test(normalized)) return { role: "timestamp", allowedAggregations: ["min", "max", "count", "count-distinct"] };
  if (/INT|DECIMAL|NUMERIC|DOUBLE|FLOAT|REAL|HUGEINT/.test(normalized)) {
    return { role: "measure", allowedAggregations: ["count", "sum", "average", "min", "max", "median", "percentile"] };
  }
  if (/CHAR|TEXT|STRING|UUID|JSON/.test(normalized)) return { role: "dimension", allowedAggregations: ["count", "count-distinct"] };
  return { role: "attribute", allowedAggregations: ["count", "count-distinct"] };
}

function formulaPreservesUnit(expression, references) {
  if (references.length !== 1) return false;
  const compact = String(expression ?? "").replace(/\s+/g, "");
  const escaped = references[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^\\[${escaped}\\]$`, "i").test(compact)
    || new RegExp(`^(?:CAST|TRY_CAST)\\(\\[${escaped}\\]AS[A-Z0-9_(),]+\\)$`, "i").test(compact);
}

function formulaDerivedField(name, type, dependencies, provenance, expression, references) {
  const base = dependencies.length
    ? mergeFieldSemantics(dependencies, provenance)
    : { ...inferFieldSemantic({ name, type }, provenance), sensitivity: "internal", source: "derived" };
  const policy = formulaTypePolicy(type);
  return {
    name,
    type: type ?? null,
    semantic: {
      ...base,
      ...policy,
      businessName: name,
      unit: formulaPreservesUnit(expression, references) ? (dependencies[0]?.semantic?.unit ?? null) : null,
      sensitivity: dependencies.length ? strictestSensitivity(dependencies.map((column) => resolveFieldSemantic(column))) : "internal",
      provenance,
      source: "derived",
    },
  };
}

export function deriveRecipeSemanticSchema(sourceSchema = [], recipe = [], outputSchema = [], existingSchema = []) {
  const existingByName = new Map(existingSchema.map((column) => [column.name, column]));
  const outputByName = new Map(outputSchema.map((column) => [column.name, column]));
  const fields = new Map(sourceSchema.map((column) => {
    const existing = existingByName.get(column.name);
    const seed = existing ? { ...column, semantic: existing.semantic } : column;
    return [column.name, { ...column, semantic: resolveFieldSemantic(seed, { kind: "source", column: column.name }) }];
  }));

  for (const step of recipe) {
    if (!step || step.enabled === false) continue;
    const params = step.params ?? {};
    if (step.type === "rename-column") {
      const previous = schemaField(fields, params.column);
      if (!previous) continue;
      fields.delete(params.column);
      fields.set(params.newName, {
        ...previous,
        name: params.newName,
        semantic: { ...previous.semantic, businessName: params.newName, provenance: { kind: "rename-column", stepId: step.id, column: params.column }, source: "derived" },
      });
    } else if (["change-type", "trim", "standardize-case", "parse-date"].includes(step.type)) {
      const previous = schemaField(fields, params.column);
      if (!previous) continue;
      const nextType = step.type === "change-type"
        ? params.targetType
        : step.type === "parse-date"
          ? "DATE"
          : step.type === "trim" || step.type === "standardize-case"
            ? "VARCHAR"
            : previous.type;
      fields.set(params.column, {
        ...previous,
        type: nextType ?? previous.type,
        semantic: { ...previous.semantic, provenance: { kind: step.type, stepId: step.id, column: params.column }, source: "derived" },
      });
    } else if (["select-columns", "remove-columns"].includes(step.type)) {
      const selected = new Set(Array.isArray(params.columns) ? params.columns : String(params.columns ?? "").split(",").map((value) => value.trim()).filter(Boolean));
      for (const name of [...fields.keys()]) {
        if ((step.type === "select-columns" && !selected.has(name)) || (step.type === "remove-columns" && selected.has(name))) fields.delete(name);
      }
    } else if (step.type === "calculated-field") {
      let references = [];
      try {
        references = getFormulaColumnReferences(params.expression);
      } catch {
        // Invalid formulas are handled by the recipe compiler; a failed semantic parse stays conservative.
      }
      const dependencies = references.map((name) => schemaField(fields, name) ?? existingByName.get(name)).filter(Boolean);
      fields.set(params.outputColumn, formulaDerivedField(params.outputColumn, outputByName.get(params.outputColumn)?.type ?? null, dependencies, {
        kind: "calculated-field",
        stepId: step.id,
        column: params.outputColumn,
        dependencies: references,
      }, params.expression, references));
    } else if (step.type === "calculated-column") {
      const references = [params.leftColumn, params.rightColumn].filter(Boolean);
      const dependencies = references.map((name) => schemaField(fields, name) ?? existingByName.get(name)).filter(Boolean);
      fields.set(params.newName, derivedField(params.newName, null, dependencies, { kind: "calculated-column", stepId: step.id, dependencies: references }));
    } else if (step.type === "conditional-column") {
      const dependency = schemaField(fields, params.column) ?? existingByName.get(params.column);
      fields.set(params.newName, derivedField(params.newName, null, dependency ? [dependency] : [], { kind: "conditional-column", stepId: step.id, dependencies: [params.column] }));
    } else if (step.type === "group-aggregate") {
      const groups = Array.isArray(params.groupColumns) ? params.groupColumns : String(params.groupColumns ?? "").split(",").map((value) => value.trim()).filter(Boolean);
      const retained = new Map(groups.map((name) => [name, schemaField(fields, name)]).filter(([, field]) => field));
      const valueField = schemaField(fields, params.valueColumn);
      const dependencies = valueField ? [valueField] : [...retained.values()];
      retained.set(params.newName, derivedField(params.newName, null, dependencies, { kind: "group-aggregate", stepId: step.id, dependencies: params.valueColumn ? [params.valueColumn] : groups }));
      fields.clear();
      for (const [name, field] of retained) fields.set(name, field);
    }
  }

  return outputSchema.map((column) => {
    const derived = fields.get(column.name);
    const existing = existingByName.get(column.name);
    if (!derived) return { ...column, semantic: { sensitivity: "internal", source: "derived-recipe", provenance: { kind: "recipe", column: column.name } } };
    const existingSemantic = existing?.semantic;
    const preserveExisting = existingSemantic?.source === "override" || existingSemantic?.source === "user-override";
    const sensitivity = existingSemantic
      ? strictestSensitivity([derived.semantic, existingSemantic])
      : derived.semantic.sensitivity;
    return {
      ...column,
      semantic: {
        ...derived.semantic,
        ...(preserveExisting ? existingSemantic : {}),
        sensitivity,
        provenance: derived.semantic.provenance,
        source: derived.semantic.source,
      },
    };
  });
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
    targetId: String(definition?.targetId ?? ""),
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
