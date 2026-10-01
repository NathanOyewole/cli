import type { Command } from "commander";

import { FluidClient } from "../clients/FluidClient.ts";
import { LendClient, type LendMarket } from "../clients/LendClient.ts";
import { LendMath } from "../lib/LendMath.ts";
import { LendOptions } from "../lib/LendOptions.ts";
import { Output } from "../lib/Output.ts";
import { LendBorrowCommand } from "./LendBorrowCommand.ts";
import { lendTransparency } from "./LendTransparency.ts";

type MarketOpts = { market: LendMarket };

const MARKET_INFO: Record<LendMarket, { name: string; sections: string[] }> = {
  main: {
    name: "Main",
    sections: [
      "earn",
      "borrow",
      "multiply",
      "smart",
      "strategies",
      "calculator",
      "statistics",
      "transparency",
    ],
  },
  ethena: {
    name: "Ethena x Bitwise",
    sections: ["earn", "calculator", "statistics", "transparency"],
  },
};

// Peak-rate multipliers the jup.ag calculator offers as scenarios.
const SCENARIOS = { standard: 1, moderate: 2, max: 3 } as const;

const POSITION_SORT_KEYS = [
  "healthFactor",
  "ratio",
  "updatedAt",
  "supply",
  "borrow",
] as const;

export class LendToolsCommand {
  public static register(lend: Command): void {
    lend
      .command("markets")
      .description("List Jupiter Lend markets with TVL")
      .action(() => this.markets());

    const stats = lend
      .command("stats")
      .description("Protocol statistics for earn, borrow, liquidity and DEX");
    stats
      .command("earn")
      .description("Earn totals and per-token supply")
      .addOption(LendOptions.market())
      .action((opts) => this.statsEarn(opts));
    stats
      .command("borrow")
      .description("Borrow totals across vaults")
      .addOption(LendOptions.market())
      .action((opts) => this.statsBorrow(opts));
    stats
      .command("liquidity")
      .description("Liquidity layer supply, borrow, rates and utilization")
      .addOption(LendOptions.market())
      .action((opts) => this.statsLiquidity(opts));
    stats
      .command("dex")
      .description("Smart vault DEX pools with 7-day volume and fees")
      .addOption(LendOptions.market())
      .action((opts) => this.statsDex(opts));
    stats
      .command("positions")
      .description("Explore all borrow positions")
      .addOption(LendOptions.market())
      .option("--vault <id>", "Only positions in this vault")
      .option("--address <address>", "Only positions owned by this wallet")
      .option(
        "--sort <key>",
        `Sort by: ${POSITION_SORT_KEYS.join(", ")}`,
        "updatedAt"
      )
      .option("--liquidated", "Only liquidated positions")
      .option("--page <n>", "Page number (10 entries per page)", "1")
      .action((opts) => this.statsPositions(opts));

    lend
      .command("strategies")
      .description("One-click max-leverage strategy vaults with max APY")
      .addOption(LendOptions.market())
      .action((opts) => this.strategies(opts));
    lend
      .command("calculator")
      .description(
        "Estimate time to liquidation for a leveraged position in a pegged vault"
      )
      .requiredOption("--vault <id>", "Pegged vault ID")
      .requiredOption("--leverage <x>", "Leverage multiplier, e.g. 5")
      .addOption(LendOptions.market())
      .action((opts) => this.calculator(opts));
    lend
      .command("transparency")
      .description("Multisigs, audits, oracles and risk reports")
      .addOption(LendOptions.market())
      .action((opts) => this.transparency(opts));
  }

  private static async markets(): Promise<void> {
    const markets = await Promise.all(
      (Object.keys(MARKET_INFO) as LendMarket[]).map(async (market) => {
        const [stats, tokens, vaults] = await Promise.all([
          FluidClient.getLendingStats(market),
          LendClient.getTokens(market),
          FluidClient.getVaults(market),
        ]);
        return {
          market,
          name: MARKET_INFO[market].name,
          earnTvlUsd: Number(stats.totalAssets),
          earnTokens: tokens.map((t) => t.asset.symbol),
          vaults: vaults.length,
          sections: MARKET_INFO[market].sections,
        };
      })
    );

    if (Output.isJson()) {
      Output.json({ markets });
      return;
    }
    Output.table({
      type: "horizontal",
      headers: {
        market: "Market",
        name: "Name",
        tvl: "Earn TVL",
        tokens: "Earn Tokens",
        vaults: "Vaults",
      },
      rows: markets.map((m) => ({
        market: m.market,
        name: m.name,
        tvl: Output.formatDollar(m.earnTvlUsd),
        tokens: m.earnTokens.join(", "),
        vaults: m.vaults,
      })),
    });
  }

  private static async statsEarn(opts: MarketOpts): Promise<void> {
    const [stats, tokens] = await Promise.all([
      FluidClient.getLendingStats(opts.market),
      LendClient.getTokens(opts.market),
    ]);
    const result = {
      totalSupplyUsd: Number(stats.totalAssets),
      totalDepositsUsd: Number(stats.totalDeposits),
      totalWithdrawsUsd: Number(stats.totalWithdraws),
      totalEarningsUsd: Number(stats.earnings),
      tokens: tokens.map((t) => ({
        token: {
          id: t.assetAddress,
          symbol: t.asset.symbol,
          decimals: t.asset.decimals,
        },
        supplyUsd:
          (Number(t.totalAssets) / 10 ** t.decimals) * Number(t.asset.price),
        apyPct: Number(t.totalRate) / 100,
      })),
    };

    if (Output.isJson()) {
      Output.json(result);
      return;
    }
    Output.table({
      type: "vertical",
      rows: [
        {
          label: "Total Supply",
          value: Output.formatDollar(result.totalSupplyUsd),
        },
        {
          label: "Lifetime Earnings",
          value: Output.formatDollar(result.totalEarningsUsd),
        },
      ],
    });
    Output.table({
      type: "horizontal",
      headers: { token: "Token", supply: "Supply", apy: "APY" },
      rows: result.tokens.map((t) => ({
        token: t.token.symbol,
        supply: Output.formatDollar(t.supplyUsd),
        apy: Output.formatPercentageChange(t.apyPct),
      })),
    });
  }

  private static async statsBorrow(opts: MarketOpts): Promise<void> {
    const vaults = (await FluidClient.getVaults(opts.market)).map((v) =>
      LendBorrowCommand.vaultSummary(v)
    );
    const sum = (key: "totalSupplyUsd" | "totalBorrowUsd") =>
      vaults.reduce((acc, v) => acc + (v[key] ?? 0), 0);
    const result = {
      totalSupplyUsd: sum("totalSupplyUsd"),
      totalBorrowUsd: sum("totalBorrowUsd"),
      vaults: vaults.length,
      positions: vaults.reduce((acc, v) => acc + v.positions, 0),
      topVaults: [...vaults]
        .sort((a, b) => (b.totalBorrowUsd ?? 0) - (a.totalBorrowUsd ?? 0))
        .slice(0, 10)
        .map((v) => ({
          vaultId: v.vaultId,
          collateral: v.collateral.symbol,
          debt: v.debt.symbol,
          totalSupplyUsd: v.totalSupplyUsd,
          totalBorrowUsd: v.totalBorrowUsd,
        })),
    };

    if (Output.isJson()) {
      Output.json(result);
      return;
    }
    Output.table({
      type: "vertical",
      rows: [
        {
          label: "Total Collateral",
          value: Output.formatDollar(result.totalSupplyUsd),
        },
        {
          label: "Total Borrowed",
          value: Output.formatDollar(result.totalBorrowUsd),
        },
        { label: "Vaults", value: String(result.vaults) },
        { label: "Positions", value: result.positions.toLocaleString() },
      ],
    });
    Output.table({
      type: "horizontal",
      headers: {
        id: "Vault",
        pair: "Collateral / Debt",
        supply: "Collateral",
        borrow: "Borrowed",
      },
      rows: result.topVaults.map((v) => ({
        id: v.vaultId,
        pair: `${v.collateral} / ${v.debt}`,
        supply: Output.formatDollar(v.totalSupplyUsd ?? undefined),
        borrow: Output.formatDollar(v.totalBorrowUsd ?? undefined),
      })),
    });
  }

  private static async statsLiquidity(opts: MarketOpts): Promise<void> {
    const tokens = (await FluidClient.getLiquidityTokens(opts.market)).map(
      (t) => {
        const usd = (raw: string) =>
          (Number(raw) / 10 ** t.decimals) * Number(t.price);
        return {
          token: { id: t.address, symbol: t.symbol, decimals: t.decimals },
          supplyUsd: usd(t.totalSupply),
          borrowUsd: usd(t.totalBorrow),
          supplyApyPct:
            Math.round(LendMath.aprToApy(Number(t.supplyRate) / 1e4) * 1e6) /
            1e4,
          borrowApyPct:
            Math.round(LendMath.aprToApy(Number(t.borrowRate) / 1e4) * 1e6) /
            1e4,
          utilizationPct: Number(t.lastStoredUtilization) / 100,
          maxUtilizationPct: Number(t.maxUtilization) / 100,
        };
      }
    );
    tokens.sort((a, b) => b.supplyUsd - a.supplyUsd);

    if (Output.isJson()) {
      Output.json({ tokens });
      return;
    }
    Output.table({
      type: "horizontal",
      headers: {
        token: "Token",
        supply: "Supplied",
        borrow: "Borrowed",
        supplyApy: "Supply APY",
        borrowApy: "Borrow APY",
        util: "Utilization",
      },
      rows: tokens.map((t) => ({
        token: t.token.symbol,
        supply: Output.formatDollar(t.supplyUsd),
        borrow: Output.formatDollar(t.borrowUsd),
        supplyApy: Output.formatPercentageChange(t.supplyApyPct),
        borrowApy: Output.formatPercentageChange(t.borrowApyPct),
        util: `${t.utilizationPct.toFixed(2)}%`,
      })),
    });
  }

  private static async statsDex(opts: MarketOpts): Promise<void> {
    const dexes = await FluidClient.getDexes(opts.market);
    const stats = await Promise.all(
      dexes.map((d) =>
        FluidClient.getDexStats(opts.market, d.id).catch(() => null)
      )
    );
    const pools = dexes.map((d, i) => {
      const s = stats[i];
      const usd = (raw: number | string | undefined, side: 0 | 1) => {
        const token = side === 0 ? d.token0 : d.token1;
        return raw === undefined
          ? null
          : (Number(raw) / 10 ** token.decimals) * Number(token.price);
      };
      const sumUsd = (a: number | null, b: number | null) =>
        a === null || b === null ? null : a + b;
      return {
        dexId: d.id,
        address: d.address,
        pair: `${d.token0.symbol}-${d.token1.symbol}`,
        volume7dUsd: s
          ? sumUsd(usd(s.volume7dToken0, 0), usd(s.volume7dToken1, 1))
          : null,
        fees7dUsd: s
          ? sumUsd(usd(s.fee7dToken0, 0), usd(s.fee7dToken1, 1))
          : null,
        swaps7d: s?.swapCount7d ?? null,
      };
    });

    if (Output.isJson()) {
      Output.json({ pools });
      return;
    }
    Output.table({
      type: "horizontal",
      headers: {
        id: "DEX",
        pair: "Pair",
        volume: "7d Volume",
        fees: "7d Fees",
        swaps: "7d Swaps",
      },
      rows: pools.map((p) => ({
        id: p.dexId,
        pair: p.pair,
        volume: Output.formatDollar(p.volume7dUsd ?? undefined),
        fees: Output.formatDollar(p.fees7dUsd ?? undefined),
        swaps: p.swaps7d?.toLocaleString() ?? "—",
      })),
    });
  }

  private static async statsPositions(
    opts: MarketOpts & {
      vault?: string;
      address?: string;
      sort: string;
      liquidated?: boolean;
      page: string;
    }
  ): Promise<void> {
    if (!(POSITION_SORT_KEYS as readonly string[]).includes(opts.sort)) {
      throw new Error(
        `--sort must be one of ${POSITION_SORT_KEYS.join(", ")}.`
      );
    }
    const page = Math.max(1, LendOptions.positiveInt("--page", opts.page));
    const [res, vaults] = await Promise.all([
      FluidClient.getPositions(opts.market, {
        page,
        vaultIds: opts.vault,
        owner: opts.address,
        sortedBy: opts.sort,
        sortedByDirection: "desc",
        isLiquidated: opts.liquidated ? "1" : undefined,
      }),
      FluidClient.getVaults(opts.market),
    ]);
    const byId = new Map(vaults.map((v) => [v.id, v]));
    const positions = res.data.map((p) => {
      const vault = byId.get(p.vaultId);
      const amount = (raw: string, side: "supplyToken" | "borrowToken") =>
        vault ? Number(raw) / 10 ** LendMath.sideDecimals(vault[side]) : null;
      return {
        positionId: p.nftId,
        vaultId: p.vaultId,
        owner: p.owner,
        collateral: vault?.supplyToken.token0.symbol ?? null,
        collateralAmount: amount(p.supply, "supplyToken"),
        debt: vault?.borrowToken.token0.symbol ?? null,
        debtAmount: amount(p.borrow, "borrowToken"),
        ltvPct: p.ratio / 100,
        healthFactor: Number(p.healthFactor),
        isLiquidated: p.isLiquidated === 1,
        updatedAt: p.updatedAt,
      };
    });
    const next = page < res.meta.lastPage ? page + 1 : undefined;

    if (Output.isJson()) {
      Output.json({ count: res.meta.total, positions, next });
      return;
    }
    Output.table({
      type: "horizontal",
      headers: {
        id: "Position",
        vault: "Vault",
        owner: "Owner",
        collateral: "Collateral",
        debt: "Debt",
        ltv: "LTV",
        health: "Health Factor",
      },
      rows: positions.map((p) => ({
        id: p.positionId,
        vault: p.vaultId,
        owner: p.owner,
        collateral: `${p.collateralAmount?.toLocaleString("en-US", { maximumFractionDigits: 4 }) ?? "?"} ${p.collateral ?? ""}`,
        debt: `${p.debtAmount?.toLocaleString("en-US", { maximumFractionDigits: 4 }) ?? "?"} ${p.debt ?? ""}`,
        ltv: `${p.ltvPct.toFixed(2)}%`,
        health: p.healthFactor.toFixed(3),
      })),
    });
    if (next) {
      console.log(`Page ${page} of ${res.meta.lastPage}. Next: --page ${next}`);
    }
  }

  private static async strategies(opts: MarketOpts): Promise<void> {
    const vaults = (await FluidClient.getVaults(opts.market))
      .filter((v) => v.type === 1 && v.metadata.maxLeverage)
      .map((v) => {
        const summary = LendBorrowCommand.vaultSummary(v);
        const m = summary.maxMultiplier;
        return {
          vaultId: v.id,
          collateral: summary.collateral,
          debt: summary.debt,
          maxMultiplier: m,
          maxApyPct:
            Math.round(
              (summary.supplyApyPct * m - summary.borrowApyPct * (m - 1)) * 100
            ) / 100,
          supplyApyPct: summary.supplyApyPct,
          borrowApyPct: summary.borrowApyPct,
          totalSupplyUsd: summary.totalSupplyUsd,
        };
      });

    if (Output.isJson()) {
      Output.json({ strategies: vaults });
      return;
    }
    Output.table({
      type: "horizontal",
      headers: {
        id: "Vault",
        pair: "Collateral / Debt",
        mult: "Max Leverage",
        apy: "Max APY",
        tvl: "TVL",
      },
      rows: vaults.map((v) => ({
        id: v.vaultId,
        pair: `${v.collateral.symbol} / ${v.debt.symbol}`,
        mult: `${v.maxMultiplier}x`,
        apy: Output.formatPercentageChange(v.maxApyPct),
        tvl: Output.formatDollar(v.totalSupplyUsd ?? undefined),
      })),
    });
  }

  private static async calculator(
    opts: MarketOpts & { vault: string; leverage: string }
  ): Promise<void> {
    const vault = await FluidClient.getVault(
      opts.market,
      LendOptions.positiveInt("--vault", opts.vault)
    );
    if (!vault.metadata.pegged) {
      const pegged = (await FluidClient.getVaults(opts.market))
        .filter((v) => v.metadata.pegged)
        .map((v) => v.id);
      throw new Error(
        `The calculator models pegged vaults only (collateral and debt track the same price). Pegged vaults: ${pegged.join(", ")}.`
      );
    }
    const leverage = Number(opts.leverage);
    const maxMultiplier = LendMath.maxMultiplier(vault);
    if (!(leverage >= 1) || leverage > maxMultiplier) {
      throw new Error(`--leverage must be between 1 and ${maxMultiplier}.`);
    }
    const summary = LendBorrowCommand.vaultSummary(vault);
    const ltvPct = leverage > 1 ? ((leverage - 1) / leverage) * 100 : 0;
    const scenarios = Object.entries(SCENARIOS).map(([scenario, factor]) => {
      const borrowApyPct = summary.borrowApyPct * factor;
      return {
        scenario,
        borrowApyPct: Math.round(borrowApyPct * 100) / 100,
        daysToLiquidation: LendMath.daysToLiquidation({
          ltvPct,
          liquidationLtvPct: summary.liquidationLtvPct,
          supplyApyPct: summary.supplyApyPct,
          borrowApyPct,
        }),
      };
    });
    const result = {
      vaultId: vault.id,
      collateral: summary.collateral,
      debt: summary.debt,
      leverage,
      maxMultiplier,
      ltvPct: Math.round(ltvPct * 100) / 100,
      liquidationLtvPct: summary.liquidationLtvPct,
      supplyApyPct: summary.supplyApyPct,
      netApyPct:
        Math.round(
          (summary.supplyApyPct * leverage -
            summary.borrowApyPct * (leverage - 1)) *
            100
        ) / 100,
      scenarios,
    };

    if (Output.isJson()) {
      Output.json(result);
      return;
    }
    Output.table({
      type: "vertical",
      rows: [
        {
          label: "Vault",
          value: `${result.vaultId} (${result.collateral.symbol} / ${result.debt.symbol})`,
        },
        {
          label: "Leverage",
          value: `${result.leverage}x (max ${result.maxMultiplier}x)`,
        },
        {
          label: "LTV",
          value: `${result.ltvPct}% (liquidation at ${result.liquidationLtvPct}%)`,
        },
        {
          label: "Net APY",
          value: Output.formatPercentageChange(result.netApyPct),
        },
      ],
    });
    Output.table({
      type: "horizontal",
      headers: {
        scenario: "Scenario",
        borrow: "Borrow APY",
        days: "Days to Liquidation",
      },
      rows: scenarios.map((s) => ({
        scenario: s.scenario,
        borrow: Output.formatPercentageChange(s.borrowApyPct),
        days:
          s.daysToLiquidation === null
            ? "Never"
            : s.daysToLiquidation.toLocaleString(),
      })),
    });
  }

  private static transparency(opts: MarketOpts): void {
    const data = lendTransparency(opts.market);
    if (Output.isJson()) {
      Output.json(data);
      return;
    }
    Output.table({
      type: "horizontal",
      headers: {
        name: "Multisig",
        threshold: "Threshold",
        timelock: "Timelock",
        address: "Address",
      },
      rows: data.multisigs.map((m) => ({
        name: m.name,
        threshold: m.threshold,
        timelock: m.timelock ?? "—",
        address: m.address,
      })),
    });
    Output.table({
      type: "horizontal",
      headers: { title: "Audit", date: "Date", url: "Report" },
      rows: data.audits.map((a) => ({
        title: a.title,
        date: a.date,
        url: a.url,
      })),
    });
    console.log(`Oracles: ${data.oracles.join(", ")}`);
  }
}
