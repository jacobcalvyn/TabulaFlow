import assert from "node:assert/strict";
import test from "node:test";
import worker from "../worker/index.js";

function createCloudEnv() {
  const rows = [];
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
          } else if (sql.startsWith("UPDATE cloud_files")) {
            const row = rows.find((item) => item.id === this.args[0] && item.owner_id === this.args[1]);
            if (row) row.status = "ready";
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
          if (sql.includes("COALESCE(SUM(size), 0) AS used_bytes")) {
            return { used_bytes: rows.filter((item) => item.owner_id === this.args[0]).reduce((sum, item) => sum + item.size, 0) };
          }
          if (sql.includes("SELECT name, content_type, object_key")) {
            return rows.find((item) => item.id === this.args[0] && item.owner_id === this.args[1] && item.status === "ready") ?? null;
          }
          return null;
        },
        async all() {
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
