import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { JSDOM } from "jsdom";
import { useWebMcpTools } from "../src/useWebMcpTools.js";
import { createWebMcpMutationRunner } from "../src/webMcpMutation.js";

function state(revision, { compose = true } = {}) {
  return {
    contractVersion: "2.6",
    workspaceRevision: revision,
    workspace: "prepare",
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

test("React WebMCP registration uses current context and aborts stale tool lifecycles", async (t) => {
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
  const firstSignal = registrations[0].signal;
  const exportTool = registry.get("tabulaflow_export_prepare");
  const args = { preparedId: "prepared-a", format: "csv", expectedRevision: 7, requestId: "registered-export-001" };
  await exportTool.execute(args);
  await exportTool.execute(args);
  assert.equal(exportExecutions, 1);

  revision = 8;
  view.rerender(React.createElement(Harness, { context: { state: state(revision), actions } }));
  assert.equal(registry.get("tabulaflow_get_workspace_state").execute({}).structuredContent.workspaceRevision, 8);
  await assert.rejects(
    () => exportTool.execute({ ...args, requestId: "registered-export-stale-001" }),
    (error) => error.code === "STALE_STATE",
  );

  view.rerender(React.createElement(Harness, { context: { state: state(revision, { compose: false }), actions } }));
  await waitFor(() => assert.equal(firstSignal.aborted, true));
  const latestSignal = registrations.at(-1).signal;
  view.unmount();
  assert.equal(latestSignal.aborted, true);
});
