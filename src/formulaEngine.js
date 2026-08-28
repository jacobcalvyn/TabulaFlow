export const FORMULA_EXPRESSION_VERSION = 1;
export const FORMULA_MAX_LENGTH = 10000;
const FORMULA_MAX_TOKENS = 512;

const CAST_TYPES = new Set(["VARCHAR", "BIGINT", "DOUBLE", "BOOLEAN", "DATE", "TIMESTAMP"]);
const NUMERIC_TYPES = new Set(["BIGINT", "DOUBLE"]);
const STRING_FUNCTIONS = Object.freeze({
  trim: { min: 1, max: 1, returnType: "VARCHAR" },
  upper: { min: 1, max: 1, returnType: "VARCHAR" },
  lower: { min: 1, max: 1, returnType: "VARCHAR" },
  length: { min: 1, max: 1, returnType: "BIGINT" },
  substring: { min: 2, max: 3, returnType: "VARCHAR" },
  replace: { min: 3, max: 3, returnType: "VARCHAR" },
  concat: { min: 2, max: Number.POSITIVE_INFINITY, returnType: "VARCHAR" },
});

export const CALCULATION_CATALOG = Object.freeze({
  expressionVersion: FORMULA_EXPRESSION_VERSION,
  syntax: {
    columnReference: "[Column name]",
    conditional: "CASE WHEN condition THEN value ELSE value END",
    nullChecks: ["IS NULL", "IS NOT NULL"],
    operators: ["+", "-", "*", "/", "%", "=", "!=", "<>", ">", ">=", "<", "<=", "AND", "OR", "NOT"],
  },
  functions: [
    { name: "if", signature: "if(condition, value, fallback)", description: "Choose a value from a condition." },
    { name: "coalesce", signature: "coalesce(value, fallback, ...)", description: "Return the first non-null value." },
    { name: "ifnull", signature: "ifnull(value, fallback)", description: "Return a fallback when a value is null." },
    { name: "trim", signature: "trim(text)", description: "Remove surrounding whitespace." },
    { name: "upper", signature: "upper(text)", description: "Convert text to uppercase." },
    { name: "lower", signature: "lower(text)", description: "Convert text to lowercase." },
    { name: "length", signature: "length(text)", description: "Count characters in text." },
    { name: "substring", signature: "substring(text, start[, length])", description: "Extract part of a text value." },
    { name: "replace", signature: "replace(text, from, to)", description: "Replace literal text." },
    { name: "concat", signature: "concat(value, value, ...)", description: "Join values as text." },
    { name: "cast", signature: "cast(value AS TYPE)", description: "Convert a value and fail the step on invalid input." },
    { name: "try_cast", signature: "try_cast(value AS TYPE)", description: "Convert a value and return null on invalid input." },
  ],
  castTypes: [...CAST_TYPES],
  examples: [
    { label: "Category", expression: "CASE WHEN [Amount] >= 1000 THEN 'High' ELSE 'Standard' END" },
    { label: "Clean label", expression: "upper(trim([Category]))" },
    { label: "Safe number", expression: "try_cast([Amount text] AS DOUBLE)" },
  ],
});

class FormulaError extends Error {
  constructor(message, start = 0, end = start + 1, code = "INVALID_FORMULA") {
    super(message);
    this.name = "FormulaError";
    this.code = code;
    this.start = start;
    this.end = Math.max(end, start + 1);
  }
}

function tokenize(input) {
  const source = String(input ?? "");
  const tokens = [];
  let index = 0;
  const push = (type, value, start, end = index) => {
    if (tokens.length >= FORMULA_MAX_TOKENS) throw new FormulaError(`Formula can contain at most ${FORMULA_MAX_TOKENS} tokens.`, start, end, "FORMULA_TOO_COMPLEX");
    tokens.push({ type, value, start, end });
  };

  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    const start = index;
    if (char === "[") {
      index += 1;
      let value = "";
      let closed = false;
      while (index < source.length) {
        if (source[index] === "]" && source[index + 1] === "]") {
          value += "]";
          index += 2;
        } else if (source[index] === "]") {
          index += 1;
          closed = true;
          break;
        } else {
          value += source[index];
          index += 1;
        }
      }
      if (!closed) throw new FormulaError("Column reference is missing a closing ].", start, source.length, "UNTERMINATED_COLUMN");
      if (!value) throw new FormulaError("Column reference cannot be empty.", start, index, "EMPTY_COLUMN");
      push("column", value, start);
      continue;
    }
    if (char === "'") {
      index += 1;
      let value = "";
      let closed = false;
      while (index < source.length) {
        if (source[index] === "'" && source[index + 1] === "'") {
          value += "'";
          index += 2;
        } else if (source[index] === "'") {
          index += 1;
          closed = true;
          break;
        } else {
          value += source[index];
          index += 1;
        }
      }
      if (!closed) throw new FormulaError("String literal is missing a closing quote.", start, source.length, "UNTERMINATED_STRING");
      push("string", value, start);
      continue;
    }
    if (/\d/.test(char) || (char === "." && /\d/.test(source[index + 1] ?? ""))) {
      const match = source.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i);
      index += match[0].length;
      const value = Number(match[0]);
      if (!Number.isFinite(value)) throw new FormulaError("Number literal must be finite.", start, index, "INVALID_NUMBER");
      push("number", value, start);
      continue;
    }
    if (/[A-Za-z_]/.test(char)) {
      const match = source.slice(index).match(/^[A-Za-z_][A-Za-z0-9_]*/);
      index += match[0].length;
      push("identifier", match[0], start);
      continue;
    }
    const two = source.slice(index, index + 2);
    if ([">=", "<=", "!=", "<>"].includes(two)) {
      index += 2;
      push("operator", two, start);
      continue;
    }
    if (["+", "-", "*", "/", "%", "=", ">", "<"].includes(char)) {
      index += 1;
      push("operator", char, start);
      continue;
    }
    if (["(", ")", ","].includes(char)) {
      index += 1;
      push("punctuation", char, start);
      continue;
    }
    throw new FormulaError(`Unexpected character "${char}".`, start, start + 1, "UNEXPECTED_CHARACTER");
  }
  tokens.push({ type: "eof", value: "", start: source.length, end: source.length });
  return tokens;
}

const BINARY_PRECEDENCE = Object.freeze({ OR: 1, AND: 2, "=": 3, "!=": 3, "<>": 3, ">": 3, ">=": 3, "<": 3, "<=": 3, "+": 4, "-": 4, "*": 5, "/": 5, "%": 5 });

class Parser {
  constructor(source) {
    this.source = source;
    this.tokens = tokenize(source);
    this.index = 0;
  }

  current() { return this.tokens[this.index]; }
  next() { return this.tokens[this.index++]; }
  isKeyword(value) { return this.current().type === "identifier" && this.current().value.toUpperCase() === value; }
  matchKeyword(value) { if (!this.isKeyword(value)) return false; this.next(); return true; }
  expectKeyword(value) {
    if (!this.matchKeyword(value)) throw new FormulaError(`Expected ${value}.`, this.current().start, this.current().end, "EXPECTED_KEYWORD");
  }
  matchPunctuation(value) {
    if (this.current().type !== "punctuation" || this.current().value !== value) return false;
    this.next();
    return true;
  }
  expectPunctuation(value) {
    if (!this.matchPunctuation(value)) throw new FormulaError(`Expected ${value}.`, this.current().start, this.current().end, "EXPECTED_PUNCTUATION");
  }

  parse() {
    if (this.current().type === "eof") throw new FormulaError("Formula cannot be empty.", 0, 1, "EMPTY_FORMULA");
    const expression = this.parseExpression();
    if (this.current().type !== "eof") throw new FormulaError(`Unexpected token "${this.current().value}".`, this.current().start, this.current().end, "UNEXPECTED_TOKEN");
    return expression;
  }

  parseExpression(minimumPrecedence = 0) {
    let left = this.parsePrefix();
    while (true) {
      if (this.isKeyword("IS")) {
        const precedence = 3;
        if (precedence < minimumPrecedence) break;
        const start = left.start;
        this.next();
        const negate = this.matchKeyword("NOT");
        this.expectKeyword("NULL");
        left = { kind: "is-null", value: left, negate, start, end: this.tokens[this.index - 1].end };
        continue;
      }
      const token = this.current();
      const operator = token.type === "operator" ? token.value : token.type === "identifier" ? token.value.toUpperCase() : null;
      const precedence = BINARY_PRECEDENCE[operator];
      if (!precedence || precedence < minimumPrecedence) break;
      this.next();
      const right = this.parseExpression(precedence + 1);
      left = { kind: "binary", operator, left, right, start: left.start, end: right.end };
    }
    return left;
  }

  parsePrefix() {
    const token = this.current();
    if (token.type === "operator" && ["+", "-"].includes(token.value)) {
      this.next();
      const value = this.parseExpression(6);
      return { kind: "unary", operator: token.value, value, start: token.start, end: value.end };
    }
    if (this.matchKeyword("NOT")) {
      const value = this.parseExpression(6);
      return { kind: "unary", operator: "NOT", value, start: token.start, end: value.end };
    }
    if (this.matchKeyword("CASE")) return this.parseCase(token.start);
    if (token.type === "number" || token.type === "string") {
      this.next();
      return { kind: "literal", value: token.value, literalType: token.type, start: token.start, end: token.end };
    }
    if (token.type === "column") {
      this.next();
      return { kind: "column", name: token.value, start: token.start, end: token.end };
    }
    if (token.type === "identifier") {
      this.next();
      const upper = token.value.toUpperCase();
      if (["TRUE", "FALSE", "NULL"].includes(upper)) {
        return { kind: "literal", value: upper === "NULL" ? null : upper === "TRUE", literalType: upper.toLowerCase(), start: token.start, end: token.end };
      }
      if (!this.matchPunctuation("(")) throw new FormulaError(`Use [${token.value}] to reference a column.`, token.start, token.end, "BARE_IDENTIFIER");
      return this.parseFunction(token);
    }
    if (this.matchPunctuation("(")) {
      const value = this.parseExpression();
      this.expectPunctuation(")");
      return { ...value, start: token.start, end: this.tokens[this.index - 1].end };
    }
    throw new FormulaError("Expected a value, column, function, or CASE expression.", token.start, token.end, "EXPECTED_EXPRESSION");
  }

  parseCase(start) {
    const branches = [];
    while (this.matchKeyword("WHEN")) {
      const condition = this.parseExpression();
      this.expectKeyword("THEN");
      const value = this.parseExpression();
      branches.push({ condition, value });
    }
    if (!branches.length) throw new FormulaError("CASE requires at least one WHEN branch.", start, this.current().end, "EMPTY_CASE");
    const fallback = this.matchKeyword("ELSE") ? this.parseExpression() : null;
    this.expectKeyword("END");
    return { kind: "case", branches, fallback, start, end: this.tokens[this.index - 1].end };
  }

  parseFunction(token) {
    const name = token.value.toLowerCase();
    if (name === "cast" || name === "try_cast") {
      const value = this.parseExpression();
      this.expectKeyword("AS");
      const typeToken = this.next();
      if (typeToken.type !== "identifier") throw new FormulaError("CAST requires a target type.", typeToken.start, typeToken.end, "INVALID_CAST_TYPE");
      const targetType = typeToken.value.toUpperCase();
      if (!CAST_TYPES.has(targetType)) throw new FormulaError(`Unsupported target type "${typeToken.value}".`, typeToken.start, typeToken.end, "INVALID_CAST_TYPE");
      this.expectPunctuation(")");
      return { kind: "cast", value, targetType, safe: name === "try_cast", start: token.start, end: this.tokens[this.index - 1].end };
    }
    const args = [];
    if (!this.matchPunctuation(")")) {
      do args.push(this.parseExpression()); while (this.matchPunctuation(","));
      this.expectPunctuation(")");
    }
    return { kind: "call", name, args, start: token.start, end: this.tokens[this.index - 1].end };
  }
}

function normalizeType(type) {
  const value = String(type ?? "UNKNOWN").toUpperCase();
  if (/^(TINYINT|SMALLINT|INTEGER|BIGINT|HUGEINT|UTINYINT|USMALLINT|UINTEGER|UBIGINT)$/.test(value)) return "BIGINT";
  if (/^(DECIMAL|NUMERIC|REAL|FLOAT|DOUBLE)/.test(value)) return "DOUBLE";
  if (/^(VARCHAR|CHAR|TEXT|STRING|JSON)/.test(value)) return "VARCHAR";
  if (/^BOOL/.test(value)) return "BOOLEAN";
  if (/^TIMESTAMP/.test(value)) return "TIMESTAMP";
  if (value === "DATE") return "DATE";
  if (value === "NULL") return "NULL";
  return "UNKNOWN";
}

function commonType(types, node) {
  const concrete = [...new Set(types.filter((type) => type !== "NULL" && type !== "UNKNOWN"))];
  if (!concrete.length) return types.includes("UNKNOWN") ? "UNKNOWN" : "NULL";
  if (concrete.every((type) => NUMERIC_TYPES.has(type))) return concrete.includes("DOUBLE") ? "DOUBLE" : "BIGINT";
  if (concrete.length === 1) return concrete[0];
  throw new FormulaError(`Expression mixes incompatible types: ${concrete.join(" and ")}.`, node.start, node.end, "TYPE_MISMATCH");
}

function requireBoolean(type, node) {
  if (!["BOOLEAN", "UNKNOWN", "NULL"].includes(type)) throw new FormulaError("Condition must return BOOLEAN.", node.start, node.end, "TYPE_MISMATCH");
}

function requireNumeric(type, node) {
  if (!NUMERIC_TYPES.has(type) && type !== "UNKNOWN" && type !== "NULL") throw new FormulaError("Arithmetic operands must be numeric.", node.start, node.end, "TYPE_MISMATCH");
}

function analyze(ast, schema) {
  const exact = new Map(schema.map((column) => [column.name, column]));
  const referenced = [];
  const visit = (node) => {
    if (node.kind === "literal") {
      if (node.literalType === "number") return Number.isInteger(node.value) ? "BIGINT" : "DOUBLE";
      if (node.literalType === "string") return "VARCHAR";
      if (node.literalType === "true" || node.literalType === "false") return "BOOLEAN";
      return "NULL";
    }
    if (node.kind === "column") {
      const column = exact.get(node.name);
      if (!column) throw new FormulaError(`Column "${node.name}" does not exist.`, node.start, node.end, "UNKNOWN_COLUMN");
      if (!referenced.includes(node.name)) referenced.push(node.name);
      return normalizeType(column.type);
    }
    if (node.kind === "unary") {
      const type = visit(node.value);
      if (node.operator === "NOT") { requireBoolean(type, node.value); return "BOOLEAN"; }
      requireNumeric(type, node.value);
      return type;
    }
    if (node.kind === "is-null") { visit(node.value); return "BOOLEAN"; }
    if (node.kind === "binary") {
      const left = visit(node.left);
      const right = visit(node.right);
      if (["AND", "OR"].includes(node.operator)) { requireBoolean(left, node.left); requireBoolean(right, node.right); return "BOOLEAN"; }
      if (["=", "!=", "<>", ">", ">=", "<", "<="].includes(node.operator)) { commonType([left, right], node); return "BOOLEAN"; }
      requireNumeric(left, node.left);
      requireNumeric(right, node.right);
      return node.operator === "/" ? "DOUBLE" : commonType([left, right], node);
    }
    if (node.kind === "case") {
      const values = node.branches.map((branch) => { requireBoolean(visit(branch.condition), branch.condition); return visit(branch.value); });
      if (node.fallback) values.push(visit(node.fallback));
      else values.push("NULL");
      return commonType(values, node);
    }
    if (node.kind === "cast") { visit(node.value); return node.targetType; }
    if (node.kind === "call") {
      const argTypes = node.args.map(visit);
      if (node.name === "if") {
        if (node.args.length !== 3) throw new FormulaError("if expects 3 arguments.", node.start, node.end, "INVALID_ARGUMENT_COUNT");
        requireBoolean(argTypes[0], node.args[0]);
        return commonType(argTypes.slice(1), node);
      }
      if (node.name === "coalesce" || node.name === "ifnull") {
        const expected = node.name === "ifnull" ? [2, 2] : [2, Number.POSITIVE_INFINITY];
        if (node.args.length < expected[0] || node.args.length > expected[1]) throw new FormulaError(`${node.name} expects ${expected[0]}${Number.isFinite(expected[1]) ? "" : " or more"} arguments.`, node.start, node.end, "INVALID_ARGUMENT_COUNT");
        return commonType(argTypes, node);
      }
      const definition = STRING_FUNCTIONS[node.name];
      if (!definition) throw new FormulaError(`Function "${node.name}" is not supported.`, node.start, node.end, "UNSUPPORTED_FUNCTION");
      if (node.args.length < definition.min || node.args.length > definition.max) throw new FormulaError(`${node.name} expects ${definition.min}${definition.max !== definition.min ? `-${definition.max}` : ""} arguments.`, node.start, node.end, "INVALID_ARGUMENT_COUNT");
      if (node.name === "substring") {
        requireNumeric(argTypes[1], node.args[1]);
        if (node.args[2]) requireNumeric(argTypes[2], node.args[2]);
      }
      return definition.returnType;
    }
    throw new FormulaError("Unsupported expression node.", node.start, node.end);
  };
  return { inferredType: visit(ast), referencedColumns: referenced };
}

function quoteIdentifier(identifier) {
  return `"${String(identifier).replaceAll('"', '""')}"`;
}

function quoteString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function compileAst(node) {
  if (node.kind === "literal") {
    if (node.value === null) return "NULL";
    if (typeof node.value === "boolean") return node.value ? "TRUE" : "FALSE";
    if (typeof node.value === "number") return String(node.value);
    return quoteString(node.value);
  }
  if (node.kind === "column") return quoteIdentifier(node.name);
  if (node.kind === "unary") return `(${node.operator} ${compileAst(node.value)})`;
  if (node.kind === "is-null") return `(${compileAst(node.value)} IS ${node.negate ? "NOT " : ""}NULL)`;
  if (node.kind === "binary") return `(${compileAst(node.left)} ${node.operator === "!=" ? "<>" : node.operator} ${compileAst(node.right)})`;
  if (node.kind === "case") {
    const branches = node.branches.map((branch) => `WHEN ${compileAst(branch.condition)} THEN ${compileAst(branch.value)}`).join(" ");
    return `(CASE ${branches}${node.fallback ? ` ELSE ${compileAst(node.fallback)}` : ""} END)`;
  }
  if (node.kind === "cast") return `${node.safe ? "TRY_CAST" : "CAST"}(${compileAst(node.value)} AS ${node.targetType})`;
  if (node.kind === "call") {
    const functionName = node.name === "ifnull" ? "COALESCE" : node.name.toUpperCase();
    return `${functionName}(${node.args.map(compileAst).join(", ")})`;
  }
  throw new FormulaError("Unsupported expression node.", node.start, node.end);
}

function normalizeSchema(schema = []) {
  return schema.map((column) => typeof column === "string" ? { name: column, type: "UNKNOWN" } : { name: String(column?.name ?? ""), type: column?.type ?? "UNKNOWN" });
}

export function parseFormula(expression) {
  const source = String(expression ?? "");
  if (source.length > FORMULA_MAX_LENGTH) throw new FormulaError(`Formula can contain at most ${FORMULA_MAX_LENGTH} characters.`, FORMULA_MAX_LENGTH, source.length, "FORMULA_TOO_LONG");
  return new Parser(source).parse();
}

export function validateFormula(expression, schema = []) {
  try {
    const ast = parseFormula(expression);
    const analysis = analyze(ast, normalizeSchema(schema));
    return { valid: true, diagnostics: [], ast, ...analysis };
  } catch (error) {
    if (!(error instanceof FormulaError)) throw error;
    return {
      valid: false,
      diagnostics: [{ code: error.code, message: error.message, start: error.start, end: error.end }],
      ast: null,
      inferredType: null,
      referencedColumns: [],
    };
  }
}

export function compileFormula(expression, schema = []) {
  const result = validateFormula(expression, schema);
  if (!result.valid) {
    const diagnostic = result.diagnostics[0];
    throw new FormulaError(diagnostic.message, diagnostic.start, diagnostic.end, diagnostic.code);
  }
  return {
    sql: compileAst(result.ast),
    inferredType: result.inferredType,
    referencedColumns: result.referencedColumns,
    ast: result.ast,
  };
}

export function formulaReferencedColumns(expression, schema = []) {
  return compileFormula(expression, schema).referencedColumns;
}

export function getFormulaColumnReferences(expression) {
  const ast = parseFormula(expression);
  const columns = [];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.kind === "column" && !columns.includes(node.name)) columns.push(node.name);
    if (node.value && typeof node.value === "object") visit(node.value);
    if (node.left) visit(node.left);
    if (node.right) visit(node.right);
    if (node.fallback) visit(node.fallback);
    node.args?.forEach(visit);
    node.branches?.forEach((branch) => { visit(branch.condition); visit(branch.value); });
  };
  visit(ast);
  return columns;
}

export function quoteFormulaColumnReference(column) {
  return `[${String(column).replaceAll("]", "]]")}]`;
}
