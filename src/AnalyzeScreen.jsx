import { useEffect, useMemo, useState } from "react";
import { CheckCircle, FloppyDisk, Play, Plus, ShieldCheck, Trash, WarningCircle } from "@phosphor-icons/react";
import { AGGREGATIONS, FIELD_ROLES, FIELD_SENSITIVITIES } from "./semanticModel.js";
import { ANALYSIS_FUNCTIONS } from "./analysisEngine.js";
import { VALIDATION_OPERATORS, VALIDATION_SEVERITIES } from "./validationEngine.js";
import { useI18n } from "./i18n.jsx";

function SemanticFieldRow({ field, busy, onSave }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(field);
  useEffect(() => setDraft(field), [field]);
  const numericAggregations = draft.role === "measure" ? AGGREGATIONS : AGGREGATIONS.filter((item) => !["sum", "average", "median", "percentile"].includes(item));
  return (
    <tr>
      <td><strong>{field.name}</strong><span className="analytics-field-type">{field.dataType ?? "—"}</span></td>
      <td><input value={draft.businessName} onChange={(event) => setDraft({ ...draft, businessName: event.target.value })} aria-label={t("businessNameFor", { field: field.name })} /></td>
      <td><select value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value, allowedAggregations: event.target.value === "measure" ? AGGREGATIONS : ["count", "count-distinct"] })}>{FIELD_ROLES.map((item) => <option key={item} value={item}>{item}</option>)}</select></td>
      <td><input value={draft.unit ?? ""} onChange={(event) => setDraft({ ...draft, unit: event.target.value || null })} placeholder="kg, IDR, days" aria-label={t("unitFor", { field: field.name })} /></td>
      <td><select value={draft.sensitivity} onChange={(event) => setDraft({ ...draft, sensitivity: event.target.value })}>{FIELD_SENSITIVITIES.map((item) => <option key={item} value={item}>{item}</option>)}</select></td>
      <td>
        <select multiple value={draft.allowedAggregations} onChange={(event) => setDraft({ ...draft, allowedAggregations: [...event.target.selectedOptions].map((option) => option.value) })} aria-label={t("allowedAggregationsFor", { field: field.name })}>
          {numericAggregations.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </td>
      <td><button className="icon-button" type="button" disabled={busy} onClick={() => onSave(field.name, draft)} aria-label={t("saveSemanticField", { field: field.name })}><FloppyDisk weight="bold" /></button></td>
    </tr>
  );
}

function RuleBuilder({ schema, busy, onCreate }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(() => ({ name: "", severity: "warning", field: schema[0]?.name ?? "", operator: "is-null", compareWith: "value", value: "", rightField: schema[1]?.name ?? schema[0]?.name ?? "", recommendation: "" }));
  useEffect(() => setDraft((current) => current.field ? current : { ...current, field: schema[0]?.name ?? "", rightField: schema[1]?.name ?? schema[0]?.name ?? "" }), [schema]);
  const needsComparison = !["is-null", "is-not-null", "is-empty", "is-not-empty"].includes(draft.operator);
  const submit = () => {
    onCreate({
      name: draft.name,
      severity: draft.severity,
      recommendation: draft.recommendation,
      condition: { field: draft.field, operator: draft.operator, ...(needsComparison && draft.compareWith === "field" ? { rightField: draft.rightField } : needsComparison ? { value: draft.value } : {}) },
    });
    setDraft((current) => ({ ...current, name: "", value: "", recommendation: "" }));
  };
  return (
    <section className="analytics-builder">
      <h3>{t("newValidationRule")}</h3>
      <div className="analytics-form-grid">
        <label>{t("ruleName")}<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
        <label>{t("severity")}<select value={draft.severity} onChange={(event) => setDraft({ ...draft, severity: event.target.value })}>{VALIDATION_SEVERITIES.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label>{t("fieldColumn")}<select value={draft.field} onChange={(event) => setDraft({ ...draft, field: event.target.value })}>{schema.map((column) => <option key={column.name} value={column.name}>{column.name}</option>)}</select></label>
        <label>{t("fieldCondition")}<select value={draft.operator} onChange={(event) => setDraft({ ...draft, operator: event.target.value })}>{VALIDATION_OPERATORS.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        {needsComparison && <label>{t("compareWith")}<select value={draft.compareWith} onChange={(event) => setDraft({ ...draft, compareWith: event.target.value })}><option value="value">{t("literalValue")}</option><option value="field">{t("anotherField")}</option></select></label>}
        {needsComparison && draft.compareWith === "field" ? <label>{t("rightField")}<select value={draft.rightField} onChange={(event) => setDraft({ ...draft, rightField: event.target.value })}>{schema.map((column) => <option key={column.name} value={column.name}>{column.name}</option>)}</select></label> : needsComparison && <label>{t("value")}<input value={draft.value} onChange={(event) => setDraft({ ...draft, value: event.target.value })} /></label>}
        <label className="analytics-form-grid__wide">{t("recommendation")}<input value={draft.recommendation} onChange={(event) => setDraft({ ...draft, recommendation: event.target.value })} /></label>
      </div>
      <button className="primary-button" type="button" disabled={busy || !draft.name.trim() || !draft.field} onClick={submit}><Plus weight="bold" />{t("addRule")}</button>
    </section>
  );
}

function AnalysisBuilder({ schema, semanticModel, busy, onRun }) {
  const { t } = useI18n();
  const fields = semanticModel.fields ?? [];
  const [name, setName] = useState("");
  const [dimension, setDimension] = useState("");
  const [fn, setFn] = useState("count");
  const [column, setColumn] = useState("");
  const [alias, setAlias] = useState("row_count");
  const [minimumSampleSize, setMinimumSampleSize] = useState(20);
  const permittedColumns = useMemo(() => fields.filter((field) => field.allowedAggregations?.includes(fn)), [fields, fn]);
  useEffect(() => {
    if (fn === "count") return;
    if (!permittedColumns.some((field) => field.name === column)) setColumn(permittedColumns[0]?.name ?? "");
  }, [column, fn, permittedColumns]);
  return (
    <section className="analytics-builder">
      <h3>{t("newAnalysis")}</h3>
      <div className="analytics-form-grid">
        <label>{t("analysisName")}<input value={name} onChange={(event) => setName(event.target.value)} placeholder={t("analysisNamePlaceholder")} /></label>
        <label>{t("groupBy")}<select value={dimension} onChange={(event) => setDimension(event.target.value)}><option value="">{t("none")}</option>{schema.map((field) => <option key={field.name} value={field.name}>{field.name}</option>)}</select></label>
        <label>{t("aggregateFunction")}<select value={fn} onChange={(event) => setFn(event.target.value)}>{ANALYSIS_FUNCTIONS.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
        <label>{t("measure")}<select value={column} disabled={fn === "count"} onChange={(event) => setColumn(event.target.value)}><option value="">{fn === "count" ? t("allRows") : t("notSelected")}</option>{permittedColumns.map((field) => <option key={field.name} value={field.name}>{field.businessName}</option>)}</select></label>
        <label>{t("alias")}<input value={alias} onChange={(event) => setAlias(event.target.value)} /></label>
        <label>{t("minimumSampleSize")}<input type="number" min="1" value={minimumSampleSize} onChange={(event) => setMinimumSampleSize(event.target.value)} /></label>
      </div>
      <button className="primary-button" type="button" disabled={busy || !name.trim() || !alias.trim() || (fn !== "count" && !column)} onClick={() => onRun({ name, dimensions: dimension ? [dimension] : [], metrics: [{ function: fn, ...(column ? { column } : {}), alias }], minimumSampleSize })}><Play weight="fill" />{t("runAnalysis")}</button>
    </section>
  );
}

export function AnalyzeScreen({ preparedOptions, targetId, schema, semanticModel, rules, validationRun, analyses, analysisResult, busy, error, onTargetChange, onSaveSemanticField, onCreateRule, onDeleteRule, onRunValidation, onRunAnalysis }) {
  const { formatNumber, t } = useI18n();
  const [tab, setTab] = useState("quality");
  const gate = validationRun?.gateStatus ?? "not-evaluated";
  return (
    <main className="analytics-screen">
      <header className="analytics-header">
        <div><h1>{t("analyze")}</h1><p>{t("analyzeDescription")}</p></div>
        <label>{t("dataset")}<select value={targetId ?? ""} onChange={(event) => onTargetChange(event.target.value)}>{preparedOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      </header>
      <nav className="analytics-tabs" aria-label={t("analyzeSections")}>
        {["quality", "semantic", "analysis"].map((item) => <button type="button" key={item} className={tab === item ? "active" : ""} onClick={() => setTab(item)}>{t(item === "quality" ? "qualityValidation" : item === "semantic" ? "semanticModel" : "analysis")}</button>)}
      </nav>
      {error && <p className="error-message" role="alert">{error}</p>}

      {tab === "semantic" && <section className="analytics-panel">
        <header><div><h2>{t("semanticModel")}</h2><p>{t("semanticModelDescription")}</p></div><span>{t("revisionNumber", { revision: semanticModel.revision })}</span></header>
        <div className="analytics-table-wrap"><table className="analytics-table"><thead><tr><th>{t("technicalField")}</th><th>{t("businessName")}</th><th>{t("role")}</th><th>{t("unit")}</th><th>{t("sensitivity")}</th><th>{t("allowedAggregations")}</th><th /></tr></thead><tbody>{semanticModel.fields.map((field) => <SemanticFieldRow key={field.name} field={field} busy={busy} onSave={onSaveSemanticField} />)}</tbody></table></div>
      </section>}

      {tab === "quality" && <div className="analytics-stack">
        <section className={`quality-gate quality-gate--${gate}`}><span>{gate === "analysis-ready" || gate === "ready-with-exceptions" ? <CheckCircle weight="fill" /> : gate === "issues-found" ? <WarningCircle weight="fill" /> : <ShieldCheck weight="duotone" />}</span><div><strong>{t("qualityGate")}: {t(`gate_${gate}`)}</strong><p>{t("qualityGateDescription")}</p></div><button type="button" className="primary-button" disabled={busy || rules.length === 0} onClick={onRunValidation}><Play weight="fill" />{t("runValidation")}</button></section>
        <RuleBuilder schema={schema} busy={busy} onCreate={onCreateRule} />
        <section className="analytics-panel"><header><div><h2>{t("validationRules")}</h2><p>{t("validationRulesDescription")}</p></div><span>{rules.length}</span></header>{rules.length === 0 ? <p className="analytics-empty">{t("noValidationRules")}</p> : <div className="validation-list">{rules.map((rule) => {
          const result = validationRun?.results?.find((item) => item.ruleId === rule.id);
          return <article key={rule.id}><span className={`severity severity--${rule.severity}`}>{rule.severity}</span><div><strong>{rule.name}</strong><p>{result ? t("impactedRecords", { count: formatNumber(result.impactedCount), percentage: (result.percentage * 100).toFixed(1) }) : t("notEvaluated")}</p>{rule.recommendation && <small>{rule.recommendation}</small>}</div><button className="icon-button" type="button" onClick={() => onDeleteRule(rule.id)} aria-label={t("deleteRule", { name: rule.name })}><Trash weight="bold" /></button></article>;
        })}</div>}</section>
      </div>}

      {tab === "analysis" && <div className="analytics-stack">
        <AnalysisBuilder schema={schema} semanticModel={semanticModel} busy={busy} onRun={onRunAnalysis} />
        <section className="analytics-panel"><header><div><h2>{t("analysisResult")}</h2><p>{analysisResult?.definition?.name ?? t("analysisResultDescription")}</p></div><span>{analyses.length} {t("saved")}</span></header>
          {!analysisResult ? <p className="analytics-empty">{t("noAnalysisResult")}</p> : <><div className="analysis-warnings">{analysisResult.warnings?.map((warning) => <p key={warning.code}><WarningCircle weight="fill" />{warning.message}</p>)}</div><div className="analytics-table-wrap"><table className="analytics-table"><thead><tr>{analysisResult.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{analysisResult.rows.map((row, index) => <tr key={index}>{analysisResult.columns.map((column) => <td key={column}>{row[column] === null ? t("emptyValue") : String(row[column])}</td>)}</tr>)}</tbody></table></div></>}
        </section>
      </div>}
    </main>
  );
}
