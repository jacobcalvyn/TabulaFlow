import assert from "node:assert/strict";
import test from "node:test";
import { activatePreparedForFlow } from "../src/preparedActivation.js";

function composeFixture() {
  return {
    graph: { revision: 4 },
    prepared: { id: "prepared-output", name: "Join 1 prepared" },
    source: {
      id: "source-output",
      location: "compose-result",
      upstreamNodeId: "join-1",
    },
  };
}

test("materializes a missing Compose result before activating its Prepared Input", async () => {
  const calls = [];
  let activationCount = 0;
  const worker = {
    async activatePrepared(preparedId, filters, aggregateColumns) {
      calls.push(["activate", preparedId, filters, aggregateColumns]);
      activationCount += 1;
      if (activationCount === 1) throw Object.assign(new Error("Source required"), { code: "SOURCE_REQUIRED" });
      return { filename: "Join 1 prepared", columns: ["id"] };
    },
    async materializeComposePrepared(graph, nodeId, identifiers) {
      calls.push(["materialize", graph, nodeId, identifiers]);
    },
  };
  const fixture = composeFixture();

  const result = await activatePreparedForFlow({
    worker,
    ...fixture,
    filters: { status: "open" },
    aggregateColumns: ["id"],
  });

  assert.equal(result.filename, "Join 1 prepared");
  assert.deepEqual(calls, [
    ["activate", "prepared-output", { status: "open" }, ["id"]],
    ["materialize", fixture.graph, "join-1", {
      sourceId: "source-output",
      preparedId: "prepared-output",
      filename: "Join 1 prepared",
    }],
    ["activate", "prepared-output", { status: "open" }, ["id"]],
  ]);
});

test("does not hide a missing local source behind Compose materialization", async () => {
  let materialized = false;
  const failure = Object.assign(new Error("Source required"), { code: "SOURCE_REQUIRED" });
  const worker = {
    async activatePrepared() {
      throw failure;
    },
    async materializeComposePrepared() {
      materialized = true;
    },
  };

  await assert.rejects(() => activatePreparedForFlow({
    worker,
    graph: {},
    prepared: { id: "prepared-local", name: "Orders" },
    source: { id: "source-local", location: "local-device" },
  }), failure);
  assert.equal(materialized, false);
});

test("does not retry unrelated activation failures", async () => {
  let materialized = false;
  const failure = Object.assign(new Error("Invalid recipe"), { code: "INVALID_RECIPE" });
  const fixture = composeFixture();
  const worker = {
    async activatePrepared() {
      throw failure;
    },
    async materializeComposePrepared() {
      materialized = true;
    },
  };

  await assert.rejects(() => activatePreparedForFlow({ worker, ...fixture }), failure);
  assert.equal(materialized, false);
});
