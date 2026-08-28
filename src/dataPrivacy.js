const DIRECT_IDENTIFIER_PATTERN = /(^|\s)(name|nama|email|e-mail|phone|telephone|telp|telepon|tlp|mobile|whatsapp|wa|address|alamat|nik|passport|paspor|resi|tracking|ext\s*id|external\s*id|customer\s*id|user\s*id|account\s*id|recipient|receiver|sender|pengirim|penerima)(\s|$)/;
const FINANCIAL_PATTERN = /(^|\s)(bank|rekening|account|card|kartu|price|harga|amount|nilai|biaya|cost|salary|gaji|payment|pembayaran|currency|mata\s*uang)(\s|$)/;
const LOCATION_PATTERN = /(^|\s)(latitude|longitude|coordinate|koordinat|location|lokasi|city|kota|district|kecamatan|village|kelurahan|postal|postcode|zip)(\s|$)/;
const SECRET_PATTERN = /(^|\s)(password|passwd|secret|token|api\s*key|credential|pin|otp)(\s|$)/;
const SAFE_CATEGORY_PATTERN = /^(status|delivery status|shipment status|status pengiriman|status kiriman|state|stage|product|produk|service|layanan|category|kategori|type|jenis|sla|cod|flag|is active|enabled)$/;
const DATE_LIKE_PATTERN = /(^|\s)(date|tanggal|time|waktu|timestamp)(\s|$)/;
const IDENTIFIER_LIKE_PATTERN = /(^|\s)(id|code|kode|number|nomor|no)(\s|$)/;
const NUMERIC_MEASURE_PATTERN = /(^|\s)(amount|nilai|biaya|cost|price|harga|total|weight|berat|volume|qty|quantity|jumlah)(\s|$)/;

function normalizedColumnName(name) {
  return String(name ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function classifyColumnSemantics(name, type) {
  const normalizedName = normalizedColumnName(name);
  const normalizedType = String(type ?? "").toUpperCase();
  let sensitivity = "unknown";
  let category = "unclassified";

  if (SECRET_PATTERN.test(normalizedName)) {
    sensitivity = "sensitive";
    category = "credential";
  } else if (DIRECT_IDENTIFIER_PATTERN.test(normalizedName)) {
    sensitivity = "sensitive";
    category = "direct-identifier";
  } else if (FINANCIAL_PATTERN.test(normalizedName)) {
    sensitivity = "sensitive";
    category = "financial";
  } else if (LOCATION_PATTERN.test(normalizedName)) {
    sensitivity = "potentially-sensitive";
    category = "location";
  } else if (SAFE_CATEGORY_PATTERN.test(normalizedName)) {
    sensitivity = "non-sensitive";
    category = "categorical";
  } else if (/VARCHAR|CHAR|TEXT|JSON|STRUCT|UNION|\[\]/.test(normalizedType)) {
    sensitivity = "potentially-sensitive";
    category = "free-text";
  } else if (/BOOL|INT|DECIMAL|NUMERIC|DOUBLE|FLOAT|REAL|DATE|TIME/.test(normalizedType)) {
    sensitivity = "non-sensitive";
    category = "typed-measure";
  }

  const recommendedType = DATE_LIKE_PATTERN.test(normalizedName) && !/DATE|TIME/.test(normalizedType)
    ? "TIMESTAMP"
    : NUMERIC_MEASURE_PATTERN.test(normalizedName) && !/INT|DECIMAL|NUMERIC|DOUBLE|FLOAT|REAL/.test(normalizedType)
      ? "DOUBLE"
      : null;
  const semanticRole = IDENTIFIER_LIKE_PATTERN.test(normalizedName)
    ? "identifier"
    : category === "categorical"
      ? "dimension"
      : NUMERIC_MEASURE_PATTERN.test(normalizedName) || /INT|DECIMAL|NUMERIC|DOUBLE|FLOAT|REAL/.test(normalizedType)
        ? "measure"
        : "attribute";

  return {
    unit: null,
    currency: null,
    sensitivity,
    category,
    semanticRole,
    recommendedType,
    recommendationReason: recommendedType === "TIMESTAMP"
      ? "Column name suggests a date or time value; validate the source format before converting."
      : recommendedType === "DOUBLE"
        ? "Column name suggests a numeric measure; validate formatting and units before converting."
        : null,
    requiresReview: sensitivity !== "non-sensitive",
    source: "conservative-name-and-type-heuristic",
  };
}

export function shouldRedactAgentValues(semantics) {
  return semantics?.sensitivity === "sensitive" || semantics?.sensitivity === "potentially-sensitive";
}

export function redactAgentRows(rows, schema = []) {
  const redactedColumns = schema
    .filter((column) => shouldRedactAgentValues(classifyColumnSemantics(column.name, column.type)))
    .map((column) => column.name);
  const redacted = new Set(redactedColumns);
  return {
    rows: rows.map((row) => Object.fromEntries(Object.entries(row).map(([column, value]) => [column, redacted.has(column) && value !== null ? "[redacted]" : value]))),
    redactedColumns,
  };
}

export function canExposeProfileRange(semantics, type) {
  if (semantics?.sensitivity !== "non-sensitive") return false;
  return /BOOL|INT|DECIMAL|NUMERIC|DOUBLE|FLOAT|REAL|DATE|TIME/.test(String(type ?? "").toUpperCase());
}
