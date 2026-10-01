import { describe, expect, test } from "bun:test";

import { PerpsCollateral } from "./PerpsCollateral.ts";

describe("PerpsCollateral.depositSummary", () => {
  // Live quote: a $1.17 SOL deposit that first settles $0.43 of borrow fees.
  test("reports the net collateral change and the borrow fees paid", () => {
    expect(
      PerpsCollateral.depositSummary(
        { collateralUsd: "1183419116" },
        {
          positionCollateralUsd: "1184163842",
          collateralUsdDelta: "1173550",
          outstandingBorrowFeeUsd: "428824",
          openFeeUsd: "0",
        }
      )
    ).toEqual({
      collateralDeltaUsd: 0.744726,
      depositUsd: 1.17355,
      feeUsd: 0.428824,
    });
  });

  test("a deposit smaller than the fees due shrinks the collateral", () => {
    expect(
      PerpsCollateral.depositSummary(
        { collateralUsd: "10000000" },
        {
          positionCollateralUsd: "9800000",
          collateralUsdDelta: "300000",
          outstandingBorrowFeeUsd: "450000",
          openFeeUsd: "50000",
        }
      )
    ).toEqual({ collateralDeltaUsd: -0.2, depositUsd: 0.3, feeUsd: 0.5 });
  });
});
