import { useEffect, useMemo, useRef, useState } from "react";
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
} from "./transformations.js";
import { useI18n } from "./i18n.jsx";

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

  const changeType = (type) => {
    setDraftType(type);
    setParams(defaultParamsFor(type, availableColumns, initialColumn));
  };

  return (
    <form className="step-form" onSubmit={(event) => { event.preventDefault(); onSubmit(draftType, { ...params }); }}>
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
        .map((definition) => <StepField key={definition[0]} definition={definition} value={params[definition[0]]} columns={availableColumns} onChange={(value) => setParams((current) => ({ ...current, [definition[0]]: value }))} />)}
      {error && <div className="step-form__error" role="alert"><WarningCircle weight="fill" />{error}</div>}
      <footer><button type="button" onClick={onCancel}>{t("cancel")}</button><button type="submit" disabled={applying}>{applying ? t("applying") : submitLabel}</button></footer>
    </form>
  );
}

export function StepsPanel({
  open,
  embedded = false,
  panelRef,
  columns,
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
  previewedStepId,
}) {
  const { t, toolLabel } = useI18n();
  const [formOpen, setFormOpen] = useState(false);
  const [formExpanded, setFormExpanded] = useState(false);
  const [sheetDragging, setSheetDragging] = useState(false);
  const [sheetDragOffset, setSheetDragOffset] = useState(0);
  const [editingId, setEditingId] = useState(null);
  const [draggedId, setDraggedId] = useState(null);
  const sheetPointerRef = useRef(null);
  const sheetDragOffsetRef = useRef(0);
  const sheetDragMovedRef = useRef(false);
  const dismissTimerRef = useRef(null);
  const stateById = useMemo(() => new Map(stepStates.map((state) => [state.id, state])), [stepStates]);

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

  const openEdit = (step) => {
    setEditingId(step.id);
    revealForm();
  };

  const submitEdit = (type, params) => {
    const next = recipe.map((step) => step.id === editingId ? { ...step, type, params: { ...params } } : step);
    dismissForm();
    onChange(next, editingId);
  };

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
      </div>

      {error && <div className="steps-panel__error" role="alert"><WarningCircle weight="fill" />{error}</div>}

      <div className="steps-list">
        {recipe.map((step, index) => {
          const state = stateById.get(step.id);
          const invalid = invalidStepId === step.id || state?.status === "invalid" || state?.status === "blocked";
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
                <strong>{toolLabel(step.type)}</strong>
                <span>{summarizeStep(step)}</span>
                <small>{invalid ? t("invalid") : state?.status === "disabled" || step.enabled === false ? t("inactive") : t("valid")}</small>
              </div>
              <div className="step-card__actions">
                <button type="button" onClick={() => move(index, -1)} disabled={index === 0 || applying} aria-label={t("moveStepUp")}><ArrowUp /></button>
                <button type="button" onClick={() => move(index, 1)} disabled={index === recipe.length - 1 || applying} aria-label={t("moveStepDown")}><ArrowDown /></button>
                <button type="button" onClick={() => onChange(recipe.map((item) => item.id === step.id ? { ...item, enabled: item.enabled === false } : item), step.id)} disabled={applying} aria-label={step.enabled === false ? t("enableStep") : t("disableStep")}><Power /></button>
                <button type="button" onClick={() => openEdit(step)} disabled={applying} aria-label={t("editStep")}><PencilSimple /></button>
                <button type="button" onClick={() => onPreview(index)} disabled={applying || invalid} aria-label={t("previewStep")}><Eye /></button>
                <button type="button" onClick={() => onChange(recipe.filter((item) => item.id !== step.id), step.id)} disabled={applying} aria-label={t("deleteStep")}><Trash /></button>
              </div>
            </article>
          );
        })}
        {!recipe.length && <div className="steps-empty"><strong>{t("noTransforms")}</strong><span>{t("chooseToolHint")}</span></div>}
      </div>

      {formOpen && editingId ? (
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
            initialType={recipe.find((step) => step.id === editingId)?.type}
            initialParams={{ ...DEFAULT_PARAMS[recipe.find((step) => step.id === editingId)?.type], ...recipe.find((step) => step.id === editingId)?.params }}
            title={t("editStep")}
            submitLabel={t("save")}
            applying={applying}
            onSubmit={submitEdit}
            onCancel={dismissForm}
          />
        </section>
      ) : null}
    </aside>
  );
}
