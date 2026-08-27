const DATABASE_NAME = "tabulaflow-recipes";
const STORE_NAME = "recipes";
const FLOW_STORE_NAME = "flows";
const SOURCE_HANDLE_STORE_NAME = "source-handles";
const ACTIVE_FLOW_KEY = "active-flow";
const DATABASE_VERSION = 3;
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
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error ?? new Error("Recipe database gagal dibuka.")));
  });
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
