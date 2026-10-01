import type { Command } from "commander";

import { PerpsClient } from "../clients/PerpsClient.ts";
import { resolveAsset } from "../lib/Asset.ts";
import { NumberConverter } from "../lib/NumberConverter.ts";
import { Output } from "../lib/Output.ts";
import { PerpsTx } from "../lib/PerpsTx.ts";

type Period = { asset: string; year: string; week: string };

function parsePeriod(opts: Period): Period & { marketMint: string } {
  const asset = opts.asset.toUpperCase();
  if (!["SOL", "ETH", "BTC"].includes(asset)) {
    throw new Error("--asset must be SOL, ETH, or BTC.");
  }
  if (!/^\d{4}$/.test(opts.year)) {
    throw new Error("--year must be a 4-digit year.");
  }
  const week = opts.week.toLowerCase();
  if (week !== "current" && !/^([1-9]|[1-4]\d|5[0-3])$/.test(week)) {
    throw new Error("--week must be 1-53 or 'current'.");
  }
  return { asset, year: opts.year, week, marketMint: resolveAsset(asset).id };
}

const toIso = (seconds: number) => new Date(seconds * 1000).toISOString();

export class PerpsLeaderboardCommand {
  public static register(perps: Command): void {
    const currentYear = String(new Date().getUTCFullYear());
    perps
      .command("leaderboard")
      .description("Top traders for a market in a given week")
      .option("--asset <asset>", "Market (SOL, BTC, ETH)", "SOL")
      .option("--year <yyyy>", "Year", currentYear)
      .option("--week <n>", "Week of the year (1-53) or 'current'", "current")
      .option("--sort <by>", "Rank by 'volume' or 'pnl'", "volume")
      .option("--limit <n>", "Max number of traders (up to 50)", "20")
      .action((opts) => this.leaderboard(opts));
    perps
      .command("stats")
      .description("A wallet's PnL and volume for a market in a given week")
      .option("--key <name>", "Key to use (overrides active key)")
      .option("--address <address>", "Wallet address to look up")
      .option("--asset <asset>", "Market (SOL, BTC, ETH)", "SOL")
      .option("--year <yyyy>", "Year", currentYear)
      .option("--week <n>", "Week of the year (1-53) or 'current'", "current")
      .action((opts) => this.stats(opts));
  }

  private static async leaderboard(
    opts: Period & { sort: string; limit: string }
  ): Promise<void> {
    const period = parsePeriod(opts);
    if (opts.sort !== "volume" && opts.sort !== "pnl") {
      throw new Error("--sort must be 'volume' or 'pnl'.");
    }
    const limit = Number(opts.limit);
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error("--limit must be a positive integer.");
    }

    const res = await PerpsClient.getTopTraders(period);
    const ranked =
      opts.sort === "pnl" ? res.topTradersByPnl : res.topTradersByVolume;
    const traders = ranked.slice(0, limit).map((t, i) => ({
      rank: i + 1,
      address: t.owner,
      pnlUsd: NumberConverter.fromMicroUsd(t.totalPnlUsd),
      volumeUsd: NumberConverter.fromMicroUsd(t.totalVolumeUsd),
    }));
    const result = {
      asset: period.asset,
      year: Number(period.year),
      week: period.week === "current" ? "current" : Number(period.week),
      startTime: toIso(res.startTimestamp),
      endTime: toIso(res.endTimestamp),
      marketVolumeUsd: NumberConverter.fromMicroUsd(res.totalVolumeUsd),
      sort: opts.sort,
      traders,
    };

    if (Output.isJson()) {
      Output.json(result);
      return;
    }

    console.log(
      `${period.asset} leaderboard by ${opts.sort}, ${result.startTime.slice(0, 10)} to ${result.endTime.slice(0, 10)} (market volume ${Output.formatDollar(result.marketVolumeUsd, { decimals: 0 })})`
    );
    Output.table({
      type: "horizontal",
      headers: {
        rank: "#",
        address: "Trader",
        pnl: "PnL",
        volume: "Volume",
      },
      rows: traders.map((t) => ({
        rank: t.rank,
        address: t.address,
        pnl: Output.formatDollarChange(t.pnlUsd),
        volume: Output.formatDollar(t.volumeUsd, { decimals: 0 }),
      })),
    });
  }

  private static async stats(
    opts: Period & { key?: string; address?: string }
  ): Promise<void> {
    const period = parsePeriod(opts);
    const address = await PerpsTx.resolveAddress(opts);
    const res = await PerpsClient.getTraderStats({
      walletAddress: address,
      marketMint: period.marketMint,
      year: period.year,
      week: period.week,
    });
    const result = {
      address,
      asset: period.asset,
      year: Number(period.year),
      week: period.week === "current" ? "current" : Number(period.week),
      startTime: toIso(res.startTimestamp),
      endTime: toIso(res.endTimestamp),
      pnlUsd: NumberConverter.fromMicroUsd(res.totalPnlUsd),
      volumeUsd: NumberConverter.fromMicroUsd(res.totalVolumeUsd),
    };

    if (Output.isJson()) {
      Output.json(result);
      return;
    }
    Output.table({
      type: "vertical",
      rows: [
        { label: "Wallet", value: address },
        { label: "Market", value: period.asset },
        {
          label: "Period",
          value: `${result.startTime.slice(0, 10)} to ${result.endTime.slice(0, 10)}`,
        },
        { label: "PnL", value: Output.formatDollarChange(result.pnlUsd) },
        {
          label: "Volume",
          value: Output.formatDollar(result.volumeUsd, { decimals: 2 }),
        },
      ],
    });
  }
}
