import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ClockCounterClockwise,
  CaretDown,
  CaretLeft,
  CaretRight,
  FileArrowUp,
  FileCsv,
  FileJs,
  FileXls,
  GlobeSimple,
  CloudArrowUp,
  FolderOpen,
  MagnifyingGlass,
  MagicWand,
  Rows,
  Robot,
  ShieldCheck,
  Trash,
  UploadSimple,
  WarningCircle,
  UserCircle,
  X,
} from "@phosphor-icons/react";
import { formatValue, isSupportedFile } from "./data.js";
import { useDataWorker } from "./useDataWorker.js";
import { useWebMcpTools } from "./useWebMcpTools.js";
import { createWebMcpMutationRunner } from "./webMcpMutation.js";
import { createWebMcpInteractionRegistry } from "./webMcpInteractions.js";
import { composeNodeSummaryForAgent, paginateAgentSchema } from "./webMcpDto.js";
import { StepsPanel, TransformationForm } from "./StepsPanel.jsx";
import { FormulaColumnEditor } from "./FormulaColumnEditor.jsx";
import { QualitativeCodingPanel } from "./QualitativeCodingPanel.jsx";
import {
  codingProjectForAgent,
  createCodingBatch,
  createCodingProject,
  grantCodingAccess,
  hashCodingText,
  materializeAcceptedCodingRows,
  normalizeCodingProject,
  redactQualitativeText,
  reviewCodingAssignment,
  revokeCodingAccess,
  submitCodingSuggestions,
  updateCodingProject,
} from "./qualitativeCoding.js";
import { useRecipeHistory } from "./useRecipeHistory.js";
import { fileFromDroppedItem, isSameFileEntry, pickSourceFile, restoreFileFromHandle } from "./sourceFileHandles.js";
import {
  loadStoredFlow,
  loadStoredSourceHandle,
  deleteStoredSourceHandle,
  saveStoredFlow,
  saveStoredSourceHandle,
  appendStoredActivity,
  clearStoredWorkspaceData,
  loadStoredActivity,
  loadStoredWebMcpOperations,
  saveStoredWebMcpOperation,
} from "./recipeStorage.js";
import { createActivityEvent, findSupersededActivity, pageActivityEvents } from "./activityModel.js";
import { composeSchemaDelta, schemaDelta } from "./schemaDelta.js";
import { nextWorkspaceRevision } from "./workspaceRevision.js";
import { resolveColumnSemantics, shouldRedactAgentValues } from "./dataPrivacy.js";
import {
  assertAgentSemanticFieldChange,
  protectComposeConfigForAgent,
  protectRecipeForAgent,
  restoreProtectedComposeOperation,
  restoreProtectedRecipeValues,
} from "./agentDataProtection.js";
import {
  applySemanticModelToSchema,
  createSemanticModel,
  normalizeMetricDefinition,
  reconcileSemanticModel,
  deriveRecipeSemanticSchema,
  updateSemanticField,
} from "./semanticModel.js";
import { useI18n } from "./i18n.jsx";
import { ComposeScreen } from "./ComposeScreen.jsx";
import { activatePreparedForFlow } from "./preparedActivation.js";
import { getCloudAccount, getCloudFiles, openCloudFile, uploadCloudFile } from "./cloudFiles.js";
import {
  PREPARED_RECIPE_STATUS,
  recipeForExecution,
} from "./preparedRecipeState.js";
import { assertAgentRecipeContract, createStep, CREATABLE_TRANSFORMATION_TYPES, includeNewFormulaAggregateColumns, isAgentCreatableTransformation, miniTableToolTouchesColumn, valueRowActionParams } from "./transformations.js";
import {
  addComposeNode,
  addPreparedInput,
  autoArrangeNodePositions,
  consolidateDuplicateFileSources,
  createFlowGraph,
  createPreparedInput,
  createPreparedFromCompose,
  createPreparedFromGeneratedRows,
  collectDescendantNodeIds,
  duplicatePreparedInput,
  findMatchingFileSource,
  hydrateComposeSchemas,
  isFlowFileSource,
  markSourcesUnlinked,
  matchesSourceReference,
  removeBuiltInDemoData,
  repairOverlappingNodePositions,
  removeComposeNode,
  removePreparedInput,
  schemaFingerprint,
  updateComposeNode,
  updateNodePosition,
  updatePreparedInput,
  validateFlowGraph,
} from "./flowModel.js";

function protectFiltersForAgent(filters = {}, schema = []) {
  const columns = new Map(schema.map((column) => [column.name, column]));
  return Object.fromEntries(Object.entries(filters).map(([column, selection]) => {
    if (!selection || !shouldRedactAgentValues(resolveColumnSemantics(columns.get(column) ?? { name: column, type: "VARCHAR" }))) return [column, structuredClone(selection)];
    return [column, { key: selection.valueRef ?? "[redacted]", label: "[redacted]", ...(selection.valueRef ? { valueRef: selection.valueRef } : {}) }];
  }));
}

const ACCEPTED_FILES = ".xlsx,.xls,.csv,.json,.jsonl,.ndjson";
const WEBMCP_CONFIRMATION_TTL_MS = 10 * 60 * 1000;
const PREVIEW_ROW_HEIGHT = 36;
const PREVIEW_OVERSCAN = 4;
const PREVIEW_COLUMN_WIDTH = 150;
const PREVIEW_COLUMN_OVERSCAN = 2;
const FREQUENCY_ROW_HEIGHT = 34;
const FREQUENCY_HEADER_HEIGHT = 32;
const FREQUENCY_VALUE_OVERSCAN = 3;
const FREQUENCY_CARD_GAP = 12;
const FREQUENCY_CARD_OVERSCAN = 2;
const AGGREGATE_SORT_MODES = Object.freeze([
  { value: "count-desc", labelKey: "sortCountDesc", token: "#↓" },
  { value: "value-asc", labelKey: "sortValueAsc", token: "A–Z" },
  { value: "value-desc", labelKey: "sortValueDesc", token: "Z–A" },
]);
const UI_TYPE_TO_DUCKDB = Object.freeze({
  teks: "VARCHAR",
  angka: "BIGINT",
  desimal: "DOUBLE",
  boolean: "BOOLEAN",
  tanggal: "DATE",
});
const UI_TYPE_LABEL_KEY = Object.freeze({
  teks: "textType",
  angka: "integerType",
  desimal: "decimalType",
  boolean: "booleanType",
  tanggal: "dateType",
  kosong: "empty",
});
const COLUMN_TYPE_OPTIONS = Object.freeze([
  { value: "VARCHAR", labelKey: "textType" },
  { value: "BIGINT", labelKey: "integerType" },
  { value: "DOUBLE", labelKey: "decimalType" },
  { value: "BOOLEAN", labelKey: "booleanType" },
  { value: "DATE", labelKey: "dateType" },
  { value: "TIMESTAMP", labelKey: "timestampType" },
]);

function FileTypeIcons() {
  const { t } = useI18n();
  return (
    <div className="format-icons" aria-label={t("supportedFormats")}>
      <span title="Excel"><FileXls weight="duotone" /></span>
      <span title="CSV"><FileCsv weight="duotone" /></span>
      <span title="JSON / JSONL"><FileJs weight="duotone" /></span>
    </div>
  );
}

function Sidebar({ screen, collapsed, hasDataset, hasPrepared, hasFlow, onNavigate, onCollapse }) {
  const { language, setLanguage, t } = useI18n();
  return (
    <aside className={`sidebar ${collapsed ? "sidebar--collapsed" : ""}`}>
      <div className="brand" aria-label="TabulaFlow">
        <span className="brand-mark"><Rows weight="fill" /></span>
        {!collapsed && <span>TabulaFlow</span>}
      </div>

      <nav className="steps workspace-nav" aria-label={t("dataWorkspace")}>
        <button type="button" className={`step ${screen === "input" ? "step--active" : ""}`} onClick={() => onNavigate("input")} aria-current={screen === "input" ? "page" : undefined} title={t("sourceData")}>
          <span className="step-dot"><FileArrowUp weight="bold" /></span>
          {!collapsed && <span>{t("source")}</span>}
        </button>
        <button type="button" className={`step ${screen === "data" ? "step--active" : ""}`} onClick={() => onNavigate("data")} disabled={!hasDataset && !hasPrepared} aria-current={screen === "data" ? "page" : undefined} title={t("profileData")}>
          <span className="step-dot"><Rows weight="bold" /></span>
          {!collapsed && <span>{t("profile")}</span>}
        </button>
        <button type="button" className={`step ${screen === "compose" ? "step--active" : ""}`} onClick={() => onNavigate("compose")} disabled={!hasFlow} aria-current={screen === "compose" ? "page" : undefined} title={t("composeData")}>
          <span className="step-dot"><MagicWand weight="bold" /></span>
          {!collapsed && <span>{t("compose")}</span>}
        </button>
      </nav>

      {screen === "data" && hasDataset && <div id="sidebar-steps" className="sidebar-steps-host" />}

      <div className="sidebar-bottom-grid">
        <button
          className={`sidebar-footer-action ${screen === "account" ? "sidebar-footer-action--active" : ""}`}
          type="button"
          onClick={() => onNavigate("account")}
          aria-current={screen === "account" ? "page" : undefined}
          aria-label={t("account")}
          title={t("account")}
        >
          <UserCircle weight="bold" />
          <span>{t("account")}</span>
        </button>
        <button
          className="sidebar-footer-action"
          type="button"
          onClick={() => setLanguage(language === "en" ? "id" : "en")}
          aria-label={t("switchLanguage", { language: language === "en" ? t("indonesian") : t("english") })}
          title={t("switchLanguage", { language: language === "en" ? t("indonesian") : t("english") })}
        >
          <GlobeSimple weight="bold" />
          <span>{language === "en" ? t("english") : t("indonesian")}</span>
        </button>
      </div>

      <button className="collapse-button" type="button" onClick={onCollapse} aria-label={collapsed ? t("showSidebar") : t("hideSidebar")}>
        <CaretLeft weight="bold" className={collapsed ? "collapse-icon--reversed" : ""} />
        {!collapsed && <span>{t("hideSidebar")}</span>}
      </button>
    </aside>
  );
}

function formatBytes(value, locale) {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length);
  const amount = bytes / (1024 ** exponent);
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: amount >= 10 ? 1 : 2 }).format(amount)} ${units[exponent - 1]}`;
}

function downloadExport(result) {
  const blob = new Blob([result.bytes], { type: result.mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = result.filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return result.filename;
}

const ACTIVITY_LABEL_KEYS = Object.freeze({
  source_imported: "activitySourceImported",
  source_relinked: "activitySourceRelinked",
  preview_filters_changed: "activityFiltersChanged",
  aggregate_columns_changed: "activityColumnsChanged",
  recipe_changed: "activityRecipeChanged",
  recipe_undone: "activityRecipeUndone",
  recipe_redone: "activityRecipeRedone",
  prepared_duplicated: "activityPreparedDuplicated",
  compose_result_promoted: "activityResultPromoted",
  compose_operation_created: "activityOperationCreated",
  compose_operation_updated: "activityOperationUpdated",
  compose_node_moved: "activityNodeMoved",
  compose_auto_arranged: "activityAutoArranged",
  prepared_exported: "activityPreparedExported",
  compose_exported: "activityComposeExported",
  delete_requested: "activityDeleteRequested",
  delete_cancelled: "activityDeleteCancelled",
  delete_confirmed: "activityDeleteConfirmed",
  prepared_deleted: "activityPreparedDeleted",
  compose_operation_deleted: "activityOperationDeleted",
  coding_project_saved: "activityCodingProjectSaved",
  coding_access_granted: "activityCodingAccessGranted",
  coding_access_revoked: "activityCodingAccessRevoked",
  coding_suggestions_submitted: "activityCodingSuggestionsSubmitted",
  coding_assignment_reviewed: "activityCodingAssignmentReviewed",
  coding_result_materialized: "activityCodingResultMaterialized",
});

function AccountScreen({ onOpenFile, uploadRequestToken, onUploadRequestShown, activityEvents, activityLoading, activityError }) {
  const { language, t } = useI18n();
  const locale = language === "id" ? "id-ID" : "en-US";
  const inputRef = useRef(null);
  const uploadButtonRef = useRef(null);
  const [account, setAccount] = useState(null);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [activityOpen, setActivityOpen] = useState(false);
  const [webMcpAvailable] = useState(() => {
    try {
      return typeof document.modelContext?.registerTool === "function";
    } catch {
      return false;
    }
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const nextAccount = await getCloudAccount();
      setAccount(nextAccount);
      if (nextAccount.authenticated) {
        const result = await getCloudFiles();
        setFiles(result.files ?? []);
      } else {
        setFiles([]);
      }
    } catch (cause) {
      setAccount({ authenticated: false });
      setFiles([]);
      setError(cause instanceof Error ? cause.message : t("cloudUnavailable"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!uploadRequestToken || !account?.authenticated) return;
    uploadButtonRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    uploadButtonRef.current?.focus();
    onUploadRequestShown?.(uploadRequestToken);
  }, [account?.authenticated, onUploadRequestShown, uploadRequestToken]);

  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      await uploadCloudFile(file);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("cloudUploadFailed"));
    } finally {
      setBusy(false);
    }
  };

  const open = async (file) => {
    setBusy(true);
    setError("");
    try {
      await onOpenFile(await openCloudFile(file));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("cloudOpenFailed"));
    } finally {
      setBusy(false);
    }
  };

  const used = account?.storage?.usedBytes ?? 0;
  const quota = account?.storage?.quotaBytes ?? 0;
  const percentage = quota > 0 ? Math.min(100, (used / quota) * 100) : 0;

  return (
    <main className="account-screen">
      <header className="account-header">
        <div>
          <h1>{t("account")}</h1>
          <p>{t("accountDescription")}</p>
        </div>
      </header>

      <section className="account-card account-ai-card" aria-labelledby="ai-access-title">
        <div className="account-card__heading">
          <div className="account-ai-card__title"><span><Robot weight="duotone" /></span><div><h2 id="ai-access-title">{t("aiAccess")}</h2><p>{t("aiAccessDescription")}</p></div></div>
          <strong className={`account-ai-status ${webMcpAvailable ? "account-ai-status--available" : "account-ai-status--unavailable"}`}>{t(webMcpAvailable ? "aiAvailable" : "aiUnavailable")}</strong>
        </div>
        <ul className="account-ai-capabilities">
          <li>{t("aiCapabilityWorkspace")}</li>
          <li>{t("aiCapabilityActions")}</li>
          <li>{t("aiCapabilityControls")}</li>
        </ul>
        <p className="account-ai-note">{t(webMcpAvailable ? "aiNoLoginRequired" : "aiBrowserUnsupported")}</p>
      </section>

      <section className={`account-card account-activity-card${activityOpen ? " account-activity-card--open" : ""}`} aria-labelledby="activity-title">
        <button
          className="account-activity-toggle"
          type="button"
          aria-expanded={activityOpen}
          aria-controls="account-activity-content"
          onClick={() => setActivityOpen((open) => !open)}
        >
          <span className="account-ai-card__title"><span><ClockCounterClockwise weight="duotone" /></span><span><strong id="activity-title">{t("activity")}</strong><small>{t("activityDescription")}</small></span></span>
          <span className="account-activity-toggle__meta"><strong>{t("activityEventCount", { count: activityEvents.length })}</strong><CaretDown weight="bold" aria-hidden="true" /></span>
        </button>
        {activityOpen && <div id="account-activity-content" className="account-activity-content">
          {activityLoading ? <p className="account-state">{t("loading")}</p> : activityEvents.length ? (
            <ol className="activity-list">{activityEvents.slice(0, 20).map((event) => (
              <li key={event.eventId}>
                <span className={`activity-actor activity-actor--${event.actor}`}>{t(event.actor === "agent" ? "activityActorAgent" : event.actor === "system" ? "activityActorSystem" : "activityActorUser")}</span>
                <div><strong>{t(ACTIVITY_LABEL_KEYS[event.action] ?? "activityChanged")}</strong><span>{event.targetType} · {new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.createdAt))}</span>{event.supersedesEventId && <small>{t("activityOverride")}</small>}</div>
              </li>
            ))}</ol>
          ) : <p className="account-empty">{t("noActivity")}</p>}
          <p className="account-ai-note">{t("activityPrivacy")}</p>
          {activityError && <p className="activity-error" role="status">{t("activityUnavailable")}</p>}
        </div>}
      </section>

      {loading ? <p className="account-state">{t("loading")}</p> : !account?.authenticated ? (
        <section className="account-guest-card">
          <span className="account-hero-icon"><CloudArrowUp weight="duotone" /></span>
          <h2>{t("cloudOptionalTitle")}</h2>
          <p>{t("cloudOptionalDescription")}</p>
          <a className="button button--primary" href="/signin-with-chatgpt?return_to=%2F%3Faccount%3D1">{t("signInChatGPT")}</a>
          <small>{t("localWithoutLogin")}</small>
        </section>
      ) : (
        <div className="account-content">
          <section className="account-card account-profile-card">
            <div className="account-card__heading">
              <div><h2>{t("profileAccount")}</h2><p>{t("readOnlyAccount")}</p></div>
              <a href="/signout-with-chatgpt?return_to=/">{t("signOut")}</a>
            </div>
            <dl className="account-details">
              <div><dt>{t("name")}</dt><dd>{account.account?.name || account.account?.email || "—"}</dd></div>
              <div><dt>{t("email")}</dt><dd>{account.account?.email || "—"}</dd></div>
            </dl>
          </section>

          <section className="account-card account-storage-card">
            <div className="account-card__heading">
              <div><h2>{t("cloudStorage")}</h2><p>{t("cloudStorageDescription")}</p></div>
              <strong>{formatBytes(used, locale)} / {formatBytes(quota, locale)}</strong>
            </div>
            <div className="storage-track" aria-label={t("storageUsage")} aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(percentage)} role="progressbar"><span style={{ width: `${percentage}%` }} /></div>
            <p>{t("cloudFileCount", { count: account.storage?.fileCount ?? 0 })}</p>
          </section>

          <section className="account-card cloud-files-card">
            <div className="account-card__heading">
              <div><h2>{t("cloudFiles")}</h2><p>{t("cloudFilesDescription")}</p></div>
              <button ref={uploadButtonRef} className="button button--secondary" type="button" disabled={busy} onClick={() => inputRef.current?.click()}><CloudArrowUp weight="bold" /> {t("uploadToCloud")}</button>
              <input ref={inputRef} type="file" accept={ACCEPTED_FILES} hidden onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = ""; }} />
            </div>
            {files.length ? <ul className="cloud-file-list">{files.map((file) => (
              <li key={file.id}>
                <div><strong>{file.name}</strong><span>{formatBytes(file.size, locale)} · {new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(file.createdAt))}</span></div>
                <button type="button" disabled={busy} onClick={() => void open(file)}><FolderOpen weight="bold" /> {t("open")}</button>
              </li>
            ))}</ul> : <p className="account-empty">{t("noCloudFiles")}</p>}
          </section>
        </div>
      )}
      {error && <p className="error-message" role="alert">{error}</p>}
    </main>
  );
}

export function InputScreen({ loading, error, onFile, onOpenSource, onRelinkSource, onSourceInteractionCancelled, onResetAll, workerReady, openedSources, fileRequestToken, onFileRequestShown, relinkRequest, onRelinkRequestShown, resetRequest, onResetRequestShown, onResetRequestResolved }) {
  const { formatNumber, t } = useI18n();
  const inputRef = useRef(null);
  const chooseFileButtonRef = useRef(null);
  const relinkButtonRefs = useRef(new Map());
  const [relinkSourceId, setRelinkSourceId] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const resetConfirmRef = useRef(null);
  const resetDisabled = loading || resetting || openedSources.some((source) => source.status === "restoring");

  useEffect(() => {
    if (!fileRequestToken) return;
    chooseFileButtonRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    chooseFileButtonRef.current?.focus();
    onFileRequestShown?.(fileRequestToken);
  }, [fileRequestToken, onFileRequestShown]);

  useEffect(() => {
    if (!relinkRequest?.token) return;
    const button = relinkButtonRefs.current.get(relinkRequest.sourceAssetId);
    button?.scrollIntoView({ block: "center", behavior: "smooth" });
    button?.focus();
    onRelinkRequestShown?.(relinkRequest.token);
  }, [onRelinkRequestShown, relinkRequest]);

  useEffect(() => {
    if (!resetRequest?.token) return;
    setConfirmingReset(true);
    onResetRequestShown?.(resetRequest.token);
  }, [onResetRequestShown, resetRequest]);

  useEffect(() => {
    if (confirmingReset) resetConfirmRef.current?.focus();
  }, [confirmingReset]);

  const dismissReset = () => {
    setConfirmingReset(false);
    if (resetRequest?.token) onResetRequestResolved?.(resetRequest.token, "cancelled");
  };

  const resetAll = async () => {
    setResetting(true);
    try {
      const reset = await onResetAll?.({ requestId: resetRequest?.requestId ?? null });
      if (reset !== false) {
        setConfirmingReset(false);
        if (resetRequest?.token) onResetRequestResolved?.(resetRequest.token, "confirmed");
      }
    } finally {
      setResetting(false);
    }
  };

  const chooseFile = async () => {
    try {
      const picked = await pickSourceFile();
      if (!picked.supported) inputRef.current?.click();
      else if (picked.selection) onFile(picked.selection.file, picked.selection.handle);
      else onSourceInteractionCancelled?.("source-file");
    } catch {
      inputRef.current?.click();
    }
  };
  const chooseRelinkFile = async (sourceId) => {
    try {
      const picked = await pickSourceFile();
      if (!picked.supported) {
        setRelinkSourceId(sourceId);
        inputRef.current?.click();
      } else if (picked.selection) {
        onRelinkSource(sourceId, picked.selection.file, picked.selection.handle);
      } else {
        onSourceInteractionCancelled?.("source-relink", sourceId);
      }
    } catch {
      setRelinkSourceId(sourceId);
      inputRef.current?.click();
    }
  };
  const handleDrop = async (event) => {
    event.preventDefault();
    setDragging(false);
    const handleSelection = await fileFromDroppedItem(event.dataTransfer.items?.[0]);
    if (handleSelection) {
      onFile(handleSelection.file, handleSelection.handle);
      return;
    }
    const dropped = event.dataTransfer.files?.[0];
    if (dropped) onFile(dropped);
  };

  return (
    <main className="input-screen">
      <div className="input-header">
        <div>
          <h1>{t("sourceData")}</h1>
          <p>{t("inputDescription")}</p>
        </div>
      </div>

      <section
        className={`dropzone ${dragging ? "dropzone--active" : ""}`}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_FILES}
          onChange={(event) => {
            const nextFile = event.target.files?.[0];
            if (nextFile) {
              if (relinkSourceId) onRelinkSource(relinkSourceId, nextFile, null);
              else onFile(nextFile, null);
            }
            setRelinkSourceId(null);
            event.target.value = "";
          }}
        />
        <span className="upload-symbol"><UploadSimple weight="duotone" /></span>
        <h2>{t("dragFile")}</h2>
        <p>{t("chooseFromDevice")}</p>
        <button ref={chooseFileButtonRef} className="button button--secondary" type="button" onClick={chooseFile} disabled={!workerReady || loading}>{loading ? t("preparing") : t("chooseFile")}</button>
        <FileTypeIcons />
        <p className="format-copy">Excel · CSV · JSON · JSONL · NDJSON</p>
      </section>

      {error && <p className="error-message" role="alert">{error}</p>}

      <section className="opened-sources" aria-labelledby="opened-sources-title">
        <header>
          <div className="file-heading__content">
            <h2 id="opened-sources-title">{t("openedFiles")}</h2>
            <p>{t("openedFilesDescription")}</p>
          </div>
          <div className="opened-sources__actions">
            <span className="opened-sources__count">{formatNumber(openedSources.length)}</span>
            {openedSources.length > 0 && (
              <button className="opened-sources__reset" type="button" disabled={resetDisabled} onClick={() => setConfirmingReset(true)}>
                <Trash weight="bold" /> {t("resetAll")}
              </button>
            )}
          </div>
        </header>
        {confirmingReset && (
          <div className="source-reset-confirmation" role="alertdialog" aria-labelledby="source-reset-title" aria-describedby="source-reset-description" onKeyDown={(event) => { if (event.key === "Escape" && !resetting) dismissReset(); }}>
            <div>
              <strong id="source-reset-title">{t("confirmResetAll")}</strong>
              <span id="source-reset-description">{t("resetAllDescription")}</span>
            </div>
            <div className="source-reset-confirmation__actions">
              <button type="button" disabled={resetting} onClick={dismissReset}>{t("cancel")}</button>
              <button ref={resetConfirmRef} className="source-reset-confirmation__confirm" type="button" disabled={resetting} onClick={() => void resetAll()}>{t(resetting ? "resettingAll" : "resetAll")}</button>
            </div>
          </div>
        )}
        {openedSources.length > 0 ? (
          <ul>
            {openedSources.map((source) => (
              <li key={source.key}>
                <span className="opened-source__icon"><FileArrowUp weight="duotone" /></span>
                <button className="opened-source__main" type="button" onClick={() => onOpenSource(source.preparedId)} disabled={source.status !== "linked"}>
                  <strong title={source.name}>{source.name}</strong>
                  <span>
                    {source.kind === "compose" ? t("composeResult") : t("localDevice")}
                    {source.size !== null && source.size !== undefined ? ` · ${formatNumber(source.size)} byte` : ""}
                  </span>
                </button>
                {source.status !== "linked" && (
                  <button ref={(element) => { if (element) relinkButtonRefs.current.set(source.sourceAssetId, element); else relinkButtonRefs.current.delete(source.sourceAssetId); }} className="opened-source__relink" type="button" disabled={loading || source.status === "restoring"} onClick={() => chooseRelinkFile(source.sourceAssetId)}>
                    {source.status === "restoring" ? t("restoringSource") : t("relink")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="opened-sources__empty">{t("noOpenedFiles")}</p>
        )}
      </section>
    </main>
  );
}

function FrequencyTable({ aggregate, selectedKey, onSelect, onSearch, onTransform, onRename, onChangeType, onReplaceValue, onValueAction, transformOpen, transformUsed, filterSignature, style }) {
  const { formatNumber, language, t } = useI18n();
  const valueLocale = language === "id" ? "id-ID" : "en-US";
  const { column, type, values, distinctCount } = aggregate;
  const [query, setQuery] = useState("");
  const [displayValues, setDisplayValues] = useState(values);
  const [matchCount, setMatchCount] = useState(distinctCount);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [sortMode, setSortMode] = useState("count-desc");
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState(column);
  const [renameSaving, setRenameSaving] = useState(false);
  const [renameError, setRenameError] = useState("");
  const [typeEditing, setTypeEditing] = useState(false);
  const [typeDraft, setTypeDraft] = useState(UI_TYPE_TO_DUCKDB[type] ?? "VARCHAR");
  const [typeSaving, setTypeSaving] = useState(false);
  const [typeError, setTypeError] = useState("");
  const [typeMenuPosition, setTypeMenuPosition] = useState(null);
  const [editingValueKey, setEditingValueKey] = useState(null);
  const [valueDraft, setValueDraft] = useState("");
  const [valueSaving, setValueSaving] = useState(false);
  const [valueError, setValueError] = useState("");
  const [valueMenu, setValueMenu] = useState(null);
  const [valueActionApplying, setValueActionApplying] = useState(false);
  const [valueActionError, setValueActionError] = useState("");
  const rowClickTimerRef = useRef(null);
  const renameInputRef = useRef(null);
  const cancelRenameRef = useRef(false);
  const typeButtonRef = useRef(null);
  const typeMenuRef = useRef(null);
  const typeOptionRefs = useRef(new Map());
  const valueInputRef = useRef(null);
  const valuesScrollRef = useRef(null);
  const valueMenuRef = useRef(null);
  const valueMenuTriggerRef = useRef(null);
  const [valuesViewportHeight, setValuesViewportHeight] = useState(240);
  const [valuesScrollTop, setValuesScrollTop] = useState(0);
  const cancelValueEditRef = useRef(false);
  const valueEditing = editingValueKey !== null;
  const inlineEditing = typeEditing || valueEditing;

  const sortedDisplayValues = useMemo(() => {
    const next = [...displayValues];
    const compareLabel = (left, right) => left.label.localeCompare(right.label, "id-ID", { numeric: true, sensitivity: "base" });
    if (sortMode === "value-asc") return next.sort(compareLabel);
    if (sortMode === "value-desc") return next.sort((left, right) => compareLabel(right, left));
    return next.sort((left, right) => right.count - left.count || compareLabel(left, right));
  }, [displayValues, sortMode]);

  useEffect(() => {
    const element = valuesScrollRef.current;
    if (!element) return undefined;
    const observer = new ResizeObserver((entries) => setValuesViewportHeight(entries[0].contentRect.height));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setValuesScrollTop(0);
    if (valuesScrollRef.current) valuesScrollRef.current.scrollTop = 0;
  }, [column, query]);

  const valueStart = Math.max(0, Math.floor(Math.max(0, valuesScrollTop - FREQUENCY_HEADER_HEIGHT) / FREQUENCY_ROW_HEIGHT) - FREQUENCY_VALUE_OVERSCAN);
  const valueVisibleCount = Math.ceil(valuesViewportHeight / FREQUENCY_ROW_HEIGHT) + FREQUENCY_VALUE_OVERSCAN * 2;
  const valueEnd = Math.min(sortedDisplayValues.length, valueStart + valueVisibleCount);
  const visibleDisplayValues = sortedDisplayValues.slice(valueStart, valueEnd);
  const valueTopSpace = valueStart * FREQUENCY_ROW_HEIGHT;
  const valueBottomSpace = Math.max(0, (sortedDisplayValues.length - valueEnd) * FREQUENCY_ROW_HEIGHT);

  const activeSort = AGGREGATE_SORT_MODES.find((item) => item.value === sortMode) ?? AGGREGATE_SORT_MODES[0];
  const cycleSort = () => {
    const currentIndex = AGGREGATE_SORT_MODES.findIndex((item) => item.value === sortMode);
    setSortMode(AGGREGATE_SORT_MODES[(currentIndex + 1) % AGGREGATE_SORT_MODES.length].value);
  };

  useEffect(() => () => window.clearTimeout(rowClickTimerRef.current), []);

  useEffect(() => {
    if (!renaming) return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [renaming]);

  useEffect(() => {
    if (!valueEditing) return;
    valueInputRef.current?.focus();
    valueInputRef.current?.select();
  }, [valueEditing]);

  useEffect(() => {
    if (!typeEditing) return;
    const currentType = UI_TYPE_TO_DUCKDB[type] ?? "VARCHAR";
    window.requestAnimationFrame(() => typeOptionRefs.current.get(currentType)?.focus());
    const closeOnOutsideClick = (event) => {
      if (typeMenuRef.current?.contains(event.target) || typeButtonRef.current?.contains(event.target)) return;
      setTypeEditing(false);
      setTypeError("");
    };
    const closeOnEscape = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setTypeEditing(false);
      setTypeError("");
      typeButtonRef.current?.focus();
    };
    const closeOnResize = () => {
      setTypeEditing(false);
      setTypeError("");
    };
    document.addEventListener("pointerdown", closeOnOutsideClick, true);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeOnResize);
    window.addEventListener("scroll", closeOnResize, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick, true);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeOnResize);
      window.removeEventListener("scroll", closeOnResize, true);
    };
  }, [typeEditing]);

  useEffect(() => {
    if (!valueMenu) return undefined;
    window.requestAnimationFrame(() => valueMenuRef.current?.querySelector("[role='menuitem']")?.focus());
    const closeOnOutsideClick = (event) => {
      if (valueMenuRef.current?.contains(event.target)) return;
      setValueMenu(null);
      setValueActionError("");
    };
    const closeOnEscape = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setValueMenu(null);
      setValueActionError("");
      valueMenuTriggerRef.current?.focus();
    };
    const closeOnResize = () => {
      setValueMenu(null);
      setValueActionError("");
    };
    document.addEventListener("pointerdown", closeOnOutsideClick, true);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeOnResize);
    window.addEventListener("scroll", closeOnResize, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick, true);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeOnResize);
      window.removeEventListener("scroll", closeOnResize, true);
    };
  }, [valueMenu]);

  const startRename = () => {
    setRenameDraft(column);
    setRenameError("");
    cancelRenameRef.current = false;
    setRenaming(true);
  };

  const commitRename = async () => {
    if (cancelRenameRef.current || renameSaving) {
      cancelRenameRef.current = false;
      return;
    }
    const nextName = renameDraft.trim();
    if (nextName === column) {
      setRenaming(false);
      setRenameError("");
      return;
    }
    setRenameSaving(true);
    setRenameError("");
    try {
      await onRename(column, nextName);
      setRenaming(false);
    } catch (cause) {
      setRenameError(cause instanceof Error ? cause.message : t("renameFailed"));
      window.setTimeout(() => renameInputRef.current?.focus(), 0);
    } finally {
      setRenameSaving(false);
    }
  };

  const startTypeEdit = (anchor) => {
    if (typeEditing) {
      setTypeEditing(false);
      setTypeError("");
      return;
    }
    const bounds = anchor.getBoundingClientRect();
    const menuWidth = 168;
    const menuHeight = COLUMN_TYPE_OPTIONS.length * 34 + 12;
    const belowTop = bounds.bottom + 5;
    const top = belowTop + menuHeight <= window.innerHeight - 8
      ? belowTop
      : Math.max(8, bounds.top - menuHeight - 5);
    setTypeDraft(UI_TYPE_TO_DUCKDB[type] ?? "VARCHAR");
    setTypeError("");
    setTypeMenuPosition({
      top,
      left: Math.min(Math.max(8, bounds.left), window.innerWidth - menuWidth - 8),
      width: menuWidth,
    });
    setTypeEditing(true);
  };

  const commitTypeEdit = async (targetType) => {
    const currentType = UI_TYPE_TO_DUCKDB[type] ?? "VARCHAR";
    setTypeDraft(targetType);
    if (targetType === currentType) {
      setTypeEditing(false);
      setTypeError("");
      return;
    }
    setTypeSaving(true);
    setTypeError("");
    try {
      await onChangeType(column, targetType);
      setTypeEditing(false);
    } catch (cause) {
      setTypeError(cause instanceof Error ? cause.message : t("typeFailed"));
      window.setTimeout(() => typeOptionRefs.current.get(targetType)?.focus(), 0);
    } finally {
      setTypeSaving(false);
    }
  };

  const navigateTypeMenu = (event) => {
    const currentIndex = COLUMN_TYPE_OPTIONS.findIndex((option) => option.value === event.currentTarget.dataset.typeValue);
    let nextIndex = currentIndex;
    if (event.key === "ArrowDown") nextIndex = (currentIndex + 1) % COLUMN_TYPE_OPTIONS.length;
    else if (event.key === "ArrowUp") nextIndex = (currentIndex - 1 + COLUMN_TYPE_OPTIONS.length) % COLUMN_TYPE_OPTIONS.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = COLUMN_TYPE_OPTIONS.length - 1;
    else return;
    event.preventDefault();
    typeOptionRefs.current.get(COLUMN_TYPE_OPTIONS[nextIndex].value)?.focus();
  };

  const startValueEdit = (item) => {
    if (item.raw === null || item.raw === undefined || item.raw === "") return;
    window.clearTimeout(rowClickTimerRef.current);
    setEditingValueKey(item.key);
    setValueDraft(String(item.raw));
    setValueError("");
    cancelValueEditRef.current = false;
  };

  const commitValueEdit = async (item) => {
    if (cancelValueEditRef.current || valueSaving) {
      cancelValueEditRef.current = false;
      return;
    }
    if (valueDraft === String(item.raw)) {
      setEditingValueKey(null);
      setValueError("");
      return;
    }
    setValueSaving(true);
    setValueError("");
    try {
      await onReplaceValue(column, item, valueDraft);
      setEditingValueKey(null);
    } catch (cause) {
      setValueError(cause instanceof Error ? cause.message : t("valueFailed"));
      window.setTimeout(() => valueInputRef.current?.focus(), 0);
    } finally {
      setValueSaving(false);
    }
  };

  const openValueMenu = (event, item) => {
    if (renaming || inlineEditing) return;
    event.preventDefault();
    event.stopPropagation();
    window.clearTimeout(rowClickTimerRef.current);
    const bounds = event.currentTarget.getBoundingClientRect();
    const menuWidth = 164;
    const menuHeight = 86;
    const pointerTriggered = event.type === "contextmenu" && event.clientX > 0;
    const requestedLeft = pointerTriggered ? event.clientX : bounds.left + 12;
    const requestedTop = pointerTriggered ? event.clientY : bounds.bottom - 4;
    valueMenuTriggerRef.current = event.currentTarget;
    setValueActionError("");
    setValueMenu({
      item,
      left: Math.min(Math.max(8, requestedLeft), window.innerWidth - menuWidth - 8),
      top: Math.min(Math.max(8, requestedTop), window.innerHeight - menuHeight - 8),
      width: menuWidth,
    });
  };

  const navigateValueMenu = (event) => {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const items = [...(valueMenuRef.current?.querySelectorAll("[role='menuitem']:not(:disabled)") ?? [])];
    if (!items.length) return;
    const currentIndex = items.indexOf(document.activeElement);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : event.key === "ArrowDown"
          ? (currentIndex + 1 + items.length) % items.length
          : (currentIndex - 1 + items.length) % items.length;
    items[nextIndex].focus();
  };

  const commitValueAction = async (action) => {
    if (!valueMenu || valueActionApplying) return;
    setValueActionApplying(true);
    setValueActionError("");
    try {
      await onValueAction(action, column, valueMenu.item);
      setValueMenu(null);
    } catch (cause) {
      setValueActionError(cause instanceof Error ? cause.message : t("valueActionFailed"));
    } finally {
      setValueActionApplying(false);
    }
  };

  useEffect(() => {
    if (!query.trim()) {
      setDisplayValues(values);
      setMatchCount(distinctCount);
      setSearching(false);
      setSearchError("");
      return undefined;
    }

    let active = true;
    setSearching(true);
    setSearchError("");
    const timer = window.setTimeout(async () => {
      try {
        const result = await onSearch(column, query);
        if (active) {
          setDisplayValues(result.values);
          setMatchCount(result.matchCount);
        }
      } catch (cause) {
        if (active) setSearchError(cause instanceof Error ? cause.message : t("searchFailed"));
      } finally {
        if (active) setSearching(false);
      }
    }, 220);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [column, distinctCount, filterSignature, onSearch, query, values]);

  return (
    <>
    <article className="frequency-card" data-column={column} style={style}>
      <header>
        <div className="frequency-card__title">
          {renaming ? (
            <label className="frequency-card__rename">
              <span className="visually-hidden">{t("newColumnName", { column })}</span>
              <input
                ref={renameInputRef}
                value={renameDraft}
                disabled={renameSaving}
                aria-invalid={Boolean(renameError)}
                aria-describedby={renameError ? `rename-error-${column}` : undefined}
                onChange={(event) => setRenameDraft(event.target.value)}
                onBlur={commitRename}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    cancelRenameRef.current = true;
                    setRenameError("");
                    setRenaming(false);
                  }
                }}
              />
              {renameError && <span id={`rename-error-${column}`} className="frequency-card__rename-error" role="alert">{renameError}</span>}
            </label>
          ) : (
            <strong
              title={t("renameHint", { column })}
              role="button"
              tabIndex={inlineEditing ? -1 : 0}
              aria-disabled={inlineEditing}
              onDoubleClick={() => { if (!inlineEditing) startRename(); }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !inlineEditing) startRename();
              }}
            >
              {column}
            </strong>
          )}
          <div className="frequency-card__actions">
            <button className="frequency-card__sort" type="button" onClick={cycleSort} disabled={renaming || inlineEditing} aria-label={t("changeSort", { column, sort: t(activeSort.labelKey) })} title={t(activeSort.labelKey)}>
              <span aria-hidden="true">{activeSort.token}</span>
            </button>
            <button className={transformOpen || transformUsed ? "frequency-card__transform--active" : ""} type="button" disabled={renaming || inlineEditing} onClick={(event) => onTransform(column, event.currentTarget)} aria-label={`${t("cleanBuildColumn", { column })}${transformUsed ? `. ${t("hasActiveStep")}` : ""}`} title={`${t("cleanBuildColumn", { column })}${transformUsed ? ` · ${t("hasActiveStep")}` : ""}`} aria-expanded={transformOpen}>
              <MagicWand weight="bold" />
            </button>
          </div>
        </div>
        <span className="frequency-card__count">
          <button
            ref={typeButtonRef}
            className={`frequency-card__type ${typeEditing ? "frequency-card__type--active" : ""}`}
            type="button"
            disabled={renaming || valueEditing}
            onClick={(event) => startTypeEdit(event.currentTarget)}
            aria-label={t("changeColumnType", { column, type: t(UI_TYPE_LABEL_KEY[type] ?? "textType") })}
            title={t("changeColumnType", { column, type: t(UI_TYPE_LABEL_KEY[type] ?? "textType") })}
            aria-haspopup="listbox"
            aria-expanded={typeEditing}
          >
            {t(UI_TYPE_LABEL_KEY[type] ?? "textType")}<CaretDown weight="bold" aria-hidden="true" />
          </button>
          {" · "}{Math.min(displayValues.length, 100)} / {formatNumber(matchCount)}
        </span>
        <label className="aggregate-search">
          <MagnifyingGlass weight="bold" />
          <input value={query} disabled={inlineEditing} onChange={(event) => setQuery(event.target.value)} placeholder={t("searchValues")} aria-label={`${t("searchValues")} ${column}`} />
          {query && <button type="button" onClick={() => setQuery("")} aria-label={t("clearSearch", { column })}><X weight="bold" /></button>}
        </label>
      </header>
      <div ref={valuesScrollRef} className={`frequency-card__scroll ${searching ? "frequency-card__scroll--loading" : ""}`} onScroll={(event) => setValuesScrollTop(event.currentTarget.scrollTop)} data-virtualized="true">
        <table>
          <thead><tr><th>{t("value")}</th><th>{t("count")}</th></tr></thead>
          <tbody>
            {valueTopSpace > 0 && <tr className="frequency-virtual-spacer"><td colSpan="2" style={{ height: valueTopSpace }} /></tr>}
            {visibleDisplayValues.map((item) => (
              <tr
                key={item.key}
                className={selectedKey === item.key ? "frequency-row-item--selected" : ""}
                tabIndex={0}
                aria-selected={selectedKey === item.key}
                aria-haspopup="menu"
                onContextMenu={(event) => openValueMenu(event, item)}
                onClick={() => {
                  if (renaming || inlineEditing) return;
                  window.clearTimeout(rowClickTimerRef.current);
                  rowClickTimerRef.current = window.setTimeout(() => onSelect(column, item), 220);
                }}
                onDoubleClick={(event) => {
                  if (renaming || inlineEditing) return;
                  event.preventDefault();
                  window.clearTimeout(rowClickTimerRef.current);
                  if (item.raw !== null && item.raw !== undefined && item.raw !== "") startValueEdit(item);
                }}
                onKeyDown={(event) => {
                  if (inlineEditing) return;
                  if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                    openValueMenu(event, item);
                  } else if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(column, item);
                  }
                }}
              >
                <td className={editingValueKey === item.key ? "frequency-value-cell--editing" : ""} title={editingValueKey === item.key ? undefined : item.raw === null || item.raw === undefined ? t("emptyValue") : item.label}>
                  {editingValueKey === item.key ? (
                    <label className="frequency-value-editor">
                      <span className="visually-hidden">{t("newValue", { value: item.raw === null || item.raw === undefined ? t("emptyValue") : item.label, column })}</span>
                      <input
                        ref={valueInputRef}
                        value={valueDraft}
                        disabled={valueSaving}
                        aria-invalid={Boolean(valueError)}
                        onChange={(event) => setValueDraft(event.target.value)}
                        onBlur={() => commitValueEdit(item)}
                        onKeyDown={(event) => {
                          event.stopPropagation();
                          if (event.key === "Enter") {
                            event.preventDefault();
                            event.currentTarget.blur();
                          } else if (event.key === "Escape") {
                            event.preventDefault();
                            cancelValueEditRef.current = true;
                            setValueError("");
                            setEditingValueKey(null);
                          }
                        }}
                      />
                      {valueError && <span className="frequency-value-editor__error" role="alert">{valueError}</span>}
                    </label>
                  ) : item.raw === null || item.raw === undefined || item.raw === "" ? t("emptyValue") : formatValue(item.raw, valueLocale)}
                </td>
                <td>{formatNumber(item.count)}</td>
              </tr>
            ))}
            {valueBottomSpace > 0 && <tr className="frequency-virtual-spacer"><td colSpan="2" style={{ height: valueBottomSpace }} /></tr>}
            {!searching && displayValues.length === 0 && (
              <tr><td className="aggregate-empty" colSpan="2">{t("noValuesFound")}</td></tr>
            )}
            {searchError && <tr><td className="aggregate-empty" colSpan="2" role="alert">{searchError}</td></tr>}
          </tbody>
        </table>
      </div>
    </article>
    {typeEditing && typeMenuPosition && createPortal(
      <div
        ref={typeMenuRef}
        className="frequency-type-menu"
        style={typeMenuPosition}
        role="listbox"
        aria-label={t("newColumnType", { column })}
        aria-busy={typeSaving}
      >
        {COLUMN_TYPE_OPTIONS.map((option) => {
          const selected = typeDraft === option.value;
          return (
            <button
              key={option.value}
              ref={(element) => {
                if (element) typeOptionRefs.current.set(option.value, element);
                else typeOptionRefs.current.delete(option.value);
              }}
              type="button"
              role="option"
              aria-selected={selected}
              data-type-value={option.value}
              disabled={typeSaving}
              onClick={() => commitTypeEdit(option.value)}
              onKeyDown={navigateTypeMenu}
            >
              <span>{t(option.labelKey)}</span>
              {selected && <Check weight="bold" aria-hidden="true" />}
            </button>
          );
        })}
        {typeError && <div className="frequency-type-menu__error" role="alert">{typeError}</div>}
      </div>,
      document.body,
    )}
    {valueMenu && createPortal(
      <div
        ref={valueMenuRef}
        className="frequency-value-menu"
        style={{ top: valueMenu.top, left: valueMenu.left, width: valueMenu.width }}
        role="menu"
        aria-label={t("valueActions", {
          value: valueMenu.item.raw === null || valueMenu.item.raw === undefined || valueMenu.item.raw === "" ? t("emptyValue") : valueMenu.item.label,
          column,
        })}
        aria-busy={valueActionApplying}
      >
        <button type="button" role="menuitem" disabled={valueActionApplying} onClick={() => commitValueAction("keep")} onKeyDown={navigateValueMenu}>{t("keepValue")}</button>
        <button className="frequency-value-menu__delete" type="button" role="menuitem" disabled={valueActionApplying} onClick={() => commitValueAction("delete")} onKeyDown={navigateValueMenu}>{t("deleteValue")}</button>
        {valueActionError && <div className="frequency-value-menu__error" role="alert">{valueActionError}</div>}
      </div>,
      document.body,
    )}
    </>
  );
}

function VirtualAggregateRow({ aggregates, renderAggregate }) {
  const scrollRef = useRef(null);
  const [viewportWidth, setViewportWidth] = useState(900);
  const [scrollLeft, setScrollLeft] = useState(0);
  const aggregateSignature = aggregates.map((aggregate) => aggregate.column).join("\u001f");

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return undefined;
    const observer = new ResizeObserver((entries) => setViewportWidth(entries[0].contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setScrollLeft(0);
    if (scrollRef.current) scrollRef.current.scrollLeft = 0;
  }, [aggregateSignature]);

  const cardWidth = viewportWidth <= 520 ? 154 : Math.min(195, Math.max(174, (viewportWidth - 72) / 7));
  const stride = cardWidth + FREQUENCY_CARD_GAP;
  const start = Math.max(0, Math.floor(scrollLeft / stride) - FREQUENCY_CARD_OVERSCAN);
  const visibleCount = Math.ceil(viewportWidth / stride) + FREQUENCY_CARD_OVERSCAN * 2;
  const end = Math.min(aggregates.length, start + visibleCount);
  const trackWidth = Math.max(0, aggregates.length * stride - FREQUENCY_CARD_GAP);

  return (
    <div className="frequency-row" ref={scrollRef} onScroll={(event) => setScrollLeft(event.currentTarget.scrollLeft)} data-virtualized="true">
      <div className="frequency-row__track" style={{ width: trackWidth, "--frequency-card-width": `${cardWidth}px` }}>
        {aggregates.slice(start, end).map((aggregate, offset) => renderAggregate(aggregate, {
          position: "absolute",
          top: 0,
          left: (start + offset) * stride,
        }))}
      </div>
    </div>
  );
}

function VirtualPreview({ rows, columns, datasetId, locale }) {
  const { t } = useI18n();
  const scrollRef = useRef(null);
  const [viewportHeight, setViewportHeight] = useState(320);
  const [viewportWidth, setViewportWidth] = useState(900);
  const [scrollTop, setScrollTop] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return undefined;
    const observer = new ResizeObserver((entries) => {
      setViewportHeight(entries[0].contentRect.height);
      setViewportWidth(entries[0].contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setScrollTop(0);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [datasetId, rows]);

  const start = Math.max(0, Math.floor(scrollTop / PREVIEW_ROW_HEIGHT) - PREVIEW_OVERSCAN);
  const visibleCount = Math.ceil(viewportHeight / PREVIEW_ROW_HEIGHT) + PREVIEW_OVERSCAN * 2;
  const end = Math.min(rows.length, start + visibleCount);
  const visibleRows = rows.slice(start, end);
  const topSpace = start * PREVIEW_ROW_HEIGHT;
  const bottomSpace = Math.max(0, (rows.length - end) * PREVIEW_ROW_HEIGHT);
  const columnStart = Math.max(0, Math.floor(Math.max(0, scrollLeft - 48) / PREVIEW_COLUMN_WIDTH) - PREVIEW_COLUMN_OVERSCAN);
  const visibleColumnCount = Math.ceil(viewportWidth / PREVIEW_COLUMN_WIDTH) + PREVIEW_COLUMN_OVERSCAN * 2;
  const columnEnd = Math.min(columns.length, columnStart + visibleColumnCount);
  const visibleColumns = columns.slice(columnStart, columnEnd);
  const leftColumnSpace = columnStart * PREVIEW_COLUMN_WIDTH;
  const rightColumnSpace = Math.max(0, (columns.length - columnEnd) * PREVIEW_COLUMN_WIDTH);
  const renderedColumnCount = visibleColumns.length + (leftColumnSpace > 0 ? 1 : 0) + (rightColumnSpace > 0 ? 1 : 0);

  return (
    <div className="data-grid-wrap" ref={scrollRef} onScroll={(event) => { setScrollTop(event.currentTarget.scrollTop); setScrollLeft(event.currentTarget.scrollLeft); }} data-virtualized="true">
      <table className="data-grid" style={{ width: 48 + columns.length * PREVIEW_COLUMN_WIDTH }}>
        <thead>
          <tr>
            <th className="row-number" aria-label={t("rowNumber")} />
            {leftColumnSpace > 0 && <th className="virtual-column-spacer" aria-hidden="true" style={{ width: leftColumnSpace, minWidth: leftColumnSpace }} />}
            {visibleColumns.map((column) => <th key={column} title={column}>{column}</th>)}
            {rightColumnSpace > 0 && <th className="virtual-column-spacer" aria-hidden="true" style={{ width: rightColumnSpace, minWidth: rightColumnSpace }} />}
          </tr>
        </thead>
        <tbody>
          {topSpace > 0 && <tr className="virtual-spacer"><td colSpan={renderedColumnCount + 1} style={{ height: topSpace }} /></tr>}
          {visibleRows.map((row, index) => {
            const rowIndex = start + index;
            const displayValue = (value) => value === null || value === undefined || value === "" ? t("emptyValue") : formatValue(value, locale);
            return (
              <tr key={rowIndex} data-preview-row={rowIndex}>
                <td className="row-number">{rowIndex + 1}</td>
                {leftColumnSpace > 0 && <td className="virtual-column-spacer" aria-hidden="true" style={{ width: leftColumnSpace, minWidth: leftColumnSpace }} />}
                {visibleColumns.map((column) => <td key={column} title={displayValue(row[column])}>{displayValue(row[column])}</td>)}
                {rightColumnSpace > 0 && <td className="virtual-column-spacer" aria-hidden="true" style={{ width: rightColumnSpace, minWidth: rightColumnSpace }} />}
              </tr>
            );
          })}
          {bottomSpace > 0 && <tr className="virtual-spacer"><td colSpan={renderedColumnCount + 1} style={{ height: bottomSpace }} /></tr>}
          {rows.length === 0 && (
            <tr><td className="empty-preview" colSpan={renderedColumnCount + 1}>{t("noMatchingRows")}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function DataScreen({
  dataset,
  activePreparedId,
  preparedName,
  preparedOptions,
  filters,
  loading,
  error,
  recipe,
  initialRecipeError,
  initialInvalidStepId,
  canUndo,
  canRedo,
  onFiltersChange,
  onAggregateSearch,
  onRecipeChange,
  onRecipeUndo,
  onRecipeRedo,
  onRecipePreview,
  onPreparedChange,
  codingProject,
  onSaveCodingProject,
  onGrantCodingAccess,
  onRevokeCodingAccess,
  onReviewCodingAssignment,
  onLoadCodingEvidence,
  onMaterializeCodingProject,
  deleteRequest,
  onDeleteRequestShown,
  onDeleteConfirmation,
}) {
  const { formatNumber, language, t, toolLabel } = useI18n();
  const valueLocale = language === "id" ? "id-ID" : "en-US";
  const [topHeight, setTopHeight] = useState(430);
  const [updating, setUpdating] = useState(false);
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  const [aggregateColumns, setAggregateColumns] = useState(dataset.aggregateColumns);
  const [columnDraft, setColumnDraft] = useState(dataset.aggregateColumns);
  const [columnQuery, setColumnQuery] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [transformPopover, setTransformPopover] = useState(null);
  const [transformError, setTransformError] = useState("");
  const [transformApplying, setTransformApplying] = useState(false);
  const [recipeApplying, setRecipeApplying] = useState(false);
  const [recipeError, setRecipeError] = useState("");
  const [invalidStepId, setInvalidStepId] = useState(null);
  const [stepPreview, setStepPreview] = useState(null);
  const [previewingStep, setPreviewingStep] = useState(false);
  const [preparedMenuOpen, setPreparedMenuOpen] = useState(false);
  const [formulaEditorOpen, setFormulaEditorOpen] = useState(false);
  const [formulaApplying, setFormulaApplying] = useState(false);
  const [formulaError, setFormulaError] = useState("");
  const [codingPanelOpen, setCodingPanelOpen] = useState(false);
  const [codingBusy, setCodingBusy] = useState(false);
  const [codingError, setCodingError] = useState("");
  const splitRef = useRef(null);
  const preparedSelectorRef = useRef(null);
  const columnPickerRef = useRef(null);
  const transformPopoverRef = useRef(null);
  const formulaPopoverRef = useRef(null);
  const formulaTriggerRef = useRef(null);
  const [sidebarStepsTarget, setSidebarStepsTarget] = useState(null);
  const activeFilterCount = Object.keys(filters).length;
  const filterSignature = JSON.stringify(filters);

  useEffect(() => {
    setSidebarStepsTarget(document.getElementById("sidebar-steps"));
  }, []);

  useEffect(() => {
    setPreparedMenuOpen(false);
    setColumnMenuOpen(false);
    setTransformPopover(null);
    setFormulaEditorOpen(false);
    setCodingPanelOpen(false);
    setCodingError("");
    setFormulaError("");
    setTransformError("");
    setAggregateColumns(dataset.aggregateColumns);
    setColumnDraft(dataset.aggregateColumns);
    setColumnQuery("");
  }, [dataset.datasetId]);

  useEffect(() => {
    if (!preparedMenuOpen) return undefined;
    const closeOnOutsideClick = (event) => {
      if (!preparedSelectorRef.current?.contains(event.target)) setPreparedMenuOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setPreparedMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [preparedMenuOpen]);

  useEffect(() => {
    setRecipeError(initialRecipeError ?? "");
    setInvalidStepId(initialInvalidStepId ?? null);
  }, [dataset.datasetId, initialInvalidStepId, initialRecipeError]);

  useEffect(() => {
    if (!actionNotice) return undefined;
    const timer = window.setTimeout(() => setActionNotice(""), 4500);
    return () => window.clearTimeout(timer);
  }, [actionNotice]);

  useEffect(() => {
    if (!columnMenuOpen) return undefined;
    const closeOnOutsideClick = (event) => {
      if (!columnPickerRef.current?.contains(event.target)) setColumnMenuOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setColumnMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsideClick, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [columnMenuOpen]);

  useEffect(() => {
    if (!transformPopover) return undefined;
    const closeOnOutsideClick = (event) => {
      if (transformPopoverRef.current?.contains(event.target)) return;
      if (transformPopover.anchor?.contains(event.target)) return;
      setTransformPopover(null);
      setTransformError("");
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        setTransformPopover(null);
        setTransformError("");
      }
    };
    const closeOnViewportChange = () => {
      setTransformPopover(null);
      setTransformError("");
    };
    document.addEventListener("pointerdown", closeOnOutsideClick, true);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeOnViewportChange);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick, true);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeOnViewportChange);
    };
  }, [transformPopover]);

  useEffect(() => {
    if (!formulaEditorOpen) return undefined;
    const closeOnOutsideClick = (event) => {
      if (formulaPopoverRef.current?.contains(event.target) || formulaTriggerRef.current?.contains(event.target)) return;
      setFormulaEditorOpen(false);
      setFormulaError("");
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        setFormulaEditorOpen(false);
        setFormulaError("");
      }
    };
    document.addEventListener("pointerdown", closeOnOutsideClick, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [formulaEditorOpen]);

  const applyFilters = useCallback(async (nextFilters, nextAggregateColumns = aggregateColumns) => {
    setStepPreview(null);
    setUpdating(true);
    setActionError("");
    try {
      await onFiltersChange(nextFilters, nextAggregateColumns);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t("filterFailed"));
    } finally {
      setUpdating(false);
    }
  }, [aggregateColumns, onFiltersChange]);

  const acceptRecipeResult = useCallback((result) => {
    setStepPreview(null);
    setAggregateColumns(result.aggregateColumns);
    setColumnDraft(result.aggregateColumns);
    if (result.removedFilterColumns?.length > 0) {
      setActionNotice(t("filtersRemoved", { count: result.removedFilterColumns.length }));
    }
    if (result.recipeError) {
      setRecipeError(result.recipeError.message);
      setInvalidStepId(result.recipeError.stepId ?? null);
    } else {
      setRecipeError("");
      setInvalidStepId(null);
    }
  }, []);

  const toggleAggregateColumn = (column) => {
    setColumnDraft((current) => {
      if (current.includes(column)) return current.filter((item) => item !== column);
      if (current.length >= dataset.aggregateColumnLimit) return current;
      return [...current, column];
    });
  };

  const applyAggregateColumns = async () => {
    const selected = new Set(columnDraft);
    const nextColumns = dataset.columns.filter((column) => selected.has(column)).slice(0, dataset.aggregateColumnLimit);
    setColumnMenuOpen(false);
    setUpdating(true);
    setActionError("");
    try {
      const result = await onFiltersChange(filters, nextColumns);
      setAggregateColumns(result.aggregateColumns);
      setColumnDraft(result.aggregateColumns);
    } catch (cause) {
      setAggregateColumns(dataset.aggregateColumns);
      setColumnDraft(dataset.aggregateColumns);
      setActionError(cause instanceof Error ? cause.message : t("aggregateColumnsFailed"));
    } finally {
      setUpdating(false);
    }
  };

  const visibleColumnOptions = dataset.columns.filter((column) =>
    column.toLocaleLowerCase("id-ID").includes(columnQuery.trim().toLocaleLowerCase("id-ID")),
  );

  const toggleFilter = (column, item) => {
    const next = { ...filters };
    if (next[column]?.key === item.key) delete next[column];
    else next[column] = { key: item.key, raw: item.raw, label: item.label };
    applyFilters(next);
  };

  const filterChips = Object.entries(filters).map(([column, selection]) => ({
    column,
    ...selection,
  }));

  const searchAggregate = useCallback(
    (column, query) => onAggregateSearch(column, query, filters),
    [filters, onAggregateSearch],
  );

  const openColumnTransformation = (column, tool, initialParams, anchor) => {
    setColumnMenuOpen(false);
    setTransformError("");
    const bounds = anchor.getBoundingClientRect();
    const width = Math.min(330, window.innerWidth - 24);
    setTransformPopover({
      column,
      anchor,
      tool,
      initialParams,
      top: Math.min(bounds.bottom + 8, Math.max(88, window.innerHeight - 520)),
      left: Math.min(Math.max(12, bounds.left), window.innerWidth - width - 12),
    });
  };

  const startColumnTransformation = (column, anchor) => {
    if (transformPopover?.column === column && !transformPopover.tool) {
      setTransformPopover(null);
      return;
    }
    openColumnTransformation(column, null, undefined, anchor);
  };

  const addColumnTransformation = async (type, params) => {
    const step = createStep(type, params);
    const nextRecipe = [...recipe, step];
    setTransformApplying(true);
    setTransformError("");
    setRecipeError("");
    setInvalidStepId(null);
    try {
      const result = await onRecipeChange(nextRecipe);
      acceptRecipeResult(result);
      setTransformPopover(null);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : t("stepFailed");
      setTransformError(message);
      setRecipeError(message);
      setInvalidStepId(step.id);
    } finally {
      setTransformApplying(false);
    }
  };

  const previewFormulaStep = async (params, referencedColumns, stepId = null, editingRecipe = recipe) => {
    const formulaStep = stepId
      ? { ...editingRecipe.find((step) => step.id === stepId), type: "calculated-field", params }
      : createStep("calculated-field", params);
    const nextRecipe = stepId
      ? editingRecipe.map((step) => step.id === stepId ? formulaStep : step)
      : [...editingRecipe, formulaStep];
    const stepIndex = nextRecipe.findIndex((step) => step.id === formulaStep.id);
    const columns = [...new Set([...referencedColumns.slice(0, 3), params.outputColumn])];
    return onRecipePreview(nextRecipe, stepIndex, { columns, limit: 10 });
  };

  const addFormulaColumn = async (params) => {
    const step = createStep("calculated-field", params);
    setFormulaApplying(true);
    setFormulaError("");
    setRecipeError("");
    setInvalidStepId(null);
    try {
      const result = await onRecipeChange([...recipe, step]);
      acceptRecipeResult(result);
      setFormulaEditorOpen(false);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : t("formulaApplyFailed");
      setFormulaError(message);
      setRecipeError(message);
      setInvalidStepId(step.id);
    } finally {
      setFormulaApplying(false);
    }
  };

  const applyInlineTransformation = async (type, params, fallbackMessage) => {
    const step = createStep(type, params);
    const nextRecipe = [...recipe, step];
    setRecipeError("");
    setInvalidStepId(null);
    try {
      const result = await onRecipeChange(nextRecipe);
      acceptRecipeResult(result);
      return result;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : fallbackMessage;
      setRecipeError(message);
      setInvalidStepId(step.id);
      throw cause;
    }
  };

  const renameColumnInline = async (column, nextName) => {
    const normalizedName = String(nextName ?? "").trim();
    if (!normalizedName) throw new Error(t("columnNameRequired"));
    const collision = dataset.columns.find((item) => item !== column && item.toLocaleLowerCase("id-ID") === normalizedName.toLocaleLowerCase("id-ID"));
    if (collision) throw new Error(t("columnExists", { column: normalizedName }));
    if (normalizedName === column) return null;
    return applyInlineTransformation("rename-column", { column, newName: normalizedName }, t("renameFailed"));
  };

  const changeColumnTypeInline = async (column, targetType) => (
    applyInlineTransformation("change-type", { column, targetType }, t("typeFailed"))
  );

  const replaceValueInline = async (column, item, nextValue) => {
    if (item.raw === null || item.raw === undefined || item.raw === "") return null;
    if (String(nextValue) === String(item.raw)) return null;
    return applyInlineTransformation("replace-value", { column, from: item.raw, to: nextValue }, t("valueFailed"));
  };

  const applyValueRowAction = async (action, column, item) => (
    applyInlineTransformation("delete-rows", valueRowActionParams(action, column, item.raw), t("valueActionFailed"))
  );

  const startResize = useCallback((event) => {
    event.preventDefault();
    const container = splitRef.current;
    if (!container) return;
    const bounds = container.getBoundingClientRect();
    const move = (moveEvent) => setTopHeight(Math.min(Math.max(moveEvent.clientY - bounds.top, 250), bounds.height - 250));
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      document.body.classList.remove("is-resizing");
    };
    document.body.classList.add("is-resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  }, []);

  const applyRecipeMutation = async (nextRecipe, changedStepId) => {
    setRecipeApplying(true);
    setRecipeError("");
    setInvalidStepId(null);
    try {
      const result = await onRecipeChange(nextRecipe);
      acceptRecipeResult(result);
      return result;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : t("recipeFailed");
      const failedStep = cause?.stepId
        ? nextRecipe.find((step) => step.id === cause.stepId)
        : Number.isInteger(cause?.stepIndex) ? nextRecipe[cause.stepIndex] : null;
      setInvalidStepId(failedStep?.id ?? changedStepId);
      setRecipeError(message);
      return null;
    } finally {
      setRecipeApplying(false);
    }
  };

  const applyHistoryAction = async (action) => {
    setRecipeApplying(true);
    setRecipeError("");
    setInvalidStepId(null);
    try {
      const result = await action();
      if (result) {
        acceptRecipeResult(result);
      }
    } catch (cause) {
      setRecipeError(cause instanceof Error ? cause.message : t("recipeHistoryFailed"));
    } finally {
      setRecipeApplying(false);
    }
  };

  const previewAfterStep = async (stepIndex) => {
    setPreviewingStep(true);
    setRecipeError("");
    try {
      setStepPreview(await onRecipePreview(recipe, stepIndex));
    } catch (cause) {
      setRecipeError(cause instanceof Error ? cause.message : t("previewFailed"));
    } finally {
      setPreviewingStep(false);
    }
  };

  const previewRows = stepPreview?.preview ?? dataset.preview;
  const previewColumns = stepPreview?.columns ?? dataset.columns;
  const hasQualityIssues = dataset.quality.emptyCells > 0 || dataset.quality.mixedColumns > 0;
  const qualityLabel = `${t("dataQuality")}: ${formatNumber(dataset.quality.emptyCells)} ${t("emptyCells")}, ${formatNumber(dataset.quality.mixedColumns)} ${t("mixedColumns")}`;

  return (
    <main className={`data-screen ${updating ? "data-screen--updating" : ""}`}>
      <header className="file-toolbar">
        <div className="file-heading">
          <span className="file-heading__icon"><FileXls weight="duotone" /></span>
          <div className="file-heading__content">
            <div className="prepared-selector" ref={preparedSelectorRef}>
              <button
                className="prepared-selector__trigger"
                type="button"
                onClick={() => setPreparedMenuOpen((current) => !current)}
                disabled={loading}
                aria-label={t("selectPreparedDataset")}
                aria-haspopup="listbox"
                aria-expanded={preparedMenuOpen}
                title={`${preparedName ?? dataset.filename} · ${dataset.filename}`}
              >
                <strong>{preparedName ?? dataset.filename}</strong>
                <CaretDown weight="bold" aria-hidden="true" />
              </button>
              {preparedMenuOpen && (
                <div className="prepared-selector__menu" role="listbox" aria-label={t("preparedDatasets")}>
                  {preparedOptions.map((option) => {
                    const active = option.id === activePreparedId;
                    return (
                      <button
                        key={option.id}
                        className={active ? "prepared-selector__option prepared-selector__option--active" : "prepared-selector__option"}
                        type="button"
                        role="option"
                        aria-selected={active}
                        onClick={() => {
                          setPreparedMenuOpen(false);
                          if (!active) void onPreparedChange(option.id);
                        }}
                      >
                        <span>
                          <strong>{option.name}</strong>
                          <small>{option.sourceName}</small>
                        </span>
                        {active && <Check weight="bold" aria-hidden="true" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <span className="file-heading__stats" aria-label={`${formatNumber(dataset.rowCount)} ${t("rows")}, ${formatNumber(dataset.columns.length)} ${t("columns")}. ${qualityLabel}`}>
              <span><strong>{formatNumber(dataset.rowCount)}</strong> {t("rows")}</span>
              <span><strong>{formatNumber(dataset.columns.length)}</strong> {t("columns")}</span>
              <span
                className={`file-heading__quality ${hasQualityIssues ? "file-heading__quality--issues" : ""}`}
                title={hasQualityIssues ? qualityLabel : `${qualityLabel}. ${t("noBasicIssues")}`}
              >
                {hasQualityIssues ? <WarningCircle weight="fill" aria-hidden="true" /> : <ShieldCheck weight="bold" aria-hidden="true" />}
                <span><strong>{formatNumber(dataset.quality.emptyCells)}</strong> {t("emptyCells")}</span>
                <span><strong>{formatNumber(dataset.quality.mixedColumns)}</strong> {t("mixedColumns")}</span>
              </span>
            </span>
          </div>
        </div>
      </header>

      {formulaEditorOpen && createPortal(
        <section ref={formulaPopoverRef} className="formula-column-popover" aria-label={t("formulaColumn")}>
          <FormulaColumnEditor
            schema={dataset.columns.map((name) => ({ name, type: dataset.columnTypes?.[name] ?? "UNKNOWN" }))}
            title={t("formulaColumn")}
            submitLabel={t("add")}
            applying={formulaApplying}
            error={formulaError}
            onPreview={(params, referencedColumns) => previewFormulaStep(params, referencedColumns)}
            onSubmit={addFormulaColumn}
            onCancel={() => { setFormulaEditorOpen(false); setFormulaError(""); }}
          />
        </section>,
        document.body,
      )}

      {codingPanelOpen && createPortal(
        <QualitativeCodingPanel
          project={codingProject}
          preparedName={preparedName}
          columns={dataset.columns}
          totalResponses={dataset.rowCount}
          busy={codingBusy}
          error={codingError}
          onClose={() => { if (!codingBusy) { setCodingPanelOpen(false); setCodingError(""); } }}
          onSave={async (draft) => {
            setCodingBusy(true);
            setCodingError("");
            try { await onSaveCodingProject(draft); }
            catch (cause) { setCodingError(cause instanceof Error ? cause.message : t("codingSaveFailed")); }
            finally { setCodingBusy(false); }
          }}
          onGrantAccess={async () => {
            setCodingBusy(true);
            setCodingError("");
            try { await onGrantCodingAccess(); }
            catch (cause) { setCodingError(cause instanceof Error ? cause.message : t("codingSaveFailed")); }
            finally { setCodingBusy(false); }
          }}
          onRevokeAccess={async () => {
            setCodingBusy(true);
            setCodingError("");
            try { await onRevokeCodingAccess(); }
            catch (cause) { setCodingError(cause instanceof Error ? cause.message : t("codingSaveFailed")); }
            finally { setCodingBusy(false); }
          }}
          onReview={async (assignmentId, decision) => {
            setCodingBusy(true);
            setCodingError("");
            try { await onReviewCodingAssignment(assignmentId, decision); }
            catch (cause) { setCodingError(cause instanceof Error ? cause.message : t("codingSaveFailed")); }
            finally { setCodingBusy(false); }
          }}
          onLoadEvidence={onLoadCodingEvidence}
          onMaterialize={async () => {
            setCodingBusy(true);
            setCodingError("");
            try { await onMaterializeCodingProject(); }
            catch (cause) { setCodingError(cause instanceof Error ? cause.message : t("codingMaterializeFailed")); }
            finally { setCodingBusy(false); }
          }}
        />,
        document.body,
      )}

      {transformPopover && createPortal(
        <section
          ref={transformPopoverRef}
          className="column-transform-popover"
          style={{ top: transformPopover.top, left: transformPopover.left }}
          aria-label={transformPopover.tool ? t("configureColumnTool", { column: transformPopover.column }) : t("chooseColumnTool", { column: transformPopover.column })}
        >
          {transformPopover.tool ? (
            <TransformationForm
              key={`${transformPopover.column}:${transformPopover.tool}`}
              columns={[...dataset.sourceColumns, ...dataset.columns]}
              initialType={transformPopover.tool}
              initialParams={transformPopover.initialParams}
              initialColumn={transformPopover.column}
              hideBoundColumn
              hideModule
              title={`${toolLabel(transformPopover.tool)} · ${transformPopover.column}`}
              submitLabel={t("add")}
              applying={transformApplying}
              error={transformError}
              onSubmit={addColumnTransformation}
              onBack={() => { setTransformError(""); setTransformPopover((current) => current ? { ...current, tool: null } : null); }}
              onCancel={() => { setTransformPopover(null); setTransformError(""); }}
            />
          ) : (
            <div className="transform-tool-picker">
              <header><div><strong>{t("chooseTool")}</strong><span>{t("column")}: {transformPopover.column}</span></div><button type="button" onClick={() => setTransformPopover(null)} aria-label={t("closeToolPicker")}><X /></button></header>
              <div className="transform-tool-picker__groups">
                <section>
                  <div>
                    {CREATABLE_TRANSFORMATION_TYPES.map((item) => (
                      <button key={item.type} type="button" onClick={() => setTransformPopover((current) => current ? { ...current, tool: item.type } : null)}>
                        <span>{toolLabel(item.type)}</span><CaretRight weight="bold" />
                      </button>
                    ))}
                  </div>
                </section>
              </div>
            </div>
          )}
        </section>,
        document.body,
      )}

      {(actionError || error) && <div className="action-error action-error--import" role="alert"><WarningCircle weight="fill" /> {actionError || error}</div>}
      {actionNotice && <div className="action-notice" role="status">{actionNotice}</div>}

      <section className="split-workspace" ref={splitRef} style={{ gridTemplateRows: `${topHeight}px 16px minmax(0, 1fr)` }}>
        <section className="aggregate-pane" aria-labelledby="aggregate-title">
          <header className="aggregate-heading">
            <div>
              <h2 id="aggregate-title">{t("aggregateTitle")}</h2>
              {dataset.columns.length > aggregateColumns.length && <span>{t("columnsShown", { shown: aggregateColumns.length, total: dataset.columns.length })}</span>}
            </div>
            <div className="aggregate-heading__actions">
              <button ref={formulaTriggerRef} className="aggregate-heading__button aggregate-heading__button--formula" type="button" onClick={() => { setColumnMenuOpen(false); setTransformPopover(null); setPreparedMenuOpen(false); setFormulaError(""); setFormulaEditorOpen((current) => !current); }} disabled={loading || recipeApplying} aria-label={t("formulaColumn")} title={t("formulaColumn")} aria-expanded={formulaEditorOpen}>
                <MagicWand weight="bold" /> {t("formulaColumn")}
              </button>
              <button className="aggregate-heading__button" type="button" onClick={() => { setColumnMenuOpen(false); setTransformPopover(null); setPreparedMenuOpen(false); setFormulaEditorOpen(false); setFormulaError(""); setCodingError(""); setCodingPanelOpen(true); }} disabled={loading || recipeApplying} aria-label={t("qualitativeCoding")} title={t("qualitativeCoding")} aria-expanded={codingPanelOpen}>
                <Robot weight="bold" /> {t("qualitativeCoding")}
              </button>
              <div className="column-picker" ref={columnPickerRef}>
                <button type="button" className="column-picker__trigger" onClick={() => {
                  setFormulaEditorOpen(false);
                  setCodingPanelOpen(false);
                  setFormulaError("");
                  setColumnDraft(aggregateColumns);
                  setColumnQuery("");
                  setColumnMenuOpen((value) => !value);
                }} aria-expanded={columnMenuOpen}>
                  <Rows weight="bold" /> {t("chooseColumns")} <CaretDown weight="bold" />
                </button>
                {columnMenuOpen && (
                  <div className="column-picker__menu" role="dialog" aria-label={t("aggregateColumnPicker")}>
                    <header><strong>{t("miniTableColumns")}</strong><span>{t("maximum", { count: dataset.aggregateColumnLimit })}</span></header>
                    <label className="column-picker__search"><MagnifyingGlass /><input value={columnQuery} onChange={(event) => setColumnQuery(event.target.value)} placeholder={t("searchColumns")} aria-label={t("searchColumns")} /></label>
                    <div className="column-picker__bulk-actions" aria-label={t("columnSelectionActions")}>
                      <button
                        type="button"
                        onClick={() => setColumnDraft(dataset.columns.slice(0, dataset.aggregateColumnLimit))}
                        disabled={columnDraft.length === Math.min(dataset.columns.length, dataset.aggregateColumnLimit)}
                      >
                        {t("selectAll")}
                      </button>
                      <button type="button" onClick={() => setColumnDraft([])} disabled={columnDraft.length === 0}>
                        {t("unselectAll")}
                      </button>
                    </div>
                    <div className="column-picker__options">
                      {visibleColumnOptions.map((column) => {
                        const checked = columnDraft.includes(column);
                        return <label key={column}><input type="checkbox" checked={checked} disabled={!checked && columnDraft.length >= dataset.aggregateColumnLimit} onChange={() => toggleAggregateColumn(column)} /><span title={column}>{column}</span></label>;
                      })}
                      {visibleColumnOptions.length === 0 && <p>{t("noColumnsFound")}</p>}
                    </div>
                    <footer><span>{t("selectedCount", { count: columnDraft.length })}</span><button type="button" onClick={applyAggregateColumns} disabled={updating}>{t("apply")}</button></footer>
                  </div>
                )}
              </div>
            </div>
          </header>
          <VirtualAggregateRow
            aggregates={dataset.aggregates}
            renderAggregate={(aggregate, style) => (
              <FrequencyTable
                key={aggregate.column}
                aggregate={aggregate}
                style={style}
                selectedKey={filters[aggregate.column]?.key}
                onSelect={toggleFilter}
                onSearch={searchAggregate}
                onTransform={startColumnTransformation}
                onRename={renameColumnInline}
                onChangeType={changeColumnTypeInline}
                onReplaceValue={replaceValueInline}
                onValueAction={applyValueRowAction}
                transformOpen={transformPopover?.column === aggregate.column}
                transformUsed={recipe.some((step) => step.enabled !== false && miniTableToolTouchesColumn(step, aggregate.column))}
                filterSignature={filterSignature}
              />
            )}
          />
        </section>

        <button className="resize-handle" type="button" onPointerDown={startResize} aria-label={t("resizePanels")}><span /><span /><span /></button>

        <section className="preview-pane" aria-labelledby="preview-title">
          <header className="preview-heading">
            <div className="preview-heading__main">
              <h2 id="preview-title">
                {stepPreview ? t("previewAfterStep", { count: stepPreview.stepIndex + 1 }) : t("previewData")} <span>· &nbsp;{t("firstRows")}</span>
                {stepPreview && <span className="filter-result">· &nbsp;{formatNumber(stepPreview.rowCount)} {t("rows")}</span>}
                {!stepPreview && activeFilterCount > 0 && <span className="filter-result">· &nbsp;{formatNumber(dataset.filteredCount)} / {formatNumber(dataset.rowCount)} {t("rows")}</span>}
              </h2>
              {!stepPreview && filterChips.length > 0 && (
                <div className="filter-chips" aria-label={t("temporaryFilters")}>
                  <span className="filter-scope">{t("temporaryFilters")}</span>
                  {filterChips.map((chip) => (
                    <span className="filter-chip" key={chip.column}>
                      <strong>{chip.column}:</strong> {chip.raw === null || chip.raw === undefined ? t("emptyValue") : chip.label}
                      <button type="button" onClick={() => toggleFilter(chip.column, chip)} aria-label={t("removeFilter", { column: chip.column })}><X weight="bold" /></button>
                    </span>
                  ))}
                </div>
              )}
            </div>
            {stepPreview ? <button className="clear-filter" type="button" onClick={() => setStepPreview(null)}>{t("closePreview")}</button> : activeFilterCount > 0 && <button className="clear-filter" type="button" onClick={() => applyFilters({})}>{t("clearAll")}</button>}
          </header>
          <VirtualPreview rows={previewRows} columns={previewColumns} datasetId={`${dataset.datasetId}:${filterSignature}:${stepPreview?.stepId ?? "final"}`} locale={valueLocale} />
        </section>
      </section>

      {sidebarStepsTarget && createPortal(<StepsPanel
          open
          embedded
          columns={[...dataset.sourceColumns, ...dataset.columns]}
          schema={dataset.columns.map((name) => ({ name, type: dataset.columnTypes?.[name] ?? "UNKNOWN" }))}
          recipe={recipe}
          stepStates={dataset.stepStates ?? []}
          invalidStepId={invalidStepId}
          error={recipeError}
          applying={recipeApplying}
          canUndo={canUndo}
          canRedo={canRedo}
          onChange={applyRecipeMutation}
          onUndo={() => applyHistoryAction(onRecipeUndo)}
          onRedo={() => applyHistoryAction(onRecipeRedo)}
          onPreview={previewAfterStep}
          onPreviewDraft={(stepId, params, referencedColumns) => previewFormulaStep(params, referencedColumns, stepId)}
          previewedStepId={stepPreview?.stepId ?? null}
          deleteRequest={deleteRequest}
          onDeleteRequestShown={onDeleteRequestShown}
          onDeleteConfirmation={onDeleteConfirmation}
        />, sidebarStepsTarget)}
      {previewingStep && <div className="recipe-preview-loading" role="status">{t("creatingPreview")}</div>}
    </main>
  );
}

export function App() {
  const { t } = useI18n();
  const worker = useDataWorker();
  const recipeHistory = useRecipeHistory();
  const [screen, setScreen] = useState(() => new URLSearchParams(window.location.search).get("account") === "1" ? "account" : "input");
  const [dataset, setDataset] = useState(null);
  const [filters, setFilters] = useState({});
  const filtersRef = useRef(filters);
  const [flow, setFlow] = useState(createFlowGraph);
  const flowRef = useRef(flow);
  const [activePreparedId, setActivePreparedId] = useState(null);
  const activePreparedIdRef = useRef(null);
  const updateActivePreparedId = useCallback((preparedId) => {
    activePreparedIdRef.current = preparedId;
    setActivePreparedId(preparedId);
  }, []);
  const [composePreview, setComposePreview] = useState(null);
  const [composeLoading, setComposeLoading] = useState(false);
  const [composeError, setComposeError] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [recipeRecovery, setRecipeRecovery] = useState({ error: "", invalidStepId: null });
  const [flowHydrated, setFlowHydrated] = useState(false);
  const [flowDirty, setFlowDirty] = useState(false);
  const [retryingFlowSave, setRetryingFlowSave] = useState(false);
  const [workspaceRevision, setWorkspaceRevision] = useState(0);
  const [activityEvents, setActivityEvents] = useState([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState("");
  const [activityOverrideNotice, setActivityOverrideNotice] = useState("");
  const [webMcpFileRequestToken, setWebMcpFileRequestToken] = useState(0);
  const [webMcpRelinkRequest, setWebMcpRelinkRequest] = useState(null);
  const [webMcpCloudUploadToken, setWebMcpCloudUploadToken] = useState(0);
  const [webMcpDeleteRequest, setWebMcpDeleteRequest] = useState(null);
  const [webMcpResetRequest, setWebMcpResetRequest] = useState(null);
  const restoreStartedRef = useRef(false);
  const flowHydratedRef = useRef(false);
  const workspaceRevisionRef = useRef(0);
  const activityEventsRef = useRef([]);
  const pendingDeleteConfirmationsRef = useRef(new Map());
  const pendingResetConfirmationRef = useRef(null);
  const codingBatchesRef = useRef(new Map());
  const sourceInteractionsRef = useRef(null);
  if (!sourceInteractionsRef.current) sourceInteractionsRef.current = createWebMcpInteractionRegistry();
  const webMcpMutationRunnerRef = useRef(null);
  if (!webMcpMutationRunnerRef.current) {
    webMcpMutationRunnerRef.current = createWebMcpMutationRunner({
      getRevision: () => workspaceRevisionRef.current,
      getFlowId: () => flowRef.current.id,
      persistOperation: saveStoredWebMcpOperation,
    });
  }

  useEffect(() => { flowRef.current = flow; }, [flow]);
  useEffect(() => { filtersRef.current = filters; }, [filters]);

  useEffect(() => {
    if (!flowHydrated) return undefined;
    let cancelled = false;
    setActivityLoading(true);
    loadStoredActivity(flow.id).then((events) => {
      if (cancelled) return;
      activityEventsRef.current = events;
      setActivityEvents(events);
      setActivityError("");
    }).catch(() => {
      if (!cancelled) setActivityError("ACTIVITY_STORAGE_UNAVAILABLE");
    }).finally(() => {
      if (!cancelled) setActivityLoading(false);
    });
    return () => { cancelled = true; };
  }, [flow.id, flowHydrated]);

  const bumpWorkspaceRevision = useCallback(({ semantic = true } = {}) => {
    const nextRevision = nextWorkspaceRevision(workspaceRevisionRef.current, { semantic });
    if (nextRevision !== workspaceRevisionRef.current) {
      workspaceRevisionRef.current = nextRevision;
      setWorkspaceRevision(nextRevision);
    }
    return nextRevision;
  }, []);

  const commitFlow = useCallback(async (nextFlow, { semantic = true } = {}) => {
    const nextRevision = bumpWorkspaceRevision({ semantic });
    const persistedFlow = nextFlow.workspaceRevision === nextRevision
      ? nextFlow
      : { ...nextFlow, workspaceRevision: nextRevision };
    flowRef.current = persistedFlow;
    setFlow(persistedFlow);
    if (flowHydratedRef.current) {
      try {
        await saveStoredFlow(persistedFlow);
        setFlowDirty(false);
      } catch {
        setFlowDirty(true);
      }
    }
    return persistedFlow;
  }, [bumpWorkspaceRevision]);

  const runWebMcpMutation = useCallback(
    (meta, execute, fingerprint) => webMcpMutationRunnerRef.current(meta, execute, fingerprint),
    [],
  );

  const recordActivity = useCallback(async ({ action, targetType, targetId, summary = {}, status = "committed", supersedesEventId = null }, context = {}) => {
    const candidate = createActivityEvent({
      flowId: flowRef.current.id,
      actor: context.actor ?? "user",
      origin: context.origin ?? "ui",
      action,
      targetType,
      targetId,
      requestId: context.requestId ?? null,
      status,
      workspaceRevision: workspaceRevisionRef.current,
      summary,
      supersedesEventId,
    });
    const superseded = findSupersededActivity(activityEventsRef.current, candidate);
    const event = supersedesEventId ? candidate : superseded ? { ...candidate, supersedesEventId: superseded.eventId } : candidate;
    try {
      const stored = await appendStoredActivity(event);
      const next = [stored, ...activityEventsRef.current].slice(0, 2000);
      activityEventsRef.current = next;
      setActivityEvents(next);
      setActivityError("");
      if (superseded && stored.actor === "user") setActivityOverrideNotice(stored.eventId);
      return stored;
    } catch {
      setActivityError("ACTIVITY_STORAGE_UNAVAILABLE");
      return null;
    }
  }, []);

  useEffect(() => {
    if (!activityOverrideNotice) return undefined;
    const timer = window.setTimeout(() => setActivityOverrideNotice(""), 7000);
    return () => window.clearTimeout(timer);
  }, [activityOverrideNotice]);

  const webMcpActivity = (meta, extra = {}) => ({ actor: "agent", origin: "webmcp", requestId: meta.requestId, ...extra });

  const retryFlowSave = useCallback(async () => {
    if (retryingFlowSave) return;
    setRetryingFlowSave(true);
    try {
      await saveStoredFlow(flowRef.current);
      setFlowDirty(false);
    } catch {
      setFlowDirty(true);
    } finally {
      setRetryingFlowSave(false);
    }
  }, [retryingFlowSave]);

  const migrateConsolidatedSourceHandles = useCallback(async (sourceIdMap) => {
    for (const [duplicateSourceId, canonicalSourceId] of sourceIdMap) {
      const canonicalHandle = await loadStoredSourceHandle(canonicalSourceId);
      const canonicalRestore = await restoreFileFromHandle(canonicalHandle);
      if (canonicalRestore.status !== "ready") {
        const duplicateHandle = await loadStoredSourceHandle(duplicateSourceId);
        const duplicateRestore = await restoreFileFromHandle(duplicateHandle);
        if (duplicateHandle && (!canonicalHandle || duplicateRestore.status === "ready")) {
          await saveStoredSourceHandle(canonicalSourceId, duplicateHandle);
        }
      }
      await deleteStoredSourceHandle(duplicateSourceId);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await loadStoredFlow();
        if (cancelled || !stored) return;
        const storedFlow = structuredClone(stored);
        if (storedFlow.schemaVersion === 2) storedFlow.schemaVersion = 3;
        storedFlow.semanticModels ??= {};
        storedFlow.metricDefinitions ??= [];
        storedFlow.codingProjects = (storedFlow.codingProjects ?? []).map(normalizeCodingProject);
        delete storedFlow.validationRules;
        delete storedFlow.validationRuns;
        delete storedFlow.analyses;
        storedFlow.preparedInputs = (storedFlow.preparedInputs ?? []).map((prepared) => {
          const semanticModel = reconcileSemanticModel(storedFlow.semanticModels[prepared.id], prepared.id, prepared.schema ?? []);
          storedFlow.semanticModels[prepared.id] = semanticModel;
          return { ...prepared, schema: applySemanticModelToSchema(prepared.schema ?? [], semanticModel) };
        });
        const cleaned = repairOverlappingNodePositions(removeBuiltInDemoData(validateFlowGraph(storedFlow)));
        const consolidated = consolidateDuplicateFileSources(cleaned);
        await migrateConsolidatedSourceHandles(consolidated.sourceIdMap);
        const restored = markSourcesUnlinked(consolidated.graph);
        const restoredWorkspaceRevision = Math.max(0, Number(restored.workspaceRevision) || 0);
        workspaceRevisionRef.current = restoredWorkspaceRevision;
        setWorkspaceRevision(restoredWorkspaceRevision);
        flowRef.current = restored;
        setFlow(restored);
        try {
          const storedOperations = await loadStoredWebMcpOperations(restored.id);
          await webMcpMutationRunnerRef.current.hydrate(storedOperations);
        } catch {
          // Operation-status recovery is best effort and must not block flow restoration.
        }
      } catch {
        if (!cancelled) setError(t("flowRestoreFailed"));
      } finally {
        if (!cancelled) {
          flowHydratedRef.current = true;
          setFlowHydrated(true);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [migrateConsolidatedSourceHandles, t]);

  const openedSources = useMemo(() => flow.sourceAssets.filter(isFlowFileSource).map((source) => {
    const prepared = flow.preparedInputs.find((item) => item.sourceAssetId === source.id);
    return {
      key: source.id,
      sourceAssetId: source.id,
      preparedId: prepared?.id ?? null,
      name: source.name,
      kind: "local",
      size: source.size,
      status: source.status ?? "unlinked",
    };
  }), [flow.preparedInputs, flow.sourceAssets]);

  const resetAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      await worker.resetWorkspace();
      const nextFlow = createFlowGraph();
      await commitFlow(nextFlow);
      try {
        await clearStoredWorkspaceData();
        await saveStoredFlow(nextFlow);
        setFlowDirty(false);
      } catch {
        setError(t("resetAllCleanupFailed"));
      }
      updateActivePreparedId(null);
      setDataset(null);
      filtersRef.current = {};
      setFilters({});
      recipeHistory.reset([]);
      setRecipeRecovery({ error: "", invalidStepId: null });
      setComposePreview(null);
      setComposeLoading(false);
      setComposeError("");
      activityEventsRef.current = [];
      setActivityEvents([]);
      setActivityError("");
      setActivityOverrideNotice("");
      pendingDeleteConfirmationsRef.current.clear();
      pendingResetConfirmationRef.current = null;
      sourceInteractionsRef.current.clear();
      webMcpMutationRunnerRef.current = createWebMcpMutationRunner({
        getRevision: () => workspaceRevisionRef.current,
        getFlowId: () => flowRef.current.id,
        persistOperation: saveStoredWebMcpOperation,
      });
      setWebMcpFileRequestToken(0);
      setWebMcpRelinkRequest(null);
      setWebMcpCloudUploadToken(0);
      setWebMcpDeleteRequest(null);
      setWebMcpResetRequest(null);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("resetAllFailed"));
      return false;
    } finally {
      setLoading(false);
    }
  }, [commitFlow, recipeHistory, t, updateActivePreparedId, worker]);

  const relinkSource = useCallback(async (sourceAssetId, nextFile, handle = null, automatic = false, beforeCommit = null, activityContext = null) => {
    beforeCommit?.();
    const source = flowRef.current.sourceAssets.find((item) => item.id === sourceAssetId);
    const preparedInputs = flowRef.current.preparedInputs.filter((item) => item.sourceAssetId === sourceAssetId);
    const primaryPrepared = preparedInputs[0];
    if (!source || !primaryPrepared) throw new Error(t("relinkFailed"));
    const inspected = await worker.inspectFile(nextFile);
    if (!matchesSourceReference(source, nextFile, inspected.sourceColumns)) {
      const mismatch = new Error(t("relinkMismatch"));
      mismatch.code = "SOURCE_MISMATCH";
      throw mismatch;
    }
    await worker.loadFile(nextFile, { sourceId: source.id, preparedId: primaryPrepared.id });
    for (const prepared of preparedInputs) {
      await worker.registerPreparedCopy(prepared.id, primaryPrepared.id, recipeForExecution(prepared, []));
    }
    await worker.activatePrepared(primaryPrepared.id, {}, primaryPrepared.schema.map((column) => column.name));
    beforeCommit?.();
    const descendantIds = collectDescendantNodeIds(flowRef.current, preparedInputs.map((prepared) => prepared.id));
    const linkedFlow = {
      ...flowRef.current,
      sourceAssets: flowRef.current.sourceAssets.map((item) => item.id === source.id ? { ...item, status: "linked" } : item),
      composeNodes: flowRef.current.composeNodes.map((node) => descendantIds.has(node.id)
        ? { ...node, validationStatus: "needs-validation", dataStatus: "stale", validationError: null }
        : node),
    };
    await commitFlow(linkedFlow, { semantic: !automatic });
    if (descendantIds.size) setComposePreview(null);
    if (handle) await saveStoredSourceHandle(source.id, handle);
    if (!automatic) setError("");
    if (!automatic) await recordActivity({ action: "source_relinked", targetType: "source", targetId: source.id }, activityContext ?? undefined);
    return true;
  }, [commitFlow, recordActivity, t, worker]);

  const relinkSourceFromPicker = useCallback(async (sourceAssetId, nextFile, handle) => {
    setLoading(true);
    setError("");
    try {
      await relinkSource(sourceAssetId, nextFile, handle, false);
      sourceInteractionsRef.current.resolveLatest("source-relink", "completed", { sourceAssetId });
    } catch (cause) {
      sourceInteractionsRef.current.resolveLatest("source-relink", "failed", { sourceAssetId, reason: cause?.code ?? "SOURCE_RELINK_FAILED" });
      setError(cause instanceof Error ? cause.message : t("relinkFailed"));
    } finally {
      setLoading(false);
    }
  }, [relinkSource, t]);

  useEffect(() => {
    if (!flowHydrated || !worker.ready || restoreStartedRef.current) return;
    restoreStartedRef.current = true;
    (async () => {
      let nextFlow = flowRef.current;
      for (const source of nextFlow.sourceAssets.filter(isFlowFileSource)) {
        nextFlow = {
          ...flowRef.current,
          sourceAssets: flowRef.current.sourceAssets.map((item) => item.id === source.id ? { ...item, status: "restoring" } : item),
        };
        flowRef.current = nextFlow;
        setFlow(nextFlow);
        try {
          const handle = await loadStoredSourceHandle(source.id);
          const restored = await restoreFileFromHandle(handle);
          if (restored.status !== "ready") throw new Error("SOURCE_HANDLE_UNAVAILABLE");
          await relinkSource(source.id, restored.file, handle, true);
          nextFlow = flowRef.current;
        } catch {
          nextFlow = {
            ...flowRef.current,
            sourceAssets: flowRef.current.sourceAssets.map((item) => item.id === source.id ? { ...item, status: "unlinked" } : item),
          };
          flowRef.current = nextFlow;
          setFlow(nextFlow);
        }
      }
      for (const source of nextFlow.sourceAssets.filter((item) => item.location === "coding-result")) {
        const prepared = nextFlow.preparedInputs.find((item) => item.sourceAssetId === source.id);
        const project = (nextFlow.codingProjects ?? []).find((item) => item.id === source.codingProjectId);
        if (!prepared || !project) continue;
        try {
          const rows = materializeAcceptedCodingRows(project);
          await worker.materializeRowsPrepared(rows, prepared.name, { sourceId: source.id, preparedId: prepared.id });
          if (prepared.recipe?.length) await worker.applyRecipe(recipeForExecution(prepared, []), {}, prepared.schema.map((column) => column.name), prepared.id);
          nextFlow = {
            ...flowRef.current,
            sourceAssets: flowRef.current.sourceAssets.map((item) => item.id === source.id ? { ...item, status: "linked" } : item),
          };
          flowRef.current = nextFlow;
          setFlow(nextFlow);
        } catch {
          nextFlow = {
            ...flowRef.current,
            sourceAssets: flowRef.current.sourceAssets.map((item) => item.id === source.id ? { ...item, status: "error" } : item),
          };
          flowRef.current = nextFlow;
          setFlow(nextFlow);
        }
      }
      await commitFlow(nextFlow, { semantic: false });
    })();
  }, [commitFlow, flowHydrated, relinkSource, worker.ready]);

  const preparedOptions = useMemo(() => flow.preparedInputs.flatMap((prepared) => {
    const source = flow.sourceAssets.find((item) => item.id === prepared.sourceAssetId);
    const isActive = prepared.id === activePreparedId;
    if (!source) return [];
    return [{
      id: prepared.id,
      name: prepared.name,
      sourceName: isActive ? dataset?.filename ?? source.name : source.name,
    }];
  }), [activePreparedId, dataset?.filename, flow.preparedInputs, flow.sourceAssets]);
  const composeSchemaState = useMemo(() => hydrateComposeSchemas(flow), [flow]);

  useEffect(() => {
    if (screen !== "compose" || composeSchemaState.graph === flow) return;
    void commitFlow(composeSchemaState.graph, { semantic: false });
  }, [commitFlow, composeSchemaState.graph, flow, screen]);

  useEffect(() => {
    if (!flowHydrated || !dataset || !activePreparedId) return;
    const prepared = flowRef.current.preparedInputs.find((item) => item.id === activePreparedId);
    if (!prepared || prepared.rowCount === dataset.rowCount) return;
    void commitFlow(updatePreparedInput(flowRef.current, activePreparedId, { rowCount: dataset.rowCount }), { semantic: false });
  }, [activePreparedId, commitFlow, dataset, flowHydrated]);

  const activateDataset = async (result, source = null, recipe = []) => {
    setDataset(result);
    updateActivePreparedId(result.preparedId ?? null);
    setFilters({});
    if (source) {
      const created = createPreparedInput(source, result, recipe);
      await commitFlow(addPreparedInput(flowRef.current, created.sourceAsset, created.preparedInput));
    }
    recipeHistory.reset(recipe);
    setRecipeRecovery({ error: "", invalidStepId: null });
    return result;
  };

  const registerSiblingPreparations = async (primaryPrepared) => {
    if (!primaryPrepared) return;
    const siblings = flowRef.current.preparedInputs.filter((item) => item.sourceAssetId === primaryPrepared.sourceAssetId && item.id !== primaryPrepared.id);
    for (const sibling of siblings) {
      await worker.registerPreparedCopy(sibling.id, primaryPrepared.id, recipeForExecution(sibling, []));
    }
  };

  useEffect(() => {
    if (screen !== "data" || !error) return undefined;
    const timer = window.setTimeout(() => setError(""), 5000);
    return () => window.clearTimeout(timer);
  }, [error, screen]);

  const loadFile = async (nextFile, handle = null, throwOnError = false, beforeCommit = null, activityContext = null) => {
    let transientPreparedId = null;
    setError("");
    if (!isSupportedFile(nextFile.name)) {
      sourceInteractionsRef.current.resolveLatest("source-file", "failed", { reason: "UNSUPPORTED_SOURCE_FORMAT" });
      if (!dataset) setDataset(null);
      setError(t("unsupportedFormat"));
      if (throwOnError) throw new Error(t("unsupportedFormat"));
      return { ok: false };
    }

    setLoading(true);
    try {
      const inspected = await worker.inspectFile(nextFile);
      const matchingSource = findMatchingFileSource(flowRef.current, nextFile, inspected.sourceColumns);
      if (matchingSource) {
        const storedHandle = await loadStoredSourceHandle(matchingSource.id);
        const sameEntry = !handle || !storedHandle || await isSameFileEntry(storedHandle, handle);
        if (sameEntry) {
          await relinkSource(matchingSource.id, nextFile, handle, false, beforeCommit, activityContext);
          sourceInteractionsRef.current.resolveLatest("source-file", "completed");
          return { ok: true, relinked: true };
        }
      }
      const result = await worker.loadFile(nextFile);
      transientPreparedId = result.preparedId;
      beforeCommit?.();
      await activateDataset(result, {
        kind: "local",
        size: nextFile.size,
        lastModified: nextFile.lastModified,
      }, []);
      transientPreparedId = null;
      if (handle && result.sourceId) await saveStoredSourceHandle(result.sourceId, handle);
      const activity = await recordActivity({ action: "source_imported", targetType: "source", targetId: result.sourceId, summary: { rowCount: result.rowCount, columnCount: result.columns.length } }, activityContext ?? undefined);
      sourceInteractionsRef.current.resolveLatest("source-file", "completed");
      return { ok: true, sourceId: result.sourceId, preparedId: result.preparedId, activity };
    } catch (cause) {
      sourceInteractionsRef.current.resolveLatest("source-file", "failed", { reason: cause?.code ?? "SOURCE_IMPORT_FAILED" });
      if (transientPreparedId) await worker.unregisterPrepared(transientPreparedId);
      if (!dataset) setDataset(null);
      setError(cause instanceof Error ? cause.message : t("fileReadFailed"));
      if (throwOnError) throw cause;
      return { ok: false };
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = useCallback(async (filters, aggregateColumns, beforeCommit = null, activityContext = null) => {
    beforeCommit?.();
    const previousFilters = filtersRef.current;
    const previousAggregateColumns = dataset?.aggregateColumns ?? [];
    const result = await worker.filter(filters, aggregateColumns);
    try {
      beforeCommit?.();
    } catch (cause) {
      await worker.filter(previousFilters, previousAggregateColumns);
      throw cause;
    }
    setDataset(result);
    setFilters(filters);
    bumpWorkspaceRevision();
    const activity = await recordActivity({
      action: activityContext?.action ?? "preview_filters_changed",
      targetType: "prepared",
      targetId: activePreparedId,
      summary: activityContext?.action === "aggregate_columns_changed" ? { aggregateColumnCount: aggregateColumns.length } : { filterCount: Object.keys(filters).length, rowCount: result.filteredCount },
    }, activityContext ?? undefined);
    return { ...result, activity };
  }, [activePreparedId, bumpWorkspaceRevision, dataset?.aggregateColumns, recordActivity, worker]);

  const searchAggregate = useCallback(
    (column, query, filters) => worker.searchAggregate(column, query, filters),
    [worker],
  );

  const persistPreparedRecipe = async (recipe, result, preparedId = activePreparedIdRef.current) => {
    if (!preparedId) return 0;
    const prepared = flowRef.current.preparedInputs.find((item) => item.id === preparedId);
    const recipeVersion = (prepared?.recipeVersion ?? 0) + 1;
    const descendantIds = collectDescendantNodeIds(flowRef.current, [preparedId]);
    const sourceAsset = flowRef.current.sourceAssets.find((item) => item.id === prepared?.sourceAssetId);
    const previousSchema = prepared?.schema ?? [];
    const previousByName = new Map(previousSchema.map((column) => [column.name, column]));
    const sourceSchema = (sourceAsset?.sourceColumns ?? previousSchema.map((column) => column.name)).map((name) => previousByName.get(name) ?? { name, type: null });
    const outputSchema = result.columns.map((name) => ({ name, type: result.columnTypes?.[name] ?? null }));
    const semanticSchema = deriveRecipeSemanticSchema(sourceSchema, recipe, outputSchema, previousSchema);
    let updated = updatePreparedInput(flowRef.current, preparedId, {
      recipe,
      recipeStatus: PREPARED_RECIPE_STATUS.APPLIED,
      recipeVersion,
      rowCount: result.rowCount,
      schema: semanticSchema,
    });
    const nextFlow = {
      ...updated,
      composeNodes: updated.composeNodes.map((node) => descendantIds.has(node.id)
        ? {
          ...node,
          schema: node.schema ?? node.lastValidSchema ?? [],
          lastValidSchema: node.schema?.length ? node.schema : node.lastValidSchema ?? [],
          validationStatus: "needs-validation",
          dataStatus: "stale",
          validationError: null,
        }
        : node),
    };
    await commitFlow(nextFlow);
    setComposePreview(null);
    setComposeError("");
    return recipeVersion;
  };

  const currentPreparedRecipe = (preparedId = activePreparedIdRef.current) => structuredClone(
    flowRef.current.preparedInputs.find((item) => item.id === preparedId)?.recipe
      ?? recipeHistory.getCurrent(),
  );

  const applyRecipeInWorker = async (nextRecipe, beforeCommit = null) => {
    const preparedId = activePreparedIdRef.current;
    const previousRecipe = currentPreparedRecipe(preparedId);
    const previousFilters = filtersRef.current;
    const previousAggregateColumns = dataset?.aggregateColumns ?? [];
    const nextAggregateColumns = includeNewFormulaAggregateColumns(
      previousAggregateColumns,
      previousRecipe,
      nextRecipe,
      dataset?.aggregateColumnLimit ?? 200,
    );
    beforeCommit?.();
    const result = await worker.applyRecipe(nextRecipe, filtersRef.current, nextAggregateColumns, preparedId);
    try {
      beforeCommit?.();
    } catch (cause) {
      await worker.applyRecipe(previousRecipe, previousFilters, previousAggregateColumns, preparedId);
      throw cause;
    }
    return result;
  };

  const applyRecipeChange = async (recipe, beforeCommit = null, activityContext = null) => {
    const preparedId = activePreparedIdRef.current;
    const toggledStep = recipe.find((step) => {
      const previous = currentPreparedRecipe().find((item) => item.id === step.id);
      return previous && (previous.enabled !== false) !== (step.enabled !== false);
    });
    const result = await applyRecipeInWorker(recipe, beforeCommit);
    const next = recipeHistory.commit(recipe);
    setDataset(result);
    setFilters(result.appliedFilters ?? filters);
    const recipeRevision = await persistPreparedRecipe(next, result, preparedId);
    const activity = await recordActivity({ action: activityContext?.action ?? "recipe_changed", targetType: "prepared", targetId: preparedId, summary: { recipeStepCount: next.length, rowCount: result.rowCount, columnCount: result.columns.length, ...(toggledStep ? { enabled: toggledStep.enabled !== false, recipeStepType: toggledStep.type } : {}), ...(activityContext?.summary ?? {}) } }, activityContext ?? undefined);
    return { ...result, recipeRevision, activity };
  };

  const undoRecipe = async (beforeCommit = null, activityContext = null) => {
    const preparedId = activePreparedIdRef.current;
    const next = recipeHistory.getUndoTarget();
    if (!next) return null;
    const result = await applyRecipeInWorker(next, beforeCommit);
    recipeHistory.undo();
    setDataset(result);
    setFilters(result.appliedFilters ?? filters);
    const recipeRevision = await persistPreparedRecipe(next, result, preparedId);
    const activity = await recordActivity({ action: "recipe_undone", targetType: "prepared", targetId: preparedId, summary: { recipeStepCount: next.length, rowCount: result.rowCount, columnCount: result.columns.length } }, activityContext ?? undefined);
    return { ...result, recipeRevision, activity };
  };

  const redoRecipe = async (beforeCommit = null, activityContext = null) => {
    const preparedId = activePreparedIdRef.current;
    const next = recipeHistory.getRedoTarget();
    if (!next) return null;
    const result = await applyRecipeInWorker(next, beforeCommit);
    recipeHistory.redo();
    setDataset(result);
    setFilters(result.appliedFilters ?? filters);
    const recipeRevision = await persistPreparedRecipe(next, result, preparedId);
    const activity = await recordActivity({ action: "recipe_redone", targetType: "prepared", targetId: preparedId, summary: { recipeStepCount: next.length, rowCount: result.rowCount, columnCount: result.columns.length } }, activityContext ?? undefined);
    return { ...result, recipeRevision, activity };
  };

  const openPrepared = async (preparedId, beforeCommit = null, throwOnError = false) => {
    const prepared = flowRef.current.preparedInputs.find((item) => item.id === preparedId);
    const source = flowRef.current.sourceAssets.find((item) => item.id === prepared?.sourceAssetId);
    if (!prepared || !source) {
      const missing = new Error(`Prepared dataset is unavailable: ${preparedId}`);
      if (throwOnError) throw missing;
      return;
    }
    if (source.status !== "linked" && source.location === "local-device") {
      setError(t("relinkRequired"));
      setScreen("input");
      if (throwOnError) {
        const relinkRequired = new Error(t("relinkRequired"));
        relinkRequired.code = "SOURCE_RELINK_REQUIRED";
        relinkRequired.requiresUserAction = true;
        relinkRequired.recommendedWorkspace = "source";
        relinkRequired.sourceAssetIds = [source.id];
        relinkRequired.affectedNodeIds = [prepared.id];
        throw relinkRequired;
      }
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await activatePreparedForFlow({
        worker,
        graph: flowRef.current,
        prepared,
        source,
        filters: {},
        aggregateColumns: prepared.schema.map((column) => column.name),
      });
      beforeCommit?.();
      setDataset(result);
      setFilters({});
      updateActivePreparedId(preparedId);
      recipeHistory.reset(result.recipe ?? []);
      setRecipeRecovery({ error: "", invalidStepId: null });
      await commitFlow(updatePreparedInput(flowRef.current, preparedId, {
        rowCount: result.rowCount,
        schema: result.columns.map((name) => ({ name, type: result.columnTypes?.[name] ?? null })),
      }), { semantic: false });
      setScreen("data");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("fileReadFailed"));
      setScreen("input");
      if (throwOnError) throw cause;
    } finally {
      setLoading(false);
    }
  };

  const duplicatePreparation = async (preparedId, beforeCommit = null, activityContext = null) => {
    setComposeError("");
    try {
      beforeCommit?.();
      const duplicated = duplicatePreparedInput(flowRef.current, preparedId);
      await worker.registerPreparedCopy(duplicated.preparedInput.id, preparedId, duplicated.preparedInput.recipe);
      try {
        beforeCommit?.();
      } catch (cause) {
        await worker.unregisterPrepared(duplicated.preparedInput.id);
        throw cause;
      }
      await commitFlow(duplicated.graph);
      setComposePreview(null);
      const activity = await recordActivity({ action: "prepared_duplicated", targetType: "prepared", targetId: duplicated.preparedInput.id, summary: { rowCount: duplicated.preparedInput.rowCount, columnCount: duplicated.preparedInput.schema.length } }, activityContext ?? undefined);
      return {
        ok: true,
        preparedInputId: duplicated.preparedInput.id,
        createdPreparedId: duplicated.preparedInput.id,
        name: duplicated.preparedInput.name,
        rowCount: duplicated.preparedInput.rowCount,
        columnCount: duplicated.preparedInput.schema.length,
        selectionChanged: false,
        activePreparedId: activePreparedIdRef.current,
        activeNodeId: duplicated.graph.activeNodeId,
        activity,
      };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : t("duplicateFailed");
      setComposeError(message);
      return { ok: false, error: message };
    }
  };

  const createPreparationFromCompose = async (nodeId, beforeCommit = null, activityContext = null, { selectCreated = true } = {}) => {
    setComposeError("");
    try {
      beforeCommit?.();
      const candidate = createPreparedFromCompose(flowRef.current, nodeId);
      const materialized = await worker.materializeComposePrepared(flowRef.current, nodeId, {
        sourceId: candidate.sourceAsset.id,
        preparedId: candidate.preparedInput.id,
        filename: candidate.preparedInput.name,
      });
      try {
        beforeCommit?.();
      } catch (cause) {
        await worker.unregisterPrepared(candidate.preparedInput.id);
        throw cause;
      }
      const nextGraph = {
        ...candidate.graph,
        activeNodeId: selectCreated ? candidate.graph.activeNodeId : flowRef.current.activeNodeId,
        sourceAssets: candidate.graph.sourceAssets.map((item) => item.id === candidate.sourceAsset.id
          ? { ...item, sourceColumns: materialized.schema.map((column) => column.name), schemaFingerprint: schemaFingerprint(materialized.schema) }
          : item),
        preparedInputs: candidate.graph.preparedInputs.map((item) => item.id === candidate.preparedInput.id
          ? { ...item, rowCount: materialized.rowCount, schema: materialized.schema.map((column) => ({ ...column })) }
          : item),
      };
      await commitFlow(nextGraph);
      setComposePreview(null);
      const activity = await recordActivity({ action: "compose_result_promoted", targetType: "prepared", targetId: candidate.preparedInput.id, summary: { rowCount: materialized.rowCount, columnCount: materialized.schema.length } }, activityContext ?? undefined);
      return {
        ok: true,
        preparedInputId: candidate.preparedInput.id,
        createdPreparedId: candidate.preparedInput.id,
        name: candidate.preparedInput.name,
        rowCount: materialized.rowCount,
        columnCount: materialized.schema.length,
        selectionChanged: selectCreated,
        activePreparedId: activePreparedIdRef.current,
        activeNodeId: nextGraph.activeNodeId,
        activity,
      };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : t("createPreparedFailed");
      setComposeError(message);
      return { ok: false, error: message };
    }
  };

  const deletePreparedDataset = async (preparedId) => {
    setComposeError("");
    try {
      const candidate = removePreparedInput(flowRef.current, preparedId);
      await worker.unregisterPrepared(preparedId);
      await commitFlow(candidate.graph);
      if (candidate.removedSourceAssetId) await deleteStoredSourceHandle(candidate.removedSourceAssetId);
      if (activePreparedId === preparedId) {
        updateActivePreparedId(null);
        setDataset(null);
        setFilters({});
        recipeHistory.reset([]);
      }
      setComposePreview(null);
      await recordActivity({ action: "prepared_deleted", targetType: "prepared", targetId: preparedId });
      return true;
    } catch (cause) {
      const message = cause?.code === "PREPARED_INPUT_HAS_DESCENDANTS"
        ? t("deleteDownstreamFirst")
        : cause instanceof Error ? cause.message : t("deletePreparedFailed");
      setComposeError(message);
      return false;
    }
  };

  const selectComposeNode = async (nodeId, beforeCommit = null, throwOnError = false) => {
    beforeCommit?.();
    const nextFlow = { ...flowRef.current, activeNodeId: nodeId };
    setComposeLoading(true);
    setComposeError("");
    try {
      const preview = await worker.previewCompose(nextFlow, nodeId);
      beforeCommit?.();
      const committedFlow = nextFlow.composeNodes.some((node) => node.id === nodeId)
        ? {
          ...nextFlow,
          revision: nextFlow.revision + 1,
          composeNodes: nextFlow.composeNodes.map((node) => node.id === nodeId ? { ...node, rowCount: preview.rowCount, lastValidRowCount: preview.rowCount, schema: preview.schema, lastValidSchema: preview.schema, validationStatus: "valid", dataStatus: "ready", validationError: null } : node),
          updatedAt: new Date().toISOString(),
        }
        : nextFlow;
      await commitFlow(committedFlow, { semantic: false });
      setComposePreview(preview);
    } catch (cause) {
      setComposePreview(null);
      setComposeError(cause instanceof Error ? cause.message : t("composePreviewFailed"));
      if (throwOnError) throw cause;
    } finally {
      setComposeLoading(false);
    }
  };

  const createComposeNode = async (draft, beforeCommit = null, activityContext = null) => {
    beforeCommit?.();
    const candidate = addComposeNode(flowRef.current, draft);
    const preview = await worker.previewCompose(candidate.graph, candidate.node.id);
    beforeCommit?.();
    const committed = {
      ...candidate.graph,
      composeNodes: candidate.graph.composeNodes.map((node) => node.id === candidate.node.id ? { ...node, rowCount: preview.rowCount, lastValidRowCount: preview.rowCount, schema: preview.schema, lastValidSchema: preview.schema, validationStatus: "valid", dataStatus: "ready", validationError: null } : node),
    };
    await commitFlow(committed);
    setComposePreview(preview);
    setComposeError("");
    const activity = await recordActivity({ action: "compose_operation_created", targetType: "compose-node", targetId: candidate.node.id, summary: { operationKind: candidate.node.kind, rowCount: preview.rowCount, columnCount: preview.schema.length } }, activityContext ?? undefined);
    return {
      nodeId: candidate.node.id,
      name: candidate.node.name,
      rowCount: preview.rowCount,
      columnCount: preview.schema.length,
      activity,
    };
  };

  const updateComposeOperation = async (nodeId, draft, beforeCommit = null, activityContext = null) => {
    beforeCommit?.();
    const candidate = updateComposeNode(flowRef.current, nodeId, draft);
    const preview = await worker.previewCompose(candidate.graph, nodeId);
    beforeCommit?.();
    const descendantIds = collectDescendantNodeIds(candidate.graph, [nodeId]);
    const committed = {
      ...candidate.graph,
      composeNodes: candidate.graph.composeNodes.map((node) => node.id === nodeId
        ? { ...node, rowCount: preview.rowCount, lastValidRowCount: preview.rowCount, schema: preview.schema, lastValidSchema: preview.schema, validationStatus: "valid", dataStatus: "ready", validationError: null }
        : descendantIds.has(node.id)
          ? { ...node, validationStatus: "needs-validation", dataStatus: "stale", validationError: null }
          : node),
    };
    await commitFlow(committed);
    setComposePreview(preview);
    setComposeError("");
    const activity = await recordActivity({ action: "compose_operation_updated", targetType: "compose-node", targetId: nodeId, summary: { operationKind: candidate.node.kind, rowCount: preview.rowCount, columnCount: preview.schema.length } }, activityContext ?? undefined);
    return {
      nodeId,
      name: candidate.node.name,
      rowCount: preview.rowCount,
      columnCount: preview.schema.length,
      activity,
    };
  };

  const deleteComposeOperation = async (nodeId) => {
    const candidate = removeComposeNode(flowRef.current, nodeId);
    await commitFlow(candidate.graph);
    setComposePreview(null);
    setComposeError("");
    await recordActivity({ action: "compose_operation_deleted", targetType: "compose-node", targetId: nodeId });
  };

  const previewComposeDraft = async (draft, nodeId = null, options = {}) => {
    const candidate = nodeId
      ? updateComposeNode(flowRef.current, nodeId, draft)
      : addComposeNode(flowRef.current, draft);
    return worker.previewCompose(candidate.graph, candidate.node.id, options);
  };

  const moveComposeNode = async (nodeId, position, beforeCommit = null, activityContext = null) => {
    try {
      const candidate = updateNodePosition(flowRef.current, nodeId, position);
      beforeCommit?.();
      const graph = await commitFlow(candidate);
      const committedPosition = graph.preparedInputs.find((node) => node.id === nodeId)?.position ?? graph.composeNodes.find((node) => node.id === nodeId)?.position;
      const activity = await recordActivity({ action: "compose_node_moved", targetType: "compose-node", targetId: nodeId, summary: { position: committedPosition } }, activityContext ?? undefined);
      return { nodeId, position: committedPosition, activity };
    } catch (cause) {
      setComposeError(cause instanceof Error ? cause.message : t("composeUpdateFailed"));
      throw cause;
    }
  };

  const autoArrangeComposeNodes = async (beforeCommit = null, activityContext = null) => {
    try {
      const candidate = autoArrangeNodePositions(flowRef.current);
      beforeCommit?.();
      const graph = await commitFlow(candidate);
      const activity = await recordActivity({ action: "compose_auto_arranged", targetType: "flow", targetId: graph.id }, activityContext ?? undefined);
      return { ...graph, activity };
    } catch (cause) {
      setComposeError(cause instanceof Error ? cause.message : t("composeUpdateFailed"));
      return null;
    }
  };

  const exportComposeNode = async (format, nodeId = flowRef.current.activeNodeId, activityContext = null, beforeDownload = null) => {
    if (!nodeId) throw new Error("Select a Compose node before exporting.");
    const result = await worker.exportCompose(flowRef.current, nodeId, format);
    beforeDownload?.();
    downloadExport(result);
    const activity = await recordActivity({ action: "compose_exported", targetType: "compose-node", targetId: nodeId, summary: { format } }, activityContext ?? undefined);
    return { nodeId, filename: result.filename, format, activity };
  };

  const exportPreparedData = async (format, preparedId = activePreparedId, activityContext = null, beforeDownload = null) => {
    if (!dataset || preparedId !== activePreparedId) throw new Error(`Prepared dataset is not active: ${preparedId}`);
    setScreen("data");
    const preparedName = flowRef.current.preparedInputs.find((item) => item.id === preparedId)?.name;
    const result = await worker.exportData(format, filters, preparedName ?? dataset.filename);
    beforeDownload?.();
    downloadExport(result);
    const activity = await recordActivity({ action: "prepared_exported", targetType: "prepared", targetId: preparedId, summary: { format, rowCount: dataset.filteredCount, columnCount: dataset.columns.length } }, activityContext ?? undefined);
    return { filename: result.filename, format, totalRowCount: dataset.rowCount, filteredRowCount: dataset.filteredCount, activity };
  };

  const previewRecipe = (recipe, stepIndex, options = {}) => worker.previewRecipe(recipe, stepIndex, options);

  const openWorkspace = async (workspace) => {
    if (workspace === "source" || workspace === "account") {
      setScreen(workspace === "source" ? "input" : "account");
      return { workspace, activePreparedId: activePreparedIdRef.current, activeNodeId: flowRef.current.activeNodeId, workspaceRevision: workspaceRevisionRef.current, activityCursor: activityEventsRef.current[0]?.sequence ?? 0 };
    }
    if (workspace === "compose") {
      if (flowRef.current.preparedInputs.length === 0) throw new Error("Compose requires at least one prepared dataset.");
      setScreen("compose");
      return { workspace, activePreparedId: activePreparedIdRef.current, activeNodeId: flowRef.current.activeNodeId, workspaceRevision: workspaceRevisionRef.current, activityCursor: activityEventsRef.current[0]?.sequence ?? 0 };
    }
    if (workspace !== "prepare") throw new Error(`Unknown workspace: ${workspace}`);
    const preparedId = flowRef.current.preparedInputs.some((item) => item.id === flowRef.current.activeNodeId)
      ? flowRef.current.activeNodeId
      : activePreparedIdRef.current ?? flowRef.current.preparedInputs[0]?.id;
    if (!preparedId) throw new Error("Prepare requires an existing prepared dataset.");
    await openPrepared(preparedId);
    return { workspace, activePreparedId: preparedId, activeNodeId: flowRef.current.activeNodeId, workspaceRevision: workspaceRevisionRef.current, activityCursor: activityEventsRef.current[0]?.sequence ?? 0 };
  };

  const selectComposeNodeFromTool = async (nodeId, meta) => runWebMcpMutation(meta, async (assertCurrent) => {
    setScreen("compose");
    await selectComposeNode(nodeId, assertCurrent, true);
    return { workspaceRevision: workspaceRevisionRef.current };
  }, `compose:select:${nodeId}`);

  const selectPreparedFromTool = async (preparedId, meta) => runWebMcpMutation(meta, async (assertCurrent) => {
    await openPrepared(preparedId, assertCurrent, true);
    return { workspaceRevision: workspaceRevisionRef.current };
  }, `prepare:select:${preparedId}`);

  const assertActivePreparedForTool = (preparedId) => {
    if (!dataset || preparedId !== activePreparedIdRef.current) {
      const inactive = new Error(`Prepared dataset is not active: ${preparedId}. Open it before reading or changing its data.`);
      inactive.code = "PREPARED_NOT_ACTIVE";
      throw inactive;
    }
    return flowRef.current.preparedInputs.find((item) => item.id === preparedId);
  };

  const runWebMcpRead = async (execute) => {
    const revision = workspaceRevisionRef.current;
    const result = await execute();
    if (revision !== workspaceRevisionRef.current) {
      const stale = new Error("Workspace state changed while the WebMCP read was running. Read workspace state and retry.");
      stale.code = "STALE_STATE";
      throw stale;
    }
    return result && typeof result === "object" ? { ...result, workspaceRevision: revision } : { result, workspaceRevision: revision };
  };

  const findCodingProject = (projectId = null) => {
    const projects = flowRef.current.codingProjects ?? [];
    return projectId
      ? projects.find((project) => project.id === projectId)
      : projects.find((project) => project.preparedId === activePreparedIdRef.current);
  };

  const commitCodingProject = async (project, activity, context = undefined) => {
    const graph = flowRef.current;
    const existing = graph.codingProjects ?? [];
    const codingProjects = existing.some((item) => item.id === project.id)
      ? existing.map((item) => item.id === project.id ? project : item)
      : [...existing, project];
    const committed = await commitFlow({
      ...graph,
      codingProjects,
      revision: graph.revision + 1,
      updatedAt: new Date().toISOString(),
    });
    if (activity) await recordActivity(activity, context);
    return committed.codingProjects.find((item) => item.id === project.id);
  };

  const saveCodingProject = async (draft) => {
    const prepared = flowRef.current.preparedInputs.find((item) => item.id === activePreparedIdRef.current);
    if (!prepared) throw new Error("Open a prepared dataset before creating a coding project.");
    const available = new Set(prepared.schema.map((column) => column.name));
    for (const column of [draft.responseIdColumn, draft.responseTextColumn, draft.questionColumn].filter(Boolean)) {
      if (!available.has(column)) throw new Error(`Column not found: ${column}`);
    }
    if (draft.responseIdColumn === draft.responseTextColumn) throw new Error("Response ID and response text must use different columns.");
    const validCodes = (draft.codes ?? []).filter((code) => code.label?.trim() && code.definition?.trim());
    const current = findCodingProject();
    const project = current
      ? updateCodingProject(current, { ...draft, codes: validCodes })
      : createCodingProject({ ...draft, codes: validCodes, preparedId: prepared.id });
    return commitCodingProject(project, {
      action: "coding_project_saved",
      targetType: "coding-project",
      targetId: project.id,
      summary: { preparedId: prepared.id, codeCount: project.codes.length, codebookRevision: project.codebookRevision },
    });
  };

  const grantActiveCodingAccess = async () => {
    const current = findCodingProject();
    if (!current) throw new Error("Save the coding project before granting AI access.");
    const project = grantCodingAccess(current);
    return commitCodingProject(project, {
      action: "coding_access_granted",
      targetType: "coding-project",
      targetId: project.id,
      summary: { expiresAt: project.accessGrant.expiresAt, purpose: project.accessGrant.purpose },
    });
  };

  const revokeActiveCodingAccess = async () => {
    const current = findCodingProject();
    if (!current) throw new Error("Coding project not found.");
    const project = revokeCodingAccess(current);
    for (const [batchId, batch] of codingBatchesRef.current) {
      if (batch.projectId === project.id) codingBatchesRef.current.delete(batchId);
    }
    return commitCodingProject(project, {
      action: "coding_access_revoked",
      targetType: "coding-project",
      targetId: project.id,
      summary: {},
    });
  };

  const reviewActiveCodingAssignment = async (assignmentId, decision) => {
    const current = findCodingProject();
    if (!current) throw new Error("Coding project not found.");
    const project = reviewCodingAssignment(current, assignmentId, decision);
    return commitCodingProject(project, {
      action: "coding_assignment_reviewed",
      targetType: "coding-project",
      targetId: project.id,
      summary: { assignmentId, decision },
    });
  };

  const loadCodingEvidence = useCallback(async (assignment) => {
    const project = (flowRef.current.codingProjects ?? []).find((item) => item.preparedId === activePreparedIdRef.current);
    if (!project || !assignment?.responseId) return null;
    const selection = { key: `coding:${assignment.responseId}`, raw: assignment.responseId, label: assignment.responseId };
    const page = await worker.previewPrepared(
      { [project.responseIdColumn]: selection },
      [project.responseTextColumn],
      { offset: 0, limit: 1, agentMode: false },
    );
    const redacted = redactQualitativeText(page.preview?.[0]?.[project.responseTextColumn]);
    const evidence = redacted.slice(assignment.evidenceStart, assignment.evidenceEnd);
    return await hashCodingText(evidence) === assignment.evidenceHash ? evidence : null;
  }, [worker]);

  const materializeActiveCodingProject = async () => {
    const current = findCodingProject();
    if (!current) throw new Error("Coding project not found.");
    const rows = materializeAcceptedCodingRows(current);
    if (!rows.length) throw new Error("Accept at least one coding suggestion before creating a dataset.");
    const schema = [
      { name: "response_id", type: "VARCHAR" },
      { name: "code_id", type: "VARCHAR" },
      { name: "code", type: "VARCHAR" },
      { name: "confidence", type: "DOUBLE" },
      { name: "uncertain", type: "BOOLEAN" },
      { name: "review_status", type: "VARCHAR" },
      { name: "evidence_hash", type: "VARCHAR" },
      { name: "coding_project_id", type: "VARCHAR" },
      { name: "codebook_revision", type: "BIGINT" },
    ];
    const candidate = createPreparedFromGeneratedRows(flowRef.current, {
      name: `${current.name} reviewed`,
      schema,
      rowCount: rows.length,
      codingProjectId: current.id,
    });
    const materialized = await worker.materializeRowsPrepared(rows, candidate.preparedInput.name, {
      sourceId: candidate.sourceAsset.id,
      preparedId: candidate.preparedInput.id,
    });
    const refreshedProject = { ...current, materializedPreparedId: candidate.preparedInput.id, revision: current.revision + 1, updatedAt: new Date().toISOString() };
    const nextGraph = {
      ...candidate.graph,
      codingProjects: (candidate.graph.codingProjects ?? []).map((item) => item.id === current.id ? refreshedProject : item),
      sourceAssets: candidate.graph.sourceAssets.map((item) => item.id === candidate.sourceAsset.id
        ? { ...item, sourceColumns: materialized.schema.map((column) => column.name), schemaFingerprint: schemaFingerprint(materialized.schema) }
        : item),
      preparedInputs: candidate.graph.preparedInputs.map((item) => item.id === candidate.preparedInput.id
        ? { ...item, rowCount: materialized.rowCount, schema: materialized.schema.map((column) => ({ ...column })) }
        : item),
    };
    await commitFlow(nextGraph);
    await worker.activatePrepared(activePreparedIdRef.current, filtersRef.current, dataset?.aggregateColumns ?? []);
    await recordActivity({
      action: "coding_result_materialized",
      targetType: "prepared",
      targetId: candidate.preparedInput.id,
      summary: { codingProjectId: current.id, rowCount: materialized.rowCount, columnCount: materialized.schema.length },
    });
    return { preparedInputId: candidate.preparedInput.id, rowCount: materialized.rowCount, columnCount: materialized.schema.length, selectionChanged: false };
  };

  const getCodingProjectFromTool = async (projectId = null) => {
    const project = findCodingProject(projectId);
    if (!project) throw Object.assign(new Error("Coding project not found for the active prepared dataset."), { code: "CODING_PROJECT_NOT_FOUND" });
    const prepared = assertActivePreparedForTool(project.preparedId);
    return { ...codingProjectForAgent(project, prepared.rowCount), workspaceRevision: workspaceRevisionRef.current };
  };

  const getCodingBatchFromTool = async (projectId, { offset = 0, limit = 25 } = {}) => {
    const project = findCodingProject(projectId);
    if (!project) throw Object.assign(new Error("Coding project not found."), { code: "CODING_PROJECT_NOT_FOUND" });
    assertActivePreparedForTool(project.preparedId);
    const columns = [project.responseIdColumn, project.responseTextColumn, project.questionColumn].filter(Boolean);
    const page = await runWebMcpRead(() => worker.previewPrepared({}, columns, { offset, limit: Math.min(50, limit), agentMode: false }));
    const batch = await createCodingBatch(project, page.preview, { limit: Math.min(50, limit) });
    codingBatchesRef.current.set(batch.batchId, batch);
    return {
      batchId: batch.batchId,
      projectId: batch.projectId,
      codebookRevision: batch.codebookRevision,
      expiresAt: batch.expiresAt,
      offset: page.offset,
      totalResponses: page.totalRowCount,
      items: batch.items.map(({ responseRef, text, question, textHash }) => ({ responseRef, text, question, textHash })),
      workspaceRevision: workspaceRevisionRef.current,
    };
  };

  const submitCodingBatchFromTool = async (projectId, batchId, submissions, meta) => runWebMcpMutation(meta, async (assertCurrent) => {
    const project = findCodingProject(projectId);
    const batch = codingBatchesRef.current.get(batchId);
    if (!project || !batch) throw Object.assign(new Error("Coding batch was not found or has expired."), { code: "CODING_BATCH_NOT_FOUND" });
    assertActivePreparedForTool(project.preparedId);
    const updated = await submitCodingSuggestions(project, batch, submissions, { agent: "webmcp" });
    assertCurrent();
    await commitCodingProject(updated, {
      action: "coding_suggestions_submitted",
      targetType: "coding-project",
      targetId: updated.id,
      summary: { batchId, suggestionCount: updated.assignments.length - project.assignments.length },
    }, webMcpActivity(meta));
    codingBatchesRef.current.delete(batchId);
    return { projectId: updated.id, projectRevision: updated.revision, pendingReviewCount: updated.assignments.filter((item) => item.status === "pending-review").length, workspaceRevision: workspaceRevisionRef.current };
  }, `coding:submit:${projectId}:${batchId}`);

  const autoArrangeComposeFromTool = async (meta) => runWebMcpMutation(meta, async (assertCurrent) => {
    setScreen("compose");
    const graph = await autoArrangeComposeNodes(assertCurrent, webMcpActivity(meta));
    if (!graph) throw new Error("The Compose graph could not be arranged.");
    return { flowRevision: graph.revision, workspaceRevision: workspaceRevisionRef.current, activity: graph.activity };
  }, "compose:auto-arrange");

  const requestSourceFileSelection = async () => {
    if (!worker.ready) {
      const unavailable = new Error("The local data engine is still starting. Try again when workspace state reports ready.");
      unavailable.code = "WORKER_NOT_READY";
      throw unavailable;
    }
    const interaction = sourceInteractionsRef.current.create("source-file", {
      workspace: "source",
      workspaceChanged: screen !== "input",
    });
    setScreen("input");
    setWebMcpFileRequestToken((current) => current + 1);
    return interaction;
  };

  const requestSourceRelinkFromTool = async (sourceAssetId) => {
    const source = flowRef.current.sourceAssets.find((item) => item.id === sourceAssetId);
    if (!source || !isFlowFileSource(source)) {
      const missing = new Error(`Local source not found: ${sourceAssetId}`);
      missing.code = "FILE_HANDLE_UNAVAILABLE";
      throw missing;
    }
    if (source.status !== "unlinked") {
      const linked = new Error(`Local source cannot be relinked in its current state: ${sourceAssetId}`);
      linked.code = "SOURCE_NOT_UNLINKED";
      throw linked;
    }
    const interaction = sourceInteractionsRef.current.create("source-relink", {
      workspace: "source",
      workspaceChanged: screen !== "input",
      sourceAssetId,
    });
    setScreen("input");
    setWebMcpRelinkRequest({ sourceAssetId, token: interaction.interactionId });
    return interaction;
  };

  const listCloudFilesFromTool = async () => {
    const account = await getCloudAccount();
    if (!account.authenticated) return { authenticated: false, files: [], storage: null };
    const result = await getCloudFiles();
    return { authenticated: true, storage: account.storage ?? null, files: result.files ?? [] };
  };

  const openCloudFileFromTool = async (fileId, meta) => runWebMcpMutation(meta, async (assertCurrent) => {
    const cloud = await listCloudFilesFromTool();
    if (!cloud.authenticated) throw new Error("Cloud files require ChatGPT sign-in.");
    const metadata = cloud.files.find((item) => item.id === fileId);
    if (!metadata) throw new Error(`Cloud file not found: ${fileId}`);
    const file = await openCloudFile(metadata);
    setScreen("input");
    await loadFile(file, null, true, assertCurrent, webMcpActivity(meta));
    return { fileId, name: metadata.name, size: metadata.size };
  }, `cloud:open:${fileId}`);

  const requestCloudUploadFromTool = async () => {
    const account = await getCloudAccount();
    if (!account.authenticated) throw new Error("Cloud upload requires ChatGPT sign-in.");
    setScreen("account");
    setWebMcpCloudUploadToken((current) => current + 1);
  };

  const getPrepareDatasetFromTool = async (preparedId) => {
    const prepared = assertActivePreparedForTool(preparedId);
    const schemaByName = new Map((prepared?.schema ?? []).map((column) => [column.name, column]));
    return {
      preparedId,
      name: prepared?.name ?? dataset.filename,
      sourceName: dataset.filename,
      recipeRevision: prepared?.recipeVersion ?? 0,
      totalRowCount: dataset.rowCount,
      filteredRowCount: dataset.filteredCount,
      previewRowCount: dataset.preview.length,
      columnCount: dataset.columns.length,
      schema: dataset.columns.map((name) => schemaByName.get(name) ?? ({ name, type: dataset.columnTypes?.[name] ?? null })),
      aggregateColumns: [...dataset.aggregateColumns],
      hiddenAggregateColumnCount: dataset.hiddenAggregateColumnCount,
      filters: protectFiltersForAgent(filters, dataset.columns.map((name) => schemaByName.get(name) ?? ({ name, type: dataset.columnTypes?.[name] }))),
      quality: structuredClone(dataset.quality),
      recipeStatus: prepared?.recipeStatus ?? null,
      workspaceRevision: workspaceRevisionRef.current,
    };
  };

  const getDataProfileFromTool = async (preparedId, columns) => {
    const prepared = assertActivePreparedForTool(preparedId);
    return runWebMcpRead(() => worker.profileData(columns, prepared.schema ?? []));
  };

  const queryColumnValuesFromTool = async (preparedId, column, search, options) => {
    assertActivePreparedForTool(preparedId);
    if (!dataset.columns.includes(column)) throw new Error(`Column not found: ${column}`);
    const prepared = flowRef.current.preparedInputs.find((item) => item.id === preparedId);
    return runWebMcpRead(() => worker.searchAggregateForAgent(column, search, filters, { ...options, semanticSchema: prepared?.schema ?? [] }));
  };

  const getPreparePreviewFromTool = async (preparedId, columns, options) => {
    assertActivePreparedForTool(preparedId);
    const prepared = flowRef.current.preparedInputs.find((item) => item.id === preparedId);
    return runWebMcpRead(() => worker.previewPrepared(filters, columns, { ...options, semanticSchema: prepared?.schema ?? [], agentMode: true }));
  };

  const getRecipeFromTool = async (preparedId) => {
    const prepared = flowRef.current.preparedInputs.find((item) => item.id === preparedId);
    if (!prepared) throw new Error(`Prepared dataset not found: ${preparedId}`);
    return {
      preparedId,
      name: prepared.name,
      recipeRevision: prepared.recipeVersion ?? 0,
      recipeStatus: prepared.recipeStatus ?? null,
      recipe: protectRecipeForAgent(prepared.recipe ?? [], prepared.schema ?? []),
      schema: structuredClone(prepared.schema ?? []),
      totalRowCount: prepared.rowCount ?? null,
      active: preparedId === activePreparedId,
      workspaceRevision: workspaceRevisionRef.current,
    };
  };

  const getSemanticModelFromTool = async (targetId) => {
    const target = [...flowRef.current.preparedInputs, ...flowRef.current.composeNodes].find((item) => item.id === targetId);
    if (!target) throw new Error(`Semantic target not found: ${targetId}`);
    const model = reconcileSemanticModel(flowRef.current.semanticModels?.[targetId], targetId, target.schema ?? []);
    return { ...structuredClone(model), schema: structuredClone(applySemanticModelToSchema(target.schema ?? [], model)), workspaceRevision: workspaceRevisionRef.current };
  };

  const updateSemanticFieldFromTool = async (targetId, fieldName, changes, meta) => runWebMcpMutation(meta, async (assertCurrent) => {
    const graph = flowRef.current;
    const target = [...graph.preparedInputs, ...graph.composeNodes].find((item) => item.id === targetId);
    if (!target) throw new Error(`Semantic target not found: ${targetId}`);
    const currentModel = reconcileSemanticModel(graph.semanticModels?.[targetId], targetId, target.schema ?? []);
    assertAgentSemanticFieldChange(fieldName, currentModel.fields[fieldName], changes);
    const nextModel = updateSemanticField(currentModel, fieldName, changes);
    const withModel = {
      ...graph,
      semanticModels: { ...(graph.semanticModels ?? {}), [targetId]: nextModel },
      preparedInputs: graph.preparedInputs.map((item) => item.id === targetId ? { ...item, schema: applySemanticModelToSchema(item.schema ?? [], nextModel) } : item),
      composeNodes: graph.composeNodes.map((item) => item.id === targetId ? { ...item, schema: applySemanticModelToSchema(item.schema ?? [], nextModel), lastValidSchema: applySemanticModelToSchema(item.lastValidSchema ?? item.schema ?? [], nextModel) } : item),
      revision: graph.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    assertCurrent();
    const hydrated = hydrateComposeSchemas(withModel).graph;
    await commitFlow(hydrated);
    await recordActivity({ action: "semantic_field_updated", targetType: target.kind ? "compose-node" : "prepared", targetId, summary: { fieldName, fieldsChanged: Object.keys(changes) } }, webMcpActivity(meta));
    return { targetId, fieldName, field: nextModel.fields[fieldName], semanticRevision: nextModel.revision };
  }, `semantic:update:${targetId}:${fieldName}:${JSON.stringify(changes)}`);

  const listMetricDefinitionsFromTool = async (targetId) => {
    await getSemanticModelFromTool(targetId);
    const allMetrics = flowRef.current.metricDefinitions ?? [];
    return {
      targetId,
      metrics: structuredClone(allMetrics.filter((item) => item.targetId === targetId)),
      availableTargetIds: [...new Set(allMetrics.map((item) => item.targetId).filter(Boolean))],
      workspaceRevision: workspaceRevisionRef.current,
    };
  };

  const upsertMetricDefinitionFromTool = async (definition, meta) => runWebMcpMutation(meta, async (assertCurrent) => {
    const graph = flowRef.current;
    const target = [...graph.preparedInputs, ...graph.composeNodes].find((item) => item.id === definition.targetId);
    if (!target) throw new Error(`Metric target not found: ${definition.targetId}`);
    const metric = normalizeMetricDefinition(definition, target.schema ?? []);
    const existing = graph.metricDefinitions ?? [];
    const nextMetrics = existing.some((item) => item.id === metric.id)
      ? existing.map((item) => item.id === metric.id ? { ...item, ...metric } : item)
      : [...existing, metric];
    assertCurrent();
    await commitFlow({ ...graph, metricDefinitions: nextMetrics, revision: graph.revision + 1, updatedAt: new Date().toISOString() });
    await recordActivity({ action: "metric_definition_saved", targetType: "metric", targetId: metric.id, summary: { targetId: metric.targetId, function: metric.function } }, webMcpActivity(meta));
    return { metric };
  }, `metric:upsert:${definition.id ?? "new"}:${JSON.stringify(definition)}`);

  const deleteMetricDefinition = async (id) => {
    const graph = flowRef.current;
    const metric = (graph.metricDefinitions ?? []).find((item) => item.id === id);
    if (!metric) return false;
    try {
      await commitFlow({ ...graph, metricDefinitions: graph.metricDefinitions.filter((item) => item.id !== id), revision: graph.revision + 1, updatedAt: new Date().toISOString() });
      await recordActivity({ action: "metric_definition_deleted", targetType: "metric", targetId: id, summary: { targetId: metric.targetId } });
      return true;
    } catch (metricDeleteError) {
      setComposeError(metricDeleteError instanceof Error ? metricDeleteError.message : t("composeUpdateFailed"));
      return false;
    }
  };

  const previewRecipeChangeFromTool = async (preparedId, recipe, stepIndex, { previewColumns, previewLimit = 10 } = {}) => {
    assertActivePreparedForTool(preparedId);
    try {
      const prepared = flowRef.current.preparedInputs.find((item) => item.id === preparedId);
      const currentRecipe = currentPreparedRecipe(preparedId);
      const restoredRecipe = restoreProtectedRecipeValues(recipe, currentRecipe);
      assertAgentRecipeContract(restoredRecipe, currentRecipe);
      const includeRows = Array.isArray(previewColumns) && previewColumns.length > 0;
      const result = await runWebMcpRead(() => worker.previewRecipe(
        restoredRecipe,
        Number.isInteger(stepIndex) ? stepIndex : Math.max(0, restoredRecipe.length - 1),
        { includeRows, agentMode: true, semanticSchema: prepared?.schema ?? [], ...(includeRows ? { columns: previewColumns, limit: previewLimit } : {}) },
      ));
      const currentSchema = prepared?.schema ?? dataset.columns.map((name) => ({ name, type: dataset.columnTypes?.[name] ?? null }));
      return {
        valid: true,
        saved: false,
        stepIndex: result.stepIndex,
        stepId: result.stepId,
        output: { rowCount: result.rowCount, columnCount: result.schema.length },
        schemaDelta: schemaDelta(currentSchema, result.schema),
        diagnostics: [],
        ...(includeRows ? { preview: { columns: result.columns, rowCount: result.previewRowCount, rows: result.preview } } : {}),
        workspaceRevision: workspaceRevisionRef.current,
      };
    } catch (cause) {
      return {
        valid: false,
        saved: false,
        diagnostics: [{ level: "error", code: cause?.code ?? "RECIPE_VALIDATION_FAILED", message: cause instanceof Error ? cause.message : "Recipe validation failed." }],
        workspaceRevision: workspaceRevisionRef.current,
      };
    }
  };

  const findComposeNodeForTool = (nodeId) => {
    const graph = flowRef.current;
    const prepared = graph.preparedInputs.find((item) => item.id === nodeId);
    if (prepared) return { node: prepared, nodeType: "dataset" };
    const operation = graph.composeNodes.find((item) => item.id === nodeId);
    if (operation) return { node: operation, nodeType: "operation" };
    return null;
  };

  const composeNodeDetailForTool = (nodeId) => {
    const found = findComposeNodeForTool(nodeId);
    if (!found) throw new Error(`Compose node not found: ${nodeId}`);
    const summary = composeNodeSummaryForAgent(found.node, found.nodeType);
    if (found.nodeType === "dataset") return { ...summary, config: null };
    const input = flowRef.current.preparedInputs.find((item) => item.id === found.node.inputIds?.[0])
      ?? flowRef.current.composeNodes.find((item) => item.id === found.node.inputIds?.[0]);
    return { ...summary, config: protectComposeConfigForAgent(found.node, input?.schema ?? []) };
  };

  const getComposeGraphFromTool = async () => {
    const nodes = [
      ...flowRef.current.preparedInputs.map((item) => composeNodeSummaryForAgent(item, "dataset")),
      ...flowRef.current.composeNodes.map((item) => composeNodeSummaryForAgent(item, "operation")),
    ];
    const sourceById = new Map(flowRef.current.sourceAssets.map((item) => [item.id, item]));
    const edges = flowRef.current.composeNodes.flatMap((node) => node.inputIds.map((sourceId) => ({ sourceId, targetId: node.id, type: "operation-input" })));
    for (const prepared of flowRef.current.preparedInputs) {
      const upstreamNodeId = sourceById.get(prepared.sourceAssetId)?.upstreamNodeId;
      if (upstreamNodeId) edges.push({ sourceId: upstreamNodeId, targetId: prepared.id, type: "materialized-result" });
    }
    return { flowId: flowRef.current.id, flowRevision: flowRef.current.revision, workspaceRevision: workspaceRevisionRef.current, activeNodeId: flowRef.current.activeNodeId, nodes, edges };
  };

  const getComposeNodeFromTool = async (nodeId) => {
    return { ...composeNodeDetailForTool(nodeId), workspaceRevision: workspaceRevisionRef.current };
  };

  const getComposeNodeSchemaFromTool = async (nodeId, options = {}) => {
    const found = findComposeNodeForTool(nodeId);
    if (!found) throw new Error(`Compose node not found: ${nodeId}`);
    return { nodeId, ...paginateAgentSchema(found.node.schema ?? [], options), workspaceRevision: workspaceRevisionRef.current };
  };

  const getComposeNodePreviewFromTool = async (nodeId, columns, options) => {
    await getComposeNodeFromTool(nodeId);
    return runWebMcpRead(() => worker.previewCompose(flowRef.current, nodeId, { columns, ...options, agentMode: true }));
  };

  const getComposeNodeQualityFromTool = async (nodeId) => {
    await getComposeNodeFromTool(nodeId);
    const result = await runWebMcpRead(() => worker.composeNodeQuality(flowRef.current, nodeId));
    return { ...result, workspaceRevision: workspaceRevisionRef.current };
  };

  const getConnectionOptionsFromTool = async (nodeId) => {
    await getComposeNodeFromTool(nodeId);
    const result = await runWebMcpRead(() => worker.composeConnectionOptions(flowRef.current, nodeId));
    return { ...result, workspaceRevision: workspaceRevisionRef.current };
  };

  const getAvailableActionsFromTool = async (targetId) => {
    if (!targetId) {
      const workspace = screen === "input" ? "source" : screen === "data" ? "prepare" : screen;
      const actions = screen === "data" ? ["inspect", "query-column-values", "set-aggregate-columns", "filter", "recipe", "formula-column", "qualitative-coding", ...(recipeHistory.recipe.length ? ["request-delete-all-recipe-steps"] : []), "export", "inspect-activity"] : screen === "compose" ? ["inspect-graph", "select-node", "get-connection-options", "validate-operation", "create-operation", "auto-arrange", "inspect-activity"] : screen === "account" ? ["list-cloud-files", "open-cloud-file", "request-cloud-upload", "inspect-activity"] : ["request-source-file", "request-source-relink", ...(flowRef.current.sourceAssets.length ? ["request-reset-all"] : []), "inspect-activity"];
      const hasUnlinkedSource = flowRef.current.sourceAssets.some((source) => isFlowFileSource(source) && source.status === "unlinked");
      return {
        workspace,
        workspaceRevision: workspaceRevisionRef.current,
        actions,
        actionStatus: actions.map((action) => ({
          action,
          registered: true,
          callable: action === "request-source-file"
            ? worker.ready
            : action === "request-source-relink"
              ? hasUnlinkedSource
              : true,
          blockedReason: action === "request-source-file" && !worker.ready
            ? "WORKER_NOT_READY"
            : action === "request-source-relink" && !hasUnlinkedSource
              ? "SOURCE_NOT_UNLINKED"
              : null,
        })),
      };
    }
    const prepared = flowRef.current.preparedInputs.find((item) => item.id === targetId);
    if (prepared) return { targetId, kind: "dataset", actions: ["open-prepare", "duplicate", "inspect", "query-column-values", "set-aggregate-columns", "filter", "recipe", "formula-column", "qualitative-coding", ...((prepared.recipe?.length ?? 0) > 0 ? ["request-delete-all-recipe-steps"] : []), "export", "create-unary-operation", "connect-binary-operation", "request-delete"], workspaceRevision: workspaceRevisionRef.current };
    const operation = flowRef.current.composeNodes.find((item) => item.id === targetId);
    if (operation) return { targetId, kind: operation.kind, actions: ["inspect", "preview", "update", "export", "promote-result", "create-unary-operation", "connect-binary-operation", "request-delete"], workspaceRevision: workspaceRevisionRef.current };
    throw new Error(`Target not found: ${targetId}`);
  };

  const recipeResultSummary = (result, stepId = null) => ({
    stepId,
    rowCount: result.rowCount,
    columnCount: result.columns.length,
    recipeRevision: result.recipeRevision,
    activity: result.activity,
  });

  const applyFiltersFromTool = async (preparedId, nextFilters, meta) => runWebMcpMutation(meta, async (assertCurrent) => {
    assertActivePreparedForTool(preparedId);
    const result = await applyFilters(nextFilters, dataset.aggregateColumns, assertCurrent, webMcpActivity(meta));
    return result;
  }, `prepare:filters:${preparedId}:${JSON.stringify(nextFilters)}`);

  const setAggregateColumnsFromTool = async (preparedId, columns, meta) => runWebMcpMutation(meta, async (assertCurrent) => {
    assertActivePreparedForTool(preparedId);
    const missing = columns.filter((column) => !dataset.columns.includes(column));
    if (missing.length) throw new Error(`Columns are not available: ${missing.join(", ")}`);
    const result = await applyFilters(filters, columns, assertCurrent, webMcpActivity(meta, { action: "aggregate_columns_changed" }));
    return { aggregateColumns: result.aggregateColumns, hiddenAggregateColumnCount: result.hiddenAggregateColumnCount, activity: result.activity };
  }, `prepare:aggregate-columns:${preparedId}:${JSON.stringify(columns)}`);

  const duplicatePreparedFromTool = async (preparedId, meta) => runWebMcpMutation(meta, async (assertCurrent) => {
    const result = await duplicatePreparation(preparedId, assertCurrent, webMcpActivity(meta));
    if (!result.ok) throw new Error(result.error || "Prepared dataset could not be duplicated.");
    return result;
  }, `prepare:duplicate:${preparedId}`);

  const replaceRecipeFromTool = async (preparedId, recipe, expectedRecipeRevision, meta) => runWebMcpMutation(meta, async (assertCurrent) => {
    const prepared = assertActivePreparedForTool(preparedId);
    const currentRevision = prepared?.recipeVersion ?? 0;
    if (expectedRecipeRevision !== currentRevision) {
      const stale = new Error(`Recipe state is stale. Expected recipe revision ${currentRevision}, received ${expectedRecipeRevision}.`);
      stale.code = "STALE_RECIPE";
      throw stale;
    }
    const currentRecipe = currentPreparedRecipe(preparedId);
    const restoredRecipe = restoreProtectedRecipeValues(recipe, currentRecipe);
    assertAgentRecipeContract(restoredRecipe, currentRecipe);
    const ids = restoredRecipe.map((step) => step.id);
    if (new Set(ids).size !== ids.length) throw new Error("Recipe step IDs must be unique.");
    setScreen("data");
    const result = await applyRecipeChange(restoredRecipe, assertCurrent, webMcpActivity(meta, { action: "recipe_replaced" }));
    return { ...recipeResultSummary(result), recipe: protectRecipeForAgent(currentPreparedRecipe(preparedId), prepared.schema ?? []) };
  }, `prepare:recipe:replace:${preparedId}:${expectedRecipeRevision}:${JSON.stringify(recipe)}`);

  const addRecipeStepFromTool = async (preparedId, definition, meta) => runWebMcpMutation(meta, async (assertCurrent) => {
    assertActivePreparedForTool(preparedId);
    if (!isAgentCreatableTransformation(definition.type)) throw new Error(`WebMCP cannot create recipe step type: ${definition.type}`);
    setScreen("data");
    const step = createStep(definition.type, { ...definition.params });
    const result = await applyRecipeChange([...currentPreparedRecipe(preparedId), step], assertCurrent, webMcpActivity(meta, { summary: { recipeStepType: step.type } }));
    return recipeResultSummary(result, step.id);
  }, `prepare:recipe:add:${preparedId}:${JSON.stringify(definition)}`);

  const updateRecipeStepFromTool = async (preparedId, stepId, definition, meta) => runWebMcpMutation(meta, async (assertCurrent) => {
    assertActivePreparedForTool(preparedId);
    const recipe = currentPreparedRecipe(preparedId);
    const current = recipe.find((step) => step.id === stepId);
    if (!current) throw new Error(`Recipe step not found: ${stepId}`);
    if (definition.type !== current.type) throw new Error(`WebMCP cannot change recipe step ${stepId} from ${current.type} to ${definition.type}.`);
    setScreen("data");
    const nextRecipe = recipe.map((step) => step.id === stepId
      ? { ...step, type: definition.type, params: { ...definition.params } }
      : step);
    const result = await applyRecipeChange(nextRecipe, assertCurrent, webMcpActivity(meta, { summary: { recipeStepType: definition.type } }));
    return recipeResultSummary(result, stepId);
  }, `prepare:recipe:update:${preparedId}:${stepId}:${JSON.stringify(definition)}`);

  const setRecipeStepEnabledFromTool = async (preparedId, stepId, enabled, meta) => runWebMcpMutation(meta, async (assertCurrent) => {
    assertActivePreparedForTool(preparedId);
    const recipe = currentPreparedRecipe(preparedId);
    if (!recipe.some((step) => step.id === stepId)) throw new Error(`Recipe step not found: ${stepId}`);
    setScreen("data");
    const nextRecipe = recipe.map((step) => step.id === stepId ? { ...step, enabled } : step);
    const result = await applyRecipeChange(nextRecipe, assertCurrent, webMcpActivity(meta, { summary: { enabled } }));
    return { ...recipeResultSummary(result, stepId), enabled };
  }, `prepare:recipe:enable:${preparedId}:${stepId}:${enabled}`);

  const moveRecipeStepFromTool = async (preparedId, stepId, position, meta) => runWebMcpMutation(meta, async (assertCurrent) => {
    assertActivePreparedForTool(preparedId);
    const recipe = currentPreparedRecipe(preparedId);
    const sourceIndex = recipe.findIndex((step) => step.id === stepId);
    if (sourceIndex < 0) throw new Error(`Recipe step not found: ${stepId}`);
    if (position > recipe.length) throw new Error(`Recipe position must be between 1 and ${recipe.length}.`);
    const nextRecipe = [...recipe];
    const [step] = nextRecipe.splice(sourceIndex, 1);
    nextRecipe.splice(position - 1, 0, step);
    setScreen("data");
    const result = await applyRecipeChange(nextRecipe, assertCurrent, webMcpActivity(meta));
    return { ...recipeResultSummary(result, stepId), position };
  }, `prepare:recipe:move:${preparedId}:${stepId}:${position}`);

  const undoRecipeFromTool = async (preparedId, meta) => runWebMcpMutation(meta, async (assertCurrent) => {
    assertActivePreparedForTool(preparedId);
    setScreen("data");
    const result = await undoRecipe(assertCurrent, webMcpActivity(meta));
    if (!result) throw new Error("There is no recipe change to undo.");
    return recipeResultSummary(result);
  }, `prepare:recipe:undo:${preparedId}`);

  const redoRecipeFromTool = async (preparedId, meta) => runWebMcpMutation(meta, async (assertCurrent) => {
    assertActivePreparedForTool(preparedId);
    setScreen("data");
    const result = await redoRecipe(assertCurrent, webMcpActivity(meta));
    if (!result) throw new Error("There is no recipe change to redo.");
    return recipeResultSummary(result);
  }, `prepare:recipe:redo:${preparedId}`);

  const applyValueActionFromTool = async (preparedId, action, column, value, meta) => runWebMcpMutation(meta, async (assertCurrent) => {
    assertActivePreparedForTool(preparedId);
    if (!dataset.columns.includes(column)) throw new Error(`Column not found: ${column}`);
    const resolvedValue = value && typeof value === "object" && value.valueRef
      ? (await worker.resolveAgentValue(column, value.valueRef)).raw
      : value;
    const step = createStep("delete-rows", valueRowActionParams(action, column, resolvedValue));
    setScreen("data");
    const result = await applyRecipeChange([...currentPreparedRecipe(preparedId), step], assertCurrent, webMcpActivity(meta, { summary: { recipeStepType: step.type } }));
    return { ...recipeResultSummary(result, step.id), action, column, valueRef: value?.valueRef ?? null };
  }, `prepare:value:${preparedId}:${action}:${column}:${JSON.stringify(value)}`);

  const composeOperationDraftFromTool = (operation, existing = null) => {
    operation = restoreProtectedComposeOperation(operation, existing);
    const defaultName = existing?.name ?? `${t(operation.kind === "filter-rows" ? "filterRows" : operation.kind === "distinct-rows" ? "distinctRows" : operation.kind)} ${flowRef.current.composeNodes.length + 1}`;
    let inputIds;
    let config;
    if (operation.kind === "append") {
      inputIds = operation.inputIds;
      config = {};
    } else if (operation.kind === "join") {
      inputIds = [operation.leftId, operation.rightId];
      config = { joinType: operation.joinType, collisionPolicy: "suffix", keyPairs: [{ left: operation.leftKey, right: operation.rightKey }], leftSuffix: "_left", rightSuffix: "_right" };
    } else if (operation.kind === "difference") {
      inputIds = [operation.leftId, operation.rightId];
      config = { mode: operation.mode, keyPairs: [{ left: operation.leftKey, right: operation.rightKey }] };
    } else {
      inputIds = [operation.inputId];
      if (operation.kind === "filter-rows") config = { conjunction: "and", conditions: [{ column: operation.column, operator: operation.operator, ...(operation.value !== undefined ? { value: operation.value } : {}) }] };
      if (operation.kind === "distinct-rows") config = { columns: operation.columns, mode: operation.mode ?? "representative-rows" };
      if (operation.kind === "aggregate") config = {
        groupBy: operation.groupBy ?? [],
        measures: operation.metrics
          ? operation.metrics.map((metric) => ({ function: metric.function, ...(metric.measureColumn ? { column: metric.measureColumn } : {}), alias: metric.alias, ...(metric.percentile !== undefined ? { percentile: metric.percentile } : {}) }))
          : [{ function: operation.function, ...(operation.measureColumn ? { column: operation.measureColumn } : {}), alias: operation.alias }],
        minimumSampleSize: operation.minimumSampleSize ?? 1,
        suppressSmallGroups: operation.suppressSmallGroups === true,
      };
      if (operation.kind === "pivot") config = { groupBy: operation.groupBy ?? [], pivotColumn: operation.pivotColumn, valueColumn: operation.valueColumn, aggregate: operation.aggregate, values: operation.values };
      if (operation.kind === "unpivot") config = { idColumns: operation.idColumns ?? [], valueColumns: operation.valueColumns, nameColumn: operation.fieldColumn, valueColumn: operation.valueColumn };
    }
    return {
      kind: operation.kind,
      name: operation.name ?? defaultName,
      inputIds,
      config,
      ...(existing?.position ? { position: existing.position } : {}),
    };
  };

  const createComposeOperationFromTool = async (operation, meta) => runWebMcpMutation(meta, async (assertCurrent) => {
    setScreen("compose");
    return createComposeNode(composeOperationDraftFromTool(operation), assertCurrent, webMcpActivity(meta));
  }, `compose:create:${JSON.stringify(operation)}`);

  const updateComposeOperationFromTool = async (nodeId, operation, meta) => runWebMcpMutation(meta, async (assertCurrent) => {
    const existing = flowRef.current.composeNodes.find((node) => node.id === nodeId);
    if (!existing) throw new Error(`Compose operation not found: ${nodeId}`);
    if (operation.kind !== existing.kind) throw new Error("Changing the operation kind is not supported. Create a new operation instead.");
    setScreen("compose");
    return updateComposeOperation(nodeId, composeOperationDraftFromTool(operation, existing), assertCurrent, webMcpActivity(meta));
  }, `compose:update:${nodeId}:${JSON.stringify(operation)}`);

  const validateComposeOperationFromTool = async (operation, { previewColumns, previewLimit = 10 } = {}) => {
    const draft = composeOperationDraftFromTool(operation);
    try {
      const includeRows = Array.isArray(previewColumns) && previewColumns.length > 0;
      const preview = await runWebMcpRead(() => previewComposeDraft(draft, null, {
        includeRows,
        agentMode: true,
        ...(includeRows ? { columns: previewColumns, limit: previewLimit } : {}),
      }));
      const inputSchemas = draft.inputIds.map((inputId) => findComposeNodeForTool(inputId)?.node.schema ?? []);
      return {
        valid: true,
        output: { rowCount: preview.rowCount, columnCount: preview.schema.length },
        schemaDelta: composeSchemaDelta(draft.kind, inputSchemas, preview.schema),
        diagnostics: [],
        ...(includeRows ? { preview: { columns: preview.columns, rowCount: preview.previewRowCount, rows: preview.preview } } : {}),
        workspaceRevision: workspaceRevisionRef.current,
      };
    } catch (cause) {
      return {
        valid: false,
        diagnostics: [{ level: "error", code: cause?.code ?? "COMPOSE_VALIDATION_FAILED", message: cause instanceof Error ? cause.message : "Compose validation failed." }],
        workspaceRevision: workspaceRevisionRef.current,
      };
    }
  };

  const exportPrepareFromTool = async (preparedId, format, meta) => runWebMcpMutation(meta, async (assertCurrent) => {
    assertActivePreparedForTool(preparedId);
    return exportPreparedData(format, preparedId, webMcpActivity(meta), assertCurrent);
  }, `prepare:export:${preparedId}:${format}`);

  const exportComposeFromTool = async (nodeId, format, meta) => runWebMcpMutation(meta, async (assertCurrent) => {
    if (!flowRef.current.composeNodes.some((item) => item.id === nodeId) && !flowRef.current.preparedInputs.some((item) => item.id === nodeId)) {
      throw new Error(`Compose node not found: ${nodeId}`);
    }
    setScreen("compose");
    return exportComposeNode(format, nodeId, webMcpActivity(meta), assertCurrent);
  }, `compose:export:${nodeId}:${format}`);

  const moveComposeNodeFromTool = async (nodeId, position, meta) => runWebMcpMutation(meta, async (assertCurrent) => {
    setScreen("compose");
    return moveComposeNode(nodeId, position, assertCurrent, webMcpActivity(meta));
  }, `compose:move:${nodeId}:${JSON.stringify(position)}`);

  const promoteComposeResultFromTool = async (nodeId, meta) => runWebMcpMutation(meta, async (assertCurrent) => {
    const result = await createPreparationFromCompose(nodeId, assertCurrent, webMcpActivity(meta), { selectCreated: false });
    if (!result.ok) throw new Error(result.error || "Compose result could not be promoted.");
    return result;
  }, `compose:promote:${nodeId}`);

  const requestDeleteFromTool = async (target, targetId, meta) => runWebMcpMutation(meta, async () => {
    if (target === "prepare-recipe") {
      assertActivePreparedForTool(targetId);
      if (!currentPreparedRecipe(targetId).length) throw new Error(`Prepare recipe has no steps: ${targetId}`);
    }
    setScreen(target === "recipe-step" || target === "prepare-recipe" ? "data" : "compose");
    const confirmationId = `confirmation-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
    const expiresAt = new Date(Date.now() + WEBMCP_CONFIRMATION_TTL_MS).toISOString();
    const workspace = target === "recipe-step" || target === "prepare-recipe" ? "prepare" : "compose";
    const activity = await recordActivity({ action: "delete_requested", targetType: target, targetId, status: "pending-confirmation", summary: { targetKind: target } }, webMcpActivity(meta));
    pendingDeleteConfirmationsRef.current.set(`${target}:${targetId}`, {
      confirmationId,
      target,
      targetId,
      flowId: flowRef.current.id,
      workspaceRevision: workspaceRevisionRef.current,
      workspace,
      requestId: meta.requestId,
      expiresAt,
      activityEventId: activity?.eventId ?? null,
    });
    setWebMcpDeleteRequest({ target, targetId, token: confirmationId, confirmationId, expiresAt, requestId: meta.requestId, workspace });
    return { target, targetId, confirmationId, confirmationToken: confirmationId, expiresAt, pendingConfirmation: true, activity };
  }, `delete:request:${target}:${targetId}`);

  const requestResetAllFromTool = async (meta) => runWebMcpMutation(meta, async () => {
    const currentFlow = flowRef.current;
    const hasFlowData = currentFlow.sourceAssets.length > 0
      || currentFlow.preparedInputs.length > 0
      || currentFlow.composeNodes.length > 0;
    if (!hasFlowData) {
      const emptyError = new Error("The current flow is already empty.");
      emptyError.code = "FLOW_ALREADY_EMPTY";
      throw emptyError;
    }
    setScreen("input");
    const confirmationId = `confirmation-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
    const expiresAt = new Date(Date.now() + WEBMCP_CONFIRMATION_TTL_MS).toISOString();
    const request = { token: confirmationId, confirmationId, expiresAt, requestId: meta.requestId, flowId: currentFlow.id, workspace: "source" };
    const activity = await recordActivity({
      action: "reset_all_requested",
      targetType: "flow",
      targetId: currentFlow.id,
      status: "pending-confirmation",
      summary: { scope: "source-prepare-compose" },
    }, webMcpActivity(meta));
    pendingResetConfirmationRef.current = {
      ...request,
      workspace: "source",
      workspaceRevision: workspaceRevisionRef.current,
      activityEventId: activity?.eventId ?? null,
    };
    setWebMcpResetRequest(request);
    return { confirmationId, confirmationToken: confirmationId, expiresAt, pendingConfirmation: true, workspace: "source", activity };
  }, "flow:request-reset-all");

  const getActivityLogFromTool = async ({ limit = 50, targetId = null, actor = null } = {}) => {
    const filtered = activityEventsRef.current
      .filter((event) => !targetId || event.targetId === targetId)
      .filter((event) => !actor || event.actor === actor)
      .slice(0, Math.min(100, Math.max(1, limit)));
    return { events: filtered, cursor: activityEventsRef.current[0]?.sequence ?? 0, hasMore: activityEventsRef.current.length > filtered.length };
  };

  const getChangesSinceFromTool = async (cursor, { limit = 100 } = {}) => pageActivityEvents(activityEventsRef.current, { cursor, limit });

  const acknowledgeDeleteRequest = useCallback((token) => {
    setWebMcpDeleteRequest((current) => current?.token === token ? null : current);
  }, []);

  const resolveDeleteConfirmation = useCallback(async (target, targetId, outcome, context = { actor: "user", origin: "ui" }) => {
    const key = `${target}:${targetId}`;
    const pending = pendingDeleteConfirmationsRef.current.get(key);
    if (!pending) return null;
    pendingDeleteConfirmationsRef.current.delete(key);
    webMcpMutationRunnerRef.current?.setRequestTerminalStatus?.(
      pending.requestId,
      outcome === "cancelled" ? "cancelled" : "committed",
      { target, targetId, pendingConfirmation: false, confirmed: outcome !== "cancelled" },
    );
    return recordActivity({
      action: outcome === "cancelled" ? "delete_cancelled" : "delete_confirmed",
      targetType: target,
      targetId,
      status: outcome === "cancelled" ? "cancelled" : "committed",
      summary: { targetKind: target },
      supersedesEventId: pending.activityEventId,
    }, { ...context, requestId: pending.requestId });
  }, [recordActivity]);

  const resolveResetConfirmation = useCallback(async (token, outcome, context = { actor: "user", origin: "ui" }) => {
    const pending = pendingResetConfirmationRef.current;
    if (!pending || pending.token !== token) return null;
    if (outcome === "confirmed") return null;
    pendingResetConfirmationRef.current = null;
    setWebMcpResetRequest(null);
    webMcpMutationRunnerRef.current?.setRequestTerminalStatus?.(pending.requestId, "cancelled", {
      target: "flow",
      targetId: pending.flowId,
      pendingConfirmation: false,
      confirmed: false,
    });
    return recordActivity({
      action: "reset_all_cancelled",
      targetType: "flow",
      targetId: pending.flowId,
      status: "cancelled",
      summary: { scope: "source-prepare-compose" },
      supersedesEventId: pending.activityEventId,
    }, { ...context, requestId: pending.requestId });
  }, [recordActivity]);

  const getPendingConfirmationsFromTool = async () => {
    const now = Date.now();
    const confirmations = [...pendingDeleteConfirmationsRef.current.values()]
      .filter((item) => item.flowId === flowRef.current.id && Date.parse(item.expiresAt) > now)
      .map(({ confirmationId, target, targetId, workspace, workspaceRevision: targetRevision, expiresAt }) => ({
        confirmationId,
        target,
        targetId,
        workspace,
        targetRevision,
        expiresAt,
        userActionRequired: true,
      }));
    const reset = pendingResetConfirmationRef.current;
    if (reset?.flowId === flowRef.current.id && Date.parse(reset.expiresAt) > now) {
      confirmations.push({
        confirmationId: reset.confirmationId,
        target: "flow",
        targetId: reset.flowId,
        workspace: "source",
        targetRevision: reset.workspaceRevision,
        expiresAt: reset.expiresAt,
        userActionRequired: true,
      });
    }
    return { confirmations, workspaceRevision: workspaceRevisionRef.current };
  };

  const rejectConfirmationFromTool = async (confirmationId) => {
    const pendingDelete = [...pendingDeleteConfirmationsRef.current.values()].find((item) => item.confirmationId === confirmationId);
    if (pendingDelete) {
      await resolveDeleteConfirmation(pendingDelete.target, pendingDelete.targetId, "cancelled", { actor: "agent", origin: "webmcp" });
      setWebMcpDeleteRequest((current) => current?.confirmationId === confirmationId ? null : current);
      return { confirmationId, status: "cancelled", destructiveActionPerformed: false };
    }
    const pendingReset = pendingResetConfirmationRef.current;
    if (pendingReset?.confirmationId === confirmationId) {
      await resolveResetConfirmation(pendingReset.token, "cancelled", { actor: "agent", origin: "webmcp" });
      return { confirmationId, status: "cancelled", destructiveActionPerformed: false };
    }
    const error = new Error(`Pending confirmation not found or expired: ${confirmationId}`);
    error.code = "CONFIRMATION_NOT_FOUND";
    throw error;
  };

  useEffect(() => {
    if (!webMcpDeleteRequest?.expiresAt) return undefined;
    const delay = Math.max(0, Date.parse(webMcpDeleteRequest.expiresAt) - Date.now());
    const timer = window.setTimeout(() => {
      void resolveDeleteConfirmation(webMcpDeleteRequest.target, webMcpDeleteRequest.targetId, "cancelled", { actor: "system", origin: "webmcp" });
      setWebMcpDeleteRequest((current) => current?.confirmationId === webMcpDeleteRequest.confirmationId ? null : current);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [resolveDeleteConfirmation, webMcpDeleteRequest]);

  useEffect(() => {
    if (!webMcpDeleteRequest?.workspace) return;
    const workspace = screen === "input" ? "source" : screen === "data" ? "prepare" : screen;
    if (workspace === webMcpDeleteRequest.workspace) return;
    void resolveDeleteConfirmation(webMcpDeleteRequest.target, webMcpDeleteRequest.targetId, "cancelled", { actor: "system", origin: "webmcp" });
    setWebMcpDeleteRequest((current) => current?.confirmationId === webMcpDeleteRequest.confirmationId ? null : current);
  }, [resolveDeleteConfirmation, screen, webMcpDeleteRequest]);

  useEffect(() => {
    if (!webMcpResetRequest?.expiresAt) return undefined;
    const delay = Math.max(0, Date.parse(webMcpResetRequest.expiresAt) - Date.now());
    const timer = window.setTimeout(() => {
      void resolveResetConfirmation(webMcpResetRequest.token, "cancelled", { actor: "system", origin: "webmcp" });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [resolveResetConfirmation, webMcpResetRequest]);

  useEffect(() => {
    if (!webMcpResetRequest?.workspace) return;
    const workspace = screen === "input" ? "source" : screen === "data" ? "prepare" : screen;
    if (workspace === webMcpResetRequest.workspace) return;
    void resolveResetConfirmation(webMcpResetRequest.token, "cancelled", { actor: "system", origin: "webmcp" });
  }, [resolveResetConfirmation, screen, webMcpResetRequest]);

  const activeAgentSchema = flow.preparedInputs.find((item) => item.id === activePreparedId)?.schema
    ?? dataset?.columns.map((name) => ({ name, type: dataset.columnTypes?.[name] }))
    ?? [];

  useWebMcpTools({
    state: {
      contractVersion: "3.2.0",
      workspaceRevision,
      flowId: flow.id,
      flowRevision: flow.revision,
      activityCursor: activityEvents[0]?.sequence ?? 0,
      activeOperationIds: webMcpMutationRunnerRef.current.getActiveOperationIds(),
      workspace: screen === "input" ? "source" : screen === "data" ? "prepare" : screen,
      worker: { ready: worker.ready, recovering: worker.recovering },
      flowDirty,
      diagnostics: [
        ...(error ? [{ scope: "source-or-prepare", level: "error", message: error }] : []),
        ...(composeError ? [{ scope: "compose", level: "error", message: composeError }] : []),
        ...(recipeRecovery.error ? [{ scope: "recipe", level: "error", message: recipeRecovery.error, stepId: recipeRecovery.invalidStepId }] : []),
        ...(activityError ? [{ scope: "activity", level: "warning", message: "Shared activity history is unavailable." }] : []),
      ],
      activePreparedId,
      activeNodeId: flow.activeNodeId,
      selection: {
        prepareContext: { preparedId: activePreparedId, meaning: "Dataset currently loaded in the Prepare worker and recipe workspace." },
        composeSelection: { nodeId: flow.activeNodeId, meaning: "Node currently selected on the independent Compose canvas." },
        relationship: activePreparedId && flow.activeNodeId === activePreparedId ? "same-dataset" : "independent-workspace-contexts",
      },
      activeDataset: dataset ? {
        name: flow.preparedInputs.find((item) => item.id === activePreparedId)?.name ?? dataset.filename,
        totalRowCount: dataset.rowCount,
        filteredRowCount: dataset.filteredCount,
        previewRowCount: dataset.preview.length,
        columnCount: dataset.columns.length,
        columns: [...dataset.columns],
        schema: dataset.columns.map((name) => flow.preparedInputs.find((item) => item.id === activePreparedId)?.schema?.find((column) => column.name === name) ?? ({ name, type: dataset.columnTypes?.[name] ?? null })),
        filterableColumns: [...dataset.aggregateColumns],
        filterableColumnsTruncated: dataset.aggregateColumns.length < dataset.columns.length,
        filters: protectFiltersForAgent(filters, activeAgentSchema),
        quality: structuredClone(dataset.quality),
      } : null,
      recipeSteps: protectRecipeForAgent(recipeHistory.recipe, activeAgentSchema).map((step) => ({
        id: step.id,
        type: step.type,
        enabled: step.enabled !== false,
        params: { ...step.params },
      })),
      recipeHistory: { canUndo: recipeHistory.canUndo, canRedo: recipeHistory.canRedo },
      preparedInputs: flow.preparedInputs.map((item) => ({
        id: item.id,
        name: item.name,
        totalRowCount: item.rowCount,
        columnCount: item.schema?.length ?? null,
        recipeStepCount: item.recipe?.length ?? 0,
        recipeRevision: item.recipeVersion ?? 0,
        recipeStatus: item.recipeStatus ?? null,
      })),
      composeNodes: [
        ...flow.preparedInputs.map((item) => ({ id: item.id, name: item.name, kind: "dataset", totalRowCount: item.rowCount, columnCount: item.schema?.length ?? null, dataStatus: "ready" })),
        ...flow.composeNodes.map((item) => ({ id: item.id, name: item.name, kind: item.kind, inputIds: [...item.inputIds], totalRowCount: item.rowCount, columnCount: item.schema?.length ?? null, validationStatus: item.validationStatus ?? null, dataStatus: item.dataStatus ?? "ready" })),
      ],
      metricDefinitions: (flow.metricDefinitions ?? []).map((item) => ({ id: item.id, name: item.name, targetId: item.targetId })),
      codingProjects: (flow.codingProjects ?? []).map((project) => codingProjectForAgent(
        project,
        flow.preparedInputs.find((item) => item.id === project.preparedId)?.rowCount ?? null,
      )),
      sourceAssets: flow.sourceAssets.map((item) => ({ id: item.id, name: item.name, location: item.location, status: item.status, size: item.size ?? null })),
    },
    actions: {
      openWorkspace,
      getAvailableActions: getAvailableActionsFromTool,
      getActivityLog: getActivityLogFromTool,
      getChangesSince: getChangesSinceFromTool,
      getOperationStatus: (operationId) => webMcpMutationRunnerRef.current.getOperationStatus(operationId),
      getActiveOperationIds: () => webMcpMutationRunnerRef.current.getActiveOperationIds(),
      getPendingInteractions: () => sourceInteractionsRef.current.list(),
      cancelOperation: (operationId) => webMcpMutationRunnerRef.current.cancelOperation(operationId),
      fenceMutations: () => webMcpMutationRunnerRef.current.fenceMutations(),
      getPendingConfirmations: getPendingConfirmationsFromTool,
      rejectConfirmation: rejectConfirmationFromTool,
      selectPrepared: selectPreparedFromTool,
      getRecipe: getRecipeFromTool,
      getSemanticModel: getSemanticModelFromTool,
      updateSemanticField: updateSemanticFieldFromTool,
      listMetricDefinitions: listMetricDefinitionsFromTool,
      upsertMetricDefinition: upsertMetricDefinitionFromTool,
      duplicatePrepared: duplicatePreparedFromTool,
      replaceRecipe: replaceRecipeFromTool,
      getPrepareDataset: getPrepareDatasetFromTool,
      getDataProfile: getDataProfileFromTool,
      queryColumnValues: queryColumnValuesFromTool,
      getPreparePreview: getPreparePreviewFromTool,
      getCodingProject: getCodingProjectFromTool,
      getCodingBatch: getCodingBatchFromTool,
      submitCodingBatch: submitCodingBatchFromTool,
      getCodingProgress: getCodingProjectFromTool,
      previewRecipeChange: previewRecipeChangeFromTool,
      applyFilters: applyFiltersFromTool,
      setAggregateColumns: setAggregateColumnsFromTool,
      selectComposeNode: selectComposeNodeFromTool,
      autoArrangeCompose: autoArrangeComposeFromTool,
      moveComposeNode: moveComposeNodeFromTool,
      getComposeGraph: getComposeGraphFromTool,
      getComposeNode: getComposeNodeFromTool,
      getComposeNodeSchema: getComposeNodeSchemaFromTool,
      getComposeNodePreview: getComposeNodePreviewFromTool,
      getComposeNodeQuality: getComposeNodeQualityFromTool,
      validateComposeOperation: validateComposeOperationFromTool,
      getConnectionOptions: getConnectionOptionsFromTool,
      requestSourceFileSelection,
      requestSourceRelink: requestSourceRelinkFromTool,
      requestResetAll: requestResetAllFromTool,
      listCloudFiles: listCloudFilesFromTool,
      openCloudFile: openCloudFileFromTool,
      requestCloudUpload: requestCloudUploadFromTool,
      exportPrepare: exportPrepareFromTool,
      addRecipeStep: addRecipeStepFromTool,
      updateRecipeStep: updateRecipeStepFromTool,
      setRecipeStepEnabled: setRecipeStepEnabledFromTool,
      moveRecipeStep: moveRecipeStepFromTool,
      undoRecipe: undoRecipeFromTool,
      redoRecipe: redoRecipeFromTool,
      applyValueAction: applyValueActionFromTool,
      createComposeOperation: createComposeOperationFromTool,
      updateComposeOperation: updateComposeOperationFromTool,
      promoteComposeResult: promoteComposeResultFromTool,
      exportCompose: exportComposeFromTool,
      requestDelete: requestDeleteFromTool,
    },
  });

  return (
    <div className={`app-shell ${collapsed ? "app-shell--collapsed" : ""}`}>
      <Sidebar screen={screen} collapsed={collapsed} hasDataset={Boolean(dataset)} hasPrepared={flow.preparedInputs.length > 0} hasFlow={flow.preparedInputs.length > 0} onNavigate={(nextScreen) => {
        const workspace = nextScreen === "input" ? "source" : nextScreen === "data" ? "prepare" : nextScreen;
        void openWorkspace(workspace);
      }} onCollapse={() => setCollapsed((value) => !value)} />
      {flowDirty && <div className="flow-save-alert" role="alert"><span>{t("flowSaveFailed")}</span><button type="button" disabled={retryingFlowSave} onClick={retryFlowSave}>{t(retryingFlowSave ? "saving" : "retrySave")}</button></div>}
      {activityOverrideNotice && <div className="activity-override-notice" role="status"><ClockCounterClockwise weight="bold" /><span>{t("activityOverrideNotice")}</span><button type="button" aria-label={t("closeForm")} onClick={() => setActivityOverrideNotice("")}><X weight="bold" /></button></div>}
      {screen === "account" ? (
        <AccountScreen
          onOpenFile={async (file) => { setScreen("input"); await loadFile(file, null); }}
          uploadRequestToken={webMcpCloudUploadToken}
          onUploadRequestShown={(token) => setWebMcpCloudUploadToken((current) => current === token ? 0 : current)}
          activityEvents={activityEvents}
          activityLoading={activityLoading}
          activityError={activityError}
        />
      ) : screen === "input" ? (
        <InputScreen
          loading={loading}
          error={error}
          onFile={loadFile}
          onOpenSource={openPrepared}
          onRelinkSource={relinkSourceFromPicker}
          onSourceInteractionCancelled={(kind, sourceAssetId = null) => {
            sourceInteractionsRef.current.resolveLatest(kind, "cancelled", { sourceAssetId, reason: "USER_CANCELLED" });
          }}
          onResetAll={resetAll}
          workerReady={worker.ready}
          openedSources={openedSources}
          fileRequestToken={webMcpFileRequestToken}
          onFileRequestShown={(token) => setWebMcpFileRequestToken((current) => current === token ? 0 : current)}
          relinkRequest={webMcpRelinkRequest}
          onRelinkRequestShown={(token) => setWebMcpRelinkRequest((current) => current?.token === token ? null : current)}
          resetRequest={webMcpResetRequest}
          onResetRequestShown={() => undefined}
          onResetRequestResolved={(token, outcome) => void resolveResetConfirmation(token, outcome)}
        />
      ) : screen === "compose" ? (
        <ComposeScreen
          flow={composeSchemaState.graph}
          dirty={flowDirty}
          preview={composePreview}
          loading={composeLoading}
          error={composeError}
          onSelectNode={selectComposeNode}
          onPreviewDraft={previewComposeDraft}
          onCreateNode={createComposeNode}
          onUpdateNode={updateComposeOperation}
          onDeleteNode={deleteComposeOperation}
          onDeletePrepared={deletePreparedDataset}
          onDeleteMetricDefinition={deleteMetricDefinition}
          onMoveNode={moveComposeNode}
          onAutoArrange={autoArrangeComposeNodes}
          onDuplicate={duplicatePreparation}
          onCreatePrepared={createPreparationFromCompose}
          onEditPreparation={openPrepared}
          onExport={exportComposeNode}
          onGetNodeQuality={getComposeNodeQualityFromTool}
          deleteRequest={["recipe-step", "prepare-recipe"].includes(webMcpDeleteRequest?.target) ? null : webMcpDeleteRequest}
          onDeleteRequestShown={acknowledgeDeleteRequest}
          onDeleteConfirmation={resolveDeleteConfirmation}
        />
      ) : dataset ? (
        <DataScreen
          dataset={dataset}
          activePreparedId={activePreparedId}
          preparedName={flow.preparedInputs.find((item) => item.id === activePreparedId)?.name}
          preparedOptions={preparedOptions}
          filters={filters}
          loading={loading}
          error={error}
          recipe={recipeHistory.recipe}
          initialRecipeError={recipeRecovery.error}
          initialInvalidStepId={recipeRecovery.invalidStepId}
          canUndo={recipeHistory.canUndo}
          canRedo={recipeHistory.canRedo}
          onFiltersChange={applyFilters}
          onAggregateSearch={searchAggregate}
          onRecipeChange={applyRecipeChange}
          onRecipeUndo={undoRecipe}
          onRecipeRedo={redoRecipe}
          onRecipePreview={previewRecipe}
          onPreparedChange={openPrepared}
          codingProject={(flow.codingProjects ?? []).find((project) => project.preparedId === activePreparedId) ?? null}
          onSaveCodingProject={saveCodingProject}
          onGrantCodingAccess={grantActiveCodingAccess}
          onRevokeCodingAccess={revokeActiveCodingAccess}
          onReviewCodingAssignment={reviewActiveCodingAssignment}
          onLoadCodingEvidence={loadCodingEvidence}
          onMaterializeCodingProject={materializeActiveCodingProject}
          deleteRequest={["recipe-step", "prepare-recipe"].includes(webMcpDeleteRequest?.target) ? webMcpDeleteRequest : null}
          onDeleteRequestShown={acknowledgeDeleteRequest}
          onDeleteConfirmation={resolveDeleteConfirmation}
        />
      ) : null}
    </div>
  );
}
