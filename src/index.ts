import { loadConfig, assertLiveReady, type Config } from "./config.js";
import { Engine, type EventReport } from "./strategy/engine.js";
import { buildForecast } from "./weather/forecast.js";
import { getCity, allCityKeys } from "./weather/cities.js";
import { todayLocal, addDays } from "./util/time.js";
import { log, print } from "./logger.js";

/* ──────────────────────────────────────────────────────────────────────────
 * CLI:  tsx src/index.ts <command> [...args]
 *   scan                 analyze markets, print edges & intended trades (no orders)
 *   run                  one pass that simulates paper fills
 *   watch [intervalMin]  repeat `run` on an interval (default 10 min)
 *   forecast <city> [d]  print the temperature distribution for a city/date
 *   auth                 disabled; never derives or prints credentials
 *   portfolio            show open positions, exposure and realized PnL
 * ──────────────────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  const cfg = loadConfig();
  const [cmd = "scan", ...rest] = process.argv.slice(2);

  switch (cmd) {
    case "scan":
      await cmdScan(cfg);
      break;
    case "run":
      await cmdRun(cfg);
      break;
    case "watch":
      await cmdWatch(cfg, Number(rest[0] ?? 10));
      break;
    case "forecast":
      await cmdForecast(rest[0], rest[1]);
      break;
    case "auth":
      throw new Error("Authentication is disabled in Phase 1; public reads need no credentials.");
    case "portfolio":
      cmdPortfolio(cfg);
      break;
    default:
      print(`Unknown command '${cmd}'. Try: scan | run | watch | forecast | auth | portfolio`);
      process.exitCode = 1;
  }
}

async function cmdScan(cfg: Config): Promise<void> {
  log.info(`MODE=${cfg.TRADING_MODE} (scan is always read-only) cities=${cfg.CITIES.join(",") || "all"}`);
  const engine = new Engine(cfg);
  const reports = await engine.runOnce({ execute: false });
  printReports(reports);
}

async function cmdRun(cfg: Config): Promise<void> {
  assertLiveReady(cfg);
  log.info("RUN mode=PAPER — fills are simulated locally");
  const engine = new Engine(cfg);
  const reports = await engine.runOnce({ execute: true });
  printReports(reports);
  const fills = reports.flatMap((r) => r.executions).filter((e) => e.ok).length;
  log.info(`pass complete: ${fills} fills`);
}

async function cmdWatch(cfg: Config, intervalMin: number): Promise<void> {
  const ms = Math.max(1, intervalMin) * 60_000;
  assertLiveReady(cfg);
  log.info(`watching every ${intervalMin} min — Ctrl+C to stop`);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await cmdRun(cfg);
    } catch (err) {
      log.error(`pass error: ${(err as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, ms));
  }
}

async function cmdForecast(cityKey?: string, dateArg?: string): Promise<void> {
  if (!cityKey) {
    print(`usage: forecast <city> [YYYY-MM-DD]\ncities: ${allCityKeys().join(", ")}`);
    return;
  }
  const city = getCity(cityKey);
  if (!city) {
    print(`unknown city '${cityKey}'. known: ${allCityKeys().join(", ")}`);
    return;
  }
  const date = dateArg ?? todayLocal(city.timezone);
  const f = await buildForecast(city, date);
  print(`\nForecast — ${city.displayName} ${date}`);
  print(`  source : ${f.source}`);
  print(`  mean   : ${f.mean.toFixed(2)}°C   sd: ${f.stdDev.toFixed(2)}°C   members: ${f.members.length}`);
  print(`  distribution over integer buckets (rounding=${city.rounding}):`);
  const lo = Math.floor(f.mean - 4);
  const hi = Math.ceil(f.mean + 4);
  for (let v = lo; v <= hi; v++) {
    const p = f.probOfBucket({
      kind: "exact",
      value: v,
      lo: city.rounding === "round" ? v - 0.5 : v,
      hi: city.rounding === "round" ? v + 0.5 : v + 1,
    });
    const bar = "█".repeat(Math.round(p * 40));
    print(`   ${String(v).padStart(3)}°C  ${(p * 100).toFixed(1).padStart(5)}%  ${bar}`);
  }
}

function cmdPortfolio(cfg: Config): void {
  const engine = new Engine(cfg);
  const pf = engine.portfolioRef;
  const positions = pf.openPositions();
  print(`\nPortfolio (mode=${cfg.TRADING_MODE})`);
  print(`  open positions : ${positions.length}`);
  print(`  total exposure : $${pf.totalExposure().toFixed(2)} / $${cfg.MAX_TOTAL_EXPOSURE}`);
  print(`  realized today : $${pf.realizedToday().toFixed(2)}`);
  for (const p of positions) {
    print(
      `   • ${p.shares.toFixed(1)} sh @ ${p.avgPrice.toFixed(3)} ($${p.costBasis.toFixed(2)}) ` +
        `— ${p.question}`,
    );
  }
}

function printReports(reports: EventReport[]): void {
  if (reports.length === 0) {
    print("No active temperature events in the configured window.");
    return;
  }
  for (const r of reports) {
    print(`\n══ ${r.event.title}  [${r.event.dateLocal}]`);
    print(
      `   forecast: ${r.forecast.mean.toFixed(1)}°C ±${r.forecast.stdDev.toFixed(1)} (${r.forecast.source})`,
    );
    for (const v of r.marketViews) {
      const flag = Math.abs(v.edge) >= 0.08 ? (v.edge > 0 ? " <== cheap" : " <== rich") : "";
      print(
        `     ${v.bucket.padEnd(7)} model ${(v.modelProb * 100).toFixed(1).padStart(5)}%  ` +
          `mkt ${(v.marketPrice * 100).toFixed(1).padStart(5)}%  edge ${(v.edge * 100).toFixed(1).padStart(6)}pp${flag}`,
      );
    }
    if (r.signals.length) {
      print(`   TRADES:`);
      for (const s of r.signals) {
        print(
          `     → BUY ${s.size.toFixed(1)} ${s.tokenId.slice(0, 8)}… @ ${s.price.toFixed(3)} ` +
            `$${s.stake.toFixed(2)}  [${s.reason}]`,
        );
      }
    } else {
      print(`   (no trades clear the edge/risk gates)`);
    }
  }
}

main().catch((err) => {
  log.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exitCode = 1;
});
