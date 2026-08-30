import { resolveColumnSemantics, shouldRedactAgentValues } from "./dataPrivacy.js";
import { getFormulaColumnReferences } from "./formulaEngine.js";
import { isSensitivityAtLeastAsStrict } from "./semanticModel.js";

export const PROTECTED_AGENT_VALUE_KEY = "__tabulaflowProtectedValue";

export function protectedAgentValue(metadata = {}) {
  return { [PROTECTED_AGENT_VALUE_KEY]: true, ...metadata };
}

export function isProtectedAgentValue(value) {
  return value?.[PROTECTED_AGENT_VALUE_KEY] === true;
}

function sameBinding(actual, expected) {
  if (Object.is(actual, expected)) return true;
  if (Array.isArray(actual) || Array.isArray(expected)) {
    return Array.isArray(actual)
      && Array.isArray(expected)
      && actual.length === expected.length
      && actual.every((value, index) => sameBinding(value, expected[index]));
  }
  if (!actual || !expected || typeof actual !== "object" || typeof expected !== "object") return false;
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  return actualKeys.length === expectedKeys.length
    && actualKeys.every((key, index) => key === expectedKeys[index] && sameBinding(actual[key], expected[key]));
}

function protectedValueError(code, message, details = {}) {
  const error = new Error(message);
  Object.assign(error, { code, ...details });
  return error;
}

function recipeValueBinding(step, key) {
  const params = step?.params ?? {};
  const base = { scope: "recipe", stepId: step?.id, stepType: step?.type, key };
  if (step?.type === "calculated-field") return { ...base, outputColumn: params.outputColumn, expressionVersion: params.expressionVersion ?? 1 };
  if (step?.type === "calculated-column") return { ...base, outputColumn: params.newName, leftColumn: params.leftColumn, rightColumn: params.rightColumn ?? null, operator: params.operator };
  if (step?.type === "conditional-column") return { ...base, outputColumn: params.newName, column: params.column, operator: params.operator };
  return { ...base, column: params.column ?? null };
}

export function assertAgentSemanticFieldChange(fieldName, currentField, changes = {}) {
  if (!changes.sensitivity) return;
  const currentSensitivity = currentField?.sensitivity;
  if (currentSensitivity && isSensitivityAtLeastAsStrict(changes.sensitivity, currentSensitivity)) return;
  const error = new Error(`WebMCP cannot lower ${fieldName} sensitivity from ${currentSensitivity ?? "unknown"} to ${changes.sensitivity}. Declassification requires a visible user action.`);
  error.code = "SEMANTIC_DECLASSIFICATION_REQUIRES_USER";
  throw error;
}

function columnRequiresProtection(schema, name) {
  const column = (schema ?? []).find((item) => item.name === name) ?? { name, type: "VARCHAR" };
  return shouldRedactAgentValues(resolveColumnSemantics(column));
}

const ALWAYS_PROTECTED_RECIPE_PARAMS = Object.freeze({
  "calculated-field": ["expression"],
  "calculated-column": ["value"],
  "conditional-column": ["value", "thenValue", "elseValue"],
});

export function protectRecipeForAgent(recipe = [], schema = []) {
  return recipe.map((step) => {
    const params = structuredClone(step?.params ?? {});
    const column = params.column;
    const protectedKeys = new Set(ALWAYS_PROTECTED_RECIPE_PARAMS[step?.type] ?? []);
    if (column && columnRequiresProtection(schema, column)) {
      for (const key of ["value", "from", "to"]) protectedKeys.add(key);
    }
    for (const key of protectedKeys) {
      if (!Object.hasOwn(params, key)) continue;
      if (step?.type === "calculated-field" && key === "expression") {
        let referencedColumns = [];
        try {
          referencedColumns = getFormulaColumnReferences(params.expression);
        } catch {
          // Invalid stored formulas remain protected and are diagnosed by recipe execution.
        }
        params[key] = protectedAgentValue({ binding: recipeValueBinding(step, key), referencedColumns });
      } else {
        params[key] = protectedAgentValue({ binding: recipeValueBinding(step, key) });
      }
    }
    return { ...structuredClone(step), params };
  });
}

export function restoreProtectedRecipeValues(recipe = [], currentRecipe = []) {
  const currentById = new Map(currentRecipe.map((step) => [step.id, step]));
  return recipe.map((step) => {
    const params = structuredClone(step?.params ?? {});
    const previous = currentById.get(step.id);
    for (const [key, value] of Object.entries(params)) {
      if (!isProtectedAgentValue(value)) continue;
      if (!previous || !Object.hasOwn(previous.params ?? {}, key)) {
        throw protectedValueError(
          "PROTECTED_VALUE_NOT_RESTORABLE",
          `Protected recipe value cannot be restored for step ${step.id}.`,
          { stepId: step.id, parameter: key },
        );
      }
      if (!sameBinding(value.binding, recipeValueBinding(step, key)) || !sameBinding(value.binding, recipeValueBinding(previous, key))) {
        throw protectedValueError(
          "PROTECTED_VALUE_BINDING_MISMATCH",
          `Protected recipe value binding changed for step ${step.id}.`,
          { stepId: step.id, parameter: key },
        );
      }
      params[key] = structuredClone(previous.params[key]);
    }
    return { ...structuredClone(step), params };
  });
}

export function protectComposeConfigForAgent(node, inputSchema = []) {
  const config = structuredClone(node?.config ?? {});
  if (node?.kind === "filter-rows") {
    config.conditions = (config.conditions ?? []).map((condition, index) => {
      if (!Object.hasOwn(condition, "value") || !columnRequiresProtection(inputSchema, condition.column)) return condition;
      return { ...condition, value: protectedAgentValue({ binding: {
        scope: "compose",
        nodeId: node?.id,
        kind: node?.kind,
        inputIds: node?.inputIds ?? [],
        key: "value",
        index,
        column: condition.column,
        operator: condition.operator,
      } }) };
    });
  }
  if (node?.kind === "pivot" && columnRequiresProtection(inputSchema, config.pivotColumn)) {
    config.values = (config.values ?? []).map((value, index) => protectedAgentValue({ binding: {
      scope: "compose",
      nodeId: node?.id,
      kind: node?.kind,
      inputIds: node?.inputIds ?? [],
      key: "values",
      index,
      pivotColumn: config.pivotColumn,
      valueColumn: config.valueColumn,
      aggregate: config.aggregate,
    } }));
  }
  return config;
}

export function restoreProtectedComposeOperation(operation, existingNode = null) {
  const restored = structuredClone(operation);
  if (restored.kind === "filter-rows" && isProtectedAgentValue(restored.value)) {
    const previous = existingNode?.config?.conditions?.[0];
    if (!previous || !Object.hasOwn(previous, "value")) {
      throw protectedValueError(
        "PROTECTED_VALUE_NOT_RESTORABLE",
        "Protected Compose filter value cannot be restored for a new operation.",
        { targetId: existingNode?.id, parameter: "value" },
      );
    }
    const expected = {
      scope: "compose",
      nodeId: existingNode.id,
      kind: existingNode.kind,
      inputIds: existingNode.inputIds ?? [],
      key: "value",
      index: 0,
      column: restored.column,
      operator: restored.operator,
    };
    if (!sameBinding(restored.value.binding, expected)
      || restored.column !== previous.column
      || restored.operator !== previous.operator) {
      throw protectedValueError(
        "PROTECTED_VALUE_BINDING_MISMATCH",
        "Protected Compose filter value binding changed.",
        { targetId: existingNode?.id, parameter: "value" },
      );
    }
    restored.value = structuredClone(previous.value);
  }
  if (restored.kind === "pivot" && Array.isArray(restored.values)) {
    restored.values = restored.values.map((value, index) => {
      if (!isProtectedAgentValue(value)) return value;
      const previous = existingNode?.config?.values?.[index];
      if (previous === undefined) {
        throw protectedValueError(
          "PROTECTED_VALUE_NOT_RESTORABLE",
          "Protected Compose pivot value cannot be restored for a new operation.",
          { targetId: existingNode?.id, parameter: `values[${index}]` },
        );
      }
      const expected = {
        scope: "compose",
        nodeId: existingNode.id,
        kind: existingNode.kind,
        inputIds: existingNode.inputIds ?? [],
        key: "values",
        index,
        pivotColumn: restored.pivotColumn,
        valueColumn: restored.valueColumn,
        aggregate: restored.aggregate,
      };
      if (!sameBinding(value.binding, expected)
        || restored.pivotColumn !== existingNode.config?.pivotColumn
        || restored.valueColumn !== existingNode.config?.valueColumn
        || restored.aggregate !== existingNode.config?.aggregate) {
        throw protectedValueError(
          "PROTECTED_VALUE_BINDING_MISMATCH",
          "Protected Compose pivot value binding changed.",
          { targetId: existingNode?.id, parameter: `values[${index}]` },
        );
      }
      return structuredClone(previous);
    });
  }
  return restored;
}
