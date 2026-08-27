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

const relation = (sql, columns) => ({ sql, schema: columns.map(([name, type]) => ({ name, type })) });

test("append rejects incompatible shared column types", () => {
  assert.throws(() => compileAppendSql([
    relation("SELECT 1", [["id", "BIGINT"]]),
    relation("SELECT 2", [["id", "VARCHAR"]]),
  ]), /tidak kompatibel/);
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
});

test("aggregate supports grouped measures with stable output types", () => {
  const result = compileAggregateSql(relation("orders", [["city", "VARCHAR"], ["amount", "DOUBLE"]]), {
    groupBy: ["city"],
    measures: [
      { function: "sum", column: "amount", alias: "total_amount" },
      { function: "count-distinct", column: "amount", alias: "unique_amounts" },
    ],
  });
  assert.deepEqual(result.schema, [
    { name: "city", type: "VARCHAR" },
    { name: "total_amount", type: "DOUBLE" },
    { name: "unique_amounts", type: "BIGINT" },
  ]);
  assert.match(result.sql, /SUM\(a\."amount"\) AS "total_amount"/);
  assert.match(result.sql, /COUNT\(DISTINCT a\."amount"\)/);
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

test("unpivot turns selected columns into field and value rows", () => {
  const result = compileUnpivotSql(relation("metrics", [["id", "VARCHAR"], ["jan", "DOUBLE"], ["feb", "DOUBLE"]]), {
    idColumns: ["id"],
    valueColumns: ["jan", "feb"],
    nameColumn: "month",
    valueColumn: "amount",
  });
  assert.deepEqual(result.schema, [
    { name: "id", type: "VARCHAR" },
    { name: "month", type: "VARCHAR" },
    { name: "amount", type: "VARCHAR" },
  ]);
  assert.match(result.sql, /UNION ALL/);
});
