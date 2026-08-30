import assert from "node:assert/strict";
import test from "node:test";
import {
  createCodingBatch,
  createCodingProject,
  getCodingProgress,
  grantCodingAccess,
  materializeAcceptedCodingRows,
  reviewCodingAssignment,
  submitCodingSuggestions,
  updateCodingProject,
} from "../src/qualitativeCoding.js";

function projectFixture() {
  return createCodingProject({
    preparedId: "prepared-survey",
    name: "Employee responses",
    responseIdColumn: "response_id",
    responseTextColumn: "answer",
    questionColumn: "question",
    codes: [{ id: "communication", label: "Communication", definition: "Information is late or unclear.", include: "Mentions missing information", exclude: "Application errors" }],
  });
}

test("qualitative coding requires stable identity and separate response text", () => {
  assert.throws(() => createCodingProject({ preparedId: "prepared", responseTextColumn: "answer" }), /stable response ID/i);
  const project = projectFixture();
  assert.equal(project.responseIdColumn, "response_id");
  assert.equal(project.assignments.length, 0);
  assert.equal(project.codebookRevision, 1);
});

test("codebook changes advance their own revision without replacing project identity", () => {
  const project = projectFixture();
  const updated = updateCodingProject(project, { codes: [...project.codes, { label: "Application", definition: "System failures" }] });
  assert.equal(updated.id, project.id);
  assert.equal(updated.codebookRevision, 2);
  assert.equal(updated.codes.length, 2);
});

test("codebook changes invalidate pending AI suggestions without rewriting reviewed decisions", async () => {
  const project = grantCodingAccess(projectFixture());
  const batch = await createCodingBatch(project, [{ response_id: "R001", answer: "Informasi terlambat", question: "Keluhan" }]);
  const submitted = await submitCodingSuggestions(project, batch, [{
    responseRef: batch.items[0].responseRef,
    codeIds: ["communication"],
    evidence: batch.items[0].text,
    confidence: 0.8,
  }]);
  const updated = updateCodingProject(submitted, {
    codes: [...submitted.codes, { label: "Application", definition: "System failures" }],
  });
  assert.equal(updated.assignments[0].status, "rejected");
  assert.equal(updated.assignments[0].reviewedBy, "system");
  assert.equal(updated.assignments[0].reviewReason, "codebook-changed");
});

test("approved coding batches pseudonymize direct identifiers and expose response references", async () => {
  const project = grantCodingAccess(projectFixture());
  const batch = await createCodingBatch(project, [{ response_id: "R001", answer: "Hubungi saya di jane@example.com atau 0812 3456 7890 karena info terlambat", question: "Saran" }]);
  assert.equal(batch.items.length, 1);
  assert.match(batch.items[0].text, /\[email\]/);
  assert.match(batch.items[0].text, /\[phone\]/);
  assert.equal(batch.items[0].text.includes("jane@example.com"), false);
  assert.notEqual(batch.items[0].responseRef, "R001");
  assert.equal(batch.items[0].responseId, "R001");
});

test("AI suggestions require exact evidence and remain pending until human review", async () => {
  const project = grantCodingAccess(projectFixture());
  const batch = await createCodingBatch(project, [{ response_id: "R001", answer: "Informasi dari atasan sering terlambat", question: "Keluhan" }]);
  await assert.rejects(
    submitCodingSuggestions(project, batch, [{ responseRef: batch.items[0].responseRef, codeIds: ["communication"], evidence: "kutipan palsu", confidence: 0.8 }]),
    (error) => error.code === "INVALID_CODING_EVIDENCE",
  );
  const submitted = await submitCodingSuggestions(project, batch, [{
    responseRef: batch.items[0].responseRef,
    codeIds: ["communication"],
    evidence: "Informasi dari atasan sering terlambat",
    confidence: 0.84,
    rationale: "The response from jane@example.com explicitly describes late information.",
  }]);
  assert.equal(submitted.assignments[0].status, "pending-review");
  assert.equal(submitted.assignments[0].rationale.includes("jane@example.com"), false);
  assert.match(submitted.assignments[0].rationale, /\[email\]/);
  const accepted = reviewCodingAssignment(submitted, submitted.assignments[0].id, "accepted");
  assert.equal(accepted.assignments[0].reviewedBy, "human");
  assert.equal(getCodingProgress(accepted, 4).coverage, 0.25);
});

test("materialized qualitative results contain only human-accepted structured assignments", async () => {
  const project = grantCodingAccess(projectFixture());
  const batch = await createCodingBatch(project, [
    { response_id: "R001", answer: "Informasi terlambat", question: "Keluhan" },
    { response_id: "R002", answer: "Informasi cukup jelas", question: "Keluhan" },
  ]);
  let submitted = await submitCodingSuggestions(project, batch, batch.items.map((item) => ({
    responseRef: item.responseRef,
    codeIds: ["communication"],
    evidence: item.text,
    confidence: 0.7,
  })));
  submitted = reviewCodingAssignment(submitted, submitted.assignments[0].id, "accepted");
  submitted = reviewCodingAssignment(submitted, submitted.assignments[1].id, "rejected");
  const rows = materializeAcceptedCodingRows(submitted);
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0]), ["response_id", "code_id", "code", "confidence", "uncertain", "review_status", "evidence_hash", "coding_project_id", "codebook_revision"]);
  assert.equal(JSON.stringify(rows).includes("Informasi terlambat"), false);
  assert.equal(rows[0].review_status, "accepted");
});
