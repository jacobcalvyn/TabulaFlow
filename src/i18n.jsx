import { createContext, useContext, useEffect, useMemo, useState } from "react";

const STORAGE_KEY = "tabulaflow-language";

const messages = {
  en: {
    source: "Source", profile: "Prepare", compose: "Compose", analyze: "Analyze", sourceData: "Data source", profileData: "Prepare data", composeData: "Compose datasets", analyzeData: "Analyze datasets",
    analyzeDescription: "Define business meaning, validate data, and run reusable analysis.", analyzeSections: "Analyze sections", qualityValidation: "Quality & Validation", semanticModel: "Semantic model", analysis: "Analysis", semanticModelDescription: "Define business roles, units, sensitivity, and valid aggregations for each field.", revisionNumber: "Revision {revision}", technicalField: "Technical field", businessName: "Business name", role: "Role", unit: "Unit", sensitivity: "Sensitivity", allowedAggregations: "Allowed aggregations", businessNameFor: "Business name for {field}", unitFor: "Unit for {field}", allowedAggregationsFor: "Allowed aggregations for {field}", saveSemanticField: "Save semantic definition for {field}", qualityGate: "Quality gate", qualityGateDescription: "Critical findings must be resolved or explicitly accepted before analysis is ready.", "gate_not-evaluated": "Not evaluated", "gate_issues-found": "Blocked by critical findings", "gate_ready-with-exceptions": "Ready with accepted exceptions", "gate_analysis-ready": "Analysis ready", runValidation: "Run validation", newValidationRule: "New validation rule", ruleName: "Rule name", severity: "Severity", compareWith: "Compare with", literalValue: "Literal value", anotherField: "Another field", rightField: "Right field", recommendation: "Recommendation", addRule: "Add rule", validationRules: "Validation rules", validationRulesDescription: "Business and cross-field checks saved with this flow.", noValidationRules: "No validation rules yet.", impactedRecords: "{count} records affected ({percentage}%)", notEvaluated: "Not evaluated", deleteRule: "Delete rule {name}", newAnalysis: "New analysis", analysisName: "Analysis name", analysisNamePlaceholder: "Failure rate by service", allRows: "All rows", minimumSampleSize: "Minimum sample size", runAnalysis: "Run analysis", analysisResult: "Analysis result", analysisResultDescription: "Run an analysis to see its structured result.", noAnalysisResult: "No analysis result yet.", saved: "saved",
    dataWorkspace: "Data workspace", showSidebar: "Show sidebar", hideSidebar: "Hide",
    language: "Language", english: "English", indonesian: "Indonesian", switchLanguage: "Switch to {language}",
    account: "Account", accountDescription: "Use TabulaFlow locally, or sign in to access cloud files from another device.", cloudOptionalTitle: "Cloud access is optional", cloudOptionalDescription: "Sign in only when you want to store supported files in your TabulaFlow cloud space and open them from another device.", signInChatGPT: "Sign in with ChatGPT", localWithoutLogin: "Source, Prepare, Compose, Analyze, and local export remain available without an account.", profileAccount: "Profile", readOnlyAccount: "Account details are read-only.", signOut: "Sign out", name: "Name", email: "Email", cloudStorage: "TabulaFlow storage", cloudStorageDescription: "Storage used by files uploaded explicitly to this app.", storageUsage: "Cloud storage usage", cloudFileCount: "{count} files stored", cloudFiles: "Cloud files", cloudFilesDescription: "Files are private to this ChatGPT account.", uploadToCloud: "Upload file", noCloudFiles: "No cloud files yet.", open: "Open", cloudUnavailable: "Cloud access is unavailable.", cloudUploadFailed: "The file could not be uploaded.", cloudOpenFailed: "The cloud file could not be opened.", aiAccess: "AI access", aiAccessDescription: "Let compatible AI agents work with this open TabulaFlow page through WebMCP.", aiAvailable: "Available", aiUnavailable: "Not supported", aiCapabilityWorkspace: "Read workflow guidance, schema, quality, frequency tables, previews, recipes, Compose, semantic models, and analysis results.", aiCapabilityActions: "Transform Prepare data; validate and arrange Compose; define semantics, run quality gates, and execute reusable analysis.", aiCapabilityControls: "Local file selection, cloud upload selection, and every requested deletion remain under your control.", aiNoLoginRequired: "AI access works without login. ChatGPT sign-in is required only for private cloud files.", aiBrowserUnsupported: "This browser does not expose WebMCP. TabulaFlow remains fully usable manually.",
    activity: "Activity", activityDescription: "Shared history of changes made by you and AI agents in this flow.", activityEventCount: "{count} events", noActivity: "No changes have been recorded yet.", activityPrivacy: "The ledger stores operational metadata, not preview rows or raw cell values.", activityUnavailable: "Activity history could not be saved locally.", activityActorUser: "You", activityActorAgent: "AI", activityActorSystem: "System", activityOverride: "This change superseded a change from the other actor.", activityChanged: "Workspace changed", activitySourceImported: "Source imported", activitySourceRelinked: "Source re-linked", activityFiltersChanged: "Preview filters changed", activityColumnsChanged: "Frequency columns changed", activityRecipeChanged: "Recipe changed", activityRecipeUndone: "Recipe change undone", activityRecipeRedone: "Recipe change redone", activityPreparedDuplicated: "Prepared dataset duplicated", activityResultPromoted: "Compose result promoted", activityOperationCreated: "Compose operation created", activityOperationUpdated: "Compose operation updated", activityNodeMoved: "Compose node moved", activityAutoArranged: "Compose graph auto-arranged", activityPreparedExported: "Prepare result exported", activityComposeExported: "Compose result exported", activityDeleteRequested: "Deletion confirmation requested", activityDeleteCancelled: "Deletion cancelled", activityDeleteConfirmed: "Deletion confirmed", activityPreparedDeleted: "Prepared dataset deleted", activityOperationDeleted: "Compose operation deleted", activitySemanticUpdated: "Semantic field updated", activityValidationRuleCreated: "Validation rule created", activityValidationRuleDeleted: "Validation rule deleted", activityDatasetValidated: "Dataset validated", activityAnalysisRun: "Analysis run",
    supportedFormats: "Supported formats", inputDescription: "Choose a file to prepare. Data is processed locally in your browser.",
    dragFile: "Drop a file here", chooseFromDevice: "or choose a file from your device", chooseFile: "Choose file",
    preparing: "Preparing…", failed: "Failed", ready: "Ready",
    startingEngine: "Starting local data engine", processingSource: "Processing source",
    progress_queued: "Waiting for the worker…", progress_engine_select: "Selecting a compatible DuckDB engine…", progress_engine_worker: "Loading the analytical worker…", progress_engine_wasm: "Loading DuckDB-Wasm…", progress_engine_connect: "Opening the local database…", progress_engine_ready: "Data engine is ready.", progress_engine_check: "Checking the data engine…", progress_read_file: "Reading the selected file…", progress_normalize_data: "Normalizing rows and columns…", progress_register_data: "Registering source data…", progress_create_table: "Creating the local table…", progress_profile_data: "Profiling columns and values…", progress_commit_data: "Committing the prepared source…",
    openedFiles: "Flow sources", openedFilesDescription: "Saved sources in this flow", noOpenedFiles: "No sources have been added yet.", relink: "Re-link", restoringSource: "Restoring…", relinkRequired: "Re-link this source before opening Prepare.", relinkFailed: "The source could not be re-linked.", relinkMismatch: "The selected file does not match the saved source.", flowRestoreFailed: "The saved flow could not be restored.",
    localDevice: "Local device", composeResult: "Compose result",
    rows: "rows", columns: "columns", rowNumber: "Row number", noMatchingRows: "No rows match these filters.",
    steps: "Steps", dataQuality: "Data quality", qualityShort: "Quality", export: "Export", exporting: "Exporting…", replaceData: "Replace data", replaceShort: "Replace", loading: "Loading…",
    emptyCells: "empty cells", mixedColumns: "mixed-type columns", noBasicIssues: "No basic issues detected.",
    empty: "empty", type: "type", moreQualityColumns: "+{count} more columns have quality notes.",
    qualityLimited: "Quality profiling is limited to {shown} of {total} columns to keep the browser responsive.",
    exportCsv: "Export CSV", currentFilteredData: "Current filtered data", exportExcel: "Export Excel", excelReady: ".xlsx workbook ready to open",
    chooseTool: "Choose tool", column: "Column", closeToolPicker: "Close tool picker", configureColumnTool: "Configure tool for column {column}",
    chooseColumnTool: "Choose a tool for column {column}", clean: "Clean", build: "Build", add: "Add", cancel: "Cancel", apply: "Apply", back: "Back",
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
    newColumnType: "New type for column {column}", newValue: "New value for {value} in column {column}", valueActions: "Actions for {value} in {column}", keepValue: "Keep", deleteValue: "Delete",
    textType: "text", integerType: "integer", decimalType: "decimal", booleanType: "boolean", dateType: "date", timestampType: "date & time",
    applying: "Applying…",
    backToTools: "Back to tool picker", closeForm: "Close form", module: "Module", save: "Save",
    firstRow: "First row", lastRow: "Last row", leftAndRight: "Left and right", left: "Left", right: "Right",
    lowercase: "lowercase", uppercase: "UPPERCASE", titlecase: "Title Case", ascending: "Ascending", descending: "Descending", notSelected: "Not selected",
    cleanBuildPanel: "Clean & Build", recordedSteps: "{count} recorded steps", closeSteps: "Close step history", undo: "Undo", redo: "Redo",
    invalid: "Invalid", inactive: "Inactive", valid: "Valid", keepRows: "Keep rows", deleteRows: "Delete rows", valueRowStepSummary: "{column} = {value}", enableStep: "Enable step", disableStep: "Disable step",
    editStep: "Edit step", previewStep: "Preview after step", deleteStep: "Delete step", confirmDeleteStep: "Delete this step?", noTransforms: "No transformations yet",
    chooseToolHint: "Choose a tool on a mini-table to add a step.", editTrackedStep: "Edit tracked step",
    stepHistory: "Transformation step history", moveStepUp: "Move step up", moveStepDown: "Move step down", lowerStepForm: "Collapse step form", raiseStepForm: "Expand step form",
    fieldColumn: "Column", fieldNewName: "New name", fieldTargetType: "Target type", fieldMode: "Mode", fieldOldValue: "Old value",
    fieldNewValue: "New value", fieldFillValue: "Fill value", fieldKeyColumns: "Key columns (comma-separated)", fieldKeep: "Keep",
    fieldFormat: "Format", fieldDateFormat: "Date format", fieldColumns: "Columns (comma-separated)", fieldDirection: "Direction",
    fieldLeftColumn: "Left column", fieldOperator: "Operator", fieldRightColumn: "Right column (optional)", fieldNumber: "Or number",
    fieldOutputName: "Output column name", fieldCondition: "Condition", fieldComparison: "Comparison value", fieldDeleteCondition: "Delete rows where", fieldThen: "If true",
    fieldElse: "If false", fieldGroupColumns: "Group columns (comma-separated)", fieldValueColumn: "Value column", fieldFunction: "Function", fieldResultName: "Result name",
    renameFailed: "Column could not be renamed.", typeFailed: "Column type could not be changed.", valueFailed: "Value could not be changed.", valueActionFailed: "The value action could not be applied.",
    filterFailed: "Filters could not be applied.", filtersRemoved: "{count} temporary filters were removed because their columns are no longer available.",
    invalidFiltersRemoved: "Temporary filters were removed because they are no longer valid after the transformation.", aggregateColumnsFailed: "Aggregate columns could not be updated.",
    stepFailed: "Step could not be applied.", columnNameRequired: "Column name is required.", columnExists: "Column \"{column}\" already exists.",
    fillRequired: "Fill value is required.", comparisonRequired: "Enter a comparison value or choose a condition that does not need one.", fillFailed: "Empty values could not be filled.", exportFailed: "Export failed.", recipeFailed: "Recipe could not be applied.",
    recipeHistoryFailed: "Recipe history could not be applied.", previewFailed: "Step preview could not be created.", unsupportedFormat: "Unsupported format. Choose Excel, CSV, JSON, JSONL, or NDJSON.",
    fileReadFailed: "The file could not be read.",
    editPreparation: "Edit preparation", duplicate: "Duplicate", selectPreparedDataset: "Select prepared dataset", preparedDatasets: "Prepared datasets",
    append: "Append", join: "Join", addNode: "Add node", activeNode: "Active node", noComposeNodes: "Add an Append or Join node to combine prepared inputs.",
    dataset: "Dataset", composeCanvasHint: "Connect two datasets to add a Join or Append operation.", chooseSecondDataset: "Choose the second dataset.", fitGraph: "Fit graph",
    cancelConnection: "Cancel connection", canvasZoom: "Canvas zoom", zoomIn: "Zoom in", zoomOut: "Zoom out", autoArrange: "Auto arrange", connectDataset: "Connect {dataset}", continueFromDataset: "Continue from {dataset}", chooseOperation: "Choose operation",
    joinHint: "Match rows using keys", appendHint: "Stack rows from both datasets", differenceHint: "Keep rows found on only one side", aggregateHint: "Group rows and calculate measures", filterRowsHint: "Keep rows matching a condition", distinctRowsHint: "Keep one row per unique key", pivotHint: "Turn values into columns", unpivotHint: "Turn columns into rows", operationSettings: "Operation settings", joinSettings: "Join settings", appendSettings: "Append settings",
    aggregate: "Aggregate", filterRows: "Filter rows", distinctRows: "Distinct rows", difference: "Difference", pivot: "Pivot", unpivot: "Unpivot", addOperation: "Add operation", chooseUnaryOperation: "Choose the next operation",
    differenceConfiguration: "Difference configuration", aggregateConfiguration: "Aggregate configuration", filterConfiguration: "Filter configuration", distinctConfiguration: "Distinct configuration", pivotConfiguration: "Pivot configuration", unpivotConfiguration: "Unpivot configuration", configuration: "Configuration", differenceMode: "Difference side", createDifference: "Create Difference", createOperation: "Create operation", none: "None",
    leftOnly: "Left only", rightOnly: "Right only", leftOnlyDescription: "Rows missing from the right", rightOnlyDescription: "Rows missing from the left", groupBy: "Group by", measure: "Measure", aggregateFunction: "Calculation", alias: "Output name", comparisonColumns: "Comparison columns", filterColumn: "Column", filterOperator: "Condition", filterValue: "Value", filterValueRequired: "Enter a comparison value.", pivotColumn: "Pivot column", pivotValues: "Values (comma-separated)", unpivotColumns: "Columns to unpivot", fieldColumnName: "Field column name", valueColumnName: "Value column name",
    equals: "Equals", notEquals: "Does not equal", contains: "Contains", notContains: "Does not contain", greaterThan: "Greater than", greaterOrEqual: "Greater than or equal", lessThan: "Less than", lessOrEqual: "Less than or equal", isNull: "Is null", isNotNull: "Is not null", isEmpty: "Is empty", isNotEmpty: "Is not empty",
    settings: "Settings", connectionTargetHint: "Now click the whole card for the second input.", createPreparedDataset: "Create dataset", createPreparedDatasetHint: "Open this result as an independent dataset in Prepare", duplicatePreparedDatasetHint: "Create an independent copy of this Prepare dataset", deletePreparedDataset: "Delete prepared dataset", confirmDeletePreparedDataset: "Delete this dataset?", deleteOperation: "Delete operation", confirmDeleteOperation: "Delete this operation?", keepOperation: "Keep", delete: "Delete", deleteDownstreamFirst: "Delete downstream operations first.",
    joinConfiguration: "Join configuration", appendConfiguration: "Append configuration", savedOperation: "Saved", draftOperation: "Draft operation", matchingKeys: "Matching keys",
    innerJoinDescription: "Matching rows", leftJoinDescription: "All from left", rightJoinDescription: "All from right", fullJoinDescription: "All from both", inner: "Inner",
    compatible: "Compatible", incompatible: "Incompatible", sameDataType: "Same data type", differentDataType: "Different data types",
    columnsSelected: "columns selected", selectAllShort: "All", selectNone: "None", collisionExplanation: "Choose how duplicate output column names are handled.",
    validatingAutomatically: "Validating automatically…", configurationValid: "Configuration is valid", createJoin: "Create Join", createAppend: "Create Append",
    connectedDatasets: "Connected datasets", noPreparedDatasets: "No prepared datasets", addSourceFirst: "Open and prepare a source before composing.",
    selectNodePreview: "Select a dataset or operation to preview its result.", showPreview: "Show preview", hidePreview: "Hide preview", composeUpdateFailed: "The Compose operation could not be updated.",
    leftInput: "Left input", rightInput: "Right input", joinType: "Join type", leftKey: "Left key", rightKey: "Right key",
    collisionPolicy: "Duplicate column names", failOnCollision: "Stop the Join", suffixCollisions: "Add left/right suffixes", manualMapping: "Rename manually",
    outputColumns: "Output columns", previewSchema: "Preview schema", createNode: "Create node", unsavedChanges: "Unsaved changes", flowSaveFailed: "Changes could not be saved. They may be lost after refresh.", retrySave: "Retry save", saving: "Saving…",
    validate: "Validate", estimatedRows: "estimated rows", chooseDifferentInputs: "Choose two different inputs.",
    activityOverrideNotice: "Your change superseded a recent AI change and was recorded in Activity.",
    composePreviewFailed: "The selected node could not be previewed.", composeCreateFailed: "The Compose node could not be created.", duplicateFailed: "The preparation could not be duplicated.", createPreparedFailed: "The Compose result could not be turned into a prepared dataset.", deletePreparedFailed: "The prepared dataset could not be deleted.",
  },
  id: {
    source: "Sumber", profile: "Siapkan", compose: "Gabungkan", analyze: "Analisis", sourceData: "Sumber data", profileData: "Siapkan data", composeData: "Gabungkan dataset", analyzeData: "Analisis dataset",
    analyzeDescription: "Definisikan makna bisnis, validasi data, dan jalankan analisis yang dapat digunakan ulang.", analyzeSections: "Bagian Analisis", qualityValidation: "Kualitas & Validasi", semanticModel: "Model semantik", analysis: "Analisis", semanticModelDescription: "Tentukan peran bisnis, unit, sensitivitas, dan agregasi yang valid untuk setiap field.", revisionNumber: "Revisi {revision}", technicalField: "Field teknis", businessName: "Nama bisnis", role: "Peran", unit: "Unit", sensitivity: "Sensitivitas", allowedAggregations: "Agregasi yang diizinkan", businessNameFor: "Nama bisnis untuk {field}", unitFor: "Unit untuk {field}", allowedAggregationsFor: "Agregasi yang diizinkan untuk {field}", saveSemanticField: "Simpan definisi semantik {field}", qualityGate: "Gerbang kualitas", qualityGateDescription: "Temuan kritis harus diselesaikan atau diterima eksplisit sebelum analisis dinyatakan siap.", "gate_not-evaluated": "Belum dievaluasi", "gate_issues-found": "Terblokir temuan kritis", "gate_ready-with-exceptions": "Siap dengan pengecualian", "gate_analysis-ready": "Siap dianalisis", runValidation: "Jalankan validasi", newValidationRule: "Rule validasi baru", ruleName: "Nama rule", severity: "Severity", compareWith: "Bandingkan dengan", literalValue: "Nilai langsung", anotherField: "Field lain", rightField: "Field kanan", recommendation: "Rekomendasi", addRule: "Tambah rule", validationRules: "Rule validasi", validationRulesDescription: "Pemeriksaan bisnis dan lintas-field yang tersimpan dalam flow ini.", noValidationRules: "Belum ada rule validasi.", impactedRecords: "{count} record terdampak ({percentage}%)", notEvaluated: "Belum dievaluasi", deleteRule: "Hapus rule {name}", newAnalysis: "Analisis baru", analysisName: "Nama analisis", analysisNamePlaceholder: "Failure rate per layanan", allRows: "Semua baris", minimumSampleSize: "Ukuran sampel minimum", runAnalysis: "Jalankan analisis", analysisResult: "Hasil analisis", analysisResultDescription: "Jalankan analisis untuk melihat hasil terstruktur.", noAnalysisResult: "Belum ada hasil analisis.", saved: "tersimpan",
    dataWorkspace: "Area kerja data", showSidebar: "Tampilkan sidebar", hideSidebar: "Sembunyikan",
    language: "Bahasa", english: "Inggris", indonesian: "Indonesia", switchLanguage: "Ubah ke {language}",
    account: "Akun", accountDescription: "Gunakan TabulaFlow secara lokal, atau masuk untuk mengakses file cloud dari perangkat lain.", cloudOptionalTitle: "Akses cloud bersifat opsional", cloudOptionalDescription: "Masuk hanya jika Anda ingin menyimpan file yang didukung di ruang cloud TabulaFlow dan membukanya dari perangkat lain.", signInChatGPT: "Masuk dengan ChatGPT", localWithoutLogin: "Sumber, Siapkan, Gabungkan, Analisis, dan ekspor lokal tetap tersedia tanpa akun.", profileAccount: "Profil", readOnlyAccount: "Informasi akun hanya dapat dibaca.", signOut: "Keluar", name: "Nama", email: "Email", cloudStorage: "Penyimpanan TabulaFlow", cloudStorageDescription: "Penyimpanan yang dipakai oleh file yang Anda unggah langsung ke aplikasi ini.", storageUsage: "Penggunaan penyimpanan cloud", cloudFileCount: "{count} file tersimpan", cloudFiles: "File cloud", cloudFilesDescription: "File bersifat privat untuk akun ChatGPT ini.", uploadToCloud: "Unggah file", noCloudFiles: "Belum ada file cloud.", open: "Buka", cloudUnavailable: "Akses cloud tidak tersedia.", cloudUploadFailed: "File tidak dapat diunggah.", cloudOpenFailed: "File cloud tidak dapat dibuka.", aiAccess: "Akses AI", aiAccessDescription: "Izinkan agen AI yang kompatibel bekerja dengan halaman TabulaFlow ini melalui WebMCP.", aiAvailable: "Tersedia", aiUnavailable: "Tidak didukung", aiCapabilityWorkspace: "Baca panduan alur, schema, kualitas, tabel frekuensi, preview, recipe, Compose, model semantik, dan hasil analisis.", aiCapabilityActions: "Transformasi Prepare; validasi dan rapikan Compose; definisikan semantik, jalankan quality gate, dan analisis reusable.", aiCapabilityControls: "Pemilihan file lokal, pemilihan unggahan cloud, dan setiap permintaan hapus tetap berada dalam kendali Anda.", aiNoLoginRequired: "Akses AI bekerja tanpa login. Masuk dengan ChatGPT hanya diperlukan untuk file cloud privat.", aiBrowserUnsupported: "Browser ini tidak menyediakan WebMCP. TabulaFlow tetap dapat digunakan sepenuhnya secara manual.",
    activity: "Aktivitas", activityDescription: "Riwayat perubahan bersama yang dibuat oleh Anda dan agen AI dalam flow ini.", activityEventCount: "{count} aktivitas", noActivity: "Belum ada perubahan yang dicatat.", activityPrivacy: "Ledger menyimpan metadata operasional, bukan baris preview atau nilai mentah sel.", activityUnavailable: "Riwayat aktivitas tidak dapat disimpan secara lokal.", activityActorUser: "Anda", activityActorAgent: "AI", activityActorSystem: "Sistem", activityOverride: "Perubahan ini menimpa perubahan dari pelaku lainnya.", activityChanged: "Area kerja berubah", activitySourceImported: "Sumber diimpor", activitySourceRelinked: "Sumber dihubungkan ulang", activityFiltersChanged: "Filter preview diubah", activityColumnsChanged: "Kolom frekuensi diubah", activityRecipeChanged: "Recipe diubah", activityRecipeUndone: "Perubahan recipe dibatalkan", activityRecipeRedone: "Perubahan recipe diulangi", activityPreparedDuplicated: "Dataset Prepare diduplikasi", activityResultPromoted: "Hasil Compose dijadikan dataset", activityOperationCreated: "Operasi Compose dibuat", activityOperationUpdated: "Operasi Compose diubah", activityNodeMoved: "Node Compose dipindahkan", activityAutoArranged: "Graph Compose dirapikan otomatis", activityPreparedExported: "Hasil Prepare diekspor", activityComposeExported: "Hasil Compose diekspor", activityDeleteRequested: "Konfirmasi hapus diminta", activityDeleteCancelled: "Penghapusan dibatalkan", activityDeleteConfirmed: "Penghapusan dikonfirmasi", activityPreparedDeleted: "Dataset Prepare dihapus", activityOperationDeleted: "Operasi Compose dihapus", activitySemanticUpdated: "Field semantik diperbarui", activityValidationRuleCreated: "Rule validasi dibuat", activityValidationRuleDeleted: "Rule validasi dihapus", activityDatasetValidated: "Dataset divalidasi", activityAnalysisRun: "Analisis dijalankan",
    supportedFormats: "Format yang didukung", inputDescription: "Pilih file yang ingin disiapkan. Data diproses secara lokal di browser Anda.",
    dragFile: "Tarik file ke sini", chooseFromDevice: "atau pilih file dari perangkat Anda", chooseFile: "Pilih file",
    preparing: "Menyiapkan…", failed: "Gagal", ready: "Siap",
    startingEngine: "Menyalakan engine data lokal", processingSource: "Mengolah sumber data",
    progress_queued: "Menunggu worker…", progress_engine_select: "Memilih engine DuckDB yang kompatibel…", progress_engine_worker: "Memuat analytical worker…", progress_engine_wasm: "Memuat DuckDB-Wasm…", progress_engine_connect: "Membuka database lokal…", progress_engine_ready: "Engine data siap.", progress_engine_check: "Memeriksa engine data…", progress_read_file: "Membaca file yang dipilih…", progress_normalize_data: "Menormalkan baris dan kolom…", progress_register_data: "Mendaftarkan sumber data…", progress_create_table: "Membuat tabel lokal…", progress_profile_data: "Menganalisis kolom dan nilai…", progress_commit_data: "Menyimpan sumber yang telah disiapkan…",
    openedFiles: "Sumber flow", openedFilesDescription: "Sumber tersimpan dalam flow ini", noOpenedFiles: "Belum ada sumber yang ditambahkan.", relink: "Hubungkan ulang", restoringSource: "Memulihkan…", relinkRequired: "Hubungkan ulang sumber ini sebelum membuka Prepare.", relinkFailed: "Sumber tidak dapat dihubungkan ulang.", relinkMismatch: "File yang dipilih tidak cocok dengan sumber tersimpan.", flowRestoreFailed: "Flow tersimpan tidak dapat dipulihkan.",
    localDevice: "Perangkat lokal", composeResult: "Hasil Compose",
    rows: "baris", columns: "kolom", rowNumber: "Nomor baris", noMatchingRows: "Tidak ada baris yang cocok dengan filter ini.",
    steps: "Langkah", dataQuality: "Kualitas data", qualityShort: "Kualitas", export: "Ekspor", exporting: "Mengekspor…", replaceData: "Ganti data", replaceShort: "Ganti", loading: "Memuat…",
    emptyCells: "sel kosong", mixedColumns: "kolom tipe campuran", noBasicIssues: "Tidak ada masalah dasar yang terdeteksi.",
    empty: "kosong", type: "tipe", moreQualityColumns: "+{count} kolom lain memiliki catatan kualitas.",
    qualityLimited: "Profil kualitas dibatasi {shown} dari {total} kolom agar browser tetap responsif.",
    exportCsv: "Ekspor CSV", currentFilteredData: "Data hasil saringan saat ini", exportExcel: "Ekspor Excel", excelReady: "Buku kerja .xlsx siap dibuka",
    chooseTool: "Pilih alat", column: "Kolom", closeToolPicker: "Tutup pilihan alat", configureColumnTool: "Konfigurasi alat kolom {column}",
    chooseColumnTool: "Pilih alat kolom {column}", clean: "Bersihkan", build: "Bentuk", add: "Tambah", cancel: "Batal", apply: "Terapkan", back: "Kembali",
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
    newColumnType: "Tipe baru untuk kolom {column}", newValue: "Nilai baru untuk {value} pada kolom {column}", valueActions: "Aksi untuk {value} pada kolom {column}", keepValue: "Pertahankan", deleteValue: "Hapus",
    textType: "teks", integerType: "angka bulat", decimalType: "desimal", booleanType: "boolean", dateType: "tanggal", timestampType: "tanggal & waktu",
    applying: "Menerapkan…",
    backToTools: "Kembali ke pilihan alat", closeForm: "Tutup form", module: "Modul", save: "Simpan",
    firstRow: "Baris pertama", lastRow: "Baris terakhir", leftAndRight: "Kiri dan kanan", left: "Kiri", right: "Kanan",
    lowercase: "lowercase", uppercase: "UPPERCASE", titlecase: "Kapital Awal Kata", ascending: "Ascending", descending: "Descending", notSelected: "Tidak dipilih",
    cleanBuildPanel: "Bersihkan & Bentuk", recordedSteps: "{count} langkah tercatat", closeSteps: "Tutup riwayat langkah", undo: "Undo", redo: "Redo",
    invalid: "Tidak valid", inactive: "Nonaktif", valid: "Valid", keepRows: "Pertahankan baris", deleteRows: "Hapus baris", valueRowStepSummary: "{column} = {value}", enableStep: "Aktifkan langkah", disableStep: "Nonaktifkan langkah",
    editStep: "Edit langkah", previewStep: "Pratinjau setelah langkah", deleteStep: "Hapus langkah", confirmDeleteStep: "Hapus langkah ini?", noTransforms: "Belum ada transformasi",
    chooseToolHint: "Pilih alat pada tabel mini untuk menambahkan langkah.", editTrackedStep: "Edit langkah tercatat",
    stepHistory: "Riwayat langkah transformasi", moveStepUp: "Pindahkan langkah ke atas", moveStepDown: "Pindahkan langkah ke bawah", lowerStepForm: "Turunkan formulir langkah", raiseStepForm: "Naikkan formulir langkah",
    fieldColumn: "Kolom", fieldNewName: "Nama baru", fieldTargetType: "Tipe tujuan", fieldMode: "Mode", fieldOldValue: "Nilai lama",
    fieldNewValue: "Nilai baru", fieldFillValue: "Nilai pengisi", fieldKeyColumns: "Kolom key (pisahkan koma)", fieldKeep: "Pertahankan",
    fieldFormat: "Format", fieldDateFormat: "Format tanggal", fieldColumns: "Kolom (pisahkan koma)", fieldDirection: "Arah",
    fieldLeftColumn: "Kolom kiri", fieldOperator: "Operator", fieldRightColumn: "Kolom kanan (opsional)", fieldNumber: "Atau angka",
    fieldOutputName: "Nama kolom hasil", fieldCondition: "Kondisi", fieldComparison: "Pembanding", fieldDeleteCondition: "Hapus baris jika", fieldThen: "Jika benar",
    fieldElse: "Jika salah", fieldGroupColumns: "Kolom grup (pisahkan koma)", fieldValueColumn: "Kolom nilai", fieldFunction: "Fungsi", fieldResultName: "Nama hasil",
    renameFailed: "Nama kolom gagal diubah.", typeFailed: "Tipe kolom gagal diubah.", valueFailed: "Nilai gagal diubah.", valueActionFailed: "Aksi nilai gagal diterapkan.",
    filterFailed: "Filter gagal diterapkan.", filtersRemoved: "{count} saringan sementara dihapus karena kolomnya tidak lagi tersedia.",
    invalidFiltersRemoved: "Saringan sementara dihapus karena tidak lagi valid setelah transformasi.", aggregateColumnsFailed: "Kolom agregat gagal diperbarui.",
    stepFailed: "Langkah gagal diterapkan.", columnNameRequired: "Nama kolom wajib diisi.", columnExists: "Kolom \"{column}\" sudah ada.",
    fillRequired: "Nilai pengisi wajib diisi.", comparisonRequired: "Isi nilai pembanding atau pilih kondisi yang tidak memerlukannya.", fillFailed: "Nilai kosong gagal diisi.", exportFailed: "Ekspor gagal.", recipeFailed: "Recipe gagal diterapkan.",
    recipeHistoryFailed: "Riwayat recipe gagal diterapkan.", previewFailed: "Pratinjau langkah gagal dibuat.", unsupportedFormat: "Format belum didukung. Pilih Excel, CSV, JSON, JSONL, atau NDJSON.",
    fileReadFailed: "File tidak dapat dibaca.",
    editPreparation: "Edit preparation", duplicate: "Duplikat", selectPreparedDataset: "Pilih dataset Prepare", preparedDatasets: "Dataset Prepare",
    append: "Append", join: "Join", addNode: "Tambah node", activeNode: "Node aktif", noComposeNodes: "Tambahkan node Append atau Join untuk menggabungkan prepared input.",
    dataset: "Dataset", composeCanvasHint: "Hubungkan dua dataset untuk menambahkan operasi Join atau Append.", chooseSecondDataset: "Pilih dataset kedua.", fitGraph: "Sesuaikan graph",
    cancelConnection: "Batalkan koneksi", canvasZoom: "Zoom kanvas", zoomIn: "Perbesar", zoomOut: "Perkecil", autoArrange: "Rapikan otomatis", connectDataset: "Hubungkan {dataset}", continueFromDataset: "Lanjutkan dari {dataset}", chooseOperation: "Pilih operasi",
    joinHint: "Cocokkan baris berdasarkan key", appendHint: "Tumpuk baris dari kedua dataset", differenceHint: "Pertahankan baris yang hanya ada di satu sisi", aggregateHint: "Kelompokkan baris dan hitung ukuran", filterRowsHint: "Pertahankan baris sesuai kondisi", distinctRowsHint: "Pertahankan satu baris per key unik", pivotHint: "Ubah nilai menjadi kolom", unpivotHint: "Ubah kolom menjadi baris", operationSettings: "Pengaturan operasi", joinSettings: "Pengaturan Join", appendSettings: "Pengaturan Append",
    aggregate: "Agregasi", filterRows: "Saring baris", distinctRows: "Baris unik", difference: "Perbedaan", pivot: "Pivot", unpivot: "Unpivot", addOperation: "Tambah operasi", chooseUnaryOperation: "Pilih operasi berikutnya",
    differenceConfiguration: "Konfigurasi perbedaan", aggregateConfiguration: "Konfigurasi agregasi", filterConfiguration: "Konfigurasi saringan", distinctConfiguration: "Konfigurasi baris unik", pivotConfiguration: "Konfigurasi Pivot", unpivotConfiguration: "Konfigurasi Unpivot", configuration: "Konfigurasi", differenceMode: "Sisi perbedaan", createDifference: "Buat Perbedaan", createOperation: "Buat operasi", none: "Tidak ada",
    leftOnly: "Hanya kiri", rightOnly: "Hanya kanan", leftOnlyDescription: "Baris yang tidak ada di kanan", rightOnlyDescription: "Baris yang tidak ada di kiri", groupBy: "Kelompokkan berdasarkan", measure: "Ukuran", aggregateFunction: "Perhitungan", alias: "Nama output", comparisonColumns: "Kolom pembanding", filterColumn: "Kolom", filterOperator: "Kondisi", filterValue: "Nilai", filterValueRequired: "Isi nilai pembanding.", pivotColumn: "Kolom Pivot", pivotValues: "Nilai (pisahkan koma)", unpivotColumns: "Kolom untuk Unpivot", fieldColumnName: "Nama kolom field", valueColumnName: "Nama kolom nilai",
    equals: "Sama dengan", notEquals: "Tidak sama dengan", contains: "Mengandung", notContains: "Tidak mengandung", greaterThan: "Lebih besar", greaterOrEqual: "Lebih besar atau sama", lessThan: "Lebih kecil", lessOrEqual: "Lebih kecil atau sama", isNull: "Null", isNotNull: "Tidak null", isEmpty: "Kosong", isNotEmpty: "Tidak kosong",
    settings: "Pengaturan", connectionTargetHint: "Sekarang klik seluruh kartu untuk input kedua.", createPreparedDataset: "Buat dataset", createPreparedDatasetHint: "Buka hasil ini sebagai dataset mandiri di Prepare", duplicatePreparedDatasetHint: "Buat salinan mandiri dari dataset Prepare ini", deletePreparedDataset: "Hapus dataset Prepare", confirmDeletePreparedDataset: "Hapus dataset ini?", deleteOperation: "Hapus operasi", confirmDeleteOperation: "Hapus operasi ini?", keepOperation: "Pertahankan", delete: "Hapus", deleteDownstreamFirst: "Hapus operasi turunannya lebih dulu.",
    joinConfiguration: "Konfigurasi Join", appendConfiguration: "Konfigurasi Append", savedOperation: "Tersimpan", draftOperation: "Operasi draft", matchingKeys: "Key pencocokan",
    innerJoinDescription: "Baris yang cocok", leftJoinDescription: "Semua dari kiri", rightJoinDescription: "Semua dari kanan", fullJoinDescription: "Semua dari keduanya", inner: "Inner",
    compatible: "Kompatibel", incompatible: "Tidak kompatibel", sameDataType: "Tipe data sama", differentDataType: "Tipe data berbeda",
    columnsSelected: "kolom dipilih", selectAllShort: "Semua", selectNone: "Kosongkan", collisionExplanation: "Pilih cara menangani nama kolom output yang duplikat.",
    validatingAutomatically: "Memvalidasi otomatis…", configurationValid: "Konfigurasi valid", createJoin: "Buat Join", createAppend: "Buat Append",
    connectedDatasets: "Dataset terhubung", noPreparedDatasets: "Belum ada dataset siap", addSourceFirst: "Buka dan siapkan sumber sebelum menggabungkan dataset.",
    selectNodePreview: "Pilih dataset atau operasi untuk melihat hasilnya.", showPreview: "Tampilkan pratinjau", hidePreview: "Sembunyikan pratinjau", composeUpdateFailed: "Operasi Compose tidak dapat diperbarui.",
    leftInput: "Input kiri", rightInput: "Input kanan", joinType: "Jenis join", leftKey: "Key kiri", rightKey: "Key kanan",
    collisionPolicy: "Nama kolom duplikat", failOnCollision: "Hentikan Join", suffixCollisions: "Tambahkan suffix kiri/kanan", manualMapping: "Ganti nama manual",
    outputColumns: "Kolom output", previewSchema: "Pratinjau schema", createNode: "Buat node", unsavedChanges: "Perubahan belum tersimpan", flowSaveFailed: "Perubahan gagal disimpan dan dapat hilang setelah refresh.", retrySave: "Coba simpan lagi", saving: "Menyimpan…",
    validate: "Validasi", estimatedRows: "estimasi baris", chooseDifferentInputs: "Pilih dua input yang berbeda.",
    activityOverrideNotice: "Perubahan Anda menimpa perubahan AI terbaru dan sudah dicatat di Aktivitas.",
    composePreviewFailed: "Node terpilih tidak dapat dipratinjau.", composeCreateFailed: "Node Compose tidak dapat dibuat.", duplicateFailed: "Preparation tidak dapat diduplikat.", createPreparedFailed: "Hasil Compose tidak dapat dijadikan dataset Prepare.", deletePreparedFailed: "Dataset Prepare tidak dapat dihapus.",
  },
};

const toolMessages = {
  en: {
    "rename-column": "Rename column", "change-type": "Change type", trim: "Trim whitespace", "replace-value": "Replace value",
    "fill-empty": "Fill empty", "remove-empty-rows": "Remove empty rows", "remove-duplicates": "Remove duplicates",
    "standardize-case": "Normalize case", "parse-date": "Parse date", "delete-rows": "Delete rows", "select-columns": "Select columns", "remove-columns": "Remove columns",
    sort: "Sort rows", "calculated-column": "Calculated column", "conditional-column": "Conditional column", "group-aggregate": "Group & aggregate",
  },
  id: Object.fromEntries([
    ["rename-column", "Ganti nama kolom"], ["change-type", "Ubah tipe"], ["trim", "Rapikan spasi"], ["replace-value", "Ganti nilai"],
    ["fill-empty", "Isi nilai kosong"], ["remove-empty-rows", "Hapus baris kosong"], ["remove-duplicates", "Hapus duplikat"],
    ["standardize-case", "Seragamkan huruf"], ["parse-date", "Baca tanggal"], ["delete-rows", "Hapus baris"], ["select-columns", "Pilih kolom"], ["remove-columns", "Hapus kolom"],
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
