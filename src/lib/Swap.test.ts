import { describe, expect, test } from "bun:test";

import type { Token } from "../clients/DatapiClient.ts";
import { Swap } from "./Swap.ts";

const SOL = { id: "SOL", decimals: 9 } as Token;
const USDC = { id: "USDC", decimals: 6 } as Token;

describe("Swap.parseSettings", () => {
  test("omits everything by default so the server picks", () => {
    expect(Swap.parseSettings({})).toEqual({});
  });

  test("maps CLI flags to Ultra order params", () => {
    expect(
      Swap.parseSettings({
        exactOut: true,
        priorityFee: "50000",
        jitoTip: "1000",
        feeType: "exact-fee",
        useWsol: true,
        excludeDexes: "Raydium, Meteora DLMM",
        excludeRouters: "jupiterz,dflow",
      })
    ).toEqual({
      swapMode: "ExactOut",
      priorityFeeLamports: "50000",
      jitoTipLamports: "1000",
      broadcastFeeType: "exactFee",
      useWsol: true,
      excludeDexes: "Raydium,Meteora DLMM",
      excludeRouters: "jupiterz,dflow",
    });
    expect(Swap.parseSettings({ feeType: "max-cap" })).toEqual({
      broadcastFeeType: "maxCap",
    });
  });

  test("rejects invalid values", () => {
    expect(() => Swap.parseSettings({ jitoTip: "999" })).toThrow(
      "--jito-tip must be an integer of at least 1000 lamports."
    );
    expect(() => Swap.parseSettings({ priorityFee: "-1" })).toThrow(
      "--priority-fee must be an integer of at least 0 lamports."
    );
    expect(() => Swap.parseSettings({ feeType: "auto" })).toThrow(
      "--fee-type must be max-cap or exact-fee."
    );
    expect(() => Swap.parseSettings({ excludeRouters: "okx" })).toThrow(
      'Unknown router "okx" in --exclude-routers.'
    );
  });
});

describe("Swap.toOrderAmount", () => {
  test("uses input decimals for ExactIn and output decimals for ExactOut", () => {
    expect(
      Swap.toOrderAmount({ inputToken: SOL, outputToken: USDC, amount: "1.5" })
    ).toBe("1500000000");
    expect(
      Swap.toOrderAmount({
        inputToken: SOL,
        outputToken: USDC,
        amount: "1.5",
        settings: { swapMode: "ExactOut" },
      })
    ).toBe("1500000");
  });

  test("passes raw amounts through", () => {
    expect(
      Swap.toOrderAmount({
        inputToken: SOL,
        outputToken: USDC,
        rawAmount: "42",
        settings: { swapMode: "ExactOut" },
      })
    ).toBe("42");
  });
});
