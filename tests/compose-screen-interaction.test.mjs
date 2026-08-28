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

const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const vite = await createServer({
  appType: "custom",
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  plugins: [react()],
  server: { middlewareMode: true, hmr: false, ws: false },
});
const [{ ComposeScreen }, { LanguageProvider }, { StepsPanel }, { FormulaColumnEditor }] = await Promise.all([
  vite.ssrLoadModule("/src/ComposeScreen.jsx"),
  vite.ssrLoadModule("/src/i18n.jsx"),
  vite.ssrLoadModule("/src/StepsPanel.jsx"),
  vite.ssrLoadModule("/src/FormulaColumnEditor.jsx"),
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

test("clicking outside an operation inspector cancels and hides it", () => {
  const updates = [];
  const flow = createFlow();
  flow.composeNodes = [{
    id: "aggregate-a",
    nodeType: "operation",
    kind: "aggregate",
    name: "Aggregate A",
    inputIds: ["prepared-a"],
    rowCount: 10,
    schema: [{ name: "count", type: "BIGINT" }],
    config: {
      groupBy: [],
      measures: [{ function: "count", column: "", alias: "count" }],
      minimumSampleSize: 1,
      suppressSmallGroups: false,
    },
    position: { x: 680, y: 40 },
  }];
  const view = renderCompose({
    flow,
    async onUpdateNode(...args) { updates.push(args); },
  });

  fireEvent.click(view.getByRole("button", { name: "Settings" }));
  const inspector = view.container.querySelector(".compose-operation-builder");
  assert.ok(inspector);

  fireEvent.pointerDown(inspector.querySelector("select"));
  assert.ok(view.container.querySelector(".compose-operation-builder"));

  fireEvent.pointerDown(view.container.querySelector(".compose-canvas"));
  assert.equal(view.container.querySelector(".compose-operation-builder"), null);
  assert.deepEqual(updates, []);
  view.unmount();
});

test("Distinct output mode is an accessible two-option segmented control", () => {
  const flow = createFlow();
  flow.composeNodes = [{
    id: "distinct-a",
    nodeType: "operation",
    kind: "distinct-rows",
    name: "Distinct A",
    inputIds: ["prepared-a"],
    rowCount: 10,
    schema: [{ name: "id", type: "BIGINT" }],
    config: {
      columns: ["id"],
      mode: "representative-rows",
    },
    position: { x: 680, y: 40 },
  }];
  const view = renderCompose({ flow });

  fireEvent.click(view.getByRole("button", { name: "Settings" }));
  const modeGroup = view.getByRole("group", { name: "Output mode" });
  const representative = within(modeGroup).getByRole("button", { name: "Keep representative rows" });
  const projected = within(modeGroup).getByRole("button", { name: "Return distinct columns only" });

  assert.equal(representative.getAttribute("aria-pressed"), "true");
  assert.equal(projected.getAttribute("aria-pressed"), "false");
  fireEvent.click(projected);
  assert.equal(representative.getAttribute("aria-pressed"), "false");
  assert.equal(projected.getAttribute("aria-pressed"), "true");
  view.unmount();
});

test("a WebMCP delete request opens the existing confirmation without deleting", async () => {
  const calls = [];
  const view = renderCompose({
    deleteRequest: { target: "prepared-dataset", targetId: "prepared-a", token: "request-1" },
    onDeleteRequestShown(token) { calls.push(["shown", token]); },
    onDeleteConfirmation(target, targetId, outcome) { calls.push(["confirmation", target, targetId, outcome]); },
    async onDeletePrepared(nodeId) { calls.push(["delete", nodeId]); return true; },
  });

  const confirmation = view.getByText("Delete this dataset?").closest("div");
  assert.deepEqual(calls, [["shown", "request-1"]]);
  assert.equal(calls.some(([type]) => type === "delete"), false);

  await act(async () => {
    fireEvent.click(within(confirmation).getByRole("button", { name: "Delete" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  assert.deepEqual(calls, [["shown", "request-1"], ["delete", "prepared-a"], ["confirmation", "prepared-dataset", "prepared-a", "confirmed"]]);
  view.unmount();
});

test("cancelling a WebMCP delete request reports a terminal cancellation", () => {
  const calls = [];
  const view = renderCompose({
    deleteRequest: { target: "prepared-dataset", targetId: "prepared-a", token: "request-cancel" },
    onDeleteRequestShown(token) { calls.push(["shown", token]); },
    onDeleteConfirmation(target, targetId, outcome) { calls.push(["confirmation", target, targetId, outcome]); },
  });
  const confirmation = view.getByText("Delete this dataset?").closest("div");
  fireEvent.click(within(confirmation).getByRole("button", { name: "Cancel" }));
  assert.deepEqual(calls, [["shown", "request-cancel"], ["confirmation", "prepared-dataset", "prepared-a", "cancelled"]]);
  view.unmount();
});

test("a WebMCP recipe deletion also waits for visible confirmation", () => {
  const calls = [];
  const recipe = [{ id: "step-a", type: "trim", version: 1, enabled: true, params: { column: "name", mode: "both" } }];
  const view = render(React.createElement(LanguageProvider, null, React.createElement(StepsPanel, {
    open: true,
    embedded: true,
    columns: ["name"],
    recipe,
    stepStates: [],
    invalidStepId: null,
    error: "",
    applying: false,
    canUndo: false,
    canRedo: false,
    onClose() {},
    onChange(nextRecipe) { calls.push(["change", nextRecipe]); },
    onUndo() {},
    onRedo() {},
    onPreview() {},
    previewedStepId: null,
    deleteRequest: { target: "recipe-step", targetId: "step-a", token: "request-2" },
    onDeleteRequestShown(token) { calls.push(["shown", token]); },
    onDeleteConfirmation(target, targetId, outcome) { calls.push(["confirmation", target, targetId, outcome]); },
  })));

  const confirmation = view.getByText("Delete this step?").closest("div");
  assert.deepEqual(calls, [["shown", "request-2"]]);
  fireEvent.click(within(confirmation).getByRole("button", { name: "Delete" }));
  assert.deepEqual(calls, [["shown", "request-2"], ["change", []], ["confirmation", "recipe-step", "step-a", "confirmed"]]);
  view.unmount();
});

test("Formula column validates, previews, and submits one create-only recipe step", async () => {
  const calls = [];
  const view = render(React.createElement(LanguageProvider, null, React.createElement(FormulaColumnEditor, {
    schema: [{ name: "amount", type: "DOUBLE" }, { name: "category", type: "VARCHAR" }],
    title: "Formula column",
    submitLabel: "Add",
    onCancel() {},
    async onPreview(params, references) {
      calls.push(["preview", params, references]);
      return { columns: ["amount", "amount_double"], preview: [{ amount: 4, amount_double: 8 }] };
    },
    onSubmit(params) { calls.push(["submit", params]); },
  })));

  fireEvent.change(view.getByLabelText("New column name"), { target: { value: "amount_double" } });
  fireEvent.change(view.getByLabelText("Formula"), { target: { value: "[amount] * 2" } });
  assert.match(view.getByText(/Result type:/).textContent, /DOUBLE/);

  await act(async () => { fireEvent.click(view.getByRole("button", { name: "Preview" })); });
  assert.deepEqual(calls[0], ["preview", { outputColumn: "amount_double", expression: "[amount] * 2", expressionVersion: 1 }, ["amount"]]);
  assert.equal(view.getByText("8").textContent, "8");

  fireEvent.click(view.getByRole("button", { name: "Add" }));
  assert.deepEqual(calls[1], ["submit", { outputColumn: "amount_double", expression: "[amount] * 2", expressionVersion: 1 }]);
  view.unmount();
});
