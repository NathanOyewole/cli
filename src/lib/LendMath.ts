import type {
  ExchangePricePoint,
  Nft,
  Vault,
  VaultSide,
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

  public static vaultApys(vault: Vault): {
    supplyApyPct: number;
    borrowApyPct: number;
  } {
    const supplyMagnifier = Number(vault.supplyRateMagnifier);
    const borrowMagnifier = Number(vault.borrowRateMagnifier);
    const supplyApr =
      (Number(vault.supplyRate.liquidity.token0) +
        (supplyMagnifier > 0 ? 0 : supplyMagnifier)) /
      1e4;
    const borrowApr =
      (Number(vault.borrowRate.liquidity.token0) +
        (borrowMagnifier < 0 ? 0 : borrowMagnifier)) /
      1e4;
    return {
      supplyApyPct: round(this.aprToApy(supplyApr) * 100, 4),
      borrowApyPct: round(this.aprToApy(borrowApr) * 100, 4),
    };
  }

  public static maxMultiplier(vault: Vault): number {
    const cf = Number(vault.collateralFactor) / 1e3;
    const cap =
      (1 / (1 - cf)) * (1 - vault.metadata.multiply.reduceFactor / 1e4);
    return Math.floor(cap * 100) / 100;
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
    const liquidationPrice =
      collateral > 0 && debt > 0 ? debt / (collateral * lt) : null;
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
