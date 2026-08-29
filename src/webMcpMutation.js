function mutationError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function createWebMcpMutationRunner({
  getRevision,
  getFlowId = () => null,
  persistOperation = null,
  maximumEntries = 100,
} = {}) {
  if (typeof getRevision !== "function") throw new Error("WebMCP mutation runner requires getRevision.");
  const cache = new Map();
  const operations = new Map();
  let mutationQueue = Promise.resolve();

  const persist = (operation) => {
    if (typeof persistOperation !== "function" || !operation?.flowId) return;
    Promise.resolve(persistOperation(structuredClone(operation))).catch(() => undefined);
  };

  const evictTerminalEntries = () => {
    while (cache.size > maximumEntries) cache.delete(cache.keys().next().value);
    while (operations.size > maximumEntries * 2) operations.delete(operations.keys().next().value);
  };

  const runWebMcpMutation = async function runWebMcpMutation(meta, execute, fingerprint) {
    const requestId = String(meta?.requestId ?? "");
    const expectedRevision = Number(meta?.expectedRevision);
    if (!requestId) throw mutationError("A WebMCP mutation requires requestId.", "REQUEST_ID_REQUIRED");
    if (!fingerprint) throw mutationError("A WebMCP mutation requires an internal fingerprint.", "MUTATION_FINGERPRINT_REQUIRED");

    const cached = cache.get(requestId);
    if (cached) {
      if (cached.fingerprint !== fingerprint) {
        throw mutationError(`The idempotency key ${requestId} was already used for another mutation.`, "IDEMPOTENCY_KEY_REUSED");
      }
      const operation = operations.get(cached.operationId);
      if (operation?.status === "failed") {
        throw mutationError(operation.error?.message ?? "Mutation failed.", operation.error?.code ?? "MUTATION_FAILED");
      }
      if (operation?.status === "committed" || operation?.status === "cancelled") return structuredClone(operation.result);
      if (operation && (operation.status === "accepted" || operation.status === "running")) {
        if (cached.executionMode === "wait") return cached.promise;
        return { operationId: operation.operationId, requestId, status: operation.status, workspaceRevision: getRevision() };
      }
      return cached.response;
    }

    const executionMode = meta?.executionMode === "async" ? "async" : "wait";
    const operationId = `operation-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
    const operation = {
      operationId,
      requestId,
      fingerprint,
      flowId: getFlowId(),
      executionMode,
      status: "accepted",
      acceptedAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      result: null,
      error: null,
    };
    operations.set(operationId, operation);
    persist(operation);
    const promise = mutationQueue.then(async () => {
      operation.status = "running";
      operation.startedAt = new Date().toISOString();
      persist(operation);
      const currentRevision = getRevision();
      if (!Number.isInteger(expectedRevision) || expectedRevision !== currentRevision) {
        throw mutationError(`Workspace state is stale. Expected revision ${currentRevision}, received ${meta?.expectedRevision}.`, "STALE_STATE");
      }
      const assertCurrent = () => {
        const latestRevision = getRevision();
        if (latestRevision !== expectedRevision) {
          throw mutationError(`Workspace state changed while the mutation was running. Expected revision ${expectedRevision}, current revision ${latestRevision}.`, "STALE_STATE");
        }
      };
      const result = await execute(assertCurrent);
      const normalized = result && typeof result === "object" ? result : { result };
      const committed = { ...normalized, workspaceRevision: getRevision() };
      operation.status = "committed";
      operation.completedAt = new Date().toISOString();
      operation.result = committed;
      persist(operation);
      return committed;
    }).catch((cause) => {
      operation.status = "failed";
      operation.completedAt = new Date().toISOString();
      operation.error = { code: cause?.code ?? "MUTATION_FAILED", message: cause instanceof Error ? cause.message : "Mutation failed." };
      persist(operation);
      throw cause;
    });
    mutationQueue = promise.then(() => undefined, () => undefined);
    const response = executionMode === "async"
      ? Promise.resolve({ operationId, requestId, status: "accepted", workspaceRevision: getRevision() })
      : promise;
    cache.set(requestId, { fingerprint, response, promise, operationId, executionMode });
    promise.then(evictTerminalEntries, evictTerminalEntries);
    if (executionMode === "async") promise.catch(() => undefined);

    try {
      const result = await response;
      return result;
    } catch (cause) {
      throw cause;
    }
  };

  runWebMcpMutation.getOperationStatus = (operationId) => {
    const operation = operations.get(String(operationId ?? ""));
    if (!operation) throw mutationError(`Mutation operation not found: ${operationId}`, "OPERATION_NOT_FOUND");
    return structuredClone(operation);
  };

  runWebMcpMutation.setRequestTerminalStatus = (requestId, status, result = {}) => {
    const cached = cache.get(String(requestId ?? ""));
    if (!cached) return false;
    const operation = operations.get(cached.operationId);
    if (!operation || !["cancelled", "committed"].includes(status)) return false;
    operation.status = status;
    operation.completedAt = new Date().toISOString();
    operation.result = { ...result, requestId: operation.requestId, status };
    operation.error = null;
    persist(operation);
    return true;
  };

  runWebMcpMutation.hydrate = (records = []) => {
    for (const stored of records.slice(0, maximumEntries * 2)) {
      if (!stored?.operationId || !stored?.requestId || !stored?.fingerprint) continue;
      const operation = structuredClone(stored);
      if (operation.status === "accepted" || operation.status === "running") {
        operation.status = "failed";
        operation.completedAt = new Date().toISOString();
        operation.error = {
          code: "OPERATION_INTERRUPTED_BY_RELOAD",
          message: "The WebMCP operation was interrupted by a page reload. Reconcile workspace state before retrying.",
        };
        persist(operation);
      }
      operations.set(operation.operationId, operation);
      cache.set(operation.requestId, {
        fingerprint: operation.fingerprint,
        operationId: operation.operationId,
        executionMode: operation.executionMode ?? "wait",
        response: operation.result,
        promise: operation.status === "committed" || operation.status === "cancelled"
          ? Promise.resolve(structuredClone(operation.result))
          : Promise.reject(mutationError(operation.error?.message ?? "Mutation failed.", operation.error?.code ?? "MUTATION_FAILED")),
      });
      cache.get(operation.requestId).promise.catch(() => undefined);
    }
    evictTerminalEntries();
  };

  return runWebMcpMutation;
}
