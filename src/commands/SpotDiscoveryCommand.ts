import chalk from "chalk";
import { Option, type Command } from "commander";

import { ContentClient } from "../clients/ContentClient.ts";
import {
  DatapiClient,
  type DatapiAsset,
  type GemsTab,
  type LaunchpadPeriodStats,
  type SmartMoneyTrader,
  type TopMover,
} from "../clients/DatapiClient.ts";
import { OptionParsers } from "../lib/OptionParsers.ts";
import { Output } from "../lib/Output.ts";
import { TokenFilters } from "../lib/TokenFilters.ts";
import { TokenView, type ScreenerRow } from "../lib/TokenView.ts";

const LISTS: Record<string, { category: string; sortBy?: string }> = {
  trending: { category: "toptrending", sortBy: "netVolume" },
  popular: { category: "popular" },
  toptraded: { category: "toptraded", sortBy: "volume" },
  organic: { category: "toporganicscore", sortBy: "numOrganicBuyers" },
  recent: { category: "recent" },
  stocks: { category: "stocks", sortBy: "volume" },
  stablecoins: { category: "stables", sortBy: "volume" },
  runners: { category: "runners", sortBy: "mcap" },
  meme: { category: "meme", sortBy: "volume" },
  defi: { category: "defi", sortBy: "volume" },
  yield: { category: "yield", sortBy: "volume" },
  rwa: { category: "rwa", sortBy: "volume" },
};

const LIST_INTERVALS = ["5m", "1h", "6h", "24h"];
const STABLECOIN_INTERVALS = [...LIST_INTERVALS, "7d", "30d"];

const LIST_SORT_FIELDS = [
  "usdPrice",
  "vwap",
  "liquidity",
  "mcap",
  "fdv",
  "listedTime",
  "holderCount",
  "organicScore",
  "bondingCurve",
  "graduatedAt",
  "stockData.price",
  "stockData.mcap",
  "stockData.priceChange24h",
  "priceDelta",
  "feesPaid",
  "symbol",
  "priceChange",
  "txs",
  "netTxs",
  "traders",
  "numNetBuyers",
  "volume",
  "netVolume",
  "holderChange",
  "numOrganicBuyers",
  "organicVolume",
  "netOrganicVolume",
  "apy",
] as const;

const ALPHASCAN_TABS: Record<string, GemsTab> = {
  new: "recent",
  graduating: "aboutToGraduate",
  graduated: "graduated",
};

const SMART_MONEY_CATEGORIES: Record<string, string> = {
  smart: "smartMoney",
  smartMoney: "smartMoney",
  whales: "whale",
  whale: "whale",
  influencers: "influencer",
  influencer: "influencer",
  "top-pnl": "topPnl",
  topPnl: "topPnl",
};

const LAUNCHPAD_SORT_FIELDS = [
  "marketShare",
  "volume",
  "traders",
  "runners",
  "mints",
  "graduates",
  "bondedRate",
] as const;

const STOCK_SORT_FIELDS = ["mcap", "price", "priceChange24h", "volume"];

type ListOpts = {
  list: string;
  interval?: string;
  sort?: string;
  sortDir?: string;
  limit?: string;
  offset?: number;
} & Record<string, unknown>;

export class SpotDiscoveryCommand {
  public static addListOptions(cmd: Command): Command {
    cmd
      .addOption(
        new Option("--list <name>", "Token list to show").choices(
          Object.keys(LISTS)
        )
      )
      .option(
        "--interval <tf>",
        "Stats interval for --list: 5m, 1h, 6h, 24h (stablecoins also 7d, 30d)"
      )
      .addOption(
        new Option(
          "--sort <field>",
          "Sort field for --list (defaults to the jup.ag sort for that list)"
        ).choices(LIST_SORT_FIELDS)
      )
      .addOption(
        new Option("--sort-dir <dir>", "Sort direction for --list")
          .choices(["asc", "desc"])
          .default("desc")
      )
      .option(
        "--offset <n>",
        "Pagination offset for --list",
        OptionParsers.nonNegativeInt
      );
    return TokenFilters.addOptions(cmd);
  }

  public static register(spot: Command): void {
    spot
      .command("pulse")
      .description("Market Pulse: the latest AI market brief from jup.ag/spot")
      .action(() => this.pulse());
    spot
      .command("heatmap")
      .description("Market dominance heatmap by sector")
      .addOption(
        new Option("--category <name>", "Show a single sector").choices([
          "meme",
          "defi",
          "yield",
          "rwa",
        ])
      )
      .addOption(
        new Option("--sort <field>", "Rank assets by")
          .choices(["mcap", "volume"])
          .default("mcap")
      )
      .option("--limit <n>", "Assets per sector", OptionParsers.positiveInt, 20)
      .action((opts) => this.heatmap(opts));

    const alphascan = spot
      .command("alphascan")
      .description("AlphaScan screener: new, graduating and graduated tokens")
      .addOption(
        new Option("--tab <tab>", "Only show one column").choices(
          Object.keys(ALPHASCAN_TABS)
        )
      )
      .addOption(
        new Option("--interval <tf>", "Stats interval for volume filters")
          .choices(LIST_INTERVALS)
          .default("24h")
      )
      .option(
        "--limit <n>",
        "Max tokens per column (max 30)",
        OptionParsers.positiveInt,
        10
      );
    TokenFilters.addOptions(alphascan).action((opts) => this.alphascan(opts));

    spot
      .command("categories")
      .description("Sector overview: market cap, volume and top movers")
      .addOption(
        new Option("--category <name>", "Show a single sector").choices([
          "meme",
          "defi",
          "yield",
          "rwa",
        ])
      )
      .action((opts) => this.categories(opts));

    spot
      .command("launchpads")
      .description("Launchpad leaderboard")
      .addOption(
        new Option("--interval <tf>", "Stats window")
          .choices(["1d", "7d", "30d"])
          .default("1d")
      )
      .addOption(
        new Option("--sort <field>", "Sort field")
          .choices(LAUNCHPAD_SORT_FIELDS)
          .default("marketShare")
      )
      .option("--launchpad <id>", "Show a single launchpad (e.g. pump.fun)")
      .option("--limit <n>", "Max results", OptionParsers.positiveInt, 20)
      .action((opts) => this.launchpads(opts));

    const smartMoney = spot
      .command("smart-money")
      .description("Smart Money wallets and their trades");
    smartMoney
      .command("wallets")
      .description("Top wallet rankings")
      .addOption(
        new Option("--category <name>", "Wallet category")
          .choices(["smart", "whales", "influencers", "top-pnl"])
          .default("influencers")
      )
      .addOption(
        new Option("--interval <tf>", "PnL window")
          .choices(["1d", "7d", "30d"])
          .default("1d")
      )
      .option("--limit <n>", "Max results", OptionParsers.positiveInt, 20)
      .action((opts) => this.smartMoneyWallets(opts));
    smartMoney
      .command("trades")
      .description("Latest Smart Money trades, grouped by token")
      .option("--limit <n>", "Max results", OptionParsers.positiveInt, 5)
      .action((opts) => this.smartMoneyTrades(opts));
    smartMoney
      .command("summary")
      .description("Tokens Smart Money is buying or selling most")
      .addOption(
        new Option("--side <side>", "Trade side")
          .choices(["buy", "sell"])
          .default("buy")
      )
      .option("--limit <n>", "Max results", OptionParsers.positiveInt, 20)
      .action((opts) => this.smartMoneySummary(opts));

    spot
      .command("stocks")
      .description("Stocks catalog with tokenized variants")
      .addOption(
        new Option("--sort <field>", "Sort field")
          .choices(STOCK_SORT_FIELDS)
          .default("mcap")
      )
      .addOption(
        new Option("--sort-dir <dir>", "Sort direction")
          .choices(["asc", "desc"])
          .default("desc")
      )
      .option(
        "--type <types>",
        "Comma-separated types: CS, ETF, ADRC, ETN, ETV, PFD"
      )
      .option("--sector <sectors>", "Comma-separated sectors")
      .option("--symbol <symbols>", "Comma-separated tickers (e.g. NVDA,AAPL)")
      .option("--limit <n>", "Max results", OptionParsers.positiveInt, 20)
      .option("--offset <n>", "Pagination offset", OptionParsers.nonNegativeInt)
      .action((opts) => this.stocks(opts));
  }

  public static async list(opts: ListOpts): Promise<void> {
    const list = LISTS[opts.list]!;
    const limit = Number(opts.limit ?? 20);
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error("--limit must be a positive integer.");
    }
    const isStables = opts.list === "stablecoins";
    const interval = opts.interval ?? (isStables ? "30d" : "24h");
    const allowed = isStables ? STABLECOIN_INTERVALS : LIST_INTERVALS;
    if (!allowed.includes(interval)) {
      throw new Error(
        `Invalid --interval for ${opts.list}. Must be one of: ${allowed.join(", ")}.`
      );
    }
    const filters = TokenFilters.resolve(
      TokenFilters.fromOptions(opts),
      interval
    );

    const offset = opts.offset ?? 0;
    let assets: DatapiAsset[];
    let total: number | null = null;
    let next: number | null = null;
    if (list.category === "recent") {
      if (opts.sort || opts.offset) {
        throw new Error("--sort and --offset are not supported for recent.");
      }
      const res = await DatapiClient.getGems({
        recent: { timeframe: interval, limit, ...filters },
      });
      assets = (res.recent?.assets ?? []).slice(0, limit);
    } else {
      const sortBy = opts.sort ?? list.sortBy;
      const res = await DatapiClient.getTokenList(list.category, interval, {
        limit,
        offset,
        ...(sortBy && { sortBy, sortDir: opts.sortDir ?? "desc" }),
        ...TokenFilters.toSearchParams(filters),
      });
      assets = res.assets;
      total = res.total ?? null;
      next = res.next ?? null;
    }

    const tokens = assets.map((a, i) => ({
      rank: offset + i + 1,
      ...TokenView.toRow(a, interval),
    }));

    if (Output.isJson()) {
      Output.json({ list: opts.list, interval, total, next, tokens });
      return;
    }
    TokenView.printTable(tokens, interval);
    if (next !== null) {
      console.log("\nNext offset:", next);
    }
  }

  private static async pulse(): Promise<void> {
    const brief = await ContentClient.getLatestBrief();
    if (!brief) {
      throw new Error("No market brief available.");
    }
    const spotlightMints =
      brief.sectors
        .find((s) => s.category === "spotlight")
        ?.tokens.map((t) => t.mint) ?? [];
    const assets = await DatapiClient.getAssets(spotlightMints);
    const byId = new Map(assets.map((a) => [a.id, a]));
    const spotlight = spotlightMints
      .map((m) => byId.get(m))
      .filter((a): a is DatapiAsset => a !== undefined)
      .map((a) => TokenView.toRow(a, "24h"));

    const result = {
      generatedAt: brief.generatedAt,
      summary: brief.overview.macro.summaryShort,
      details: brief.overview.macro.summaryFull,
      sources: brief.overview.macro.sources ?? [],
      sectors: brief.sectors.map((s) => ({
        category: s.category,
        summary: s.summaryShort,
        details: s.summaryFull,
        tokens: s.tokens.map((t) => ({ id: t.mint, symbol: t.symbol })),
      })),
      spotlight,
    };

    if (Output.isJson()) {
      Output.json(result);
      return;
    }
    console.log(
      `${chalk.bold("Market Pulse")} ${chalk.gray(new Date(result.generatedAt).toLocaleString())}`
    );
    console.log(`\n${result.summary}\n`);
    if (spotlight.length > 0) {
      console.log(chalk.bold("Spotlight"));
      TokenView.printTable(spotlight, "24h");
    }
    Output.table({
      type: "horizontal",
      headers: { category: "Sector", summary: "Summary", tokens: "Tokens" },
      maxWidths: { summary: 70, tokens: 40 },
      rows: result.sectors
        .filter((s) => s.category !== "spotlight")
        .map((s) => ({
          category: s.category,
          summary: s.summary,
          tokens: s.tokens.map((t) => t.symbol).join(", "),
        })),
    });
  }

  private static async heatmap(opts: {
    category?: string;
    sort: string;
    limit: number;
  }): Promise<void> {
    const res = await DatapiClient.getHeatmap({
      ...(opts.category ? { category: opts.category } : { isCombined: true }),
      sort: opts.sort === "volume" ? "volume24h" : "mcap",
      limit: opts.limit,
    });
    const categories = res.categories.map((c) => ({
      category: c.category,
      description: c.description,
      mcap: c.mcap,
      dominancePct: c.dominancePct,
      mcapChangePct: c.mcapChange24h ?? null,
      topMovers: c.topMovers.map((m) => this.mapMover(m)),
      assets: c.assets.map((a) => ({
        id: a.id,
        symbol: a.symbol,
        volumeUsd: a.volume,
        priceChangePct: a.priceChange24h ?? null,
      })),
    }));

    if (Output.isJson()) {
      Output.json({ timestamp: res.timestamp, categories });
      return;
    }
    Output.table({
      type: "horizontal",
      headers: {
        category: "Sector",
        mcap: "Mcap",
        dominance: "Dominance",
        change: "24h",
        movers: "Top Movers",
      },
      rows: categories.map((c) => ({
        category: c.category,
        mcap: Output.formatCompactDollar(c.mcap),
        dominance: `${c.dominancePct.toFixed(2)}%`,
        change: Output.formatPercentageChange(c.mcapChangePct ?? undefined),
        movers: this.formatMovers(c.topMovers),
      })),
    });
    if (opts.category && categories[0]) {
      Output.table({
        type: "horizontal",
        headers: {
          symbol: "Token",
          volume: "24h Vol",
          change: "24h",
          id: "Address",
        },
        rows: categories[0].assets.map((a) => ({
          symbol: a.symbol,
          volume: Output.formatCompactDollar(a.volumeUsd),
          change: Output.formatPercentageChange(a.priceChangePct ?? undefined),
          id: a.id,
        })),
      });
    }
  }

  private static async alphascan(
    opts: {
      tab?: string;
      interval: string;
      limit: number;
    } & Record<string, unknown>
  ): Promise<void> {
    if (opts.limit > 30) {
      throw new Error("--limit must be at most 30.");
    }
    const filters = TokenFilters.resolve(
      TokenFilters.fromOptions(opts),
      opts.interval
    );
    const tabs = opts.tab ? [opts.tab] : Object.keys(ALPHASCAN_TABS);
    const res = await DatapiClient.getGems(
      Object.fromEntries(
        tabs.map((tab) => [
          ALPHASCAN_TABS[tab]!,
          { timeframe: opts.interval, limit: opts.limit, ...filters },
        ])
      )
    );
    const columns = Object.fromEntries(
      tabs.map((tab) => [
        tab,
        (res[ALPHASCAN_TABS[tab]!]?.assets ?? [])
          .slice(0, opts.limit)
          .map((a) => TokenView.toScreenerRow(a, opts.interval)),
      ])
    );

    if (Output.isJson()) {
      Output.json({ interval: opts.interval, ...columns });
      return;
    }
    for (const tab of tabs) {
      console.log(chalk.bold(tab[0]!.toUpperCase() + tab.slice(1)));
      this.printScreener(columns[tab]!, tab, opts.interval);
      console.log();
    }
  }

  private static printScreener(
    rows: ScreenerRow[],
    tab: string,
    interval: string
  ): void {
    Output.table({
      type: "horizontal",
      headers: {
        symbol: "Token",
        age: "Age",
        mcap: "Mcap",
        volume: `${interval} Vol`,
        holders: "Holders",
        progress: tab === "graduated" ? "Graduated" : "Bonding",
        top10: "Top 10",
        dev: "Dev",
        snipers: "Snipers",
        launchpad: "Launchpad",
        id: "Address",
      },
      rows: rows.map((r) => ({
        symbol: r.symbol,
        age: TokenView.formatAge(r.createdAt),
        mcap: Output.formatCompactDollar(r.mcap),
        volume: Output.formatCompactDollar(r.volumeUsd),
        holders: Output.formatCompactNumber(r.holderCount),
        progress:
          tab === "graduated"
            ? `${TokenView.formatAge(r.graduatedAt)} ago`
            : this.formatPct(r.bondingCurvePct),
        top10: this.formatPct(r.topHoldersPct),
        dev: this.formatPct(r.devBalancePct),
        snipers: this.formatPct(r.sniperPct),
        launchpad: r.launchpad ?? "",
        id: r.id,
      })),
    });
  }

  private static async categories(opts: { category?: string }): Promise<void> {
    const res = await DatapiClient.getCategoryStats(
      opts.category ? { category: opts.category } : {}
    );
    const categories = res.categories.map((c) => ({
      category: c.category,
      description: c.description,
      mcap: c.mcap,
      mcapChange1hPct: c.mcapChange1h ?? null,
      mcapChange24hPct: c.mcapChange24h ?? null,
      mcapChange7dPct: c.mcapChange7d ?? null,
      volume24hUsd: c.volume24h ?? null,
      netVolume24hUsd: c.netVolume24h ?? null,
      topMovers: c.topMovers.map((m) => this.mapMover(m)),
    }));

    if (Output.isJson()) {
      Output.json({ categories });
      return;
    }
    Output.table({
      type: "horizontal",
      headers: {
        category: "Sector",
        mcap: "Mcap",
        change1h: "1h",
        change24h: "24h",
        change7d: "7d",
        volume: "24h Vol",
        netVolume: "24h Net Vol",
        movers: "Top Movers",
      },
      rows: categories.map((c) => ({
        category: c.category,
        mcap: Output.formatCompactDollar(c.mcap),
        change1h: Output.formatPercentageChange(c.mcapChange1hPct ?? undefined),
        change24h: Output.formatPercentageChange(
          c.mcapChange24hPct ?? undefined
        ),
        change7d: Output.formatPercentageChange(c.mcapChange7dPct ?? undefined),
        volume: Output.formatCompactDollar(c.volume24hUsd),
        netVolume: Output.formatCompactDollar(c.netVolume24hUsd),
        movers: this.formatMovers(c.topMovers),
      })),
    });
    console.log(
      chalk.gray(
        "\nTokens in a sector: jup spot tokens --list <meme|defi|yield|rwa>"
      )
    );
  }

  private static async launchpads(opts: {
    interval: "1d" | "7d" | "30d";
    sort: (typeof LAUNCHPAD_SORT_FIELDS)[number];
    launchpad?: string;
    limit: number;
  }): Promise<void> {
    const { launchpads } = await DatapiClient.getLaunchpadStats();
    const rows = launchpads.map((l) => {
      const s: LaunchpadPeriodStats = l[`stats${opts.interval}`];
      return {
        launchpad: l.launchpad,
        marketSharePct: s.marketShare,
        volumeUsd: s.volume,
        traders: s.traders,
        runners: s.runners,
        mints: s.mints,
        graduates: s.graduates,
        bondedRatePct: s.mints > 0 ? (s.graduates / s.mints) * 100 : null,
        newMarketSharePct: s.newMarketShare,
        newVolumeUsd: s.newVolume,
        newTraders: s.newTraders,
      };
    });
    const sortKey = {
      marketShare: "marketSharePct",
      volume: "volumeUsd",
      traders: "traders",
      runners: "runners",
      mints: "mints",
      graduates: "graduates",
      bondedRate: "bondedRatePct",
    }[opts.sort] as keyof (typeof rows)[number];
    const ranked = rows
      .sort((a, b) => Number(b[sortKey] ?? 0) - Number(a[sortKey] ?? 0))
      .map((r, i) => ({ rank: i + 1, ...r }))
      .filter(
        (r) =>
          !opts.launchpad ||
          r.launchpad.toLowerCase() === opts.launchpad.toLowerCase()
      )
      .slice(0, opts.limit);
    if (opts.launchpad && ranked.length === 0) {
      throw new Error(`Launchpad not found: ${opts.launchpad}`);
    }

    if (Output.isJson()) {
      Output.json({ interval: opts.interval, launchpads: ranked });
      return;
    }
    Output.table({
      type: "horizontal",
      headers: {
        rank: "#",
        launchpad: "Launchpad",
        share: "Market Share",
        volume: "Volume",
        traders: "Traders",
        mints: "Mints",
        graduates: "Graduates",
        bonded: "Bonded Rate",
        runners: "Runners",
      },
      rows: ranked.map((r) => ({
        rank: r.rank,
        launchpad: r.launchpad,
        share: this.formatPct(r.marketSharePct),
        volume: Output.formatCompactDollar(r.volumeUsd),
        traders: Output.formatCompactNumber(r.traders),
        mints: Output.formatCompactNumber(r.mints),
        graduates: Output.formatCompactNumber(r.graduates),
        bonded: this.formatPct(r.bondedRatePct),
        runners: r.runners,
      })),
    });
  }

  private static async smartMoneyWallets(opts: {
    category: string;
    interval: string;
    limit: number;
  }): Promise<void> {
    const { wallets } = await DatapiClient.getSmartMoneyTop({
      category: SMART_MONEY_CATEGORIES[opts.category]!,
      window: opts.interval,
      limit: opts.limit,
    });
    const rows = wallets.map((w) => ({
      rank: w.rank,
      address: w.walletId,
      twitter: w.twitterUsername ?? null,
      pnlUsd: w.pnlUsd,
      winRatePct: w.winRate * 100,
      volumeUsd: w.volumeUsd,
      txns: w.txnCount,
      lastActiveAt: w.lastActiveAt,
    }));

    if (Output.isJson()) {
      Output.json({
        category: opts.category,
        interval: opts.interval,
        wallets: rows,
      });
      return;
    }
    Output.table({
      type: "horizontal",
      headers: {
        rank: "#",
        wallet: "Wallet",
        pnl: `${opts.interval} PnL`,
        winRate: "Win Rate",
        volume: `${opts.interval} Volume`,
        txns: "Txns",
        active: "Active",
      },
      rows: rows.map((r) => ({
        rank: r.rank,
        wallet: r.twitter ? `@${r.twitter}\n${r.address}` : r.address,
        pnl: Output.formatDollarChange(r.pnlUsd),
        winRate: this.formatPct(r.winRatePct),
        volume: Output.formatCompactDollar(r.volumeUsd),
        txns: r.txns,
        active: `${TokenView.formatAge(r.lastActiveAt)} ago`,
      })),
    });
    console.log(
      chalk.gray("\nFollow a wallet: jup spot tracker add --address <address>")
    );
  }

  private static async smartMoneyTrades(opts: {
    limit: number;
  }): Promise<void> {
    const { cards } = await DatapiClient.getSmartMoneyCards({
      limit: opts.limit,
    });
    const symbols = await this.symbolsFor(cards.map((c) => c.assetId));
    const trades = cards.map((c) => ({
      token: { id: c.assetId, symbol: symbols.get(c.assetId) ?? null },
      side: c.latestType,
      majoritySide: c.majorityType,
      latestAt: c.latestAt,
      traders: c.distinctTraders,
      volumeUsd: c.volumeUsd,
      soldPct: c.pctSold,
      wallets: c.traders.map((t) => this.mapTrader(t)),
    }));

    if (Output.isJson()) {
      Output.json({ trades });
      return;
    }
    Output.table({
      type: "horizontal",
      headers: {
        time: "Time",
        token: "Token",
        side: "Side",
        traders: "Traders",
        volume: "Volume",
        id: "Address",
      },
      rows: trades.map((t) => ({
        time: new Date(t.latestAt).toLocaleString(),
        token: t.token.symbol ?? "?",
        side: this.formatSide(t.side),
        traders: t.traders,
        volume: Output.formatDollar(t.volumeUsd, { decimals: 2 }),
        id: t.token.id,
      })),
    });
  }

  private static async smartMoneySummary(opts: {
    side: "buy" | "sell";
    limit: number;
  }): Promise<void> {
    const { cards } = await DatapiClient.getSmartMoneySummary({
      direction: opts.side,
      limit: opts.limit,
    });
    const symbols = await this.symbolsFor(
      cards.filter((c) => !c.symbol).map((c) => c.assetId)
    );
    const tokens = cards.map((c) => ({
      id: c.assetId,
      symbol: c.symbol ?? symbols.get(c.assetId) ?? null,
      traders: c.traderCount,
      volumeUsd: c.volumeUsd,
      latestAt: c.latestAt,
      wallets: c.traders.map((t) => this.mapTrader(t)),
    }));

    if (Output.isJson()) {
      Output.json({ side: opts.side, tokens });
      return;
    }
    Output.table({
      type: "horizontal",
      headers: {
        symbol: "Token",
        traders: "Traders",
        volume: "Volume",
        latest: "Latest",
        id: "Address",
      },
      rows: tokens.map((t) => ({
        symbol: t.symbol ?? "?",
        traders: t.traders,
        volume: Output.formatCompactDollar(t.volumeUsd),
        latest: `${TokenView.formatAge(t.latestAt)} ago`,
        id: t.id,
      })),
    });
  }

  private static async stocks(opts: {
    sort: string;
    sortDir: string;
    type?: string;
    sector?: string;
    symbol?: string;
    limit: number;
    offset?: number;
  }): Promise<void> {
    const res = await DatapiClient.getStocks({
      sortBy: opts.sort,
      sortDir: opts.sortDir,
      limit: opts.limit,
      ...(opts.offset && { offset: opts.offset }),
      ...(opts.type && { types: opts.type.toUpperCase() }),
      ...(opts.sector && { sector: opts.sector }),
      ...(opts.symbol && { symbols: opts.symbol.toUpperCase() }),
    });
    const stocks = res.rwas.map((s) => ({
      symbol: s.symbol,
      name: s.name,
      type: s.type,
      sector: s.sector ?? null,
      exchange: s.exchange ?? null,
      priceUsd: s.price ?? null,
      priceChangePct: s.priceChange24h ?? null,
      mcap: s.mcap ?? null,
      volumeUsd: s.volumeUsd ?? null,
      marketState: s.marketSession?.state ?? null,
      tokens: (s.variants ?? []).map((v) => ({
        issuer: v.issuer,
        mint: v.mint,
      })),
    }));

    if (Output.isJson()) {
      Output.json({ total: res.total, next: res.next ?? null, stocks });
      return;
    }
    Output.table({
      type: "horizontal",
      headers: {
        symbol: "Ticker",
        name: "Name",
        price: "Price",
        change: "24h",
        mcap: "Mcap",
        volume: "24h Vol",
        tokens: "Tokenized (issuer: mint)",
      },
      maxWidths: { name: 28 },
      rows: stocks.map((s) => ({
        symbol: s.symbol,
        name: s.name,
        price: Output.formatDollar(s.priceUsd ?? undefined, { decimals: 2 }),
        change: Output.formatPercentageChange(s.priceChangePct ?? undefined),
        mcap: Output.formatCompactDollar(s.mcap),
        volume: Output.formatCompactDollar(s.volumeUsd),
        tokens: s.tokens.map((t) => `${t.issuer}: ${t.mint}`).join("\n"),
      })),
    });
    if (res.next) {
      console.log("\nNext offset:", res.next);
    }
  }

  private static async symbolsFor(
    mints: string[]
  ): Promise<Map<string, string>> {
    const assets = await DatapiClient.getAssets([...new Set(mints)]);
    return new Map(assets.map((a) => [a.id, a.symbol]));
  }

  private static mapMover(m: TopMover) {
    return {
      id: m.id,
      symbol: m.symbol,
      name: m.name,
      priceChangePct: m.priceChange24h ?? null,
    };
  }

  private static mapTrader(t: SmartMoneyTrader) {
    return {
      address: t.walletId,
      twitter: t.twitterUsername ?? null,
      categories: t.categories,
      side: t.latestType,
      volumeUsd: t.volumeUsd,
      latestAt: t.latestAt,
      pnl7dUsd: t.pnl7d,
      volume7dUsd: t.volume7d,
      winRate7dPct: t.winRate7d * 100,
    };
  }

  private static formatMovers(
    movers: { symbol: string; priceChangePct: number | null }[]
  ): string {
    return movers
      .map(
        (m) =>
          `${m.symbol} ${Output.formatPercentageChange(m.priceChangePct ?? undefined)}`
      )
      .join("\n");
  }

  private static formatSide(side: "buy" | "sell"): string {
    return side === "buy" ? chalk.green(side) : chalk.red(side);
  }

  private static formatPct(value: number | null): string {
    return value === null ? chalk.gray("—") : `${value.toFixed(2)}%`;
  }

  public static hasListOptions(opts: Record<string, unknown>): boolean {
    return (
      ["interval", "sort", "offset"].some((k) => opts[k] !== undefined) ||
      Object.keys(TokenFilters.fromOptions(opts)).length > 0
    );
  }
}
