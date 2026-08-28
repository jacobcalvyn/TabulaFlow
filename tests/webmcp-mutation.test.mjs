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

  releaseFirst();
  assert.equal((await first).committed, "first");
  await assert.rejects(second, (error) => error.code === "STALE_STATE");
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

test("allows a failed mutation to be retried with the same key", async () => {
  let attempts = 0;
  const run = createWebMcpMutationRunner({ getRevision: () => 5 });
  const meta = { expectedRevision: 5, requestId: "failure-001" };
  await assert.rejects(() => run(meta, async () => { attempts += 1; throw new Error("temporary"); }, "compose:create"), /temporary/);
  const result = await run(meta, async () => { attempts += 1; return { ok: true }; }, "compose:create");
  assert.equal(attempts, 2);
  assert.equal(result.ok, true);
});
