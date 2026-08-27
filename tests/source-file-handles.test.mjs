import assert from "node:assert/strict";
import test from "node:test";
import { restoreFileFromHandle } from "../src/sourceFileHandles.js";

test("restores a file when a persisted handle still has read permission", async () => {
  const file = { name: "orders.csv", size: 10, lastModified: 20 };
  const result = await restoreFileFromHandle({
    kind: "file",
    queryPermission: async () => "granted",
    getFile: async () => file,
  });
  assert.equal(result.status, "ready");
  assert.equal(result.file, file);
});

test("does not prompt for permission during automatic restore", async () => {
  let opened = false;
  const result = await restoreFileFromHandle({
    kind: "file",
    queryPermission: async () => "prompt",
    getFile: async () => { opened = true; },
  });
  assert.equal(result.status, "permission-required");
  assert.equal(opened, false);
});

test("treats missing or inaccessible handles as unavailable", async () => {
  assert.equal((await restoreFileFromHandle(null)).status, "missing");
  const result = await restoreFileFromHandle({
    kind: "file",
    queryPermission: async () => "granted",
    getFile: async () => { throw new DOMException("Missing", "NotFoundError"); },
  });
  assert.equal(result.status, "unavailable");
  assert.equal(result.file, null);
});
