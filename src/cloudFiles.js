async function readJson(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Cloud request failed.");
  return body;
}

export async function getCloudAccount() {
  const response = await fetch("/api/account", { headers: { accept: "application/json" } });
  if (response.status === 404) return { authenticated: false };
  return readJson(response);
}

export async function getCloudFiles() {
  return readJson(await fetch("/api/cloud-files", { headers: { accept: "application/json" } }));
}

export async function uploadCloudFile(file) {
  return readJson(await fetch("/api/cloud-files", {
    method: "POST",
    headers: {
      "content-type": file.type || "application/octet-stream",
      "x-file-name": encodeURIComponent(file.name),
    },
    body: file,
  }));
}

export async function openCloudFile(file) {
  const response = await fetch(`/api/cloud-files/${encodeURIComponent(file.id)}`);
  if (!response.ok) await readJson(response);
  const blob = await response.blob();
  return new File([blob], file.name, {
    type: file.contentType || blob.type || "application/octet-stream",
    lastModified: Date.now(),
  });
}
