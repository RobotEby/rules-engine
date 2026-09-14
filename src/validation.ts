import type { Condition, RuleSet, Facts, ComparisonOperator } from "./types.js";
import { FactsValidationError, RuleValidationError } from "./types.js";
import { isPlainObject, propertyPath, validateData, VALIDATION_LIMITS } from "./data.js";
import { isValidPath } from "./paths.js";

const OPERATORS: readonly ComparisonOperator[] = ["eq", "ne", "gt", "gte", "lt", "lte", "in", "notIn", "exists", "notExists"];
const NUMERIC = new Set(["gt", "gte", "lt", "lte"]);
export interface ValidationResult { valid: boolean; errors: string[] }

function unknownKeys(obj: Record<string, unknown>, allowed: string[], path: string, errors: string[]): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) errors.push(`${propertyPath(path, key)}: propriedade desconhecida`);
  }
}

function nonemptyString(obj: Record<string, unknown>, key: string, path: string, errors: string[]): void {
  if (typeof obj[key] !== "string" || obj[key].trim() === "") {
    errors.push(`${propertyPath(path, key)}: obrigatório e deve ser uma string não-vazia`);
  }
}

function conditionSchema(c: unknown, path: string, errors: string[], budget: { count: number }): void {
  if (++budget.count > VALIDATION_LIMITS.maxConditions) {
    if (budget.count === VALIDATION_LIMITS.maxConditions + 1) errors.push(`${path}: limite de ${VALIDATION_LIMITS.maxConditions} condições excedido`);
    return;
  }
  if (!isPlainObject(c)) { errors.push(`${path}: condição deve ser um objeto`); return; }
  const combinators = ["all", "any", "not"].filter(key => Object.hasOwn(c, key));
  if (combinators.length > 1) { errors.push(`${path}: use apenas um combinador por nó (all | any | not)`); return; }
  const combinator = combinators[0];
  if (combinator) {
    if (Object.hasOwn(c, "field") || Object.hasOwn(c, "operator")) {
      errors.push(`${path}: não é possível misturar combinador com field/operator`);
      return;
    }
    unknownKeys(c, [combinator], path, errors);
    if (combinator === "not") {
      conditionSchema(c.not, `${path}.not`, errors, budget);
    } else {
      const children = c[combinator];
      if (!Array.isArray(children) || children.length === 0) {
        errors.push(`${path}.${combinator}: deve ser um array não-vazio de condições`);
      } else {
        for (let i = 0; i < children.length && budget.count <= VALIDATION_LIMITS.maxConditions; i++) {
          conditionSchema(children[i], `${path}.${combinator}[${i}]`, errors, budget);
        }
      }
    }
    return;
  }
  unknownKeys(c, ["field", "operator", "value"], path, errors);
  nonemptyString(c, "field", path, errors);
  if (typeof c.field === "string" && !isValidPath(c.field)) errors.push(`${path}.field: caminho inválido (segmento vazio ou reservado)`);
  if (typeof c.operator !== "string" || !OPERATORS.includes(c.operator as ComparisonOperator)) {
    errors.push(`${path}.operator: deve ser um de [${OPERATORS.join(", ")}]`);
    return;
  }
  if (c.operator !== "exists" && c.operator !== "notExists" && !Object.hasOwn(c, "value")) {
    errors.push(`${path}.value: obrigatório para o operador "${c.operator}"`);
    return;
  }
  if (NUMERIC.has(c.operator) && (typeof c.value !== "number" || !Number.isFinite(c.value))) {
    errors.push(`${path}.value: deve ser um número finito para o operador "${c.operator}"`);
  }
  if ((c.operator === "in" || c.operator === "notIn") && !Array.isArray(c.value)) {
    errors.push(`${path}.value: deve ser um array para o operador "${c.operator}"`);
  }
}

export function validateRuleSet(input: unknown): ValidationResult {
  const errors = validateData(input, false, "ruleset");
  if (errors.length) return { valid: false, errors };
  if (!isPlainObject(input)) return { valid: false, errors: ["o ruleset deve ser um objeto JSON"] };
  unknownKeys(input, ["version", "name", "description", "rules"], "", errors);
  nonemptyString(input, "version", "", errors);
  nonemptyString(input, "name", "", errors);
  if (Object.hasOwn(input, "description") && typeof input.description !== "string") errors.push("description: deve ser uma string");
  if (!Array.isArray(input.rules)) {
    errors.push("rules: obrigatório e deve ser um array");
  } else if (input.rules.length === 0) {
    errors.push("rules: deve conter ao menos uma regra");
  } else if (input.rules.length > VALIDATION_LIMITS.maxRules) {
    errors.push(`rules: limite de ${VALIDATION_LIMITS.maxRules} regras excedido`);
  } else {
    const seen = new Set<string>();
    const budget = { count: 0 };
    for (let i = 0; i < input.rules.length; i++) {
      const r: unknown = input.rules[i];
      const path = `rules[${i}]`;
      if (!isPlainObject(r)) { errors.push(`${path}: deve ser um objeto`); continue; }
      unknownKeys(r, ["id", "description", "priority", "enabled", "conditions", "action"], path, errors);
      nonemptyString(r, "id", path, errors);
      if (typeof r.id === "string") {
        if (seen.has(r.id)) errors.push(`${path}.id: id duplicado "${r.id}"`);
        seen.add(r.id);
      }
      if (Object.hasOwn(r, "description") && typeof r.description !== "string") errors.push(`${path}.description: deve ser uma string`);
      if (Object.hasOwn(r, "priority") && (typeof r.priority !== "number" || !Number.isFinite(r.priority))) errors.push(`${path}.priority: deve ser um número finito`);
      if (Object.hasOwn(r, "enabled") && typeof r.enabled !== "boolean") errors.push(`${path}.enabled: deve ser um booleano`);
      if (!isPlainObject(r.action)) {
        errors.push(`${path}.action: obrigatório e deve ser um objeto`);
      } else {
        unknownKeys(r.action, ["type", "params"], `${path}.action`, errors);
        nonemptyString(r.action, "type", `${path}.action`, errors);
        if (Object.hasOwn(r.action, "params") && !isPlainObject(r.action.params)) errors.push(`${path}.action.params: deve ser um objeto`);
      }
      if (!Object.hasOwn(r, "conditions")) errors.push(`${path}.conditions: obrigatório`);
      else conditionSchema(r.conditions, `${path}.conditions`, errors, budget);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function assertRuleSet(input: unknown): asserts input is RuleSet {
  const { valid, errors } = validateRuleSet(input);
  if (!valid) throw new RuleValidationError(errors);
}

export function assertCondition(input: unknown): asserts input is Condition {
  const errors = validateData(input, false, "condition");
  if (!errors.length) conditionSchema(input, "condition", errors, { count: 0 });
  if (errors.length) throw new RuleValidationError(errors);
}

export function validateFacts(input: unknown): ValidationResult {
  const errors = validateData(input, true, "facts");
  if (!errors.length && !isPlainObject(input)) errors.push("facts: deve ser um objeto de dados simples");
  return { valid: errors.length === 0, errors };
}

export function assertFacts(input: unknown): asserts input is Facts {
  const { valid, errors } = validateFacts(input);
  if (!valid) throw new FactsValidationError(errors);
}

export { VALIDATION_LIMITS } from "./data.js";
export type { Condition, Rule } from "./types.js";
