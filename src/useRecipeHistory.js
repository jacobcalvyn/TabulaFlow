import { useCallback, useMemo, useState } from "react";

export const EMPTY_RECIPE_HISTORY = Object.freeze({ past: [], present: [], future: [] });

function cloneRecipe(recipe) {
  return recipe.map((step) => ({ ...step, params: { ...step.params } }));
}

export function resetRecipeHistory(recipe = []) {
  return { past: [], present: cloneRecipe(recipe), future: [] };
}

export function commitRecipeHistory(history, recipe) {
  return { past: [...history.past, history.present], present: cloneRecipe(recipe), future: [] };
}

export function undoRecipeHistory(history) {
  if (!history.past.length) return history;
  return {
    past: history.past.slice(0, -1),
    present: history.past.at(-1),
    future: [history.present, ...history.future],
  };
}

export function redoRecipeHistory(history) {
  if (!history.future.length) return history;
  const [present, ...future] = history.future;
  return { past: [...history.past, history.present], present, future };
}

export function useRecipeHistory() {
  const [history, setHistory] = useState(EMPTY_RECIPE_HISTORY);

  const reset = useCallback((recipe = []) => {
    const next = cloneRecipe(recipe);
    setHistory(resetRecipeHistory(next));
    return next;
  }, []);

  const commit = useCallback((recipe) => {
    const next = cloneRecipe(recipe);
    setHistory((current) => commitRecipeHistory(current, next));
    return next;
  }, []);

  const undo = useCallback(() => {
    setHistory((current) => undoRecipeHistory(current));
  }, []);

  const redo = useCallback(() => {
    setHistory((current) => redoRecipeHistory(current));
  }, []);

  const undoTarget = history.past.length ? cloneRecipe(history.past.at(-1)) : null;
  const redoTarget = history.future.length ? cloneRecipe(history.future[0]) : null;

  return useMemo(() => ({
    recipe: history.present,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    undoTarget,
    redoTarget,
    reset,
    commit,
    undo,
    redo,
  }), [history, reset, commit, undo, redo]);
}
