export const MAX_AGENT_SCHEMA_PAGE = 100;

function finiteCount(value) {
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

export function composeNodeSummaryForAgent(node, nodeType = node?.kind === "dataset" ? "dataset" : "operation") {
  return {
    id: node.id,
    name: node.name,
    nodeType,
    kind: nodeType === "dataset" ? "dataset" : node.kind,
    inputIds: nodeType === "dataset" ? [] : [...(node.inputIds ?? [])],
    position: node.position ? { x: Number(node.position.x) || 0, y: Number(node.position.y) || 0 } : null,
    status: nodeType === "dataset" ? "ready" : node.dataStatus ?? "ready",
    validationStatus: nodeType === "dataset" ? null : node.validationStatus ?? null,
    rowCount: finiteCount(node.rowCount),
    columnCount: Array.isArray(node.schema) ? node.schema.length : finiteCount(node.columnCount),
  };
}

export function paginateAgentSchema(schema = [], { offset = 0, limit = MAX_AGENT_SCHEMA_PAGE } = {}) {
  const safeOffset = Math.max(0, Number.isInteger(offset) ? offset : 0);
  const safeLimit = Math.min(MAX_AGENT_SCHEMA_PAGE, Math.max(1, Number.isInteger(limit) ? limit : MAX_AGENT_SCHEMA_PAGE));
  const columns = structuredClone(schema.slice(safeOffset, safeOffset + safeLimit));
  return {
    columns,
    offset: safeOffset,
    limit: safeLimit,
    totalColumnCount: schema.length,
    hasMore: safeOffset + columns.length < schema.length,
    nextOffset: safeOffset + columns.length < schema.length ? safeOffset + columns.length : null,
  };
}
