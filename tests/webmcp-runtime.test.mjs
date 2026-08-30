import assert from "node:assert/strict";
import test from "node:test";
import {
  WEBMCP_REGISTRATION_BUDGET,
  assertWebMcpRegistrationBudget,
  createWebMcpRuntimeHealth,
  measureWebMcpToolset,
} from "../src/webMcpRuntime.js";
import { createWebMcpToolBundles } from "../src/useWebMcpTools.js";

const contextRef = { current: { state: { workspace: "prepare" }, actions: {} } };

test("every contextual WebMCP bundle stays inside the measured registration budget", () => {
  for (const workspace of ["source", "prepare", "compose", "account"]) {
    const bundles = createWebMcpToolBundles(contextRef, { workspace, hasDataset: true, hasPrepared: true, hasComposeNodes: true });
    const metrics = measureWebMcpToolset([...bundles.core, ...bundles.workspace]);
    assert.doesNotThrow(() => assertWebMcpRegistrationBudget(metrics));
    assert.ok(metrics.schemaBytes <= WEBMCP_REGISTRATION_BUDGET.maxSchemaBytes);
  }
});

test("registration budget rejects an oversized toolset before publication", () => {
  const oversized = [{
    name: "tabulaflow_oversized",
    description: "x".repeat(WEBMCP_REGISTRATION_BUDGET.maxSchemaBytes + 1),
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  }];
  const metrics = measureWebMcpToolset(oversized);
  assert.throws(
    () => assertWebMcpRegistrationBudget(metrics),
    (error) => error.code === "WEBMCP_CONFIGURATION_LIMIT_EXCEEDED" && error.exceeded.includes("schemaBytes"),
  );
});

test("runtime health blocks stale generations and reports registration failures honestly", () => {
  const health = createWebMcpRuntimeHealth();
  const metrics = { schemaBytes: 100, propertyCount: 4, schemaDepth: 3 };
  health.beginRegistration({ generation: 1, expectedToolCount: 10, metrics });
  assert.equal(health.snapshot().status, "registering");
  assert.equal(health.snapshot().callableToolCount, 0);
  assert.equal(health.snapshot().blockedToolCount, 10);
  assert.throws(() => health.assertExecutable(0), (error) => error.code === "WEBMCP_REFRESH_REQUIRED");
  health.completeRegistration({ generation: 1, registeredToolCount: 10, expectedToolCount: 10, metrics });
  assert.equal(health.snapshot().status, "available");
  assert.equal(health.snapshot().callableToolCount, 10);
  assert.equal(health.snapshot().blockedToolCount, 0);
  assert.throws(() => health.assertExecutable(0), (error) => error.code === "WEBMCP_STALE_GENERATION");
  health.failRegistration(Object.assign(new Error("configuration exceeds supported limits"), { code: "WEBMCP_CONFIGURATION_LIMIT_EXCEEDED" }), { generation: 1, metrics });
  assert.equal(health.snapshot().status, "limit-exceeded");
  assert.equal(health.snapshot().refreshRequired, true);
});
