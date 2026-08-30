import assert from "node:assert/strict";
import test from "node:test";
import { createWebMcpMutationRunner } from "../src/webMcpMutation.js";

test("rejects stale WebMCP mutations before execution", async () => {
  let executed = false;
  const run = createWebMcpMutationRunner({ getRevision: () => 4 });
  await assert.rejects(
    () => run({ expectedRevision: 3, requestId: "stale-001" }, async () => { executed = true; }, "filter:a"),
    (error) => error.code === "STALE_STATE" && /Expected revision 4/.test(error.message),
  );
  assert.equal(executed, false);
});

test("deduplicates concurrent retries and returns the committed revision", async () => {
  let revision = 2;
  let executions = 0;
  const run = createWebMcpMutationRunner({ getRevision: () => revision });
  const execute = async () => {
    executions += 1;
    revision += 1;
    return { changed: true };
  };
  const meta = { expectedRevision: 2, requestId: "retry-001" };
  const [first, second] = await Promise.all([run(meta, execute, "recipe:add:a"), run(meta, execute, "recipe:add:a")]);
  assert.equal(executions, 1);
  assert.deepEqual(first, { changed: true, workspaceRevision: 3 });
  assert.deepEqual(second, first);
});

test("serializes distinct mutations so only the first matching revision can commit", async () => {
  let revision = 4;
  let releaseFirst;
  let secondExecuted = false;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const runMutation = createWebMcpMutationRunner({ getRevision: () => revision });

  const first = runMutation({ expectedRevision: 4, requestId: "serialize-first" }, async () => {
    await firstGate;
    revision += 1;
    return { committed: "first" };
  }, "first");
  const second = runMutation({ expectedRevision: 4, requestId: "serialize-second" }, async () => {
    secondExecuted = true;
    revision += 1;
    return { committed: "second" };
  }, "second");
  const secondRejected = assert.rejects(second, (error) => error.code === "STALE_STATE");

  releaseFirst();
  assert.equal((await first).committed, "first");
  await secondRejected;
  assert.equal(secondExecuted, false);
  assert.equal(revision, 5);
});

test("rejects reuse of one idempotency key for a different mutation", async () => {
  let revision = 1;
  const run = createWebMcpMutationRunner({ getRevision: () => revision });
  const meta = { expectedRevision: 1, requestId: "reused-001" };
  await run(meta, async () => { revision += 1; return { ok: true }; }, "filter:a");
  await assert.rejects(
    () => run(meta, async () => ({ ok: true }), "filter:b"),
    (error) => error.code === "IDEMPOTENCY_KEY_REUSED",
  );
});

test("lets transactional actions reject a revision change before commit", async () => {
  let revision = 8;
  const run = createWebMcpMutationRunner({ getRevision: () => revision });
  await assert.rejects(
    () => run({ expectedRevision: 8, requestId: "midflight-001" }, async (assertCurrent) => {
      revision = 9;
      assertCurrent();
      return { committed: true };
    }, "compose:create"),
    (error) => error.code === "STALE_STATE" && /while the mutation was running/.test(error.message),
  );
});

test("keeps failed mutations terminal and requires a new key for a retry", async () => {
  let attempts = 0;
  const run = createWebMcpMutationRunner({ getRevision: () => 5 });
  const meta = { expectedRevision: 5, requestId: "failure-001" };
  await assert.rejects(() => run(meta, async () => { attempts += 1; throw new Error("temporary"); }, "compose:create"), /temporary/);
  await assert.rejects(
    () => run(meta, async () => { attempts += 1; return { ok: true }; }, "compose:create"),
    (error) => error.code === "WEBMCP_OPERATION_FAILED" && !error.message.includes("temporary"),
  );
  const result = await run({ ...meta, requestId: "failure-002" }, async () => { attempts += 1; return { ok: true }; }, "compose:create");
  assert.equal(attempts, 2);
  assert.equal(result.ok, true);
});

test("evicts failed terminal mutations using the same bounded cache policy", async () => {
  let executions = 0;
  const run = createWebMcpMutationRunner({ getRevision: () => 5, maximumEntries: 2 });
  for (const requestId of ["failed-1", "failed-2", "failed-3"]) {
    await assert.rejects(() => run({ expectedRevision: 4, requestId }, async () => { executions += 1; }, `stale:${requestId}`), (error) => error.code === "STALE_STATE");
  }
  const recovered = await run({ expectedRevision: 5, requestId: "failed-1" }, async () => { executions += 1; return { ok: true }; }, "stale:failed-1");
  assert.equal(recovered.ok, true);
  assert.equal(executions, 1);
});

test("acknowledges long mutations asynchronously and exposes terminal status", async () => {
  let revision = 10;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const run = createWebMcpMutationRunner({ getRevision: () => revision });
  const accepted = await run({ expectedRevision: 10, requestId: "async-recipe-001", executionMode: "async" }, async () => {
    await gate;
    revision += 1;
    return { recipeRevision: 4 };
  }, "recipe:replace");
  assert.equal(accepted.status, "accepted");
  assert.equal(run.getOperationStatus(accepted.operationId).status, "running");
  release();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const completed = run.getOperationStatus(accepted.operationId);
  assert.equal(completed.status, "committed");
  assert.equal(completed.result.recipeRevision, 4);
  assert.equal(completed.result.workspaceRevision, 11);
});

test("async failures replay their terminal failure instead of stale accepted state", async () => {
  const run = createWebMcpMutationRunner({ getRevision: () => 3 });
  const meta = { expectedRevision: 3, requestId: "async-failure-001", executionMode: "async" };
  const accepted = await run(meta, async () => { throw new Error("worker failed"); }, "recipe:replace");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(run.getOperationStatus(accepted.operationId).status, "failed");
  await assert.rejects(
    () => run(meta, async () => ({ ok: true }), "recipe:replace"),
    (error) => error.code === "WEBMCP_OPERATION_FAILED" && !error.message.includes("worker failed"),
  );
});

test("a cancelled confirmation remains terminal for the original request", async () => {
  const run = createWebMcpMutationRunner({ getRevision: () => 2 });
  const meta = { expectedRevision: 2, requestId: "delete-cancel-001" };
  await run(meta, async () => ({ target: "prepared-dataset", targetId: "prepared-a", pendingConfirmation: true }), "delete:prepared-a");
  assert.equal(run.setRequestTerminalStatus(meta.requestId, "cancelled", { target: "prepared-dataset", targetId: "prepared-a", pendingConfirmation: false }), true);
  const replay = await run(meta, async () => ({ pendingConfirmation: true }), "delete:prepared-a");
  assert.deepEqual(replay, { target: "prepared-dataset", targetId: "prepared-a", pendingConfirmation: false, requestId: meta.requestId, status: "cancelled" });
});

test("hydrates committed mutation results across a runner reload", async () => {
  const stored = new Map();
  const options = {
    getRevision: () => 6,
    getFlowId: () => "flow-a",
    persistOperation: async (operation) => stored.set(operation.operationId, structuredClone(operation)),
  };
  const first = createWebMcpMutationRunner(options);
  const meta = { expectedRevision: 6, requestId: "durable-commit-001" };
  const committed = await first(meta, async () => ({ value: 42 }), "recipe:durable");
  await new Promise((resolve) => setTimeout(resolve, 0));

  let reexecuted = false;
  const restored = createWebMcpMutationRunner(options);
  await restored.hydrate([...stored.values()]);
  const replay = await restored(meta, async () => { reexecuted = true; return { value: 99 }; }, "recipe:durable");
  assert.equal(reexecuted, false);
  assert.deepEqual(replay, { workspaceRevision: committed.workspaceRevision });
});

test("marks non-terminal persisted mutations as interrupted after reload", async () => {
  const stored = [];
  const restored = createWebMcpMutationRunner({
    getRevision: () => 9,
    getFlowId: () => "flow-a",
    persistOperation: async (operation) => stored.push(structuredClone(operation)),
  });
  await restored.hydrate([{
    operationId: "operation-interrupted",
    requestId: "durable-running-001",
    fingerprint: "compose:create",
    flowId: "flow-a",
    executionMode: "async",
    status: "running",
    acceptedAt: "2026-08-30T00:00:00.000Z",
    startedAt: "2026-08-30T00:00:01.000Z",
    completedAt: null,
    result: null,
    error: null,
  }]);
  const status = restored.getOperationStatus("operation-interrupted");
  assert.equal(status.status, "failed");
  assert.equal(status.error.code, "OPERATION_INTERRUPTED_BY_RELOAD");
  await assert.rejects(
    () => restored({ expectedRevision: 9, requestId: "durable-running-001", executionMode: "async" }, async () => ({ ok: true }), "compose:create"),
    (error) => error.code === "OPERATION_INTERRUPTED_BY_RELOAD",
  );
});

test("operation status never exposes raw fingerprints or mutation payloads", async () => {
  let revision = 12;
  const stored = [];
  const run = createWebMcpMutationRunner({
    getRevision: () => revision,
    getFlowId: () => "flow-private",
    persistOperation: async (operation) => stored.push(structuredClone(operation)),
  });
  const secretFormula = "IF([email] = 'person@example.com', 9900000, 0)";
  const result = await run({ expectedRevision: 12, requestId: "private-operation-001" }, async () => {
    revision += 1;
    return { ok: true, expression: secretFormula };
  }, `formula:${secretFormula}`);
  assert.equal(result.ok, true);
  const operationId = stored.at(-1).operationId;
  const status = run.getOperationStatus(operationId);
  assert.equal(JSON.stringify(status).includes("person@example.com"), false);
  assert.equal(JSON.stringify(status).includes("9900000"), false);
  assert.equal(Object.hasOwn(status, "fingerprint"), false);
  assert.equal(Object.hasOwn(status, "fingerprintHash"), false);
  assert.equal(JSON.stringify(stored).includes(secretFormula), false);
});

test("cancellation fences a running writer before commit", async () => {
  let revision = 20;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const run = createWebMcpMutationRunner({ getRevision: () => revision });
  const accepted = await run({ expectedRevision: 20, requestId: "cancel-writer-001", executionMode: "async" }, async (assertCurrent) => {
    assertCurrent();
    await gate;
    assertCurrent();
    revision += 1;
    return { ok: true };
  }, "recipe:cancel");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(run.cancelOperation(accepted.operationId).status, "cancelling");
  release();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(run.getOperationStatus(accepted.operationId).status, "cancelled");
  assert.equal(revision, 20);
});

test("a registration-generation fence prevents an older writer from committing", async () => {
  let revision = 30;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const run = createWebMcpMutationRunner({ getRevision: () => revision });
  const accepted = await run({
    expectedRevision: 30,
    requestId: "generation-fence-001",
    executionMode: "async",
  }, async (assertCurrent) => {
    await gate;
    assertCurrent();
    revision += 1;
    return { changed: true };
  }, "recipe:generation-fence");

  assert.equal(run.getOperationStatus(accepted.operationId).status, "running");
  assert.deepEqual(run.fenceMutations(), [accepted.operationId]);
  release();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(run.getOperationStatus(accepted.operationId).status, "cancelled");
  assert.equal(revision, 30);
});
