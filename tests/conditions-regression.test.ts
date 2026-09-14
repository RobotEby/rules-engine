import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateCondition, getByPath, RulesEngine, RuleValidationError, FactsValidationError,
  type Condition, type Facts, type FieldCondition } from "../src/index.js";

for (const [name, facts, state, present] of [
  ["missing", {}, "missing", false], ["undefined", { x: undefined }, "undefined", false],
  ["null", { x: null }, "null", false], ["false", { x: false }, "value", true],
  ["zero", { x: 0 }, "value", true], ["empty string", { x: "" }, "value", true],
] as const) {
  test(`presence semantics and JSON trace: ${name}`, () => {
    const expected = { ne: true, notIn: true, exists: present, notExists: !present };
    for (const operator of ["ne", "notIn", "exists", "notExists"] as const) {
      const c: FieldCondition = { field: "x", operator, value: operator === "notIn" ? ["allowed"] : "allowed" };
      const trace = evaluateCondition(c, facts);
      assert.equal(trace.passed, expected[operator]);
      assert.equal(trace.actualState, state);
      const json = JSON.parse(JSON.stringify(trace));
      assert.equal(json.actualState, state);
      if (state === "missing" || state === "undefined") assert.equal(Object.hasOwn(json, "actual"), false);
      else assert.equal(json.actual, getByPath(facts, "x"));
    }
    const exists: Condition = { field: "x", operator: "exists" };
    const notEq: Condition = { not: { field: "x", operator: "eq", value: "allowed" } };
    assert.equal(evaluateCondition(notEq, facts).passed, true);
    assert.equal(evaluateCondition({ all: [exists, notEq] }, facts).passed, present);
    assert.equal(evaluateCondition({ any: [exists, notEq] }, facts).passed, true);
    assert.equal(evaluateCondition({ not: exists }, facts).passed, !present);
    assert.equal(evaluateCondition({ not: { not: exists } }, facts).passed, present);
  });
}

test("null compares strictly; false, zero and empty string are distinct values", () => {
  assert.equal(evaluateCondition({ field: "x", operator: "eq", value: null }, {}).passed, false);
  assert.equal(evaluateCondition({ field: "x", operator: "ne", value: null }, { x: null }).passed, false);
  assert.equal(evaluateCondition({ field: "x", operator: "in", value: [null] }, { x: null }).passed, true);
  assert.equal(evaluateCondition({ field: "x", operator: "notIn", value: [null] }, { x: null }).passed, false);
  for (const value of [null, false, 0, ""]) {
    for (const actual of [null, false, 0, ""]) {
      assert.equal(evaluateCondition({ field: "x", operator: "eq", value }, { x: actual }).passed, actual === value);
    }
  }
});

test("own paths: ignores inherited data at every segment and reserved names", () => {
  assert.equal(getByPath(Object.create({ vip: true }), "vip"), undefined);
  assert.equal(getByPath({ cliente: Object.create({ vip: true }) }, "cliente.vip"), undefined);
  const obj = JSON.parse('{"constructor":1,"prototype":2,"__proto__":3,"":{"x":4}}');
  for (const path of ["constructor", "prototype", "__proto__", "", ".x", "x.", "x..y"]) assert.equal(getByPath(obj, path), undefined);
  assert.equal(getByPath({}, "constructor"), undefined);
});

test("own paths: null prototypes, arrays, null intermediates and legitimate keys", () => {
  const child = Object.assign(Object.create(null), { value: 0 });
  const root = Object.assign(Object.create(null), { child, items: [{ value: false }], missing: null, "normal-key": "" });
  assert.equal(getByPath(root, "child.value"), 0);
  assert.equal(getByPath(root, "items.0.value"), false);
  assert.equal(getByPath(root, "normal-key"), "");
  assert.equal(getByPath(root, "missing.value"), undefined);
  assert.equal(getByPath(root, "child"), child);
  assert.equal(evaluateCondition({ field: "missing.value", operator: "notExists" }, root).actualState, "missing");
});

test("own paths: never invokes getters or proxy traps", () => {
  const root = { get x(): never { throw new Error("getter executed"); } };
  assert.equal(getByPath(root, "x"), undefined);
  const proxy = new Proxy({}, { getOwnPropertyDescriptor() { throw new Error("trap executed"); } });
  assert.equal(getByPath(proxy, "x"), undefined);
});

test("standalone evaluation validates domain and condition limits", () => {
  const invalid: unknown[] = [{ field: "x", operator: "gte", value: "200" }, { any: [] }];
  const cyclic: Record<string, unknown> = {}; cyclic.not = cyclic; invalid.push(cyclic);
  let deep: unknown = { field: "x", operator: "exists" };
  for (let i = 0; i < 1_000; i++) deep = { not: deep };
  invalid.push(deep);
  for (const c of invalid) assert.throws(() => evaluateCondition(c as Condition, {}), RuleValidationError);
  for (const facts of [null, [], new Date(), { x: Infinity }]) {
    assert.throws(() => evaluateCondition({ field: "x", operator: "exists" }, facts as unknown as Facts), FactsValidationError);
    const engine = new RulesEngine({ version: "1", name: "test", rules: [{ id: "r", conditions: { field: "x", operator: "exists" }, action: { type: "A" } }] });
    assert.throws(() => engine.evaluate(facts as unknown as Facts), FactsValidationError);
  }
});

test("standalone traces copy actual and expected; object comparison remains identity based", () => {
  const object = { nested: [1] };
  const condition: Condition = { field: "x", operator: "eq", value: object };
  const trace = evaluateCondition(condition, { x: object });
  assert.equal(trace.passed, true);
  (trace.expected as typeof object).nested.push(2);
  assert.deepEqual(object, { nested: [1] });
  assert.equal(evaluateCondition(condition, { x: { nested: [1] } }).passed, false);
  const engine = new RulesEngine({ version: "1", name: "test", rules: [{ id: "r", conditions: condition, action: { type: "A" } }] });
  assert.equal(engine.evaluate({ x: object }).results[0]!.matched, false);
});

test("full trace: any/all retain children after the result is known", () => {
  for (const combinator of ["all", "any"] as const) {
    const children: Condition[] = [{ field: "x", operator: "exists" }, { field: "y", operator: "notExists" }];
    const condition: Condition = combinator === "all" ? { all: children } : { any: children };
    assert.equal(evaluateCondition(condition, { x: true }).children?.length, 2);
  }
});
