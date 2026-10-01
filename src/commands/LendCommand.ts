import type { Command } from "commander";
import type { Instruction } from "@solana/kit";

import { FluidClient } from "../clients/FluidClient.ts";
import {
  LendClient,
  type EarnAction,
  type LendMarket,
  type LendToken,
} from "../clients/LendClient.ts";
import { Config } from "../lib/Config.ts";
import { LendMath } from "../lib/LendMath.ts";
import { LendOptions } from "../lib/LendOptions.ts";
import { LendTx } from "../lib/LendTx.ts";
import { NumberConverter } from "../lib/NumberConverter.ts";
import { Output } from "../lib/Output.ts";
import { Signer } from "../lib/Signer.ts";
import { Swap } from "../lib/Swap.ts";
import { LendBorrowCommand } from "./LendBorrowCommand.ts";
import { LendMultiplyCommand } from "./LendMultiplyCommand.ts";
import { LendToolsCommand } from "./LendToolsCommand.ts";

const EARN_COMPUTE_UNITS = 300_000;

type MarketOpts = { market: LendMarket };

export class LendCommand {
  public static register(program: Command): void {
    const lend = program
      .command("lend")
      .description("Lending and earning yield");
    const earn = lend
      .command("earn")
      .description("Earn yield by lending tokens");
    earn
      .command("tokens")
      .description("View tokens available for lending with APY")
      .addOption(LendOptions.market())
      .action((opts) => this.tokens(opts));
    earn
      .command("positions")
      .description("View lending positions with earnings")
      .addOption(LendOptions.market())
      .option("--key <name>", "Key to use (overrides active key)")
      .option("--address <address>", "Wallet address to look up")
      .option("--token <token>", "Filter by token (symbol or mint address)")
      .action((opts) => this.positions(opts));
    earn
      .command("deposit")
      .description("Deposit tokens into lending")
      .requiredOption(
        "--token <token>",
        "Token to deposit (symbol or mint address)"
      )
      .option("--amount <n>", "Amount in human-readable units")
      .option(
        "--raw-amount <n>",
        "Amount in on-chain units (no decimal conversion)"
      )
      .addOption(LendOptions.market())
      .option("--key <name>", "Key to use for signing")
      .action((opts) => this.deposit(opts));
    earn
      .command("withdraw")
      .description("Withdraw tokens from lending")
      .requiredOption(
        "--token <token>",
        "Token to withdraw (symbol, jlToken symbol, or mint address)"
      )
      .option("--amount <n>", "Amount in human-readable units")
      .option(
        "--raw-amount <n>",
        "Amount of jlToken shares in on-chain units (no decimal conversion)"
      )
      .addOption(LendOptions.market())
      .option("--key <name>", "Key to use for signing")
      .action((opts) => this.withdraw(opts));
    earn
      .command("history")
      .description("View lending deposit and withdrawal history")
      .addOption(LendOptions.market())
      .option("--key <name>", "Key to use (overrides active key)")
      .option("--address <address>", "Wallet address to look up")
      .option("--token <token>", "Filter by token (symbol or mint address)")
      .option(
        "--type <type>",
        "Filter by type: deposit, withdraw, transfer, mint, redeem"
      )
      .option("--page <n>", "Page number (10 entries per page)", "1")
      .action((opts) => this.history(opts));
    earn
      .command("chart")
      .description("View a lending token's historical APY and exchange rate")
      .requiredOption("--token <token>", "Token (symbol or mint address)")
      .option("--range <range>", "Time range: 1d, 7d, 30d, 1y", "7d")
      .addOption(LendOptions.market())
      .action((opts) => this.chart(opts));

    LendBorrowCommand.register(lend);
    LendMultiplyCommand.register(lend);
    LendToolsCommand.register(lend);
  }

  private static async tokens(opts: MarketOpts): Promise<void> {
    const lendTokens = await LendClient.getTokens(opts.market);

    const tokens = lendTokens.map((lt) => {
      const price = Number(lt.asset.price);
      const tvl =
        Number(NumberConverter.fromChainAmount(lt.totalAssets, lt.decimals)) *
        price;
      const withdrawable =
        Number(
          NumberConverter.fromChainAmount(
            lt.liquiditySupplyData.withdrawable,
            lt.decimals
          )
        ) * price;
      return {
        token: this.tokenInfo(lt),
        jlToken: {
          id: lt.address,
          symbol: lt.symbol,
          decimals: lt.decimals,
        },
        apyPct: this.rateToPct(lt.totalRate),
        supplyApyPct: this.rateToPct(lt.supplyRate),
        rewardsApyPct: this.rateToPct(lt.rewardsRate),
        totalTvlUsd: tvl,
        withdrawableUsd: withdrawable,
        priceUsd: price,
      };
    });

    if (Output.isJson()) {
      Output.json({ tokens });
      return;
    }

    Output.table({
      type: "horizontal",
      headers: {
        token: "Token",
        apy: "APY",
        tvl: "TVL",
        withdrawable: "Withdrawable",
      },
      rows: tokens.map((t) => ({
        token: t.token.symbol,
        apy: Output.formatPercentageChange(t.apyPct),
        tvl: Output.formatDollar(t.totalTvlUsd),
        withdrawable: Output.formatDollar(t.withdrawableUsd),
      })),
    });
  }

  private static async positions(
    opts: MarketOpts & { key?: string; address?: string; token?: string }
  ): Promise<void> {
    const address = await LendOptions.resolveAddress(opts);

    const allPositions = await LendClient.getPositions(address, opts.market);
    let activePositions = allPositions.filter((p) => p.shares !== "0");

    if (opts.token) {
      const filter = this.normalizeSymbol(opts.token);
      activePositions = activePositions.filter(
        (p) =>
          p.token.asset.symbol.toLowerCase() === filter ||
          p.token.assetAddress.toLowerCase() === filter
      );
    }

    if (activePositions.length === 0) {
      if (Output.isJson()) {
        Output.json({ positions: [] });
        return;
      }
      throw new Error("No active lending positions found.");
    }

    const earnings = await LendClient.getEarnings({
      user: address,
      positions: activePositions.map((p) => p.token.address).join(","),
      market: opts.market,
    });
    const earningsMap = new Map(earnings.map((e) => [e.address, e.earnings]));

    const positions = activePositions.map((p) => {
      const price = Number(p.token.asset.price);
      const currentAmount = Number(
        NumberConverter.fromChainAmount(
          p.underlyingAssets,
          p.token.asset.decimals
        )
      );
      const rawEarnings = earningsMap.get(p.token.address) ?? 0;
      const earningsAmount = Number(
        NumberConverter.fromChainAmount(
          BigInt(rawEarnings).toString(),
          p.token.asset.decimals
        )
      );
      return {
        token: this.tokenInfo(p.token),
        jlToken: {
          id: p.token.address,
          symbol: p.token.symbol,
          decimals: p.token.decimals,
        },
        positionAmount: currentAmount,
        positionUsd: currentAmount * price,
        earningsAmount,
        earningsUsd: earningsAmount * price,
        apyPct: this.rateToPct(p.token.totalRate),
      };
    });

    if (Output.isJson()) {
      Output.json({ positions });
      return;
    }

    Output.table({
      type: "horizontal",
      headers: {
        token: "Token",
        apy: "APY",
        position: "Position",
        earnings: "Earnings",
      },
      rows: positions.map((p) => ({
        token: p.token.symbol,
        apy: Output.formatPercentageChange(p.apyPct),
        position: `${this.formatAmount(p.positionAmount)} ${p.token.symbol} (${Output.formatDollar(p.positionUsd)})`,
        earnings: Output.formatDollarChange(p.earningsUsd),
      })),
    });
  }

  private static async deposit(
    opts: MarketOpts & {
      token: string;
      amount?: string;
      rawAmount?: string;
      key?: string;
    }
  ): Promise<void> {
    Swap.validateAmountOpts(opts);

    const lendTokens = await LendClient.getTokens(opts.market);
    const lendToken = this.resolveLendToken(lendTokens, opts.token);
    const signer = await Signer.load(opts.key ?? Config.load().activeKey);

    const rawAmount =
      opts.rawAmount ??
      NumberConverter.toChainAmount(opts.amount!, lendToken.asset.decimals);
    const transaction = await this.buildEarnTx({
      action: "deposit",
      signer: signer.address,
      lendToken,
      market: opts.market,
      amount: rawAmount,
    });

    const price = Number(lendToken.asset.price);
    const depositedAmount = NumberConverter.fromChainAmount(
      rawAmount,
      lendToken.asset.decimals
    );
    const depositedUsd = Number(depositedAmount) * price;
    const apyPct = this.rateToPct(lendToken.totalRate);

    if (Config.dryRun) {
      if (Output.isJson()) {
        Output.json({
          dryRun: true,
          token: this.tokenInfo(lendToken),
          depositedAmount,
          depositedUsd,
          apyPct,
          signature: null,
          transaction,
        });
        return;
      }
      console.log(Output.DRY_RUN_LABEL);
      Output.table({
        type: "vertical",
        rows: [
          {
            label: "Deposit",
            value: `${depositedAmount} ${lendToken.asset.symbol} (${Output.formatDollar(depositedUsd)})`,
          },
          { label: "APY", value: Output.formatPercentageChange(apyPct) },
        ],
      });
      return;
    }

    const signature = await LendTx.signAndSend(signer, transaction);
    const positionAmount = await this.fetchPositionAmount(
      signer.address,
      lendToken,
      opts.market
    );

    if (Output.isJson()) {
      Output.json({
        token: this.tokenInfo(lendToken),
        depositedAmount,
        depositedUsd,
        positionAmount,
        positionUsd: positionAmount === null ? null : positionAmount * price,
        apyPct,
        signature,
      });
      return;
    }

    Output.table({
      type: "vertical",
      rows: [
        {
          label: "Deposited",
          value: `${depositedAmount} ${lendToken.asset.symbol} (${Output.formatDollar(depositedUsd)})`,
        },
        this.positionRow(positionAmount, lendToken),
        { label: "APY", value: Output.formatPercentageChange(apyPct) },
        { label: "Tx Signature", value: signature },
      ],
    });
  }

  private static async withdraw(
    opts: MarketOpts & {
      token: string;
      amount?: string;
      rawAmount?: string;
      key?: string;
    }
  ): Promise<void> {
    if (opts.amount && opts.rawAmount) {
      throw new Error("Only one of --amount or --raw-amount can be provided.");
    }

    const lendTokens = await LendClient.getTokens(opts.market);
    const lendToken = this.resolveLendToken(lendTokens, opts.token);
    const signer = await Signer.load(opts.key ?? Config.load().activeKey);

    let shares = opts.rawAmount;
    if (!opts.amount && !shares) {
      const positions = await LendClient.getPositions(
        signer.address,
        opts.market
      );
      const position = positions.find(
        (p) => p.token.address === lendToken.address
      );
      if (!position || position.shares === "0") {
        throw new Error(
          `No lending position found for ${lendToken.asset.symbol}.`
        );
      }
      shares = position.shares;
    }
    const withdrawnRaw = opts.amount
      ? BigInt(
          NumberConverter.toChainAmount(opts.amount, lendToken.asset.decimals)
        )
      : (BigInt(shares!) * BigInt(lendToken.convertToAssets)) /
        10n ** BigInt(lendToken.decimals);

    const withdrawable = BigInt(lendToken.liquiditySupplyData.withdrawable);
    if (withdrawnRaw > withdrawable) {
      throw new Error(
        `Only ${NumberConverter.fromChainAmount(withdrawable, lendToken.asset.decimals)} ${lendToken.asset.symbol} is withdrawable right now (protocol withdrawal limit). Withdraw a smaller --amount.`
      );
    }

    const transaction = await this.buildEarnTx({
      signer: signer.address,
      lendToken,
      market: opts.market,
      ...(opts.amount
        ? { action: "withdraw", amount: withdrawnRaw.toString() }
        : { action: "redeem", shares: shares! }),
    });

    const price = Number(lendToken.asset.price);
    const withdrawnAmount = NumberConverter.fromChainAmount(
      withdrawnRaw,
      lendToken.asset.decimals
    );
    const withdrawnUsd = Number(withdrawnAmount) * price;
    const apyPct = this.rateToPct(lendToken.totalRate);

    if (Config.dryRun) {
      if (Output.isJson()) {
        Output.json({
          dryRun: true,
          token: this.tokenInfo(lendToken),
          withdrawnAmount,
          withdrawnUsd,
          apyPct,
          signature: null,
          transaction,
        });
        return;
      }
      console.log(Output.DRY_RUN_LABEL);
      Output.table({
        type: "vertical",
        rows: [
          {
            label: "Withdraw",
            value: `${withdrawnAmount} ${lendToken.asset.symbol} (${Output.formatDollar(withdrawnUsd)})`,
          },
          { label: "APY", value: Output.formatPercentageChange(apyPct) },
        ],
      });
      return;
    }

    const signature = await LendTx.signAndSend(signer, transaction);
    const positionAmount = await this.fetchPositionAmount(
      signer.address,
      lendToken,
      opts.market
    );

    if (Output.isJson()) {
      Output.json({
        token: this.tokenInfo(lendToken),
        withdrawnAmount,
        withdrawnUsd,
        positionAmount,
        positionUsd: positionAmount === null ? null : positionAmount * price,
        apyPct,
        signature,
      });
      return;
    }

    Output.table({
      type: "vertical",
      rows: [
        {
          label: "Withdrawn",
          value: `${withdrawnAmount} ${lendToken.asset.symbol} (${Output.formatDollar(withdrawnUsd)})`,
        },
        this.positionRow(positionAmount, lendToken),
        { label: "APY", value: Output.formatPercentageChange(apyPct) },
        { label: "Tx Signature", value: signature },
      ],
    });
  }

  private static async history(
    opts: MarketOpts & {
      key?: string;
      address?: string;
      token?: string;
      type?: string;
      page: string;
    }
  ): Promise<void> {
    const address = await LendOptions.resolveAddress(opts);
    const page = Math.max(1, LendOptions.positiveInt("--page", opts.page));
    const lendTokens = await LendClient.getTokens(opts.market);
    const ftoken = opts.token
      ? this.resolveLendToken(lendTokens, opts.token).address
      : undefined;

    const res = await FluidClient.getEarnHistory(opts.market, address, {
      page,
      type: opts.type,
      ftoken,
    });
    const byJlToken = new Map(lendTokens.map((lt) => [lt.address, lt]));

    const history = res.data.map((a) => {
      const lt = byJlToken.get(a.ftoken);
      const decimals = lt?.asset.decimals ?? 0;
      return {
        time: a.createdAt,
        type: a.type,
        token: lt
          ? this.tokenInfo(lt)
          : { id: a.asset, symbol: null, decimals: null },
        amount: lt
          ? Number(NumberConverter.fromChainAmount(a.assetAmount, decimals))
          : null,
        amountUsd: a.assetAmountUsd === null ? null : Number(a.assetAmountUsd),
        status: a.status,
        signature: a.signature,
      };
    });
    const next = page < res.meta.lastPage ? page + 1 : undefined;

    if (Output.isJson()) {
      Output.json({ count: res.meta.total, history, next });
      return;
    }

    Output.table({
      type: "horizontal",
      headers: {
        time: "Time",
        type: "Type",
        amount: "Amount",
        value: "Value",
        status: "Status",
        signature: "Tx Signature",
      },
      rows: history.map((h) => ({
        time: new Date(h.time).toLocaleString(),
        type: h.type,
        amount: `${h.amount === null ? "?" : this.formatAmount(h.amount)} ${h.token.symbol ?? ""}`,
        value: Output.formatDollar(h.amountUsd ?? undefined),
        status: h.status,
        signature: h.signature,
      })),
    });
    if (next) {
      console.log(`Page ${page} of ${res.meta.lastPage}. Next: --page ${next}`);
    }
  }

  private static async chart(
    opts: MarketOpts & { token: string; range: string }
  ): Promise<void> {
    if (!["1d", "7d", "30d", "1y"].includes(opts.range)) {
      throw new Error("--range must be one of 1d, 7d, 30d, 1y.");
    }
    const lendTokens = await LendClient.getTokens(opts.market);
    const lendToken = this.resolveLendToken(lendTokens, opts.token);
    const raw = await FluidClient.getExchangePriceChart(
      opts.market,
      lendToken.address,
      opts.range
    );
    const points = LendMath.exchangePriceApys(raw);

    if (Output.isJson()) {
      Output.json({
        token: this.tokenInfo(lendToken),
        range: opts.range,
        points,
      });
      return;
    }

    const step = Math.max(1, Math.ceil(points.length / 24));
    Output.table({
      type: "horizontal",
      headers: {
        time: "Time",
        apy: "APY",
        base: "Supply APY",
        rate: `${lendToken.symbol}/${lendToken.asset.symbol}`,
      },
      rows: points
        .filter((_, i) => i % step === 0 || i === points.length - 1)
        .map((p) => ({
          time: new Date(p.time).toLocaleString(),
          apy: Output.formatPercentageChange(p.apyPct),
          base: Output.formatPercentageChange(p.baseApyPct),
          rate: p.exchangeRate.toFixed(6),
        })),
    });
  }

  private static async buildEarnTx(
    req: {
      action: EarnAction;
      signer: string;
      lendToken: LendToken;
      market: LendMarket;
    } & ({ amount: string } | { shares: string })
  ): Promise<string> {
    const { action, signer, lendToken, market } = req;
    const asset = lendToken.assetAddress;
    const isSol = asset === LendTx.WSOL_MINT;
    const value: { amount: string } | { shares: string } =
      "amount" in req ? { amount: req.amount } : { shares: req.shares };

    const [{ instructions }, programs] = await Promise.all([
      LendClient.postEarnInstructions(action, {
        asset,
        signer,
        market,
        ...value,
      }),
      LendTx.tokenPrograms([asset, lendToken.address]),
    ]);
    const assetProgram = programs.get(asset)!;
    const isEntry = action === "deposit" || action === "mint";

    const ixs: Instruction[] = [...LendTx.computeBudget(EARN_COMPUTE_UNITS)];
    if (isEntry) {
      ixs.push(
        await LendTx.createAta(
          signer,
          lendToken.address,
          programs.get(lendToken.address)!
        )
      );
      if (isSol && "amount" in value) {
        ixs.push(
          await LendTx.createAta(signer, asset, assetProgram),
          ...(await LendTx.wrapSol(signer, BigInt(value.amount), assetProgram))
        );
      }
    } else {
      ixs.push(await LendTx.createAta(signer, asset, assetProgram));
    }
    ixs.push(...instructions.map(LendTx.fromApi));
    if (isSol) {
      ixs.push(await LendTx.unwrapSol(signer, assetProgram));
    }
    return LendTx.compile(signer, ixs);
  }

  // Runs after the transaction has landed, so a failed lookup must not hide
  // its signature: the position is then reported as null.
  private static async fetchPositionAmount(
    address: string,
    lendToken: LendToken,
    market: LendMarket
  ): Promise<number | null> {
    try {
      const positions = await LendClient.getPositions(address, market);
      const position = positions.find(
        (p) => p.token.address === lendToken.address
      );
      return position
        ? Number(
            NumberConverter.fromChainAmount(
              position.underlyingAssets,
              lendToken.asset.decimals
            )
          )
        : 0;
    } catch {
      return null;
    }
  }

  private static positionRow(amount: number | null, lendToken: LendToken) {
    return {
      label: "Position",
      value:
        amount === null
          ? "unavailable (lookup failed)"
          : `${this.formatAmount(amount)} ${lendToken.asset.symbol} (${Output.formatDollar(amount * Number(lendToken.asset.price))})`,
    };
  }

  private static tokenInfo(lt: LendToken) {
    return {
      id: lt.assetAddress,
      symbol: lt.asset.symbol,
      decimals: lt.asset.decimals,
    };
  }

  private static normalizeSymbol(input: string): string {
    const query = input.toLowerCase();
    return query === "sol" ? "wsol" : query;
  }

  private static resolveLendToken(
    lendTokens: LendToken[],
    input: string
  ): LendToken {
    const query = this.normalizeSymbol(input);
    const match = lendTokens.find(
      (lt) =>
        lt.asset.symbol.toLowerCase() === query ||
        lt.assetAddress.toLowerCase() === query ||
        lt.symbol.toLowerCase() === query ||
        lt.address.toLowerCase() === query
    );
    if (!match) {
      const available = lendTokens.map((lt) => lt.asset.symbol).join(", ");
      throw new Error(
        `Token "${input}" is not available for lending. Available: ${available}`
      );
    }
    return match;
  }

  private static formatAmount(n: number): string {
    return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
  }

  private static rateToPct(rate: string): number {
    return Number(rate) / 100;
  }
}
