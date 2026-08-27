import assert from "node:assert/strict";
import { File } from "node:buffer";
import test from "node:test";
import * as XLSX from "xlsx";
import { parseDataFile } from "../src/data.js";
import { encodeSpreadsheetExport } from "../src/dataExport.js";

const rows = [
  { order_id: "ORD-1", status: "Ready", amount: 1250 },
  { order_id: "ORD-2", status: "=2+2", amount: 900 },
];
const columns = ["order_id", "status", "amount"];

test("CSV import and filtered export round-trip through the production codecs", async () => {
  const imported = await parseDataFile(new File([
    "order_id,status,amount\nORD-1,Ready,1250\nORD-2,=2+2,900\n",
  ], "orders.csv", { type: "text/csv" }));
  assert.deepEqual(imported, rows);

  const exported = await encodeSpreadsheetExport(imported.slice(1), columns, "csv", "orders-filtered");
  assert.equal(exported.filename, "orders-filtered.csv");
  const reparsed = await parseDataFile(new File([exported.bytes], exported.filename, { type: exported.mime }));
  assert.deepEqual(reparsed, [{ order_id: "ORD-2", status: "'=2+2", amount: 900 }]);
});

test("Excel import and filtered export round-trip through the production codecs", async () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows, { header: columns }), "Orders");
  const sourceBytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  const imported = await parseDataFile(new File([sourceBytes], "orders.xlsx"));
  assert.deepEqual(imported, rows);

  const exported = await encodeSpreadsheetExport(imported.slice(0, 1), columns, "xlsx", "orders-filtered");
  assert.equal(exported.filename, "orders-filtered.xlsx");
  const reparsed = await parseDataFile(new File([exported.bytes], exported.filename, { type: exported.mime }));
  assert.deepEqual(reparsed, [rows[0]]);
});
