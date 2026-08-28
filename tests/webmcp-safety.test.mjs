import assert from "node:assert/strict";
import test from "node:test";
import { canExposeProfileRange, classifyColumnSemantics, redactAgentRows } from "../src/dataPrivacy.js";
import { sanitizeExportBaseName } from "../src/dataExport.js";
import { buildJoinKeyCandidates, rankJoinKeyCandidates } from "../src/joinRecommendations.js";
import { schemaDelta } from "../src/schemaDelta.js";
import { nextWorkspaceRevision } from "../src/workspaceRevision.js";
import { qualityCoverage, qualityProfileBatches } from "../src/qualityProfiling.js";

test("sensitivity heuristics redact profile ranges for identifiers and free text", () => {
  const tracking = classifyColumnSemantics("Nomor Resi", "VARCHAR");
  const phone = classifyColumnSemantics("Tlp Penerima", "VARCHAR");
  const operationalText = classifyColumnSemantics("Status Posisi Akhir", "VARCHAR");
  const quantity = classifyColumnSemantics("Jumlah Barang", "BIGINT");

  assert.equal(tracking.sensitivity, "sensitive");
  assert.equal(phone.sensitivity, "sensitive");
  assert.equal(operationalText.sensitivity, "potentially-sensitive");
  assert.equal(canExposeProfileRange(tracking, "VARCHAR"), false);
  assert.equal(canExposeProfileRange(operationalText, "VARCHAR"), false);
  assert.equal(quantity.sensitivity, "non-sensitive");
  assert.equal(canExposeProfileRange(quantity, "BIGINT"), true);
  assert.equal(classifyColumnSemantics("Status Pengiriman", "VARCHAR").sensitivity, "non-sensitive");
  assert.equal(classifyColumnSemantics("Biaya Kirim", "VARCHAR").recommendedType, "DOUBLE");
  assert.equal(classifyColumnSemantics("Tanggal Kirim", "VARCHAR").recommendedType, "TIMESTAMP");
});

test("agent previews redact sensitive columns while preserving nulls and safe categories", () => {
  const result = redactAgentRows([
    { "Nomor Resi": "ABC123", Status: "DELIVERED", Email: null },
  ], [
    { name: "Nomor Resi", type: "VARCHAR" },
    { name: "Status", type: "VARCHAR" },
    { name: "Email", type: "VARCHAR" },
  ]);
  assert.deepEqual(result.redactedColumns, ["Nomor Resi", "Email"]);
  assert.deepEqual(result.rows, [{ "Nomor Resi": "[redacted]", Status: "DELIVERED", Email: null }]);
});

test("explicit semantic sensitivity overrides drive agent redaction", () => {
  const result = redactAgentRows([{ shipment_state: "IN_TRANSIT", customer_name: "Alice" }], [
    { name: "shipment_state", type: "VARCHAR", semantic: { role: "status", sensitivity: "internal" } },
    { name: "customer_name", type: "VARCHAR", semantic: { role: "attribute", sensitivity: "pii" } },
  ]);
  assert.deepEqual(result.rows, [{ shipment_state: "IN_TRANSIT", customer_name: "[redacted]" }]);
});

test("Join recommendations rank semantic names and data quality instead of returning every type-compatible pair", () => {
  const left = [
    { name: "Nomor Resi", type: "VARCHAR" },
    { name: "Nama Pengirim", type: "VARCHAR" },
    { name: "volume", type: "DOUBLE" },
  ];
  const right = [
    { name: "nomor_resi", type: "VARCHAR" },
    { name: "recipient_name", type: "VARCHAR" },
    { name: "weight", type: "DOUBLE" },
  ];
  const preliminary = buildJoinKeyCandidates(left, right, { limit: 32 });
  const leftStats = new Map([["Nomor Resi", { uniquenessRatio: 1, nullRatio: 0 }]]);
  const rightStats = new Map([["nomor_resi", { uniquenessRatio: 1, nullRatio: 0 }]]);
  const ranked = rankJoinKeyCandidates(preliminary.candidates, leftStats, rightStats, { limit: 2 });

  assert.equal(preliminary.compatiblePairCount, 5);
  assert.equal(ranked.length, 2);
  assert.deepEqual([ranked[0].left, ranked[0].right], ["Nomor Resi", "nomor_resi"]);
  assert.ok(ranked[0].score > ranked[1].score);
});

test("Join recommendations prefer exact semantic identifiers over sparse boolean columns", () => {
  const left = [{ name: "shipment_id", type: "VARCHAR", semantic: { role: "identifier" } }, { name: "active", type: "BOOLEAN" }];
  const right = [{ name: "shipment_id", type: "VARCHAR", semantic: { role: "identifier" } }, { name: "active", type: "BOOLEAN" }];
  const preliminary = buildJoinKeyCandidates(left, right, { limit: 12 });
  const leftStats = new Map([
    ["shipment_id", { uniquenessRatio: 1, nullRatio: 0, totalRowCount: 171 }],
    ["active", { uniquenessRatio: 1, nullRatio: 0.993, totalRowCount: 171 }],
  ]);
  const rightStats = new Map(leftStats);
  const ranked = rankJoinKeyCandidates(preliminary.candidates, leftStats, rightStats, { limit: 4 });
  assert.deepEqual([ranked[0].left, ranked[0].right], ["shipment_id", "shipment_id"]);
});

test("dry-run schema deltas contain metadata only", () => {
  assert.deepEqual(schemaDelta(
    [{ name: "id", type: "BIGINT" }, { name: "status", type: "VARCHAR" }],
    [{ name: "id", type: "VARCHAR" }, { name: "total", type: "DOUBLE" }],
  ), {
    added: [{ name: "total", type: "DOUBLE" }],
    removed: [{ name: "status", type: "VARCHAR" }],
    typeChanged: [{ name: "id", before: "BIGINT", after: "VARCHAR" }],
  });
});

test("derived rebuilds do not advance the semantic workspace revision", () => {
  assert.equal(nextWorkspaceRevision(14, { semantic: false }), 14);
  assert.equal(nextWorkspaceRevision(14, { semantic: true }), 15);
});

test("export names use the visible dataset or operation name safely", () => {
  assert.equal(sanitizeExportBaseName("tabulaFlow - lengkap copy.xlsx"), "tabulaFlow - lengkap copy");
  assert.equal(sanitizeExportBaseName("QC Patch / Join updated"), "QC Patch - Join updated");
});

test("wide data quality profiling covers every column in deterministic batches", () => {
  const columns = Array.from({ length: 304 }, (_, index) => `column_${index + 1}`);
  const batches = qualityProfileBatches(columns, 40);
  assert.deepEqual(batches.map((batch) => batch.length), [40, 40, 40, 40, 40, 40, 40, 24]);
  assert.deepEqual(batches.flat(), columns);
  assert.deepEqual(qualityCoverage(304, 304), { profiledColumnCount: 304, totalColumnCount: 304, complete: true, coverage: "full" });
  assert.equal(qualityCoverage(200, 304).coverage, "partial");
});
