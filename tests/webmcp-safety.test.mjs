import assert from "node:assert/strict";
import test from "node:test";
import { canExposeProfileRange, classifyColumnSemantics } from "../src/dataPrivacy.js";
import { sanitizeExportBaseName } from "../src/dataExport.js";
import { buildJoinKeyCandidates, rankJoinKeyCandidates } from "../src/joinRecommendations.js";
import { schemaDelta } from "../src/schemaDelta.js";
import { nextWorkspaceRevision } from "../src/workspaceRevision.js";

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
