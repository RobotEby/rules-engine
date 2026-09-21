import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateCondition, getByPath } from "../src/conditions.js";

test("getByPath lê caminhos aninhados", () => {
  const facts = { destino: { regiao: "Sul" } };
  assert.equal(getByPath(facts, "destino.regiao"), "Sul");
});

test("getByPath retorna undefined para caminho ausente, sem lançar exceção", () => {
  const facts = { destino: {} };
  assert.equal(getByPath(facts, "destino.regiao"), undefined);
  assert.equal(getByPath({}, "a.b.c"), undefined);
});

test("operador eq/ne", () => {
  assert.equal(evaluateCondition({ field: "x", operator: "eq", value: 1 }, { x: 1 }).passed, true);
  assert.equal(evaluateCondition({ field: "x", operator: "eq", value: 1 }, { x: 2 }).passed, false);
  assert.equal(evaluateCondition({ field: "x", operator: "ne", value: 1 }, { x: 2 }).passed, true);
});

test("operadores numéricos respeitam limites (gte/lte são inclusivos)", () => {
  assert.equal(evaluateCondition({ field: "v", operator: "gte", value: 200 }, { v: 200 }).passed, true);
  assert.equal(evaluateCondition({ field: "v", operator: "gte", value: 200 }, { v: 199.99 }).passed, false);
  assert.equal(evaluateCondition({ field: "v", operator: "gt", value: 200 }, { v: 200 }).passed, false);
  assert.equal(evaluateCondition({ field: "v", operator: "lt", value: 5 }, { v: 4.99 }).passed, true);
  assert.equal(evaluateCondition({ field: "v", operator: "lt", value: 5 }, { v: 5 }).passed, false);
  assert.equal(evaluateCondition({ field: "v", operator: "lte", value: 5 }, { v: 5 }).passed, true);
});

test("operadores numéricos com campo não-numérico não casam (não lançam exceção)", () => {
  assert.equal(evaluateCondition({ field: "v", operator: "gte", value: 10 }, { v: "abc" }).passed, false);
  assert.equal(evaluateCondition({ field: "v", operator: "gte", value: 10 }, {}).passed, false);
});

test("in / notIn", () => {
  assert.equal(evaluateCondition({ field: "r", operator: "in", value: ["A", "B"] }, { r: "A" }).passed, true);
  assert.equal(evaluateCondition({ field: "r", operator: "in", value: ["A", "B"] }, { r: "C" }).passed, false);
  assert.equal(evaluateCondition({ field: "r", operator: "notIn", value: ["A", "B"] }, { r: "C" }).passed, true);
});

test("exists / notExists com dado ausente", () => {
  assert.equal(evaluateCondition({ field: "cliente.vip", operator: "exists" }, {}).passed, false);
  assert.equal(evaluateCondition({ field: "cliente.vip", operator: "notExists" }, {}).passed, true);
  assert.equal(evaluateCondition({ field: "cliente.vip", operator: "exists" }, { cliente: { vip: false } }).passed, true);
});

test("all: todas as sub-condições devem passar", () => {
  const cond = { all: [
    { field: "a", operator: "eq" as const, value: 1 },
    { field: "b", operator: "eq" as const, value: 2 },
  ] };
  assert.equal(evaluateCondition(cond, { a: 1, b: 2 }).passed, true);
  assert.equal(evaluateCondition(cond, { a: 1, b: 3 }).passed, false);
});

test("any: basta uma sub-condição passar", () => {
  const cond = { any: [
    { field: "a", operator: "eq" as const, value: 1 },
    { field: "b", operator: "eq" as const, value: 2 },
  ] };
  assert.equal(evaluateCondition(cond, { a: 0, b: 2 }).passed, true);
  assert.equal(evaluateCondition(cond, { a: 0, b: 0 }).passed, false);
});

test("not: inverte o resultado da sub-condição", () => {
  const cond = { not: { field: "a", operator: "eq" as const, value: 1 } };
  assert.equal(evaluateCondition(cond, { a: 1 }).passed, false);
  assert.equal(evaluateCondition(cond, { a: 2 }).passed, true);
});

test("condições aninhadas (all dentro de any) e trace com filhos", () => {
  const cond = {
    any: [
      { all: [
        { field: "valorPedido", operator: "gte" as const, value: 200 },
        { field: "destino.regiao", operator: "in" as const, value: ["Sudeste", "Sul"] },
      ] },
      { field: "cliente.vip", operator: "eq" as const, value: true },
    ],
  };
  const trace = evaluateCondition(cond, { valorPedido: 250, destino: { regiao: "Sul" }, cliente: { vip: false } });
  assert.equal(trace.passed, true);
  assert.equal(trace.type, "any");
  assert.equal(trace.children?.length, 2);
  assert.equal(trace.children?.[0]?.passed, true);
  assert.equal(trace.children?.[1]?.passed, false);
});
