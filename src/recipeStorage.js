const DATABASE_NAME = "tabulaflow-recipes";
const STORE_NAME = "recipes";
const FLOW_STORE_NAME = "flows";
const SOURCE_HANDLE_STORE_NAME = "source-handles";
const ACTIVITY_STORE_NAME = "activity-events";
const WEBMCP_OPERATION_STORE_NAME = "webmcp-operations";
const ACTIVE_FLOW_KEY = "active-flow";
const DATABASE_VERSION = 5;
const saveQueues = new Map();

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener("upgradeneeded", () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
      if (!request.result.objectStoreNames.contains(FLOW_STORE_NAME)) {
        request.result.createObjectStore(FLOW_STORE_NAME);
      }
      if (!request.result.objectStoreNames.contains(SOURCE_HANDLE_STORE_NAME)) {
        request.result.createObjectStore(SOURCE_HANDLE_STORE_NAME);
      }
      if (!request.result.objectStoreNames.contains(ACTIVITY_STORE_NAME)) {
        const activityStore = request.result.createObjectStore(ACTIVITY_STORE_NAME, { keyPath: "sequence", autoIncrement: true });
        activityStore.createIndex("flowId", "flowId", { unique: false });
        activityStore.createIndex("targetId", "targetId", { unique: false });
      }
      if (!request.result.objectStoreNames.contains(WEBMCP_OPERATION_STORE_NAME)) {
        const operationStore = request.result.createObjectStore(WEBMCP_OPERATION_STORE_NAME, { keyPath: "operationId" });
        operationStore.createIndex("flowId", "flowId", { unique: false });
        operationStore.createIndex("requestId", "requestId", { unique: false });
      }
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error ?? new Error("Recipe database gagal dibuka.")));
  });
}

export async function appendStoredActivity(event, retention = 2000) {
  const database = await openDatabase();
  try {
    const sequence = await new Promise((resolve, reject) => {
      const request = database.transaction(ACTIVITY_STORE_NAME, "readwrite").objectStore(ACTIVITY_STORE_NAME).add(event);
      request.addEventListener("success", () => resolve(Number(request.result)));
      request.addEventListener("error", () => reject(request.error ?? new Error("Activity event could not be saved.")));
    });
    const stored = { ...event, sequence };
    const flowEvents = await new Promise((resolve, reject) => {
      const request = database.transaction(ACTIVITY_STORE_NAME, "readonly").objectStore(ACTIVITY_STORE_NAME).index("flowId").getAll(event.flowId);
      request.addEventListener("success", () => resolve(request.result ?? []));
      request.addEventListener("error", () => reject(request.error ?? new Error("Activity events could not be read.")));
    });
    const expired = flowEvents.sort((left, right) => right.sequence - left.sequence).slice(retention);
    if (expired.length) {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(ACTIVITY_STORE_NAME, "readwrite");
        const store = transaction.objectStore(ACTIVITY_STORE_NAME);
        for (const item of expired) store.delete(item.sequence);
        transaction.addEventListener("complete", () => resolve());
        transaction.addEventListener("error", () => reject(transaction.error ?? new Error("Old activity events could not be pruned.")));
      });
    }
    return stored;
  } finally {
    database.close();
  }
}

export async function loadStoredActivity(flowId) {
  if (!flowId) return [];
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(ACTIVITY_STORE_NAME, "readonly").objectStore(ACTIVITY_STORE_NAME).index("flowId").getAll(flowId);
      request.addEventListener("success", () => resolve((request.result ?? []).sort((left, right) => right.sequence - left.sequence)));
      request.addEventListener("error", () => reject(request.error ?? new Error("Activity events could not be read.")));
    });
  } finally {
    database.close();
  }
}

export async function clearStoredWorkspaceData() {
  await Promise.allSettled([...saveQueues.values()]);
  const database = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const transaction = database.transaction([
        STORE_NAME,
        SOURCE_HANDLE_STORE_NAME,
        ACTIVITY_STORE_NAME,
        WEBMCP_OPERATION_STORE_NAME,
      ], "readwrite");
      transaction.objectStore(STORE_NAME).clear();
      transaction.objectStore(SOURCE_HANDLE_STORE_NAME).clear();
      transaction.objectStore(ACTIVITY_STORE_NAME).clear();
      transaction.objectStore(WEBMCP_OPERATION_STORE_NAME).clear();
      transaction.addEventListener("complete", () => resolve());
      transaction.addEventListener("error", () => reject(transaction.error ?? new Error("Stored workspace data could not be cleared.")));
      transaction.addEventListener("abort", () => reject(transaction.error ?? new Error("Stored workspace reset was aborted.")));
    });
  } finally {
    database.close();
  }
}

async function writeStoredWebMcpOperation(operation) {
  if (!operation?.operationId || !operation?.flowId) return;
  const database = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const request = database.transaction(WEBMCP_OPERATION_STORE_NAME, "readwrite")
        .objectStore(WEBMCP_OPERATION_STORE_NAME)
        .put(structuredClone(operation));
      request.addEventListener("success", () => resolve());
      request.addEventListener("error", () => reject(request.error ?? new Error("WebMCP operation could not be saved.")));
    });
  } finally {
    database.close();
  }
}

export function saveStoredWebMcpOperation(operation) {
  if (!operation?.operationId || !operation?.flowId) return Promise.resolve();
  const queueKey = `webmcp-operation:${operation.operationId}`;
  const previous = saveQueues.get(queueKey) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() => writeStoredWebMcpOperation(operation));
  saveQueues.set(queueKey, next);
  return next.finally(() => {
    if (saveQueues.get(queueKey) === next) saveQueues.delete(queueKey);
  });
}

export async function loadStoredWebMcpOperations(flowId, limit = 200) {
  if (!flowId) return [];
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(WEBMCP_OPERATION_STORE_NAME, "readonly")
        .objectStore(WEBMCP_OPERATION_STORE_NAME)
        .index("flowId")
        .getAll(flowId);
      request.addEventListener("success", () => {
        const records = (request.result ?? [])
          .sort((left, right) => String(right.acceptedAt ?? "").localeCompare(String(left.acceptedAt ?? "")))
          .slice(0, Math.max(1, limit));
        resolve(records);
      });
      request.addEventListener("error", () => reject(request.error ?? new Error("WebMCP operations could not be read.")));
    });
  } finally {
    database.close();
  }
}

export function preparedRecipeStorageKey(preparedId) {
  return `prepared-recipe:${preparedId}`;
}

export function legacyRecipeStorageKey(dataset) {
  return JSON.stringify({ filename: dataset.filename, sourceColumns: dataset.sourceColumns });
}

export function canMigrateLegacyRecipe({ preparedRecipe, legacyRecipe, matchingPreparedCount }) {
  return (!Array.isArray(preparedRecipe) || preparedRecipe.length === 0)
    && Array.isArray(legacyRecipe)
    && legacyRecipe.length > 0
    && matchingPreparedCount === 1;
}

export async function loadStoredRecipe(key) {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key);
      request.addEventListener("success", () => resolve(Array.isArray(request.result?.recipe) ? request.result.recipe : []));
      request.addEventListener("error", () => reject(request.error ?? new Error("Recipe gagal dibaca.")));
    });
  } finally {
    database.close();
  }
}

export async function loadPreparedRecipe(preparedId, dataset, matchingCount) {
  const preparedKey = preparedRecipeStorageKey(preparedId);
  const preparedRecipe = await loadStoredRecipe(preparedKey);
  if (preparedRecipe.length) return { recipe: preparedRecipe, key: preparedKey, migrated: false };
  const legacyKey = legacyRecipeStorageKey(dataset);
  const legacyRecipe = await loadStoredRecipe(legacyKey);
  if (!canMigrateLegacyRecipe({ preparedRecipe, legacyRecipe, matchingPreparedCount: matchingCount })) {
    return { recipe: [], key: preparedKey, migrated: false };
  }
  await saveStoredRecipe(preparedKey, legacyRecipe);
  return { recipe: legacyRecipe, key: preparedKey, migrated: true };
}

async function writeStoredRecipe(key, recipe) {
  const database = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const request = database.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put({
        version: 1,
        updatedAt: new Date().toISOString(),
        recipe,
      }, key);
      request.addEventListener("success", () => resolve());
      request.addEventListener("error", () => reject(request.error ?? new Error("Recipe gagal disimpan.")));
    });
  } finally {
    database.close();
  }
}

export function saveStoredRecipe(key, recipe) {
  const previous = saveQueues.get(key) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() => writeStoredRecipe(key, recipe));
  saveQueues.set(key, next);
  return next.finally(() => {
    if (saveQueues.get(key) === next) saveQueues.delete(key);
  });
}

export async function loadStoredFlow() {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(FLOW_STORE_NAME, "readonly").objectStore(FLOW_STORE_NAME).get(ACTIVE_FLOW_KEY);
      request.addEventListener("success", () => resolve(request.result?.graph ?? null));
      request.addEventListener("error", () => reject(request.error ?? new Error("Flow gagal dibaca.")));
    });
  } finally {
    database.close();
  }
}

async function writeStoredFlow(graph) {
  const database = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const request = database.transaction(FLOW_STORE_NAME, "readwrite").objectStore(FLOW_STORE_NAME).put({
        version: 2,
        updatedAt: new Date().toISOString(),
        graph,
      }, ACTIVE_FLOW_KEY);
      request.addEventListener("success", () => resolve());
      request.addEventListener("error", () => reject(request.error ?? new Error("Flow gagal disimpan.")));
    });
  } finally {
    database.close();
  }
}

export function saveStoredFlow(graph) {
  const queueKey = `flow:${ACTIVE_FLOW_KEY}`;
  const previous = saveQueues.get(queueKey) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() => writeStoredFlow(graph));
  saveQueues.set(queueKey, next);
  return next.finally(() => {
    if (saveQueues.get(queueKey) === next) saveQueues.delete(queueKey);
  });
}

export async function loadStoredSourceHandle(sourceAssetId) {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(SOURCE_HANDLE_STORE_NAME, "readonly")
        .objectStore(SOURCE_HANDLE_STORE_NAME)
        .get(sourceAssetId);
      request.addEventListener("success", () => resolve(request.result?.handle ?? null));
      request.addEventListener("error", () => reject(request.error ?? new Error("Source handle gagal dibaca.")));
    });
  } finally {
    database.close();
  }
}

export async function saveStoredSourceHandle(sourceAssetId, handle) {
  if (!sourceAssetId || !handle) return;
  const database = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const request = database.transaction(SOURCE_HANDLE_STORE_NAME, "readwrite")
        .objectStore(SOURCE_HANDLE_STORE_NAME)
        .put({ handle, updatedAt: new Date().toISOString() }, sourceAssetId);
      request.addEventListener("success", () => resolve());
      request.addEventListener("error", () => reject(request.error ?? new Error("Source handle gagal disimpan.")));
    });
  } finally {
    database.close();
  }
}

export async function deleteStoredSourceHandle(sourceAssetId) {
  if (!sourceAssetId) return;
  const database = await openDatabase();
  try {
    await new Promise((resolve, reject) => {
      const request = database.transaction(SOURCE_HANDLE_STORE_NAME, "readwrite")
        .objectStore(SOURCE_HANDLE_STORE_NAME)
        .delete(sourceAssetId);
      request.addEventListener("success", () => resolve());
      request.addEventListener("error", () => reject(request.error ?? new Error("Source handle gagal dihapus.")));
    });
  } finally {
    database.close();
  }
}
