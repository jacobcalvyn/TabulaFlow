import assert from "node:assert/strict";
import test from "node:test";
import {
  addComposeNode,
  addPreparedInput,
  autoArrangeNodePositions,
  collectDescendantNodeIds,
  consolidateDuplicateFileSources,
  createFlowGraph,
  createPreparedInput,
  createPreparedFromCompose,
  createPreparedFromGeneratedRows,
  duplicatePreparedInput,
  findMatchingFileSource,
  getAncestors,
  getDescendants,
  hydrateComposeSchemas,
  isFlowFileSource,
  markSourcesUnlinked,
  matchesSourceReference,
  removeComposeNode,
  removeBuiltInDemoData,
  removePreparedInput,
  repairOverlappingNodePositions,
  updateComposeNode,
  updateNodePosition,
  validateFlowGraph,
} from "../src/flowModel.js";

test("new flows include persistent qualitative coding projects", () => {
  const graph = createFlowGraph();
  assert.equal(graph.schemaVersion, 3);
  assert.deepEqual(graph.codingProjects, []);
});

test("accepted coding rows become an independent prepared dataset without changing selection", () => {
  const graph = createFlowGraph();
  const result = createPreparedFromGeneratedRows(graph, {
    name: "Survey coding reviewed",
    schema: [{ name: "response_id", type: "VARCHAR" }, { name: "code", type: "VARCHAR" }],
    rowCount: 4,
    codingProjectId: "coding-a",
  });
  assert.equal(result.graph.activeNodeId, graph.activeNodeId);
  assert.equal(result.sourceAsset.location, "coding-result");
  assert.equal(result.sourceAsset.codingProjectId, "coding-a");
  assert.equal(result.preparedInput.rowCount, 4);
});
import {
  PREPARED_RECIPE_STATUS,
  recipeForExecution,
  recipeStatusAfterRelink,
  shouldPromptForPreparedRecipe,
} from "../src/preparedRecipeState.js";
import { collectSourceColumns } from "../src/sourceInspection.js";

function prepared(name, columns = ["id"]) {
  return createPreparedInput(
    { kind: "local", size: 10, lastModified: 20 },
    { filename: `${name}.csv`, sourceColumns: columns, columns, columnTypes: Object.fromEntries(columns.map((column) => [column, "VARCHAR"])) },
  );
}

test("duplicates a prepared input without duplicating its source asset and with independent step ids", () => {
  const created = prepared("orders");
  created.preparedInput.recipe = [{ id: "shared-step", type: "trim", params: { column: "id" } }];
  const graph = addPreparedInput(createFlowGraph(), created.sourceAsset, created.preparedInput);
  const duplicated = duplicatePreparedInput(graph, created.preparedInput.id);
  assert.equal(duplicated.graph.sourceAssets.length, 1);
  assert.equal(duplicated.graph.preparedInputs.length, 2);
  assert.equal(duplicated.preparedInput.sourceAssetId, created.preparedInput.sourceAssetId);
  assert.notEqual(duplicated.preparedInput.recipe, created.preparedInput.recipe);
  assert.equal(duplicated.preparedInput.recipe[0].type, "trim");
  assert.notEqual(duplicated.preparedInput.recipe[0].id, "shared-step");
  assert.equal(duplicated.graph.activeNodeId, graph.activeNodeId);
  assert.deepEqual(duplicated.preparedInput.position, {
    x: created.preparedInput.position.x + 320,
    y: created.preparedInput.position.y,
  });
});

test("new flows persist a monotonic workspace revision field", () => {
  const graph = createFlowGraph();
  assert.equal(graph.workspaceRevision, 0);
  const source = prepared("orders");
  const next = addPreparedInput(graph, source.sourceAsset, source.preparedInput);
  assert.equal(next.workspaceRevision, 0);
});

test("promoting a prepared dataset returns an operation-kind diagnostic", () => {
  const source = prepared("orders");
  const graph = addPreparedInput(createFlowGraph(), source.sourceAsset, source.preparedInput);
  assert.throws(
    () => createPreparedFromCompose(graph, source.preparedInput.id),
    (error) => error.code === "OPERATION_NODE_REQUIRED" && error.actualKind === "prepared-dataset",
  );
});

test("keeps a restored recipe out of execution until the user applies it", () => {
  const storedRecipe = [{ id: "trim-id", type: "trim", params: { column: "id" } }];
  const preparedInput = {
    recipe: storedRecipe,
    recipeStatus: recipeStatusAfterRelink(storedRecipe),
  };

  assert.equal(preparedInput.recipeStatus, PREPARED_RECIPE_STATUS.PENDING);
  assert.deepEqual(recipeForExecution(preparedInput, []), []);
  assert.equal(shouldPromptForPreparedRecipe(preparedInput, []), true);
});

test("keeps an ignored recipe stored without executing or prompting for it", () => {
  const storedRecipe = [{ id: "trim-id", type: "trim", params: { column: "id" } }];
  const preparedInput = {
    recipe: storedRecipe,
    recipeStatus: PREPARED_RECIPE_STATUS.IGNORED,
  };

  assert.deepEqual(recipeForExecution(preparedInput, []), []);
  assert.equal(shouldPromptForPreparedRecipe(preparedInput, []), false);
  assert.deepEqual(preparedInput.recipe, storedRecipe);
});

test("keeps legacy prepared recipes executable when no lifecycle status exists", () => {
  const storedRecipe = [{ id: "trim-id", type: "trim", params: { column: "id" } }];
  assert.deepEqual(recipeForExecution({ recipe: storedRecipe }, []), storedRecipe);
});

test("collects source columns in first-seen order without mutating a worker registry", () => {
  assert.deepEqual(collectSourceColumns([
    { id: 1, customer: "A" },
    { customer: "B", amount: 10 },
    { id: 2, status: "open" },
  ]), ["id", "customer", "amount", "status"]);
});

test("places newly opened prepared inputs in non-overlapping vertical slots", () => {
  const first = prepared("orders");
  const second = prepared("customers");
  let graph = addPreparedInput(createFlowGraph(), first.sourceAsset, first.preparedInput);
  graph = addPreparedInput(graph, second.sourceAsset, second.preparedInput);

  assert.deepEqual(graph.preparedInputs[0].position, { x: 40, y: 52 });
  assert.deepEqual(graph.preparedInputs[1].position, { x: 40, y: 188 });
});

test("reuses one source asset when the same local file is opened again", () => {
  const first = prepared("orders");
  const second = prepared("orders");
  let graph = addPreparedInput(createFlowGraph(), first.sourceAsset, first.preparedInput);
  graph = addPreparedInput(graph, second.sourceAsset, second.preparedInput);

  assert.equal(graph.sourceAssets.length, 1);
  assert.equal(graph.preparedInputs.length, 2);
  assert.equal(graph.preparedInputs[1].sourceAssetId, first.sourceAsset.id);
  assert.equal(findMatchingFileSource(graph, { name: "orders.csv", size: 10, lastModified: 20 }, ["id"])?.id, first.sourceAsset.id);
});

test("consolidates duplicate persisted file sources without removing prepared branches", () => {
  const first = prepared("orders");
  const second = prepared("orders");
  const graph = {
    ...createFlowGraph(),
    sourceAssets: [first.sourceAsset, second.sourceAsset],
    preparedInputs: [first.preparedInput, second.preparedInput],
  };

  const consolidated = consolidateDuplicateFileSources(graph);
  assert.equal(consolidated.graph.sourceAssets.length, 1);
  assert.deepEqual(consolidated.graph.preparedInputs.map((item) => item.sourceAssetId), [first.sourceAsset.id, first.sourceAsset.id]);
  assert.equal(consolidated.sourceIdMap.get(second.sourceAsset.id), first.sourceAsset.id);
});

test("repairs overlapping prepared input positions restored from older flows", () => {
  const first = prepared("orders");
  const second = prepared("customers");
  const graph = {
    ...createFlowGraph(),
    sourceAssets: [first.sourceAsset, second.sourceAsset],
    preparedInputs: [
      { ...first.preparedInput, position: { x: 280, y: 80 } },
      { ...second.preparedInput, position: { x: 280, y: 80 } },
    ],
  };

  const repaired = repairOverlappingNodePositions(graph);
  assert.deepEqual(repaired.preparedInputs[0].position, { x: 280, y: 80 });
  assert.deepEqual(repaired.preparedInputs[1].position, { x: 280, y: 216 });
});

test("repairs overlapping Compose nodes without flattening their horizontal topology", () => {
  const source = prepared("orders");
  let graph = addPreparedInput(createFlowGraph(), source.sourceAsset, source.preparedInput);
  graph = addComposeNode(graph, {
    kind: "filter-rows",
    name: "Filter A",
    inputIds: [source.preparedInput.id],
    config: { conditions: [{ column: "id", operator: "is-not-null" }] },
    position: { x: 600, y: 80 },
  }).graph;
  graph = addComposeNode(graph, {
    kind: "distinct-rows",
    name: "Distinct B",
    inputIds: [source.preparedInput.id],
    config: { columns: ["id"] },
    position: { x: 610, y: 80 },
  }).graph;

  const repaired = repairOverlappingNodePositions(graph);
  assert.deepEqual(repaired.preparedInputs[0].position, { x: 40, y: 52 });
  assert.deepEqual(repaired.composeNodes[0].position, { x: 600, y: 80 });
  assert.deepEqual(repaired.composeNodes[1].position, { x: 610, y: 216 });
});

test("auto-arranges dependencies left to right and separates parallel branches", () => {
  const left = prepared("orders");
  const right = prepared("customers");
  let graph = addPreparedInput(createFlowGraph(), left.sourceAsset, left.preparedInput);
  graph = addPreparedInput(graph, right.sourceAsset, right.preparedInput);
  const joined = addComposeNode(graph, {
    kind: "join",
    name: "Joined",
    inputIds: [left.preparedInput.id, right.preparedInput.id],
    config: {},
    position: { x: 90, y: 90 },
  });
  const filtered = addComposeNode(joined.graph, {
    kind: "filter-rows",
    name: "Filtered",
    inputIds: [joined.node.id],
    config: { conditions: [{ column: "id", operator: "is-not-null" }] },
    position: { x: 90, y: 90 },
  });
  const distinct = addComposeNode(filtered.graph, {
    kind: "distinct-rows",
    name: "Distinct",
    inputIds: [joined.node.id],
    config: { columns: ["id"] },
    position: { x: 90, y: 90 },
  });

  const arranged = autoArrangeNodePositions(distinct.graph);
  const positions = new Map([...arranged.preparedInputs, ...arranged.composeNodes].map((node) => [node.id, node.position]));
  assert.equal(positions.get(left.preparedInput.id).x, 40);
  assert.equal(positions.get(right.preparedInput.id).x, 40);
  assert.equal(positions.get(joined.node.id).x, 360);
  assert.equal(positions.get(filtered.node.id).x, 680);
  assert.equal(positions.get(distinct.node.id).x, 680);
  assert.notEqual(positions.get(filtered.node.id).y, positions.get(distinct.node.id).y);
  assert.equal(arranged.revision, distinct.graph.revision + 1);
});

test("creates an independent prepared dataset from a Compose result", () => {
  const left = prepared("orders");
  const right = prepared("customers");
  let graph = addPreparedInput(createFlowGraph(), left.sourceAsset, left.preparedInput);
  graph = addPreparedInput(graph, right.sourceAsset, right.preparedInput);
  const joined = addComposeNode(graph, {
    kind: "join",
    name: "Orders joined",
    inputIds: [left.preparedInput.id, right.preparedInput.id],
    config: {},
    schema: [{ name: "id_left", type: "VARCHAR" }],
    position: { x: 600, y: 120 },
  });
  const created = createPreparedFromCompose(joined.graph, joined.node.id);

  assert.equal(created.sourceAsset.location, "compose-result");
  assert.equal(created.sourceAsset.upstreamNodeId, joined.node.id);
  assert.equal(created.preparedInput.name, "Orders joined prepared");
  assert.deepEqual(created.preparedInput.recipe, []);
  assert.deepEqual(created.preparedInput.schema.map(({ name, type }) => ({ name, type })), [{ name: "id_left", type: "VARCHAR" }]);
  assert.equal(created.preparedInput.schema[0].semantic.provenance.nodeId, joined.node.id);
  assert.deepEqual(created.preparedInput.position, { x: 920, y: 120 });
  assert.equal(created.graph.activeNodeId, created.preparedInput.id);
  assert.equal(isFlowFileSource(created.sourceAsset), false);
  assert.equal(isFlowFileSource(left.sourceAsset), true);
});

test("tracks ancestors and descendants in dependency order", () => {
  const left = prepared("left");
  const right = prepared("right");
  let graph = addPreparedInput(createFlowGraph(), left.sourceAsset, left.preparedInput);
  graph = addPreparedInput(graph, right.sourceAsset, right.preparedInput);
  const joined = addComposeNode(graph, { kind: "join", name: "Joined", inputIds: [left.preparedInput.id, right.preparedInput.id], config: {} });
  const appended = addComposeNode(joined.graph, { kind: "append", name: "Result", inputIds: [joined.node.id, left.preparedInput.id], config: {} });
  assert.deepEqual(getAncestors(appended.graph, appended.node.id), [left.preparedInput.id, right.preparedInput.id, joined.node.id, appended.node.id]);
  assert.deepEqual(getDescendants(appended.graph, left.preparedInput.id), [joined.node.id, appended.node.id]);
});

test("hydrates Compose schemas from prepared metadata before the canvas renders", () => {
  const left = prepared("left", ["id", "left_value"]);
  const right = prepared("right", ["id", "right_value"]);
  let graph = addPreparedInput(createFlowGraph(), left.sourceAsset, left.preparedInput);
  graph = addPreparedInput(graph, right.sourceAsset, right.preparedInput);
  const joined = addComposeNode(graph, {
    kind: "join",
    name: "Joined",
    inputIds: [left.preparedInput.id, right.preparedInput.id],
    config: {
      joinType: "inner",
      collisionPolicy: "suffix",
      keyPairs: [{ left: "id", right: "id" }],
      leftSuffix: "_left",
      rightSuffix: "_right",
    },
    schema: [],
  });

  const result = hydrateComposeSchemas(joined.graph);
  const schema = result.graph.composeNodes[0].schema;
  assert.deepEqual(schema.map((column) => column.name), ["id_left", "left_value", "id_right", "right_value"]);
  assert.equal(result.graph.composeNodes[0].validationStatus, "valid");
  assert.deepEqual(result.unresolvedNodeIds, []);
});

test("schema hydration preserves stale Compose nodes until worker evaluation succeeds", () => {
  const input = prepared("input", ["id", "status"]);
  const graph = addPreparedInput(createFlowGraph(), input.sourceAsset, input.preparedInput);
  const filtered = addComposeNode(graph, {
    kind: "filter-rows",
    name: "Stale filter",
    inputIds: [input.preparedInput.id],
    config: { conjunction: "and", conditions: [{ column: "status", operator: "equals", value: "open" }] },
    schema: [],
    validationStatus: "needs-validation",
    dataStatus: "stale",
  });
  const node = hydrateComposeSchemas(filtered.graph).graph.composeNodes[0];
  assert.equal(node.validationStatus, "needs-validation");
  assert.equal(node.dataStatus, "stale");
  assert.deepEqual(node.schema.map((column) => column.name), ["id", "status"]);
});

test("preserves the last valid Compose schema while an operation is invalid", () => {
  const input = prepared("input", ["id", "status"]);
  const graph = addPreparedInput(createFlowGraph(), input.sourceAsset, input.preparedInput);
  const lastValidSchema = [{ name: "id", type: "VARCHAR" }, { name: "status", type: "VARCHAR" }];
  const filtered = addComposeNode(graph, {
    kind: "filter-rows",
    name: "Invalid filter",
    inputIds: [input.preparedInput.id],
    config: { conjunction: "and", conditions: [{ column: "missing", operator: "equals", value: "open" }] },
    schema: [],
    lastValidSchema,
    validationStatus: "needs-validation",
    dataStatus: "stale",
  });

  const result = hydrateComposeSchemas(filtered.graph);
  const node = result.graph.composeNodes[0];
  assert.deepEqual(node.schema, lastValidSchema);
  assert.deepEqual(node.lastValidSchema, lastValidSchema);
  assert.equal(node.validationStatus, "invalid");
  assert.equal(node.dataStatus, "error");
  assert.match(node.validationError, /missing/i);
});

test("relink invalidation includes descendants of every prepared copy of a source", () => {
  const left = prepared("left");
  const right = prepared("right");
  let graph = addPreparedInput(createFlowGraph(), left.sourceAsset, left.preparedInput);
  const duplicated = duplicatePreparedInput(graph, left.preparedInput.id);
  graph = addPreparedInput(duplicated.graph, right.sourceAsset, right.preparedInput);
  const primaryJoin = addComposeNode(graph, {
    kind: "join",
    name: "Primary join",
    inputIds: [left.preparedInput.id, right.preparedInput.id],
    config: {},
  });
  const copyJoin = addComposeNode(primaryJoin.graph, {
    kind: "join",
    name: "Copy join",
    inputIds: [duplicated.preparedInput.id, right.preparedInput.id],
    config: {},
  });
  const invalidated = collectDescendantNodeIds(copyJoin.graph, [left.preparedInput.id, duplicated.preparedInput.id]);
  assert.equal(invalidated.has(primaryJoin.node.id), true);
  assert.equal(invalidated.has(copyJoin.node.id), true);
});

test("rejects missing inputs and graph cycles", () => {
  const graph = createFlowGraph();
  assert.throws(() => addComposeNode(graph, { kind: "append", inputIds: ["missing"] }), /tidak tersedia/);
  const cyclic = { ...graph, composeNodes: [{ id: "a", inputIds: ["b"] }, { id: "b", inputIds: ["a"] }] };
  assert.throws(() => validateFlowGraph(cyclic), /siklus/);
});

test("enforces unary and binary Compose operation arity", () => {
  const left = prepared("left");
  const right = prepared("right");
  let graph = addPreparedInput(createFlowGraph(), left.sourceAsset, left.preparedInput);
  graph = addPreparedInput(graph, right.sourceAsset, right.preparedInput);

  const aggregated = addComposeNode(graph, {
    kind: "aggregate",
    inputIds: [left.preparedInput.id],
    config: { groupBy: ["id"], aggregate: "count", alias: "row_count" },
  });
  assert.equal(aggregated.node.kind, "aggregate");
  assert.throws(() => addComposeNode(graph, {
    kind: "filter-rows",
    inputIds: [left.preparedInput.id, right.preparedInput.id],
    config: {},
  }), /tepat satu input/);

  const difference = addComposeNode(graph, {
    kind: "difference",
    inputIds: [left.preparedInput.id, right.preparedInput.id],
    config: { leftKey: "id", rightKey: "id", mode: "left" },
  });
  assert.equal(difference.node.kind, "difference");
  assert.throws(() => addComposeNode(graph, {
    kind: "difference",
    inputIds: [left.preparedInput.id],
    config: {},
  }), /tepat dua input/);
});

test("restored browser sources wait for automatic relink while non-file sources stay linked", () => {
  const created = prepared("orders");
  const composeSource = { ...created.sourceAsset, id: "compose-source", location: "compose-result" };
  const graph = {
    ...addPreparedInput(createFlowGraph(), created.sourceAsset, created.preparedInput),
    sourceAssets: [created.sourceAsset, composeSource],
  };
  const restored = markSourcesUnlinked(graph);
  assert.equal(restored.sourceAssets[0].status, "restoring");
  assert.equal(restored.sourceAssets[1].status, "linked");
  assert.equal(matchesSourceReference(restored.sourceAssets[0], { name: "orders.csv", size: 10, lastModified: 20 }, ["id"]), true);
});

test("removes persisted built-in demo data and every downstream result", () => {
  const demo = createPreparedInput(
    { kind: "demo" },
    { filename: "sample.xlsx", sourceColumns: ["id"], columns: ["id"], columnTypes: { id: "VARCHAR" } },
  );
  const local = prepared("orders");
  let graph = addPreparedInput(createFlowGraph(), demo.sourceAsset, demo.preparedInput);
  graph = addPreparedInput(graph, local.sourceAsset, local.preparedInput);
  const joined = addComposeNode(graph, {
    kind: "join",
    inputIds: [demo.preparedInput.id, local.preparedInput.id],
    schema: [{ name: "id", type: "VARCHAR" }],
  });
  const materialized = createPreparedFromCompose(joined.graph, joined.node.id);

  const cleaned = removeBuiltInDemoData(materialized.graph);

  assert.deepEqual(cleaned.sourceAssets.map((source) => source.id), [local.sourceAsset.id]);
  assert.deepEqual(cleaned.preparedInputs.map((item) => item.id), [local.preparedInput.id]);
  assert.deepEqual(cleaned.composeNodes, []);
  assert.equal(cleaned.activeNodeId, local.preparedInput.id);
});

test("updates operation configuration and persists canvas positions", () => {
  const left = prepared("left");
  const right = prepared("right");
  let graph = addPreparedInput(createFlowGraph(), left.sourceAsset, left.preparedInput);
  graph = addPreparedInput(graph, right.sourceAsset, right.preparedInput);
  const joined = addComposeNode(graph, { kind: "join", name: "Joined", inputIds: [left.preparedInput.id, right.preparedInput.id], config: {} });

  const updated = updateComposeNode(joined.graph, joined.node.id, { name: "Orders with customers", config: { joinType: "left" } });
  assert.equal(updated.node.id, joined.node.id);
  assert.equal(updated.node.name, "Orders with customers");
  assert.equal(updated.node.config.joinType, "left");

  const movedDataset = updateNodePosition(updated.graph, left.preparedInput.id, { x: 151.4, y: 88.8 });
  const movedOperation = updateNodePosition(movedDataset, joined.node.id, { x: 612, y: 174 });
  assert.deepEqual(movedOperation.preparedInputs.find((node) => node.id === left.preparedInput.id).position, { x: 151, y: 89 });
  assert.deepEqual(movedOperation.composeNodes.find((node) => node.id === joined.node.id).position, { x: 612, y: 174 });

  const clamped = updateNodePosition(movedOperation, joined.node.id, { x: Number.POSITIVE_INFINITY, y: 1000000 });
  assert.deepEqual(clamped.composeNodes.find((node) => node.id === joined.node.id).position, { x: 40, y: 32000 });
});

test("deletes only leaf Compose operations", () => {
  const left = prepared("left");
  const right = prepared("right");
  let graph = addPreparedInput(createFlowGraph(), left.sourceAsset, left.preparedInput);
  graph = addPreparedInput(graph, right.sourceAsset, right.preparedInput);
  const joined = addComposeNode(graph, { kind: "join", name: "Joined", inputIds: [left.preparedInput.id, right.preparedInput.id], config: {} });
  const appended = addComposeNode(joined.graph, { kind: "append", name: "Result", inputIds: [joined.node.id, left.preparedInput.id], config: {} });

  assert.throws(() => removeComposeNode(appended.graph, joined.node.id), (error) => error.code === "COMPOSE_NODE_HAS_DESCENDANTS");
  const withoutAppend = removeComposeNode(appended.graph, appended.node.id);
  assert.equal(withoutAppend.graph.composeNodes.length, 1);
  assert.equal(withoutAppend.graph.activeNodeId, joined.node.id);
  const withoutJoin = removeComposeNode(withoutAppend.graph, joined.node.id);
  assert.equal(withoutJoin.graph.composeNodes.length, 0);
  assert.equal(withoutJoin.graph.activeNodeId, left.preparedInput.id);
});

test("deletes only leaf prepared inputs and preserves shared sources", () => {
  const left = prepared("left");
  const right = prepared("right");
  let graph = addPreparedInput(createFlowGraph(), left.sourceAsset, left.preparedInput);
  const duplicated = duplicatePreparedInput(graph, left.preparedInput.id);
  graph = addPreparedInput(duplicated.graph, right.sourceAsset, right.preparedInput);
  const joined = addComposeNode(graph, {
    kind: "join",
    name: "Joined",
    inputIds: [left.preparedInput.id, right.preparedInput.id],
    config: {},
  });

  assert.throws(() => removePreparedInput(joined.graph, left.preparedInput.id), (error) => error.code === "PREPARED_INPUT_HAS_DESCENDANTS");
  const withoutCopy = removePreparedInput(joined.graph, duplicated.preparedInput.id);
  assert.equal(withoutCopy.graph.preparedInputs.length, 2);
  assert.equal(withoutCopy.graph.sourceAssets.some((source) => source.id === left.sourceAsset.id), true);
});
