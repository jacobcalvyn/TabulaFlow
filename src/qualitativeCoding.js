export const CODING_PROJECT_VERSION = 1;
export const CODING_BATCH_LIMIT = 50;
export const CODING_ACCESS_TTL_MS = 30 * 60 * 1000;

const ASSIGNMENT_STATUSES = new Set(["pending-review", "accepted", "rejected"]);

function createId(prefix) {
  const value = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${value}`;
}

function cleanText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function cleanOptionalText(value) {
  const text = cleanText(value);
  return text || null;
}

function normalizeCode(code, index = 0) {
  return {
    id: cleanText(code?.id, createId("code")),
    label: cleanText(code?.label, `Code ${index + 1}`),
    definition: cleanText(code?.definition),
    include: cleanText(code?.include),
    exclude: cleanText(code?.exclude),
    active: code?.active !== false,
  };
}

export function createCodingProject({
  preparedId,
  name,
  responseIdColumn,
  responseTextColumn,
  questionColumn = null,
  codes = [],
} = {}) {
  if (!cleanText(preparedId)) throw new Error("A prepared dataset is required.");
  if (!cleanText(responseIdColumn)) throw new Error("A stable response ID column is required.");
  if (!cleanText(responseTextColumn)) throw new Error("A response text column is required.");
  const now = new Date().toISOString();
  return {
    version: CODING_PROJECT_VERSION,
    id: createId("coding"),
    preparedId: cleanText(preparedId),
    name: cleanText(name, "Qualitative coding"),
    responseIdColumn: cleanText(responseIdColumn),
    responseTextColumn: cleanText(responseTextColumn),
    questionColumn: cleanOptionalText(questionColumn),
    codebookRevision: 1,
    codes: codes.map(normalizeCode),
    assignments: [],
    accessGrant: null,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    materializedPreparedId: null,
  };
}

export function normalizeCodingProject(project) {
  const normalized = {
    ...project,
    version: CODING_PROJECT_VERSION,
    codes: (project?.codes ?? []).map(normalizeCode),
    assignments: (project?.assignments ?? []).filter((assignment) => ASSIGNMENT_STATUSES.has(assignment.status)),
    accessGrant: project?.accessGrant ?? null,
    revision: Math.max(1, Number(project?.revision) || 1),
    codebookRevision: Math.max(1, Number(project?.codebookRevision) || 1),
    materializedPreparedId: project?.materializedPreparedId ?? null,
  };
  if (!normalized.id || !normalized.preparedId || !normalized.responseIdColumn || !normalized.responseTextColumn) {
    throw new Error("Coding project metadata is incomplete.");
  }
  return normalized;
}

export function updateCodingProject(project, changes = {}) {
  const current = normalizeCodingProject(project);
  const codes = changes.codes ? changes.codes.map(normalizeCode) : current.codes;
  const codebookChanged = JSON.stringify(codes) !== JSON.stringify(current.codes);
  const updatedAt = new Date().toISOString();
  const assignments = codebookChanged
    ? current.assignments.map((assignment) => assignment.status === "pending-review"
      ? {
          ...assignment,
          status: "rejected",
          reviewedBy: "system",
          reviewedAt: updatedAt,
          reviewReason: "codebook-changed",
        }
      : assignment)
    : current.assignments;
  return {
    ...current,
    ...changes,
    id: current.id,
    preparedId: current.preparedId,
    responseIdColumn: cleanText(changes.responseIdColumn ?? current.responseIdColumn),
    responseTextColumn: cleanText(changes.responseTextColumn ?? current.responseTextColumn),
    questionColumn: cleanOptionalText(changes.questionColumn ?? current.questionColumn),
    codes,
    assignments,
    codebookRevision: codebookChanged ? current.codebookRevision + 1 : current.codebookRevision,
    revision: current.revision + 1,
    updatedAt,
  };
}

export function grantCodingAccess(project, { ttlMs = CODING_ACCESS_TTL_MS, purpose = "qualitative-coding" } = {}) {
  const current = normalizeCodingProject(project);
  const issuedAt = Date.now();
  return {
    ...current,
    accessGrant: {
      id: createId("coding-grant"),
      purpose,
      issuedAt: new Date(issuedAt).toISOString(),
      expiresAt: new Date(issuedAt + Math.max(60_000, Number(ttlMs) || CODING_ACCESS_TTL_MS)).toISOString(),
    },
    revision: current.revision + 1,
    updatedAt: new Date().toISOString(),
  };
}

export function revokeCodingAccess(project) {
  const current = normalizeCodingProject(project);
  return { ...current, accessGrant: null, revision: current.revision + 1, updatedAt: new Date().toISOString() };
}

export function hasActiveCodingAccess(project, now = Date.now()) {
  const expiresAt = Date.parse(project?.accessGrant?.expiresAt ?? "");
  return Boolean(project?.accessGrant?.id && Number.isFinite(expiresAt) && expiresAt > now);
}

export function redactQualitativeText(value) {
  return String(value ?? "")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/(?:\+?62|0)[\s().-]*(?:\d[\s().-]*){8,13}\b/g, "[phone]")
    .replace(/\b(?:\d[ -]*?){12,19}\b/g, "[long-id]")
    .trim();
}

export async function hashCodingText(value) {
  const bytes = new TextEncoder().encode(String(value ?? ""));
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  let hash = 2166136261;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619);
  return `fallback-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export async function createCodingBatch(project, rows, { offset = 0, limit = CODING_BATCH_LIMIT } = {}) {
  const current = normalizeCodingProject(project);
  if (!hasActiveCodingAccess(current)) {
    const error = new Error("Human approval is required before response text can be shared with an AI agent.");
    error.code = "CODING_ACCESS_REQUIRED";
    throw error;
  }
  const batchId = createId("coding-batch");
  const selected = rows.slice(Math.max(0, offset), Math.max(0, offset) + Math.min(CODING_BATCH_LIMIT, Math.max(1, limit)));
  const internalItems = await Promise.all(selected.map(async (row) => {
    const responseId = cleanText(row?.[current.responseIdColumn]);
    if (!responseId) return null;
    const text = redactQualitativeText(row?.[current.responseTextColumn]);
    if (!text) return null;
    const question = current.questionColumn ? redactQualitativeText(row?.[current.questionColumn]) : null;
    const textHash = await hashCodingText(text);
    const responseRef = createId("response-ref");
    return { responseRef, responseId, text, question, textHash };
  }));
  return {
    batchId,
    projectId: current.id,
    projectRevision: current.revision,
    codebookRevision: current.codebookRevision,
    grantId: current.accessGrant.id,
    expiresAt: current.accessGrant.expiresAt,
    items: internalItems.filter(Boolean),
  };
}

function evidenceRange(text, evidence) {
  const quote = cleanText(evidence);
  if (!quote) return null;
  const start = text.indexOf(quote);
  if (start < 0) return null;
  return { quote, start, end: start + quote.length };
}

export async function submitCodingSuggestions(project, batch, submissions, { agent = "webmcp" } = {}) {
  const current = normalizeCodingProject(project);
  if (!hasActiveCodingAccess(current)) {
    const error = new Error("The qualitative coding access grant has expired or was revoked.");
    error.code = "CODING_ACCESS_REQUIRED";
    throw error;
  }
  if (batch.projectId !== current.id || batch.codebookRevision !== current.codebookRevision || batch.grantId !== current.accessGrant?.id) {
    const error = new Error("The coding project or codebook changed after this batch was issued.");
    error.code = "STALE_CODING_BATCH";
    throw error;
  }
  const codes = new Map(current.codes.filter((code) => code.active).map((code) => [code.id, code]));
  const items = new Map(batch.items.map((item) => [item.responseRef, item]));
  const nextAssignments = [];
  for (const submission of submissions ?? []) {
    const item = items.get(submission?.responseRef);
    if (!item) throw Object.assign(new Error("Unknown response reference."), { code: "UNKNOWN_RESPONSE_REF" });
    const textHash = await hashCodingText(item.text);
    if (textHash !== item.textHash) throw Object.assign(new Error("Batch evidence no longer matches its issued text."), { code: "CODING_EVIDENCE_MISMATCH" });
    const requestedCodes = [...new Set(submission?.codeIds ?? [])];
    if (!requestedCodes.length && !submission?.uncertain) {
      throw Object.assign(new Error("Each coding suggestion needs at least one code or must be marked uncertain."), { code: "CODING_CODE_REQUIRED" });
    }
    for (const codeId of requestedCodes) {
      if (!codes.has(codeId)) throw Object.assign(new Error(`Unknown or inactive code: ${codeId}`), { code: "UNKNOWN_CODE" });
    }
    const evidence = evidenceRange(item.text, submission?.evidence);
    if (!evidence) throw Object.assign(new Error("Evidence must be an exact excerpt from the redacted response text."), { code: "INVALID_CODING_EVIDENCE" });
    const confidence = Number(submission?.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      throw Object.assign(new Error("Confidence must be between 0 and 1."), { code: "INVALID_CODING_CONFIDENCE" });
    }
    const evidenceHash = await hashCodingText(evidence.quote);
    for (const codeId of requestedCodes.length ? requestedCodes : [null]) {
      nextAssignments.push({
        id: createId("coding-assignment"),
        responseId: item.responseId,
        codeId,
        evidenceStart: evidence.start,
        evidenceEnd: evidence.end,
        evidenceHash,
        confidence,
        uncertain: Boolean(submission?.uncertain),
        rationale: redactQualitativeText(submission?.rationale).slice(0, 280),
        status: "pending-review",
        suggestedBy: cleanText(agent, "webmcp"),
        reviewedAt: null,
        createdAt: new Date().toISOString(),
      });
    }
  }
  return {
    ...current,
    assignments: [...current.assignments, ...nextAssignments],
    revision: current.revision + 1,
    updatedAt: new Date().toISOString(),
  };
}

export function reviewCodingAssignment(project, assignmentId, decision) {
  if (!new Set(["accepted", "rejected"]).has(decision)) throw new Error("Review decision must be accepted or rejected.");
  const current = normalizeCodingProject(project);
  let found = false;
  const assignments = current.assignments.map((assignment) => {
    if (assignment.id !== assignmentId) return assignment;
    found = true;
    return { ...assignment, status: decision, reviewedBy: "human", reviewedAt: new Date().toISOString() };
  });
  if (!found) throw new Error("Coding assignment was not found.");
  return { ...current, assignments, revision: current.revision + 1, updatedAt: new Date().toISOString() };
}

export function getCodingProgress(project, totalResponses = null) {
  const current = normalizeCodingProject(project);
  const counts = { pending: 0, accepted: 0, rejected: 0, uncertain: 0 };
  const classified = new Set();
  for (const assignment of current.assignments) {
    if (assignment.status === "pending-review") counts.pending += 1;
    else counts[assignment.status] += 1;
    if (assignment.uncertain) counts.uncertain += 1;
    if (assignment.status === "accepted") classified.add(assignment.responseId);
  }
  const population = Number.isFinite(Number(totalResponses)) ? Math.max(0, Number(totalResponses)) : null;
  return {
    ...counts,
    classifiedResponses: classified.size,
    totalResponses: population,
    unclassifiedResponses: population == null ? null : Math.max(0, population - classified.size),
    coverage: population ? classified.size / population : null,
  };
}

export function materializeAcceptedCodingRows(project) {
  const current = normalizeCodingProject(project);
  const codeMap = new Map(current.codes.map((code) => [code.id, code]));
  return current.assignments
    .filter((assignment) => assignment.status === "accepted" && assignment.codeId && codeMap.has(assignment.codeId))
    .map((assignment) => ({
      response_id: assignment.responseId,
      code_id: assignment.codeId,
      code: codeMap.get(assignment.codeId).label,
      confidence: assignment.confidence,
      uncertain: assignment.uncertain,
      review_status: "accepted",
      evidence_hash: assignment.evidenceHash,
      coding_project_id: current.id,
      codebook_revision: current.codebookRevision,
    }));
}

export function codingProjectForAgent(project, totalResponses = null) {
  const current = normalizeCodingProject(project);
  return {
    id: current.id,
    preparedId: current.preparedId,
    name: current.name,
    responseIdColumn: current.responseIdColumn,
    responseTextColumn: current.responseTextColumn,
    questionColumn: current.questionColumn,
    revision: current.revision,
    codebookRevision: current.codebookRevision,
    codes: current.codes.filter((code) => code.active),
    access: {
      active: hasActiveCodingAccess(current),
      purpose: current.accessGrant?.purpose ?? null,
      expiresAt: current.accessGrant?.expiresAt ?? null,
    },
    progress: getCodingProgress(current, totalResponses),
  };
}
