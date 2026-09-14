import { test } from "node:test";
import assert from "node:assert/strict";
import { validateRuleSet } from "../src/validation.js";

const validRuleSet = {
  version: "1",
  name: "teste",
  rules: [
    {
      id: "r1",
      conditions: { field: "x", operator: "eq", value: 1 },
      action: { type: "SOME_ACTION" },
    },
  ],
};

test("aceita um ruleset bem formado", () => {
  const result = validateRuleSet(validRuleSet);
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("rejeita entrada que não é objeto", () => {
  assert.equal(validateRuleSet(null).valid, false);
  assert.equal(validateRuleSet("string").valid, false);
  assert.equal(validateRuleSet([]).valid, false);
});

test("rejeita ruleset sem version/name/rules", () => {
  const result = validateRuleSet({});
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.startsWith("version:")));
  assert.ok(result.errors.some((e) => e.startsWith("name:")));
  assert.ok(result.errors.some((e) => e.startsWith("rules:")));
});

test("rejeita rules vazio", () => {
  const result = validateRuleSet({ version: "1", name: "x", rules: [] });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("ao menos uma regra")));
});

test("rejeita ids de regra duplicados", () => {
  const result = validateRuleSet({
    version: "1",
    name: "x",
    rules: [
      { id: "dup", conditions: { field: "a", operator: "exists" }, action: { type: "A" } },
      { id: "dup", conditions: { field: "b", operator: "exists" }, action: { type: "B" } },
    ],
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('id duplicado "dup"')));
});

test("rejeita operador desconhecido", () => {
  const result = validateRuleSet({
    version: "1",
    name: "x",
    rules: [{ id: "r1", conditions: { field: "a", operator: "between", value: [1, 2] }, action: { type: "A" } }],
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("operator")));
});

test("rejeita 'value' ausente quando o operador exige valor", () => {
  const result = validateRuleSet({
    version: "1",
    name: "x",
    rules: [{ id: "r1", conditions: { field: "a", operator: "eq" }, action: { type: "A" } }],
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes(".value: obrigatório")));
});

test("aceita operadores exists/notExists sem 'value'", () => {
  const result = validateRuleSet({
    version: "1",
    name: "x",
    rules: [{ id: "r1", conditions: { field: "a", operator: "exists" }, action: { type: "A" } }],
  });
  assert.equal(result.valid, true);
});

test("rejeita misturar combinador com field no mesmo nó", () => {
  const result = validateRuleSet({
    version: "1",
    name: "x",
    rules: [
      {
        id: "r1",
        conditions: { all: [{ field: "a", operator: "exists" }], field: "b", operator: "exists" },
        action: { type: "A" },
      },
    ],
  });
  assert.equal(result.valid, false);
});

test("rejeita all/any vazio", () => {
  const result = validateRuleSet({
    version: "1",
    name: "x",
    rules: [{ id: "r1", conditions: { all: [] }, action: { type: "A" } }],
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("array não-vazio")));
});

test("valida recursivamente condições aninhadas com erro em profundidade", () => {
  const result = validateRuleSet({
    version: "1",
    name: "x",
    rules: [
      {
        id: "r1",
        conditions: { all: [{ any: [{ field: "a", operator: "eq", value: 1 }, { field: "b" }] }] },
        action: { type: "A" },
      },
    ],
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("rules[0].conditions.all[0].any[1]")));
});
