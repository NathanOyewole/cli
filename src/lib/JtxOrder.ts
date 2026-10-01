import type { JtxMarket, JtxSide } from "../clients/JtxPerpsClient.ts";

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
