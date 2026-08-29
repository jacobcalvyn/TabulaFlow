import assert from "node:assert/strict";
import test from "node:test";
import { agentPreviewColumnSchema, canExposeProfileRange, classifyColumnSemantics, redactAgentRows } from "../src/dataPrivacy.js";
import { sanitizeExportBaseName } from "../src/dataExport.js";
import { buildJoinKeyCandidates, rankJoinKeyCandidates } from "../src/joinRecommendations.js";
import { schemaDelta } from "../src/schemaDelta.js";
import { nextWorkspaceRevision } from "../src/workspaceRevision.js";
import { qualityCoverage, qualityProfileBatches } from "../src/qualityProfiling.js";
import {
  assertAgentSemanticFieldChange,
  isProtectedAgentValue,
  protectComposeConfigForAgent,
  protectRecipeForAgent,
  restoreProtectedComposeOperation,
  restoreProtectedRecipeValues,
} from "../src/agentDataProtection.js";
import { deriveRecipeSemanticSchema, isSensitivityAtLeastAsStrict, reconcileSemanticModel } from "../src/semanticModel.js";

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

test("numeric identifier columns default to redacted internal semantics", () => {
  const names = ["student_id", "employee_number", "patient_id", "shipment_id", "customer_key", "pk", "fk", "uuid", "guid"];
  for (const name of names) {
    const semantics = classifyColumnSemantics(name, "BIGINT");
    assert.equal(semantics.semanticRole, "identifier");
    assert.equal(semantics.sensitivity, "potentially-sensitive");
  }
  const row = Object.fromEntries(names.map((name, index) => [name, index + 100]));
  const result = redactAgentRows([row], names.map((name) => ({ name, type: "BIGINT" })));
  assert.deepEqual(result.redactedColumns, names);
  assert.deepEqual(result.rows[0], Object.fromEntries(names.map((name) => [name, "[redacted]"])));
});

test("stale identifier roles retain an internal sensitivity floor", () => {
  const schema = [{ name: "legacy_number", type: "BIGINT", semantic: { role: "identifier", sensitivity: "public", source: "inferred" } }];
  assert.deepEqual(redactAgentRows([{ legacy_number: 123 }], schema).rows, [{ legacy_number: "[redacted]" }]);
  const reconciled = reconcileSemanticModel({ targetId: "prepared-a", fields: { legacy_number: schema[0].semantic } }, "prepared-a", schema);
  assert.equal(reconciled.fields.legacy_number.sensitivity, "internal");
});

test("recipe lineage never lowers sensitivity through rename, cast, or Formula column updates", () => {
  const source = [
    { name: "api_token", type: "VARCHAR" },
    { name: "notes", type: "VARCHAR" },
  ];
  const recipe = [
    { id: "rename", type: "rename-column", enabled: true, params: { column: "api_token", newName: "status" } },
    { id: "cast", type: "change-type", enabled: true, params: { column: "notes", targetType: "BIGINT" } },
    { id: "formula", type: "calculated-field", enabled: true, params: { outputColumn: "public_result", expression: "substring([status], 1, 100)", expressionVersion: 1 } },
  ];
  const derived = deriveRecipeSemanticSchema(source, recipe, [
    { name: "status", type: "VARCHAR" },
    { name: "notes", type: "BIGINT" },
    { name: "public_result", type: "VARCHAR" },
  ], [{ name: "public_result", type: "VARCHAR", semantic: { role: "status", sensitivity: "public", source: "inferred" } }]);
  assert.equal(derived.find((column) => column.name === "status").semantic.sensitivity, "secret");
  assert.equal(derived.find((column) => column.name === "notes").semantic.sensitivity, "internal");
  assert.equal(derived.find((column) => column.name === "public_result").semantic.sensitivity, "secret");
  assert.deepEqual(redactAgentRows([{ status: "secret", notes: 42, public_result: "secret" }], derived).rows, [{ status: "[redacted]", notes: "[redacted]", public_result: "[redacted]" }]);
});

test("stale inferred public semantics cannot bypass a stricter identifier heuristic", () => {
  const schema = [{ name: "shipment_id", type: "BIGINT", semantic: { role: "identifier", sensitivity: "public", source: "inferred" } }];
  assert.deepEqual(redactAgentRows([{ shipment_id: 42 }], schema).rows, [{ shipment_id: "[redacted]" }]);
  const reconciled = reconcileSemanticModel({ targetId: "prepared-a", revision: 1, fields: { shipment_id: schema[0].semantic } }, "prepared-a", schema);
  assert.equal(reconciled.fields.shipment_id.sensitivity, "internal");
});

test("agent semantic updates may tighten but never lower sensitivity", () => {
  assert.equal(isSensitivityAtLeastAsStrict("secret", "pii"), true);
  assert.equal(isSensitivityAtLeastAsStrict("pii", "internal"), true);
  assert.equal(isSensitivityAtLeastAsStrict("public", "internal"), false);
  assert.equal(isSensitivityAtLeastAsStrict("internal", "secret"), false);
  assert.doesNotThrow(() => assertAgentSemanticFieldChange("customer_id", { sensitivity: "internal" }, { sensitivity: "pii" }));
  assert.throws(
    () => assertAgentSemanticFieldChange("customer_id", { sensitivity: "pii" }, { sensitivity: "public" }),
    (error) => error.code === "SEMANTIC_DECLASSIFICATION_REQUIRES_USER",
  );
});

test("explicit semantic sensitivity overrides drive agent redaction", () => {
  const result = redactAgentRows([{ shipment_state: "IN_TRANSIT", customer_name: "Alice", public_status: "DELIVERED", Email: "alice@example.com" }], [
    { name: "shipment_state", type: "VARCHAR", semantic: { role: "status", sensitivity: "internal" } },
    { name: "customer_name", type: "VARCHAR", semantic: { role: "attribute", sensitivity: "pii" } },
    { name: "public_status", type: "VARCHAR", semantic: { role: "status", sensitivity: "public", source: "user-override" } },
    { name: "Email", type: "VARCHAR", semantic: { role: "attribute", sensitivity: "public", source: "override" } },
  ]);
  assert.deepEqual(result.rows, [{ shipment_state: "[redacted]", customer_name: "[redacted]", public_status: "DELIVERED", Email: "[redacted]" }]);
});

test("inferred free text remains redacted after semantic-model classification", () => {
  const result = redactAgentRows([{ Notes: "Call the recipient before delivery" }], [
    { name: "Notes", type: "VARCHAR", semantic: { role: "free-text", sensitivity: "internal", source: "inferred" } },
  ]);
  assert.deepEqual(result.redactedColumns, ["Notes"]);
  assert.deepEqual(result.rows, [{ Notes: "[redacted]" }]);
  assert.equal(canExposeProfileRange({ sensitivity: "internal" }, "BIGINT"), false);
});

test("recipe dry-run preview preserves explicit semantics and protects unknown derived columns", () => {
  const semanticSchema = [
    { name: "internal_date", type: "DATE", semantic: { sensitivity: "internal" } },
    { name: "public_total", type: "BIGINT", semantic: { sensitivity: "public" } },
  ];
  const schema = [
    agentPreviewColumnSchema("internal_date", "DATE", semanticSchema),
    agentPreviewColumnSchema("public_total", "BIGINT", semanticSchema),
    agentPreviewColumnSchema("derived_total", "BIGINT", semanticSchema),
  ];
  const result = redactAgentRows([{ internal_date: "2026-08-29", public_total: 10, derived_total: 20 }], schema);
  assert.deepEqual(result.rows, [{ internal_date: "[redacted]", public_total: 10, derived_total: "[redacted]" }]);
});

test("Compose reads protect internal filter and pivot literals while public values remain readable", () => {
  const schema = [
    { name: "private_code", type: "BIGINT", semantic: { sensitivity: "internal" } },
    { name: "public_status", type: "VARCHAR", semantic: { sensitivity: "public", source: "user-override" } },
  ];
  const privateFilter = { kind: "filter-rows", config: { conditions: [{ column: "private_code", operator: "equals", value: 42 }] } };
  const publicFilter = { kind: "filter-rows", config: { conditions: [{ column: "public_status", operator: "equals", value: "READY" }] } };
  const pivot = { kind: "pivot", config: { pivotColumn: "private_code", values: [42, 84] } };

  assert.equal(isProtectedAgentValue(protectComposeConfigForAgent(privateFilter, schema).conditions[0].value), true);
  assert.equal(protectComposeConfigForAgent(publicFilter, schema).conditions[0].value, "READY");
  assert.equal(protectComposeConfigForAgent(pivot, schema).values.every(isProtectedAgentValue), true);
});

test("protected Compose values can only be restored against the existing operation", () => {
  const existing = { id: "filter-a", kind: "filter-rows", inputIds: ["prepared-a"], config: { conditions: [{ column: "private_code", operator: "equals", value: 42 }] } };
  const marker = protectComposeConfigForAgent(existing, [{ name: "private_code", type: "BIGINT", semantic: { sensitivity: "internal" } }]).conditions[0].value;
  const restored = restoreProtectedComposeOperation({ kind: "filter-rows", inputId: "prepared-a", column: "private_code", operator: "equals", value: marker }, existing);
  assert.equal(restored.value, 42);
  assert.throws(() => restoreProtectedComposeOperation({ kind: "filter-rows", column: "public_status", operator: "equals", value: marker }, existing), /binding changed/);
  assert.throws(() => restoreProtectedComposeOperation({ kind: "filter-rows", column: "private_code", operator: "equals", value: marker }), /cannot be restored/);
});

test("agent recipe reads protect formula and legacy calculation literals while preserving reversible edits", () => {
  const recipe = [
    { id: "formula-a", type: "calculated-field", enabled: true, params: { outputColumn: "flag", expression: "if([status] = 'PRIVATE-CODE', 1, 0)", expressionVersion: 1 } },
    { id: "legacy-a", type: "conditional-column", enabled: true, params: { column: "status", operator: "=", value: "PRIVATE-CODE", thenValue: "Alice", elseValue: "Other", newName: "bucket" } },
  ];
  const protectedRecipe = protectRecipeForAgent(recipe, [{ name: "status", type: "VARCHAR", semantic: { sensitivity: "pii" } }]);
  assert.equal(isProtectedAgentValue(protectedRecipe[0].params.expression), true);
  assert.deepEqual(protectedRecipe[0].params.expression.referencedColumns, ["status"]);
  assert.equal(isProtectedAgentValue(protectedRecipe[1].params.value), true);
  assert.equal(isProtectedAgentValue(protectedRecipe[1].params.thenValue), true);
  assert.equal(isProtectedAgentValue(protectedRecipe[1].params.elseValue), true);
  assert.deepEqual(restoreProtectedRecipeValues(protectedRecipe, recipe), recipe);
  const movedMarker = structuredClone(protectedRecipe);
  movedMarker[1].params.column = "public_status";
  assert.throws(() => restoreProtectedRecipeValues(movedMarker, recipe), /binding changed/);
  assert.throws(() => restoreProtectedRecipeValues(protectedRecipe, []), /cannot be restored/);
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
