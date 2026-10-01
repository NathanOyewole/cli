import type {
  DexData,
  Vault,
  VaultSide,
  VaultToken,
} from "../clients/FluidClient.ts";
import {
  DexMath,
  SLIPPAGE_SCALE,
  type CollateralReserves,
  type DebtReserves,
  type PerfectMaxEstimate,
  type PricesAndExchangePrices,
  type SharesEstimate,
  type UserOpConfig,
} from "./DexMath.ts";
import type { DexLegInput } from "./LendDexOperate.ts";

// Port of the jup.ag lend smart-side helpers (Borrowing/helpers/smartSide*,
// smartMultiply): every smart leg is quoted off the vault's API DEX snapshot,
// exactly as the web app sizes its share bounds.

export type SmartAction = "deposit" | "withdraw" | "borrow" | "payback";

export type SmartSideCtx = {
  cfg: UserOpConfig;
  pex: PricesAndExchangePrices;
  colReserves: CollateralReserves;
  debtReserves: DebtReserves | null;
  totalShares: bigint;
  token0: VaultToken;
  token1: VaultToken;
  dex: DexData;
};

export type SmartMultiplyCtx = {
  colCtx: SmartSideCtx;
  marginLeg: 0 | 1;
  marginToken: VaultToken;
};

// DEFAULT_DEX_SLIPPAGE (0.02%) in basis points.
export const DEFAULT_DEX_SLIPPAGE_BPS = 2;
// Interest the full unwind covers on top of the debt (FULL_REPAY_INTEREST_PAD).
const FULL_REPAY_INTEREST_PAD = 1.001;
const PER_SHARE_PRECISION = 10n ** 18n;
const SHARE_SCALE = 10n ** 9n;
const ORACLE_SCALE = 10n ** 15n;
const MULTIPLIER_SCALE = 1_000_000n;

export class LendSmart {
  public static sideCtx(
    side: VaultSide,
    dex: DexData | null | undefined
  ): SmartSideCtx | null {
    if (!side.token1 || !dex) {
      return null;
    }
    const bi = BigInt;
    return {
      cfg: {
        token0Decimals: side.token0.decimals,
        token1Decimals: side.token1.decimals,
        fee: bi(dex.fee),
      },
      pex: {
        centerPrice: bi(dex.pex.centerPrice),
        upperRange: bi(dex.pex.upperRange),
        lowerRange: bi(dex.pex.lowerRange),
        geometricMean: bi(dex.pex.geometricMean),
      },
      colReserves: {
        token0RealReserves: bi(dex.token0RealReserves),
        token1RealReserves: bi(dex.token1RealReserves),
        token0ImaginaryReserves: bi(dex.token0ImaginaryReserves),
        token1ImaginaryReserves: bi(dex.token1ImaginaryReserves),
      },
      debtReserves:
        dex.token0Debt === undefined || dex.token1Debt === undefined
          ? null
          : {
              token0Debt: bi(dex.token0Debt),
              token1Debt: bi(dex.token1Debt),
              token0RealReserves: bi(dex.token0RealReserves),
              token1RealReserves: bi(dex.token1RealReserves),
              token0ImaginaryReserves: bi(dex.token0ImaginaryReserves),
              token1ImaginaryReserves: bi(dex.token1ImaginaryReserves),
            },
      totalShares: bi(dex.totalShares),
      token0: side.token0,
      token1: side.token1,
      dex,
    };
  }

  public static colCtx(vault: Vault): SmartSideCtx | null {
    return this.sideCtx(vault.supplyToken, vault.supplyDexData);
  }

  public static debtCtx(vault: Vault): SmartSideCtx | null {
    return this.sideCtx(vault.borrowToken, vault.borrowDexData);
  }

  // dexDefaultSlippagePct: twice the first smart pool's fee, else 0.02%.
  public static defaultSlippageBps(...ctxs: (SmartSideCtx | null)[]): number {
    const fee = ctxs.find((c) => c && c.cfg.fee > 0n)?.cfg.fee;
    return fee ? (Number(fee) * 2) / 100 : DEFAULT_DEX_SLIPPAGE_BPS;
  }

  public static variableShares(
    action: SmartAction,
    ctx: SmartSideCtx,
    amount0: bigint,
    amount1: bigint,
    slippageBps: number
  ): SharesEstimate {
    const s = slippageFixedPoint(slippageBps);
    switch (action) {
      case "deposit":
        return DexMath.deposit(
          ctx.cfg,
          ctx.pex,
          ctx.colReserves,
          amount0,
          amount1,
          ctx.totalShares,
          s
        );
      case "withdraw":
        return DexMath.withdraw(
          ctx.cfg,
          ctx.pex,
          ctx.colReserves,
          amount0,
          amount1,
          ctx.totalShares,
          s
        );
      case "borrow":
        return DexMath.borrow(
          ctx.cfg,
          ctx.pex,
          debtReserves(ctx),
          amount0,
          amount1,
          ctx.totalShares,
          s
        );
      case "payback":
        return DexMath.payback(
          ctx.cfg,
          ctx.pex,
          debtReserves(ctx),
          amount0,
          amount1,
          ctx.totalShares,
          s
        );
    }
  }

  // smartVariableInput: exact token amounts with a share bound.
  public static variableInput(
    action: SmartAction,
    ctx: SmartSideCtx,
    amount0: bigint,
    amount1: bigint,
    slippageBps: number
  ): DexLegInput & { shares: bigint } {
    const estimate = this.variableShares(
      action,
      ctx,
      amount0,
      amount1,
      slippageBps
    );
    const bound = positiveBound(estimate.sharesWithSlippage);
    return {
      token0: amount0,
      token1: amount1,
      shares: estimate.shares,
      ...(action === "deposit" || action === "borrow"
        ? { minShares: bound }
        : { maxShares: bound }),
    };
  }

  public static perfectMax(
    action: "withdraw" | "payback",
    ctx: SmartSideCtx,
    shares: bigint,
    slippageBps: number
  ): PerfectMaxEstimate {
    const s = slippageFixedPoint(slippageBps);
    return action === "withdraw"
      ? DexMath.withdrawPerfectMax(
          ctx.cfg,
          ctx.colReserves,
          shares,
          ctx.totalShares,
          s
        )
      : DexMath.paybackPerfectMax(
          ctx.cfg,
          debtReserves(ctx),
          shares,
          ctx.totalShares,
          s
        );
  }

  // smartPerfectMaxInput: burn the whole balance proportionally.
  public static perfectMaxInput(
    action: "withdraw" | "payback",
    ctx: SmartSideCtx,
    shares: bigint,
    slippageBps: number
  ): DexLegInput {
    const estimate = this.perfectMax(action, ctx, shares, slippageBps);
    return {
      max: true,
      minToken0: positiveBound(estimate.token0AmtWithSlippage),
      minToken1: positiveBound(estimate.token1AmtWithSlippage),
    };
  }

  // smartOneTokenMaxInput: exit the whole balance in one token (perfect
  // builder with the max sentinel and a zero bound on the other leg).
  public static oneTokenMax(
    action: "withdraw" | "payback",
    ctx: SmartSideCtx,
    shares: bigint,
    leg: 0 | 1,
    slippageBps: number
  ): { tokenAmount: bigint; input: DexLegInput } {
    const s = slippageFixedPoint(slippageBps);
    const estimate =
      action === "withdraw"
        ? DexMath.withdrawMax(
            ctx.cfg,
            ctx.pex,
            ctx.colReserves,
            shares,
            ctx.totalShares,
            leg === 0,
            s
          )
        : DexMath.paybackMax(
            ctx.cfg,
            ctx.pex,
            debtReserves(ctx),
            shares,
            ctx.totalShares,
            leg === 0,
            s
          );
    const bound = positiveBound(estimate.tokenAmountWithSlippage);
    return {
      tokenAmount: estimate.tokenAmount,
      input: {
        max: true,
        minToken0: leg === 0 ? bound : 0n,
        minToken1: leg === 1 ? bound : 0n,
      },
    };
  }

  // smartOneTokenExactInput: burn the shares a one-token amount is worth and
  // floor the payout on that leg (perfect builder, single-token mode).
  public static oneTokenExactInput(
    action: "withdraw" | "payback",
    ctx: SmartSideCtx,
    amount: bigint,
    leg: 0 | 1,
    slippageBps: number
  ): DexLegInput {
    const { shares } = this.variableShares(
      action,
      ctx,
      leg === 0 ? amount : 0n,
      leg === 1 ? amount : 0n,
      0
    );
    const s = slippageFixedPoint(slippageBps);
    const payout =
      action === "withdraw"
        ? DexMath.withdrawMax(
            ctx.cfg,
            ctx.pex,
            ctx.colReserves,
            shares,
            ctx.totalShares,
            leg === 0,
            s
          )
        : DexMath.paybackMax(
            ctx.cfg,
            ctx.pex,
            debtReserves(ctx),
            shares,
            ctx.totalShares,
            leg === 0,
            s
          );
    const bound = positiveBound(payout.tokenAmountWithSlippage);
    return {
      shares: positiveBound(shares),
      minToken0: leg === 0 ? bound : 0n,
      minToken1: leg === 1 ? bound : 0n,
    };
  }

  // splitShares: what a share balance is worth in each pair token (a supply
  // position redeems rounding down, a debt position repays rounding up),
  // falling back to the API per-share ratio when the exact math declines.
  public static splitShares(
    side: "supply" | "borrow",
    shares: bigint,
    ctx: SmartSideCtx
  ): { token0: bigint; token1: bigint } {
    if (shares <= 0n) {
      return { token0: 0n, token1: 0n };
    }
    try {
      const r = this.perfectMax(
        side === "supply" ? "withdraw" : "payback",
        ctx,
        shares,
        0
      );
      return { token0: r.token0Amt, token1: r.token1Amt };
    } catch {
      const perShare = (ratio: string, decimals: number) =>
        (shares * BigInt(ratio) * 10n ** BigInt(decimals)) /
        (PER_SHARE_PRECISION * SHARE_SCALE);
      return {
        token0: perShare(ctx.dex.token0PerShare, ctx.token0.decimals),
        token1: perShare(ctx.dex.token1PerShare, ctx.token1.decimals),
      };
    }
  }

  // getSmartMultiplyCtx: smart collateral whose normal debt token is one of
  // the pair tokens supports the swap-free flashloan loop.
  public static multiplyCtx(vault: Vault): SmartMultiplyCtx | null {
    if (!vault.supplyToken.token1 || vault.borrowToken.token1) {
      return null;
    }
    const colCtx = this.colCtx(vault);
    if (!colCtx) {
      return null;
    }
    const debt = vault.borrowToken.token0.address;
    const marginLeg =
      colCtx.token0.address === debt
        ? 0
        : colCtx.token1.address === debt
          ? 1
          : null;
    if (marginLeg === null) {
      return null;
    }
    return {
      colCtx,
      marginLeg,
      marginToken: marginLeg === 0 ? colCtx.token0 : colCtx.token1,
    };
  }

  // calculateSmartMultiplyAmounts: f = (m - 1) * C - m * D, with C the
  // oracle-priced collateral shares (position + what the margin mints) and D
  // the debt, all in the debt token's native units.
  public static multiplyFlashloan(p: {
    ctx: SmartMultiplyCtx;
    oraclePrice: bigint;
    positionShares: bigint;
    debt: bigint;
    debtDecimals: number;
    margin: bigint;
    multiplier: number;
  }): bigint {
    let marginShares = 0n;
    if (p.margin > 0n) {
      try {
        marginShares = this.variableShares(
          "deposit",
          p.ctx.colCtx,
          p.ctx.marginLeg === 0 ? p.margin : 0n,
          p.ctx.marginLeg === 1 ? p.margin : 0n,
          0
        ).shares;
      } catch {
        marginShares = 0n;
      }
    }
    const priceScale = SHARE_SCALE * ORACLE_SCALE;
    const collateral =
      (p.positionShares + marginShares) *
      p.oraclePrice *
      10n ** BigInt(p.debtDecimals);
    const m = BigInt(Math.round(p.multiplier * Number(MULTIPLIER_SCALE)));
    const scaled =
      (m - MULTIPLIER_SCALE) * collateral - m * p.debt * priceScale;
    return scaled > 0n ? scaled / (MULTIPLIER_SCALE * priceScale) : 0n;
  }

  // Debt that puts an existing position at multiplier m: (m - 1) x equity,
  // with equity the oracle-priced collateral shares less the debt.
  public static targetDebt(p: {
    oraclePrice: bigint;
    positionShares: bigint;
    debt: bigint;
    debtDecimals: number;
    multiplier: number;
  }): bigint {
    const collateral =
      (p.positionShares * p.oraclePrice * 10n ** BigInt(p.debtDecimals)) /
      (SHARE_SCALE * ORACLE_SCALE);
    const equity = collateral - p.debt;
    if (equity <= 0n) {
      throw new Error("Position has no equity to lever.");
    }
    const m = BigInt(Math.round(p.multiplier * Number(MULTIPLIER_SCALE)));
    return ((m - MULTIPLIER_SCALE) * equity) / MULTIPLIER_SCALE;
  }

  // fullRepayBuffer: the unwind's withdraw only guarantees its slippage floor
  // while the flashloan must be repaid in full, so pad for both.
  public static fullRepayBuffer(slippageBps: number): number {
    const remaining = 1 - slippageBps / 10_000;
    if (remaining <= 0) {
      throw new Error("Slippage tolerance is too high to unwind.");
    }
    return FULL_REPAY_INTEREST_PAD / remaining;
  }
}

// slippageToFixedPoint: percent of SLIPPAGE_SCALE (1e6), so 1 bps = 100.
function slippageFixedPoint(bps: number): bigint {
  return (BigInt(Math.round(bps * 100)) * SLIPPAGE_SCALE) / 1_000_000n;
}

function debtReserves(ctx: SmartSideCtx): DebtReserves {
  if (!ctx.debtReserves) {
    throw new Error("This pool has no debt reserves.");
  }
  return ctx.debtReserves;
}

// The SDK drops a zero bound and the leg would revert on-chain.
function positiveBound(value: bigint): bigint {
  if (value <= 0n) {
    throw new Error("Amount is too small to quote.");
  }
  return value;
}
