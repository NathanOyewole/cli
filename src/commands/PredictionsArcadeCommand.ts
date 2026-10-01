import chalk from "chalk";
import type { Command } from "commander";
import { HTTPError } from "ky";

import {
  PredictionsArcadeClient,
  type ArcadeAsset,
  type ArcadeBetRequest,
  type ArcadeRound,
} from "../clients/PredictionsArcadeClient.ts";
import { Config } from "../lib/Config.ts";
import { NumberConverter } from "../lib/NumberConverter.ts";
import { Output } from "../lib/Output.ts";
import { PredictionsExecution } from "../lib/PredictionsExecution.ts";
import { PredictionsFormat } from "../lib/PredictionsFormat.ts";
import { Signer } from "../lib/Signer.ts";

const ASSETS: ArcadeAsset[] = ["BTC", "SOL"];
const BETTING_CLOSED_RETRY_MS = 5_000;

export class PredictionsArcadeCommand {
  public static register(predictions: Command): void {
    const arcade = predictions
      .command("arcade")
      .description("1-minute UP/DOWN rounds on BTC and SOL");
    arcade
      .command("rounds")
      .description("Live and upcoming rounds, plus recent results")
      .option("--asset <asset>", "Asset: BTC, SOL", "BTC")
      .option("--limit <n>", "Recent rounds to show", "5")
      .action((opts) => this.rounds(opts));
    arcade
      .command("open")
      .description("Bet on the next round closing up or down")
      .requiredOption("--asset <asset>", "Asset: BTC, SOL")
      .requiredOption("--side <side>", "Side: up, down, u, d")
      .requiredOption("--amount <usdc>", "Bet size in USDC")
      .option("--key <name>", "Key to use for signing")
      .action((opts) => this.open(opts));
    arcade
      .command("positions")
      .description("Bets in the live and next rounds")
      .option("--asset <asset>", "Asset: BTC, SOL (default: both)")
      .option("--key <name>", "Key to use (overrides active key)")
      .option("--address <address>", "Wallet address to look up")
      .action((opts) => this.positions(opts));
    arcade
      .command("history")
      .description("Round results and stats for any wallet")
      .option("--key <name>", "Key to use (overrides active key)")
      .option("--address <address>", "Wallet address to look up")
      .option("--limit <n>", "Max results", "10")
      .option("--offset <n>", "Pagination offset", "0")
      .action((opts) => this.history(opts));
  }

  private static normalizeAsset(asset: string): ArcadeAsset {
    const a = asset.toUpperCase() as ArcadeAsset;
    if (!ASSETS.includes(a)) {
      throw new Error(`Invalid --asset. Must be one of: ${ASSETS.join(", ")}.`);
    }
    return a;
  }

  public static normalizeSide(side: string): "UP" | "DOWN" {
    const s = side.toLowerCase();
    if (s === "up" || s === "u") {
      return "UP";
    }
    if (s === "down" || s === "d") {
      return "DOWN";
    }
    throw new Error("Invalid --side. Must be up, down, u, or d.");
  }

  /** The live round contains the server time; bets go into the next one. */
  public static currentRounds(
    rounds: ArcadeRound[],
    serverTime: number
  ): { live: ArcadeRound | null; next: ArcadeRound | null } {
    const sorted = [...rounds].sort((a, b) => a.openTs - b.openTs);
    return {
      live:
        sorted.find((r) => r.openTs <= serverTime && serverTime < r.closeTs) ??
        null,
      next: sorted.find((r) => r.openTs > serverTime) ?? null,
    };
  }

  private static roundJson(r: ArcadeRound) {
    return {
      roundId: r.id,
      address: r.address,
      opensAt: new Date(r.openTs * 1000).toISOString(),
      closesAt: new Date(r.closeTs * 1000).toISOString(),
      status: r.status ?? "upcoming",
      outcome: r.outcome === "UNRESOLVED" ? null : r.outcome,
      upPoolUsd: NumberConverter.fromMicroUsd(r.upPool),
      downPoolUsd: NumberConverter.fromMicroUsd(r.downPool),
      openPriceUsd: PredictionsFormat.microOrNull(r.openPrice),
      closePriceUsd: PredictionsFormat.microOrNull(r.closePrice),
    };
  }

  private static async rounds(opts: {
    asset: string;
    limit: string;
  }): Promise<void> {
    const asset = this.normalizeAsset(opts.asset);
    const [config, res] = await Promise.all([
      PredictionsArcadeClient.getConfig(),
      PredictionsArcadeClient.getRounds(asset),
    ]);
    const { live, next } = this.currentRounds(res.data, res.serverTime);
    const recent = res.data
      .filter((r) => r.closeTs <= res.serverTime)
      .sort((a, b) => b.openTs - a.openTs)
      .slice(0, Number(opts.limit));

    const json = {
      asset,
      paused: config.paused,
      roundSeconds: config.roundDurationSeconds,
      betCutoffSeconds: config.betCutoffSeconds,
      feePct: config.feeBps / 100,
      minBetUsd: NumberConverter.fromMicroUsd(config.limits.minimum),
      maxBetUsd: NumberConverter.fromMicroUsd(config.limits.maximumPerEntry),
      live: live ? this.roundJson(live) : null,
      next: next ? this.roundJson(next) : null,
      recent: recent.map((r) => this.roundJson(r)),
    };

    if (Output.isJson()) {
      Output.json(json);
      return;
    }
    if (json.paused) {
      console.log(chalk.yellow("Arcade is paused."));
    }
    const time = (iso: string) => new Date(iso).toLocaleTimeString();
    const price = (v: number | null) =>
      v === null ? "—" : Output.formatDollar(v, { decimals: 2 });
    Output.table({
      type: "horizontal",
      headers: {
        round: "Round",
        window: "Window",
        status: "Status",
        open: "Open",
        close: "Close",
        pools: "Up / Down Pool",
      },
      rows: [
        ...(json.next ? [{ ...json.next, label: "next" }] : []),
        ...(json.live ? [{ ...json.live, label: "live" }] : []),
        ...json.recent.map((r) => ({ ...r, label: r.outcome ?? r.status })),
      ].map((r) => ({
        round:
          r.label === "UP"
            ? chalk.green(r.label)
            : r.label === "DOWN"
              ? chalk.red(r.label)
              : r.label,
        window: `${time(r.opensAt)} → ${time(r.closesAt)}`,
        status: r.status,
        open: price(r.openPriceUsd),
        close: price(r.closePriceUsd),
        pools: `${Output.formatDollar(r.upPoolUsd, { decimals: 0 })} / ${Output.formatDollar(r.downPoolUsd, { decimals: 0 })}`,
      })),
    });
    console.log(
      `Bets go into the next round. Min ${Output.formatDollar(json.minBetUsd, { decimals: 2 })}, max ${Output.formatDollar(json.maxBetUsd, { decimals: 2 })}, fee ${json.feePct}%.`
    );
  }

  private static async prepareBet(req: {
    asset: ArcadeAsset;
    walletAddress: string;
    side: "UP" | "DOWN";
    amount: string;
  }): Promise<ArcadeBetRequest> {
    try {
      return await PredictionsArcadeClient.prepareBet(req);
    } catch (err) {
      // Betting shuts for a few seconds before each round opens; the next round accepts bets right after.
      const body =
        err instanceof HTTPError
          ? await err.response
              .clone()
              .json()
              .catch(() => null)
          : null;
      if ((body as { code?: string } | null)?.code !== "betting_closed") {
        throw err;
      }
      await new Promise((r) => setTimeout(r, BETTING_CLOSED_RETRY_MS));
      return PredictionsArcadeClient.prepareBet(req);
    }
  }

  private static async open(opts: {
    asset: string;
    side: string;
    amount: string;
    key?: string;
  }): Promise<void> {
    const asset = this.normalizeAsset(opts.asset);
    const side = this.normalizeSide(opts.side);
    const amount = NumberConverter.toMicroUsd(opts.amount);
    if (!/^\d+$/.test(amount) || BigInt(amount) <= 0n) {
      throw new Error("--amount must be a positive USDC amount.");
    }
    const signer = await Signer.load(opts.key ?? Config.load().activeKey);
    const res = await this.prepareBet({
      asset,
      walletAddress: signer.address,
      side,
      amount,
    });
    const { signature } = await PredictionsExecution.signAndExecute(signer, {
      transaction: res.transaction,
      execution: { endpoint: "/api/v1/execute", context: { type: "play_bet" } },
    });
    const amountUsd = NumberConverter.fromMicroUsd(res.amount);
    const opensAt = new Date(res.openTs * 1000).toISOString();

    if (Output.isJson()) {
      Output.json({
        ...(Config.dryRun && { dryRun: true }),
        action: "open",
        asset,
        side: side.toLowerCase(),
        amountUsd,
        roundOpensAt: opensAt,
        signature,
        ...(Config.dryRun && { transaction: res.transaction }),
      });
      return;
    }
    if (Config.dryRun) {
      console.log(Output.DRY_RUN_LABEL);
    }
    Output.table({
      type: "vertical",
      rows: [
        { label: "Action", value: "Arcade Bet" },
        { label: "Asset", value: asset },
        {
          label: "Side",
          value: PredictionsFormat.formatSide(side.toLowerCase()),
        },
        {
          label: "Amount",
          value: Output.formatDollar(amountUsd, { decimals: 2 }),
        },
        { label: "Round Opens", value: new Date(opensAt).toLocaleTimeString() },
        ...(!Config.dryRun
          ? [{ label: "Tx Signature", value: signature ?? "" }]
          : []),
      ],
    });
  }

  private static async positions(opts: {
    asset?: string;
    key?: string;
    address?: string;
  }): Promise<void> {
    const address = await PredictionsFormat.resolveAddress(opts);
    const assets = opts.asset ? [this.normalizeAsset(opts.asset)] : ASSETS;
    const positions = [];
    for (const asset of assets) {
      const res = await PredictionsArcadeClient.getRounds(asset);
      const { live, next } = this.currentRounds(res.data, res.serverTime);
      for (const [round, r] of [
        ["live", live],
        ["next", next],
      ] as const) {
        if (!r) {
          continue;
        }
        const p = await PredictionsArcadeClient.getPosition(
          asset,
          r.openTs,
          address
        );
        if (!p) {
          continue;
        }
        positions.push({
          asset,
          round,
          opensAt: new Date(r.openTs * 1000).toISOString(),
          closesAt: new Date(r.closeTs * 1000).toISOString(),
          upAmountUsd: NumberConverter.fromMicroUsd(p.upAmount),
          downAmountUsd: NumberConverter.fromMicroUsd(p.downAmount),
          upPayoutUsd: NumberConverter.fromMicroUsd(p.upPayout),
          downPayoutUsd: NumberConverter.fromMicroUsd(p.downPayout),
        });
      }
    }

    if (Output.isJson()) {
      Output.json({ address, count: positions.length, positions });
      return;
    }
    if (positions.length === 0) {
      console.log("No bets in the live or next rounds.");
      return;
    }
    Output.table({
      type: "horizontal",
      headers: {
        asset: "Asset",
        round: "Round",
        closes: "Closes",
        up: "Up Bet",
        down: "Down Bet",
      },
      rows: positions.map((p) => ({
        asset: p.asset,
        round: p.round,
        closes: new Date(p.closesAt).toLocaleTimeString(),
        up: Output.formatDollar(p.upAmountUsd, { decimals: 2 }),
        down: Output.formatDollar(p.downAmountUsd, { decimals: 2 }),
      })),
    });
  }

  private static async history(opts: {
    key?: string;
    address?: string;
    limit: string;
    offset: string;
  }): Promise<void> {
    const { start, end } = PredictionsFormat.parsePagination(opts);
    const address = await PredictionsFormat.resolveAddress(opts);
    const [stats, res] = await Promise.all([
      PredictionsArcadeClient.getStats(address),
      PredictionsArcadeClient.getHistory(address, start, end),
    ]);
    const history = res.data.map((h) => {
      const up = BigInt(h.upAmount);
      const down = BigInt(h.downAmount);
      return {
        asset: h.asset,
        opensAt: new Date(h.openTs * 1000).toISOString(),
        outcome: h.outcome === "UNRESOLVED" ? null : h.outcome,
        side: up > 0n && down > 0n ? "both" : up > 0n ? "up" : "down",
        amountUsd: NumberConverter.fromMicroUsd((up + down).toString()),
        payoutUsd: NumberConverter.fromMicroUsd(
          (BigInt(h.upPayout) + BigInt(h.downPayout)).toString()
        ),
        pnlUsd: PredictionsFormat.microOrNull(h.realizedPnlUsd),
        roundAddress: h.roundAddress,
      };
    });

    if (Output.isJson()) {
      Output.json({
        address,
        totalRounds: stats.totalRounds,
        wins: stats.wins,
        losses: stats.losses,
        voided: stats.voided,
        pnlUsd: NumberConverter.fromMicroUsd(stats.realizedPnlUsd),
        history,
        ...(res.pagination.hasNext && { next: res.pagination.end }),
      });
      return;
    }
    console.log(
      `${stats.totalRounds} rounds, ${stats.wins} won / ${stats.losses} lost / ${stats.voided} void, PnL ${Output.formatDollarChange(NumberConverter.fromMicroUsd(stats.realizedPnlUsd))}`
    );
    if (history.length === 0) {
      return;
    }
    Output.table({
      type: "horizontal",
      headers: {
        time: "Round",
        asset: "Asset",
        side: "Bet",
        outcome: "Outcome",
        amount: "Amount",
        pnl: "PnL",
      },
      rows: history.map((h) => ({
        time: PredictionsFormat.formatDateTime(h.opensAt),
        asset: h.asset,
        side: PredictionsFormat.formatSide(h.side),
        outcome: h.outcome ?? "—",
        amount: Output.formatDollar(h.amountUsd, { decimals: 2 }),
        pnl: Output.formatDollarChange(h.pnlUsd ?? undefined),
      })),
    });
    if (res.pagination.hasNext) {
      console.log("\nNext offset:", res.pagination.end);
    }
  }
}
