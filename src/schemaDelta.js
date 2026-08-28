export function schemaDelta(before = [], after = []) {
  const beforeByName = new Map(before.map((column) => [column.name, column.type ?? null]));
  const afterByName = new Map(after.map((column) => [column.name, column.type ?? null]));
  return {
    added: after.filter((column) => !beforeByName.has(column.name)).map((column) => ({ name: column.name, type: column.type ?? null })),
    removed: before.filter((column) => !afterByName.has(column.name)).map((column) => ({ name: column.name, type: column.type ?? null })),
    typeChanged: after.flatMap((column) => {
      if (!beforeByName.has(column.name) || beforeByName.get(column.name) === (column.type ?? null)) return [];
      return [{ name: column.name, before: beforeByName.get(column.name), after: column.type ?? null }];
    }),
  };
}
