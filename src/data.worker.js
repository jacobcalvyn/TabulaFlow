import * as duckdb from "@duckdb/duckdb-wasm";
import { DUCKDB_BUNDLES } from "@duckdb-bundles";
import { compileComposeOperation } from "./composeSql.js";
import { DATA_LIMITS, makeDemoRows, normalizeEmptyValues, parseDataFile } from "./data.js";
import { canExposeProfileRange, classifyColumnSemantics } from "./dataPrivacy.js";
import { encodeSpreadsheetExport, sanitizeExportBaseName } from "./dataExport.js";
import { buildJoinKeyCandidates, rankJoinKeyCandidates } from "./joinRecommendations.js";
import { recipeForExecution } from "./preparedRecipeState.js";
import { collectSourceColumns } from "./sourceInspection.js";
import { compileRecipe, compileRecipeSafely, INTERNAL_ROW_ID } from "./transformations.js";

const AGGREGATE_LIMIT = 100;
const WEBMCP_PREVIEW_COLUMN_LIMIT = 100;
const WEBMCP_PROFILE_COLUMN_LIMIT = 50;
const WEBMCP_DRY_RUN_PREVIEW_COLUMN_LIMIT = 20;
const WEBMCP_DRY_RUN_PREVIEW_ROW_LIMIT = 20;
const SOURCE_TABLE = "source_data";
const WORKING_VIEW = "working_data";
let databasePromise = null;
let database = null;
let connection = null;
let engineWorker = null;
let sourceName = "";
let datasetId = 0;
let rowCount = 0;
let columns = [];
let sourceColumns = [];
let columnTypes = new Map();
let aggregateColumns = [];
let qualityCache = null;
let currentRecipe = [];
let stepStates = [];
let engineVersion = "";
let requestQueue = Promise.resolve();
let activeRequestId = null;
const sourceRegistry = new Map();
const preparedRegistry = new Map();
let activePreparedId = null;

function reportProgress(phase, percent) {
  if (activeRequestId === null) return;
  self.postMessage({ kind: "progress", requestId: activeRequestId, phase, percent });
}

function registryTableName(sequence) {
  return `source_${sequence}`;
}

function cloneRecipe(recipe = []) {
  return recipe.map((step) => ({ ...step, params: { ...step.params } }));
}

function quoteIdentifier(identifier) {
  return `"${String(identifier).replaceAll('"', '""')}"`;
}

function normalizeDuckValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString();
  if (value instanceof Date) return value;
  if (Array.isArray(value)) return JSON.stringify(value.map(normalizeDuckValue));
  if (typeof value === "object") {
    const jsonValue = typeof value.toJSON === "function" ? value.toJSON() : value;
    if (jsonValue !== value) return normalizeDuckValue(jsonValue);
    return JSON.stringify(jsonValue);
  }
  return value;
}

function tableRows(table) {
  return table.toArray().map((row) => {
    const json = typeof row.toJSON === "function" ? row.toJSON() : row;
    return Object.fromEntries(Object.entries(json).map(([key, value]) => [key, normalizeDuckValue(value)]));
  });
}

async function initializeDuckDB() {
  if (connection) return;
  if (!databasePromise) {
    databasePromise = (async () => {
      try {
        reportProgress("engine_select", 5);
        const bundle = await duckdb.selectBundle(DUCKDB_BUNDLES);
        reportProgress("engine_worker", 15);
        engineWorker = await duckdb.createWorker(bundle.mainWorker);
        database = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), engineWorker);
        reportProgress("engine_wasm", 30);
        await database.instantiate(bundle.mainModule, bundle.pthreadWorker);
        reportProgress("engine_connect", 75);
        engineVersion = await database.getVersion();
        connection = await database.connect();
        reportProgress("engine_ready", 100);
      } catch (error) {
        try {
          await database?.terminate();
        } catch {
          engineWorker?.terminate();
        }
        databasePromise = null;
        database = null;
        connection = null;
        engineWorker = null;
        engineVersion = "";
        throw error;
      }
    })();
  }
  await databasePromise;
}

async function query(sql, parameters = []) {
  await initializeDuckDB();
  if (!parameters.length) return tableRows(await connection.query(sql));
  const statement = await connection.prepare(sql);
  try {
    return tableRows(await statement.query(...parameters));
  } finally {
    await statement.close();
  }
}

function typeToUi(type) {
  const normalized = String(type).toUpperCase();
  if (normalized.includes("DATE") || normalized.includes("TIME")) return "tanggal";
  if (normalized === "BOOLEAN") return "boolean";
  if (/^(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT)$/.test(normalized)) return "angka";
  if (normalized.includes("DECIMAL") || ["FLOAT", "DOUBLE", "REAL"].includes(normalized)) return "desimal";
  return "teks";
}

function parseAggregateValue(valueText, type) {
  if (valueText === null || valueText === undefined) return null;
  const uiType = typeToUi(type);
  if (uiType === "angka" || uiType === "desimal") {
    const numeric = Number(valueText);
    return Number.isFinite(numeric) && (uiType === "desimal" || Number.isSafeInteger(numeric)) ? numeric : String(valueText);
  }
  if (uiType === "boolean") return String(valueText).toLowerCase() === "true";
  return String(valueText);
}

function aggregateItem(row, type) {
  const raw = parseAggregateValue(row.value_text, type);
  const label = raw === null ? "" : String(row.value_text);
  const prefix = raw === null ? "empty" : typeof raw;
  return { key: `${prefix}:${raw === null ? "" : String(raw)}`, label, raw, count: Number(row.count) };
}

function filterParameter(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return value;
}

function buildWhere(filters = {}, excludedColumn = null) {
  const clauses = [];
  const parameters = [];
  for (const [column, selection] of Object.entries(filters)) {
    if (column === excludedColumn || !columnTypes.has(column) || !selection) continue;
    const identifier = quoteIdentifier(column);
    if (selection.raw === null || selection.raw === undefined) {
      clauses.push(`${identifier} IS NULL`);
    } else {
      const type = String(columnTypes.get(column)).toUpperCase();
      if (type.includes("JSON") || type.includes("UNION") || type.includes("STRUCT") || type.includes("[]")) {
        clauses.push(`CAST(${identifier} AS VARCHAR) = ?`);
      } else {
        clauses.push(`${identifier} = CAST(? AS ${columnTypes.get(column)})`);
      }
      parameters.push(filterParameter(selection.raw));
    }
  }
  return { sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "", parameters };
}

function displayProjection(selectedColumns = columns) {
  return selectedColumns.map((column) => {
    const identifier = quoteIdentifier(column);
    const type = String(columnTypes.get(column)).toUpperCase();
    return type.includes("DATE") || type.includes("TIME")
      ? `CAST(${identifier} AS VARCHAR) AS ${identifier}`
      : identifier;
  }).join(", ");
}

function normalizedPage(offset = 0, limit = 100) {
  const normalizedOffset = Math.max(0, Math.trunc(Number(offset) || 0));
  const normalizedLimit = Math.max(1, Math.min(100, Math.trunc(Number(limit) || 100)));
  return { offset: normalizedOffset, limit: normalizedLimit };
}

function selectedKnownColumns(requestedColumns, maximum = WEBMCP_PREVIEW_COLUMN_LIMIT) {
  const requested = Array.isArray(requestedColumns) && requestedColumns.length
    ? requestedColumns
    : columns.slice(0, maximum);
  if (requested.length > maximum) throw new Error(`A maximum of ${maximum} columns can be returned per request.`);
  const seen = new Set();
  return requested.map(String).filter((column) => {
    if (!columnTypes.has(column)) throw new Error(`Column not found: ${column}`);
    if (seen.has(column)) return false;
    seen.add(column);
    return true;
  });
}

async function refreshMetadata({ requireRows = false } = {}) {
  const description = await query(`DESCRIBE ${WORKING_VIEW}`);
  const visibleDescription = description.filter((item) => item.column_name !== INTERNAL_ROW_ID);
  columns = visibleDescription.map((item) => item.column_name);
  columnTypes = new Map(visibleDescription.map((item) => [item.column_name, item.column_type]));
  const counts = await query(`SELECT COUNT(*) AS row_count FROM ${WORKING_VIEW}`);
  rowCount = Number(counts[0]?.row_count ?? 0);
  if (requireRows && rowCount === 0) throw new Error("File tidak memiliki baris data.");
}

function normalizeAggregateColumns(requestedColumns) {
  const candidates = Array.isArray(requestedColumns)
    ? requestedColumns
    : columns.slice(0, DATA_LIMITS.maxAggregateColumns);
  const seen = new Set();
  return candidates.filter((column) => {
    if (!columnTypes.has(column) || seen.has(column) || seen.size >= DATA_LIMITS.maxAggregateColumns) return false;
    seen.add(column);
    return true;
  });
}

function createRegistryId(prefix) {
  const value = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${value}`;
}

async function loadRows(rows, filename, identifiers = {}) {
  reportProgress("engine_check", 10);
  await initializeDuckDB();
  const nextDatasetId = datasetId + 1;
  const sourceId = identifiers.sourceId ?? createRegistryId("source");
  const preparedId = identifiers.preparedId ?? createRegistryId("prepared");
  const previousSourceEntry = sourceRegistry.get(sourceId);
  const previousPreparedEntry = preparedRegistry.get(preparedId);
  const tableName = previousSourceEntry?.tableName ?? registryTableName(nextDatasetId);
  const importPath = `tabulaflow-import-${nextDatasetId}.json`;
  const previousState = {
    datasetId,
    sourceName,
    rowCount,
    columns,
    sourceColumns,
    columnTypes,
    aggregateColumns,
    qualityCache,
    currentRecipe,
    stepStates,
    activePreparedId,
  };

  reportProgress("register_data", 35);
  await database.registerFileText(importPath, JSON.stringify(rows));
  let transactionStarted = false;
  try {
    await query("BEGIN TRANSACTION");
    transactionStarted = true;
    reportProgress("create_table", 50);
    await query(`CREATE OR REPLACE TABLE ${quoteIdentifier(tableName)} AS
      SELECT ROW_NUMBER() OVER () AS ${quoteIdentifier(INTERNAL_ROW_ID)}, *
      FROM read_json_auto(
        '${importPath}',
        format = 'array',
        union_by_name = true,
        map_inference_threshold = -1,
        field_appearance_threshold = 0.0
      )`);
    await query(`CREATE OR REPLACE TEMP VIEW ${WORKING_VIEW} AS SELECT * FROM ${quoteIdentifier(tableName)}`);
    reportProgress("profile_data", 70);
    await refreshMetadata({ requireRows: true });
    sourceColumns = [...columns];
    aggregateColumns = normalizeAggregateColumns();
    datasetId = nextDatasetId;
    sourceName = filename;
    qualityCache = null;
    currentRecipe = [];
    stepStates = [];
    activePreparedId = preparedId;
    const sourceEntry = { id: sourceId, tableName, filename, sourceColumns: [...sourceColumns] };
    sourceRegistry.set(sourceId, sourceEntry);
    preparedRegistry.set(preparedId, { id: preparedId, sourceId, recipe: [], sourceColumns: [...sourceColumns], filename });
    const result = await buildDataset();
    reportProgress("commit_data", 95);
    await query("COMMIT");
    await query(`CREATE OR REPLACE TEMP VIEW ${SOURCE_TABLE} AS SELECT * FROM ${quoteIdentifier(tableName)}`);
    return { ...result, sourceId, preparedId };
  } catch (error) {
    if (transactionStarted) {
      try {
        await query("ROLLBACK");
      } catch {
        // Preserve the original import error; a failed rollback will require worker recovery.
      }
    }
    if (previousSourceEntry) sourceRegistry.set(sourceId, previousSourceEntry);
    else sourceRegistry.delete(sourceId);
    if (previousPreparedEntry) preparedRegistry.set(preparedId, previousPreparedEntry);
    else preparedRegistry.delete(preparedId);
    ({ datasetId, sourceName, rowCount, columns, sourceColumns, columnTypes, aggregateColumns, qualityCache, currentRecipe, stepStates, activePreparedId } = previousState);
    throw error;
  } finally {
    try {
      await database.dropFile(importPath);
    } catch {
      // Virtual import files are best-effort cleanup and must not invalidate a committed dataset.
    }
  }
}

async function analyzeQuality() {
  const affectedColumns = [];
  let emptyCells = 0;
  let mixedColumns = 0;
  const profiledColumns = columns.slice(0, DATA_LIMITS.maxAggregateColumns);
  const scalarExpressions = [];
  const jsonProfiles = [];

  profiledColumns.forEach((column, index) => {
    const identifier = quoteIdentifier(column);
    const normalizedType = String(columnTypes.get(column)).toUpperCase();
    scalarExpressions.push(`COUNT(*) FILTER (WHERE ${identifier} IS NULL OR TRIM(CAST(${identifier} AS VARCHAR)) = '') AS quality_${index}_missing`);
    if (normalizedType.includes("VARCHAR")) {
      scalarExpressions.push(
        `COUNT(*) FILTER (WHERE NULLIF(TRIM(${identifier}), '') IS NOT NULL AND TRY_CAST(NULLIF(TRIM(${identifier}), '') AS DOUBLE) IS NOT NULL) AS quality_${index}_numeric`,
        `COUNT(*) FILTER (WHERE NULLIF(TRIM(${identifier}), '') IS NOT NULL AND LOWER(NULLIF(TRIM(${identifier}), '')) IN ('true', 'false')) AS quality_${index}_boolean`,
        `COUNT(*) FILTER (WHERE NULLIF(TRIM(${identifier}), '') IS NOT NULL AND TRY_CAST(NULLIF(TRIM(${identifier}), '') AS DOUBLE) IS NULL AND LOWER(NULLIF(TRIM(${identifier}), '')) NOT IN ('true', 'false') AND TRY_CAST(NULLIF(TRIM(${identifier}), '') AS DATE) IS NOT NULL) AS quality_${index}_date`,
        `COUNT(*) FILTER (WHERE NULLIF(TRIM(${identifier}), '') IS NOT NULL AND TRY_CAST(NULLIF(TRIM(${identifier}), '') AS DOUBLE) IS NULL AND LOWER(NULLIF(TRIM(${identifier}), '')) NOT IN ('true', 'false') AND TRY_CAST(NULLIF(TRIM(${identifier}), '') AS DATE) IS NULL) AS quality_${index}_text`,
      );
    } else if (normalizedType.includes("JSON")) {
      jsonProfiles.push({ column, index });
    }
  });

  const scalarProfile = scalarExpressions.length
    ? (await query(`SELECT ${scalarExpressions.join(",\n")} FROM ${WORKING_VIEW}`))[0] ?? {}
    : {};
  const jsonProfileRows = jsonProfiles.length
    ? await query(jsonProfiles.map(({ column, index }) => {
      const identifier = quoteIdentifier(column);
      return `SELECT ${index} AS column_index, JSON_TYPE(${identifier}) AS source_type
        FROM ${WORKING_VIEW}
        WHERE ${identifier} IS NOT NULL
        GROUP BY source_type`;
    }).join("\nUNION ALL\n"))
    : [];
  const jsonTypesByColumn = new Map();
  for (const row of jsonProfileRows) {
    const index = Number(row.column_index);
    const categories = jsonTypesByColumn.get(index) ?? new Set();
    const sourceType = String(row.source_type).toUpperCase();
    if (["BIGINT", "UBIGINT", "DOUBLE", "DECIMAL"].includes(sourceType)) categories.add("angka");
    else if (sourceType === "BOOLEAN") categories.add("boolean");
    else categories.add("teks");
    jsonTypesByColumn.set(index, categories);
  }

  profiledColumns.forEach((column, index) => {
    const type = columnTypes.get(column);
    const missing = Number(scalarProfile[`quality_${index}_missing`] ?? 0);
    let mixed = false;
    let types = [typeToUi(type)];
    const normalizedType = String(type).toUpperCase();
    if (normalizedType.includes("VARCHAR")) {
      const categories = [
        ["angka", Number(scalarProfile[`quality_${index}_numeric`] ?? 0)],
        ["boolean", Number(scalarProfile[`quality_${index}_boolean`] ?? 0)],
        ["tanggal", Number(scalarProfile[`quality_${index}_date`] ?? 0)],
        ["teks", Number(scalarProfile[`quality_${index}_text`] ?? 0)],
      ].filter(([, count]) => count > 0);
      mixed = categories.length > 1;
      types = categories.map(([name]) => name);
    } else if (normalizedType.includes("JSON")) {
      const categories = jsonTypesByColumn.get(index) ?? new Set();
      mixed = categories.size > 1;
      types = [...categories];
    } else if (normalizedType.includes("UNION")) {
      const categories = [
        /INT|DECIMAL|DOUBLE|FLOAT/.test(normalizedType) && "angka",
        normalizedType.includes("BOOLEAN") && "boolean",
        /DATE|TIME/.test(normalizedType) && "tanggal",
        /VARCHAR|CHAR/.test(normalizedType) && "teks",
      ].filter(Boolean);
      types = [...new Set(categories)];
      mixed = types.length > 1;
    }
    emptyCells += missing;
    if (mixed) mixedColumns += 1;
    if (missing > 0 || mixed) affectedColumns.push({ column, missing, mixed, types });
  });
  return {
    emptyCells,
    mixedColumns,
    affectedColumns,
    profiledColumnCount: profiledColumns.length,
    totalColumnCount: columns.length,
  };
}

async function aggregateForColumns(requestedColumns, filters) {
  if (!requestedColumns.length) return [];
  const branches = [];
  const parameters = [];

  requestedColumns.forEach((column, index) => {
    const identifier = quoteIdentifier(column);
    const where = buildWhere(filters, column);
    branches.push(`SELECT ${index} AS column_index, value_text, count, distinct_count, FALSE AS selected_only
      FROM (
        WITH grouped AS (
          SELECT CAST(${identifier} AS VARCHAR) AS value_text, COUNT(*) AS count
          FROM ${WORKING_VIEW} ${where.sql}
          GROUP BY ${identifier}
        )
        SELECT value_text, count, COUNT(*) OVER () AS distinct_count
        FROM grouped
        ORDER BY count DESC, value_text ASC NULLS FIRST
        LIMIT ${AGGREGATE_LIMIT}
      ) AS aggregate_${index}`);
    parameters.push(...where.parameters);

    if (filters[column]) {
      const selectedWhere = buildWhere(filters);
      branches.push(`SELECT ${index} AS column_index, CAST(${identifier} AS VARCHAR) AS value_text, COUNT(*) AS count, 0 AS distinct_count, TRUE AS selected_only
        FROM ${WORKING_VIEW} ${selectedWhere.sql}
        GROUP BY ${identifier}`);
      parameters.push(...selectedWhere.parameters);
    }
  });

  const rows = await query(branches.join("\nUNION ALL\n"), parameters);
  return requestedColumns.map((column, index) => {
    const type = columnTypes.get(column);
    const columnRows = rows.filter((row) => Number(row.column_index) === index);
    const mainRows = columnRows.filter((row) => !row.selected_only);
    const values = mainRows.map((row) => aggregateItem(row, type)).sort((left, right) => {
      if (left.count !== right.count) return right.count - left.count;
      if (left.raw === null) return -1;
      if (right.raw === null) return 1;
      return left.label.localeCompare(right.label);
    });
    const selectedRow = columnRows.find((row) => row.selected_only);
    if (selectedRow) {
      const selectedItem = aggregateItem(selectedRow, type);
      if (!values.some((item) => item.key === selectedItem.key)) values.push(selectedItem);
    }
    return {
      column,
      type: typeToUi(type),
      distinctCount: Number(mainRows[0]?.distinct_count ?? 0),
      values,
    };
  });
}

async function buildDataset(filters = {}, requestedAggregateColumns) {
  aggregateColumns = normalizeAggregateColumns(requestedAggregateColumns);
  if (!qualityCache) qualityCache = await analyzeQuality();
  const where = buildWhere(filters);
  const countRows = await query(`SELECT COUNT(*) AS filtered_count FROM ${WORKING_VIEW} ${where.sql}`, where.parameters);
  const preview = await query(`SELECT ${displayProjection()} FROM ${WORKING_VIEW} ${where.sql} LIMIT 100`, where.parameters);
  const aggregates = await aggregateForColumns(aggregateColumns, filters);
  return {
    datasetId,
    filename: sourceName,
    rowCount,
    filteredCount: Number(countRows[0]?.filtered_count ?? 0),
    columns,
    aggregateColumns,
    aggregateColumnLimit: DATA_LIMITS.maxAggregateColumns,
    hiddenAggregateColumnCount: columns.length - aggregateColumns.length,
    aggregates,
    preview,
    quality: qualityCache,
    recipe: currentRecipe,
    stepStates,
    sourceColumns,
    columnTypes: Object.fromEntries(columnTypes),
    preparedId: activePreparedId,
    sourceId: activePreparedId ? preparedRegistry.get(activePreparedId)?.sourceId ?? null : null,
    engine: { name: "DuckDB-Wasm", version: engineVersion },
  };
}

async function searchAggregate(column, searchText, filters, offset = 0, limit = AGGREGATE_LIMIT) {
  if (!columnTypes.has(column)) return { values: [], matchCount: 0 };
  const page = normalizedPage(offset, limit);
  const identifier = quoteIdentifier(column);
  const type = columnTypes.get(column);
  const where = buildWhere(filters, column);
  const searchClause = where.sql ? `${where.sql} AND` : "WHERE";
  const normalizedSearch = String(searchText ?? "").trim();
  const nullSearch = normalizedSearch.replaceAll("(", "").replaceAll(")", "").toLocaleLowerCase();
  const includesNull = ["null", "kosong"].some((token) => token.includes(nullSearch));
  const escapedSearch = normalizedSearch.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
  const groupedSql = `
    WITH grouped AS (
      SELECT CAST(${identifier} AS VARCHAR) AS value_text, COUNT(*) AS count
      FROM ${WORKING_VIEW}
      ${searchClause} (LOWER(CAST(${identifier} AS VARCHAR)) LIKE LOWER(?) ESCAPE '\\'${includesNull ? ` OR ${identifier} IS NULL` : ""})
      GROUP BY ${identifier}
    )`;
  const parameters = [...where.parameters, `%${escapedSearch}%`];
  const countRows = await query(`${groupedSql} SELECT COUNT(*) AS match_count FROM grouped`, parameters);
  const rows = await query(`${groupedSql}
    SELECT value_text, count
    FROM grouped
    ORDER BY count DESC, value_text ASC NULLS FIRST
    LIMIT ${page.limit} OFFSET ${page.offset}
  `, parameters);
  return {
    column,
    values: rows.map((row) => aggregateItem(row, type)),
    matchCount: Number(countRows[0]?.match_count ?? 0),
    offset: page.offset,
    limit: page.limit,
  };
}

async function previewPreparedData(filters = {}, requestedColumns, offset = 0, limit = 100) {
  const page = normalizedPage(offset, limit);
  const selectedColumns = selectedKnownColumns(requestedColumns);
  const where = buildWhere(filters);
  const counts = await query(`SELECT COUNT(*) AS filtered_count FROM ${WORKING_VIEW} ${where.sql}`, where.parameters);
  const preview = await query(`SELECT ${displayProjection(selectedColumns)} FROM ${WORKING_VIEW} ${where.sql} LIMIT ${page.limit} OFFSET ${page.offset}`, where.parameters);
  return {
    preparedId: activePreparedId,
    columns: selectedColumns,
    totalColumnCount: columns.length,
    columnsTruncated: selectedColumns.length < columns.length,
    columnTypes: Object.fromEntries(selectedColumns.map((column) => [column, columnTypes.get(column)])),
    totalRowCount: rowCount,
    filteredRowCount: Number(counts[0]?.filtered_count ?? 0),
    previewRowCount: preview.length,
    offset: page.offset,
    limit: page.limit,
    preview,
  };
}

async function profileDataColumns(requestedColumns) {
  const selectedColumns = selectedKnownColumns(requestedColumns, WEBMCP_PROFILE_COLUMN_LIMIT);
  if (!qualityCache) qualityCache = await analyzeQuality();
  const semanticsByColumn = new Map(selectedColumns.map((column) => [column, classifyColumnSemantics(column, columnTypes.get(column))]));
  const expressions = selectedColumns.flatMap((column, index) => {
    const identifier = quoteIdentifier(column);
    const type = String(columnTypes.get(column)).toUpperCase();
    const comparable = type.includes("JSON") || type.includes("UNION") || type.includes("STRUCT") || type.includes("[]")
      ? `CAST(${identifier} AS VARCHAR)`
      : identifier;
    const baseExpressions = [
      `COUNT(*) FILTER (WHERE ${identifier} IS NULL OR TRIM(CAST(${identifier} AS VARCHAR)) = '') AS missing_${index}`,
      `COUNT(DISTINCT CAST(${identifier} AS VARCHAR)) AS distinct_${index}`,
    ];
    return canExposeProfileRange(semanticsByColumn.get(column), type)
      ? [...baseExpressions, `MIN(${comparable}) AS min_${index}`, `MAX(${comparable}) AS max_${index}`]
      : baseExpressions;
  });
  const stats = expressions.length ? (await query(`SELECT ${expressions.join(", ")} FROM ${WORKING_VIEW}`))[0] ?? {} : {};
  const qualityByColumn = new Map((qualityCache?.affectedColumns ?? []).map((item) => [item.column, item]));
  return {
    preparedId: activePreparedId,
    totalRowCount: rowCount,
    totalColumnCount: columns.length,
    profiledColumnCount: selectedColumns.length,
    columnsTruncated: selectedColumns.length < columns.length,
    quality: qualityCache,
    columns: selectedColumns.map((column, index) => {
      const issue = qualityByColumn.get(column);
      const semantics = semanticsByColumn.get(column);
      const exposeRange = canExposeProfileRange(semantics, columnTypes.get(column));
      return {
        name: column,
        type: columnTypes.get(column),
        missingCount: Number(stats[`missing_${index}`] ?? issue?.missing ?? 0),
        distinctCount: Number(stats[`distinct_${index}`] ?? 0),
        min: exposeRange ? stats[`min_${index}`] ?? null : null,
        max: exposeRange ? stats[`max_${index}`] ?? null : null,
        rangeRedacted: !exposeRange,
        mixedType: Boolean(issue?.mixed),
        observedTypes: issue?.types ?? [typeToUi(columnTypes.get(column))],
        semantics,
      };
    }),
  };
}

async function exportRows(format, filters, requestedBaseName = null) {
  const where = buildWhere(filters);
  const countRows = await query(`SELECT COUNT(*) AS export_count FROM ${WORKING_VIEW} ${where.sql}`, where.parameters);
  const exportCount = Number(countRows[0]?.export_count ?? 0);
  if (exportCount > DATA_LIMITS.maxExportRows) {
    throw new Error(`Ekspor dibatasi ${DATA_LIMITS.maxExportRows.toLocaleString("id-ID")} baris. Persempit data dengan filter.`);
  }
  const filteredRows = await query(`SELECT ${displayProjection()} FROM ${WORKING_VIEW} ${where.sql}`, where.parameters);
  const baseName = sanitizeExportBaseName(requestedBaseName || sourceName);
  const hasFilters = Object.values(filters ?? {}).some(Boolean);
  return encodeSpreadsheetExport(filteredRows, columns, format, hasFilters ? `${baseName}-filtered` : baseName);
}

async function activatePrepared(preparedId, filters = {}, requestedAggregateColumns) {
  const prepared = preparedRegistry.get(preparedId);
  const source = prepared ? sourceRegistry.get(prepared.sourceId) : null;
  if (!prepared || !source) {
    const error = new Error("Source is unavailable in this session.");
    error.code = "SOURCE_REQUIRED";
    throw error;
  }
  const compiled = compileRecipeSafely(prepared.recipe, prepared.sourceColumns, source.tableName);
  const previousState = {
    sourceName,
    sourceColumns,
    rowCount,
    columns,
    columnTypes,
    aggregateColumns,
    qualityCache,
    currentRecipe,
    stepStates,
    activePreparedId,
  };
  await query("BEGIN TRANSACTION");
  try {
    await query(`CREATE OR REPLACE TEMP VIEW ${SOURCE_TABLE} AS SELECT * FROM ${quoteIdentifier(source.tableName)}`);
    await query(`CREATE OR REPLACE TEMP VIEW ${WORKING_VIEW} AS ${compiled.sql}`);
    sourceName = source.filename;
    sourceColumns = [...prepared.sourceColumns];
    currentRecipe = cloneRecipe(prepared.recipe);
    stepStates = compiled.stepStates;
    activePreparedId = preparedId;
    qualityCache = null;
    await refreshMetadata();
    aggregateColumns = normalizeAggregateColumns(requestedAggregateColumns);
    const filterState = reconcileWorkerFilters(filters);
    const result = await buildDataset(filterState.appliedFilters, aggregateColumns);
    await query("COMMIT");
    return { ...result, ...filterState, recipeError: compiled.recipeError };
  } catch (error) {
    try { await query("ROLLBACK"); } catch { /* recovery owns a failed rollback */ }
    ({ sourceName, sourceColumns, rowCount, columns, columnTypes, aggregateColumns, qualityCache, currentRecipe, stepStates, activePreparedId } = previousState);
    throw error;
  }
}

function registerPreparedCopy(preparedId, sourcePreparedId, recipe = null) {
  const source = preparedRegistry.get(sourcePreparedId);
  if (!source) throw new Error("Preparation sumber untuk duplikasi tidak tersedia.");
  preparedRegistry.set(preparedId, {
    ...source,
    id: preparedId,
    recipe: cloneRecipe(recipe ?? source.recipe),
  });
  return { preparedId, sourceId: source.sourceId };
}

function unregisterPrepared(preparedId) {
  const prepared = preparedRegistry.get(preparedId);
  if (!prepared) return { preparedId, removed: false };
  preparedRegistry.delete(preparedId);
  const sourceStillUsed = [...preparedRegistry.values()].some((entry) => entry.sourceId === prepared.sourceId);
  if (!sourceStillUsed) sourceRegistry.delete(prepared.sourceId);
  if (activePreparedId === preparedId) activePreparedId = null;
  return { preparedId, sourceId: prepared.sourceId, removed: true, sourceRemoved: !sourceStillUsed };
}

async function materializeComposePrepared(graph, nodeId, identifiers) {
  const relation = await compileGraphNode(graph, nodeId);
  const described = relation.schema?.length ? relation.schema : await describeRelation(relation.sql);
  const schema = described.filter((column) => column.name !== INTERNAL_ROW_ID);
  if (!schema.length) throw new Error("Hasil Compose tidak memiliki kolom untuk disiapkan.");
  const sourceId = identifiers.sourceId;
  const preparedId = identifiers.preparedId;
  const filename = identifiers.filename;
  const tableName = `source_compose_${String(sourceId).replaceAll(/[^a-zA-Z0-9_]/g, "_")}`;
  const previousSourceEntry = sourceRegistry.get(sourceId);
  const previousPreparedEntry = preparedRegistry.get(preparedId);
  const projection = schema.map((column) => quoteIdentifier(column.name)).join(", ");
  await query("BEGIN TRANSACTION");
  try {
    await query(`CREATE OR REPLACE TABLE ${quoteIdentifier(tableName)} AS
      SELECT ROW_NUMBER() OVER () AS ${quoteIdentifier(INTERNAL_ROW_ID)}, ${projection}
      FROM (${relation.sql}) AS compose_materialized`);
    const count = await query(`SELECT COUNT(*) AS row_count FROM ${quoteIdentifier(tableName)}`);
    const sourceColumns = schema.map((column) => column.name);
    sourceRegistry.set(sourceId, { id: sourceId, tableName, filename, sourceColumns });
    preparedRegistry.set(preparedId, { id: preparedId, sourceId, recipe: [], sourceColumns, filename });
    await query("COMMIT");
    return { sourceId, preparedId, schema, rowCount: Number(count[0]?.row_count ?? 0) };
  } catch (error) {
    try { await query("ROLLBACK"); } catch { /* recovery owns a failed rollback */ }
    if (previousSourceEntry) sourceRegistry.set(sourceId, previousSourceEntry);
    else sourceRegistry.delete(sourceId);
    if (previousPreparedEntry) preparedRegistry.set(preparedId, previousPreparedEntry);
    else preparedRegistry.delete(preparedId);
    throw error;
  }
}

async function describeRelation(sql) {
  const rows = await query(`DESCRIBE SELECT * FROM (${sql}) AS relation_schema`);
  return rows.map((row) => ({ name: row.column_name, type: row.column_type }));
}

async function preparedRelation(preparedId, graphPrepared) {
  const prepared = preparedRegistry.get(preparedId);
  const source = prepared ? sourceRegistry.get(prepared.sourceId) : null;
  if (!prepared || !source) throw new Error(`Source is unavailable in this session for ${graphPrepared?.name ?? preparedId}.`);
  const recipe = recipeForExecution(graphPrepared, prepared.recipe);
  const compiled = compileRecipe(recipe, prepared.sourceColumns, source.tableName);
  const schema = await describeRelation(compiled.sql);
  return { sql: compiled.sql, schema };
}

async function compileGraphNode(graph, nodeId, cache = new Map(), visiting = new Set()) {
  if (cache.has(nodeId)) return cache.get(nodeId);
  if (visiting.has(nodeId)) throw new Error("Flow tidak boleh memiliki siklus.");
  visiting.add(nodeId);
  const graphPrepared = graph.preparedInputs?.find((item) => item.id === nodeId);
  if (graphPrepared) {
    const sourceAsset = graph.sourceAssets?.find((item) => item.id === graphPrepared.sourceAssetId);
    if (sourceAsset?.status === "unlinked") throw new Error(`Source is unavailable in this session for ${graphPrepared.name ?? nodeId}.`);
    const relation = await preparedRelation(nodeId, graphPrepared);
    cache.set(nodeId, relation);
    visiting.delete(nodeId);
    return relation;
  }
  const node = graph.composeNodes?.find((item) => item.id === nodeId);
  if (!node) throw new Error(`Node ${nodeId} tidak tersedia.`);
  const inputs = [];
  for (const inputId of node.inputIds ?? []) inputs.push(await compileGraphNode(graph, inputId, cache, visiting));
  const relation = compileComposeOperation(node.kind, inputs, node.config ?? {});
  cache.set(nodeId, relation);
  visiting.delete(nodeId);
  return relation;
}

async function previewComposeNode(graph, nodeId, options = {}) {
  const relation = await compileGraphNode(graph, nodeId);
  const schema = relation.schema?.length ? relation.schema : await describeRelation(relation.sql);
  const visibleSchema = schema.filter((column) => column.name !== INTERNAL_ROW_ID);
  const includeRows = options.includeRows !== false;
  const requestedColumns = includeRows
    ? (Array.isArray(options.columns) && options.columns.length
      ? options.columns.map(String)
      : visibleSchema.slice(0, WEBMCP_PREVIEW_COLUMN_LIMIT).map((column) => column.name))
    : [];
  if (requestedColumns.length > WEBMCP_PREVIEW_COLUMN_LIMIT) throw new Error(`A maximum of ${WEBMCP_PREVIEW_COLUMN_LIMIT} columns can be returned per request.`);
  const schemaByName = new Map(visibleSchema.map((column) => [column.name, column]));
  const selectedSchema = requestedColumns.map((column) => {
    const definition = schemaByName.get(column);
    if (!definition) throw new Error(`Column not found on Compose node ${nodeId}: ${column}`);
    return definition;
  });
  const page = normalizedPage(options.offset, options.limit);
  const projection = selectedSchema.map((column) => {
    const identifier = quoteIdentifier(column.name);
    return /DATE|TIME/.test(String(column.type).toUpperCase()) ? `CAST(${identifier} AS VARCHAR) AS ${identifier}` : identifier;
  }).join(", ");
  const count = await query(`SELECT COUNT(*) AS row_count FROM (${relation.sql}) AS compose_count`);
  const preview = includeRows
    ? await query(`SELECT ${projection} FROM (${relation.sql}) AS compose_preview LIMIT ${page.limit} OFFSET ${page.offset}`)
    : [];
  return {
    nodeId,
    columns: selectedSchema.map((column) => column.name),
    totalColumnCount: visibleSchema.length,
    columnsTruncated: selectedSchema.length < visibleSchema.length,
    columnTypes: Object.fromEntries(selectedSchema.map((column) => [column.name, column.type])),
    schema: visibleSchema,
    rowCount: Number(count[0]?.row_count ?? 0),
    previewRowCount: preview.length,
    offset: page.offset,
    limit: page.limit,
    preview,
  };
}

async function exportComposeNode(graph, nodeId, format) {
  const result = await previewComposeNode(graph, nodeId, { includeRows: false });
  if (result.rowCount > DATA_LIMITS.maxExportRows) throw new Error(`Ekspor dibatasi ${DATA_LIMITS.maxExportRows.toLocaleString("id-ID")} baris.`);
  const relation = await compileGraphNode(graph, nodeId);
  const exportColumns = result.schema.map((column) => column.name);
  const rows = await query(`SELECT ${exportColumns.map(quoteIdentifier).join(", ")} FROM (${relation.sql}) AS compose_export`);
  const node = graph.preparedInputs?.find((item) => item.id === nodeId) ?? graph.composeNodes?.find((item) => item.id === nodeId);
  return encodeSpreadsheetExport(rows, exportColumns, format, sanitizeExportBaseName(node?.name, "tabulaflow-compose"), "Composed Data");
}

async function profileJoinColumns(relation, requestedColumns) {
  const names = [...new Set(requestedColumns)].filter(Boolean);
  if (!names.length) return new Map();
  const expressions = ["COUNT(*) AS total_rows", ...names.flatMap((name, index) => {
    const identifier = quoteIdentifier(name);
    return [
      `COUNT(*) FILTER (WHERE ${identifier} IS NULL OR TRIM(CAST(${identifier} AS VARCHAR)) = '') AS null_${index}`,
      `COUNT(DISTINCT CAST(${identifier} AS VARCHAR)) AS distinct_${index}`,
    ];
  })];
  const row = (await query(`SELECT ${expressions.join(", ")} FROM (${relation.sql}) AS join_profile`))[0] ?? {};
  const totalRows = Number(row.total_rows ?? 0);
  return new Map(names.map((name, index) => {
    const missing = Number(row[`null_${index}`] ?? 0);
    const nonMissing = Math.max(0, totalRows - missing);
    const distinct = Number(row[`distinct_${index}`] ?? 0);
    return [name, {
      nullRatio: totalRows ? missing / totalRows : 1,
      uniquenessRatio: nonMissing ? distinct / nonMissing : 0,
    }];
  }));
}

async function composeConnectionOptions(graph, nodeId) {
  const graphNodes = [
    ...(graph.preparedInputs ?? []).map((item) => ({ ...item, kind: "dataset" })),
    ...(graph.composeNodes ?? []),
  ];
  const sourceNode = graphNodes.find((item) => item.id === nodeId);
  if (!sourceNode) throw new Error(`Compose node not found: ${nodeId}`);
  const sourceRelation = await compileGraphNode(graph, nodeId);
  const sourceSchema = (sourceRelation.schema?.length ? sourceRelation.schema : await describeRelation(sourceRelation.sql))
    .filter((column) => column.name !== INTERNAL_ROW_ID);
  const preliminaryTargets = [];
  const profiledSourceColumns = new Set();

  for (const target of graphNodes.filter((item) => item.id !== nodeId)) {
    try {
      const targetRelation = await compileGraphNode(graph, target.id);
      const targetSchema = (targetRelation.schema?.length ? targetRelation.schema : await describeRelation(targetRelation.sql))
        .filter((column) => column.name !== INTERNAL_ROW_ID);
      const candidateSet = buildJoinKeyCandidates(sourceSchema, targetSchema, { limit: 32 });
      candidateSet.candidates.forEach((candidate) => profiledSourceColumns.add(candidate.left));
      preliminaryTargets.push({ target, targetRelation, targetSchema, candidateSet });
    } catch (error) {
      preliminaryTargets.push({ target, error: error instanceof Error ? error.message : "Target could not be inspected." });
    }
  }

  const sourceStats = await profileJoinColumns(sourceRelation, [...profiledSourceColumns]);
  const targets = [];
  for (const entry of preliminaryTargets) {
    if (entry.error) {
      targets.push({ targetNodeId: entry.target.id, targetName: entry.target.name, operations: [], appendCompatible: false, appendConflicts: [], keyPairCount: 0, compatibleKeyPairCount: 0, keyPairsTruncated: false, keyPairs: [], diagnostic: entry.error });
      continue;
    }
    const targetStats = await profileJoinColumns(entry.targetRelation, entry.candidateSet.candidates.map((candidate) => candidate.right));
    const keyPairs = rankJoinKeyCandidates(entry.candidateSet.candidates, sourceStats, targetStats, { limit: 12 })
      .map((pair) => ({ ...pair, recommended: pair.exactName || pair.score >= 0.55 }));
    const targetTypes = new Map(entry.targetSchema.map(({ name, type }) => [name, String(type).toUpperCase().replace(/\s+/g, " ").trim()]));
    const appendConflicts = sourceSchema.filter(({ name, type }) => targetTypes.has(name) && targetTypes.get(name) !== String(type).toUpperCase().replace(/\s+/g, " ").trim());
    const appendCompatible = appendConflicts.length === 0;
    targets.push({
      targetNodeId: entry.target.id,
      targetName: entry.target.name,
      operations: [...(appendCompatible ? ["append"] : []), ...(keyPairs.length ? ["join", "difference"] : [])],
      appendCompatible,
      appendConflicts: appendConflicts.map(({ name, type }) => ({ column: name, sourceType: type, targetType: targetTypes.get(name) })),
      keyPairCount: keyPairs.length,
      compatibleKeyPairCount: entry.candidateSet.compatiblePairCount,
      keyPairsTruncated: entry.candidateSet.compatiblePairCount > keyPairs.length,
      ranking: ["exact-name", "normalized-name-similarity", "uniqueness", "null-ratio"],
      keyPairs,
    });
  }
  return { nodeId, targets };
}

function reconcileWorkerFilters(filters = {}) {
  const appliedFilters = {};
  const removedFilterColumns = [];
  for (const [column, selection] of Object.entries(filters)) {
    if (columnTypes.has(column)) appliedFilters[column] = selection;
    else removedFilterColumns.push(column);
  }
  return { appliedFilters, removedFilterColumns };
}

async function applyRecipe(recipe, filters = {}, requestedAggregateColumns, preparedId = activePreparedId) {
  if (preparedId && preparedId !== activePreparedId) await activatePrepared(preparedId);
  const compiled = compileRecipeSafely(recipe, sourceColumns);
  const previousState = {
    rowCount,
    columns,
    columnTypes,
    aggregateColumns,
    qualityCache,
    currentRecipe,
    stepStates,
  };
  let transactionStarted = false;
  try {
    await query("BEGIN TRANSACTION");
    transactionStarted = true;
    await query(`CREATE OR REPLACE TEMP VIEW ${WORKING_VIEW} AS ${compiled.sql}`);
    await refreshMetadata();
    currentRecipe = recipe.map((step) => ({ ...step, params: { ...step.params } }));
    stepStates = compiled.stepStates;
    aggregateColumns = normalizeAggregateColumns(requestedAggregateColumns ?? aggregateColumns);
    qualityCache = null;
    const filterState = reconcileWorkerFilters(filters);
    const result = await buildDataset(filterState.appliedFilters, aggregateColumns);
    await query("COMMIT");
    if (activePreparedId && preparedRegistry.has(activePreparedId)) {
      preparedRegistry.set(activePreparedId, { ...preparedRegistry.get(activePreparedId), recipe: cloneRecipe(recipe) });
    }
    return { ...result, ...filterState, recipeError: compiled.recipeError };
  } catch (error) {
    if (transactionStarted) {
      try {
        await query("ROLLBACK");
      } catch {
        // Preserve the original recipe error; worker recovery handles a failed rollback.
      }
    }
    ({ rowCount, columns, columnTypes, aggregateColumns, qualityCache, currentRecipe, stepStates } = previousState);
    throw error;
  }
}

async function previewRecipe(recipe, stepIndex, options = {}) {
  const lastIndex = Math.min(Math.max(Number(stepIndex), 0), recipe.length - 1);
  const selectedRecipe = recipe.slice(0, lastIndex + 1);
  const compiled = compileRecipe(selectedRecipe, sourceColumns);
  const description = await query(`DESCRIBE SELECT * FROM (${compiled.sql}) AS recipe_preview_schema`);
  const previewTypes = new Map(description.map((item) => [item.column_name, item.column_type]));
  const includeRows = options.includeRows !== false;
  const requestedColumns = includeRows && Array.isArray(options.columns) && options.columns.length
    ? options.columns.map(String)
    : includeRows ? compiled.columns : [];
  if (options.columns?.length > WEBMCP_DRY_RUN_PREVIEW_COLUMN_LIMIT) throw new Error(`A dry-run preview can return at most ${WEBMCP_DRY_RUN_PREVIEW_COLUMN_LIMIT} columns.`);
  const unknownColumns = requestedColumns.filter((column) => !previewTypes.has(column));
  if (unknownColumns.length) throw new Error(`Recipe preview columns not found: ${unknownColumns.join(", ")}`);
  const projection = requestedColumns.map((column) => {
    const identifier = quoteIdentifier(column);
    const type = String(previewTypes.get(column)).toUpperCase();
    return type.includes("DATE") || type.includes("TIME")
      ? `CAST(${identifier} AS VARCHAR) AS ${identifier}`
      : identifier;
  }).join(", ");
  const countRows = await query(`SELECT COUNT(*) AS preview_count FROM (${compiled.sql}) AS recipe_preview`);
  const previewLimit = options.limit === undefined
    ? 100
    : Math.min(WEBMCP_DRY_RUN_PREVIEW_ROW_LIMIT, Math.max(1, Number(options.limit) || WEBMCP_DRY_RUN_PREVIEW_ROW_LIMIT));
  const preview = includeRows ? await query(`SELECT ${projection} FROM (${compiled.sql}) AS recipe_preview LIMIT ${previewLimit}`) : [];
  return {
    stepIndex: lastIndex,
    stepId: selectedRecipe.at(-1)?.id ?? null,
    schema: compiled.columns.map((name) => ({ name, type: previewTypes.get(name) ?? null })),
    columns: requestedColumns,
    rowCount: Number(countRows[0]?.preview_count ?? 0),
    previewRowCount: preview.length,
    preview,
  };
}

async function handleRequest(type, payload) {
  if (type === "initialize") return initializeDuckDB().then(() => ({ engineVersion }));
  if (type === "load-file") {
    reportProgress("read_file", 5);
    const rows = normalizeEmptyValues(await parseDataFile(payload.file));
    reportProgress("normalize_data", 20);
    return loadRows(rows, payload.file.name, payload);
  }
  if (type === "inspect-file") {
    const rows = normalizeEmptyValues(await parseDataFile(payload.file));
    return { sourceColumns: collectSourceColumns(rows) };
  }
  if (type === "load-demo") return loadRows(makeDemoRows(), "penjualan_agustus.xlsx", payload);
  if (type === "activate-prepared") return activatePrepared(payload.preparedId, payload.filters, payload.aggregateColumns);
  if (type === "register-prepared-copy") return registerPreparedCopy(payload.preparedId, payload.sourcePreparedId, payload.recipe);
  if (type === "unregister-prepared") return unregisterPrepared(payload.preparedId);
  if (type === "materialize-compose-prepared") return materializeComposePrepared(payload.graph, payload.nodeId, payload.identifiers);
  if (type === "filter") return buildDataset(payload.filters, payload.aggregateColumns);
  if (type === "search-aggregate") return searchAggregate(payload.column, payload.query, payload.filters, payload.offset, payload.limit);
  if (type === "prepare-preview") return previewPreparedData(payload.filters, payload.columns, payload.offset, payload.limit);
  if (type === "data-profile") return profileDataColumns(payload.columns);
  if (type === "export") return exportRows(payload.format, payload.filters, payload.baseName);
  if (type === "apply-recipe") return applyRecipe(payload.recipe, payload.filters, payload.aggregateColumns, payload.preparedId);
  if (type === "preview-recipe") return previewRecipe(payload.recipe, payload.stepIndex, payload.options);
  if (type === "compose-preview") return previewComposeNode(payload.graph, payload.nodeId, payload.options);
  if (type === "compose-export") return exportComposeNode(payload.graph, payload.nodeId, payload.format);
  if (type === "compose-connection-options") return composeConnectionOptions(payload.graph, payload.nodeId);
  throw new Error("Operasi worker tidak dikenal.");
}

self.addEventListener("message", (event) => {
  const { requestId, type, payload = {} } = event.data;
  requestQueue = requestQueue.then(async () => {
    activeRequestId = requestId;
    try {
      const result = await handleRequest(type, payload);
      self.postMessage({ requestId, ok: true, result }, type === "export" || type === "compose-export" ? [result.bytes] : []);
    } finally {
      activeRequestId = null;
    }
  }).catch((error) => {
    activeRequestId = null;
    self.postMessage({
      requestId,
      ok: false,
      error: {
        code: error?.code ?? "WORKER_OPERATION_FAILED",
        message: error instanceof Error ? error.message : "Pengolahan data DuckDB gagal.",
        stepIndex: Number.isInteger(error?.stepIndex) ? error.stepIndex : null,
        stepId: error?.stepId ?? null,
      },
    });
  });
});
