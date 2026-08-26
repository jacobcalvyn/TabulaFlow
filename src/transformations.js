const INTERNAL_ROW_ID = "__tf_row_id";

export const TRANSFORMATION_TYPES = Object.freeze([
  { type: "rename-column", group: "Clean", label: "Ganti nama kolom" },
  { type: "change-type", group: "Clean", label: "Ubah tipe" },
  { type: "trim", group: "Clean", label: "Rapikan spasi" },
  { type: "replace-value", group: "Clean", label: "Ganti nilai" },
  { type: "fill-empty", group: "Clean", label: "Isi nilai kosong" },
  { type: "remove-empty-rows", group: "Clean", label: "Hapus baris kosong" },
  { type: "remove-duplicates", group: "Clean", label: "Hapus duplikat" },
  { type: "standardize-case", group: "Clean", label: "Seragamkan huruf" },
  { type: "parse-date", group: "Clean", label: "Baca tanggal" },
  { type: "select-columns", group: "Build", label: "Pilih kolom" },
  { type: "remove-columns", group: "Build", label: "Hapus kolom" },
  { type: "sort", group: "Build", label: "Urutkan baris" },
  { type: "calculated-column", group: "Build", label: "Kolom perhitungan" },
  { type: "conditional-column", group: "Build", label: "Kolom bersyarat" },
  { type: "group-aggregate", group: "Build", label: "Kelompokkan & agregasi" },
]);

const CREATABLE_TRANSFORMATION_IDS = new Set([
  "trim",
  "standardize-case",
  "parse-date",
  "remove-columns",
]);

export const CREATABLE_TRANSFORMATION_TYPES = Object.freeze(
  TRANSFORMATION_TYPES.filter((item) => CREATABLE_TRANSFORMATION_IDS.has(item.type)),
);

const TYPE_LABELS = new Map(TRANSFORMATION_TYPES.map((item) => [item.type, item.label]));
const CAST_TYPES = new Set(["VARCHAR", "BIGINT", "DOUBLE", "BOOLEAN", "DATE", "TIMESTAMP"]);
const CASE_MODES = new Set(["lower", "upper", "title"]);
const CALCULATION_OPERATORS = new Set(["+", "-", "*", "/"]);
const COMPARISON_OPERATORS = new Set(["=", "!=", ">", ">=", "<", "<="]);
const AGGREGATE_FUNCTIONS = new Set(["COUNT", "SUM", "AVG", "MIN", "MAX"]);

export function createStep(type, params = {}) {
  if (!TYPE_LABELS.has(type)) throw new Error("Tipe langkah tidak dikenal.");
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `step-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type,
    version: 1,
    enabled: true,
    params,
  };
}

export function getStepLabel(type) {
  return TYPE_LABELS.get(type) ?? type;
}

export function quoteIdentifier(identifier) {
  return `"${String(identifier).replaceAll('"', '""')}"`;
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Nilai angka step tidak valid.");
    return String(value);
  }
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function normalizeColumns(value) {
  const values = Array.isArray(value) ? value : String(value ?? "").split(",");
  return [...new Set(values.map((item) => String(item).trim()).filter(Boolean))];
}

function requireColumn(columns, column) {
  if (!columns.includes(column)) throw new Error(`Kolom "${column}" tidak tersedia pada langkah ini.`);
  return quoteIdentifier(column);
}

function requireOutputName(columns, name, replacing = null) {
  const normalized = String(name ?? "").trim();
  if (!normalized) throw new Error("Nama kolom hasil wajib diisi.");
  if (normalized === INTERNAL_ROW_ID) throw new Error("Nama kolom hasil menggunakan nama internal.");
  const collision = columns.find((column) => column !== replacing && column.toLocaleLowerCase("id-ID") === normalized.toLocaleLowerCase("id-ID"));
  if (collision) throw new Error(`Kolom "${normalized}" sudah ada.`);
  return normalized;
}

function requireColumns(columns, requested, minimum = 1) {
  const selected = normalizeColumns(requested);
  if (selected.length < minimum) throw new Error("Pilih minimal satu kolom.");
  selected.forEach((column) => requireColumn(columns, column));
  return selected;
}

function stepInputName(index) {
  return index === 0 ? "source_data" : `step_${index}`;
}

function compileEnabledStep(step, input, columns) {
  const params = step.params ?? {};
  const source = quoteIdentifier(input);
  let nextColumns = [...columns];
  let sql;

  if (step.type === "rename-column") {
    const column = String(params.column ?? "");
    const identifier = requireColumn(columns, column);
    const nextName = requireOutputName(columns, params.newName, column);
    sql = `SELECT * RENAME (${identifier} AS ${quoteIdentifier(nextName)}) FROM ${source}`;
    nextColumns = columns.map((item) => item === column ? nextName : item);
  } else if (step.type === "change-type") {
    const identifier = requireColumn(columns, params.column);
    const targetType = String(params.targetType ?? "").toUpperCase();
    if (!CAST_TYPES.has(targetType)) throw new Error("Tipe tujuan tidak didukung.");
    sql = `SELECT * REPLACE (TRY_CAST(${identifier} AS ${targetType}) AS ${identifier}) FROM ${source}`;
  } else if (step.type === "trim") {
    const identifier = requireColumn(columns, params.column);
    const functionName = params.mode === "left" ? "LTRIM" : params.mode === "right" ? "RTRIM" : "TRIM";
    sql = `SELECT * REPLACE (${functionName}(CAST(${identifier} AS VARCHAR)) AS ${identifier}) FROM ${source}`;
  } else if (step.type === "replace-value") {
    const identifier = requireColumn(columns, params.column);
    sql = `SELECT * REPLACE (CASE WHEN ${identifier} IS NOT DISTINCT FROM ${sqlLiteral(params.from)} THEN ${sqlLiteral(params.to)} ELSE ${identifier} END AS ${identifier}) FROM ${source}`;
  } else if (step.type === "fill-empty") {
    const identifier = requireColumn(columns, params.column);
    sql = `SELECT * REPLACE (CASE WHEN ${identifier} IS NULL OR TRIM(CAST(${identifier} AS VARCHAR)) = '' THEN ${sqlLiteral(params.value)} ELSE ${identifier} END AS ${identifier}) FROM ${source}`;
  } else if (step.type === "remove-empty-rows") {
    const identifier = requireColumn(columns, params.column);
    sql = `SELECT * FROM ${source} WHERE ${identifier} IS NOT NULL AND TRIM(CAST(${identifier} AS VARCHAR)) <> ''`;
  } else if (step.type === "remove-duplicates") {
    const selected = requireColumns(columns, params.columns);
    const direction = params.keep === "last" ? "DESC" : "ASC";
    sql = `SELECT * FROM ${source} QUALIFY ROW_NUMBER() OVER (PARTITION BY ${selected.map(quoteIdentifier).join(", ")} ORDER BY ${quoteIdentifier(INTERNAL_ROW_ID)} ${direction}) = 1`;
  } else if (step.type === "standardize-case") {
    const identifier = requireColumn(columns, params.column);
    const mode = String(params.mode ?? "lower");
    if (!CASE_MODES.has(mode)) throw new Error("Format huruf tidak didukung.");
    const textExpression = `CAST(${identifier} AS VARCHAR)`;
    const caseExpression = mode === "title"
      ? `array_to_string(list_transform(string_split(lower(${textExpression}), ' '), lambda word: upper(left(word, 1)) || substring(word, 2)), ' ')`
      : `${mode === "upper" ? "UPPER" : "LOWER"}(${textExpression})`;
    sql = `SELECT * REPLACE (${caseExpression} AS ${identifier}) FROM ${source}`;
  } else if (step.type === "parse-date") {
    const identifier = requireColumn(columns, params.column);
    const format = String(params.format ?? "%Y-%m-%d");
    sql = `SELECT * REPLACE (TRY_STRPTIME(CAST(${identifier} AS VARCHAR), ${sqlLiteral(format)})::DATE AS ${identifier}) FROM ${source}`;
  } else if (step.type === "select-columns") {
    const selected = requireColumns(columns, params.columns);
    sql = `SELECT ${quoteIdentifier(INTERNAL_ROW_ID)}, ${selected.map(quoteIdentifier).join(", ")} FROM ${source}`;
    nextColumns = selected;
  } else if (step.type === "remove-columns") {
    const removed = requireColumns(columns, params.columns);
    if (removed.length >= columns.length) throw new Error("Minimal satu kolom harus dipertahankan.");
    sql = `SELECT * EXCLUDE (${removed.map(quoteIdentifier).join(", ")}) FROM ${source}`;
    nextColumns = columns.filter((column) => !removed.includes(column));
  } else if (step.type === "sort") {
    const identifier = requireColumn(columns, params.column);
    const direction = params.direction === "desc" ? "DESC" : "ASC";
    sql = `SELECT * FROM ${source} ORDER BY ${identifier} ${direction} NULLS LAST`;
  } else if (step.type === "calculated-column") {
    const left = requireColumn(columns, params.leftColumn);
    const operator = String(params.operator ?? "");
    if (!CALCULATION_OPERATORS.has(operator)) throw new Error("Operator kalkulasi tidak didukung.");
    const name = requireOutputName(columns, params.newName);
    const right = params.rightColumn ? requireColumn(columns, params.rightColumn) : sqlLiteral(Number(params.value));
    sql = `SELECT *, (${left} ${operator} NULLIF(${right}, 0)) AS ${quoteIdentifier(name)} FROM ${source}`;
    if (operator !== "/") sql = `SELECT *, (${left} ${operator} ${right}) AS ${quoteIdentifier(name)} FROM ${source}`;
    nextColumns.push(name);
  } else if (step.type === "conditional-column") {
    const identifier = requireColumn(columns, params.column);
    const operator = String(params.operator ?? "=");
    if (!COMPARISON_OPERATORS.has(operator)) throw new Error("Operator kondisi tidak didukung.");
    const name = requireOutputName(columns, params.newName);
    sql = `SELECT *, CASE WHEN ${identifier} ${operator} ${sqlLiteral(params.value)} THEN ${sqlLiteral(params.thenValue)} ELSE ${sqlLiteral(params.elseValue)} END AS ${quoteIdentifier(name)} FROM ${source}`;
    nextColumns.push(name);
  } else if (step.type === "group-aggregate") {
    const groups = requireColumns(columns, params.groupColumns);
    const aggregateFunction = String(params.function ?? "COUNT").toUpperCase();
    if (!AGGREGATE_FUNCTIONS.has(aggregateFunction)) throw new Error("Fungsi agregasi tidak didukung.");
    const name = requireOutputName(groups, params.newName);
    const valueExpression = aggregateFunction === "COUNT" && !params.valueColumn
      ? "*"
      : requireColumn(columns, params.valueColumn);
    const groupSql = groups.map(quoteIdentifier).join(", ");
    sql = `SELECT ROW_NUMBER() OVER () AS ${quoteIdentifier(INTERNAL_ROW_ID)}, ${groupSql}, ${aggregateFunction}(${valueExpression}) AS ${quoteIdentifier(name)} FROM ${source} GROUP BY ${groupSql}`;
    nextColumns = [...groups, name];
  } else {
    throw new Error(`Tipe langkah "${step.type}" belum didukung.`);
  }

  return { sql, columns: nextColumns };
}

export function compileRecipe(recipe, sourceColumns) {
  if (!Array.isArray(recipe)) throw new Error("Recipe harus berupa array.");
  const ids = new Set();
  let columns = [...sourceColumns];
  const ctes = [];
  const stepStates = [];
  let enabledIndex = 0;

  recipe.forEach((step, recipeIndex) => {
    if (!step || typeof step !== "object" || !step.id || ids.has(step.id)) {
      const error = new Error(`Langkah ${recipeIndex + 1} memiliki ID yang tidak valid atau duplikat.`);
      error.code = "INVALID_RECIPE_STEP";
      error.stepIndex = recipeIndex;
      error.stepId = step?.id ?? null;
      throw error;
    }
    ids.add(step.id);
    if (!TYPE_LABELS.has(step.type)) {
      const error = new Error(`Langkah ${recipeIndex + 1} memiliki tipe yang tidak dikenal.`);
      error.code = "INVALID_RECIPE_STEP";
      error.stepIndex = recipeIndex;
      error.stepId = step.id;
      throw error;
    }
    if (step.enabled === false) {
      stepStates.push({ id: step.id, status: "disabled", inputColumns: [...columns], outputColumns: [...columns] });
      return;
    }
    const input = stepInputName(enabledIndex);
    let compiled;
    try {
      compiled = compileEnabledStep(step, input, columns);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Konfigurasi langkah tidak valid.";
      const recipeError = new Error(`Langkah ${recipeIndex + 1} (${getStepLabel(step.type)}): ${message}`);
      recipeError.code = "INVALID_RECIPE_STEP";
      recipeError.stepIndex = recipeIndex;
      recipeError.stepId = step.id;
      throw recipeError;
    }
    enabledIndex += 1;
    ctes.push(`${quoteIdentifier(`step_${enabledIndex}`)} AS (${compiled.sql})`);
    stepStates.push({ id: step.id, status: "valid", inputColumns: [...columns], outputColumns: [...compiled.columns] });
    columns = compiled.columns;
  });

  const finalSource = enabledIndex === 0 ? quoteIdentifier("source_data") : quoteIdentifier(`step_${enabledIndex}`);
  return {
    sql: ctes.length ? `WITH ${ctes.join(",\n")} SELECT * FROM ${finalSource}` : `SELECT * FROM ${finalSource}`,
    columns,
    stepStates,
  };
}

export function compileRecipeSafely(recipe, sourceColumns) {
  try {
    return { ...compileRecipe(recipe, sourceColumns), recipeError: null };
  } catch (error) {
    if (error?.code !== "INVALID_RECIPE_STEP" || !Number.isInteger(error.stepIndex)) throw error;
    const validPrefix = recipe.slice(0, error.stepIndex);
    const compiled = compileRecipe(validPrefix, sourceColumns);
    const invalidStep = recipe[error.stepIndex];
    const trailingStates = recipe.slice(error.stepIndex).map((step, offset) => ({
      id: step?.id ?? `invalid-${error.stepIndex + offset}`,
      status: offset === 0 ? "invalid" : "blocked",
      inputColumns: [...compiled.columns],
      outputColumns: [...compiled.columns],
    }));
    return {
      ...compiled,
      stepStates: [...compiled.stepStates, ...trailingStates],
      recipeError: {
        code: error.code,
        message: error.message,
        stepIndex: error.stepIndex,
        stepId: invalidStep?.id ?? error.stepId ?? null,
      },
    };
  }
}

export function summarizeStep(step) {
  const params = step.params ?? {};
  if (step.type === "rename-column") return `${params.column ?? "?"} → ${params.newName ?? "?"}`;
  if (step.type === "change-type") return `${params.column ?? "?"} → ${params.targetType ?? "?"}`;
  if (["trim", "remove-empty-rows", "standardize-case", "parse-date", "sort"].includes(step.type)) return String(params.column ?? "Pilih kolom");
  if (["remove-duplicates", "select-columns", "remove-columns"].includes(step.type)) return normalizeColumns(params.columns).join(", ") || "Pilih kolom";
  if (step.type === "replace-value") return `${params.column ?? "?"}: ${params.from ?? ""} → ${params.to ?? ""}`;
  if (step.type === "fill-empty") return `${params.column ?? "?"} → ${params.value ?? ""}`;
  if (["calculated-column", "conditional-column", "group-aggregate"].includes(step.type)) return String(params.newName ?? "Kolom baru");
  return getStepLabel(step.type);
}

export { INTERNAL_ROW_ID };
