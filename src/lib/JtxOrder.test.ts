import { describe, expect, test } from "bun:test";

import {
  maxLeverage,
  protectedPrice,
  sizeOpenOrder,
  snapDown,
  snapUp,
} from "./JtxOrder.ts";

const limits = {
  minOrderQty: 0.1,
  minOrderNotional: 5,
  maxOpenOrderQty: 5000,
  maxCloseOrderQty: 5000,
  maxOpenOrderNotional: 1000,
  maxCloseOrderNotional: 1000,
};
const JUP = {
  tickSize: 0.00001,
  stepSize: 0.1,
  initialMarginRatioBps: 1000,
  takerFeeBps: 3.5,
  makerFeeBps: 0.5,
  orderLimitConfig: { limit: limits, market: limits, postOnly: limits },
};

describe("snapping", () => {
  test("snaps to increments without float noise", () => {
    expect(snapDown(0.3333333, 0.00001)).toBe(0.33333);
    expect(snapUp(0.3266999, 0.00001)).toBe(0.3267);
    expect(snapDown(151.51515, 0.1)).toBe(151.5);
    expect(snapDown(0.3, 0.1)).toBe(0.3);
    expect(snapDown(83416.7, 1)).toBe(83416);
  });
});

describe("protectedPrice", () => {
  test("allows 1% slippage against the taker", () => {
    expect(protectedPrice(0.33, "Bid", 0.00001)).toBe(0.3333);
    expect(protectedPrice(0.33, "Ask", 0.00001)).toBe(0.3267);
  });
});

describe("sizeOpenOrder", () => {
  test("market order below max leverage targets collateral x leverage", () => {
    expect(
      sizeOpenOrder({
        market: JUP,
        markPrice: 0.33,
        side: "Bid",
        collateralUsd: 10,
        leverage: 5,
      })
    ).toEqual({ quantity: 151.5, price: 0.3333, sizeUsd: 49.995 });
  });

  test("max leverage keeps a margin buffer for fees", () => {
    expect(maxLeverage(JUP)).toBe(10);
    expect(
      sizeOpenOrder({
        market: JUP,
        markPrice: 0.33,
        side: "Ask",
        collateralUsd: 10,
        leverage: 10,
      })
    ).toEqual({ quantity: 298.3, price: 0.3267, sizeUsd: 98.439 });
  });

  test("limit order sizes at the limit price", () => {
    expect(
      sizeOpenOrder({
        market: JUP,
        markPrice: 0.33,
        side: "Bid",
        collateralUsd: 20,
        leverage: 2,
        limitPrice: 0.3,
      })
    ).toEqual({ quantity: 133.3, price: 0.3, sizeUsd: 39.99 });
  });

  test("rejects leverage outside the market's range", () => {
    const base = {
      market: JUP,
      markPrice: 0.33,
      side: "Bid" as const,
      collateralUsd: 10,
    };
    expect(() => sizeOpenOrder({ ...base, leverage: 11 })).toThrow(
      "between 1.1x and 10x"
    );
    expect(() => sizeOpenOrder({ ...base, leverage: 1 })).toThrow();
  });

  test("rejects orders under the minimum notional", () => {
    expect(() =>
      sizeOpenOrder({
        market: JUP,
        markPrice: 0.33,
        side: "Bid",
        collateralUsd: 2,
        leverage: 2,
      })
    ).toThrow("too small");
  });
});
