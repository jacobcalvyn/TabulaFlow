function cloneRecipe(recipe = []) {
  return recipe.map((step) => ({ ...step, params: { ...step.params } }));
}

function cloneFilters(filters = {}) {
  return Object.fromEntries(Object.entries(filters).map(([column, selection]) => [column, { ...selection }]));
}

function cloneRegistry(registry) {
  return {
    sources: new Map(registry.sources),
    preparedInputs: new Map(registry.preparedInputs),
    activePreparedId: registry.activePreparedId,
    activeFilters: cloneFilters(registry.activeFilters),
    aggregateColumns: [...(registry.aggregateColumns ?? [])],
  };
}

export function createWorkerRegistry() {
  return {
    sources: new Map(),
    preparedInputs: new Map(),
    activePreparedId: null,
    activeFilters: {},
    aggregateColumns: [],
  };
}

export function rememberLoadedSource(registry, entry) {
  const next = cloneRegistry(registry);
  const existingPrimary = next.preparedInputs.get(entry.primaryPreparedId);
  next.sources.set(entry.sourceId, {
    sourceId: entry.sourceId,
    origin: entry.origin,
    payload: entry.payload,
    primaryPreparedId: entry.primaryPreparedId,
  });
  next.preparedInputs.set(entry.primaryPreparedId, {
    preparedId: entry.primaryPreparedId,
    sourceId: entry.sourceId,
    sourcePreparedId: entry.primaryPreparedId,
    recipe: cloneRecipe(existingPrimary?.recipe),
    kind: entry.origin === "compose" ? "compose" : "primary",
  });
  next.activePreparedId = entry.primaryPreparedId;
  next.activeFilters = {};
  next.aggregateColumns = [...(entry.aggregateColumns ?? [])];
  return next;
}

export function rememberPreparedCopy(registry, entry) {
  const sourcePrepared = registry.preparedInputs.get(entry.sourcePreparedId);
  const sourceId = entry.sourceId ?? sourcePrepared?.sourceId;
  if (!sourceId) return registry;
  const next = cloneRegistry(registry);
  next.preparedInputs.set(entry.preparedId, {
    preparedId: entry.preparedId,
    sourceId,
    sourcePreparedId: entry.sourcePreparedId,
    recipe: cloneRecipe(entry.recipe),
    kind: entry.kind ?? (entry.preparedId === entry.sourcePreparedId ? "primary" : "copy"),
  });
  return next;
}

export function rememberPreparedRecipe(registry, preparedId, recipe) {
  const current = registry.preparedInputs.get(preparedId);
  if (!current) return registry;
  const next = cloneRegistry(registry);
  next.preparedInputs.set(preparedId, { ...current, recipe: cloneRecipe(recipe) });
  next.activePreparedId = preparedId;
  return next;
}

export function rememberActivePrepared(registry, entry) {
  const next = rememberPreparedRecipe(registry, entry.preparedId, entry.recipe ?? registry.preparedInputs.get(entry.preparedId)?.recipe ?? []);
  next.activePreparedId = entry.preparedId;
  next.activeFilters = cloneFilters(entry.filters);
  next.aggregateColumns = [...(entry.aggregateColumns ?? [])];
  return next;
}

export function rememberActiveFilters(registry, filters, aggregateColumns) {
  const next = cloneRegistry(registry);
  next.activeFilters = cloneFilters(filters);
  next.aggregateColumns = [...(aggregateColumns ?? next.aggregateColumns)];
  return next;
}

export function forgetPrepared(registry, preparedId) {
  const current = registry.preparedInputs.get(preparedId);
  if (!current) return registry;
  const next = cloneRegistry(registry);
  next.preparedInputs.delete(preparedId);
  const siblings = [...next.preparedInputs.values()].filter((item) => item.sourceId === current.sourceId);
  const sourceStillUsed = siblings.length > 0;
  if (!sourceStillUsed) {
    next.sources.delete(current.sourceId);
  } else {
    const source = next.sources.get(current.sourceId);
    if (source?.primaryPreparedId === preparedId) {
      const replacement = siblings[0];
      next.sources.set(current.sourceId, {
        ...source,
        primaryPreparedId: replacement.preparedId,
        payload: { ...source.payload, preparedId: replacement.preparedId },
      });
      for (const sibling of siblings) {
        next.preparedInputs.set(sibling.preparedId, {
          ...sibling,
          sourcePreparedId: replacement.preparedId,
          kind: sibling.preparedId === replacement.preparedId ? "primary" : "copy",
        });
      }
    }
  }
  if (next.activePreparedId === preparedId) {
    next.activePreparedId = siblings[0]?.preparedId ?? next.preparedInputs.keys().next().value ?? null;
    next.activeFilters = {};
    next.aggregateColumns = [];
  }
  return next;
}

function loadTimeoutFor(type) {
  return type === "load-file" || type === "load-demo" || type === "materialize-compose-prepared" || type === "initialize"
    ? "load"
    : "request";
}

export function buildRecoveryPlan(registry) {
  const requests = [{ type: "initialize", payload: {}, timeout: "load" }];
  const sources = [...registry.sources.values()];
  for (const source of sources.filter((item) => item.origin !== "compose")) {
    requests.push({
      type: source.origin === "demo" ? "load-demo" : "load-file",
      payload: { ...source.payload, sourceId: source.sourceId, preparedId: source.primaryPreparedId },
      timeout: "load",
    });
  }

  const filePrepared = [...registry.preparedInputs.values()].filter((item) => {
    const source = registry.sources.get(item.sourceId);
    return source && source.origin !== "compose";
  });
  for (const prepared of filePrepared) {
    const source = registry.sources.get(prepared.sourceId);
    requests.push({
      type: "register-prepared-copy",
      payload: {
        preparedId: prepared.preparedId,
        sourcePreparedId: source.primaryPreparedId,
        recipe: cloneRecipe(prepared.recipe),
      },
      timeout: "request",
    });
  }

  for (const source of sources.filter((item) => item.origin === "compose")) {
    requests.push({
      type: "materialize-compose-prepared",
      payload: source.payload,
      timeout: "load",
    });
  }

  const composePrepared = [...registry.preparedInputs.values()].filter((item) => {
    const source = registry.sources.get(item.sourceId);
    return source?.origin === "compose" && item.recipe.length;
  });
  for (const prepared of composePrepared) {
    requests.push({
      type: "register-prepared-copy",
      payload: {
        preparedId: prepared.preparedId,
        sourcePreparedId: prepared.sourcePreparedId,
        recipe: cloneRecipe(prepared.recipe),
      },
      timeout: "request",
    });
  }

  if (registry.activePreparedId && registry.preparedInputs.has(registry.activePreparedId)) {
    requests.push({
      type: "activate-prepared",
      payload: {
        preparedId: registry.activePreparedId,
        filters: cloneFilters(registry.activeFilters),
        aggregateColumns: [...registry.aggregateColumns],
      },
      timeout: "request",
    });
  }

  return requests.map((request) => ({ ...request, timeout: request.timeout ?? loadTimeoutFor(request.type) }));
}
