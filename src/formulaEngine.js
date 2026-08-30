export const FORMULA_EXPRESSION_VERSION = 1;
export const FORMULA_MAX_LENGTH = 10000;
const FORMULA_MAX_TOKENS = 512;

const CAST_TYPES = new Set(["VARCHAR", "BIGINT", "DOUBLE", "BOOLEAN", "DATE", "TIMESTAMP"]);
const NUMERIC_TYPES = new Set(["BIGINT", "DOUBLE"]);
const DATE_PARTS = new Set(["year", "quarter", "month", "week", "day", "hour", "minute", "second"]);
const DATE_ADD_INTERVALS = Object.freeze({
  year: "1 year",
  quarter: "3 months",
  month: "1 month",
  week: "1 week",
  day: "1 day",
  hour: "1 hour",
  minute: "1 minute",
  second: "1 second",
});
const FUNCTION_RULES = Object.freeze({
  trim: { min: 1, max: 1, returnType: "VARCHAR", stringArgs: [0] },
  ltrim: { min: 1, max: 1, returnType: "VARCHAR", stringArgs: [0] },
  rtrim: { min: 1, max: 1, returnType: "VARCHAR", stringArgs: [0] },
  upper: { min: 1, max: 1, returnType: "VARCHAR", stringArgs: [0] },
  lower: { min: 1, max: 1, returnType: "VARCHAR", stringArgs: [0] },
  length: { min: 1, max: 1, returnType: "BIGINT", stringArgs: [0] },
  substring: { min: 2, max: 3, returnType: "VARCHAR", stringArgs: [0], numericArgs: [1, 2] },
  left: { min: 2, max: 2, returnType: "VARCHAR", stringArgs: [0], numericArgs: [1] },
  right: { min: 2, max: 2, returnType: "VARCHAR", stringArgs: [0], numericArgs: [1] },
  replace: { min: 3, max: 3, returnType: "VARCHAR", stringArgs: [0, 1, 2] },
  concat: { min: 2, max: Number.POSITIVE_INFINITY, returnType: "VARCHAR" },
  contains: { min: 2, max: 2, returnType: "BOOLEAN", stringArgs: [0, 1] },
  starts_with: { min: 2, max: 2, returnType: "BOOLEAN", stringArgs: [0, 1] },
  ends_with: { min: 2, max: 2, returnType: "BOOLEAN", stringArgs: [0, 1] },
  split_part: { min: 3, max: 3, returnType: "VARCHAR", stringArgs: [0, 1], numericArgs: [2] },
  lpad: { min: 3, max: 3, returnType: "VARCHAR", stringArgs: [0, 2], numericArgs: [1] },
  rpad: { min: 3, max: 3, returnType: "VARCHAR", stringArgs: [0, 2], numericArgs: [1] },
  repeat: { min: 2, max: 2, returnType: "VARCHAR", stringArgs: [0], numericArgs: [1] },
  reverse: { min: 1, max: 1, returnType: "VARCHAR", stringArgs: [0] },
  abs: { min: 1, max: 1, returnArg: 0, numericArgs: [0] },
  round: { min: 1, max: 2, returnArg: 0, numericArgs: [0, 1] },
  floor: { min: 1, max: 1, returnArg: 0, numericArgs: [0] },
  ceil: { min: 1, max: 1, returnArg: 0, numericArgs: [0] },
  power: { min: 2, max: 2, returnType: "DOUBLE", numericArgs: [0, 1] },
  sqrt: { min: 1, max: 1, returnType: "DOUBLE", numericArgs: [0] },
  sign: { min: 1, max: 1, returnType: "BIGINT", numericArgs: [0] },
  year: { min: 1, max: 1, returnType: "BIGINT", dateArgs: [0] },
  month: { min: 1, max: 1, returnType: "BIGINT", dateArgs: [0] },
  day: { min: 1, max: 1, returnType: "BIGINT", dateArgs: [0] },
  date_trunc: { min: 2, max: 2, returnType: "TIMESTAMP", datePartArg: 0, dateArgs: [1] },
  date_diff: { min: 3, max: 3, returnType: "BIGINT", datePartArg: 0, dateArgs: [1, 2] },
  date_add: { min: 3, max: 3, returnType: "TIMESTAMP", datePartArg: 0, numericArgs: [1], dateArgs: [2] },
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
    { name: "if", signature: "IF(condition, value_if_true, value_if_false)", arguments: ["condition", "value_if_true", "value_if_false"], description: "Choose a value from a condition.", example: "IF([Amount] >= 1000, 'High', 'Standard')" },
    { name: "coalesce", signature: "COALESCE(value1, value2, ...)", arguments: ["value1", "value2", "..."], variadic: true, description: "Return the first non-null value.", example: "COALESCE([Phone], [Mobile], 'Unknown')" },
    { name: "ifnull", signature: "IFNULL(value, fallback)", arguments: ["value", "fallback"], description: "Return a fallback when a value is null.", example: "IFNULL([Discount], 0)" },
    { name: "nullif", signature: "NULLIF(value, match)", arguments: ["value", "match"], description: "Return null when two values match.", example: "NULLIF([Email], '')" },
    { name: "trim", signature: "TRIM(text)", arguments: ["text"], description: "Remove surrounding whitespace.", example: "TRIM([Customer Name])" },
    { name: "ltrim", signature: "LTRIM(text)", arguments: ["text"], description: "Remove whitespace from the left.", example: "LTRIM([Customer Name])" },
    { name: "rtrim", signature: "RTRIM(text)", arguments: ["text"], description: "Remove whitespace from the right.", example: "RTRIM([Customer Name])" },
    { name: "upper", signature: "UPPER(text)", arguments: ["text"], description: "Convert text to uppercase.", example: "UPPER([Service])" },
    { name: "lower", signature: "LOWER(text)", arguments: ["text"], description: "Convert text to lowercase.", example: "LOWER([Email])" },
    { name: "length", signature: "LENGTH(text)", arguments: ["text"], description: "Count characters in text.", example: "LENGTH([Tracking Number])" },
    { name: "substring", signature: "SUBSTRING(text, start, length)", arguments: ["text", "start", "length"], optionalArguments: [2], description: "Extract part of a text value.", example: "SUBSTRING([Tracking Number], 1, 3)" },
    { name: "left", signature: "LEFT(text, count)", arguments: ["text", "count"], description: "Extract characters from the left.", example: "LEFT([Tracking Number], 3)" },
    { name: "right", signature: "RIGHT(text, count)", arguments: ["text", "count"], description: "Extract characters from the right.", example: "RIGHT([Tracking Number], 4)" },
    { name: "replace", signature: "REPLACE(text, from, to)", arguments: ["text", "from", "to"], description: "Replace literal text.", example: "REPLACE([Status], ' ', '_')" },
    { name: "concat", signature: "CONCAT(value1, value2, ...)", arguments: ["value1", "value2", "..."], variadic: true, description: "Join values as text.", example: "CONCAT([First Name], ' ', [Last Name])" },
    { name: "contains", signature: "CONTAINS(text, search)", arguments: ["text", "search"], description: "Check whether text contains a value.", example: "CONTAINS([Notes], 'urgent')" },
    { name: "starts_with", signature: "STARTS_WITH(text, prefix)", arguments: ["text", "prefix"], description: "Check whether text starts with a value.", example: "STARTS_WITH([Tracking Number], 'DCI')" },
    { name: "ends_with", signature: "ENDS_WITH(text, suffix)", arguments: ["text", "suffix"], description: "Check whether text ends with a value.", example: "ENDS_WITH([Filename], '.csv')" },
    { name: "split_part", signature: "SPLIT_PART(text, delimiter, index)", arguments: ["text", "delimiter", "index"], description: "Return one 1-based part of split text.", example: "SPLIT_PART([Email], '@', 2)" },
    { name: "lpad", signature: "LPAD(text, length, fill)", arguments: ["text", "length", "fill"], description: "Pad text on the left to a target length.", example: "LPAD(CAST([Zone] AS VARCHAR), 5, '0')" },
    { name: "rpad", signature: "RPAD(text, length, fill)", arguments: ["text", "length", "fill"], description: "Pad text on the right to a target length.", example: "RPAD([Code], 8, '0')" },
    { name: "repeat", signature: "REPEAT(text, count)", arguments: ["text", "count"], description: "Repeat text a number of times.", example: "REPEAT([Marker], 3)" },
    { name: "reverse", signature: "REVERSE(text)", arguments: ["text"], description: "Reverse the characters in text.", example: "REVERSE([Code])" },
    { name: "abs", signature: "ABS(number)", arguments: ["number"], description: "Return the absolute numeric value.", example: "ABS([Weight Gap])" },
    { name: "round", signature: "ROUND(number, digits)", arguments: ["number", "digits"], optionalArguments: [1], description: "Round a number to decimal digits.", example: "ROUND([Amount], 2)" },
    { name: "floor", signature: "FLOOR(number)", arguments: ["number"], description: "Round a number down.", example: "FLOOR([Weight])" },
    { name: "ceil", signature: "CEIL(number)", arguments: ["number"], description: "Round a number up.", example: "CEIL([Weight])" },
    { name: "greatest", signature: "GREATEST(value1, value2, ...)", arguments: ["value1", "value2", "..."], variadic: true, description: "Return the greatest compatible value.", example: "GREATEST([Actual Weight], [Chargeable Weight])" },
    { name: "least", signature: "LEAST(value1, value2, ...)", arguments: ["value1", "value2", "..."], variadic: true, description: "Return the least compatible value.", example: "LEAST([Actual Weight], [Chargeable Weight])" },
    { name: "power", signature: "POWER(number, exponent)", arguments: ["number", "exponent"], description: "Raise a number to an exponent.", example: "POWER([Length], 2)" },
    { name: "sqrt", signature: "SQRT(number)", arguments: ["number"], description: "Return the square root of a number.", example: "SQRT([Area])" },
    { name: "sign", signature: "SIGN(number)", arguments: ["number"], description: "Return -1, 0, or 1 for a number.", example: "SIGN([Weight Gap])" },
    { name: "year", signature: "YEAR(date)", arguments: ["date"], description: "Return the year from a date or timestamp.", example: "YEAR(TRY_CAST([Created at] AS TIMESTAMP))" },
    { name: "month", signature: "MONTH(date)", arguments: ["date"], description: "Return the month number from a date or timestamp.", example: "MONTH(TRY_CAST([Created at] AS TIMESTAMP))" },
    { name: "day", signature: "DAY(date)", arguments: ["date"], description: "Return the day of month from a date or timestamp.", example: "DAY(TRY_CAST([Created at] AS TIMESTAMP))" },
    { name: "date_trunc", signature: "DATE_TRUNC(part, date)", arguments: ["part", "date"], description: "Truncate a date or timestamp to a supported part.", example: "DATE_TRUNC('month', TRY_CAST([Created at] AS TIMESTAMP))" },
    { name: "date_diff", signature: "DATE_DIFF(part, start, end)", arguments: ["part", "start", "end"], description: "Count date-part boundaries between two values.", example: "DATE_DIFF('day', TRY_CAST([Sent at] AS DATE), TRY_CAST([Received at] AS DATE))" },
    { name: "date_add", signature: "DATE_ADD(part, amount, date)", arguments: ["part", "amount", "date"], description: "Add an amount of a supported date part.", example: "DATE_ADD('day', 7, TRY_CAST([Created at] AS TIMESTAMP))" },
    { name: "cast", signature: "CAST(value AS TYPE)", arguments: ["value", "TYPE"], description: "Convert a value and fail the step on invalid input.", example: "CAST([Zone] AS VARCHAR)" },
    { name: "try_cast", signature: "TRY_CAST(value AS TYPE)", arguments: ["value", "TYPE"], description: "Convert a value and return null on invalid input.", example: "TRY_CAST([Amount text] AS DOUBLE)" },
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

function requireString(type, node) {
  if (!["VARCHAR", "UNKNOWN", "NULL"].includes(type)) throw new FormulaError("Text function arguments must be VARCHAR.", node.start, node.end, "TYPE_MISMATCH");
}

function requireDate(type, node) {
  if (!["DATE", "TIMESTAMP", "UNKNOWN", "NULL"].includes(type)) throw new FormulaError("Date function arguments must be DATE or TIMESTAMP.", node.start, node.end, "TYPE_MISMATCH");
}

function requireDatePart(node) {
  const part = node?.kind === "literal" && node.literalType === "string" ? String(node.value).toLowerCase() : null;
  if (!part || !DATE_PARTS.has(part)) {
    throw new FormulaError(`Date part must be one of: ${[...DATE_PARTS].join(", ")}.`, node?.start ?? 0, node?.end ?? 1, "INVALID_DATE_PART");
  }
  return part;
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
      if (["coalesce", "ifnull", "nullif", "greatest", "least"].includes(node.name)) {
        const expected = ["ifnull", "nullif"].includes(node.name) ? [2, 2] : [2, Number.POSITIVE_INFINITY];
        if (node.args.length < expected[0] || node.args.length > expected[1]) throw new FormulaError(`${node.name} expects ${expected[0]}${Number.isFinite(expected[1]) ? "" : " or more"} arguments.`, node.start, node.end, "INVALID_ARGUMENT_COUNT");
        return commonType(argTypes, node);
      }
      const definition = FUNCTION_RULES[node.name];
      if (!definition) throw new FormulaError(`Function "${node.name}" is not supported.`, node.start, node.end, "UNSUPPORTED_FUNCTION");
      if (node.args.length < definition.min || node.args.length > definition.max) throw new FormulaError(`${node.name} expects ${definition.min}${definition.max !== definition.min ? `-${definition.max}` : ""} arguments.`, node.start, node.end, "INVALID_ARGUMENT_COUNT");
      definition.stringArgs?.forEach((index) => { if (node.args[index]) requireString(argTypes[index], node.args[index]); });
      definition.numericArgs?.forEach((index) => { if (node.args[index]) requireNumeric(argTypes[index], node.args[index]); });
      definition.dateArgs?.forEach((index) => { if (node.args[index]) requireDate(argTypes[index], node.args[index]); });
      if (Number.isInteger(definition.datePartArg)) requireDatePart(node.args[definition.datePartArg]);
      if (Number.isInteger(definition.returnArg)) return argTypes[definition.returnArg];
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
    if (node.name === "date_add") {
      const part = String(node.args[0].value).toLowerCase();
      return `DATE_ADD(${compileAst(node.args[2])}, (${compileAst(node.args[1])}) * INTERVAL ${quoteString(DATE_ADD_INTERVALS[part])})`;
    }
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
