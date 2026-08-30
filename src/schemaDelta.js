export function schemaDelta(before = [], after = []) {
  const beforeByName = new Map(before.map((column) => [column.name, column.type ?? null]));
  const afterByName = new Map(after.map((column) => [column.name, column.type ?? null]));
  const renamed = after.flatMap((column) => {
    const provenance = column.provenance ?? column.semantic?.provenance;
    const sourceName = provenance?.column ?? provenance?.sourceColumn ?? null;
    if (!sourceName || sourceName === column.name) return [];
    return [{
      from: sourceName,
      to: column.name,
      side: provenance.side ?? null,
      type: column.type ?? null,
    }];
  });
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
      renamed: schemaDelta([], after).renamed,
      baseline: "normalized-binary-input",
    };
  }
  if (kind === "append") return { ...schemaDelta(appendBaseline(inputSchemas), after), baseline: "normalized-binary-input" };
  return { ...schemaDelta(inputSchemas[0] ?? [], after), baseline: "primary-input" };
}
