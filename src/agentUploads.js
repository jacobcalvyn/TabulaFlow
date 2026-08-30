const CREDENTIAL_PREFIX = "tabulaflow-agent-upload:";

function apiError(body, fallback) {
  const error = new Error(body?.error || fallback);
  error.code = body?.code || "AGENT_UPLOAD_FAILED";
  return error;
}

async function readJson(response, fallback = "Agent upload request failed.") {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw apiError(body, fallback);
  return body;
}

function credentialKey(uploadId) {
  return `${CREDENTIAL_PREFIX}${uploadId}`;
}

function tokenFromUploadUrl(uploadUrl) {
  try {
    return new URL(uploadUrl, globalThis.location?.href).searchParams.get("token") || "";
  } catch {
    return "";
  }
}

function saveCredential(uploadId, uploadUrl) {
  const token = tokenFromUploadUrl(uploadUrl);
  if (!token) throw apiError({ code: "UPLOAD_TOKEN_INVALID" }, "Agent upload capability is missing.");
  globalThis.sessionStorage?.setItem(credentialKey(uploadId), token);
}

function credential(uploadId) {
  const token = globalThis.sessionStorage?.getItem(credentialKey(uploadId)) || "";
  if (!token) throw apiError({ code: "UPLOAD_SESSION_UNAVAILABLE" }, "Agent upload belongs to another browser session or has expired.");
  return token;
}

function clearCredential(uploadId) {
  globalThis.sessionStorage?.removeItem(credentialKey(uploadId));
}

function authorization(uploadId) {
  return { authorization: `Bearer ${credential(uploadId)}` };
}

export async function beginAgentUpload({ fileName, size, contentType, sha256, flowId, requestId }) {
  const result = await readJson(await fetch("/api/agent-uploads", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ fileName, size, contentType, sha256, flowId, requestId }),
  }));
  saveCredential(result.upload.uploadId, result.upload.uploadUrl);
  return result.upload;
}

export async function getAgentUploadStatus(uploadId) {
  const result = await readJson(await fetch(`/api/agent-uploads/${encodeURIComponent(uploadId)}`, {
    headers: { accept: "application/json", ...authorization(uploadId) },
  }));
  return result.upload;
}

export async function openAgentUpload(uploadId, { signal } = {}) {
  const token = credential(uploadId);
  const response = await fetch(`/api/agent-uploads/${encodeURIComponent(uploadId)}/content`, {
    signal,
    headers: { authorization: `Bearer ${token}` },
  });
  if (!response.ok) await readJson(response);
  const blob = await response.blob();
  const encodedName = response.headers.get("x-tabulaflow-file-name") || "";
  let name = "agent-upload";
  try {
    name = decodeURIComponent(encodedName) || name;
  } catch {
    // The server already validates filenames; keep a neutral fallback for malformed intermediaries.
  }
  return new File([blob], name, {
    type: blob.type || "application/octet-stream",
    lastModified: Date.now(),
  });
}

export async function completeAgentUpload(uploadId) {
  const result = await readJson(await fetch(`/api/agent-uploads/${encodeURIComponent(uploadId)}/complete`, {
    method: "POST",
    headers: { accept: "application/json", ...authorization(uploadId) },
  }));
  clearCredential(uploadId);
  return result.upload;
}

export async function cancelAgentUpload(uploadId) {
  const result = await readJson(await fetch(`/api/agent-uploads/${encodeURIComponent(uploadId)}`, {
    method: "DELETE",
    headers: { accept: "application/json", ...authorization(uploadId) },
  }));
  clearCredential(uploadId);
  return result.upload;
}
