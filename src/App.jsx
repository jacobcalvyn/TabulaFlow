import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  CaretDown,
  CaretLeft,
  CaretRight,
  DownloadSimple,
  FileArrowUp,
  FileCsv,
  FileJs,
  FileXls,
  GlobeSimple,
  MagnifyingGlass,
  MagicWand,
  Rows,
  ShieldCheck,
  UploadSimple,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { formatValue, isSupportedFile } from "./data.js";
import { useDataWorker } from "./useDataWorker.js";
import { StepsPanel, TransformationForm } from "./StepsPanel.jsx";
import { useRecipeHistory } from "./useRecipeHistory.js";
import { loadStoredRecipe, recipeStorageKey, saveStoredRecipe } from "./recipeStorage.js";
import { useI18n } from "./i18n.jsx";
import { createStep, CREATABLE_TRANSFORMATION_TYPES, summarizeStep } from "./transformations.js";

const ACCEPTED_FILES = ".xlsx,.xls,.csv,.json,.jsonl,.ndjson";
const PREVIEW_ROW_HEIGHT = 36;
const PREVIEW_OVERSCAN = 4;
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

function Sidebar({ screen, collapsed, hasDataset, onNavigate, onCollapse }) {
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
        <button type="button" className={`step ${screen === "data" ? "step--active" : ""}`} onClick={() => onNavigate("data")} disabled={!hasDataset} aria-current={screen === "data" ? "page" : undefined} title={t("profileData")}>
          <span className="step-dot"><Rows weight="bold" /></span>
          {!collapsed && <span>{t("profile")}</span>}
        </button>
      </nav>

      {screen === "data" && hasDataset && <div id="sidebar-steps" className="sidebar-steps-host" />}

      <div className="sidebar-bottom-grid">
        <button
          className="language-selector"
          type="button"
          onClick={() => setLanguage(language === "en" ? "id" : "en")}
          aria-label={t("switchLanguage", { language: language === "en" ? t("indonesian") : t("english") })}
          title={t("switchLanguage", { language: language === "en" ? t("indonesian") : t("english") })}
        >
          <GlobeSimple weight="bold" />
          <span>{language === "en" ? t("english") : t("indonesian")}</span>
        </button>
        <div id="sidebar-data-actions" className="sidebar-data-actions" />
      </div>

      <button className="collapse-button" type="button" onClick={onCollapse} aria-label={collapsed ? t("showSidebar") : t("hideSidebar")}>
        <CaretLeft weight="bold" className={collapsed ? "collapse-icon--reversed" : ""} />
        {!collapsed && <span>{t("hideSidebar")}</span>}
      </button>
    </aside>
  );
}

function InputScreen({ file, loading, error, onFile, onDemo, workerReady, openedSources }) {
  const { formatNumber, t } = useI18n();
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);

  const chooseFile = () => inputRef.current?.click();
  const handleDrop = (event) => {
    event.preventDefault();
    setDragging(false);
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
          onChange={(event) => event.target.files?.[0] && onFile(event.target.files[0])}
        />
        <span className="upload-symbol"><UploadSimple weight="duotone" /></span>
        <h2>{t("dragFile")}</h2>
        <p>{t("chooseFromDevice")}</p>
        <button className="button button--secondary" type="button" onClick={chooseFile} disabled={!workerReady}>{t("chooseFile")}</button>
        <FileTypeIcons />
        <p className="format-copy">Excel · CSV · JSON · JSONL · NDJSON</p>
      </section>

      {file && (
        <section className="selected-file" aria-live="polite">
          <span className="selected-file__icon"><FileArrowUp weight="duotone" /></span>
          <div>
            <strong>{file.name}</strong>
            <span>{formatNumber(file.size)} byte</span>
          </div>
          <span className={`file-state ${error ? "file-state--error" : ""}`}>{loading ? t("preparing") : error ? t("failed") : t("ready")}</span>
        </section>
      )}

      {error && <p className="error-message" role="alert">{error}</p>}

      <div className="input-actions">
        <button className="button button--ghost" type="button" onClick={onDemo} disabled={!workerReady || loading}>{t("useDemo")}</button>
      </div>

      <section className="opened-sources" aria-labelledby="opened-sources-title">
        <header>
          <div>
            <h2 id="opened-sources-title">{t("openedFiles")}</h2>
            <p>{t("openedFilesDescription")}</p>
          </div>
          <span>{formatNumber(openedSources.length)}</span>
        </header>
        {openedSources.length > 0 ? (
          <ul>
            {openedSources.map((source) => (
              <li key={source.key} className={source.active ? "opened-source--active" : ""}>
                <span className="opened-source__icon"><FileArrowUp weight="duotone" /></span>
                <div>
                  <strong title={source.name}>{source.name}</strong>
                  <span>
                    {source.kind === "demo" ? t("builtInSample") : t("localDevice")}
                    {source.size !== null && source.size !== undefined ? ` · ${formatNumber(source.size)} byte` : ""}
                  </span>
                </div>
                {source.active && <span className="opened-source__status">{t("activeFile")}</span>}
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

function FrequencyTable({ aggregate, selectedKey, onSelect, onSearch, onTransform, onRename, onChangeType, onReplaceValue, transformOpen, transformUsed, filterSignature }) {
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
  const rowClickTimerRef = useRef(null);
  const renameInputRef = useRef(null);
  const cancelRenameRef = useRef(false);
  const typeButtonRef = useRef(null);
  const typeMenuRef = useRef(null);
  const typeOptionRefs = useRef(new Map());
  const valueInputRef = useRef(null);
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
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick, true);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeOnResize);
    };
  }, [typeEditing]);

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
    <article className="frequency-card" data-column={column}>
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
      <div className={`frequency-card__scroll ${searching ? "frequency-card__scroll--loading" : ""}`}>
        <table>
          <thead><tr><th>{t("value")}</th><th>{t("count")}</th></tr></thead>
          <tbody>
            {sortedDisplayValues.map((item) => (
              <tr
                key={item.key}
                className={selectedKey === item.key ? "frequency-row-item--selected" : ""}
                tabIndex={0}
                aria-selected={selectedKey === item.key}
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
                  if (event.key === "Enter" || event.key === " ") {
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
    </>
  );
}

function VirtualPreview({ rows, columns, datasetId, locale }) {
  const { t } = useI18n();
  const scrollRef = useRef(null);
  const [viewportHeight, setViewportHeight] = useState(320);
  const [scrollTop, setScrollTop] = useState(0);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return undefined;
    const observer = new ResizeObserver((entries) => setViewportHeight(entries[0].contentRect.height));
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

  return (
    <div className="data-grid-wrap" ref={scrollRef} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)} data-virtualized="true">
      <table className="data-grid">
        <thead>
          <tr>
            <th className="row-number" aria-label={t("rowNumber")} />
            {columns.map((column) => <th key={column} title={column}>{column}</th>)}
          </tr>
        </thead>
        <tbody>
          {topSpace > 0 && <tr className="virtual-spacer"><td colSpan={columns.length + 1} style={{ height: topSpace }} /></tr>}
          {visibleRows.map((row, index) => {
            const rowIndex = start + index;
            const displayValue = (value) => value === null || value === undefined || value === "" ? t("emptyValue") : formatValue(value, locale);
            return (
              <tr key={rowIndex} data-preview-row={rowIndex}>
                <td className="row-number">{rowIndex + 1}</td>
                {columns.map((column) => <td key={column} title={displayValue(row[column])}>{displayValue(row[column])}</td>)}
              </tr>
            );
          })}
          {bottomSpace > 0 && <tr className="virtual-spacer"><td colSpan={columns.length + 1} style={{ height: bottomSpace }} /></tr>}
          {rows.length === 0 && (
            <tr><td className="empty-preview" colSpan={columns.length + 1}>{t("noMatchingRows")}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function DataScreen({
  dataset,
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
  onExport,
  onRecipeChange,
  onRecipeUndo,
  onRecipeRedo,
  onRecipePreview,
}) {
  const { formatNumber, language, t, toolLabel } = useI18n();
  const valueLocale = language === "id" ? "id-ID" : "en-US";
  const [topHeight, setTopHeight] = useState(430);
  const [updating, setUpdating] = useState(false);
  const [openMenu, setOpenMenu] = useState(null);
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  const [aggregateColumns, setAggregateColumns] = useState(dataset.aggregateColumns);
  const [columnDraft, setColumnDraft] = useState(dataset.aggregateColumns);
  const [columnQuery, setColumnQuery] = useState("");
  const [exporting, setExporting] = useState(false);
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
  const splitRef = useRef(null);
  const toolbarActionsRef = useRef(null);
  const columnPickerRef = useRef(null);
  const transformPopoverRef = useRef(null);
  const [sidebarActionsTarget, setSidebarActionsTarget] = useState(null);
  const [sidebarStepsTarget, setSidebarStepsTarget] = useState(null);
  const activeFilterCount = Object.keys(filters).length;
  const filterSignature = JSON.stringify(filters);

  useEffect(() => {
    setSidebarActionsTarget(document.getElementById("sidebar-data-actions"));
    setSidebarStepsTarget(document.getElementById("sidebar-steps"));
  }, []);

  useEffect(() => {
    setOpenMenu(null);
    setColumnMenuOpen(false);
    setTransformPopover(null);
    setTransformError("");
    setAggregateColumns(dataset.aggregateColumns);
    setColumnDraft(dataset.aggregateColumns);
    setColumnQuery("");
  }, [dataset.datasetId]);

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
    if (!openMenu) return undefined;

    const closeOnOutsideClick = (event) => {
      if (!toolbarActionsRef.current?.contains(event.target)) setOpenMenu(null);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setOpenMenu(null);
    };

    document.addEventListener("pointerdown", closeOnOutsideClick, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [openMenu]);

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
  }, [t]);

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
    setOpenMenu(null);
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

  const exportFiltered = async (format) => {
    setExporting(true);
    setOpenMenu(null);
    setActionError("");
    try {
      await onExport(format, filters);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : t("exportFailed"));
    } finally {
      setExporting(false);
    }
  };

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
          <div>
            <strong title={dataset.filename}>{dataset.filename}</strong>
            <span>{formatNumber(dataset.rowCount)} {t("rows")} <i /> {formatNumber(dataset.columns.length)} {t("columns")}</span>
            <span
              className={`file-quality-summary ${hasQualityIssues ? "file-quality-summary--issues" : ""}`}
              aria-label={qualityLabel}
              title={hasQualityIssues ? qualityLabel : `${qualityLabel}. ${t("noBasicIssues")}`}
            >
              {hasQualityIssues ? <WarningCircle weight="fill" aria-hidden="true" /> : <ShieldCheck weight="bold" aria-hidden="true" />}
              {formatNumber(dataset.quality.emptyCells)} {t("emptyCells")} · {formatNumber(dataset.quality.mixedColumns)} {t("mixedColumns")}
            </span>
          </div>
        </div>
      </header>

      {sidebarActionsTarget && createPortal(
        <div className="sidebar-action-stack" ref={toolbarActionsRef}>
          <div className="toolbar-menu">
            <button className="button button--export sidebar-action-button" type="button" onClick={() => setOpenMenu((value) => value === "export" ? null : "export")} disabled={exporting} aria-expanded={openMenu === "export"} title={t("export")}>
              <DownloadSimple weight="bold" />
              <span className="sidebar-action-label">{exporting ? t("exporting") : t("export")}</span>
            </button>
            {openMenu === "export" && (
              <div className="export-menu" role="menu">
                <button type="button" onClick={() => exportFiltered("csv")} role="menuitem"><FileCsv weight="duotone" /><span><strong>{t("exportCsv")}</strong><small>{t("currentFilteredData")}</small></span></button>
                <button type="button" onClick={() => exportFiltered("xlsx")} role="menuitem"><FileXls weight="duotone" /><span><strong>{t("exportExcel")}</strong><small>{t("excelReady")}</small></span></button>
              </div>
            )}
          </div>
        </div>,
        sidebarActionsTarget,
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
                {["Clean", "Build"].map((group) => (
                  <section key={group}>
                    <h3>{group === "Clean" ? t("clean") : t("build")}</h3>
                    <div>
                      {CREATABLE_TRANSFORMATION_TYPES.filter((item) => item.group === group).map((item) => (
                        <button key={item.type} type="button" onClick={() => setTransformPopover((current) => current ? { ...current, tool: item.type } : null)}>
                          <span>{toolLabel(item.type)}</span><CaretRight weight="bold" />
                        </button>
                      ))}
                    </div>
                  </section>
                ))}
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
          <div className="frequency-row">
            {dataset.aggregates.map((aggregate) => (
              <FrequencyTable
                key={aggregate.column}
                aggregate={aggregate}
                selectedKey={filters[aggregate.column]?.key}
                onSelect={toggleFilter}
                onSearch={searchAggregate}
                onTransform={startColumnTransformation}
                onRename={renameColumnInline}
                onChangeType={changeColumnTypeInline}
                onReplaceValue={replaceValueInline}
                transformOpen={transformPopover?.column === aggregate.column}
                transformUsed={recipe.some((step) => step.enabled !== false && stepTouchesColumn(step, aggregate.column))}
                filterSignature={filterSignature}
              />
            ))}
          </div>
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
        />, sidebarStepsTarget)}
      {previewingStep && <div className="recipe-preview-loading" role="status">{t("creatingPreview")}</div>}
    </main>
  );
}

function RecipeRestoreDialog({ pending, applying, onIgnore, onApply }) {
  const { t, toolLabel } = useI18n();
  const [inspecting, setInspecting] = useState(false);
  const stepCount = pending.recipe.length;

  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === "Escape" && !applying) onIgnore();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [applying, onIgnore]);

  return createPortal(
    <div className="recipe-restore-backdrop" role="presentation">
      <section className="recipe-restore-dialog" role="dialog" aria-modal="true" aria-labelledby="recipe-restore-title">
        <header>
          <div>
            <span>{t("savedRecipe")}</span>
            <h2 id="recipe-restore-title">{t("applyPreviousSteps")}</h2>
          </div>
          <button type="button" onClick={onIgnore} disabled={applying} aria-label={t("ignoreSavedRecipe")}><X weight="bold" /></button>
        </header>
        <p>{t("savedRecipeFound", { count: stepCount, filename: pending.filename })}</p>
        {inspecting && (
          <ol className="recipe-restore-list">
            {pending.recipe.map((step) => (
              <li key={step.id}>
                <strong>{toolLabel(step.type)}</strong>
                <span>{summarizeStep(step)}</span>
              </li>
            ))}
          </ol>
        )}
        <footer>
          <button type="button" onClick={onIgnore} disabled={applying}>{t("ignore")}</button>
          <button type="button" onClick={() => setInspecting((value) => !value)} disabled={applying}>{inspecting ? t("closeDetails") : t("inspect")}</button>
          <button className="button--primary" type="button" onClick={onApply} disabled={applying}>{applying ? t("applying") : t("applyRecipe")}</button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

export function App() {
  const { t } = useI18n();
  const worker = useDataWorker();
  const recipeHistory = useRecipeHistory();
  const demoLoadedRef = useRef(false);
  const [screen, setScreen] = useState("input");
  const [file, setFile] = useState(null);
  const [dataset, setDataset] = useState(null);
  const [filters, setFilters] = useState({});
  const [openedSources, setOpenedSources] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [activeRecipeKey, setActiveRecipeKey] = useState("");
  const [recipeRecovery, setRecipeRecovery] = useState({ error: "", invalidStepId: null });
  const [pendingRecipeRestore, setPendingRecipeRestore] = useState(null);
  const [restoringRecipe, setRestoringRecipe] = useState(false);

  const activateDataset = async (result, source = null) => {
    setDataset(result);
    setFilters({});
    if (source) {
      setOpenedSources((current) => {
        const nextSource = { ...source, name: result.filename, active: true };
        const previous = current
          .filter((item) => item.key !== source.key)
          .map((item) => ({ ...item, active: false }));
        return [nextSource, ...previous].slice(0, 20);
      });
    }
    recipeHistory.reset([]);
    setRecipeRecovery({ error: "", invalidStepId: null });
    setPendingRecipeRestore(null);
    const storageKey = recipeStorageKey(result);
    setActiveRecipeKey(storageKey);
    try {
      const storedRecipe = await loadStoredRecipe(storageKey);
      if (storedRecipe.length) {
        setPendingRecipeRestore({ recipe: storedRecipe, storageKey, filename: result.filename });
      }
    } catch (cause) {
      setError(cause instanceof Error ? `${t("storedRecipeReadFailed")} ${cause.message}` : t("storedRecipeReadFailed"));
    }
    return result;
  };

  const applyPendingRecipe = async () => {
    if (!pendingRecipeRestore) return;
    const storedRecipe = pendingRecipeRestore.recipe;
    setRestoringRecipe(true);
    setRecipeRecovery({ error: "", invalidStepId: null });
    try {
      const restored = await worker.applyRecipe(storedRecipe, filters, dataset?.aggregateColumns ?? []);
      setDataset(restored);
      setFilters(restored.appliedFilters ?? filters);
      recipeHistory.reset(storedRecipe);
      setRecipeRecovery(restored.recipeError
        ? { error: restored.recipeError.message, invalidStepId: restored.recipeError.stepId ?? null }
        : { error: "", invalidStepId: null });
      setPendingRecipeRestore(null);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : t("storedRecipeApplyFailed");
      setRecipeRecovery({
        error: `${t("storedRecipeApplyFailed")} ${message}`,
        invalidStepId: cause?.stepId ?? (Number.isInteger(cause?.stepIndex) ? storedRecipe[cause.stepIndex]?.id ?? null : null),
      });
    } finally {
      setRestoringRecipe(false);
    }
  };

  useEffect(() => {
    if (!worker.ready || demoLoadedRef.current || new URLSearchParams(window.location.search).get("demo") !== "1") return;
    demoLoadedRef.current = true;
    setLoading(true);
    worker.loadDemo()
      .then(async (result) => { await activateDataset(result, { key: "demo", kind: "demo", size: null }); setScreen("data"); })
      .catch((cause) => setError(cause instanceof Error ? cause.message : t("demoFailed")))
      .finally(() => setLoading(false));
  }, [worker]);

  useEffect(() => {
    if (screen !== "data" || !error) return undefined;
    const timer = window.setTimeout(() => setError(""), 5000);
    return () => window.clearTimeout(timer);
  }, [error, screen]);

  const loadFile = async (nextFile) => {
    setError("");
    if (!isSupportedFile(nextFile.name)) {
      if (!dataset) setDataset(null);
      setError(t("unsupportedFormat"));
      return;
    }

    setLoading(true);
    try {
      const result = await worker.loadFile(nextFile);
      setFile(nextFile);
      await activateDataset(result, {
        key: `local:${nextFile.name}:${nextFile.size}:${nextFile.lastModified}`,
        kind: "local",
        size: nextFile.size,
      });
      setScreen("data");
    } catch (cause) {
      if (!dataset) setDataset(null);
      setError(cause instanceof Error ? cause.message : t("fileReadFailed"));
    } finally {
      setLoading(false);
    }
  };

  const showDemo = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await worker.loadDemo();
      await activateDataset(result, { key: "demo", kind: "demo", size: null });
      setScreen("data");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("demoFailed"));
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

  const exportData = useCallback(async (format, filters) => {
    const result = await worker.exportData(format, filters);
    const blob = new Blob([result.bytes], { type: result.mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = result.filename;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [worker]);

  const persistRecipe = async (recipe) => {
    if (!activeRecipeKey) return;
    try {
      await saveStoredRecipe(activeRecipeKey, recipe);
    } catch {
      setError(t("recipeSaveFailed"));
    }
  };

  const applyRecipeChange = async (recipe) => {
    const result = await worker.applyRecipe(recipe, filters, dataset?.aggregateColumns ?? []);
    const next = recipeHistory.commit(recipe);
    setDataset(result);
    setFilters(result.appliedFilters ?? filters);
    void persistRecipe(next);
    return result;
  };

  const undoRecipe = async () => {
    const next = recipeHistory.undoTarget;
    if (!next) return null;
    const result = await worker.applyRecipe(next, filters, dataset?.aggregateColumns ?? []);
    recipeHistory.undo();
    setDataset(result);
    setFilters(result.appliedFilters ?? filters);
    void persistRecipe(next);
    return result;
  };

  const redoRecipe = async () => {
    const next = recipeHistory.redoTarget;
    if (!next) return null;
    const result = await worker.applyRecipe(next, filters, dataset?.aggregateColumns ?? []);
    recipeHistory.redo();
    setDataset(result);
    setFilters(result.appliedFilters ?? filters);
    void persistRecipe(next);
    return result;
  };

  const previewRecipe = (recipe, stepIndex) => worker.previewRecipe(recipe, stepIndex);

  return (
    <div className={`app-shell ${collapsed ? "app-shell--collapsed" : ""}`}>
      <Sidebar screen={screen} collapsed={collapsed} hasDataset={Boolean(dataset)} onNavigate={(nextScreen) => {
        if (nextScreen === "input" || dataset) setScreen(nextScreen);
      }} onCollapse={() => setCollapsed((value) => !value)} />
      {screen === "input" ? (
        <InputScreen
          file={file}
          loading={loading}
          error={error}
          onFile={loadFile}
          onDemo={showDemo}
          workerReady={worker.ready}
          openedSources={openedSources}
        />
      ) : dataset ? (
        <DataScreen
          dataset={dataset}
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
          onExport={exportData}
          onRecipeChange={applyRecipeChange}
          onRecipeUndo={undoRecipe}
          onRecipeRedo={redoRecipe}
          onRecipePreview={previewRecipe}
        />
      ) : null}
      {pendingRecipeRestore && (
        <RecipeRestoreDialog
          pending={pendingRecipeRestore}
          applying={restoringRecipe}
          onIgnore={() => setPendingRecipeRestore(null)}
          onApply={applyPendingRecipe}
        />
      )}
    </div>
  );
}
