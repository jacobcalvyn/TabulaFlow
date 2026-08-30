import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import React, { useEffect } from "react";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const workerInstances = [];

class FakeWorker extends dom.window.EventTarget {
  constructor() {
    super();
    this.messages = [];
    workerInstances.push(this);
  }

  postMessage(message) {
    this.messages.push(message);
    if (message.type === "initialize") {
      queueMicrotask(() => this.respond(message.requestId, { engineVersion: "test" }));
    }
  }

  respond(requestId, result) {
    this.dispatchEvent(new dom.window.MessageEvent("message", { data: { requestId, ok: true, result } }));
  }

  fail(requestId, code) {
    this.dispatchEvent(new dom.window.MessageEvent("message", {
      data: { requestId, ok: false, error: { code, message: "cancelled" } },
    }));
  }

  terminate() {}
}

globalThis.Worker = FakeWorker;
const { act, cleanup, render, waitFor } = await import("@testing-library/react");
const { useDataWorker } = await import("../src/useDataWorker.js");

test.after(() => {
  cleanup();
  dom.window.close();
});

function Harness({ onChange }) {
  const worker = useDataWorker();
  useEffect(() => onChange(worker), [onChange, worker]);
  return null;
}

test("an aborted operation sends a cooperative cancellation message to the active worker request", async () => {
  delete globalThis[Symbol.for("tabulaflow.worker-registry")];
  let api;
  const view = render(React.createElement(Harness, { onChange: (next) => { api = next; } }));
  await waitFor(() => assert.equal(api?.ready, true));
  const fakeWorker = workerInstances.at(-1);
  const controller = new AbortController();
  let requestPromise;
  await act(async () => {
    requestPromise = api.previewCompose({ preparedInputs: [], composeNodes: [] }, "node-a", {}, { signal: controller.signal });
    await Promise.resolve();
  });
  const request = fakeWorker.messages.find((message) => message.type === "compose-preview");
  assert.ok(request);
  await act(async () => {
    controller.abort();
    await Promise.resolve();
  });
  const cancellation = fakeWorker.messages.find((message) => message.kind === "cancel" && message.requestId === request.requestId);
  assert.deepEqual(cancellation, { kind: "cancel", requestId: request.requestId });
  await act(async () => {
    fakeWorker.fail(request.requestId, "OPERATION_CANCELLED");
    await assert.rejects(requestPromise, (error) => error.code === "OPERATION_CANCELLED");
  });
  view.unmount();
});

test("worker cancellation checks every transactional commit boundary", () => {
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/data.worker.js"), "utf8");
  assert.match(source, /if \(kind === "cancel"\)/);
  assert.equal((source.match(/assertRequestActive\(\);\s*\n\s*await query\("COMMIT"\)/g) ?? []).length, 5);
});
