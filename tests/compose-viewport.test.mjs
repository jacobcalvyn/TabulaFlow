import assert from "node:assert/strict";
import test from "node:test";
import { calculateGraphFit, MAX_CANVAS_COORDINATE, normalizeCanvasPosition } from "../src/composeViewport.js";

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
  assert.ok(result.scale >= 0.02);
  assert.equal(result.scrollLeft, 0);
  assert.equal(result.scrollTop, 0);
  assert.equal(result.fits, true);
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
  assert.equal(result.fits, true);
});

test("calculateGraphFit uses an overview scale when the graph is wider than the manual zoom range", () => {
  const result = calculateGraphFit({
    positions: {
      left: { x: 40, y: 52 },
      right: { x: 9000, y: 420 },
    },
    viewportWidth: 709,
    viewportHeight: 926,
  });

  assert.ok(result.scale < 0.3);
  assert.equal(result.fits, true);
  assert.equal(result.scrollLeft, 0);
});

test("calculateGraphFit centers a graph restored far from the canvas origin", () => {
  const result = calculateGraphFit({
    positions: {
      left: { x: 4200, y: 3200 },
      right: { x: 4520, y: 3200 },
    },
    viewportWidth: 900,
    viewportHeight: 600,
  });

  assert.equal(result.scale, 1);
  assert.ok(result.scrollLeft > 3800);
  assert.ok(result.scrollTop > 2900);
  assert.equal(result.fits, true);
});

test("normalizeCanvasPosition rejects invalid and extreme persisted coordinates", () => {
  assert.deepEqual(normalizeCanvasPosition({ x: Number.NaN, y: Number.POSITIVE_INFINITY }), { x: 40, y: 52 });
  assert.deepEqual(normalizeCanvasPosition({ x: -500, y: MAX_CANVAS_COORDINATE * 10 }), { x: 24, y: MAX_CANVAS_COORDINATE });
});
