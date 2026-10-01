import { describe, expect, test } from "bun:test";

import { DexMath, DexMathError } from "./DexMath.ts";

// Expected values come from running @jup-ag/lend@0.2.0-beta.7 `userOperations`
// on the same inputs: vault 90's supplyDexData (syrupUSDC/USDC collateral
// pool) and vault 91's borrowDexData (JupUSD/USDC debt pool) snapshots.
const colCfg = { token0Decimals: 6, token1Decimals: 6, fee: 100n };
const colPex = {
  centerPrice: 1185736000000000n,
  upperRange: 1186922922922922n,
  lowerRange: 1182178792000000n,
  geometricMean: 1184548482426164n,
};
const col = {
  token0RealReserves: 1384626224000n,
  token1RealReserves: 4039580710000n,
  token0ImaginaryReserves: 2394400983987555n,
  token1ImaginaryReserves: 2838683475719808n,
};
const colShares = 2804196431289n;

const debtCfg = { token0Decimals: 6, token1Decimals: 6, fee: 100n };
const debtPex = {
  centerPrice: 1000000000000000n,
  upperRange: 1003009027081243n,
  lowerRange: 997000000000000n,
  geometricMean: 999999999999999n,
};
const debt = {
  token0Debt: 1330375710259000n,
  token1Debt: 1596581675319000n,
  token0RealReserves: 1594402994097280n,
  token1RealReserves: 1328197029037280n,
  token0ImaginaryReserves: 973595859075263766n,
  token1ImaginaryReserves: 973329653110203478n,
};
const debtShares = 1449673214282266n;
const slippage = 200n; // 0.02%
const positionShares = 843501012930n;
const debtPositionShares = 1208191881492258n;

describe("DexMath imperfect operations", () => {
  test("deposit one-sided and two-sided", () => {
    expect(
      DexMath.deposit(
        colCfg,
        colPex,
        col,
        0n,
        1000_000000n,
        colShares,
        slippage
      )
    ).toEqual({ shares: 493537075112n, sharesWithSlippage: 493438367696n });
    expect(
      DexMath.deposit(colCfg, colPex, col, 250_000000n, 0n, colShares, slippage)
    ).toEqual({ shares: 146274610525n, sharesWithSlippage: 146245355602n });
    expect(
      DexMath.deposit(
        colCfg,
        colPex,
        col,
        100_000000n,
        500_000000n,
        colShares,
        slippage
      )
    ).toEqual({ shares: 305307173354n, sharesWithSlippage: 305246111919n });
  });

  test("withdraw one-sided and two-sided", () => {
    expect(
      DexMath.withdraw(
        colCfg,
        colPex,
        col,
        0n,
        300_000000n,
        colShares,
        slippage
      )
    ).toEqual({ shares: 148095821818n, sharesWithSlippage: 148125440983n });
    expect(
      DexMath.withdraw(
        colCfg,
        colPex,
        col,
        50_000000n,
        120_000000n,
        colShares,
        slippage
      )
    ).toEqual({ shares: 88491699565n, sharesWithSlippage: 88509397905n });
  });

  test("borrow and payback against a debt pool", () => {
    expect(
      DexMath.borrow(
        debtCfg,
        debtPex,
        debt,
        1000_000000n,
        0n,
        debtShares,
        slippage
      )
    ).toEqual({ shares: 495259128345n, sharesWithSlippage: 495358180171n });
    expect(
      DexMath.borrow(
        debtCfg,
        debtPex,
        debt,
        400_000000n,
        900_000000n,
        debtShares,
        slippage
      )
    ).toEqual({ shares: 643915010234n, sharesWithSlippage: 644043793237n });
    expect(
      DexMath.payback(
        debtCfg,
        debtPex,
        debt,
        0n,
        750_000000n,
        debtShares,
        slippage
      )
    ).toEqual({ shares: 371471461126n, sharesWithSlippage: 371397166833n });
    expect(
      DexMath.payback(
        debtCfg,
        debtPex,
        debt,
        300_000000n,
        200_000000n,
        debtShares,
        slippage
      )
    ).toEqual({ shares: 247625208613n, sharesWithSlippage: 247575683571n });
  });

  test("rejects an empty deposit with the SDK's error code", () => {
    expect(() =>
      DexMath.deposit(colCfg, colPex, col, 0n, 0n, colShares, slippage)
    ).toThrow(new DexMathError("DEPOSIT_AMOUNTS_ZERO"));
  });
});

describe("DexMath full exits", () => {
  test("one-token withdraw max", () => {
    expect(
      DexMath.withdrawMax(
        colCfg,
        colPex,
        col,
        positionShares,
        colShares,
        false,
        slippage
      )
    ).toEqual({
      tokenAmount: 1708707683n,
      tokenAmountWithSlippage: 1708365941n,
    });
    expect(() =>
      DexMath.withdrawMax(
        colCfg,
        colPex,
        col,
        positionShares,
        colShares,
        true,
        slippage
      )
    ).toThrow(new DexMathError("TOKEN0_RESERVES_TOO_LOW"));
  });

  test("proportional withdraw max", () => {
    expect(
      DexMath.withdrawPerfectMax(
        colCfg,
        col,
        positionShares,
        colShares,
        slippage
      )
    ).toEqual({
      token0Amt: 416494938n,
      token1Amt: 1215104041n,
      token0AmtWithSlippage: 416411639n,
      token1AmtWithSlippage: 1214861020n,
    });
  });

  test("one-token and proportional payback max", () => {
    const shares = debtPositionShares / 1000n;
    expect(
      DexMath.paybackMax(
        debtCfg,
        debtPex,
        debt,
        shares,
        debtShares,
        true,
        slippage
      )
    ).toEqual({
      tokenAmount: 2439894235n,
      tokenAmountWithSlippage: 2440382214n,
    });
    expect(
      DexMath.paybackMax(
        debtCfg,
        debtPex,
        debt,
        shares,
        debtShares,
        false,
        slippage
      )
    ).toEqual({
      tokenAmount: 2439204332n,
      tokenAmountWithSlippage: 2439692173n,
    });
    expect(
      DexMath.paybackPerfectMax(debtCfg, debt, shares, debtShares, slippage)
    ).toEqual({
      token0Amt: 1108766526n,
      token1Amt: 1330628862n,
      token0AmtWithSlippage: 1108988280n,
      token1AmtWithSlippage: 1330894988n,
    });
  });
});
