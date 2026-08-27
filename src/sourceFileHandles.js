const FILE_PICKER_TYPES = [{
  description: "TabulaFlow data files",
  accept: {
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
    "application/vnd.ms-excel": [".xls"],
    "text/csv": [".csv"],
    "application/json": [".json", ".jsonl", ".ndjson"],
  },
}];

export function supportsFileSystemAccess() {
  return typeof window !== "undefined" && typeof window.showOpenFilePicker === "function";
}

export async function pickSourceFile() {
  if (!supportsFileSystemAccess()) return { supported: false, selection: null };
  try {
    const [handle] = await window.showOpenFilePicker({
      multiple: false,
      excludeAcceptAllOption: false,
      types: FILE_PICKER_TYPES,
    });
    if (!handle) return { supported: true, selection: null };
    return { supported: true, selection: { file: await handle.getFile(), handle } };
  } catch (error) {
    if (error?.name === "AbortError") return { supported: true, selection: null };
    throw error;
  }
}

export async function fileFromDroppedItem(item) {
  if (typeof item?.getAsFileSystemHandle !== "function") return null;
  try {
    const handle = await item.getAsFileSystemHandle();
    if (handle?.kind !== "file") return null;
    return { file: await handle.getFile(), handle };
  } catch {
    return null;
  }
}

export async function restoreFileFromHandle(handle) {
  if (!handle || handle.kind !== "file" || typeof handle.getFile !== "function") {
    return { status: "missing", file: null };
  }
  try {
    if (typeof handle.queryPermission === "function") {
      const permission = await handle.queryPermission({ mode: "read" });
      if (permission !== "granted") return { status: "permission-required", file: null };
    }
    return { status: "ready", file: await handle.getFile() };
  } catch (error) {
    return { status: "unavailable", file: null, error };
  }
}
