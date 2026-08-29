import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { JSDOM } from "jsdom";
import react from "@vitejs/plugin-react";
import { createServer } from "vite";

const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.navigator = dom.window.navigator;
globalThis.Element = dom.window.Element;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.Node = dom.window.Node;
globalThis.localStorage = dom.window.localStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
window.requestAnimationFrame = (callback) => { callback(); return 1; };

const { act, cleanup, fireEvent, render } = await import("@testing-library/react");
const vite = await createServer({
  appType: "custom",
  configFile: false,
  optimizeDeps: { noDiscovery: true },
  plugins: [react()],
  server: { middlewareMode: true, hmr: false, ws: false },
});
const [{ InputScreen }, { LanguageProvider }] = await Promise.all([
  vite.ssrLoadModule("/src/App.jsx"),
  vite.ssrLoadModule("/src/i18n.jsx"),
]);

test.after(async () => {
  cleanup();
  await vite.close();
  dom.window.close();
});

function renderSource(overrides = {}) {
  const props = {
    loading: false,
    error: "",
    onFile() {},
    onOpenSource() {},
    onRelinkSource() {},
    onResetAll: async () => true,
    workerReady: true,
    openedSources: [{
      key: "source-a",
      sourceAssetId: "source-a",
      preparedId: "prepared-a",
      name: "orders.csv",
      kind: "local",
      size: 120,
      status: "linked",
    }],
    ...overrides,
  };
  return render(React.createElement(LanguageProvider, null, React.createElement(InputScreen, props)));
}

test("Reset all requires explicit confirmation and Cancel preserves the flow", () => {
  let resetCount = 0;
  const view = renderSource({ onResetAll: async () => { resetCount += 1; return true; } });

  fireEvent.click(view.getByRole("button", { name: "Reset all" }));
  assert.ok(view.getByRole("alertdialog", { name: "Reset the entire flow?" }));
  fireEvent.click(view.getByRole("button", { name: "Cancel" }));

  assert.equal(resetCount, 0);
  assert.equal(view.queryByRole("alertdialog"), null);
  view.unmount();
});

test("confirming Reset all invokes the destructive reset once", async () => {
  let resetCount = 0;
  const view = renderSource({ onResetAll: async () => { resetCount += 1; return true; } });

  fireEvent.click(view.getByRole("button", { name: "Reset all" }));
  const confirmation = view.getByRole("alertdialog", { name: "Reset the entire flow?" });
  await act(async () => {
    fireEvent.click(confirmation.querySelector(".source-reset-confirmation__confirm"));
  });

  assert.equal(resetCount, 1);
  assert.equal(view.queryByRole("alertdialog"), null);
  view.unmount();
});

test("Reset all is hidden for an already empty flow", () => {
  const view = renderSource({ openedSources: [] });
  assert.equal(view.queryByRole("button", { name: "Reset all" }), null);
  view.unmount();
});

test("a WebMCP Reset all request opens the same visible confirmation and can be cancelled", async () => {
  const resolutions = [];
  let resetCount = 0;
  let view;
  await act(async () => {
    view = renderSource({
      resetRequest: { token: "reset-token", requestId: "reset-request-001" },
      onResetRequestResolved: (token, outcome) => resolutions.push({ token, outcome }),
      onResetAll: async () => { resetCount += 1; return true; },
    });
  });
  assert.ok(view.getByRole("alertdialog", { name: "Reset the entire flow?" }));
  fireEvent.click(view.getByRole("button", { name: "Cancel" }));
  assert.equal(resetCount, 0);
  assert.deepEqual(resolutions, [{ token: "reset-token", outcome: "cancelled" }]);
  view.unmount();
});
