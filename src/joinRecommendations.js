import { classifyColumnSemantics } from "./dataPrivacy.js";

function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function bigrams(value) {
  const compact = value.replaceAll(" ", "");
  if (compact.length < 2) return new Set(compact ? [compact] : []);
  return new Set(Array.from({ length: compact.length - 1 }, (_, index) => compact.slice(index, index + 2)));
}

function dice(left, right) {
  const leftSet = bigrams(left);
  const rightSet = bigrams(right);
  if (!leftSet.size && !rightSet.size) return 1;
  let overlap = 0;
  for (const item of leftSet) if (rightSet.has(item)) overlap += 1;
  return (2 * overlap) / Math.max(1, leftSet.size + rightSet.size);
}

function tokenJaccard(left, right) {
  const leftTokens = new Set(left.split(" ").filter(Boolean));
  const rightTokens = new Set(right.split(" ").filter(Boolean));
  const union = new Set([...leftTokens, ...rightTokens]);
  if (!union.size) return 1;
  let overlap = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) overlap += 1;
  return overlap / union.size;
}

export function joinNameSimilarity(leftName, rightName) {
  if (leftName === rightName) return 1;
  const left = normalizeName(leftName);
  const right = normalizeName(rightName);
  if (left === right) return 0.98;
  return Number((tokenJaccard(left, right) * 0.55 + dice(left, right) * 0.45).toFixed(4));
}

function normalizeType(type) {
  return String(type ?? "").toUpperCase().replace(/\s+/g, " ").trim();
}

export function buildJoinKeyCandidates(leftSchema = [], rightSchema = [], { limit = 32 } = {}) {
  const candidates = [];
  let compatiblePairCount = 0;
  for (const left of leftSchema) {
    for (const right of rightSchema) {
      if (normalizeType(left.type) !== normalizeType(right.type)) continue;
      compatiblePairCount += 1;
      const leftRole = left.semantic?.role ?? left.semanticRole ?? classifyColumnSemantics(left.name, left.type).semanticRole;
      const rightRole = right.semantic?.role ?? right.semanticRole ?? classifyColumnSemantics(right.name, right.type).semanticRole;
      const normalizedExactName = normalizeName(left.name) === normalizeName(right.name);
      candidates.push({
        left: left.name,
        right: right.name,
        type: left.type,
        compatible: true,
        exactName: left.name === right.name,
        normalizedExactName,
        semanticIdentifier: leftRole === "identifier" && rightRole === "identifier",
        nameScore: joinNameSimilarity(left.name, right.name),
      });
    }
  }
  candidates.sort((left, right) => Number(right.exactName) - Number(left.exactName)
    || Number(right.normalizedExactName) - Number(left.normalizedExactName)
    || Number(right.semanticIdentifier) - Number(left.semanticIdentifier)
    || right.nameScore - left.nameScore
    || left.left.localeCompare(right.left)
    || left.right.localeCompare(right.right));
  return { compatiblePairCount, candidates: candidates.slice(0, Math.max(1, limit)) };
}

function columnQuality(stat = {}) {
  const uniqueness = Number.isFinite(stat.uniquenessRatio) ? stat.uniquenessRatio : 0;
  const completeness = Number.isFinite(stat.nullRatio) ? 1 - stat.nullRatio : 0;
  const population = Number(stat.totalRowCount ?? stat.rowCount ?? 0);
  const populationScore = population >= 20 ? 1 : population / 20;
  const extremeNullPenalty = completeness < 0.2 ? completeness * 0.25 : 1;
  return Math.max(0, Math.min(1, (uniqueness * 0.62 + completeness * 0.28 + populationScore * 0.1) * extremeNullPenalty));
}

export function rankJoinKeyCandidates(candidates, leftStats = new Map(), rightStats = new Map(), { limit = 12 } = {}) {
  return candidates.map((candidate) => {
    const leftQuality = columnQuality(leftStats.get(candidate.left));
    const rightQuality = columnQuality(rightStats.get(candidate.right));
    const dataQualityScore = (leftQuality + rightQuality) / 2;
    const semanticScore = candidate.semanticIdentifier ? 1 : 0;
    const exactScore = candidate.exactName ? 1 : candidate.normalizedExactName ? 0.94 : candidate.nameScore;
    const score = Math.min(1, exactScore * 0.52 + semanticScore * 0.22 + dataQualityScore * 0.26);
    return {
      ...candidate,
      score: Number(score.toFixed(4)),
      uniqueness: {
        left: leftStats.get(candidate.left)?.uniquenessRatio ?? null,
        right: rightStats.get(candidate.right)?.uniquenessRatio ?? null,
      },
      nullRatio: {
        left: leftStats.get(candidate.left)?.nullRatio ?? null,
        right: rightStats.get(candidate.right)?.nullRatio ?? null,
      },
    };
  }).sort((left, right) => right.score - left.score
    || Number(right.exactName) - Number(left.exactName)
    || Number(right.normalizedExactName) - Number(left.normalizedExactName)
    || Number(right.semanticIdentifier) - Number(left.semanticIdentifier)
    || left.left.localeCompare(right.left)
    || left.right.localeCompare(right.right))
    .slice(0, Math.max(1, limit));
}
