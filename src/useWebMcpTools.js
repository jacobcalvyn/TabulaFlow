import { useEffect, useRef } from "react";

const EMPTY_INPUT_SCHEMA = Object.freeze({
  type: "object",
  properties: {},
  additionalProperties: false,
});

const WORKSPACE_INPUT_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    workspace: {
      type: "string",
      enum: ["source", "prepare", "compose", "account"],
      description: "The TabulaFlow workspace to show.",
    },
  },
  required: ["workspace"],
  additionalProperties: false,
});

const PREPARED_INPUT_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    preparedId: {
      type: "string",
      minLength: 1,
      description: "The stable ID of the prepared dataset to open.",
    },
  },
  required: ["preparedId"],
  additionalProperties: false,
});

const FILTER_INPUT_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    column: {
      type: "string",
      minLength: 1,
      description: "An exact filterable column name returned by tabulaflow_get_workspace_state.",
    },
    value: {
      description: "The exact value to keep. Use null for empty cells.",
      oneOf: [
        { type: "string" },
        { type: "number" },
        { type: "boolean" },
        { type: "null" },
      ],
    },
  },
  required: ["column", "value"],
  additionalProperties: false,
});

const COMPOSE_NODE_INPUT_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    nodeId: {
      type: "string",
      minLength: 1,
      description: "The stable ID of an existing dataset or operation node.",
    },
  },
  required: ["nodeId"],
  additionalProperties: false,
});

const VALUE_SCHEMA = {
  oneOf: [
    { type: "string" },
    { type: "number" },
    { type: "boolean" },
    { type: "null" },
  ],
};

const EXPORT_FORMAT_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    format: { type: "string", enum: ["csv", "xlsx"], description: "The download file format." },
  },
  required: ["format"],
  additionalProperties: false,
});

const COMPOSE_EXPORT_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    nodeId: { type: "string", minLength: 1, description: "The dataset or operation node to export." },
    format: { type: "string", enum: ["csv", "xlsx"], description: "The download file format." },
  },
  required: ["nodeId", "format"],
  additionalProperties: false,
});

function strictObject(properties, required = Object.keys(properties)) {
  return { type: "object", properties, required, additionalProperties: false };
}

const RECIPE_STEP_DEFINITION_SCHEMA = Object.freeze({
  oneOf: [
    strictObject({
      type: { const: "rename-column" },
      params: strictObject({ column: { type: "string", minLength: 1 }, newName: { type: "string", minLength: 1 } }),
    }),
    strictObject({
      type: { const: "change-type" },
      params: strictObject({ column: { type: "string", minLength: 1 }, targetType: { type: "string", enum: ["VARCHAR", "BIGINT", "DOUBLE", "BOOLEAN", "DATE", "TIMESTAMP"] } }),
    }),
    strictObject({
      type: { const: "trim" },
      params: strictObject({ column: { type: "string", minLength: 1 }, mode: { type: "string", enum: ["both", "left", "right"] } }),
    }),
    strictObject({
      type: { const: "replace-value" },
      params: strictObject({ column: { type: "string", minLength: 1 }, from: VALUE_SCHEMA, to: VALUE_SCHEMA }),
    }),
    strictObject({
      type: { const: "standardize-case" },
      params: strictObject({ column: { type: "string", minLength: 1 }, mode: { type: "string", enum: ["lower", "upper", "title"] } }),
    }),
    strictObject({
      type: { const: "parse-date" },
      params: strictObject({ column: { type: "string", minLength: 1 }, format: { type: "string", minLength: 1 } }),
    }),
    strictObject({
      type: { const: "remove-columns" },
      params: strictObject({ columns: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1, uniqueItems: true } }),
    }),
  ],
});

const ADD_RECIPE_STEP_SCHEMA = Object.freeze(strictObject({ step: RECIPE_STEP_DEFINITION_SCHEMA }));
const UPDATE_RECIPE_STEP_SCHEMA = Object.freeze(strictObject({
  stepId: { type: "string", minLength: 1 },
  step: RECIPE_STEP_DEFINITION_SCHEMA,
}));
const ENABLE_RECIPE_STEP_SCHEMA = Object.freeze(strictObject({
  stepId: { type: "string", minLength: 1 },
  enabled: { type: "boolean" },
}));
const MOVE_RECIPE_STEP_SCHEMA = Object.freeze(strictObject({
  stepId: { type: "string", minLength: 1 },
  position: { type: "integer", minimum: 1, description: "The one-based destination position." },
}));
const VALUE_ACTION_SCHEMA = Object.freeze(strictObject({
  action: { type: "string", enum: ["keep", "delete"] },
  column: { type: "string", minLength: 1 },
  value: VALUE_SCHEMA,
}));

const FILTER_OPERATORS = ["equals", "not-equals", "contains", "not-contains", "greater-than", "greater-or-equal", "less-than", "less-or-equal", "is-null", "is-not-null", "is-empty", "is-not-empty"];
const AGGREGATE_FUNCTIONS = ["count", "sum", "average", "min", "max", "count-distinct"];
const OPTIONAL_NAME = { type: "string", minLength: 1, maxLength: 120 };
const ID = { type: "string", minLength: 1 };
const COLUMN_NAMES = { type: "array", items: { type: "string", minLength: 1 }, minItems: 1, uniqueItems: true };

const COMPOSE_OPERATION_SCHEMA = Object.freeze({
  oneOf: [
    strictObject({ kind: { const: "append" }, inputIds: { type: "array", items: ID, minItems: 2, maxItems: 2, uniqueItems: true }, name: OPTIONAL_NAME }, ["kind", "inputIds"]),
    strictObject({ kind: { const: "join" }, leftId: ID, rightId: ID, leftKey: ID, rightKey: ID, joinType: { type: "string", enum: ["inner", "left", "right", "full"] }, name: OPTIONAL_NAME }, ["kind", "leftId", "rightId", "leftKey", "rightKey", "joinType"]),
    strictObject({ kind: { const: "difference" }, leftId: ID, rightId: ID, leftKey: ID, rightKey: ID, mode: { type: "string", enum: ["left-only", "right-only"] }, name: OPTIONAL_NAME }, ["kind", "leftId", "rightId", "leftKey", "rightKey", "mode"]),
    strictObject({ kind: { const: "filter-rows" }, inputId: ID, column: ID, operator: { type: "string", enum: FILTER_OPERATORS }, value: VALUE_SCHEMA, name: OPTIONAL_NAME }, ["kind", "inputId", "column", "operator"]),
    strictObject({ kind: { const: "distinct-rows" }, inputId: ID, columns: COLUMN_NAMES, name: OPTIONAL_NAME }, ["kind", "inputId", "columns"]),
    strictObject({ kind: { const: "aggregate" }, inputId: ID, groupBy: { type: "array", items: ID, uniqueItems: true }, function: { type: "string", enum: AGGREGATE_FUNCTIONS }, measureColumn: ID, alias: ID, name: OPTIONAL_NAME }, ["kind", "inputId", "function", "alias"]),
    strictObject({ kind: { const: "pivot" }, inputId: ID, groupBy: { type: "array", items: ID, uniqueItems: true }, pivotColumn: ID, valueColumn: ID, aggregate: { type: "string", enum: ["sum", "count", "average", "min", "max"] }, values: { type: "array", items: VALUE_SCHEMA, minItems: 1 }, name: OPTIONAL_NAME }, ["kind", "inputId", "pivotColumn", "valueColumn", "aggregate", "values"]),
    strictObject({ kind: { const: "unpivot" }, inputId: ID, idColumns: { type: "array", items: ID, uniqueItems: true }, valueColumns: COLUMN_NAMES, fieldColumn: ID, valueColumn: ID, name: OPTIONAL_NAME }, ["kind", "inputId", "valueColumns", "fieldColumn", "valueColumn"]),
  ],
});

const CREATE_COMPOSE_OPERATION_SCHEMA = Object.freeze(strictObject({ operation: COMPOSE_OPERATION_SCHEMA }));
const DELETE_REQUEST_SCHEMA = Object.freeze(strictObject({
  target: { type: "string", enum: ["recipe-step", "prepared-dataset", "compose-operation"] },
  targetId: { type: "string", minLength: 1 },
}));

function webMcpResult(message, data) {
  return {
    content: [{ type: "text", text: message }],
    structuredContent: data,
  };
}

function activeContext(contextRef) {
  const context = contextRef.current;
  if (!context) throw new Error("TabulaFlow is not ready.");
  return context;
}

function filterSelection(raw) {
  const prefix = raw === null ? "empty" : typeof raw;
  return {
    key: `${prefix}:${raw === null ? "" : String(raw)}`,
    raw,
    label: raw === null ? "" : String(raw),
  };
}

const WEBMCP_CAPABILITIES = Object.freeze({
  authenticationRequired: false,
  workspaces: ["source", "prepare", "compose", "account"],
  actions: [
    "inspect-workspace",
    "navigate-workspace",
    "request-local-file-selection",
    "filter-preview",
    "export-prepare",
    "manage-recipe",
    "select-compose-node",
    "auto-arrange-compose",
    "export-compose",
    "create-compose-operation",
    "request-delete",
  ],
  safeguards: {
    localFileSelection: "user-action-required",
    deletion: "visible-user-confirmation-required",
    cloudFiles: "chatgpt-sign-in-required",
  },
});

export function createWebMcpTools(contextRef, availability) {
  const tools = [{
    name: "tabulaflow_get_workspace_state",
    title: "Get TabulaFlow workspace state",
    description: "Inspect the visible TabulaFlow workspace, active dataset or Compose node, temporary filters, and available dataset and operation IDs. Use this before choosing another TabulaFlow tool.",
    inputSchema: EMPTY_INPUT_SCHEMA,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute() {
      const { state } = activeContext(contextRef);
      return webMcpResult(`TabulaFlow is showing the ${state.workspace} workspace.`, state);
    },
  }, {
    name: "tabulaflow_get_capabilities",
    title: "Get TabulaFlow AI capabilities",
    description: "Discover TabulaFlow WebMCP capabilities and safety boundaries. This tool is always available and does not require login or an open dataset.",
    inputSchema: EMPTY_INPUT_SCHEMA,
    annotations: { readOnlyHint: true },
    execute() {
      return webMcpResult("TabulaFlow WebMCP is available without login. Local file selection and deletion remain under user control.", WEBMCP_CAPABILITIES);
    },
  }, {
    name: "tabulaflow_open_workspace",
    title: "Open a TabulaFlow workspace",
    description: "Show Source, Prepare, Compose, or Account in the current TabulaFlow page. Prepare and Compose are available only when the current flow has the required data.",
    inputSchema: WORKSPACE_INPUT_SCHEMA,
    annotations: { readOnlyHint: false },
    async execute({ workspace }) {
      const { actions } = activeContext(contextRef);
      await actions.openWorkspace(workspace);
      return webMcpResult(`Opened the ${workspace} workspace.`, { workspace });
    },
  }, {
    name: "tabulaflow_request_source_file",
    title: "Choose a source file in TabulaFlow",
    description: "Open Source and place keyboard focus on the file chooser. The user must choose the local file because WebMCP cannot read an arbitrary device file without a browser permission gesture.",
    inputSchema: EMPTY_INPUT_SCHEMA,
    annotations: { readOnlyHint: false },
    async execute() {
      const { actions } = activeContext(contextRef);
      await actions.requestSourceFileSelection();
      return webMcpResult("The Source file chooser is ready for the user.", { awaitingUser: true, workspace: "source" });
    },
  }];

  if (availability.hasPrepared) {
    tools.push({
      name: "tabulaflow_select_prepared_dataset",
      title: "Open a prepared dataset",
      description: "Open one existing prepared dataset in Prepare by its stable ID. Read the available IDs with tabulaflow_get_workspace_state first.",
      inputSchema: PREPARED_INPUT_SCHEMA,
      annotations: { readOnlyHint: false },
      async execute({ preparedId }) {
        const { state, actions } = activeContext(contextRef);
        const prepared = state.preparedInputs.find((item) => item.id === preparedId);
        if (!prepared) throw new Error(`Prepared dataset not found: ${preparedId}`);
        await actions.selectPrepared(preparedId);
        return webMcpResult(`Opened prepared dataset ${prepared.name}.`, { preparedId, name: prepared.name });
      },
    });
  }

  if (availability.hasDataset) {
    tools.push({
      name: "tabulaflow_set_preview_filter",
      title: "Filter the prepared-data preview",
      description: "Set or replace one temporary value filter on the active Prepare preview. Filters on different columns use AND logic and are shown as removable chips in the UI.",
      inputSchema: FILTER_INPUT_SCHEMA,
      annotations: { readOnlyHint: false },
      async execute({ column, value }) {
        const { state, actions } = activeContext(contextRef);
        if (!state.activeDataset?.filterableColumns.includes(column)) throw new Error(`Column is not available in the active aggregate view: ${column}`);
        const nextFilters = { ...state.activeDataset.filters, [column]: filterSelection(value) };
        const result = await actions.applyFilters(nextFilters);
        return webMcpResult(`Filtered ${column} by the requested value.`, {
          column,
          value,
          rowCount: result.rowCount,
          filters: nextFilters,
        });
      },
    }, {
      name: "tabulaflow_clear_preview_filters",
      title: "Clear prepared-data filters",
      description: "Remove every temporary value filter from the active Prepare preview and update the visible aggregate tables and data preview.",
      inputSchema: EMPTY_INPUT_SCHEMA,
      annotations: { readOnlyHint: false },
      async execute() {
        const { actions } = activeContext(contextRef);
        const result = await actions.applyFilters({});
        return webMcpResult("Cleared all temporary Prepare filters.", { rowCount: result.rowCount, filters: {} });
      },
    }, {
      name: "tabulaflow_export_prepare",
      title: "Export the prepared dataset",
      description: "Download the active Prepare result, including its current temporary filters, as CSV or Excel.",
      inputSchema: EXPORT_FORMAT_SCHEMA,
      annotations: { readOnlyHint: false },
      async execute({ format }) {
        const { actions } = activeContext(contextRef);
        const result = await actions.exportPrepare(format);
        return webMcpResult(`Downloaded ${result.filename}.`, result);
      },
    }, {
      name: "tabulaflow_add_recipe_step",
      title: "Add a Prepare recipe step",
      description: "Append one supported transformation to the active prepared dataset and visibly rebuild its result. Use exact column names from workspace state.",
      inputSchema: ADD_RECIPE_STEP_SCHEMA,
      annotations: { readOnlyHint: false },
      async execute({ step }) {
        const { actions } = activeContext(contextRef);
        const result = await actions.addRecipeStep(step);
        return webMcpResult(`Added ${step.type} to the Prepare recipe.`, result);
      },
    }, {
      name: "tabulaflow_update_recipe_step",
      title: "Update a Prepare recipe step",
      description: "Replace the type and parameters of one existing recipe step, preserving its stable ID and enabled state.",
      inputSchema: UPDATE_RECIPE_STEP_SCHEMA,
      annotations: { readOnlyHint: false },
      async execute({ stepId, step }) {
        const { actions } = activeContext(contextRef);
        const result = await actions.updateRecipeStep(stepId, step);
        return webMcpResult(`Updated recipe step ${stepId}.`, result);
      },
    }, {
      name: "tabulaflow_set_recipe_step_enabled",
      title: "Enable or disable a recipe step",
      description: "Enable or disable one existing Prepare recipe step without deleting it.",
      inputSchema: ENABLE_RECIPE_STEP_SCHEMA,
      annotations: { readOnlyHint: false },
      async execute({ stepId, enabled }) {
        const { actions } = activeContext(contextRef);
        const result = await actions.setRecipeStepEnabled(stepId, enabled);
        return webMcpResult(`${enabled ? "Enabled" : "Disabled"} recipe step ${stepId}.`, result);
      },
    }, {
      name: "tabulaflow_move_recipe_step",
      title: "Move a Prepare recipe step",
      description: "Move one existing recipe step to a one-based position and visibly rebuild the prepared result.",
      inputSchema: MOVE_RECIPE_STEP_SCHEMA,
      annotations: { readOnlyHint: false },
      async execute({ stepId, position }) {
        const { actions } = activeContext(contextRef);
        const result = await actions.moveRecipeStep(stepId, position);
        return webMcpResult(`Moved recipe step ${stepId} to position ${position}.`, result);
      },
    }, {
      name: "tabulaflow_undo_recipe",
      title: "Undo the last recipe change",
      description: "Undo the latest Prepare recipe change and visibly rebuild the prepared result.",
      inputSchema: EMPTY_INPUT_SCHEMA,
      annotations: { readOnlyHint: false },
      async execute() {
        const { actions } = activeContext(contextRef);
        const result = await actions.undoRecipe();
        return webMcpResult("Undid the last Prepare recipe change.", result);
      },
    }, {
      name: "tabulaflow_redo_recipe",
      title: "Redo the last recipe change",
      description: "Redo the latest undone Prepare recipe change and visibly rebuild the prepared result.",
      inputSchema: EMPTY_INPUT_SCHEMA,
      annotations: { readOnlyHint: false },
      async execute() {
        const { actions } = activeContext(contextRef);
        const result = await actions.redoRecipe();
        return webMcpResult("Redid the Prepare recipe change.", result);
      },
    }, {
      name: "tabulaflow_apply_value_action",
      title: "Keep or delete a grouped value",
      description: "Create the same tracked Keep or Delete rows recipe step exposed by a value row context menu in Prepare.",
      inputSchema: VALUE_ACTION_SCHEMA,
      annotations: { readOnlyHint: false },
      async execute({ action, column, value }) {
        const { actions } = activeContext(contextRef);
        const result = await actions.applyValueAction(action, column, value);
        return webMcpResult(`${action === "keep" ? "Kept" : "Deleted"} rows for the selected grouped value.`, result);
      },
    });
  }

  if (availability.hasComposeNodes) {
    tools.push({
      name: "tabulaflow_select_compose_node",
      title: "Select a Compose node",
      description: "Open Compose, select an existing dataset or operation node by its stable ID, and update the visible result preview for that node.",
      inputSchema: COMPOSE_NODE_INPUT_SCHEMA,
      annotations: { readOnlyHint: false },
      async execute({ nodeId }) {
        const { state, actions } = activeContext(contextRef);
        const node = state.composeNodes.find((item) => item.id === nodeId);
        if (!node) throw new Error(`Compose node not found: ${nodeId}`);
        await actions.selectComposeNode(nodeId);
        return webMcpResult(`Selected Compose node ${node.name}.`, { nodeId, name: node.name });
      },
    }, {
      name: "tabulaflow_auto_arrange_compose",
      title: "Auto arrange the Compose graph",
      description: "Open Compose and arrange the current dependency graph from left to right while separating parallel branches. This visibly replaces current node positions.",
      inputSchema: EMPTY_INPUT_SCHEMA,
      annotations: { readOnlyHint: false },
      async execute() {
        const { actions } = activeContext(contextRef);
        const graph = await actions.autoArrangeCompose();
        if (!graph) throw new Error("The Compose graph could not be arranged.");
        return webMcpResult("Auto-arranged the Compose graph.", { revision: graph.revision });
      },
    }, {
      name: "tabulaflow_export_compose",
      title: "Export a Compose node",
      description: "Select and download one existing Compose dataset or operation result as CSV or Excel.",
      inputSchema: COMPOSE_EXPORT_SCHEMA,
      annotations: { readOnlyHint: false },
      async execute({ nodeId, format }) {
        const { state, actions } = activeContext(contextRef);
        if (!state.composeNodes.some((item) => item.id === nodeId)) throw new Error(`Compose node not found: ${nodeId}`);
        const result = await actions.exportCompose(nodeId, format);
        return webMcpResult(`Downloaded ${result.filename}.`, result);
      },
    }, {
      name: "tabulaflow_create_compose_operation",
      title: "Create a Compose operation",
      description: "Transactionally validate and create Append, Join, Difference, Aggregate, Filter rows, Distinct rows, Pivot, or Unpivot in the visible Compose graph.",
      inputSchema: CREATE_COMPOSE_OPERATION_SCHEMA,
      annotations: { readOnlyHint: false },
      async execute({ operation }) {
        const { actions } = activeContext(contextRef);
        const result = await actions.createComposeOperation(operation);
        return webMcpResult(`Created Compose operation ${result.name}.`, result);
      },
    });
  }

  if (availability.hasDataset || availability.hasComposeNodes) {
    tools.push({
      name: "tabulaflow_request_delete",
      title: "Request deletion in TabulaFlow",
      description: "Open the visible confirmation control for a recipe step, prepared dataset, or Compose operation. This tool never confirms or performs the deletion itself.",
      inputSchema: DELETE_REQUEST_SCHEMA,
      annotations: { readOnlyHint: false, destructiveHint: true },
      async execute({ target, targetId }) {
        const { state, actions } = activeContext(contextRef);
        const exists = target === "recipe-step"
          ? state.recipeSteps.some((item) => item.id === targetId)
          : target === "prepared-dataset"
            ? state.preparedInputs.some((item) => item.id === targetId)
            : state.composeNodes.some((item) => item.id === targetId && item.kind !== "dataset");
        if (!exists) throw new Error(`${target} not found: ${targetId}`);
        await actions.requestDelete(target, targetId);
        return webMcpResult(`Deletion confirmation opened for ${targetId}.`, { target, targetId, pendingConfirmation: true });
      },
    });
  }

  return tools;
}

export async function registerWebMcpTools(modelContext, tools, signal) {
  if (typeof modelContext?.registerTool !== "function") return false;
  await Promise.all(tools.map((tool) => modelContext.registerTool(tool, { signal })));
  return true;
}

export function useWebMcpTools(context) {
  const contextRef = useRef(context);
  contextRef.current = context;
  const availability = {
    hasDataset: Boolean(context.state.activeDataset),
    hasPrepared: context.state.preparedInputs.length > 0,
    hasComposeNodes: context.state.composeNodes.length > 0,
  };

  useEffect(() => {
    let modelContext;
    try {
      modelContext = document.modelContext;
    } catch {
      return undefined;
    }
    if (typeof modelContext?.registerTool !== "function") return undefined;

    const controller = new AbortController();
    const tools = createWebMcpTools(contextRef, availability);
    void registerWebMcpTools(modelContext, tools, controller.signal).catch((error) => {
      if (!controller.signal.aborted) console.warn("WebMCP tool registration failed.", error);
    });
    return () => controller.abort();
  }, [availability.hasComposeNodes, availability.hasDataset, availability.hasPrepared]);
}
