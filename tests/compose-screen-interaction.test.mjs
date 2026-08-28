import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { JSDOM } from "jsdom";
import react from "@vitejs/plugin-react";
import { createServer } from "vite";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;
globalThis.Element = dom.window.Element;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.localStorage = dom.window.localStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia = () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
});
window.requestAnimationFrame = (callback) => { callback(); return 1; };

const { cleanup, fireEvent, render, within } = await import("@testing-library/react");
const vite = await createServer({
  appType: "custom",
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  plugins: [react()],
  server: { middlewareMode: true, hmr: false, ws: false },
});
const [{ ComposeScreen }, { LanguageProvider }] = await Promise.all([
  vite.ssrLoadModule("/src/ComposeScreen.jsx"),
  vite.ssrLoadModule("/src/i18n.jsx"),
]);

test.after(async () => {
  cleanup();
  await vite.close();
  dom.window.close();
});

function createFlow() {
  return {
    sourceAssets: [
      { id: "source-a", name: "Source A", status: "linked" },
      { id: "source-b", name: "Source B", status: "linked" },
    ],
    preparedInputs: [
      { id: "prepared-a", sourceAssetId: "source-a", name: "Dataset A", rowCount: 10, schema: [{ name: "id", type: "BIGINT" }], position: { x: 40, y: 40 } },
      { id: "prepared-b", sourceAssetId: "source-b", name: "Dataset B", rowCount: 20, schema: [{ name: "id", type: "BIGINT" }], position: { x: 360, y: 40 } },
    ],
    composeNodes: [],
    activeNodeId: "prepared-a",
  };
}

function renderCompose(overrides = {}) {
  const props = {
    flow: createFlow(),
    dirty: false,
    preview: null,
    loading: false,
    error: "",
    onSelectNode() {},
    onPreviewDraft: async () => ({ rowCount: 0, schema: [] }),
    onCreateNode: async () => undefined,
    onUpdateNode: async () => undefined,
    onDeleteNode: async () => undefined,
    onDeletePrepared: async () => true,
    onMoveNode: async () => undefined,
    onAutoArrange: async () => createFlow(),
    onDuplicate: async () => ({ ok: true }),
    onCreatePrepared: async () => ({ ok: true }),
    onEditPreparation() {},
    onExport: async () => undefined,
    ...overrides,
  };
  return render(React.createElement(LanguageProvider, null, React.createElement(ComposeScreen, props)));
}

test("connector starts connection mode and opens only the new continuation actions", () => {
  const view = renderCompose();
  const connectors = view.getAllByRole("button", { name: /Continue from Dataset/ });
  fireEvent.click(connectors[0]);

  const unaryPicker = view.getByRole("dialog", { name: "Choose the next operation" });
  assert.deepEqual(within(unaryPicker).getAllByRole("button").map((button) => button.textContent), [
    "Create datasetCreate an independent copy of this Prepare dataset",
    "AggregateGroup rows and calculate measures",
    "Filter rowsKeep rows matching a condition",
    "Distinct rowsKeep one row per unique key",
    "PivotTurn values into columns",
    "UnpivotTurn columns into rows",
  ]);
  assert.equal(view.container.querySelectorAll(".canvas-node--target").length, 1);

  fireEvent.click(connectors[0]);
  assert.equal(view.queryByRole("dialog", { name: "Choose the next operation" }), null);
  assert.equal(view.container.querySelectorAll(".canvas-node--target").length, 0);
  view.unmount();
});

test("clicking the second node opens the existing binary operation chooser", () => {
  const view = renderCompose();
  fireEvent.click(view.getAllByRole("button", { name: /Continue from Dataset/ })[0]);
  fireEvent.click(view.getByText("Dataset B").closest("article"));

  const binaryPicker = view.getByRole("dialog", { name: "Choose operation" });
  assert.deepEqual(within(binaryPicker).getAllByRole("button").map((button) => button.textContent), [
    "JoinMatch rows using keys",
    "AppendStack rows from both datasets",
    "DifferenceKeep rows found on only one side",
    "Cancel",
  ]);
  assert.equal(view.queryByRole("dialog", { name: "Choose the next operation" }), null);
  view.unmount();
});
