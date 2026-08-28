export function nextWorkspaceRevision(currentRevision, { semantic = true } = {}) {
  const current = Math.max(0, Number(currentRevision) || 0);
  return semantic ? current + 1 : current;
}
