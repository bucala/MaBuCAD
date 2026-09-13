import { describe, expect, it } from "vitest";

import { evaluateExpression, isValidVariableName } from "./equations";

/** The grammar is deliberately tiny and total: every input either parses to a finite
 * number or returns null — never throws, never evals. These tests pin both halves. */
describe("evaluateExpression", () => {
  it("evaluates plain numbers, including the decimal comma it accepts alongside the dot", () => {
    expect(evaluateExpression("5", {})).toBe(5);
    expect(evaluateExpression("2.5", {})).toBe(2.5);
    expect(evaluateExpression("2,5", {})).toBe(2.5);
  });

  it("respects operator precedence and parentheses", () => {
    expect(evaluateExpression("2 + 3 * 4", {})).toBe(14);
    expect(evaluateExpression("(2 + 3) * 4", {})).toBe(20);
    expect(evaluateExpression("10 / 4", {})).toBe(2.5);
  });

  it("supports unary minus and a leading = marker", () => {
    expect(evaluateExpression("-5", {})).toBe(-5);
    expect(evaluateExpression("=2 * 3", {})).toBe(6);
  });

  it("resolves named variables and combines them", () => {
    expect(evaluateExpression("width * 2", { width: 10 })).toBe(20);
    expect(evaluateExpression("width + height", { width: 3, height: 4 })).toBe(7);
    expect(evaluateExpression("=width", { width: 10 })).toBe(10);
  });

  it("returns null for syntax errors rather than throwing", () => {
    expect(evaluateExpression("", {})).toBeNull();
    expect(evaluateExpression("2 +", {})).toBeNull();
    expect(evaluateExpression("(2 + 3", {})).toBeNull();
    expect(evaluateExpression("2 3", {})).toBeNull();
    expect(evaluateExpression("2 ** 3", {})).toBeNull();
  });

  it("returns null for unknown variables and non-finite results", () => {
    expect(evaluateExpression("depth + 1", {})).toBeNull();
    expect(evaluateExpression("5 / 0", {})).toBeNull();
  });

  it("is not an eval: nothing but the grammar can run", () => {
    // A hand-written parser over numbers/identifiers/+ - * / ( ) only — these all fail
    // to tokenize, which is the point of not using Function()/eval() on document input.
    expect(evaluateExpression("alert(1)", {})).toBeNull();
    expect(evaluateExpression("1; throw new Error()", {})).toBeNull();
    expect(evaluateExpression("`${1}`", {})).toBeNull();
  });
});

describe("isValidVariableName", () => {
  it("accepts the identifier grammar the parser itself reads", () => {
    expect(isValidVariableName("width")).toBe(true);
    expect(isValidVariableName("_x")).toBe(true);
    expect(isValidVariableName("w2")).toBe(true);
  });

  it("rejects anything that would not tokenize as one identifier", () => {
    expect(isValidVariableName("2w")).toBe(false);
    expect(isValidVariableName("w-id")).toBe(false);
    expect(isValidVariableName("width height")).toBe(false);
    expect(isValidVariableName("")).toBe(false);
  });
});
