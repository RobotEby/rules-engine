import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";

const root = fileURLToPath(new URL("../", import.meta.url));
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, "Execute via npm run test:package");
const temporary = mkdtempSync(path.join(tmpdir(), "rules-engine-consumer-"));

function run(args, cwd = root) {
  const result = spawnSync(process.execPath, args, { cwd, encoding: "utf8", timeout: 120_000, maxBuffer: 8 * 1024 * 1024 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${args.join(" ")}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

async function verifyServer(file) {
  const child = spawn(process.execPath, [file], {
    cwd: temporary, env: { ...process.env, PORT: "0", ADMIN_TOKEN: "package-test-token" }, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let errors = "";
  child.stderr.on("data", chunk => { errors += chunk; });
  try {
    const base = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error(`Servidor não iniciou: ${output} ${errors}`)), 10_000);
      const onExit = () => finish(new Error(`Servidor encerrou antes de iniciar: ${errors}`));
      const onData = chunk => {
        output += chunk;
        const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) finish(undefined, match[0]);
      };
      function finish(error, url) {
        clearTimeout(timeout);
        child.off("exit", onExit); child.off("error", finish); child.stdout.off("data", onData);
        if (error) reject(error); else resolve(url);
      }
      child.once("exit", onExit); child.once("error", finish); child.stdout.on("data", onData);
    });
    const send = async (route, body, admin = true) => {
      const response = await fetch(base + route, {
        method: body === undefined ? "GET" : "POST", body,
        headers: { "Content-Type": "application/json", ...(admin ? { Authorization: "Bearer package-test-token" } : {}) },
        signal: AbortSignal.timeout(5000),
      });
      return { status: response.status, body: await response.json() };
    };
    assert.equal((await send("/rules/versions", undefined, false)).status, 401);
    assert.equal((await send("/evaluate", "null")).status, 422);
    const facts = JSON.stringify({ valorPedido: 180, quantidadeItens: 3, destino: { regiao: "Sudeste" }, cliente: { primeiraCompra: true } });
    const before = await send("/evaluate", facts);
    assert.equal(before.status, 200);
    assert.equal(before.body.actions.some(action => action.type === "FREE_SHIPPING"), false);
    const v2 = readFileSync(path.join(path.dirname(file), "rules-frete-desconto.v2.json"), "utf8");
    assert.equal((await send("/rules", v2)).status, 201);
    assert.equal((await send("/evaluate", facts)).body.actions.some(action => action.type === "FREE_SHIPPING"), true);
    assert.equal((await send("/rules/rollback", '{"version":"1"}')).status, 200);
    assert.deepEqual((await send("/evaluate", facts)).body, before.body);
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill("SIGTERM");
      const timeout = setTimeout(() => child.kill("SIGKILL"), 5000);
      try { const [code, signal] = await exited; assert.equal(code, 0, errors); assert.equal(signal, null); }
      finally { clearTimeout(timeout); }
    }
  }
}

try {
  // A sentinela prova que o prepack reconstrói dist a partir de uma saída limpa.
  mkdirSync(path.join(root, "dist"), { recursive: true });
  const stale = path.join(root, "dist/stale-package-check.txt");
  writeFileSync(stale, "must be removed by build");
  const packed = JSON.parse(run([npmCli, "pack", "--json", "--silent", "--pack-destination", temporary]));
  assert.equal(existsSync(stale), false);
  const manifest = packed[0];
  const paths = manifest.files.map(file => file.path);
  for (const required of ["dist/src/index.js", "dist/src/index.d.ts", "dist/examples/demo.js", "dist/examples/server.js", "dist/examples/rules-frete-desconto.v1.json", "dist/examples/rules-frete-desconto.v2.json"]) assert.ok(paths.includes(required), required);
  // npm sempre inclui LICENSE no pacote, independentemente de "files".
  assert.ok(paths.every(file => file === "package.json" || file === "README.md" || file === "LICENSE" || file.startsWith("dist/src/") || file.startsWith("dist/examples/")), paths.join("\n"));
  const consumer = path.join(temporary, "consumer");
  mkdirSync(consumer);
  writeFileSync(path.join(consumer, "package.json"), JSON.stringify({ private: true, type: "module" }));
  run([npmCli, "install", path.join(temporary, manifest.filename), "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false"], consumer);
  writeFileSync(path.join(consumer, "consumer.mjs"), `
import assert from 'node:assert/strict';
import { RulesEngine, validateFacts, VALIDATION_LIMITS, FactsValidationError } from 'rules-engine';
const engine = new RulesEngine({ version: '1', name: 'consumer', rules: [{ id: 'r', conditions: { field: 'x', operator: 'gte', value: 2 }, action: { type: 'A' } }] });
assert.equal(engine.evaluate({ x: 2 }).actions[0].type, 'A');
assert.equal(validateFacts({ x: undefined }).valid, true);
assert.equal(VALIDATION_LIMITS.maxDepth, 64);
assert.throws(() => engine.evaluate(null), FactsValidationError);
`);
  writeFileSync(path.join(consumer, "consumer.ts"), `
import { RulesEngine, type RuleSet, type RulesEngineOptions, type EvaluationResult, type Facts, type JsonValue } from 'rules-engine';
const rules: RuleSet = { version: '1', name: 'consumer', rules: [{ id: 'r', conditions: { field: 'x', operator: 'exists' }, action: { type: 'A', params: { nested: [1, null] } } }] };
const options: RulesEngineOptions = { mode: 'collect-all' };
const facts: Facts = { x: undefined };
const result: EvaluationResult = new RulesEngine(rules, options).evaluate(facts);
const state: 'missing' | 'undefined' | 'null' | 'value' | undefined = result.results[0]?.trace.actualState;
// @ts-expect-error Date is outside the declared JSON domain.
const invalid: JsonValue = new Date();
`);
  run(["consumer.mjs"], consumer);
  run([path.join(root, "node_modules/typescript/bin/tsc"), "--noEmit", "--strict", "--module", "NodeNext", "--moduleResolution", "NodeNext", "--target", "ES2022", "consumer.ts"], consumer);
  const installed = path.join(consumer, "node_modules/rules-engine");
  const pkg = JSON.parse(readFileSync(path.join(installed, "package.json"), "utf8"));
  assert.equal(Object.keys(pkg.dependencies ?? {}).length, 0);
  assert.match(run([path.join(installed, "dist/examples/demo.js")], consumer), /16 cenários/);
  await verifyServer(path.join(root, "dist/examples/server.js"));
  await verifyServer(path.join(installed, "dist/examples/server.js"));
  console.log(`Pacote verificado em ${process.version}: ${paths.length} arquivos, entrada ESM, tipos NodeNext, demo e servidores compilado/instalado; zero dependências de runtime.`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
