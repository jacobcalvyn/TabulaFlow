import Papa from "papaparse";

const EMPTY_LABEL = "(kosong)";
const SUPPORTED_EXTENSIONS = new Set(["xlsx", "xls", "csv", "json", "jsonl", "ndjson"]);
export const DATA_LIMITS = Object.freeze({
  maxImportBytes: 50 * 1024 * 1024,
  maxRows: 100_000,
  maxColumns: 1_000,
  maxAggregateColumns: 200,
  maxExportRows: 50_000,
});

function getExtension(filename) {
  return filename.split(".").pop()?.toLowerCase() ?? "";
}

export function isSupportedFile(filename) {
  return SUPPORTED_EXTENSIONS.has(getExtension(filename));
}

export function makeUniqueHeaders(rawHeaders) {
  const used = new Set();
  return rawHeaders.map((value, index) => {
    const base = String(value ?? "").trim() || `column_${index + 1}`;
    let candidate = base;
    for (let suffix = 2; used.has(candidate.toLocaleLowerCase("id-ID")); suffix += 1) {
      candidate = `${base}_${suffix}`;
    }
    used.add(candidate.toLocaleLowerCase("id-ID"));
    return candidate;
  });
}

function rowsFromMatrix(matrix) {
  if (!Array.isArray(matrix) || matrix.length === 0) return [];

  const headers = makeUniqueHeaders(matrix[0]);
  return matrix.slice(1).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, values[index] ?? null])),
  );
}

function flattenRecordEntries(record, segments = [], entries = []) {
  if (record === null || record === undefined) return entries;
  for (const [key, value] of Object.entries(record)) {
    const path = [...segments, key];
    if (Array.isArray(value)) {
      entries.push({ identity: JSON.stringify(path), label: path.join("."), value: JSON.stringify(value) });
    } else if (value && typeof value === "object" && !(value instanceof Date)) {
      flattenRecordEntries(value, path, entries);
    } else {
      entries.push({ identity: JSON.stringify(path), label: path.join("."), value: value ?? null });
    }
  }
  return entries;
}

function normalizeJsonRecords(records, includeScalarRow = false) {
  const labelsByIdentity = new Map();
  const entryRows = records.map((record, index) => {
    const entries = record && typeof record === "object" && !Array.isArray(record)
      ? flattenRecordEntries(record)
      : [
        { identity: JSON.stringify(["value"]), label: "value", value: record },
        ...(includeScalarRow ? [{ identity: JSON.stringify(["row"]), label: "row", value: index + 1 }] : []),
      ];
    for (const entry of entries) {
      if (!labelsByIdentity.has(entry.identity)) labelsByIdentity.set(entry.identity, entry.label);
    }
    return entries;
  });

  const identities = [...labelsByIdentity.keys()];
  const headers = makeUniqueHeaders([...labelsByIdentity.values()]);
  const headerByIdentity = new Map(identities.map((identity, index) => [identity, headers[index]]));
  return entryRows.map((entries) => Object.fromEntries(
    entries.map((entry) => [headerByIdentity.get(entry.identity), entry.value]),
  ));
}

function normalizeJsonPayload(payload) {
  let records = payload;

  if (!Array.isArray(records) && records && typeof records === "object") {
    const commonArray = [records.data, records.rows, records.records, records.items].find(Array.isArray);
    records = commonArray ?? [records];
  }

  if (!Array.isArray(records)) {
    throw new Error("JSON harus berisi array objek atau objek tunggal.");
  }

  return normalizeJsonRecords(records, true);
}

function parseJsonLines(text) {
  const records = [];
  const errors = [];

  text.split(/\r?\n/).forEach((line, index) => {
    if (!line.trim()) return;
    try {
      const parsed = JSON.parse(line);
      records.push(parsed);
    } catch {
      errors.push(index + 1);
    }
  });

  if (errors.length) {
    const preview = errors.slice(0, 5).join(", ");
    throw new Error(`JSONL tidak valid pada baris ${preview}${errors.length > 5 ? "…" : ""}.`);
  }

  return normalizeJsonRecords(records);
}

function validateRows(rows) {
  if (!rows.length) throw new Error("File tidak memiliki baris data.");
  if (rows.length > DATA_LIMITS.maxRows) {
    throw new Error(`File melebihi batas ${DATA_LIMITS.maxRows.toLocaleString("id-ID")} baris.`);
  }
  const columnCount = getColumns(rows).length;
  if (!columnCount) throw new Error("File tidak memiliki kolom data.");
  if (columnCount > DATA_LIMITS.maxColumns) {
    throw new Error(`File melebihi batas ${DATA_LIMITS.maxColumns.toLocaleString("id-ID")} kolom.`);
  }
}

export async function parseDataFile(file) {
  const extension = getExtension(file.name);
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new Error("Format belum didukung. Pilih Excel, CSV, JSON, JSONL, atau NDJSON.");
  }
  if (file.size > DATA_LIMITS.maxImportBytes) {
    const limitMb = Math.floor(DATA_LIMITS.maxImportBytes / 1024 / 1024);
    throw new Error(`Ukuran file melebihi batas ${limitMb} MB.`);
  }

  let rows;

  if (extension === "xlsx" || extension === "xls") {
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(await file.arrayBuffer(), { cellDates: true, sheetRows: DATA_LIMITS.maxRows + 2 });
    const firstSheet = workbook.SheetNames[0];
    if (!firstSheet) throw new Error("Workbook tidak memiliki sheet.");
    const matrix = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], {
      header: 1,
      defval: null,
      raw: true,
    });
    rows = rowsFromMatrix(matrix);
  } else if (extension === "csv") {
    const result = Papa.parse(await file.text(), {
      header: false,
      skipEmptyLines: "greedy",
      dynamicTyping: true,
    });
    if (result.errors.length) {
      throw new Error(result.errors[0].message || "CSV tidak dapat dibaca.");
    }
    rows = rowsFromMatrix(result.data);
  } else if (extension === "json") {
    const text = (await file.text()).replace(/^\uFEFF/, "");
    rows = normalizeJsonPayload(JSON.parse(text));
  } else {
    rows = parseJsonLines((await file.text()).replace(/^\uFEFF/, ""));
  }

  validateRows(rows);
  return rows;
}

export function getColumns(rows) {
  const columns = [];
  const seen = new Set();

  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }

  return columns;
}

function stableValue(value) {
  if (value === null || value === undefined || value === "") {
    return { key: "empty:", label: EMPTY_LABEL, raw: null };
  }
  if (value instanceof Date) {
    return { key: `date:${value.toISOString()}`, label: value.toISOString().slice(0, 10), raw: value };
  }
  if (typeof value === "object") {
    const label = JSON.stringify(value);
    return { key: `object:${label}`, label, raw: value };
  }
  return { key: `${typeof value}:${String(value)}`, label: String(value), raw: value };
}

export function filterRows(rows, filters, excludedColumn = null) {
  const activeFilters = Object.entries(filters).filter(([column]) => column !== excludedColumn);
  if (!activeFilters.length) return rows;

  return rows.filter((row) =>
    activeFilters.every(([column, selectedKey]) => stableValue(row[column]).key === selectedKey),
  );
}

export function inferColumnType(rows, column) {
  const values = rows.map((row) => row[column]).filter((value) => value !== null && value !== undefined && value !== "");
  if (!values.length) return "kosong";
  if (values.every((value) => typeof value === "number" && Number.isInteger(value))) return "angka";
  if (values.every((value) => typeof value === "number")) return "desimal";
  if (values.every((value) => typeof value === "boolean")) return "boolean";
  if (values.every((value) => value instanceof Date || /^\d{4}-\d{2}-\d{2}(?:[T\s]|$)/.test(String(value)))) return "tanggal";
  return "teks";
}

export function aggregateColumn(rows, column) {
  const counts = new Map();

  for (const row of rows) {
    const normalized = stableValue(row[column]);
    const current = counts.get(normalized.key);
    counts.set(normalized.key, current ? { ...current, count: current.count + 1 } : { ...normalized, count: 1 });
  }

  return [...counts.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "id-ID", { numeric: true }));
}

function valueKind(value) {
  if (value === null || value === undefined || value === "") return "kosong";
  if (value instanceof Date || /^\d{4}-\d{2}-\d{2}(?:[T\s]|$)/.test(String(value))) return "tanggal";
  if (typeof value === "number") return "angka";
  if (typeof value === "boolean") return "boolean";
  return "teks";
}

export function analyzeDataQuality(rows, columns = getColumns(rows)) {
  const details = columns.map((column) => {
    let missing = 0;
    const types = new Set();

    for (const row of rows) {
      const kind = valueKind(row[column]);
      if (kind === "kosong") missing += 1;
      else types.add(kind);
    }

    return {
      column,
      missing,
      mixed: types.size > 1,
      types: [...types],
    };
  });

  return {
    emptyCells: details.reduce((total, item) => total + item.missing, 0),
    mixedColumns: details.filter((item) => item.mixed).length,
    affectedColumns: details.filter((item) => item.missing > 0 || item.mixed),
  };
}

export function sanitizeSpreadsheetValue(value) {
  if (typeof value !== "string") return value;
  return /^[\t\r]/.test(value) || /^[=+\-@]/.test(value.trimStart()) ? `'${value}` : value;
}

export function sanitizeRowsForSpreadsheet(rows) {
  return rows.map((row) => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, sanitizeSpreadsheetValue(value)]),
  ));
}

export function prepareSpreadsheetData(rows, sourceColumns = getColumns(rows)) {
  const headers = makeUniqueHeaders(sourceColumns.map((column) => sanitizeSpreadsheetValue(column)));
  const data = rows.map((row) => sourceColumns.map((column) => sanitizeSpreadsheetValue(row[column])));
  return { headers, data };
}

export function normalizeEmptyValues(rows) {
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key,
    typeof value === "string" && value.trim() === "" ? null : value,
  ])));
}

export function formatValue(value, locale = "en-US") {
  if (value === null || value === undefined || value === "") return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number") return new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

export function makeDemoRows(count = 7245) {
  const cities = ["Jakarta", "Surabaya", "Bandung", "Medan", "Semarang", "Makassar"];
  const products = [
    ["Beras 5kg", 56000],
    ["Minyak Goreng 2L", 28000],
    ["Kopi Bubuk 250g", 27000],
    ["Gula Pasir 1kg", 15000],
    ["Teh Celup 25s", 12500],
    ["Susu UHT 1L", 18000],
  ];

  return Array.from({ length: count }, (_, index) => {
    const product = products[(index * 5 + Math.floor(index / 7)) % products.length];
    const qty = [1, 1, 2, 1, 3, 2, 1, 5][index % 8];
    const day = String((index % 31) + 1).padStart(2, "0");
    return {
      order_id: `ORD-${String(index + 1).padStart(5, "0")}`,
      tanggal: `2025-08-${day}`,
      wilayah: cities[(index * 3 + Math.floor(index / 11)) % cities.length],
      produk: product[0],
      qty,
      harga: product[1],
      total: product[1] * qty,
    };
  });
}
