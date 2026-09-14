import { test } from "node:test";
import assert from "node:assert/strict";
import { RulesEngine, type RuleSet, type Rule } from "../src/index.js";

function ruleset(): RuleSet {
  const rule = (id: string, options: Partial<Rule> = {}): Rule => ({
    id, conditions: { field: "x", operator: "exists" }, action: { type: id }, ...options,
  });
  return { version: "1", name: "order", rules: [
    rule("default"), rule("tie-first", { priority: 10 }), rule("disabled", { priority: 100, enabled: false }),
    rule("high-unmatched", { priority: 20, conditions: { field: "missing", operator: "exists" } }),
    rule("tie-second", { priority: 10 }), rule("negative", { priority: -1 }),
  ] };
}

for (const mode of ["first-match", "collect-all"] as const) {
  test(`ordering: priorities, stable ties, disabled rules and rollback in ${mode}`, () => {
    const input = ruleset();
    const engine = new RulesEngine(input, { mode });
    const expectedRules = mode === "first-match" ? ["high-unmatched", "tie-first"] : ["high-unmatched", "tie-first", "tie-second", "default", "negative"];
    const expectedActions = mode === "first-match" ? ["tie-first"] : ["tie-first", "tie-second", "default", "negative"];
    for (let i = 0; i < 3; i++) {
      const result = engine.evaluate({ x: false });
      assert.deepEqual(result.results.map(rule => rule.ruleId), expectedRules);
      assert.deepEqual(result.actions.map(action => action.type), expectedActions);
      assert.deepEqual(engine.explain({ x: false }), result);
    }
    assert.deepEqual(engine.getActiveRules().map(rule => rule.id), input.rules.map(rule => rule.id));
    const before = engine.evaluate({ x: false });
    engine.loadRuleSet({ ...input, version: "2", rules: input.rules.map((rule, index) => index === 0 ? { ...rule, priority: 30 } : rule) });
    assert.equal(engine.evaluate({ x: false }).actions[0]!.type, "default");
    engine.rollback("1");
    assert.deepEqual(engine.evaluate({ x: false }), before);
  });
}
