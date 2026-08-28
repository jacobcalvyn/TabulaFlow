import { quoteIdentifier } from "./transformations.js";
import { semanticFieldMap } from "./semanticModel.js";

export const ANALYSIS_FUNCTIONS = Object.freeze(["count", "count-distinct", "sum", "average", "median", "percentile", "min", "max"]);

function requireField(schema, name) {
  const field = schema.find((column) => column.name === name);
  if (!field) throw new Error(`Analysis field not found: ${name}`);
  return field;
}

function safeAlias(value, fallback) {
  const alias = String(value ?? fallback).trim();
  if (!alias) throw new Error("Analysis metric alias is required.");
  return alias;
}

function metricSql(metric, schema, semanticModel) {
  const fn = metric.function;
  if (!ANALYSIS_FUNCTIONS.includes(fn)) throw new Error(`Unsupported analysis function: ${fn}`);
  const alias = safeAlias(metric.alias, fn);
  if (fn === "count" && !metric.column) return { sql: `COUNT(*) AS ${quoteIdentifier(alias)}`, alias };
  requireField(schema, metric.column);
  const semantic = semanticFieldMap(semanticModel).get(metric.column);
  if (semantic && !semantic.allowedAggregations.includes(fn)) throw new Error(`${fn} is not allowed for ${metric.column}.`);
  const column = quoteIdentifier(metric.column);
  const expression = fn === "count" ? `COUNT(${column})`
    : fn === "count-distinct" ? `COUNT(DISTINCT ${column})`
      : fn === "average" ? `AVG(${column})`
        : fn === "median" ? `MEDIAN(${column})`
          : fn === "percentile" ? `QUANTILE_CONT(${column}, ${Math.min(.99, Math.max(.01, Number(metric.percentile) || .5))})`
            : `${fn.toUpperCase()}(${column})`;
  return { sql: `${expression} AS ${quoteIdentifier(alias)}`, alias };
}

export function compileAnalysis(definition, schema, semanticModel, relation = "working_data") {
  const dimensions = [...new Set(definition.dimensions ?? [])];
  const semanticFields = semanticFieldMap(semanticModel);
  dimensions.forEach((name) => {
    requireField(schema, name);
    const field = semanticFields.get(name);
    if (field?.role === "identifier" || ["pii", "secret"].includes(field?.sensitivity)) {
      throw new Error(`${name} cannot be used as an analysis dimension because it is identifying or sensitive.`);
    }
  });
  const metrics = (definition.metrics ?? []).map((metric) => metricSql(metric, schema, semanticModel));
  if (!metrics.length) throw new Error("Analysis requires at least one metric.");
  const projection = [...dimensions.map(quoteIdentifier), ...metrics.map((metric) => metric.sql), `COUNT(*) AS ${quoteIdentifier("__tf_group_count")}`].join(", ");
  const groupBy = dimensions.length ? ` GROUP BY ${dimensions.map(quoteIdentifier).join(", ")}` : "";
  const orderBy = metrics.length ? ` ORDER BY ${quoteIdentifier(metrics[0].alias)} DESC NULLS LAST` : "";
  const limit = Math.min(1000, Math.max(1, Number(definition.limit) || 200));
  return {
    sql: `SELECT ${projection} FROM ${relation}${groupBy}${orderBy} LIMIT ${limit}`,
    dimensions,
    metricAliases: metrics.map((metric) => metric.alias),
    limit,
  };
}

export function normalizeAnalysisDefinition(definition, schema, semanticModel) {
  compileAnalysis(definition, schema, semanticModel);
  return {
    id: String(definition.id ?? globalThis.crypto?.randomUUID?.() ?? `analysis-${Date.now()}`),
    name: String(definition.name ?? "Analysis").trim() || "Analysis",
    targetId: definition.targetId,
    metrics: structuredClone(definition.metrics ?? []),
    dimensions: [...new Set(definition.dimensions ?? [])],
    minimumSampleSize: Math.max(1, Number(definition.minimumSampleSize) || 20),
    limit: Math.min(1000, Math.max(1, Number(definition.limit) || 200)),
    revision: Math.max(1, Number(definition.revision) || 1),
    updatedAt: new Date().toISOString(),
  };
}
