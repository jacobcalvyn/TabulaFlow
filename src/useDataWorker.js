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

  const sendDirect = useCallback((type, payload, { recoverOnTimeout = true, timeoutMs = REQUEST_TIMEOUT_MS } = {}) => new Promise((resolve, reject) => {
    const worker = workerRef.current;
    const generation = generationRef.current;
    if (!worker) {
      reject(new DataWorkerError({ code: "WORKER_NOT_READY", message: "Data worker is not ready." }));
      return;
    }
    const requestId = ++sequenceRef.current;
    setProgress({ requestId, phase: "queued", percent: 0 });
    const timeoutId = window.setTimeout(() => {
      const pending = pendingRef.current.get(requestId);
      if (!pending || pending.generation !== generation) return;
      pendingRef.current.delete(requestId);
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
    pendingRef.current.set(requestId, { resolve, reject, timeoutId, generation });
    try {
      worker.postMessage({ requestId, type, payload });
    } catch (cause) {
      window.clearTimeout(timeoutId);
      pendingRef.current.delete(requestId);
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

  const request = useCallback(async (type, payload) => {
    if (recoveryRef.current) await recoveryRef.current;
    const timeoutMs = type === "load-file" || type === "inspect-file" || type === "load-demo" || type === "materialize-compose-prepared" ? LOAD_TIMEOUT_MS : REQUEST_TIMEOUT_MS;
    try {
      return await sendDirect(type, payload, { timeoutMs });
    } catch (error) {
      if (!isRecoverableWorkerStateError(error)) throw error;
      await recover(error);
      return sendDirect(type, payload, { recoverOnTimeout: false, timeoutMs });
    }
  }, [recover, sendDirect]);

  const rememberStableState = (nextState) => {
    stableStateRef.current = nextState;
    globalThis[SESSION_REGISTRY_KEY] = nextState;
  };

  const loadFile = useCallback(async (file, identifiers = {}) => {
    const result = await request("load-file", { file, ...identifiers });
    rememberStableState(rememberLoadedSource(stableStateRef.current, {
      sourceId: result.sourceId,
      origin: "file",
      payload: { file, sourceId: result.sourceId, preparedId: result.preparedId },
      primaryPreparedId: result.preparedId,
      aggregateColumns: result.aggregateColumns,
    }));
    return result;
  }, [request]);
  const inspectFile = useCallback((file) => request("inspect-file", { file }), [request]);
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
  const filter = useCallback(async (filters, aggregateColumns) => {
    const result = await request("filter", { filters, aggregateColumns });
    rememberStableState(rememberActiveFilters(stableStateRef.current, filters, result.aggregateColumns));
    return result;
  }, [request]);
  const searchAggregate = useCallback((column, query, filters, options = {}) => request("search-aggregate", { column, query, filters, ...options }), [request]);
  const searchAggregateForAgent = useCallback((column, query, filters, options = {}) => request("search-aggregate-agent", { column, query, filters, ...options }), [request]);
  const resolveAgentValue = useCallback((column, valueRef) => request("resolve-agent-value", { column, valueRef }), [request]);
  const previewPrepared = useCallback((filters, columns, options = {}) => request("prepare-preview", { filters, columns, ...options }), [request]);
  const profileData = useCallback((columns, semanticSchema = []) => request("data-profile", { columns, semanticSchema }), [request]);
  const exportData = useCallback((format, filters, baseName) => request("export", { format, filters, baseName }), [request]);
  const activatePrepared = useCallback(async (preparedId, filters = {}, aggregateColumns = []) => {
    const result = await request("activate-prepared", { preparedId, filters, aggregateColumns });
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
  const materializeComposePrepared = useCallback(async (graph, nodeId, identifiers) => {
    const result = await request("materialize-compose-prepared", { graph, nodeId, identifiers });
    rememberStableState(rememberLoadedSource(stableStateRef.current, {
      sourceId: result.sourceId,
      origin: "compose",
      payload: { graph, nodeId, identifiers },
      primaryPreparedId: result.preparedId,
      aggregateColumns: [],
    }));
    return result;
  }, [request]);
  const applyRecipe = useCallback(async (recipe, filters = {}, aggregateColumns = [], preparedId = stableStateRef.current.activePreparedId) => {
    const result = await request("apply-recipe", { recipe, filters, aggregateColumns, preparedId });
    rememberStableState(rememberActivePrepared(stableStateRef.current, {
      preparedId,
      recipe,
      filters: result.appliedFilters ?? filters,
      aggregateColumns: result.aggregateColumns,
    }));
    return result;
  }, [request]);
  const previewRecipe = useCallback((recipe, stepIndex, options = {}) => request("preview-recipe", { recipe, stepIndex, options }), [request]);
  const previewCompose = useCallback((graph, nodeId, options = {}) => request("compose-preview", { graph, nodeId, options }), [request]);
  const composeNodeQuality = useCallback((graph, nodeId) => request("compose-quality", { graph, nodeId }), [request]);
  const exportCompose = useCallback((graph, nodeId, format) => request("compose-export", { graph, nodeId, format }), [request]);
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
  }), [ready, recovering, progress, loadFile, inspectFile, loadDemo, activatePrepared, registerPreparedCopy, unregisterPrepared, resetWorkspace, materializeComposePrepared, filter, searchAggregate, searchAggregateForAgent, resolveAgentValue, previewPrepared, profileData, exportData, applyRecipe, previewRecipe, previewCompose, composeNodeQuality, exportCompose, composeConnectionOptions]);
}
