import type { Base64EncodedBytes } from "@solana/kit";

import {
  PredictionsClient,
  type ExecutableRequest,
  type HistoryEvent,
  type Order,
} from "../clients/PredictionsClient.ts";
import { Config } from "./Config.ts";
import { NumberConverter } from "./NumberConverter.ts";
import { PredictionsFormat } from "./PredictionsFormat.ts";
import type { Signer } from "./Signer.ts";

export type OrderStatus = "filled" | "failed" | "pending";

export type OrderFill = {
  orderStatus: OrderStatus | null;
  filledContracts: number | null;
  avgFillPriceUsd: number | null;
};

export type TrackedOrder = {
  ownerPubkey: string;
  orderPubkey: string | null;
  orderId: string | null;
};

const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 60_000;

/** jup.ag asks for confirmation at or above 5% simulated slippage... */
const SLIPPAGE_WARNING_BPS = 500;
/** ...or when slippage would take at least $2,000 off a sell. */
const SIZE_IMPACT_WARNING_MICRO_USD = 2_000_000_000n;

export type SlippageQuote = {
  slippageBps?: number | null;
  maxSlippageBps?: number | null;
};

export class PredictionsExecution {
  /**
   * Signs a server-built Predict transaction and submits it to `/execute`,
   * echoing the request's execution context like the web app does. Returns a
   * null signature in dry-run mode.
   */
  public static async signAndExecute(
    signer: Signer,
    request: ExecutableRequest,
    opts: { ownerPubkey?: string } = {}
  ): Promise<{ signature: string | null }> {
    if (!request.transaction) {
      throw new Error("Insufficient balance to build this transaction.");
    }
    if (Config.dryRun) {
      return { signature: null };
    }
    const signedTransaction = await signer.signTransaction(
      request.transaction as Base64EncodedBytes
    );
    const res = await PredictionsClient.postExecute({
      signedTransaction,
      ...(request.execution?.context && { context: request.execution.context }),
      ...(opts.ownerPubkey && { ownerPubkey: opts.ownerPubkey }),
      ...(request.jupiterSwapRequestId && {
        jupiterSwapRequestId: request.jupiterSwapRequestId,
      }),
    });
    if (res.status === "Failed") {
      throw new Error(res.error ?? "Failed to execute transaction.");
    }
    return { signature: res.signature };
  }

  /**
   * The server quotes the slippage it simulated for the order. jup.ag makes the
   * user confirm a high quote before signing; the CLI requires
   * `--slippage <bps>` at or above the quote instead.
   */
  public static assertSlippageAccepted(
    quote: SlippageQuote,
    acceptedBps: number | undefined,
    sellSizeMicroUsd?: bigint
  ): void {
    const slippageBps = quote.slippageBps ?? 0;
    const needsConfirmation =
      slippageBps >= SLIPPAGE_WARNING_BPS ||
      (sellSizeMicroUsd !== undefined &&
        (sellSizeMicroUsd * BigInt(slippageBps)) / 10_000n >=
          SIZE_IMPACT_WARNING_MICRO_USD);
    if (
      !needsConfirmation ||
      (acceptedBps !== undefined && acceptedBps >= slippageBps)
    ) {
      return;
    }
    const maxBps = quote.maxSlippageBps ?? null;
    const estimate = `Estimated slippage is ${this.formatBps(slippageBps)}`;
    const reason =
      maxBps === null
        ? `${estimate}.`
        : slippageBps >= maxBps
          ? `${estimate}, at or above the ${this.formatBps(maxBps)} max, so the order will likely fail.`
          : `${estimate}; the order reverts above ${this.formatBps(maxBps)}.`;
    throw new Error(
      `${reason} Re-run with --slippage ${slippageBps} or higher to accept it.`
    );
  }

  public static parseSlippageBps(
    input: string | undefined
  ): number | undefined {
    if (input === undefined) {
      return undefined;
    }
    if (!/^\d+$/.test(input) || !Number.isSafeInteger(Number(input))) {
      throw new Error(
        "--slippage must be a whole number of basis points, e.g. 600 for 6%."
      );
    }
    return Number(input);
  }

  private static formatBps(bps: number): string {
    return `${Number((bps / 100).toFixed(2))}%`;
  }

  /** A keeper-rejected order fails the command even though its tx landed. */
  public static fillError(
    fill: OrderFill,
    orderPubkey: string,
    signature: string | null
  ): string | null {
    if (fill.orderStatus !== "failed") {
      return null;
    }
    return `Order ${orderPubkey} was not filled: the keeper marked it failed (tx ${signature ?? "unknown"}).`;
  }

  /**
   * A submitted order is filled asynchronously by a keeper. Poll the open
   * orders list (the web app's approach) and fall back to trade history,
   * because filled orders are closed and drop out of the list within seconds.
   * On timeout the last observed state is returned, still "pending".
   */
  public static async waitForFill(
    order: TrackedOrder,
    timeoutMs = POLL_TIMEOUT_MS
  ): Promise<OrderFill> {
    const deadline = Date.now() + timeoutMs;
    let last: OrderFill = {
      orderStatus: "pending",
      filledContracts: null,
      avgFillPriceUsd: null,
    };
    while (Date.now() < deadline) {
      last = await this.checkFill(order);
      if (last.orderStatus !== "pending") {
        return last;
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    return last;
  }

  private static async checkFill(order: TrackedOrder): Promise<OrderFill> {
    const orders = await PredictionsClient.getOrders({
      ownerPubkey: order.ownerPubkey,
      start: 0,
      end: 20,
    });
    const open = orders.data.find((o) => this.matchesOrder(o, order));
    if (open) {
      return {
        orderStatus: open.status,
        filledContracts: NumberConverter.fromMicroUsd(
          open.filledContractsMicro
        ),
        avgFillPriceUsd: PredictionsFormat.priceOrNull(
          Number(open.avgFillPriceUsd)
        ),
      };
    }

    const history = await PredictionsClient.getHistory({
      ownerPubkey: order.ownerPubkey,
      start: 0,
      end: 20,
    });
    const events = history.data.filter(
      (h) =>
        !!order.orderPubkey &&
        h.orderPubkey === order.orderPubkey &&
        (!order.orderId ||
          !h.externalOrderId ||
          h.externalOrderId === order.orderId)
    );
    return this.fillFromHistory(events);
  }

  private static matchesOrder(o: Order, order: TrackedOrder): boolean {
    if (order.orderPubkey && o.pubkey === order.orderPubkey) {
      return true;
    }
    const id = o.clientOrderId ?? o.externalOrderId;
    return !!order.orderId && id === order.orderId;
  }

  public static fillFromHistory(
    events: Pick<
      HistoryEvent,
      | "eventType"
      | "filledContracts"
      | "filledContractsMicro"
      | "avgFillPriceUsd"
    >[]
  ): OrderFill {
    const filled = events.find((e) => e.eventType === "order_filled");
    if (filled) {
      return {
        orderStatus: "filled",
        filledContracts: PredictionsFormat.contracts(
          filled.filledContractsMicro,
          filled.filledContracts
        ),
        avgFillPriceUsd: NumberConverter.fromMicroUsd(filled.avgFillPriceUsd),
      };
    }
    if (events.some((e) => e.eventType === "order_failed")) {
      return {
        orderStatus: "failed",
        filledContracts: 0,
        avgFillPriceUsd: null,
      };
    }
    return {
      orderStatus: "pending",
      filledContracts: null,
      avgFillPriceUsd: null,
    };
  }
}
