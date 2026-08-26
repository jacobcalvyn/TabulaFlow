export function reconcileFilters(filters, columns) {
  const availableColumns = new Set(columns);
  const nextFilters = {};
  const removedColumns = [];

  for (const [column, selection] of Object.entries(filters)) {
    if (availableColumns.has(column)) nextFilters[column] = selection;
    else removedColumns.push(column);
  }

  return { filters: nextFilters, removedColumns };
}
