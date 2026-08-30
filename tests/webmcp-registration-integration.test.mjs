import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { JSDOM } from "jsdom";
import { useWebMcpTools } from "../src/useWebMcpTools.js";
import { createWebMcpMutationRunner } from "../src/webMcpMutation.js";

function state(revision, { compose = true, workspace = "prepare" } = {}) {
  return {
    contractVersion: "3.2.4",
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

function createAbortAwareHost({ failOn } = {}) {
  const registrations = [];
  const registry = new Map();
  const namesBySignal = new WeakMap();
  return {
    registrations,
    registry,
    modelContext: {
      async registerTool(tool, options) {
        registrations.push({ name: tool.name, signal: options.signal });
        if (tool.name === failOn) throw new Error("configuration limit exceeded");
        registry.set(tool.name, tool);
        let names = namesBySignal.get(options.signal);
        if (!names) {
          names = new Set();
          namesBySignal.set(options.signal, names);
          options.signal.addEventListener("abort", () => {
            for (const name of names) registry.delete(name);
          }, { once: true });
        }
        names.add(tool.name);
      },
    },
  };
}

test("React WebMCP registers one stable surface and the host removes it only on lifecycle abort", async (t) => {
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

  const host = createAbortAwareHost();
  const { registrations, registry } = host;
  document.modelContext = host.modelContext;

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
  await waitFor(() => assert.ok(registry.has("tabulaflow_prepare_mutate")));
  const initialRegistrationCount = registrations.length;
  const lifecycleSignal = registrations.find(({ name }) => name === "tabulaflow_get_workspace_state").signal;
  assert.ok(registrations.every(({ signal }) => signal === lifecycleSignal));
  assert.equal(registry.has("tabulaflow_export_prepare"), false);
  assert.equal(registry.has("tabulaflow_compose_read"), true);
  const exportTool = registry.get("tabulaflow_prepare_mutate");
  const args = { preparedId: "prepared-a", format: "csv", expectedRevision: 7, requestId: "registered-export-001", executionMode: "wait" };
  await exportTool.execute({ action: "export_prepare", input: args });
  await exportTool.execute({ action: "export_prepare", input: args });
  assert.equal(exportExecutions, 1);

  revision = 8;
  view.rerender(React.createElement(Harness, { context: { state: state(revision), actions } }));
  assert.equal(lifecycleSignal.aborted, false);
  assert.equal(registrations.length, initialRegistrationCount);
  assert.equal((await registry.get("tabulaflow_get_workspace_state").execute({})).structuredContent.workspaceRevision, 8);
  await assert.rejects(
    () => exportTool.execute({ action: "export_prepare", input: { ...args, requestId: "registered-export-stale-001" } }),
    (error) => error.code === "STALE_STATE",
  );

  view.rerender(React.createElement(Harness, { context: { state: state(revision, { workspace: "compose" }), actions } }));
  await waitFor(async () => assert.equal((await registry.get("tabulaflow_get_workspace_state").execute({})).structuredContent.workspace, "compose"));
  assert.equal(registrations.length, initialRegistrationCount);
  assert.equal(lifecycleSignal.aborted, false);
  view.unmount();
  assert.equal(lifecycleSignal.aborted, true);
  assert.equal(registry.size, 0);
});

test("a host registration failure aborts and removes the partial stable surface", async (t) => {
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

  const host = createAbortAwareHost({ failOn: "tabulaflow_prepare_read" });
  const { registrations, registry } = host;
  document.modelContext = host.modelContext;

  const view = render(React.createElement(Harness, { context: { state: state(7), actions: {} } }));
  await waitFor(() => assert.ok(warnings.length > 0));
  assert.ok(registrations.every(({ signal }) => signal.aborted));
  assert.equal(registry.size, 0);
  assert.match(warnings[0][0], /stable tool registration failed/);
  view.unmount();
});
