const SUPPORTED_EXTENSIONS = new Set([".xlsx", ".xls", ".csv", ".json", ".jsonl", ".ndjson"]);
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const DEFAULT_STORAGE_QUOTA_BYTES = 1024 * 1024 * 1024;
const AGENT_UPLOAD_TTL_MS = 15 * 60 * 1000;
const AGENT_UPLOAD_RATE_WINDOW_MS = 60 * 60 * 1000;
const AGENT_UPLOAD_RATE_LIMIT = 8;
const AGENT_UPLOAD_RATE_BYTES = 100 * 1024 * 1024;

function json(data, status = 200) {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
}

function apiError(code, message, status = 400) {
  return json({ error: message, code }, status);
}

function authenticatedUser(request) {
  const id = request.headers.get("oai-authenticated-user-id");
  const email = request.headers.get("oai-authenticated-user-email");
  if (!id || !email) return null;
  const encodedName = request.headers.get("oai-authenticated-user-full-name");
  let name = "";
  if (encodedName) {
    try {
      name = request.headers.get("oai-authenticated-user-full-name-encoding") === "percent-encoded-utf-8"
        ? decodeURIComponent(encodedName)
        : encodedName;
    } catch {
      name = "";
    }
  }
  return { id, email, name };
}

function storageQuota(env) {
  const configured = Number(env.CLOUD_STORAGE_QUOTA_BYTES);
  return Number.isSafeInteger(configured) && configured > 0 ? configured : DEFAULT_STORAGE_QUOTA_BYTES;
}

function requireCloudBindings(env) {
  return Boolean(env.DB && env.FILES);
}

async function initializeCloudStorage(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS cloud_files (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      size INTEGER NOT NULL,
      content_type TEXT NOT NULL,
      object_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS cloud_files_owner_created_idx ON cloud_files (owner_id, created_at DESC)"),
  ]);
}

async function initializeAgentUploads(env) {
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS agent_uploads (
      id TEXT PRIMARY KEY,
      requester_key TEXT NOT NULL,
      owner_id TEXT,
      flow_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      name TEXT NOT NULL,
      expected_size INTEGER NOT NULL,
      actual_size INTEGER,
      content_type TEXT NOT NULL,
      expected_sha256 TEXT NOT NULL,
      actual_sha256 TEXT,
      object_key TEXT NOT NULL UNIQUE,
      token_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      completed_at TEXT
    )`),
    env.DB.prepare("CREATE INDEX IF NOT EXISTS agent_uploads_requester_created_idx ON agent_uploads (requester_key, created_at DESC)"),
    env.DB.prepare("CREATE UNIQUE INDEX IF NOT EXISTS agent_uploads_request_idx ON agent_uploads (requester_key, request_id)"),
  ]);
}

function cleanFileName(value) {
  let decoded = "";
  try {
    decoded = decodeURIComponent(value || "");
  } catch {
    return "";
  }
  const name = decoded.split(/[\\/]/).pop()?.trim() ?? "";
  if (!name || name.length > 180 || /[\u0000-\u001f\u007f]/.test(name)) return "";
  return name;
}

function fileExtension(name) {
  const index = name.lastIndexOf(".");
  return index >= 0 ? name.slice(index).toLowerCase() : "";
}

function randomCapabilityToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (item) => item.toString(16).padStart(2, "0")).join("");
}

async function requesterKey(request, user) {
  const identity = user?.id
    ? `user:${user.id}`
    : `guest:${request.headers.get("cf-connecting-ip") || "unknown"}:${request.headers.get("user-agent") || "unknown"}`;
  return sha256Hex(identity);
}

function agentUploadToken(request, url) {
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  return bearer || url.searchParams.get("token") || "";
}

function agentUploadPayload(row) {
  return {
    uploadId: row.id,
    status: row.status,
    fileName: row.name,
    size: Number(row.actual_size ?? row.expected_size),
    contentType: row.content_type,
    sha256: row.actual_sha256 ?? null,
    flowId: row.flow_id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    completedAt: row.completed_at ?? null,
  };
}

async function cleanupExpiredAgentUploads(env) {
  const now = new Date().toISOString();
  const expired = await env.DB.prepare(`SELECT id, object_key FROM agent_uploads
    WHERE expires_at <= ? AND status IN ('pending', 'uploaded')`).bind(now).all();
  for (const row of expired.results ?? []) {
    await env.FILES.delete(row.object_key).catch(() => {});
    await env.DB.prepare("UPDATE agent_uploads SET status = 'expired', completed_at = ? WHERE id = ?")
      .bind(now, row.id).run().catch(() => {});
  }
}

async function findAuthorizedAgentUpload(request, env, id, url) {
  const row = await env.DB.prepare("SELECT * FROM agent_uploads WHERE id = ?").bind(id).first();
  if (!row) return { response: apiError("UPLOAD_NOT_FOUND", "Agent upload session was not found.", 404) };
  const token = agentUploadToken(request, url);
  if (!token || await sha256Hex(token) !== row.token_hash) {
    return { response: apiError("UPLOAD_TOKEN_INVALID", "Agent upload capability is invalid.", 403) };
  }
  if (new Date(row.expires_at).getTime() <= Date.now() && !["consumed", "cancelled", "expired"].includes(row.status)) {
    await env.FILES.delete(row.object_key).catch(() => {});
    await env.DB.prepare("UPDATE agent_uploads SET status = 'expired', completed_at = ? WHERE id = ?")
      .bind(new Date().toISOString(), id).run().catch(() => {});
    row.status = "expired";
  }
  return { row };
}

function hasExpectedFileSignature(name, bytes) {
  const extension = fileExtension(name);
  const head = new Uint8Array(bytes.slice(0, 8));
  if (extension === ".xlsx") return head[0] === 0x50 && head[1] === 0x4b;
  if (extension === ".xls") return head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0;
  const sample = new Uint8Array(bytes.slice(0, Math.min(bytes.byteLength, 4096)));
  return !sample.some((value) => value === 0);
}

async function beginAgentUpload(request, env, user) {
  const body = await request.json().catch(() => null);
  const name = cleanFileName(body?.fileName);
  const size = Number(body?.size);
  const contentType = String(body?.contentType || "application/octet-stream").slice(0, 120);
  const expectedSha256 = String(body?.sha256 || "").toLowerCase();
  const flowId = String(body?.flowId || "").trim().slice(0, 160);
  const requestId = String(body?.requestId || "").trim().slice(0, 160);
  if (!name || !SUPPORTED_EXTENSIONS.has(fileExtension(name))) {
    return apiError("UPLOAD_TYPE_UNSUPPORTED", "Choose an Excel, CSV, JSON, JSONL, or NDJSON file.");
  }
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_FILE_BYTES) {
    return apiError("UPLOAD_SIZE_EXCEEDED", "Agent uploads must be between 1 byte and 50 MB.", 413);
  }
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) {
    return apiError("UPLOAD_HASH_REQUIRED", "A lowercase SHA-256 digest is required.");
  }
  if (!flowId || requestId.length < 8) {
    return apiError("UPLOAD_SESSION_INVALID", "flowId and a unique requestId are required.");
  }

  await cleanupExpiredAgentUploads(env);
  const key = await requesterKey(request, user);
  const since = new Date(Date.now() - AGENT_UPLOAD_RATE_WINDOW_MS).toISOString();
  const recent = await env.DB.prepare(`SELECT COUNT(*) AS upload_count, COALESCE(SUM(expected_size), 0) AS reserved_bytes
    FROM agent_uploads WHERE requester_key = ? AND created_at >= ?`).bind(key, since).first();
  if (Number(recent?.upload_count ?? 0) >= AGENT_UPLOAD_RATE_LIMIT || Number(recent?.reserved_bytes ?? 0) + size > AGENT_UPLOAD_RATE_BYTES) {
    return apiError("UPLOAD_QUOTA_EXCEEDED", "Agent upload rate limit exceeded. Try again later.", 429);
  }
  const reused = await env.DB.prepare("SELECT id, status FROM agent_uploads WHERE requester_key = ? AND request_id = ?")
    .bind(key, requestId).first();
  if (reused) return apiError("UPLOAD_REQUEST_REUSED", `Agent upload requestId already belongs to ${reused.id}.`, 409);

  const id = crypto.randomUUID();
  const token = randomCapabilityToken();
  const objectKey = `agent-pending/${id}`;
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + AGENT_UPLOAD_TTL_MS).toISOString();
  await env.DB.prepare(`INSERT INTO agent_uploads
    (id, requester_key, owner_id, flow_id, request_id, name, expected_size, content_type, expected_sha256, object_key, token_hash, status, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`).bind(
    id, key, user?.id ?? null, flowId, requestId, name, size, contentType, expectedSha256,
    objectKey, await sha256Hex(token), createdAt, expiresAt,
  ).run();
  const uploadUrl = new URL(`/api/agent-uploads/${id}`, request.url);
  uploadUrl.searchParams.set("token", token);
  return json({
    upload: {
      uploadId: id,
      uploadUrl: uploadUrl.toString(),
      method: "PUT",
      expiresAt,
      maximumBytes: MAX_FILE_BYTES,
      allowedFormats: [...SUPPORTED_EXTENSIONS].map((item) => item.slice(1)),
      status: "pending",
    },
  }, 201);
}

async function putAgentUpload(request, env, row) {
  if (row.status === "uploaded") return json({ upload: agentUploadPayload(row) });
  if (row.status !== "pending") return apiError("UPLOAD_NOT_WRITABLE", `Agent upload is ${row.status}.`, 409);
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength !== Number(row.expected_size)) {
    return apiError("UPLOAD_SIZE_MISMATCH", "Uploaded bytes do not match the declared size.", 400);
  }
  const actualSha256 = await sha256Hex(bytes);
  if (actualSha256 !== row.expected_sha256) {
    return apiError("UPLOAD_HASH_MISMATCH", "Uploaded bytes do not match the declared SHA-256 digest.", 400);
  }
  if (!hasExpectedFileSignature(row.name, bytes)) {
    return apiError("UPLOAD_CONTENT_INVALID", "Uploaded bytes do not match the declared file format.", 400);
  }
  await env.FILES.put(row.object_key, bytes, { httpMetadata: { contentType: row.content_type } });
  await env.DB.prepare(`UPDATE agent_uploads SET status = 'uploaded', actual_size = ?, actual_sha256 = ? WHERE id = ?`)
    .bind(bytes.byteLength, actualSha256, row.id).run();
  return json({ upload: agentUploadPayload({ ...row, status: "uploaded", actual_size: bytes.byteLength, actual_sha256: actualSha256 }) });
}

async function getAgentUpload(env, row) {
  return json({ upload: agentUploadPayload(row) });
}

async function downloadAgentUpload(env, row) {
  if (row.status !== "uploaded") return apiError("UPLOAD_NOT_READY", `Agent upload is ${row.status}.`, 409);
  const object = await env.FILES.get(row.object_key);
  if (!object) return apiError("UPLOAD_CONTENT_UNAVAILABLE", "Agent upload content is unavailable.", 404);
  const safeName = String(row.name).replace(/["\\\r\n]/g, "_");
  return new Response(object.body, { headers: {
    "cache-control": "private, no-store",
    "content-type": row.content_type || "application/octet-stream",
    "content-disposition": `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(row.name)}`,
    "x-tabulaflow-file-name": encodeURIComponent(row.name),
  } });
}

async function completeAgentUpload(env, row) {
  if (row.status === "consumed") return json({ upload: agentUploadPayload(row) });
  if (row.status !== "uploaded") return apiError("UPLOAD_NOT_READY", `Agent upload is ${row.status}.`, 409);
  const completedAt = new Date().toISOString();
  await env.FILES.delete(row.object_key).catch(() => {});
  await env.DB.prepare("UPDATE agent_uploads SET status = 'consumed', completed_at = ? WHERE id = ?")
    .bind(completedAt, row.id).run();
  return json({ upload: agentUploadPayload({ ...row, status: "consumed", completed_at: completedAt }) });
}

async function cancelAgentUpload(env, row) {
  if (["consumed", "cancelled", "expired"].includes(row.status)) return json({ upload: agentUploadPayload(row) });
  const completedAt = new Date().toISOString();
  await env.FILES.delete(row.object_key).catch(() => {});
  await env.DB.prepare("UPDATE agent_uploads SET status = 'cancelled', completed_at = ? WHERE id = ?")
    .bind(completedAt, row.id).run();
  return json({ upload: agentUploadPayload({ ...row, status: "cancelled", completed_at: completedAt }) });
}

async function accountPayload(env, user) {
  if (!user) return json({ authenticated: false });
  if (!requireCloudBindings(env)) return json({ error: "Cloud storage is not configured." }, 503);
  await initializeCloudStorage(env);
  const usage = await env.DB.prepare(`SELECT COUNT(*) AS file_count, COALESCE(SUM(size), 0) AS used_bytes
    FROM cloud_files WHERE owner_id = ? AND status = 'ready'`).bind(user.id).first();
  return json({
    authenticated: true,
    account: { name: user.name || user.email, email: user.email },
    storage: {
      usedBytes: Number(usage?.used_bytes ?? 0),
      quotaBytes: storageQuota(env),
      fileCount: Number(usage?.file_count ?? 0),
    },
  });
}

async function listCloudFiles(env, user) {
  const result = await env.DB.prepare(`SELECT id, name, size, content_type, created_at
    FROM cloud_files WHERE owner_id = ? AND status = 'ready' ORDER BY created_at DESC`).bind(user.id).all();
  return json({ files: (result.results ?? []).map((file) => ({
    id: file.id,
    name: file.name,
    size: Number(file.size),
    contentType: file.content_type,
    createdAt: file.created_at,
  })) });
}

async function uploadCloudFile(request, env, user) {
  const name = cleanFileName(request.headers.get("x-file-name"));
  if (!name || !SUPPORTED_EXTENSIONS.has(fileExtension(name))) {
    return json({ error: "Choose an Excel, CSV, JSON, JSONL, or NDJSON file." }, 400);
  }
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > MAX_FILE_BYTES) {
    return json({ error: "Files must be between 1 byte and 50 MB." }, 413);
  }

  const id = crypto.randomUUID();
  const objectKey = `${encodeURIComponent(user.id)}/${id}`;
  const contentType = (request.headers.get("content-type") || "application/octet-stream").slice(0, 120);
  const createdAt = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO cloud_files
    (id, owner_id, name, size, content_type, object_key, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`).bind(
    id, user.id, name, bytes.byteLength, contentType, objectKey, createdAt,
  ).run();

  try {
    const usage = await env.DB.prepare("SELECT COALESCE(SUM(size), 0) AS used_bytes FROM cloud_files WHERE owner_id = ?")
      .bind(user.id).first();
    if (Number(usage?.used_bytes ?? 0) > storageQuota(env)) {
      await env.DB.prepare("DELETE FROM cloud_files WHERE id = ? AND owner_id = ?").bind(id, user.id).run();
      return json({ error: "Cloud storage quota exceeded." }, 413);
    }
    await env.FILES.put(objectKey, bytes, { httpMetadata: { contentType } });
    await env.DB.prepare("UPDATE cloud_files SET status = 'ready' WHERE id = ? AND owner_id = ?").bind(id, user.id).run();
    return json({ file: { id, name, size: bytes.byteLength, contentType, createdAt } }, 201);
  } catch (error) {
    await env.FILES.delete(objectKey).catch(() => {});
    await env.DB.prepare("DELETE FROM cloud_files WHERE id = ? AND owner_id = ?").bind(id, user.id).run().catch(() => {});
    throw error;
  }
}

async function downloadCloudFile(env, user, id) {
  const file = await env.DB.prepare(`SELECT name, content_type, object_key FROM cloud_files
    WHERE id = ? AND owner_id = ? AND status = 'ready'`).bind(id, user.id).first();
  if (!file) return json({ error: "File not found." }, 404);
  const object = await env.FILES.get(file.object_key);
  if (!object) return json({ error: "File content is unavailable." }, 404);
  const safeDownloadName = String(file.name).replace(/["\\\r\n]/g, "_");
  return new Response(object.body, { headers: {
    "cache-control": "private, no-store",
    "content-type": file.content_type || "application/octet-stream",
    "content-disposition": `attachment; filename="${safeDownloadName}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
  } });
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  const user = authenticatedUser(request);
  if (url.pathname === "/api/account" && request.method === "GET") return accountPayload(env, user);
  const agentUploadRoute = url.pathname.match(/^\/api\/agent-uploads\/([a-f0-9-]+)(?:\/(content|complete))?$/i);
  if (url.pathname === "/api/agent-uploads" || agentUploadRoute) {
    if (!requireCloudBindings(env)) return apiError("UPLOAD_STORAGE_UNAVAILABLE", "Agent upload storage is not configured.", 503);
    await initializeAgentUploads(env);
    if (url.pathname === "/api/agent-uploads" && request.method === "POST") return beginAgentUpload(request, env, user);
    if (!agentUploadRoute) return apiError("UPLOAD_ROUTE_NOT_FOUND", "Agent upload route not found.", 404);
    const authorized = await findAuthorizedAgentUpload(request, env, agentUploadRoute[1], url);
    if (authorized.response) return authorized.response;
    const { row } = authorized;
    if (!agentUploadRoute[2] && request.method === "PUT") return putAgentUpload(request, env, row);
    if (!agentUploadRoute[2] && request.method === "GET") return getAgentUpload(env, row);
    if (!agentUploadRoute[2] && request.method === "DELETE") return cancelAgentUpload(env, row);
    if (agentUploadRoute[2] === "content" && request.method === "GET") return downloadAgentUpload(env, row);
    if (agentUploadRoute[2] === "complete" && request.method === "POST") return completeAgentUpload(env, row);
    return apiError("UPLOAD_ROUTE_NOT_FOUND", "Agent upload route not found.", 404);
  }
  const fileRoute = url.pathname.match(/^\/api\/cloud-files\/([a-f0-9-]+)$/i);
  const isCloudFileRoute = url.pathname === "/api/cloud-files" || Boolean(fileRoute);
  if (!isCloudFileRoute) return json({ error: "API route not found." }, 404);
  if (!user) return json({ error: "Sign in with ChatGPT to use cloud files." }, 401);
  if (!requireCloudBindings(env)) return json({ error: "Cloud storage is not configured." }, 503);
  await initializeCloudStorage(env);
  if (url.pathname === "/api/cloud-files" && request.method === "GET") return listCloudFiles(env, user);
  if (url.pathname === "/api/cloud-files" && request.method === "POST") return uploadCloudFile(request, env, user);
  if (fileRoute && request.method === "GET") return downloadCloudFile(env, user, fileRoute[1]);
  return json({ error: "API route not found." }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/account" || url.pathname === "/api/cloud-files" || url.pathname.startsWith("/api/cloud-files/") || url.pathname === "/api/agent-uploads" || url.pathname.startsWith("/api/agent-uploads/")) {
      try {
        return await handleApi(request, env);
      } catch (error) {
        return apiError(error?.code || "STORAGE_REQUEST_FAILED", "Storage request failed.", 500);
      }
    }
    const response = await env.ASSETS.fetch(request);
    const acceptsHtml = request.headers.get("accept")?.includes("text/html");
    if (response.status !== 404 || !acceptsHtml || !["GET", "HEAD"].includes(request.method)) return response;
    const indexUrl = new URL(request.url);
    indexUrl.pathname = "/index.html";
    indexUrl.search = "";
    return env.ASSETS.fetch(new Request(indexUrl, request));
  },
};
