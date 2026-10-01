import { describe, expect, test } from "bun:test";

import { LendTicks, MIN_I128 } from "./LendTicks.ts";

// Expected values come from running the same @jup-ag/lend@0.2.0-beta.7
// functions (getRatioAtTick, getTickAtRatio, getTickIndices, getMinimumDebt,
// findNextTickWithDebt, getCurrentPositionState, getFinalPosition) on these
// inputs, with the program and RPC mocked to return the fixtures below.
describe("LendTicks", () => {
  test("ratio at tick", () => {
    const cases: [number, bigint][] = [
      [-16383, 6093n],
      [-500, 133034100365076n],
      [-1, 281053396615732n],
      [0, 281474976710656n],
      [1, 281897189175722n],
      [77, 315909889299554n],
      [4242, 162474454909301193n],
      [16383, 13002088162051014298412982n],
    ];
    for (const [tick, ratio] of cases) {
      expect(LendTicks.ratioAtTick(tick)).toBe(ratio);
    }
  });

  test("tick at ratio", () => {
    const cases: [bigint, number][] = [
      [6093n, -16384],
      [281474976710656n, 0],
      [123456789012345n, -550],
      [999999999999999999n, 5454],
      [13002088162051014298412982n, 16383],
    ];
    for (const [ratio, tick] of cases) {
      expect(LendTicks.tickAtRatio(ratio)).toBe(tick);
    }
  });

  test("tick-has-debt indices and minimum debt", () => {
    expect(LendTicks.tickIndices(-16383)).toEqual({
      arrayIndex: 0,
      mapIndex: 0,
      byteIndex: 0,
      bitIndex: 0,
    });
    expect(LendTicks.tickIndices(-1)).toEqual({
      arrayIndex: 7,
      mapIndex: 7,
      byteIndex: 31,
      bitIndex: 6,
    });
    expect(LendTicks.tickIndices(2047)).toEqual({
      arrayIndex: 8,
      mapIndex: 7,
      byteIndex: 31,
      bitIndex: 6,
    });
    expect(LendTicks.minimumDebt(6)).toBe(1000000n);
    expect(LendTicks.minimumDebt(9)).toBe(1000n);
    expect(LendTicks.minimumDebt(2)).toBe(100000000n);
  });

  test("next tick with debt walks the bitmaps downwards", async () => {
    const maps = (set: [number, number, number][]) => {
      const out = Array.from({ length: 8 }, () => new Uint8Array(32));
      for (const [map, byte, value] of set) {
        out[map]![byte] = value;
      }
      return out;
    };
    const arrays: Record<number, Uint8Array[]> = {
      7: maps([
        [7, 31, 0b11000000],
        [3, 5, 0b00010100],
      ]),
      6: maps([[0, 0, 1]]),
    };
    const read = async (i: number) => arrays[i] ?? null;
    const cases: [number, number][] = [
      [0, -1],
      [-1, -1235],
      [-700, -1235],
      [-1200, -1235],
      [-2100, -4095],
      [-4000, -4095],
    ];
    for (const [start, next] of cases) {
      expect(await LendTicks.nextTickWithDebt(start, read)).toBe(next);
    }
  });

  const position = {
    nftId: 7,
    isSupplyOnlyPosition: 0,
    tick: 120,
    tickId: 2,
    supplyAmount: 5000000000000n,
    dustDebtAmount: 1000n,
  };

  test("current position without liquidation", () => {
    expect(
      LendTicks.currentPosition({
        position,
        tickData: {
          isLiquidated: 0,
          totalIds: 2,
          isFullyLiquidated: 0,
          liquidationBranchId: 0,
          debtFactor: 0n,
        },
        tickIdData: null,
        branches: [],
        borrowMintDecimals: 6,
      })
    ).toEqual({
      tick: 120,
      tickId: 2,
      colRaw: 5000000000000n,
      debtRaw: 5985279555541n,
      dustDebtRaw: 1000n,
      userLiquidationStatus: false,
      postLiquidationBranchId: 0,
    });
  });

  test("current position follows a liquidation through the branch chain", () => {
    expect(
      LendTicks.currentPosition({
        position: { ...position, tickId: 1 },
        tickData: {
          isLiquidated: 1,
          totalIds: 2,
          isFullyLiquidated: 0,
          liquidationBranchId: 3,
          debtFactor: 0n,
        },
        tickIdData: {
          isFullyLiquidated: [0, 0, 0],
          liquidationBranchId: [2, 0, 0],
          debtFactor: [562949953437662n, 0n, 0n],
        },
        branches: [
          {
            branchId: 1,
            status: 1,
            minimaTick: 80,
            minimaTickPartials: 536870911,
            debtFactor: 281474976727006n,
            connectedBranchId: 0,
          },
          {
            branchId: 2,
            status: 2,
            minimaTick: 100,
            minimaTickPartials: 0,
            debtFactor: 506654958075870n,
            connectedBranchId: 1,
          },
        ],
        borrowMintDecimals: 6,
      })
    ).toEqual({
      tick: 80,
      tickId: 1,
      colRaw: 2951328608582n,
      debtRaw: 3324822793231n,
      dustDebtRaw: 1000n,
      userLiquidationStatus: true,
      postLiquidationBranchId: 2,
    });
  });

  test("final tick after collateral and debt changes", () => {
    const current = {
      tick: 120,
      tickId: 2,
      colRaw: 5000000000000n,
      debtRaw: 5985279555541n,
      dustDebtRaw: 1000n,
      userLiquidationStatus: false,
      postLiquidationBranchId: 0,
    };
    const finalTick = (newCol: bigint, newDebt: bigint) =>
      LendTicks.finalTick({
        current,
        newCol,
        newDebt,
        supplyExchangePrice: 1_050_000_000_000n,
        borrowExchangePrice: 1_100_000_000_000n,
        borrowFee: 10,
      });
    expect(finalTick(2000000000000n, 900000000000n)).toBe(-9);
    expect(finalTick(0n, 250000000000n)).toBe(145);
    expect(finalTick(-1000000000n, -100000000000n)).toBe(110);
    expect(finalTick(0n, MIN_I128)).toBe(-16383);
    expect(finalTick(MIN_I128, 0n)).toBe(-16383);
  });
});
