import assert from "node:assert/strict";
import test from "node:test";
import {
  WEBMCP_REGISTRATION_BUDGET,
  assertWebMcpRegistrationBudget,
  createWebMcpRuntimeHealth,
  measureWebMcpToolset,
} from "../src/webMcpRuntime.js";
import { createWebMcpStableTools } from "../src/useWebMcpTools.js";

const contextRef = { current: { state: { workspace: "prepare" }, actions: {} } };

test("the permanent WebMCP dispatcher surface stays inside the measured registration budget", () => {
  const metrics = measureWebMcpToolset(createWebMcpStableTools(contextRef));
  assert.doesNotThrow(() => assertWebMcpRegistrationBudget(metrics));
  assert.ok(metrics.schemaBytes <= WEBMCP_REGISTRATION_BUDGET.maxSchemaBytes * 0.7);
  assert.ok(metrics.toolCount < WEBMCP_REGISTRATION_BUDGET.maxToolCount / 2);
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

test("workspace navigation can wait for one complete stable generation", async () => {
  const health = createWebMcpRuntimeHealth();
  const pending = health.waitForStableGeneration(2, { timeoutMs: 100, workspace: "compose" });
  health.beginRegistration({ generation: 3, workspace: "compose", expectedToolCount: 12, metrics: { schemaBytes: 100 } });
  health.completeRegistration({ generation: 3, workspace: "compose", registeredToolCount: 12, expectedToolCount: 12, metrics: { schemaBytes: 100 } });
  const stable = await pending;
  assert.equal(stable.generation, 3);
  assert.equal(stable.status, "available");
  assert.equal(stable.workspace, "compose");
  assert.equal(stable.registeredToolCount, stable.expectedToolCount);
});
