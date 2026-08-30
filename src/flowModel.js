import { PREPARED_RECIPE_STATUS } from "./preparedRecipeState.js";
import { compileComposeOperation } from "./composeSql.js";
import { applySemanticModelToSchema, createSemanticModel, reconcileSemanticModel } from "./semanticModel.js";
import { normalizeCanvasPosition } from "./composeViewport.js";

export const FLOW_SCHEMA_VERSION = 3;

const CANVAS_NODE_WIDTH = 230;
const CANVAS_NODE_HEIGHT = 104;
const CANVAS_NODE_GAP = 32;
const INITIAL_PREPARED_POSITION = Object.freeze({ x: 40, y: 52 });

function createId(prefix) {
  const value = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${value}`;
}

function cloneRecipe(recipe = [], { newStepIds = false } = {}) {
  return recipe.map((step) => ({
    ...step,
    id: newStepIds ? createId("step") : step.id,
    params: { ...step.params },
  }));
}

function normalizedPosition(position, fallback = INITIAL_PREPARED_POSITION) {
  return normalizeCanvasPosition(position, fallback);
}

function positionsOverlap(left, right) {
  return left.x < right.x + CANVAS_NODE_WIDTH + CANVAS_NODE_GAP
    && left.x + CANVAS_NODE_WIDTH + CANVAS_NODE_GAP > right.x
    && left.y < right.y + CANVAS_NODE_HEIGHT + CANVAS_NODE_GAP
    && left.y + CANVAS_NODE_HEIGHT + CANVAS_NODE_GAP > right.y;
}

function nextAvailablePosition(position, occupied) {
  const origin = normalizedPosition(position);
  let candidate = origin;
  while (occupied.some((item) => positionsOverlap(candidate, item))) {
    candidate = { x: origin.x, y: candidate.y + CANVAS_NODE_HEIGHT + CANVAS_NODE_GAP };
  }
  return candidate;
}

export function schemaFingerprint(columns = []) {
  return columns
    .map((column) => typeof column === "string" ? column : `${column.name}:${column.type ?? ""}`)
    .join("\u001f")
    .toLocaleLowerCase("en-US");
}

function schemaMetadataFingerprint(columns = []) {
  return JSON.stringify(columns.map((column) => ({ name: column.name, type: column.type ?? null, semantic: column.semantic ?? null })));
}

export function createFlowGraph() {
  return {
    schemaVersion: FLOW_SCHEMA_VERSION,
    id: createId("flow"),
    revision: 0,
    workspaceRevision: 0,
    activeNodeId: null,
    sourceAssets: [],
    preparedInputs: [],
    composeNodes: [],
    semanticModels: {},
    metricDefinitions: [],
    codingProjects: [],
    updatedAt: new Date().toISOString(),
  };
}

export function hydrateComposeSchemas(graph) {
  const relations = new Map(graph.preparedInputs
    .filter((node) => Array.isArray(node.schema) && node.schema.length > 0)
    .map((node) => [node.id, { sql: `prepared_${node.id}`, schema: node.schema }]));
  const hydrated = new Map();
  const unresolved = new Set(graph.composeNodes.map((node) => node.id));
  let progressed = true;

  while (unresolved.size && progressed) {
    progressed = false;
    for (const node of graph.composeNodes) {
      if (!unresolved.has(node.id)) continue;
      const inputs = node.inputIds.map((inputId) => relations.get(inputId));
      if (inputs.some((input) => !input)) continue;
      unresolved.delete(node.id);
      progressed = true;
      try {
        const compiled = compileComposeOperation(node.kind, inputs, node.config);
        compiled.schema = applySemanticModelToSchema(compiled.schema, graph.semanticModels?.[node.id]);
        relations.set(node.id, compiled);
        const remainsStale = node.dataStatus === "stale" || node.validationStatus === "needs-validation";
        hydrated.set(node.id, {
          schema: compiled.schema,
          lastValidSchema: compiled.schema,
          validationStatus: remainsStale ? "needs-validation" : "valid",
          dataStatus: remainsStale ? "stale" : "ready",
          validationError: null,
        });
      } catch (error) {
        const lastValidSchema = node.lastValidSchema?.length
          ? node.lastValidSchema
          : node.schema ?? [];
        hydrated.set(node.id, {
          schema: lastValidSchema,
          lastValidSchema,
          validationStatus: "invalid",
          dataStatus: "error",
          validationError: error instanceof Error ? error.message : "Compose schema validation failed.",
        });
      }
    }
  }

  let changed = false;
  const composeNodes = graph.composeNodes.map((node) => {
    const next = hydrated.get(node.id);
    if (!next) return node;
    const currentSignature = schemaMetadataFingerprint(node.schema ?? []);
    const nextSignature = schemaMetadataFingerprint(next.schema);
    const currentLastValidSignature = schemaMetadataFingerprint(node.lastValidSchema ?? []);
    const nextLastValidSignature = schemaMetadataFingerprint(next.lastValidSchema ?? []);
    if (
      currentSignature === nextSignature
      && currentLastValidSignature === nextLastValidSignature
      && node.validationStatus === next.validationStatus
      && node.dataStatus === next.dataStatus
      && (node.validationError ?? null) === next.validationError
    ) return node;
    changed = true;
    return { ...node, ...next };
  });

  return {
    graph: changed ? { ...graph, composeNodes } : graph,
    unresolvedNodeIds: [...unresolved],
  };
}

export function isFlowFileSource(sourceAsset) {
  return ["local-device", "agent-workspace", "cloud-file"].includes(sourceAsset?.location);
}

function fileSourceIdentity(sourceAsset) {
  if (!isFlowFileSource(sourceAsset)) return null;
  if (sourceAsset.location === "agent-workspace") {
    return JSON.stringify([
      sourceAsset.location,
      sourceAsset.name ?? null,
      sourceAsset.size ?? null,
      sourceAsset.contentSha256 ?? null,
      sourceAsset.schemaFingerprint ?? null,
    ]);
  }
  if (sourceAsset.location === "cloud-file" && sourceAsset.cloudFileId) {
    return JSON.stringify([sourceAsset.location, sourceAsset.cloudFileId, sourceAsset.schemaFingerprint ?? null]);
  }
  return JSON.stringify([
    sourceAsset.location,
    sourceAsset.name ?? null,
    sourceAsset.size ?? null,
    sourceAsset.lastModified ?? null,
    sourceAsset.schemaFingerprint ?? null,
  ]);
}

export function findMatchingFileSource(graph, file, sourceColumns, metadata = null) {
  const fingerprint = schemaFingerprint(sourceColumns);
  if (metadata?.kind === "agent" && metadata.contentSha256) {
    return graph.sourceAssets.find((source) => source.location === "agent-workspace"
      && source.name === file.name
      && source.size === file.size
      && source.contentSha256 === metadata.contentSha256
      && source.schemaFingerprint === fingerprint) ?? null;
  }
  if (metadata?.kind === "cloud" && metadata.cloudFileId) {
    return graph.sourceAssets.find((source) => source.location === "cloud-file"
      && source.cloudFileId === metadata.cloudFileId
      && source.schemaFingerprint === fingerprint) ?? null;
  }
  return graph.sourceAssets.find((source) => isFlowFileSource(source)
    && source.location === "local-device"
    && source.name === file.name
    && source.size === file.size
    && source.lastModified === file.lastModified
    && source.schemaFingerprint === fingerprint) ?? null;
}

export function consolidateDuplicateFileSources(graph) {
  const canonicalByIdentity = new Map();
  const sourceIdMap = new Map();
  const sourceAssets = [];

  for (const source of graph.sourceAssets) {
    const identity = fileSourceIdentity(source);
    const canonical = identity ? canonicalByIdentity.get(identity) : null;
    if (!canonical) {
      sourceAssets.push(source);
      if (identity) canonicalByIdentity.set(identity, source);
      continue;
    }
    sourceIdMap.set(source.id, canonical.id);
  }

  if (sourceIdMap.size === 0) return { graph, sourceIdMap };
  return {
    graph: {
      ...graph,
      sourceAssets,
      preparedInputs: graph.preparedInputs.map((prepared) => {
        const sourceAssetId = sourceIdMap.get(prepared.sourceAssetId);
        return sourceAssetId ? { ...prepared, sourceAssetId } : prepared;
      }),
      updatedAt: new Date().toISOString(),
    },
    sourceIdMap,
  };
}

export function createPreparedInput(fileMetadata, dataset, recipe = []) {
  const sourceAssetId = dataset.sourceId ?? createId("source");
  const preparedInputId = dataset.preparedId ?? createId("prepared");
  const sourceAsset = {
    id: sourceAssetId,
    name: dataset.filename,
    size: fileMetadata?.size ?? null,
    lastModified: fileMetadata?.lastModified ?? null,
    location: fileMetadata?.kind === "demo"
      ? "built-in"
      : fileMetadata?.kind === "agent"
        ? "agent-workspace"
        : fileMetadata?.kind === "cloud"
          ? "cloud-file"
          : "local-device",
    contentSha256: fileMetadata?.contentSha256 ?? null,
    cloudFileId: fileMetadata?.cloudFileId ?? null,
    agentUploadId: fileMetadata?.agentUploadId ?? null,
    schemaFingerprint: schemaFingerprint(dataset.sourceColumns),
    sourceColumns: [...dataset.sourceColumns],
    status: "linked",
  };
  const preparedInput = {
    id: preparedInputId,
    sourceAssetId,
    name: dataset.filename.replace(/\.[^.]+$/, "") || "Prepared input",
    recipeVersion: 1,
    recipe: cloneRecipe(recipe),
    recipeStatus: PREPARED_RECIPE_STATUS.APPLIED,
    rowCount: dataset.rowCount ?? null,
    schema: dataset.columns.map((name) => ({ name, type: dataset.columnTypes?.[name] ?? null })),
    position: { ...INITIAL_PREPARED_POSITION },
  };
  const semanticModel = createSemanticModel(preparedInputId, preparedInput.schema);
  preparedInput.schema = applySemanticModelToSchema(preparedInput.schema, semanticModel);
  return { sourceAsset, preparedInput, semanticModel };
}

export function addPreparedInput(graph, sourceAsset, preparedInput) {
  const occupied = [...graph.preparedInputs, ...graph.composeNodes]
    .map((node) => normalizedPosition(node.position));
  const matchingSource = isFlowFileSource(sourceAsset)
    ? graph.sourceAssets.find((source) => fileSourceIdentity(source) === fileSourceIdentity(sourceAsset))
    : null;
  const positionedPreparedInput = {
    ...preparedInput,
    sourceAssetId: matchingSource?.id ?? preparedInput.sourceAssetId,
    position: nextAvailablePosition(preparedInput.position, occupied),
  };
  const semanticModel = reconcileSemanticModel(graph.semanticModels?.[positionedPreparedInput.id], positionedPreparedInput.id, positionedPreparedInput.schema);
  const semanticPreparedInput = { ...positionedPreparedInput, schema: applySemanticModelToSchema(positionedPreparedInput.schema, semanticModel) };
  return {
    ...graph,
    revision: graph.revision + 1,
    activeNodeId: semanticPreparedInput.id,
    sourceAssets: matchingSource ? graph.sourceAssets : [...graph.sourceAssets, sourceAsset],
    preparedInputs: [...graph.preparedInputs, semanticPreparedInput],
    semanticModels: { ...(graph.semanticModels ?? {}), [semanticPreparedInput.id]: semanticModel },
    metricDefinitions: graph.metricDefinitions ?? [],
    updatedAt: new Date().toISOString(),
  };
}

export function repairOverlappingNodePositions(graph) {
  const occupied = [];
  let changed = false;

  const repair = (node, fallback) => {
    const original = node.position;
    const current = normalizedPosition(node.position, fallback);
    const position = nextAvailablePosition(current, occupied);
    occupied.push(position);
    if (position.x === original?.x && position.y === original?.y) return node;
    changed = true;
    return { ...node, position };
  };

  const preparedInputs = graph.preparedInputs.map((node) => repair(node, INITIAL_PREPARED_POSITION));
  const composeNodes = graph.composeNodes.map((node, index) => repair(node, { x: 560, y: 52 + index * (CANVAS_NODE_HEIGHT + CANVAS_NODE_GAP) }));
  return changed ? { ...graph, preparedInputs, composeNodes } : graph;
}

export function autoArrangeNodePositions(graph) {
  const nodes = [...graph.preparedInputs, ...graph.composeNodes];
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const sourceById = new Map(graph.sourceAssets.map((source) => [source.id, source]));
  const depths = new Map();
  const visiting = new Set();

  const parentsOf = (node) => {
    if (Array.isArray(node.inputIds)) return node.inputIds.filter((id) => byId.has(id));
    const upstreamNodeId = sourceById.get(node.sourceAssetId)?.upstreamNodeId;
    return upstreamNodeId && byId.has(upstreamNodeId) ? [upstreamNodeId] : [];
  };

  const depthOf = (node) => {
    if (depths.has(node.id)) return depths.get(node.id);
    if (visiting.has(node.id)) return 0;
    visiting.add(node.id);
    const parents = parentsOf(node);
    const depth = parents.length ? Math.max(...parents.map((id) => depthOf(byId.get(id)))) + 1 : 0;
    visiting.delete(node.id);
    depths.set(node.id, depth);
    return depth;
  };

  const layers = new Map();
  nodes.forEach((node, index) => {
    const depth = depthOf(node);
    if (!layers.has(depth)) layers.set(depth, []);
    layers.get(depth).push({ node, index });
  });

  const maxLayerSize = Math.max(1, ...[...layers.values()].map((layer) => layer.length));
  const positions = new Map();
  for (const [depth, layer] of layers) {
    layer.sort((left, right) => {
      const leftY = normalizedPosition(left.node.position).y;
      const rightY = normalizedPosition(right.node.position).y;
      return leftY - rightY || left.index - right.index;
    });
    const offset = (maxLayerSize - layer.length) * (CANVAS_NODE_HEIGHT + CANVAS_NODE_GAP) / 2;
    layer.forEach(({ node }, index) => positions.set(node.id, {
      x: INITIAL_PREPARED_POSITION.x + depth * 320,
      y: Math.round(INITIAL_PREPARED_POSITION.y + offset + index * (CANVAS_NODE_HEIGHT + CANVAS_NODE_GAP)),
    }));
  }

  const arrange = (node) => ({ ...node, position: positions.get(node.id) ?? normalizedPosition(node.position) });
  return {
    ...graph,
    revision: graph.revision + 1,
    preparedInputs: graph.preparedInputs.map(arrange),
    composeNodes: graph.composeNodes.map(arrange),
    updatedAt: new Date().toISOString(),
  };
}

export function updatePreparedInput(graph, preparedInputId, changes) {
  const current = graph.preparedInputs.find((item) => item.id === preparedInputId);
  const nextSchema = changes.schema ?? current?.schema ?? [];
  const semanticModel = reconcileSemanticModel(graph.semanticModels?.[preparedInputId], preparedInputId, nextSchema);
  return {
    ...graph,
    revision: graph.revision + 1,
    preparedInputs: graph.preparedInputs.map((item) => item.id === preparedInputId
      ? { ...item, ...changes, schema: applySemanticModelToSchema(nextSchema, semanticModel), recipe: changes.recipe ? cloneRecipe(changes.recipe) : item.recipe }
      : item),
    semanticModels: { ...(graph.semanticModels ?? {}), [preparedInputId]: semanticModel },
    metricDefinitions: graph.metricDefinitions ?? [],
    updatedAt: new Date().toISOString(),
  };
}

export function duplicatePreparedInput(graph, preparedInputId) {
  const source = graph.preparedInputs.find((item) => item.id === preparedInputId);
  if (!source) throw new Error("Prepared input tidak ditemukan.");
  const copy = {
    ...source,
    id: createId("prepared"),
    name: `${source.name} copy`,
    recipe: cloneRecipe(source.recipe, { newStepIds: true }),
    schema: source.schema.map((column) => ({ ...column })),
    position: normalizedPosition({ x: source.position.x + 320, y: source.position.y }),
  };
  const sourceModel = reconcileSemanticModel(graph.semanticModels?.[source.id], source.id, source.schema);
  const copyModel = { ...structuredClone(sourceModel), targetId: copy.id, revision: 0 };
  copy.schema = applySemanticModelToSchema(copy.schema, copyModel);
  return {
    graph: {
      ...graph,
      revision: graph.revision + 1,
      activeNodeId: graph.activeNodeId,
      preparedInputs: [...graph.preparedInputs, copy],
      semanticModels: { ...(graph.semanticModels ?? {}), [copy.id]: copyModel },
      metricDefinitions: graph.metricDefinitions ?? [],
      updatedAt: new Date().toISOString(),
    },
    preparedInput: copy,
  };
}

function uniquePreparedName(graph, baseName) {
  const used = new Set(graph.preparedInputs.map((item) => item.name.toLocaleLowerCase("en-US")));
  if (!used.has(baseName.toLocaleLowerCase("en-US"))) return baseName;
  for (let index = 2; ; index += 1) {
    const candidate = `${baseName} ${index}`;
    if (!used.has(candidate.toLocaleLowerCase("en-US"))) return candidate;
  }
}

export function createPreparedFromCompose(graph, composeNodeId) {
  const sourceNode = graph.composeNodes.find((item) => item.id === composeNodeId);
  if (!sourceNode) {
    const preparedNode = graph.preparedInputs.find((item) => item.id === composeNodeId);
    const error = new Error(preparedNode
      ? "Only an operation result can be promoted to a prepared dataset."
      : `Compose node not found: ${composeNodeId}`);
    error.code = preparedNode ? "OPERATION_NODE_REQUIRED" : "COMPOSE_NODE_NOT_FOUND";
    error.actualKind = preparedNode ? "prepared-dataset" : "missing";
    throw error;
  }
  const sourceAssetId = createId("source");
  const preparedInputId = createId("prepared");
  const name = uniquePreparedName(graph, `${sourceNode.name} prepared`);
  const schema = (sourceNode.schema ?? []).map((column) => ({ ...column }));
  const sourceAsset = {
    id: sourceAssetId,
    name,
    size: null,
    lastModified: null,
    location: "compose-result",
    upstreamNodeId: sourceNode.id,
    schemaFingerprint: schemaFingerprint(schema),
    sourceColumns: schema.map((column) => column.name),
    status: "linked",
  };
  const preparedInput = {
    id: preparedInputId,
    sourceAssetId,
    name,
    recipeVersion: 1,
    recipe: [],
    recipeStatus: PREPARED_RECIPE_STATUS.APPLIED,
    rowCount: sourceNode.rowCount ?? null,
    schema,
    position: normalizedPosition({ x: sourceNode.position.x + 320, y: sourceNode.position.y }),
  };
  const semanticModel = createSemanticModel(preparedInputId, schema);
  semanticModel.fields = Object.fromEntries(schema.map((column) => [column.name, { ...semanticModel.fields[column.name], ...(column.semantic ?? {}), provenance: column.semantic?.provenance ?? { kind: "compose-result", nodeId: sourceNode.id, column: column.name } }]));
  preparedInput.schema = applySemanticModelToSchema(schema, semanticModel);
  return {
    graph: {
      ...graph,
      revision: graph.revision + 1,
      activeNodeId: preparedInput.id,
      sourceAssets: [...graph.sourceAssets, sourceAsset],
      preparedInputs: [...graph.preparedInputs, preparedInput],
      semanticModels: { ...(graph.semanticModels ?? {}), [preparedInput.id]: semanticModel },
      metricDefinitions: graph.metricDefinitions ?? [],
      updatedAt: new Date().toISOString(),
    },
    sourceAsset,
    preparedInput,
    sourceNode,
  };
}

export function createPreparedFromGeneratedRows(graph, {
  name,
  schema,
  rowCount,
  codingProjectId,
}) {
  const sourceAssetId = createId("source");
  const preparedInputId = createId("prepared");
  const preparedName = uniquePreparedName(graph, name || "Coding review result");
  const preparedSchema = (schema ?? []).map((column) => ({ ...column }));
  const sourceAsset = {
    id: sourceAssetId,
    name: preparedName,
    size: null,
    lastModified: null,
    location: "coding-result",
    codingProjectId,
    schemaFingerprint: schemaFingerprint(preparedSchema),
    sourceColumns: preparedSchema.map((column) => column.name),
    status: "linked",
  };
  const preparedInput = {
    id: preparedInputId,
    sourceAssetId,
    name: preparedName,
    recipeVersion: 1,
    recipe: [],
    recipeStatus: PREPARED_RECIPE_STATUS.APPLIED,
    rowCount: Math.max(0, Number(rowCount) || 0),
    schema: preparedSchema,
    position: nextAvailablePosition(INITIAL_PREPARED_POSITION, [
      ...graph.preparedInputs.map((item) => item.position),
      ...graph.composeNodes.map((item) => item.position),
    ]),
  };
  const semanticModel = createSemanticModel(preparedInputId, preparedSchema);
  preparedInput.schema = applySemanticModelToSchema(preparedSchema, semanticModel);
  return {
    graph: {
      ...graph,
      revision: graph.revision + 1,
      activeNodeId: graph.activeNodeId,
      sourceAssets: [...graph.sourceAssets, sourceAsset],
      preparedInputs: [...graph.preparedInputs, preparedInput],
      semanticModels: { ...(graph.semanticModels ?? {}), [preparedInput.id]: semanticModel },
      metricDefinitions: graph.metricDefinitions ?? [],
      codingProjects: graph.codingProjects ?? [],
      updatedAt: new Date().toISOString(),
    },
    sourceAsset,
    preparedInput,
  };
}

export function addComposeNode(graph, node) {
  const next = {
    ...node,
    id: node.id ?? createId(node.kind),
    position: normalizedPosition(node.position, { x: 560, y: 80 + graph.composeNodes.length * 120 }),
  };
  const candidate = {
    ...graph,
    revision: graph.revision + 1,
    activeNodeId: next.id,
    composeNodes: [...graph.composeNodes, next],
    updatedAt: new Date().toISOString(),
  };
  validateFlowGraph(candidate);
  return { graph: candidate, node: next };
}

export function updateComposeNode(graph, nodeId, changes) {
  const current = graph.composeNodes.find((node) => node.id === nodeId);
  if (!current) throw new Error("Compose node tidak ditemukan.");
  const nextNode = {
    ...current,
    ...changes,
    id: current.id,
    config: changes.config ? structuredClone(changes.config) : current.config,
    position: changes.position ? normalizedPosition(changes.position, current.position) : current.position,
  };
  const candidate = {
    ...graph,
    revision: graph.revision + 1,
    activeNodeId: nodeId,
    composeNodes: graph.composeNodes.map((node) => node.id === nodeId ? nextNode : node),
    updatedAt: new Date().toISOString(),
  };
  validateFlowGraph(candidate);
  return { graph: candidate, node: nextNode };
}

export function removeComposeNode(graph, nodeId) {
  const current = graph.composeNodes.find((node) => node.id === nodeId);
  if (!current) throw new Error("Compose node tidak ditemukan.");
  const descendants = getDescendants(graph, nodeId);
  if (descendants.length) {
    const error = new Error("Delete downstream operations first.");
    error.code = "COMPOSE_NODE_HAS_DESCENDANTS";
    throw error;
  }
  const composeNodes = graph.composeNodes.filter((node) => node.id !== nodeId);
  const candidate = {
    ...graph,
    revision: graph.revision + 1,
    activeNodeId: graph.activeNodeId === nodeId ? current.inputIds?.[0] ?? graph.preparedInputs[0]?.id ?? null : graph.activeNodeId,
    composeNodes,
    semanticModels: Object.fromEntries(Object.entries(graph.semanticModels ?? {}).filter(([targetId]) => targetId !== nodeId)),
    metricDefinitions: (graph.metricDefinitions ?? []).filter((metric) => metric.targetId !== nodeId),
    updatedAt: new Date().toISOString(),
  };
  validateFlowGraph(candidate);
  return { graph: candidate, node: current };
}

export function removePreparedInput(graph, preparedInputId) {
  const current = graph.preparedInputs.find((node) => node.id === preparedInputId);
  if (!current) throw new Error("Prepared input was not found.");
  const descendants = getDescendants(graph, preparedInputId);
  if (descendants.length) {
    const error = new Error("Delete downstream operations first.");
    error.code = "PREPARED_INPUT_HAS_DESCENDANTS";
    throw error;
  }
  const preparedInputs = graph.preparedInputs.filter((node) => node.id !== preparedInputId);
  const sourceStillUsed = preparedInputs.some((node) => node.sourceAssetId === current.sourceAssetId);
  const sourceAssets = sourceStillUsed
    ? graph.sourceAssets
    : graph.sourceAssets.filter((source) => source.id !== current.sourceAssetId);
  const candidate = {
    ...graph,
    revision: graph.revision + 1,
    activeNodeId: graph.activeNodeId === preparedInputId
      ? preparedInputs[0]?.id ?? graph.composeNodes[0]?.id ?? null
      : graph.activeNodeId,
    sourceAssets,
    preparedInputs,
    semanticModels: Object.fromEntries(Object.entries(graph.semanticModels ?? {}).filter(([targetId]) => targetId !== preparedInputId)),
    metricDefinitions: (graph.metricDefinitions ?? []).filter((metric) => metric.targetId !== preparedInputId),
    codingProjects: (graph.codingProjects ?? [])
      .filter((project) => project.preparedId !== preparedInputId)
      .map((project) => project.materializedPreparedId === preparedInputId
        ? { ...project, materializedPreparedId: null }
        : project),
    updatedAt: new Date().toISOString(),
  };
  validateFlowGraph(candidate);
  return { graph: candidate, preparedInput: current, removedSourceAssetId: sourceStillUsed ? null : current.sourceAssetId };
}

export function updateNodePosition(graph, nodeId, position) {
  const nextPosition = normalizedPosition(position);
  const move = (node) => node.id === nodeId ? { ...node, position: nextPosition } : node;
  if (!graph.preparedInputs.some((node) => node.id === nodeId) && !graph.composeNodes.some((node) => node.id === nodeId)) {
    throw new Error("Flow node tidak ditemukan.");
  }
  return {
    ...graph,
    revision: graph.revision + 1,
    preparedInputs: graph.preparedInputs.map(move),
    composeNodes: graph.composeNodes.map(move),
    updatedAt: new Date().toISOString(),
  };
}

function inputIds(node) {
  return Array.isArray(node.inputIds) ? node.inputIds : [];
}

export function validateFlowGraph(graph) {
  if (!graph || graph.schemaVersion !== FLOW_SCHEMA_VERSION) throw new Error("Versi flow tidak didukung.");
  if (!Array.isArray(graph.codingProjects)) throw new Error("Coding projects must be an array.");
  const allNodes = [...graph.preparedInputs, ...graph.composeNodes];
  const ids = new Set();
  for (const node of allNodes) {
    if (!node?.id || ids.has(node.id)) throw new Error("Flow memiliki ID node yang kosong atau duplikat.");
    ids.add(node.id);
  }
  for (const node of graph.composeNodes) {
    const inputs = inputIds(node);
    const unaryKinds = new Set(["aggregate", "filter-rows", "distinct-rows", "pivot", "unpivot"]);
    const binaryKinds = new Set(["join", "difference"]);
    if (!inputs.length) throw new Error(`Node ${node.name ?? node.id} tidak memiliki input.`);
    for (const inputId of inputs) {
      if (!ids.has(inputId)) throw new Error(`Input ${inputId} tidak tersedia.`);
      if (inputId === node.id) throw new Error("Node tidak dapat menggunakan dirinya sendiri sebagai input.");
    }
    if (unaryKinds.has(node.kind) && inputs.length !== 1) throw new Error(`Node ${node.name ?? node.id} memerlukan tepat satu input.`);
    if (binaryKinds.has(node.kind) && inputs.length !== 2) throw new Error(`Node ${node.name ?? node.id} memerlukan tepat dua input.`);
    if (node.kind === "append" && inputs.length < 2) throw new Error(`Node ${node.name ?? node.id} memerlukan minimal dua input.`);
  }
  const preparedIds = new Set(graph.preparedInputs.map((item) => item.id));
  for (const project of graph.codingProjects) {
    if (!project?.id || !preparedIds.has(project.preparedId)) throw new Error("Coding project refers to an unavailable prepared dataset.");
  }
  const visiting = new Set();
  const visited = new Set();
  const byId = new Map(graph.composeNodes.map((node) => [node.id, node]));
  function visit(id) {
    if (visiting.has(id)) throw new Error("Flow tidak boleh memiliki siklus.");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const inputId of inputIds(byId.get(id))) if (byId.has(inputId)) visit(inputId);
    visiting.delete(id);
    visited.add(id);
  }
  for (const node of graph.composeNodes) visit(node.id);
  return graph;
}

export function getAncestors(graph, nodeId) {
  const byId = new Map(graph.composeNodes.map((node) => [node.id, node]));
  const result = [];
  const seen = new Set();
  function walk(id) {
    if (seen.has(id)) return;
    seen.add(id);
    const node = byId.get(id);
    if (node) for (const inputId of inputIds(node)) walk(inputId);
    result.push(id);
  }
  walk(nodeId);
  return result;
}

export function collectDescendantNodeIds(graph, preparedIds) {
  const ids = new Set();
  for (const preparedId of preparedIds) {
    for (const id of getDescendants(graph, preparedId)) ids.add(id);
  }
  return ids;
}

export function matchingPreparedCount(graph, filename, sourceColumns) {
  const fingerprint = schemaFingerprint(sourceColumns);
  return graph.preparedInputs.filter((prepared) => {
    const source = graph.sourceAssets.find((item) => item.id === prepared.sourceAssetId);
    return source?.name === filename && source.schemaFingerprint === fingerprint;
  }).length;
}

export function getDescendants(graph, nodeId) {
  const result = [];
  const queue = [nodeId];
  const seen = new Set([nodeId]);
  while (queue.length) {
    const current = queue.shift();
    for (const node of graph.composeNodes) {
      if (!inputIds(node).includes(current) || seen.has(node.id)) continue;
      seen.add(node.id);
      result.push(node.id);
      queue.push(node.id);
    }
  }
  return result;
}

export function markSourcesUnlinked(graph) {
  return {
    ...graph,
    sourceAssets: graph.sourceAssets.map((source) => isFlowFileSource(source)
      ? { ...source, status: "restoring" }
      : source),
  };
}

export function removeBuiltInDemoData(graph) {
  const removedSourceIds = new Set(
    graph.sourceAssets
      .filter((source) => source.location === "built-in")
      .map((source) => source.id),
  );
  if (removedSourceIds.size === 0) return graph;

  const removedNodeIds = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const prepared of graph.preparedInputs) {
      if (!removedSourceIds.has(prepared.sourceAssetId) || removedNodeIds.has(prepared.id)) continue;
      removedNodeIds.add(prepared.id);
      changed = true;
    }
    for (const node of graph.composeNodes) {
      if (removedNodeIds.has(node.id) || !inputIds(node).some((id) => removedNodeIds.has(id))) continue;
      removedNodeIds.add(node.id);
      changed = true;
    }
    for (const source of graph.sourceAssets) {
      if (removedSourceIds.has(source.id) || !removedNodeIds.has(source.upstreamNodeId)) continue;
      removedSourceIds.add(source.id);
      changed = true;
    }
  }

  const preparedInputs = graph.preparedInputs.filter((item) => !removedNodeIds.has(item.id));
  const composeNodes = graph.composeNodes.filter((item) => !removedNodeIds.has(item.id));
  const activeNodeId = removedNodeIds.has(graph.activeNodeId)
    ? preparedInputs[0]?.id ?? composeNodes[0]?.id ?? null
    : graph.activeNodeId;

  return {
    ...graph,
    revision: graph.revision + 1,
    activeNodeId,
    sourceAssets: graph.sourceAssets.filter((source) => !removedSourceIds.has(source.id)),
    preparedInputs,
    composeNodes,
    updatedAt: new Date().toISOString(),
  };
}

export function matchesSourceReference(sourceAsset, file, sourceColumns) {
  return sourceAsset.name === file.name
    && sourceAsset.size === file.size
    && (sourceAsset.location !== "local-device" || sourceAsset.lastModified === file.lastModified)
    && sourceAsset.schemaFingerprint === schemaFingerprint(sourceColumns);
}

export function cloneFlowGraph(graph) {
  return structuredClone(graph);
}
