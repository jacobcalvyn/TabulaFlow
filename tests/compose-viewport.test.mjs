import assert from "node:assert/strict";
import test from "node:test";
import { calculateGraphFit } from "../src/composeViewport.js";

test("calculateGraphFit keeps a wide persisted graph inside a narrow Compose viewport", () => {
  const result = calculateGraphFit({
    positions: {
      left: { x: 40, y: 52 },
      middle: { x: 720, y: 240 },
      right: { x: 1420, y: 420 },
    },
    viewportWidth: 709,
    viewportHeight: 926,
  });

  assert.ok(result.scale < 0.5);
  assert.ok(result.scale >= 0.3);
  assert.equal(result.scrollLeft, 0);
  assert.equal(result.scrollTop, 0);
});

test("calculateGraphFit leaves a compact graph at 100 percent", () => {
  const result = calculateGraphFit({
    positions: {
      left: { x: 40, y: 52 },
      right: { x: 360, y: 52 },
    },
    viewportWidth: 900,
    viewportHeight: 600,
  });

  assert.equal(result.scale, 1);
  assert.equal(result.scrollLeft, 0);
  assert.equal(result.scrollTop, 0);
});
