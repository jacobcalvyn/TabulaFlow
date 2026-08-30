import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { JSDOM } from "jsdom";
import react from "@vitejs/plugin-react";
import { createServer } from "vite";

const stylesSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/styles.css"), "utf8");

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
    metricDefinitions: [{ id: "metric-a", name: "Revenue", targetId: "prepared-a" }],
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

test("Compose overlays and workspace share one explicit grid column", () => {
  assert.match(stylesSource, /\.compose-screen\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s);
  assert.match(stylesSource, /\.compose-toolbar\s*\{[^}]*grid-column:\s*1;[^}]*grid-row:\s*1;/s);
  assert.match(stylesSource, /\.compose-global-error\s*\{[^}]*grid-column:\s*1;[^}]*grid-row:\s*2;/s);
  assert.match(stylesSource, /\.compose-layout\s*\{[^}]*grid-column:\s*1;[^}]*grid-row:\s*2;/s);
  assert.match(stylesSource, /\.compose-global-confirmation\s*\{[^}]*grid-column:\s*1;[^}]*grid-row:\s*2;/s);
});

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

test("opening Data preview preserves the current Compose zoom", async () => {
  const observers = [];
  const originalResizeObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class TestResizeObserver {
    constructor(callback) {
      this.callback = callback;
      observers.push(this);
    }

    observe(target) {
      this.target = target;
    }

    disconnect() {}
  };

  let view;
  try {
    view = renderCompose({
      preview: { rowCount: 4, columns: ["group", "count"], preview: [] },
    });
    assert.equal(observers.length, 1);

    await act(async () => {
      observers[0].callback([{ contentRect: { width: 1200, height: 800 } }]);
    });
    fireEvent.click(view.getByRole("button", { name: "Zoom out" }));
    assert.equal(view.getByText("85%").textContent, "85%");

    fireEvent.click(view.getByRole("button", { name: "Show preview" }));
    await act(async () => {
      observers[0].callback([{ contentRect: { width: 1200, height: 480 } }]);
    });

    assert.equal(view.getByText("85%").textContent, "85%");
    assert.equal(view.getByRole("button", { name: "Hide preview" }).getAttribute("aria-expanded"), "true");
  } finally {
    view?.unmount();
    if (originalResizeObserver === undefined) delete globalThis.ResizeObserver;
    else globalThis.ResizeObserver = originalResizeObserver;
  }
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

test("a reusable metric deletion waits for visible user confirmation", async () => {
  const calls = [];
  const view = renderCompose({
    deleteRequest: { target: "metric-definition", targetId: "metric-a", token: "metric-request" },
    onDeleteRequestShown(token) { calls.push(["shown", token]); },
    onDeleteConfirmation(target, targetId, outcome) { calls.push(["confirmation", target, targetId, outcome]); },
    async onDeleteMetricDefinition(id) { calls.push(["delete-metric", id]); return true; },
  });
  const confirmation = view.getByText("Delete this reusable metric definition?").closest("div");
  assert.deepEqual(calls, [["shown", "metric-request"]]);
  await act(async () => {
    fireEvent.click(within(confirmation).getByRole("button", { name: "Delete" }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  assert.deepEqual(calls, [["shown", "metric-request"], ["delete-metric", "metric-a"], ["confirmation", "metric-definition", "metric-a", "confirmed"]]);
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

test("Prepare Steps deletes the complete recipe only after inline confirmation", async () => {
  const calls = [];
  const recipe = [
    { id: "step-a", type: "trim", version: 1, enabled: true, params: { column: "name", mode: "both" } },
    { id: "step-b", type: "normalize-case", version: 1, enabled: true, params: { column: "name", mode: "upper" } },
  ];
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
    onChange(nextRecipe, changedStepId) { calls.push([nextRecipe, changedStepId]); },
    onUndo() {},
    onRedo() {},
    onPreview() {},
    previewedStepId: null,
  })));

  fireEvent.click(view.getByRole("button", { name: "Delete all" }));
  let confirmation = view.getByRole("alertdialog", { name: "Delete all 2 steps?" });
  fireEvent.keyDown(confirmation, { key: "Escape" });
  assert.deepEqual(calls, []);
  assert.equal(view.queryByRole("alertdialog"), null);

  fireEvent.click(view.getByRole("button", { name: "Delete all" }));
  confirmation = view.getByRole("alertdialog", { name: "Delete all 2 steps?" });
  fireEvent.click(within(confirmation).getByRole("button", { name: "Cancel" }));
  assert.deepEqual(calls, []);
  assert.equal(view.queryByRole("alertdialog"), null);

  fireEvent.click(view.getByRole("button", { name: "Delete all" }));
  await act(async () => { fireEvent.click(within(view.getByRole("alertdialog")).getByRole("button", { name: "Delete all" })); });
  assert.deepEqual(calls, [[[], "step-a"]]);
  view.unmount();
});

test("a WebMCP Delete all request uses the visible Prepare confirmation", async () => {
  const calls = [];
  const recipe = [{ id: "step-a", type: "trim", version: 1, enabled: true, params: { column: "name", mode: "both" } }];
  const renderSteps = (deleteRequest) => render(React.createElement(LanguageProvider, null, React.createElement(StepsPanel, {
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
    async onChange(nextRecipe, changedStepId) { calls.push(["change", nextRecipe, changedStepId]); return { rowCount: 1 }; },
    onUndo() {},
    onRedo() {},
    onPreview() {},
    previewedStepId: null,
    deleteRequest,
    onDeleteRequestShown(token) { calls.push(["shown", token]); },
    onDeleteConfirmation(target, targetId, outcome) { calls.push(["confirmation", target, targetId, outcome]); },
  })));

  let view = renderSteps({ target: "prepare-recipe", targetId: "prepared-a", token: "delete-all-cancel" });
  assert.deepEqual(calls, [["shown", "delete-all-cancel"]]);
  fireEvent.click(within(view.getByRole("alertdialog", { name: "Delete the only recipe step?" })).getByRole("button", { name: "Cancel" }));
  assert.deepEqual(calls, [["shown", "delete-all-cancel"], ["confirmation", "prepare-recipe", "prepared-a", "cancelled"]]);
  view.unmount();

  calls.length = 0;
  view = renderSteps({ target: "prepare-recipe", targetId: "prepared-a", token: "delete-all-confirm" });
  await act(async () => { fireEvent.click(within(view.getByRole("alertdialog", { name: "Delete the only recipe step?" })).getByRole("button", { name: "Delete all" })); });
  assert.deepEqual(calls, [
    ["shown", "delete-all-confirm"],
    ["change", [], "step-a"],
    ["confirmation", "prepare-recipe", "prepared-a", "confirmed"],
  ]);
  view.unmount();
});

test("Prepare Steps hides Delete all when the active recipe is empty", () => {
  const view = render(React.createElement(LanguageProvider, null, React.createElement(StepsPanel, {
    open: true,
    embedded: true,
    columns: ["name"],
    recipe: [],
    stepStates: [],
    invalidStepId: null,
    error: "",
    applying: false,
    canUndo: true,
    canRedo: false,
    onClose() {},
    onChange() {},
    onUndo() {},
    onRedo() {},
    onPreview() {},
    previewedStepId: null,
  })));

  assert.equal(view.queryByRole("button", { name: "Delete all" }), null);
  view.unmount();
});

test("Formula recipe steps edit in a modal instead of the embedded swipe sheet", () => {
  const calls = [];
  const recipe = [{
    id: "formula-a",
    type: "calculated-field",
    version: 1,
    enabled: true,
    params: { outputColumn: "amount_double", expression: "[amount] * 2", expressionVersion: 1 },
  }];
  const view = render(React.createElement(LanguageProvider, null, React.createElement(StepsPanel, {
    open: true,
    embedded: true,
    columns: ["amount"],
    schema: [{ name: "amount", type: "DOUBLE" }],
    recipe,
    stepStates: [],
    invalidStepId: null,
    error: "",
    applying: false,
    canUndo: false,
    canRedo: false,
    onClose() {},
    onChange(nextRecipe, changedStepId) { calls.push([nextRecipe, changedStepId]); },
    onUndo() {},
    onRedo() {},
    onPreview() {},
    previewedStepId: null,
  })));

  fireEvent.click(view.getByRole("button", { name: "Edit step" }));
  let dialog = view.getByRole("dialog", { name: "Edit formula column" });
  assert.equal(document.body.contains(dialog), true);
  assert.equal(view.container.querySelector(".step-form-sheet"), null);
  assert.equal(within(dialog).getByLabelText("New column name").value, "amount_double");
  assert.equal(within(dialog).getByLabelText("Formula").value, "[amount] * 2");
  const saveButton = within(dialog).getByRole("button", { name: "Save" });
  saveButton.focus();
  fireEvent.keyDown(dialog, { key: "Tab" });
  assert.equal(document.activeElement, within(dialog).getByRole("button", { name: "Close form" }));

  fireEvent.keyDown(document, { key: "Escape" });
  assert.equal(view.queryByRole("dialog", { name: "Edit formula column" }), null);

  fireEvent.click(view.getByRole("button", { name: "Edit step" }));
  dialog = view.getByRole("dialog", { name: "Edit formula column" });
  fireEvent.pointerDown(dialog.parentElement);
  assert.equal(view.queryByRole("dialog", { name: "Edit formula column" }), null);

  fireEvent.click(view.getByRole("button", { name: "Edit step" }));
  dialog = view.getByRole("dialog", { name: "Edit formula column" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  assert.deepEqual(calls, [[recipe, "formula-a"]]);
  assert.equal(view.queryByRole("dialog", { name: "Edit formula column" }), null);
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

  const outputName = view.getByLabelText("New column name");
  assert.equal(outputName.value, "Formula column 1");
  assert.equal(outputName.selectionStart, 0);
  assert.equal(outputName.selectionEnd, outputName.value.length);
  fireEvent.change(outputName, { target: { value: "amount_double" } });
  const formula = view.getByLabelText("Formula");
  fireEvent.change(formula, { target: { value: "[amo", selectionStart: 4 } });
  assert.equal(view.getByRole("listbox", { name: "Column suggestions" }).textContent.includes("amount"), true);
  fireEvent.keyDown(formula, { key: "Enter" });
  assert.equal(formula.value, "[amount]");
  fireEvent.change(formula, { target: { value: "[amount] * 2", selectionStart: 12 } });
  assert.match(view.getByText(/Result type:/).textContent, /DOUBLE/);

  await act(async () => { fireEvent.click(view.getByRole("button", { name: "Preview" })); });
  assert.deepEqual(calls[0], ["preview", { outputColumn: "amount_double", expression: "[amount] * 2", expressionVersion: 1 }, ["amount"]]);
  assert.equal(view.getByText("8").textContent, "8");

  fireEvent.click(view.getByRole("button", { name: "Add" }));
  assert.deepEqual(calls[1], ["submit", { outputColumn: "amount_double", expression: "[amount] * 2", expressionVersion: 1 }]);
  view.unmount();
});

test("Formula column chooses the first unused default name and does not suggest columns inside strings", () => {
  const view = render(React.createElement(LanguageProvider, null, React.createElement(FormulaColumnEditor, {
    schema: [
      { name: "Formula column 1", type: "DOUBLE" },
      { name: "Formula Column 2", type: "VARCHAR" },
      { name: "amount", type: "DOUBLE" },
    ],
    title: "Formula column",
    submitLabel: "Add",
    onCancel() {},
    onSubmit() {},
  })));

  assert.equal(view.getByLabelText("New column name").value, "Formula column 3");
  assert.equal(view.queryByText("Insert column"), null);
  assert.equal(view.queryByText("Insert function"), null);
  const formula = view.getByLabelText("Formula");
  fireEvent.change(formula, { target: { value: "'[am", selectionStart: 4 } });
  assert.equal(view.queryByRole("listbox", { name: "Column suggestions" }), null);
  fireEvent.change(formula, { target: { value: "co", selectionStart: 2 } });
  assert.equal(view.getByRole("listbox", { name: "Function suggestions" }).textContent.includes("COALESCE"), true);
  fireEvent.keyDown(formula, { key: "Enter" });
  assert.equal(formula.value, "COALESCE()");
  assert.equal(formula.selectionStart, "COALESCE(".length);
  assert.match(view.getByRole("status", { name: "Function syntax" }).textContent, /COALESCE\(value1, value2, \.\.\.\)/);
  fireEvent.change(formula, { target: { value: "IF([amount])", selectionStart: 12 } });
  const functionHelp = view.getByRole("status", { name: "Function syntax" });
  assert.match(functionHelp.textContent, /IF\(condition, value_if_true, value_if_false\)/);
  assert.match(functionHelp.textContent, /Argument 2: value_if_true/);
  assert.equal(view.queryByText(/if expects 3 arguments/), null);
  view.unmount();
});
