import "dotenv/config";
import { z } from "zod";
import { setLogLevel, type LogLevel } from "./logger.js";

/** Coerce a comma-separated env string into a string[] (trimmed, non-empty). */
const csv = z
  .string()
  .optional()
  .transform((s) =>
    (s ?? "")
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean),
  );

const num = (def: number) => z.coerce.number().default(def);

const schema = z.object({
  // Public data only. Wallet/API credentials are deliberately not loaded.
  CLOB_HOST: z.string().url().default("https://clob.polymarket.com"),
  GAMMA_HOST: z.string().url().default("https://gamma-api.polymarket.com"),

  // mode + risk
  TRADING_MODE: z.enum(["paper", "live"]).default("paper"),
  MIN_EDGE: num(0.08),
  // Edges larger than this almost always mean the MODEL is wrong, not the market.
  // We refuse to trade them rather than bet hardest on the most-mispriced signal.
  EDGE_SANITY_CAP: num(0.35),
  // Don't trade an event resolving sooner than this many minutes from now.
  MIN_MINUTES_TO_RESOLVE: z.coerce.number().int().min(0).default(60),
  // Extra dispersion applied to the (typically under-dispersed) ensemble.
  SPREAD_INFLATION: num(1.4),
  // Shrinkage weight on the MODEL vs the (de-vigged) MARKET when estimating the
  // true probability we trade on. 1 = trust model fully, 0 = trust market fully.
  MODEL_WEIGHT: num(0.5),
  // Correlation discount: each additional same-direction bet within one event has
  // its stake multiplied by this^k (k = #already taken), since e.g. several NO
  // bets across adjacent buckets are nearly the same view.
  CORRELATION_DECAY: num(0.5),
  MIN_PRICE: num(0.03),
  MAX_PRICE: num(0.97),
  KELLY_FRACTION: num(0.25),
  BANKROLL: num(1000),
  MAX_STAKE_PER_MARKET: num(50),
  MAX_STAKE_PER_EVENT: num(150),
  MAX_TOTAL_EXPOSURE: num(1000),
  MAX_DAILY_LOSS: num(200),
  MIN_BOOK_LIQUIDITY: num(20),

  CITIES: csv,
  MAX_DAYS_AHEAD: z.coerce.number().int().min(0).default(2),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type Config = z.infer<typeof schema>;

let cached: Config | null = null;

export function parseConfig(env: NodeJS.ProcessEnv): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    // Validation messages may echo supplied values. Report field names only.
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: invalid value`).join("\n");
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  return parsed.data;
}

export function loadConfig(): Config {
  if (cached) return cached;
  cached = parseConfig(process.env);
  setLogLevel(cached.LOG_LEVEL as LogLevel);
  return cached;
}

/** Phase 1 has no authenticated client or order submission implementation. */
export function assertLiveReady(cfg: Config): void {
  if (cfg.TRADING_MODE !== "paper") throw new Error("Live trading is disabled in Phase 1.");
}
