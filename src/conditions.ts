import type {
  Condition,
  ConditionTrace,
  Facts,
  FieldCondition,
  AllCondition,
  AnyCondition,
  NotCondition,
} from "./types.js";
import { copyData } from "./data.js";
import { resolvePath } from "./paths.js";
import { assertCondition, assertFacts } from "./validation.js";

function isAllCondition(c: Condition): c is AllCondition {
  return "all" in c;
}
function isAnyCondition(c: Condition): c is AnyCondition {
  return "any" in c;
}
function isNotCondition(c: Condition): c is NotCondition {
  return "not" in c;
}
function isFieldCondition(c: Condition): c is FieldCondition {
  return "field" in c && "operator" in c;
}

/** Retorna a referência do chamador; resultados de avaliação usam cópias. */
export function getByPath(obj: Facts, path: string): unknown {
  return resolvePath(obj, path).value;
}

function compare(
  operator: FieldCondition["operator"],
  actual: unknown,
  expected: unknown,
): boolean {
  switch (operator) {
    case "eq":
      return actual === expected;
    case "ne":
      return actual !== expected;
    case "gt":
      return (
        typeof actual === "number" &&
        typeof expected === "number" &&
        actual > expected
      );
    case "gte":
      return (
        typeof actual === "number" &&
        typeof expected === "number" &&
        actual >= expected
      );
    case "lt":
      return (
        typeof actual === "number" &&
        typeof expected === "number" &&
        actual < expected
      );
    case "lte":
      return (
        typeof actual === "number" &&
        typeof expected === "number" &&
        actual <= expected
      );
    case "in":
      return Array.isArray(expected) && Array.prototype.includes.call(expected, actual);
    case "notIn":
      return Array.isArray(expected) && !Array.prototype.includes.call(expected, actual);
    case "exists":
      return actual !== undefined && actual !== null;
    case "notExists":
      return actual === undefined || actual === null;
    default: {
      const _exhaustive: never = operator;
      return _exhaustive;
    }
  }
}

export function evaluateCondition(
  condition: Condition,
  facts: Facts,
): ConditionTrace {
  assertCondition(condition);
  assertFacts(facts);
  return evaluateValidatedCondition(condition, facts);
}

/** Uso interno: condições e fatos já passaram pela validação limitada. */
export function evaluateValidatedCondition(
  condition: Condition,
  facts: Facts,
  copies = new Map<object, object>(),
): ConditionTrace {
  if (isFieldCondition(condition)) {
    const { found, value: actual } = resolvePath(facts, condition.field);
    const passed = compare(condition.operator, actual, condition.value);
    return {
      type: "field",
      passed,
      field: condition.field,
      operator: condition.operator,
      expected: copyData(condition.value, copies),
      actual: copyData(actual, copies),
      actualState: !found ? "missing" : actual === undefined ? "undefined" : actual === null ? "null" : "value",
    };
  }

  if (isAllCondition(condition)) {
    const children = Array.from(condition.all, c => evaluateValidatedCondition(c, facts, copies));
    return { type: "all", passed: children.every((c) => c.passed), children };
  }

  if (isAnyCondition(condition)) {
    const children = Array.from(condition.any, c => evaluateValidatedCondition(c, facts, copies));
    return { type: "any", passed: children.some((c) => c.passed), children };
  }

  if (isNotCondition(condition)) {
    const child = evaluateValidatedCondition(condition.not, facts, copies);
    return { type: "not", passed: !child.passed, children: [child] };
  }

  throw new Error(
    `Condição em formato desconhecido: ${JSON.stringify(condition)}`,
  );
}
