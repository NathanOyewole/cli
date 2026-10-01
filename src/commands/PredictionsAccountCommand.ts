import chalk from "chalk";
import type { Command } from "commander";

import { PredictionsClient } from "../clients/PredictionsClient.ts";
import { PredictionsCommunityClient } from "../clients/PredictionsCommunityClient.ts";
import { Config } from "../lib/Config.ts";
import { NumberConverter } from "../lib/NumberConverter.ts";
import { Output } from "../lib/Output.ts";
import { PredictionsAuth } from "../lib/PredictionsAuth.ts";
import { PredictionsExecution } from "../lib/PredictionsExecution.ts";
import { PredictionsFormat } from "../lib/PredictionsFormat.ts";
import { Signer } from "../lib/Signer.ts";

const LEADERBOARD_PERIODS = ["all_time", "weekly", "monthly"];
const LEADERBOARD_METRICS = ["pnl", "volume", "win_rate"];
const PROFILE_PERIODS = ["all_time", "24h", "7d", "30d"];
const PNL_INTERVALS = ["24h", "7d", "30d", "all"];

function oneOf(name: string, value: string, options: string[]): string {
  if (!options.includes(value)) {
    throw new Error(`Invalid ${name}. Must be one of: ${options.join(", ")}.`);
  }
  return value;
}

export class PredictionsAccountCommand {
  public static register(predictions: Command): void {
    predictions
      .command("orders")
      .description("View open and recent prediction orders")
      .option("--key <name>", "Key to use (overrides active key)")
      .option("--address <address>", "Wallet address to look up")
      .option("--limit <n>", "Max results", "10")
      .option("--offset <n>", "Pagination offset", "0")
      .action((opts) => this.orders(opts));
    predictions
      .command("claim")
      .description("Claim payouts for resolved positions (all, or one)")
      .option("--position <pubkey>", "Claim a single position")
      .option("--key <name>", "Key to use for signing")
      .action((opts) => this.claim(opts));
    predictions
      .command("leaderboard")
      .description("Prediction trader leaderboard")
      .option(
        "--period <period>",
        `Period: ${LEADERBOARD_PERIODS.join(", ")}`,
        "weekly"
      )
      .option(
        "--metric <metric>",
        `Rank by: ${LEADERBOARD_METRICS.join(", ")}`,
        "pnl"
      )
      .option("--limit <n>", "Max results", "10")
      .action((opts) => this.leaderboard(opts));
    predictions
      .command("profile")
      .description("Prediction stats for any wallet")
      .option("--key <name>", "Key to use (overrides active key)")
      .option("--address <address>", "Wallet address to look up")
      .option(
        "--period <period>",
        `Period: ${PROFILE_PERIODS.join(", ")}`,
        "all_time"
      )
      .action((opts) => this.profile(opts));
    predictions
      .command("pnl")
      .description("Cumulative realized PnL chart for any wallet")
      .option("--key <name>", "Key to use (overrides active key)")
      .option("--address <address>", "Wallet address to look up")
      .option(
        "--interval <interval>",
        `Interval: ${PNL_INTERVALS.join(", ")}`,
        "7d"
      )
      .action((opts) => this.pnl(opts));
    predictions
      .command("set-username")
      .description("Set your public prediction-market username")
      .requiredOption("--username <name>", "New username")
      .option("--key <name>", "Key to use for signing")
      .action((opts) => this.setUsername(opts));
  }

  private static async orders(opts: {
    key?: string;
    address?: string;
    limit: string;
    offset: string;
  }): Promise<void> {
    const { start, end } = PredictionsFormat.parsePagination(opts);
    const address = await PredictionsFormat.resolveAddress(opts);
    const res = await PredictionsClient.getOrders({
      ownerPubkey: address,
      start,
      end,
    });

    const orders = res.data.map((o) => ({
      orderPubkey: o.pubkey,
      event: o.eventMetadata.title,
      market: o.marketMetadata.title,
      marketId: o.marketMetadata.marketId,
      orderType: o.orderType,
      status: o.status,
      side: o.isYes ? "yes" : "no",
      action: o.isBuy ? "buy" : "sell",
      contracts: NumberConverter.fromMicroUsd(o.contractsMicro),
      filledContracts: NumberConverter.fromMicroUsd(o.filledContractsMicro),
      limitPriceUsd: PredictionsFormat.microOrNull(
        o.isBuy ? o.maxBuyPriceUsd : o.minSellPriceUsd
      ),
      avgFillPriceUsd: PredictionsFormat.priceOrNull(Number(o.avgFillPriceUsd)),
      sizeUsd: NumberConverter.fromMicroUsd(o.sizeUsd),
      positionPubkey: o.position,
      createdAt: new Date(o.createdAt * 1000).toISOString(),
    }));

    if (Output.isJson()) {
      Output.json({
        count: orders.length,
        orders,
        ...(res.pagination.hasNext && { next: res.pagination.end }),
      });
      return;
    }
    if (orders.length === 0) {
      console.log("No orders found.");
      return;
    }
    Output.table({
      type: "horizontal",
      headers: {
        createdAt: "Created",
        event: "Event / Market",
        trade: "Trade",
        orderType: "Type",
        status: "Status",
        contracts: "Filled / Contracts",
        limit: "Limit Price",
        orderPubkey: "Order",
      },
      maxWidths: { event: 36 },
      rows: orders.map((o) => ({
        createdAt: PredictionsFormat.formatDate(o.createdAt),
        event: o.event + chalk.gray("\n└─► ") + o.market,
        trade: `${o.action} ${PredictionsFormat.formatSide(o.side)}`,
        orderType: o.orderType,
        status: o.status,
        contracts: `${o.filledContracts} / ${o.contracts}`,
        limit: Output.formatDollar(o.limitPriceUsd ?? undefined, {
          decimals: 2,
        }),
        orderPubkey: o.orderPubkey,
      })),
    });
    if (res.pagination.hasNext) {
      console.log("\nNext offset:", res.pagination.end);
    }
  }

  private static async claim(opts: {
    position?: string;
    key?: string;
  }): Promise<void> {
    const signer = await Signer.load(opts.key ?? Config.load().activeKey);
    const requests = opts.position
      ? [await PredictionsClient.claimPosition(opts.position, signer.address)]
      : (await PredictionsClient.claimAllPositions(signer.address)).data;
    if (requests.length === 0) {
      throw new Error("No positions to claim.");
    }

    const results = [];
    for (const req of requests) {
      const { signature } = await PredictionsExecution.signAndExecute(
        signer,
        req
      );
      results.push({
        positionPubkey: req.position.positionPubkey,
        side: req.position.isYes ? "yes" : "no",
        contracts: Number(req.position.contracts),
        payoutUsd: NumberConverter.fromMicroUsd(req.position.payoutAmountUsd),
        signature,
        ...(Config.dryRun && { transaction: req.transaction }),
      });
    }
    const payoutUsd = results.reduce((sum, r) => sum + r.payoutUsd, 0);

    if (Output.isJson()) {
      Output.json({
        ...(Config.dryRun && { dryRun: true }),
        action: "claim",
        payoutUsd,
        results,
      });
      return;
    }
    if (Config.dryRun) {
      console.log(Output.DRY_RUN_LABEL);
    }
    Output.table({
      type: "horizontal",
      headers: {
        positionPubkey: "Position",
        side: "Side",
        payout: "Payout",
        ...(!Config.dryRun && { signature: "Tx Signature" }),
      },
      rows: results.map((r) => ({
        positionPubkey: r.positionPubkey,
        side: PredictionsFormat.formatSide(r.side),
        payout: Output.formatDollar(r.payoutUsd),
        signature: r.signature,
      })),
    });
    console.log(`Total payout: ${Output.formatDollar(payoutUsd)}`);
  }

  private static async leaderboard(opts: {
    period: string;
    metric: string;
    limit: string;
  }): Promise<void> {
    const period = oneOf("--period", opts.period, LEADERBOARD_PERIODS);
    const metric = oneOf("--metric", opts.metric, LEADERBOARD_METRICS);
    const res = await PredictionsClient.getLeaderboard({
      period,
      metric,
      limit: Number(opts.limit),
    });
    const usernames = await PredictionsClient.getUsernames(
      res.data.map((r) => r.ownerPubkey)
    );
    const leaderboard = res.data.map((r, i) => ({
      rank: i + 1,
      address: r.ownerPubkey,
      username: usernames.data[r.ownerPubkey] ?? null,
      pnlUsd: NumberConverter.fromMicroUsd(r.realizedPnlUsd),
      volumeUsd: NumberConverter.fromMicroUsd(r.totalVolumeUsd),
      predictions: Number(r.predictionsCount),
      correct: Number(r.correctPredictions),
      wrong: Number(r.wrongPredictions),
      winRatePct: Number(r.winRatePct),
    }));
    const summary = res.summary[period];

    if (Output.isJson()) {
      Output.json({
        period,
        metric,
        totalVolumeUsd: summary
          ? NumberConverter.fromMicroUsd(summary.totalVolumeUsd)
          : null,
        totalPredictions: summary?.predictionsCount ?? null,
        leaderboard,
      });
      return;
    }
    Output.table({
      type: "horizontal",
      headers: {
        rank: "#",
        trader: "Trader",
        pnl: "PnL",
        volume: "Volume",
        record: "W / L",
        winRate: "Win Rate",
      },
      rows: leaderboard.map((r) => ({
        rank: r.rank,
        trader: r.username
          ? `${r.username}\n${chalk.gray(r.address)}`
          : r.address,
        pnl: Output.formatDollarChange(r.pnlUsd),
        volume: Output.formatDollar(r.volumeUsd, { decimals: 0 }),
        record: `${r.correct} / ${r.wrong}`,
        winRate: `${r.winRatePct.toFixed(2)}%`,
      })),
    });
  }

  private static async profile(opts: {
    key?: string;
    address?: string;
    period: string;
  }): Promise<void> {
    const period = oneOf("--period", opts.period, PROFILE_PERIODS);
    const address = await PredictionsFormat.resolveAddress(opts);
    const [p, usernames] = await Promise.all([
      PredictionsClient.getProfile(address, period),
      PredictionsClient.getUsernames([address]),
    ]);
    const correct = Number(p.correctPredictions);
    const wrong = Number(p.wrongPredictions);
    const profile = {
      address,
      username: usernames.data[address] ?? null,
      period,
      pnlUsd: NumberConverter.fromMicroUsd(p.realizedPnlUsd),
      volumeUsd: NumberConverter.fromMicroUsd(p.totalVolumeUsd),
      predictions: Number(p.predictionsCount),
      correct,
      wrong,
      winRatePct:
        correct + wrong > 0
          ? Number(((correct / (correct + wrong)) * 100).toFixed(2))
          : null,
      activeContracts: p.totalActiveContractsMicro
        ? NumberConverter.fromMicroUsd(p.totalActiveContractsMicro)
        : Number(p.totalActiveContracts),
      positionsValueUsd: NumberConverter.fromMicroUsd(p.totalPositionsValueUsd),
    };

    if (Output.isJson()) {
      Output.json(profile);
      return;
    }
    Output.table({
      type: "vertical",
      rows: [
        { label: "Wallet", value: profile.address },
        { label: "Username", value: profile.username ?? "—" },
        { label: "Period", value: profile.period },
        {
          label: "Realized PnL",
          value: Output.formatDollarChange(profile.pnlUsd),
        },
        { label: "Volume", value: Output.formatDollar(profile.volumeUsd) },
        { label: "Predictions", value: String(profile.predictions) },
        { label: "Won / Lost", value: `${profile.correct} / ${profile.wrong}` },
        {
          label: "Win Rate",
          value: profile.winRatePct === null ? "—" : `${profile.winRatePct}%`,
        },
        {
          label: "Open Positions Value",
          value: Output.formatDollar(profile.positionsValueUsd),
        },
      ],
    });
  }

  private static async pnl(opts: {
    key?: string;
    address?: string;
    interval: string;
  }): Promise<void> {
    const interval = oneOf("--interval", opts.interval, PNL_INTERVALS);
    const address = await PredictionsFormat.resolveAddress(opts);
    const res = await PredictionsClient.getPnlHistory(address, interval);
    const history = res.history.map((h) => ({
      time: new Date(h.timestamp * 1000).toISOString(),
      pnlUsd: Number(h.cumulativePnlUsd) / 1_000_000,
    }));
    const changeUsd =
      history.length > 1
        ? history[history.length - 1]!.pnlUsd - history[0]!.pnlUsd
        : 0;

    if (Output.isJson()) {
      Output.json({
        address,
        interval,
        bucketSeconds: res.bucketSeconds,
        changeUsd,
        history,
      });
      return;
    }
    console.log(
      `PnL change (${interval}): ${Output.formatDollarChange(changeUsd)}`
    );
    Output.table({
      type: "horizontal",
      headers: { time: "Time", pnl: "Cumulative PnL" },
      rows: history.map((h) => ({
        time: PredictionsFormat.formatDateTime(h.time),
        pnl: Output.formatDollarChange(h.pnlUsd),
      })),
    });
  }

  private static async setUsername(opts: {
    username: string;
    key?: string;
  }): Promise<void> {
    const keyName = opts.key ?? Config.load().activeKey;
    const wallet = await Signer.loadAddress(keyName);
    const timestamp = Date.now();
    const message = PredictionsAuth.usernameMessage(
      wallet,
      opts.username,
      timestamp
    );

    if (Config.dryRun) {
      if (Output.isJson()) {
        Output.json({
          dryRun: true,
          action: "set-username",
          address: wallet,
          username: opts.username,
          message,
        });
        return;
      }
      console.log(Output.DRY_RUN_LABEL);
      console.log(`Would sign and submit:\n${message}`);
      return;
    }

    const signer = await Signer.load(keyName);
    const signed = await PredictionsAuth.signWithWallet(signer, message);
    const res = await PredictionsCommunityClient.setUsername({
      wallet,
      username: opts.username,
      timestamp,
      ...signed,
    });

    if (Output.isJson()) {
      Output.json({
        action: "set-username",
        address: res.ownerPubkey,
        username: res.username,
      });
      return;
    }
    console.log(`Username set to ${chalk.bold(res.username)}.`);
  }
}
