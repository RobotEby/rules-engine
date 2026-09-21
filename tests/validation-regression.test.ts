import { test } from "node:test";
import assert from "node:assert/strict";
import { validateFacts, validateRuleSet, VALIDATION_LIMITS, type FactValue } from "../src/index.js";

const rule = (overrides: Record<string, unknown> = {}) => ({
  id: "r", conditions: { field: "x", operator: "eq", value: 1 }, action: { type: "A" }, ...overrides,
});
const ruleset = (overrides: Record<string, unknown> = {}) => ({ version: "1", name: "test", rules: [rule()], ...overrides });

for (const [name, input, path] of [
  ["gte string", ruleset({ rules: [rule({ conditions: { field: "x", operator: "gte", value: "200" } })] }), "conditions.value"],
  ["params number", ruleset({ rules: [rule({ action: { type: "A", params: 5 } })] }), "action.params"],
  ["params array", ruleset({ rules: [rule({ action: { type: "A", params: [] } })] }), "action.params"],
  ["action missing", ruleset({ rules: [{ id: "r", conditions: { field: "x", operator: "eq", value: 1 } }] }), "action:"],
  ["action string", ruleset({ rules: [rule({ action: "A" })] }), "action:"],
  ["rule description", ruleset({ rules: [rule({ description: 1 })] }), "description"],
  ["ruleset description", ruleset({ description: 1 }), "description"],
  ["priority infinity", ruleset({ rules: [rule({ priority: Infinity })] }), "priority"],
  ["enabled null", ruleset({ rules: [rule({ enabled: null })] }), "enabled"],
  ["optional undefined", ruleset({ description: undefined }), "description"],
  ["unknown rule property", ruleset({ rules: [rule({ enabld: false })] }), "enabld"],
  ["unknown root property", ruleset({ names: "typo" }), "names"],
  ["unknown action property", ruleset({ rules: [rule({ action: { type: "A", param: {} } })] }), "action.param"],
  ["unknown condition property", ruleset({ rules: [rule({ conditions: { field: "x", operator: "exists", typo: true } })] }), "conditions.typo"],
  ["combinator extra value", ruleset({ rules: [rule({ conditions: { not: { field: "x", operator: "exists" }, value: 1 } })] }), "conditions.value"],
  ["two combinators", ruleset({ rules: [rule({ conditions: { all: [], any: [] } })] }), "conditions"],
  ["not array", ruleset({ rules: [rule({ conditions: { not: [] } })] }), "conditions.not"],
  ["in scalar", ruleset({ rules: [rule({ conditions: { field: "x", operator: "in", value: 1 } })] }), "conditions.value"],
  ["notIn null", ruleset({ rules: [rule({ conditions: { field: "x", operator: "notIn", value: null } })] }), "conditions.value"],
] as const) {
  test(`validation: rejects ${name} with path`, () => {
    const result = validateRuleSet(input);
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(error => error.includes(path)), result.errors.join("\n"));
  });
}

for (const operator of ["gt", "gte", "lt", "lte"]) {
  test(`validation: ${operator} accepts finite numbers only`, () => {
    for (const value of ["200", null, false, NaN, Infinity, -Infinity]) {
      assert.equal(validateRuleSet(ruleset({ rules: [rule({ conditions: { field: "x", operator, value } })] })).valid, false);
    }
    assert.equal(validateRuleSet(ruleset({ rules: [rule({ conditions: { field: "x", operator, value: 0 } })] })).valid, true);
  });
}

test("validation: null, absent value and explicit undefined are different", () => {
  for (const operator of ["eq", "ne", "exists", "notExists"]) {
    assert.equal(validateRuleSet(ruleset({ rules: [rule({ conditions: { field: "x", operator, value: null } })] })).valid, true);
    assert.equal(validateRuleSet(ruleset({ rules: [rule({ conditions: { field: "x", operator, value: undefined } })] })).valid, false);
    assert.equal(validateRuleSet(ruleset({ rules: [rule({ conditions: { field: "x", operator } })] })).valid, operator.endsWith("Exists") || operator === "exists");
  }
  assert.equal(validateFacts({ x: undefined, nested: [undefined, null, false, 0, ""] }).valid, true);
});

const revoked = Proxy.revocable({}, {});
revoked.revoke();
for (const [name, value] of [
  ["Date", new Date()], ["Map", new Map()], ["Set", new Set()], ["RegExp", /x/],
  ["class", new (class Data { x = 1; })()], ["function", () => 1], ["bigint", 1n],
  ["symbol", Symbol("x")], ["NaN", NaN], ["Infinity", Infinity],
  ["proxy", new Proxy({}, {})], ["revoked proxy", revoked.proxy],
  ["symbol key", { [Symbol("x")]: 1 }], ["hidden property", Object.defineProperty({}, "x", { value: 1 })],
  ["sparse array", new Array(2)], ["extra array property", Object.assign([1], { extra: 2 })],
] as const) {
  test(`data domain: rejects ${name} in facts and action params`, () => {
    for (const result of [validateFacts({ nested: value }), validateRuleSet(ruleset({ rules: [rule({ action: { type: "A", params: { nested: value } } })] }))]) {
      assert.equal(result.valid, false);
      assert.match(result.errors.join("\n"), /nested/);
    }
  });
}

test("data domain: getters are rejected without execution", () => {
  let reads = 0;
  const value = { get x() { reads++; throw new Error("must not run"); } };
  assert.equal(validateFacts(value).valid, false);
  assert.equal(validateRuleSet(ruleset({ description: value })).valid, false);
  assert.equal(reads, 0);
});

test("data domain: cycles fail, shared structures and null prototypes are accepted", () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.match(validateFacts(cyclic).errors[0]!, /self.*cíclica/);
  const condition: Record<string, unknown> = {};
  condition.not = condition;
  assert.match(validateRuleSet(ruleset({ rules: [rule({ conditions: condition })] })).errors[0]!, /conditions.not.*cíclica/);
  const shared = Object.assign(Object.create(null), { nested: [1, { x: 2 }] });
  assert.equal(validateFacts({ a: shared, b: shared }).valid, true);
  assert.equal(validateRuleSet(ruleset({ rules: [rule({ action: { type: "A", params: { a: shared, b: shared, enabld: false } } })] })).valid, true);
});

test("limits: structural depth at 64 and 65", () => {
  let nested: FactValue = null;
  for (let i = 0; i < VALIDATION_LIMITS.maxDepth; i++) nested = { x: nested };
  assert.equal(validateFacts(nested).valid, true);
  assert.match(validateFacts({ x: nested }).errors[0]!, /profundidade/);
});

test("limits: 1000 rules and 1001 rules", () => {
  const rules = Array.from({ length: VALIDATION_LIMITS.maxRules }, (_, index) => rule({ id: String(index) }));
  assert.equal(validateRuleSet(ruleset({ rules })).valid, true);
  assert.match(validateRuleSet(ruleset({ rules: [...rules, rule({ id: "extra" })] })).errors[0]!, /rules.*1000/);
});

test("limits: 10000 conditions and 10001 conditions, including shared nodes", () => {
  const leaf = { field: "x", operator: "exists" };
  const all = Array(VALIDATION_LIMITS.maxConditions - 1).fill(leaf);
  assert.equal(validateRuleSet(ruleset({ rules: [rule({ conditions: { all } })] })).valid, true);
  assert.match(validateRuleSet(ruleset({ rules: [rule({ conditions: { all: [...all, leaf] } })] })).errors[0]!, /conditions.*10000/);
});

test("limits: 100000 values and 100001 values", () => {
  assert.equal(validateFacts({ values: Array(VALIDATION_LIMITS.maxValues - 2).fill(null) }).valid, true);
  assert.match(validateFacts({ values: Array(VALIDATION_LIMITS.maxValues - 1).fill(null) }).errors[0]!, /values.*100000/);
});

test("limits: shared DAG cannot bypass the expanded occurrence budget", () => {
  let value: FactValue = null;
  for (let i = 0; i < 20; i++) value = { a: value, b: value };
  assert.match(validateFacts(value).errors[0]!, /100000/);
});

test("validation: empty and reserved path segments are rejected", () => {
  for (const field of ["", ".x", "x.", "x..y", "constructor", "x.__proto__.y", "x.prototype.y"]) {
    const result = validateRuleSet(ruleset({ rules: [rule({ conditions: { field, operator: "exists" } })] }));
    assert.equal(result.valid, false);
    assert.match(result.errors.join("\n"), /conditions.field/);
  }
});

test("validation: percentage ranges belong to the consumer", () => {
  assert.equal(validateRuleSet(ruleset({ rules: [rule({ action: { type: "PERCENT_DISCOUNT", params: { percentual: 150 } } })] })).valid, true);
});
