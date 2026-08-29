import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRecoveryPlan,
  createWorkerRegistry,
  forgetPrepared,
  rememberActivePrepared,
  rememberLoadedSource,
  rememberPreparedCopy,
} from "../src/workerRecovery.js";

const recipeA = [{ id: "trim-a", type: "trim", params: { column: "id" } }];
const recipeCopy = [{ id: "trim-copy", type: "trim", params: { column: "city" } }];

function twoSourcesWithCopy() {
  let registry = createWorkerRegistry();
  registry = rememberLoadedSource(registry, {
    sourceId: "source-orders",
    origin: "file",
    payload: { file: { name: "orders.csv" } },
    primaryPreparedId: "prepared-orders",
    aggregateColumns: ["id"],
  });
  registry = rememberPreparedRecipe(registry, "prepared-orders", recipeA);
  registry = rememberPreparedCopy(registry, {
    preparedId: "prepared-orders-copy",
    sourcePreparedId: "prepared-orders",
    sourceId: "source-orders",
    recipe: recipeCopy,
  });
  registry = rememberLoadedSource(registry, {
    sourceId: "source-customers",
    origin: "file",
    payload: { file: { name: "customers.csv" } },
    primaryPreparedId: "prepared-customers",
    aggregateColumns: ["id"],
  });
  registry = rememberActivePrepared(registry, {
    preparedId: "prepared-orders-copy",
    recipe: recipeCopy,
    filters: { city: { key: "empty:", raw: null } },
    aggregateColumns: ["city"],
  });
  return registry;
}

function rememberPreparedRecipe(registry, preparedId, recipe) {
  return rememberActivePrepared(registry, {
    preparedId,
    recipe,
    filters: {},
    aggregateColumns: registry.aggregateColumns,
  });
}

test("recovery reloads every file source, re-registers copies, then restores the active prepared input", () => {
  const plan = buildRecoveryPlan(twoSourcesWithCopy());
  const types = plan.map((step) => step.type);
  assert.deepEqual(types, [
    "initialize",
    "load-file",
    "load-file",
    "register-prepared-copy",
    "register-prepared-copy",
    "register-prepared-copy",
    "activate-prepared",
  ]);

  const loads = plan.filter((step) => step.type === "load-file");
  assert.deepEqual(loads.map((step) => step.payload.sourceId), ["source-orders", "source-customers"]);
  assert.equal(loads[0].payload.preparedId, "prepared-orders");

  const copies = plan.filter((step) => step.type === "register-prepared-copy");
  assert.deepEqual(copies.map((step) => [step.payload.preparedId, step.payload.recipe[0]?.id ?? null]), [
    ["prepared-orders", "trim-a"],
    ["prepared-orders-copy", "trim-copy"],
    ["prepared-customers", null],
  ]);

  const activate = plan.at(-1);
  assert.equal(activate.payload.preparedId, "prepared-orders-copy");
  assert.deepEqual(activate.payload.filters, { city: { key: "empty:", raw: null } });
});

test("forgetting the last prepared input of a source drops that source from recovery", () => {
  let registry = rememberLoadedSource(createWorkerRegistry(), {
    sourceId: "source-orders",
    origin: "file",
    payload: { file: { name: "orders.csv" } },
    primaryPreparedId: "prepared-orders",
  });
  registry = rememberPreparedCopy(registry, {
    preparedId: "prepared-orders-copy",
    sourcePreparedId: "prepared-orders",
    recipe: recipeCopy,
  });
  registry = forgetPrepared(registry, "prepared-orders-copy");
  assert.equal(registry.sources.has("source-orders"), true);
  registry = forgetPrepared(registry, "prepared-orders");
  assert.equal(registry.sources.has("source-orders"), false);
  assert.deepEqual(buildRecoveryPlan(registry).map((step) => step.type), ["initialize"]);
});

test("forgetting a primary promotes a sibling without losing its recipe", () => {
  let registry = twoSourcesWithCopy();
  registry = forgetPrepared(registry, "prepared-orders");
  const source = registry.sources.get("source-orders");
  const promoted = registry.preparedInputs.get("prepared-orders-copy");
  assert.equal(source.primaryPreparedId, "prepared-orders-copy");
  assert.equal(source.payload.preparedId, "prepared-orders-copy");
  assert.equal(promoted.sourcePreparedId, "prepared-orders-copy");
  assert.equal(promoted.kind, "primary");
  assert.deepEqual(promoted.recipe, recipeCopy);
  const plan = buildRecoveryPlan(registry);
  assert.equal(plan.find((step) => step.type === "load-file" && step.payload.sourceId === "source-orders").payload.preparedId, "prepared-orders-copy");
  assert.deepEqual(plan.find((step) => step.type === "register-prepared-copy" && step.payload.preparedId === "prepared-orders-copy").payload.recipe, recipeCopy);
});

test("reloading a known source preserves sibling recipes until registration completes", () => {
  const registry = rememberLoadedSource(twoSourcesWithCopy(), {
    sourceId: "source-orders",
    origin: "file",
    payload: { file: { name: "orders.csv" }, preparedId: "prepared-orders" },
    primaryPreparedId: "prepared-orders",
    aggregateColumns: ["id"],
  });
  assert.deepEqual(registry.preparedInputs.get("prepared-orders").recipe, recipeA);
  assert.deepEqual(registry.preparedInputs.get("prepared-orders-copy").recipe, recipeCopy);
});
