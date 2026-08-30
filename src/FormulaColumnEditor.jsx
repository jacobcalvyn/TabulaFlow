import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, WarningCircle, X } from "@phosphor-icons/react";
import {
  CALCULATION_CATALOG,
  FORMULA_EXPRESSION_VERSION,
  quoteFormulaColumnReference,
  validateFormula,
} from "./formulaEngine.js";
import { useI18n } from "./i18n.jsx";

function normalizeSchema(schema = []) {
  return schema.map((column) => typeof column === "string" ? { name: column, type: "UNKNOWN" } : column);
}

function nextFormulaColumnName(schema, baseName) {
  const names = new Set(schema.map((column) => column.name.toLocaleLowerCase("id-ID")));
  let suffix = 1;
  while (names.has(`${baseName} ${suffix}`.toLocaleLowerCase("id-ID"))) suffix += 1;
  return `${baseName} ${suffix}`;
}

function findFormulaAutocomplete(expression, cursor) {
  const source = String(expression ?? "");
  const end = Math.max(0, Math.min(cursor ?? source.length, source.length));
  let inString = false;
  let columnStart = null;
  for (let index = 0; index < end; index += 1) {
    const char = source[index];
    if (inString) {
      if (char === "'" && source[index + 1] === "'") index += 1;
      else if (char === "'") inString = false;
      continue;
    }
    if (columnStart !== null) {
      if (char === "]" && source[index + 1] === "]") index += 1;
      else if (char === "]") columnStart = null;
      continue;
    }
    if (char === "'") inString = true;
    else if (char === "[") columnStart = index;
  }
  if (inString) return null;
  if (columnStart !== null) {
    const query = source.slice(columnStart + 1, end);
    if (query.includes("\n") || query.includes("\r")) return null;
    return { kind: "column", start: columnStart, end: source[end] === "]" ? end + 1 : end, query };
  }
  const identifier = source.slice(0, end).match(/[A-Za-z_][A-Za-z0-9_]*$/)?.[0] ?? "";
  if (!identifier) return null;
  const query = identifier.toLocaleLowerCase("id-ID");
  if (!CALCULATION_CATALOG.functions.some((item) => item.name.startsWith(query))) return null;
  return { kind: "function", start: end - identifier.length, end, query };
}

const FORMULA_FUNCTIONS = new Map(CALCULATION_CATALOG.functions.map((item) => [item.name, item]));

function findFormulaFunctionContext(expression, cursor) {
  const source = String(expression ?? "");
  const end = Math.max(0, Math.min(cursor ?? source.length, source.length));
  const stack = [];
  let inString = false;
  let inColumn = false;
  let lastClosed = null;

  for (let index = 0; index < end; index += 1) {
    const char = source[index];
    if (inString) {
      if (char === "'" && source[index + 1] === "'") index += 1;
      else if (char === "'") inString = false;
      continue;
    }
    if (inColumn) {
      if (char === "]" && source[index + 1] === "]") index += 1;
      else if (char === "]") inColumn = false;
      continue;
    }
    if (char === "'") {
      inString = true;
      continue;
    }
    if (char === "[") {
      inColumn = true;
      continue;
    }
    if (char === "(") {
      let nameEnd = index;
      while (nameEnd > 0 && /\s/.test(source[nameEnd - 1])) nameEnd -= 1;
      const name = source.slice(0, nameEnd).match(/[A-Za-z_][A-Za-z0-9_]*$/)?.[0]?.toLocaleLowerCase("id-ID");
      stack.push({ item: name ? FORMULA_FUNCTIONS.get(name) ?? null : null, argumentIndex: 0, openIndex: index });
      continue;
    }
    if (char === ",") {
      if (stack.at(-1)?.item) stack.at(-1).argumentIndex += 1;
      continue;
    }
    if (char === ")") {
      const frame = stack.pop();
      if (frame?.item) lastClosed = { ...frame, closeIndex: index, closed: true };
    }
  }

  const active = stack.findLast((frame) => frame.item);
  if (active) return { ...active, closed: false };
  const finalNonSpaceIndex = source.slice(0, end).trimEnd().length - 1;
  return lastClosed?.closeIndex === finalNonSpaceIndex ? lastClosed : null;
}

export function FormulaColumnEditor({
  schema,
  initialParams,
  title,
  submitLabel,
  applying = false,
  error = "",
  onPreview,
  onSubmit,
  onCancel,
}) {
  const { t } = useI18n();
  const normalizedSchema = useMemo(() => normalizeSchema(schema), [schema]);
  const generatedOutputColumn = useMemo(
    () => nextFormulaColumnName(normalizedSchema, t("formulaColumn")),
    [normalizedSchema, t],
  );
  const [outputColumn, setOutputColumn] = useState(initialParams?.outputColumn ?? generatedOutputColumn);
  const [expression, setExpression] = useState(initialParams?.expression ?? "");
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [autocomplete, setAutocomplete] = useState(null);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const [selectedCatalogFunction, setSelectedCatalogFunction] = useState(null);
  const [cursorPosition, setCursorPosition] = useState((initialParams?.expression ?? "").length);
  const outputInputRef = useRef(null);
  const textareaRef = useRef(null);
  const pendingCursorRef = useRef(null);
  const validation = useMemo(() => validateFormula(expression, normalizedSchema), [expression, normalizedSchema]);
  const functionContext = useMemo(
    () => findFormulaFunctionContext(expression, cursorPosition),
    [expression, cursorPosition],
  );
  const functionHelpContext = selectedCatalogFunction
    ? { item: selectedCatalogFunction, argumentIndex: 0, closed: false, catalogSelection: true }
    : functionContext;
  const primaryDiagnostic = validation.diagnostics[0] ?? null;
  const hideArityDiagnostic = functionContext && primaryDiagnostic?.code === "INVALID_ARGUMENT_COUNT";
  const functionArguments = functionHelpContext?.item.arguments ?? [];
  const functionArgumentIndex = functionHelpContext ? Math.min(
    !functionHelpContext.catalogSelection && functionHelpContext.closed && primaryDiagnostic?.code === "INVALID_ARGUMENT_COUNT"
      ? functionHelpContext.argumentIndex + 1
      : functionHelpContext.argumentIndex,
    Math.max(0, functionArguments.length - 1),
  ) : 0;
  const originalOutput = String(initialParams?.outputColumn ?? "").trim().toLocaleLowerCase("id-ID");
  const outputCollision = normalizedSchema.some((column) => (
    column.name.toLocaleLowerCase("id-ID") === outputColumn.trim().toLocaleLowerCase("id-ID")
    && column.name.toLocaleLowerCase("id-ID") !== originalOutput
  ));
  const complete = outputColumn.trim().length > 0 && validation.valid && !outputCollision;

  const suggestions = useMemo(() => {
    if (!autocomplete) return [];
    const query = autocomplete.query.toLocaleLowerCase("id-ID");
    if (autocomplete.kind === "function") {
      return CALCULATION_CATALOG.functions
        .filter((item) => item.name.startsWith(query))
        .slice(0, 8)
        .map((item) => ({ kind: "function", key: item.name, label: item.signature, meta: t("formulaFunction"), value: item.name.toUpperCase() }));
    }
    return normalizedSchema
      .filter((column) => column.name.toLocaleLowerCase("id-ID").includes(query))
      .sort((left, right) => {
        const leftPrefix = left.name.toLocaleLowerCase("id-ID").startsWith(query) ? 0 : 1;
        const rightPrefix = right.name.toLocaleLowerCase("id-ID").startsWith(query) ? 0 : 1;
        return leftPrefix - rightPrefix;
      })
      .slice(0, 8)
      .map((column) => ({ kind: "column", key: column.name, label: column.name, meta: column.type ?? "UNKNOWN", value: column.name }));
  }, [autocomplete, normalizedSchema, t]);

  useEffect(() => {
    if (initialParams?.outputColumn || !outputInputRef.current) return;
    outputInputRef.current.focus();
    outputInputRef.current.select();
  }, [initialParams?.outputColumn]);

  useEffect(() => {
    setActiveSuggestion(0);
  }, [autocomplete?.kind, autocomplete?.query]);

  useEffect(() => {
    if (pendingCursorRef.current === null || !textareaRef.current) return;
    const cursor = pendingCursorRef.current;
    pendingCursorRef.current = null;
    textareaRef.current.focus();
    textareaRef.current.setSelectionRange(cursor, cursor);
    setCursorPosition(cursor);
  }, [expression]);

  const updateAutocomplete = (nextExpression, cursor) => {
    setCursorPosition(cursor);
    setAutocomplete(findFormulaAutocomplete(nextExpression, cursor));
  };

  const chooseSuggestion = (suggestion) => {
    if (!autocomplete || !suggestion) return;
    const replacement = suggestion.kind === "column"
      ? quoteFormulaColumnReference(suggestion.value)
      : `${suggestion.value}()`;
    const next = `${expression.slice(0, autocomplete.start)}${replacement}${expression.slice(autocomplete.end)}`;
    const cursor = autocomplete.start + replacement.length - (suggestion.kind === "function" ? 1 : 0);
    pendingCursorRef.current = cursor;
    setExpression(next);
    setPreview(null);
    setAutocomplete(null);
  };

  const insertCatalogFunction = (item) => {
    const start = textareaRef.current?.selectionStart ?? cursorPosition ?? expression.length;
    const end = textareaRef.current?.selectionEnd ?? start;
    const replacement = `${item.name.toUpperCase()}()`;
    const next = `${expression.slice(0, start)}${replacement}${expression.slice(end)}`;
    const cursor = start + replacement.length - 1;
    pendingCursorRef.current = cursor;
    setExpression(next);
    setPreview(null);
    setAutocomplete(null);
  };

  const handleFormulaKeyDown = (event) => {
    setSelectedCatalogFunction(null);
    if (!autocomplete || !suggestions.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveSuggestion((current) => (current + 1) % suggestions.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSuggestion((current) => (current - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      chooseSuggestion(suggestions[Math.min(activeSuggestion, suggestions.length - 1)]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setAutocomplete(null);
    }
  };

  const params = () => ({
    outputColumn: outputColumn.trim(),
    expression: expression.trim(),
    expressionVersion: FORMULA_EXPRESSION_VERSION,
  });

  const previewFormula = async () => {
    if (!complete || !onPreview) return;
    setPreviewing(true);
    setPreviewError("");
    try {
      setPreview(await onPreview(params(), validation.referencedColumns));
    } catch (cause) {
      setPreviewError(cause instanceof Error ? cause.message : t("formulaPreviewFailed"));
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <form className="formula-editor" onSubmit={(event) => { event.preventDefault(); if (complete) onSubmit(params()); }}>
      <header>
        <div><strong>{title}</strong><span>{t("formulaEditorDescription")}</span></div>
        <button type="button" onClick={onCancel} aria-label={t("closeForm")}><X /></button>
      </header>

      <div className="formula-editor__body">
        <aside className="formula-editor__catalog" aria-label={t("formulaFunctions")}>
          <header>
            <strong>{t("formulaFunctions")}</strong>
            <span>{t("formulaFunctionsHint")}</span>
          </header>
          <ul>
            {CALCULATION_CATALOG.functions.map((item) => (
              <li key={item.name}>
                <button
                  type="button"
                  onClick={() => setSelectedCatalogFunction(item)}
                  onDoubleClick={() => insertCatalogFunction(item)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    setSelectedCatalogFunction(item);
                    insertCatalogFunction(item);
                  }}
                  aria-label={`${t("formulaSelectFunction")}: ${item.signature}`}
                  aria-pressed={selectedCatalogFunction?.name === item.name}
                  title={t("formulaFunctionsHint")}
                >
                  <strong>{item.name.toUpperCase()}</strong>
                  <span>{item.signature.slice(item.signature.indexOf("("))}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <div className="formula-editor__workspace">
          <label className="formula-editor__field">
            <span>{t("formulaOutputColumn")}</span>
            <input ref={outputInputRef} value={outputColumn} onChange={(event) => { setOutputColumn(event.target.value); setPreview(null); }} placeholder={t("formulaOutputPlaceholder")} />
          </label>
          {outputCollision && <p className="formula-editor__diagnostic" role="alert">{t("formulaCreateOnlyCollision")}</p>}

          <label className="formula-editor__field">
            <span>{t("formulaExpression")}</span>
            <div className="formula-editor__expression">
              <textarea
                ref={textareaRef}
                value={expression}
                onChange={(event) => {
                  setExpression(event.target.value);
                  setPreview(null);
                  setSelectedCatalogFunction(null);
                  updateAutocomplete(event.target.value, event.target.selectionStart);
                }}
                onKeyDown={handleFormulaKeyDown}
                onClick={(event) => {
                  setSelectedCatalogFunction(null);
                  updateAutocomplete(expression, event.currentTarget.selectionStart);
                }}
                onSelect={(event) => {
                  setSelectedCatalogFunction(null);
                  setCursorPosition(event.currentTarget.selectionStart);
                }}
                onBlur={() => setAutocomplete(null)}
                spellCheck="false"
                placeholder="CASE WHEN [Amount] >= 1000 THEN 'High' ELSE 'Standard' END"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={Boolean(autocomplete && suggestions.length)}
                aria-controls="formula-suggestions"
                aria-activedescendant={autocomplete && suggestions.length ? `formula-suggestion-${activeSuggestion}` : undefined}
              />
              {autocomplete && suggestions.length > 0 && (
                <ul id="formula-suggestions" className="formula-editor__suggestions" role="listbox" aria-label={autocomplete.kind === "column" ? t("formulaColumnSuggestions") : t("formulaFunctionSuggestions")}>
                  {suggestions.map((suggestion, index) => (
                    <li
                      id={`formula-suggestion-${index}`}
                      key={`${suggestion.kind}-${suggestion.key}`}
                      role="option"
                      aria-selected={index === activeSuggestion}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => chooseSuggestion(suggestion)}
                    >
                      <strong>{suggestion.label}</strong><span>{suggestion.meta}</span>
                    </li>
                  ))}
                </ul>
              )}
              {functionHelpContext && functionArguments.length > 0 && (
                <div className="formula-editor__function-help" role="status" aria-label={t("formulaFunctionSyntax")}>
                  <div className="formula-editor__function-syntax">
                    <code>
                      <strong>{functionHelpContext.item.name.toUpperCase()}(</strong>
                      {functionArguments.map((argument, index) => (
                        <span key={`${functionHelpContext.item.name}-${argument}-${index}`}>
                          {index > 0 && <span>{functionHelpContext.item.name.includes("cast") ? " AS " : ", "}</span>}
                          <mark className={index === functionArgumentIndex ? "is-active" : ""}>{argument}</mark>
                        </span>
                      ))}
                      <strong>)</strong>
                    </code>
                    <span>{t("formulaActiveArgument", { count: functionArgumentIndex + 1, argument: functionArguments[functionArgumentIndex] })}</span>
                  </div>
                  <p>{functionHelpContext.item.description}</p>
                  <div className="formula-editor__function-example">
                    <span>{t("formulaExample")}</span>
                    <code>{functionHelpContext.item.example}</code>
                  </div>
                </div>
              )}
            </div>
          </label>

          {validation.valid ? (
            <div className="formula-editor__status" role="status">
              <span>{t("formulaInferredType")}: <strong>{validation.inferredType}</strong></span>
              <span>{t("formulaReferences")}: <strong>{validation.referencedColumns.join(", ") || t("none")}</strong></span>
            </div>
          ) : expression.trim() && !hideArityDiagnostic ? (
            <p className="formula-editor__diagnostic" role="alert">
              {primaryDiagnostic?.message} {t("formulaAtCharacter", { count: (primaryDiagnostic?.start ?? 0) + 1 })}
            </p>
          ) : null}

          {(error || previewError) && <div className="formula-editor__error" role="alert"><WarningCircle weight="fill" />{error || previewError}</div>}

          {preview && (
            <section className="formula-editor__preview" aria-label={t("formulaPreview")}>
              <strong>{t("formulaPreview")}</strong>
              <div><table><thead><tr>{preview.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{preview.preview.map((row, index) => <tr key={index}>{preview.columns.map((column) => <td key={column}>{row[column] === null || row[column] === undefined ? t("emptyValue") : String(row[column])}</td>)}</tr>)}</tbody></table></div>
            </section>
          )}
        </div>
      </div>

      <footer>
        <button type="button" onClick={onCancel}>{t("cancel")}</button>
        {onPreview && <button type="button" onClick={previewFormula} disabled={!complete || applying || previewing}><Eye /> {previewing ? t("creatingPreview") : t("preview")}</button>}
        <button type="submit" disabled={!complete || applying}>{applying ? t("applying") : submitLabel}</button>
      </footer>
    </form>
  );
}
