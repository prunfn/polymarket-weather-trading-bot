import { assertLiveReady, type Config } from "../config.js";
import type { ClobTradingClient } from "../polymarket/clob.js";
import type { Portfolio } from "./portfolio.js";
import type { FillRecord, TradeSignal } from "../types.js";
import { log } from "../logger.js";

export interface ExecutionResult {
  ok: boolean;
  mode: "paper" | "live";
  orderId?: string;
  error?: string;
  fill?: FillRecord;
}

/**
 * Turns a TradeSignal into a fill. In paper mode it simulates an immediate fill
 * at the signal price. Live execution is disabled in Phase 1.
 */
export class Executor {
  constructor(
    private readonly cfg: Config,
    private readonly clob: ClobTradingClient,
    private readonly portfolio: Portfolio,
  ) {}

  async execute(signal: TradeSignal): Promise<ExecutionResult> {
    assertLiveReady(this.cfg);
    const mode = this.cfg.TRADING_MODE;
    const ts = new Date().toISOString();
    const baseFill: FillRecord = {
      ts,
      mode,
      marketId: signal.marketId,
      tokenId: signal.tokenId,
      side: signal.side,
      price: signal.price,
      size: signal.size,
      stake: signal.stake,
      question: signal.question,
    };

    if (mode === "paper") {
      this.book(baseFill, signal);
      log.info(
        `PAPER fill: BUY ${signal.size.toFixed(2)} @ ${signal.price.toFixed(3)} ` +
          `($${signal.stake.toFixed(2)}) — ${signal.question}`,
      );
      return { ok: true, mode, fill: baseFill };
    }

    throw new Error("Live trading is disabled in Phase 1.");
  }

  private book(fill: FillRecord, signal: TradeSignal): void {
    this.portfolio.applyBuy(fill, {
      cityKey: signal.cityKey,
      dateLocal: signal.dateLocal,
      modelProb: signal.modelProb,
    });
  }
}
