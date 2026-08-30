function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function readyState(nodeId, status = "ready") {
  return {
    nodeId,
    executable: true,
    status,
    blockedReason: null,
    requiredAction: null,
    retryable: false,
    sourceAssetIds: [],
    blockedDependencyIds: [],
  };
}

function blockedState(nodeId, code, {
  requiredAction,
  retryable = false,
  sourceAssetIds = [],
  blockedDependencyIds = [],
} = {}) {
  return {
    nodeId,
    executable: false,
    status: "blocked",
    blockedReason: code,
    requiredAction: requiredAction ?? null,
    retryable,
    sourceAssetIds: unique(sourceAssetIds),
    blockedDependencyIds: unique(blockedDependencyIds),
  };
}

function inheritBlockedState(nodeId, dependencyId, state) {
  return {
    ...state,
    nodeId,
    blockedDependencyIds: unique([dependencyId, ...state.blockedDependencyIds]),
  };
}

export function resolveNodeExecutionState(graph, nodeId) {
  const preparedById = new Map((graph?.preparedInputs ?? []).map((item) => [item.id, item]));
  const composeById = new Map((graph?.composeNodes ?? []).map((item) => [item.id, item]));
  const sourceById = new Map((graph?.sourceAssets ?? []).map((item) => [item.id, item]));
  const resolved = new Map();
  const visiting = new Set();

  const resolve = (currentId) => {
    if (resolved.has(currentId)) return resolved.get(currentId);
    if (visiting.has(currentId)) {
      return blockedState(currentId, "SOURCE_DATA_UNAVAILABLE", {
        requiredAction: "inspect-flow",
        blockedDependencyIds: [currentId],
      });
    }
    visiting.add(currentId);

    const prepared = preparedById.get(currentId);
    if (prepared) {
      const source = sourceById.get(prepared.sourceAssetId);
      let state;
      if (!source) {
        state = blockedState(currentId, "SOURCE_DATA_UNAVAILABLE", {
          requiredAction: "inspect-source",
          blockedDependencyIds: [currentId],
        });
      } else if (source.location === "compose-result") {
        if (!source.upstreamNodeId) {
          state = blockedState(currentId, "SOURCE_DATA_UNAVAILABLE", {
            requiredAction: "recreate-prepared-dataset",
            sourceAssetIds: [source.id],
            blockedDependencyIds: [currentId],
          });
        } else {
          const upstream = resolve(source.upstreamNodeId);
          state = upstream.executable
            ? readyState(currentId)
            : inheritBlockedState(currentId, source.upstreamNodeId, upstream);
        }
      } else if (source.status === "restoring") {
        state = blockedState(currentId, "SOURCE_RESTORE_IN_PROGRESS", {
          requiredAction: "wait-for-source-restore",
          retryable: true,
          sourceAssetIds: [source.id],
          blockedDependencyIds: [currentId],
        });
      } else if (source.status === "unlinked") {
        const local = source.location === "local-device";
        state = blockedState(currentId, local ? "SOURCE_RELINK_REQUIRED" : "SOURCE_DATA_UNAVAILABLE", {
          requiredAction: local ? "relink-source" : "reopen-source",
          retryable: true,
          sourceAssetIds: [source.id],
          blockedDependencyIds: [currentId],
        });
      } else if (source.status === "error") {
        state = blockedState(currentId, "SOURCE_DATA_UNAVAILABLE", {
          requiredAction: "rebuild-source",
          retryable: true,
          sourceAssetIds: [source.id],
          blockedDependencyIds: [currentId],
        });
      } else {
        state = readyState(currentId);
      }
      visiting.delete(currentId);
      resolved.set(currentId, state);
      return state;
    }

    const operation = composeById.get(currentId);
    if (operation) {
      let state = readyState(currentId, operation.dataStatus ?? "ready");
      for (const inputId of operation.inputIds ?? []) {
        const inputState = resolve(inputId);
        if (!inputState.executable) {
          state = inheritBlockedState(currentId, inputId, inputState);
          break;
        }
      }
      visiting.delete(currentId);
      resolved.set(currentId, state);
      return state;
    }

    const missing = blockedState(currentId, "SOURCE_DATA_UNAVAILABLE", {
      requiredAction: "inspect-flow",
      blockedDependencyIds: [currentId],
    });
    visiting.delete(currentId);
    resolved.set(currentId, missing);
    return missing;
  };

  return resolve(nodeId);
}

export function assertNodeExecutable(graph, nodeId) {
  const state = resolveNodeExecutionState(graph, nodeId);
  if (state.executable) return state;
  const error = new Error(`Data execution is blocked for ${nodeId}: ${state.blockedReason}.`);
  Object.assign(error, {
    code: state.blockedReason,
    targetId: nodeId,
    requiredAction: state.requiredAction,
    retryable: state.retryable,
    sourceAssetIds: state.sourceAssetIds,
    blockedDependencyIds: state.blockedDependencyIds,
    recommendedWorkspace: state.blockedReason === "SOURCE_RELINK_REQUIRED" ? "source" : undefined,
  });
  throw error;
}
