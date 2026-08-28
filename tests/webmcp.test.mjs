import assert from "node:assert/strict";
import test from "node:test";
import {
  createWebMcpTools,
  registerWebMcpTools,
} from "../src/useWebMcpTools.js";

function createContext() {
  const calls = [];
  return {
    calls,
    ref: {
      current: {
        state: {
          workspace: "prepare",
          worker: { ready: true, recovering: false },
          flowDirty: false,
          activePreparedId: "prepared-a",
          activeNodeId: "operation-a",
          activeDataset: {
            name: "Orders",
            rowCount: 10,
            columnCount: 2,
            filterableColumns: ["status", "amount"],
            filterableColumnsTruncated: false,
            filters: {},
          },
          recipeSteps: [{ id: "step-a", type: "trim", enabled: true, params: { column: "status", mode: "both" } }],
          recipeHistory: { canUndo: true, canRedo: false },
          preparedInputs: [{ id: "prepared-a", name: "Orders", rowCount: 10, columnCount: 2 }],
          composeNodes: [
            { id: "prepared-a", name: "Orders", kind: "dataset", rowCount: 10, columnCount: 2 },
            { id: "operation-a", name: "Filtered orders", kind: "filter-rows", rowCount: 4, columnCount: 2 },
          ],
        },
        actions: {
          async openWorkspace(workspace) { calls.push(["workspace", workspace]); },
          async selectPrepared(preparedId) { calls.push(["prepared", preparedId]); },
          async applyFilters(filters) { calls.push(["filters", filters]); return { rowCount: 4 }; },
          async selectComposeNode(nodeId) { calls.push(["node", nodeId]); },
          async autoArrangeCompose() { calls.push(["arrange"]); return { revision: 3 }; },
          async requestSourceFileSelection() { calls.push(["file"]); },
          async exportPrepare(format) { calls.push(["export-prepare", format]); return { filename: `orders.${format}`, format, rowCount: 10 }; },
          async addRecipeStep(step) { calls.push(["add-step", step]); return { stepId: "step-b", rowCount: 10, columnCount: 2 }; },
          async updateRecipeStep(stepId, step) { calls.push(["update-step", stepId, step]); return { stepId, rowCount: 10, columnCount: 2 }; },
          async setRecipeStepEnabled(stepId, enabled) { calls.push(["enable-step", stepId, enabled]); return { stepId, enabled }; },
          async moveRecipeStep(stepId, position) { calls.push(["move-step", stepId, position]); return { stepId, position }; },
          async undoRecipe() { calls.push(["undo"]); return { rowCount: 10, columnCount: 2 }; },
          async redoRecipe() { calls.push(["redo"]); return { rowCount: 10, columnCount: 2 }; },
          async applyValueAction(action, column, value) { calls.push(["value-action", action, column, value]); return { action, column, value }; },
          async exportCompose(nodeId, format) { calls.push(["export-compose", nodeId, format]); return { nodeId, filename: `node.${format}`, format }; },
          async createComposeOperation(operation) { calls.push(["create-operation", operation]); return { nodeId: "operation-b", name: operation.name ?? "Filter rows 2" }; },
          async requestDelete(target, targetId) { calls.push(["delete-request", target, targetId]); },
        },
      },
    },
  };
}

function toolByName(tools, name) {
  const tool = tools.find((item) => item.name === name);
  assert.ok(tool, `Expected WebMCP tool ${name}`);
  return tool;
}

test("WebMCP exposes only tools available for the current TabulaFlow context", () => {
  const { ref } = createContext();
  const globalOnly = createWebMcpTools(ref, { hasDataset: false, hasPrepared: false, hasComposeNodes: false });
  assert.deepEqual(globalOnly.map((tool) => tool.name), [
    "tabulaflow_get_workspace_state",
    "tabulaflow_get_capabilities",
    "tabulaflow_open_workspace",
    "tabulaflow_request_source_file",
  ]);

  const allTools = createWebMcpTools(ref, { hasDataset: true, hasPrepared: true, hasComposeNodes: true });
  assert.deepEqual(allTools.map((tool) => tool.name), [
    "tabulaflow_get_workspace_state",
    "tabulaflow_get_capabilities",
    "tabulaflow_open_workspace",
    "tabulaflow_request_source_file",
    "tabulaflow_select_prepared_dataset",
    "tabulaflow_set_preview_filter",
    "tabulaflow_clear_preview_filters",
    "tabulaflow_export_prepare",
    "tabulaflow_add_recipe_step",
    "tabulaflow_update_recipe_step",
    "tabulaflow_set_recipe_step_enabled",
    "tabulaflow_move_recipe_step",
    "tabulaflow_undo_recipe",
    "tabulaflow_redo_recipe",
    "tabulaflow_apply_value_action",
    "tabulaflow_select_compose_node",
    "tabulaflow_auto_arrange_compose",
    "tabulaflow_export_compose",
    "tabulaflow_create_compose_operation",
    "tabulaflow_request_delete",
  ]);
});

test("WebMCP tools reuse visible TabulaFlow actions", async () => {
  const { calls, ref } = createContext();
  const tools = createWebMcpTools(ref, { hasDataset: true, hasPrepared: true, hasComposeNodes: true });

  const stateResult = await toolByName(tools, "tabulaflow_get_workspace_state").execute({});
  assert.equal(stateResult.structuredContent.workspace, "prepare");
  const capabilitiesResult = await toolByName(tools, "tabulaflow_get_capabilities").execute({});
  assert.equal(capabilitiesResult.structuredContent.authenticationRequired, false);
  assert.equal(capabilitiesResult.structuredContent.safeguards.deletion, "visible-user-confirmation-required");

  await toolByName(tools, "tabulaflow_open_workspace").execute({ workspace: "source" });
  await toolByName(tools, "tabulaflow_request_source_file").execute({});
  await toolByName(tools, "tabulaflow_select_prepared_dataset").execute({ preparedId: "prepared-a" });
  const filterResult = await toolByName(tools, "tabulaflow_set_preview_filter").execute({ column: "status", value: "open" });
  await toolByName(tools, "tabulaflow_clear_preview_filters").execute({});
  await toolByName(tools, "tabulaflow_select_compose_node").execute({ nodeId: "operation-a" });
  await toolByName(tools, "tabulaflow_auto_arrange_compose").execute({});
  await toolByName(tools, "tabulaflow_export_prepare").execute({ format: "csv" });
  await toolByName(tools, "tabulaflow_add_recipe_step").execute({ step: { type: "trim", params: { column: "status", mode: "both" } } });
  await toolByName(tools, "tabulaflow_update_recipe_step").execute({ stepId: "step-a", step: { type: "standardize-case", params: { column: "status", mode: "upper" } } });
  await toolByName(tools, "tabulaflow_set_recipe_step_enabled").execute({ stepId: "step-a", enabled: false });
  await toolByName(tools, "tabulaflow_move_recipe_step").execute({ stepId: "step-a", position: 1 });
  await toolByName(tools, "tabulaflow_undo_recipe").execute({});
  await toolByName(tools, "tabulaflow_redo_recipe").execute({});
  await toolByName(tools, "tabulaflow_apply_value_action").execute({ action: "keep", column: "status", value: "open" });
  await toolByName(tools, "tabulaflow_export_compose").execute({ nodeId: "operation-a", format: "xlsx" });
  await toolByName(tools, "tabulaflow_create_compose_operation").execute({ operation: { kind: "filter-rows", inputId: "prepared-a", column: "status", operator: "equals", value: "open" } });
  const deleteResult = await toolByName(tools, "tabulaflow_request_delete").execute({ target: "recipe-step", targetId: "step-a" });

  assert.equal(filterResult.structuredContent.rowCount, 4);
  assert.equal(deleteResult.structuredContent.pendingConfirmation, true);
  assert.deepEqual(calls, [
    ["workspace", "source"],
    ["file"],
    ["prepared", "prepared-a"],
    ["filters", { status: { key: "string:open", raw: "open", label: "open" } }],
    ["filters", {}],
    ["node", "operation-a"],
    ["arrange"],
    ["export-prepare", "csv"],
    ["add-step", { type: "trim", params: { column: "status", mode: "both" } }],
    ["update-step", "step-a", { type: "standardize-case", params: { column: "status", mode: "upper" } }],
    ["enable-step", "step-a", false],
    ["move-step", "step-a", 1],
    ["undo"],
    ["redo"],
    ["value-action", "keep", "status", "open"],
    ["export-compose", "operation-a", "xlsx"],
    ["create-operation", { kind: "filter-rows", inputId: "prepared-a", column: "status", operator: "equals", value: "open" }],
    ["delete-request", "recipe-step", "step-a"],
  ]);
});

test("WebMCP tools reject stale dataset and node identifiers", async () => {
  const { ref } = createContext();
  const tools = createWebMcpTools(ref, { hasDataset: true, hasPrepared: true, hasComposeNodes: true });
  await assert.rejects(() => toolByName(tools, "tabulaflow_set_preview_filter").execute({ column: "missing", value: "x" }), /not available/);
  await assert.rejects(() => toolByName(tools, "tabulaflow_select_prepared_dataset").execute({ preparedId: "missing" }), /Prepared dataset not found/);
  await assert.rejects(() => toolByName(tools, "tabulaflow_select_compose_node").execute({ nodeId: "missing" }), /Compose node not found/);
  await assert.rejects(() => toolByName(tools, "tabulaflow_export_compose").execute({ nodeId: "missing", format: "csv" }), /Compose node not found/);
  await assert.rejects(() => toolByName(tools, "tabulaflow_request_delete").execute({ target: "recipe-step", targetId: "missing" }), /not found/);
});

test("WebMCP registration passes one lifecycle signal and safely skips unsupported browsers", async () => {
  const { ref } = createContext();
  const tools = createWebMcpTools(ref, { hasDataset: false, hasPrepared: false, hasComposeNodes: false });
  const controller = new AbortController();
  const registrations = [];
  const supported = await registerWebMcpTools({
    async registerTool(tool, options) { registrations.push({ tool, options }); },
  }, tools, controller.signal);

  assert.equal(supported, true);
  assert.equal(registrations.length, 4);
  assert.ok(registrations.every(({ options }) => options.signal === controller.signal));
  assert.equal(await registerWebMcpTools(undefined, tools, controller.signal), false);
  controller.abort();
  assert.equal(registrations[0].options.signal.aborted, true);
});
