/** Tiny leveled logger — no deps, structured-ish console output. */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let threshold = LEVELS.info;

const SECRET_ENV = ["PRIVATE_KEY", "CLOB_API_KEY", "CLOB_API_SECRET", "CLOB_API_PASSPHRASE"] as const;
const SECRET_FIELD = /private[_-]?key|api[_-]?key|secret|passphrase|authorization|password/i;

/** All bot console output passes here, including errors and CLI reports. */
export function safeText(value: unknown): string {
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value, (key, item: unknown) => {
      if (SECRET_FIELD.test(key)) return "[REDACTED]";
      if (item instanceof Error) return { name: item.name, message: item.message };
      return item;
    }) ?? "";
  } catch {
    return "[unserializable]";
  }
  for (const name of SECRET_ENV) {
    const secret = process.env[name];
    if (!secret) continue;
    for (const variant of [secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1)]) {
      text = text.split(variant).join("[REDACTED]");
    }
  }
  // Also protect private-key-shaped values that are not in the environment.
  return text.replace(/0x[0-9a-f]{64}\b/gi, "[REDACTED]");
}

export function print(...values: unknown[]): void {
  console.log(...values.map(safeText));
}

export function setLogLevel(level: LogLevel): void {
  threshold = LEVELS[level];
}

function emit(level: LogLevel, msg: string, extra?: unknown): void {
  if (LEVELS[level] < threshold) return;
  const ts = new Date().toISOString();
  const tag = level.toUpperCase().padEnd(5);
  const line = safeText(`${ts} ${tag} ${msg}`);
  const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  if (extra !== undefined) sink(line, safeText(extra));
  else sink(line);
}

export const log = {
  debug: (msg: string, extra?: unknown) => emit("debug", msg, extra),
  info: (msg: string, extra?: unknown) => emit("info", msg, extra),
  warn: (msg: string, extra?: unknown) => emit("warn", msg, extra),
  error: (msg: string, extra?: unknown) => emit("error", msg, extra),
};
