import { createPublicClient, forkEnvironmentConfig, type PublicClient } from "@polymarket/client";
import type { BookSnapshot, Side } from "../types.js";
import type { Config } from "../config.js";

/** Public order books only. No signer, authentication, approvals or order transport. */
export class ClobTradingClient {
  private readClient: PublicClient | null = null;

  constructor(private readonly cfg: Config) {}

  private reader(): PublicClient {
    if (!this.readClient) {
      this.readClient = createPublicClient({
        environment: forkEnvironmentConfig({
          name: "weather-read-only",
          clob: { rest: this.cfg.CLOB_HOST },
        }),
      });
    }
    return this.readClient;
  }

  /** Preserve the strategy's existing best bid/ask and midpoint calculation. */
  async getBook(tokenId: string): Promise<BookSnapshot> {
    const book = await this.reader().fetchOrderBook({ assetId: tokenId });
    const bids = (book.bids ?? []).map((o) => ({ price: Number(o.price), size: Number(o.size) }));
    const asks = (book.asks ?? []).map((o) => ({ price: Number(o.price), size: Number(o.size) }));
    const bestBid = bids.reduce((b, o) => (o.price > b.price ? o : b), { price: 0, size: 0 });
    const bestAsk = asks.reduce((a, o) => (o.price < a.price ? o : a), { price: 1, size: 0 });
    const mid = bestAsk.price > bestBid.price ? (bestBid.price + bestAsk.price) / 2 : bestBid.price || bestAsk.price;
    return {
      tokenId,
      bidPrice: bestBid.price,
      bidSize: bestBid.size,
      askPrice: bestAsk.price,
      askSize: bestAsk.size,
      midPrice: mid,
    };
  }

  /** Fail closed even when called directly, without constructing an SDK client. */
  async placeOrder(_args: {
    tokenId: string;
    side: Side;
    price: number;
    size: number;
    tickSize: number;
    negRisk: boolean;
    fok?: boolean;
  }): Promise<never> {
    throw new Error("Live order submission is disabled in Phase 1.");
  }
}
