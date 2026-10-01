import chalk from "chalk";
import { Option, type Command } from "commander";

import {
  DatapiClient,
  type DatapiAsset,
  type Holder,
  type HolderPnl,
} from "../clients/DatapiClient.ts";
import { IntelClient } from "../clients/IntelClient.ts";
import { Asset } from "../lib/Asset.ts";
import { OptionParsers } from "../lib/OptionParsers.ts";
import { Output } from "../lib/Output.ts";
import { TokenView } from "../lib/TokenView.ts";
import { WalletTracker } from "../lib/WalletTracker.ts";

const CHART_INTERVALS: Record<string, string> = {
  "1s": "1_SECOND",
  "15s": "15_SECOND",
  "30s": "30_SECOND",
  "1m": "1_MINUTE",
  "3m": "3_MINUTE",
  "5m": "5_MINUTE",
  "15m": "15_MINUTE",
  "30m": "30_MINUTE",
  "1h": "1_HOUR",
  "2h": "2_HOUR",
  "4h": "4_HOUR",
  "8h": "8_HOUR",
  "12h": "12_HOUR",
  "1d": "1_DAY",
  "1w": "1_WEEK",
  "1M": "1_MONTH",
};

const NET_VOLUME_INTERVALS: Record<string, string> = {
  "5m": "5_MINUTE",
  "1h": "1_HOUR",
  "6h": "6_HOUR",
  "24h": "1_DAY",
};

const STATS_INTERVALS = ["5m", "1h", "6h", "24h"] as const;
const HOLDER_TAGS = ["sniper", "insider", "bundler"];

type TokenOpts = { token: string };

export class SpotTokenCommand {
  public static register(spot: Command): void {
    const token = spot
      .command("token")
      .description("Token detail: stats, chart, holders, traders, txs, dev");
    const withToken = (cmd: Command) =>
      cmd.requiredOption("--token <token>", "Token symbol or mint address");

    withToken(token.command("info"))
      .description("Price, market stats, audit, organic score and warnings")
      .action((opts) => this.info(opts));

    withToken(token.command("chart"))
      .description("Price or market cap candles")
      .addOption(
        new Option("--interval <tf>", "Candle interval")
          .choices(Object.keys(CHART_INTERVALS))
          .default("1h")
      )
      .option(
        "--candles <n>",
        "Number of candles",
        OptionParsers.positiveInt,
        24
      )
      .addOption(
        new Option("--type <type>", "Chart type")
          .choices(["price", "mcap"])
          .default("price")
      )
      .option(
        "--quote <token>",
        "Quote in usd, sol, or another token (symbol or mint)",
        "usd"
      )
      .option(
        "--before <date>",
        "End of the window (date or UNIX timestamp; default now)",
        OptionParsers.timestamp
      )
      .action((opts) => this.chart(opts));

    withToken(token.command("net-volume"))
      .description("Net buy volume over time")
      .addOption(
        new Option("--interval <tf>", "Window")
          .choices(Object.keys(NET_VOLUME_INTERVALS))
          .default("24h")
      )
      .action((opts) => this.netVolume(opts));

    withToken(token.command("holders"))
      .description("Top holders with PnL")
      .addOption(
        new Option("--tag <tag>", "Filter holders").choices([
          ...HOLDER_TAGS,
          "dev",
          "tracked",
        ])
      )
      .option("--address <addresses>", "Only these wallets (comma-separated)")
      .option("--limit <n>", "Max results", OptionParsers.positiveInt, 20)
      .action((opts) => this.holders(opts));

    withToken(token.command("traders"))
      .description("Top traders by PnL")
      .addOption(
        new Option("--tag <tag>", "Filter traders").choices(HOLDER_TAGS)
      )
      .option("--limit <n>", "Max results", OptionParsers.positiveInt, 20)
      .action((opts) => this.traders(opts));

    withToken(token.command("txs"))
      .description("Recent trades")
      .addOption(
        new Option("--side <side>", "Filter by side").choices(["buy", "sell"])
      )
      .option(
        "--tag <tags>",
        "Filter by trader tags (comma-separated: sniper, insider, bundler)"
      )
      .option(
        "--address <addresses>",
        "Only trades by these wallets (comma-separated)"
      )
      .option("--tracked", "Only trades by wallets in your tracker")
      .option("--dev", "Only trades by the token's dev")
      .option("--min-usd <n>", "Minimum trade size (USD)", OptionParsers.number)
      .option("--max-usd <n>", "Maximum trade size (USD)", OptionParsers.number)
      .option(
        "--after <date>",
        "Trades after this date or UNIX timestamp",
        OptionParsers.timestamp
      )
      .option(
        "--before <date>",
        "Trades before this date or UNIX timestamp",
        OptionParsers.timestamp
      )
      .option("--limit <n>", "Max results", OptionParsers.positiveInt, 20)
      .option("--offset <cursor>", "Pagination cursor from a previous `next`")
      .action((opts) => this.txs(opts));

    withToken(token.command("dev"))
      .description("Tokens created by this token's dev")
      .option("--limit <n>", "Max results", OptionParsers.positiveInt, 20)
      .action((opts) => this.dev(opts));

    withToken(token.command("pools"))
      .description("Liquidity pools for the token")
      .action((opts) => this.pools(opts));

    withToken(token.command("about"))
      .description(
        "Token description and narrative (plus Jupiter Intel AI summary with an API key)"
      )
      .action((opts) => this.about(opts));

    withToken(token.command("news"))
      .description("Jupiter Intel news summary and items (requires an API key)")
      .option("--limit <n>", "Max news items", OptionParsers.positiveInt, 10)
      .action((opts) => this.news(opts));
  }

  private static async info(opts: TokenOpts): Promise<void> {
    const asset = await DatapiClient.resolveAsset(opts.token);
    const warnings = (await DatapiClient.getShieldWarnings([asset.id]))[
      asset.id
    ];
    const audit = asset.audit;
    const info = {
      id: asset.id,
      symbol: asset.symbol,
      name: asset.name,
      decimals: asset.decimals,
      tokenProgram: asset.tokenProgram,
      isVerified: asset.isVerified ?? false,
      tags: asset.tags ?? [],
      priceUsd: asset.usdPrice ?? null,
      mcap: asset.mcap ?? null,
      fdv: asset.fdv ?? null,
      liquidity: asset.liquidity ?? null,
      holderCount: asset.holderCount ?? null,
      circSupply: asset.circSupply ?? null,
      totalSupply: asset.totalSupply ?? null,
      organicScore: asset.organicScore ?? null,
      organicScoreLabel: asset.organicScoreLabel ?? null,
      launchpad: asset.launchpad ?? null,
      bondingCurvePct: asset.bondingCurve ?? null,
      graduatedPool: asset.graduatedPool ?? null,
      graduatedAt: asset.graduatedAt ?? null,
      dev: asset.dev ?? null,
      createdAt: asset.firstPool?.createdAt ?? asset.createdAt ?? null,
      firstPool: asset.firstPool
        ? {
            id: asset.firstPool.id,
            dex: asset.firstPool.dex ?? null,
            createdAt: asset.firstPool.createdAt,
          }
        : null,
      socials: {
        website: asset.website ?? null,
        twitter: asset.twitter ?? null,
        telegram: asset.telegram ?? null,
        discord: asset.discord ?? null,
      },
      stats: Object.fromEntries(
        STATS_INTERVALS.map((tf) => [
          tf,
          TokenView.mapStats(TokenView.stats(asset, tf)),
        ])
      ),
      audit: {
        mintAuthorityDisabled: audit?.mintAuthorityDisabled ?? null,
        freezeAuthorityDisabled: audit?.freezeAuthorityDisabled ?? null,
        topHoldersPct: audit?.topHoldersPercentage ?? null,
        devBalancePct: audit?.devBalancePercentage ?? null,
        devMigrations: audit?.devMigrations ?? null,
        sniperPct: audit?.sniperPct ?? null,
        insiderPct: audit?.insiderPct ?? null,
        bundlerPct: audit?.bundlerStats?.holdingPct ?? null,
        botHoldersPct: audit?.botHoldersPercentage ?? null,
        botHoldersCount: audit?.botHoldersCount ?? null,
        lpBurnedPct: audit?.lpBurnedPercentage ?? null,
        iconReused: audit?.iconReused ?? null,
        impersonating: audit?.impersonationAssetId ?? null,
      },
      warnings: (warnings ?? []).map((w) => ({
        type: w.type,
        severity: w.severity,
        message: w.message,
      })),
    };

    if (Output.isJson()) {
      Output.json(info);
      return;
    }
    const pct = (v: number | null) =>
      v === null ? chalk.gray("—") : `${v.toFixed(2)}%`;
    const bool = (v: boolean | null) =>
      v === null ? chalk.gray("—") : Output.formatBoolean(v);
    Output.table({
      type: "vertical",
      rows: [
        {
          label: "Token",
          value: `${info.name} (${info.symbol})${info.isVerified ? " ✓" : ""}`,
        },
        { label: "Address", value: info.id },
        {
          label: "Price",
          value: Output.formatDollar(info.priceUsd ?? undefined),
        },
        { label: "Market Cap", value: Output.formatCompactDollar(info.mcap) },
        { label: "FDV", value: Output.formatCompactDollar(info.fdv) },
        {
          label: "Liquidity",
          value: Output.formatCompactDollar(info.liquidity),
        },
        {
          label: "Holders",
          value: Output.formatCompactNumber(info.holderCount),
        },
        {
          label: "Organic Score",
          value:
            info.organicScore === null
              ? chalk.gray("—")
              : `${info.organicScore.toFixed(0)} (${info.organicScoreLabel})`,
        },
        { label: "Age", value: TokenView.formatAge(info.createdAt) },
        ...(info.launchpad
          ? [
              {
                label: "Launchpad",
                value: `${info.launchpad}${info.bondingCurvePct !== null && !info.graduatedAt ? ` (bonding ${pct(info.bondingCurvePct)})` : ""}`,
              },
            ]
          : []),
        {
          label: "Mint Authority Disabled",
          value: bool(info.audit.mintAuthorityDisabled),
        },
        {
          label: "Freeze Authority Disabled",
          value: bool(info.audit.freezeAuthorityDisabled),
        },
        { label: "Top 10 Holders", value: pct(info.audit.topHoldersPct) },
        { label: "Dev Holdings", value: pct(info.audit.devBalancePct) },
        { label: "Snipers", value: pct(info.audit.sniperPct) },
        { label: "Insiders", value: pct(info.audit.insiderPct) },
        { label: "Bundlers", value: pct(info.audit.bundlerPct) },
        {
          label: "Warnings",
          value:
            info.warnings.length === 0
              ? chalk.green("None")
              : info.warnings
                  .map((w) =>
                    w.severity === "critical"
                      ? chalk.red(w.message)
                      : chalk.yellow(w.message)
                  )
                  .join("\n"),
        },
      ],
    });
    Output.table({
      type: "horizontal",
      headers: {
        tf: "",
        change: "Price",
        volume: "Volume",
        net: "Net Vol",
        txns: "Txns",
        traders: "Traders",
        organic: "Organic Vol",
      },
      rows: STATS_INTERVALS.map((tf) => {
        const s = info.stats[tf]!;
        return {
          tf,
          change: Output.formatPercentageChange(s.priceChangePct ?? undefined),
          volume: Output.formatCompactDollar(s.volumeUsd),
          net: Output.formatCompactDollar(s.netVolumeUsd),
          txns: Output.formatCompactNumber(s.txns),
          traders: Output.formatCompactNumber(s.traders),
          organic: Output.formatCompactDollar(s.organicVolumeUsd),
        };
      }),
    });
  }

  private static async chart(
    opts: TokenOpts & {
      interval: string;
      candles: number;
      type: string;
      quote: string;
      before?: string;
    }
  ): Promise<void> {
    const asset = await DatapiClient.resolveAsset(opts.token);
    const quote = await this.resolveQuote(opts.quote);
    if (quote.param !== "usd" && quote.param !== "native") {
      if (["1s", "15s", "30s"].includes(opts.interval)) {
        throw new Error("Token-pair charts need an --interval of 1m or more.");
      }
    }
    const { candles } = await DatapiClient.getCandles(asset.id, {
      interval: CHART_INTERVALS[opts.interval]!,
      to: opts.before ? Date.parse(opts.before) : Date.now(),
      candles: opts.candles,
      type: opts.type,
      ...(quote.param !== "usd" && { quote: quote.param }),
    });
    const rows = candles.map((c) => ({
      time: new Date(c.time * 1000).toISOString(),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }));

    if (Output.isJson()) {
      Output.json({
        token: { id: asset.id, symbol: asset.symbol },
        interval: opts.interval,
        type: opts.type,
        quote: quote.label,
        candles: rows,
      });
      return;
    }
    const fmt = (v: number, compact = false) =>
      quote.label === "USD"
        ? compact
          ? Output.formatCompactDollar(v)
          : Output.formatDollar(v)
        : `${v.toLocaleString("en-US", compact ? { notation: "compact", maximumFractionDigits: 2 } : { maximumSignificantDigits: 6 })} ${quote.label}`;
    console.log(
      chalk.bold(
        `${asset.symbol} ${opts.type} (${quote.label}), ${opts.interval} candles`
      )
    );
    Output.table({
      type: "horizontal",
      headers: {
        time: "Time",
        open: "Open",
        high: "High",
        low: "Low",
        close: "Close",
        volume: "Volume",
      },
      rows: rows.map((r) => ({
        time: new Date(r.time).toLocaleString(),
        open: fmt(r.open),
        high: fmt(r.high),
        low: fmt(r.low),
        close: fmt(r.close),
        volume: fmt(r.volume, true),
      })),
    });
  }

  private static async netVolume(
    opts: TokenOpts & { interval: string }
  ): Promise<void> {
    const asset = await DatapiClient.resolveAsset(opts.token);
    const { data } = await DatapiClient.getNetVolume(asset.id, {
      interval: NET_VOLUME_INTERVALS[opts.interval]!,
    });
    const points = data.map((d) => ({
      time: new Date(d.time * 1000).toISOString(),
      netVolumeUsd: d.netVolume,
    }));

    if (Output.isJson()) {
      Output.json({
        token: { id: asset.id, symbol: asset.symbol },
        interval: opts.interval,
        points,
      });
      return;
    }
    Output.table({
      type: "horizontal",
      headers: { time: "Time", net: `${opts.interval} Net Volume` },
      rows: points.map((p) => ({
        time: new Date(p.time).toLocaleString(),
        net: Output.formatDollarChange(p.netVolumeUsd),
      })),
    });
  }

  private static async holders(
    opts: TokenOpts & { tag?: string; address?: string; limit: number }
  ): Promise<void> {
    const asset = await DatapiClient.resolveAsset(opts.token);
    let addresses = opts.address;
    if (opts.tag === "dev") {
      if (!asset.dev) {
        throw new Error(`${asset.symbol} has no known dev wallet.`);
      }
      addresses = asset.dev;
    }
    if (opts.tag === "tracked") {
      addresses = this.trackedAddresses().join(",");
    }
    const res = await DatapiClient.getHolders(asset.id, {
      ...(addresses && { addresses }),
      ...(opts.tag && HOLDER_TAGS.includes(opts.tag) && { tags: opts.tag }),
    });
    const holders = res.holders
      .slice(0, opts.limit)
      .map((h) => this.mapHolder(h, res.holderPnl[h.address], asset));

    if (Output.isJson()) {
      Output.json({
        token: { id: asset.id, symbol: asset.symbol },
        count: res.count ?? null,
        holders,
      });
      return;
    }
    this.printHolders(holders, asset);
    if (res.count) {
      console.log(`\nTotal holders: ${res.count.toLocaleString("en-US")}`);
    }
  }

  private static async traders(
    opts: TokenOpts & { tag?: string; limit: number }
  ): Promise<void> {
    const asset = await DatapiClient.resolveAsset(opts.token);
    const res = await DatapiClient.getTopTraders({
      assetId: asset.id,
      ...(opts.tag && { tags: opts.tag }),
    });
    const traders = res.holders
      .slice(0, opts.limit)
      .map((h) => this.mapHolder(h, res.holderPnl[h.address], asset));

    if (Output.isJson()) {
      Output.json({ token: { id: asset.id, symbol: asset.symbol }, traders });
      return;
    }
    this.printHolders(traders, asset);
  }

  private static async txs(
    opts: TokenOpts & {
      side?: string;
      tag?: string;
      address?: string;
      tracked?: boolean;
      dev?: boolean;
      minUsd?: number;
      maxUsd?: number;
      after?: string;
      before?: string;
      limit: number;
      offset?: string;
    }
  ): Promise<void> {
    const asset = await DatapiClient.resolveAsset(opts.token);
    const traders = [
      ...(opts.address ? OptionParsers.list(opts.address) : []),
      ...(opts.tracked ? this.trackedAddresses() : []),
    ];
    if (opts.dev) {
      if (!asset.dev) {
        throw new Error(`${asset.symbol} has no known dev wallet.`);
      }
      traders.push(asset.dev);
    }
    const tags = opts.tag ? OptionParsers.list(opts.tag) : [];
    const badTag = tags.find((t) => !HOLDER_TAGS.includes(t));
    if (badTag) {
      throw new Error(
        `Invalid --tag: ${badTag}. Must be ${HOLDER_TAGS.join(", ")}.`
      );
    }
    const res = await DatapiClient.getTokenTxs(asset.id, {
      limit: opts.limit,
      ...(opts.offset && { offset: opts.offset }),
      ...(opts.side && { types: opts.side }),
      ...(tags.length > 0 && { tags: tags.join(",") }),
      ...(traders.length > 0 && { traderAddress: traders.join(",") }),
      ...(opts.minUsd !== undefined && { minUsdVolume: opts.minUsd }),
      ...(opts.maxUsd !== undefined && { maxUsdVolume: opts.maxUsd }),
      ...(opts.after && { fromTs: opts.after }),
      ...(opts.before && { toTs: opts.before }),
    });
    const txs = res.txs.map((t) => ({
      time: t.timestamp,
      side: t.type,
      amount: t.amount,
      priceUsd: t.usdPrice,
      valueUsd: t.usdVolume,
      solAmount: t.nativeVolume,
      trader: t.traderAddress,
      traderTags: t.holderTags ?? [],
      isMev: t.isMev,
      poolId: t.poolId,
      signature: t.txHash,
    }));

    if (Output.isJson()) {
      Output.json({
        token: { id: asset.id, symbol: asset.symbol },
        txs,
        next: res.next ?? null,
      });
      return;
    }
    Output.table({
      type: "horizontal",
      headers: {
        time: "Time",
        side: "Side",
        value: "Value",
        amount: asset.symbol,
        price: "Price",
        trader: "Trader",
        signature: "Tx Signature",
      },
      rows: txs.map((t) => ({
        time: new Date(t.time).toLocaleString(),
        side: t.side === "buy" ? chalk.green(t.side) : chalk.red(t.side),
        value: Output.formatDollar(t.valueUsd, { decimals: 2 }),
        amount: Output.formatCompactNumber(t.amount),
        price: Output.formatDollar(t.priceUsd),
        trader: t.traderTags.length
          ? `${t.trader}\n${chalk.gray(t.traderTags.join(", "))}`
          : t.trader,
        signature: t.signature,
      })),
    });
    if (res.next) {
      console.log("\nNext offset:", res.next);
    }
  }

  private static async dev(opts: TokenOpts & { limit: number }): Promise<void> {
    const asset = await DatapiClient.resolveAsset(opts.token);
    if (!asset.dev) {
      throw new Error(`${asset.symbol} has no known dev wallet.`);
    }
    const stats = await DatapiClient.getDevStats(asset.dev, {
      limit: opts.limit,
    });
    const result = {
      dev: asset.dev,
      solBalance: stats.solBalance,
      numCreated: stats.numCreated,
      numCreatedInPast7Days: stats.numCreatedInPast7Days,
      numMigrated: stats.numMigrated,
      lastTokenLaunchedAt: stats.lastTokenLaunchedDate ?? null,
      tokens: stats.topTokens.map((t) => TokenView.toRow(t, "24h")),
    };

    if (Output.isJson()) {
      Output.json(result);
      return;
    }
    Output.table({
      type: "vertical",
      rows: [
        { label: "Dev", value: result.dev },
        { label: "SOL Balance", value: `${result.solBalance} SOL` },
        {
          label: "Tokens Created",
          value: `${result.numCreated} (${result.numCreatedInPast7Days} in 7d)`,
        },
        { label: "Migrated", value: String(result.numMigrated) },
      ],
    });
    TokenView.printTable(result.tokens, "24h");
  }

  private static async pools(opts: TokenOpts): Promise<void> {
    const asset = await DatapiClient.resolveAsset(opts.token);
    const { pools } = await DatapiClient.getPools(asset.id);
    const quoteMints = [...new Set(pools.map((p) => p.quoteAsset))];
    const quotes = new Map(
      (await DatapiClient.getAssets(quoteMints)).map((a) => [a.id, a.symbol])
    );
    const rows = pools.map((p) => ({
      id: p.id,
      dex: p.dex,
      type: p.type,
      quoteToken: {
        id: p.quoteAsset,
        symbol: quotes.get(p.quoteAsset) ?? null,
      },
      liquidity: p.liquidity ?? null,
      volume24hUsd: p.volume24h ?? null,
      createdAt: p.createdAt,
    }));

    if (Output.isJson()) {
      Output.json({
        token: { id: asset.id, symbol: asset.symbol },
        pools: rows,
      });
      return;
    }
    Output.table({
      type: "horizontal",
      headers: {
        pair: "Pair",
        dex: "DEX",
        liquidity: "Liquidity",
        volume: "24h Vol",
        age: "Age",
        id: "Pool",
      },
      rows: rows.map((p) => ({
        pair: `${asset.symbol}/${p.quoteToken.symbol ?? "?"}`,
        dex: p.dex,
        liquidity: Output.formatCompactDollar(p.liquidity),
        volume: Output.formatCompactDollar(p.volume24hUsd),
        age: TokenView.formatAge(p.createdAt),
        id: p.id,
      })),
    });
  }

  private static async about(opts: TokenOpts): Promise<void> {
    const asset = await DatapiClient.resolveAsset(opts.token);
    const [description, narrative, intel] = await Promise.all([
      DatapiClient.getDescription(asset.id),
      DatapiClient.getNarrative(asset.id),
      IntelClient.hasApiKey()
        ? IntelClient.getDescription(asset.id)
        : Promise.resolve(null),
    ]);
    const result = {
      token: { id: asset.id, symbol: asset.symbol },
      description: description.description || null,
      narrative:
        narrative.status === "success" ? (narrative.narrative ?? null) : null,
      ai:
        intel === null
          ? null
          : intel.status === "found"
            ? {
                status: intel.status,
                description: intel.description,
                citations: intel.citations,
                updatedAt: intel.updatedAt,
              }
            : intel.status === "copycat"
              ? { status: intel.status, original: intel.verifiedOriginal }
              : { status: intel.status },
    };

    if (Output.isJson()) {
      Output.json(result);
      return;
    }
    const sections: [string, string | null][] = [
      [
        "AI Summary",
        result.ai?.status === "found" && "description" in result.ai
          ? result.ai.description
          : result.ai?.status === "copycat" && "original" in result.ai
            ? chalk.red(
                `Possible copycat of ${result.ai.original.symbol} (${result.ai.original.mint})`
              )
            : null,
      ],
      ["Description", result.description],
      ["Narrative", result.narrative],
    ];
    for (const [title, text] of sections) {
      if (text) {
        console.log(`${chalk.bold(title)}\n${text}\n`);
      }
    }
    if (result.ai === null) {
      console.log(
        chalk.gray(
          "Set an API key with `jup config set --api-key <key>` to include Jupiter Intel's AI summary."
        )
      );
    }
  }

  private static async news(
    opts: TokenOpts & { limit: number }
  ): Promise<void> {
    IntelClient.assertApiKey();
    const asset = await DatapiClient.resolveAsset(opts.token);
    const [summary, items] = await Promise.all([
      IntelClient.getNewsSummary(asset.id),
      IntelClient.getNewsItems(asset.id, Math.min(opts.limit, 100)),
    ]);
    const result = {
      token: { id: asset.id, symbol: asset.symbol },
      status: summary.status,
      summary: summary.status === "found" ? summary.summary : null,
      items: items.map((i) =>
        i.type === "tweet"
          ? {
              type: i.type,
              source: i.author,
              title: null,
              text: i.text,
              url: i.url,
              publishedAt: i.publishedAt,
            }
          : {
              type: i.type,
              source: i.publisher,
              title: i.title,
              text: i.excerpt,
              url: i.url,
              publishedAt: i.publishedAt,
            }
      ),
    };

    if (Output.isJson()) {
      Output.json(result);
      return;
    }
    if (result.summary) {
      console.log(`${chalk.bold("Summary")}\n${result.summary}\n`);
    } else if (result.status === "pending") {
      console.log(
        chalk.gray("News summary is being generated. Try again shortly.\n")
      );
    }
    Output.table({
      type: "horizontal",
      headers: {
        time: "Published",
        source: "Source",
        text: "News",
        url: "Link",
      },
      maxWidths: { text: 70 },
      rows: result.items.map((i) => ({
        time: new Date(i.publishedAt).toLocaleString(),
        source: i.type === "tweet" ? `@${i.source}` : i.source,
        text: i.title ?? i.text,
        url: i.url,
      })),
    });
  }

  private static async resolveQuote(
    quote: string
  ): Promise<{ param: string; label: string }> {
    const q = quote.toLowerCase();
    if (q === "usd") {
      return { param: "usd", label: "USD" };
    }
    if (q === "sol" || quote === Asset.SOL.id) {
      return { param: "native", label: "SOL" };
    }
    const asset = await DatapiClient.resolveAsset(quote);
    return { param: asset.id, label: asset.symbol };
  }

  private static trackedAddresses(): string[] {
    const addresses = WalletTracker.load().following.map((w) => w.address);
    if (addresses.length === 0) {
      throw new Error(
        "No tracked wallets. Follow one with `jup spot tracker add --address <address>`."
      );
    }
    return addresses;
  }

  private static mapHolder(
    h: Holder,
    pnl: HolderPnl | undefined,
    asset: DatapiAsset
  ) {
    return {
      address: h.address,
      amount: h.amount,
      valueUsd: asset.usdPrice !== undefined ? h.amount * asset.usdPrice : null,
      supplyPct: asset.totalSupply
        ? (h.amount / asset.totalSupply) * 100
        : null,
      solBalance: h.solBalanceDisplay,
      tags: [...(h.tags ?? []).map((t) => t.name), ...(h.holderTags ?? [])],
      boughtUsd: pnl?.boughtValue ?? null,
      soldUsd: pnl?.soldValue ?? null,
      realizedPnlUsd: pnl?.realizedPnl ?? null,
      unrealizedPnlUsd: pnl?.unrealizedPnl ?? null,
      pnlUsd: pnl?.totalPnl ?? null,
      pnlPct: pnl?.totalPnlPercentage ?? null,
      buys: pnl?.totalBuys ?? null,
      sells: pnl?.totalSells ?? null,
      fundedBy: h.addressInfo?.fundingAddress ?? null,
      lastActiveAt: h.lastActiveTime ?? null,
    };
  }

  private static printHolders(
    rows: ReturnType<typeof SpotTokenCommand.mapHolder>[],
    asset: DatapiAsset
  ): void {
    Output.table({
      type: "horizontal",
      headers: {
        address: "Wallet",
        amount: asset.symbol,
        supply: "% Supply",
        bought: "Bought",
        sold: "Sold",
        pnl: "PnL",
      },
      rows: rows.map((r) => ({
        address: r.tags.length
          ? `${r.address}\n${chalk.gray(r.tags.join(", "))}`
          : r.address,
        amount: `${Output.formatCompactNumber(r.amount)} (${Output.formatCompactDollar(r.valueUsd)})`,
        supply:
          r.supplyPct === null ? chalk.gray("—") : `${r.supplyPct.toFixed(2)}%`,
        bought: Output.formatCompactDollar(r.boughtUsd),
        sold: Output.formatCompactDollar(r.soldUsd),
        pnl:
          r.pnlUsd === null
            ? chalk.gray("—")
            : `${Output.formatDollarChange(r.pnlUsd)} (${Output.formatPercentageChange(r.pnlPct ?? undefined)})`,
      })),
    });
  }
}
