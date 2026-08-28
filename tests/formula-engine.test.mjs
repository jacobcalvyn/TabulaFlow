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
  assert.ok(CALCULATION_CATALOG.functions.some((item) => item.name === "try_cast"));
  assert.ok(!CALCULATION_CATALOG.functions.some((item) => item.name.includes("regex")));
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
