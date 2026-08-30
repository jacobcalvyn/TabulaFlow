import assert from "node:assert/strict";
import test from "node:test";
import { composeNodeSummaryForAgent, paginateAgentSchema } from "../src/webMcpDto.js";

test("Compose graph summaries exclude recipes and full schemas", () => {
  const node = {
    id: "prepared-a",
    name: "Orders",
    kind: "dataset",
    rowCount: 10,
    schema: Array.from({ length: 1000 }, (_, index) => ({ name: `column_${index}`, type: "VARCHAR" })),
    recipe: [{ id: "step-a", type: "replace-value", params: { from: "secret", to: "hidden" } }],
    sourceAssetId: "source-a",
    position: { x: 10, y: 20 },
  };
  const summary = composeNodeSummaryForAgent(node, "dataset");
  assert.equal(summary.columnCount, 1000);
  assert.equal(Object.hasOwn(summary, "schema"), false);
  assert.equal(Object.hasOwn(summary, "recipe"), false);
  assert.equal(JSON.stringify(summary).includes("secret"), false);
});

test("Compose graph summaries expose factual blocked execution state", () => {
  const summary = composeNodeSummaryForAgent({
    id: "operation-a",
    name: "Aggregate",
    kind: "aggregate",
    inputIds: ["prepared-a"],
    dataStatus: "ready",
    schema: [],
  }, "operation", {
    executable: false,
    status: "blocked",
    blockedReason: "SOURCE_RELINK_REQUIRED",
    requiredAction: "relink-source",
    sourceAssetIds: ["source-a"],
    blockedDependencyIds: ["prepared-a"],
  });

  assert.equal(summary.status, "blocked");
  assert.equal(summary.executable, false);
  assert.equal(summary.blockedReason, "SOURCE_RELINK_REQUIRED");
  assert.deepEqual(summary.sourceAssetIds, ["source-a"]);
});

test("Compose schema reads are deterministic and bounded", () => {
  const schema = Array.from({ length: 1000 }, (_, index) => ({ name: `column_${index}`, type: "VARCHAR" }));
  const page = paginateAgentSchema(schema, { offset: 100, limit: 500 });
  assert.equal(page.columns.length, 100);
  assert.equal(page.columns[0].name, "column_100");
  assert.equal(page.totalColumnCount, 1000);
  assert.equal(page.hasMore, true);
  assert.equal(page.nextOffset, 200);
});
