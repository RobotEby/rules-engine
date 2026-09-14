import { test } from "node:test";
import assert from "node:assert/strict";
import { runDemo, requireExplanation, validateCheckoutActions } from "../examples/demo.js";

test("demo: all documented scenarios assert their expected actions", t => {
  const logs: string[] = [];
  t.mock.method(console, "log", (...args: unknown[]) => { logs.push(args.join(" ")); });
  runDemo();
  assert.ok(logs.some(line => line.includes("16 cenários")));
  assert.ok(logs.some(line => line.includes("Centro-Oeste")));
  assert.ok(logs.some(line => line.includes("Ações retornadas")));
});

test("demo: missing explanation fails clearly", () => {
  assert.throws(() => requireExplanation({ rulesetVersion: "1", mode: "collect-all", actions: [], results: [] }, "missing"), /Regra "missing" não encontrada/);
});

test("demo: percentage validation belongs to checkout and does not compose actions", () => {
  const actions = [10, 5].map(percentual => ({ type: "PERCENT_DISCOUNT", params: { percentual } }));
  validateCheckoutActions(actions);
  assert.deepEqual(actions.map(action => action.params.percentual), [10, 5]);
  for (const percentual of [-1, 101, "5", null]) assert.throws(() => validateCheckoutActions([{ type: "PERCENT_DISCOUNT", params: { percentual } }]), /entre 0 e 100/);
  assert.doesNotThrow(() => validateCheckoutActions([0, 100].map(percentual => ({ type: "PERCENT_DISCOUNT", params: { percentual } }))));
});
