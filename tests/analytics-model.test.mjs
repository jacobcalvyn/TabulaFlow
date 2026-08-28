import assert from "node:assert/strict";
import test from "node:test";
import { compileAnalysis } from "../src/analysisEngine.js";
import { createSemanticModel, updateSemanticField } from "../src/semanticModel.js";
import { compileValidationCondition, qualityGateStatus } from "../src/validationEngine.js";

const schema = [{ name: "status", type: "VARCHAR" }, { name: "amount", type: "DOUBLE" }, { name: "expected", type: "DOUBLE" }];

test("semantic model constrains aggregations by business role", () => {
  const model = createSemanticModel("prepared-a", schema);
  const identifier = updateSemanticField(model, "status", { role: "identifier", sensitivity: "internal", allowedAggregations: ["count", "count-distinct"] });
  assert.throws(() => updateSemanticField(identifier, "status", { allowedAggregations: ["sum"] }), /Only measures/);
  assert.equal(identifier.revision, 2);
});

test("validation compiler supports cross-field and conditional rules", () => {
  const sql = compileValidationCondition({ all: [
    { field: "status", operator: "equals", value: "failed" },
    { field: "amount", operator: "not-equals", rightField: "expected" },
  ] }, schema);
  assert.match(sql, /"status" IS NOT DISTINCT FROM 'failed'/);
  assert.match(sql, /"amount" IS DISTINCT FROM "expected"/);
});

test("quality gate blocks open critical findings but permits audited exceptions", () => {
  const rules = [{ id: "r1", enabled: true, severity: "critical", exception: null }];
  const results = [{ ruleId: "r1", impactedCount: 3 }];
  assert.equal(qualityGateStatus(rules, results), "issues-found");
  assert.equal(qualityGateStatus([{ ...rules[0], exception: { reason: "Known source limitation" } }], results), "ready-with-exceptions");
});

test("analysis compiler enforces semantic aggregations", () => {
  const model = createSemanticModel("prepared-a", schema);
  const compiled = compileAnalysis({ dimensions: ["status"], metrics: [{ function: "sum", column: "amount", alias: "total_amount" }] }, schema, model);
  assert.match(compiled.sql, /SUM\("amount"\) AS "total_amount"/);
  assert.match(compiled.sql, /GROUP BY "status"/);
  assert.throws(() => compileAnalysis({ dimensions: [], metrics: [{ function: "sum", column: "status", alias: "bad" }] }, schema, model), /not allowed/);
  const identifying = updateSemanticField(model, "status", { role: "identifier", sensitivity: "pii", allowedAggregations: ["count", "count-distinct"] });
  assert.throws(() => compileAnalysis({ dimensions: ["status"], metrics: [{ function: "count", alias: "rows" }] }, schema, identifying), /identifying or sensitive/);
});
