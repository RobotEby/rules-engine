import { test } from "node:test";
import assert from "node:assert/strict";
import { RulesEngine } from "../src/engine.js";
import { RuleValidationError, RuleSetNotFoundError } from "../src/types.js";

const rulesetV1 = {
  version: "1",
  name: "frete-e-desconto",
  rules: [
    {
      id: "frete-gratis",
      priority: 10,
      conditions: {
        all: [
          { field: "valorPedido", operator: "gte" as const, value: 200 },
          {
            field: "destino.regiao",
            operator: "in" as const,
            value: ["Sudeste", "Sul"],
          },
        ],
      },
      action: { type: "FREE_SHIPPING" },
    },
    {
      id: "desconto-volume",
      priority: 5,
      conditions: {
        field: "quantidadeItens",
        operator: "gte" as const,
        value: 5,
      },
      action: { type: "PERCENT_DISCOUNT", params: { percentual: 10 } },
    },
  ],
};

const rulesetV2 = {
  ...rulesetV1,
  version: "2",
  rules: [
    {
      ...rulesetV1.rules[0],
      conditions: {
        all: [
          { field: "valorPedido", operator: "gte" as const, value: 150 },
          {
            field: "destino.regiao",
            operator: "in" as const,
            value: ["Sudeste", "Sul"],
          },
        ],
      },
    },
    rulesetV1.rules[1],
  ],
};

test("evaluate: casa a regra correta e retorna a ação", () => {
  const engine = new RulesEngine(rulesetV1);
  const result = engine.evaluate({
    valorPedido: 250,
    destino: { regiao: "Sul" },
    quantidadeItens: 1,
  });
  assert.equal(result.actions.length, 1);
  assert.deepEqual(result.actions[0], { type: "FREE_SHIPPING" });
});

test("evaluate: testa o limite exato (boundary) — gte é inclusivo", () => {
  const engine = new RulesEngine(rulesetV1);
  const noLimite = engine.evaluate({
    valorPedido: 200,
    destino: { regiao: "Sul" },
    quantidadeItens: 1,
  });
  const abaixoDoLimite = engine.evaluate({
    valorPedido: 199.99,
    destino: { regiao: "Sul" },
    quantidadeItens: 1,
  });
  assert.equal(noLimite.actions.length, 1);
  assert.equal(abaixoDoLimite.actions.length, 0);
});

test("evaluate: múltiplas regras podem casar (modo collect-all, padrão)", () => {
  const engine = new RulesEngine(rulesetV1);
  const result = engine.evaluate({
    valorPedido: 300,
    destino: { regiao: "Sul" },
    quantidadeItens: 6,
  });
  assert.equal(result.actions.length, 2);
});

test("evaluate: modo first-match para na primeira regra que casar (ordem por prioridade)", () => {
  const engine = new RulesEngine(rulesetV1, { mode: "first-match" });
  const result = engine.evaluate({
    valorPedido: 300,
    destino: { regiao: "Sul" },
    quantidadeItens: 6,
  });
  assert.equal(result.actions.length, 1);
  assert.equal(result.results[0]?.ruleId, "frete-gratis");
});

test("evaluate: regra desabilitada é ignorada", () => {
  const ruleset = {
    ...rulesetV1,
    rules: [{ ...rulesetV1.rules[0], enabled: false }, rulesetV1.rules[1]],
  };
  const engine = new RulesEngine(ruleset);
  const result = engine.evaluate({
    valorPedido: 999,
    destino: { regiao: "Sul" },
    quantidadeItens: 1,
  });
  assert.equal(result.actions.length, 0);
  assert.equal(
    result.results.find((r) => r.ruleId === "frete-gratis"),
    undefined,
  );
});

test("evaluate: dado ausente não lança exceção, apenas não casa a regra", () => {
  const engine = new RulesEngine(rulesetV1);
  assert.doesNotThrow(() => engine.evaluate({}));
  const result = engine.evaluate({});
  assert.equal(result.actions.length, 0);
});

test("loadRuleSet: rejeita JSON inválido com RuleValidationError", () => {
  const engine = new RulesEngine(rulesetV1);
  assert.throws(
    () => engine.loadRuleSet({ version: "2", name: "x", rules: [] }),
    RuleValidationError,
  );
  assert.equal(engine.getCurrentVersion(), "1");
});

test("loadRuleSet: hot-reload troca a versão ativa sem perder o histórico", () => {
  const engine = new RulesEngine(rulesetV1);
  const antes = engine.evaluate({
    valorPedido: 180,
    destino: { regiao: "Sul" },
    quantidadeItens: 1,
  });
  assert.equal(antes.actions.length, 0); // 180 < 200, não casa em v1

  engine.loadRuleSet(rulesetV2);
  const depois = engine.evaluate({
    valorPedido: 180,
    destino: { regiao: "Sul" },
    quantidadeItens: 1,
  });
  assert.equal(depois.actions.length, 1); // 180 >= 150, casa em v2
  assert.equal(engine.getCurrentVersion(), "2");
});

test("loadRuleSet: rejeita recarregar a mesma versão já carregada", () => {
  const engine = new RulesEngine(rulesetV1);
  assert.throws(() => engine.loadRuleSet(rulesetV1), RuleValidationError);
});

test("rollback: volta para uma versão anterior carregada", () => {
  const engine = new RulesEngine(rulesetV1);
  engine.loadRuleSet(rulesetV2);
  engine.rollback("1");
  assert.equal(engine.getCurrentVersion(), "1");
  const result = engine.evaluate({
    valorPedido: 180,
    destino: { regiao: "Sul" },
    quantidadeItens: 1,
  });
  assert.equal(result.actions.length, 0); // voltou a exigir >= 200
});

test("rollback: lança RuleSetNotFoundError para versão nunca carregada", () => {
  const engine = new RulesEngine(rulesetV1);
  assert.throws(() => engine.rollback("999"), RuleSetNotFoundError);
});

test("listVersions: reporta todas as versões carregadas e marca a ativa", () => {
  const engine = new RulesEngine(rulesetV1);
  engine.loadRuleSet(rulesetV2);
  const versions = engine.listVersions();
  assert.equal(versions.length, 2);
  assert.equal(versions.find((v) => v.version === "2")?.active, true);
  assert.equal(versions.find((v) => v.version === "1")?.active, false);
});

test("explain: retorna o trace de condições junto do resultado", () => {
  const engine = new RulesEngine(rulesetV1);
  const result = engine.explain({
    valorPedido: 250,
    destino: { regiao: "Sul" },
    quantidadeItens: 1,
  });
  const rule = result.results.find((r) => r.ruleId === "frete-gratis");
  assert.equal(rule?.trace.type, "all");
  assert.equal(rule?.trace.children?.length, 2);
});

test("evaluate: sem ruleset carregado lança erro claro", () => {
  const engine = new RulesEngine();
  assert.throws(() => engine.evaluate({}), /Nenhum RuleSet carregado/);
});
