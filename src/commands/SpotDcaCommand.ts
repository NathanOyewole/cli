import type { Base64EncodedBytes } from "@solana/kit";
import chalk from "chalk";
import type { Command } from "commander";

import { DatapiClient } from "../clients/DatapiClient.ts";
import {
  TriggerClient,
  type DcaOrder,
  type V1DcaOrder,
} from "../clients/TriggerClient.ts";
import { resolveWalletAsset } from "../lib/Asset.ts";
import { Config } from "../lib/Config.ts";
import { NumberConverter } from "../lib/NumberConverter.ts";
import { OrderTokens, toTokenRef, type TokenRef } from "../lib/OrderTokens.ts";
import { Output } from "../lib/Output.ts";
import { Signer } from "../lib/Signer.ts";
import { Swap } from "../lib/Swap.ts";
import {
  assertMinDcaOrderUsd,
  buildDcaOrderParams,
  parseInterval,
} from "../lib/TriggerOrder.ts";
import { SpotLimitCommand } from "./SpotLimitCommand.ts";

type DcaOrderView = {
  orderId: string;
  state: string;
  inputToken: TokenRef;
  outputToken: TokenRef;
  inAmount: string | null;
  remainingInAmount: string | null;
  inAmountPerOrder: string | null;
  outAmount: string | null;
  orderCount: number;
  ordersFilled: number;
  intervalSeconds: number;
  minPriceUsd: number | null;
  maxPriceUsd: number | null;
  earn: boolean;
  earnedUsd: number | null;
  nextOrderAt: string | null;
  createdAt: string;
};

export class SpotDcaCommand {
  public static register(spot: Command): void {
    const dca = spot
      .command("dca")
      .description("Recurring (DCA) orders that split a buy over time");
    dca
      .command("open")
      .description("Create a recurring order")
      .requiredOption(
        "--from <token>",
        "Token to spend (symbol or mint address)"
      )
      .requiredOption("--to <token>", "Token to buy (symbol or mint address)")
      .option("--amount <n>", "Total amount to spend in human-readable units")
      .option(
        "--raw-amount <n>",
        "Total amount to spend in on-chain units (no decimal conversion)"
      )
      .requiredOption("--orders <n>", "Number of orders to split into (2-100)")
      .requiredOption(
        "--interval <duration>",
        "Time between orders, e.g. 30m, 1h, 1d, 1w, 1mo, or seconds"
      )
      .option(
        "--min-price <usd>",
        "Only buy when the --to token price is at or above this USD price"
      )
      .option(
        "--max-price <usd>",
        "Only buy when the --to token price is at or below this USD price"
      )
      .option(
        "--earn",
        "Earn Jupiter Lend yield on the unspent balance (USDC, USDT or JupUSD; time-based only)"
      )
      .option("--key <name>", "Key to use for signing")
      .action((opts) => this.open(opts));
    for (const [name, description] of [
      ["orders", "List active recurring orders"],
      ["history", "List past recurring orders"],
    ] as const) {
      dca
        .command(name)
        .description(description)
        .option("--key <name>", "Key to use (overrides active key)")
        .option("--address <address>", "Wallet address to look up (--v1 only)")
        .option("--token <token>", "Filter by token (symbol or mint address)")
        .option("--limit <n>", "Max number of results (max: 100)", "10")
        .option("--offset <n>", "Pagination offset", "0")
        .option("--v1", "List legacy V1 recurring orders")
        .action((opts) =>
          this.list(name === "orders" ? "active" : "past", opts)
        );
    }
    dca
      .command("close")
      .description("Cancel a recurring order and withdraw the unspent balance")
      .requiredOption("--order <id>", "Order ID to cancel")
      .option("--v1", "Cancel a legacy V1 recurring order")
      .option("--key <name>", "Key to use for signing")
      .action((opts) => this.close(opts));
  }

  private static async open(opts: {
    from: string;
    to: string;
    amount?: string;
    rawAmount?: string;
    orders: string;
    interval: string;
    minPrice?: string;
    maxPrice?: string;
    earn?: boolean;
    key?: string;
  }): Promise<void> {
    Swap.validateAmountOpts(opts);
    const intervalSeconds = parseInterval(opts.interval);

    const signer = await Signer.load(opts.key ?? Config.load().activeKey);
    const [inputToken, outputToken] = await Promise.all([
      resolveWalletAsset(signer.address, opts.from),
      DatapiClient.resolveToken(opts.to),
    ]);
    if (inputToken.id === outputToken.id) {
      throw new Error("--from and --to must be different tokens.");
    }
    const { jlMint, ...params } = buildDcaOrderParams({
      inputMint: inputToken.id,
      outputMint: outputToken.id,
      orderCount: Number(opts.orders),
      intervalSeconds,
      minPriceUsd:
        opts.minPrice !== undefined ? Number(opts.minPrice) : undefined,
      maxPriceUsd:
        opts.maxPrice !== undefined ? Number(opts.maxPrice) : undefined,
      earn: Boolean(opts.earn),
    });

    const multiplier = Swap.getScaledUiMultiplier(inputToken);
    const rawAmount =
      opts.rawAmount ??
      NumberConverter.toChainAmount(
        opts.amount!,
        inputToken.decimals,
        multiplier
      );
    const inAmount = NumberConverter.fromChainAmount(
      rawAmount,
      inputToken.decimals,
      multiplier
    );
    const inUsdValue =
      inputToken.usdPrice !== undefined
        ? Number(inAmount) * inputToken.usdPrice
        : undefined;
    assertMinDcaOrderUsd(inUsdValue, params.orderCount);

    const pair = await TriggerClient.checkMints({
      orderType: "dca",
      inputMint: inputToken.id,
      outputMint: outputToken.id,
      triggerMint: params.triggerMint,
    });
    if (!pair.dca.supported) {
      throw new Error(
        `Pair not supported for recurring orders: ${pair.dca.error}${pair.dca.reason ? ` (${pair.dca.reason})` : ""}`
      );
    }

    await TriggerClient.ensureVault(signer);
    const deposit = await TriggerClient.craftDeposit(signer, {
      inputMint: inputToken.id,
      outputMint: outputToken.id,
      userAddress: signer.address,
      amount: rawAmount,
      orderType: "dca",
      ...(jlMint && { jlMint }),
    });

    let order: { id: string; txSignature: string } | null = null;
    if (!Config.dryRun) {
      const signedTx = await signer.signTransaction(
        deposit.transaction as Base64EncodedBytes
      );
      order = await TriggerClient.createDcaOrder(signer, {
        ...params,
        depositRequestId: deposit.requestId,
        depositSignedTx: signedTx,
        userPubkey: signer.address,
        inputMint: inputToken.id,
        inputAmount: rawAmount,
        outputMint: outputToken.id,
      });
    }

    const inAmountPerOrder = NumberConverter.fromChainAmount(
      (BigInt(rawAmount) / BigInt(params.orderCount)).toString(),
      inputToken.decimals,
      multiplier
    );

    if (Output.isJson()) {
      Output.json({
        ...(Config.dryRun && { dryRun: true }),
        orderId: order?.id ?? null,
        inputToken: toTokenRef(inputToken),
        outputToken: toTokenRef(outputToken),
        inAmount,
        inUsdValue: inUsdValue ?? null,
        orderCount: params.orderCount,
        inAmountPerOrder,
        intervalSeconds,
        minPriceUsd: params.minPriceUsd ?? null,
        maxPriceUsd: params.maxPriceUsd ?? null,
        earn: Boolean(params.jlEnabled),
        signature: order?.txSignature ?? null,
        ...(Config.dryRun && { transaction: deposit.transaction }),
      });
      return;
    }

    if (Config.dryRun) {
      console.log(Output.DRY_RUN_LABEL);
    }
    Output.table({
      type: "vertical",
      rows: [
        ...(order ? [{ label: "Order ID", value: order.id }] : []),
        {
          label: "Spend",
          value: `${inAmount} ${inputToken.symbol} (${Output.formatDollar(inUsdValue)})`,
        },
        { label: "Buy", value: outputToken.symbol },
        {
          label: "Schedule",
          value: `${params.orderCount} orders of ${inAmountPerOrder} ${inputToken.symbol}, every ${this.formatInterval(intervalSeconds)}`,
        },
        {
          label: "Price Range",
          value: this.describePriceRange(
            params.minPriceUsd ?? null,
            params.maxPriceUsd ?? null,
            outputToken.symbol
          ),
        },
        { label: "Earn", value: Output.formatBoolean(params.jlEnabled) },
        ...(order ? [{ label: "Tx Signature", value: order.txSignature }] : []),
      ],
    });
  }

  private static async list(
    state: "active" | "past",
    opts: {
      key?: string;
      address?: string;
      token?: string;
      limit: string;
      offset: string;
      v1?: boolean;
    }
  ): Promise<void> {
    const { limit, offset } = SpotLimitCommand.parsePagination(opts);
    let views: DcaOrderView[];
    let total: number;
    let tokens: OrderTokens;

    if (opts.v1) {
      if (opts.token) {
        throw new Error("--token cannot be used with --v1.");
      }
      if (opts.address && opts.key) {
        throw new Error("Only one of --address or --key can be provided.");
      }
      const address =
        opts.address ??
        (await Signer.loadAddress(opts.key ?? Config.load().activeKey));
      const res = await TriggerClient.getV1DcaOrders({
        user: address,
        state,
        offset,
        limit,
      });
      tokens = await OrderTokens.load(
        res.orders.flatMap((o) => [o.inputMint, o.outputMint])
      );
      views = res.orders.map((o) => this.formatV1Order(o, state, tokens));
      total = res.total;
    } else {
      if (opts.address) {
        throw new Error(
          "--address requires --v1: V2 orders can only be read by signing in with a key (--key)."
        );
      }
      const signer = await Signer.load(opts.key ?? Config.load().activeKey);
      const mint = opts.token
        ? (await DatapiClient.resolveToken(opts.token)).id
        : undefined;
      const res = await TriggerClient.getDcaOrders(signer, {
        state,
        limit,
        offset,
        mint,
      });
      tokens = await OrderTokens.load(
        res.orders.flatMap((o) => [o.inputMint, o.outputMint])
      );
      views = res.orders.map((o) => this.formatOrder(o, tokens));
      total = res.pagination.total;
    }

    const next =
      offset + views.length < total ? offset + views.length : undefined;
    if (Output.isJson()) {
      Output.json({
        count: total,
        orders: views,
        ...(next !== undefined && { next }),
      });
      return;
    }

    Output.table({
      type: "horizontal",
      headers: {
        orderId: "Order ID",
        state: "State",
        spend: "Spend",
        bought: "Bought",
        progress: "Orders",
        interval: "Every",
        next: "Next Order",
      },
      rows: views.map((o) => ({
        orderId: o.orderId,
        state: o.state,
        spend: `${o.inAmount ?? "?"} ${tokens.symbol(o.inputToken.id)}`,
        bought: `${o.outAmount ?? "0"} ${tokens.symbol(o.outputToken.id)}`,
        progress: `${o.ordersFilled}/${o.orderCount}`,
        interval: this.formatInterval(o.intervalSeconds),
        next: o.nextOrderAt
          ? new Date(o.nextOrderAt).toLocaleString()
          : chalk.gray("—"),
      })),
    });
    if (next) {
      console.log("\nNext offset:", next);
    }
  }

  private static async close(opts: {
    order: string;
    v1?: boolean;
    key?: string;
  }): Promise<void> {
    if (opts.v1) {
      throw new Error(
        "Closing V1 recurring orders is not supported by the CLI: the transaction must be built client-side with the DCA program SDK. Close it at https://jup.ag/recurring instead."
      );
    }
    const signer = await Signer.load(opts.key ?? Config.load().activeKey);
    const order = await TriggerClient.getDcaOrder(signer, opts.order);
    const tokens = await OrderTokens.load([order.inputMint]);
    const cancel = await TriggerClient.cancelOrder(signer, "dca", order.id);
    const refundAmount = tokens.uiAmount(
      order.inputMint,
      cancel.refundAmount ?? order.inputAmountRemaining
    );

    let signature: string | null = null;
    if (!Config.dryRun) {
      const signedTx = await signer.signTransaction(
        cancel.transaction as Base64EncodedBytes
      );
      const res = await TriggerClient.confirmCancelOrder(
        signer,
        "dca",
        order.id,
        { signedTransaction: signedTx, cancelRequestId: cancel.requestId }
      );
      signature = res.txSignature;
    }

    if (Output.isJson()) {
      Output.json({
        ...(Config.dryRun && { dryRun: true }),
        orderId: order.id,
        inputToken: tokens.ref(order.inputMint),
        remainingInAmount: refundAmount,
        ordersRemaining: cancel.roundsRemaining ?? null,
        signature,
        ...(Config.dryRun && { transaction: cancel.transaction }),
      });
      return;
    }

    if (Config.dryRun) {
      console.log(Output.DRY_RUN_LABEL);
    }
    Output.table({
      type: "vertical",
      rows: [
        { label: "Order ID", value: order.id },
        {
          label: "Withdraw",
          value: `${refundAmount ?? "?"} ${tokens.symbol(order.inputMint)}`,
        },
        ...(signature ? [{ label: "Tx Signature", value: signature }] : []),
      ],
    });
  }

  private static formatOrder(o: DcaOrder, tokens: OrderTokens): DcaOrderView {
    return {
      orderId: o.id,
      state: o.displayState,
      inputToken: tokens.ref(o.inputMint),
      outputToken: tokens.ref(o.outputMint),
      inAmount: tokens.uiAmount(o.inputMint, o.inputAmountInitial),
      remainingInAmount: tokens.uiAmount(o.inputMint, o.inputAmountRemaining),
      inAmountPerOrder: tokens.uiAmount(o.inputMint, o.amountPerRound),
      outAmount: tokens.uiAmount(o.outputMint, o.outputAmountTotal),
      orderCount: o.numberOfRounds,
      ordersFilled: o.roundsFilled,
      intervalSeconds: o.intervalSeconds,
      minPriceUsd: o.minPriceUsd,
      maxPriceUsd: o.maxPriceUsd,
      earn: Boolean(o.jlEnabled),
      earnedUsd: o.jlYieldUsd ?? null,
      nextOrderAt: o.nextFillAt,
      createdAt: o.createdAt,
    };
  }

  private static formatV1Order(
    o: V1DcaOrder,
    state: "active" | "past",
    tokens: OrderTokens
  ): DcaOrderView {
    const perOrder = Number(o.inAmountPerCycle);
    const deposited = Number(o.inDeposited);
    const used = Number(o.inUsed);
    const remaining = deposited - used - Number(o.inWithdrawn);
    return {
      orderId: o.orderKey,
      state:
        state === "active"
          ? "active"
          : o.userClosed
            ? "cancelled"
            : "completed",
      inputToken: tokens.ref(o.inputMint),
      outputToken: tokens.ref(o.outputMint),
      inAmount: o.inDeposited,
      remainingInAmount: String(Math.max(remaining, 0)),
      inAmountPerOrder: o.inAmountPerCycle,
      outAmount: o.outReceived,
      orderCount: perOrder > 0 ? Math.round(deposited / perOrder) : 0,
      ordersFilled: perOrder > 0 ? Math.round(used / perOrder) : 0,
      intervalSeconds: Number(o.cycleFrequency),
      minPriceUsd: null,
      maxPriceUsd: null,
      earn: false,
      earnedUsd: null,
      nextOrderAt: null,
      createdAt: new Date(o.createdAt).toISOString(),
    };
  }

  private static formatInterval(seconds: number): string {
    for (const [unit, size] of [
      ["week", 604_800],
      ["day", 86_400],
      ["hour", 3_600],
      ["minute", 60],
    ] as const) {
      if (seconds % size === 0) {
        const n = seconds / size;
        return n === 1 ? unit : `${n} ${unit}s`;
      }
    }
    return `${seconds}s`;
  }

  private static describePriceRange(
    min: number | null,
    max: number | null,
    symbol: string
  ): string {
    if (min === null && max === null) {
      return chalk.gray("—");
    }
    if (min !== null && max !== null) {
      return `${symbol} between ${Output.formatDollar(min)} and ${Output.formatDollar(max)}`;
    }
    return min !== null
      ? `${symbol} at or above ${Output.formatDollar(min)}`
      : `${symbol} at or below ${Output.formatDollar(max!)}`;
  }
}
