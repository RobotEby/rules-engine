import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { RulesEngine, RuleValidationError } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const initial = JSON.parse(
  readFileSync(path.join(__dirname, "rules-frete-desconto.v1.json"), "utf-8"),
);
const engine = new RulesEngine(initial);

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sendJson(
  res: import("node:http").ServerResponse,
  status: number,
  body: unknown,
) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body, null, 2));
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/evaluate") {
      const facts = JSON.parse(await readBody(req));
      return sendJson(res, 200, engine.evaluate(facts));
    }

    if (req.method === "POST" && req.url === "/rules") {
      const body = JSON.parse(await readBody(req));
      const loaded = engine.loadRuleSet(body);
      return sendJson(res, 201, {
        message: "RuleSet carregado e ativado",
        version: loaded.version,
      });
    }

    if (req.method === "GET" && req.url === "/rules/versions") {
      return sendJson(res, 200, engine.listVersions());
    }

    if (req.method === "POST" && req.url === "/rules/rollback") {
      const { version } = JSON.parse(await readBody(req));
      engine.rollback(version);
      return sendJson(res, 200, { message: "Rollback aplicado", version });
    }

    sendJson(res, 404, { error: "rota não encontrada" });
  } catch (err) {
    if (err instanceof RuleValidationError) {
      return sendJson(res, 422, { error: err.message, details: err.errors });
    }
    sendJson(res, 500, { error: (err as Error).message });
  }
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Ruleset ativo: v${engine.getCurrentVersion()}`);
  console.log(`
Experimente:
    -d '{"valorPedido":180,"quantidadeItens":3,"destino":{"regiao":"Sudeste"},"cliente":{"vip":false,"primeiraCompra":true}}'
`);
});
