import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, readdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parseConfig, assertLiveReady } from "../src/config.js";
import { log, print, safeText, setLogLevel } from "../src/logger.js";
import { ClobTradingClient } from "../src/polymarket/clob.js";
import { Executor } from "../src/trading/executor.js";
import { Store } from "../src/store/db.js";
import { Portfolio } from "../src/trading/portfolio.js";
import type { TradeSignal } from "../src/types.js";

const cfg = parseConfig({});
// Deliberately invalid credential markers, never a wallet private key.
const credentials = {
  PRIVATE_KEY: "test-only-not-a-private-key",
  CLOB_API_KEY: "test-only-api-key",
  CLOB_API_SECRET: 'test-only-secret/with+symbols"',
  CLOB_API_PASSPHRASE: "test-only-passphrase",
};
const signal: TradeSignal = {
  eventId: "event", marketId: "market", cityKey: "hong_kong", dateLocal: "2026-11-09",
  question: "Synthetic market", tokenId: "123", side: "BUY", modelProb: 0.6,
  price: 0.4, edge: 0.2, stake: 10, size: 25, tickSize: 0.01, negRisk: false, reason: "fixture",
};

function temp(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(join(tmpdir(), "weather-security-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function cli(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [
    "--import", import.meta.resolve("tsx"),
    "--import", fileURLToPath(new URL("./fixtures/offline.ts", import.meta.url)),
    fileURLToPath(new URL("../src/index.ts", import.meta.url)), ...args,
  ], { cwd, env: { PATH: process.env.PATH, ...env }, encoding: "utf8", timeout: 15_000 });
}

test("configuration defaults are paper, credential-free, and preserve strategy parameters", () => {
  assert.equal(cfg.TRADING_MODE, "paper");
  assert.equal(cfg.MIN_EDGE, 0.08);
  assert.equal(cfg.MODEL_WEIGHT, 0.5);
  assert.equal(cfg.SPREAD_INFLATION, 1.4);
  assert.equal(cfg.CORRELATION_DECAY, 0.5);
  assert.deepEqual(parseConfig(credentials), cfg);
  assert.deepEqual(parseConfig({ CITIES: " Seoul, Hong_Kong " }).CITIES, ["seoul", "hong_kong"]);
  assert.doesNotThrow(() => assertLiveReady(cfg));
  assert.throws(() => assertLiveReady(parseConfig({ TRADING_MODE: "live", ...credentials })), /disabled/);
});

test("validation errors name fields without echoing supplied values", () => {
  for (const field of ["TRADING_MODE", "LOG_LEVEL", "CLOB_HOST", "MIN_EDGE"]) {
    assert.throws(() => parseConfig({ [field]: credentials.CLOB_API_SECRET }), (err: Error) => {
      assert.match(err.message, new RegExp(field));
      assert.ok(!err.message.includes(credentials.CLOB_API_SECRET));
      return true;
    });
  }
});

test("every log level and CLI printing redact credentials, nested fields and errors", (t) => {
  t.mock.property(process, "env", { ...process.env, ...credentials });
  const output: unknown[][] = [];
  for (const method of ["log", "warn", "error"] as const) t.mock.method(console, method, (...args: unknown[]) => output.push(args));
  setLogLevel("debug");
  t.after(() => setLogLevel("info"));
  const message = Object.values(credentials).join(" ");
  for (const method of ["debug", "info", "warn", "error"] as const) {
    log[method](message, { nested: { secret: "unregistered-secret", privateKey: "unregistered-key" }, error: new Error(message) });
  }
  print(message, { passphrase: "unregistered-passphrase" });
  const text = JSON.stringify(output);
  for (const value of [...Object.values(credentials), "unregistered-secret", "unregistered-key", "unregistered-passphrase"]) {
    assert.ok(!text.includes(value));
  }
  assert.match(text, /REDACTED/);
  assert.equal(safeText(encodeURIComponent(credentials.CLOB_API_SECRET)), "[REDACTED]");
  const circular: { self?: unknown } = {}; circular.self = circular;
  assert.equal(safeText(circular), "[unserializable]");
});

test("official SDK reads a public book without credentials, preserving best prices", async (t) => {
  const { requests, book } = await import("./fixtures/offline.js");
  const client = new ClobTradingClient(parseConfig(credentials));
  const snapshot = await client.getBook("123");
  assert.deepEqual(snapshot, { tokenId: "123", bidPrice: 0.08, bidSize: 1000, askPrice: 0.1, askSize: 1000, midPrice: 0.09 });
  assert.equal(requests.at(-1)?.searchParams.get("token_id"), "123");
  t.mock.method(globalThis, "fetch", async () => Response.json({ ...book("123"), bids: [], asks: [] }));
  assert.deepEqual(await client.getBook("123"), { tokenId: "123", bidPrice: 0, bidSize: 0, askPrice: 1, askSize: 0, midPrice: 0.5 });
});

test("direct order calls and executor live mode fail before networking or state writes", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { assert.fail("No network permitted"); });
  const dir = temp(t);
  const live = parseConfig({ TRADING_MODE: "live", ...credentials });
  const client = new ClobTradingClient(live);
  await assert.rejects(client.placeOrder(signal), /disabled/);
  const store = new Store(join(dir, "state.json"));
  const executor = new Executor(live, client, new Portfolio(store));
  await assert.rejects(executor.execute(signal), /disabled/);
  assert.deepEqual(readdirSync(dir), []);
  assert.deepEqual(store.data.fills, []);
});

test("paper execution retains simulated fills and local accounting without networking", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { assert.fail("No network permitted"); });
  const dir = temp(t);
  const store = new Store(join(dir, "state.json"));
  const executor = new Executor(cfg, new ClobTradingClient(cfg), new Portfolio(store));
  const result = await executor.execute(signal);
  assert.equal(result.ok, true);
  assert.equal(result.fill?.mode, "paper");
  const saved = JSON.parse(readFileSync(join(dir, "state.json"), "utf8"));
  assert.equal(saved.fills.length, 1);
  assert.equal(saved.positions[0].shares, signal.size);
  assert.equal(saved.positions[0].costBasis, signal.stake);
});

test("offline CLI scan produces signals without credentials or local state writes, even with live selected", (t) => {
  const dir = temp(t);
  for (const mode of ["paper", "live"]) {
    const result = cli(dir, ["scan"], { CITIES: "hong_kong", TRADING_MODE: mode, MODEL_WEIGHT: "1", MIN_EDGE: "0.01" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /TRADES:/);
    assert.deepEqual(readdirSync(dir), []);
  }
});

test("CLI auth, live run and live watch fail closed without exposing credential markers", (t) => {
  const dir = temp(t);
  for (const command of ["auth", "run", "watch"]) {
    const result = cli(dir, [command], { TRADING_MODE: "live", ...credentials });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stderr, /disabled/);
    for (const value of Object.values(credentials)) assert.ok(!(result.stdout + result.stderr).includes(value));
    assert.deepEqual(readdirSync(dir), []);
  }
});
