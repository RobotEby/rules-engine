import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { RulesEngine, RuleValidationError, type EvaluationResult, type Facts, type RuleAction } from "../src/index.js";

const SHIPPING_RULE = "frete-gratis-regioes-elegiveis";

function loadJson(file: string): unknown {
  return JSON.parse(readFileSync(new URL(file, import.meta.url), "utf8"));
}

/** Contrato comercial deste consumidor; não faz parte do núcleo genérico. */
export function validateCheckoutActions(actions: RuleAction[]): void {
  for (const action of actions) {
    if (action.type !== "PERCENT_DISCOUNT") continue;
    const percent = action.params?.percentual;
    assert.ok(typeof percent === "number" && Number.isFinite(percent) && percent >= 0 && percent <= 100,
      "PERCENT_DISCOUNT: percentual deve ser um número entre 0 e 100 no checkout");
  }
}

export function requireExplanation(result: EvaluationResult, ruleId: string) {
  const rule = result.results.find(item => item.ruleId === ruleId);
  assert.ok(rule, `Regra "${ruleId}" não encontrada na explicação da versão ${result.rulesetVersion}`);
  return rule.trace;
}

function printResult(label: string, result: EvaluationResult): void {
  console.log(`\n${label} — versão ${result.rulesetVersion}`);
  for (const rule of result.results) console.log(`${rule.matched ? "ATENDIDA" : "NÃO ATENDIDA"} [${rule.ruleId}] ${rule.description ?? ""}`);
  console.log("Ações retornadas:", JSON.stringify(result.actions));
}

export function runDemo(): void {
  const pedido = { valorPedido: 180, quantidadeItens: 3, destino: { regiao: "Sudeste" }, cliente: { vip: false, primeiraCompra: true } };
  const scenarios: { label: string; facts: Facts; shipping: [boolean, boolean]; discounts: number[] }[] = [
    { label: "R$180 no Sudeste", facts: pedido, shipping: [false, true], discounts: [5] },
    { label: "R$250 no Centro-Oeste", facts: { ...pedido, valorPedido: 250, destino: { regiao: "Centro-Oeste" } }, shipping: [false, true], discounts: [5] },
    ...([[149.99, false, false], [150, false, true], [199.99, false, true], [200, true, true]] as const).map(([value, v1, v2]) => ({
      label: `Limite: R$${value.toFixed(2)} no Sudeste`, facts: { ...pedido, valorPedido: value },
      shipping: [v1, v2] as [boolean, boolean], discounts: [5],
    })),
    { label: "R$500, primeira compra, sem destino.regiao", facts: { ...pedido, valorPedido: 500, quantidadeItens: 1, destino: {} }, shipping: [false, false], discounts: [5] },
    { label: "Descontos de 10% e 5% retornados juntos", facts: { ...pedido, valorPedido: 500, quantidadeItens: 6 }, shipping: [true, true], discounts: [10, 5] },
  ];
  const engine = new RulesEngine(loadJson("./rules-frete-desconto.v1.json"));
  const baseline = engine.evaluate(pedido);
  let verified = 0;
  for (const versionIndex of [0, 1] as const) {
    if (versionIndex === 1) {
      console.log("\nCarregando v2: limite reduzido de R$200 para R$150 e inclusão do Centro-Oeste.");
      engine.loadRuleSet(loadJson("./rules-frete-desconto.v2.json"));
    }
    for (const scenario of scenarios) {
      const result = engine.evaluate(scenario.facts);
      validateCheckoutActions(result.actions);
      assert.equal(result.rulesetVersion, String(versionIndex + 1));
      assert.equal(result.actions.filter(action => action.type === "FREE_SHIPPING").length, Number(scenario.shipping[versionIndex]), scenario.label);
      assert.deepEqual(result.actions.filter(action => action.type === "PERCENT_DISCOUNT").map(action => action.params?.percentual), scenario.discounts, scenario.label);
      assert.equal(result.actions.length, Number(scenario.shipping[versionIndex]) + scenario.discounts.length, scenario.label);
      printResult(scenario.label, result);
      verified++;
    }
  }
  console.log("\nAs ações de 10% e 5% permanecem separadas. A aplicação decide a política de composição; esta demo não soma nem aplica descontos.");
  const versions = engine.listVersions();
  const beforeFailure = engine.evaluate(pedido);
  assert.throws(() => engine.loadRuleSet({ version: "3", name: "atualização inválida", rules: [] }), RuleValidationError);
  assert.deepEqual(engine.listVersions(), versions);
  assert.deepEqual(engine.evaluate(pedido), beforeFailure);
  console.log("Atualização inválida rejeitada; v2 e histórico preservados.");
  engine.rollback("1");
  const rollback = engine.evaluate(pedido);
  assert.deepEqual(rollback, baseline);
  printResult("Rollback para v1", rollback);
  console.log("\nExplicação da regra de frete:", JSON.stringify(requireExplanation(engine.explain(pedido), SHIPPING_RULE), null, 2));
  console.log(`\nVerificações concluídas: ${verified} cenários, atualização inválida e rollback.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) runDemo();
