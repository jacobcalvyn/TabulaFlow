import {
  operationStatusForAgent,
  persistedOperationForStorage,
  sanitizeWebMcpError,
} from "./webMcpPrivacy.js";

function mutationError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function digestFingerprint(value) {
  const bytes = new TextEncoder().encode(String(value));
  let hash = 1469598103934665603n;
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 1099511628211n);
  }
  return `fnv1a64:${hash.toString(16).padStart(16, "0")}`;
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
  let writeEpoch = 0;
  let activeWriterOperationId = null;

  const persist = (operation) => {
    if (typeof persistOperation !== "function" || !operation?.flowId) return;
    Promise.resolve(persistOperation(persistedOperationForStorage(operation))).catch(() => undefined);
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
    const fingerprintHash = digestFingerprint(fingerprint);

    const cached = cache.get(requestId);
    if (cached) {
      if (cached.fingerprintHash !== fingerprintHash) {
        throw mutationError(`The idempotency key ${requestId} was already used for another mutation.`, "IDEMPOTENCY_KEY_REUSED");
      }
      const operation = operations.get(cached.operationId);
      if (operation?.status === "failed") {
        const safeError = sanitizeWebMcpError(operation.error);
        throw mutationError(safeError.message, safeError.code);
      }
      if (operation?.status === "succeeded" || operation?.status === "cancelled") return structuredClone(operation.result);
      if (operation && ["accepted", "running", "cancelling", "committing"].includes(operation.status)) {
        if (cached.executionMode === "wait") return cached.promise;
        return {
          operationId: operation.operationId,
          requestId,
          status: operation.status,
          target: operation.target ?? null,
          workspaceRevision: getRevision(),
        };
      }
      return cached.response;
    }

    const executionMode = meta?.executionMode === "async" ? "async" : "wait";
    const operationId = `operation-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
    const operationClass = ["snapshot-compute", "confirmation-request"].includes(meta?.operationClass)
      ? meta.operationClass
      : "workspace-writer";
    const operation = {
      operationId,
      requestId,
      fingerprintHash,
      flowId: getFlowId(),
      executionMode,
      operationClass,
      target: meta?.target && typeof meta.target === "object"
        ? { type: String(meta.target.type ?? "workspace"), id: meta.target.id == null ? null : String(meta.target.id) }
        : null,
      baseRevision: expectedRevision,
      phase: "queued",
      writeEpoch: null,
      cancelRequested: false,
      status: "accepted",
      acceptedAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      result: null,
      error: null,
    };
    operations.set(operationId, operation);
    persist(operation);
    const executeOperation = async () => {
      if (operation.cancelRequested) throw mutationError("The operation was cancelled before it started.", "OPERATION_CANCELLED");
      if (operationClass !== "confirmation-request") {
        operation.writeEpoch = ++writeEpoch;
        activeWriterOperationId = operation.operationId;
      }
      operation.status = "running";
      operation.phase = "executing";
      operation.startedAt = new Date().toISOString();
      persist(operation);
      const currentRevision = getRevision();
      if (!Number.isInteger(expectedRevision) || expectedRevision !== currentRevision) {
        throw mutationError(`Workspace state is stale. Expected revision ${currentRevision}, received ${meta?.expectedRevision}.`, "STALE_STATE");
      }
      let checkpointCount = 0;
      const assertCurrent = () => {
        if (operation.cancelRequested || (operationClass !== "confirmation-request" && operation.writeEpoch !== writeEpoch)) {
          throw mutationError("The operation was cancelled before its commit boundary.", "OPERATION_CANCELLED");
        }
        const latestRevision = getRevision();
        if (latestRevision !== expectedRevision) {
          throw mutationError(`Workspace state changed while the mutation was running. Expected revision ${expectedRevision}, current revision ${latestRevision}.`, "STALE_STATE");
        }
        checkpointCount += 1;
        if (checkpointCount > 1) {
          operation.status = "committing";
          operation.phase = "committing";
          persist(operation);
        }
      };
      const result = await execute(assertCurrent);
      if (operation.cancelRequested || (operationClass !== "confirmation-request" && operation.writeEpoch !== writeEpoch)) {
        throw mutationError("The operation was cancelled before its commit boundary.", "OPERATION_CANCELLED");
      }
      const normalized = result && typeof result === "object" ? result : { result };
      const succeeded = {
        operationId,
        requestId,
        status: "succeeded",
        target: operation.target,
        ...normalized,
        workspaceRevision: getRevision(),
      };
      operation.status = "succeeded";
      operation.phase = "completed";
      operation.completedAt = new Date().toISOString();
      operation.result = succeeded;
      persist(operation);
      return succeeded;
    };
    const scheduled = operationClass === "confirmation-request"
      ? Promise.resolve().then(executeOperation)
      : mutationQueue.then(executeOperation);
    const promise = scheduled.catch((cause) => {
      operation.status = cause?.code === "OPERATION_CANCELLED" ? "cancelled" : "failed";
      operation.phase = operation.status === "cancelled" ? "cancelled" : "failed";
      operation.completedAt = new Date().toISOString();
      operation.error = operation.status === "cancelled" ? null : sanitizeWebMcpError(cause);
      operation.result = operation.status === "cancelled"
        ? { operationId, requestId, status: "cancelled", workspaceRevision: getRevision() }
        : null;
      persist(operation);
      throw cause;
    }).finally(() => {
      if (activeWriterOperationId === operation.operationId) activeWriterOperationId = null;
    });
    if (operationClass !== "confirmation-request") mutationQueue = promise.then(() => undefined, () => undefined);
    const response = executionMode === "async"
      ? Promise.resolve({ operationId, requestId, status: "accepted", target: operation.target, workspaceRevision: getRevision() })
      : promise;
    cache.set(requestId, { fingerprintHash, response, promise, operationId, executionMode });
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
    return operationStatusForAgent(operation);
  };

  runWebMcpMutation.getActiveOperationIds = () => [...operations.values()]
    .filter((operation) => operation.operationClass !== "confirmation-request")
    .filter((operation) => ["accepted", "running", "cancelling", "committing"].includes(operation.status))
    .map((operation) => operation.operationId);

  runWebMcpMutation.cancelOperation = (operationId) => {
    const operation = operations.get(String(operationId ?? ""));
    if (!operation) throw mutationError(`Mutation operation not found: ${operationId}`, "OPERATION_NOT_FOUND");
    if (["succeeded", "failed", "cancelled"].includes(operation.status)) return operationStatusForAgent(operation);
    if (operation.status === "committing") throw mutationError("The operation has crossed its commit boundary.", "TOO_LATE_TO_CANCEL");
    operation.cancelRequested = true;
    operation.status = "cancelling";
    operation.phase = "cancelling";
    if (activeWriterOperationId === operation.operationId) writeEpoch += 1;
    persist(operation);
    return operationStatusForAgent(operation);
  };

  runWebMcpMutation.fenceMutations = () => {
    const cancellable = [...operations.values()].filter((operation) => (
      operation.operationClass !== "confirmation-request"
      &&
      ["accepted", "running", "cancelling"].includes(operation.status)
    ));
    if (!cancellable.length) return [];
    writeEpoch += 1;
    for (const operation of cancellable) {
      operation.cancelRequested = true;
      operation.status = "cancelling";
      operation.phase = "cancelling";
      persist(operation);
    }
    return cancellable.map((operation) => operation.operationId);
  };

  runWebMcpMutation.setRequestTerminalStatus = (requestId, status, result = {}) => {
    const cached = cache.get(String(requestId ?? ""));
    if (!cached) return false;
    const operation = operations.get(cached.operationId);
    if (!operation || !["cancelled", "succeeded"].includes(status)) return false;
    operation.status = status;
    operation.completedAt = new Date().toISOString();
    operation.result = {
      operationId: operation.operationId,
      requestId: operation.requestId,
      status,
      target: operation.target,
      ...result,
      workspaceRevision: getRevision(),
    };
    operation.error = null;
    persist(operation);
    return true;
  };

  runWebMcpMutation.hydrate = async (records = []) => {
    for (const stored of records.slice(0, maximumEntries * 2)) {
      if (!stored?.operationId || !stored?.requestId || (!stored?.fingerprintHash && !stored?.fingerprint)) continue;
      const operation = structuredClone(stored);
      operation.fingerprintHash ??= digestFingerprint(operation.fingerprint);
      delete operation.fingerprint;
      if (operation.status === "committed") operation.status = "succeeded";
      if (operation.result?.status === "committed") operation.result.status = "succeeded";
      if (["accepted", "running", "cancelling", "committing"].includes(operation.status)) {
        operation.status = "failed";
        operation.phase = "failed";
        operation.completedAt = new Date().toISOString();
        operation.error = {
          code: "OPERATION_INTERRUPTED_BY_RELOAD",
          message: "The WebMCP operation was interrupted by a page reload. Reconcile workspace state before retrying.",
        };
        persist(operation);
      }
      operations.set(operation.operationId, operation);
      cache.set(operation.requestId, {
        fingerprintHash: operation.fingerprintHash,
        operationId: operation.operationId,
        executionMode: operation.executionMode ?? "wait",
        response: operation.result,
        promise: operation.status === "succeeded" || operation.status === "cancelled"
          ? Promise.resolve(structuredClone(operation.result))
          : Promise.reject(mutationError(operation.error?.message ?? "Mutation failed.", operation.error?.code ?? "MUTATION_FAILED")),
      });
      cache.get(operation.requestId).promise.catch(() => undefined);
    }
    evictTerminalEntries();
  };

  return runWebMcpMutation;
}
