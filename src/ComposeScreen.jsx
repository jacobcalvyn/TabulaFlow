import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CaretDown, CaretUp, CheckCircle, Copy, CornersOut, Database, DownloadSimple, FileXls, Intersect, LinkSimple, MagnifyingGlassMinus, MagnifyingGlassPlus, PencilSimple, PlugsConnected, Plus, SlidersHorizontal, Trash, TreeStructure, X } from "@phosphor-icons/react";
import { MdJoinFull, MdJoinInner, MdJoinLeft, MdJoinRight } from "react-icons/md";
import { calculateGraphFit } from "./composeViewport.js";
import { useI18n } from "./i18n.jsx";

const NODE_WIDTH = 230;
const NODE_HEIGHT = 104;
const BUILDER_WIDTH = 660;
const UNARY_OPERATION_KINDS = new Set(["aggregate", "filter-rows", "distinct-rows", "pivot", "unpivot"]);
const OPERATION_LABEL_KEYS = {
  join: "join",
  append: "append",
  difference: "difference",
  aggregate: "aggregate",
  "filter-rows": "filterRows",
  "distinct-rows": "distinctRows",
  pivot: "pivot",
  unpivot: "unpivot",
};

function operationLabel(kind, t) {
  return t(OPERATION_LABEL_KEYS[kind] ?? kind);
}

function PreviewTable({ preview }) {
  const { t } = useI18n();
  if (!preview) return null;
  return (
    <div className="compose-preview__table">
      <table>
        <thead><tr><th aria-label={t("rowNumber")} />{preview.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
        <tbody>{preview.preview.map((row, index) => <tr key={index}><td>{index + 1}</td>{preview.columns.map((column) => <td key={column}>{row[column] === null || row[column] === undefined ? t("emptyValue") : String(row[column])}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function nodePosition(node, index) {
  if (Number.isFinite(node.position?.x) && Number.isFinite(node.position?.y)) return node.position;
  return { x: 40 + (index % 3) * 300, y: 52 + Math.floor(index / 3) * 160 };
}

function connectionPath(start, end) {
  const x1 = start.x + NODE_WIDTH;
  const y1 = start.y + NODE_HEIGHT / 2;
  const x2 = end.x;
  const y2 = end.y + NODE_HEIGHT / 2;
  const bend = Math.max(60, Math.abs(x2 - x1) / 2);
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`;
}

function OperationInspector({ operation, flow, byId, position, onCancel, onPreviewDraft, onCreateNode, onUpdateNode }) {
  const { formatNumber, t } = useI18n();
  const existing = operation.node ?? null;
  const kind = operation.kind;
  const [leftId, rightId] = operation.inputIds;
  const left = byId.get(leftId);
  const right = byId.get(rightId);
  const leftSchema = left?.schema ?? [];
  const rightSchema = right?.schema ?? [];
  const initialConfig = existing?.config ?? {};
  const [leftKey, setLeftKey] = useState(initialConfig.keyPairs?.[0]?.left ?? leftSchema[0]?.name ?? "");
  const [rightKey, setRightKey] = useState(initialConfig.keyPairs?.[0]?.right ?? rightSchema[0]?.name ?? "");
  const [joinType, setJoinType] = useState(initialConfig.joinType ?? "inner");
  const [differenceMode, setDifferenceMode] = useState(initialConfig.mode ?? "left-only");
  const [joinMenuOpen, setJoinMenuOpen] = useState(false);
  const joinMenuRef = useRef(null);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(true);
  const [draftPreview, setDraftPreview] = useState(null);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    if (!joinMenuOpen) return undefined;
    const closeMenu = (event) => {
      if (!joinMenuRef.current?.contains(event.target)) setJoinMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeMenu);
    return () => document.removeEventListener("pointerdown", closeMenu);
  }, [joinMenuOpen]);

  const buildDraft = () => {
    const config = kind === "join" ? {
      joinType,
      collisionPolicy: "suffix",
      keyPairs: [{ left: leftKey, right: rightKey }],
      leftSuffix: "_left",
      rightSuffix: "_right",
    } : kind === "difference" ? {
      mode: differenceMode,
      keyPairs: [{ left: leftKey, right: rightKey }],
    } : {};
    return {
      kind,
      name: existing?.name ?? `${operationLabel(kind, t)} ${flow.composeNodes.length + 1}`,
      inputIds: [leftId, rightId],
      config,
      position: existing?.position ?? operation.position,
    };
  };

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      setValidating(true);
      setFormError("");
      try {
        const result = await onPreviewDraft(buildDraft(), existing?.id ?? null);
        if (active) setDraftPreview(result);
      } catch (cause) {
        if (!active) return;
        setDraftPreview(null);
        setFormError(cause instanceof Error ? cause.message : t("composePreviewFailed"));
      } finally {
        if (active) setValidating(false);
      }
    }, 220);
    return () => { active = false; window.clearTimeout(timer); };
  }, [leftKey, rightKey, joinType, differenceMode]);

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setFormError("");
    try {
      if (existing) await onUpdateNode(existing.id, buildDraft());
      else await onCreateNode(buildDraft());
      onCancel();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : t(existing ? "composeUpdateFailed" : "composeCreateFailed"));
    } finally {
      setSaving(false);
    }
  };

  const leftKeyColumn = leftSchema.find((column) => column.name === leftKey);
  const rightKeyColumn = rightSchema.find((column) => column.name === rightKey);
  const keysCompatible = Boolean(leftKeyColumn && rightKeyColumn && leftKeyColumn.type === rightKeyColumn.type);
  const joinDescriptions = { inner: t("innerJoinDescription"), left: t("leftJoinDescription"), right: t("rightJoinDescription"), full: t("fullJoinDescription") };
  const joinOptions = [
    { value: "inner", Icon: MdJoinInner },
    { value: "left", Icon: MdJoinLeft },
    { value: "right", Icon: MdJoinRight },
    { value: "full", Icon: MdJoinFull },
  ];
  const ActiveJoinIcon = joinOptions.find((option) => option.value === joinType)?.Icon ?? MdJoinInner;

  return (
    <form className="compose-operation-popover compose-operation-builder" style={{ transform: `translate(${position.x}px, ${position.y}px)` }} onSubmit={submit}>
      <header>
        <div><span>{kind === "join" ? t("joinConfiguration") : kind === "difference" ? t("differenceConfiguration") : t("appendConfiguration")}</span>{existing && <em>{t("savedOperation")}</em>}</div>
        <div><button type="button" onClick={onCancel} aria-label={t("closeForm")} title={t("closeForm")}><X /></button></div>
      </header>
      <section className="compose-builder-body">
        <div className="compose-builder-route" aria-label={t("connectedDatasets")}>
          <div><Database /><span><strong>{left?.name}</strong><small>{leftSchema.length} {t("columns")}</small></span></div>
          {kind === "join" ? <div className="compose-join-mode-picker" ref={joinMenuRef}>
            <button type="button" className={joinMenuOpen ? "compose-builder-route__operation is-open" : "compose-builder-route__operation"} onClick={() => setJoinMenuOpen((open) => !open)} aria-expanded={joinMenuOpen}>
              <ActiveJoinIcon /><span><strong>{t("join")}</strong><small>{joinType[0].toUpperCase() + joinType.slice(1)}</small></span><CaretDown />
            </button>
            {joinMenuOpen && <div className="compose-join-mode-menu">
              {joinOptions.map(({ value, Icon }) => <button key={value} className={joinType === value ? "is-active" : ""} type="button" onClick={() => { setJoinType(value); setJoinMenuOpen(false); }}>
                <Icon />
                <span><strong>{value[0].toUpperCase() + value.slice(1)}</strong><small>{joinDescriptions[value]}</small></span>
              </button>)}
            </div>}
          </div> : <div><Intersect weight="bold" /><span><strong>{operationLabel(kind, t)}</strong><small>{kind === "difference" ? t(differenceMode === "left-only" ? "leftOnly" : "rightOnly") : t("append")}</small></span></div>}
          <div><Database /><span><strong>{right?.name}</strong><small>{rightSchema.length} {t("columns")}</small></span></div>
        </div>

        {kind === "difference" && <div className="compose-difference-mode" role="group" aria-label={t("differenceMode")}>
          <button className={differenceMode === "left-only" ? "is-active" : ""} type="button" onClick={() => setDifferenceMode("left-only")}>{t("leftOnly")}</button>
          <button className={differenceMode === "right-only" ? "is-active" : ""} type="button" onClick={() => setDifferenceMode("right-only")}>{t("rightOnly")}</button>
        </div>}

        {(kind === "join" || kind === "difference") && <>
          <div className="compose-builder-section">
            <div className="compose-builder-section__title"><b>1</b><strong>{t("matchingKeys")}</strong></div>
            <div className="compose-key-match">
              <label><span><Database />{left?.name}</span><select value={leftKey} onChange={(event) => setLeftKey(event.target.value)}>{leftSchema.map((column) => <option key={column.name} value={column.name}>{column.name} · {column.type}</option>)}</select></label>
              <span className="compose-key-equals">=</span>
              <label><span><Database />{right?.name}</span><select value={rightKey} onChange={(event) => setRightKey(event.target.value)}>{rightSchema.map((column) => <option key={column.name} value={column.name}>{column.name} · {column.type}</option>)}</select></label>
              <div className={keysCompatible ? "compose-compatible" : "compose-compatible compose-compatible--error"}>{keysCompatible && <CheckCircle weight="fill" />}<span><strong>{t(keysCompatible ? "compatible" : "incompatible")}</strong><small>{t(keysCompatible ? "sameDataType" : "differentDataType")}</small></span></div>
            </div>
          </div>
        </>}

      </section>
      <footer>
        <div className={formError ? "compose-validation compose-validation--error" : "compose-validation"}>{validating ? <span>{t("validatingAutomatically")}</span> : draftPreview ? <><CheckCircle weight="fill" /><span><strong>{t("configurationValid")}</strong><small>{formatNumber(draftPreview.rowCount)} {t("estimatedRows")} · {draftPreview.schema.length} {t("columns")}</small></span></> : <span>{formError}</span>}</div>
        <div><button type="button" onClick={onCancel}>{t("cancel")}</button><button className="button--primary" type="submit" disabled={saving || validating || !draftPreview}>{saving ? t("loading") : t(existing ? "save" : kind === "join" ? "createJoin" : kind === "difference" ? "createDifference" : "createAppend")}</button></div>
      </footer>
    </form>
  );
}

function UnaryOperationInspector({ operation, flow, byId, position, onCancel, onPreviewDraft, onCreateNode, onUpdateNode }) {
  const { formatNumber, t } = useI18n();
  const existing = operation.node ?? null;
  const kind = operation.kind;
  const inputId = operation.inputIds[0];
  const input = byId.get(inputId);
  const schema = input?.schema ?? [];
  const names = schema.map((column) => column.name);
  const initial = existing?.config ?? {};
  const [column, setColumn] = useState(initial.conditions?.[0]?.column ?? names[0] ?? "");
  const [operator, setOperator] = useState(initial.conditions?.[0]?.operator ?? "equals");
  const [value, setValue] = useState(initial.conditions?.[0]?.value ?? "");
  const [selectedColumns, setSelectedColumns] = useState(() => initial.columns ?? initial.valueColumns ?? (kind === "unpivot" ? [] : names));
  const [distinctMode, setDistinctMode] = useState(initial.mode ?? "representative-rows");
  const [groupColumn, setGroupColumn] = useState(initial.groupBy?.[0] ?? "");
  const [aggregateFunction, setAggregateFunction] = useState(initial.measures?.[0]?.function ?? initial.aggregate ?? "count");
  const [measureColumn, setMeasureColumn] = useState(initial.measures?.[0]?.column ?? initial.valueColumn ?? names[0] ?? "");
  const [alias, setAlias] = useState(initial.measures?.[0]?.alias ?? "count");
  const [aggregateMeasures, setAggregateMeasures] = useState(() => (initial.measures?.length ? initial.measures : [{ function: "count", column: "", alias: "count" }]).map((measure) => ({ ...measure, percentile: measure.percentile ?? 0.9 })));
  const [minimumSampleSize, setMinimumSampleSize] = useState(initial.minimumSampleSize ?? 1);
  const [suppressSmallGroups, setSuppressSmallGroups] = useState(initial.suppressSmallGroups === true);
  const reusableMetrics = (flow.metricDefinitions ?? []).filter((metric) => metric.targetId === inputId);
  const [pivotColumn, setPivotColumn] = useState(initial.pivotColumn ?? names[0] ?? "");
  const [pivotValues, setPivotValues] = useState((initial.values ?? []).join(", "));
  const [fieldColumn, setFieldColumn] = useState(initial.fieldColumn ?? "field");
  const [valueColumn, setValueColumn] = useState(initial.valueColumn ?? "value");
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(true);
  const [draftPreview, setDraftPreview] = useState(null);
  const [formError, setFormError] = useState("");
  const hidesValue = ["is-null", "is-not-null", "is-empty", "is-not-empty"].includes(operator);

  const buildConfig = () => {
    if (kind === "filter-rows") {
      if (!hidesValue && !value.trim()) throw new Error(t("filterValueRequired"));
      return { conjunction: "and", conditions: [{ column, operator, value }] };
    }
    if (kind === "distinct-rows") return { columns: selectedColumns, mode: distinctMode };
    if (kind === "aggregate") return {
      groupBy: groupColumn ? [groupColumn] : [],
      measures: aggregateMeasures.map((measure) => ({
        function: measure.function,
        column: measure.function === "count" ? "" : measure.column,
        alias: measure.alias.trim() || measure.function.replace("-", "_"),
        ...(measure.function === "percentile" ? { percentile: Number(measure.percentile) } : {}),
      })),
      minimumSampleSize: Number(minimumSampleSize) || 1,
      suppressSmallGroups,
    };
    if (kind === "pivot") return {
      groupBy: groupColumn ? [groupColumn] : [],
      pivotColumn,
      valueColumn: measureColumn,
      aggregate: aggregateFunction,
      values: pivotValues.split(",").map((item) => item.trim()).filter(Boolean),
    };
    if (kind === "unpivot") return {
      idColumns: names.filter((name) => !selectedColumns.includes(name)),
      valueColumns: selectedColumns,
      fieldColumn: fieldColumn.trim() || "field",
      valueColumn: valueColumn.trim() || "value",
    };
    return {};
  };

  const buildDraft = () => ({
    kind,
    name: existing?.name ?? `${operationLabel(kind, t)} ${flow.composeNodes.length + 1}`,
    inputIds: [inputId],
    config: buildConfig(),
    position: existing?.position ?? operation.position,
  });

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(async () => {
      setValidating(true);
      setFormError("");
      try {
        const result = await onPreviewDraft(buildDraft(), existing?.id ?? null);
        if (active) setDraftPreview(result);
      } catch (cause) {
        if (!active) return;
        setDraftPreview(null);
        setFormError(cause instanceof Error ? cause.message : t("composePreviewFailed"));
      } finally {
        if (active) setValidating(false);
      }
    }, 220);
    return () => { active = false; window.clearTimeout(timer); };
  }, [kind, column, operator, value, selectedColumns, distinctMode, groupColumn, aggregateFunction, measureColumn, alias, aggregateMeasures, minimumSampleSize, suppressSmallGroups, pivotColumn, pivotValues, fieldColumn, valueColumn]);

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    setFormError("");
    try {
      if (existing) await onUpdateNode(existing.id, buildDraft());
      else await onCreateNode(buildDraft());
      onCancel();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : t(existing ? "composeUpdateFailed" : "composeCreateFailed"));
    } finally {
      setSaving(false);
    }
  };

  const toggleColumn = (name) => setSelectedColumns((current) => current.includes(name) ? current.filter((item) => item !== name) : [...current, name]);
  const filterOperators = ["equals", "not-equals", "contains", "not-contains", "greater-than", "greater-or-equal", "less-than", "less-or-equal", "is-null", "is-not-null", "is-empty", "is-not-empty"];
  const aggregateFunctions = ["count", "sum", "average", "min", "max", "count-distinct", "median", "percentile"];
  const updateAggregateMeasure = (index, changes) => setAggregateMeasures((current) => current.map((measure, measureIndex) => measureIndex === index ? { ...measure, ...changes } : measure));

  return (
    <form className="compose-operation-popover compose-operation-builder compose-unary-builder" style={{ transform: `translate(${position.x}px, ${position.y}px)` }} onSubmit={submit}>
      <header><div><span>{operationLabel(kind, t)} {t("configuration")}</span>{existing && <em>{t("savedOperation")}</em>}</div><div><button type="button" onClick={onCancel} aria-label={t("closeForm")}><X /></button></div></header>
      <section className="compose-builder-body">
        {kind === "filter-rows" && <div className="compose-unary-fields compose-unary-fields--three">
          <label><span>{t("filterColumn")}</span><select value={column} onChange={(event) => setColumn(event.target.value)}>{names.map((name) => <option key={name}>{name}</option>)}</select></label>
          <label><span>{t("filterOperator")}</span><select value={operator} onChange={(event) => setOperator(event.target.value)}>{filterOperators.map((item) => <option key={item} value={item}>{t(item.replace(/-([a-z])/g, (_, char) => char.toUpperCase()))}</option>)}</select></label>
          {!hidesValue && <label><span>{t("filterValue")}</span><input value={value} onChange={(event) => setValue(event.target.value)} /></label>}
        </div>}

        {kind === "aggregate" && <div className="compose-aggregate-editor">
          {reusableMetrics.length > 0 && <label className="compose-reusable-metric"><span>{t("reusableMetric")}</span><select defaultValue="" onChange={(event) => {
            const metric = reusableMetrics.find((item) => item.id === event.target.value);
            if (metric) setAggregateMeasures((current) => [...current, { function: metric.function, column: metric.column ?? "", alias: metric.name, percentile: metric.percentile ?? 0.9 }]);
            event.target.value = "";
          }}><option value="">{t("addReusableMetric")}</option>{reusableMetrics.map((metric) => <option key={metric.id} value={metric.id}>{metric.name}</option>)}</select></label>}
          <div className="compose-unary-fields">
            <label><span>{t("groupBy")}</span><select value={groupColumn} onChange={(event) => setGroupColumn(event.target.value)}><option value="">{t("none")}</option>{names.map((name) => <option key={name}>{name}</option>)}</select></label>
            <label><span>{t("minimumSampleSize")}</span><input type="number" min="1" value={minimumSampleSize} onChange={(event) => setMinimumSampleSize(event.target.value)} /></label>
            <label className="compose-checkbox-field"><input type="checkbox" checked={suppressSmallGroups} disabled={!groupColumn} onChange={(event) => setSuppressSmallGroups(event.target.checked)} /><span>{t("suppressSmallGroups")}</span></label>
          </div>
          <div className="compose-metric-list">
            {aggregateMeasures.map((measure, index) => <div className={`compose-metric-row compose-metric-row--${measure.function}`} key={index}>
              <label><span>{t("aggregateFunction")}</span><select value={measure.function} onChange={(event) => updateAggregateMeasure(index, { function: event.target.value, column: measure.column || names[0] || "" })}>{aggregateFunctions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
              {measure.function !== "count" && <label><span>{t("measure")}</span><select value={measure.column || names[0] || ""} onChange={(event) => updateAggregateMeasure(index, { column: event.target.value })}>{names.map((name) => <option key={name}>{name}</option>)}</select></label>}
              {measure.function === "percentile" && <label><span>{t("percentile")}</span><input type="number" min="0.01" max="0.99" step="0.01" value={measure.percentile} onChange={(event) => updateAggregateMeasure(index, { percentile: event.target.value })} /></label>}
              <label><span>{t("alias")}</span><input value={measure.alias} onChange={(event) => updateAggregateMeasure(index, { alias: event.target.value })} /></label>
              <button type="button" className="compose-metric-row__remove" aria-label={t("removeMetric")} disabled={aggregateMeasures.length === 1} onClick={() => setAggregateMeasures((current) => current.filter((_, measureIndex) => measureIndex !== index))}><Trash /></button>
            </div>)}
            <button type="button" className="compose-add-metric" onClick={() => setAggregateMeasures((current) => [...current, { function: "count", column: "", alias: `count_${current.length + 1}`, percentile: 0.9 }])}><Plus weight="bold" />{t("addMetric")}</button>
          </div>
        </div>}

        {kind === "pivot" && <div className="compose-unary-fields">
          <label><span>{t("groupBy")}</span><select value={groupColumn} onChange={(event) => setGroupColumn(event.target.value)}><option value="">{t("none")}</option>{names.map((name) => <option key={name}>{name}</option>)}</select></label>
          <label><span>{t("pivotColumn")}</span><select value={pivotColumn} onChange={(event) => setPivotColumn(event.target.value)}>{names.map((name) => <option key={name}>{name}</option>)}</select></label>
          <label><span>{t("measure")}</span><select value={measureColumn} onChange={(event) => setMeasureColumn(event.target.value)}>{names.map((name) => <option key={name}>{name}</option>)}</select></label>
          <label><span>{t("aggregateFunction")}</span><select value={aggregateFunction} onChange={(event) => setAggregateFunction(event.target.value)}>{aggregateFunctions.filter((item) => item !== "count-distinct").map((item) => <option key={item}>{item}</option>)}</select></label>
          <label className="compose-unary-fields__wide"><span>{t("pivotValues")}</span><input value={pivotValues} onChange={(event) => setPivotValues(event.target.value)} placeholder="Jakarta, Bandung" /></label>
        </div>}

        {kind === "distinct-rows" && <div className="compose-distinct-mode">
          <strong>{t("distinctOutputMode")}</strong>
          <div role="group" aria-label={t("distinctOutputMode")}>
            <button type="button" className={distinctMode === "representative-rows" ? "is-active" : ""} aria-pressed={distinctMode === "representative-rows"} onClick={() => setDistinctMode("representative-rows")}>{t("representativeRows")}</button>
            <button type="button" className={distinctMode === "project-columns" ? "is-active" : ""} aria-pressed={distinctMode === "project-columns"} onClick={() => setDistinctMode("project-columns")}>{t("projectDistinctColumns")}</button>
          </div>
        </div>}
        {(kind === "distinct-rows" || kind === "unpivot") && <div className="compose-checkbox-list"><strong>{t(kind === "distinct-rows" ? "comparisonColumns" : "unpivotColumns")}</strong><div>{schema.map((item) => <label key={item.name}><input type="checkbox" checked={selectedColumns.includes(item.name)} onChange={() => toggleColumn(item.name)} /><span>{item.name}</span><small>{item.type}</small></label>)}</div></div>}
        {kind === "unpivot" && <div className="compose-unary-fields"><label><span>{t("fieldColumnName")}</span><input value={fieldColumn} onChange={(event) => setFieldColumn(event.target.value)} /></label><label><span>{t("valueColumnName")}</span><input value={valueColumn} onChange={(event) => setValueColumn(event.target.value)} /></label></div>}
      </section>
      <footer><div className={formError ? "compose-validation compose-validation--error" : "compose-validation"}>{validating ? <span>{t("validatingAutomatically")}</span> : draftPreview ? <><CheckCircle weight="fill" /><span><strong>{t("configurationValid")}</strong><small>{formatNumber(draftPreview.rowCount)} {t("estimatedRows")} · {draftPreview.schema.length} {t("columns")}</small></span></> : <span>{formError}</span>}</div><div><button type="button" onClick={onCancel}>{t("cancel")}</button><button className="button--primary" type="submit" disabled={saving || validating || !draftPreview}>{saving ? t("loading") : t(existing ? "save" : "createOperation")}</button></div></footer>
    </form>
  );
}

export function ComposeScreen({ flow, dirty, preview, loading, error, onSelectNode, onPreviewDraft, onCreateNode, onUpdateNode, onDeleteNode, onDeletePrepared, onDeleteMetricDefinition, onMoveNode, onAutoArrange, onDuplicate, onCreatePrepared, onEditPreparation, onExport, onGetNodeQuality, deleteRequest, onDeleteRequestShown, onDeleteConfirmation }) {
  const { formatNumber, t } = useI18n();
  const nodes = useMemo(() => [
    ...flow.preparedInputs.map((node) => ({ ...node, nodeType: "dataset" })),
    ...flow.composeNodes.map((node) => ({ ...node, nodeType: "operation" })),
  ], [flow]);
  const byId = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const sourceById = useMemo(() => new Map(flow.sourceAssets.map((source) => [source.id, source])), [flow.sourceAssets]);
  const [positions, setPositions] = useState(() => Object.fromEntries(nodes.map((node, index) => [node.id, nodePosition(node, index)])));
  const positionsRef = useRef(positions);
  const [dragging, setDragging] = useState(null);
  const [connectingFrom, setConnectingFrom] = useState(null);
  const [creatingPrepared, setCreatingPrepared] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [confirmingPreparedDeleteId, setConfirmingPreparedDeleteId] = useState(null);
  const [confirmingOperationDeleteId, setConfirmingOperationDeleteId] = useState(null);
  const [confirmingMetricDeleteId, setConfirmingMetricDeleteId] = useState(null);
  const [deletingOperationId, setDeletingOperationId] = useState(null);
  const [operationDeleteError, setOperationDeleteError] = useState("");
  const [pendingPair, setPendingPair] = useState(null);
  const [unarySourceId, setUnarySourceId] = useState(null);
  const [operationError, setOperationError] = useState("");
  const [operation, setOperation] = useState(null);

  useEffect(() => {
    if (!deleteRequest) return;
    if (deleteRequest.target === "prepared-dataset" && flow.preparedInputs.some((node) => node.id === deleteRequest.targetId)) {
      setConfirmingPreparedDeleteId(deleteRequest.targetId);
      setConfirmingOperationDeleteId(null);
    } else if (deleteRequest.target === "compose-operation" && flow.composeNodes.some((node) => node.id === deleteRequest.targetId)) {
      setOperationDeleteError("");
      setConfirmingOperationDeleteId(deleteRequest.targetId);
      setConfirmingPreparedDeleteId(null);
      setConfirmingMetricDeleteId(null);
    } else if (deleteRequest.target === "metric-definition" && (flow.metricDefinitions ?? []).some((metric) => metric.id === deleteRequest.targetId)) {
      setConfirmingMetricDeleteId(deleteRequest.targetId);
      setConfirmingPreparedDeleteId(null);
      setConfirmingOperationDeleteId(null);
    }
    onDeleteRequestShown?.(deleteRequest.token);
  }, [deleteRequest, flow.composeNodes, flow.metricDefinitions, flow.preparedInputs, onDeleteRequestShown]);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [nodeQuality, setNodeQuality] = useState(null);
  const [qualityLoading, setQualityLoading] = useState(false);
  const [qualityError, setQualityError] = useState("");

  useEffect(() => {
    setNodeQuality(null);
    setQualityOpen(false);
    setQualityError("");
  }, [flow.activeNodeId]);

  const toggleNodeQuality = async () => {
    if (qualityOpen) {
      setQualityOpen(false);
      return;
    }
    if (!flow.activeNodeId || !onGetNodeQuality) return;
    setQualityOpen(true);
    if (nodeQuality) return;
    setQualityLoading(true);
    setQualityError("");
    try {
      setNodeQuality(await onGetNodeQuality(flow.activeNodeId));
    } catch (cause) {
      setQualityError(cause instanceof Error ? cause.message : t("qualityLoadFailed"));
    } finally {
      setQualityLoading(false);
    }
  };
  const [isMobile, setIsMobile] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 580px)").matches);
  const [viewScale, setViewScale] = useState(1);
  const canvasRef = useRef(null);
  const fittedGraphRef = useRef("");
  const previousCanvasSizeRef = useRef({ width: 0, height: 0 });
  const canvasPositions = positions;

  useEffect(() => {
    const query = window.matchMedia("(max-width: 580px)");
    const update = () => setIsMobile(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    setPositions((current) => {
      const next = {};
      nodes.forEach((node, index) => { next[node.id] = nodePosition(node, index); });
      positionsRef.current = next;
      return next;
    });
  }, [nodes]);

  useEffect(() => {
    if (!dragging) return undefined;
    const move = (event) => {
      const next = { x: Math.max(24, dragging.origin.x + (event.clientX - dragging.start.x) / dragging.scale), y: Math.max(24, dragging.origin.y + (event.clientY - dragging.start.y) / dragging.scale) };
      positionsRef.current = { ...positionsRef.current, [dragging.id]: next };
      setPositions(positionsRef.current);
    };
    const stop = (event) => {
      const next = { x: Math.max(24, dragging.origin.x + (event.clientX - dragging.start.x) / dragging.scale), y: Math.max(24, dragging.origin.y + (event.clientY - dragging.start.y) / dragging.scale) };
      setDragging(null);
      onMoveNode(dragging.id, next);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
  }, [dragging, onMoveNode]);

  useEffect(() => {
    const cancel = (event) => {
      if (event.key !== "Escape") return;
      setConnectingFrom(null);
      setConnectionError("");
      setPendingPair(null);
      setUnarySourceId(null);
      setOperation(null);
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, []);

  useEffect(() => {
    if (!operation) return undefined;
    const dismissInspector = (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || target.closest(".compose-operation-builder")) return;
      setOperation(null);
    };
    document.addEventListener("pointerdown", dismissInspector);
    return () => document.removeEventListener("pointerdown", dismissInspector);
  }, [operation]);

  const dismissConnection = () => {
    setConnectingFrom(null);
    setConnectionError("");
    setUnarySourceId(null);
    setOperationError("");
  };

  const handleCanvasClick = (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const insideConnectionHint = Boolean(target.closest(".compose-connection-hint"));
    const insideOperationPicker = Boolean(target.closest(".compose-operation-picker"));
    const insideNode = Boolean(target.closest(".canvas-node"));

    if (pendingPair && !insideOperationPicker) {
      setPendingPair(null);
      setOperationError("");
    }

    if (unarySourceId && !insideOperationPicker) setUnarySourceId(null);

    if (connectingFrom && !insideConnectionHint && !insideNode) {
      dismissConnection();
    }
  };

  const connect = (nodeId) => {
    if (!connectingFrom) return;
    if (connectingFrom === nodeId) {
      setConnectingFrom(null);
      return;
    }
    setPendingPair([connectingFrom, nodeId]);
    setConnectingFrom(null);
    setConnectionError("");
  };

  const createPreparedDataset = async (event) => {
    event.stopPropagation();
    if (!unarySourceId || creatingPrepared) return;
    const sourceId = unarySourceId;
    const sourceNode = byId.get(sourceId);
    setCreatingPrepared(true);
    setOperationError("");
    const result = sourceNode?.nodeType === "dataset"
      ? await onDuplicate(sourceId)
      : await onCreatePrepared(sourceId);
    setCreatingPrepared(false);
    if (result?.ok) {
      setUnarySourceId(null);
      setConnectingFrom(null);
      return;
    }
    setOperationError(result?.error ?? t("createPreparedFailed"));
  };

  const openContinuationMenu = (nodeId) => {
    setUnarySourceId((current) => current === nodeId ? null : nodeId);
    setConnectingFrom(nodeId);
    setConnectionError("");
    setPendingPair(null);
    setOperationError("");
  };

  const chooseOperation = async (kind) => {
    if (!pendingPair) return;
    const inputIds = pendingPair;
    const left = canvasPositions[inputIds[0]];
    const right = canvasPositions[inputIds[1]];
    const draft = {
      mode: "create",
      kind,
      inputIds,
      position: { x: Math.max(left.x, right.x) + NODE_WIDTH + 90, y: Math.round((left.y + right.y) / 2) },
    };
    setOperationError("");
    setPendingPair(null);
    setOperation(draft);
    if (kind === "join" || kind === "difference") return;
    try {
      await onCreateNode({
        kind: "append",
        name: `${t("append")} ${flow.composeNodes.length + 1}`,
        inputIds,
        config: {},
        position: draft.position,
      });
      setOperation(null);
    } catch (cause) {
      setOperation(null);
      setPendingPair(inputIds);
      setOperationError(cause instanceof Error ? cause.message : t("composeCreateFailed"));
    }
  };

  const chooseUnaryOperation = (kind) => {
    if (!unarySourceId) return;
    const sourcePosition = canvasPositions[unarySourceId];
    setOperation({
      mode: "create",
      kind,
      inputIds: [unarySourceId],
      position: { x: sourcePosition.x + NODE_WIDTH + 90, y: sourcePosition.y },
    });
    setUnarySourceId(null);
    setPendingPair(null);
    setConnectingFrom(null);
  };

  const openOperation = (node) => {
    onSelectNode(node.id);
    setPendingPair(null);
    setConnectingFrom(null);
    setOperation({ mode: "edit", kind: node.kind, inputIds: node.inputIds, node });
  };

  const deleteOperation = async (nodeId) => {
    setDeletingOperationId(nodeId);
    setOperationDeleteError("");
    try {
      await onDeleteNode(nodeId);
      setConfirmingOperationDeleteId(null);
      if (operation?.node?.id === nodeId) setOperation(null);
      return true;
    } catch (cause) {
      setOperationDeleteError(cause?.code === "COMPOSE_NODE_HAS_DESCENDANTS" ? t("deleteDownstreamFirst") : cause instanceof Error ? cause.message : t("composeUpdateFailed"));
      return false;
    } finally {
      setDeletingOperationId(null);
    }
  };

  const canvasWidth = Math.max(isMobile ? 300 : 1000, ...Object.values(canvasPositions).map((position) => position.x + NODE_WIDTH + (isMobile ? 40 : 180)), operation?.position ? operation.position.x + BUILDER_WIDTH + 80 : 0);
  const showInspector = Boolean(operation && !(operation.mode === "create" && operation.kind === "append"));
  const operationAnchor = showInspector ? canvasPositions[operation.node?.id] ?? operation.position : null;
  const inspectorPosition = operationAnchor ? {
    x: Math.max(24, Math.min(operationAnchor.x - (BUILDER_WIDTH - NODE_WIDTH) / 2, canvasWidth - BUILDER_WIDTH - 24)),
    y: operationAnchor.y + NODE_HEIGHT + 14,
  } : null;
  const canvasHeight = Math.max(520, ...Object.values(canvasPositions).map((position) => position.y + NODE_HEIGHT + 160), inspectorPosition ? inspectorPosition.y + 720 : 0);
  const menuPosition = pendingPair ? {
    x: Math.round((canvasPositions[pendingPair[0]].x + canvasPositions[pendingPair[1]].x) / 2 + NODE_WIDTH / 2),
    y: Math.round((canvasPositions[pendingPair[0]].y + canvasPositions[pendingPair[1]].y) / 2 + NODE_HEIGHT + 16),
  } : null;
  const unarySourcePosition = unarySourceId ? canvasPositions[unarySourceId] : null;
  const unaryMenuPosition = unarySourcePosition ? {
    x: unarySourcePosition.x + 34,
    y: unarySourcePosition.y + NODE_HEIGHT + 10,
  } : null;
  const fitGraph = useCallback((behavior = "smooth") => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const viewport = calculateGraphFit({
      positions: positionsRef.current,
      viewportWidth: canvas.clientWidth,
      viewportHeight: canvas.clientHeight,
      nodeWidth: NODE_WIDTH,
      nodeHeight: NODE_HEIGHT,
    });
    setViewScale(viewport.scale);
    window.requestAnimationFrame(() => canvas.scrollTo?.({ left: viewport.scrollLeft, top: viewport.scrollTop, behavior }));
  }, []);

  const graphIdentity = nodes.map((node) => node.id).sort().join(":");

  useEffect(() => {
    if (!graphIdentity || fittedGraphRef.current === graphIdentity) return undefined;
    const frame = window.requestAnimationFrame(() => {
      fitGraph("auto");
      fittedGraphRef.current = graphIdentity;
    });
    return () => window.cancelAnimationFrame?.(frame);
  }, [fitGraph, graphIdentity]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === "undefined") return undefined;
    let frame = 0;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      const height = entry.contentRect.height;
      const previous = previousCanvasSizeRef.current;
      previousCanvasSizeRef.current = { width, height };
      if (!previous.width || (width >= previous.width - 1 && height >= previous.height - 1)) return;
      window.cancelAnimationFrame?.(frame);
      frame = window.requestAnimationFrame(() => fitGraph("auto"));
    });
    observer.observe(canvas);
    return () => {
      window.cancelAnimationFrame?.(frame);
      observer.disconnect();
    };
  }, [fitGraph]);
  const zoomBy = (delta) => setViewScale((current) => Math.max(0.3, Math.min(1.5, Number((current + delta).toFixed(2)))));
  const autoArrange = async () => {
    setOperation(null);
    setPendingPair(null);
    setUnarySourceId(null);
    setConnectingFrom(null);
    const arranged = await onAutoArrange();
    if (!arranged) return;
    const arrangedNodes = [...arranged.preparedInputs, ...arranged.composeNodes];
    const next = Object.fromEntries(arrangedNodes.map((node, index) => [node.id, nodePosition(node, index)]));
    positionsRef.current = next;
    setPositions(next);
    setViewScale(1);
    canvasRef.current?.scrollTo({ left: 0, top: 0, behavior: "smooth" });
  };

  return (
    <main className="compose-screen">
      <header className="compose-toolbar">
        <div><h1>{t("compose")}</h1><p>{connectingFrom ? t("chooseSecondDataset") : t("composeCanvasHint")} {dirty && <span className="compose-dirty">· {t("unsavedChanges")}</span>}</p></div>
        <div className="compose-toolbar__actions"><div className="compose-zoom-controls" role="group" aria-label={t("canvasZoom")}><button type="button" onClick={() => zoomBy(-0.15)} aria-label={t("zoomOut")} title={t("zoomOut")}><MagnifyingGlassMinus /></button><span>{Math.round(viewScale * 100)}%</span><button type="button" onClick={() => zoomBy(0.15)} aria-label={t("zoomIn")} title={t("zoomIn")}><MagnifyingGlassPlus /></button></div><button className="compose-auto-arrange" type="button" onClick={autoArrange}><TreeStructure />{t("autoArrange")}</button><button className="compose-fit-graph" type="button" onClick={() => fitGraph()}><CornersOut />{t("fitGraph")}</button>{connectingFrom && <button className="compose-cancel-connect" type="button" onClick={dismissConnection}><X />{t("cancelConnection")}</button>}</div>
      </header>
      {error && <div className="compose-global-error" role="alert">{error}</div>}
      {confirmingMetricDeleteId && <div className="compose-global-confirmation" role="alertdialog" aria-label={t("confirmDeleteMetricDefinition")}>
        <span>{t("confirmDeleteMetricDefinition")}</span>
        <div><button type="button" onClick={() => { const id = confirmingMetricDeleteId; setConfirmingMetricDeleteId(null); onDeleteConfirmation?.("metric-definition", id, "cancelled"); }}>{t("cancel")}</button><button className="compose-global-confirmation__delete" type="button" onClick={async () => { const id = confirmingMetricDeleteId; const removed = await onDeleteMetricDefinition?.(id); if (removed) { setConfirmingMetricDeleteId(null); onDeleteConfirmation?.("metric-definition", id, "confirmed"); } }}>{t("delete")}</button></div>
      </div>}
      <div className={`compose-layout ${previewOpen ? "compose-layout--preview-open" : "compose-layout--preview-closed"}`}>
        <section ref={canvasRef} className={`compose-canvas ${connectingFrom ? "compose-canvas--connecting" : ""} ${isMobile ? "compose-canvas--mobile" : ""}`} aria-label={t("composeData")} onClick={handleCanvasClick}>
          <div className="compose-canvas__surface" style={{ width: canvasWidth * viewScale, height: canvasHeight * viewScale }}>
            <div className="compose-canvas__scene" style={{ width: canvasWidth, height: canvasHeight, transform: `scale(${viewScale})` }}>
            {connectingFrom && <div className="compose-connection-hint"><PlugsConnected weight="bold" /><span className={connectionError ? "compose-connection-hint__error" : undefined}>{connectionError || t("connectionTargetHint")}</span><button type="button" onClick={dismissConnection}>{t("cancel")}</button></div>}
            <svg className="compose-edges" width={canvasWidth} height={canvasHeight} aria-hidden="true">
              <defs><marker id="compose-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker></defs>
              {flow.composeNodes.flatMap((node) => node.inputIds.map((inputId) => {
                const start = canvasPositions[inputId];
                const end = canvasPositions[node.id];
                if (!start || !end) return null;
                return <path key={`${node.id}:${inputId}`} className={flow.activeNodeId === node.id ? "compose-edge compose-edge--active" : "compose-edge"} d={connectionPath(start, end)} markerEnd="url(#compose-arrow)" />;
              }))}
              {flow.preparedInputs.map((node) => {
                const upstreamNodeId = sourceById.get(node.sourceAssetId)?.upstreamNodeId;
                const start = upstreamNodeId ? canvasPositions[upstreamNodeId] : null;
                const end = canvasPositions[node.id];
                if (!start || !end) return null;
                return <path key={`prepared:${node.id}`} className={flow.activeNodeId === node.id ? "compose-edge compose-edge--active" : "compose-edge"} d={connectionPath(start, end)} markerEnd="url(#compose-arrow)" />;
              })}
              {operation?.mode === "create" && operation.inputIds.map((inputId) => {
                const start = canvasPositions[inputId];
                const end = operation.position;
                if (!start || !end) return null;
                return <path key={`draft:${inputId}`} className="compose-edge compose-edge--draft" d={connectionPath(start, end)} markerEnd="url(#compose-arrow)" />;
              })}
            </svg>

            {operation?.mode === "create" && <article className="canvas-node canvas-node--operation canvas-node--draft" style={{ transform: `translate(${operation.position.x}px, ${operation.position.y}px)` }}>
              <header><span>{t("draftOperation")}</span><strong>{operationLabel(operation.kind, t)}</strong></header>
              <p>{operation.kind === "join" ? `${t("inner")} · ${operation.inputIds.map((id) => byId.get(id)?.name).join(" + ")}` : operation.inputIds.map((id) => byId.get(id)?.name).join(" + ")}</p>
            </article>}

            {nodes.map((node, index) => {
              const position = canvasPositions[node.id] ?? nodePosition(node, index);
              const isDataset = node.nodeType === "dataset";
              const source = isDataset ? sourceById.get(node.sourceAssetId) : null;
              return (
                <article
                  key={node.id}
                  className={`canvas-node canvas-node--${node.nodeType} ${flow.activeNodeId === node.id ? "canvas-node--active" : ""} ${connectingFrom === node.id ? "canvas-node--connecting" : ""} ${connectingFrom && connectingFrom !== node.id ? "canvas-node--target" : ""} ${source?.status === "unlinked" ? "canvas-node--warning" : ""}`}
                  style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
                  onPointerDown={(event) => {
                    if (event.button !== 0 || event.target.closest("button") || connectingFrom) return;
                    event.currentTarget.setPointerCapture?.(event.pointerId);
                    setDragging({ id: node.id, start: { x: event.clientX, y: event.clientY }, origin: position, scale: viewScale });
                  }}
                  onClick={() => {
                    if (connectingFrom && connectingFrom !== node.id) {
                      connect(node.id);
                      return;
                    }
                    onSelectNode(node.id);
                  }}
                >
                  <header><span>{isDataset ? t("dataset") : operationLabel(node.kind, t)}</span><strong>{node.name}</strong></header>
                  <p>{Number.isFinite(node.rowCount) ? formatNumber(node.rowCount) : "—"} {t("rows")} · {node.schema?.length ? node.schema.length : "—"} {t("columns")}</p>
                  {isDataset ? <footer>{confirmingPreparedDeleteId === node.id ? <div className="canvas-node__delete-confirm" onClick={(event) => event.stopPropagation()}><span>{t("confirmDeletePreparedDataset")}</span><button type="button" onClick={() => { setConfirmingPreparedDeleteId(null); onDeleteConfirmation?.("prepared-dataset", node.id, "cancelled"); }}>{t("cancel")}</button><button className="canvas-node__delete-confirm-action" type="button" onClick={async () => { const removed = await onDeletePrepared(node.id); if (removed) { setConfirmingPreparedDeleteId(null); onDeleteConfirmation?.("prepared-dataset", node.id, "confirmed"); } }}>{t("delete")}</button></div> : <><button type="button" onClick={(event) => { event.stopPropagation(); onEditPreparation(node.id); }} title={t("editPreparation")}><PencilSimple />{t("editPreparation")}</button><button type="button" onClick={(event) => { event.stopPropagation(); onDuplicate(node.id); }} title={t("duplicate")}><Copy /></button><button className="canvas-node__delete" type="button" onClick={(event) => { event.stopPropagation(); setConfirmingPreparedDeleteId(node.id); }} aria-label={t("deletePreparedDataset")} title={t("deletePreparedDataset")}><Trash /></button></>}</footer> : <footer>{confirmingOperationDeleteId === node.id ? <div className="canvas-node__delete-confirm" onClick={(event) => event.stopPropagation()}><span>{operationDeleteError || t("confirmDeleteOperation")}</span><button type="button" onClick={() => { setConfirmingOperationDeleteId(null); setOperationDeleteError(""); onDeleteConfirmation?.("compose-operation", node.id, "cancelled"); }}>{t("cancel")}</button><button className="canvas-node__delete-confirm-action" type="button" disabled={deletingOperationId === node.id} onClick={async () => { const removed = await deleteOperation(node.id); if (removed) onDeleteConfirmation?.("compose-operation", node.id, "confirmed"); }}>{deletingOperationId === node.id ? t("loading") : t("delete")}</button></div> : <>{node.kind !== "append" && <button className="canvas-node__settings" type="button" onClick={(event) => { event.stopPropagation(); openOperation(node); }} aria-label={t("settings")} title={t("settings")}><SlidersHorizontal weight="bold" /></button>}<button className="canvas-node__delete" type="button" onClick={(event) => { event.stopPropagation(); setOperationDeleteError(""); setConfirmingOperationDeleteId(node.id); }} aria-label={t("deleteOperation")} title={t("deleteOperation")}><Trash /></button></>}</footer>}
                  <button className="canvas-node__port" type="button" onClick={(event) => { event.stopPropagation(); if (connectingFrom === node.id) dismissConnection(); else if (connectingFrom) connect(node.id); else openContinuationMenu(node.id); }} aria-label={t("continueFromDataset", { dataset: node.name })} title={t("continueFromDataset", { dataset: node.name })}><LinkSimple weight="bold" /></button>
                </article>
              );
            })}

            {!nodes.length && <div className="compose-empty-state"><strong>{t("noPreparedDatasets")}</strong><span>{t("addSourceFirst")}</span></div>}

            {pendingPair && menuPosition && <div className="compose-operation-picker" style={{ transform: `translate(${menuPosition.x}px, ${menuPosition.y}px)` }} role="dialog" aria-label={t("chooseOperation")}>
              <span>{t("chooseOperation")}</span>
              {operationError && <span className="compose-operation-picker__error" role="alert">{operationError}</span>}
              <button type="button" onClick={() => chooseOperation("join")}><strong>{t("join")}</strong><small>{t("joinHint")}</small></button>
              <button type="button" onClick={() => chooseOperation("append")}><strong>{t("append")}</strong><small>{t("appendHint")}</small></button>
              <button type="button" onClick={() => chooseOperation("difference")}><strong>{t("difference")}</strong><small>{t("differenceHint")}</small></button>
              <button className="compose-operation-picker__cancel" type="button" onClick={() => setPendingPair(null)}>{t("cancel")}</button>
            </div>}

            {unarySourceId && unaryMenuPosition && <div className="compose-operation-picker compose-unary-picker" style={{ transform: `translate(${unaryMenuPosition.x}px, ${unaryMenuPosition.y}px)` }} role="dialog" aria-label={t("chooseUnaryOperation")}>
              <span>{t("chooseUnaryOperation")}</span>
              {operationError && <span className="compose-operation-picker__error" role="alert">{operationError}</span>}
              <button type="button" disabled={creatingPrepared} onClick={createPreparedDataset}><strong>{creatingPrepared ? t("loading") : t("createPreparedDataset")}</strong><small>{t(byId.get(unarySourceId)?.nodeType === "dataset" ? "duplicatePreparedDatasetHint" : "createPreparedDatasetHint")}</small></button>
              {["aggregate", "filter-rows", "distinct-rows", "pivot", "unpivot"].map((kind) => <button key={kind} type="button" onClick={() => chooseUnaryOperation(kind)}><strong>{operationLabel(kind, t)}</strong><small>{t(`${OPERATION_LABEL_KEYS[kind]}Hint`)}</small></button>)}
            </div>}

            {showInspector && inspectorPosition && (UNARY_OPERATION_KINDS.has(operation.kind)
              ? <UnaryOperationInspector key={`${operation.mode}:${operation.node?.id ?? operation.inputIds.join(":")}:${operation.kind}`} operation={operation} flow={flow} byId={byId} position={inspectorPosition} onCancel={() => setOperation(null)} onPreviewDraft={onPreviewDraft} onCreateNode={onCreateNode} onUpdateNode={onUpdateNode} />
              : <OperationInspector key={`${operation.mode}:${operation.node?.id ?? operation.inputIds.join(":")}:${operation.kind}`} operation={operation} flow={flow} byId={byId} position={inspectorPosition} onCancel={() => setOperation(null)} onPreviewDraft={onPreviewDraft} onCreateNode={onCreateNode} onUpdateNode={onUpdateNode} />)}
            </div>
          </div>
        </section>

        <section className={`compose-preview ${previewOpen ? "compose-preview--open" : "compose-preview--closed"}`}>
          <header><div><strong>{t("previewData")}</strong>{preview && <span>{formatNumber(preview.rowCount)} {t("rows")} · {preview.columns.length} {t("columns")}</span>}</div><div className="compose-preview__actions">{flow.activeNodeId && <button type="button" onClick={toggleNodeQuality} aria-expanded={qualityOpen}>{t("qualityShort")}</button>}{previewOpen && preview && <><button type="button" onClick={() => onExport("csv")}><DownloadSimple /> CSV</button><button type="button" onClick={() => onExport("xlsx")}><FileXls /> Excel</button></>}<button className="compose-preview__toggle" type="button" onClick={() => setPreviewOpen((current) => !current)} aria-expanded={previewOpen}>{previewOpen ? <CaretDown /> : <CaretUp />}{t(previewOpen ? "hidePreview" : "showPreview")}</button></div></header>
          {qualityOpen && <div className="compose-node-quality" role="status">{qualityLoading ? t("loading") : qualityError || (nodeQuality && <><span>{formatNumber(nodeQuality.emptyCellCount)} {t("emptyCells")}</span><span>{formatNumber(nodeQuality.mixedTypeColumnCount)} {t("mixedColumns")}</span><span>{nodeQuality.semanticCoverage.described}/{nodeQuality.semanticCoverage.total} {t("semanticFields")}</span>{nodeQuality.sampleWarning && <strong>{nodeQuality.sampleWarning}</strong>}</>)}</div>}
          {previewOpen && (loading ? <p>{t("loading")}</p> : error ? <p className="error-message" role="alert">{error}</p> : preview ? <PreviewTable preview={preview} /> : <p>{t("selectNodePreview")}</p>)}
        </section>
      </div>
    </main>
  );
}
