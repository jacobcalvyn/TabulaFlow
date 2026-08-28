import { INTERNAL_ROW_ID, quoteIdentifier } from "./transformations.js";
import { mergeFieldSemantics, resolveFieldSemantic } from "./semanticModel.js";

const JOIN_TYPES = new Set(["inner", "left", "right", "full"]);
const COLLISION_POLICIES = new Set(["fail", "suffix", "manual"]);
const FILTER_OPERATORS = new Set(["equals", "not-equals", "contains", "not-contains", "greater-than", "greater-or-equal", "less-than", "less-or-equal", "is-null", "is-not-null", "is-empty", "is-not-empty"]);
const AGGREGATE_FUNCTIONS = new Set(["count", "sum", "average", "min", "max", "count-distinct", "median", "percentile"]);

function visibleSchema(schema = []) {
  return schema.filter((column) => column.name !== INTERNAL_ROW_ID);
}

function typeKey(type) {
  return String(type ?? "").toUpperCase().replace(/\s+/g, " ").trim();
}

const INTEGER_TYPE = /^(?:U?(?:TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT))$/;
const DECIMAL_TYPE = /^(?:DECIMAL|NUMERIC)(?:\(|$)/;
const FLOAT_TYPE = /^(?:FLOAT|REAL|DOUBLE)$/;

function commonUnpivotType(valueColumns) {
  const types = valueColumns.map((column) => typeKey(column.type));
  const uniqueTypes = [...new Set(types)];
  if (uniqueTypes.length === 1) return uniqueTypes[0];
  if (uniqueTypes.every((type) => INTEGER_TYPE.test(type))) return "BIGINT";
  if (uniqueTypes.every((type) => INTEGER_TYPE.test(type) || DECIMAL_TYPE.test(type) || FLOAT_TYPE.test(type))) return "DOUBLE";
  const error = new Error(`Unpivot value columns must share a compatible type (${uniqueTypes.join(" ↔ ")}).`);
  error.code = "UNPIVOT_VALUE_TYPE_MISMATCH";
  throw error;
}

function schemaMap(schema) {
  return new Map(schema.map((column) => [column.name, column]));
}

function assertUniqueNames(columns) {
  const used = new Set();
  for (const column of columns) {
    const key = column.name.toLocaleLowerCase("en-US");
    if (used.has(key)) throw new Error(`Nama kolom output "${column.name}" duplikat.`);
    used.add(key);
  }
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Nilai angka tidak valid.");
    return String(value);
  }
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function requireVisibleColumn(input, name, label = "Kolom") {
  const column = schemaMap(visibleSchema(input.schema)).get(name);
  if (!column) throw new Error(`${label} "${name}" tidak tersedia.`);
  return column;
}

function uniqueOutputName(requested, used, fallback) {
  const base = String(requested ?? fallback).trim() || fallback;
  let candidate = base;
  for (let index = 2; used.has(candidate.toLocaleLowerCase("en-US")); index += 1) candidate = `${base}_${index}`;
  used.add(candidate.toLocaleLowerCase("en-US"));
  return candidate;
}

function compileFilterPredicate(alias, input, condition) {
  const column = requireVisibleColumn(input, condition.column, "Kolom filter");
  const identifier = `${alias}.${quoteIdentifier(column.name)}`;
  const operator = String(condition.operator ?? "equals");
  if (!FILTER_OPERATORS.has(operator)) throw new Error("Operator filter tidak didukung.");
  const rawValue = String(condition.value ?? "");
  if (!["is-null", "is-not-null", "is-empty", "is-not-empty"].includes(operator) && !rawValue.trim()) {
    throw new Error("Filter rows memerlukan nilai pembanding.");
  }
  const value = sqlLiteral(rawValue);
  if (operator === "equals") return `CAST(${identifier} AS VARCHAR) = ${value}`;
  if (operator === "not-equals") return `CAST(${identifier} AS VARCHAR) <> ${value}`;
  if (operator === "contains") return `STRPOS(CAST(${identifier} AS VARCHAR), ${value}) > 0`;
  if (operator === "not-contains") return `STRPOS(CAST(${identifier} AS VARCHAR), ${value}) = 0`;
  if (operator === "greater-than") return `TRY_CAST(${identifier} AS DOUBLE) > TRY_CAST(${value} AS DOUBLE)`;
  if (operator === "greater-or-equal") return `TRY_CAST(${identifier} AS DOUBLE) >= TRY_CAST(${value} AS DOUBLE)`;
  if (operator === "less-than") return `TRY_CAST(${identifier} AS DOUBLE) < TRY_CAST(${value} AS DOUBLE)`;
  if (operator === "less-or-equal") return `TRY_CAST(${identifier} AS DOUBLE) <= TRY_CAST(${value} AS DOUBLE)`;
  if (operator === "is-null") return `${identifier} IS NULL`;
  if (operator === "is-not-null") return `${identifier} IS NOT NULL`;
  if (operator === "is-empty") return `(${identifier} IS NULL OR TRIM(CAST(${identifier} AS VARCHAR)) = '')`;
  return `(${identifier} IS NOT NULL AND TRIM(CAST(${identifier} AS VARCHAR)) <> '')`;
}

export function compileAppendSql(inputs, config = {}) {
  if (!Array.isArray(inputs) || inputs.length < 2) throw new Error("Append memerlukan minimal dua input.");
  const maps = inputs.map((input) => schemaMap(visibleSchema(input.schema)));
  const orderedNames = [];
  const seen = new Set();
  for (const input of inputs) {
    for (const column of visibleSchema(input.schema)) {
      const key = column.name.toLocaleLowerCase("en-US");
      if (!seen.has(key)) {
        seen.add(key);
        orderedNames.push(column.name);
      }
    }
  }
  for (const name of orderedNames) {
    const types = maps.map((map) => map.get(name)?.type).filter(Boolean).map(typeKey);
    if (new Set(types).size > 1) throw new Error(`Append gagal: tipe kolom "${name}" tidak kompatibel (${[...new Set(types)].join(" ↔ ")}).`);
  }
  const selectedNames = Array.isArray(config.outputColumns)
    ? config.outputColumns.filter((name) => orderedNames.includes(name))
    : orderedNames;
  if (!selectedNames.length) throw new Error("Append harus menghasilkan minimal satu kolom.");
  const union = inputs.map((input) => `SELECT * EXCLUDE (${quoteIdentifier(INTERNAL_ROW_ID)}) FROM (${input.sql}) AS append_input`).join(" UNION ALL BY NAME ");
  const projection = selectedNames.map(quoteIdentifier).join(", ");
  const types = new Map();
  for (const name of selectedNames) {
    const column = maps.map((map) => map.get(name)).find(Boolean);
    types.set(name, column?.type ?? "VARCHAR");
  }
  return {
    sql: `SELECT ROW_NUMBER() OVER () AS ${quoteIdentifier(INTERNAL_ROW_ID)}, ${projection} FROM (${union}) AS appended`,
    schema: selectedNames.map((name) => {
      const sources = maps.map((map) => map.get(name)).filter(Boolean);
      return {
        name,
        type: types.get(name),
        semantic: mergeFieldSemantics(sources, { kind: "append", columns: sources.map((column) => column.name) }),
      };
    }),
  };
}

function defaultJoinOutput(leftSchema, rightSchema, policy, config) {
  const left = visibleSchema(leftSchema);
  const right = visibleSchema(rightSchema);
  const leftKeys = new Set(left.map((column) => column.name.toLocaleLowerCase("en-US")));
  const collisions = new Set(right.filter((column) => leftKeys.has(column.name.toLocaleLowerCase("en-US"))).map((column) => column.name.toLocaleLowerCase("en-US")));
  if (policy === "fail" && collisions.size) throw new Error(`Join memiliki tabrakan nama kolom: ${[...collisions].join(", ")}. Pilih suffix atau pemetaan manual.`);
  const leftSuffix = String(config.leftSuffix ?? "_left");
  const rightSuffix = String(config.rightSuffix ?? "_right");
  return [
    ...left.map((column) => ({ side: "left", source: column.name, name: collisions.has(column.name.toLocaleLowerCase("en-US")) ? `${column.name}${leftSuffix}` : column.name, type: column.type, semantic: resolveFieldSemantic(column) })),
    ...right.map((column) => ({ side: "right", source: column.name, name: collisions.has(column.name.toLocaleLowerCase("en-US")) ? `${column.name}${rightSuffix}` : column.name, type: column.type, semantic: resolveFieldSemantic(column) })),
  ];
}

export function compileJoinSql(left, right, config = {}) {
  const joinType = String(config.joinType ?? "inner").toLowerCase();
  if (!JOIN_TYPES.has(joinType)) throw new Error("Jenis Join tidak didukung.");
  const policy = String(config.collisionPolicy ?? "fail").toLowerCase();
  if (!COLLISION_POLICIES.has(policy)) throw new Error("Collision policy tidak didukung.");
  const keyPairs = Array.isArray(config.keyPairs) ? config.keyPairs : [];
  if (!keyPairs.length) throw new Error("Join memerlukan minimal satu pasangan key.");
  const leftMap = schemaMap(visibleSchema(left.schema));
  const rightMap = schemaMap(visibleSchema(right.schema));
  for (const pair of keyPairs) {
    const leftColumn = leftMap.get(pair.left);
    const rightColumn = rightMap.get(pair.right);
    if (!leftColumn || !rightColumn) throw new Error("Salah satu key Join tidak tersedia.");
    if (typeKey(leftColumn.type) !== typeKey(rightColumn.type)) {
      const error = new Error(`Key types differ: ${typeKey(leftColumn.type)} ↔ ${typeKey(rightColumn.type)}`);
      error.code = "JOIN_KEY_TYPE_MISMATCH";
      throw error;
    }
  }
  let output = policy === "manual"
    ? (Array.isArray(config.outputColumns) ? config.outputColumns.filter((column) => column.include !== false).map((column) => {
      const source = column.side === "right" ? rightMap.get(column.source) : leftMap.get(column.source);
      if (!source) throw new Error(`Kolom output Join "${column.source}" tidak tersedia.`);
      return { side: column.side === "right" ? "right" : "left", source: column.source, name: String(column.name ?? column.source).trim(), type: source.type, semantic: resolveFieldSemantic(source) };
    }) : [])
    : defaultJoinOutput(left.schema, right.schema, policy, config);
  if (Array.isArray(config.selectedOutputColumns)) {
    const selected = new Set(config.selectedOutputColumns);
    output = output.filter((column) => selected.has(`${column.side}:${column.source}`));
  }
  if (!output.length) throw new Error("Join harus menghasilkan minimal satu kolom.");
  if (output.some((column) => !column.name)) throw new Error("Nama kolom output Join wajib diisi.");
  assertUniqueNames(output);
  const projection = output.map((column) => `${column.side === "right" ? "r" : "l"}.${quoteIdentifier(column.source)} AS ${quoteIdentifier(column.name)}`).join(", ");
  const condition = keyPairs.map((pair) => `l.${quoteIdentifier(pair.left)} = r.${quoteIdentifier(pair.right)}`).join(" AND ");
  return {
    sql: `SELECT ROW_NUMBER() OVER () AS ${quoteIdentifier(INTERNAL_ROW_ID)}, ${projection} FROM (${left.sql}) AS l ${joinType.toUpperCase()} JOIN (${right.sql}) AS r ON ${condition}`,
    schema: output.map(({ name, type, semantic, side, source }) => ({
      name,
      type,
      semantic: { ...semantic, provenance: { kind: "join", side, column: source } },
    })),
    keyPairs,
  };
}

export function compileFilterRowsSql(input, config = {}) {
  const conditions = Array.isArray(config.conditions) ? config.conditions : [];
  if (!conditions.length) throw new Error("Filter rows memerlukan minimal satu kondisi.");
  const conjunction = String(config.conjunction ?? "and").toLowerCase() === "or" ? " OR " : " AND ";
  const predicate = conditions.map((condition) => `COALESCE((${compileFilterPredicate("f", input, condition)}), FALSE)`).join(conjunction);
  return {
    sql: `SELECT * FROM (${input.sql}) AS f WHERE ${predicate}`,
    schema: visibleSchema(input.schema),
  };
}

export function compileDistinctRowsSql(input, config = {}) {
  const requested = Array.isArray(config.columns) ? config.columns : [];
  const columns = requested.length ? requested : visibleSchema(input.schema).map((column) => column.name);
  columns.forEach((name) => requireVisibleColumn(input, name, "Kolom pembanding"));
  if (!columns.length) throw new Error("Distinct rows memerlukan minimal satu kolom pembanding.");
  const mode = String(config.mode ?? "representative-rows");
  if (!new Set(["representative-rows", "project-columns"]).has(mode)) throw new Error("Distinct rows mode is not supported.");
  if (mode === "project-columns") {
    const projection = columns.map(quoteIdentifier).join(", ");
    return {
      sql: `SELECT ROW_NUMBER() OVER () AS ${quoteIdentifier(INTERNAL_ROW_ID)}, ${projection} FROM (SELECT DISTINCT ${projection} FROM (${input.sql}) AS distinct_source) AS d`,
      schema: columns.map((name) => requireVisibleColumn(input, name)),
      mode,
    };
  }
  return {
    sql: `SELECT * FROM (${input.sql}) AS d QUALIFY ROW_NUMBER() OVER (PARTITION BY ${columns.map((name) => `d.${quoteIdentifier(name)}`).join(", ")} ORDER BY d.${quoteIdentifier(INTERNAL_ROW_ID)}) = 1`,
    schema: visibleSchema(input.schema),
    mode,
  };
}

export function compileAggregateSql(input, config = {}) {
  const groupBy = Array.isArray(config.groupBy) ? [...new Set(config.groupBy)] : [];
  groupBy.forEach((name) => requireVisibleColumn(input, name, "Kolom group by"));
  const measures = Array.isArray(config.measures) ? config.measures : [];
  if (!groupBy.length && !measures.length) throw new Error("Aggregate memerlukan group by atau minimal satu measure.");
  const used = new Set(groupBy.map((name) => name.toLocaleLowerCase("en-US")));
  const compiledMeasures = measures.map((measure, index) => {
    const fn = String(measure.function ?? "count").toLowerCase();
    if (!AGGREGATE_FUNCTIONS.has(fn)) throw new Error("Fungsi Aggregate tidak didukung.");
    const column = measure.column ? requireVisibleColumn(input, measure.column, "Kolom measure") : null;
    if (fn !== "count" && !column) throw new Error("Fungsi Aggregate ini memerlukan kolom measure.");
    const source = column ? `a.${quoteIdentifier(column.name)}` : "*";
    const percentile = Number(measure.percentile ?? 0.9);
    if (fn === "percentile" && (!Number.isFinite(percentile) || percentile <= 0 || percentile >= 1)) throw new Error("Percentile must be greater than 0 and less than 1.");
    const expression = fn === "count-distinct"
      ? `COUNT(DISTINCT ${source})`
      : fn === "average"
        ? `AVG(${source})`
        : fn === "median"
          ? `MEDIAN(${source})`
          : fn === "percentile"
            ? `QUANTILE_CONT(${source}, ${percentile})`
            : `${fn.toUpperCase()}(${source})`;
    const fallback = `${fn.replace("-", "_")}_${column?.name ?? "rows"}`;
    const name = uniqueOutputName(measure.alias, used, fallback || `measure_${index + 1}`);
    const type = ["count", "count-distinct"].includes(fn) ? "BIGINT" : ["average", "median", "percentile"].includes(fn) ? "DOUBLE" : column?.type ?? "BIGINT";
    return {
      expression,
      name,
      type,
      semantic: mergeFieldSemantics(column ? [column] : [], { kind: "aggregate", function: fn, column: column?.name ?? null }),
    };
  });
  const projection = [
    ...groupBy.map((name) => `a.${quoteIdentifier(name)}`),
    ...compiledMeasures.map((measure) => `${measure.expression} AS ${quoteIdentifier(measure.name)}`),
  ];
  const groupSql = groupBy.length ? ` GROUP BY ${groupBy.map((name) => `a.${quoteIdentifier(name)}`).join(", ")}` : "";
  const minimumSampleSize = Math.max(1, Math.floor(Number(config.minimumSampleSize) || 1));
  const suppressSmallGroups = config.suppressSmallGroups === true && groupBy.length > 0;
  const havingSql = suppressSmallGroups ? ` HAVING COUNT(*) >= ${minimumSampleSize}` : "";
  return {
    sql: `SELECT ROW_NUMBER() OVER () AS ${quoteIdentifier(INTERNAL_ROW_ID)}, ${projection.join(", ")} FROM (${input.sql}) AS a${groupSql}${havingSql}`,
    schema: [
      ...groupBy.map((name) => requireVisibleColumn(input, name)),
      ...compiledMeasures.map(({ name, type, semantic }) => ({ name, type, semantic })),
    ],
    minimumSampleSize,
    suppressSmallGroups,
  };
}

export function compileDifferenceSql(left, right, config = {}) {
  const mode = String(config.mode ?? "left-only").toLowerCase();
  if (!new Set(["left-only", "right-only"]).has(mode)) throw new Error("Mode Difference tidak didukung.");
  const keyPairs = Array.isArray(config.keyPairs) ? config.keyPairs : [];
  if (!keyPairs.length) throw new Error("Difference memerlukan minimal satu pasangan key.");
  for (const pair of keyPairs) {
    const leftColumn = requireVisibleColumn(left, pair.left, "Key kiri");
    const rightColumn = requireVisibleColumn(right, pair.right, "Key kanan");
    if (typeKey(leftColumn.type) !== typeKey(rightColumn.type)) {
      const error = new Error(`Key types differ: ${typeKey(leftColumn.type)} ↔ ${typeKey(rightColumn.type)}`);
      error.code = "DIFFERENCE_KEY_TYPE_MISMATCH";
      throw error;
    }
  }
  const source = mode === "right-only" ? right : left;
  const sourceAlias = mode === "right-only" ? "r" : "l";
  const otherAlias = mode === "right-only" ? "l" : "r";
  const other = mode === "right-only" ? left : right;
  const condition = keyPairs.map((pair) => {
    const sourceKey = mode === "right-only" ? pair.right : pair.left;
    const otherKey = mode === "right-only" ? pair.left : pair.right;
    return `${sourceAlias}.${quoteIdentifier(sourceKey)} IS NOT DISTINCT FROM ${otherAlias}.${quoteIdentifier(otherKey)}`;
  }).join(" AND ");
  const projection = visibleSchema(source.schema).map((column) => `${sourceAlias}.${quoteIdentifier(column.name)}`).join(", ");
  return {
    sql: `SELECT ROW_NUMBER() OVER () AS ${quoteIdentifier(INTERNAL_ROW_ID)}, ${projection} FROM (${source.sql}) AS ${sourceAlias} WHERE NOT EXISTS (SELECT 1 FROM (${other.sql}) AS ${otherAlias} WHERE ${condition})`,
    schema: visibleSchema(source.schema),
  };
}

export function compilePivotSql(input, config = {}) {
  const groupBy = Array.isArray(config.groupBy) ? [...new Set(config.groupBy)] : [];
  groupBy.forEach((name) => requireVisibleColumn(input, name, "Kolom group by"));
  const pivotColumn = requireVisibleColumn(input, config.pivotColumn, "Kolom pivot");
  const valueColumn = requireVisibleColumn(input, config.valueColumn, "Kolom nilai");
  const fn = String(config.aggregate ?? "sum").toLowerCase();
  if (!new Set(["sum", "count", "average", "min", "max"]).has(fn)) throw new Error("Fungsi Pivot tidak didukung.");
  const values = Array.isArray(config.values) ? config.values : [];
  if (!values.length) throw new Error("Pivot memerlukan minimal satu nilai kolom baru.");
  const used = new Set(groupBy.map((name) => name.toLocaleLowerCase("en-US")));
  const pivoted = values.map((item) => {
    const value = typeof item === "object" ? item.value : item;
    const name = uniqueOutputName(typeof item === "object" ? item.alias : value, used, String(value));
    const caseSql = `CASE WHEN p.${quoteIdentifier(pivotColumn.name)} IS NOT DISTINCT FROM ${sqlLiteral(value)} THEN p.${quoteIdentifier(valueColumn.name)} END`;
    const expression = `${fn === "average" ? "AVG" : fn.toUpperCase()}(${caseSql})`;
    return { name, expression, type: fn === "count" ? "BIGINT" : fn === "average" ? "DOUBLE" : valueColumn.type, semantic: mergeFieldSemantics([valueColumn], { kind: "pivot", value: String(value), column: valueColumn.name }) };
  });
  const projection = [...groupBy.map((name) => `p.${quoteIdentifier(name)}`), ...pivoted.map((item) => `${item.expression} AS ${quoteIdentifier(item.name)}`)];
  const groupSql = groupBy.length ? ` GROUP BY ${groupBy.map((name) => `p.${quoteIdentifier(name)}`).join(", ")}` : "";
  return {
    sql: `SELECT ROW_NUMBER() OVER () AS ${quoteIdentifier(INTERNAL_ROW_ID)}, ${projection.join(", ")} FROM (${input.sql}) AS p${groupSql}`,
    schema: [...groupBy.map((name) => requireVisibleColumn(input, name)), ...pivoted.map(({ name, type, semantic }) => ({ name, type, semantic }))],
  };
}

export function compileUnpivotSql(input, config = {}) {
  const valueColumns = Array.isArray(config.valueColumns) ? [...new Set(config.valueColumns)] : [];
  if (!valueColumns.length) throw new Error("Unpivot memerlukan minimal satu value column.");
  const valueDefinitions = valueColumns.map((name) => requireVisibleColumn(input, name, "Value column"));
  const outputValueType = commonUnpivotType(valueDefinitions);
  const requestedIds = Array.isArray(config.idColumns) ? [...new Set(config.idColumns)] : [];
  const idColumns = requestedIds.length ? requestedIds : visibleSchema(input.schema).map((column) => column.name).filter((name) => !valueColumns.includes(name));
  idColumns.forEach((name) => requireVisibleColumn(input, name, "ID column"));
  const used = new Set(idColumns.map((name) => name.toLocaleLowerCase("en-US")));
  const nameColumn = uniqueOutputName(config.nameColumn, used, "field");
  const valueColumn = uniqueOutputName(config.valueColumn, used, "value");
  const selectIds = idColumns.map((name) => `u.${quoteIdentifier(name)}`).join(", ");
  const union = valueColumns.map((name) => `SELECT ${selectIds ? `${selectIds}, ` : ""}${sqlLiteral(name)} AS ${quoteIdentifier(nameColumn)}, CAST(u.${quoteIdentifier(name)} AS ${outputValueType}) AS ${quoteIdentifier(valueColumn)} FROM (${input.sql}) AS u`).join(" UNION ALL ");
  return {
    sql: `SELECT ROW_NUMBER() OVER () AS ${quoteIdentifier(INTERNAL_ROW_ID)}, * FROM (${union}) AS unpivoted`,
    schema: [
      ...idColumns.map((name) => requireVisibleColumn(input, name)),
      { name: nameColumn, type: "VARCHAR", semantic: { ...resolveFieldSemantic({ name: nameColumn, type: "VARCHAR" }), role: "dimension", sensitivity: "public", provenance: { kind: "unpivot-field", columns: valueColumns } } },
      { name: valueColumn, type: outputValueType, semantic: mergeFieldSemantics(valueDefinitions, { kind: "unpivot-value", columns: valueColumns }) },
    ],
  };
}

export function compileComposeOperation(kind, inputs, config = {}) {
  if (!Array.isArray(inputs)) throw new Error("Input operasi Compose tidak valid.");
  if (kind === "append") return compileAppendSql(inputs, config);
  if (kind === "join") {
    if (inputs.length !== 2) throw new Error("Join memerlukan tepat dua input.");
    return compileJoinSql(inputs[0], inputs[1], config);
  }
  if (kind === "difference") {
    if (inputs.length !== 2) throw new Error("Difference memerlukan tepat dua input.");
    return compileDifferenceSql(inputs[0], inputs[1], config);
  }
  if (inputs.length !== 1) throw new Error(`${kind} memerlukan tepat satu input.`);
  if (kind === "filter-rows") return compileFilterRowsSql(inputs[0], config);
  if (kind === "distinct-rows") return compileDistinctRowsSql(inputs[0], config);
  if (kind === "aggregate") return compileAggregateSql(inputs[0], config);
  if (kind === "pivot") return compilePivotSql(inputs[0], config);
  if (kind === "unpivot") return compileUnpivotSql(inputs[0], config);
  throw new Error(`Operasi Compose "${kind}" belum didukung.`);
}
