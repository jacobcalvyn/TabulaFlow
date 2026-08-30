import test from "node:test";
import assert from "node:assert/strict";
import {
  CALCULATION_CATALOG,
  compileFormula,
  FORMULA_EXPRESSION_VERSION,
  quoteFormulaColumnReference,
  validateFormula,
} from "../src/formulaEngine.js";
import { compileRecipe, createStep } from "../src/transformations.js";

const schema = [
  { name: "Amount", type: "DOUBLE" },
  { name: "Category", type: "VARCHAR" },
  { name: "Active", type: "BOOLEAN" },
  { name: "Odd]name", type: "VARCHAR" },
  { name: "Created at", type: "TIMESTAMP" },
  { name: "Delivered at", type: "DATE" },
];

test("compiles a typed conditional formula through an allowlisted AST", () => {
  const result = compileFormula("CASE WHEN [Amount] >= 1000 AND [Active] THEN upper(trim([Category])) ELSE 'Standard' END", schema);
  assert.equal(result.inferredType, "VARCHAR");
  assert.deepEqual(result.referencedColumns, ["Amount", "Active", "Category"]);
  assert.match(result.sql, /^\(CASE WHEN/);
  assert.match(result.sql, /UPPER\(TRIM\("Category"\)\)/);
});

test("supports safe casts, null handling, and escaped column references", () => {
  const reference = quoteFormulaColumnReference("Odd]name");
  assert.equal(reference, "[Odd]]name]");
  const result = compileFormula(`coalesce(try_cast(${reference} AS DOUBLE), 0)`, schema);
  assert.equal(result.inferredType, "DOUBLE");
  assert.match(result.sql, /TRY_CAST\("Odd]name" AS DOUBLE\)/);
});

test("rejects raw identifiers, unknown functions, missing columns, and incompatible branches", () => {
  for (const expression of [
    "Amount + 1",
    "regexp_extract([Category], 'x')",
    "[Missing] + 1",
    "CASE WHEN [Active] THEN [Amount] ELSE [Category] END",
  ]) {
    const result = validateFormula(expression, schema);
    assert.equal(result.valid, false, expression);
    assert.equal(result.diagnostics.length, 1);
    assert.ok(Number.isInteger(result.diagnostics[0].start));
  }
});

test("publishes a bounded calculation catalog", () => {
  assert.equal(CALCULATION_CATALOG.expressionVersion, FORMULA_EXPRESSION_VERSION);
  assert.equal(CALCULATION_CATALOG.functions.length, 40);
  assert.ok(CALCULATION_CATALOG.functions.some((item) => item.name === "try_cast"));
  assert.ok(!CALCULATION_CATALOG.functions.some((item) => item.name.includes("regex")));
  assert.equal(CALCULATION_CATALOG.functions.every((item) => item.example && item.description), true);
});

test("compiles the expanded deterministic text function catalog", () => {
  const cases = [
    ["left([Category], 2)", "VARCHAR", "LEFT"],
    ["right([Category], 2)", "VARCHAR", "RIGHT"],
    ["ltrim([Category])", "VARCHAR", "LTRIM"],
    ["rtrim([Category])", "VARCHAR", "RTRIM"],
    ["nullif([Category], '')", "VARCHAR", "NULLIF"],
    ["contains([Category], 'x')", "BOOLEAN", "CONTAINS"],
    ["starts_with([Category], 'x')", "BOOLEAN", "STARTS_WITH"],
    ["ends_with([Category], 'x')", "BOOLEAN", "ENDS_WITH"],
    ["split_part([Category], '-', 2)", "VARCHAR", "SPLIT_PART"],
    ["lpad([Category], 8, '0')", "VARCHAR", "LPAD"],
    ["rpad([Category], 8, '0')", "VARCHAR", "RPAD"],
    ["repeat([Category], 2)", "VARCHAR", "REPEAT"],
    ["reverse([Category])", "VARCHAR", "REVERSE"],
  ];
  for (const [expression, inferredType, sqlFunction] of cases) {
    const result = compileFormula(expression, schema);
    assert.equal(result.inferredType, inferredType, expression);
    assert.match(result.sql, new RegExp(`^${sqlFunction}\\(`), expression);
  }
});

test("compiles the expanded deterministic numeric function catalog", () => {
  const cases = [
    ["abs([Amount])", "DOUBLE", "ABS"],
    ["round([Amount], 2)", "DOUBLE", "ROUND"],
    ["floor([Amount])", "DOUBLE", "FLOOR"],
    ["ceil([Amount])", "DOUBLE", "CEIL"],
    ["greatest([Amount], 1)", "DOUBLE", "GREATEST"],
    ["least([Amount], 1)", "DOUBLE", "LEAST"],
    ["power([Amount], 2)", "DOUBLE", "POWER"],
    ["sqrt([Amount])", "DOUBLE", "SQRT"],
    ["sign([Amount])", "BIGINT", "SIGN"],
  ];
  for (const [expression, inferredType, sqlFunction] of cases) {
    const result = compileFormula(expression, schema);
    assert.equal(result.inferredType, inferredType, expression);
    assert.match(result.sql, new RegExp(`^${sqlFunction}\\(`), expression);
  }
});

test("compiles deterministic date functions and safely rewrites DATE_ADD", () => {
  const cases = [
    ["year([Created at])", "BIGINT", `YEAR("Created at")`],
    ["month([Created at])", "BIGINT", `MONTH("Created at")`],
    ["day([Delivered at])", "BIGINT", `DAY("Delivered at")`],
    ["date_trunc('month', [Created at])", "TIMESTAMP", `DATE_TRUNC('month', "Created at")`],
    ["date_diff('day', [Delivered at], [Created at])", "BIGINT", `DATE_DIFF('day', "Delivered at", "Created at")`],
    ["date_add('week', 2, [Created at])", "TIMESTAMP", `DATE_ADD("Created at", (2) * INTERVAL '1 week')`],
  ];
  for (const [expression, inferredType, sql] of cases) {
    const result = compileFormula(expression, schema);
    assert.equal(result.inferredType, inferredType, expression);
    assert.equal(result.sql, sql, expression);
  }
  assert.equal(validateFormula("date_add([Category], 1, [Created at])", schema).diagnostics[0].code, "INVALID_DATE_PART");
  assert.equal(validateFormula("year([Category])", schema).diagnostics[0].code, "TYPE_MISMATCH");
});

test("compiles a create-only calculated-field recipe step", () => {
  const step = createStep("calculated-field", {
    outputColumn: "Amount doubled",
    expression: "[Amount] * 2",
    expressionVersion: FORMULA_EXPRESSION_VERSION,
  });
  const compiled = compileRecipe([step], ["Amount", "Category"]);
  assert.deepEqual(compiled.columns, ["Amount", "Category", "Amount doubled"]);
  assert.match(compiled.sql, /AS "Amount doubled"/);
  assert.throws(
    () => compileRecipe([{ ...step, params: { ...step.params, outputColumn: "Amount" } }], ["Amount", "Category"]),
    /sudah ada/,
  );
});

test("recipe compilation uses source column types for formula validation", () => {
  const numeric = createStep("calculated-field", {
    outputColumn: "Amount doubled",
    expression: "[Amount] * 2",
    expressionVersion: FORMULA_EXPRESSION_VERSION,
  });
  const compiled = compileRecipe([numeric], [{ name: "Amount", type: "DOUBLE" }, { name: "Category", type: "VARCHAR" }]);
  assert.equal(compiled.columnTypes["Amount doubled"], "DOUBLE");
  assert.throws(() => compileRecipe([{ ...numeric, params: { ...numeric.params, expression: "[Category] * 2" } }], [
    { name: "Amount", type: "DOUBLE" },
    { name: "Category", type: "VARCHAR" },
  ]), /Arithmetic operands must be numeric/);
});
