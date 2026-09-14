import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { RulesEngine } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadJson(file: string): unknown {
  return JSON.parse(readFileSync(path.join(__dirname, file), "utf-8"));
}

function printResult(
  label: string,
  result: ReturnType<RulesEngine["evaluate"]>,
) {
  console.log(
    `\n--- ${label} (ruleset v${result.rulesetVersion}, modo: ${result.mode}) ---`,
  );
  for (const r of result.results) {
    const status = r.matched ? "CASOU" : "  não casou";
    console.log(`${status}  [${r.ruleId}] ${r.description ?? ""}`);
  }
  console.log("Ações disparadas:", JSON.stringify(result.actions, null, 2));
}

const pedido = {
  valorPedido: 180,
  quantidadeItens: 3,
  destino: { regiao: "Sudeste" },
  cliente: { vip: false, primeiraCompra: true },
};

console.log("Pedido de exemplo:", JSON.stringify(pedido, null, 2));

const engine = new RulesEngine(loadJson("rules-frete-desconto.v1.json"));
const resultV1 = engine.evaluate(pedido);
printResult("Avaliação com v1", resultV1);
console.log(
  "\nEm v1, o pedido de R$180 NÃO ganha frete grátis (limite era R$200).",
);

console.log("\n>>> Aplicando hot-reload para a v2 (limite cai para R$150)...");
engine.loadRuleSet(loadJson("rules-frete-desconto.v2.json"));
const resultV2 = engine.evaluate(pedido);
printResult("Avaliação com v2 (mesmo pedido, engine não reiniciou)", resultV2);

console.log("\nVersões carregadas:", engine.listVersions());

console.log("\n>>> Fazendo rollback para v1...");
engine.rollback("1");
const resultRollback = engine.evaluate(pedido);
printResult("Avaliação após rollback para v1", resultRollback);

console.log(
  "\n--- Explicação detalhada da regra 'frete-gratis-sudeste' em v1 ---",
);
const explained = engine.explain(pedido);
const rule = explained.results.find((r) => r.ruleId === "frete-gratis-sudeste");
console.log(JSON.stringify(rule?.trace, null, 2));

console.log(
  "\n--- Avaliação com dado ausente (destino.regiao não informado) ---",
);
const pedidoIncompleto = { valorPedido: 500, quantidadeItens: 1 };
const resultIncompleto = engine.evaluate(pedidoIncompleto);
printResult("Pedido sem destino.regiao", resultIncompleto);
