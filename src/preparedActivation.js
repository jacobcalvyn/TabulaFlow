export async function activatePreparedForFlow({
  worker,
  graph,
  prepared,
  source,
  filters = {},
  aggregateColumns = [],
}) {
  try {
    return await worker.activatePrepared(prepared.id, filters, aggregateColumns);
  } catch (error) {
    const canMaterializeComposeResult = error?.code === "SOURCE_REQUIRED"
      && source?.location === "compose-result"
      && source?.upstreamNodeId;
    if (!canMaterializeComposeResult) throw error;

    await worker.materializeComposePrepared(graph, source.upstreamNodeId, {
      sourceId: source.id,
      preparedId: prepared.id,
      filename: prepared.name,
    });
    return worker.activatePrepared(prepared.id, filters, aggregateColumns);
  }
}
