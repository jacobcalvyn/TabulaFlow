const DATABASE_NAME = "tabulaflow-recipes";
const STORE_NAME = "recipes";
const DATABASE_VERSION = 1;
const saveQueues = new Map();

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener("upgradeneeded", () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error ?? new Error("Recipe database gagal dibuka.")));
  });
}

export function recipeStorageKey(dataset) {
  return JSON.stringify({ filename: dataset.filename, sourceColumns: dataset.sourceColumns });
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
