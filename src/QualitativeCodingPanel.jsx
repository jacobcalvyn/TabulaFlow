import { useEffect, useMemo, useState } from "react";
import { Check, Plus, ShieldCheck, Trash, X } from "@phosphor-icons/react";
import { getCodingProgress, hasActiveCodingAccess } from "./qualitativeCoding.js";
import { useI18n } from "./i18n.jsx";

function emptyCode(index) {
  return { id: "", label: `Code ${index + 1}`, definition: "", include: "", exclude: "", active: true };
}

export function QualitativeCodingPanel({
  project,
  preparedName,
  columns,
  totalResponses,
  busy,
  error,
  onClose,
  onSave,
  onGrantAccess,
  onRevokeAccess,
  onReview,
  onLoadEvidence,
  onMaterialize,
}) {
  const { formatNumber, t } = useI18n();
  const [draft, setDraft] = useState(() => ({
    name: project?.name ?? `${preparedName} coding`,
    responseIdColumn: project?.responseIdColumn ?? columns[0] ?? "",
    responseTextColumn: project?.responseTextColumn ?? columns[1] ?? columns[0] ?? "",
    questionColumn: project?.questionColumn ?? "",
    codes: project?.codes?.length ? project.codes.map((code) => ({ ...code })) : [emptyCode(0)],
  }));
  const [evidenceById, setEvidenceById] = useState({});

  useEffect(() => {
    setDraft({
      name: project?.name ?? `${preparedName} coding`,
      responseIdColumn: project?.responseIdColumn ?? columns[0] ?? "",
      responseTextColumn: project?.responseTextColumn ?? columns[1] ?? columns[0] ?? "",
      questionColumn: project?.questionColumn ?? "",
      codes: project?.codes?.length ? project.codes.map((code) => ({ ...code })) : [emptyCode(0)],
    });
  }, [columns, preparedName, project]);

  const progress = useMemo(() => project ? getCodingProgress(project, totalResponses) : null, [project, totalResponses]);
  const pending = project?.assignments?.filter((assignment) => assignment.status === "pending-review") ?? [];
  const codeMap = new Map((project?.codes ?? []).map((code) => [code.id, code]));
  const accessActive = hasActiveCodingAccess(project);

  useEffect(() => {
    let cancelled = false;
    setEvidenceById({});
    Promise.all(pending.map(async (assignment) => {
      try { return [assignment.id, await onLoadEvidence(assignment)]; }
      catch { return [assignment.id, null]; }
    })).then((items) => { if (!cancelled) setEvidenceById(Object.fromEntries(items)); });
    return () => { cancelled = true; };
  }, [onLoadEvidence, project?.revision]);
  const valid = draft.name.trim() && draft.responseIdColumn && draft.responseTextColumn
    && draft.responseIdColumn !== draft.responseTextColumn
    && draft.codes.some((code) => code.label.trim() && code.definition.trim());

  const updateCode = (index, patch) => setDraft((current) => ({
    ...current,
    codes: current.codes.map((code, codeIndex) => codeIndex === index ? { ...code, ...patch } : code),
  }));

  return (
    <div className="coding-overlay" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="coding-panel" role="dialog" aria-modal="true" aria-labelledby="coding-panel-title">
        <header className="coding-panel__header">
          <div>
            <h2 id="coding-panel-title">{t("qualitativeCoding")}</h2>
            <p>{t("codingDescription")}</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label={t("closeForm")}><X /></button>
        </header>

        <div className="coding-panel__body">
          <section className="coding-panel__section">
            <div className="coding-panel__section-heading">
              <div><strong>{t("codingProject")}</strong><span>{preparedName}</span></div>
              {project && <span className="coding-status">{t("codingCodebookRevision", { count: project.codebookRevision })}</span>}
            </div>
            <div className="coding-form-grid">
              <label className="coding-field coding-field--wide"><span>{t("codingProjectName")}</span><input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></label>
              <label className="coding-field"><span>{t("codingResponseId")}</span><select value={draft.responseIdColumn} onChange={(event) => setDraft((current) => ({ ...current, responseIdColumn: event.target.value }))}>{columns.map((column) => <option key={column} value={column}>{column}</option>)}</select></label>
              <label className="coding-field"><span>{t("codingResponseText")}</span><select value={draft.responseTextColumn} onChange={(event) => setDraft((current) => ({ ...current, responseTextColumn: event.target.value }))}>{columns.map((column) => <option key={column} value={column}>{column}</option>)}</select></label>
              <label className="coding-field coding-field--wide"><span>{t("codingQuestionOptional")}</span><select value={draft.questionColumn} onChange={(event) => setDraft((current) => ({ ...current, questionColumn: event.target.value }))}><option value="">{t("none")}</option>{columns.map((column) => <option key={column} value={column}>{column}</option>)}</select></label>
            </div>
          </section>

          <section className="coding-panel__section">
            <div className="coding-panel__section-heading"><div><strong>{t("codingCodebook")}</strong><span>{t("codingCodebookHint")}</span></div><button type="button" className="button button--quiet" onClick={() => setDraft((current) => ({ ...current, codes: [...current.codes, emptyCode(current.codes.length)] }))}><Plus /> {t("codingAddCode")}</button></div>
            <div className="coding-code-list">
              {draft.codes.map((code, index) => (
                <article className="coding-code" key={code.id || `new-${index}`}>
                  <label className="coding-field"><span>{t("codingCodeLabel")}</span><input value={code.label} onChange={(event) => updateCode(index, { label: event.target.value })} /></label>
                  <label className="coding-field"><span>{t("codingDefinition")}</span><input value={code.definition} onChange={(event) => updateCode(index, { definition: event.target.value })} /></label>
                  <label className="coding-field"><span>{t("codingInclude")}</span><input value={code.include} onChange={(event) => updateCode(index, { include: event.target.value })} /></label>
                  <label className="coding-field"><span>{t("codingExclude")}</span><input value={code.exclude} onChange={(event) => updateCode(index, { exclude: event.target.value })} /></label>
                  <button type="button" className="icon-button icon-button--danger" onClick={() => setDraft((current) => ({ ...current, codes: current.codes.filter((_, codeIndex) => codeIndex !== index) }))} aria-label={t("codingRemoveCode")}><Trash /></button>
                </article>
              ))}
            </div>
          </section>

          {project && (
            <section className="coding-panel__section">
              <div className="coding-panel__section-heading">
                <div><strong>{t("codingAiAccess")}</strong><span>{t("codingAiAccessHint")}</span></div>
                <button type="button" className={`button ${accessActive ? "button--quiet" : "button--primary"}`} onClick={accessActive ? onRevokeAccess : onGrantAccess} disabled={busy}>
                  <ShieldCheck /> {t(accessActive ? "codingRevokeAccess" : "codingGrantAccess")}
                </button>
              </div>
              <div className="coding-progress" aria-label={t("codingProgress")}>
                <span><strong>{formatNumber(progress.pending)}</strong>{t("codingPending")}</span>
                <span><strong>{formatNumber(progress.accepted)}</strong>{t("codingAccepted")}</span>
                <span><strong>{formatNumber(progress.rejected)}</strong>{t("codingRejected")}</span>
                <span><strong>{progress.coverage == null ? "—" : `${formatNumber(progress.coverage * 100)}%`}</strong>{t("codingCoverage")}</span>
              </div>
            </section>
          )}

          {project && (
            <section className="coding-panel__section">
              <div className="coding-panel__section-heading"><div><strong>{t("codingHumanReview")}</strong><span>{t("codingReviewHint")}</span></div></div>
              <div className="coding-review-list">
                {pending.length === 0 ? <p className="coding-empty">{t("codingNoPending")}</p> : pending.map((assignment) => (
                  <article className="coding-review" key={assignment.id}>
                    <div><strong>{codeMap.get(assignment.codeId)?.label ?? t("codingUncertain")}</strong><span>{t("codingResponseReference", { id: assignment.responseId })}</span></div>
                    <p>{evidenceById[assignment.id] ? `“${evidenceById[assignment.id]}”` : t("codingEvidenceUnavailable")}</p>
                    {assignment.rationale && <small>{assignment.rationale}</small>}
                    <div><button type="button" className="button button--quiet" onClick={() => onReview(assignment.id, "rejected")} disabled={busy}><X /> {t("codingReject")}</button><button type="button" className="button button--primary" onClick={() => onReview(assignment.id, "accepted")} disabled={busy}><Check /> {t("codingAccept")}</button></div>
                  </article>
                ))}
              </div>
            </section>
          )}
        </div>

        {error && <div className="coding-panel__error" role="alert">{error}</div>}
        <footer className="coding-panel__footer">
          {project && <button type="button" className="button button--quiet" onClick={onMaterialize} disabled={busy || progress.accepted === 0}>{t("codingCreateDataset")}</button>}
          <div><button type="button" className="button button--quiet" onClick={onClose}>{t("cancel")}</button><button type="button" className="button button--primary" onClick={() => onSave(draft)} disabled={busy || !valid}>{t("save")}</button></div>
        </footer>
      </section>
    </div>
  );
}
