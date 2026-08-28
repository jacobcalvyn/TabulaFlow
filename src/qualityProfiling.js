export function qualityProfileBatches(columns = [], batchSize = 40) {
  const normalizedSize = Math.max(1, Math.trunc(Number(batchSize) || 40));
  const batches = [];
  for (let index = 0; index < columns.length; index += normalizedSize) batches.push(columns.slice(index, index + normalizedSize));
  return batches;
}

export function qualityCoverage(profiledColumnCount, totalColumnCount) {
  const profiled = Math.max(0, Number(profiledColumnCount) || 0);
  const total = Math.max(0, Number(totalColumnCount) || 0);
  return {
    profiledColumnCount: profiled,
    totalColumnCount: total,
    complete: profiled === total,
    coverage: profiled === total ? "full" : "partial",
  };
}
