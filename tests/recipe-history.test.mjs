import assert from "node:assert/strict";
import test from "node:test";
import {
  commitRecipeHistory,
  EMPTY_RECIPE_HISTORY,
  redoRecipeHistory,
  resetRecipeHistory,
  undoRecipeHistory,
} from "../src/useRecipeHistory.js";

const step = (id) => ({ id, type: "trim", version: 1, enabled: true, params: { column: id } });

test("tracks recipe revisions and clears redo after a new commit", () => {
  let history = resetRecipeHistory([step("one")]);
  history = commitRecipeHistory(history, [step("one"), step("two")]);
  history = undoRecipeHistory(history);

  assert.deepEqual(history.present.map(({ id }) => id), ["one"]);
  assert.equal(history.future.length, 1);

  history = commitRecipeHistory(history, [step("three")]);
  assert.deepEqual(history.present.map(({ id }) => id), ["three"]);
  assert.equal(history.future.length, 0);
});

test("undo and redo preserve ordered steps including deletion and reorder", () => {
  const initial = [step("one"), step("two"), step("three")];
  let history = resetRecipeHistory(initial);
  history = commitRecipeHistory(history, [initial[2], initial[0], initial[1]]);
  history = commitRecipeHistory(history, [initial[2], initial[1]]);

  history = undoRecipeHistory(history);
  assert.deepEqual(history.present.map(({ id }) => id), ["three", "one", "two"]);
  history = undoRecipeHistory(history);
  assert.deepEqual(history.present.map(({ id }) => id), ["one", "two", "three"]);
  history = redoRecipeHistory(history);
  assert.deepEqual(history.present.map(({ id }) => id), ["three", "one", "two"]);
});

test("history operations are no-ops when no revision is available", () => {
  assert.equal(undoRecipeHistory(EMPTY_RECIPE_HISTORY), EMPTY_RECIPE_HISTORY);
  assert.equal(redoRecipeHistory(EMPTY_RECIPE_HISTORY), EMPTY_RECIPE_HISTORY);
});
