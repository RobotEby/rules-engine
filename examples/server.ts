import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  RulesEngine, RuleValidationError, RuleSetNotFoundError, FactsValidationError,
  validateFacts, validateRuleSet, type Facts,
} from "../src/index.js";

export const MAX_BODY_BYTES = 1024 * 1024;

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    const cleanup = () => {
      req.off("data", onData); req.off("end", onEnd); req.off("error", onError);
      req.off("aborted", onAborted); req.off("close", onClose);
    };
    const fail = (error: HttpError) => {
      if (settled) return;
      settled = true;
      cleanup();
      chunks.length = 0;
      // Ainda pode haver um erro de socket após a interrupção da leitura.
      req.on("error", () => {});
      req.resume();
      reject(error);
    };
    const onData = (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) { fail(new HttpError(413, "Corpo excede o limite de 1 MiB")); return; }
      chunks.push(chunk);
    };
    const onEnd = () => {
      if (settled) return;
      let body: unknown;
      try { body = JSON.parse(Buffer.concat(chunks, bytes).toString("utf8")); }
      catch { fail(new HttpError(400, "JSON malformado")); return; }
      settled = true;
      cleanup();
      resolve(body);
    };
    const onError = () => fail(new HttpError(400, "Falha na leitura do corpo"));
    const onAborted = () => fail(new HttpError(400, "Leitura do corpo interrompida"));
    const onClose = () => { if (!req.complete) onAborted(); };
    req.on("data", onData); req.once("end", onEnd); req.once("error", onError);
    req.once("aborted", onAborted); req.once("close", onClose);
    const declaredLength = req.headers["content-length"];
    if (declaredLength && Number(declaredLength) > MAX_BODY_BYTES) fail(new HttpError(413, "Corpo excede o limite de 1 MiB"));
    else if (req.destroyed || req.aborted) onAborted();
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.destroyed || res.writableEnded) return;
  const data = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...(status >= 400 ? { Connection: "close" } : {}),
    ...(status === 401 ? { "WWW-Authenticate": "Bearer" } : {}),
  });
  res.end(data);
}

function authorize(req: IncomingMessage, token: string | undefined): void {
  if (!token || token.trim() === "") throw new HttpError(503, "Administração desabilitada: configure ADMIN_TOKEN");
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(req.headers.authorization ?? "");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new HttpError(401, "Credenciais administrativas inválidas");
}

/** Fábrica sem escuta nem leitura de ambiente; útil para testes e incorporação local. */
export function createDemoServer(options: { engine: RulesEngine; adminToken?: string }) {
  const { engine, adminToken } = options;
  return createServer(async (req, res) => {
    try {
      if (req.url === "/rules" || req.url?.startsWith("/rules/")) authorize(req, adminToken);
      if (req.method === "POST" && req.url === "/evaluate") {
        const body = await readJsonBody(req);
        const validation = validateFacts(body);
        if (!validation.valid) throw new FactsValidationError(validation.errors);
        return sendJson(res, 200, engine.evaluate(body as Facts));
      }
      if (req.method === "POST" && req.url === "/rules") {
        const body = await readJsonBody(req);
        const validation = validateRuleSet(body);
        if (!validation.valid) throw new RuleValidationError(validation.errors);
        const loaded = engine.loadRuleSet(body);
        return sendJson(res, 201, { message: "RuleSet carregado e ativado", version: loaded.version });
      }
      if (req.method === "GET" && req.url === "/rules/versions") {
        return sendJson(res, 200, engine.listVersions());
      }
      if (req.method === "POST" && req.url === "/rules/rollback") {
        const body = await readJsonBody(req);
        if (body === null || typeof body !== "object" || Array.isArray(body)
          || Object.keys(body).length !== 1 || !("version" in body)
          || typeof body.version !== "string" || body.version.trim() === "") {
          throw new HttpError(422, "Corpo deve conter somente version, uma string não-vazia");
        }
        engine.rollback(body.version);
        return sendJson(res, 200, { message: "Rollback aplicado", version: body.version });
      }
      sendJson(res, 404, { error: "Rota não encontrada" });
    } catch (error) {
      if (error instanceof RuleValidationError || error instanceof FactsValidationError) {
        return sendJson(res, 422, { error: error.message, details: error.errors });
      }
      if (error instanceof RuleSetNotFoundError) return sendJson(res, 404, { error: error.message });
      if (error instanceof HttpError) return sendJson(res, error.status, { error: error.message });
      console.error("Falha inesperada no servidor demonstrativo:", error);
      sendJson(res, 500, { error: "Erro interno do servidor" });
    }
  });
}

function main(): void {
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("PORT deve ser um inteiro entre 0 e 65535");
  const initial: unknown = JSON.parse(readFileSync(new URL("./rules-frete-desconto.v1.json", import.meta.url), "utf8"));
  const engine = new RulesEngine(initial);
  const server = createDemoServer({ engine, adminToken: process.env.ADMIN_TOKEN });
  server.listen(port, "127.0.0.1", () => {
    const address = server.address();
    if (!address || typeof address === "string") return;
    console.log(`Servidor em http://127.0.0.1:${address.port} — ruleset v${engine.getCurrentVersion()}`);
    console.log("POST /evaluate; operações /rules exigem ADMIN_TOKEN e Authorization: Bearer <token>.");
  });
  const shutdown = () => {
    server.close(error => { if (error) { console.error(error); process.exitCode = 1; } });
    server.closeAllConnections();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
