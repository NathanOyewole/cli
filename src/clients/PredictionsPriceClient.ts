import { ClientConfig } from "./ClientConfig.ts";

const HOST = "prediction-market-price-service.fly.dev";

/** Levels are `[priceUsd, contracts]`, best price last. */
export type OrderbookSnapshot = {
  marketId: string;
  yes_dollars: [string, number][] | null;
  no_dollars: [string, number][] | null;
};

export class PredictionsPriceClient {
  static readonly #ky = ClientConfig.ky.extend({
    prefixUrl: `https://${HOST}`,
  });

  public static async getCryptoPrice(
    symbol: string,
    timestampSec: number
  ): Promise<{ symbol: string; value: number; timestamp: number }> {
    return this.#ky
      .get(`price/crypto/${symbol}`, {
        searchParams: { timestamp: timestampSec },
      })
      .json();
  }

  /** The orderbook is only published over WebSocket: subscribe, take the first snapshot, close. */
  public static async getOrderbook(
    marketId: string,
    timeoutMs = 15_000
  ): Promise<OrderbookSnapshot> {
    if (typeof WebSocket === "undefined") {
      throw new Error("Reading the orderbook requires Node.js 22+ or Bun.");
    }
    const ws = new WebSocket(`wss://${HOST}/ws/orderbook`);
    return new Promise<OrderbookSnapshot>((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error("Timed out waiting for the orderbook snapshot."));
      }, timeoutMs);
      const finish = (fn: () => void) => {
        clearTimeout(timer);
        ws.close();
        fn();
      };
      ws.onopen = () =>
        ws.send(JSON.stringify({ type: "subscribe", marketId }));
      ws.onerror = () =>
        finish(() => reject(new Error("Orderbook connection failed.")));
      ws.onmessage = (e) => {
        const msg = JSON.parse(String(e.data)) as {
          type: string;
          marketId?: string;
          error?: string;
        } & OrderbookSnapshot;
        if (msg.type === "orderbook" && msg.marketId === marketId) {
          finish(() => resolve(msg));
        } else if (msg.type === "error") {
          finish(() =>
            reject(new Error(`Orderbook subscription failed: ${msg.error}`))
          );
        }
      };
    });
  }
}
