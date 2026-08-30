import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildRecoveryPlan,
  createWorkerRegistry,
  forgetPrepared,
  rememberActiveFilters,
  rememberActivePrepared,
  rememberLoadedSource,
  rememberPreparedCopy,
} from "./workerRecovery.js";

const REQUEST_TIMEOUT_MS = 120_000;
const LOAD_TIMEOUT_MS = 300_000;
const SESSION_REGISTRY_KEY = Symbol.for("tabulaflow.worker-registry");

function sessionRegistry() {
  if (!globalThis[SESSION_REGISTRY_KEY]) globalThis[SESSION_REGISTRY_KEY] = createWorkerRegistry();
  return globalThis[SESSION_REGISTRY_KEY];
}

function isRecoverableWorkerStateError(error) {
  return error?.code === "SOURCE_REQUIRED"
    || /table with name (?:working_data|source_data) does not exist/i.test(String(error?.message ?? ""));
}

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

export function useDataWorker() {
  const workerRef = useRef(null);
  const pendingRef = useRef(new Map());
  const sequenceRef = useRef(0);
  const generationRef = useRef(0);
  const mountedRef = useRef(false);
  const recoveryRef = useRef(null);
  const recoverHandlerRef = useRef(null);
  const stableStateRef = useRef(null);
  if (stableStateRef.current === null) stableStateRef.current = sessionRegistry();
  globalThis[SESSION_REGISTRY_KEY] = stableStateRef.current;
  const [ready, setReady] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [progress, setProgress] = useState(null);

  const rejectPending = useCallback((error, generation = null) => {
    for (const [requestId, pending] of pendingRef.current.entries()) {
      if (generation !== null && pending.generation !== generation) continue;
      window.clearTimeout(pending.timeoutId);
      pending.signal?.removeEventListener("abort", pending.abortHandler);
      pending.reject(error);
      pendingRef.current.delete(requestId);
    }
  }, []);

  const createWorker = useCallback(() => {
    const generation = ++generationRef.current;
    const worker = new Worker(new URL("./data.worker.js", import.meta.url), { type: "module" });
    workerRef.current = worker;
    worker.addEventListener("message", (event) => {
      if (event.data.kind === "progress") {
        const pending = pendingRef.current.get(event.data.requestId);
        if (pending?.generation === generation) {
          setProgress({ requestId: event.data.requestId, phase: event.data.phase, percent: event.data.percent });
        }
        return;
      }
      const pending = pendingRef.current.get(event.data.requestId);
      if (!pending || pending.generation !== generation) return;
      pendingRef.current.delete(event.data.requestId);
      window.clearTimeout(pending.timeoutId);
      pending.signal?.removeEventListener("abort", pending.abortHandler);
      setProgress((current) => current?.requestId === event.data.requestId ? null : current);
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

  const sendDirect = useCallback((type, payload, { recoverOnTimeout = true, timeoutMs = REQUEST_TIMEOUT_MS, signal = null } = {}) => new Promise((resolve, reject) => {
    const worker = workerRef.current;
    const generation = generationRef.current;
    if (!worker) {
      reject(new DataWorkerError({ code: "WORKER_NOT_READY", message: "Data worker is not ready." }));
      return;
    }
    if (signal?.aborted) {
      reject(new DataWorkerError({ code: "OPERATION_CANCELLED", message: "The data operation was cancelled before it started." }));
      return;
    }
    const requestId = ++sequenceRef.current;
    setProgress({ requestId, phase: "queued", percent: 0 });
    const abortHandler = () => {
      setProgress((current) => current?.requestId === requestId ? { ...current, phase: "cancelling" } : current);
      try {
        worker.postMessage({ kind: "cancel", requestId });
      } catch {
        // Worker recovery owns transport failures; the mutation fence still prevents commit.
      }
    };
    const timeoutId = window.setTimeout(() => {
      const pending = pendingRef.current.get(requestId);
      if (!pending || pending.generation !== generation) return;
      pendingRef.current.delete(requestId);
      pending.signal?.removeEventListener("abort", pending.abortHandler);
      setProgress((current) => current?.requestId === requestId ? null : current);
      const error = new DataWorkerError({
        code: "WORKER_TIMEOUT",
        message: timeoutMs === LOAD_TIMEOUT_MS
          ? "Data loading exceeded the five-minute limit. The worker is being recovered."
          : "Data processing exceeded the two-minute limit. The worker is being recovered.",
      });
      reject(error);
      if (recoverOnTimeout) recoverHandlerRef.current?.(error);
    }, timeoutMs);
    pendingRef.current.set(requestId, { resolve, reject, timeoutId, generation, signal, abortHandler });
    signal?.addEventListener("abort", abortHandler, { once: true });
    try {
      worker.postMessage({ requestId, type, payload });
    } catch (cause) {
      window.clearTimeout(timeoutId);
      pendingRef.current.delete(requestId);
      signal?.removeEventListener("abort", abortHandler);
      setProgress((current) => current?.requestId === requestId ? null : current);
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
      let result = null;
      for (const step of buildRecoveryPlan(stableStateRef.current)) {
        result = await sendDirect(step.type, step.payload, {
          recoverOnTimeout: false,
          timeoutMs: step.timeout === "load" ? LOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS,
        });
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
    const worker = createWorker();
    setReady(false);
    const initialize = async () => {
      let result = null;
      for (const step of buildRecoveryPlan(stableStateRef.current)) {
        result = await sendDirect(step.type, step.payload, {
          recoverOnTimeout: false,
          timeoutMs: step.timeout === "load" ? LOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS,
        });
      }
      return result;
    };
    initialize().then(() => {
      if (mountedRef.current && workerRef.current === worker) setReady(true);
    }).catch(() => {
      if (mountedRef.current && workerRef.current === worker) setReady(false);
    });
    return () => {
      mountedRef.current = false;
      workerRef.current?.terminate();
      workerRef.current = null;
      rejectPending(new DataWorkerError({ code: "WORKER_STOPPED", message: "Data worker was stopped." }));
      setProgress(null);
      setReady(false);
    };
  }, [createWorker, rejectPending, sendDirect]);

  const request = useCallback(async (type, payload, options = {}) => {
    if (recoveryRef.current) await recoveryRef.current;
    const timeoutMs = type === "load-file" || type === "inspect-file" || type === "load-demo" || type === "materialize-compose-prepared" || type === "materialize-rows-prepared" ? LOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
    try {
      return await sendDirect(type, payload, { timeoutMs, signal: options.signal });
    } catch (error) {
      if (!isRecoverableWorkerStateError(error)) throw error;
      await recover(error);
      return sendDirect(type, payload, { recoverOnTimeout: false, timeoutMs, signal: options.signal });
    }
  }, [recover, sendDirect]);

  const rememberStableState = (nextState) => {
    stableStateRef.current = nextState;
    globalThis[SESSION_REGISTRY_KEY] = nextState;
  };

  const loadFile = useCallback(async (file, identifiers = {}, options = {}) => {
    const result = await request("load-file", { file, ...identifiers }, options);
    rememberStableState(rememberLoadedSource(stableStateRef.current, {
      sourceId: result.sourceId,
      origin: "file",
      payload: { file, sourceId: result.sourceId, preparedId: result.preparedId },
      primaryPreparedId: result.preparedId,
      aggregateColumns: result.aggregateColumns,
    }));
    return result;
  }, [request]);
  const inspectFile = useCallback((file, options = {}) => request("inspect-file", { file }, options), [request]);
  const loadDemo = useCallback(async (identifiers = {}) => {
    const result = await request("load-demo", identifiers);
    rememberStableState(rememberLoadedSource(stableStateRef.current, {
      sourceId: result.sourceId,
      origin: "demo",
      payload: { sourceId: result.sourceId, preparedId: result.preparedId },
      primaryPreparedId: result.preparedId,
      aggregateColumns: result.aggregateColumns,
    }));
    return result;
  }, [request]);
  const filter = useCallback(async (filters, aggregateColumns, options = {}) => {
    const result = await request("filter", { filters, aggregateColumns }, options);
    rememberStableState(rememberActiveFilters(stableStateRef.current, filters, result.aggregateColumns));
    return result;
  }, [request]);
  const searchAggregate = useCallback((column, query, filters, options = {}) => request("search-aggregate", { column, query, filters, ...options }), [request]);
  const searchAggregateForAgent = useCallback((column, query, filters, options = {}) => request("search-aggregate-agent", { column, query, filters, ...options }), [request]);
  const resolveAgentValue = useCallback((column, valueRef) => request("resolve-agent-value", { column, valueRef }), [request]);
  const previewPrepared = useCallback((filters, columns, options = {}) => request("prepare-preview", { filters, columns, ...options }), [request]);
  const profileData = useCallback((columns, semanticSchema = []) => request("data-profile", { columns, semanticSchema }), [request]);
  const exportData = useCallback((format, filters, baseName, options = {}) => request("export", { format, filters, baseName }, options), [request]);
  const activatePrepared = useCallback(async (preparedId, filters = {}, aggregateColumns = [], options = {}) => {
    const result = await request("activate-prepared", { preparedId, filters, aggregateColumns }, options);
    rememberStableState(rememberActivePrepared(stableStateRef.current, {
      preparedId,
      recipe: result.recipe,
      filters: result.appliedFilters ?? filters,
      aggregateColumns: result.aggregateColumns,
    }));
    return result;
  }, [request]);
  const registerPreparedCopy = useCallback(async (preparedId, sourcePreparedId, recipe) => {
    const result = await request("register-prepared-copy", { preparedId, sourcePreparedId, recipe });
    rememberStableState(rememberPreparedCopy(stableStateRef.current, {
      preparedId,
      sourcePreparedId,
      recipe,
      sourceId: result.sourceId,
    }));
    return result;
  }, [request]);
  const unregisterPrepared = useCallback(async (preparedId) => {
    const result = await request("unregister-prepared", { preparedId });
    rememberStableState(forgetPrepared(stableStateRef.current, preparedId));
    return result;
  }, [request]);
  const resetWorkspace = useCallback(async () => {
    const result = await request("reset-workspace", {});
    rememberStableState(createWorkerRegistry());
    return result;
  }, [request]);
  const materializeComposePrepared = useCallback(async (graph, nodeId, identifiers, options = {}) => {
    const result = await request("materialize-compose-prepared", { graph, nodeId, identifiers }, options);
    rememberStableState(rememberLoadedSource(stableStateRef.current, {
      sourceId: result.sourceId,
      origin: "compose",
      payload: { graph, nodeId, identifiers },
      primaryPreparedId: result.preparedId,
      aggregateColumns: [],
    }));
    return result;
  }, [request]);
  const materializeRowsPrepared = useCallback(async (rows, filename, identifiers) => {
    const result = await request("materialize-rows-prepared", { rows, filename, identifiers });
    rememberStableState(rememberLoadedSource(stableStateRef.current, {
      sourceId: result.sourceId,
      origin: "rows",
      payload: { rows, filename, identifiers },
      primaryPreparedId: result.preparedId,
      aggregateColumns: [],
    }));
    return result;
  }, [request]);
  const applyRecipe = useCallback(async (recipe, filters = {}, aggregateColumns = [], preparedId = stableStateRef.current.activePreparedId, options = {}) => {
    const result = await request("apply-recipe", { recipe, filters, aggregateColumns, preparedId }, options);
    rememberStableState(rememberActivePrepared(stableStateRef.current, {
      preparedId,
      recipe,
      filters: result.appliedFilters ?? filters,
      aggregateColumns: result.aggregateColumns,
    }));
    return result;
  }, [request]);
  const previewRecipe = useCallback((recipe, stepIndex, options = {}) => request("preview-recipe", { recipe, stepIndex, options }), [request]);
  const previewCompose = useCallback((graph, nodeId, options = {}, requestOptions = {}) => request("compose-preview", { graph, nodeId, options }, requestOptions), [request]);
  const composeNodeQuality = useCallback((graph, nodeId) => request("compose-quality", { graph, nodeId }), [request]);
  const exportCompose = useCallback((graph, nodeId, format, options = {}) => request("compose-export", { graph, nodeId, format }, options), [request]);
  const composeConnectionOptions = useCallback((graph, nodeId) => request("compose-connection-options", { graph, nodeId }), [request]);

  return useMemo(() => ({
    ready,
    recovering,
    progress,
    loadFile,
    inspectFile,
    loadDemo,
    activatePrepared,
    registerPreparedCopy,
    unregisterPrepared,
    resetWorkspace,
    materializeComposePrepared,
    materializeRowsPrepared,
    filter,
    searchAggregate,
    searchAggregateForAgent,
    resolveAgentValue,
    previewPrepared,
    profileData,
    exportData,
    applyRecipe,
    previewRecipe,
    previewCompose,
    composeNodeQuality,
    exportCompose,
    composeConnectionOptions,
  }), [ready, recovering, progress, loadFile, inspectFile, loadDemo, activatePrepared, registerPreparedCopy, unregisterPrepared, resetWorkspace, materializeComposePrepared, materializeRowsPrepared, filter, searchAggregate, searchAggregateForAgent, resolveAgentValue, previewPrepared, profileData, exportData, applyRecipe, previewRecipe, previewCompose, composeNodeQuality, exportCompose, composeConnectionOptions]);
}
