import type { Condition, Rule, RuleSet, ComparisonOperator } from "./types.js";
import { RuleValidationError } from "./types.js";

const VALID_OPERATORS: ComparisonOperator[] = [
  "eq",
  "ne",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
  "notIn",
  "exists",
  "notExists",
];

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function validateCondition(c: unknown, path: string, errors: string[]): void {
  if (!isPlainObject(c)) {
    errors.push(`${path}: condição deve ser um objeto`);
    return;
  }

  const keys = Object.keys(c);
  const combinatorKeys = keys.filter(
    (k) => k === "all" || k === "any" || k === "not",
  );
  const isField = "field" in c || "operator" in c;

  if (combinatorKeys.length > 1) {
    errors.push(
      `${path}: use apenas um combinador por nó (all | any | not), encontrado: ${combinatorKeys.join(", ")}`,
    );
    return;
  }

  if (combinatorKeys.length === 1 && isField) {
    errors.push(
      `${path}: não é possível misturar "${combinatorKeys[0]}" com "field"/"operator" no mesmo nó`,
    );
    return;
  }

  if (combinatorKeys[0] === "all" || combinatorKeys[0] === "any") {
    const arr = (c as Record<string, unknown>)[combinatorKeys[0]];
    if (!Array.isArray(arr) || arr.length === 0) {
      errors.push(
        `${path}.${combinatorKeys[0]}: deve ser um array não-vazio de condições`,
      );
      return;
    }
    arr.forEach((child, i) =>
      validateCondition(child, `${path}.${combinatorKeys[0]}[${i}]`, errors),
    );
    return;
  }

  if (combinatorKeys[0] === "not") {
    validateCondition(
      (c as Record<string, unknown>).not,
      `${path}.not`,
      errors,
    );
    return;
  }

  // Condição de campo
  if (typeof c.field !== "string" || c.field.trim() === "") {
    errors.push(`${path}.field: obrigatório e deve ser uma string não-vazia`);
  }
  if (
    typeof c.operator !== "string" ||
    !VALID_OPERATORS.includes(c.operator as ComparisonOperator)
  ) {
    errors.push(
      `${path}.operator: deve ser um de [${VALID_OPERATORS.join(", ")}], recebido "${String(c.operator)}"`,
    );
  }
  const needsValue = c.operator !== "exists" && c.operator !== "notExists";
  if (needsValue && !("value" in c)) {
    errors.push(
      `${path}.value: obrigatório para o operador "${String(c.operator)}"`,
    );
  }
  if (
    (c.operator === "in" || c.operator === "notIn") &&
    !Array.isArray(c.value)
  ) {
    errors.push(
      `${path}.value: deve ser um array para o operador "${String(c.operator)}"`,
    );
  }
}

function validateRule(
  r: unknown,
  index: number,
  errors: string[],
  seenIds: Set<string>,
): void {
  const path = `rules[${index}]`;
  if (!isPlainObject(r)) {
    errors.push(`${path}: deve ser um objeto`);
    return;
  }
  if (typeof r.id !== "string" || r.id.trim() === "") {
    errors.push(`${path}.id: obrigatório e deve ser uma string não-vazia`);
  } else if (seenIds.has(r.id)) {
    errors.push(`${path}.id: id duplicado "${r.id}"`);
  } else {
    seenIds.add(r.id);
  }
  if (r.priority !== undefined && typeof r.priority !== "number") {
    errors.push(`${path}.priority: deve ser um número`);
  }
  if (r.enabled !== undefined && typeof r.enabled !== "boolean") {
    errors.push(`${path}.enabled: deve ser um booleano`);
  }
  if (!isPlainObject(r.action)) {
    errors.push(`${path}.action: obrigatório e deve ser um objeto`);
  } else if (typeof r.action.type !== "string" || r.action.type.trim() === "") {
    errors.push(
      `${path}.action.type: obrigatório e deve ser uma string não-vazia`,
    );
  }
  if (r.conditions === undefined) {
    errors.push(`${path}.conditions: obrigatório`);
  } else {
    validateCondition(r.conditions, `${path}.conditions`, errors);
  }
}

export function validateRuleSet(input: unknown): ValidationResult {
  const errors: string[] = [];

  if (!isPlainObject(input)) {
    return { valid: false, errors: ["o ruleset deve ser um objeto JSON"] };
  }

  if (typeof input.version !== "string" || input.version.trim() === "") {
    errors.push("version: obrigatório e deve ser uma string não-vazia");
  }
  if (typeof input.name !== "string" || input.name.trim() === "") {
    errors.push("name: obrigatório e deve ser uma string não-vazia");
  }
  if (!Array.isArray(input.rules)) {
    errors.push("rules: obrigatório e deve ser um array");
  } else if (input.rules.length === 0) {
    errors.push("rules: deve conter ao menos uma regra");
  } else {
    const seenIds = new Set<string>();
    input.rules.forEach((r, i) => validateRule(r, i, errors, seenIds));
  }

  return { valid: errors.length === 0, errors };
}

export function assertRuleSet(input: unknown): asserts input is RuleSet {
  const { valid, errors } = validateRuleSet(input);
  if (!valid) {
    throw new RuleValidationError(errors);
  }
}

export type { Condition, Rule };
