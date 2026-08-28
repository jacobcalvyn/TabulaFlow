const SUPPORTED_EXTENSIONS = new Set([".xlsx", ".xls", ".csv", ".json", ".jsonl", ".ndjson"]);
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const DEFAULT_STORAGE_QUOTA_BYTES = 1024 * 1024 * 1024;

function json(data, status = 200) {
  return Response.json(data, { status, headers: { "cache-control": "no-store" } });
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
    if (url.pathname === "/api/account" || url.pathname === "/api/cloud-files" || url.pathname.startsWith("/api/cloud-files/")) {
      try {
        return await handleApi(request, env);
      } catch {
        return json({ error: "Cloud storage request failed." }, 500);
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
