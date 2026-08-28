import Papa from "papaparse";
import { prepareSpreadsheetData } from "./data.js";

export function sanitizeExportBaseName(value, fallback = "tabulaflow-data") {
  const normalized = String(value ?? "")
    .replace(/\.[^.]+$/, "")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return normalized || fallback;
}

export async function encodeSpreadsheetExport(rows, sourceColumns, format, baseName, sheetName = "Filtered Data") {
  const spreadsheet = prepareSpreadsheetData(rows, sourceColumns);
  if (format === "csv") {
    const text = `\uFEFF${Papa.unparse({ fields: spreadsheet.headers, data: spreadsheet.data })}`;
    return {
      bytes: new TextEncoder().encode(text).buffer,
      filename: `${baseName}.csv`,
      mime: "text/csv;charset=utf-8",
    };
  }
  if (format !== "xlsx") throw new Error(`Format ekspor "${format}" tidak didukung.`);
  const XLSX = await import("xlsx");
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([spreadsheet.headers, ...spreadsheet.data]), sheetName);
  return {
    bytes: XLSX.write(workbook, { bookType: "xlsx", type: "array" }),
    filename: `${baseName}.xlsx`,
    mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}
