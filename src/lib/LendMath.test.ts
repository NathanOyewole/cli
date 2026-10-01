import { describe, expect, test } from "bun:test";

import type { Vault } from "../clients/FluidClient.ts";
import { LendMath } from "./LendMath.ts";
import { NumberConverter } from "./NumberConverter.ts";

const token = (symbol: string, decimals: number) => ({
  address: symbol,
  symbol,
  decimals,
  price: "1",
});

const vault = {
  id: 1,
  type: 1,
  supplyToken: { token0: token("SOL", 9), token1: null },
  borrowToken: { token0: token("USDC", 6), token1: null },
  supplyRateMagnifier: "0",
  borrowRateMagnifier: "0",
  supplyRate: {
    liquidity: { token0: "397", token1: "0" },
    vault: { rate: "397", feeRate: "0" },
  },
  borrowRate: {
    liquidity: { token0: "734", token1: "0" },
    vault: { rate: "734", feeRate: "0" },
  },
  collateralFactor: "800",
  liquidationThreshold: "850",
  oraclePrice: "100000000000000000",
  metadata: {
    maxLeverage: false,
    nativeStake: false,
    pegged: false,
    multiply: { enabled: true, reduceFactor: 300 },
    earn: false,
  },
} as unknown as Vault;

describe("LendMath", () => {
  test("health of a normal position", () => {
    expect(LendMath.health(vault, 10, 500)).toEqual({
      ltvPct: 50,
      maxLtvPct: 80,
      liquidationLtvPct: 85,
      liquidationPrice: 58.82352941,
      multiplier: 2,
      status: "Safe",
    });
  });

  test("status tiers", () => {
    expect(LendMath.status(0.8, 0.85, false)).toBe("Very Risky");
    expect(LendMath.status(0.7, 0.85, false)).toBe("Risky");
    expect(LendMath.status(0.86, 0.85, false)).toBe("Liquidated");
    expect(LendMath.status(0.845, 0.85, true)).toBe("Risky");
    expect(LendMath.status(0.5, 0.85, true)).toBe("Safe");
  });

  test("no debt has zero LTV and no liquidation price", () => {
    const h = LendMath.health(vault, 10, 0);
    expect(h.ltvPct).toBe(0);
    expect(h.liquidationPrice).toBeNull();
    expect(h.multiplier).toBe(1);
  });

  test("vault APYs compound the liquidity rate daily", () => {
    expect(LendMath.vaultApys(vault)).toEqual({
      supplyApyPct: 4.0496,
      borrowApyPct: 7.6153,
    });
  });

  test("vault APYs add LST staking yield and incentive magnifiers", () => {
    expect(
      LendMath.vaultApys({
        ...vault,
        supplyToken: {
          token0: { ...token("JupSOL", 9), stakingApr: 700 },
          token1: null,
        },
        borrowRateMagnifier: "-200",
      })
    ).toEqual({ supplyApyPct: 11.0496, borrowApyPct: 5.6351 });
  });

  test("max multiplier applies the reduce factor", () => {
    expect(LendMath.maxMultiplier(vault)).toBe(4.85);
  });

  test("exchange price history becomes annualized APYs", () => {
    expect(
      LendMath.exchangePriceApys([
        {
          liquidityExchangePrice: 1e12,
          tokenExchangePrice: 1e12,
          date: "2026-01-01T00:00:00.000Z",
        },
        {
          liquidityExchangePrice: 1.0001e12,
          tokenExchangePrice: 1.0002e12,
          date: "2026-01-02T00:00:00.000Z",
        },
      ])
    ).toEqual([
      {
        time: "2026-01-02T00:00:00.000Z",
        apyPct: 7.3,
        baseApyPct: 3.65,
        exchangeRate: 1.0002,
      },
    ]);
  });

  test("scaled UI multiplier switches to the new one at its effective time", () => {
    const spyx = {
      ...token("SPYx", 8),
      scaledUiConfig: {
        multiplier: 1.003909240011759,
        newMultiplier: 1.005714560286254,
        newMultiplierEffectiveTimestamp: "1781755200",
      },
    };
    expect(LendMath.uiMultiplier(spyx, 1781755199_000)).toBe(1.003909240011759);
    expect(LendMath.uiMultiplier(spyx, 1781755200_000)).toBe(1.005714560286254);
    expect(LendMath.uiMultiplier(token("USDC", 6))).toBe(1);
  });

  test("UI amounts settle as UI ÷ multiplier raw units", () => {
    // 10 SPYx at 1.005714560286254 → 9.9431791036 raw SPYx (8 decimals).
    expect(NumberConverter.toChainAmount("10", 8, 1.005714560286254)).toBe(
      "994317910"
    );
  });

  test("liquidation price is per UI unit of a scaled collateral", () => {
    const scaled = {
      ...vault,
      supplyToken: {
        token0: {
          ...token("SPYx", 8),
          scaledUiConfig: {
            multiplier: 2,
            newMultiplier: 2,
            newMultiplierEffectiveTimestamp: "0",
          },
        },
        token1: null,
      },
    } as Vault;
    const h = LendMath.health(scaled, 10, 500);
    expect(h.ltvPct).toBe(50);
    expect(h.liquidationPrice).toBe(29.41176471);
  });

  test("days to liquidation", () => {
    expect(
      LendMath.daysToLiquidation({
        ltvPct: 50,
        liquidationLtvPct: 85,
        supplyApyPct: 4,
        borrowApyPct: 8,
      })
    ).toBe(5131);
    expect(
      LendMath.daysToLiquidation({
        ltvPct: 50,
        liquidationLtvPct: 85,
        supplyApyPct: 8,
        borrowApyPct: 4,
      })
    ).toBeNull();
  });
});
