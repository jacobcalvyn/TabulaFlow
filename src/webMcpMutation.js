function mutationError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function createWebMcpMutationRunner({ getRevision, maximumEntries = 100 } = {}) {
  if (typeof getRevision !== "function") throw new Error("WebMCP mutation runner requires getRevision.");
  const cache = new Map();
  const operations = new Map();
  let mutationQueue = Promise.resolve();

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
      return cached.response;
    }

    const executionMode = meta?.executionMode === "async" ? "async" : "wait";
    const operationId = `operation-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
    const operation = {
      operationId,
      requestId,
      fingerprint,
      status: "accepted",
      acceptedAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      result: null,
      error: null,
    };
    operations.set(operationId, operation);
    const promise = mutationQueue.then(async () => {
      operation.status = "running";
      operation.startedAt = new Date().toISOString();
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
      return committed;
    }).catch((cause) => {
      operation.status = "failed";
      operation.completedAt = new Date().toISOString();
      operation.error = { code: cause?.code ?? "MUTATION_FAILED", message: cause instanceof Error ? cause.message : "Mutation failed." };
      throw cause;
    });
    mutationQueue = promise.then(() => undefined, () => undefined);
    const response = executionMode === "async"
      ? Promise.resolve({ operationId, requestId, status: "accepted", workspaceRevision: getRevision() })
      : promise;
    cache.set(requestId, { fingerprint, response, promise, operationId });
    if (executionMode === "async") promise.catch(() => undefined);

    try {
      const result = await response;
      while (cache.size > maximumEntries) cache.delete(cache.keys().next().value);
      while (operations.size > maximumEntries * 2) operations.delete(operations.keys().next().value);
      return result;
    } catch (cause) {
      cache.delete(requestId);
      throw cause;
    }
  };

  runWebMcpMutation.getOperationStatus = (operationId) => {
    const operation = operations.get(String(operationId ?? ""));
    if (!operation) throw mutationError(`Mutation operation not found: ${operationId}`, "OPERATION_NOT_FOUND");
    return structuredClone(operation);
  };

  return runWebMcpMutation;
}
