import { readFileSync } from "node:fs";

import chalk from "chalk";
import { Option, type Command } from "commander";

import { DatapiClient } from "../clients/DatapiClient.ts";
import { OptionParsers } from "../lib/OptionParsers.ts";
import { Output } from "../lib/Output.ts";
import { TokenView } from "../lib/TokenView.ts";
import { WalletTracker } from "../lib/WalletTracker.ts";
import { Watchlist, type WatchlistEntry } from "../lib/Watchlist.ts";

type EntryOpts = { token?: string; stock?: string; name?: string };

export class SpotWatchCommand {
  public static register(spot: Command): void {
    const watchlist = spot
      .command("watchlist")
      .description(
        `Local token and stock watchlists (stored in ${Watchlist.FILE})`
      );
    watchlist
      .command("list")
      .description("Show a watchlist with live prices")
      .option("--name <list>", "Watchlist name (default: the active list)")
      .addOption(
        new Option("--interval <tf>", "Price change interval")
          .choices(["5m", "1h", "6h", "24h"])
          .default("24h")
      )
      .action((opts) => this.watchlistList(opts));
    watchlist
      .command("add")
      .description("Add a token or stock (creates the list if it is new)")
      .option("--token <token>", "Token symbol or mint address")
      .option("--stock <ticker>", "Stock ticker (e.g. NVDA)")
      .option("--name <list>", "Watchlist name (default: the active list)")
      .action((opts) => this.watchlistAdd(opts));
    watchlist
      .command("remove")
      .description("Remove a token or stock")
      .option("--token <token>", "Token symbol or mint address")
      .option("--stock <ticker>", "Stock ticker")
      .option("--name <list>", "Watchlist name (default: the active list)")
      .action((opts) => this.watchlistRemove(opts));
    watchlist
      .command("use")
      .description("Set the active watchlist")
      .requiredOption("--name <list>", "Watchlist name")
      .action((opts) => this.watchlistUse(opts));
    watchlist
      .command("delete")
      .description("Delete a watchlist")
      .requiredOption("--name <list>", "Watchlist name")
      .action((opts) => this.watchlistDelete(opts));

    const tracker = spot
      .command("tracker")
      .description(`Local wallet tracker (stored in ${WalletTracker.FILE})`);
    tracker
      .command("list")
      .description("Show followed wallets with SOL balance and last activity")
      .action(() => this.trackerList());
    tracker
      .command("add")
      .description("Follow a wallet, or update its label")
      .requiredOption("--address <address>", "Wallet address")
      .option("--name <name>", "Label (max 18 characters)")
      .option("--emoji <emoji>", "Label emoji")
      .option("--group <groups>", "Comma-separated groups", OptionParsers.list)
      .action((opts) => this.trackerAdd(opts));
    tracker
      .command("remove")
      .description("Unfollow a wallet")
      .requiredOption("--address <address>", "Wallet address")
      .action((opts) => this.trackerRemove(opts));
    tracker
      .command("trades")
      .description("Latest trades by followed wallets")
      .option("--token <token>", "Only trades of this token")
      .option(
        "--address <addresses>",
        "Only these followed wallets (comma-separated)"
      )
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
      .option(
        "--limit <n>",
        "Max results (max 30)",
        OptionParsers.positiveInt,
        20
      )
      .option("--offset <cursor>", "Pagination cursor from a previous `next`")
      .action((opts) => this.trackerTrades(opts));
    tracker
      .command("import")
      .description(
        "Import wallets from jup.ag, Axiom, GMGN or Padre share JSON"
      )
      .requiredOption("--file <path>", "JSON file, or - for stdin")
      .action((opts) => this.trackerImport(opts));
    tracker
      .command("export")
      .description("Print followed wallets as jup.ag / Axiom share JSON")
      .action(() => this.trackerExport());
  }

  private static async watchlistList(opts: {
    name?: string;
    interval: string;
  }): Promise<void> {
    const config = Watchlist.load();
    const list = Watchlist.get(config, opts.name);
    const tokenIds = list.entries
      .filter((e) => e.kind === "token")
      .map((e) => e.id);
    const stockSymbols = list.entries
      .filter((e) => e.kind === "stock")
      .map((e) => e.symbol.toUpperCase());
    const [assets, stocks] = await Promise.all([
      DatapiClient.getAssets(tokenIds),
      stockSymbols.length > 0
        ? DatapiClient.getStocks({
            symbols: stockSymbols.join(","),
            limit: stockSymbols.length,
          }).then((r) => r.rwas)
        : Promise.resolve([]),
    ]);
    const assetById = new Map(assets.map((a) => [a.id, a]));
    const stockBySymbol = new Map(
      stocks.map((s) => [s.symbol.toUpperCase(), s])
    );

    const entries = list.entries.map((e) => {
      const base = {
        kind: e.kind,
        id: e.id,
        symbol: e.symbol,
        addedAt: new Date(e.addedTimestamp).toISOString(),
      };
      if (e.kind === "token") {
        const asset = assetById.get(e.id);
        const row = asset ? TokenView.toRow(asset, opts.interval) : null;
        return {
          ...base,
          name: row?.name ?? null,
          priceUsd: row?.priceUsd ?? null,
          priceChangePct: row?.priceChangePct ?? null,
          mcap: row?.mcap ?? null,
          liquidity: row?.liquidity ?? null,
          volumeUsd: row?.volumeUsd ?? null,
        };
      }
      const stock = stockBySymbol.get(e.symbol.toUpperCase());
      return {
        ...base,
        name: stock?.name ?? e.name,
        priceUsd: stock?.price ?? null,
        priceChangePct:
          opts.interval === "24h" ? (stock?.priceChange24h ?? null) : null,
        mcap: stock?.mcap ?? null,
        liquidity: null,
        volumeUsd: stock?.volumeUsd ?? null,
      };
    });

    const result = {
      name: list.name,
      active: list.name === config.activeWatchlistName,
      watchlists: config.watchlists.map((w) => w.name),
      interval: opts.interval,
      entries,
    };
    if (Output.isJson()) {
      Output.json(result);
      return;
    }
    console.log(
      `${chalk.bold(result.name)} ${chalk.gray(`(lists: ${result.watchlists.join(", ")})`)}`
    );
    Output.table({
      type: "horizontal",
      headers: {
        symbol: "Token",
        price: "Price",
        change: opts.interval,
        mcap: "Mcap",
        volume: "Volume",
        id: "Address / Ticker",
      },
      rows: entries.map((e) => ({
        symbol: e.kind === "stock" ? `${e.symbol} (stock)` : e.symbol,
        price: Output.formatDollar(e.priceUsd ?? undefined),
        change: Output.formatPercentageChange(e.priceChangePct ?? undefined),
        mcap: Output.formatCompactDollar(e.mcap),
        volume: Output.formatCompactDollar(e.volumeUsd),
        id: e.kind === "stock" ? e.symbol : e.id,
      })),
    });
  }

  private static async watchlistAdd(opts: EntryOpts): Promise<void> {
    const entry = await this.resolveEntry(opts, Date.now());
    const { config, added } = Watchlist.add(
      Watchlist.load(),
      entry,
      opts.name,
      Date.now()
    );
    Watchlist.save(config);
    this.printEntryChange(
      "added",
      added,
      entry,
      Watchlist.get(config, opts.name).name
    );
  }

  private static async watchlistRemove(opts: EntryOpts): Promise<void> {
    const current = Watchlist.load();
    const listName = Watchlist.get(current, opts.name).name;
    const entry = await this.findEntry(current, listName, opts);
    const { config, removed } = Watchlist.remove(current, entry, listName);
    Watchlist.save(config);
    this.printEntryChange("removed", removed, entry, listName);
  }

  private static watchlistUse(opts: { name: string }): void {
    Watchlist.save(Watchlist.use(Watchlist.load(), opts.name));
    this.printDone(
      { activeWatchlist: opts.name },
      `Active watchlist: ${opts.name}`
    );
  }

  private static watchlistDelete(opts: { name: string }): void {
    const config = Watchlist.deleteList(Watchlist.load(), opts.name);
    Watchlist.save(config);
    this.printDone(
      { deleted: opts.name, activeWatchlist: config.activeWatchlistName },
      `Deleted watchlist ${opts.name}`
    );
  }

  private static async resolveEntry(
    opts: EntryOpts,
    now: number
  ): Promise<WatchlistEntry> {
    if (!opts.token === !opts.stock) {
      throw new Error("Provide exactly one of --token or --stock.");
    }
    if (opts.token) {
      const asset = await DatapiClient.resolveAsset(opts.token);
      return {
        kind: "token",
        id: asset.id,
        symbol: asset.symbol,
        icon: asset.icon,
        addedTimestamp: now,
      };
    }
    const [stock] = (
      await DatapiClient.getStocks({
        symbols: opts.stock!.toUpperCase(),
        limit: 1,
      })
    ).rwas;
    if (!stock) {
      throw new Error(`Stock not found: ${opts.stock}`);
    }
    return {
      kind: "stock",
      id: stock.slug,
      symbol: stock.symbol,
      name: stock.name,
      icon: stock.icon,
      addedTimestamp: now,
    };
  }

  private static async findEntry(
    config: ReturnType<typeof Watchlist.load>,
    listName: string,
    opts: EntryOpts
  ): Promise<WatchlistEntry> {
    if (!opts.token === !opts.stock) {
      throw new Error("Provide exactly one of --token or --stock.");
    }
    const entries = Watchlist.get(config, listName).entries;
    const query = (opts.token ?? opts.stock)!;
    const kind = opts.token ? "token" : "stock";
    const match = entries.find(
      (e) =>
        e.kind === kind &&
        (e.id === query || e.symbol.toLowerCase() === query.toLowerCase())
    );
    if (!match) {
      throw new Error(`${query} is not in watchlist ${listName}.`);
    }
    return match;
  }

  private static printEntryChange(
    action: "added" | "removed",
    changed: boolean,
    entry: WatchlistEntry,
    listName: string
  ): void {
    if (Output.isJson()) {
      Output.json({ watchlist: listName, [action]: changed, entry });
      return;
    }
    console.log(
      changed
        ? `${action === "added" ? "Added" : "Removed"} ${entry.symbol} ${action === "added" ? "to" : "from"} ${listName}.`
        : `${entry.symbol} is already in ${listName}.`
    );
  }

  private static async trackerList(): Promise<void> {
    const wallets = WalletTracker.wallets(WalletTracker.load());
    const summary = await DatapiClient.getAddressSummary(
      wallets.map((w) => w.address)
    );
    const rows = wallets.map((w) => ({
      address: w.address,
      name: w.name || null,
      emoji: w.emoji ?? null,
      groups: w.groups ?? [],
      addedAt: w.addedAt,
      solBalance: summary[w.address]?.solBalance ?? null,
      lastActiveAt: summary[w.address]?.lastActive ?? null,
    }));

    if (Output.isJson()) {
      Output.json({ wallets: rows });
      return;
    }
    if (rows.length === 0) {
      console.log(
        "No followed wallets. Find some with `jup spot smart-money wallets`, then `jup spot tracker add --address <address>`."
      );
      return;
    }
    Output.table({
      type: "horizontal",
      headers: {
        name: "Name",
        address: "Wallet",
        sol: "SOL",
        active: "Last Active",
        groups: "Groups",
      },
      rows: rows.map((r) => ({
        name: [r.emoji, r.name].filter(Boolean).join(" "),
        address: r.address,
        sol:
          r.solBalance === null
            ? chalk.gray("—")
            : r.solBalance.toLocaleString("en-US", {
                maximumFractionDigits: 3,
              }),
        active: r.lastActiveAt
          ? `${TokenView.formatAge(r.lastActiveAt)} ago`
          : chalk.gray("—"),
        groups: r.groups.join(", "),
      })),
    });
  }

  private static trackerAdd(opts: {
    address: string;
    name?: string;
    emoji?: string;
    group?: string[];
  }): void {
    const config = WalletTracker.follow(
      WalletTracker.load(),
      {
        address: opts.address,
        name: opts.name,
        emoji: opts.emoji,
        groups: opts.group,
      },
      new Date()
    );
    WalletTracker.save(config);
    const wallet = WalletTracker.wallets(config).find(
      (w) => w.address === opts.address
    )!;
    this.printDone(
      { following: config.following.length, wallet },
      `Following ${opts.address}${wallet.name ? ` (${wallet.name})` : ""}.`
    );
  }

  private static trackerRemove(opts: { address: string }): void {
    const { config, removed } = WalletTracker.unfollow(
      WalletTracker.load(),
      opts.address
    );
    if (!removed) {
      throw new Error(`Not following ${opts.address}.`);
    }
    WalletTracker.save(config);
    this.printDone(
      { following: config.following.length, removed: opts.address },
      `Unfollowed ${opts.address}.`
    );
  }

  private static async trackerTrades(opts: {
    token?: string;
    address?: string;
    minUsd?: number;
    maxUsd?: number;
    after?: string;
    before?: string;
    limit: number;
    offset?: string;
  }): Promise<void> {
    const wallets = WalletTracker.wallets(WalletTracker.load());
    const followed = new Map(wallets.map((w) => [w.address, w]));
    const addresses = opts.address
      ? OptionParsers.list(opts.address)
      : [...followed.keys()].sort();
    if (addresses.length === 0) {
      throw new Error(
        "No followed wallets. Follow one with `jup spot tracker add --address <address>`."
      );
    }
    const asset = opts.token
      ? await DatapiClient.resolveAsset(opts.token)
      : undefined;
    const { userTrades, next } = await DatapiClient.getUserTrades({
      addresses: addresses.join(","),
      limit: Math.min(opts.limit, 30),
      ...(asset && { assetId: asset.id }),
      ...(opts.minUsd !== undefined && { minUsdVolume: opts.minUsd }),
      ...(opts.maxUsd !== undefined && { maxUsdVolume: opts.maxUsd }),
      ...(opts.after && { fromTs: opts.after }),
      ...(opts.before && { toTs: opts.before }),
      ...(opts.offset && { offset: opts.offset }),
    });
    const trades = userTrades.slice(0, opts.limit);
    const symbols = new Map(
      (
        await DatapiClient.getAssets([...new Set(trades.map((t) => t.assetId))])
      ).map((a) => [a.id, a.symbol])
    );
    const rows = trades.map((t) => ({
      time: t.blockTime,
      wallet: {
        address: t.signerId,
        name: followed.get(t.signerId)?.name || null,
      },
      side: t.type,
      token: { id: t.assetId, symbol: symbols.get(t.assetId) ?? null },
      amount: t.amount,
      priceUsd: t.price,
      valueUsd: t.usdVolume,
      solAmount: t.nativeVolume,
      pnlUsd: t.type === "sell" ? t.profit : null,
      signature: t.txHash,
    }));

    if (Output.isJson()) {
      Output.json({ trades: rows, next: next ?? null });
      return;
    }
    Output.table({
      type: "horizontal",
      headers: {
        time: "Time",
        wallet: "Wallet",
        side: "Side",
        token: "Token",
        value: "Value",
        pnl: "PnL",
        signature: "Tx Signature",
      },
      rows: rows.map((r) => ({
        time: new Date(r.time).toLocaleString(),
        wallet: r.wallet.name ?? r.wallet.address,
        side: r.side === "buy" ? chalk.green(r.side) : chalk.red(r.side),
        token: r.token.symbol ?? r.token.id,
        value: Output.formatDollar(r.valueUsd, { decimals: 2 }),
        pnl:
          r.pnlUsd === null
            ? chalk.gray("—")
            : Output.formatDollarChange(r.pnlUsd),
        signature: r.signature,
      })),
    });
    if (next) {
      console.log("\nNext offset:", next);
    }
  }

  private static trackerImport(opts: { file: string }): void {
    const text = readFileSync(opts.file === "-" ? 0 : opts.file, "utf-8");
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new Error("Invalid JSON.");
    }
    const { wallets, skipped } = WalletTracker.parseShared(raw, new Date());
    const before = WalletTracker.load();
    const config = WalletTracker.merge(before, wallets);
    WalletTracker.save(config);
    const known = new Set(before.following.map((w) => w.address));
    const added = wallets.filter((w) => !known.has(w.address)).length;
    const dropped = before.following.length + added - config.following.length;
    this.printDone(
      {
        imported: wallets.length,
        added,
        skipped,
        unfollowed: dropped,
        following: config.following.length,
      },
      `Imported ${wallets.length} wallets (${added} new, ${skipped} invalid skipped${dropped ? `, ${dropped} oldest unfollowed to stay within ${WalletTracker.MAX_WALLETS}` : ""}). Following ${config.following.length}.`
    );
  }

  private static trackerExport(): void {
    Output.json(WalletTracker.toShared(WalletTracker.load()));
  }

  private static printDone(json: Record<string, unknown>, text: string): void {
    if (Output.isJson()) {
      Output.json(json);
      return;
    }
    console.log(text);
  }
}
