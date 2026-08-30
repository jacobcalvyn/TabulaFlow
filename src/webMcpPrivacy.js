const SAFE_OPERATION_RESULT_KEYS = new Set([
  "ok",
  "status",
  "workspaceRevision",
  "recipeRevision",
  "stepId",
  "preparedId",
  "preparedInputId",
  "createdPreparedId",
  "nodeId",
  "activePreparedId",
  "activeNodeId",
  "selectionChanged",
  "target",
  "targetId",
  "name",
  "filename",
  "format",
  "rowCount",
  "columnCount",
  "pendingConfirmation",
  "confirmed",
]);

export function sanitizeWebMcpError(cause) {
  const code = String(cause?.code ?? "WEBMCP_OPERATION_FAILED");
  const safeMessages = {
    STALE_STATE: "Workspace state changed before the operation could commit.",
    STALE_RECIPE: "Recipe state changed before the operation could commit.",
    OPERATION_CANCELLED: "The operation was cancelled before its commit boundary.",
    OPERATION_INTERRUPTED_BY_RELOAD: "The operation was interrupted by a page reload. Reconcile workspace state before retrying.",
    OPERATION_IN_PROGRESS: "Another workspace mutation is already active.",
    TOO_LATE_TO_CANCEL: "The operation has crossed its commit boundary and can no longer be cancelled.",
    WEBMCP_REFRESH_REQUIRED: "The WebMCP toolset is changing. Fetch capabilities and retry with the current generation.",
    WEBMCP_STALE_GENERATION: "This tool belongs to an inactive WebMCP generation. Fetch the current toolset and retry.",
    WEBMCP_MUTATION_UNAVAILABLE: "WebMCP mutations are temporarily unavailable. Inspect runtime health before retrying.",
    WEBMCP_CONFIGURATION_LIMIT_EXCEEDED: "The WebMCP toolset exceeds the supported registration budget.",
    CONFIRMATION_NOT_FOUND: "The pending confirmation is unavailable or expired.",
    OPERATION_NOT_FOUND: "The requested operation status is unavailable.",
    IDEMPOTENCY_KEY_REUSED: "The idempotency key was already used for another mutation.",
    SOURCE_RELINK_REQUIRED: "The local source must be re-linked by the user before data operations can continue.",
    SOURCE_RESTORE_IN_PROGRESS: "The local source is still being restored. Retry after source restoration finishes.",
    SOURCE_DATA_UNAVAILABLE: "The target data cannot be materialized from its current source dependencies.",
    SOURCE_NOT_UNLINKED: "The source is already linked and does not need a Re-link interaction.",
    FILE_HANDLE_UNAVAILABLE: "The requested local source handle is unavailable.",
    USER_GESTURE_REQUIRED: "The user must complete the requested browser file interaction.",
    WORKER_NOT_READY: "The local data engine is still starting.",
    WEBMCP_SNAPSHOT_STALE: "The host WebMCP snapshot is stale. Fetch the current toolset and retry.",
    WEBMCP_INVALID_INPUT: "The tool input does not match the registered WebMCP schema.",
    INTERACTION_NOT_FOUND: "The requested user interaction is unavailable or expired.",
    WRONG_WORKSPACE: "Open the required TabulaFlow workspace before requesting this action.",
    PREPARED_NOT_ACTIVE: "Open the required prepared dataset before running this action.",
  };
  return {
    code,
    message: safeMessages[code] ?? "The operation failed. Inspect the visible TabulaFlow diagnostics for details.",
  };
}

export function webMcpErrorForAgent(cause, metadata = {}) {
  const safe = sanitizeWebMcpError(cause);
  const error = new Error(safe.message);
  Object.assign(error, {
    code: safe.code,
    phase: metadata.phase ?? cause?.phase ?? "handler",
    tool: metadata.tool ?? cause?.tool,
    ...(metadata.requestId || cause?.requestId ? { requestId: metadata.requestId ?? cause.requestId } : {}),
    ...(cause?.refreshRequired === true ? { refreshRequired: true } : {}),
    ...(cause?.targetId ? { targetId: cause.targetId } : {}),
    ...(cause?.requiredAction ? { requiredAction: cause.requiredAction } : {}),
    ...(cause?.recommendedWorkspace ? { recommendedWorkspace: cause.recommendedWorkspace } : {}),
    ...(typeof cause?.retryable === "boolean" ? { retryable: cause.retryable } : {}),
    ...(Array.isArray(cause?.sourceAssetIds) ? { sourceAssetIds: [...cause.sourceAssetIds] } : {}),
    ...(Array.isArray(cause?.blockedDependencyIds) ? { blockedDependencyIds: [...cause.blockedDependencyIds] } : {}),
    ...(Number.isInteger(metadata.generation) ? { generation: metadata.generation } : {}),
  });
  return error;
}

export function sanitizeWebMcpDiagnostic(diagnostic = {}) {
  return {
    scope: diagnostic.scope ?? "webmcp",
    level: diagnostic.level ?? "error",
    code: diagnostic.code ?? "OPERATIONAL_DIAGNOSTIC",
    ...(diagnostic.stepId ? { stepId: diagnostic.stepId } : {}),
    message: diagnostic.code
      ? "A structured TabulaFlow diagnostic is available for this code."
      : "An operational diagnostic is available in the visible TabulaFlow UI.",
  };
}

export function sanitizeWebMcpOperationResult(result) {
  if (!result || typeof result !== "object") return null;
  return Object.fromEntries(Object.entries(result)
    .filter(([key, value]) => SAFE_OPERATION_RESULT_KEYS.has(key) && (value === null || ["string", "number", "boolean"].includes(typeof value))));
}

export function operationStatusForAgent(operation) {
  const safeResult = sanitizeWebMcpOperationResult(operation.result);
  const artifact = safeResult?.filename
    ? { type: "file", id: null, name: safeResult.filename, format: safeResult.format ?? null }
    : safeResult?.preparedInputId || safeResult?.preparedId
      ? { type: "prepared-dataset", id: safeResult.preparedInputId ?? safeResult.preparedId, name: safeResult.name ?? null }
      : safeResult?.nodeId
        ? { type: "compose-node", id: safeResult.nodeId, name: safeResult.name ?? null }
        : null;
  return {
    operationId: operation.operationId,
    requestId: operation.requestId,
    status: operation.status,
    flowId: operation.flowId ?? null,
    baseRevision: operation.baseRevision ?? null,
    operationClass: operation.operationClass ?? "workspace-writer",
    phase: operation.phase ?? null,
    acceptedAt: operation.acceptedAt ?? null,
    startedAt: operation.startedAt ?? null,
    completedAt: operation.completedAt ?? null,
    cancelRequested: operation.cancelRequested === true,
    target: operation.target ?? null,
    result: safeResult,
    artifact,
    error: operation.error ? sanitizeWebMcpError(operation.error) : null,
  };
}

export function persistedOperationForStorage(operation) {
  return {
    ...operationStatusForAgent(operation),
    fingerprintHash: operation.fingerprintHash,
    executionMode: operation.executionMode,
    writeEpoch: operation.writeEpoch,
  };
}
