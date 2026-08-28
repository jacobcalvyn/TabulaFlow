import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
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
  UploadSimple,
  WarningCircle,
  UserCircle,
  X,
} from "@phosphor-icons/react";
import { formatValue, isSupportedFile } from "./data.js";
import { useDataWorker } from "./useDataWorker.js";
import { useWebMcpTools } from "./useWebMcpTools.js";
import { StepsPanel, TransformationForm } from "./StepsPanel.jsx";
import { useRecipeHistory } from "./useRecipeHistory.js";
import { fileFromDroppedItem, isSameFileEntry, pickSourceFile, restoreFileFromHandle } from "./sourceFileHandles.js";
import {
  loadStoredFlow,
  loadStoredSourceHandle,
  deleteStoredSourceHandle,
  saveStoredFlow,
  saveStoredSourceHandle,
} from "./recipeStorage.js";
import { useI18n } from "./i18n.jsx";
import { ComposeScreen } from "./ComposeScreen.jsx";
import { activatePreparedForFlow } from "./preparedActivation.js";
import { getCloudAccount, getCloudFiles, openCloudFile, uploadCloudFile } from "./cloudFiles.js";
import {
  PREPARED_RECIPE_STATUS,
  recipeForExecution,
} from "./preparedRecipeState.js";
import { createStep, CREATABLE_TRANSFORMATION_TYPES, valueRowActionParams } from "./transformations.js";
import {
  addComposeNode,
  addPreparedInput,
  autoArrangeNodePositions,
  consolidateDuplicateFileSources,
  createFlowGraph,
  createPreparedInput,
  createPreparedFromCompose,
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

const ACCEPTED_FILES = ".xlsx,.xls,.csv,.json,.jsonl,.ndjson";
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

function stepTouchesColumn(step, column) {
  const params = step.params ?? {};
  const directFields = ["column", "leftColumn", "rightColumn", "valueColumn", "newName"];
  if (directFields.some((field) => params[field] === column)) return true;
  return ["columns", "groupColumns"].some((field) => {
    const value = params[field];
    const columns = Array.isArray(value) ? value : String(value ?? "").split(",");
    return columns.some((item) => String(item).trim() === column);
  });
}

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

function AccountScreen({ onOpenFile }) {
  const { language, t } = useI18n();
  const locale = language === "id" ? "id-ID" : "en-US";
  const inputRef = useRef(null);
  const [account, setAccount] = useState(null);
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
              <button className="button button--secondary" type="button" disabled={busy} onClick={() => inputRef.current?.click()}><CloudArrowUp weight="bold" /> {t("uploadToCloud")}</button>
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

function InputScreen({ loading, error, onFile, onOpenSource, onRelinkSource, workerReady, openedSources, fileRequestToken, onFileRequestShown }) {
  const { formatNumber, t } = useI18n();
  const inputRef = useRef(null);
  const chooseFileButtonRef = useRef(null);
  const [relinkSourceId, setRelinkSourceId] = useState(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!fileRequestToken) return;
    chooseFileButtonRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    chooseFileButtonRef.current?.focus();
    onFileRequestShown?.(fileRequestToken);
  }, [fileRequestToken, onFileRequestShown]);

  const chooseFile = async () => {
    try {
      const picked = await pickSourceFile();
      if (!picked.supported) inputRef.current?.click();
      else if (picked.selection) onFile(picked.selection.file, picked.selection.handle);
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
          <span>{formatNumber(openedSources.length)}</span>
        </header>
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
                  <button className="opened-source__relink" type="button" disabled={loading || source.status === "restoring"} onClick={() => chooseRelinkFile(source.sourceAssetId)}>
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
  deleteRequest,
  onDeleteRequestShown,
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
  const splitRef = useRef(null);
  const preparedSelectorRef = useRef(null);
  const columnPickerRef = useRef(null);
  const transformPopoverRef = useRef(null);
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
            <div className="column-picker" ref={columnPickerRef}>
              <button type="button" className="column-picker__trigger" onClick={() => {
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
                transformUsed={recipe.some((step) => step.enabled !== false && stepTouchesColumn(step, aggregate.column))}
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
          previewedStepId={stepPreview?.stepId ?? null}
          deleteRequest={deleteRequest}
          onDeleteRequestShown={onDeleteRequestShown}
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
  const [flow, setFlow] = useState(createFlowGraph);
  const flowRef = useRef(flow);
  const [activePreparedId, setActivePreparedId] = useState(null);
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
  const [webMcpFileRequestToken, setWebMcpFileRequestToken] = useState(0);
  const [webMcpDeleteRequest, setWebMcpDeleteRequest] = useState(null);
  const restoreStartedRef = useRef(false);
  const flowHydratedRef = useRef(false);

  useEffect(() => { flowRef.current = flow; }, [flow]);

  const commitFlow = useCallback(async (nextFlow) => {
    flowRef.current = nextFlow;
    setFlow(nextFlow);
    if (flowHydratedRef.current) {
      try {
        await saveStoredFlow(nextFlow);
        setFlowDirty(false);
      } catch {
        setFlowDirty(true);
      }
    }
    return nextFlow;
  }, []);

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
        const cleaned = repairOverlappingNodePositions(removeBuiltInDemoData(validateFlowGraph(stored)));
        const consolidated = consolidateDuplicateFileSources(cleaned);
        await migrateConsolidatedSourceHandles(consolidated.sourceIdMap);
        const restored = markSourcesUnlinked(consolidated.graph);
        flowRef.current = restored;
        setFlow(restored);
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

  const relinkSource = useCallback(async (sourceAssetId, nextFile, handle = null, automatic = false) => {
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
    const linkedFlow = {
      ...flowRef.current,
      sourceAssets: flowRef.current.sourceAssets.map((item) => item.id === source.id ? { ...item, status: "linked" } : item),
    };
    await commitFlow(linkedFlow);
    if (handle) await saveStoredSourceHandle(source.id, handle);
    if (!automatic) setError("");
    return true;
  }, [commitFlow, t, worker]);

  const relinkSourceFromPicker = useCallback(async (sourceAssetId, nextFile, handle) => {
    setLoading(true);
    setError("");
    try {
      await relinkSource(sourceAssetId, nextFile, handle, false);
    } catch (cause) {
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
      await commitFlow(nextFlow);
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
    void commitFlow(composeSchemaState.graph);
  }, [commitFlow, composeSchemaState.graph, flow, screen]);

  useEffect(() => {
    if (!flowHydrated || !dataset || !activePreparedId) return;
    const prepared = flowRef.current.preparedInputs.find((item) => item.id === activePreparedId);
    if (!prepared || prepared.rowCount === dataset.rowCount) return;
    void commitFlow(updatePreparedInput(flowRef.current, activePreparedId, { rowCount: dataset.rowCount }));
  }, [activePreparedId, commitFlow, dataset, flowHydrated]);

  const activateDataset = async (result, source = null, recipe = []) => {
    setDataset(result);
    setActivePreparedId(result.preparedId ?? null);
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

  const loadFile = async (nextFile, handle = null) => {
    setError("");
    if (!isSupportedFile(nextFile.name)) {
      if (!dataset) setDataset(null);
      setError(t("unsupportedFormat"));
      return;
    }

    setLoading(true);
    try {
      const inspected = await worker.inspectFile(nextFile);
      const matchingSource = findMatchingFileSource(flowRef.current, nextFile, inspected.sourceColumns);
      if (matchingSource) {
        const storedHandle = await loadStoredSourceHandle(matchingSource.id);
        const sameEntry = !handle || !storedHandle || await isSameFileEntry(storedHandle, handle);
        if (sameEntry) {
          await relinkSource(matchingSource.id, nextFile, handle, false);
          return;
        }
      }
      const result = await worker.loadFile(nextFile);
      await activateDataset(result, {
        kind: "local",
        size: nextFile.size,
        lastModified: nextFile.lastModified,
      }, []);
      if (handle && result.sourceId) await saveStoredSourceHandle(result.sourceId, handle);
    } catch (cause) {
      if (!dataset) setDataset(null);
      setError(cause instanceof Error ? cause.message : t("fileReadFailed"));
    } finally {
      setLoading(false);
    }
  };

  const applyFilters = useCallback(async (filters, aggregateColumns) => {
    const result = await worker.filter(filters, aggregateColumns);
    setDataset(result);
    setFilters(filters);
    return result;
  }, [worker]);

  const searchAggregate = useCallback(
    (column, query, filters) => worker.searchAggregate(column, query, filters),
    [worker],
  );

  const persistPreparedRecipe = async (recipe, result, preparedId = activePreparedId) => {
    if (!preparedId) return;
    const prepared = flowRef.current.preparedInputs.find((item) => item.id === preparedId);
    const descendantIds = collectDescendantNodeIds(flowRef.current, [preparedId]);
    const updated = updatePreparedInput(flowRef.current, preparedId, {
      recipe,
      recipeStatus: PREPARED_RECIPE_STATUS.APPLIED,
      recipeVersion: (prepared?.recipeVersion ?? 0) + 1,
      rowCount: result.rowCount,
      schema: result.columns.map((name) => ({ name, type: result.columnTypes?.[name] ?? null })),
    });
    const nextFlow = {
      ...updated,
      composeNodes: updated.composeNodes.map((node) => descendantIds.has(node.id)
        ? { ...node, schema: [], validationStatus: "needs-validation" }
        : node),
    };
    await commitFlow(nextFlow);
    setComposePreview(null);
    setComposeError("");
  };

  const applyRecipeChange = async (recipe) => {
    const result = await worker.applyRecipe(recipe, filters, dataset?.aggregateColumns ?? [], activePreparedId);
    const next = recipeHistory.commit(recipe);
    setDataset(result);
    setFilters(result.appliedFilters ?? filters);
    await persistPreparedRecipe(next, result);
    return result;
  };

  const undoRecipe = async () => {
    const next = recipeHistory.undoTarget;
    if (!next) return null;
    const result = await worker.applyRecipe(next, filters, dataset?.aggregateColumns ?? [], activePreparedId);
    recipeHistory.undo();
    setDataset(result);
    setFilters(result.appliedFilters ?? filters);
    await persistPreparedRecipe(next, result);
    return result;
  };

  const redoRecipe = async () => {
    const next = recipeHistory.redoTarget;
    if (!next) return null;
    const result = await worker.applyRecipe(next, filters, dataset?.aggregateColumns ?? [], activePreparedId);
    recipeHistory.redo();
    setDataset(result);
    setFilters(result.appliedFilters ?? filters);
    await persistPreparedRecipe(next, result);
    return result;
  };

  const openPrepared = async (preparedId) => {
    const prepared = flowRef.current.preparedInputs.find((item) => item.id === preparedId);
    const source = flowRef.current.sourceAssets.find((item) => item.id === prepared?.sourceAssetId);
    if (!prepared || !source) return;
    if (source.status !== "linked" && source.location === "local-device") {
      setError(t("relinkRequired"));
      setScreen("input");
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
      setDataset(result);
      setFilters({});
      setActivePreparedId(preparedId);
      recipeHistory.reset(result.recipe ?? []);
      setRecipeRecovery({ error: "", invalidStepId: null });
      await commitFlow(updatePreparedInput(flowRef.current, preparedId, {
        rowCount: result.rowCount,
        schema: result.columns.map((name) => ({ name, type: result.columnTypes?.[name] ?? null })),
      }));
      setScreen("data");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("fileReadFailed"));
      setScreen("input");
    } finally {
      setLoading(false);
    }
  };

  const duplicatePreparation = async (preparedId) => {
    setComposeError("");
    try {
      const duplicated = duplicatePreparedInput(flowRef.current, preparedId);
      await worker.registerPreparedCopy(duplicated.preparedInput.id, preparedId, duplicated.preparedInput.recipe);
      await commitFlow(duplicated.graph);
      setComposePreview(null);
      return { ok: true, preparedInputId: duplicated.preparedInput.id };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : t("duplicateFailed");
      setComposeError(message);
      return { ok: false, error: message };
    }
  };

  const createPreparationFromCompose = async (nodeId) => {
    setComposeError("");
    try {
      const candidate = createPreparedFromCompose(flowRef.current, nodeId);
      const materialized = await worker.materializeComposePrepared(flowRef.current, nodeId, {
        sourceId: candidate.sourceAsset.id,
        preparedId: candidate.preparedInput.id,
        filename: candidate.preparedInput.name,
      });
      const nextGraph = {
        ...candidate.graph,
        sourceAssets: candidate.graph.sourceAssets.map((item) => item.id === candidate.sourceAsset.id
          ? { ...item, sourceColumns: materialized.schema.map((column) => column.name), schemaFingerprint: schemaFingerprint(materialized.schema) }
          : item),
        preparedInputs: candidate.graph.preparedInputs.map((item) => item.id === candidate.preparedInput.id
          ? { ...item, rowCount: materialized.rowCount, schema: materialized.schema.map((column) => ({ ...column })) }
          : item),
      };
      await commitFlow(nextGraph);
      setComposePreview(null);
      return { ok: true, preparedInputId: candidate.preparedInput.id };
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
        setActivePreparedId(null);
        setDataset(null);
        setFilters({});
        recipeHistory.reset([]);
      }
      setComposePreview(null);
      return true;
    } catch (cause) {
      const message = cause?.code === "PREPARED_INPUT_HAS_DESCENDANTS"
        ? t("deleteDownstreamFirst")
        : cause instanceof Error ? cause.message : t("deletePreparedFailed");
      setComposeError(message);
      return false;
    }
  };

  const selectComposeNode = async (nodeId) => {
    const nextFlow = { ...flowRef.current, activeNodeId: nodeId };
    await commitFlow(nextFlow);
    setComposeLoading(true);
    setComposeError("");
    try {
      const preview = await worker.previewCompose(nextFlow, nodeId);
      if (nextFlow.composeNodes.some((node) => node.id === nodeId)) {
        await commitFlow({
          ...nextFlow,
          revision: nextFlow.revision + 1,
          composeNodes: nextFlow.composeNodes.map((node) => node.id === nodeId ? { ...node, rowCount: preview.rowCount, schema: preview.schema, validationStatus: "valid" } : node),
          updatedAt: new Date().toISOString(),
        });
      }
      setComposePreview(preview);
    } catch (cause) {
      setComposePreview(null);
      setComposeError(cause instanceof Error ? cause.message : t("composePreviewFailed"));
    } finally {
      setComposeLoading(false);
    }
  };

  const createComposeNode = async (draft) => {
    const candidate = addComposeNode(flowRef.current, draft);
    const preview = await worker.previewCompose(candidate.graph, candidate.node.id);
    const committed = {
      ...candidate.graph,
      composeNodes: candidate.graph.composeNodes.map((node) => node.id === candidate.node.id ? { ...node, rowCount: preview.rowCount, schema: preview.schema, validationStatus: "valid" } : node),
    };
    await commitFlow(committed);
    setComposePreview(preview);
    setComposeError("");
    return {
      nodeId: candidate.node.id,
      name: candidate.node.name,
      rowCount: preview.rowCount,
      columnCount: preview.schema.length,
    };
  };

  const updateComposeOperation = async (nodeId, draft) => {
    const candidate = updateComposeNode(flowRef.current, nodeId, draft);
    const preview = await worker.previewCompose(candidate.graph, nodeId);
    const committed = {
      ...candidate.graph,
      composeNodes: candidate.graph.composeNodes.map((node) => node.id === nodeId
        ? { ...node, rowCount: preview.rowCount, schema: preview.schema, validationStatus: "valid" }
        : node),
    };
    await commitFlow(committed);
    setComposePreview(preview);
    setComposeError("");
  };

  const deleteComposeOperation = async (nodeId) => {
    const candidate = removeComposeNode(flowRef.current, nodeId);
    await commitFlow(candidate.graph);
    setComposePreview(null);
    setComposeError("");
  };

  const previewComposeDraft = async (draft, nodeId = null) => {
    const candidate = nodeId
      ? updateComposeNode(flowRef.current, nodeId, draft)
      : addComposeNode(flowRef.current, draft);
    return worker.previewCompose(candidate.graph, candidate.node.id);
  };

  const moveComposeNode = async (nodeId, position) => {
    try {
      await commitFlow(updateNodePosition(flowRef.current, nodeId, position));
    } catch (cause) {
      setComposeError(cause instanceof Error ? cause.message : t("composeUpdateFailed"));
    }
  };

  const autoArrangeComposeNodes = async () => {
    try {
      return await commitFlow(autoArrangeNodePositions(flowRef.current));
    } catch (cause) {
      setComposeError(cause instanceof Error ? cause.message : t("composeUpdateFailed"));
      return null;
    }
  };

  const exportComposeNode = async (format, nodeId = flowRef.current.activeNodeId) => {
    if (!nodeId) throw new Error("Select a Compose node before exporting.");
    const result = await worker.exportCompose(flowRef.current, nodeId, format);
    downloadExport(result);
    return { nodeId, filename: result.filename, format };
  };

  const exportPreparedData = async (format) => {
    if (!dataset) throw new Error("Open a prepared dataset before exporting.");
    setScreen("data");
    const result = await worker.exportData(format, filters);
    downloadExport(result);
    return { filename: result.filename, format, rowCount: dataset.rowCount };
  };

  const previewRecipe = (recipe, stepIndex) => worker.previewRecipe(recipe, stepIndex);

  const openWorkspace = async (workspace) => {
    if (workspace === "source" || workspace === "account") {
      setScreen(workspace === "source" ? "input" : "account");
      return;
    }
    if (workspace === "compose") {
      if (flowRef.current.preparedInputs.length === 0) throw new Error("Compose requires at least one prepared dataset.");
      setScreen("compose");
      return;
    }
    if (workspace !== "prepare") throw new Error(`Unknown workspace: ${workspace}`);
    const preparedId = flowRef.current.preparedInputs.some((item) => item.id === flowRef.current.activeNodeId)
      ? flowRef.current.activeNodeId
      : activePreparedId ?? flowRef.current.preparedInputs[0]?.id;
    if (!preparedId) throw new Error("Prepare requires an existing prepared dataset.");
    await openPrepared(preparedId);
  };

  const selectComposeNodeFromTool = async (nodeId) => {
    setScreen("compose");
    await selectComposeNode(nodeId);
  };

  const autoArrangeComposeFromTool = async () => {
    setScreen("compose");
    return autoArrangeComposeNodes();
  };

  const requestSourceFileSelection = async () => {
    if (!worker.ready) throw new Error("The local data engine is still starting. Try again when workspace state reports ready.");
    setScreen("input");
    setWebMcpFileRequestToken((current) => current + 1);
  };

  const recipeResultSummary = (result, stepId = null) => ({
    stepId,
    rowCount: result.rowCount,
    columnCount: result.columns.length,
  });

  const addRecipeStepFromTool = async (definition) => {
    if (!dataset) throw new Error("Open a prepared dataset before changing its recipe.");
    setScreen("data");
    const step = createStep(definition.type, { ...definition.params });
    const result = await applyRecipeChange([...recipeHistory.recipe, step]);
    return recipeResultSummary(result, step.id);
  };

  const updateRecipeStepFromTool = async (stepId, definition) => {
    const current = recipeHistory.recipe.find((step) => step.id === stepId);
    if (!current) throw new Error(`Recipe step not found: ${stepId}`);
    setScreen("data");
    const nextRecipe = recipeHistory.recipe.map((step) => step.id === stepId
      ? { ...step, type: definition.type, params: { ...definition.params } }
      : step);
    const result = await applyRecipeChange(nextRecipe);
    return recipeResultSummary(result, stepId);
  };

  const setRecipeStepEnabledFromTool = async (stepId, enabled) => {
    if (!recipeHistory.recipe.some((step) => step.id === stepId)) throw new Error(`Recipe step not found: ${stepId}`);
    setScreen("data");
    const nextRecipe = recipeHistory.recipe.map((step) => step.id === stepId ? { ...step, enabled } : step);
    const result = await applyRecipeChange(nextRecipe);
    return { ...recipeResultSummary(result, stepId), enabled };
  };

  const moveRecipeStepFromTool = async (stepId, position) => {
    const sourceIndex = recipeHistory.recipe.findIndex((step) => step.id === stepId);
    if (sourceIndex < 0) throw new Error(`Recipe step not found: ${stepId}`);
    if (position > recipeHistory.recipe.length) throw new Error(`Recipe position must be between 1 and ${recipeHistory.recipe.length}.`);
    const nextRecipe = [...recipeHistory.recipe];
    const [step] = nextRecipe.splice(sourceIndex, 1);
    nextRecipe.splice(position - 1, 0, step);
    setScreen("data");
    const result = await applyRecipeChange(nextRecipe);
    return { ...recipeResultSummary(result, stepId), position };
  };

  const undoRecipeFromTool = async () => {
    setScreen("data");
    const result = await undoRecipe();
    if (!result) throw new Error("There is no recipe change to undo.");
    return recipeResultSummary(result);
  };

  const redoRecipeFromTool = async () => {
    setScreen("data");
    const result = await redoRecipe();
    if (!result) throw new Error("There is no recipe change to redo.");
    return recipeResultSummary(result);
  };

  const applyValueActionFromTool = async (action, column, value) => {
    if (!dataset?.columns.includes(column)) throw new Error(`Column not found: ${column}`);
    const step = createStep("delete-rows", valueRowActionParams(action, column, value));
    setScreen("data");
    const result = await applyRecipeChange([...recipeHistory.recipe, step]);
    return { ...recipeResultSummary(result, step.id), action, column, value };
  };

  const createComposeOperationFromTool = async (operation) => {
    const defaultName = `${t(operation.kind === "filter-rows" ? "filterRows" : operation.kind === "distinct-rows" ? "distinctRows" : operation.kind)} ${flowRef.current.composeNodes.length + 1}`;
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
      if (operation.kind === "distinct-rows") config = { columns: operation.columns };
      if (operation.kind === "aggregate") config = { groupBy: operation.groupBy ?? [], measures: [{ function: operation.function, ...(operation.measureColumn ? { column: operation.measureColumn } : {}), alias: operation.alias }] };
      if (operation.kind === "pivot") config = { groupBy: operation.groupBy ?? [], pivotColumn: operation.pivotColumn, valueColumn: operation.valueColumn, aggregate: operation.aggregate, values: operation.values };
      if (operation.kind === "unpivot") config = { idColumns: operation.idColumns ?? [], valueColumns: operation.valueColumns, nameColumn: operation.fieldColumn, valueColumn: operation.valueColumn };
    }
    setScreen("compose");
    return createComposeNode({ kind: operation.kind, name: operation.name ?? defaultName, inputIds, config });
  };

  const exportComposeFromTool = async (nodeId, format) => {
    setScreen("compose");
    await selectComposeNode(nodeId);
    return exportComposeNode(format, nodeId);
  };

  const requestDeleteFromTool = async (target, targetId) => {
    setScreen(target === "recipe-step" ? "data" : "compose");
    setWebMcpDeleteRequest({ target, targetId, token: `${Date.now()}-${Math.random()}` });
  };

  const acknowledgeDeleteRequest = useCallback((token) => {
    setWebMcpDeleteRequest((current) => current?.token === token ? null : current);
  }, []);

  useWebMcpTools({
    state: {
      workspace: screen === "input" ? "source" : screen === "data" ? "prepare" : screen,
      worker: { ready: worker.ready, recovering: worker.recovering },
      flowDirty,
      activePreparedId,
      activeNodeId: flow.activeNodeId,
      activeDataset: dataset ? {
        name: flow.preparedInputs.find((item) => item.id === activePreparedId)?.name ?? dataset.filename,
        rowCount: dataset.rowCount,
        columnCount: dataset.columns.length,
        filterableColumns: [...dataset.aggregateColumns],
        filterableColumnsTruncated: dataset.aggregateColumns.length < dataset.columns.length,
        filters: { ...filters },
      } : null,
      recipeSteps: recipeHistory.recipe.map((step) => ({
        id: step.id,
        type: step.type,
        enabled: step.enabled !== false,
        params: { ...step.params },
      })),
      recipeHistory: { canUndo: recipeHistory.canUndo, canRedo: recipeHistory.canRedo },
      preparedInputs: flow.preparedInputs.map((item) => ({
        id: item.id,
        name: item.name,
        rowCount: item.rowCount,
        columnCount: item.schema?.length ?? null,
      })),
      composeNodes: [
        ...flow.preparedInputs.map((item) => ({ id: item.id, name: item.name, kind: "dataset", rowCount: item.rowCount, columnCount: item.schema?.length ?? null })),
        ...flow.composeNodes.map((item) => ({ id: item.id, name: item.name, kind: item.kind, inputIds: [...item.inputIds], rowCount: item.rowCount, columnCount: item.schema?.length ?? null })),
      ],
    },
    actions: {
      openWorkspace,
      selectPrepared: openPrepared,
      applyFilters: (nextFilters) => applyFilters(nextFilters, dataset?.aggregateColumns ?? []),
      selectComposeNode: selectComposeNodeFromTool,
      autoArrangeCompose: autoArrangeComposeFromTool,
      requestSourceFileSelection,
      exportPrepare: exportPreparedData,
      addRecipeStep: addRecipeStepFromTool,
      updateRecipeStep: updateRecipeStepFromTool,
      setRecipeStepEnabled: setRecipeStepEnabledFromTool,
      moveRecipeStep: moveRecipeStepFromTool,
      undoRecipe: undoRecipeFromTool,
      redoRecipe: redoRecipeFromTool,
      applyValueAction: applyValueActionFromTool,
      createComposeOperation: createComposeOperationFromTool,
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
      {screen === "account" ? (
        <AccountScreen onOpenFile={async (file) => { setScreen("input"); await loadFile(file, null); }} />
      ) : screen === "input" ? (
        <InputScreen
          loading={loading}
          error={error}
          onFile={loadFile}
          onOpenSource={openPrepared}
          onRelinkSource={relinkSourceFromPicker}
          workerReady={worker.ready}
          openedSources={openedSources}
          fileRequestToken={webMcpFileRequestToken}
          onFileRequestShown={(token) => setWebMcpFileRequestToken((current) => current === token ? 0 : current)}
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
          onMoveNode={moveComposeNode}
          onAutoArrange={autoArrangeComposeNodes}
          onDuplicate={duplicatePreparation}
          onCreatePrepared={createPreparationFromCompose}
          onEditPreparation={openPrepared}
          onExport={exportComposeNode}
          deleteRequest={webMcpDeleteRequest?.target === "recipe-step" ? null : webMcpDeleteRequest}
          onDeleteRequestShown={acknowledgeDeleteRequest}
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
          deleteRequest={webMcpDeleteRequest?.target === "recipe-step" ? webMcpDeleteRequest : null}
          onDeleteRequestShown={acknowledgeDeleteRequest}
        />
      ) : null}
    </div>
  );
}
