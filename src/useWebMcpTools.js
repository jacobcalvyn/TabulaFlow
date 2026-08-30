import { useEffect, useRef } from "react";
import { CALCULATION_CATALOG, FORMULA_EXPRESSION_VERSION } from "./formulaEngine.js";
import { sanitizeWebMcpDiagnostic, webMcpErrorForAgent } from "./webMcpPrivacy.js";
import {
  WEBMCP_CONTRACT_VERSION,
  assertWebMcpRegistrationBudget,
  createWebMcpRuntimeHealth,
  measureWebMcpToolset,
} from "./webMcpRuntime.js";
import { assertWebMcpInput } from "./webMcpSchema.js";

const WEBMCP_RUNTIME_HEALTH = new WeakMap();

function runtimeHealthFor(contextRef) {
  let health = WEBMCP_RUNTIME_HEALTH.get(contextRef);
  if (health) return health;
  health = createWebMcpRuntimeHealth();
  WEBMCP_RUNTIME_HEALTH.set(contextRef, health);
  return health;
}

const ACTION_TOOL_DEPENDENCIES = Object.freeze({
  "formula-column": ["tabulaflow_prepare_read", "tabulaflow_prepare_mutate", "tabulaflow_preview_recipe_change", "tabulaflow_add_recipe_step", "tabulaflow_replace_recipe"],
  recipe: ["tabulaflow_prepare_read", "tabulaflow_prepare_mutate", "tabulaflow_preview_recipe_change", "tabulaflow_add_recipe_step", "tabulaflow_replace_recipe"],
  duplicate: ["tabulaflow_prepare_mutate", "tabulaflow_duplicate_prepared_dataset"],
  export: ["tabulaflow_prepare_mutate", "tabulaflow_compose_mutate", "tabulaflow_export_prepare", "tabulaflow_export_compose"],
  "create-operation": ["tabulaflow_compose_mutate", "tabulaflow_create_compose_operation"],
  "create-unary-operation": ["tabulaflow_compose_mutate", "tabulaflow_create_compose_operation"],
  "connect-binary-operation": ["tabulaflow_compose_mutate", "tabulaflow_create_compose_operation"],
  update: ["tabulaflow_compose_mutate", "tabulaflow_update_compose_operation"],
  "qualitative-coding": ["tabulaflow_qualitative_coding"],
});

function applyRuntimeHealthToActions(result, health) {
  const degradedNames = new Set((health.degradedTools ?? []).map((item) => item.tool));
  const unavailableActions = [...(result.unavailableActions ?? [])];
  const registrationBlocked = ["registering", "stale", "limit-exceeded"].includes(health.status);
  const actions = (result.actions ?? []).filter((action) => {
    const failedTools = (ACTION_TOOL_DEPENDENCIES[action] ?? []).filter((name) => degradedNames.has(name));
    if (!registrationBlocked && !failedTools.length) return true;
    unavailableActions.push({
      action,
      reason: registrationBlocked ? "REFRESH_REQUIRED" : "runtime-degraded",
      ...(failedTools.length ? { failedTools } : {}),
    });
    return false;
  });
  const statusByAction = new Map((result.actionStatus ?? []).map((item) => [item.action, item]));
  const actionStatus = (result.actions ?? []).map((action) => {
    const base = statusByAction.get(action) ?? { action, registered: true, callable: true, executable: true, blockedReason: null };
    const unavailable = unavailableActions.find((item) => item.action === action);
    return unavailable
      ? { ...base, callable: false, blockedReason: unavailable.reason }
      : base;
  });
  for (const item of actionStatus) {
    if ((item.callable !== false && item.executable !== false) || unavailableActions.some((entry) => entry.action === item.action)) continue;
    unavailableActions.push({ action: item.action, reason: item.blockedReason ?? "blocked-by-context" });
  }
  const callableActions = actions.filter((action) => {
    const status = actionStatus.find((item) => item.action === action);
    return status?.callable !== false && status?.executable !== false;
  });
  return { ...result, actions: callableActions, actionStatus, unavailableActions, runtimeHealth: health };
}

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
        { type: "object", properties: { valueRef: { type: "string", minLength: 1 } }, required: ["valueRef"], additionalProperties: false },
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

const OPERATION_KINDS = ["append", "join", "difference", "aggregate", "filter-rows", "distinct-rows", "pivot", "unpivot"];
const MUTATION_META = {
  expectedRevision: { type: "integer", minimum: 0 },
  requestId: { type: "string", minLength: 8, maxLength: 160 },
};
const MUTATION_EXECUTION_MODE = { type: "string", enum: ["wait", "async"], default: "async" };

const CODING_SUBMISSION_SCHEMA = Object.freeze(strictObject({
  responseRef: { type: "string", minLength: 1 },
  codeIds: { type: "array", items: { type: "string", minLength: 1 }, uniqueItems: true },
  evidence: { type: "string", minLength: 1, maxLength: 1000 },
  confidence: { type: "number", minimum: 0, maximum: 1 },
  uncertain: { type: "boolean", default: false },
  rationale: { type: "string", maxLength: 280 },
}, ["responseRef", "codeIds", "evidence", "confidence"]));

const SUBMIT_CODING_BATCH_SCHEMA = Object.freeze(strictObject({
  projectId: { type: "string", minLength: 1 },
  batchId: { type: "string", minLength: 1 },
  submissions: { type: "array", items: CODING_SUBMISSION_SCHEMA, minItems: 1, maxItems: 100 },
  ...MUTATION_META,
}, ["projectId", "batchId", "submissions", "expectedRevision", "requestId"]));

const QUALITATIVE_CODING_SCHEMA = Object.freeze({
  type: "object",
  properties: {
    action: { type: "string", enum: ["get-project", "get-batch", "submit-batch", "get-progress"] },
    projectId: { type: "string", minLength: 1 },
    batchId: { type: "string", minLength: 1 },
    offset: { type: "integer", minimum: 0, default: 0 },
    limit: { type: "integer", minimum: 1, maximum: 50, default: 25 },
    submissions: SUBMIT_CODING_BATCH_SCHEMA.properties.submissions,
    expectedRevision: MUTATION_META.expectedRevision,
    requestId: MUTATION_META.requestId,
  },
  required: ["action"],
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

const PROTECTED_AGENT_VALUE_SCHEMA = strictObject({
  __tabulaflowProtectedValue: { const: true, description: "Protected value returned by a WebMCP read. Preserve it unchanged during an unrelated update." },
  binding: { type: "object", description: "Opaque binding metadata. Preserve it unchanged.", additionalProperties: true },
  referencedColumns: { type: "array", items: { type: "string" }, uniqueItems: true },
}, ["__tabulaflowProtectedValue", "binding"]);

const COMPOSE_VALUE_SCHEMA = {
  oneOf: [...VALUE_SCHEMA.oneOf, PROTECTED_AGENT_VALUE_SCHEMA],
};

const AGENT_VALUE_SCHEMA = {
  oneOf: [
    ...VALUE_SCHEMA.oneOf,
    strictObject({ valueRef: { type: "string", minLength: 1, description: "Opaque value reference returned for a sensitive grouped value." } }),
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

const COMPOSE_EXPORT_SCHEMA = Object.freeze(strictObject({
  nodeId: { type: "string", minLength: 1, description: "The dataset or operation node to export." },
  format: { type: "string", enum: ["csv", "xlsx"], description: "The download file format." },
  ...MUTATION_META,
  executionMode: MUTATION_EXECUTION_MODE,
}, ["nodeId", "format", "expectedRevision", "requestId"]));

function strictObject(properties, required = Object.keys(properties)) {
  return { type: "object", properties, required, additionalProperties: false };
}

const SELECT_PREPARED_INPUT_SCHEMA = Object.freeze(strictObject({
  preparedId: { type: "string", minLength: 1, description: "The stable ID of the prepared dataset to open." },
  ...MUTATION_META,
}));

const SELECT_COMPOSE_NODE_INPUT_SCHEMA = Object.freeze(strictObject({
  nodeId: { type: "string", minLength: 1, description: "The stable ID of an existing dataset or operation node." },
  ...MUTATION_META,
}));

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
    strictObject({
      type: { const: "calculated-field" },
      params: strictObject({
        outputColumn: { type: "string", minLength: 1 },
        expression: { type: "string", minLength: 1, maxLength: 10000 },
        expressionVersion: { const: FORMULA_EXPRESSION_VERSION },
      }),
    }),
  ],
});

const VALUE_ACTION_SCHEMA = Object.freeze(strictObject({
  action: { type: "string", enum: ["keep", "delete"] },
  column: { type: "string", minLength: 1 },
  value: VALUE_SCHEMA,
}));

const FILTER_VALUE_OPERATORS = ["equals", "not-equals", "contains", "not-contains", "greater-than", "greater-or-equal", "less-than", "less-or-equal"];
const FILTER_VALUELESS_OPERATORS = ["is-null", "is-not-null", "is-empty", "is-not-empty"];
const ID = { type: "string", minLength: 1 };
// The browser counts the complete active WebMCP schema against a small
// configuration budget. Compose keeps strict object shapes here and delegates
// semantic constraints (known IDs, non-empty names, uniqueness) to the same
// runtime validator used by the UI.
const OPERATION_ID = { type: "string" };
const OPERATION_NAME = { type: "string", maxLength: 120 };
const OPERATION_COLUMNS = { type: "array", items: OPERATION_ID, minItems: 1 };

const COMPOSE_OPERATION_SCHEMA = Object.freeze({
  oneOf: [
    strictObject({ kind: { const: "append" }, inputIds: { type: "array", items: OPERATION_ID, minItems: 2, maxItems: 2 }, name: OPERATION_NAME }, ["kind", "inputIds"]),
    strictObject({ kind: { const: "join" }, leftId: OPERATION_ID, rightId: OPERATION_ID, leftKey: OPERATION_ID, rightKey: OPERATION_ID, joinType: { type: "string", enum: ["inner", "left", "right", "full"] }, name: OPERATION_NAME }, ["kind", "leftId", "rightId", "leftKey", "rightKey", "joinType"]),
    strictObject({ kind: { const: "difference" }, leftId: OPERATION_ID, rightId: OPERATION_ID, leftKey: OPERATION_ID, rightKey: OPERATION_ID, mode: { type: "string", enum: ["left-only", "right-only"] }, name: OPERATION_NAME }, ["kind", "leftId", "rightId", "leftKey", "rightKey", "mode"]),
    strictObject({ kind: { const: "filter-rows" }, inputId: OPERATION_ID, column: OPERATION_ID, operator: { type: "string", enum: FILTER_VALUE_OPERATORS }, value: COMPOSE_VALUE_SCHEMA, name: OPERATION_NAME }, ["kind", "inputId", "column", "operator", "value"]),
    strictObject({ kind: { const: "filter-rows" }, inputId: OPERATION_ID, column: OPERATION_ID, operator: { type: "string", enum: FILTER_VALUELESS_OPERATORS }, name: OPERATION_NAME }, ["kind", "inputId", "column", "operator"]),
    strictObject({ kind: { const: "distinct-rows" }, inputId: OPERATION_ID, columns: OPERATION_COLUMNS, mode: { type: "string", enum: ["representative-rows", "project-columns"] }, name: OPERATION_NAME }, ["kind", "inputId", "columns"]),
    strictObject({
      kind: { const: "aggregate" },
      inputId: OPERATION_ID,
      groupBy: { type: "array", items: OPERATION_ID },
      metrics: {
        type: "array",
        minItems: 1,
        maxItems: 20,
        items: strictObject({
          function: { type: "string", enum: ["count", "count-distinct", "sum", "average", "min", "max", "median", "percentile"] },
          measureColumn: OPERATION_ID,
          alias: OPERATION_ID,
          percentile: { type: "number", exclusiveMinimum: 0, exclusiveMaximum: 1 },
        }, ["function", "alias"]),
      },
      minimumSampleSize: { type: "integer", minimum: 1 },
      suppressSmallGroups: { type: "boolean" },
      name: OPERATION_NAME,
    }, ["kind", "inputId", "metrics"]),
    strictObject({ kind: { const: "pivot" }, inputId: OPERATION_ID, groupBy: { type: "array", items: OPERATION_ID }, pivotColumn: OPERATION_ID, valueColumn: OPERATION_ID, aggregate: { type: "string", enum: ["sum", "count", "average", "min", "max"] }, values: { type: "array", items: COMPOSE_VALUE_SCHEMA, minItems: 1 }, name: OPERATION_NAME }, ["kind", "inputId", "pivotColumn", "valueColumn", "aggregate", "values"]),
    strictObject({ kind: { const: "unpivot" }, inputId: OPERATION_ID, idColumns: { type: "array", items: OPERATION_ID }, valueColumns: OPERATION_COLUMNS, fieldColumn: OPERATION_ID, valueColumn: OPERATION_ID, name: OPERATION_NAME }, ["kind", "inputId", "valueColumns", "fieldColumn", "valueColumn"]),
  ],
});

const CREATE_COMPOSE_OPERATION_SCHEMA = Object.freeze(strictObject({ operation: COMPOSE_OPERATION_SCHEMA }));
const DELETE_REQUEST_SCHEMA = Object.freeze(strictObject({
  target: { type: "string", enum: ["recipe-step", "prepared-dataset", "compose-operation", "metric-definition"] },
  targetId: { type: "string", minLength: 1 },
  ...MUTATION_META,
}));

const PREPARE_TARGET_SCHEMA = Object.freeze(strictObject({ preparedId: ID }));
const DATA_PROFILE_SCHEMA = Object.freeze(strictObject({
  preparedId: ID,
  columns: { type: "array", items: ID, maxItems: 50, uniqueItems: true },
}, ["preparedId"]));
const PAGED_PREVIEW_SCHEMA = Object.freeze(strictObject({
  preparedId: ID,
  columns: { type: "array", items: ID, minItems: 1, maxItems: 20, uniqueItems: true },
  offset: { type: "integer", minimum: 0, default: 0 },
  limit: { type: "integer", minimum: 1, maximum: 20, default: 20 },
}, ["preparedId", "columns"]));
const COLUMN_VALUES_SCHEMA = Object.freeze(strictObject({
  preparedId: ID,
  column: ID,
  search: { type: "string", default: "" },
  offset: { type: "integer", minimum: 0, default: 0 },
  limit: { type: "integer", minimum: 1, maximum: 100, default: 100 },
}, ["preparedId", "column"]));
const RECIPE_PREVIEW_SCHEMA = Object.freeze(strictObject({
  preparedId: ID,
  recipe: {
    type: "array",
    items: strictObject({
      id: ID,
      type: ID,
      version: { type: "integer", minimum: 1, description: "Recipe step contract version returned by recipe reads." },
      params: { type: "object", additionalProperties: true },
      enabled: { type: "boolean", default: true },
    }, ["id", "type", "params"]),
    description: "The complete ordered recipe. Every dry-run step requires the same stable id used by the runtime.",
  },
  stepIndex: { type: "integer", minimum: 0 },
  previewColumns: { type: "array", items: ID, maxItems: 20, uniqueItems: true, description: "Optional explicit columns for a bounded row preview. Omit for metadata-only validation." },
  previewLimit: { type: "integer", minimum: 1, maximum: 20, default: 10 },
}, ["preparedId", "recipe"]));
const WORKSPACE_ACTIONS_SCHEMA = Object.freeze(strictObject({ targetId: ID }, []));
const OPERATION_DESCRIPTION_SCHEMA = Object.freeze(strictObject({ kind: { type: "string", enum: OPERATION_KINDS } }));
const CONNECTION_OPTIONS_SCHEMA = Object.freeze(strictObject({ nodeId: ID }));
const COMPOSE_PREVIEW_SCHEMA = Object.freeze(strictObject({
  nodeId: ID,
  columns: { type: "array", items: ID, minItems: 1, maxItems: 20, uniqueItems: true },
  offset: { type: "integer", minimum: 0, default: 0 },
  limit: { type: "integer", minimum: 1, maximum: 20, default: 20 },
}, ["nodeId", "columns"]));
const COMPOSE_QUALITY_SCHEMA = Object.freeze(strictObject({ nodeId: ID }));
const COMPOSE_SCHEMA_PAGE_SCHEMA = Object.freeze(strictObject({
  nodeId: ID,
  offset: { type: "integer", minimum: 0, default: 0 },
  limit: { type: "integer", minimum: 1, maximum: 100, default: 100 },
}, ["nodeId"]));
const OPERATION_STATUS_SCHEMA = Object.freeze(strictObject({ operationId: ID }));
const CANCEL_PENDING_SCHEMA = Object.freeze({
  type: "object",
  properties: { operationId: ID, interactionId: ID },
  oneOf: [{ required: ["operationId"] }, { required: ["interactionId"] }],
  additionalProperties: false,
});
const CONFIRMATION_SCHEMA = Object.freeze(strictObject({ confirmationId: ID }));
const SEMANTIC_MODEL_SCHEMA = Object.freeze(strictObject({ targetId: ID }));
const UPDATE_SEMANTIC_FIELD_SCHEMA = Object.freeze(strictObject({
  targetId: ID,
  fieldName: ID,
  changes: strictObject({
    businessName: { type: "string", minLength: 1 },
    role: { type: "string", enum: ["identifier", "dimension", "measure", "timestamp", "status", "free-text", "attribute"] },
    unit: { type: ["string", "null"] },
    sensitivity: { type: "string", enum: ["internal", "pii", "financial", "secret"], description: "A sensitivity level that is at least as strict as the current value. Declassification is user-controlled." },
    allowedAggregations: { type: "array", items: { type: "string", enum: ["count", "count-distinct", "sum", "average", "min", "max", "median", "percentile"] }, uniqueItems: true },
  }, []),
  ...MUTATION_META,
}, ["targetId", "fieldName", "changes", "expectedRevision", "requestId"]));
const METRIC_DEFINITION_SCHEMA = Object.freeze(strictObject({
  id: ID,
  targetId: ID,
  name: ID,
  function: { type: "string", enum: ["count", "count-distinct", "sum", "average", "min", "max", "median", "percentile"] },
  column: ID,
  percentile: { type: "number", exclusiveMinimum: 0, exclusiveMaximum: 1 },
  description: { type: "string" },
  unit: { type: ["string", "null"] },
  format: { type: ["string", "null"] },
  ...MUTATION_META,
}, ["targetId", "name", "function", "expectedRevision", "requestId"]));
const DELETE_METRIC_DEFINITION_SCHEMA = Object.freeze(strictObject({ id: ID, ...MUTATION_META }));
const VALIDATE_COMPOSE_OPERATION_SCHEMA = Object.freeze(strictObject({
  operation: COMPOSE_OPERATION_SCHEMA,
  previewColumns: { type: "array", items: ID, maxItems: 20, uniqueItems: true, description: "Optional explicit columns for a bounded row preview. Omit for metadata-only validation." },
  previewLimit: { type: "integer", minimum: 1, maximum: 20, default: 10 },
}, ["operation"]));
const DUPLICATE_PREPARED_SCHEMA = Object.freeze(strictObject({ preparedId: ID, ...MUTATION_META, executionMode: MUTATION_EXECUTION_MODE }, ["preparedId", "expectedRevision", "requestId"]));
const PROMOTE_COMPOSE_SCHEMA = Object.freeze(strictObject({ nodeId: ID, ...MUTATION_META, executionMode: MUTATION_EXECUTION_MODE }, ["nodeId", "expectedRevision", "requestId"]));
const MOVE_COMPOSE_SCHEMA = Object.freeze(strictObject({
  nodeId: ID,
  position: strictObject({ x: { type: "number", minimum: 0, maximum: 32000 }, y: { type: "number", minimum: 0, maximum: 32000 } }),
  ...MUTATION_META,
}));
const UPDATE_COMPOSE_OPERATION_SCHEMA = Object.freeze(strictObject({
  nodeId: ID,
  operation: COMPOSE_OPERATION_SCHEMA,
  ...MUTATION_META,
  executionMode: MUTATION_EXECUTION_MODE,
}, ["nodeId", "operation", "expectedRevision", "requestId"]));
const SOURCE_RELINK_SCHEMA = Object.freeze(strictObject({ sourceAssetId: ID }));
const RESET_ALL_SCHEMA = Object.freeze(strictObject({ ...MUTATION_META }));
const CLOUD_FILE_SCHEMA = Object.freeze(strictObject({ fileId: ID, ...MUTATION_META }));

const FILTER_MUTATION_SCHEMA = Object.freeze(strictObject({
  preparedId: ID,
  column: FILTER_INPUT_SCHEMA.properties.column,
  value: FILTER_INPUT_SCHEMA.properties.value,
  ...MUTATION_META,
}));
const REMOVE_FILTER_SCHEMA = Object.freeze(strictObject({ preparedId: ID, column: ID, ...MUTATION_META }));
const CLEAR_FILTERS_SCHEMA = Object.freeze(strictObject({ preparedId: ID, ...MUTATION_META }));
const AGGREGATE_COLUMNS_SCHEMA = Object.freeze(strictObject({
  preparedId: ID,
  columns: { type: "array", items: ID, maxItems: 200, uniqueItems: true },
  ...MUTATION_META,
}));
const PREPARE_EXPORT_V2_SCHEMA = Object.freeze(strictObject({ preparedId: ID, format: EXPORT_FORMAT_SCHEMA.properties.format, ...MUTATION_META, executionMode: MUTATION_EXECUTION_MODE }, ["preparedId", "format", "expectedRevision", "requestId"]));
const ACTIVITY_LOG_SCHEMA = Object.freeze(strictObject({
  limit: { type: "integer", minimum: 1, maximum: 100, default: 50 },
  targetId: ID,
  actor: { type: "string", enum: ["user", "agent", "system"] },
}, []));
const CHANGES_SINCE_SCHEMA = Object.freeze(strictObject({
  cursor: { type: "integer", minimum: 0, description: "The last activity cursor already observed." },
  limit: { type: "integer", minimum: 1, maximum: 100, default: 100 },
}, ["cursor"]));
const ADD_RECIPE_STEP_V2_SCHEMA = Object.freeze(strictObject({ preparedId: ID, step: RECIPE_STEP_DEFINITION_SCHEMA, ...MUTATION_META, executionMode: MUTATION_EXECUTION_MODE }, ["preparedId", "step", "expectedRevision", "requestId"]));
const UPDATE_RECIPE_STEP_V2_SCHEMA = Object.freeze(strictObject({ preparedId: ID, stepId: ID, step: RECIPE_STEP_DEFINITION_SCHEMA, ...MUTATION_META, executionMode: MUTATION_EXECUTION_MODE }, ["preparedId", "stepId", "step", "expectedRevision", "requestId"]));
const ENABLE_RECIPE_STEP_V2_SCHEMA = Object.freeze(strictObject({ preparedId: ID, stepId: ID, enabled: { type: "boolean" }, ...MUTATION_META, executionMode: MUTATION_EXECUTION_MODE }, ["preparedId", "stepId", "enabled", "expectedRevision", "requestId"]));
const MOVE_RECIPE_STEP_V2_SCHEMA = Object.freeze(strictObject({ preparedId: ID, stepId: ID, position: { type: "integer", minimum: 1 }, ...MUTATION_META, executionMode: MUTATION_EXECUTION_MODE }, ["preparedId", "stepId", "position", "expectedRevision", "requestId"]));
const RECIPE_HISTORY_V2_SCHEMA = Object.freeze(strictObject({ preparedId: ID, ...MUTATION_META, executionMode: MUTATION_EXECUTION_MODE }, ["preparedId", "expectedRevision", "requestId"]));
const DELETE_ALL_RECIPE_STEPS_SCHEMA = Object.freeze(strictObject({ preparedId: ID, ...MUTATION_META }));
const REPLACE_RECIPE_SCHEMA = Object.freeze(strictObject({
  preparedId: ID,
  recipe: RECIPE_PREVIEW_SCHEMA.properties.recipe,
  expectedRecipeRevision: { type: "integer", minimum: 0, description: "Recipe revision returned by tabulaflow_get_recipe." },
  ...MUTATION_META,
  executionMode: MUTATION_EXECUTION_MODE,
}, ["preparedId", "recipe", "expectedRecipeRevision", "expectedRevision", "requestId"]));
const VALUE_ACTION_V2_SCHEMA = Object.freeze(strictObject({ preparedId: ID, action: VALUE_ACTION_SCHEMA.properties.action, column: ID, value: AGENT_VALUE_SCHEMA, ...MUTATION_META, executionMode: MUTATION_EXECUTION_MODE }, ["preparedId", "action", "column", "value", "expectedRevision", "requestId"]));
const CREATE_COMPOSE_OPERATION_V2_SCHEMA = Object.freeze(strictObject({ operation: COMPOSE_OPERATION_SCHEMA, ...MUTATION_META, executionMode: MUTATION_EXECUTION_MODE }, ["operation", "expectedRevision", "requestId"]));
const AUTO_ARRANGE_V2_SCHEMA = Object.freeze(strictObject({ ...MUTATION_META }));
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
  if (raw && typeof raw === "object" && raw.valueRef) return { key: raw.valueRef, valueRef: raw.valueRef, label: "[redacted]" };
  const prefix = raw === null ? "empty" : typeof raw;
  return {
    key: `${prefix}:${raw === null ? "" : String(raw)}`,
    raw,
    label: raw === null ? "" : String(raw),
  };
}

function dispatcherActions(toolNames) {
  return Object.freeze(Object.fromEntries(toolNames.map((toolName) => [toolName.replace(/^tabulaflow_/, ""), toolName])));
}

export const WEBMCP_ACTION_CONTRACT_ACTION = "get_action_contract";

function dispatcherActionNames(actions) {
  return [WEBMCP_ACTION_CONTRACT_ACTION, ...Object.keys(actions)];
}

export const WEBMCP_DISPATCH_ACTIONS = Object.freeze({
  source: dispatcherActions([
    "tabulaflow_request_source_file",
    "tabulaflow_request_source_relink",
    "tabulaflow_request_reset_all",
    "tabulaflow_list_cloud_files",
    "tabulaflow_open_cloud_file",
    "tabulaflow_request_cloud_upload",
  ]),
  prepareRead: dispatcherActions([
    "tabulaflow_get_calculation_catalog",
    "tabulaflow_get_recipe",
    "tabulaflow_get_semantic_model",
    "tabulaflow_list_metric_definitions",
    "tabulaflow_get_prepare_dataset",
    "tabulaflow_get_data_profile",
    "tabulaflow_query_column_values",
    "tabulaflow_get_prepare_preview",
    "tabulaflow_preview_recipe_change",
  ]),
  prepareMutate: dispatcherActions([
    "tabulaflow_select_prepared_dataset",
    "tabulaflow_update_semantic_field",
    "tabulaflow_upsert_metric_definition",
    "tabulaflow_delete_metric_definition",
    "tabulaflow_replace_recipe",
    "tabulaflow_duplicate_prepared_dataset",
    "tabulaflow_set_aggregate_columns",
    "tabulaflow_set_preview_filter",
    "tabulaflow_remove_preview_filter",
    "tabulaflow_clear_preview_filters",
    "tabulaflow_export_prepare",
    "tabulaflow_add_recipe_step",
    "tabulaflow_request_delete_all_recipe_steps",
    "tabulaflow_update_recipe_step",
    "tabulaflow_set_recipe_step_enabled",
    "tabulaflow_move_recipe_step",
    "tabulaflow_undo_recipe",
    "tabulaflow_redo_recipe",
    "tabulaflow_apply_value_action",
    "tabulaflow_request_delete",
  ]),
  composeRead: dispatcherActions([
    "tabulaflow_describe_operation",
    "tabulaflow_get_semantic_model",
    "tabulaflow_list_metric_definitions",
    "tabulaflow_get_compose_graph",
    "tabulaflow_get_compose_node",
    "tabulaflow_get_node_schema",
    "tabulaflow_get_node_preview",
    "tabulaflow_get_compose_node_quality",
    "tabulaflow_validate_compose_operation",
    "tabulaflow_get_connection_options",
  ]),
  composeMutate: dispatcherActions([
    "tabulaflow_update_semantic_field",
    "tabulaflow_upsert_metric_definition",
    "tabulaflow_delete_metric_definition",
    "tabulaflow_select_compose_node",
    "tabulaflow_auto_arrange_compose",
    "tabulaflow_move_compose_node",
    "tabulaflow_export_compose",
    "tabulaflow_create_compose_operation",
    "tabulaflow_update_compose_operation",
    "tabulaflow_promote_compose_result",
    "tabulaflow_request_delete",
  ]),
});

const WEBMCP_CAPABILITIES = Object.freeze({
  contractVersion: WEBMCP_CONTRACT_VERSION,
  authenticationRequired: false,
  workspaces: ["source", "prepare", "compose", "account"],
  toolSurface: {
    lifecycle: "stable-page-dispatchers",
    dispatchers: Object.fromEntries(Object.entries(WEBMCP_DISPATCH_ACTIONS).map(([name, actions]) => [name, dispatcherActionNames(actions)])),
    actionPayload: "Pass action plus input. Each input is validated against the selected action contract before its handler runs.",
    contractDiscovery: "Call any dispatcher with action=get_action_contract and input.action set to one of its other actions.",
  },
  actions: [
    "inspect-workspace",
    "navigate-workspace",
    "request-local-file-selection",
    "request-reset-all",
    "filter-preview",
    "export-prepare",
    "manage-recipe",
    "request-delete-all-recipe-steps",
    "replace-recipe-atomically",
    "select-compose-node",
    "auto-arrange-compose",
    "export-compose",
    "create-compose-operation",
    "request-delete",
    "inspect-prepare-data",
    "query-column-values",
    "choose-frequency-columns",
    "preview-recipe-change",
    "remove-one-preview-filter",
    "inspect-compose-graph",
    "inspect-compose-node-preview",
    "inspect-compose-node-schema",
    "inspect-compatible-connections",
    "validate-compose-operation",
    "update-compose-operation",
    "move-compose-node",
    "duplicate-prepared-dataset",
    "promote-compose-result",
    "request-source-relink",
    "cloud-file-access",
    "inspect-shared-activity",
    "inspect-changes-since-cursor",
    "inspect-mutation-operation",
    "cancel-mutation-operation",
    "inspect-pending-confirmations",
    "reject-pending-confirmation",
    "inspect-and-override-semantics",
    "inspect-compose-quality",
    "manage-reusable-metrics",
    "inspect-calculation-language",
    "inspect-qualitative-codebook",
    "read-approved-qualitative-batches",
    "submit-qualitative-coding-suggestions",
    "inspect-qualitative-review-progress",
  ],
  operationLifecycle: {
    states: ["accepted", "running", "committing", "succeeded", "failed", "cancelling", "cancelled"],
    terminalStates: ["succeeded", "failed", "cancelled"],
    userInteractions: ["awaiting-user", "completed", "failed", "cancelled", "expired"],
  },
  safeguards: {
    localFileSelection: "user-action-required",
    deletion: "visible-user-confirmation-required",
    cloudFiles: "chatgpt-sign-in-required",
    dataExposure: "conservative-redaction-floor",
    semanticDeclassification: "visible-user-action-required",
    recipeLiterals: "opaque-preserve-only",
    exports: "revision-and-idempotency-required",
    idempotency: "flow-scoped-and-persistent-across-reload",
    qualitativeCoding: "human-codebook-and-human-review-required",
  },
});

const WORKFLOW_GUIDE = Object.freeze({
  contractVersion: WEBMCP_CONTRACT_VERSION,
  flow: [
    { workspace: "source", purpose: "Open local or signed-in cloud files and maintain source references. Local selection and relinking require a user gesture." },
    { workspace: "prepare", purpose: "Inspect one prepared dataset, maintain its recipe, and review optional qualitative coding suggestions against a human-owned codebook." },
    { workspace: "compose", purpose: "Create a dependency graph across prepared datasets and operation results without mutating upstream inputs." },
  ],
  collaboration: {
    observeBeforeActing: "Read workspace state and the target dataset or node immediately before a mutation.",
    concurrency: "Pass the latest workspaceRevision as expectedRevision and a unique requestId with every mutation or export side effect. Operation and idempotency status persist for the active flow across page reloads.",
    visibility: "Every successful action updates the same visible state used by the user.",
    activity: "UI and WebMCP changes share one privacy-safe persistent ledger. Read it before continuing after user interaction.",
    userControlled: ["local file selection", "source relinking", "cloud upload file selection", "deletion confirmation"],
    qualitativeCoding: "AI receives only time-bounded pseudonymized batches and can submit suggestions; only human-accepted assignments can be materialized for Compose.",
  },
});

const OPERATION_GUIDES = Object.freeze({
  append: { inputs: 2, purpose: "Stack rows from two compatible inputs while preserving all visible columns.", parameters: ["inputIds", "name?"], compatibility: "Shared column names must have compatible types; columns present on only one side are retained.", example: { kind: "append", inputIds: ["prepared-a", "prepared-b"] }, undoable: "Delete the leaf operation after user confirmation." },
  join: { inputs: 2, purpose: "Match two inputs using explicit same-type keys.", parameters: ["leftId", "rightId", "leftKey", "rightKey", "joinType", "name?"], compatibility: "Key types must match exactly; duplicate output names receive automatic suffixes.", example: { kind: "join", leftId: "prepared-orders", rightId: "prepared-customers", leftKey: "customer_id", rightKey: "id", joinType: "left" }, undoable: "Update its configuration or delete the leaf operation." },
  difference: { inputs: 2, purpose: "Return rows that exist only on the chosen side using explicit matching keys.", parameters: ["leftId", "rightId", "leftKey", "rightKey", "mode", "name?"], compatibility: "Matching key types must be compatible.", example: { kind: "difference", leftId: "prepared-a", rightId: "prepared-b", leftKey: "id", rightKey: "id", mode: "left-only" }, undoable: "Update its configuration or delete the leaf operation." },
  aggregate: { inputs: 1, purpose: "Group rows and calculate multiple reusable metrics in one node, including median and percentile.", parameters: ["inputId", "groupBy?", "metrics", "minimumSampleSize?", "suppressSmallGroups?", "name?"], compatibility: "Every function except count requires a measure column. Percentile requires a value between 0 and 1.", example: { kind: "aggregate", inputId: "prepared-orders", groupBy: ["status"], metrics: [{ function: "count", alias: "shipments" }, { function: "sum", measureColumn: "amount", alias: "total_amount" }, { function: "percentile", measureColumn: "amount", percentile: 0.9, alias: "p90_amount" }], minimumSampleSize: 20, suppressSmallGroups: true }, undoable: "Update its configuration or delete the leaf operation." },
  "filter-rows": { inputs: 1, purpose: "Keep rows that satisfy a persistent condition in Compose.", parameters: ["inputId", "column", "operator", "value?", "name?"], compatibility: "Comparison operators require a value; null and empty operators do not accept one.", example: { kind: "filter-rows", inputId: "prepared-orders", column: "status", operator: "equals", value: "open" }, undoable: "Update its configuration or delete the leaf operation." },
  "distinct-rows": { inputs: 1, purpose: "Keep one representative row per unique key or return only the projected distinct columns.", parameters: ["inputId", "columns", "mode?", "name?"], compatibility: "At least one existing column is required. representative-rows preserves the full schema; project-columns returns only comparison columns.", example: { kind: "distinct-rows", inputId: "prepared-orders", columns: ["tracking_id"], mode: "project-columns" }, undoable: "Update its configuration or delete the leaf operation." },
  pivot: { inputs: 1, purpose: "Turn distinct row values into columns using an aggregate.", parameters: ["inputId", "groupBy?", "pivotColumn", "valueColumn", "aggregate", "values", "name?"], compatibility: "Pivot/value columns and explicit pivot values must exist.", example: { kind: "pivot", inputId: "prepared-orders", groupBy: ["region"], pivotColumn: "status", valueColumn: "amount", aggregate: "sum", values: ["open", "closed"] }, undoable: "Update its configuration or delete the leaf operation." },
  unpivot: { inputs: 1, purpose: "Turn multiple value columns into field/value rows.", parameters: ["inputId", "idColumns?", "valueColumns", "fieldColumn", "valueColumn", "name?"], compatibility: "At least one value column is required and output names must not collide.", example: { kind: "unpivot", inputId: "prepared-costs", idColumns: ["id"], valueColumns: ["fee", "tax"], fieldColumn: "cost_type", valueColumn: "cost_value" }, undoable: "Update its configuration or delete the leaf operation." },
});

export const WEBMCP_CORE_TOOL_NAMES = Object.freeze([
  "tabulaflow_get_workspace_state",
  "tabulaflow_get_capabilities",
  "tabulaflow_get_workflow_guide",
  "tabulaflow_get_available_actions",
  "tabulaflow_get_activity_log",
  "tabulaflow_get_changes_since",
  "tabulaflow_get_operation_status",
  "tabulaflow_cancel_operation",
  "tabulaflow_get_pending_confirmations",
  "tabulaflow_reject_confirmation",
  "tabulaflow_open_workspace",
]);

export const WEBMCP_STABLE_TOOL_NAMES = Object.freeze([
  ...WEBMCP_CORE_TOOL_NAMES,
  "tabulaflow_source",
  "tabulaflow_prepare_read",
  "tabulaflow_prepare_mutate",
  "tabulaflow_compose_read",
  "tabulaflow_compose_mutate",
  "tabulaflow_qualitative_coding",
]);

export function createWebMcpTools(contextRef, availability) {
  const runtimeHealth = runtimeHealthFor(contextRef);
  const tools = [{
    name: "tabulaflow_get_workspace_state",
    title: "Get TabulaFlow workspace state",
    description: "Inspect the visible workspace, active IDs, filters, data summary, diagnostics, and runtime health before acting.",
    inputSchema: EMPTY_INPUT_SCHEMA,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute() {
      const { state, actions } = activeContext(contextRef);
      const activeOperationIds = actions.getActiveOperationIds?.() ?? state.activeOperationIds ?? [];
      return webMcpResult(`TabulaFlow is showing the ${state.workspace} workspace.`, {
        ...state,
        activeOperationIds,
        pendingInteractions: actions.getPendingInteractions?.() ?? state.pendingInteractions ?? [],
        diagnostics: (state.diagnostics ?? []).map(sanitizeWebMcpDiagnostic),
        runtimeHealth: runtimeHealth.snapshot({ activeOperationIds }),
      });
    },
  }, {
    name: "tabulaflow_get_capabilities",
    title: "Get TabulaFlow AI capabilities",
    description: "Discover TabulaFlow WebMCP capabilities and safety boundaries. This tool is always available and does not require login or an open dataset.",
    inputSchema: EMPTY_INPUT_SCHEMA,
    annotations: { readOnlyHint: true },
    execute() {
      const activeOperationIds = contextRef.current?.actions?.getActiveOperationIds?.() ?? [];
      return webMcpResult("TabulaFlow WebMCP is available without login. Local file selection and deletion remain under user control.", {
        ...WEBMCP_CAPABILITIES,
        runtimeHealth: runtimeHealth.snapshot({ activeOperationIds }),
      });
    },
  }, {
    name: "tabulaflow_get_workflow_guide",
    title: "Get the TabulaFlow workflow guide",
    description: "Explain Source, Prepare, Compose, collaboration revisions, and the actions that always remain under user control.",
    inputSchema: EMPTY_INPUT_SCHEMA,
    annotations: { readOnlyHint: true },
    execute() {
      return webMcpResult("TabulaFlow uses the Source to Prepare to Compose workflow.", WORKFLOW_GUIDE);
    },
  }, {
    name: "tabulaflow_get_calculation_catalog",
    title: "Get the Formula column language catalog",
    description: "Read the safe row-level Formula column syntax, function allowlist, types, examples, and expression version.",
    inputSchema: EMPTY_INPUT_SCHEMA,
    annotations: { readOnlyHint: true },
    execute() {
      return webMcpResult("Returned the safe Prepare Formula column language catalog.", CALCULATION_CATALOG);
    },
  }, {
    name: "tabulaflow_describe_operation",
    title: "Describe a Compose operation",
    description: "Explain one Compose operation, its input count, compatibility requirements, output behavior, and recovery path.",
    inputSchema: OPERATION_DESCRIPTION_SCHEMA,
    annotations: { readOnlyHint: true },
    execute({ kind }) {
      return webMcpResult(`Described the ${kind} operation.`, { kind, ...OPERATION_GUIDES[kind] });
    },
  }, {
    name: "tabulaflow_get_available_actions",
    title: "Get available TabulaFlow actions",
    description: "Return the actions currently valid for the visible workspace or one dataset/operation target.",
    inputSchema: WORKSPACE_ACTIONS_SCHEMA,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    async execute({ targetId }) {
      const { actions } = activeContext(contextRef);
      const result = await actions.getAvailableActions(targetId);
      return webMcpResult("Returned the actions available in the current context.", applyRuntimeHealthToActions(result, runtimeHealth.snapshot()));
    },
  }, {
    name: "tabulaflow_get_activity_log",
    title: "Get shared TabulaFlow activity",
    description: "Read the newest privacy-safe activity entries produced by both the user UI and AI agents. Use targetId or actor to narrow the result.",
    inputSchema: ACTIVITY_LOG_SCHEMA,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    async execute({ limit = 50, targetId, actor }) {
      const { actions } = activeContext(contextRef);
      const result = await actions.getActivityLog({ limit, targetId, actor });
      return webMcpResult(`Returned ${result.events.length} shared activity events.`, result);
    },
  }, {
    name: "tabulaflow_get_changes_since",
    title: "Get TabulaFlow changes since a cursor",
    description: "Read ordered activity changes newer than a cursor. Use this before another mutation when the user may have changed the workspace.",
    inputSchema: CHANGES_SINCE_SCHEMA,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    async execute({ cursor, limit = 100 }) {
      const { actions } = activeContext(contextRef);
      const result = await actions.getChangesSince(cursor, { limit });
      return webMcpResult(`Returned ${result.events.length} changes after cursor ${cursor}.`, result);
    },
  }, {
    name: "tabulaflow_get_operation_status",
    title: "Get mutation operation status",
    description: "Poll an async mutation for status, progress, terminal result, or safe diagnostic.",
    inputSchema: OPERATION_STATUS_SCHEMA,
    annotations: { readOnlyHint: true },
    async execute({ operationId }) {
      const { actions } = activeContext(contextRef);
      const result = await actions.getOperationStatus(operationId);
      return webMcpResult(`Mutation operation ${operationId} is ${result.status}.`, result);
    },
  }, {
    name: "tabulaflow_cancel_operation",
    title: "Cancel pending TabulaFlow work",
    description: "Cancel an accepted or running mutation before commit, or dismiss an awaiting-user Source interaction.",
    inputSchema: CANCEL_PENDING_SCHEMA,
    annotations: { readOnlyHint: false, destructiveHint: false },
    async execute({ operationId, interactionId }) {
      const { actions } = activeContext(contextRef);
      const result = interactionId
        ? await actions.cancelInteraction(interactionId)
        : await actions.cancelOperation(operationId);
      const targetId = interactionId ?? operationId;
      return webMcpResult(`Cancellation state for ${targetId}: ${result.status}.`, result);
    },
  }, {
    name: "tabulaflow_get_pending_confirmations",
    title: "Get pending user confirmations",
    description: "List privacy-safe destructive requests waiting for a visible user decision. AI agents can inspect or reject a request, but can never confirm deletion.",
    inputSchema: EMPTY_INPUT_SCHEMA,
    annotations: { readOnlyHint: true },
    async execute() {
      const { actions } = activeContext(contextRef);
      const result = await actions.getPendingConfirmations();
      return webMcpResult(`Returned ${result.confirmations.length} pending user confirmations.`, result);
    },
  }, {
    name: "tabulaflow_reject_confirmation",
    title: "Reject a pending destructive request",
    description: "Cancel one pending destructive request. This tool cannot confirm or perform deletion; approval remains a visible user-only action.",
    inputSchema: CONFIRMATION_SCHEMA,
    annotations: { readOnlyHint: false, destructiveHint: false },
    async execute({ confirmationId }) {
      const { actions } = activeContext(contextRef);
      const result = await actions.rejectConfirmation(confirmationId);
      return webMcpResult(`Rejected pending confirmation ${confirmationId}.`, result);
    },
  }, {
    name: "tabulaflow_open_workspace",
    title: "Open a TabulaFlow workspace",
    description: "Show Source, Prepare, Compose, or Account in the current TabulaFlow page. Prepare and Compose are available only when the current flow has the required data.",
    inputSchema: WORKSPACE_INPUT_SCHEMA,
    annotations: { readOnlyHint: false },
    async execute({ workspace }) {
      const { actions } = activeContext(contextRef);
      const result = await actions.openWorkspace(workspace);
      return webMcpResult(`Opened the ${workspace} workspace.`, { ...result, generation: runtimeHealth.snapshot().generation });
    },
  }, {
    name: "tabulaflow_request_source_file",
    title: "Choose a source file in TabulaFlow",
    description: "Open Source and focus its file chooser. The user must choose the local file.",
    inputSchema: EMPTY_INPUT_SCHEMA,
    annotations: { readOnlyHint: false },
    async execute() {
      const { actions } = activeContext(contextRef);
      const result = await actions.requestSourceFileSelection();
      return webMcpResult("The Source file chooser is ready for the user.", { ...result, generation: runtimeHealth.snapshot().generation });
    },
  }, {
    name: "tabulaflow_request_source_relink",
    title: "Request source relinking",
    description: "Open Source and focus the Re-link control for an unavailable local source. The user must select the matching file.",
    inputSchema: SOURCE_RELINK_SCHEMA,
    annotations: { readOnlyHint: false },
    async execute({ sourceAssetId }) {
      const { actions } = activeContext(contextRef);
      const result = await actions.requestSourceRelink(sourceAssetId);
      return webMcpResult("The source Re-link control is ready for the user.", { ...result, generation: runtimeHealth.snapshot().generation });
    },
  }, {
    name: "tabulaflow_request_reset_all",
    title: "Request a complete flow reset",
    description: "Open the visible Reset all confirmation. AI requests but never confirms this destructive action.",
    inputSchema: RESET_ALL_SCHEMA,
    annotations: { readOnlyHint: false, destructiveHint: true },
    async execute({ expectedRevision, requestId }) {
      const { actions } = activeContext(contextRef);
      const result = await actions.requestResetAll({ expectedRevision, requestId });
      return webMcpResult("Reset all is waiting for visible user confirmation in Source.", result);
    },
  }, {
    name: "tabulaflow_list_cloud_files",
    title: "List signed-in cloud files",
    description: "List cloud files and storage metadata for the signed-in account. Returns an authentication-required result when the user is a guest.",
    inputSchema: EMPTY_INPUT_SCHEMA,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    async execute() {
      const { actions } = activeContext(contextRef);
      const result = await actions.listCloudFiles();
      return webMcpResult(result.authenticated ? "Listed cloud files." : "Cloud files require ChatGPT sign-in.", result);
    },
  }, {
    name: "tabulaflow_open_cloud_file",
    title: "Open a cloud file",
    description: "Download one signed-in cloud file by stable ID and open it as a visible local TabulaFlow source.",
    inputSchema: CLOUD_FILE_SCHEMA,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    async execute({ fileId, expectedRevision, requestId }) {
      const { actions } = activeContext(contextRef);
      const result = await actions.openCloudFile(fileId, { expectedRevision, requestId });
      return webMcpResult(`Opened cloud file ${result.name}.`, result);
    },
  }, {
    name: "tabulaflow_request_cloud_upload",
    title: "Request a cloud upload",
    description: "Open Account and focus the cloud upload control. The signed-in user must choose the local file.",
    inputSchema: EMPTY_INPUT_SCHEMA,
    annotations: { readOnlyHint: false },
    async execute() {
      const { actions } = activeContext(contextRef);
      await actions.requestCloudUpload();
      return webMcpResult("The cloud upload control is ready for the user.", { awaitingUser: true, workspace: "account" });
    },
  }];

  if (availability.hasPrepared) {
    tools.push({
      name: "tabulaflow_select_prepared_dataset",
      title: "Open a prepared dataset",
      description: "Open one existing prepared dataset in Prepare by its stable ID. Read the available IDs with tabulaflow_get_workspace_state first.",
      inputSchema: SELECT_PREPARED_INPUT_SCHEMA,
      annotations: { readOnlyHint: false },
      async execute({ preparedId, expectedRevision, requestId }) {
        const { state, actions } = activeContext(contextRef);
        const prepared = state.preparedInputs.find((item) => item.id === preparedId);
        if (!prepared) throw new Error(`Prepared dataset not found: ${preparedId}`);
        const result = await actions.selectPrepared(preparedId, { expectedRevision, requestId });
        return webMcpResult(`Opened prepared dataset ${prepared.name}.`, { preparedId, name: prepared.name, ...result });
      },
    }, {
      name: "tabulaflow_get_recipe",
      title: "Get a prepared dataset recipe",
      description: "Read the complete ordered recipe, recipe revision, status, and schema for one prepared dataset.",
      inputSchema: PREPARE_TARGET_SCHEMA,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async execute({ preparedId }) {
        const { actions } = activeContext(contextRef);
        const result = await actions.getRecipe(preparedId);
        return webMcpResult(`Read the recipe for ${result.name}.`, result);
      },
    }, {
      name: "tabulaflow_get_semantic_model",
      title: "Get dataset or node semantics",
      description: "Read business names, roles, units, sensitivity, allowed aggregations, and provenance for a prepared dataset or Compose node.",
      inputSchema: SEMANTIC_MODEL_SCHEMA,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async execute({ targetId }) {
        const { actions } = activeContext(contextRef);
        const result = await actions.getSemanticModel(targetId);
        return webMcpResult(`Read semantic metadata for ${targetId}.`, result);
      },
    }, {
      name: "tabulaflow_update_semantic_field",
      title: "Update semantic field metadata",
      description: "Update field role, unit, sensitivity, or aggregations. AI cannot lower sensitivity.",
      inputSchema: UPDATE_SEMANTIC_FIELD_SCHEMA,
      annotations: { readOnlyHint: false },
      async execute({ targetId, fieldName, changes, expectedRevision, requestId }) {
        const { actions } = activeContext(contextRef);
        const result = await actions.updateSemanticField(targetId, fieldName, changes, { expectedRevision, requestId });
        return webMcpResult(`Updated semantic metadata for ${fieldName}.`, result);
      },
    }, {
      name: "tabulaflow_list_metric_definitions",
      title: "List reusable metric definitions",
      description: "List reusable aggregate metric definitions for one dataset, including function, source column, unit, and format.",
      inputSchema: SEMANTIC_MODEL_SCHEMA,
      annotations: { readOnlyHint: true },
      async execute({ targetId }) {
        const { actions } = activeContext(contextRef);
        const result = await actions.listMetricDefinitions(targetId);
        return webMcpResult(`Returned ${result.metrics.length} reusable metrics.`, result);
      },
    }, {
      name: "tabulaflow_upsert_metric_definition",
      title: "Save a reusable metric definition",
      description: "Create or update a reusable metric definition after validating the target schema and aggregation function.",
      inputSchema: METRIC_DEFINITION_SCHEMA,
      annotations: { readOnlyHint: false },
      async execute({ expectedRevision, requestId, ...definition }) {
        const { actions } = activeContext(contextRef);
        const result = await actions.upsertMetricDefinition(definition, { expectedRevision, requestId });
        return webMcpResult(`Saved reusable metric ${result.metric.name}.`, result);
      },
    }, {
      name: "tabulaflow_delete_metric_definition",
      title: "Delete a reusable metric definition",
      description: "Open a visible confirmation before deleting a reusable metric definition. Existing Compose nodes keep their copied metric configuration.",
      inputSchema: DELETE_METRIC_DEFINITION_SCHEMA,
      annotations: { readOnlyHint: false },
      async execute({ id, expectedRevision, requestId }) {
        const { actions } = activeContext(contextRef);
        const result = await actions.requestDelete("metric-definition", id, { expectedRevision, requestId });
        return webMcpResult(`Deletion confirmation opened for reusable metric ${id}.`, result);
      },
    }, {
      name: "tabulaflow_replace_recipe",
      title: "Replace a Prepare recipe atomically",
      description: "Validate and atomically commit a complete recipe using current workspace and recipe revisions.",
      inputSchema: REPLACE_RECIPE_SCHEMA,
      annotations: { readOnlyHint: false },
      async execute({ preparedId, recipe, expectedRecipeRevision, expectedRevision, requestId, executionMode = "async" }) {
        const { actions } = activeContext(contextRef);
        const result = await actions.replaceRecipe(preparedId, recipe, expectedRecipeRevision, { expectedRevision, requestId, executionMode, target: { type: "prepared-dataset", id: preparedId } });
        return webMcpResult(result.status === "accepted" ? "Recipe replacement was accepted for background execution." : `Replaced the recipe with ${recipe.length} ordered steps.`, result);
      },
    }, {
      name: "tabulaflow_duplicate_prepared_dataset",
      title: "Duplicate a prepared dataset",
      description: "Deep-clone one prepared dataset recipe while sharing its source table. Requires a current workspace revision and idempotency key.",
      inputSchema: DUPLICATE_PREPARED_SCHEMA,
      annotations: { readOnlyHint: false },
      async execute({ preparedId, expectedRevision, requestId, executionMode = "async" }) {
        const { actions } = activeContext(contextRef);
        const result = await actions.duplicatePrepared(preparedId, { expectedRevision, requestId, executionMode, target: { type: "prepared-dataset", id: preparedId } });
        return webMcpResult(result.status === "accepted"
          ? "Prepared dataset duplication was accepted for background execution."
          : `Created prepared dataset ${result.name ?? result.preparedInputId}.`, result);
      },
    });
  }

  if (availability.hasDataset) {
    tools.push({
      name: "tabulaflow_get_prepare_dataset",
      title: "Get the active prepared dataset",
      description: "Read complete schema, types, total and filtered row counts, quality summary, filters, and recipe status for the active prepared dataset.",
      inputSchema: PREPARE_TARGET_SCHEMA,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async execute({ preparedId }) {
        const { actions } = activeContext(contextRef);
        const result = await actions.getPrepareDataset(preparedId);
        return webMcpResult(`Read prepared dataset ${result.name}.`, result);
      },
    }, {
      name: "tabulaflow_get_data_profile",
      title: "Profile prepared data",
      description: "Read missing, distinct, mixed-type, and conservative sensitivity metadata by column.",
      inputSchema: DATA_PROFILE_SCHEMA,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async execute({ preparedId, columns }) {
        const { actions } = activeContext(contextRef);
        const result = await actions.getDataProfile(preparedId, columns);
        return webMcpResult(`Profiled ${result.columns.length} columns.`, result);
      },
    }, {
      name: "tabulaflow_query_column_values",
      title: "Query a frequency mini table",
      description: "Search and page grouped values and counts for one active Prepare column using the same faceted filters as the visible mini table.",
      inputSchema: COLUMN_VALUES_SCHEMA,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async execute({ preparedId, column, search = "", offset = 0, limit = 100 }) {
        const { actions } = activeContext(contextRef);
        const result = await actions.queryColumnValues(preparedId, column, search, { offset, limit });
        return webMcpResult(`Returned grouped values for ${column}.`, result);
      },
    }, {
      name: "tabulaflow_get_prepare_preview",
      title: "Read prepared-data preview rows",
      description: "Read up to 20 filtered Prepare rows with 1-20 explicit columns. Sensitive columns are redacted; use opaque frequency value references for filtering.",
      inputSchema: PAGED_PREVIEW_SCHEMA,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async execute({ preparedId, columns, offset = 0, limit = 20 }) {
        const { actions } = activeContext(contextRef);
        const result = await actions.getPreparePreview(preparedId, columns, { offset, limit });
        return webMcpResult(`Returned ${result.previewRowCount} prepared-data rows.`, result);
      },
    }, {
      name: "tabulaflow_qualitative_coding",
      title: "Work with qualitative coding",
      description: "Read codebook, pseudonymized batches, or progress; submit suggestions. AI cannot approve them.",
      inputSchema: QUALITATIVE_CODING_SCHEMA,
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      async execute({ action, projectId, batchId, offset = 0, limit = 25, submissions, expectedRevision, requestId }) {
        const { actions } = activeContext(contextRef);
        if (action === "get-project") {
          const result = await actions.getCodingProject(projectId);
          return webMcpResult(`Read qualitative coding project ${result.name}.`, result);
        }
        if (action === "get-progress") {
          const result = await actions.getCodingProgress(projectId);
          return webMcpResult("Read qualitative coding review progress.", { projectId: result.id, projectRevision: result.revision, codebookRevision: result.codebookRevision, progress: result.progress, workspaceRevision: result.workspaceRevision });
        }
        if (action === "get-batch") {
          if (!projectId) throw Object.assign(new Error("projectId is required for get-batch."), { code: "INVALID_CODING_REQUEST" });
          const result = await actions.getCodingBatch(projectId, { offset, limit });
          return webMcpResult(`Returned ${result.items.length} pseudonymized responses for coding.`, result);
        }
        if (action === "submit-batch") {
          if (!projectId || !batchId || !Array.isArray(submissions) || expectedRevision === undefined || !requestId) {
            throw Object.assign(new Error("projectId, batchId, submissions, expectedRevision, and requestId are required for submit-batch."), { code: "INVALID_CODING_REQUEST" });
          }
          const result = await actions.submitCodingBatch(projectId, batchId, submissions, { expectedRevision, requestId });
          return webMcpResult(`Submitted ${submissions.length} qualitative coding suggestions for human review.`, result);
        }
        throw Object.assign(new Error(`Unsupported qualitative coding action: ${action}`), { code: "INVALID_CODING_REQUEST" });
      },
    }, {
      name: "tabulaflow_preview_recipe_change",
      title: "Preview a complete recipe",
      description: "Dry-run a complete recipe. Returns diagnostics, counts, schema delta, and only explicitly requested bounded rows.",
      inputSchema: RECIPE_PREVIEW_SCHEMA,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async execute({ preparedId, recipe, stepIndex, previewColumns, previewLimit = 10 }) {
        const { actions } = activeContext(contextRef);
        const result = await actions.previewRecipeChange(preparedId, recipe, stepIndex, { previewColumns, previewLimit });
        return webMcpResult(result.valid ? "Validated the recipe change without saving it." : "The recipe change is invalid.", result);
      },
    }, {
      name: "tabulaflow_set_aggregate_columns",
      title: "Choose visible frequency columns",
      description: "Replace the ordered set of up to 200 columns rendered as Prepare frequency mini tables without changing the underlying dataset or recipe.",
      inputSchema: AGGREGATE_COLUMNS_SCHEMA,
      annotations: { readOnlyHint: false },
      async execute({ preparedId, columns, expectedRevision, requestId }) {
        const { actions } = activeContext(contextRef);
        const result = await actions.setAggregateColumns(preparedId, columns, { expectedRevision, requestId });
        return webMcpResult(`Showing ${result.aggregateColumns.length} frequency columns.`, result);
      },
    }, {
      name: "tabulaflow_set_preview_filter",
      title: "Filter the prepared-data preview",
      description: "Set or replace one visible temporary Prepare filter; columns combine with AND.",
      inputSchema: FILTER_MUTATION_SCHEMA,
      annotations: { readOnlyHint: false },
      async execute({ preparedId, column, value, expectedRevision, requestId }) {
        const { state, actions } = activeContext(contextRef);
        if (state.activePreparedId !== preparedId) throw new Error(`Prepared dataset is not active: ${preparedId}`);
        if (!state.activeDataset?.columns.includes(column)) throw new Error(`Column is not available: ${column}`);
        const nextFilters = { ...state.activeDataset.filters, [column]: filterSelection(value) };
        const result = await actions.applyFilters(preparedId, nextFilters, { expectedRevision, requestId });
        return webMcpResult(`Filtered ${column} by the requested value.`, {
          column,
          valueRef: value?.valueRef ?? null,
          totalRowCount: result.rowCount,
          filteredRowCount: result.filteredCount,
          filterColumns: Object.keys(nextFilters),
          workspaceRevision: result.workspaceRevision,
          activity: result.activity,
        });
      },
    }, {
      name: "tabulaflow_remove_preview_filter",
      title: "Remove one prepared-data filter",
      description: "Remove one temporary Prepare filter while preserving filters on other columns.",
      inputSchema: REMOVE_FILTER_SCHEMA,
      annotations: { readOnlyHint: false },
      async execute({ preparedId, column, expectedRevision, requestId }) {
        const { state, actions } = activeContext(contextRef);
        const nextFilters = { ...state.activeDataset?.filters };
        delete nextFilters[column];
        const result = await actions.applyFilters(preparedId, nextFilters, { expectedRevision, requestId });
        return webMcpResult(`Removed the ${column} filter.`, { filterColumns: Object.keys(nextFilters), totalRowCount: result.rowCount, filteredRowCount: result.filteredCount, workspaceRevision: result.workspaceRevision, activity: result.activity });
      },
    }, {
      name: "tabulaflow_clear_preview_filters",
      title: "Clear prepared-data filters",
      description: "Remove every temporary value filter from the active Prepare preview and update the visible aggregate tables and data preview.",
      inputSchema: CLEAR_FILTERS_SCHEMA,
      annotations: { readOnlyHint: false },
      async execute({ preparedId, expectedRevision, requestId }) {
        const { actions } = activeContext(contextRef);
        const result = await actions.applyFilters(preparedId, {}, { expectedRevision, requestId });
        return webMcpResult("Cleared all temporary Prepare filters.", { totalRowCount: result.rowCount, filteredRowCount: result.filteredCount, filterColumns: [], workspaceRevision: result.workspaceRevision, activity: result.activity });
      },
    }, {
      name: "tabulaflow_export_prepare",
      title: "Export the prepared dataset",
      description: "Export the filtered Prepare result as CSV or Excel with revision and idempotency guards.",
      inputSchema: PREPARE_EXPORT_V2_SCHEMA,
      annotations: { readOnlyHint: false },
      async execute({ preparedId, format, expectedRevision, requestId, executionMode = "async" }) {
        const { actions } = activeContext(contextRef);
        const result = await actions.exportPrepare(preparedId, format, { expectedRevision, requestId, executionMode, operationClass: "snapshot-compute", target: { type: "prepared-dataset", id: preparedId } });
        return webMcpResult(result.status === "accepted"
          ? "Prepare export was accepted for background execution."
          : `Downloaded ${result.filename}.`, result);
      },
    }, {
      name: "tabulaflow_add_recipe_step",
      title: "Add a Prepare recipe step",
      description: "Append one supported transformation to the active prepared dataset and visibly rebuild its result. Use exact column names from workspace state.",
      inputSchema: ADD_RECIPE_STEP_V2_SCHEMA,
      annotations: { readOnlyHint: false },
      async execute({ preparedId, step, expectedRevision, requestId, executionMode = "async" }) {
        const { actions } = activeContext(contextRef);
        const result = await actions.addRecipeStep(preparedId, step, { expectedRevision, requestId, executionMode });
        return webMcpResult(`Added ${step.type} to the Prepare recipe.`, result);
      },
    }, {
      name: "tabulaflow_request_delete_all_recipe_steps",
      title: "Request deletion of all Prepare recipe steps",
      description: "Open visible Delete all confirmation for the active recipe. AI never confirms it; Undo can restore it.",
      inputSchema: DELETE_ALL_RECIPE_STEPS_SCHEMA,
      annotations: { readOnlyHint: false, destructiveHint: true },
      async execute({ preparedId, expectedRevision, requestId }) {
        const { state, actions } = activeContext(contextRef);
        if (state.activePreparedId !== preparedId) throw new Error(`Prepared dataset is not active: ${preparedId}`);
        if (!state.recipeSteps.length) throw new Error(`Prepare recipe has no steps: ${preparedId}`);
        const result = await actions.requestDelete("prepare-recipe", preparedId, { expectedRevision, requestId });
        return webMcpResult(`Delete all confirmation opened for the recipe of ${preparedId}.`, result);
      },
    }, {
      name: "tabulaflow_update_recipe_step",
      title: "Update a Prepare recipe step",
      description: "Replace the type and parameters of one existing recipe step, preserving its stable ID and enabled state.",
      inputSchema: UPDATE_RECIPE_STEP_V2_SCHEMA,
      annotations: { readOnlyHint: false },
      async execute({ preparedId, stepId, step, expectedRevision, requestId, executionMode = "async" }) {
        const { actions } = activeContext(contextRef);
        const result = await actions.updateRecipeStep(preparedId, stepId, step, { expectedRevision, requestId, executionMode });
        return webMcpResult(`Updated recipe step ${stepId}.`, result);
      },
    }, {
      name: "tabulaflow_set_recipe_step_enabled",
      title: "Enable or disable a recipe step",
      description: "Enable or disable one existing Prepare recipe step without deleting it.",
      inputSchema: ENABLE_RECIPE_STEP_V2_SCHEMA,
      annotations: { readOnlyHint: false },
      async execute({ preparedId, stepId, enabled, expectedRevision, requestId, executionMode = "async" }) {
        const { actions } = activeContext(contextRef);
        const result = await actions.setRecipeStepEnabled(preparedId, stepId, enabled, { expectedRevision, requestId, executionMode });
        return webMcpResult(`${enabled ? "Enabled" : "Disabled"} recipe step ${stepId}.`, result);
      },
    }, {
      name: "tabulaflow_move_recipe_step",
      title: "Move a Prepare recipe step",
      description: "Move one existing recipe step to a one-based position and visibly rebuild the prepared result.",
      inputSchema: MOVE_RECIPE_STEP_V2_SCHEMA,
      annotations: { readOnlyHint: false },
      async execute({ preparedId, stepId, position, expectedRevision, requestId, executionMode = "async" }) {
        const { actions } = activeContext(contextRef);
        const result = await actions.moveRecipeStep(preparedId, stepId, position, { expectedRevision, requestId, executionMode });
        return webMcpResult(`Moved recipe step ${stepId} to position ${position}.`, result);
      },
    }, {
      name: "tabulaflow_undo_recipe",
      title: "Undo the last recipe change",
      description: "Undo the latest Prepare recipe change and visibly rebuild the prepared result.",
      inputSchema: RECIPE_HISTORY_V2_SCHEMA,
      annotations: { readOnlyHint: false },
      async execute({ preparedId, expectedRevision, requestId, executionMode = "async" }) {
        const { actions } = activeContext(contextRef);
        const result = await actions.undoRecipe(preparedId, { expectedRevision, requestId, executionMode });
        return webMcpResult("Undid the last Prepare recipe change.", result);
      },
    }, {
      name: "tabulaflow_redo_recipe",
      title: "Redo the last recipe change",
      description: "Redo the latest undone Prepare recipe change and visibly rebuild the prepared result.",
      inputSchema: RECIPE_HISTORY_V2_SCHEMA,
      annotations: { readOnlyHint: false },
      async execute({ preparedId, expectedRevision, requestId, executionMode = "async" }) {
        const { actions } = activeContext(contextRef);
        const result = await actions.redoRecipe(preparedId, { expectedRevision, requestId, executionMode });
        return webMcpResult("Redid the Prepare recipe change.", result);
      },
    }, {
      name: "tabulaflow_apply_value_action",
      title: "Keep or delete a grouped value",
      description: "Create the same tracked Keep or Delete rows recipe step exposed by a value row context menu in Prepare.",
      inputSchema: VALUE_ACTION_V2_SCHEMA,
      annotations: { readOnlyHint: false },
      async execute({ preparedId, action, column, value, expectedRevision, requestId, executionMode = "async" }) {
        const { actions } = activeContext(contextRef);
        const result = await actions.applyValueAction(preparedId, action, column, value, { expectedRevision, requestId, executionMode });
        return webMcpResult(`${action === "keep" ? "Kept" : "Deleted"} rows for the selected grouped value.`, result);
      },
    });
  }

  if (availability.hasComposeNodes) {
    tools.push({
      name: "tabulaflow_get_compose_graph",
      title: "Get the Compose graph",
      description: "Read a compact Compose graph summary with node IDs, counts, positions, statuses, and edges. Use tabulaflow_get_node_schema and tabulaflow_get_compose_node for paged schema and protected configuration details.",
      inputSchema: EMPTY_INPUT_SCHEMA,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async execute() {
        const { actions } = activeContext(contextRef);
        const result = await actions.getComposeGraph();
        return webMcpResult(`Read ${result.nodes.length} Compose graph nodes.`, result);
      },
    }, {
      name: "tabulaflow_get_compose_node",
      title: "Get one Compose node",
      description: "Read one compact dataset or operation node including protected configuration, inputs, result counts, and status. Schema is available separately through tabulaflow_get_node_schema.",
      inputSchema: COMPOSE_NODE_INPUT_SCHEMA,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async execute({ nodeId }) {
        const { actions } = activeContext(contextRef);
        const result = await actions.getComposeNode(nodeId);
        return webMcpResult(`Read Compose node ${result.name}.`, result);
      },
    }, {
      name: "tabulaflow_get_node_schema",
      title: "Read a Compose node schema page",
      description: "Read up to 100 schema columns for one dataset or operation node. Use offset pagination until hasMore is false instead of requesting the entire schema through the graph.",
      inputSchema: COMPOSE_SCHEMA_PAGE_SCHEMA,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async execute({ nodeId, offset = 0, limit = 100 }) {
        const { actions } = activeContext(contextRef);
        const result = await actions.getComposeNodeSchema(nodeId, { offset, limit });
        return webMcpResult(`Returned ${result.columns.length} schema columns for Compose node ${nodeId}.`, result);
      },
    }, {
      name: "tabulaflow_get_node_preview",
      title: "Read Compose node preview rows",
      description: "Evaluate a Compose node and return up to 20 rows with 1-20 explicit columns. Sensitive values are redacted.",
      inputSchema: COMPOSE_PREVIEW_SCHEMA,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async execute({ nodeId, columns, offset = 0, limit = 20 }) {
        const { actions } = activeContext(contextRef);
        const result = await actions.getComposeNodePreview(nodeId, columns, { offset, limit });
        return webMcpResult(`Returned ${result.previewRowCount} rows from Compose node ${nodeId}.`, result);
      },
    }, {
      name: "tabulaflow_get_compose_node_quality",
      title: "Get Compose node quality",
      description: "Profile one Compose result for empty cells, mixed-type columns, semantic coverage, sensitivity totals, and minimum-sample warnings.",
      inputSchema: COMPOSE_QUALITY_SCHEMA,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async execute({ nodeId }) {
        const { actions } = activeContext(contextRef);
        const result = await actions.getComposeNodeQuality(nodeId);
        return webMcpResult(`Profiled Compose node ${nodeId}.`, result);
      },
    }, {
      name: "tabulaflow_validate_compose_operation",
      title: "Validate a Compose operation",
      description: "Dry-run a candidate operation and return diagnostics, output counts, and schema delta without changing the graph. Rows require explicit previewColumns and are limited to 20.",
      inputSchema: VALIDATE_COMPOSE_OPERATION_SCHEMA,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async execute({ operation, previewColumns, previewLimit = 10 }) {
        const { actions } = activeContext(contextRef);
        const result = await actions.validateComposeOperation(operation, { previewColumns, previewLimit });
        return webMcpResult(result.valid ? "Validated the candidate Compose operation without saving it." : "The candidate Compose operation is invalid.", result);
      },
    }, {
      name: "tabulaflow_get_connection_options",
      title: "Get compatible Compose connections",
      description: "List valid target nodes and a bounded ranking of Join/Difference keys using exact names, normalized-name similarity, uniqueness, null ratio, and exact type compatibility.",
      inputSchema: CONNECTION_OPTIONS_SCHEMA,
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      async execute({ nodeId }) {
        const { actions } = activeContext(contextRef);
        const result = await actions.getConnectionOptions(nodeId);
        return webMcpResult(`Returned connection options for ${nodeId}.`, result);
      },
    }, {
      name: "tabulaflow_select_compose_node",
      title: "Select a Compose node",
      description: "Open Compose, select an existing dataset or operation node by its stable ID, and update the visible result preview for that node.",
      inputSchema: SELECT_COMPOSE_NODE_INPUT_SCHEMA,
      annotations: { readOnlyHint: false },
      async execute({ nodeId, expectedRevision, requestId }) {
        const { state, actions } = activeContext(contextRef);
        const node = state.composeNodes.find((item) => item.id === nodeId);
        if (!node) throw new Error(`Compose node not found: ${nodeId}`);
        const result = await actions.selectComposeNode(nodeId, { expectedRevision, requestId });
        return webMcpResult(`Selected Compose node ${node.name}.`, { nodeId, name: node.name, ...result });
      },
    }, {
      name: "tabulaflow_auto_arrange_compose",
      title: "Auto arrange the Compose graph",
      description: "Open Compose and arrange the current dependency graph from left to right while separating parallel branches. This visibly replaces current node positions.",
      inputSchema: AUTO_ARRANGE_V2_SCHEMA,
      annotations: { readOnlyHint: false },
      async execute({ expectedRevision, requestId }) {
        const { actions } = activeContext(contextRef);
        const graph = await actions.autoArrangeCompose({ expectedRevision, requestId });
        if (!graph) throw new Error("The Compose graph could not be arranged.");
        return webMcpResult("Auto-arranged the Compose graph.", graph);
      },
    }, {
      name: "tabulaflow_move_compose_node",
      title: "Move a Compose node",
      description: "Move one dataset or operation node to an explicit canvas position without changing graph topology.",
      inputSchema: MOVE_COMPOSE_SCHEMA,
      annotations: { readOnlyHint: false },
      async execute({ nodeId, position, expectedRevision, requestId }) {
        const { actions } = activeContext(contextRef);
        const result = await actions.moveComposeNode(nodeId, position, { expectedRevision, requestId });
        return webMcpResult(`Moved Compose node ${nodeId}.`, result);
      },
    }, {
      name: "tabulaflow_export_compose",
      title: "Export a Compose node",
      description: "Select and download one existing Compose dataset or operation result as CSV or Excel. Requires the latest workspace revision and an idempotency key so retries do not trigger duplicate downloads.",
      inputSchema: COMPOSE_EXPORT_SCHEMA,
      annotations: { readOnlyHint: false },
      async execute({ nodeId, format, expectedRevision, requestId, executionMode = "async" }) {
        const { state, actions } = activeContext(contextRef);
        if (!state.composeNodes.some((item) => item.id === nodeId)) throw new Error(`Compose node not found: ${nodeId}`);
        const result = await actions.exportCompose(nodeId, format, { expectedRevision, requestId, executionMode, operationClass: "snapshot-compute", target: { type: "compose-node", id: nodeId } });
        return webMcpResult(result.status === "accepted"
          ? "Compose export was accepted for background execution."
          : `Downloaded ${result.filename}.`, result);
      },
    }, {
      name: "tabulaflow_create_compose_operation",
      title: "Create a Compose operation",
      description: "Transactionally validate and create Append, Join, Difference, Aggregate, Filter rows, Distinct rows, Pivot, or Unpivot in the visible Compose graph.",
      inputSchema: CREATE_COMPOSE_OPERATION_V2_SCHEMA,
      annotations: { readOnlyHint: false },
      async execute({ operation, expectedRevision, requestId, executionMode = "async" }) {
        const { actions } = activeContext(contextRef);
        const result = await actions.createComposeOperation(operation, { expectedRevision, requestId, executionMode, target: { type: "compose-graph", id: null } });
        return webMcpResult(result.status === "accepted" ? "Compose operation creation was accepted for background execution." : `Created Compose operation ${result.name}.`, result);
      },
    }, {
      name: "tabulaflow_update_compose_operation",
      title: "Update a Compose operation",
      description: "Transactionally validate and replace an existing Compose operation configuration while preserving its stable node ID.",
      inputSchema: UPDATE_COMPOSE_OPERATION_SCHEMA,
      annotations: { readOnlyHint: false },
      async execute({ nodeId, operation, expectedRevision, requestId, executionMode = "async" }) {
        const { actions } = activeContext(contextRef);
        const result = await actions.updateComposeOperation(nodeId, operation, { expectedRevision, requestId, executionMode, target: { type: "compose-node", id: nodeId } });
        return webMcpResult(result.status === "accepted" ? "Compose operation update was accepted for background execution." : `Updated Compose operation ${result.name}.`, result);
      },
    }, {
      name: "tabulaflow_promote_compose_result",
      title: "Create a prepared dataset from a Compose result",
      description: "Materialize one operation result as an independent prepared dataset with an empty recipe and visible dependency edge.",
      inputSchema: PROMOTE_COMPOSE_SCHEMA,
      annotations: { readOnlyHint: false },
      async execute({ nodeId, expectedRevision, requestId, executionMode = "async" }) {
        const { actions } = activeContext(contextRef);
        const result = await actions.promoteComposeResult(nodeId, { expectedRevision, requestId, executionMode, target: { type: "compose-node", id: nodeId } });
        return webMcpResult(result.status === "accepted"
          ? "Compose result promotion was accepted for background execution."
          : `Created prepared dataset ${result.name ?? result.preparedInputId} from ${nodeId}.`, result);
      },
    });
  }

  if (availability.hasDataset || availability.hasComposeNodes) {
    tools.push({
      name: "tabulaflow_request_delete",
      title: "Request deletion in TabulaFlow",
      description: "Open visible deletion confirmation for a recipe step, dataset, operation, or metric. AI never confirms it.",
      inputSchema: DELETE_REQUEST_SCHEMA,
      annotations: { readOnlyHint: false, destructiveHint: true },
      async execute({ target, targetId, expectedRevision, requestId }) {
        const { state, actions } = activeContext(contextRef);
        const exists = target === "recipe-step"
          ? state.recipeSteps.some((item) => item.id === targetId)
          : target === "prepared-dataset"
            ? state.preparedInputs.some((item) => item.id === targetId)
            : target === "compose-operation"
              ? state.composeNodes.some((item) => item.id === targetId && item.kind !== "dataset")
              : state.metricDefinitions.some((item) => item.id === targetId);
        if (!exists) throw new Error(`${target} not found: ${targetId}`);
        const result = await actions.requestDelete(target, targetId, { expectedRevision, requestId });
        return webMcpResult(`Deletion confirmation opened for ${targetId}.`, result);
      },
    });
  }

  return tools.map((tool) => ({
    ...tool,
    async execute(input = {}) {
      try {
        const result = await tool.execute(input);
        runtimeHealth.clear(tool.name);
        return result;
      } catch (cause) {
        if (cause && typeof cause === "object") {
          cause.code ??= cause instanceof SyntaxError ? "WEBMCP_EXECUTION_SYNTAX_ERROR" : "WEBMCP_EXECUTION_FAILED";
          cause.phase ??= "handler";
          cause.tool ??= tool.name;
          if (typeof input?.requestId === "string") cause.requestId ??= input.requestId;
        }
        runtimeHealth.record(tool.name, cause);
        throw cause;
      }
    },
  }));
}

function createDispatcherTool({ name, title, description, actions, toolsByName, readOnly, runtimeHealth }) {
  const inputSchema = strictObject({
    action: { type: "string", enum: dispatcherActionNames(actions), description: `The exact dispatcher action to run. Use ${WEBMCP_ACTION_CONTRACT_ACTION} to inspect another action's input contract.` },
    input: { type: "object", description: `Action-specific input. For ${WEBMCP_ACTION_CONTRACT_ACTION}, pass { action: "target_action" }.`, additionalProperties: true },
  }, ["action"]);
  return {
    name,
    title,
    description,
    inputSchema,
    annotations: { readOnlyHint: readOnly, untrustedContentHint: readOnly },
    async execute({ action, input = {} }) {
      if (action === WEBMCP_ACTION_CONTRACT_ACTION) {
        const contractSchema = strictObject({
          action: { type: "string", enum: Object.keys(actions), description: "The dispatcher action whose original strict input schema should be returned." },
        }, ["action"]);
        assertWebMcpInput(contractSchema, input);
        const targetName = actions[input.action];
        const target = toolsByName.get(targetName);
        if (!target) {
          const error = new Error(`Dispatcher action is unavailable: ${input.action}`);
          error.code = "WEBMCP_ACTION_UNAVAILABLE";
          throw error;
        }
        runtimeHealth.clear(name);
        return webMcpResult(`Returned the strict input contract for ${input.action}.`, {
          dispatcher: { tool: name, action: WEBMCP_ACTION_CONTRACT_ACTION },
          targetAction: input.action,
          targetTool: target.name,
          title: target.title,
          description: target.description,
          inputSchema: structuredClone(target.inputSchema),
          annotations: structuredClone(target.annotations ?? {}),
        });
      }
      const targetName = actions[action];
      const target = toolsByName.get(targetName);
      if (!target) {
        const error = new Error(`Dispatcher action is unavailable: ${action}`);
        error.code = "WEBMCP_ACTION_UNAVAILABLE";
        throw error;
      }
      try {
        assertWebMcpInput(target.inputSchema, input);
        const result = await target.execute(input);
        runtimeHealth.clear(name);
        return result?.structuredContent && typeof result.structuredContent === "object"
          ? { ...result, structuredContent: { ...result.structuredContent, dispatcher: { tool: name, action } } }
          : result;
      } catch (cause) {
        if (cause && typeof cause === "object") cause.dispatcherAction ??= action;
        runtimeHealth.record(name, cause);
        throw cause;
      }
    },
  };
}

export function createWebMcpStableTools(contextRef) {
  const runtimeHealth = runtimeHealthFor(contextRef);
  const granularTools = createWebMcpTools(contextRef, { hasDataset: true, hasPrepared: true, hasComposeNodes: true });
  const toolsByName = new Map(granularTools.map((tool) => [tool.name, tool]));
  const core = WEBMCP_CORE_TOOL_NAMES.map((name) => toolsByName.get(name));
  const dispatchers = [
    createDispatcherTool({
      name: "tabulaflow_source",
      title: "Use TabulaFlow Source",
      description: "Request local Source interactions or use signed-in cloud files through one stable Source dispatcher.",
      actions: WEBMCP_DISPATCH_ACTIONS.source,
      toolsByName,
      readOnly: false,
      runtimeHealth,
    }),
    createDispatcherTool({
      name: "tabulaflow_prepare_read",
      title: "Read TabulaFlow Prepare",
      description: "Inspect Prepare data, recipes, semantics, metrics, profiles, values, previews, and dry-runs without changing workspace data.",
      actions: WEBMCP_DISPATCH_ACTIONS.prepareRead,
      toolsByName,
      readOnly: true,
      runtimeHealth,
    }),
    createDispatcherTool({
      name: "tabulaflow_prepare_mutate",
      title: "Change TabulaFlow Prepare",
      description: "Run guarded Prepare selections, filters, recipe mutations, exports, duplication, semantic changes, metrics, and deletion requests.",
      actions: WEBMCP_DISPATCH_ACTIONS.prepareMutate,
      toolsByName,
      readOnly: false,
      runtimeHealth,
    }),
    createDispatcherTool({
      name: "tabulaflow_compose_read",
      title: "Read TabulaFlow Compose",
      description: "Inspect Compose operations, graph state, schemas, previews, quality, validation, semantics, metrics, and connection options.",
      actions: WEBMCP_DISPATCH_ACTIONS.composeRead,
      toolsByName,
      readOnly: true,
      runtimeHealth,
    }),
    createDispatcherTool({
      name: "tabulaflow_compose_mutate",
      title: "Change TabulaFlow Compose",
      description: "Run guarded Compose selection, layout, export, operation, promotion, semantic, metric, and deletion-request actions.",
      actions: WEBMCP_DISPATCH_ACTIONS.composeMutate,
      toolsByName,
      readOnly: false,
      runtimeHealth,
    }),
  ];
  const qualitativeCoding = toolsByName.get("tabulaflow_qualitative_coding");
  const stableTools = [...core, ...dispatchers, qualitativeCoding];
  if (stableTools.some((tool) => !tool)) throw new Error("The stable WebMCP surface references an unavailable handler.");
  return stableTools;
}

export async function registerWebMcpTools(modelContext, tools, signal, {
  onExecutionFailure,
  onExecutionSuccess,
  runtimeHealth = null,
  generation = 0,
  core = false,
} = {}) {
  if (typeof modelContext?.registerTool !== "function") return false;
  for (const tool of tools) {
    if (signal?.aborted) return false;
    await modelContext.registerTool({
      ...tool,
      async execute(input = {}) {
        const requestId = typeof input?.requestId === "string"
          ? input.requestId
          : typeof input?.input?.requestId === "string"
            ? input.input.requestId
            : undefined;
        runtimeHealth?.assertExecutable(generation, {
          core,
          mutation: tool.annotations?.readOnlyHint !== true,
        });
        const normalizedFailure = (cause) => {
          const hadCode = Boolean(cause?.code);
          if (cause && typeof cause === "object") {
            cause.code ??= cause instanceof SyntaxError ? "WEBMCP_EXECUTION_SYNTAX_ERROR" : "WEBMCP_EXECUTION_FAILED";
            cause.phase ??= "handler";
            cause.tool ??= tool.name;
            if (requestId) cause.requestId ??= requestId;
          }
          onExecutionFailure?.(tool.name, cause);
          if (!hadCode || cause instanceof SyntaxError) console.warn(`WebMCP tool execution failed: ${tool.name}`, {
            code: cause?.code ?? "WEBMCP_EXECUTION_FAILED",
            phase: cause?.phase ?? "handler",
          });
          return webMcpErrorForAgent(cause, {
            tool: tool.name,
            phase: cause?.phase ?? "handler",
            requestId,
            generation: runtimeHealth?.snapshot().generation ?? generation,
          });
        };
        try {
          assertWebMcpInput(tool.inputSchema, input);
          const result = await tool.execute(input);
          if (result?.structuredContent && typeof result.structuredContent === "object") {
            result.structuredContent = {
              ...result.structuredContent,
              generation: runtimeHealth?.snapshot().generation ?? generation,
            };
          }
          onExecutionSuccess?.(tool.name);
          return result;
        } catch (cause) {
          throw normalizedFailure(cause);
        }
      },
    }, { signal });
    if (signal?.aborted) return false;
  }
  return true;
}

export function useWebMcpTools(context) {
  const contextRef = useRef(context);
  contextRef.current = context;
  const runtimeHealth = runtimeHealthFor(contextRef);

  useEffect(() => {
    runtimeHealth.setWorkspace(context.state.workspace);
  }, [context.state.workspace, runtimeHealth]);

  useEffect(() => {
    let modelContext;
    try {
      modelContext = document.modelContext;
    } catch {
      return undefined;
    }
    if (typeof modelContext?.registerTool !== "function") return undefined;

    const controller = new AbortController();
    let disposed = false;
    const stableTools = createWebMcpStableTools(contextRef);
    const metrics = measureWebMcpToolset(stableTools);
    try {
      assertWebMcpRegistrationBudget(metrics);
    } catch (cause) {
      runtimeHealth.failRegistration(cause, { generation: 0, metrics });
      console.warn("WebMCP stable tool surface exceeds its registration budget.", { code: cause?.code ?? "WEBMCP_REGISTRATION_FAILED" });
      return undefined;
    }

    runtimeHealth.beginRegistration({
      generation: 1,
      workspace: contextRef.current.state.workspace,
      registeredToolCount: 0,
      expectedToolCount: stableTools.length,
      metrics,
    });

    registerWebMcpTools(modelContext, stableTools, controller.signal, {
      runtimeHealth,
      generation: 1,
    }).then((registered) => {
      if (!registered || disposed) return;
      runtimeHealth.completeRegistration({
        generation: 1,
        workspace: contextRef.current.state.workspace,
        registeredToolCount: stableTools.length,
        expectedToolCount: stableTools.length,
        metrics,
      });
    }).catch((cause) => {
      if (!controller.signal.aborted) {
        controller.abort();
        runtimeHealth.failRegistration(cause, { generation: 1, metrics });
        console.warn("WebMCP stable tool registration failed.", { code: cause?.code ?? "WEBMCP_REGISTRATION_FAILED" });
      }
    });

    return () => {
      disposed = true;
      controller.abort();
      runtimeHealth.markUnavailable();
    };
  }, [runtimeHealth]);
}
