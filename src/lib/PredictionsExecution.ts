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
    if (Config.dryRun) {
      return { signature: null };
    }
    if (!request.transaction) {
      throw new Error("Insufficient balance to build this transaction.");
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
   * A submitted order is filled asynchronously by a keeper. Poll the open
   * orders list (the web app's approach) and fall back to trade history,
   * because filled orders are closed and drop out of the list within seconds.
   */
  public static async waitForFill(
    order: TrackedOrder,
    timeoutMs = POLL_TIMEOUT_MS
  ): Promise<OrderFill> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const fill = await this.checkFill(order);
      if (fill.orderStatus !== "pending") {
        return fill;
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    return {
      orderStatus: "pending",
      filledContracts: null,
      avgFillPriceUsd: null,
    };
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
        filledContracts: filled.filledContractsMicro
          ? NumberConverter.fromMicroUsd(filled.filledContractsMicro)
          : Number(filled.filledContracts),
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
