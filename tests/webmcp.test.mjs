import assert from "node:assert/strict";
import test from "node:test";
import { createWebMcpTools, registerWebMcpTools } from "../src/useWebMcpTools.js";

const REVISION = 7;
const mutation = (requestId) => ({ expectedRevision: REVISION, requestId });

function createContext() {
  const calls = [];
  const result = (extra = {}) => ({ workspaceRevision: REVISION + 1, ...extra });
  return {
    calls,
    ref: { current: {
      state: {
        contractVersion: "2.5", workspaceRevision: REVISION, activityCursor: 12, flowId: "flow-a", flowRevision: 4,
        workspace: "prepare", worker: { ready: true, recovering: false }, flowDirty: false, diagnostics: [],
        activePreparedId: "prepared-a", activeNodeId: "operation-a",
        selection: { prepareContext: { preparedId: "prepared-a" }, composeSelection: { nodeId: "operation-a" }, relationship: "independent-workspace-contexts" },
        activeDataset: {
          name: "Orders", totalRowCount: 10, filteredRowCount: 4, previewRowCount: 4, columnCount: 2,
          columns: ["status", "amount"], schema: [{ name: "status", type: "VARCHAR" }, { name: "amount", type: "DOUBLE" }],
          filterableColumns: ["status", "amount"], filterableColumnsTruncated: false, filters: {},
          quality: { emptyCellCount: 1, mixedTypeColumnCount: 0 },
        },
        recipeSteps: [{ id: "step-a", type: "trim", enabled: true, params: { column: "status", mode: "both" } }],
        recipeHistory: { canUndo: true, canRedo: false },
        preparedInputs: [{ id: "prepared-a", name: "Orders", rowCount: 10, columnCount: 2 }],
        composeNodes: [
          { id: "prepared-a", name: "Orders", kind: "dataset", rowCount: 10, columnCount: 2 },
          { id: "operation-a", name: "Filtered orders", kind: "filter-rows", rowCount: 4, columnCount: 2 },
        ],
        sourceAssets: [{ id: "source-a", name: "orders.csv", status: "linked" }],
      },
      actions: {
        async getAvailableActions(targetId) { calls.push(["available-actions", targetId]); return { targetId, actions: ["inspect"] }; },
        async getActivityLog(options) { calls.push(["activity", options]); return { events: [{ sequence: 12, actor: "agent" }], cursor: 12, hasMore: false }; },
        async getChangesSince(cursor, options) { calls.push(["changes", cursor, options]); return { events: [], cursor, hasMore: false }; },
        async getOperationStatus(operationId) { calls.push(["operation-status", operationId]); return { operationId, status: "committed" }; },
        async openWorkspace(workspace) { calls.push(["workspace", workspace]); return { workspace, workspaceRevision: REVISION, activityCursor: 12, activePreparedId: "prepared-a", activeNodeId: "operation-a" }; },
        async requestSourceFileSelection() { calls.push(["file"]); },
        async requestSourceRelink(sourceAssetId) { calls.push(["relink", sourceAssetId]); },
        async listCloudFiles() { calls.push(["cloud-list"]); return { authenticated: true, files: [{ id: "cloud-a" }] }; },
        async openCloudFile(fileId, meta) { calls.push(["cloud-open", fileId, meta]); return result({ fileId, name: "orders.csv" }); },
        async requestCloudUpload() { calls.push(["cloud-upload"]); },
        async selectPrepared(preparedId, meta) { calls.push(["prepared", preparedId, meta]); },
        async getRecipe(preparedId) { calls.push(["recipe", preparedId]); return { preparedId, name: "Orders", recipe: [] }; },
        async getSemanticModel(targetId) { calls.push(["semantic", targetId]); return { targetId, revision: 0, fields: {} }; },
        async updateSemanticField(targetId, fieldName, changes, meta) { calls.push(["semantic-update", targetId, fieldName, changes, meta]); return result({ targetId, fieldName }); },
        async listMetricDefinitions(targetId) { calls.push(["metric-list", targetId]); return { targetId, metrics: [] }; },
        async upsertMetricDefinition(definition, meta) { calls.push(["metric-upsert", definition, meta]); return result({ metric: definition }); },
        async deleteMetricDefinition(id, meta) { calls.push(["metric-delete", id, meta]); return result({ id, deleted: true }); },
        async replaceRecipe(preparedId, recipe, expectedRecipeRevision, meta) { calls.push(["replace-recipe", preparedId, recipe, expectedRecipeRevision, meta]); return result({ recipeRevision: expectedRecipeRevision + 1 }); },
        async duplicatePrepared(preparedId, meta) { calls.push(["duplicate", preparedId, meta]); return result({ preparedInputId: "prepared-b" }); },
        async getPrepareDataset(preparedId) { calls.push(["dataset", preparedId]); return { preparedId, name: "Orders", columns: ["status", "amount"] }; },
        async getDataProfile(preparedId, columns) { calls.push(["profile", preparedId, columns]); return { columns: [{ name: "status" }] }; },
        async queryColumnValues(preparedId, column, search, options) { calls.push(["values", preparedId, column, search, options]); return { column, values: [{ value: "open", count: 4 }], matchCount: 1 }; },
        async getPreparePreview(preparedId, columns, options) { calls.push(["prepare-preview", preparedId, columns, options]); return { previewRowCount: 1, rows: [{ status: "open" }] }; },
        async previewRecipeChange(preparedId, recipe, stepIndex, options) { calls.push(["recipe-preview", preparedId, recipe, stepIndex, options]); return { valid: true, output: { rowCount: 4, columnCount: 2 }, schemaDelta: {}, diagnostics: [], saved: false }; },
        async applyFilters(preparedId, filters, meta) { calls.push(["filters", preparedId, filters, meta]); return result({ rowCount: 10, filteredCount: Object.keys(filters).length ? 4 : 10 }); },
        async setAggregateColumns(preparedId, columns, meta) { calls.push(["aggregate-columns", preparedId, columns, meta]); return result({ aggregateColumns: columns, hiddenAggregateColumnCount: 2 - columns.length }); },
        async exportPrepare(preparedId, format) { calls.push(["export-prepare", preparedId, format]); return { filename: `orders.${format}`, format, totalRowCount: 10, filteredRowCount: 4 }; },
        async addRecipeStep(preparedId, step, meta) { calls.push(["add-step", preparedId, step, meta]); return result({ stepId: "step-b" }); },
        async updateRecipeStep(preparedId, stepId, step, meta) { calls.push(["update-step", preparedId, stepId, step, meta]); return result({ stepId }); },
        async setRecipeStepEnabled(preparedId, stepId, enabled, meta) { calls.push(["enable-step", preparedId, stepId, enabled, meta]); return result({ stepId, enabled }); },
        async moveRecipeStep(preparedId, stepId, position, meta) { calls.push(["move-step", preparedId, stepId, position, meta]); return result({ stepId, position }); },
        async undoRecipe(preparedId, meta) { calls.push(["undo", preparedId, meta]); return result(); },
        async redoRecipe(preparedId, meta) { calls.push(["redo", preparedId, meta]); return result(); },
        async applyValueAction(preparedId, action, column, value, meta) { calls.push(["value-action", preparedId, action, column, value, meta]); return result({ action, column, value }); },
        async getComposeGraph() { calls.push(["graph"]); return { nodes: [{ id: "operation-a" }], edges: [], workspaceRevision: REVISION }; },
        async getComposeNode(nodeId) { calls.push(["compose-node", nodeId]); return { id: nodeId, name: "Filtered orders" }; },
        async getComposeNodePreview(nodeId, columns, options) { calls.push(["node-preview", nodeId, columns, options]); return { previewRowCount: 1, rows: [{ status: "open" }] }; },
        async getComposeNodeQuality(nodeId) { calls.push(["node-quality", nodeId]); return { nodeId, emptyCellCount: 0, mixedTypeColumnCount: 0 }; },
        async validateComposeOperation(operation, options) { calls.push(["validate", operation, options]); return { valid: true, output: { rowCount: 4, columnCount: 2 }, schemaDelta: {}, diagnostics: [] }; },
        async getConnectionOptions(nodeId) { calls.push(["connections", nodeId]); return { nodeId, targets: [] }; },
        async selectComposeNode(nodeId, meta) { calls.push(["node", nodeId, meta]); },
        async autoArrangeCompose(meta) { calls.push(["arrange", meta]); return result({ revision: 5 }); },
        async moveComposeNode(nodeId, position, meta) { calls.push(["move-node", nodeId, position, meta]); return result({ nodeId, position }); },
        async exportCompose(nodeId, format) { calls.push(["export-compose", nodeId, format]); return { nodeId, filename: `node.${format}`, format }; },
        async createComposeOperation(operation, meta) { calls.push(["create-operation", operation, meta]); return result({ nodeId: "operation-b", name: operation.name ?? "Filter rows 2" }); },
        async updateComposeOperation(nodeId, operation, meta) { calls.push(["update-operation", nodeId, operation, meta]); return result({ nodeId, name: "Filtered orders" }); },
        async promoteComposeResult(nodeId, meta) { calls.push(["promote", nodeId, meta]); return result({ preparedInputId: "prepared-b" }); },
        async requestDelete(target, targetId, meta) { calls.push(["delete-request", target, targetId, meta]); return result({ target, targetId, pendingConfirmation: true }); },
      },
    } },
  };
}

function toolByName(tools, name) {
  const tool = tools.find((item) => item.name === name);
  assert.ok(tool, `Expected WebMCP tool ${name}`);
  return tool;
}

const GLOBAL_TOOL_NAMES = [
  "tabulaflow_get_workspace_state", "tabulaflow_get_capabilities", "tabulaflow_get_workflow_guide", "tabulaflow_get_calculation_catalog",
  "tabulaflow_describe_operation", "tabulaflow_get_available_actions", "tabulaflow_get_activity_log",
  "tabulaflow_get_changes_since", "tabulaflow_get_operation_status", "tabulaflow_open_workspace",
  "tabulaflow_request_source_file", "tabulaflow_request_source_relink", "tabulaflow_list_cloud_files",
  "tabulaflow_open_cloud_file", "tabulaflow_request_cloud_upload",
];

const ALL_TOOL_NAMES = [
  ...GLOBAL_TOOL_NAMES,
  "tabulaflow_select_prepared_dataset", "tabulaflow_get_recipe", "tabulaflow_get_semantic_model", "tabulaflow_update_semantic_field", "tabulaflow_list_metric_definitions", "tabulaflow_upsert_metric_definition", "tabulaflow_delete_metric_definition", "tabulaflow_replace_recipe", "tabulaflow_duplicate_prepared_dataset",
  "tabulaflow_get_prepare_dataset", "tabulaflow_get_data_profile", "tabulaflow_query_column_values",
  "tabulaflow_get_prepare_preview", "tabulaflow_preview_recipe_change", "tabulaflow_set_aggregate_columns", "tabulaflow_set_preview_filter",
  "tabulaflow_remove_preview_filter", "tabulaflow_clear_preview_filters", "tabulaflow_export_prepare",
  "tabulaflow_add_recipe_step", "tabulaflow_update_recipe_step", "tabulaflow_set_recipe_step_enabled",
  "tabulaflow_move_recipe_step", "tabulaflow_undo_recipe", "tabulaflow_redo_recipe", "tabulaflow_apply_value_action",
  "tabulaflow_get_compose_graph", "tabulaflow_get_compose_node", "tabulaflow_get_node_preview", "tabulaflow_get_compose_node_quality",
  "tabulaflow_validate_compose_operation", "tabulaflow_get_connection_options", "tabulaflow_select_compose_node",
  "tabulaflow_auto_arrange_compose", "tabulaflow_move_compose_node", "tabulaflow_export_compose",
  "tabulaflow_create_compose_operation", "tabulaflow_update_compose_operation", "tabulaflow_promote_compose_result",
  "tabulaflow_request_delete",
];

test("WebMCP exposes contextual Agent-Ready v2 tools", () => {
  const { ref } = createContext();
  assert.deepEqual(createWebMcpTools(ref, { hasDataset: false, hasPrepared: false, hasComposeNodes: false }).map((tool) => tool.name), GLOBAL_TOOL_NAMES);
  const allTools = createWebMcpTools(ref, { hasDataset: true, hasPrepared: true, hasComposeNodes: true });
  assert.deepEqual(allTools.map((tool) => tool.name), ALL_TOOL_NAMES);
  assert.equal(new Set(ALL_TOOL_NAMES).size, 55);
});

test("WebMCP read plane observes workflow, Prepare data, and Compose data", async () => {
  const { calls, ref } = createContext();
  const tools = createWebMcpTools(ref, { hasDataset: true, hasPrepared: true, hasComposeNodes: true });
  const state = await toolByName(tools, "tabulaflow_get_workspace_state").execute({});
  const capabilities = await toolByName(tools, "tabulaflow_get_capabilities").execute({});
  const guide = await toolByName(tools, "tabulaflow_get_workflow_guide").execute({});
  const calculationCatalog = await toolByName(tools, "tabulaflow_get_calculation_catalog").execute({});
  const operation = await toolByName(tools, "tabulaflow_describe_operation").execute({ kind: "join" });
  await toolByName(tools, "tabulaflow_get_available_actions").execute({ targetId: "prepared-a" });
  await toolByName(tools, "tabulaflow_get_activity_log").execute({ limit: 20, actor: "agent" });
  await toolByName(tools, "tabulaflow_get_changes_since").execute({ cursor: 12, limit: 20 });
  await toolByName(tools, "tabulaflow_get_operation_status").execute({ operationId: "operation-1" });
  await toolByName(tools, "tabulaflow_get_recipe").execute({ preparedId: "prepared-a" });
  await toolByName(tools, "tabulaflow_get_semantic_model").execute({ targetId: "prepared-a" });
  await toolByName(tools, "tabulaflow_list_metric_definitions").execute({ targetId: "prepared-a" });
  await toolByName(tools, "tabulaflow_get_prepare_dataset").execute({ preparedId: "prepared-a" });
  await toolByName(tools, "tabulaflow_get_data_profile").execute({ preparedId: "prepared-a", columns: ["status"] });
  await toolByName(tools, "tabulaflow_query_column_values").execute({ preparedId: "prepared-a", column: "status", search: "op", offset: 0, limit: 20 });
  await toolByName(tools, "tabulaflow_get_prepare_preview").execute({ preparedId: "prepared-a", columns: ["status"], offset: 0, limit: 20 });
  await toolByName(tools, "tabulaflow_preview_recipe_change").execute({ preparedId: "prepared-a", recipe: [], stepIndex: 0 });
  await toolByName(tools, "tabulaflow_get_compose_graph").execute({});
  await toolByName(tools, "tabulaflow_get_compose_node").execute({ nodeId: "operation-a" });
  await toolByName(tools, "tabulaflow_get_node_preview").execute({ nodeId: "operation-a", columns: ["status"], offset: 0, limit: 20 });
  await toolByName(tools, "tabulaflow_get_compose_node_quality").execute({ nodeId: "operation-a" });
  const candidate = { kind: "filter-rows", inputId: "prepared-a", column: "status", operator: "equals", value: "open" };
  await toolByName(tools, "tabulaflow_validate_compose_operation").execute({ operation: candidate });
  await toolByName(tools, "tabulaflow_get_connection_options").execute({ nodeId: "prepared-a" });

  assert.equal(state.structuredContent.workspaceRevision, REVISION);
  assert.equal(capabilities.structuredContent.contractVersion, "2.5");
  assert.equal(calculationCatalog.structuredContent.expressionVersion, 1);
  assert.ok(calculationCatalog.structuredContent.functions.some((item) => item.name === "try_cast"));
  assert.equal(state.structuredContent.selection.relationship, "independent-workspace-contexts");
  assert.equal(capabilities.structuredContent.safeguards.deletion, "visible-user-confirmation-required");
  assert.equal(guide.structuredContent.flow.length, 3);
  assert.equal(operation.structuredContent.inputs, 2);
  assert.ok(tools.filter((tool) => tool.annotations?.untrustedContentHint).length >= 10);
  assert.deepEqual(calls, [
    ["available-actions", "prepared-a"], ["activity", { limit: 20, targetId: undefined, actor: "agent" }], ["changes", 12, { limit: 20 }], ["operation-status", "operation-1"], ["recipe", "prepared-a"], ["semantic", "prepared-a"], ["metric-list", "prepared-a"], ["dataset", "prepared-a"],
    ["profile", "prepared-a", ["status"]], ["values", "prepared-a", "status", "op", { offset: 0, limit: 20 }],
    ["prepare-preview", "prepared-a", ["status"], { offset: 0, limit: 20 }], ["recipe-preview", "prepared-a", [], 0, { previewColumns: undefined, previewLimit: 10 }],
    ["graph"], ["compose-node", "operation-a"], ["node-preview", "operation-a", ["status"], { offset: 0, limit: 20 }], ["node-quality", "operation-a"],
    ["validate", candidate, { previewColumns: undefined, previewLimit: 10 }], ["connections", "prepared-a"],
  ]);
});

test("WebMCP mutations target stable IDs and carry revision plus idempotency metadata", async () => {
  const { calls, ref } = createContext();
  const tools = createWebMcpTools(ref, { hasDataset: true, hasPrepared: true, hasComposeNodes: true });
  const trim = { type: "trim", params: { column: "status", mode: "both" } };
  const filter = { kind: "filter-rows", inputId: "prepared-a", column: "status", operator: "equals", value: "open" };

  await toolByName(tools, "tabulaflow_open_workspace").execute({ workspace: "source" });
  await toolByName(tools, "tabulaflow_request_source_file").execute({});
  await toolByName(tools, "tabulaflow_request_source_relink").execute({ sourceAssetId: "source-a" });
  await toolByName(tools, "tabulaflow_list_cloud_files").execute({});
  await toolByName(tools, "tabulaflow_open_cloud_file").execute({ fileId: "cloud-a", ...mutation("cloud-open-001") });
  await toolByName(tools, "tabulaflow_request_cloud_upload").execute({});
  await toolByName(tools, "tabulaflow_select_prepared_dataset").execute({ preparedId: "prepared-a", ...mutation("prepared-select-001") });
  await toolByName(tools, "tabulaflow_duplicate_prepared_dataset").execute({ preparedId: "prepared-a", ...mutation("duplicate-001") });
  await toolByName(tools, "tabulaflow_set_aggregate_columns").execute({ preparedId: "prepared-a", columns: ["status"], ...mutation("aggregate-columns-001") });
  const filtered = await toolByName(tools, "tabulaflow_set_preview_filter").execute({ preparedId: "prepared-a", column: "status", value: "open", ...mutation("filter-set-001") });
  await toolByName(tools, "tabulaflow_remove_preview_filter").execute({ preparedId: "prepared-a", column: "status", ...mutation("filter-remove-001") });
  await toolByName(tools, "tabulaflow_clear_preview_filters").execute({ preparedId: "prepared-a", ...mutation("filter-clear-001") });
  await toolByName(tools, "tabulaflow_export_prepare").execute({ preparedId: "prepared-a", format: "csv" });
  await toolByName(tools, "tabulaflow_add_recipe_step").execute({ preparedId: "prepared-a", step: trim, ...mutation("recipe-add-001") });
  await toolByName(tools, "tabulaflow_replace_recipe").execute({ preparedId: "prepared-a", recipe: [{ id: "step-a", ...trim, enabled: true }], expectedRecipeRevision: 1, ...mutation("recipe-replace-001") });
  await toolByName(tools, "tabulaflow_update_recipe_step").execute({ preparedId: "prepared-a", stepId: "step-a", step: trim, ...mutation("recipe-update-001") });
  await toolByName(tools, "tabulaflow_set_recipe_step_enabled").execute({ preparedId: "prepared-a", stepId: "step-a", enabled: false, ...mutation("recipe-enable-001") });
  await toolByName(tools, "tabulaflow_move_recipe_step").execute({ preparedId: "prepared-a", stepId: "step-a", position: 1, ...mutation("recipe-move-001") });
  await toolByName(tools, "tabulaflow_undo_recipe").execute({ preparedId: "prepared-a", ...mutation("recipe-undo-001") });
  await toolByName(tools, "tabulaflow_redo_recipe").execute({ preparedId: "prepared-a", ...mutation("recipe-redo-001") });
  await toolByName(tools, "tabulaflow_apply_value_action").execute({ preparedId: "prepared-a", action: "keep", column: "status", value: "open", ...mutation("value-action-001") });
  await toolByName(tools, "tabulaflow_select_compose_node").execute({ nodeId: "operation-a", ...mutation("compose-select-001") });
  await toolByName(tools, "tabulaflow_auto_arrange_compose").execute(mutation("arrange-001"));
  await toolByName(tools, "tabulaflow_move_compose_node").execute({ nodeId: "operation-a", position: { x: 200, y: 300 }, ...mutation("move-node-001") });
  await toolByName(tools, "tabulaflow_export_compose").execute({ nodeId: "operation-a", format: "xlsx" });
  await toolByName(tools, "tabulaflow_create_compose_operation").execute({ operation: filter, ...mutation("operation-create-001") });
  await toolByName(tools, "tabulaflow_update_compose_operation").execute({ nodeId: "operation-a", operation: filter, ...mutation("operation-update-001") });
  await toolByName(tools, "tabulaflow_promote_compose_result").execute({ nodeId: "operation-a", ...mutation("promote-001") });
  const deletion = await toolByName(tools, "tabulaflow_request_delete").execute({ target: "recipe-step", targetId: "step-a", ...mutation("delete-001") });

  assert.equal(filtered.structuredContent.totalRowCount, 10);
  assert.equal(filtered.structuredContent.filteredRowCount, 4);
  assert.equal(deletion.structuredContent.pendingConfirmation, true);
  assert.ok(calls.some((call) => call[0] === "duplicate" && call[2].expectedRevision === REVISION));
  assert.ok(calls.some((call) => call[0] === "create-operation" && call[2].requestId === "operation-create-001"));
  assert.ok(calls.some((call) => call[0] === "delete-request" && call[3].requestId === "delete-001"));
});

test("WebMCP rejects stale target identifiers before invoking visible actions", async () => {
  const { calls, ref } = createContext();
  const tools = createWebMcpTools(ref, { hasDataset: true, hasPrepared: true, hasComposeNodes: true });
  await assert.rejects(() => toolByName(tools, "tabulaflow_set_preview_filter").execute({ preparedId: "prepared-a", column: "missing", value: "x", ...mutation("missing-column-001") }), /not available/);
  await assert.rejects(() => toolByName(tools, "tabulaflow_set_preview_filter").execute({ preparedId: "missing", column: "status", value: "x", ...mutation("missing-prepared-001") }), /not active/);
  await assert.rejects(() => toolByName(tools, "tabulaflow_select_prepared_dataset").execute({ preparedId: "missing", ...mutation("missing-prepared-select") }), /not found/);
  await assert.rejects(() => toolByName(tools, "tabulaflow_select_compose_node").execute({ nodeId: "missing", ...mutation("missing-compose-select") }), /not found/);
  await assert.rejects(() => toolByName(tools, "tabulaflow_export_compose").execute({ nodeId: "missing", format: "csv" }), /not found/);
  await assert.rejects(() => toolByName(tools, "tabulaflow_request_delete").execute({ target: "recipe-step", targetId: "missing", ...mutation("missing-delete-001") }), /not found/);
  assert.equal(calls.length, 0);
});

test("WebMCP mutation schemas require collaboration metadata and conditional values", () => {
  const { ref } = createContext();
  const tools = createWebMcpTools(ref, { hasDataset: true, hasPrepared: true, hasComposeNodes: true });
  for (const name of [
    "tabulaflow_open_cloud_file", "tabulaflow_select_prepared_dataset", "tabulaflow_duplicate_prepared_dataset", "tabulaflow_set_aggregate_columns", "tabulaflow_set_preview_filter", "tabulaflow_add_recipe_step", "tabulaflow_replace_recipe",
    "tabulaflow_select_compose_node", "tabulaflow_auto_arrange_compose", "tabulaflow_create_compose_operation", "tabulaflow_update_compose_operation",
    "tabulaflow_promote_compose_result", "tabulaflow_request_delete",
  ]) {
    const required = toolByName(tools, name).inputSchema.required;
    assert.ok(required.includes("expectedRevision"), `${name} must require expectedRevision`);
    assert.ok(required.includes("requestId"), `${name} must require requestId`);
  }
  const branches = toolByName(tools, "tabulaflow_create_compose_operation").inputSchema.properties.operation.oneOf;
  const filters = branches.filter((branch) => branch.properties.kind.const === "filter-rows");
  assert.equal(filters.length, 2);
  assert.ok(filters.some((branch) => branch.required.includes("value")));
  assert.ok(filters.some((branch) => !Object.hasOwn(branch.properties, "value")));
  const aggregates = branches.filter((branch) => branch.properties.kind.const === "aggregate");
  assert.equal(aggregates.length, 3);
  assert.ok(aggregates.some((branch) => branch.required.includes("measureColumn")));
  assert.ok(aggregates.some((branch) => branch.required.includes("metrics")));
  assert.equal(toolByName(tools, "tabulaflow_replace_recipe").inputSchema.properties.executionMode.default, "wait");
  const previewStep = toolByName(tools, "tabulaflow_preview_recipe_change").inputSchema.properties.recipe.items;
  assert.ok(previewStep.required.includes("id"));
  assert.equal(toolByName(tools, "tabulaflow_preview_recipe_change").inputSchema.properties.previewLimit.maximum, 20);
  assert.equal(toolByName(tools, "tabulaflow_validate_compose_operation").inputSchema.properties.previewLimit.maximum, 20);
  const recipeStepDefinitions = toolByName(tools, "tabulaflow_add_recipe_step").inputSchema.properties.step.oneOf;
  const formulaDefinition = recipeStepDefinitions.find((branch) => branch.properties.type.const === "calculated-field");
  assert.deepEqual(formulaDefinition.properties.params.required, ["outputColumn", "expression", "expressionVersion"]);
  assert.equal(formulaDefinition.properties.params.properties.expressionVersion.const, 1);
  assert.deepEqual(toolByName(tools, "tabulaflow_get_prepare_preview").inputSchema.required, ["preparedId", "columns"]);
  assert.equal(toolByName(tools, "tabulaflow_get_prepare_preview").inputSchema.properties.columns.maxItems, 20);
  assert.deepEqual(toolByName(tools, "tabulaflow_get_node_preview").inputSchema.required, ["nodeId", "columns"]);
});

test("WebMCP registration is sequential, uses one lifecycle signal, and skips unsupported browsers", async () => {
  const { ref } = createContext();
  const tools = createWebMcpTools(ref, { hasDataset: false, hasPrepared: false, hasComposeNodes: false });
  const controller = new AbortController();
  const registrations = [];
  const supported = await registerWebMcpTools({ async registerTool(tool, options) { registrations.push({ tool, options }); } }, tools, controller.signal);
  assert.equal(supported, true);
  assert.equal(registrations.length, GLOBAL_TOOL_NAMES.length);
  assert.deepEqual(registrations.map(({ tool }) => tool.name), GLOBAL_TOOL_NAMES);
  assert.ok(registrations.every(({ options }) => options.signal === controller.signal));
  assert.equal(await registerWebMcpTools(undefined, tools, controller.signal), false);
  controller.abort();
  assert.equal(registrations[0].options.signal.aborted, true);
});
