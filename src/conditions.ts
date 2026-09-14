import type {
  Condition,
  ConditionTrace,
  Facts,
  FieldCondition,
  AllCondition,
  AnyCondition,
  NotCondition,
} from "./types.js";

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

export function getByPath(obj: Facts, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc === null || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
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
      return Array.isArray(expected) && expected.includes(actual);
    case "notIn":
      return Array.isArray(expected) && !expected.includes(actual);
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
  if (isFieldCondition(condition)) {
    const actual = getByPath(facts, condition.field);
    const passed = compare(condition.operator, actual, condition.value);
    return {
      type: "field",
      passed,
      field: condition.field,
      operator: condition.operator,
      expected: condition.value,
      actual,
    };
  }

  if (isAllCondition(condition)) {
    const children = condition.all.map((c) => evaluateCondition(c, facts));
    return { type: "all", passed: children.every((c) => c.passed), children };
  }

  if (isAnyCondition(condition)) {
    const children = condition.any.map((c) => evaluateCondition(c, facts));
    return { type: "any", passed: children.some((c) => c.passed), children };
  }

  if (isNotCondition(condition)) {
    const child = evaluateCondition(condition.not, facts);
    return { type: "not", passed: !child.passed, children: [child] };
  }

  throw new Error(
    `Condição em formato desconhecido: ${JSON.stringify(condition)}`,
  );
}
