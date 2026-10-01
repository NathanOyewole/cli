import {
  getAddressDecoder,
  getBase58Encoder,
  getOptionDecoder,
  getStructDecoder,
  getU64Decoder,
} from "@solana/kit";

import type {
  JtxMarket,
  JtxOpenOrder,
  JtxOrderHistory,
  JtxSide,
} from "../clients/JtxPerpsClient.ts";

type SizingMarket = Pick<
  JtxMarket,
  | "tickSize"
  | "stepSize"
  | "initialMarginRatioBps"
  | "takerFeeBps"
  | "makerFeeBps"
  | "orderLimitConfig"
>;

// Market orders carry a protected (worst) price this far from the reference,
// matching the web's PERPS_JTX_SLIPPAGE_PCT.
const SLIPPAGE = 0.01;
// The web keeps this much headroom below max leverage so fees still fit.
const MAX_LEVERAGE_BUFFER = 0.12;
export const MIN_LEVERAGE = 1.1;

function decimalsOf(increment: number): number {
  const [mantissa = "", exponent = "0"] = increment.toExponential().split("e");
  const mantissaDecimals = mantissa.split(".")[1]?.length ?? 0;
  return Math.max(0, mantissaDecimals - Number(exponent));
}

export function snapDown(value: number, increment: number): number {
  const decimals = decimalsOf(increment);
  const steps = Math.floor(Number((value / increment).toFixed(9)));
  return Number((steps * increment).toFixed(decimals));
}

export function snapUp(value: number, increment: number): number {
  const decimals = decimalsOf(increment);
  const steps = Math.ceil(Number((value / increment).toFixed(9)));
  return Number((steps * increment).toFixed(decimals));
}

export function maxLeverage(market: Pick<JtxMarket, "initialMarginRatioBps">) {
  return Math.floor(10_000 / market.initialMarginRatioBps);
}

// Worst acceptable fill price for a market order on `side`.
export function protectedPrice(
  reference: number,
  side: JtxSide,
  tickSize: number
): number {
  return side === "Bid"
    ? snapDown(reference * (1 + SLIPPAGE), tickSize)
    : snapUp(reference * (1 - SLIPPAGE), tickSize);
}

// Base quantity for a new order so that `collateralUsd` covers initial margin
// and the taker fee, mirroring the web's jtxPerpsTradeSimulation sizing.
export function sizeOpenOrder(opts: {
  market: SizingMarket;
  markPrice: number;
  side: JtxSide;
  collateralUsd: number;
  leverage: number;
  limitPrice?: number;
}): { quantity: number; price: number; sizeUsd: number } {
  const { market, markPrice, side, collateralUsd, leverage, limitPrice } = opts;
  const max = maxLeverage(market);
  if (leverage < MIN_LEVERAGE || leverage > max) {
    throw new Error(
      `Leverage must be between ${MIN_LEVERAGE}x and ${max}x for this market.`
    );
  }
  const isLimit = limitPrice !== undefined;
  const price = isLimit
    ? snapDown(limitPrice, market.tickSize)
    : protectedPrice(markPrice, side, market.tickSize);
  const marginLeverage = leverage >= max ? max - MAX_LEVERAGE_BUFFER : max;
  const marginPrice = isLimit ? Math.max(markPrice, price) : markPrice;
  const feeBps = Math.max(
    market.takerFeeBps,
    isLimit ? market.makerFeeBps : 0,
    0
  );
  const collateralPerToken =
    marginPrice / marginLeverage +
    (Math.max(markPrice, price) * feeBps) / 10_000;
  let size = collateralUsd / collateralPerToken;
  if (leverage < max) {
    size = Math.min(
      size,
      (collateralUsd * leverage) / (limitPrice ?? markPrice)
    );
  }
  const quantity = snapDown(size, market.stepSize);
  const sizeUsd = Number((quantity * (limitPrice ?? markPrice)).toFixed(6));
  assertWithinLimits(market, isLimit, "open", quantity, sizeUsd);
  return { quantity, price, sizeUsd };
}

export function assertWithinLimits(
  market: SizingMarket,
  isLimit: boolean,
  kind: "open" | "close",
  quantity: number,
  notionalUsd: number
): void {
  const limits = market.orderLimitConfig[isLimit ? "limit" : "market"];
  const maxQty =
    kind === "open" ? limits.maxOpenOrderQty : limits.maxCloseOrderQty;
  const maxNotional =
    kind === "open"
      ? limits.maxOpenOrderNotional
      : limits.maxCloseOrderNotional;
  if (quantity < limits.minOrderQty || notionalUsd < limits.minOrderNotional) {
    throw new Error(
      `Order is too small: minimum is ${limits.minOrderQty} units and $${limits.minOrderNotional}.`
    );
  }
  if (quantity > maxQty || notionalUsd > maxNotional) {
    throw new Error(
      `Order is too large: maximum is ${maxQty} units and $${maxNotional} per ${isLimit ? "limit" : "market"} order.`
    );
  }
}

export function randomClientOrderId(): string {
  const [hi = 0, lo = 0] = crypto.getRandomValues(new Uint32Array(2));
  return String((hi & 0x1fffff) * 0x1_0000_0000 + lo || 1);
}

export type JtxOrderOutcome =
  | { state: "done"; orderId: string; status: string; filledSize: number }
  | { state: "failed"; reason: string }
  | { state: "pending" };

// Mirrors the web's crosschainOrder confirmation: a market order only counts
// once it has filled, and an order cancelled without a fill was rejected.
export function orderOutcome(
  target: {
    clientOrderId: string;
    symbol: string;
    side: JtxSide;
    isMarket: boolean;
    signature: string;
    startTime: number;
  },
  history: JtxOrderHistory[],
  openOrders: JtxOpenOrder[] = []
): JtxOrderOutcome {
  const order = history.find(
    (o) =>
      o.clientOrderId === target.clientOrderId &&
      o.symbol === target.symbol &&
      o.side === target.side &&
      (!o.originTxId || o.originTxId === target.signature) &&
      o.createdAt >= target.startTime &&
      o.orderId
  );
  if (order) {
    const filledSize = Number(order.filledSize);
    if (order.status === "cancelled" && filledSize === 0) {
      return {
        state: "failed",
        reason: `Order ${order.orderId} was cancelled without filling`,
      };
    }
    if (!target.isMarket || filledSize > 0) {
      return {
        state: "done",
        orderId: order.orderId,
        status: order.status,
        filledSize,
      };
    }
  }
  const open = target.isMarket
    ? undefined
    : openOrders.find(
        (o) =>
          o.clientOrderId === target.clientOrderId &&
          o.symbol === target.symbol &&
          o.side === target.side
      );
  if (open) {
    return {
      state: "done",
      orderId: open.orderId,
      status: "open",
      filledSize: Number(
        (Number(open.initialSize) - Number(open.remainingSize)).toFixed(9)
      ),
    };
  }
  return { state: "pending" };
}

// A cancel is confirmed once the order leaves the open orders; history tells
// whether it filled first.
export function cancelOutcome(
  orderId: string,
  openOrders: JtxOpenOrder[],
  history: JtxOrderHistory[]
): JtxOrderOutcome {
  if (openOrders.some((o) => o.orderId === orderId)) {
    return { state: "pending" };
  }
  const order = history.find((o) => o.orderId === orderId);
  if (order?.status === "filled") {
    return {
      state: "failed",
      reason: `Order ${orderId} filled before it could be cancelled`,
    };
  }
  return {
    state: "done",
    orderId,
    status: order?.status ?? "cancelled",
    filledSize: Number(order?.filledSize ?? 0),
  };
}

const JTX_GATEWAY = "gumhFpP3saWX8arwLx4peMZ6kBBXXbL7RWVuMtCjedY";
const INTENT_OPENED_TAG = 0x1d9acb512ea545e4n;
const INTENT_OPENED_DISCRIMINATOR = 0xa831dbfe71096dden;
const intentOpenedDecoder = getStructDecoder([
  ["eventCpiTag", getU64Decoder()],
  ["discriminator", getU64Decoder()],
  ["intentId", getAddressDecoder()],
  ["user", getAddressDecoder()],
  ["depositAmount", getOptionDecoder(getU64Decoder())],
  ["msgId", getU64Decoder()],
]);

// The gateway emits a CrosschainIntentOpened event (via self-CPI) carrying the
// intent ID that GET crosschain/intent/{id} reports on.
export function findOpenedIntent(
  accountKeys: string[],
  innerInstructions: { programIdIndex: number; data: string }[]
): { intentId: string; user: string } | null {
  for (const ix of innerInstructions) {
    if (accountKeys[ix.programIdIndex] !== JTX_GATEWAY) {
      continue;
    }
    try {
      const event = intentOpenedDecoder.decode(
        getBase58Encoder().encode(ix.data)
      );
      if (
        event.eventCpiTag === INTENT_OPENED_TAG &&
        event.discriminator === INTENT_OPENED_DISCRIMINATOR
      ) {
        return { intentId: event.intentId, user: event.user };
      }
    } catch {
      continue;
    }
  }
  return null;
}
