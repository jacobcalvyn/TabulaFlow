import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { JSDOM } from "jsdom";
import { useWebMcpTools } from "../src/useWebMcpTools.js";
import { createWebMcpMutationRunner } from "../src/webMcpMutation.js";

function state(revision, { compose = true, workspace = "prepare" } = {}) {
  return {
    contractVersion: "2.9",
    workspaceRevision: revision,
    workspace,
    worker: { ready: true, recovering: false },
    flowDirty: false,
    diagnostics: [],
    activePreparedId: "prepared-a",
    activeNodeId: compose ? "operation-a" : "prepared-a",
    selection: { prepareContext: { preparedId: "prepared-a" }, composeSelection: { nodeId: compose ? "operation-a" : "prepared-a" }, relationship: "independent-workspace-contexts" },
    activeDataset: { name: "Orders", columns: ["status"], schema: [{ name: "status", type: "VARCHAR" }], filters: {}, quality: {} },
    recipeSteps: [],
    recipeHistory: { canUndo: false, canRedo: false },
    preparedInputs: [{ id: "prepared-a", name: "Orders" }],
    metricDefinitions: [],
    composeNodes: compose ? [{ id: "operation-a", name: "Filtered orders", kind: "filter-rows" }] : [],
    sourceAssets: [],
  };
}

function Harness({ context }) {
  useWebMcpTools(context);
  return null;
}

test("React WebMCP registration keeps core stable and rotates only the active workspace bundle", async (t) => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://example.test" });
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  t.after(() => {
    cleanup();
    dom.window.close();
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  });

  const registrations = [];
  const registry = new Map();
  document.modelContext = {
    async registerTool(tool, options) {
      registrations.push({ name: tool.name, signal: options.signal });
      registry.set(tool.name, tool);
    },
  };

  let revision = 7;
  let exportExecutions = 0;
  const runMutation = createWebMcpMutationRunner({ getRevision: () => revision });
  const exportPrepare = (preparedId, format, meta) => runMutation(meta, async (assertCurrent) => {
    assertCurrent();
    exportExecutions += 1;
    return { preparedId, filename: `Orders.${format}`, format };
  }, `prepare:export:${preparedId}:${format}`);
  const actions = { exportPrepare };

  const view = render(React.createElement(Harness, { context: { state: state(revision), actions } }));
  await waitFor(() => assert.ok(registry.has("tabulaflow_export_prepare")));
  const coreSignal = registrations.find(({ name }) => name === "tabulaflow_get_workspace_state").signal;
  const prepareSignal = registrations.find(({ name }) => name === "tabulaflow_export_prepare").signal;
  assert.notEqual(coreSignal, prepareSignal);
  assert.equal(registry.has("tabulaflow_export_compose"), false);
  const exportTool = registry.get("tabulaflow_export_prepare");
  const args = { preparedId: "prepared-a", format: "csv", expectedRevision: 7, requestId: "registered-export-001" };
  await exportTool.execute(args);
  await exportTool.execute(args);
  assert.equal(exportExecutions, 1);

  revision = 8;
  view.rerender(React.createElement(Harness, { context: { state: state(revision), actions } }));
  assert.equal(coreSignal.aborted, false);
  assert.equal(prepareSignal.aborted, false);
  assert.equal(registry.get("tabulaflow_get_workspace_state").execute({}).structuredContent.workspaceRevision, 8);
  await assert.rejects(
    () => exportTool.execute({ ...args, requestId: "registered-export-stale-001" }),
    (error) => error.code === "STALE_STATE",
  );

  view.rerender(React.createElement(Harness, { context: { state: state(revision, { workspace: "compose" }), actions } }));
  await waitFor(() => assert.ok(registry.has("tabulaflow_export_compose")));
  assert.equal(prepareSignal.aborted, true);
  assert.equal(coreSignal.aborted, false);
  const composeSignal = registrations.find(({ name }) => name === "tabulaflow_export_compose").signal;
  view.unmount();
  assert.equal(coreSignal.aborted, true);
  assert.equal(composeSignal.aborted, true);
});

test("a workspace registration failure does not disable the WebMCP core", async (t) => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "https://example.test" });
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousWarn = console.warn;
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  const warnings = [];
  console.warn = (...args) => warnings.push(args);
  t.after(() => {
    cleanup();
    dom.window.close();
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
    console.warn = previousWarn;
  });

  const registrations = [];
  document.modelContext = {
    async registerTool(tool, options) {
      registrations.push({ name: tool.name, signal: options.signal });
      if (tool.name === "tabulaflow_get_prepare_dataset") throw new Error("configuration limit exceeded");
    },
  };

  const view = render(React.createElement(Harness, { context: { state: state(7), actions: {} } }));
  await waitFor(() => assert.ok(warnings.length > 0));
  const coreSignal = registrations.find(({ name }) => name === "tabulaflow_get_workspace_state").signal;
  const workspaceSignal = registrations.find(({ name }) => name === "tabulaflow_get_prepare_dataset").signal;
  assert.equal(coreSignal.aborted, false);
  assert.equal(workspaceSignal.aborted, true);
  assert.match(warnings[0][0], /prepare tool registration failed/);
  view.unmount();
  assert.equal(coreSignal.aborted, true);
});
