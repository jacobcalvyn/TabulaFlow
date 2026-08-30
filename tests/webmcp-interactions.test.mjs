import assert from "node:assert/strict";
import test from "node:test";
import { createWebMcpInteractionRegistry } from "../src/webMcpInteractions.js";

test("source interactions expose a bounded awaiting-user lifecycle", () => {
  let timestamp = Date.parse("2026-08-30T00:00:00.000Z");
  const registry = createWebMcpInteractionRegistry({ ttlMs: 1_000, now: () => timestamp });
  const pending = registry.create("source-file", { workspace: "source", workspaceChanged: true });
  assert.equal(pending.status, "awaiting-user");
  assert.equal(pending.awaitingUser, true);
  assert.equal(pending.workspaceChanged, true);
  assert.equal(registry.list().length, 1);

  const completed = registry.resolveLatest("source-file", "completed");
  assert.equal(completed.status, "completed");
  assert.equal(registry.list().length, 0);
});

test("source interactions expire and relink resolution is target-bound", () => {
  let timestamp = Date.parse("2026-08-30T00:00:00.000Z");
  const registry = createWebMcpInteractionRegistry({ ttlMs: 1_000, now: () => timestamp });
  registry.create("source-relink", { sourceAssetId: "source-a" });
  assert.equal(registry.resolveLatest("source-relink", "completed", { sourceAssetId: "source-b" }), null);
  timestamp += 1_001;
  assert.equal(registry.list().length, 0);
  const history = registry.list({ includeTerminal: true });
  assert.equal(history[0].status, "expired");
  assert.equal(history[0].reason, "USER_GESTURE_REQUIRED");
});

test("an agent can cancel an awaiting Source interaction without waiting for expiry", () => {
  const registry = createWebMcpInteractionRegistry();
  const pending = registry.create("source-file", { workspace: "source" });
  const cancelled = registry.cancel(pending.interactionId);
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.awaitingUser, false);
  assert.equal(cancelled.reason, "AGENT_CANCELLED");
  assert.equal(registry.list().length, 0);
  assert.equal(registry.cancel(pending.interactionId).status, "cancelled");
  assert.throws(() => registry.cancel("missing"), (error) => error.code === "INTERACTION_NOT_FOUND");
});
