import { useMemo, useRef, useState } from "react";
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

function functionSnippet(name) {
  if (name === "cast" || name === "try_cast") return `${name}([Column] AS VARCHAR)`;
  if (name === "if") return "if(condition, value, fallback)";
  if (name === "coalesce" || name === "ifnull") return `${name}(value, fallback)`;
  if (name === "substring") return "substring(text, start, length)";
  if (name === "replace") return "replace(text, from, to)";
  if (name === "concat") return "concat(value, value)";
  return `${name}(value)`;
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
  const [outputColumn, setOutputColumn] = useState(initialParams?.outputColumn ?? "");
  const [expression, setExpression] = useState(initialParams?.expression ?? "");
  const [selectedColumn, setSelectedColumn] = useState(normalizedSchema[0]?.name ?? "");
  const [selectedFunction, setSelectedFunction] = useState(CALCULATION_CATALOG.functions[0]?.name ?? "");
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const textareaRef = useRef(null);
  const validation = useMemo(() => validateFormula(expression, normalizedSchema), [expression, normalizedSchema]);
  const originalOutput = String(initialParams?.outputColumn ?? "").trim().toLocaleLowerCase("id-ID");
  const outputCollision = normalizedSchema.some((column) => (
    column.name.toLocaleLowerCase("id-ID") === outputColumn.trim().toLocaleLowerCase("id-ID")
    && column.name.toLocaleLowerCase("id-ID") !== originalOutput
  ));
  const complete = outputColumn.trim().length > 0 && validation.valid && !outputCollision;

  const insertText = (text) => {
    const input = textareaRef.current;
    const start = input?.selectionStart ?? expression.length;
    const end = input?.selectionEnd ?? expression.length;
    const next = `${expression.slice(0, start)}${text}${expression.slice(end)}`;
    setExpression(next);
    setPreview(null);
    requestAnimationFrame(() => {
      if (!textareaRef.current) return;
      textareaRef.current.focus();
      textareaRef.current.setSelectionRange(start + text.length, start + text.length);
    });
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

      <label className="formula-editor__field">
        <span>{t("formulaOutputColumn")}</span>
        <input value={outputColumn} onChange={(event) => { setOutputColumn(event.target.value); setPreview(null); }} placeholder={t("formulaOutputPlaceholder")} autoFocus />
      </label>
      {outputCollision && <p className="formula-editor__diagnostic" role="alert">{t("formulaCreateOnlyCollision")}</p>}

      <div className="formula-editor__insert-row">
        <label><span>{t("formulaInsertColumn")}</span><select value={selectedColumn} onChange={(event) => setSelectedColumn(event.target.value)}>{normalizedSchema.map((column) => <option key={column.name} value={column.name}>{column.name}</option>)}</select></label>
        <button type="button" onClick={() => insertText(quoteFormulaColumnReference(selectedColumn))} disabled={!selectedColumn}>{t("insert")}</button>
      </div>
      <div className="formula-editor__insert-row">
        <label><span>{t("formulaInsertFunction")}</span><select value={selectedFunction} onChange={(event) => setSelectedFunction(event.target.value)}>{CALCULATION_CATALOG.functions.map((item) => <option key={item.name} value={item.name}>{item.signature}</option>)}</select></label>
        <button type="button" onClick={() => insertText(functionSnippet(selectedFunction))}>{t("insert")}</button>
      </div>

      <label className="formula-editor__field">
        <span>{t("formulaExpression")}</span>
        <textarea ref={textareaRef} value={expression} onChange={(event) => { setExpression(event.target.value); setPreview(null); }} spellCheck="false" placeholder="CASE WHEN [Amount] >= 1000 THEN 'High' ELSE 'Standard' END" />
      </label>

      {validation.valid ? (
        <div className="formula-editor__status" role="status">
          <span>{t("formulaInferredType")}: <strong>{validation.inferredType}</strong></span>
          <span>{t("formulaReferences")}: <strong>{validation.referencedColumns.join(", ") || t("none")}</strong></span>
        </div>
      ) : expression.trim() ? (
        <p className="formula-editor__diagnostic" role="alert">
          {validation.diagnostics[0]?.message} {t("formulaAtCharacter", { count: (validation.diagnostics[0]?.start ?? 0) + 1 })}
        </p>
      ) : null}

      {(error || previewError) && <div className="formula-editor__error" role="alert"><WarningCircle weight="fill" />{error || previewError}</div>}

      {preview && (
        <section className="formula-editor__preview" aria-label={t("formulaPreview")}>
          <strong>{t("formulaPreview")}</strong>
          <div><table><thead><tr>{preview.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{preview.preview.map((row, index) => <tr key={index}>{preview.columns.map((column) => <td key={column}>{row[column] === null || row[column] === undefined ? t("emptyValue") : String(row[column])}</td>)}</tr>)}</tbody></table></div>
        </section>
      )}

      <footer>
        <button type="button" onClick={onCancel}>{t("cancel")}</button>
        {onPreview && <button type="button" onClick={previewFormula} disabled={!complete || applying || previewing}><Eye /> {previewing ? t("creatingPreview") : t("preview")}</button>}
        <button type="submit" disabled={!complete || applying}>{applying ? t("applying") : submitLabel}</button>
      </footer>
    </form>
  );
}
