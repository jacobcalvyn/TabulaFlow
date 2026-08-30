export const WEBMCP_CONTRACT_VERSION = "3.2.5";

export const WEBMCP_REGISTRATION_BUDGET = Object.freeze({
  maxToolCount: 48,
  // Keep every active catalog under the measured 32 KiB application-schema ceiling.
  maxSchemaBytes: 32_768,
  maxPropertyCount: 420,
  maxSchemaDepth: 18,
});

const HEALTH_STATES = new Set([
  "unavailable",
  "registering",
  "available",
  "degraded",
  "stale",
  "limit-exceeded",
]);

function encodedLength(value) {
  const serialized = JSON.stringify(value);
  return typeof TextEncoder === "function"
    ? new TextEncoder().encode(serialized).byteLength
    : serialized.length;
}

function schemaShape(value, depth = 0) {
  if (!value || typeof value !== "object") return { properties: 0, depth };
  let properties = 0;
  let maximumDepth = depth;
  if (value.properties && typeof value.properties === "object") {
    properties += Object.keys(value.properties).length;
  }
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    if (!child || typeof child !== "object") continue;
    const nested = schemaShape(child, depth + 1);
    properties += nested.properties;
    maximumDepth = Math.max(maximumDepth, nested.depth);
  }
  return { properties, depth: maximumDepth };
}

function registrationDescriptor(tool) {
  return {
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema,
    annotations: tool.annotations,
  };
}

export function measureWebMcpToolset(tools = []) {
  const descriptors = tools.map(registrationDescriptor);
  const shape = schemaShape(descriptors);
  return {
    toolCount: descriptors.length,
    schemaBytes: encodedLength(descriptors),
    propertyCount: shape.properties,
    schemaDepth: shape.depth,
  };
}

export function assertWebMcpRegistrationBudget(metrics, budget = WEBMCP_REGISTRATION_BUDGET) {
  const exceeded = [];
  if (metrics.toolCount > budget.maxToolCount) exceeded.push("toolCount");
  if (metrics.schemaBytes > budget.maxSchemaBytes) exceeded.push("schemaBytes");
  if (metrics.propertyCount > budget.maxPropertyCount) exceeded.push("propertyCount");
  if (metrics.schemaDepth > budget.maxSchemaDepth) exceeded.push("schemaDepth");
  if (!exceeded.length) return metrics;
  const error = new Error(`WebMCP registration budget exceeded: ${exceeded.join(", ")}.`);
  error.code = "WEBMCP_CONFIGURATION_LIMIT_EXCEEDED";
  error.metrics = metrics;
  error.exceeded = exceeded;
  throw error;
}

export function createWebMcpRuntimeHealth() {
  const failures = new Map();
  const listeners = new Set();
  let state = {
    status: "unavailable",
    workspace: null,
    generation: 0,
    registeredToolCount: 0,
    callableToolCount: 0,
    blockedToolCount: 0,
    expectedToolCount: 0,
    schemaBytes: 0,
    propertyCount: 0,
    schemaDepth: 0,
    degradedTools: [],
    lastRegistrationError: null,
    refreshRequired: false,
  };

  const update = (patch) => {
    const status = patch.status ?? state.status;
    if (!HEALTH_STATES.has(status)) throw new Error(`Unsupported WebMCP runtime health state: ${status}`);
    state = { ...state, ...patch, status };
    for (const listener of listeners) listener(state);
  };

  return {
    beginRegistration({ generation, workspace = null, registeredToolCount = 0, expectedToolCount, metrics }) {
      update({
        status: "registering",
        generation,
        workspace,
        registeredToolCount,
        callableToolCount: registeredToolCount,
        blockedToolCount: Math.max(0, Number(expectedToolCount ?? 0) - registeredToolCount),
        expectedToolCount,
        schemaBytes: metrics?.schemaBytes ?? 0,
        propertyCount: metrics?.propertyCount ?? 0,
        schemaDepth: metrics?.schemaDepth ?? 0,
        lastRegistrationError: null,
        refreshRequired: true,
      });
    },
    completeRegistration({ generation, workspace = state.workspace, registeredToolCount, expectedToolCount, metrics, degraded = false }) {
      update({
        status: degraded || failures.size ? "degraded" : "available",
        generation,
        workspace,
        registeredToolCount,
        callableToolCount: Math.max(0, registeredToolCount - failures.size),
        blockedToolCount: failures.size,
        expectedToolCount,
        schemaBytes: metrics?.schemaBytes ?? state.schemaBytes,
        propertyCount: metrics?.propertyCount ?? state.propertyCount,
        schemaDepth: metrics?.schemaDepth ?? state.schemaDepth,
        degradedTools: [...failures.values()],
        lastRegistrationError: degraded ? state.lastRegistrationError : null,
        refreshRequired: false,
      });
    },
    failRegistration(cause, { generation, metrics, restored = false } = {}) {
      const limitExceeded = cause?.code === "WEBMCP_CONFIGURATION_LIMIT_EXCEEDED"
        || /configuration.*limit|supported limits/i.test(String(cause?.message ?? ""));
      update({
        status: limitExceeded ? "limit-exceeded" : restored ? "degraded" : "stale",
        generation: Number.isInteger(generation) ? generation : state.generation,
        schemaBytes: metrics?.schemaBytes ?? state.schemaBytes,
        propertyCount: metrics?.propertyCount ?? state.propertyCount,
        schemaDepth: metrics?.schemaDepth ?? state.schemaDepth,
        lastRegistrationError: {
          code: cause?.code ?? "WEBMCP_REGISTRATION_FAILED",
          message: limitExceeded ? "WebMCP tool configuration exceeds the supported registration budget." : "WebMCP tool publication failed.",
        },
        callableToolCount: restored ? state.registeredToolCount : 0,
        blockedToolCount: restored ? failures.size : state.expectedToolCount,
        refreshRequired: !restored,
      });
    },
    markUnavailable() {
      update({ status: "unavailable", registeredToolCount: 0, callableToolCount: 0, blockedToolCount: 0, refreshRequired: false });
    },
    setWorkspace(workspace) {
      update({ workspace });
    },
    record(toolName, cause) {
      if (!(cause instanceof SyntaxError) && cause?.code !== "WEBMCP_EXECUTION_SYNTAX_ERROR") return;
      const previous = failures.get(toolName);
      failures.set(toolName, {
        tool: toolName,
        code: "WEBMCP_EXECUTION_SYNTAX_ERROR",
        phase: cause?.phase ?? "handler",
        count: (previous?.count ?? 0) + 1,
        firstSeenAt: previous?.firstSeenAt ?? new Date().toISOString(),
        lastSeenAt: new Date().toISOString(),
      });
      update({ status: "degraded", degradedTools: [...failures.values()], refreshRequired: false });
    },
    clear(toolName) {
      failures.delete(toolName);
      const degradedTools = [...failures.values()];
      update({
        degradedTools,
        status: state.status === "degraded" && !degradedTools.length && !state.lastRegistrationError ? "available" : state.status,
      });
    },
    assertExecutable(generation, { core = false, mutation = false } = {}) {
      if (core && !mutation) return;
      if (state.status === "registering" || state.status === "stale" || state.status === "limit-exceeded") {
        const error = new Error("WebMCP tools are being refreshed. Fetch the current toolset and retry.");
        error.code = "WEBMCP_REFRESH_REQUIRED";
        error.refreshRequired = true;
        throw error;
      }
      if (!core && generation !== state.generation) {
        const error = new Error("This WebMCP tool belongs to a stale registration generation.");
        error.code = "WEBMCP_STALE_GENERATION";
        error.refreshRequired = true;
        throw error;
      }
      if (mutation && state.status !== "available" && state.status !== "degraded") {
        const error = new Error("WebMCP mutations are temporarily unavailable.");
        error.code = "WEBMCP_MUTATION_UNAVAILABLE";
        throw error;
      }
    },
    waitForStableGeneration(afterGeneration, { timeoutMs = 5_000, workspace = null } = {}) {
      const isStable = (candidate) => (
        candidate.generation > afterGeneration
        && (!workspace || candidate.workspace === workspace)
        && ["available", "degraded"].includes(candidate.status)
        && candidate.registeredToolCount === candidate.expectedToolCount
      );
      if (isStable(state)) return Promise.resolve({ ...state });
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          listeners.delete(onUpdate);
          const error = new Error("WebMCP workspace publication did not become stable before the timeout.");
          error.code = "WEBMCP_SNAPSHOT_STALE";
          error.refreshRequired = true;
          reject(error);
        }, timeoutMs);
        const onUpdate = (candidate) => {
          if (!isStable(candidate)) return;
          clearTimeout(timeout);
          listeners.delete(onUpdate);
          resolve({ ...candidate });
        };
        listeners.add(onUpdate);
      });
    },
    snapshot(extra = {}) {
      return {
        ...state,
        degradedTools: [...failures.values()].sort((left, right) => left.tool.localeCompare(right.tool)),
        ...extra,
      };
    },
  };
}
