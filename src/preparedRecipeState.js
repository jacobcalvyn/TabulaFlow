export const PREPARED_RECIPE_STATUS = Object.freeze({
  APPLIED: "applied",
  PENDING: "pending",
  IGNORED: "ignored",
});

export function recipeStatusAfterRelink(recipe = []) {
  return recipe.length ? PREPARED_RECIPE_STATUS.PENDING : PREPARED_RECIPE_STATUS.APPLIED;
}

export function recipeForExecution(graphPrepared, registeredRecipe = []) {
  if (graphPrepared?.recipeStatus === PREPARED_RECIPE_STATUS.PENDING
    || graphPrepared?.recipeStatus === PREPARED_RECIPE_STATUS.IGNORED) {
    return registeredRecipe;
  }
  return graphPrepared?.recipe ?? registeredRecipe;
}

export function shouldPromptForPreparedRecipe(prepared, workerRecipe = []) {
  return prepared?.recipeStatus !== PREPARED_RECIPE_STATUS.IGNORED
    && (prepared?.recipe?.length ?? 0) > 0
    && workerRecipe.length === 0;
}
