import { describe, expect, test } from "bun:test";

import {
  amountOf,
  mintsOf,
  normalizeElement,
  type RawPortfolioElement,
} from "./PortfolioPositions.ts";

const OWNER = "jupE53639uCTuXk3VgRmUuDoafR9baGfLZf4T5DBH5H";
const JLP = "27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4";
const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL = "So11111111111111111111111111111111111111112";
const tokens = { [JLP]: { symbol: "JLP" }, [USDC]: { symbol: "USDC" } };

describe("amountOf", () => {
  test("reads v1 numbers and v2 fixed or floating amounts", () => {
    expect(amountOf(12.5)).toBe(12.5);
    expect(amountOf({ fixed: true, raw: "5000000", decimals: 6 })).toBe(5);
    expect(amountOf({ value: "1.25" })).toBe(1.25);
    expect(amountOf(undefined)).toBeNull();
  });
});

describe("normalizeElement", () => {
  test("borrowlend: supplied and borrowed assets, net value, health", () => {
    const el: RawPortfolioElement = {
      type: "borrowlend",
      label: "Lending",
      platformId: "jupiter-exchange",
      value: 26.33,
      netApy: 0.1563,
      data: {
        suppliedAssets: [
          { value: 61.84, data: { address: JLP, amount: 12.8, price: 4.83 } },
        ],
        borrowedAssets: [
          { value: 35.51, data: { address: USDC, amount: 35.51, price: 1 } },
        ],
        rewardAssets: [],
        healthRatio: 0.36,
        sourceRefs: [
          {
            name: "Vault",
            address: "DchXYJwVjPaEUxCiySXVbNyNppAFbQM7Ku76uKvyaDNT",
          },
        ],
        link: "https://jup.ag/lend/borrow/8/nfts/7170",
      },
    };
    expect(normalizeElement(el, OWNER, tokens)).toEqual({
      owner: OWNER,
      platformId: "jupiter-exchange",
      label: "Lending",
      name: null,
      type: "borrowlend",
      valueUsd: 26.33,
      apyPct: 15.629999999999999,
      healthRatio: 0.36,
      assets: [
        {
          role: "supplied",
          mint: JLP,
          symbol: "JLP",
          amount: 12.8,
          priceUsd: 4.83,
          valueUsd: 61.84,
        },
        {
          role: "borrowed",
          mint: USDC,
          symbol: "USDC",
          amount: 35.51,
          priceUsd: 1,
          valueUsd: 35.51,
        },
      ],
      perps: [],
      link: "https://jup.ag/lend/borrow/8/nfts/7170",
    });
    expect(mintsOf([el])).toEqual([JLP, USDC]);
  });

  test("leverage: isolated perps positions", () => {
    const el: RawPortfolioElement = {
      type: "leverage",
      label: "Leverage",
      platformId: "jupiter-exchange",
      owner: OWNER,
      value: 6.97,
      netApy: 0,
      link: "https://jup.ag/perps",
      data: {
        isolated: {
          positions: [
            {
              address: SOL,
              side: "long",
              size: 0.0975,
              sizeValue: 13.43,
              pnlValue: -1.94,
              value: 6.97,
              leverage: 1.5,
              entryPrice: 137.77,
              markPrice: 117.85,
              liquidationPrice: 46.58,
            },
          ],
        },
      },
    };
    const p = normalizeElement(el, "ignored", { [SOL]: { symbol: "SOL" } });
    expect(p.owner).toBe(OWNER);
    expect(p.apyPct).toBe(0);
    expect(p.assets).toEqual([]);
    expect(p.perps).toEqual([
      {
        side: "long",
        mint: SOL,
        symbol: "SOL",
        size: 0.0975,
        sizeUsd: 13.43,
        pnlUsd: -1.94,
        leverage: 1.5,
        entryPriceUsd: 137.77,
        markPriceUsd: 117.85,
        liquidationPriceUsd: 46.58,
        valueUsd: 6.97,
      },
    ]);
  });

  test("generic assets fall back to their name", () => {
    const el: RawPortfolioElement = {
      type: "multiple",
      label: "Deposit",
      platformId: "jupiter-pm",
      value: 5.8,
      data: {
        assets: [
          {
            type: "generic",
            name: "Over $500 - Yes",
            value: 5.8,
            data: { amount: 116 },
          },
        ],
      },
    };
    expect(normalizeElement(el, OWNER, {}).assets).toEqual([
      {
        role: "asset",
        mint: null,
        symbol: "Over $500 - Yes",
        amount: 116,
        priceUsd: null,
        valueUsd: 5.8,
      },
    ]);
  });
});
