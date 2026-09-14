import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { connect } from "node:net";
import { request as httpRequest } from "node:http";
import { createDemoServer, MAX_BODY_BYTES } from "../examples/server.js";
import { RulesEngine } from "../src/index.js";

const TOKEN = "test-token-only";
const initial = { version: "1", name: "test", rules: [{ id: "r", conditions: { field: "x", operator: "exists" }, action: { type: "A" } }] };

async function setup(t: TestContext, options: { adminToken?: string } = { adminToken: TOKEN }) {
  const engine = new RulesEngine(initial);
  const server = createDemoServer({ engine, ...options });
  t.after(async () => {
    if (!server.listening) return;
    const closed = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    server.closeAllConnections();
    await closed;
  });
  const listening = once(server, "listening");
  server.listen(0, "127.0.0.1");
  await listening;
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const send = async (route: string, body?: string, token: string | null = TOKEN) => {
    const response = await fetch(base + route, {
      method: body === undefined ? "GET" : "POST", body,
      headers: { "Content-Type": "application/json", ...(token === null ? {} : { Authorization: `Bearer ${token}` }) },
      signal: AbortSignal.timeout(5000),
    });
    return { status: response.status, headers: response.headers, body: await response.json() };
  };
  return { engine, server, base, port: address.port, send };
}

test("HTTP: malformed JSON and incompatible bodies preserve state", async t => {
  const { engine, send } = await setup(t);
  const versions = engine.listVersions();
  for (const route of ["/evaluate", "/rules", "/rules/rollback"]) {
    for (const body of ["{", "", "not json"]) assert.equal((await send(route, body)).status, 400);
    for (const body of ["null", "[]", "1", '"text"']) assert.equal((await send(route, body)).status, 422);
  }
  for (const body of ["{}", '{"version":null}', '{"version":1}', '{"version":""}', '{"version":"1","extra":true}']) {
    assert.equal((await send("/rules/rollback", body)).status, 422);
  }
  assert.deepEqual(engine.listVersions(), versions);
  assert.equal((await send("/evaluate", '{"x":false}')).status, 200);
});

test("HTTP: administrative routes require a configured, matching token", async t => {
  const { engine, send } = await setup(t);
  const versions = engine.listVersions();
  for (const [route, body] of [["/rules", JSON.stringify({ ...initial, version: "2" })], ["/rules/rollback", '{"version":"1"}'], ["/rules/versions", undefined]] as const) {
    for (const token of [null, "wrong", "x".repeat(TOKEN.length)]) {
      const response = await send(route, body, token);
      assert.equal(response.status, 401);
      assert.equal(response.headers.get("www-authenticate"), "Bearer");
    }
  }
  assert.deepEqual(engine.listVersions(), versions);
  assert.equal((await send("/evaluate", '{"x":true}', null)).status, 200);
  const disabled = await setup(t, {});
  for (const [route, body] of [["/rules", JSON.stringify({ ...initial, version: "2" })], ["/rules/rollback", '{"version":"1"}'], ["/rules/versions", undefined]] as const) {
    assert.equal((await disabled.send(route, body)).status, 503);
  }
  assert.equal(disabled.engine.getCurrentVersion(), "1");
});

test("HTTP: load, duplicate rejection, listing and rollback use correct statuses", async t => {
  const { engine, send } = await setup(t);
  assert.equal((await send("/rules", JSON.stringify({ ...initial, version: "2" }))).status, 201);
  const versions = engine.listVersions();
  assert.equal((await send("/rules", JSON.stringify({ ...initial, version: "2" }))).status, 422);
  assert.equal((await send("/rules", JSON.stringify({ ...initial, version: "3", rules: [] }))).status, 422);
  assert.equal((await send("/rules/rollback", '{"version":"missing"}')).status, 404);
  assert.deepEqual(engine.listVersions(), versions);
  const listing = await send("/rules/versions");
  assert.equal(listing.status, 200);
  assert.ok(Array.isArray(listing.body));
  assert.equal(listing.body[1].active, true);
  assert.equal((await send("/rules/rollback", '{"version":"1"}')).status, 200);
  assert.equal(engine.getCurrentVersion(), "1");
  assert.equal((await send("/no-route")).status, 404);
});

test("HTTP: 500 hides unexpected details", async t => {
  const { engine, send } = await setup(t);
  t.mock.method(console, "error", () => {});
  t.mock.method(engine, "evaluate", () => { throw new Error("private implementation detail"); });
  const response = await send("/evaluate", "{}");
  assert.equal(response.status, 500);
  assert.deepEqual(response.body, { error: "Erro interno do servidor" });
});

test("HTTP: body limit is inclusive and counts UTF-8 bytes", async t => {
  const { engine, send } = await setup(t);
  const before = engine.listVersions();
  const prefix = '{"x":"';
  const suffix = '"}';
  const exact = prefix + "a".repeat(MAX_BODY_BYTES - prefix.length - suffix.length) + suffix;
  assert.equal(Buffer.byteLength(exact), MAX_BODY_BYTES);
  assert.equal((await send("/evaluate", exact)).status, 200);
  const tooLarge = prefix + "é".repeat(MAX_BODY_BYTES / 2) + suffix;
  assert.ok(tooLarge.length < MAX_BODY_BYTES);
  assert.equal((await send("/evaluate", tooLarge)).status, 413);
  assert.equal((await send("/rules", tooLarge)).status, 413);
  assert.deepEqual(engine.listVersions(), before);
});

test("HTTP: chunked oversized body gets 413 without Content-Length", { timeout: 10_000 }, async t => {
  const { base, engine } = await setup(t);
  const status = await new Promise<number | undefined>((resolve, reject) => {
    const req = httpRequest(base + "/rules", { method: "POST", headers: { Authorization: `Bearer ${TOKEN}` } }, res => {
      res.resume();
      res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", reject);
    req.write(" ".repeat(MAX_BODY_BYTES));
    req.end("{}");
  });
  assert.equal(status, 413);
  assert.equal(engine.getCurrentVersion(), "1");
});

test("HTTP: aborted body cannot activate a version or leave the server stuck", { timeout: 10_000 }, async t => {
  const { port, server, engine, send } = await setup(t);
  const before = engine.listVersions();
  const socket = connect(port, "127.0.0.1");
  t.after(() => socket.destroy());
  const interrupted = new Promise<void>(resolve => server.once("request", req => {
    req.once("aborted", () => resolve());
    req.once("data", () => socket.destroy());
  }));
  await once(socket, "connect");
  socket.write(`POST /rules HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer ${TOKEN}\r\nContent-Length: 1000\r\n\r\n{"version":"2"`);
  await interrupted;
  assert.deepEqual(engine.listVersions(), before);
  assert.equal((await send("/evaluate", "{}")).status, 200);
});

test("HTTP: read errors become controlled 400 responses", async t => {
  const { server, engine, send } = await setup(t);
  server.once("request", req => req.emit("error", new Error("read failed")));
  assert.equal((await send("/rules", JSON.stringify({ ...initial, version: "2" }))).status, 400);
  assert.equal(engine.getCurrentVersion(), "1");
});
