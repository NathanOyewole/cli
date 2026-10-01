import { describe, expect, test } from "bun:test";

import type { DexData, Vault, VaultSide } from "../clients/FluidClient.ts";
import { LendSmart } from "./LendSmart.ts";

// Expected values come from running the jup.ag web helpers
// (smartVariableInput, smartOneTokenExactInput, splitShares,
// dexDefaultSlippagePct) on these API snapshots: vault 90's supplyDexData
// (syrupUSDC/USDC) and vault 91's borrowDexData (JupUSD/USDC).
const token = (symbol: string, address: string) => ({
  address,
  symbol,
  decimals: 6,
  price: "1",
});
const pex = (center: string, upper: string, lower: string, gm: string) => ({
  centerPrice: center,
  upperRange: upper,
  lowerRange: lower,
  geometricMean: gm,
});
const colSide: VaultSide = {
  token0: token("syrupUSDC", "AvZZF1YaZDziPY2RCK4oJrRVrbN3mTD9NL24hPeaZeUj"),
  token1: token("USDC", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
};
const colDex: DexData = {
  token0RealReserves: "1384626224000",
  token1RealReserves: "4039580710000",
  token0ImaginaryReserves: "2394400983987555",
  token1ImaginaryReserves: "2838683475719808",
  totalShares: "2804196431289",
  maxShares: "6000000000000000",
  token0PerShare: "493769341031338278",
  token1PerShare: "1440548409849852458",
  fee: "100",
  pex: pex(
    "1185736000000000",
    "1186922922922922",
    "1182178792000000",
    "1184548482426164"
  ),
};
const debtSide: VaultSide = {
  token0: token("JupUSD", "JuprjznTrTSp2UFa3ZBUFgwdAmtZCq4MQCwysN55USD"),
  token1: token("USDC", "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"),
};
const debtDex: DexData = {
  token0Debt: "1330375710259000",
  token1Debt: "1596581675319000",
  token0RealReserves: "1594402994097280",
  token1RealReserves: "1328197029037280",
  token0ImaginaryReserves: "973595859075263766",
  token1ImaginaryReserves: "973329653110203478",
  totalShares: "1449673214282266",
  maxShares: "6000000000000000",
  token0PerShare: "917707313035834590",
  token1PerShare: "1101339018745316653",
  fee: "100",
  pex: pex(
    "1000000000000000",
    "1003009027081243",
    "997000000000000",
    "999999999999999"
  ),
};
const colCtx = LendSmart.sideCtx(colSide, colDex)!;
const debtCtx = LendSmart.sideCtx(debtSide, debtDex)!;

describe("LendSmart", () => {
  test("default slippage is twice the pool fee", () => {
    expect(LendSmart.defaultSlippageBps(colCtx)).toBe(2);
    expect(LendSmart.defaultSlippageBps(null)).toBe(2);
  });

  test("variable deposit inputs carry a minimum share bound", () => {
    expect(
      LendSmart.variableInput("deposit", colCtx, 0n, 1000_000000n, 2)
    ).toEqual({
      token0: 0n,
      token1: 1000_000000n,
      shares: 493537075112n,
      minShares: 493438367696n,
    });
    expect(
      LendSmart.variableInput("deposit", colCtx, 25_500000n, 40_000000n, 5)
    ).toEqual({
      token0: 25_500000n,
      token1: 40_000000n,
      shares: 34665494372n,
      minShares: 34648161624n,
    });
  });

  test("variable withdraw, borrow and payback inputs", () => {
    expect(
      LendSmart.variableInput("withdraw", colCtx, 12_000000n, 0n, 2)
    ).toEqual({
      token0: 12_000000n,
      token1: 0n,
      shares: 7022956483n,
      maxShares: 7024361075n,
    });
    expect(
      LendSmart.variableInput("payback", debtCtx, 0n, 300_000000n, 2)
    ).toEqual({
      token0: 0n,
      token1: 300_000000n,
      shares: 148588598345n,
      maxShares: 148558880625n,
    });
    expect(
      LendSmart.variableInput("borrow", debtCtx, 150_000000n, 0n, 2)
    ).toEqual({
      token0: 150_000000n,
      token1: 0n,
      shares: 74288850380n,
      minShares: 74303708151n,
    });
  });

  test("one-token exact withdraw for the unwind", () => {
    expect(
      LendSmart.oneTokenExactInput("withdraw", colCtx, 100_000000n, 1, 2)
    ).toEqual({ shares: 49364962213n, minToken0: 0n, minToken1: 99987108n });
  });

  test("one-token full exits bound the single settled leg", () => {
    expect(
      LendSmart.oneTokenMax("withdraw", colCtx, 843501012930n, 1, 2)
    ).toEqual({
      tokenAmount: 1708707683n,
      input: { max: true, minToken0: 0n, minToken1: 1708365941n },
    });
    expect(
      LendSmart.oneTokenMax("withdraw", colCtx, 50000000000n, 0, 2)
    ).toEqual({
      tokenAmount: 85435226n,
      input: { max: true, minToken0: 85418138n, minToken1: 0n },
    });
    expect(() =>
      LendSmart.oneTokenMax("withdraw", colCtx, 843501012930n, 0, 2)
    ).toThrow("token0 reserves too low");
    expect(
      LendSmart.oneTokenMax("payback", debtCtx, 1208191881492n, 1, 2)
    ).toEqual({
      tokenAmount: 2439204332n,
      input: { max: true, minToken0: 0n, minToken1: 2439692173n },
    });
    expect(
      LendSmart.oneTokenMax("payback", debtCtx, 1208191881492n, 0, 2)
    ).toEqual({
      tokenAmount: 2439894235n,
      input: { max: true, minToken0: 2440382214n, minToken1: 0n },
    });
  });

  test("share balances split into pair tokens", () => {
    expect(LendSmart.splitShares("supply", 843501012930n, colCtx)).toEqual({
      token0: 416494938n,
      token1: 1215104041n,
    });
    expect(LendSmart.splitShares("borrow", 1208191881492n, debtCtx)).toEqual({
      token0: 1108766526n,
      token1: 1330628862n,
    });
  });

  test("smart multiply needs the debt token in the collateral pair", () => {
    const vault = {
      supplyToken: colSide,
      borrowToken: { token0: colSide.token1!, token1: null },
      supplyDexData: colDex,
    } as unknown as Vault;
    const ctx = LendSmart.multiplyCtx(vault)!;
    expect(ctx.marginLeg).toBe(1);
    expect(
      LendSmart.multiplyCtx({
        ...vault,
        borrowToken: { token0: token("SOL", "So1"), token1: null },
      } as Vault)
    ).toBeNull();
  });

  test("flashloan sizing for a target multiplier", () => {
    const ctx = LendSmart.multiplyCtx({
      supplyToken: colSide,
      borrowToken: { token0: colSide.token1!, token1: null },
      supplyDexData: colDex,
    } as unknown as Vault)!;
    const size = (
      positionShares: bigint,
      debt: bigint,
      margin: bigint,
      multiplier: number
    ) =>
      LendSmart.multiplyFlashloan({
        ctx,
        oraclePrice: 2015910090857826n,
        positionShares,
        debt,
        debtDecimals: 6,
        margin,
        multiplier,
      });
    // Web calculateSmartMultiplyAmounts: 1989.852739, 46.442727, 1840.769869.
    expect(size(0n, 0n, 1000_000000n, 3)).toBe(1989852739n);
    expect(size(843501012930n, 1001676231n, 0n, 2.5)).toBe(46442727n);
    expect(size(843501012930n, 1001676231n, 250_000000n, 4)).toBe(1840769869n);
    // (m - 1) x (shares x oracle - debt): 1700.422203 - 1001.676231 = 698.745972.
    const target = (multiplier: number) =>
      LendSmart.targetDebt({
        oraclePrice: 2015910090857826n,
        positionShares: 843501012930n,
        debt: 1001676231n,
        debtDecimals: 6,
        multiplier,
      });
    expect(target(2)).toBe(698745972n);
    expect(target(2.5)).toBe(1048118958n);
    expect(LendSmart.fullRepayBuffer(2)).toBeCloseTo(1.0012002400480096, 12);
  });
});
