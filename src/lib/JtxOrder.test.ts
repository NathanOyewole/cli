import { describe, expect, test } from "bun:test";

import type {
  JtxOpenOrder,
  JtxOrderHistory,
} from "../clients/JtxPerpsClient.ts";
import {
  cancelOutcome,
  findOpenedIntent,
  maxLeverage,
  orderOutcome,
  protectedPrice,
  sizeOpenOrder,
  snapDown,
  snapLimitPrice,
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

describe("snapLimitPrice", () => {
  test("rounds away from the taker", () => {
    expect(snapLimitPrice(0.344444, "Bid", 0.00001)).toBe(0.34444);
    expect(snapLimitPrice(0.344444, "Ask", 0.00001)).toBe(0.34445);
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

  test("max leverage keeps a margin buffer for fees and slippage", () => {
    expect(maxLeverage(JUP)).toBe(10);
    expect(
      sizeOpenOrder({
        market: JUP,
        markPrice: 0.33,
        side: "Ask",
        collateralUsd: 10,
        leverage: 10,
      })
    ).toEqual({ quantity: 271.6, price: 0.3267, sizeUsd: 89.628 });
  });

  test("max leverage sizes for the book's actual price impact", () => {
    expect(
      sizeOpenOrder({
        market: JUP,
        markPrice: 0.33,
        side: "Ask",
        collateralUsd: 10,
        leverage: 10,
        book: [
          [0.3299, 100],
          [0.3295, 1000],
        ],
      })
    ).toEqual({ quantity: 295.1, price: 0.3267, sizeUsd: 97.27545 });
  });

  test("a market order walks the book to the target exposure", () => {
    expect(
      sizeOpenOrder({
        market: JUP,
        markPrice: 0.33,
        side: "Bid",
        collateralUsd: 10,
        leverage: 5,
        book: [
          [0.3301, 50],
          [0.331, 100],
          [0.335, 1000],
        ],
      })
    ).toEqual({ quantity: 151.2, price: 0.3333, sizeUsd: 50.007 });
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

  test("a sell limit price rounds up to the tick", () => {
    expect(
      sizeOpenOrder({
        market: JUP,
        markPrice: 0.33,
        side: "Ask",
        collateralUsd: 20,
        leverage: 2,
        limitPrice: 0.344444,
      })
    ).toEqual({ quantity: 116.1, price: 0.34445, sizeUsd: 39.990645 });
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

const historyEntry = (o: Partial<JtxOrderHistory>): JtxOrderHistory => ({
  orderId: "900",
  clientOrderId: "42",
  symbol: "JUP",
  side: "Bid",
  reduceOnly: false,
  price: "0.3333",
  originalSize: "150",
  filledSize: "0",
  realizedPnl: null,
  status: "open",
  createdAt: 1_000,
  orderType: "market",
  originTxId: null,
  ...o,
});
const openOrder = (o: Partial<JtxOpenOrder>): JtxOpenOrder => ({
  symbol: "JUP",
  orderId: "900",
  clientOrderId: "42",
  side: "Bid",
  price: "0.3",
  initialSize: "150",
  remainingSize: "100",
  reduceOnly: false,
  status: "open",
  ...o,
});
const target = {
  clientOrderId: "42",
  symbol: "JUP",
  side: "Bid" as const,
  isMarket: true,
  signature: "sig",
  startTime: 940,
};

describe("orderOutcome", () => {
  test("a market order is done only once it fills", () => {
    expect(orderOutcome(target, [historyEntry({ status: "open" })])).toEqual({
      state: "pending",
    });
    expect(
      orderOutcome(target, [
        historyEntry({ status: "filled", filledSize: "150" }),
      ])
    ).toEqual({
      state: "done",
      orderId: "900",
      status: "filled",
      filledSize: 150,
    });
  });

  test("an order cancelled without a fill failed", () => {
    expect(
      orderOutcome(target, [historyEntry({ status: "cancelled" })])
    ).toEqual({
      state: "failed",
      reason: "Order 900 was cancelled without filling",
    });
  });

  test("ignores other orders, older orders, and other transactions", () => {
    const filled = { status: "filled", filledSize: "150" };
    expect(
      orderOutcome(target, [
        historyEntry({ ...filled, clientOrderId: "7" }),
        historyEntry({ ...filled, side: "Ask" }),
        historyEntry({ ...filled, createdAt: 900 }),
        historyEntry({ ...filled, originTxId: "other" }),
      ])
    ).toEqual({ state: "pending" });
  });

  test("a resting limit order is done once it shows in open orders", () => {
    expect(
      orderOutcome({ ...target, isMarket: false }, [], [openOrder({})])
    ).toEqual({
      state: "done",
      orderId: "900",
      status: "open",
      filledSize: 50,
    });
  });
});

describe("cancelOutcome", () => {
  test("waits while the order is still open", () => {
    expect(cancelOutcome("900", [openOrder({})], [])).toEqual({
      state: "pending",
    });
  });

  test("confirms once the order leaves the book", () => {
    expect(
      cancelOutcome(
        "900",
        [],
        [historyEntry({ status: "cancelled", filledSize: "20" })]
      )
    ).toEqual({
      state: "done",
      orderId: "900",
      status: "cancelled",
      filledSize: 20,
    });
  });

  test("fails if the order filled first", () => {
    expect(
      cancelOutcome("900", [], [historyEntry({ status: "filled" })])
    ).toEqual({
      state: "failed",
      reason: "Order 900 filled before it could be cancelled",
    });
  });
});

describe("findOpenedIntent", () => {
  // From deposit tx f7ykrvij...dArKBB: the gateway's self-CPI event.
  test("decodes the gateway's CrosschainIntentOpened event", () => {
    const keys = Array.from({ length: 11 }, (_, i) => `key${i}`);
    keys[10] = "gumhFpP3saWX8arwLx4peMZ6kBBXXbL7RWVuMtCjedY";
    expect(
      findOpenedIntent(keys, [
        { programIdIndex: 5, data: "3Bxs4EN9fHrenk9m" },
        {
          programIdIndex: 10,
          data: "6z5JQVKMf7bLGpGeWftT5msfGNxLoBiccCGhSJNBxaGJhZRdHAnSMpnqNyLG94ESYL7onSXdsbP2J9yZB9u8RPsFAzRmtxsFjiKXHhsBShNL5SuKuPaLDV4SE4UQD6JzzSvtf",
        },
      ])
    ).toEqual({
      intentId: "CUbVBbM3xftoyY6ZJg69ceZX1Pa1darYtBrr2GUo4Y2P",
      user: "2aQkQDngEjWwoJz7RvotLJkrq6cpXENhDnvmT7awU5W8",
    });
  });

  test("ignores other programs' instructions", () => {
    expect(
      findOpenedIntent(["key0"], [{ programIdIndex: 0, data: "3Bxs4EN9" }])
    ).toBeNull();
  });
});
