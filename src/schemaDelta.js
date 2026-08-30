function provenanceRenames(after = [], beforeByName = null) {
  return after.flatMap((column) => {
    const provenance = column.provenance ?? column.semantic?.provenance;
    const sourceName = provenance?.column ?? provenance?.sourceColumn ?? null;
    if (!sourceName || sourceName === column.name || (beforeByName && !beforeByName.has(sourceName))) return [];
    return [{
      from: sourceName,
      to: column.name,
      side: provenance.side ?? null,
      type: column.type ?? null,
    }];
  });
}

export function schemaDelta(before = [], after = []) {
  const beforeByName = new Map(before.map((column) => [column.name, column.type ?? null]));
  const afterByName = new Map(after.map((column) => [column.name, column.type ?? null]));
  const renamed = provenanceRenames(after, beforeByName);
  return {
    added: after.filter((column) => !beforeByName.has(column.name)).map((column) => ({ name: column.name, type: column.type ?? null })),
    removed: before.filter((column) => !afterByName.has(column.name)).map((column) => ({ name: column.name, type: column.type ?? null })),
    typeChanged: after.flatMap((column) => {
      if (!beforeByName.has(column.name) || beforeByName.get(column.name) === (column.type ?? null)) return [];
      return [{ name: column.name, before: beforeByName.get(column.name), after: column.type ?? null }];
    }),
    renamed,
  };
}

function appendBaseline(inputSchemas = []) {
  const seen = new Set();
  return inputSchemas.flatMap((schema) => schema).filter((column) => {
    const key = String(column.name).toLocaleLowerCase("en-US");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function composeSchemaDelta(kind, inputSchemas = [], after = []) {
  if (kind === "join") {
    const baseline = after.filter((column) => {
      const provenance = column.provenance ?? column.semantic?.provenance;
      return provenance?.kind === "join";
    }).map((column) => ({ name: column.name, type: column.type ?? null }));
    const delta = schemaDelta(baseline, after);
    return {
      ...delta,
      renamed: provenanceRenames(after),
      baseline: "normalized-binary-input",
    };
  }
  if (kind === "append") return { ...schemaDelta(appendBaseline(inputSchemas), after), baseline: "normalized-binary-input" };
  return { ...schemaDelta(inputSchemas[0] ?? [], after), baseline: "primary-input" };
}

const SCHEMA_DELTA_KINDS = Object.freeze(["added", "removed", "typeChanged", "renamed"]);
const SCHEMA_DELTA_CURSOR_PREFIX = "schema-delta:";
const SCHEMA_DELTA_PAGE_ITEM_BYTE_BUDGET = 14_000;

function schemaDeltaEntries(delta = {}) {
  return SCHEMA_DELTA_KINDS.flatMap((kind) => (
    Array.isArray(delta[kind])
      ? delta[kind].map((change) => ({ kind, ...change }))
      : []
  ));
}

function schemaDeltaOffset(cursor) {
  if (cursor === undefined || cursor === null || cursor === "") return 0;
  const match = String(cursor).match(/^schema-delta:(\d+)$/);
  if (!match) {
    const error = new Error("The schema delta cursor is invalid or expired.");
    error.code = "INVALID_SCHEMA_DELTA_CURSOR";
    throw error;
  }
  return Number(match[1]);
}

function jsonByteLength(value) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/**
 * Convert an internal full schema delta into a bounded agent-facing response.
 * The engine keeps the complete delta; only the WebMCP transport is compacted.
 */
export function compactSchemaDelta(delta = {}, {
  detailLevel = "summary",
  cursor,
  limit = 100,
} = {}) {
  const entries = schemaDeltaEntries(delta);
  const counts = Object.fromEntries(SCHEMA_DELTA_KINDS.map((kind) => [kind, Array.isArray(delta[kind]) ? delta[kind].length : 0]));
  counts.total = entries.length;
  const base = {
    baseline: delta.baseline ?? null,
    detailLevel,
    counts,
  };
  if (detailLevel !== "paged") {
    return {
      ...base,
      truncated: entries.length > 0,
      page: null,
    };
  }

  const offset = schemaDeltaOffset(cursor);
  const boundedLimit = Math.max(1, Math.min(100, Number(limit) || 100));
  const changes = [];
  for (const entry of entries.slice(offset, offset + boundedLimit)) {
    const candidate = [...changes, entry];
    if (changes.length > 0 && jsonByteLength(candidate) > SCHEMA_DELTA_PAGE_ITEM_BYTE_BUDGET) break;
    changes.push(entry);
  }
  const nextOffset = offset + changes.length;
  const hasMore = nextOffset < entries.length;
  return {
    ...base,
    changes,
    truncated: hasMore,
    page: {
      cursor: cursor ?? null,
      nextCursor: hasMore ? `${SCHEMA_DELTA_CURSOR_PREFIX}${nextOffset}` : null,
      limit: boundedLimit,
      returnedCount: changes.length,
      totalCount: entries.length,
      hasMore,
      byteBudget: SCHEMA_DELTA_PAGE_ITEM_BYTE_BUDGET,
    },
  };
}
