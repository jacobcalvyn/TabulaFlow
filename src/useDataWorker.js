import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const REQUEST_TIMEOUT_MS = 120_000;

export class DataWorkerError extends Error {
  constructor(details) {
    const normalized = typeof details === "string" ? { message: details } : details ?? {};
    super(normalized.message || "Data worker operation failed.");
    this.name = "DataWorkerError";
    this.code = normalized.code ?? "WORKER_OPERATION_FAILED";
    this.stepIndex = Number.isInteger(normalized.stepIndex) ? normalized.stepIndex : null;
    this.stepId = normalized.stepId ?? null;
  }
}

function cloneFilters(filters = {}) {
  return Object.fromEntries(Object.entries(filters).map(([column, selection]) => [column, { ...selection }]));
}

export function useDataWorker() {
  const workerRef = useRef(null);
  const pendingRef = useRef(new Map());
  const sequenceRef = useRef(0);
  const generationRef = useRef(0);
  const mountedRef = useRef(false);
  const recoveryRef = useRef(null);
  const recoverHandlerRef = useRef(null);
  const stableStateRef = useRef({ source: null, recipe: [], filters: {}, aggregateColumns: [] });
  const [ready, setReady] = useState(false);
  const [recovering, setRecovering] = useState(false);

  const rejectPending = useCallback((error, generation = null) => {
    for (const [requestId, pending] of pendingRef.current.entries()) {
      if (generation !== null && pending.generation !== generation) continue;
      window.clearTimeout(pending.timeoutId);
      pending.reject(error);
      pendingRef.current.delete(requestId);
    }
  }, []);

  const createWorker = useCallback(() => {
    const generation = ++generationRef.current;
    const worker = new Worker(new URL("./data.worker.js", import.meta.url), { type: "module" });
    workerRef.current = worker;
    worker.addEventListener("message", (event) => {
      const pending = pendingRef.current.get(event.data.requestId);
      if (!pending || pending.generation !== generation) return;
      pendingRef.current.delete(event.data.requestId);
      window.clearTimeout(pending.timeoutId);
      if (event.data.ok) pending.resolve(event.data.result);
      else pending.reject(new DataWorkerError(event.data.error));
    });
    worker.addEventListener("error", () => {
      if (generation !== generationRef.current || !mountedRef.current) return;
      recoverHandlerRef.current?.(new DataWorkerError({
        code: "WORKER_CRASHED",
        message: "Data worker stopped unexpectedly.",
      }));
    });
    return worker;
  }, []);

  const sendDirect = useCallback((type, payload, { recoverOnTimeout = true } = {}) => new Promise((resolve, reject) => {
    const worker = workerRef.current;
    const generation = generationRef.current;
    if (!worker) {
      reject(new DataWorkerError({ code: "WORKER_NOT_READY", message: "Data worker is not ready." }));
      return;
    }
    const requestId = ++sequenceRef.current;
    const timeoutId = window.setTimeout(() => {
      const pending = pendingRef.current.get(requestId);
      if (!pending || pending.generation !== generation) return;
      pendingRef.current.delete(requestId);
      const error = new DataWorkerError({
        code: "WORKER_TIMEOUT",
        message: "Data processing exceeded the two-minute limit. The worker is being recovered.",
      });
      reject(error);
      if (recoverOnTimeout) recoverHandlerRef.current?.(error);
    }, REQUEST_TIMEOUT_MS);
    pendingRef.current.set(requestId, { resolve, reject, timeoutId, generation });
    try {
      worker.postMessage({ requestId, type, payload });
    } catch (cause) {
      window.clearTimeout(timeoutId);
      pendingRef.current.delete(requestId);
      reject(cause instanceof Error ? cause : new DataWorkerError({ message: "Data worker request could not be sent." }));
    }
  }), []);

  const recover = useCallback((reason) => {
    if (recoveryRef.current) return recoveryRef.current;
    setReady(false);
    setRecovering(true);
    const failedGeneration = generationRef.current;
    rejectPending(reason, failedGeneration);
    workerRef.current?.terminate();
    workerRef.current = null;
    const recovery = (async () => {
      createWorker();
      const stable = stableStateRef.current;
      if (!stable.source) return null;
      let result = await sendDirect(stable.source.type, stable.source.payload, { recoverOnTimeout: false });
      if (stable.recipe.length) {
        result = await sendDirect("apply-recipe", {
          recipe: stable.recipe,
          filters: stable.filters,
          aggregateColumns: stable.aggregateColumns,
        }, { recoverOnTimeout: false });
      } else if (Object.keys(stable.filters).length || stable.aggregateColumns.length) {
        result = await sendDirect("filter", {
          filters: stable.filters,
          aggregateColumns: stable.aggregateColumns,
        }, { recoverOnTimeout: false });
      }
      return result;
    })();
    recoveryRef.current = recovery;
    recovery.then(() => {
      if (mountedRef.current) setReady(true);
    }).catch(() => {
      workerRef.current?.terminate();
      workerRef.current = null;
    }).finally(() => {
      recoveryRef.current = null;
      if (mountedRef.current) setRecovering(false);
    });
    return recovery;
  }, [createWorker, rejectPending, sendDirect]);

  recoverHandlerRef.current = recover;

  useEffect(() => {
    mountedRef.current = true;
    createWorker();
    setReady(true);
    return () => {
      mountedRef.current = false;
      workerRef.current?.terminate();
      workerRef.current = null;
      rejectPending(new DataWorkerError({ code: "WORKER_STOPPED", message: "Data worker was stopped." }));
      setReady(false);
    };
  }, [createWorker, rejectPending]);

  const request = useCallback(async (type, payload) => {
    if (recoveryRef.current) await recoveryRef.current;
    return sendDirect(type, payload);
  }, [sendDirect]);

  const loadFile = useCallback(async (file) => {
    const result = await request("load-file", { file });
    stableStateRef.current = { source: { type: "load-file", payload: { file } }, recipe: [], filters: {}, aggregateColumns: result.aggregateColumns };
    return result;
  }, [request]);
  const loadDemo = useCallback(async () => {
    const result = await request("load-demo");
    stableStateRef.current = { source: { type: "load-demo", payload: {} }, recipe: [], filters: {}, aggregateColumns: result.aggregateColumns };
    return result;
  }, [request]);
  const filter = useCallback(async (filters, aggregateColumns) => {
    const result = await request("filter", { filters, aggregateColumns });
    stableStateRef.current = { ...stableStateRef.current, filters: cloneFilters(filters), aggregateColumns: [...result.aggregateColumns] };
    return result;
  }, [request]);
  const searchAggregate = useCallback((column, query, filters) => request("search-aggregate", { column, query, filters }), [request]);
  const exportData = useCallback((format, filters) => request("export", { format, filters }), [request]);
  const applyRecipe = useCallback(async (recipe, filters = {}, aggregateColumns = []) => {
    const result = await request("apply-recipe", { recipe, filters, aggregateColumns });
    stableStateRef.current = {
      ...stableStateRef.current,
      recipe: recipe.map((step) => ({ ...step, params: { ...step.params } })),
      filters: cloneFilters(result.appliedFilters ?? filters),
      aggregateColumns: [...result.aggregateColumns],
    };
    return result;
  }, [request]);
  const previewRecipe = useCallback((recipe, stepIndex) => request("preview-recipe", { recipe, stepIndex }), [request]);

  return useMemo(() => ({
    ready,
    recovering,
    loadFile,
    loadDemo,
    filter,
    searchAggregate,
    exportData,
    applyRecipe,
    previewRecipe,
  }), [ready, recovering, loadFile, loadDemo, filter, searchAggregate, exportData, applyRecipe, previewRecipe]);
}
