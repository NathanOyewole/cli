import type { DatapiAsset, SwapStats } from "../clients/DatapiClient.ts";
import { Output } from "./Output.ts";

export type TokenRow = {
  rank?: number;
  id: string;
  symbol: string;
  name: string;
  priceUsd: number | null;
  priceChangePct: number | null;
  mcap: number | null;
  liquidity: number | null;
  volumeUsd: number | null;
  netVolumeUsd: number | null;
  txns: number | null;
  traders: number | null;
  netBuyers: number | null;
  holderCount: number | null;
  organicScore: number | null;
  organicScoreLabel: string | null;
  isVerified: boolean;
  launchpad: string | null;
  createdAt: string | null;
};

export type ScreenerRow = TokenRow & {
  bondingCurvePct: number | null;
  graduatedAt: string | null;
  devBalancePct: number | null;
  topHoldersPct: number | null;
  sniperPct: number | null;
  insiderPct: number | null;
  bundlerPct: number | null;
  twitter: string | null;
};

const STATS_KEYS = {
  "5m": "stats5m",
  "1h": "stats1h",
  "6h": "stats6h",
  "24h": "stats24h",
  "7d": "stats7d",
  "30d": "stats30d",
} as const;

export type StatsInterval = keyof typeof STATS_KEYS;

function sum(a: number | undefined, b: number | undefined): number | null {
  if (a === undefined && b === undefined) {
    return null;
  }
  return (a ?? 0) + (b ?? 0);
}

function diff(a: number | undefined, b: number | undefined): number | null {
  if (a === undefined && b === undefined) {
    return null;
  }
  return (a ?? 0) - (b ?? 0);
}

export class TokenView {
  public static stats(
    asset: DatapiAsset,
    interval: string
  ): SwapStats | undefined {
    const key = STATS_KEYS[interval as StatsInterval];
    return key ? asset[key] : undefined;
  }

  public static mapStats(stats: SwapStats | undefined) {
    return {
      priceChangePct: stats?.priceChange ?? null,
      volumeUsd: sum(stats?.buyVolume, stats?.sellVolume),
      buyVolumeUsd: stats?.buyVolume ?? null,
      sellVolumeUsd: stats?.sellVolume ?? null,
      netVolumeUsd: diff(stats?.buyVolume, stats?.sellVolume),
      organicVolumeUsd: sum(stats?.buyOrganicVolume, stats?.sellOrganicVolume),
      txns: sum(stats?.numBuys, stats?.numSells),
      buys: stats?.numBuys ?? null,
      sells: stats?.numSells ?? null,
      traders: stats?.numTraders ?? null,
      netBuyers: stats?.numNetBuyers ?? null,
      organicBuyers: stats?.numOrganicBuyers ?? null,
      holderChangePct: stats?.holderChange ?? null,
      liquidityChangePct: stats?.liquidityChange ?? null,
    };
  }

  public static toRow(asset: DatapiAsset, interval: string): TokenRow {
    const stats = this.mapStats(this.stats(asset, interval));
    return {
      id: asset.id,
      symbol: asset.symbol,
      name: asset.name,
      priceUsd: asset.usdPrice ?? null,
      priceChangePct: stats.priceChangePct,
      mcap: asset.mcap ?? null,
      liquidity: asset.liquidity ?? null,
      volumeUsd: stats.volumeUsd,
      netVolumeUsd: stats.netVolumeUsd,
      txns: stats.txns,
      traders: stats.traders,
      netBuyers: stats.netBuyers,
      holderCount: asset.holderCount ?? null,
      organicScore: asset.organicScore ?? null,
      organicScoreLabel: asset.organicScoreLabel ?? null,
      isVerified: asset.isVerified ?? false,
      launchpad: asset.launchpad ?? null,
      createdAt: asset.firstPool?.createdAt ?? asset.createdAt ?? null,
    };
  }

  public static toScreenerRow(
    asset: DatapiAsset,
    interval: string
  ): ScreenerRow {
    return {
      ...this.toRow(asset, interval),
      bondingCurvePct: asset.bondingCurve ?? null,
      graduatedAt: asset.graduatedAt ?? null,
      devBalancePct: asset.audit?.devBalancePercentage ?? null,
      topHoldersPct: asset.audit?.topHoldersPercentage ?? null,
      sniperPct: asset.audit?.sniperPct ?? null,
      insiderPct: asset.audit?.insiderPct ?? null,
      bundlerPct: asset.audit?.bundlerStats?.holdingPct ?? null,
      twitter: asset.twitter ?? null,
    };
  }

  public static formatAge(iso: string | null): string {
    if (!iso) {
      return "—";
    }
    const minutes = Math.max(0, (Date.now() - Date.parse(iso)) / 60_000);
    if (minutes < 60) {
      return `${Math.floor(minutes)}m`;
    }
    if (minutes < 60 * 24) {
      return `${Math.floor(minutes / 60)}h`;
    }
    if (minutes < 60 * 24 * 365) {
      return `${Math.floor(minutes / 1440)}d`;
    }
    return `${(minutes / 525_600).toFixed(1)}y`;
  }

  public static printTable(rows: TokenRow[], interval: string): void {
    const hasRank = rows.some((r) => r.rank !== undefined);
    Output.table({
      type: "horizontal",
      headers: {
        ...(hasRank && { rank: "#" }),
        symbol: "Token",
        price: "Price",
        change: interval,
        mcap: "Mcap",
        liquidity: "Liquidity",
        volume: `${interval} Vol`,
        holders: "Holders",
        age: "Age",
        id: "Address",
      },
      rows: rows.map((r) => ({
        rank: r.rank,
        symbol: r.isVerified ? `${r.symbol} ✓` : r.symbol,
        price: Output.formatDollar(r.priceUsd ?? undefined),
        change: Output.formatPercentageChange(r.priceChangePct ?? undefined),
        mcap: Output.formatCompactDollar(r.mcap),
        liquidity: Output.formatCompactDollar(r.liquidity),
        volume: Output.formatCompactDollar(r.volumeUsd),
        holders: Output.formatCompactNumber(r.holderCount),
        age: this.formatAge(r.createdAt),
        id: r.id,
      })),
    });
  }
}
