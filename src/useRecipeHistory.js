import { useCallback, useMemo, useRef, useState } from "react";

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
  const historyRef = useRef(EMPTY_RECIPE_HISTORY);

  const publish = useCallback((next) => {
    historyRef.current = next;
    setHistory(next);
    return next;
  }, []);

  const reset = useCallback((recipe = []) => {
    const next = cloneRecipe(recipe);
    publish(resetRecipeHistory(next));
    return next;
  }, [publish]);

  const commit = useCallback((recipe) => {
    const next = cloneRecipe(recipe);
    publish(commitRecipeHistory(historyRef.current, next));
    return next;
  }, [publish]);

  const undo = useCallback(() => {
    publish(undoRecipeHistory(historyRef.current));
  }, [publish]);

  const redo = useCallback(() => {
    publish(redoRecipeHistory(historyRef.current));
  }, [publish]);

  const getCurrent = useCallback(() => cloneRecipe(historyRef.current.present), []);
  const getUndoTarget = useCallback(() => historyRef.current.past.length ? cloneRecipe(historyRef.current.past.at(-1)) : null, []);
  const getRedoTarget = useCallback(() => historyRef.current.future.length ? cloneRecipe(historyRef.current.future[0]) : null, []);

  const undoTarget = history.past.length ? cloneRecipe(history.past.at(-1)) : null;
  const redoTarget = history.future.length ? cloneRecipe(history.future[0]) : null;

  return useMemo(() => ({
    recipe: history.present,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    undoTarget,
    redoTarget,
    getCurrent,
    getUndoTarget,
    getRedoTarget,
    reset,
    commit,
    undo,
    redo,
  }), [history, reset, commit, undo, redo, getCurrent, getUndoTarget, getRedoTarget]);
}
