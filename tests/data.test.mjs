import assert from "node:assert/strict";
import { File } from "node:buffer";
import test from "node:test";
import * as XLSX from "xlsx";
import {
  DATA_LIMITS,
  aggregateColumn,
  analyzeDataQuality,
  filterRows,
  getColumns,
  formatValue,
  normalizeEmptyValues,
  parseDataFile,
  prepareSpreadsheetData,
  sanitizeRowsForSpreadsheet,
} from "../src/data.js";

test("normalizes blank strings to null without trimming non-empty values", () => {
  assert.deepEqual(normalizeEmptyValues([
    { empty: "", whitespace: "   ", preserved: "  Jayapura  ", amount: 0 },
  ]), [
    { empty: null, whitespace: null, preserved: "  Jayapura  ", amount: 0 },
  ]);
});

test("formats numbers with the active locale", () => {
  assert.equal(formatValue(1234.5, "en-US"), "1,234.5");
  assert.equal(formatValue(1234.5, "id-ID"), "1.234,5");
  assert.equal(formatValue(null, "en-US"), "");
});

test("aggregates values by frequency in descending order", () => {
  const result = aggregateColumn(
    [{ city: "Jayapura" }, { city: "Merauke" }, { city: "Jayapura" }, { city: null }],
    "city",
  );

  assert.deepEqual(result.map(({ label, count }) => [label, count]), [
    ["Jayapura", 2],
    ["(kosong)", 1],
    ["Merauke", 1],
  ]);
});

test("filters rows by selected aggregate values using AND logic", () => {
  const rows = [
    { city: "Jayapura", status: "Selesai" },
    { city: "Jayapura", status: "Proses" },
    { city: "Merauke", status: "Selesai" },
  ];

  assert.deepEqual(filterRows(rows, { city: "string:Jayapura" }), rows.slice(0, 2));
  assert.deepEqual(filterRows(rows, { city: "string:Jayapura", status: "string:Selesai" }), [rows[0]]);
  assert.deepEqual(
    filterRows(rows, { city: "string:Jayapura", status: "string:Selesai" }, "city"),
    [rows[0], rows[2]],
  );
  assert.equal(filterRows(rows, { city: "string:Sorong" }).length, 0);
});

test("parses CSV and normalizes duplicate headers", async () => {
  const file = new File(["Kurs,Kurs,Wilayah\n16000,16100,Timur\n"], "sample.csv", { type: "text/csv" });
  const rows = await parseDataFile(file);

  assert.deepEqual(rows, [{ Kurs: 16000, Kurs_2: 16100, Wilayah: "Timur" }]);
});

test("preserves every CSV column when generated suffixes collide", async () => {
  const forward = new File(["A,A,A_2\n1,2,3\n"], "forward.csv", { type: "text/csv" });
  const reverse = new File(["A_2,A,A\n1,2,3\n"], "reverse.csv", { type: "text/csv" });

  assert.deepEqual(await parseDataFile(forward), [{ A: 1, A_2: 2, A_2_2: 3 }]);
  assert.deepEqual(await parseDataFile(reverse), [{ A_2: 1, A: 2, A_3: 3 }]);
});

test("parses and flattens nested JSON", async () => {
  const file = new File([JSON.stringify([{ id: 1, address: { city: "Jayapura" }, tags: ["A", "B"] }])], "sample.json");
  const rows = await parseDataFile(file);

  assert.deepEqual(rows, [{ id: 1, "address.city": "Jayapura", tags: '["A","B"]' }]);
});

test("preserves literal and nested JSON paths that flatten to the same label", async () => {
  const file = new File([JSON.stringify([
    { "a.b": 1, a: { b: 2 } },
    { a: { b: 3 }, "a.b": 4 },
  ])], "collision.json");

  assert.deepEqual(await parseDataFile(file), [
    { "a.b": 1, "a.b_2": 2 },
    { "a.b_2": 3, "a.b": 4 },
  ]);
});

test("parses JSONL and reports malformed line numbers", async () => {
  const valid = new File(['{"id":1}\n{"id":2}\n'], "sample.jsonl");
  assert.deepEqual(await parseDataFile(valid), [{ id: 1 }, { id: 2 }]);

  const invalid = new File(['{"id":1}\nnot-json\n'], "broken.jsonl");
  await assert.rejects(() => parseDataFile(invalid), /baris 2/);
});

test("parses the first Excel sheet and preserves unique columns", async () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["order_id", "qty", "qty"],
    ["ORD-1", 2, 3],
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Data");
  const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  const file = new File([bytes], "sample.xlsx");
  const rows = await parseDataFile(file);

  assert.deepEqual(getColumns(rows), ["order_id", "qty", "qty_2"]);
  assert.deepEqual(rows, [{ order_id: "ORD-1", qty: 2, qty_2: 3 }]);
});

test("preserves every Excel column when generated suffixes collide", async () => {
  const sheet = XLSX.utils.aoa_to_sheet([["A", "A", "A_2"], [1, 2, 3]]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Data");
  const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" });

  assert.deepEqual(await parseDataFile(new File([bytes], "collision.xlsx")), [
    { A: 1, A_2: 2, A_2_2: 3 },
  ]);
});

test("reports empty cells and mixed-type columns", () => {
  const quality = analyzeDataQuality([
    { code: "A", amount: 10 },
    { code: null, amount: "unknown" },
    { code: "C", amount: 20 },
  ]);

  assert.equal(quality.emptyCells, 1);
  assert.equal(quality.mixedColumns, 1);
  assert.deepEqual(quality.affectedColumns.map(({ column }) => column), ["code", "amount"]);
});

test("neutralizes spreadsheet formulas before export", () => {
  assert.deepEqual(sanitizeRowsForSpreadsheet([
    { safe: "Jakarta", formula: "=2+2", command: "@SUM(A1:A2)", amount: 10 },
  ]), [
    { safe: "Jakarta", formula: "'=2+2", command: "'@SUM(A1:A2)", amount: 10 },
  ]);
});

test("neutralizes and de-duplicates spreadsheet headers at the export boundary", () => {
  assert.deepEqual(prepareSpreadsheetData([
    { "=SUM(A1:A2)": "  +2+2", "'=SUM(A1:A2)": "safe" },
  ]), {
    headers: ["'=SUM(A1:A2)", "'=SUM(A1:A2)_2"],
    data: [["'  +2+2", "safe"]],
  });
});

test("rejects files above the import byte limit before parsing", async () => {
  await assert.rejects(() => parseDataFile({
    name: "oversized.csv",
    size: DATA_LIMITS.maxImportBytes + 1,
  }), /50 MB/);
});

test("accepts wide files up to 1,000 columns", async () => {
  const headers = Array.from({ length: 201 }, (_, index) => `column_${index + 1}`);
  const values = Array.from({ length: 201 }, (_, index) => index + 1);
  const file = new File([`${headers.join(",")}\n${values.join(",")}\n`], "wide.csv", { type: "text/csv" });

  const rows = await parseDataFile(file);
  assert.equal(getColumns(rows).length, 201);
  assert.equal(rows[0].column_201, 201);
  assert.equal(DATA_LIMITS.maxColumns, 1_000);
  assert.equal(DATA_LIMITS.maxAggregateColumns, 200);
});

test("rejects files above the 1,000-column import limit", async () => {
  const headers = Array.from({ length: DATA_LIMITS.maxColumns + 1 }, (_, index) => `column_${index + 1}`);
  const values = headers.map(() => "1");
  const file = new File([`${headers.join(",")}\n${values.join(",")}\n`], "too-wide.csv", { type: "text/csv" });

  await assert.rejects(() => parseDataFile(file), /1\.000 kolom/);
});
