import assert from "node:assert/strict";
import test from "node:test";
import worker from "../worker/index.js";

function createCloudEnv() {
  const rows = [];
  const agentRows = [];
  const objects = new Map();
  const DB = {
    batch: async () => {},
    prepare(sql) {
      const statement = {
        args: [],
        bind(...args) { this.args = args; return this; },
        async run() {
          if (sql.includes("INSERT INTO cloud_files")) {
            const [id, owner_id, name, size, content_type, object_key, created_at] = this.args;
            rows.push({ id, owner_id, name, size, content_type, object_key, created_at, status: "pending" });
          } else if (sql.includes("INSERT INTO agent_uploads")) {
            const [id, requester_key, owner_id, flow_id, request_id, name, expected_size, content_type, expected_sha256, object_key, token_hash, created_at, expires_at] = this.args;
            agentRows.push({ id, requester_key, owner_id, flow_id, request_id, name, expected_size, actual_size: null, content_type, expected_sha256, actual_sha256: null, object_key, token_hash, created_at, expires_at, completed_at: null, status: "pending" });
          } else if (sql.startsWith("UPDATE cloud_files")) {
            const row = rows.find((item) => item.id === this.args[0] && item.owner_id === this.args[1]);
            if (row) row.status = "ready";
          } else if (sql.includes("UPDATE agent_uploads SET status = 'uploaded'")) {
            const row = agentRows.find((item) => item.id === this.args[2]);
            if (row) Object.assign(row, { status: "uploaded", actual_size: this.args[0], actual_sha256: this.args[1] });
          } else if (sql.includes("UPDATE agent_uploads SET status = 'expired'")) {
            const row = agentRows.find((item) => item.id === this.args[1]);
            if (row) Object.assign(row, { status: "expired", completed_at: this.args[0] });
          } else if (sql.includes("UPDATE agent_uploads SET status = 'consumed'")) {
            const row = agentRows.find((item) => item.id === this.args[1]);
            if (row) Object.assign(row, { status: "consumed", completed_at: this.args[0] });
          } else if (sql.includes("UPDATE agent_uploads SET status = 'cancelled'")) {
            const row = agentRows.find((item) => item.id === this.args[1]);
            if (row) Object.assign(row, { status: "cancelled", completed_at: this.args[0] });
          } else if (sql.startsWith("DELETE FROM cloud_files")) {
            const index = rows.findIndex((item) => item.id === this.args[0] && item.owner_id === this.args[1]);
            if (index >= 0) rows.splice(index, 1);
          }
          return { success: true };
        },
        async first() {
          if (sql.includes("COUNT(*) AS file_count")) {
            const owned = rows.filter((item) => item.owner_id === this.args[0] && item.status === "ready");
            return { file_count: owned.length, used_bytes: owned.reduce((sum, item) => sum + item.size, 0) };
          }
          if (sql.includes("COUNT(*) AS upload_count")) {
            const recent = agentRows.filter((item) => item.requester_key === this.args[0] && item.created_at >= this.args[1]);
            return { upload_count: recent.length, reserved_bytes: recent.reduce((sum, item) => sum + item.expected_size, 0) };
          }
          if (sql.includes("SELECT id, status FROM agent_uploads")) {
            return agentRows.find((item) => item.requester_key === this.args[0] && item.request_id === this.args[1]) ?? null;
          }
          if (sql.includes("SELECT * FROM agent_uploads")) {
            return agentRows.find((item) => item.id === this.args[0]) ?? null;
          }
          if (sql.includes("COALESCE(SUM(size), 0) AS used_bytes")) {
            return { used_bytes: rows.filter((item) => item.owner_id === this.args[0]).reduce((sum, item) => sum + item.size, 0) };
          }
          if (sql.includes("SELECT name, content_type, object_key")) {
            return rows.find((item) => item.id === this.args[0] && item.owner_id === this.args[1] && item.status === "ready") ?? null;
          }
          return null;
        },
        async all() {
          if (sql.includes("SELECT id, object_key FROM agent_uploads")) {
            return { results: agentRows.filter((item) => item.expires_at <= this.args[0] && ["pending", "uploaded"].includes(item.status)) };
          }
          return { results: rows.filter((item) => item.owner_id === this.args[0] && item.status === "ready") };
        },
      };
      return statement;
    },
  };
  return {
    DB,
    FILES: {
      async put(key, value) { objects.set(key, value); },
      async get(key) { return objects.has(key) ? { body: objects.get(key) } : null; },
      async delete(key) { objects.delete(key); },
    },
  };
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Buffer.from(digest).toString("hex");
}

const userHeaders = {
  "oai-authenticated-user-id": "user-1",
  "oai-authenticated-user-email": "person@example.com",
  "oai-authenticated-user-full-name": "Tabula%20User",
  "oai-authenticated-user-full-name-encoding": "percent-encoded-utf-8",
};

test("keeps local use public while cloud routes require sign-in", async () => {
  const account = await worker.fetch(new Request("https://example.test/api/account"), {});
  assert.deepEqual(await account.json(), { authenticated: false });

  const files = await worker.fetch(new Request("https://example.test/api/cloud-files"), {});
  assert.equal(files.status, 401);
});

test("stores cloud files per authenticated owner and reports account usage", async () => {
  const env = createCloudEnv();
  const upload = await worker.fetch(new Request("https://example.test/api/cloud-files", {
    method: "POST",
    headers: { ...userHeaders, "content-type": "text/csv", "x-file-name": "shipments.csv" },
    body: "id,status\n1,ready",
  }), env);
  assert.equal(upload.status, 201);
  const saved = (await upload.json()).file;

  const account = await worker.fetch(new Request("https://example.test/api/account", { headers: userHeaders }), env);
  const accountBody = await account.json();
  assert.equal(accountBody.authenticated, true);
  assert.equal(accountBody.account.name, "Tabula User");
  assert.equal(accountBody.storage.fileCount, 1);
  assert.equal(accountBody.storage.usedBytes, saved.size);

  const list = await worker.fetch(new Request("https://example.test/api/cloud-files", { headers: userHeaders }), env);
  assert.deepEqual((await list.json()).files.map((file) => file.name), ["shipments.csv"]);

  const otherUser = { ...userHeaders, "oai-authenticated-user-id": "user-2" };
  const hidden = await worker.fetch(new Request(`https://example.test/api/cloud-files/${saved.id}`, { headers: otherUser }), env);
  assert.equal(hidden.status, 404);

  const download = await worker.fetch(new Request(`https://example.test/api/cloud-files/${saved.id}`, { headers: userHeaders }), env);
  assert.equal(download.status, 200);
  assert.equal(await download.text(), "id,status\n1,ready");
});

test("stages, verifies, downloads, and consumes a guest agent upload with a short-lived capability", async () => {
  const env = createCloudEnv();
  const content = "id,status\n1,ready";
  const begin = await worker.fetch(new Request("https://example.test/api/agent-uploads", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "192.0.2.10", "user-agent": "qc-agent" },
    body: JSON.stringify({
      fileName: "agent-fixture.csv",
      size: new TextEncoder().encode(content).byteLength,
      contentType: "text/csv",
      sha256: await sha256Hex(content),
      flowId: "flow-agent-a",
      requestId: "agent-upload-request-001",
    }),
  }), env);
  assert.equal(begin.status, 201);
  const session = (await begin.json()).upload;
  assert.equal(session.status, "pending");
  assert.equal(session.maximumBytes, 50 * 1024 * 1024);
  assert.ok(session.uploadUrl.includes("token="));

  const staged = await worker.fetch(new Request(session.uploadUrl, { method: "PUT", body: content }), env);
  assert.equal(staged.status, 200);
  assert.equal((await staged.json()).upload.status, "uploaded");

  const contentUrl = new URL(session.uploadUrl);
  contentUrl.pathname += "/content";
  const downloaded = await worker.fetch(new Request(contentUrl), env);
  assert.equal(downloaded.status, 200);
  assert.equal(await downloaded.text(), content);

  const completeUrl = new URL(session.uploadUrl);
  completeUrl.pathname += "/complete";
  const completed = await worker.fetch(new Request(completeUrl, { method: "POST" }), env);
  assert.equal((await completed.json()).upload.status, "consumed");
  const unavailable = await worker.fetch(new Request(contentUrl), env);
  assert.equal(unavailable.status, 409);
  assert.equal((await unavailable.json()).code, "UPLOAD_NOT_READY");
});

test("rejects agent upload token, size, and hash mismatches with structured codes", async () => {
  const env = createCloudEnv();
  const content = "id\n1";
  const begin = await worker.fetch(new Request("https://example.test/api/agent-uploads", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "192.0.2.11", "user-agent": "qc-agent" },
    body: JSON.stringify({ fileName: "fixture.csv", size: 4, contentType: "text/csv", sha256: await sha256Hex(content), flowId: "flow-a", requestId: "agent-upload-request-002" }),
  }), env);
  const session = (await begin.json()).upload;

  const wrongToken = new URL(session.uploadUrl);
  wrongToken.searchParams.set("token", "invalid");
  const forbidden = await worker.fetch(new Request(wrongToken, { method: "PUT", body: content }), env);
  assert.equal(forbidden.status, 403);
  assert.equal((await forbidden.json()).code, "UPLOAD_TOKEN_INVALID");

  const wrongSize = await worker.fetch(new Request(session.uploadUrl, { method: "PUT", body: `${content}\n2` }), env);
  assert.equal((await wrongSize.json()).code, "UPLOAD_SIZE_MISMATCH");

  const wrongHash = await worker.fetch(new Request(session.uploadUrl, { method: "PUT", body: "id\n2" }), env);
  assert.equal((await wrongHash.json()).code, "UPLOAD_HASH_MISMATCH");
});
