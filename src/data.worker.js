import * as duckdb from "@duckdb/duckdb-wasm";
import { DUCKDB_BUNDLES } from "@duckdb-bundles";
import Papa from "papaparse";
import { DATA_LIMITS, makeDemoRows, normalizeEmptyValues, parseDataFile, prepareSpreadsheetData } from "./data.js";
import { compileRecipe, compileRecipeSafely, INTERNAL_ROW_ID } from "./transformations.js";

const AGGREGATE_LIMIT = 100;
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
        const bundle = await duckdb.selectBundle(DUCKDB_BUNDLES);
        engineWorker = await duckdb.createWorker(bundle.mainWorker);
        database = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), engineWorker);
        await database.instantiate(bundle.mainModule, bundle.pthreadWorker);
        engineVersion = await database.getVersion();
        connection = await database.connect();
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

async function refreshMetadata() {
  const description = await query(`DESCRIBE ${WORKING_VIEW}`);
  const visibleDescription = description.filter((item) => item.column_name !== INTERNAL_ROW_ID);
  columns = visibleDescription.map((item) => item.column_name);
  columnTypes = new Map(visibleDescription.map((item) => [item.column_name, item.column_type]));
  const counts = await query(`SELECT COUNT(*) AS row_count FROM ${WORKING_VIEW}`);
  rowCount = Number(counts[0]?.row_count ?? 0);
  if (!rowCount) throw new Error("File tidak memiliki baris data.");
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

async function loadRows(rows, filename) {
  await initializeDuckDB();
  const nextDatasetId = datasetId + 1;
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
  };

  await database.registerFileText(importPath, JSON.stringify(rows));
  let transactionStarted = false;
  try {
    await query("BEGIN TRANSACTION");
    transactionStarted = true;
    await query(`CREATE OR REPLACE TABLE ${SOURCE_TABLE} AS
      SELECT ROW_NUMBER() OVER () AS ${quoteIdentifier(INTERNAL_ROW_ID)}, *
      FROM read_json_auto(
        '${importPath}',
        format = 'array',
        union_by_name = true,
        map_inference_threshold = -1,
        field_appearance_threshold = 0.0
      )`);
    await query(`CREATE OR REPLACE TEMP VIEW ${WORKING_VIEW} AS SELECT * FROM ${SOURCE_TABLE}`);
    await refreshMetadata();
    sourceColumns = [...columns];
    aggregateColumns = normalizeAggregateColumns();
    datasetId = nextDatasetId;
    sourceName = filename;
    qualityCache = null;
    currentRecipe = [];
    stepStates = [];
    const result = await buildDataset();
    await query("COMMIT");
    return result;
  } catch (error) {
    if (transactionStarted) {
      try {
        await query("ROLLBACK");
      } catch {
        // Preserve the original import error; a failed rollback will require worker recovery.
      }
    }
    ({ datasetId, sourceName, rowCount, columns, sourceColumns, columnTypes, aggregateColumns, qualityCache, currentRecipe, stepStates } = previousState);
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
  for (const column of profiledColumns) {
    const identifier = quoteIdentifier(column);
    const type = columnTypes.get(column);
    const missingResult = await query(`SELECT COUNT(*) FILTER (WHERE ${identifier} IS NULL OR TRIM(CAST(${identifier} AS VARCHAR)) = '') AS missing FROM ${WORKING_VIEW}`);
    const missing = Number(missingResult[0]?.missing ?? 0);
    let mixed = false;
    let types = [typeToUi(type)];
    const normalizedType = String(type).toUpperCase();
    if (normalizedType.includes("VARCHAR")) {
      const profile = (await query(`
        WITH values AS (SELECT NULLIF(TRIM(${identifier}), '') AS value FROM ${WORKING_VIEW})
        SELECT
          COUNT(*) FILTER (WHERE value IS NOT NULL AND TRY_CAST(value AS DOUBLE) IS NOT NULL) AS numeric_count,
          COUNT(*) FILTER (WHERE value IS NOT NULL AND LOWER(value) IN ('true', 'false')) AS boolean_count,
          COUNT(*) FILTER (WHERE value IS NOT NULL AND TRY_CAST(value AS DOUBLE) IS NULL AND LOWER(value) NOT IN ('true', 'false') AND TRY_CAST(value AS DATE) IS NOT NULL) AS date_count,
          COUNT(*) FILTER (WHERE value IS NOT NULL AND TRY_CAST(value AS DOUBLE) IS NULL AND LOWER(value) NOT IN ('true', 'false') AND TRY_CAST(value AS DATE) IS NULL) AS text_count
        FROM values
      `))[0];
      const categories = [
        ["angka", Number(profile?.numeric_count ?? 0)],
        ["boolean", Number(profile?.boolean_count ?? 0)],
        ["tanggal", Number(profile?.date_count ?? 0)],
        ["teks", Number(profile?.text_count ?? 0)],
      ].filter(([, count]) => count > 0);
      mixed = categories.length > 1;
      types = categories.map(([name]) => name);
    } else if (normalizedType.includes("JSON")) {
      const jsonTypes = await query(`
        SELECT JSON_TYPE(${identifier}) AS source_type, COUNT(*) AS count
        FROM ${WORKING_VIEW}
        WHERE ${identifier} IS NOT NULL
        GROUP BY source_type
      `);
      const categories = new Set(jsonTypes.map((item) => {
        const sourceType = String(item.source_type).toUpperCase();
        if (["BIGINT", "UBIGINT", "DOUBLE", "DECIMAL"].includes(sourceType)) return "angka";
        if (sourceType === "BOOLEAN") return "boolean";
        return "teks";
      }));
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
  }
  return {
    emptyCells,
    mixedColumns,
    affectedColumns,
    profiledColumnCount: profiledColumns.length,
    totalColumnCount: columns.length,
  };
}

async function aggregateForColumn(column, filters) {
  const identifier = quoteIdentifier(column);
  const type = columnTypes.get(column);
  const where = buildWhere(filters, column);
  const rows = await query(`
    WITH grouped AS (
      SELECT CAST(${identifier} AS VARCHAR) AS value_text, COUNT(*) AS count
      FROM ${WORKING_VIEW} ${where.sql}
      GROUP BY ${identifier}
    )
    SELECT value_text, count, COUNT(*) OVER () AS distinct_count
    FROM grouped
    ORDER BY count DESC, value_text ASC NULLS FIRST
    LIMIT ${AGGREGATE_LIMIT}
  `, where.parameters);
  const values = rows.map((row) => aggregateItem(row, type));
  const distinctCount = Number(rows[0]?.distinct_count ?? 0);
  const selected = filters[column];
  if (selected && !values.some((item) => item.key === selected.key)) {
    const selectedWhere = buildWhere(filters);
    const selectedRows = await query(`
      SELECT CAST(${identifier} AS VARCHAR) AS value_text, COUNT(*) AS count
      FROM ${WORKING_VIEW} ${selectedWhere.sql}
      GROUP BY ${identifier}
    `, selectedWhere.parameters);
    if (selectedRows[0]) values.push(aggregateItem(selectedRows[0], type));
  }
  return { column, type: typeToUi(type), distinctCount, values };
}

async function buildDataset(filters = {}, requestedAggregateColumns) {
  aggregateColumns = normalizeAggregateColumns(requestedAggregateColumns);
  if (!qualityCache) qualityCache = await analyzeQuality();
  const where = buildWhere(filters);
  const countRows = await query(`SELECT COUNT(*) AS filtered_count FROM ${WORKING_VIEW} ${where.sql}`, where.parameters);
  const preview = await query(`SELECT ${displayProjection()} FROM ${WORKING_VIEW} ${where.sql} LIMIT 100`, where.parameters);
  const aggregates = [];
  for (const column of aggregateColumns) aggregates.push(await aggregateForColumn(column, filters));
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
    engine: { name: "DuckDB-Wasm", version: engineVersion },
  };
}

async function searchAggregate(column, searchText, filters) {
  if (!columnTypes.has(column)) return { values: [], matchCount: 0 };
  const identifier = quoteIdentifier(column);
  const type = columnTypes.get(column);
  const where = buildWhere(filters, column);
  const searchClause = where.sql ? `${where.sql} AND` : "WHERE";
  const normalizedSearch = String(searchText ?? "").trim();
  const nullSearch = normalizedSearch.replaceAll("(", "").replaceAll(")", "").toLocaleLowerCase();
  const includesNull = ["null", "kosong"].some((token) => token.includes(nullSearch));
  const escapedSearch = normalizedSearch.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
  const rows = await query(`
    WITH grouped AS (
      SELECT CAST(${identifier} AS VARCHAR) AS value_text, COUNT(*) AS count
      FROM ${WORKING_VIEW}
      ${searchClause} (LOWER(CAST(${identifier} AS VARCHAR)) LIKE LOWER(?) ESCAPE '\\'${includesNull ? ` OR ${identifier} IS NULL` : ""})
      GROUP BY ${identifier}
    )
    SELECT value_text, count, COUNT(*) OVER () AS match_count
    FROM grouped
    ORDER BY count DESC, value_text ASC NULLS FIRST
    LIMIT ${AGGREGATE_LIMIT}
  `, [...where.parameters, `%${escapedSearch}%`]);
  return { values: rows.map((row) => aggregateItem(row, type)), matchCount: Number(rows[0]?.match_count ?? 0) };
}

async function exportRows(format, filters) {
  const where = buildWhere(filters);
  const countRows = await query(`SELECT COUNT(*) AS export_count FROM ${WORKING_VIEW} ${where.sql}`, where.parameters);
  const exportCount = Number(countRows[0]?.export_count ?? 0);
  if (exportCount > DATA_LIMITS.maxExportRows) {
    throw new Error(`Ekspor dibatasi ${DATA_LIMITS.maxExportRows.toLocaleString("id-ID")} baris. Persempit data dengan filter.`);
  }
  const filteredRows = await query(`SELECT ${displayProjection()} FROM ${WORKING_VIEW} ${where.sql}`, where.parameters);
  const spreadsheet = prepareSpreadsheetData(filteredRows, columns);
  const baseName = sourceName.replace(/\.[^.]+$/, "") || "tabulaflow-data";
  if (format === "csv") {
    const text = `\uFEFF${Papa.unparse({ fields: spreadsheet.headers, data: spreadsheet.data })}`;
    return { bytes: new TextEncoder().encode(text).buffer, filename: `${baseName}-filtered.csv`, mime: "text/csv;charset=utf-8" };
  }
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([spreadsheet.headers, ...spreadsheet.data]), "Filtered Data");
  return {
    bytes: XLSX.write(workbook, { bookType: "xlsx", type: "array" }),
    filename: `${baseName}-filtered.xlsx`,
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
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

async function applyRecipe(recipe, filters = {}, requestedAggregateColumns) {
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

async function previewRecipe(recipe, stepIndex) {
  const lastIndex = Math.min(Math.max(Number(stepIndex), 0), recipe.length - 1);
  const selectedRecipe = recipe.slice(0, lastIndex + 1);
  const compiled = compileRecipe(selectedRecipe, sourceColumns);
  const description = await query(`DESCRIBE SELECT * FROM (${compiled.sql}) AS recipe_preview_schema`);
  const previewTypes = new Map(description.map((item) => [item.column_name, item.column_type]));
  const projection = compiled.columns.map((column) => {
    const identifier = quoteIdentifier(column);
    const type = String(previewTypes.get(column)).toUpperCase();
    return type.includes("DATE") || type.includes("TIME")
      ? `CAST(${identifier} AS VARCHAR) AS ${identifier}`
      : identifier;
  }).join(", ");
  const countRows = await query(`SELECT COUNT(*) AS preview_count FROM (${compiled.sql}) AS recipe_preview`);
  const preview = await query(`SELECT ${projection} FROM (${compiled.sql}) AS recipe_preview LIMIT 100`);
  return {
    stepIndex: lastIndex,
    stepId: selectedRecipe.at(-1)?.id ?? null,
    columns: compiled.columns,
    rowCount: Number(countRows[0]?.preview_count ?? 0),
    preview,
  };
}

async function handleRequest(type, payload) {
  if (type === "load-file") return loadRows(normalizeEmptyValues(await parseDataFile(payload.file)), payload.file.name);
  if (type === "load-demo") return loadRows(makeDemoRows(), "penjualan_agustus.xlsx");
  if (type === "filter") return buildDataset(payload.filters, payload.aggregateColumns);
  if (type === "search-aggregate") return searchAggregate(payload.column, payload.query, payload.filters);
  if (type === "export") return exportRows(payload.format, payload.filters);
  if (type === "apply-recipe") return applyRecipe(payload.recipe, payload.filters, payload.aggregateColumns);
  if (type === "preview-recipe") return previewRecipe(payload.recipe, payload.stepIndex);
  throw new Error("Operasi worker tidak dikenal.");
}

self.addEventListener("message", (event) => {
  const { requestId, type, payload = {} } = event.data;
  requestQueue = requestQueue.then(async () => {
    const result = await handleRequest(type, payload);
    self.postMessage({ requestId, ok: true, result }, type === "export" ? [result.bytes] : []);
  }).catch((error) => {
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
