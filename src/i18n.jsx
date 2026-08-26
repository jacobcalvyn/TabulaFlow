import { createContext, useContext, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "tabulaflow-language";

const messages = {
  en: {
    source: "Source", profile: "Profile", sourceData: "Data source", profileData: "Data profile",
    dataWorkspace: "Data workspace", showSidebar: "Show sidebar", hideSidebar: "Hide",
    language: "Language", english: "English", indonesian: "Indonesian", switchLanguage: "Switch to {language}",
    supportedFormats: "Supported formats", inputDescription: "Choose a file to prepare. Data is processed locally in your browser.",
    dragFile: "Drop a file here", chooseFromDevice: "or choose a file from your device", chooseFile: "Choose file",
    preparing: "Preparing…", failed: "Failed", ready: "Ready", useDemo: "Use sample data",
    openedFiles: "Opened files", openedFilesDescription: "Files opened in this session", noOpenedFiles: "No files have been opened yet.",
    localDevice: "Local device", builtInSample: "Built-in sample", activeFile: "Active",
    rows: "rows", columns: "columns", rowNumber: "Row number", noMatchingRows: "No rows match these filters.",
    steps: "Steps", dataQuality: "Data quality", qualityShort: "Quality", export: "Export", exporting: "Exporting…", replaceData: "Replace data", replaceShort: "Replace", loading: "Loading…",
    emptyCells: "empty cells", mixedColumns: "mixed-type columns", noBasicIssues: "No basic issues detected.",
    empty: "empty", type: "type", moreQualityColumns: "+{count} more columns have quality notes.",
    qualityLimited: "Quality profiling is limited to {shown} of {total} columns to keep the browser responsive.",
    exportCsv: "Export CSV", currentFilteredData: "Current filtered data", exportExcel: "Export Excel", excelReady: ".xlsx workbook ready to open",
    chooseTool: "Choose tool", column: "Column", closeToolPicker: "Close tool picker", configureColumnTool: "Configure tool for column {column}",
    chooseColumnTool: "Choose a tool for column {column}", clean: "Clean", build: "Build", add: "Add", cancel: "Cancel", apply: "Apply",
    aggregateTitle: "Value frequency by column", columnsShown: "{shown} of {total} columns shown", chooseColumns: "Choose columns",
    aggregateColumnPicker: "Choose aggregate columns", miniTableColumns: "Mini-table columns", maximum: "Maximum {count}",
    searchColumns: "Search columns…", columnSelectionActions: "Column selection actions", selectAll: "Select all", unselectAll: "Unselect all",
    noColumnsFound: "No columns found.", selectedCount: "{count} selected", resizePanels: "Resize panels",
    previewData: "Data preview", previewAfterStep: "Preview after step {count}", firstRows: "first 100 rows",
    temporaryFilters: "Temporary filters", removeFilter: "Remove {column} filter", closePreview: "Close preview", clearAll: "Clear all",
    creatingPreview: "Creating step preview…", value: "Value", count: "Count", noValuesFound: "No values found", searchFailed: "Value search failed.",
    searchValues: "Search values…", clearSearch: "Clear {column} search", emptyValue: "(null)",
    changeSort: "Change sorting for {column}. Current sorting: {sort}", sortCountDesc: "Highest count", sortValueAsc: "Value A–Z", sortValueDesc: "Value Z–A",
    cleanBuildColumn: "Clean and Build column {column}", hasActiveStep: "Has an active step", cleanBuild: "Clean and Build",
    renameHint: "Double-click to rename {column}", newColumnName: "New name for column {column}", changeColumnType: "Change type for {column}. Current type: {type}",
    newColumnType: "New type for column {column}", newValue: "New value for {value} in column {column}",
    textType: "text", integerType: "integer", decimalType: "decimal", booleanType: "boolean", dateType: "date", timestampType: "date & time",
    savedRecipe: "Saved recipe", applyPreviousSteps: "Apply previous steps?", ignoreSavedRecipe: "Ignore saved recipe",
    savedRecipeFound: "Found {count} steps for {filename}. The source data has not been changed.", ignore: "Ignore", inspect: "Inspect",
    closeDetails: "Close details", applyRecipe: "Apply recipe", applying: "Applying…",
    backToTools: "Back to tool picker", closeForm: "Close form", module: "Module", save: "Save",
    firstRow: "First row", lastRow: "Last row", leftAndRight: "Left and right", left: "Left", right: "Right",
    lowercase: "lowercase", uppercase: "UPPERCASE", titlecase: "Title Case", ascending: "Ascending", descending: "Descending", notSelected: "Not selected",
    cleanBuildPanel: "Clean & Build", recordedSteps: "{count} recorded steps", closeSteps: "Close step history", undo: "Undo", redo: "Redo",
    invalid: "Invalid", inactive: "Inactive", valid: "Valid", enableStep: "Enable step", disableStep: "Disable step",
    editStep: "Edit step", previewStep: "Preview after step", deleteStep: "Delete step", noTransforms: "No transformations yet",
    chooseToolHint: "Choose a tool on a mini-table to add a step.", editTrackedStep: "Edit tracked step",
    stepHistory: "Transformation step history", moveStepUp: "Move step up", moveStepDown: "Move step down", lowerStepForm: "Collapse step form", raiseStepForm: "Expand step form",
    fieldColumn: "Column", fieldNewName: "New name", fieldTargetType: "Target type", fieldMode: "Mode", fieldOldValue: "Old value",
    fieldNewValue: "New value", fieldFillValue: "Fill value", fieldKeyColumns: "Key columns (comma-separated)", fieldKeep: "Keep",
    fieldFormat: "Format", fieldDateFormat: "Date format", fieldColumns: "Columns (comma-separated)", fieldDirection: "Direction",
    fieldLeftColumn: "Left column", fieldOperator: "Operator", fieldRightColumn: "Right column (optional)", fieldNumber: "Or number",
    fieldOutputName: "Output column name", fieldCondition: "Condition", fieldComparison: "Comparison value", fieldThen: "If true",
    fieldElse: "If false", fieldGroupColumns: "Group columns (comma-separated)", fieldValueColumn: "Value column", fieldFunction: "Function", fieldResultName: "Result name",
    renameFailed: "Column could not be renamed.", typeFailed: "Column type could not be changed.", valueFailed: "Value could not be changed.",
    filterFailed: "Filters could not be applied.", filtersRemoved: "{count} temporary filters were removed because their columns are no longer available.",
    invalidFiltersRemoved: "Temporary filters were removed because they are no longer valid after the transformation.", aggregateColumnsFailed: "Aggregate columns could not be updated.",
    stepFailed: "Step could not be applied.", columnNameRequired: "Column name is required.", columnExists: "Column \"{column}\" already exists.",
    fillRequired: "Fill value is required.", fillFailed: "Empty values could not be filled.", exportFailed: "Export failed.", recipeFailed: "Recipe could not be applied.",
    recipeHistoryFailed: "Recipe history could not be applied.", previewFailed: "Step preview could not be created.", storedRecipeReadFailed: "Saved recipe could not be read.",
    storedRecipeApplyFailed: "Saved recipe could not be applied.", demoFailed: "Sample data could not be loaded.", unsupportedFormat: "Unsupported format. Choose Excel, CSV, JSON, JSONL, or NDJSON.",
    fileReadFailed: "The file could not be read.", recipeSaveFailed: "The recipe was applied but could not be saved in the browser.",
  },
  id: {
    source: "Sumber", profile: "Profil", sourceData: "Sumber data", profileData: "Profil data",
    dataWorkspace: "Area kerja data", showSidebar: "Tampilkan sidebar", hideSidebar: "Sembunyikan",
    language: "Bahasa", english: "Inggris", indonesian: "Indonesia", switchLanguage: "Ubah ke {language}",
    supportedFormats: "Format yang didukung", inputDescription: "Pilih file yang ingin disiapkan. Data diproses secara lokal di browser Anda.",
    dragFile: "Tarik file ke sini", chooseFromDevice: "atau pilih file dari perangkat Anda", chooseFile: "Pilih file",
    preparing: "Menyiapkan…", failed: "Gagal", ready: "Siap", useDemo: "Pakai data contoh",
    openedFiles: "File yang dibuka", openedFilesDescription: "File yang telah dibuka pada sesi ini", noOpenedFiles: "Belum ada file yang dibuka.",
    localDevice: "Perangkat lokal", builtInSample: "Data contoh bawaan", activeFile: "Aktif",
    rows: "baris", columns: "kolom", rowNumber: "Nomor baris", noMatchingRows: "Tidak ada baris yang cocok dengan filter ini.",
    steps: "Langkah", dataQuality: "Kualitas data", qualityShort: "Kualitas", export: "Ekspor", exporting: "Mengekspor…", replaceData: "Ganti data", replaceShort: "Ganti", loading: "Memuat…",
    emptyCells: "sel kosong", mixedColumns: "kolom tipe campuran", noBasicIssues: "Tidak ada masalah dasar yang terdeteksi.",
    empty: "kosong", type: "tipe", moreQualityColumns: "+{count} kolom lain memiliki catatan kualitas.",
    qualityLimited: "Profil kualitas dibatasi {shown} dari {total} kolom agar browser tetap responsif.",
    exportCsv: "Ekspor CSV", currentFilteredData: "Data hasil saringan saat ini", exportExcel: "Ekspor Excel", excelReady: "Buku kerja .xlsx siap dibuka",
    chooseTool: "Pilih alat", column: "Kolom", closeToolPicker: "Tutup pilihan alat", configureColumnTool: "Konfigurasi alat kolom {column}",
    chooseColumnTool: "Pilih alat kolom {column}", clean: "Bersihkan", build: "Bentuk", add: "Tambah", cancel: "Batal", apply: "Terapkan",
    aggregateTitle: "Agregat nilai per kolom", columnsShown: "{shown} dari {total} kolom ditampilkan", chooseColumns: "Pilih kolom",
    aggregateColumnPicker: "Pilih kolom agregat", miniTableColumns: "Kolom mini-table", maximum: "Maksimal {count}",
    searchColumns: "Cari kolom…", columnSelectionActions: "Aksi pilihan kolom", selectAll: "Pilih semua", unselectAll: "Batalkan semua",
    noColumnsFound: "Kolom tidak ditemukan.", selectedCount: "{count} dipilih", resizePanels: "Ubah tinggi panel",
    previewData: "Pratinjau data", previewAfterStep: "Pratinjau setelah langkah {count}", firstRows: "100 baris pertama",
    temporaryFilters: "Saringan sementara", removeFilter: "Hapus saringan {column}", closePreview: "Tutup pratinjau", clearAll: "Hapus semua",
    creatingPreview: "Membuat pratinjau langkah…", value: "Nilai", count: "Jumlah", noValuesFound: "Nilai tidak ditemukan", searchFailed: "Pencarian nilai gagal.",
    searchValues: "Cari nilai…", clearSearch: "Hapus pencarian {column}", emptyValue: "(kosong)",
    changeSort: "Ubah urutan kolom {column}. Urutan saat ini {sort}", sortCountDesc: "Jumlah terbanyak", sortValueAsc: "Nilai A–Z", sortValueDesc: "Nilai Z–A",
    cleanBuildColumn: "Bersihkan dan Bentuk kolom {column}", hasActiveStep: "Memiliki langkah aktif", cleanBuild: "Bersihkan dan Bentuk",
    renameHint: "Double-click untuk mengganti nama {column}", newColumnName: "Nama baru untuk kolom {column}", changeColumnType: "Ubah tipe kolom {column}. Tipe saat ini {type}",
    newColumnType: "Tipe baru untuk kolom {column}", newValue: "Nilai baru untuk {value} pada kolom {column}",
    textType: "teks", integerType: "angka bulat", decimalType: "desimal", booleanType: "boolean", dateType: "tanggal", timestampType: "tanggal & waktu",
    savedRecipe: "Recipe tersimpan", applyPreviousSteps: "Terapkan langkah sebelumnya?", ignoreSavedRecipe: "Abaikan recipe tersimpan",
    savedRecipeFound: "Ditemukan {count} langkah untuk {filename}. Data sumber belum diubah.", ignore: "Abaikan", inspect: "Periksa",
    closeDetails: "Tutup rincian", applyRecipe: "Terapkan recipe", applying: "Menerapkan…",
    backToTools: "Kembali ke pilihan alat", closeForm: "Tutup form", module: "Modul", save: "Simpan",
    firstRow: "Baris pertama", lastRow: "Baris terakhir", leftAndRight: "Kiri dan kanan", left: "Kiri", right: "Kanan",
    lowercase: "lowercase", uppercase: "UPPERCASE", titlecase: "Kapital Awal Kata", ascending: "Ascending", descending: "Descending", notSelected: "Tidak dipilih",
    cleanBuildPanel: "Bersihkan & Bentuk", recordedSteps: "{count} langkah tercatat", closeSteps: "Tutup riwayat langkah", undo: "Undo", redo: "Redo",
    invalid: "Tidak valid", inactive: "Nonaktif", valid: "Valid", enableStep: "Aktifkan langkah", disableStep: "Nonaktifkan langkah",
    editStep: "Edit langkah", previewStep: "Pratinjau setelah langkah", deleteStep: "Hapus langkah", noTransforms: "Belum ada transformasi",
    chooseToolHint: "Pilih alat pada tabel mini untuk menambahkan langkah.", editTrackedStep: "Edit langkah tercatat",
    stepHistory: "Riwayat langkah transformasi", moveStepUp: "Pindahkan langkah ke atas", moveStepDown: "Pindahkan langkah ke bawah", lowerStepForm: "Turunkan formulir langkah", raiseStepForm: "Naikkan formulir langkah",
    fieldColumn: "Kolom", fieldNewName: "Nama baru", fieldTargetType: "Tipe tujuan", fieldMode: "Mode", fieldOldValue: "Nilai lama",
    fieldNewValue: "Nilai baru", fieldFillValue: "Nilai pengisi", fieldKeyColumns: "Kolom key (pisahkan koma)", fieldKeep: "Pertahankan",
    fieldFormat: "Format", fieldDateFormat: "Format tanggal", fieldColumns: "Kolom (pisahkan koma)", fieldDirection: "Arah",
    fieldLeftColumn: "Kolom kiri", fieldOperator: "Operator", fieldRightColumn: "Kolom kanan (opsional)", fieldNumber: "Atau angka",
    fieldOutputName: "Nama kolom hasil", fieldCondition: "Kondisi", fieldComparison: "Pembanding", fieldThen: "Jika benar",
    fieldElse: "Jika salah", fieldGroupColumns: "Kolom grup (pisahkan koma)", fieldValueColumn: "Kolom nilai", fieldFunction: "Fungsi", fieldResultName: "Nama hasil",
    renameFailed: "Nama kolom gagal diubah.", typeFailed: "Tipe kolom gagal diubah.", valueFailed: "Nilai gagal diubah.",
    filterFailed: "Filter gagal diterapkan.", filtersRemoved: "{count} saringan sementara dihapus karena kolomnya tidak lagi tersedia.",
    invalidFiltersRemoved: "Saringan sementara dihapus karena tidak lagi valid setelah transformasi.", aggregateColumnsFailed: "Kolom agregat gagal diperbarui.",
    stepFailed: "Langkah gagal diterapkan.", columnNameRequired: "Nama kolom wajib diisi.", columnExists: "Kolom \"{column}\" sudah ada.",
    fillRequired: "Nilai pengisi wajib diisi.", fillFailed: "Nilai kosong gagal diisi.", exportFailed: "Ekspor gagal.", recipeFailed: "Recipe gagal diterapkan.",
    recipeHistoryFailed: "Riwayat recipe gagal diterapkan.", previewFailed: "Pratinjau langkah gagal dibuat.", storedRecipeReadFailed: "Recipe tersimpan tidak dapat dibaca.",
    storedRecipeApplyFailed: "Recipe tersimpan tidak dapat diterapkan.", demoFailed: "Data contoh gagal dimuat.", unsupportedFormat: "Format belum didukung. Pilih Excel, CSV, JSON, JSONL, atau NDJSON.",
    fileReadFailed: "File tidak dapat dibaca.", recipeSaveFailed: "Recipe diterapkan, tetapi gagal disimpan di browser.",
  },
};

const toolMessages = {
  en: {
    "rename-column": "Rename column", "change-type": "Change type", trim: "Trim whitespace", "replace-value": "Replace value",
    "fill-empty": "Fill empty", "remove-empty-rows": "Remove empty rows", "remove-duplicates": "Remove duplicates",
    "standardize-case": "Normalize case", "parse-date": "Parse date", "select-columns": "Select columns", "remove-columns": "Remove columns",
    sort: "Sort rows", "calculated-column": "Calculated column", "conditional-column": "Conditional column", "group-aggregate": "Group & aggregate",
  },
  id: Object.fromEntries([
    ["rename-column", "Ganti nama kolom"], ["change-type", "Ubah tipe"], ["trim", "Rapikan spasi"], ["replace-value", "Ganti nilai"],
    ["fill-empty", "Isi nilai kosong"], ["remove-empty-rows", "Hapus baris kosong"], ["remove-duplicates", "Hapus duplikat"],
    ["standardize-case", "Seragamkan huruf"], ["parse-date", "Baca tanggal"], ["select-columns", "Pilih kolom"], ["remove-columns", "Hapus kolom"],
    ["sort", "Urutkan baris"], ["calculated-column", "Kolom perhitungan"], ["conditional-column", "Kolom bersyarat"], ["group-aggregate", "Kelompokkan & agregasi"],
  ]),
};

function interpolate(message, values = {}) {
  return String(message).replace(/\{(\w+)\}/g, (_, key) => values[key] ?? `{${key}}`);
}

const LanguageContext = createContext(null);

function readStoredLanguage() {
  try {
    return localStorage.getItem(STORAGE_KEY) === "id" ? "id" : "en";
  } catch {
    return "en";
  }
}

export function LanguageProvider({ children }) {
  const [language, setLanguageState] = useState(readStoredLanguage);
  const setLanguage = (nextLanguage) => {
    const normalized = nextLanguage === "id" ? "id" : "en";
    try {
      localStorage.setItem(STORAGE_KEY, normalized);
    } catch {
      // Language switching still works when browser storage is unavailable.
    }
    setLanguageState(normalized);
  };
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  const value = useMemo(() => ({
    language,
    setLanguage,
    t: (key, values) => interpolate(messages[language][key] ?? messages.en[key] ?? key, values),
    toolLabel: (type) => toolMessages[language][type] ?? toolMessages.en[type] ?? type,
    formatNumber: (value) => new Intl.NumberFormat(language === "id" ? "id-ID" : "en-US").format(value),
  }), [language]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useI18n() {
  const value = useContext(LanguageContext);
  if (!value) throw new Error("useI18n must be used inside LanguageProvider.");
  return value;
}
