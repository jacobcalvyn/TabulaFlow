export const ACTIVITY_ACTORS = Object.freeze(["user", "agent", "system"]);
export const ACTIVITY_ORIGINS = Object.freeze(["ui", "webmcp", "recovery"]);
export const ACTIVITY_STATUSES = Object.freeze(["committed", "pending-confirmation", "failed"]);

const SAFE_SUMMARY_KEYS = new Set([
  "aggregateColumnCount", "columnCount", "enabled", "filterCount", "format",
  "operationKind", "position", "recipeStepCount", "recipeStepType", "rowCount", "targetKind",
]);

function createEventId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `activity-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function sanitizeActivitySummary(summary = {}) {
  return Object.fromEntries(Object.entries(summary).flatMap(([key, value]) => {
    if (!SAFE_SUMMARY_KEYS.has(key)) return [];
    if (key === "position" && value && Number.isFinite(value.x) && Number.isFinite(value.y)) {
      return [[key, { x: value.x, y: value.y }]];
    }
    if (["string", "number", "boolean"].includes(typeof value) || value === null) return [[key, value]];
    return [];
  }));
}

export function createActivityEvent({
  flowId, actor = "user", origin = "ui", action, targetType, targetId, requestId = null,
  status = "committed", workspaceRevision = null, summary = {}, supersedesEventId = null,
  createdAt = new Date().toISOString(),
}) {
  if (!flowId || !action || !targetType || !targetId) throw new Error("Activity event requires flow, action, and target identifiers.");
  if (!ACTIVITY_ACTORS.includes(actor)) throw new Error(`Unsupported activity actor: ${actor}`);
  if (!ACTIVITY_ORIGINS.includes(origin)) throw new Error(`Unsupported activity origin: ${origin}`);
  if (!ACTIVITY_STATUSES.includes(status)) throw new Error(`Unsupported activity status: ${status}`);
  return {
    eventId: createEventId(), flowId, actor, origin, action, targetType, targetId, requestId, status,
    workspaceRevision, summary: sanitizeActivitySummary(summary), supersedesEventId, createdAt,
  };
}

export function findSupersededActivity(events, candidate) {
  if (candidate.actor === "system") return null;
  return events.find((event) => event.flowId === candidate.flowId
    && event.targetType === candidate.targetType
    && event.targetId === candidate.targetId
    && event.actor !== candidate.actor
    && event.status === "committed"
    && ((candidate.action === "recipe_changed"
      && event.action === "recipe_changed"
      && typeof candidate.summary?.enabled === "boolean"
      && typeof event.summary?.enabled === "boolean"
      && candidate.summary.enabled !== event.summary.enabled)
      || (candidate.action === "compose_operation_updated" && event.action === "compose_operation_updated")
      || (candidate.action === "prepared_deleted" && event.action === "prepared_duplicated")
      || (candidate.action === "compose_operation_deleted" && ["compose_operation_created", "compose_operation_updated"].includes(event.action)))) ?? null;
}

export function pageActivityEvents(events, { cursor = 0, limit = 50, targetId = null, actor = null } = {}) {
  const normalizedCursor = Math.max(0, Number(cursor) || 0);
  const normalizedLimit = Math.min(100, Math.max(1, Number(limit) || 50));
  const filtered = events
    .filter((event) => event.sequence > normalizedCursor)
    .filter((event) => !targetId || event.targetId === targetId)
    .filter((event) => !actor || event.actor === actor)
    .sort((left, right) => left.sequence - right.sequence);
  const page = filtered.slice(0, normalizedLimit);
  return { events: page, cursor: page.at(-1)?.sequence ?? normalizedCursor, hasMore: filtered.length > page.length };
}
