import assert from "node:assert/strict";
import test from "node:test";
import {
  compileAggregateSql,
  compileAppendSql,
  compileDifferenceSql,
  compileDistinctRowsSql,
  compileFilterRowsSql,
  compileJoinSql,
  compilePivotSql,
  compileUnpivotSql,
} from "../src/composeSql.js";
import { composeSchemaDelta } from "../src/schemaDelta.js";

const relation = (sql, columns) => ({ sql, schema: columns.map(([name, type]) => ({ name, type })) });

test("append rejects incompatible shared column types", () => {
  assert.throws(() => compileAppendSql([
    relation("SELECT 1", [["id", "BIGINT"]]),
    relation("SELECT 2", [["id", "VARCHAR"]]),
  ]), /tidak kompatibel/);
});

test("append widens compatible numeric columns explicitly", () => {
  const result = compileAppendSql([
    relation("left_table", [["id", "INTEGER"], ["amount", "DECIMAL(10,2)"]]),
    relation("right_table", [["id", "BIGINT"], ["amount", "DOUBLE"]]),
  ]);
  assert.deepEqual(result.schema.map((column) => [column.name, column.type]), [["id", "BIGINT"], ["amount", "DOUBLE"]]);
  assert.match(result.sql, /CAST\(append_input\."id" AS BIGINT\)/);
  assert.match(result.sql, /CAST\(append_input\."amount" AS DOUBLE\)/);
});

test("join rejects incompatible key types without implicit casting", () => {
  assert.throws(() => compileJoinSql(
    relation("SELECT 1", [["id", "BIGINT"]]),
    relation("SELECT 2", [["id", "VARCHAR"]]),
    { keyPairs: [{ left: "id", right: "id" }], collisionPolicy: "suffix" },
  ), /Key types differ/);
});

test("join suffixes collisions and supports explicit output selection", () => {
  const result = compileJoinSql(
    relation("SELECT 1", [["id", "BIGINT"], ["name", "VARCHAR"]]),
    relation("SELECT 2", [["id", "BIGINT"], ["name", "VARCHAR"]]),
    {
      joinType: "left",
      keyPairs: [{ left: "id", right: "id" }],
      collisionPolicy: "suffix",
      selectedOutputColumns: ["left:id", "right:name"],
    },
  );
  assert.deepEqual(result.schema.map((column) => column.name), ["id_left", "name_right"]);
  assert.match(result.sql, /LEFT JOIN/);
});

test("join includes every visible input column by default", () => {
  const result = compileJoinSql(
    relation("SELECT 1", [["id", "BIGINT"], ["left_value", "VARCHAR"]]),
    relation("SELECT 2", [["id", "BIGINT"], ["right_value", "VARCHAR"]]),
    {
      joinType: "inner",
      keyPairs: [{ left: "id", right: "id" }],
      collisionPolicy: "suffix",
    },
  );
  assert.deepEqual(result.schema.map((column) => column.name), ["id_left", "left_value", "id_right", "right_value"]);
});

test("wide Join schema delta uses normalized provenance instead of reporting every field twice", () => {
  const leftColumns = Array.from({ length: 305 }, (_, index) => [`field_${index}`, index === 0 ? "BIGINT" : "VARCHAR"]);
  const rightColumns = Array.from({ length: 305 }, (_, index) => [`field_${index}`, index === 0 ? "BIGINT" : "VARCHAR"]);
  const left = relation("left_table", leftColumns);
  const right = relation("right_table", rightColumns);
  const compiled = compileJoinSql(left, right, {
    joinType: "inner",
    collisionPolicy: "suffix",
    keyPairs: [{ left: "field_0", right: "field_0" }],
  });
  const delta = composeSchemaDelta("join", [left.schema, right.schema], compiled.schema);
  assert.equal(compiled.schema.length, 610);
  assert.equal(delta.added.length, 0);
  assert.equal(delta.removed.length, 0);
  assert.equal(delta.renamed.length, 610);
  assert.equal(delta.baseline, "normalized-binary-input");
  assert.deepEqual(compiled.schema[0].provenance, { kind: "join", side: "left", column: "field_0" });
});

test("append and join reject an explicitly empty output selection", () => {
  const left = relation("left_table", [["id", "INTEGER"]]);
  const right = relation("right_table", [["id", "INTEGER"]]);
  assert.throws(() => compileAppendSql([left, right], { outputColumns: [] }), /minimal satu kolom/);
  assert.throws(() => compileJoinSql(left, right, {
    joinType: "inner",
    collisionPolicy: "suffix",
    keyPairs: [{ left: "id", right: "id" }],
    selectedOutputColumns: [],
  }), /minimal satu kolom/);
});

test("filter rows keeps the input schema and compiles explicit predicates", () => {
  const result = compileFilterRowsSql(relation("orders", [["city", "VARCHAR"], ["amount", "DOUBLE"]]), {
    conditions: [{ column: "city", operator: "contains", value: "Jay" }],
  });
  assert.deepEqual(result.schema.map((column) => column.name), ["city", "amount"]);
  assert.match(result.sql, /STRPOS\(CAST\(f\."city" AS VARCHAR\), 'Jay'\) > 0/);
});

test("filter rows rejects blank values for comparison operators", () => {
  assert.throws(() => compileFilterRowsSql(relation("orders", [["city", "VARCHAR"]]), {
    conditions: [{ column: "city", operator: "equals", value: "" }],
  }), /nilai pembanding/);
  assert.doesNotThrow(() => compileFilterRowsSql(relation("orders", [["city", "VARCHAR"]]), {
    conditions: [{ column: "city", operator: "is-empty", value: "" }],
  }));
});

test("distinct rows uses the selected comparison columns", () => {
  const result = compileDistinctRowsSql(relation("orders", [["id", "VARCHAR"], ["status", "VARCHAR"]]), {
    columns: ["id"],
  });
  assert.match(result.sql, /PARTITION BY d\."id"/);
  assert.deepEqual(result.schema.map((column) => column.name), ["id", "status"]);

  const projected = compileDistinctRowsSql(relation("orders", [["id", "VARCHAR"], ["status", "VARCHAR"]]), {
    columns: ["id"],
    mode: "project-columns",
  });
  assert.deepEqual(projected.schema.map((column) => column.name), ["id"]);
  assert.match(projected.sql, /SELECT DISTINCT "id"/);
});

test("aggregate supports grouped measures with stable output types", () => {
  const result = compileAggregateSql(relation("orders", [["city", "VARCHAR"], ["amount", "DOUBLE"]]), {
    groupBy: ["city"],
    measures: [
      { function: "sum", column: "amount", alias: "total_amount" },
      { function: "count-distinct", column: "amount", alias: "unique_amounts" },
    ],
  });
  assert.deepEqual(result.schema.map(({ name, type }) => ({ name, type })), [
    { name: "city", type: "VARCHAR" },
    { name: "total_amount", type: "DOUBLE" },
    { name: "unique_amounts", type: "BIGINT" },
  ]);
  assert.match(result.sql, /SUM\(a\."amount"\) AS "total_amount"/);
  assert.match(result.sql, /COUNT\(DISTINCT a\."amount"\)/);
});

test("aggregate supports median, percentile, and minimum sample suppression", () => {
  const result = compileAggregateSql(relation("orders", [["city", "VARCHAR"], ["amount", "DOUBLE"]]), {
    groupBy: ["city"],
    measures: [
      { function: "median", column: "amount", alias: "median_amount" },
      { function: "percentile", column: "amount", percentile: 0.9, alias: "p90_amount" },
    ],
    minimumSampleSize: 20,
    suppressSmallGroups: true,
  });
  assert.match(result.sql, /MEDIAN\(a\."amount"\)/);
  assert.match(result.sql, /QUANTILE_CONT\(a\."amount", 0\.9\)/);
  assert.match(result.sql, /HAVING COUNT\(\*\) >= 20/);
  assert.deepEqual(result.schema.slice(1).map(({ name, type }) => ({ name, type })), [
    { name: "median_amount", type: "DOUBLE" },
    { name: "p90_amount", type: "DOUBLE" },
  ]);
});

test("difference returns only one side and compares null keys explicitly", () => {
  const left = relation("orders", [["id", "VARCHAR"], ["amount", "DOUBLE"]]);
  const right = relation("customers", [["customer_id", "VARCHAR"]]);
  const result = compileDifferenceSql(left, right, {
    mode: "left-only",
    keyPairs: [{ left: "id", right: "customer_id" }],
  });
  assert.deepEqual(result.schema.map((column) => column.name), ["id", "amount"]);
  assert.match(result.sql, /WHERE NOT EXISTS/);
  assert.match(result.sql, /IS NOT DISTINCT FROM/);
});

test("difference rejects incompatible key types", () => {
  assert.throws(() => compileDifferenceSql(
    relation("left_table", [["id", "BIGINT"]]),
    relation("right_table", [["id", "VARCHAR"]]),
    { keyPairs: [{ left: "id", right: "id" }] },
  ), /Key types differ/);
});

test("pivot creates one output column for every explicit value", () => {
  const result = compilePivotSql(relation("sales", [["month", "VARCHAR"], ["region", "VARCHAR"], ["amount", "DOUBLE"]]), {
    groupBy: ["month"],
    pivotColumn: "region",
    valueColumn: "amount",
    aggregate: "sum",
    values: ["East", "West"],
  });
  assert.deepEqual(result.schema.map((column) => column.name), ["month", "East", "West"]);
  assert.match(result.sql, /CASE WHEN p\."region" IS NOT DISTINCT FROM 'East'/);
});

test("pivot count counts matching rows even when the value column is null", () => {
  const result = compilePivotSql(relation("orders", [["region", "VARCHAR"], ["status", "VARCHAR"], ["amount", "DOUBLE"]]), {
    groupBy: ["region"],
    pivotColumn: "status",
    valueColumn: "amount",
    aggregate: "count",
    values: ["FAILED"],
  });
  assert.match(result.sql, /COUNT\(\*\) FILTER \(WHERE p\."status" IS NOT DISTINCT FROM 'FAILED'\)/);
});

test("unpivot turns selected columns into field and value rows", () => {
  const result = compileUnpivotSql(relation("metrics", [["id", "VARCHAR"], ["jan", "DOUBLE"], ["feb", "DOUBLE"]]), {
    idColumns: ["id"],
    valueColumns: ["jan", "feb"],
    nameColumn: "month",
    valueColumn: "amount",
  });
  assert.deepEqual(result.schema.map(({ name, type }) => ({ name, type })), [
    { name: "id", type: "VARCHAR" },
    { name: "month", type: "VARCHAR" },
    { name: "amount", type: "DOUBLE" },
  ]);
  assert.match(result.sql, /CAST\(u\."jan" AS DOUBLE\)/);
  assert.match(result.sql, /UNION ALL/);
});

test("unpivot widens compatible numeric columns and rejects incompatible values", () => {
  const numeric = compileUnpivotSql(relation("metrics", [["id", "VARCHAR"], ["units", "BIGINT"], ["amount", "DECIMAL(18,2)"]]), {
    idColumns: ["id"],
    valueColumns: ["units", "amount"],
  });
  assert.equal(numeric.schema.at(-1).type, "DOUBLE");
  assert.throws(() => compileUnpivotSql(relation("metrics", [["id", "VARCHAR"], ["amount", "DOUBLE"], ["status", "VARCHAR"]]), {
    idColumns: ["id"],
    valueColumns: ["amount", "status"],
  }), (error) => error.code === "UNPIVOT_VALUE_TYPE_MISMATCH");
});
