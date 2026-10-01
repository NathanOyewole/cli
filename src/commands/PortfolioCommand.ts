import type { Command } from "commander";

import { DatapiClient, type Token } from "../clients/DatapiClient.ts";
import {
  PortfolioClient,
  type AirdropCheckerResult,
} from "../clients/PortfolioClient.ts";
import { UltraClient } from "../clients/UltraClient.ts";
import { AddressBook, DEMO_GROUP, DEMO_WALLETS } from "../lib/AddressBook.ts";
import { Asset } from "../lib/Asset.ts";
import { Config } from "../lib/Config.ts";
import { NumberConverter } from "../lib/NumberConverter.ts";
import { Output } from "../lib/Output.ts";
import {
  mintsOf,
  normalizeElement,
  type Position,
  type PositionAsset,
  type TokenInfoMap,
} from "../lib/PortfolioPositions.ts";
import { Signer } from "../lib/Signer.ts";

// v2 reports native SOL balances under the system program address.
const NATIVE_SOL = "11111111111111111111111111111111";
const JUP_MINT = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const MAX_ASSETS_IN_TABLE = 4;

type WalletSummary = {
  address: string;
  netWorthUsd: number;
  failedFetchers: string[];
};

export class PortfolioCommand {
  public static register(program: Command): void {
    const portfolio = program
      .command("portfolio")
      .description(
        "Net worth, DeFi positions, spot PnL and airdrops across wallets"
      );
    const addressHelp =
      "Comma-separated wallet addresses, address book names or groups ('demo' for the jup.ag demo wallets)";

    portfolio
      .command("positions")
      .description("Net worth and positions (wallet tokens and DeFi)")
      .option("--address <addresses>", addressHelp)
      .option("--key <name>", "Key to use (overrides active key)")
      .action((opts) => this.positions(opts));
    portfolio
      .command("pnl")
      .description("Spot trading PnL of one wallet")
      .option("--address <address>", "Wallet address or address book name")
      .option("--key <name>", "Key to use (overrides active key)")
      .action((opts) => this.pnl(opts));
    portfolio
      .command("airdrops")
      .description("Check airdrops the wallets are eligible for")
      .option("--address <addresses>", addressHelp)
      .option("--key <name>", "Key to use (overrides active key)")
      .option("--all", "Include ineligible airdrops")
      .action((opts) => this.airdrops(opts));

    const book = portfolio
      .command("addressbook")
      .description("Saved wallets and groups, usable in --address");
    book
      .command("list")
      .description("List saved wallets and groups")
      .action(() => this.bookList());
    book
      .command("add")
      .description("Save a wallet, optionally adding it to a group")
      .requiredOption("--name <name>", "Wallet name")
      .requiredOption("--address <address>", "Wallet address")
      .option("--group <group>", "Group to add the wallet to")
      .action((opts) => this.bookAdd(opts));
    book
      .command("remove")
      .description("Remove a wallet or group, or a wallet from a group")
      .requiredOption("--name <name>", "Wallet or group name")
      .option("--group <group>", "Only remove the wallet from this group")
      .action((opts) => this.bookRemove(opts));
  }

  private static async resolveAddresses(opts: {
    address?: string;
    key?: string;
  }): Promise<string[]> {
    if (opts.address && opts.key) {
      throw new Error("Only one of --address or --key can be provided.");
    }
    if (opts.address) {
      return AddressBook.resolve(opts.address, AddressBook.load());
    }
    return [await Signer.loadAddress(opts.key ?? Config.load().activeKey)];
  }

  private static async positions(opts: {
    address?: string;
    key?: string;
  }): Promise<void> {
    const addresses = await this.resolveAddresses(opts);
    const wallets: WalletSummary[] = [];
    const positions: Position[] = [];
    let coverage = "jupiter-platforms";

    // Sequential: keyless api.jup.ag allows only a few requests per second.
    for (const address of addresses) {
      const res = await PortfolioClient.getPositions(address);
      coverage = res.coverage;
      const tokenInfo: TokenInfoMap = {
        ...res.tokenInfo,
        [NATIVE_SOL]: { symbol: "SOL", decimals: Asset.SOL.decimals },
      };
      const unknownMints = mintsOf(res.elements).filter(
        (m) => !tokenInfo[m]?.symbol
      );
      for (const t of await DatapiClient.getTokensByMints(unknownMints)) {
        tokenInfo[t.id] = { symbol: t.symbol, decimals: t.decimals };
      }
      const walletPositions = res.elements.map((el) =>
        normalizeElement(el, address, tokenInfo)
      );
      if (res.coverage === "jupiter-platforms") {
        walletPositions.push(
          ...(await this.v1Extras(address, walletPositions))
        );
      }
      wallets.push({
        address,
        netWorthUsd: this.sumValue(walletPositions),
        failedFetchers: res.failedFetchers,
      });
      positions.push(...walletPositions);
    }
    positions.sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));
    const netWorthUsd = wallets.reduce((s, w) => s + w.netWorthUsd, 0);

    if (Output.isJson()) {
      Output.json({ coverage, netWorthUsd, wallets, positions });
      return;
    }

    Output.table({
      type: "vertical",
      rows: [
        { label: "Net Worth", value: Output.formatDollar(netWorthUsd) },
        ...(wallets.length > 1
          ? wallets.map((w) => ({
              label: this.short(w.address),
              value: Output.formatDollar(w.netWorthUsd),
            }))
          : []),
      ],
    });
    const multi = wallets.length > 1;
    Output.table({
      type: "horizontal",
      headers: {
        ...(multi && { owner: "Wallet" }),
        platform: "Platform",
        label: "Type",
        assets: "Assets",
        value: "Value",
        apy: "APY",
      },
      rows: positions.map((p) => ({
        owner: this.short(p.owner),
        platform: p.platformId,
        label: p.name ? `${p.label} (${p.name})` : p.label,
        assets: this.describeAssets(p),
        value: Output.formatDollar(p.valueUsd ?? undefined),
        apy:
          p.apyPct === null || p.apyPct === 0
            ? "\u2014"
            : Output.formatPercentageChange(p.apyPct),
      })),
      maxWidths: { assets: 48 },
    });
    if (coverage === "jupiter-platforms") {
      console.log(
        "\nDeFi positions cover Jupiter platforms. An API key with Portfolio v2 access adds all other protocols."
      );
    }
    const failed = [...new Set(wallets.flatMap((w) => w.failedFetchers))];
    if (failed.length > 0) {
      console.log(`Some sources failed to load: ${failed.join(", ")}`);
    }
  }

  // v1 omits wallet tokens and staked JUP; add them so net worth matches the web.
  private static async v1Extras(
    address: string,
    existing: Position[]
  ): Promise<Position[]> {
    const [holdings, stakedJup] = await Promise.all([
      UltraClient.getHoldings(address),
      existing.some((p) => p.platformId === "jupiter-governance")
        ? null
        : PortfolioClient.getStakedJup(address),
    ]);

    const balances = new Map<string, string>();
    for (const [mint, accounts] of Object.entries(holdings.tokens)) {
      const total = accounts.reduce((s, a) => s + BigInt(a.amount), 0n);
      if (total > 0n) {
        balances.set(mint, total.toString());
      }
    }
    const nativeSol = BigInt(holdings.amount);
    if (nativeSol > 0n) {
      balances.set(
        Asset.SOL.id,
        (nativeSol + BigInt(balances.get(Asset.SOL.id) ?? "0")).toString()
      );
    }
    const mints = [...balances.keys()];
    if (stakedJup && !mints.includes(JUP_MINT)) {
      mints.push(JUP_MINT);
    }
    const tokens = new Map<string, Token>(
      (await DatapiClient.getTokensByMints(mints)).map((t) => [t.id, t])
    );

    const walletAssets: PositionAsset[] = [];
    for (const [mint, raw] of balances) {
      const token = tokens.get(mint);
      if (!token) {
        continue;
      }
      const amount = Number(
        NumberConverter.fromChainAmount(raw, token.decimals)
      );
      walletAssets.push({
        role: "asset",
        mint,
        symbol: token.symbol,
        amount,
        priceUsd: token.usdPrice ?? null,
        valueUsd: token.usdPrice ? amount * token.usdPrice : null,
      });
    }
    walletAssets.sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0));

    const extras: Position[] = [];
    if (walletAssets.length > 0) {
      extras.push(
        this.syntheticPosition(address, "wallet-tokens", "Wallet", walletAssets)
      );
    }
    const jupPrice = tokens.get(JUP_MINT)?.usdPrice ?? null;
    const stakedAmount =
      (stakedJup?.stakedAmount ?? 0) +
      (stakedJup?.unstaking ?? []).reduce((s, u) => s + u.amount, 0);
    if (stakedAmount > 0) {
      extras.push(
        this.syntheticPosition(address, "jupiter-governance", "Staked", [
          {
            role: "asset",
            mint: JUP_MINT,
            symbol: "JUP",
            amount: stakedAmount,
            priceUsd: jupPrice,
            valueUsd: jupPrice ? stakedAmount * jupPrice : null,
          },
        ])
      );
    }
    return extras;
  }

  private static syntheticPosition(
    owner: string,
    platformId: string,
    label: string,
    assets: PositionAsset[]
  ): Position {
    return {
      owner,
      platformId,
      label,
      name: null,
      type: "multiple",
      valueUsd: assets.reduce((s, a) => s + (a.valueUsd ?? 0), 0),
      apyPct: null,
      healthRatio: null,
      assets,
      perps: [],
      link: null,
    };
  }

  private static async pnl(opts: {
    address?: string;
    key?: string;
  }): Promise<void> {
    const addresses = await this.resolveAddresses(opts);
    if (addresses.length > 1) {
      throw new Error(
        "Spot PnL is calculated for one wallet at a time. Pass a single --address."
      );
    }
    const address = addresses[0]!;
    const [statsRes, positionsRes] = await Promise.all([
      PortfolioClient.getPnlStats(address),
      PortfolioClient.getPnlPositions(address),
    ]);
    const rawStats = statsRes[address]?.stats ?? {};
    const stats = Object.fromEntries(
      ["1d", "7d", "30d", "total"]
        .filter((tf) => rawStats[tf])
        .map((tf) => {
          const s = rawStats[tf]!;
          return [
            tf,
            {
              pnlUsd: s.totalPnl,
              realizedPnlUsd: s.totalRealisedPnl,
              unrealizedPnlUsd: s.totalUnrealisedPnl,
              pnlPct: s.totalPercentage,
              winRatePct: s.winRate,
              buys: s.totalBuys,
              sells: s.totalSells,
              boughtVolumeUsd: s.totalBoughtVolume,
              soldVolumeUsd: s.totalSoldVolume,
            },
          ];
        })
    );
    const positions = positionsRes[address]?.tokenPositions ?? [];
    const tokens = new Map(
      (
        await DatapiClient.getTokensByMints(positions.map((p) => p.assetId))
      ).map((t) => [t.id, t])
    );
    const tokenPnl = positions
      .map((p) => ({
        mint: p.assetId,
        symbol: tokens.get(p.assetId)?.symbol ?? null,
        balance: p.balance,
        valueUsd: p.balanceValue,
        averageCostUsd: p.averageCost,
        realizedPnlUsd: p.realizedPnl,
        unrealizedPnlUsd: p.unrealizedPnl,
        pnlUsd: p.totalPnl,
        pnlPct: p.totalPnlPercentage,
      }))
      .sort((a, b) => b.valueUsd - a.valueUsd);

    if (Output.isJson()) {
      Output.json({ address, stats, tokens: tokenPnl });
      return;
    }
    Output.table({
      type: "horizontal",
      headers: {
        timeframe: "Timeframe",
        pnl: "PnL",
        realized: "Realized",
        unrealized: "Unrealized",
        pct: "PnL %",
        winRate: "Win Rate",
      },
      rows: Object.entries(stats).map(([tf, s]) => ({
        timeframe: tf,
        pnl: Output.formatDollarChange(s.pnlUsd),
        realized: Output.formatDollarChange(s.realizedPnlUsd),
        unrealized: Output.formatDollarChange(s.unrealizedPnlUsd),
        pct: Output.formatPercentageChange(s.pnlPct),
        winRate: `${Math.round(s.winRatePct)}%`,
      })),
    });
    Output.table({
      type: "horizontal",
      headers: {
        symbol: "Token",
        value: "Value",
        averageCost: "Avg Cost",
        pnl: "PnL",
        pct: "PnL %",
      },
      rows: tokenPnl.map((t) => ({
        symbol: t.symbol ?? t.mint,
        value: Output.formatDollar(t.valueUsd),
        averageCost: Output.formatDollar(t.averageCostUsd),
        pnl: Output.formatDollarChange(t.pnlUsd),
        pct: Output.formatPercentageChange(t.pnlPct),
      })),
    });
  }

  private static async airdrops(opts: {
    address?: string;
    key?: string;
    all?: boolean;
  }): Promise<void> {
    const addresses = await this.resolveAddresses(opts);
    const results: AirdropCheckerResult[] =
      await PortfolioClient.getAirdrops(addresses);
    const mints = [
      ...new Set(
        results.flatMap((r) =>
          r.airdrops.flatMap((a) => a.items.map((i) => i.address))
        )
      ),
    ];
    const tokens = new Map(
      (await DatapiClient.getTokensByMints(mints)).map((t) => [t.id, t])
    );
    const airdrops = results
      .flatMap((r) => r.airdrops)
      .map((a) => {
        const items = a.items
          .filter((i) => opts.all || i.isEligible)
          .map((i) => ({
            mint: i.address,
            symbol: tokens.get(i.address)?.symbol ?? i.label,
            amount: i.amount,
            valueUsd: i.value,
            status: this.stripRank(i.status),
          }));
        return {
          owner: a.owner,
          id: a.id,
          name: a.name ? `${a.emitterName} ${a.name}` : a.emitterName,
          status: this.stripRank(a.status),
          claimStart: a.claimStart
            ? new Date(a.claimStart).toISOString()
            : null,
          claimEnd: a.claimEnd ? new Date(a.claimEnd).toISOString() : null,
          claimLink: a.claimLink,
          valueUsd: items.reduce((s, i) => s + (i.valueUsd ?? 0), 0),
          items,
        };
      })
      .filter((a) => a.items.length > 0)
      .sort((a, b) => b.valueUsd - a.valueUsd);
    const claimableValueUsd = airdrops
      .flatMap((a) => a.items)
      .filter((i) => i.status === "claimable")
      .reduce((s, i) => s + (i.valueUsd ?? 0), 0);

    if (Output.isJson()) {
      Output.json({ claimableValueUsd, airdrops });
      return;
    }
    Output.table({
      type: "horizontal",
      headers: {
        ...(addresses.length > 1 && { owner: "Wallet" }),
        name: "Airdrop",
        items: "Allocation",
        value: "Value",
        status: "Status",
        claimLink: "Claim Link",
      },
      rows: airdrops.map((a) => ({
        owner: this.short(a.owner),
        name: a.name,
        items: a.items
          .map((i) => `${this.num(i.amount)} ${i.symbol} (${i.status})`)
          .join("\n"),
        value: Output.formatDollar(a.valueUsd),
        status: a.status,
        claimLink: a.claimLink ?? "\u2014",
      })),
    });
    console.log(
      `\nClaimable now: ${Output.formatDollar(claimableValueUsd, { decimals: 2 })}`
    );
  }

  private static bookList(): void {
    const data = AddressBook.load();
    const builtIn = {
      wallets: DEMO_WALLETS,
      groups: [DEMO_GROUP],
    };
    if (Output.isJson()) {
      Output.json({ ...data, builtIn });
      return;
    }
    const groupsOf = (address: string) =>
      [...data.groups, DEMO_GROUP]
        .filter((g) => g.addresses.includes(address))
        .map((g) => g.name)
        .join(", ");
    Output.table({
      type: "horizontal",
      headers: { name: "Name", address: "Address", groups: "Groups" },
      rows: [...data.wallets, ...DEMO_WALLETS].map((w) => ({
        ...w,
        groups: groupsOf(w.address),
      })),
    });
    const loose = data.groups.flatMap((g) =>
      g.addresses
        .filter((a) => !data.wallets.some((w) => w.address === a))
        .map((a) => `${g.name}: ${a}`)
    );
    if (loose.length > 0) {
      console.log(`\nUnnamed group members:\n${loose.join("\n")}`);
    }
  }

  private static bookAdd(opts: {
    name: string;
    address: string;
    group?: string;
  }): void {
    const data = AddressBook.addWallet(
      AddressBook.load(),
      opts.name,
      opts.address,
      opts.group
    );
    AddressBook.save(data);
    this.printBookChange(data);
  }

  private static bookRemove(opts: { name: string; group?: string }): void {
    const data = AddressBook.remove(AddressBook.load(), opts.name, opts.group);
    AddressBook.save(data);
    this.printBookChange(data);
  }

  private static printBookChange(data: ReturnType<typeof AddressBook.load>) {
    if (Output.isJson()) {
      Output.json(data);
      return;
    }
    this.bookList();
  }

  private static describeAssets(p: Position): string {
    const parts = [
      ...p.perps.map(
        (x) =>
          `${x.side.toUpperCase()} ${x.symbol ?? this.short(x.mint ?? "")} ${Output.formatDollar(x.sizeUsd ?? undefined)}${x.leverage ? ` ${x.leverage.toFixed(1)}x` : ""}`
      ),
      ...p.assets.map((a) => {
        const sign = a.role === "borrowed" ? "-" : "";
        const amount = a.amount === null ? "" : `${sign}${this.num(a.amount)} `;
        return `${amount}${a.symbol ?? this.short(a.mint ?? "?")}`;
      }),
    ];
    if (parts.length <= MAX_ASSETS_IN_TABLE) {
      return parts.join(", ");
    }
    return `${parts.slice(0, MAX_ASSETS_IN_TABLE).join(", ")} +${parts.length - MAX_ASSETS_IN_TABLE} more`;
  }

  private static sumValue(positions: Position[]): number {
    return positions.reduce((s, p) => s + (p.valueUsd ?? 0), 0);
  }

  private static stripRank(status: string): string {
    const name = status.replace(/^\d+_/, "");
    return name === "unknowned" ? "unknown" : name;
  }

  private static num(n: number): string {
    return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  }

  private static short(address: string): string {
    return address.length > 12
      ? `${address.slice(0, 4)}...${address.slice(-4)}`
      : address;
  }
}
