import { test } from "node:test";
import assert from "node:assert/strict";
import { RulesEngine, RuleValidationError, RuleSetNotFoundError, type RuleSet, type RuleAction } from "../src/index.js";

const make = (): RuleSet => ({
  version: "1", name: "original", rules: [{
    id: "r", priority: 10,
    conditions: { all: [
      { field: "x", operator: "in", value: [1, { deep: ["original"] }] },
      { field: "payload", operator: "exists" },
    ] },
    action: { type: "A", params: { nested: { items: [{ label: "original" }] } } },
  }],
});
const facts = () => ({ x: 1, payload: { items: [{ label: "fact" }] } });
function changeAction(action: RuleAction): void {
  const params = action.params as { nested: { items: { label: string }[] } };
  params.nested.items[0]!.label = "changed";
  params.nested.items.push({ label: "extra" });
}
type Context = { input: RuleSet; engine: RulesEngine; returned: RuleSet };
const mutations: Record<string, (ctx: Context) => void> = {
  "original nested input": ({ input }) => { changeAction(input.rules[0]!.action); input.rules[0]!.enabled = false; input.name = "changed"; input.version = "other"; },
  "loadRuleSet return": ({ returned }) => { changeAction(returned.rules[0]!.action); returned.rules.length = 0; },
  "getActiveRules": ({ engine }) => { const rules = engine.getActiveRules(); changeAction(rules[0]!.action); rules[0]!.id = "other"; rules.push(rules[0]!); },
  "evaluate.actions": ({ engine }) => { const result = engine.evaluate(facts()); changeAction(result.actions[0]!); result.actions.length = 0; },
  "evaluate.results.action": ({ engine }) => changeAction(engine.evaluate(facts()).results[0]!.action!),
  "trace.expected": ({ engine }) => {
    const value = engine.evaluate(facts()).results[0]!.trace.children![0]!.expected as [number, { deep: string[] }];
    value[0] = 2; value[1].deep.push("changed");
  },
  "explain and trace children": ({ engine }) => { const result = engine.explain(facts()); changeAction(result.actions[0]!); result.results[0]!.trace.children!.length = 0; },
  "version metadata and Date": ({ engine }) => { const list = engine.listVersions(); list[0]!.loadedAt.setTime(0); list[0]!.name = "other"; list[0]!.active = false; list.length = 0; },
};
for (const [name, mutate] of Object.entries(mutations)) {
  test(`isolation: mutating ${name} cannot change engine state`, () => {
    const input = make();
    const engine = new RulesEngine();
    const returned = engine.loadRuleSet(input);
    const expected = engine.evaluate(facts());
    const versions = engine.listVersions();
    mutate({ input, engine, returned });
    assert.deepEqual(engine.evaluate(facts()), expected);
    assert.deepEqual(engine.listVersions(), versions);
  });
}

test("isolation: facts and traces own independent nested objects", () => {
  const input = facts();
  const original = structuredClone(input);
  const engine = new RulesEngine(make());
  const first = engine.evaluate(input);
  const second = engine.explain(input);
  const actual = first.results[0]!.trace.children![1]!.actual as typeof input.payload;
  actual.items[0]!.label = "trace changed";
  actual.items.push({ label: "extra" });
  assert.deepEqual(input, original);
  input.payload.items[0]!.label = "caller changed";
  assert.deepEqual(second.results[0]!.trace.children![1]!.actual, original.payload);
  assert.equal(Object.isFrozen(input.payload.items), false);
});

test("isolation: loading never mutates or freezes caller objects", () => {
  const input = make();
  const original = structuredClone(input);
  const engine = new RulesEngine(input);
  assert.deepEqual(input, original);
  assert.equal(Object.isFrozen(input.rules[0]!.action.params), false);
  engine.loadRuleSet(Object.freeze({ ...input, version: "2" }));
  assert.deepEqual(input, original);
});

test("isolation: shared structures between versions stay original through rollback", () => {
  const input = make();
  const engine = new RulesEngine(input);
  const first = engine.evaluate(facts());
  const returned = engine.loadRuleSet({ ...input, version: "2" });
  changeAction(input.rules[0]!.action);
  changeAction(returned.rules[0]!.action);
  input.rules[0]!.conditions = { field: "x", operator: "eq", value: 999 };
  assert.deepEqual(engine.evaluate(facts()), { ...first, rulesetVersion: "2" });
  engine.rollback("1");
  assert.deepEqual(engine.evaluate(facts()), first);
  engine.rollback("2");
  assert.deepEqual(engine.evaluate(facts()), { ...first, rulesetVersion: "2" });
});

test("atomicity: all rejected updates preserve active version, content and history", () => {
  const engine = new RulesEngine(make());
  engine.loadRuleSet({ ...make(), version: "2" });
  const versions = engine.listVersions();
  const expected = engine.evaluate(facts());
  const cycle: Record<string, unknown> = {};
  cycle.not = cycle;
  const invalid = [make(), { ...make(), version: "3", rules: [] }, { ...make(), version: "3", unknown: true },
    { ...make(), version: "3", rules: [{ ...make().rules[0], conditions: cycle }] },
    { ...make(), version: "3", description: new Date() }];
  for (const input of invalid) {
    assert.throws(() => engine.loadRuleSet(input), RuleValidationError);
    assert.deepEqual(engine.listVersions(), versions);
    assert.deepEqual(engine.evaluate(facts()), expected);
  }
  assert.throws(() => engine.rollback("missing"), RuleSetNotFoundError);
  assert.deepEqual(engine.listVersions(), versions);
  assert.deepEqual(engine.evaluate(facts()), expected);
  engine.loadRuleSet({ ...make(), version: "3" });
  assert.equal(engine.getCurrentVersion(), "3");
});

test("isolation: null prototypes, __proto__ data and signed zero survive copying", () => {
  const input = make();
  const params = Object.assign(Object.create(null), JSON.parse('{"__proto__":{"label":"data"}}'));
  params.zero = -0;
  input.rules[0]!.action.params = params;
  const engine = new RulesEngine(input);
  const output = engine.evaluate(facts()).actions[0]!.params!;
  assert.equal(Object.getPrototypeOf(output), null);
  assert.equal(Object.hasOwn(output, "__proto__"), true);
  assert.ok(Object.is(output.zero, -0));
  assert.deepEqual(output.__proto__, { label: "data" });
});
