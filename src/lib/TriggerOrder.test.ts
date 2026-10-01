import { describe, expect, test } from "bun:test";

import {
  assertMinDcaOrderUsd,
  assertMinOrderUsd,
  buildDcaOrderParams,
  buildPriceOrderParams,
  getTriggerSide,
  parseDuration,
  parseExpiry,
  parseIntent,
  parseInterval,
  resolveTargetPrice,
} from "./TriggerOrder.ts";

const SOL = "So11111111111111111111111111111111111111112";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

describe("parseDuration", () => {
  test("parses unit suffixes and bare seconds", () => {
    expect(parseDuration("30m", "--x")).toBe(1800);
    expect(parseDuration("1h", "--x")).toBe(3600);
    expect(parseDuration("1d", "--x")).toBe(86400);
    expect(parseDuration("7d", "--x")).toBe(604800);
    expect(parseDuration("1w", "--x")).toBe(604800);
    expect(parseDuration("1mo", "--x")).toBe(2592000);
    expect(parseDuration("90", "--x")).toBe(90);
    expect(parseDuration("1.5h", "--x")).toBe(5400);
  });

  test("rejects malformed values", () => {
    expect(() => parseDuration("abc", "--x")).toThrow("Invalid --x");
    expect(() => parseDuration("1y", "--x")).toThrow("Invalid --x");
    expect(() => parseDuration("0", "--x")).toThrow(
      "--x must be greater than zero."
    );
  });
});

describe("parseExpiry", () => {
  test("returns epoch milliseconds offset from now", () => {
    expect(parseExpiry("1h", 1_000_000)).toBe(4_600_000);
    expect(parseExpiry("30d", 0)).toBe(2_592_000_000);
  });

  test("caps at 10 years", () => {
    expect(() => parseExpiry("3651d", 0)).toThrow(
      "--expiry cannot be longer than 10 years."
    );
  });
});

describe("parseInterval", () => {
  test("accepts 1 minute to 1 year", () => {
    expect(parseInterval("1m")).toBe(60);
    expect(parseInterval("2w")).toBe(1209600);
    expect(parseInterval("31536000")).toBe(31536000);
  });

  test("rejects out-of-range intervals", () => {
    expect(() => parseInterval("30s")).toThrow(
      "--interval must be between 1 minute and 1 year."
    );
    expect(() => parseInterval("366d")).toThrow(
      "--interval must be between 1 minute and 1 year."
    );
  });
});

describe("parseIntent", () => {
  test("normalizes case and rejects unknown intents", () => {
    expect(parseIntent("Take-Profit")).toBe("take-profit");
    expect(() => parseIntent("limit")).toThrow("Invalid --intent");
  });
});

describe("getTriggerSide", () => {
  test("sell intents watch the input token, buy intents the output", () => {
    expect(getTriggerSide("take-profit")).toBe("input");
    expect(getTriggerSide("stop-loss")).toBe("input");
    expect(getTriggerSide("trailing-stop")).toBe("input");
    expect(getTriggerSide("oco")).toBe("input");
    expect(getTriggerSide("buy-dip")).toBe("output");
    expect(getTriggerSide("buy-pump")).toBe("output");
    expect(getTriggerSide("otoco")).toBe("output");
  });
});

describe("resolveTargetPrice", () => {
  const base = {
    optionName: "--price",
    referencePriceUsd: 200,
    circSupply: 1_000_000,
    mcap: false,
  };

  test("uses USD values as-is", () => {
    expect(resolveTargetPrice("150", base)).toBe(150);
  });

  test("resolves signed percentages against the reference price", () => {
    expect(resolveTargetPrice("+10%", base)).toBeCloseTo(220, 10);
    expect(resolveTargetPrice("-25%", base)).toBe(150);
  });

  test("converts market cap to price via circulating supply", () => {
    expect(resolveTargetPrice("250000000", { ...base, mcap: true })).toBe(250);
  });

  test("rejects non-positive results", () => {
    expect(() => resolveTargetPrice("-100%", base)).toThrow(
      "--price must resolve to a positive price."
    );
    expect(() =>
      resolveTargetPrice("10%", { ...base, referencePriceUsd: undefined })
    ).toThrow("no reference price available");
  });
});

describe("buildPriceOrderParams", () => {
  const common = { triggerMint: SOL, marketPriceUsd: 100 };

  test("take-profit sells above with server slippage", () => {
    expect(
      buildPriceOrderParams({ ...common, intent: "take-profit", priceUsd: 150 })
    ).toEqual({
      orderType: "single",
      triggerMint: SOL,
      triggerCondition: "above",
      triggerPriceUsd: 150,
      slippageBps: undefined,
    });
  });

  test("stop-loss sells below with 20% default slippage", () => {
    expect(
      buildPriceOrderParams({ ...common, intent: "stop-loss", priceUsd: 80 })
    ).toEqual({
      orderType: "single",
      triggerMint: SOL,
      triggerCondition: "below",
      triggerPriceUsd: 80,
      slippageBps: 2000,
    });
  });

  test("buy-dip triggers below, buy-pump above with 20% slippage", () => {
    expect(
      buildPriceOrderParams({ ...common, intent: "buy-dip", priceUsd: 90 })
    ).toMatchObject({ triggerCondition: "below", slippageBps: undefined });
    expect(
      buildPriceOrderParams({ ...common, intent: "buy-pump", priceUsd: 110 })
    ).toMatchObject({ triggerCondition: "above", slippageBps: 2000 });
  });

  test("explicit slippage overrides defaults", () => {
    expect(
      buildPriceOrderParams({
        ...common,
        intent: "stop-loss",
        priceUsd: 80,
        slippageBps: 300,
      }).slippageBps
    ).toBe(300);
  });

  test("trailing-stop converts percent to bps", () => {
    expect(
      buildPriceOrderParams({
        ...common,
        intent: "trailing-stop",
        trailingPct: 12.5,
      })
    ).toEqual({
      orderType: "single",
      triggerMint: SOL,
      triggerCondition: "below",
      trailingBps: 1250,
      slippageBps: 2000,
    });
    expect(() =>
      buildPriceOrderParams({
        ...common,
        intent: "trailing-stop",
        trailingPct: 0.3,
      })
    ).toThrow("--trailing must be between 0.5 and 90, in steps of 0.5.");
    expect(() =>
      buildPriceOrderParams({
        ...common,
        intent: "trailing-stop",
        trailingPct: 1.2,
      })
    ).toThrow("--trailing must be between 0.5 and 90, in steps of 0.5.");
  });

  test("oco sets both legs", () => {
    expect(
      buildPriceOrderParams({
        ...common,
        intent: "oco",
        tpPriceUsd: 150,
        slPriceUsd: 80,
      })
    ).toEqual({
      orderType: "oco",
      triggerMint: SOL,
      tpPriceUsd: 150,
      slPriceUsd: 80,
      tpSlippageBps: undefined,
      slSlippageBps: 2000,
    });
    expect(() =>
      buildPriceOrderParams({
        ...common,
        intent: "oco",
        tpPriceUsd: 80,
        slPriceUsd: 150,
      })
    ).toThrow("--tp must be above --sl.");
  });

  test("otoco entry condition follows the market", () => {
    expect(
      buildPriceOrderParams({
        ...common,
        intent: "otoco",
        priceUsd: 90,
        tpPriceUsd: 120,
        slPriceUsd: 70,
      })
    ).toEqual({
      orderType: "otoco",
      triggerMint: SOL,
      triggerCondition: "below",
      triggerPriceUsd: 90,
      slippageBps: undefined,
      tpPriceUsd: 120,
      tpSlippageBps: undefined,
      slPriceUsd: 70,
      slSlippageBps: 2000,
    });
    expect(
      buildPriceOrderParams({
        ...common,
        intent: "otoco",
        priceUsd: 110,
        tpPriceUsd: 130,
      })
    ).toEqual({
      orderType: "otoco",
      triggerMint: SOL,
      triggerCondition: "above",
      triggerPriceUsd: 110,
      slippageBps: 2000,
      tpPriceUsd: 130,
      tpSlippageBps: undefined,
    });
  });

  test("rejects options that do not apply to the intent", () => {
    expect(() =>
      buildPriceOrderParams({
        ...common,
        intent: "take-profit",
        priceUsd: 150,
        tpPriceUsd: 160,
      })
    ).toThrow("--tp cannot be used with --intent take-profit.");
    expect(() =>
      buildPriceOrderParams({ ...common, intent: "stop-loss" })
    ).toThrow("--price is required for --intent stop-loss.");
  });
});

describe("buildDcaOrderParams", () => {
  const common = {
    inputMint: USDC,
    outputMint: SOL,
    orderCount: 4,
    intervalSeconds: 86400,
    earn: false,
  };

  test("time-based by default", () => {
    expect(buildDcaOrderParams(common)).toEqual({
      orderType: "time_based",
      orderCount: 4,
      intervalSeconds: 86400,
    });
  });

  test("price range makes it price-conditional on the output token", () => {
    expect(
      buildDcaOrderParams({ ...common, minPriceUsd: 80, maxPriceUsd: 120 })
    ).toEqual({
      orderType: "price_conditional",
      orderCount: 4,
      intervalSeconds: 86400,
      triggerMint: SOL,
      minPriceUsd: 80,
      maxPriceUsd: 120,
    });
    expect(() =>
      buildDcaOrderParams({ ...common, minPriceUsd: 120, maxPriceUsd: 80 })
    ).toThrow("--min-price must be below --max-price.");
  });

  test("earn maps stablecoins to jl-token mints", () => {
    expect(buildDcaOrderParams({ ...common, earn: true })).toEqual({
      orderType: "time_based",
      orderCount: 4,
      intervalSeconds: 86400,
      jlEnabled: true,
      jlMint: "9BEcn9aPEmhSPbPQeFGjidRiEKki46fVQDyPpSQXPA2D",
    });
    expect(() =>
      buildDcaOrderParams({ ...common, inputMint: SOL, earn: true })
    ).toThrow(
      "--earn is only available when paying with USDC, USDT or JupUSD."
    );
    expect(() =>
      buildDcaOrderParams({ ...common, earn: true, maxPriceUsd: 100 })
    ).toThrow("--earn is only available for time-based orders");
  });

  test("order count bounds", () => {
    expect(() => buildDcaOrderParams({ ...common, orderCount: 1 })).toThrow(
      "--orders must be an integer between 2 and 100."
    );
    expect(() => buildDcaOrderParams({ ...common, orderCount: 101 })).toThrow(
      "--orders must be an integer between 2 and 100."
    );
  });
});

describe("minimum order size", () => {
  test("limit orders need $10 notional", () => {
    expect(() => assertMinOrderUsd(9.99)).toThrow("Min order size: $10.");
    expect(() => assertMinOrderUsd(10)).not.toThrow();
    expect(() => assertMinOrderUsd(undefined)).not.toThrow();
  });

  test("dca orders need $10 per order", () => {
    expect(() => assertMinDcaOrderUsd(39, 4)).toThrow(
      "Min $10 per order: increase --amount to at least $40 for 4 orders."
    );
    expect(() => assertMinDcaOrderUsd(39.2, 4)).not.toThrow();
  });
});
