import assert from "node:assert/strict";
import test from "node:test";
import {
  WEBMCP_ACTION_CONTRACT_ACTION,
  WEBMCP_CORE_TOOL_NAMES,
  WEBMCP_DISPATCH_ACTIONS,
  WEBMCP_STABLE_TOOL_NAMES,
  createWebMcpStableTools,
  createWebMcpTools,
  registerWebMcpTools,
} from "../src/useWebMcpTools.js";
import { protectRecipeForAgent, restoreProtectedRecipeValues } from "../src/agentDataProtection.js";
import { WEBMCP_REGISTRATION_BUDGET, measureWebMcpToolset } from "../src/webMcpRuntime.js";

const REVISION = 7;
const mutation = (requestId) => ({ expectedRevision: REVISION, requestId });

function createContext() {
  const calls = [];
  const result = (extra = {}) => ({ workspaceRevision: REVISION + 1, ...extra });
  return {
    calls,
    ref: { current: {
      state: {
        contractVersion: "3.2.4", workspaceRevision: REVISION, activityCursor: 12, flowId: "flow-a", flowRevision: 4,
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
        metricDefinitions: [{ id: "metric-a", name: "Revenue", targetId: "prepared-a" }],
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
        async getOperationStatus(operationId) { calls.push(["operation-status", operationId]); return { operationId, status: "succeeded" }; },
        async cancelOperation(operationId) { calls.push(["cancel-operation", operationId]); return { operationId, status: "cancelling" }; },
        async cancelInteraction(interactionId) { calls.push(["cancel-interaction", interactionId]); return { interactionId, status: "cancelled" }; },
        async getPendingConfirmations() { calls.push(["pending-confirmations"]); return { confirmations: [] }; },
        async rejectConfirmation(confirmationId) { calls.push(["reject-confirmation", confirmationId]); return { confirmationId, status: "cancelled" }; },
        async openWorkspace(workspace) { calls.push(["workspace", workspace]); return { workspace, workspaceRevision: REVISION, activityCursor: 12, activePreparedId: "prepared-a", activeNodeId: "operation-a" }; },
        async requestSourceFileSelection() { calls.push(["file"]); return { interactionId: "interaction-file", status: "awaiting-user", awaitingUser: true, workspace: "source" }; },
        async requestSourceRelink(sourceAssetId) { calls.push(["relink", sourceAssetId]); return { interactionId: "interaction-relink", status: "awaiting-user", awaitingUser: true, workspace: "source", sourceAssetId }; },
        async requestResetAll(meta) { calls.push(["reset-all", meta]); return result({ pendingConfirmation: true }); },
        async listCloudFiles() { calls.push(["cloud-list"]); return { authenticated: true, files: [{ id: "cloud-a" }] }; },
        async openCloudFile(fileId, meta) { calls.push(["cloud-open", fileId, meta]); return result({ fileId, name: "orders.csv" }); },
        async requestCloudUpload() { calls.push(["cloud-upload"]); },
        async selectPrepared(preparedId, meta) { calls.push(["prepared", preparedId, meta]); },
        async getRecipe(preparedId) { calls.push(["recipe", preparedId]); return { preparedId, name: "Orders", recipe: [] }; },
        async getSemanticModel(targetId) { calls.push(["semantic", targetId]); return { targetId, revision: 0, fields: {} }; },
        async updateSemanticField(targetId, fieldName, changes, meta) { calls.push(["semantic-update", targetId, fieldName, changes, meta]); return result({ targetId, fieldName }); },
        async listMetricDefinitions(targetId) { calls.push(["metric-list", targetId]); return { targetId, metrics: [] }; },
        async upsertMetricDefinition(definition, meta) { calls.push(["metric-upsert", definition, meta]); return result({ metric: definition }); },
        async replaceRecipe(preparedId, recipe, expectedRecipeRevision, meta) { calls.push(["replace-recipe", preparedId, recipe, expectedRecipeRevision, meta]); return result({ recipeRevision: expectedRecipeRevision + 1 }); },
        async duplicatePrepared(preparedId, meta) { calls.push(["duplicate", preparedId, meta]); return result({ preparedInputId: "prepared-b" }); },
        async getPrepareDataset(preparedId) { calls.push(["dataset", preparedId]); return { preparedId, name: "Orders", columns: ["status", "amount"] }; },
        async getDataProfile(preparedId, columns) { calls.push(["profile", preparedId, columns]); return { columns: [{ name: "status" }] }; },
        async queryColumnValues(preparedId, column, search, options) { calls.push(["values", preparedId, column, search, options]); return { column, values: [{ value: "open", count: 4 }], matchCount: 1 }; },
        async getPreparePreview(preparedId, columns, options) { calls.push(["prepare-preview", preparedId, columns, options]); return { previewRowCount: 1, rows: [{ status: "open" }] }; },
        async getCodingProject(projectId) { calls.push(["coding-project", projectId]); return { id: projectId ?? "coding-a", name: "Survey coding", revision: 2, codebookRevision: 1, progress: { pending: 0 } }; },
        async getCodingProgress(projectId) { calls.push(["coding-progress", projectId]); return { id: projectId ?? "coding-a", revision: 2, codebookRevision: 1, progress: { pending: 0 } }; },
        async getCodingBatch(projectId, options) { calls.push(["coding-batch", projectId, options]); return { items: [{ responseRef: "response-a", text: "redacted response" }] }; },
        async submitCodingBatch(projectId, batchId, submissions, meta) { calls.push(["coding-submit", projectId, batchId, submissions, meta]); return result({ pendingReviewCount: submissions.length }); },
        async previewRecipeChange(preparedId, recipe, stepIndex, options) { calls.push(["recipe-preview", preparedId, recipe, stepIndex, options]); return { valid: true, output: { rowCount: 4, columnCount: 2 }, schemaDelta: {}, diagnostics: [], saved: false }; },
        async applyFilters(preparedId, filters, meta) { calls.push(["filters", preparedId, filters, meta]); return result({ rowCount: 10, filteredCount: Object.keys(filters).length ? 4 : 10 }); },
        async setAggregateColumns(preparedId, columns, meta) { calls.push(["aggregate-columns", preparedId, columns, meta]); return result({ aggregateColumns: columns, hiddenAggregateColumnCount: 2 - columns.length }); },
        async exportPrepare(preparedId, format, meta) { calls.push(["export-prepare", preparedId, format, meta]); return result({ filename: `orders.${format}`, format, totalRowCount: 10, filteredRowCount: 4 }); },
        async addRecipeStep(preparedId, step, meta) { calls.push(["add-step", preparedId, step, meta]); return result({ stepId: "step-b" }); },
        async updateRecipeStep(preparedId, stepId, step, meta) { calls.push(["update-step", preparedId, stepId, step, meta]); return result({ stepId }); },
        async setRecipeStepEnabled(preparedId, stepId, enabled, meta) { calls.push(["enable-step", preparedId, stepId, enabled, meta]); return result({ stepId, enabled }); },
        async moveRecipeStep(preparedId, stepId, position, meta) { calls.push(["move-step", preparedId, stepId, position, meta]); return result({ stepId, position }); },
        async undoRecipe(preparedId, meta) { calls.push(["undo", preparedId, meta]); return result(); },
        async redoRecipe(preparedId, meta) { calls.push(["redo", preparedId, meta]); return result(); },
        async applyValueAction(preparedId, action, column, value, meta) { calls.push(["value-action", preparedId, action, column, value, meta]); return result({ action, column, value }); },
        async getComposeGraph() { calls.push(["graph"]); return { nodes: [{ id: "operation-a" }], edges: [], workspaceRevision: REVISION }; },
        async getComposeNode(nodeId) { calls.push(["compose-node", nodeId]); return { id: nodeId, name: "Filtered orders" }; },
        async getComposeNodeSchema(nodeId, options) { calls.push(["node-schema", nodeId, options]); return { nodeId, columns: [{ name: "status", type: "VARCHAR" }], totalColumnCount: 1, hasMore: false }; },
        async getComposeNodePreview(nodeId, columns, options) { calls.push(["node-preview", nodeId, columns, options]); return { previewRowCount: 1, rows: [{ status: "open" }] }; },
        async getComposeNodeQuality(nodeId) { calls.push(["node-quality", nodeId]); return { nodeId, emptyCellCount: 0, mixedTypeColumnCount: 0 }; },
        async validateComposeOperation(operation, options) { calls.push(["validate", operation, options]); return { valid: true, output: { rowCount: 4, columnCount: 2 }, schemaDelta: {}, diagnostics: [] }; },
        async getConnectionOptions(nodeId) { calls.push(["connections", nodeId]); return { nodeId, targets: [] }; },
        async selectComposeNode(nodeId, meta) { calls.push(["node", nodeId, meta]); },
        async autoArrangeCompose(meta) { calls.push(["arrange", meta]); return result({ revision: 5 }); },
        async moveComposeNode(nodeId, position, meta) { calls.push(["move-node", nodeId, position, meta]); return result({ nodeId, position }); },
        async exportCompose(nodeId, format, meta) { calls.push(["export-compose", nodeId, format, meta]); return result({ nodeId, filename: `node.${format}`, format }); },
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
  "tabulaflow_get_changes_since", "tabulaflow_get_operation_status", "tabulaflow_cancel_operation",
  "tabulaflow_get_pending_confirmations", "tabulaflow_reject_confirmation", "tabulaflow_open_workspace",
  "tabulaflow_request_source_file", "tabulaflow_request_source_relink", "tabulaflow_request_reset_all", "tabulaflow_list_cloud_files",
  "tabulaflow_open_cloud_file", "tabulaflow_request_cloud_upload",
];

const ALL_TOOL_NAMES = [
  ...GLOBAL_TOOL_NAMES,
  "tabulaflow_select_prepared_dataset", "tabulaflow_get_recipe", "tabulaflow_get_semantic_model", "tabulaflow_update_semantic_field", "tabulaflow_list_metric_definitions", "tabulaflow_upsert_metric_definition", "tabulaflow_delete_metric_definition", "tabulaflow_replace_recipe", "tabulaflow_duplicate_prepared_dataset",
  "tabulaflow_get_prepare_dataset", "tabulaflow_get_data_profile", "tabulaflow_query_column_values",
  "tabulaflow_get_prepare_preview", "tabulaflow_qualitative_coding", "tabulaflow_preview_recipe_change", "tabulaflow_set_aggregate_columns", "tabulaflow_set_preview_filter",
  "tabulaflow_remove_preview_filter", "tabulaflow_clear_preview_filters", "tabulaflow_export_prepare",
  "tabulaflow_add_recipe_step", "tabulaflow_request_delete_all_recipe_steps", "tabulaflow_update_recipe_step", "tabulaflow_set_recipe_step_enabled",
  "tabulaflow_move_recipe_step", "tabulaflow_undo_recipe", "tabulaflow_redo_recipe", "tabulaflow_apply_value_action",
  "tabulaflow_get_compose_graph", "tabulaflow_get_compose_node", "tabulaflow_get_node_schema", "tabulaflow_get_node_preview", "tabulaflow_get_compose_node_quality",
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
  assert.equal(new Set(ALL_TOOL_NAMES).size, 62);
});

test("WebMCP confirmation protocol is inspect-or-reject and never exposes agent confirmation", async () => {
  const { calls, ref } = createContext();
  ref.current.actions.getPendingConfirmations = async () => ({ confirmations: [{ confirmationId: "confirmation-a", target: "flow", userActionRequired: true }] });
  const tools = createWebMcpTools(ref, { hasDataset: true, hasPrepared: true, hasComposeNodes: true });
  const pending = await toolByName(tools, "tabulaflow_get_pending_confirmations").execute({});
  assert.equal(pending.structuredContent.confirmations[0].userActionRequired, true);
  await toolByName(tools, "tabulaflow_reject_confirmation").execute({ confirmationId: "confirmation-a" });
  assert.ok(calls.some((call) => call[0] === "reject-confirmation" && call[1] === "confirmation-a"));
  assert.equal(tools.some((tool) => /confirm.*delet|resolve.*confirm/i.test(tool.name)), false);
});

test("qualitative coding WebMCP uses one bounded dispatcher and keeps approval human-only", async () => {
  const { calls, ref } = createContext();
  const tools = createWebMcpTools(ref, { hasDataset: true, hasPrepared: true, hasComposeNodes: true });
  const coding = toolByName(tools, "tabulaflow_qualitative_coding");
  const project = await coding.execute({ action: "get-project", projectId: "coding-a" });
  assert.equal(project.structuredContent.name, "Survey coding");
  const batch = await coding.execute({ action: "get-batch", projectId: "coding-a", offset: 0, limit: 10 });
  assert.equal(batch.structuredContent.items[0].responseRef, "response-a");
  await coding.execute({ action: "submit-batch", projectId: "coding-a", batchId: "batch-a", submissions: [{ responseRef: "response-a", codeIds: ["code-a"], evidence: "redacted response", confidence: 0.8 }], ...mutation("coding-request-a") });
  assert.ok(calls.some((call) => call[0] === "coding-submit"));
  assert.equal(coding.inputSchema.properties.action.enum.includes("approve"), false);
});

test("WebMCP 3.2.4 registers one small stable dispatcher surface", () => {
  const { ref } = createContext();
  const stable = createWebMcpStableTools(ref);
  assert.deepEqual(stable.map((tool) => tool.name), WEBMCP_STABLE_TOOL_NAMES);
  assert.deepEqual(stable.slice(0, WEBMCP_CORE_TOOL_NAMES.length).map((tool) => tool.name), WEBMCP_CORE_TOOL_NAMES);
  assert.equal(new Set(stable.map((tool) => tool.name)).size, stable.length);
  assert.ok(Object.hasOwn(WEBMCP_DISPATCH_ACTIONS.source, "request_source_file"));
  assert.ok(Object.hasOwn(WEBMCP_DISPATCH_ACTIONS.prepareRead, "get_prepare_preview"));
  assert.ok(Object.hasOwn(WEBMCP_DISPATCH_ACTIONS.prepareMutate, "add_recipe_step"));
  assert.ok(Object.hasOwn(WEBMCP_DISPATCH_ACTIONS.composeRead, "get_compose_graph"));
  assert.ok(Object.hasOwn(WEBMCP_DISPATCH_ACTIONS.composeMutate, "create_compose_operation"));
  assert.ok(stable.filter((tool) => tool.name.endsWith("_read") || tool.name.endsWith("_mutate") || tool.name === "tabulaflow_source")
    .every((tool) => tool.inputSchema.properties.action.enum.includes(WEBMCP_ACTION_CONTRACT_ACTION)));
  const metrics = measureWebMcpToolset(stable);
  assert.ok(metrics.schemaBytes <= WEBMCP_REGISTRATION_BUDGET.maxSchemaBytes * 0.7, "stable WebMCP schema must retain 30 percent host headroom");
});

test("stable dispatchers validate the selected action schema and route against current context", async () => {
  const { calls, ref } = createContext();
  const stable = createWebMcpStableTools(ref);
  const prepareRead = toolByName(stable, "tabulaflow_prepare_read");
  const prepareMutate = toolByName(stable, "tabulaflow_prepare_mutate");
  const recipe = await prepareRead.execute({ action: "get_recipe", input: { preparedId: "prepared-a" } });
  assert.equal(recipe.structuredContent.preparedId, "prepared-a");
  assert.deepEqual(recipe.structuredContent.dispatcher, { tool: "tabulaflow_prepare_read", action: "get_recipe" });
  await prepareMutate.execute({
    action: "set_preview_filter",
    input: { preparedId: "prepared-a", column: "status", value: "open", ...mutation("dispatcher-filter-001") },
  });
  assert.ok(calls.some((call) => call[0] === "filters"));
  await assert.rejects(
    () => prepareMutate.execute({
      action: "set_preview_filter",
      input: { preparedId: "prepared-a", column: "status", values: ["open"], ...mutation("dispatcher-filter-invalid") },
    }),
    (error) => error.code === "WEBMCP_INVALID_INPUT" && error.phase === "input-validation",
  );
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
  await toolByName(tools, "tabulaflow_get_node_schema").execute({ nodeId: "operation-a", offset: 0, limit: 20 });
  await toolByName(tools, "tabulaflow_get_node_preview").execute({ nodeId: "operation-a", columns: ["status"], offset: 0, limit: 20 });
  await toolByName(tools, "tabulaflow_get_compose_node_quality").execute({ nodeId: "operation-a" });
  const candidate = { kind: "filter-rows", inputId: "prepared-a", column: "status", operator: "equals", value: "open" };
  await toolByName(tools, "tabulaflow_validate_compose_operation").execute({ operation: candidate });
  await toolByName(tools, "tabulaflow_get_connection_options").execute({ nodeId: "prepared-a" });

  assert.equal(state.structuredContent.workspaceRevision, REVISION);
  assert.equal(capabilities.structuredContent.contractVersion, "3.2.4");
  assert.deepEqual(capabilities.structuredContent.operationLifecycle.terminalStates, ["succeeded", "failed", "cancelled"]);
  assert.equal(calculationCatalog.structuredContent.expressionVersion, 1);
  assert.ok(calculationCatalog.structuredContent.functions.some((item) => item.name === "try_cast"));
  assert.equal(state.structuredContent.selection.relationship, "independent-workspace-contexts");
  assert.equal(capabilities.structuredContent.safeguards.deletion, "visible-user-confirmation-required");
  assert.equal(capabilities.structuredContent.safeguards.semanticDeclassification, "visible-user-action-required");
  assert.equal(capabilities.structuredContent.safeguards.exports, "revision-and-idempotency-required");
  assert.equal(guide.structuredContent.flow.length, 3);
  assert.equal(operation.structuredContent.inputs, 2);
  assert.ok(tools.filter((tool) => tool.annotations?.untrustedContentHint).length >= 10);
  assert.deepEqual(calls, [
    ["available-actions", "prepared-a"], ["activity", { limit: 20, targetId: undefined, actor: "agent" }], ["changes", 12, { limit: 20 }], ["operation-status", "operation-1"], ["recipe", "prepared-a"], ["semantic", "prepared-a"], ["metric-list", "prepared-a"], ["dataset", "prepared-a"],
    ["profile", "prepared-a", ["status"]], ["values", "prepared-a", "status", "op", { offset: 0, limit: 20 }],
    ["prepare-preview", "prepared-a", ["status"], { offset: 0, limit: 20 }], ["recipe-preview", "prepared-a", [], 0, { previewColumns: undefined, previewLimit: 10 }],
    ["graph"], ["compose-node", "operation-a"], ["node-schema", "operation-a", { offset: 0, limit: 20 }], ["node-preview", "operation-a", ["status"], { offset: 0, limit: 20 }], ["node-quality", "operation-a"],
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
  const resetRequest = await toolByName(tools, "tabulaflow_request_reset_all").execute(mutation("reset-all-001"));
  await toolByName(tools, "tabulaflow_list_cloud_files").execute({});
  await toolByName(tools, "tabulaflow_open_cloud_file").execute({ fileId: "cloud-a", ...mutation("cloud-open-001") });
  await toolByName(tools, "tabulaflow_request_cloud_upload").execute({});
  await toolByName(tools, "tabulaflow_select_prepared_dataset").execute({ preparedId: "prepared-a", ...mutation("prepared-select-001") });
  await toolByName(tools, "tabulaflow_duplicate_prepared_dataset").execute({ preparedId: "prepared-a", ...mutation("duplicate-001") });
  await toolByName(tools, "tabulaflow_set_aggregate_columns").execute({ preparedId: "prepared-a", columns: ["status"], ...mutation("aggregate-columns-001") });
  const filtered = await toolByName(tools, "tabulaflow_set_preview_filter").execute({ preparedId: "prepared-a", column: "status", value: "open", ...mutation("filter-set-001") });
  await toolByName(tools, "tabulaflow_remove_preview_filter").execute({ preparedId: "prepared-a", column: "status", ...mutation("filter-remove-001") });
  await toolByName(tools, "tabulaflow_clear_preview_filters").execute({ preparedId: "prepared-a", ...mutation("filter-clear-001") });
  await toolByName(tools, "tabulaflow_export_prepare").execute({ preparedId: "prepared-a", format: "csv", ...mutation("prepare-export-001") });
  await toolByName(tools, "tabulaflow_add_recipe_step").execute({ preparedId: "prepared-a", step: trim, ...mutation("recipe-add-001") });
  const recipeDeletion = await toolByName(tools, "tabulaflow_request_delete_all_recipe_steps").execute({ preparedId: "prepared-a", ...mutation("recipe-delete-all-001") });
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
  await toolByName(tools, "tabulaflow_export_compose").execute({ nodeId: "operation-a", format: "xlsx", ...mutation("compose-export-001") });
  await toolByName(tools, "tabulaflow_create_compose_operation").execute({ operation: filter, ...mutation("operation-create-001") });
  await toolByName(tools, "tabulaflow_update_compose_operation").execute({ nodeId: "operation-a", operation: filter, ...mutation("operation-update-001") });
  await toolByName(tools, "tabulaflow_promote_compose_result").execute({ nodeId: "operation-a", ...mutation("promote-001") });
  const deletion = await toolByName(tools, "tabulaflow_request_delete").execute({ target: "recipe-step", targetId: "step-a", ...mutation("delete-001") });
  const metricDeletion = await toolByName(tools, "tabulaflow_delete_metric_definition").execute({ id: "metric-a", ...mutation("metric-delete-001") });

  assert.equal(filtered.structuredContent.totalRowCount, 10);
  assert.equal(filtered.structuredContent.filteredRowCount, 4);
  assert.equal(recipeDeletion.structuredContent.pendingConfirmation, true);
  assert.equal(deletion.structuredContent.pendingConfirmation, true);
  assert.equal(metricDeletion.structuredContent.pendingConfirmation, true);
  assert.equal(resetRequest.structuredContent.pendingConfirmation, true);
  assert.ok(calls.some((call) => call[0] === "duplicate" && call[2].expectedRevision === REVISION));
  assert.ok(calls.some((call) => call[0] === "create-operation" && call[2].requestId === "operation-create-001"));
  assert.ok(calls.some((call) => call[0] === "delete-request" && call[3].requestId === "delete-001"));
  assert.ok(calls.some((call) => call[0] === "delete-request" && call[1] === "prepare-recipe" && call[2] === "prepared-a" && call[3].requestId === "recipe-delete-all-001"));
  assert.ok(calls.some((call) => call[0] === "delete-request" && call[1] === "metric-definition" && call[2] === "metric-a"));
  assert.ok(calls.some((call) => call[0] === "export-prepare" && call[3].requestId === "prepare-export-001"));
  assert.ok(calls.some((call) => call[0] === "export-compose" && call[3].requestId === "compose-export-001"));
});

test("WebMCP rejects stale target identifiers before invoking visible actions", async () => {
  const { calls, ref } = createContext();
  const tools = createWebMcpTools(ref, { hasDataset: true, hasPrepared: true, hasComposeNodes: true });
  await assert.rejects(() => toolByName(tools, "tabulaflow_set_preview_filter").execute({ preparedId: "prepared-a", column: "missing", value: "x", ...mutation("missing-column-001") }), /not available/);
  await assert.rejects(() => toolByName(tools, "tabulaflow_set_preview_filter").execute({ preparedId: "missing", column: "status", value: "x", ...mutation("missing-prepared-001") }), /not active/);
  await assert.rejects(() => toolByName(tools, "tabulaflow_select_prepared_dataset").execute({ preparedId: "missing", ...mutation("missing-prepared-select") }), /not found/);
  await assert.rejects(() => toolByName(tools, "tabulaflow_select_compose_node").execute({ nodeId: "missing", ...mutation("missing-compose-select") }), /not found/);
  await assert.rejects(() => toolByName(tools, "tabulaflow_export_compose").execute({ nodeId: "missing", format: "csv", ...mutation("missing-export-001") }), /not found/);
  await assert.rejects(() => toolByName(tools, "tabulaflow_request_delete").execute({ target: "recipe-step", targetId: "missing", ...mutation("missing-delete-001") }), /not found/);
  await assert.rejects(() => toolByName(tools, "tabulaflow_request_delete_all_recipe_steps").execute({ preparedId: "missing", ...mutation("missing-recipe-delete-all") }), /not active/);
  assert.equal(calls.length, 0);
});

test("WebMCP mutation schemas require collaboration metadata and conditional values", () => {
  const { ref } = createContext();
  const tools = createWebMcpTools(ref, { hasDataset: true, hasPrepared: true, hasComposeNodes: true });
  for (const name of [
    "tabulaflow_request_reset_all", "tabulaflow_open_cloud_file", "tabulaflow_select_prepared_dataset", "tabulaflow_duplicate_prepared_dataset", "tabulaflow_set_aggregate_columns", "tabulaflow_set_preview_filter", "tabulaflow_export_prepare", "tabulaflow_add_recipe_step", "tabulaflow_request_delete_all_recipe_steps", "tabulaflow_replace_recipe",
    "tabulaflow_select_compose_node", "tabulaflow_auto_arrange_compose", "tabulaflow_create_compose_operation", "tabulaflow_update_compose_operation",
    "tabulaflow_export_compose", "tabulaflow_promote_compose_result", "tabulaflow_request_delete",
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
  assert.equal(aggregates.length, 1);
  assert.ok(aggregates.some((branch) => branch.required.includes("metrics")));
  assert.equal(toolByName(tools, "tabulaflow_replace_recipe").inputSchema.properties.executionMode.default, "async");
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
  assert.equal(toolByName(tools, "tabulaflow_update_semantic_field").inputSchema.properties.changes.properties.sensitivity.enum.includes("public"), false);
});

test("registered WebMCP export tools execute through the modelContext registry with collaboration guards", async () => {
  const { calls, ref } = createContext();
  const tools = createWebMcpTools(ref, { hasDataset: true, hasPrepared: true, hasComposeNodes: true });
  const registry = new Map();
  const controller = new AbortController();
  await registerWebMcpTools({
    async registerTool(tool, options) {
      assert.equal(options.signal, controller.signal);
      registry.set(tool.name, tool);
    },
  }, tools, controller.signal);

  const prepareResult = await registry.get("tabulaflow_export_prepare").execute({ preparedId: "prepared-a", format: "csv", ...mutation("registered-prepare-export") });
  const composeResult = await registry.get("tabulaflow_export_compose").execute({ nodeId: "operation-a", format: "xlsx", ...mutation("registered-compose-export") });

  assert.equal(prepareResult.structuredContent.workspaceRevision, REVISION + 1);
  assert.equal(composeResult.structuredContent.workspaceRevision, REVISION + 1);
  assert.ok(calls.some((call) => call[0] === "export-prepare" && call[3].requestId === "registered-prepare-export"));
  assert.ok(calls.some((call) => call[0] === "export-compose" && call[3].requestId === "registered-compose-export"));
  controller.abort();
});

test("registered tools reject schema-invalid input before an application action runs", async () => {
  const { calls, ref } = createContext();
  const tools = createWebMcpTools(ref, { hasDataset: true, hasPrepared: true, hasComposeNodes: true });
  const registry = new Map();
  const controller = new AbortController();
  await registerWebMcpTools({
    async registerTool(tool) { registry.set(tool.name, tool); },
  }, tools, controller.signal);

  await assert.rejects(
    () => registry.get("tabulaflow_set_preview_filter").execute({
      preparedId: "prepared-a",
      column: "status",
      values: ["open"],
      ...mutation("invalid-filter-shape"),
    }),
    (error) => error.code === "WEBMCP_INVALID_INPUT" && error.phase === "input-validation",
  );
  await assert.rejects(
    () => registry.get("tabulaflow_cancel_operation").execute({ operationId: "operation-a", interactionId: "interaction-a" }),
    (error) => error.code === "WEBMCP_INVALID_INPUT",
  );
  assert.equal(calls.some((call) => call[0] === "filters"), false);
  assert.equal(calls.some((call) => call[0] === "cancel-operation" || call[0] === "cancel-interaction"), false);
  controller.abort();
});

test("stable recipe dispatcher round-trips protected recipe reads across JSON transport", async () => {
  const { calls, ref } = createContext();
  const storedRecipe = [{
    id: "formula-a",
    type: "calculated-field",
    version: 1,
    enabled: true,
    params: { outputColumn: "weight_band", expression: "if([weight] >= 1, 'Heavy', 'Light')", expressionVersion: 1 },
  }];
  ref.current.actions.getRecipe = async (preparedId) => ({
    preparedId,
    recipeRevision: 1,
    recipe: protectRecipeForAgent(storedRecipe, [{ name: "weight", type: "DOUBLE", semantic: { sensitivity: "internal" } }]),
  });
  ref.current.actions.replaceRecipe = async (preparedId, recipe, expectedRecipeRevision, meta) => {
    const restored = restoreProtectedRecipeValues(recipe, storedRecipe);
    calls.push(["replace-recipe", preparedId, restored, expectedRecipeRevision, meta]);
    return { status: "succeeded", workspaceRevision: REVISION + 1, recipeRevision: expectedRecipeRevision + 1 };
  };
  const registry = new Map();
  const controller = new AbortController();
  await registerWebMcpTools({
    async registerTool(tool) { registry.set(tool.name, tool); },
  }, createWebMcpStableTools(ref), controller.signal);
  const read = await registry.get("tabulaflow_prepare_read").execute({
    action: "get_recipe",
    input: { preparedId: "prepared-a" },
  });
  const recipe = JSON.parse(JSON.stringify(read.structuredContent.recipe));

  await registry.get("tabulaflow_prepare_mutate").execute({
    action: "replace_recipe",
    input: {
      preparedId: "prepared-a",
      recipe,
      expectedRecipeRevision: 1,
      ...mutation("protected-recipe-roundtrip-001"),
      executionMode: "wait",
    },
  });

  const call = calls.find((item) => item[0] === "replace-recipe");
  assert.deepEqual(call[2], storedRecipe);

  const withoutReadOnlyVersion = recipe.map(({ version: _version, ...step }) => step);
  await registry.get("tabulaflow_prepare_mutate").execute({
    action: "replace_recipe",
    input: {
      preparedId: "prepared-a",
      recipe: withoutReadOnlyVersion,
      expectedRecipeRevision: 1,
      ...mutation("protected-recipe-roundtrip-002"),
      executionMode: "wait",
    },
  });
  assert.deepEqual(calls.filter((item) => item[0] === "replace-recipe").at(-1)[2], storedRecipe.map(({ version: _version, ...step }) => step));
  controller.abort();
});

test("stable dispatchers expose strict action contracts on demand", async () => {
  const { ref } = createContext();
  const stable = createWebMcpStableTools(ref);
  const composeRead = toolByName(stable, "tabulaflow_compose_read");
  const composeMutate = toolByName(stable, "tabulaflow_compose_mutate");

  const validation = await composeRead.execute({
    action: WEBMCP_ACTION_CONTRACT_ACTION,
    input: { action: "validate_compose_operation" },
  });
  assert.equal(validation.structuredContent.targetAction, "validate_compose_operation");
  assert.deepEqual(validation.structuredContent.inputSchema.required, ["operation"]);
  assert.equal(new Set(validation.structuredContent.inputSchema.properties.operation.oneOf.map((branch) => branch.properties.kind.const)).size, 8);

  const creation = await composeMutate.execute({
    action: WEBMCP_ACTION_CONTRACT_ACTION,
    input: { action: "create_compose_operation" },
  });
  assert.deepEqual(creation.structuredContent.inputSchema.required, ["operation", "expectedRevision", "requestId"]);
  assert.equal(new Set(creation.structuredContent.inputSchema.properties.operation.oneOf.map((branch) => branch.properties.kind.const)).size, 8);
});

test("context-blocked actions stay registered but are not advertised as executable", async () => {
  const { ref } = createContext();
  ref.current.actions.getAvailableActions = async () => ({
    targetId: "operation-a",
    actions: ["inspect", "preview"],
    actionStatus: [
      { action: "inspect", registered: true, callable: true, executable: true, blockedReason: null },
      { action: "preview", registered: true, callable: true, executable: false, blockedReason: "SOURCE_RELINK_REQUIRED" },
    ],
  });
  const result = await toolByName(
    createWebMcpTools(ref, { hasDataset: true, hasPrepared: true, hasComposeNodes: true }),
    "tabulaflow_get_available_actions",
  ).execute({ targetId: "operation-a" });

  assert.deepEqual(result.structuredContent.actions, ["inspect"]);
  assert.equal(result.structuredContent.actionStatus.find((item) => item.action === "preview").callable, true);
  assert.equal(result.structuredContent.actionStatus.find((item) => item.action === "preview").executable, false);
  assert.ok(result.structuredContent.unavailableActions.some((item) => item.action === "preview" && item.reason === "SOURCE_RELINK_REQUIRED"));
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

test("WebMCP registration stops immediately when its lifecycle is aborted", async () => {
  const { ref } = createContext();
  const tools = createWebMcpTools(ref, { hasDataset: true, hasPrepared: true, hasComposeNodes: true });
  const controller = new AbortController();
  const registrations = [];
  const supported = await registerWebMcpTools({
    async registerTool(tool) {
      registrations.push(tool.name);
      controller.abort();
    },
  }, tools, controller.signal);
  assert.equal(supported, false);
  assert.deepEqual(registrations, [tools[0].name]);
});

test("registered WebMCP tools annotate unexpected syntax failures at the handler boundary", async () => {
  const controller = new AbortController();
  let registered;
  const previousWarn = console.warn;
  console.warn = () => undefined;
  try {
    await registerWebMcpTools({ async registerTool(tool) { registered = tool; } }, [{
      name: "tabulaflow_test_failure",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute() { throw new SyntaxError("missing ) after argument list"); },
    }], controller.signal);
    await assert.rejects(
      () => registered.execute({}),
      (error) => error.code === "WEBMCP_EXECUTION_SYNTAX_ERROR" && error.phase === "handler" && error.tool === "tabulaflow_test_failure",
    );
  } finally {
    console.warn = previousWarn;
  }
});

test("registered WebMCP tools never expose raw failure literals", async () => {
  const controller = new AbortController();
  let registered;
  const previousWarn = console.warn;
  console.warn = () => undefined;
  try {
    await registerWebMcpTools({ async registerTool(tool) { registered = tool; } }, [{
      name: "tabulaflow_private_failure",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute() { throw new Error("person@example.com 9900000"); },
    }], controller.signal);
    await assert.rejects(
      () => registered.execute({}),
      (error) => error.code === "WEBMCP_EXECUTION_FAILED"
        && !error.message.includes("person@example.com")
        && !error.message.includes("9900000")
        && error.diagnostics?.[0]?.code === "WEBMCP_EXECUTION_FAILED"
        && !JSON.stringify(error.diagnostics).includes("person@example.com"),
    );
  } finally {
    console.warn = previousWarn;
  }
});

test("registered WebMCP tools preserve safe recovery metadata", async () => {
  const controller = new AbortController();
  let registered;
  await registerWebMcpTools({ async registerTool(tool) { registered = tool; } }, [{
    name: "tabulaflow_blocked_source",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    execute() {
      const error = new Error("private source detail");
      Object.assign(error, {
        code: "SOURCE_RELINK_REQUIRED",
        targetId: "operation-a",
        requiredAction: "relink-source",
        recommendedWorkspace: "source",
        retryable: true,
        sourceAssetIds: ["source-a"],
        blockedDependencyIds: ["prepared-a"],
      });
      throw error;
    },
  }], controller.signal);

  await assert.rejects(
    () => registered.execute({}),
    (error) => error.code === "SOURCE_RELINK_REQUIRED"
      && error.targetId === "operation-a"
      && error.requiredAction === "relink-source"
      && error.recommendedWorkspace === "source"
      && error.retryable === true
      && error.sourceAssetIds[0] === "source-a"
      && error.blockedDependencyIds[0] === "prepared-a"
      && !error.message.includes("private source detail"),
  );
});

test("runtime health stops advertising actions whose execution path is degraded", async () => {
  const { ref } = createContext();
  ref.current.actions.getAvailableActions = async () => ({ targetId: "prepared-a", actions: ["inspect", "recipe", "formula-column", "export"] });
  ref.current.actions.addRecipeStep = async () => { throw new SyntaxError("missing ) after argument list"); };
  const tools = createWebMcpTools(ref, { hasDataset: true, hasPrepared: true, hasComposeNodes: true });
  const registry = new Map();
  const controller = new AbortController();
  await registerWebMcpTools({ async registerTool(tool) { registry.set(tool.name, tool); } }, tools, controller.signal, {
    onExecutionFailure: () => undefined,
  });
  const previousWarn = console.warn;
  console.warn = () => undefined;
  try {
    await assert.rejects(
      () => registry.get("tabulaflow_add_recipe_step").execute({
        preparedId: "prepared-a",
        step: { type: "trim", params: { column: "status", mode: "both" } },
        ...mutation("runtime-health-failure-001"),
      }),
      (error) => error.code === "WEBMCP_EXECUTION_SYNTAX_ERROR",
    );
  } finally {
    console.warn = previousWarn;
  }
  const healthAwareTools = createWebMcpTools(ref, { hasDataset: true, hasPrepared: true, hasComposeNodes: true });
  const capabilities = await toolByName(healthAwareTools, "tabulaflow_get_capabilities").execute({});
  const available = await toolByName(healthAwareTools, "tabulaflow_get_available_actions").execute({ targetId: "prepared-a" });
  assert.equal(capabilities.structuredContent.runtimeHealth.status, "degraded");
  assert.equal(available.structuredContent.actions.includes("recipe"), false);
  assert.ok(available.structuredContent.unavailableActions.some((item) => item.action === "recipe"));
  controller.abort();
});
