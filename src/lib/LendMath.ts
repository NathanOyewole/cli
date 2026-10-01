import type {
  ExchangePricePoint,
  Nft,
  Vault,
  VaultSide,
  VaultToken,
} from "../clients/FluidClient.ts";

const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;
const ORACLE_PRICE_SCALE = 1e15;
const DEX_SHARE_DECIMALS = 9;

export type PositionHealth = {
  ltvPct: number;
  maxLtvPct: number;
  liquidationLtvPct: number;
  liquidationPrice: number | null;
  multiplier: number;
  status: "Safe" | "Medium" | "Risky" | "Very Risky" | "Liquidated";
};

export class LendMath {
  public static aprToApy(apr: number): number {
    return (1 + apr / 365) ** 365 - 1;
  }

  public static isSmart(side: VaultSide): boolean {
    return side.token1 !== null;
  }

  // Mirrors the jup.ag vault rate breakdown: liquidity rate (plus a positive
  // magnifier), reward campaigns, LST staking yield, and incentive magnifiers.
  public static vaultApys(vault: Vault): {
    supplyApyPct: number;
    borrowApyPct: number;
  } {
    const supplyMagnifier = Number(vault.supplyRateMagnifier) / 1e4;
    const borrowMagnifier = Number(vault.borrowRateMagnifier) / 1e4;
    const rewards = (side: "supply" | "borrow", sign: number) =>
      (vault.rewards ?? [])
        .filter((r) => r.side === side)
        .reduce(
          (sum, r) => sum + this.aprToApy((sign * Number(r.apr)) / 1e4),
          0
        );
    const staking = (side: VaultSide) =>
      this.isSmart(side) ? 0 : Number(side.token0.stakingApr ?? 0) / 1e4;

    const supply =
      this.aprToApy(
        Number(vault.supplyRate.liquidity.token0) / 1e4 +
          (supplyMagnifier > 0 ? 0 : supplyMagnifier)
      ) +
      (supplyMagnifier > 0 ? this.aprToApy(supplyMagnifier) : 0) +
      rewards("supply", 1) +
      staking(vault.supplyToken);
    const borrow =
      this.aprToApy(
        Number(vault.borrowRate.liquidity.token0) / 1e4 +
          (borrowMagnifier < 0 ? 0 : borrowMagnifier)
      ) +
      (borrowMagnifier < 0 ? this.aprToApy(borrowMagnifier) : 0) +
      rewards("borrow", -1) +
      staking(vault.borrowToken);
    return {
      supplyApyPct: round(supply * 100, 4),
      borrowApyPct: round(borrow * 100, 4),
    };
  }

  public static maxMultiplier(vault: Vault): number {
    const cf = Number(vault.collateralFactor) / 1e3;
    const cap =
      (1 / (1 - cf)) * (1 - vault.metadata.multiply.reduceFactor / 1e4);
    return Math.floor(cap * 100) / 100;
  }

  // getEffectiveMultiplier in the jup.ag lend UI: the pending multiplier wins
  // once its effective time has passed.
  public static uiMultiplier(token: VaultToken, nowMs = Date.now()): number {
    const config = token.scaledUiConfig;
    if (!config) {
      return 1;
    }
    const effectiveMs = Number(config.newMultiplierEffectiveTimestamp) * 1000;
    if (config.newMultiplier !== undefined && effectiveMs <= nowMs) {
      return config.newMultiplier;
    }
    return config.multiplier ?? 1;
  }

  // A smart side is denominated in DEX shares, which are never scaled.
  public static sideUiMultiplier(side: VaultSide, nowMs = Date.now()): number {
    return this.isSmart(side) ? 1 : this.uiMultiplier(side.token0, nowMs);
  }

  public static sideDecimals(side: VaultSide): number {
    return this.isSmart(side) ? DEX_SHARE_DECIMALS : side.token0.decimals;
  }

  public static positionAmounts(nft: Nft): {
    collateral: number;
    debt: number;
  } {
    const { vault } = nft;
    return {
      collateral:
        Number(nft.supply) / 10 ** this.sideDecimals(vault.supplyToken),
      debt:
        (Number(nft.borrow) + Number(nft.dustBorrow ?? 0)) /
        10 ** this.sideDecimals(vault.borrowToken),
    };
  }

  // Amounts are in protocol units (raw / 10^decimals), which the oracle
  // prices; the liquidation price is quoted per UI unit of collateral.
  public static health(
    vault: Vault,
    collateral: number,
    debt: number,
    isLiquidated = false
  ): PositionHealth {
    const oraclePrice =
      vault.oraclePrice === null
        ? null
        : Number(vault.oraclePrice) / ORACLE_PRICE_SCALE;
    const lt = Number(vault.liquidationThreshold) / 1e3;
    let ratio = 0;
    if (debt > 0 && oraclePrice !== null) {
      const collateralInDebt = collateral * oraclePrice;
      ratio = collateralInDebt <= 0 ? 1 : Math.min(debt / collateralInDebt, 1);
    }
    const uiScale =
      this.sideUiMultiplier(vault.borrowToken) /
      this.sideUiMultiplier(vault.supplyToken);
    const liquidationPrice =
      collateral > 0 && debt > 0 ? (debt / (collateral * lt)) * uiScale : null;
    return {
      ltvPct: round(ratio * 100, 2),
      maxLtvPct: Number(vault.collateralFactor) / 10,
      liquidationLtvPct: lt * 100,
      liquidationPrice:
        liquidationPrice === null ? null : round(liquidationPrice, 8),
      multiplier: ratio >= 1 ? 1 : Math.floor((1 / (1 - ratio)) * 100) / 100,
      status: isLiquidated
        ? "Liquidated"
        : this.status(ratio, lt, vault.metadata.pegged),
    };
  }

  public static status(
    ratio: number,
    liquidationThreshold: number,
    pegged: boolean
  ): PositionHealth["status"] {
    const deviation = 1 - ratio / liquidationThreshold;
    const tiers: [number, PositionHealth["status"]][] = pegged
      ? [
          [0, "Liquidated"],
          [0.005, "Very Risky"],
          [0.01, "Risky"],
          [0.02, "Medium"],
        ]
      : [
          [0, "Liquidated"],
          [0.1, "Very Risky"],
          [0.25, "Risky"],
        ];
    return tiers.find(([max]) => deviation <= max)?.[1] ?? "Safe";
  }

  public static exchangePriceApys(points: ExchangePricePoint[]): {
    time: string;
    apyPct: number;
    baseApyPct: number;
    exchangeRate: number;
  }[] {
    const result = [];
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1]!;
      const curr = points[i]!;
      const seconds =
        (new Date(curr.date).getTime() - new Date(prev.date).getTime()) / 1000;
      if (seconds <= 0) {
        continue;
      }
      const annualize = SECONDS_PER_YEAR / seconds;
      result.push({
        time: curr.date,
        apyPct: round(
          ((curr.tokenExchangePrice - prev.tokenExchangePrice) /
            prev.tokenExchangePrice) *
            annualize *
            100,
          4
        ),
        baseApyPct: round(
          ((curr.liquidityExchangePrice - prev.liquidityExchangePrice) /
            prev.liquidityExchangePrice) *
            annualize *
            100,
          4
        ),
        exchangeRate: curr.tokenExchangePrice / 1e12,
      });
    }
    return result;
  }

  public static daysToLiquidation(params: {
    ltvPct: number;
    liquidationLtvPct: number;
    supplyApyPct: number;
    borrowApyPct: number;
  }): number | null {
    const growth =
      Math.log(1 + params.borrowApyPct / 100) -
      Math.log(1 + params.supplyApyPct / 100);
    if (params.ltvPct <= 0 || growth <= 0) {
      return null;
    }
    const days =
      ((Math.log(params.liquidationLtvPct) - Math.log(params.ltvPct)) /
        growth) *
      365;
    return days <= 0 ? 0 : Math.floor(days);
  }
}

function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}
