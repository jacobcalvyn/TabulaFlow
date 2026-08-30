import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CaretDown,
  DotsSixVertical,
  Eye,
  PencilSimple,
  Power,
  Trash,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import {
  CREATABLE_TRANSFORMATION_TYPES,
  summarizeStep,
  TRANSFORMATION_TYPES,
  transformationParamsAreComplete,
} from "./transformations.js";
import { useI18n } from "./i18n.jsx";
import { FormulaColumnEditor } from "./FormulaColumnEditor.jsx";

const TYPE_OPTIONS = ["VARCHAR", "BIGINT", "DOUBLE", "BOOLEAN", "DATE", "TIMESTAMP"];
const FIELD_DEFINITIONS = {
  "rename-column": [["column", "fieldColumn", "column"], ["newName", "fieldNewName", "text"]],
  "change-type": [["column", "fieldColumn", "column"], ["targetType", "fieldTargetType", "type"]],
  trim: [["column", "fieldColumn", "column"], ["mode", "fieldMode", "trim-mode"]],
  "replace-value": [["column", "fieldColumn", "column"], ["from", "fieldOldValue", "text"], ["to", "fieldNewValue", "text"]],
  "fill-empty": [["column", "fieldColumn", "column"], ["value", "fieldFillValue", "text"]],
  "remove-empty-rows": [["column", "fieldColumn", "column"]],
  "remove-duplicates": [["columns", "fieldKeyColumns", "text"], ["keep", "fieldKeep", "keep"]],
  "standardize-case": [["column", "fieldColumn", "column"], ["mode", "fieldFormat", "case-mode"]],
  "parse-date": [["column", "fieldColumn", "column"], ["format", "fieldDateFormat", "text"]],
  "delete-rows": [["column", "fieldColumn", "column"], ["operator", "fieldDeleteCondition", "delete-condition"], ["value", "fieldComparison", "text"]],
  "select-columns": [["columns", "fieldColumns", "text"]],
  "remove-columns": [["columns", "fieldColumns", "text"]],
  sort: [["column", "fieldColumn", "column"], ["direction", "fieldDirection", "direction"]],
  "calculated-column": [["leftColumn", "fieldLeftColumn", "column"], ["operator", "fieldOperator", "calculation"], ["rightColumn", "fieldRightColumn", "optional-column"], ["value", "fieldNumber", "number"], ["newName", "fieldOutputName", "text"]],
  "conditional-column": [["column", "fieldColumn", "column"], ["operator", "fieldCondition", "comparison"], ["value", "fieldComparison", "text"], ["thenValue", "fieldThen", "text"], ["elseValue", "fieldElse", "text"], ["newName", "fieldOutputName", "text"]],
  "group-aggregate": [["groupColumns", "fieldGroupColumns", "text"], ["valueColumn", "fieldValueColumn", "optional-column"], ["function", "fieldFunction", "aggregate"], ["newName", "fieldResultName", "text"]],
};

const DEFAULT_PARAMS = {
  "change-type": { targetType: "VARCHAR" },
  trim: { mode: "both" },
  "remove-duplicates": { keep: "first" },
  "standardize-case": { mode: "lower" },
  "parse-date": { format: "%Y-%m-%d" },
  "delete-rows": { operator: "equals" },
  sort: { direction: "asc" },
  "calculated-column": { operator: "+", value: 0 },
  "conditional-column": { operator: "=" },
  "group-aggregate": { function: "COUNT" },
};

const BOUND_COLUMN_FIELD = {
  "remove-duplicates": "columns",
  "select-columns": "columns",
  "remove-columns": "columns",
  "calculated-column": "leftColumn",
  "group-aggregate": "groupColumns",
};

function boundColumnFieldFor(type) {
  return BOUND_COLUMN_FIELD[type] ?? "column";
}

function valueRowActionFor(step) {
  if (step.type !== "delete-rows") return null;
  const params = step.params ?? {};
  if (params.valueAction === "keep" || params.valueAction === "delete") return params.valueAction;
  if (params.operator === "is-not-null") return "keep";
  if (params.operator === "is-null") return "delete";
  if (params.exactValue === true && params.operator === "not-equals" && params.nullSafe === true) return "keep";
  if (params.exactValue === true && params.operator === "equals") return "delete";
  return null;
}

function defaultParamsFor(type, availableColumns, initialColumn = availableColumns[0] ?? "") {
  const defaults = { ...DEFAULT_PARAMS[type] };
  for (const [name, , kind] of FIELD_DEFINITIONS[type]) {
    if (kind === "column" && defaults[name] === undefined) defaults[name] = initialColumn;
    if ((name === "columns" || name === "groupColumns") && defaults[name] === undefined) defaults[name] = initialColumn;
  }
  return defaults;
}

function SelectField({ value, onChange, options, allowEmpty = false }) {
  const { t } = useI18n();
  return (
    <select value={value ?? ""} onChange={(event) => onChange(event.target.value)}>
      {allowEmpty && <option value="">{t("notSelected")}</option>}
      {options.map((option) => {
        const item = typeof option === "string" ? { value: option, label: option } : option;
        return <option key={item.value} value={item.value}>{item.label}</option>;
      })}
    </select>
  );
}

function StepField({ definition, value, columns, onChange }) {
  const { t } = useI18n();
  const [name, labelKey, kind] = definition;
  let control;
  if (kind === "column" || kind === "optional-column") {
    control = <SelectField value={value} onChange={onChange} options={columns} allowEmpty={kind === "optional-column"} />;
  } else if (kind === "type") {
    control = <SelectField value={value} onChange={onChange} options={TYPE_OPTIONS} />;
  } else if (kind === "trim-mode") {
    control = <SelectField value={value} onChange={onChange} options={[{ value: "both", label: t("leftAndRight") }, { value: "left", label: t("left") }, { value: "right", label: t("right") }]} />;
  } else if (kind === "keep") {
    control = <SelectField value={value} onChange={onChange} options={[{ value: "first", label: t("firstRow") }, { value: "last", label: t("lastRow") }]} />;
  } else if (kind === "case-mode") {
    control = <SelectField value={value} onChange={onChange} options={[
      { value: "lower", label: t("lowercase") },
      { value: "upper", label: t("uppercase") },
      { value: "title", label: t("titlecase") },
    ]} />;
  } else if (kind === "direction") {
    control = <SelectField value={value} onChange={onChange} options={[{ value: "asc", label: t("ascending") }, { value: "desc", label: t("descending") }]} />;
  } else if (kind === "calculation") {
    control = <SelectField value={value} onChange={onChange} options={["+", "-", "*", "/"]} />;
  } else if (kind === "comparison") {
    control = <SelectField value={value} onChange={onChange} options={["=", "!=", ">", ">=", "<", "<="]} />;
  } else if (kind === "delete-condition") {
    control = <SelectField value={value} onChange={onChange} options={[
      { value: "equals", label: t("equals") },
      { value: "not-equals", label: t("notEquals") },
      { value: "contains", label: t("contains") },
      { value: "not-contains", label: t("notContains") },
      { value: "greater-than", label: t("greaterThan") },
      { value: "greater-or-equal", label: t("greaterOrEqual") },
      { value: "less-than", label: t("lessThan") },
      { value: "less-or-equal", label: t("lessOrEqual") },
      { value: "is-null", label: t("isNull") },
      { value: "is-not-null", label: t("isNotNull") },
      { value: "is-empty", label: t("isEmpty") },
      { value: "is-not-empty", label: t("isNotEmpty") },
    ]} />;
  } else if (kind === "aggregate") {
    control = <SelectField value={value} onChange={onChange} options={["COUNT", "SUM", "AVG", "MIN", "MAX"]} />;
  } else {
    control = <input type={kind === "number" ? "number" : "text"} value={value ?? ""} onChange={(event) => onChange(event.target.value)} />;
  }
  return <label className="step-field"><span>{t(labelKey)}</span>{control}</label>;
}

export function TransformationForm({
  columns,
  initialType = CREATABLE_TRANSFORMATION_TYPES[0].type,
  initialParams,
  initialColumn,
  title,
  submitLabel,
  applying = false,
  error = "",
  onSubmit,
  onCancel,
  onBack,
  hideBoundColumn = false,
  hideModule = false,
}) {
  const { t, toolLabel } = useI18n();
  const availableColumns = useMemo(() => [...new Set(columns)], [columns]);
  const [draftType, setDraftType] = useState(initialType);
  const [params, setParams] = useState(() => initialParams ?? defaultParamsFor(initialType, availableColumns, initialColumn));
  const selectableTypes = useMemo(() => {
    const currentType = TRANSFORMATION_TYPES.find((item) => item.type === draftType);
    if (!currentType || CREATABLE_TRANSFORMATION_TYPES.some((item) => item.type === draftType)) return CREATABLE_TRANSFORMATION_TYPES;
    return [currentType, ...CREATABLE_TRANSFORMATION_TYPES];
  }, [draftType]);
  const paramsComplete = transformationParamsAreComplete(draftType, params);

  const changeType = (type) => {
    setDraftType(type);
    setParams(defaultParamsFor(type, availableColumns, initialColumn));
  };

  return (
    <form className="step-form" onSubmit={(event) => { event.preventDefault(); if (paramsComplete) onSubmit(draftType, { ...params }); }}>
      <header>
        <div className="step-form__heading">
          {onBack && <button type="button" onClick={onBack} aria-label={t("backToTools")}><ArrowLeft /></button>}
          <strong>{title}</strong>
        </div>
        <button type="button" onClick={onCancel} aria-label={t("closeForm")}><X /></button>
      </header>
      {!hideModule && <label className="step-field"><span>{t("module")}</span><select value={draftType} onChange={(event) => changeType(event.target.value)}>{["Clean", "Build"].map((group) => <optgroup key={group} label={group === "Clean" ? t("clean") : t("build")}>{selectableTypes.filter((item) => item.group === group).map((item) => <option key={item.type} value={item.type}>{toolLabel(item.type)}</option>)}</optgroup>)}</select></label>}
      {FIELD_DEFINITIONS[draftType]
        .filter(([name]) => !hideBoundColumn || name !== boundColumnFieldFor(draftType))
        .filter(([name]) => !(draftType === "delete-rows" && name === "value" && ["is-null", "is-not-null", "is-empty", "is-not-empty"].includes(params.operator)))
        .map((definition) => <StepField key={definition[0]} definition={definition} value={params[definition[0]]} columns={availableColumns} onChange={(value) => setParams((current) => ({ ...current, [definition[0]]: value }))} />)}
      {error && <div className="step-form__error" role="alert"><WarningCircle weight="fill" />{error}</div>}
      {!paramsComplete && <div className="step-form__validation" role="status">{t("comparisonRequired")}</div>}
      <footer><button type="button" onClick={onCancel}>{t("cancel")}</button><button type="submit" disabled={applying || !paramsComplete}>{applying ? t("applying") : submitLabel}</button></footer>
    </form>
  );
}

export function StepsPanel({
  open,
  embedded = false,
  panelRef,
  columns,
  schema = columns,
  recipe,
  stepStates,
  invalidStepId,
  error,
  applying,
  canUndo,
  canRedo,
  onClose,
  onChange,
  onUndo,
  onRedo,
  onPreview,
  onPreviewDraft,
  previewedStepId,
  deleteRequest,
  onDeleteRequestShown,
  onDeleteConfirmation,
}) {
  const { t, toolLabel } = useI18n();
  const [formOpen, setFormOpen] = useState(false);
  const [formExpanded, setFormExpanded] = useState(false);
  const [sheetDragging, setSheetDragging] = useState(false);
  const [sheetDragOffset, setSheetDragOffset] = useState(0);
  const [editingId, setEditingId] = useState(null);
  const [draggedId, setDraggedId] = useState(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState(null);
  const [confirmingDeleteAll, setConfirmingDeleteAll] = useState(false);
  const [deleteAllRequestTargetId, setDeleteAllRequestTargetId] = useState(null);
  const sheetPointerRef = useRef(null);
  const formulaModalRef = useRef(null);
  const deleteAllConfirmRef = useRef(null);
  const sheetDragOffsetRef = useRef(0);
  const sheetDragMovedRef = useRef(false);
  const dismissTimerRef = useRef(null);
  const stateById = useMemo(() => new Map(stepStates.map((state) => [state.id, state])), [stepStates]);
  const editingStep = recipe.find((step) => step.id === editingId);
  const editingInputColumns = stateById.get(editingId)?.inputColumns ?? columns;
  const editingSchema = schema.filter((column) => editingInputColumns.includes(typeof column === "string" ? column : column.name));

  const revealForm = () => {
    window.clearTimeout(dismissTimerRef.current);
    setSheetDragOffset(0);
    setFormExpanded(false);
    setFormOpen(true);
    window.requestAnimationFrame(() => setFormExpanded(true));
  };

  const dismissForm = () => {
    setSheetDragOffset(0);
    setFormExpanded(false);
    window.clearTimeout(dismissTimerRef.current);
    dismissTimerRef.current = window.setTimeout(() => setFormOpen(false), 240);
  };

  useEffect(() => () => window.clearTimeout(dismissTimerRef.current), []);

  useEffect(() => {
    if (!open && !embedded) setFormExpanded(false);
  }, [embedded, open]);

  useEffect(() => {
    if (confirmingDeleteAll) deleteAllConfirmRef.current?.focus();
  }, [confirmingDeleteAll]);

  useEffect(() => {
    if (recipe.length) return;
    setConfirmingDeleteAll(false);
    setDeleteAllRequestTargetId(null);
  }, [recipe.length]);

  useEffect(() => {
    if (!deleteRequest) return;
    if (deleteRequest.target === "prepare-recipe" && recipe.length > 0) {
      setConfirmingDeleteId(null);
      setDeleteAllRequestTargetId(deleteRequest.targetId);
      setConfirmingDeleteAll(true);
    } else if (deleteRequest.target === "recipe-step" && recipe.some((step) => step.id === deleteRequest.targetId)) {
      setConfirmingDeleteAll(false);
      setDeleteAllRequestTargetId(null);
      setConfirmingDeleteId(deleteRequest.targetId);
    }
    onDeleteRequestShown?.(deleteRequest.token);
  }, [deleteRequest, onDeleteRequestShown, recipe]);

  const cancelDeleteAll = () => {
    setConfirmingDeleteAll(false);
    if (deleteAllRequestTargetId) onDeleteConfirmation?.("prepare-recipe", deleteAllRequestTargetId, "cancelled");
    setDeleteAllRequestTargetId(null);
  };

  const confirmDeleteAll = async () => {
    const result = await onChange([], recipe[0]?.id ?? null);
    if (result === null) return;
    setConfirmingDeleteAll(false);
    setEditingId(null);
    dismissForm();
    if (deleteAllRequestTargetId) onDeleteConfirmation?.("prepare-recipe", deleteAllRequestTargetId, "confirmed");
    setDeleteAllRequestTargetId(null);
  };

  const openEdit = (step) => {
    setEditingId(step.id);
    if (step.type === "calculated-field") {
      window.clearTimeout(dismissTimerRef.current);
      setFormExpanded(false);
      setFormOpen(true);
      return;
    }
    revealForm();
  };

  const dismissFormulaModal = () => {
    window.clearTimeout(dismissTimerRef.current);
    setFormOpen(false);
    setFormExpanded(false);
    setEditingId(null);
  };

  const keepFormulaFocusInside = (event) => {
    if (event.key !== "Tab") return;
    const focusable = [...event.currentTarget.querySelectorAll(
      'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
    )].filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
    if (!focusable.length) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const submitEdit = (type, params) => {
    const next = recipe.map((step) => step.id === editingId ? { ...step, type, params: { ...params } } : step);
    if (type === "calculated-field") dismissFormulaModal();
    else dismissForm();
    onChange(next, editingId);
  };

  useEffect(() => {
    if (!formOpen || editingStep?.type !== "calculated-field") return undefined;
    formulaModalRef.current?.focus();
    const closeOnEscape = (event) => {
      if (event.key === "Escape" && !applying) dismissFormulaModal();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [applying, editingStep?.type, formOpen]);

  const startSheetDrag = (event) => {
    if (event.button !== 0) return;
    sheetPointerRef.current = { pointerId: event.pointerId, startY: event.clientY };
    sheetDragMovedRef.current = false;
    setSheetDragging(true);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture can be unavailable for synthetic or interrupted pointer sequences.
    }
  };

  const moveSheetDrag = (event) => {
    if (sheetPointerRef.current?.pointerId !== event.pointerId) return;
    const offset = event.clientY - sheetPointerRef.current.startY;
    if (Math.abs(offset) > 4) sheetDragMovedRef.current = true;
    const boundedOffset = formExpanded ? Math.max(0, offset) : Math.min(0, offset);
    sheetDragOffsetRef.current = boundedOffset;
    setSheetDragOffset(boundedOffset);
  };

  const finishSheetDrag = (event) => {
    if (sheetPointerRef.current?.pointerId !== event.pointerId) return;
    if (formExpanded && sheetDragOffsetRef.current > 56) setFormExpanded(false);
    if (!formExpanded && sheetDragOffsetRef.current < -56) setFormExpanded(true);
    sheetPointerRef.current = null;
    sheetDragOffsetRef.current = 0;
    setSheetDragging(false);
    setSheetDragOffset(0);
  };

  const toggleSheet = () => {
    if (sheetDragMovedRef.current) {
      sheetDragMovedRef.current = false;
      return;
    }
    setFormExpanded((current) => !current);
  };

  const move = (index, offset) => {
    const target = index + offset;
    if (target < 0 || target >= recipe.length) return;
    const next = [...recipe];
    const [step] = next.splice(index, 1);
    next.splice(target, 0, step);
    onChange(next, step.id);
  };

  const dropAt = (targetId) => {
    if (!draggedId || draggedId === targetId) return;
    const next = [...recipe];
    const sourceIndex = next.findIndex((step) => step.id === draggedId);
    const targetIndex = next.findIndex((step) => step.id === targetId);
    const [step] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, step);
    setDraggedId(null);
    onChange(next, step.id);
  };

  return (
    <aside
      ref={panelRef}
      className={`steps-panel ${embedded ? "steps-panel--embedded" : open ? "steps-panel--open" : "steps-panel--closed"}`}
      aria-label={t("stepHistory")}
      aria-hidden={embedded ? undefined : !open}
      inert={embedded || open ? undefined : true}
    >
      <header className="steps-panel__header">
        <div><strong>{embedded ? t("steps") : t("cleanBuildPanel")}</strong><span>{t("recordedSteps", { count: recipe.length })}</span></div>
        {!embedded && <button type="button" onClick={() => { setFormExpanded(false); onClose(); }} aria-label={t("closeSteps")}><X weight="bold" /></button>}
      </header>

      <div className="steps-panel__history">
        <button type="button" onClick={onUndo} disabled={!canUndo || applying}><ArrowCounterClockwise /> {t("undo")}</button>
        <button type="button" onClick={onRedo} disabled={!canRedo || applying}><ArrowClockwise /> {t("redo")}</button>
        {recipe.length > 0 && <button className="steps-panel__delete-all" type="button" onClick={() => { setConfirmingDeleteId(null); setDeleteAllRequestTargetId(null); setConfirmingDeleteAll(true); }} disabled={applying}><Trash /> {t("deleteAllSteps")}</button>}
      </div>

      {confirmingDeleteAll && (
        <div className="steps-panel__delete-all-confirm" role="alertdialog" aria-labelledby="delete-all-steps-title" aria-describedby="delete-all-steps-description" onKeyDown={(event) => { if (event.key === "Escape" && !applying) cancelDeleteAll(); }}>
          <div>
            <strong id="delete-all-steps-title">{t(recipe.length === 1 ? "confirmDeleteAllStep" : "confirmDeleteAllSteps", { count: recipe.length })}</strong>
            <span id="delete-all-steps-description">{t("deleteAllStepsDescription")}</span>
          </div>
          <div>
            <button type="button" disabled={applying} onClick={cancelDeleteAll}>{t("cancel")}</button>
            <button ref={deleteAllConfirmRef} className="steps-panel__delete-all-confirm-action" type="button" disabled={applying} onClick={() => void confirmDeleteAll()}>{t("deleteAllSteps")}</button>
          </div>
        </div>
      )}

      {error && <div className="steps-panel__error" role="alert"><WarningCircle weight="fill" />{error}</div>}

      <div className="steps-list">
        {recipe.map((step, index) => {
          const state = stateById.get(step.id);
          const invalid = invalidStepId === step.id || state?.status === "invalid" || state?.status === "blocked";
          const valueRowAction = valueRowActionFor(step);
          const stepTitle = valueRowAction === "keep" ? t("keepRows") : valueRowAction === "delete" ? t("deleteRows") : toolLabel(step.type);
          const stepSummary = valueRowAction
            ? t("valueRowStepSummary", {
              column: step.params?.column ?? "?",
              value: step.params?.value === null || step.params?.value === undefined ? t("emptyValue") : String(step.params.value),
            })
            : summarizeStep(step);
          const statusLabel = invalid ? t("invalid") : state?.status === "disabled" || step.enabled === false ? t("inactive") : null;
          return (
            <article
              key={step.id}
              className={`step-card ${step.enabled === false ? "step-card--disabled" : ""} ${invalid ? "step-card--invalid" : ""} ${previewedStepId === step.id ? "step-card--previewed" : ""}`}
              draggable={!applying}
              onDragStart={() => setDraggedId(step.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => dropAt(step.id)}
            >
              <span className="step-card__index">{index + 1}</span>
              <DotsSixVertical className="step-card__drag" aria-hidden="true" />
              <div className="step-card__body">
                <strong>{stepTitle}</strong>
                <span>{stepSummary}</span>
                {statusLabel && <small>{statusLabel}</small>}
              </div>
              <div className="step-card__actions">
                <button type="button" onClick={() => move(index, -1)} disabled={index === 0 || applying} aria-label={t("moveStepUp")}><ArrowUp /></button>
                <button type="button" onClick={() => move(index, 1)} disabled={index === recipe.length - 1 || applying} aria-label={t("moveStepDown")}><ArrowDown /></button>
                <button type="button" onClick={() => onChange(recipe.map((item) => item.id === step.id ? { ...item, enabled: item.enabled === false } : item), step.id)} disabled={applying} aria-label={step.enabled === false ? t("enableStep") : t("disableStep")}><Power /></button>
                <button type="button" onClick={() => openEdit(step)} disabled={applying} aria-label={t("editStep")}><PencilSimple /></button>
                <button type="button" onClick={() => onPreview(index)} disabled={applying || invalid} aria-label={t("previewStep")}><Eye /></button>
                <button type="button" onClick={() => onChange(recipe.filter((item) => item.id !== step.id), step.id)} disabled={applying} aria-label={t("deleteStep")}><Trash /></button>
              </div>
              {confirmingDeleteId === step.id && <div className="step-card__delete-confirm"><span>{t("confirmDeleteStep")}</span><button type="button" onClick={() => { setConfirmingDeleteId(null); onDeleteConfirmation?.("recipe-step", step.id, "cancelled"); }}>{t("cancel")}</button><button type="button" disabled={applying} onClick={() => { setConfirmingDeleteId(null); onChange(recipe.filter((item) => item.id !== step.id), step.id); onDeleteConfirmation?.("recipe-step", step.id, "confirmed"); }}>{t("delete")}</button></div>}
            </article>
          );
        })}
        {!recipe.length && <div className="steps-empty"><strong>{t("noTransforms")}</strong><span>{t("chooseToolHint")}</span></div>}
      </div>

      {formOpen && editingId && editingStep?.type !== "calculated-field" ? (
        <section
          className={`step-form-sheet ${formExpanded ? "step-form-sheet--expanded" : "step-form-sheet--collapsed"} ${sheetDragging ? "step-form-sheet--dragging" : ""}`}
          style={sheetDragging ? {
            transform: formExpanded
              ? `translateY(${Math.max(0, sheetDragOffset)}px)`
              : `translateY(calc(100% - 30px + ${Math.min(0, sheetDragOffset)}px))`,
          } : undefined}
          aria-label={t("editTrackedStep")}
        >
          <button
            className="step-form-sheet__handle"
            type="button"
            aria-expanded={formExpanded}
            aria-label={formExpanded ? t("lowerStepForm") : t("raiseStepForm")}
            onClick={toggleSheet}
            onPointerDown={startSheetDrag}
            onPointerMove={moveSheetDrag}
            onPointerUp={finishSheetDrag}
            onPointerCancel={finishSheetDrag}
          >
            <CaretDown weight="bold" />
          </button>
          <TransformationForm
            key={editingId}
            columns={columns}
            initialType={editingStep?.type}
            initialParams={{ ...DEFAULT_PARAMS[editingStep?.type], ...editingStep?.params }}
            title={t("editStep")}
            submitLabel={t("save")}
            applying={applying}
            onSubmit={submitEdit}
            onCancel={dismissForm}
          />
        </section>
      ) : null}

      {formOpen && editingId && editingStep?.type === "calculated-field" ? createPortal(
        <div
          className="formula-step-modal-backdrop"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget && !applying) dismissFormulaModal();
          }}
        >
          <section
            ref={formulaModalRef}
            className="formula-step-modal"
            role="dialog"
            aria-modal="true"
            aria-label={t("editFormulaColumn")}
            tabIndex={-1}
            onKeyDown={keepFormulaFocusInside}
          >
            <FormulaColumnEditor
              key={editingId}
              schema={editingSchema}
              initialParams={editingStep.params}
              title={t("editFormulaColumn")}
              submitLabel={t("save")}
              applying={applying}
              onPreview={onPreviewDraft ? (params, referencedColumns) => onPreviewDraft(editingId, params, referencedColumns) : undefined}
              onSubmit={(params) => submitEdit("calculated-field", params)}
              onCancel={dismissFormulaModal}
            />
          </section>
        </div>,
        document.body,
      ) : null}
    </aside>
  );
}
