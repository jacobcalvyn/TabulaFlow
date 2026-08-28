function mutationError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function createWebMcpMutationRunner({ getRevision, maximumEntries = 100 } = {}) {
  if (typeof getRevision !== "function") throw new Error("WebMCP mutation runner requires getRevision.");
  const cache = new Map();
  let mutationQueue = Promise.resolve();

  return async function runWebMcpMutation(meta, execute, fingerprint) {
    const requestId = String(meta?.requestId ?? "");
    const expectedRevision = Number(meta?.expectedRevision);
    if (!requestId) throw mutationError("A WebMCP mutation requires requestId.", "REQUEST_ID_REQUIRED");
    if (!fingerprint) throw mutationError("A WebMCP mutation requires an internal fingerprint.", "MUTATION_FINGERPRINT_REQUIRED");

    const cached = cache.get(requestId);
    if (cached) {
      if (cached.fingerprint !== fingerprint) {
        throw mutationError(`The idempotency key ${requestId} was already used for another mutation.`, "IDEMPOTENCY_KEY_REUSED");
      }
      return cached.promise;
    }

    const promise = mutationQueue.then(async () => {
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
      return { ...normalized, workspaceRevision: getRevision() };
    });
    mutationQueue = promise.then(() => undefined, () => undefined);
    cache.set(requestId, { fingerprint, promise });

    try {
      const result = await promise;
      while (cache.size > maximumEntries) cache.delete(cache.keys().next().value);
      return result;
    } catch (cause) {
      cache.delete(requestId);
      throw cause;
    }
  };
}
