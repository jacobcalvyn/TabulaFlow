import assert from "node:assert/strict";
import test from "node:test";
import {
  compileRecipe,
  compileRecipeSafely,
  CREATABLE_TRANSFORMATION_TYPES,
  createStep,
  getStepLabel,
  summarizeStep,
  transformationParamsAreComplete,
  valueRowActionParams,
} from "../src/transformations.js";

function step(id, type, params, enabled = true) {
  return { id, type, version: 1, enabled, params };
}

test("compiles an ordered recipe and tracks schema after every step", () => {
  const recipe = [
    step("one", "trim", { column: "name" }),
    step("two", "rename-column", { column: "name", newName: "customer_name" }),
    step("three", "calculated-column", { leftColumn: "amount", operator: "*", value: 2, newName: "double_amount" }),
  ];
  const result = compileRecipe(recipe, ["name", "amount"]);

  assert.deepEqual(result.columns, ["customer_name", "amount", "double_amount"]);
  assert.deepEqual(result.stepStates.map(({ status }) => status), ["valid", "valid", "valid"]);
  assert.match(result.sql, /TRIM\(CAST\("name" AS VARCHAR\)\)/);
  assert.match(result.sql, /RENAME \("name" AS "customer_name"\)/);
  assert.match(result.sql, /"amount" \* 2/);
});

test("disabled steps remain tracked without changing the compiled schema", () => {
  const result = compileRecipe([
    step("one", "remove-columns", { columns: ["amount"] }, false),
  ], ["name", "amount"]);

  assert.deepEqual(result.columns, ["name", "amount"]);
  assert.equal(result.stepStates[0].status, "disabled");
  assert.equal(result.sql, 'SELECT * FROM "source_data"');
});

test("reordering steps revalidates downstream column dependencies", () => {
  const rename = step("rename", "rename-column", { column: "name", newName: "customer_name" });
  const trim = step("trim", "trim", { column: "customer_name" });

  assert.doesNotThrow(() => compileRecipe([rename, trim], ["name"]));
  assert.throws(() => compileRecipe([trim, rename], ["name"]), /customer_name/);
});

test("safe compilation keeps the valid prefix and marks invalid downstream steps", () => {
  const result = compileRecipeSafely([
    step("rename", "rename-column", { column: "name", newName: "customer_name" }),
    step("invalid", "trim", { column: "missing" }),
    step("blocked", "trim", { column: "customer_name" }),
  ], ["name"]);

  assert.deepEqual(result.columns, ["customer_name"]);
  assert.deepEqual(result.stepStates.map(({ status }) => status), ["valid", "invalid", "blocked"]);
  assert.equal(result.recipeError.stepId, "invalid");
  assert.equal(result.recipeError.stepIndex, 1);
  assert.match(result.sql, /RENAME/);
});

test("rejects duplicate IDs, column collisions, and unknown step types", () => {
  assert.throws(() => compileRecipe([
    step("same", "trim", { column: "name" }),
    step("same", "trim", { column: "name" }),
  ], ["name"]), /ID.*duplikat/);
  assert.throws(() => compileRecipe([
    step("one", "rename-column", { column: "name", newName: "AMOUNT" }),
  ], ["name", "amount"]), /sudah ada/);
  assert.throws(() => compileRecipe([step("one", "raw-sql", {})], ["name"]), /tidak dikenal/);
});

test("escapes values and identifiers in generated SQL", () => {
  const result = compileRecipe([
    step("one", "replace-value", { column: 'customer"name', from: "O'Reilly", to: "safe" }),
  ], ['customer"name']);

  assert.match(result.sql, /"customer""name"/);
  assert.match(result.sql, /'O''Reilly'/);
});

test("supports lowercase, uppercase, and title case normalization", () => {
  const lower = compileRecipe([step("lower", "standardize-case", { column: "name", mode: "lower" })], ["name"]);
  const upper = compileRecipe([step("upper", "standardize-case", { column: "name", mode: "upper" })], ["name"]);
  const title = compileRecipe([step("title", "standardize-case", { column: "name", mode: "title" })], ["name"]);

  assert.match(lower.sql, /LOWER\(CAST\("name" AS VARCHAR\)\)/);
  assert.match(upper.sql, /UPPER\(CAST\("name" AS VARCHAR\)\)/);
  assert.match(title.sql, /list_transform\(string_split\(lower\(CAST\("name" AS VARCHAR\)\), ' '\), lambda word:/);
  assert.throws(
    () => compileRecipe([step("invalid", "standardize-case", { column: "name", mode: "sentence" })], ["name"]),
    /Format huruf tidak didukung/,
  );
});

test("delete rows removes matching values while preserving unknown predicates", () => {
  const result = compileRecipe([
    step("delete", "delete-rows", { column: "status", operator: "equals", value: "cancelled" }),
  ], ["status", "amount"]);

  assert.deepEqual(result.columns, ["status", "amount"]);
  assert.match(result.sql, /WHERE NOT COALESCE\(\(CAST\("status" AS VARCHAR\) = 'cancelled'\), FALSE\)/);
});

test("value-row actions create exact null-safe delete conditions", () => {
  assert.deepEqual(valueRowActionParams("delete", "status", "cancelled"), {
    column: "status",
    operator: "equals",
    value: "cancelled",
    exactValue: true,
    valueAction: "delete",
  });
  assert.deepEqual(valueRowActionParams("keep", "status", "paid"), {
    column: "status",
    operator: "not-equals",
    value: "paid",
    exactValue: true,
    valueAction: "keep",
    nullSafe: true,
  });
  assert.deepEqual(valueRowActionParams("delete", "status", null), {
    column: "status",
    operator: "is-null",
    valueAction: "delete",
  });
  assert.deepEqual(valueRowActionParams("keep", "status", null), {
    column: "status",
    operator: "is-not-null",
    valueAction: "keep",
  });
  assert.deepEqual(valueRowActionParams("keep", "status", ""), {
    column: "status",
    operator: "not-equals",
    value: "",
    exactValue: true,
    valueAction: "keep",
    nullSafe: true,
  });
  assert.equal(transformationParamsAreComplete("delete-rows", valueRowActionParams("keep", "status", "")), true);
  assert.throws(() => valueRowActionParams("replace", "status", "paid"), /tidak didukung/);
});

test("keep value deletes every non-matching row including nulls", () => {
  const result = compileRecipe([
    step("keep", "delete-rows", valueRowActionParams("keep", "status", "paid")),
  ], ["status"]);

  assert.match(result.sql, /CAST\("status" AS VARCHAR\) IS DISTINCT FROM 'paid'/);
});

test("delete rows requires a comparison value unless the operator is self-contained", () => {
  assert.equal(transformationParamsAreComplete("delete-rows", { operator: "equals", value: "" }), false);
  assert.equal(transformationParamsAreComplete("delete-rows", { operator: "contains", value: "  " }), false);
  assert.equal(transformationParamsAreComplete("delete-rows", { operator: "equals", value: "paid" }), true);
  assert.equal(transformationParamsAreComplete("delete-rows", { operator: "is-null", value: "" }), true);
  assert.equal(transformationParamsAreComplete("trim", {}), true);
});

test("keeps legacy step metadata while exposing only the current creation catalog", () => {
  const generated = createStep("sort", { column: "amount", direction: "desc" });
  assert.ok(generated.id);
  assert.equal(getStepLabel(generated.type), "Urutkan baris");
  assert.equal(summarizeStep(generated), "amount");
  assert.deepEqual(CREATABLE_TRANSFORMATION_TYPES.map(({ type }) => type), [
    "trim",
    "standardize-case",
    "parse-date",
    "remove-columns",
  ]);
});
