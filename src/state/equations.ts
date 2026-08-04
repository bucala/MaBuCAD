/**
 * Inspect ▸ Equations' expression evaluator.
 *
 * Deliberately not `Function()`/`eval()` — a document is a file a user can open from
 * disk, and an expression is just as much untrusted input as any other field in it, so
 * this is a small hand-written recursive-descent parser over a strict grammar (numbers,
 * `+ - * /`, unary minus, parentheses, and variable names) rather than anything that could
 * run arbitrary code.
 *
 * Consumed by `DimensionValueField.tsx`: a sketch dimension's value field starting with
 * `=` is treated as an expression here instead of a literal number, resolved against the
 * current document's `variables` map (Inspect ▸ Equations' own data, `documentStore.ts`).
 */

const TOKEN_PATTERN = /\s*(?:([0-9]+(?:[.,][0-9]+)?)|([A-Za-z_][A-Za-z0-9_]*)|([+\-*/()]))/y;

type Token = { kind: "number"; value: number } | { kind: "identifier"; value: string } | { kind: "op"; value: string };

function tokenize(expression: string): Token[] | null {
  const tokens: Token[] = [];
  TOKEN_PATTERN.lastIndex = 0;
  let index = 0;
  while (index < expression.length) {
    TOKEN_PATTERN.lastIndex = index;
    const match = TOKEN_PATTERN.exec(expression);
    if (!match || match.index !== index) return null;
    index = TOKEN_PATTERN.lastIndex;
    if (match[1] !== undefined) tokens.push({ kind: "number", value: Number(match[1].replace(",", ".")) });
    else if (match[2] !== undefined) tokens.push({ kind: "identifier", value: match[2] });
    else if (match[3] !== undefined) tokens.push({ kind: "op", value: match[3] });
  }
  return tokens;
}

class Parser {
  private position = 0;
  constructor(
    private readonly tokens: Token[],
    private readonly variables: Record<string, number>,
  ) {}

  private peek(): Token | undefined {
    return this.tokens[this.position];
  }

  private consume(): Token | undefined {
    return this.tokens[this.position++];
  }

  /** expr := term (('+' | '-') term)* */
  parseExpression(): number {
    let value = this.parseTerm();
    for (;;) {
      const token = this.peek();
      if (token?.kind !== "op" || (token.value !== "+" && token.value !== "-")) break;
      this.consume();
      const rhs = this.parseTerm();
      value = token.value === "+" ? value + rhs : value - rhs;
    }
    return value;
  }

  /** term := factor (('*' | '/') factor)* */
  private parseTerm(): number {
    let value = this.parseFactor();
    for (;;) {
      const token = this.peek();
      if (token?.kind !== "op" || (token.value !== "*" && token.value !== "/")) break;
      this.consume();
      const rhs = this.parseFactor();
      value = token.value === "*" ? value * rhs : value / rhs;
    }
    return value;
  }

  /** factor := '-' factor | '(' expr ')' | number | identifier */
  private parseFactor(): number {
    const token = this.consume();
    if (!token) throw new Error("Unexpected end of expression");

    if (token.kind === "op" && token.value === "-") return -this.parseFactor();
    if (token.kind === "op" && token.value === "(") {
      const value = this.parseExpression();
      const closing = this.consume();
      if (closing?.kind !== "op" || closing.value !== ")") throw new Error("Expected ')'");
      return value;
    }
    if (token.kind === "number") return token.value;
    if (token.kind === "identifier") {
      const value = this.variables[token.value];
      if (value === undefined) throw new Error(`Unknown variable "${token.value}"`);
      return value;
    }
    throw new Error("Unexpected token");
  }

  atEnd(): boolean {
    return this.position >= this.tokens.length;
  }
}

/**
 * Evaluates a `+ - * /` arithmetic expression against a set of named variables. Returns
 * `null` for anything that doesn't parse cleanly (syntax error, unknown variable, a
 * non-finite result such as division by zero) rather than throwing — every caller treats
 * "not a valid expression yet" as an ordinary, expected state while someone is mid-typing.
 */
export function evaluateExpression(expression: string, variables: Record<string, number>): number | null {
  // A leading "=" is optional here — accepted (and stripped) so the same string works
  // whether it came from a dimension field (which needs it, to tell an expression apart
  // from a plain number) or Inspect ▸ Equations' own expression input (which doesn't).
  const trimmed = expression.trim();
  const withoutEquals = trimmed.startsWith("=") ? trimmed.slice(1) : trimmed;

  const tokens = tokenize(withoutEquals);
  if (!tokens || tokens.length === 0) return null;

  try {
    const parser = new Parser(tokens, variables);
    const value = parser.parseExpression();
    if (!parser.atEnd() || !Number.isFinite(value)) return null;
    return value;
  } catch {
    return null;
  }
}

/** A variable name valid to define in Inspect ▸ Equations — the same identifier grammar
 * the expression parser itself accepts, so anything you can name you can also reference. */
export function isValidVariableName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}
