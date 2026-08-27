import assert from "node:assert/strict";
import test from "node:test";
import {
  canMigrateLegacyRecipe,
  legacyRecipeStorageKey,
  preparedRecipeStorageKey,
} from "../src/recipeStorage.js";

test("prepared recipe keys are scoped to preparedId, not filename and schema", () => {
  assert.equal(preparedRecipeStorageKey("prepared-a"), "prepared-recipe:prepared-a");
  assert.notEqual(
    preparedRecipeStorageKey("prepared-a"),
    preparedRecipeStorageKey("prepared-b"),
  );
  assert.equal(
    legacyRecipeStorageKey({ filename: "orders.csv", sourceColumns: ["id"] }),
    JSON.stringify({ filename: "orders.csv", sourceColumns: ["id"] }),
  );
});

test("legacy recipes migrate only when the prepared key is empty and the match is unique", () => {
  const legacyRecipe = [{ id: "trim-1", type: "trim", params: { column: "id" } }];
  assert.equal(canMigrateLegacyRecipe({
    preparedRecipe: [],
    legacyRecipe,
    matchingPreparedCount: 1,
  }), true);
  assert.equal(canMigrateLegacyRecipe({
    preparedRecipe: legacyRecipe,
    legacyRecipe,
    matchingPreparedCount: 1,
  }), false);
  assert.equal(canMigrateLegacyRecipe({
    preparedRecipe: [],
    legacyRecipe,
    matchingPreparedCount: 2,
  }), false);
  assert.equal(canMigrateLegacyRecipe({
    preparedRecipe: [],
    legacyRecipe: [],
    matchingPreparedCount: 1,
  }), false);
});
