export function collectSourceColumns(rows = []) {
  const used = new Set();
  const columns = [];
  for (const row of rows) {
    for (const column of Object.keys(row ?? {})) {
      if (used.has(column)) continue;
      used.add(column);
      columns.push(column);
    }
  }
  return columns;
}
