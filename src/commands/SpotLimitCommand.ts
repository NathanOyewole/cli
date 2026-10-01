import type { Base64EncodedBytes } from "@solana/kit";
import chalk from "chalk";
import type { Command } from "commander";

import { DatapiClient } from "../clients/DatapiClient.ts";
import {
  TriggerClient,
  type PriceOrder,
  type PriceOrderParams,
  type PriceOrderPatch,
  type V1TriggerOrder,
} from "../clients/TriggerClient.ts";
import { resolveWalletAsset } from "../lib/Asset.ts";
import { Config } from "../lib/Config.ts";
import { NumberConverter } from "../lib/NumberConverter.ts";
import { OrderTokens, toTokenRef, type TokenRef } from "../lib/OrderTokens.ts";
import { Output } from "../lib/Output.ts";
import { Signer } from "../lib/Signer.ts";
import { Swap } from "../lib/Swap.ts";
import {
  DEFAULT_EXPIRY,
  DRY_RUN_CANCEL_NOTE,
  LIMIT_INTENTS,
  assertIntentPair,
  assertMinOrderUsd,
  buildPriceOrderParams,
  getTriggerSide,
  parseExpiry,
  parseIntent,
  resolveTargetPrice,
  type LimitIntent,
} from "../lib/TriggerOrder.ts";

type OrderParamsView = {
  triggerCondition: "above" | "below" | null;
  triggerPriceUsd: number | null;
  trailingBps: number | null;
  tpPriceUsd: number | null;
  slPriceUsd: number | null;
  slippageBps: number | null;
  tpSlippageBps: number | null;
  slSlippageBps: number | null;
};

type LimitOrderView = OrderParamsView & {
  orderId: string;
  intent: LimitIntent | null;
  orderType: PriceOrder["orderType"] | "v1";
  state: string;
  inputToken: TokenRef;
  outputToken: TokenRef;
  triggerToken: TokenRef | null;
  inAmount: string | null;
  remainingInAmount: string | null;
  outAmount: string | null;
  fillPct: number | null;
  expiresAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type ListOpts = {
  key?: string;
  address?: string;
  token?: string;
  limit: string;
  offset: string;
  v1?: boolean;
};

export class SpotLimitCommand {
  public static register(spot: Command): void {
    const limit = spot
      .command("limit")
      .description(
        "Limit orders: take-profit, stop-loss, buy the dip/pump, trailing stop, OCO, OTOCO"
      );
    limit
      .command("open")
      .description("Place a limit order")
      .requiredOption(
        "--from <token>",
        "Token to sell (symbol or mint address)"
      )
      .requiredOption("--to <token>", "Token to buy (symbol or mint address)")
      .requiredOption(
        "--intent <intent>",
        `One of: ${LIMIT_INTENTS.join(", ")}`
      )
      .option("--amount <n>", "Amount to sell in human-readable units")
      .option(
        "--raw-amount <n>",
        "Amount to sell in on-chain units (no decimal conversion)"
      )
      .option(
        "--price <usd>",
        "Trigger price in USD, or percent from market (e.g. -10%); entry price for otoco"
      )
      .option(
        "--tp <usd>",
        "Take-profit price for oco/otoco (USD or percent, relative to entry for otoco)"
      )
      .option(
        "--sl <usd>",
        "Stop-loss price for oco/otoco (USD or percent, relative to entry for otoco)"
      )
      .option("--trailing <pct>", "Trailing distance in percent (0.5-90)")
      .option("--mcap", "Read --price, --tp and --sl as market cap in USD")
      .option(
        "--slippage <bps>",
        "Max slippage in basis points (defaults: 2000 for stop-loss legs and buy-pump, otherwise auto)"
      )
      .option(
        "--expiry <duration>",
        "Time until the order expires: 1h, 1d, 7d, 30d or custom (e.g. 12h)",
        DEFAULT_EXPIRY
      )
      .option("--key <name>", "Key to use for signing")
      .action((opts) => this.open(opts));
    for (const [name, description] of [
      ["orders", "List open limit orders"],
      ["history", "List past limit orders"],
    ] as const) {
      limit
        .command(name)
        .description(description)
        .option("--key <name>", "Key to use (overrides active key)")
        .option("--address <address>", "Wallet address to look up (--v1 only)")
        .option("--token <token>", "Filter by token (symbol or mint address)")
        .option("--limit <n>", "Max number of results (max: 100)", "10")
        .option("--offset <n>", "Pagination offset", "0")
        .option("--v1", "List legacy V1 limit orders")
        .action((opts) =>
          this.list(name === "orders" ? "active" : "past", opts)
        );
    }
    limit
      .command("set")
      .description("Update an open limit order's prices or slippage")
      .requiredOption("--order <id>", "Order ID to update")
      .option("--price <usd>", "New trigger/entry price (USD or percent)")
      .option("--tp <usd>", "New take-profit price (USD or percent)")
      .option("--sl <usd>", "New stop-loss price (USD or percent)")
      .option("--trailing <pct>", "New trailing distance in percent")
      .option("--mcap", "Read --price, --tp and --sl as market cap in USD")
      .option("--slippage <bps>", "New max slippage in basis points")
      .option("--key <name>", "Key to use for signing in")
      .action((opts) => this.set(opts));
    limit
      .command("close")
      .description("Cancel a limit order and withdraw its funds")
      .requiredOption(
        "--order <id>",
        "Order ID to cancel ('all' cancels every V1 order with --v1)"
      )
      .option("--v1", "Cancel legacy V1 limit orders")
      .option("--key <name>", "Key to use for signing")
      .action((opts) => this.close(opts));
  }

  private static async open(opts: {
    from: string;
    to: string;
    intent: string;
    amount?: string;
    rawAmount?: string;
    price?: string;
    tp?: string;
    sl?: string;
    trailing?: string;
    mcap?: boolean;
    slippage?: string;
    expiry: string;
    key?: string;
  }): Promise<void> {
    Swap.validateAmountOpts(opts);
    const intent = parseIntent(opts.intent);
    const expiresAt = parseExpiry(opts.expiry, Date.now());
    const slippageBps = this.parseSlippage(opts.slippage);

    const signer = await Signer.load(opts.key ?? Config.load().activeKey);
    const [inputToken, outputToken] = await Promise.all([
      resolveWalletAsset(signer.address, opts.from),
      DatapiClient.resolveToken(opts.to),
    ]);
    if (inputToken.id === outputToken.id) {
      throw new Error("--from and --to must be different tokens.");
    }
    assertIntentPair(intent, inputToken.id, outputToken.id);
    const triggerToken =
      getTriggerSide(intent) === "input" ? inputToken : outputToken;
    const target = (
      value: string | undefined,
      optionName: string,
      referencePriceUsd: number | undefined
    ) =>
      value === undefined
        ? undefined
        : resolveTargetPrice(value, {
            optionName,
            referencePriceUsd,
            circSupply: triggerToken.circSupply,
            mcap: Boolean(opts.mcap),
          });
    const priceUsd = target(opts.price, "--price", triggerToken.usdPrice);
    const exitReferenceUsd =
      intent === "otoco" ? priceUsd : triggerToken.usdPrice;
    const params = buildPriceOrderParams({
      intent,
      triggerMint: triggerToken.id,
      marketPriceUsd: triggerToken.usdPrice,
      priceUsd,
      tpPriceUsd: target(opts.tp, "--tp", exitReferenceUsd),
      slPriceUsd: target(opts.sl, "--sl", exitReferenceUsd),
      trailingPct:
        opts.trailing !== undefined ? Number(opts.trailing) : undefined,
      slippageBps,
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
    assertMinOrderUsd(inUsdValue);

    const pair = await TriggerClient.checkMints({
      orderType: "price",
      inputMint: inputToken.id,
      outputMint: outputToken.id,
      triggerMint: triggerToken.id,
    });
    if (!pair.price.supported) {
      throw new Error(
        `Pair not supported for limit orders: ${pair.price.error}${pair.price.reason ? ` (${pair.price.reason})` : ""}`
      );
    }

    await TriggerClient.ensureVault(signer);
    const deposit = await TriggerClient.craftDeposit(signer, {
      inputMint: inputToken.id,
      outputMint: outputToken.id,
      userAddress: signer.address,
      amount: rawAmount,
      orderType: "price",
      orderSubType: params.orderType,
    });

    let order: { id: string; txSignature: string } | null = null;
    if (!Config.dryRun) {
      const signedTx = await signer.signTransaction(
        deposit.transaction as Base64EncodedBytes
      );
      const res = await TriggerClient.createPriceOrder(signer, {
        ...params,
        depositRequestId: deposit.requestId,
        depositSignedTx: signedTx,
        userPubkey: signer.address,
        inputMint: inputToken.id,
        inputAmount: rawAmount,
        outputMint: outputToken.id,
        expiresAt,
      });
      if (!res.depositConfirmed) {
        throw new Error(
          `Order ${res.id} was created but its deposit is not confirmed yet${res.message ? ` (${res.message})` : ""}. Check \`jup spot limit orders\`.`
        );
      }
      order = res;
    }

    const result = {
      ...(Config.dryRun && { dryRun: true }),
      orderId: order?.id ?? null,
      intent,
      orderType: params.orderType,
      inputToken: toTokenRef(inputToken),
      outputToken: toTokenRef(outputToken),
      triggerToken: toTokenRef(triggerToken),
      inAmount,
      inUsdValue: inUsdValue ?? null,
      ...this.formatParams(params),
      expiresAt: new Date(expiresAt).toISOString(),
      signature: order?.txSignature ?? null,
      ...(Config.dryRun && { transaction: deposit.transaction }),
    };

    if (Output.isJson()) {
      Output.json(result);
      return;
    }

    if (Config.dryRun) {
      console.log(Output.DRY_RUN_LABEL);
    }
    Output.table({
      type: "vertical",
      rows: [
        ...(order ? [{ label: "Order ID", value: order.id }] : []),
        { label: "Intent", value: intent },
        {
          label: "Sell",
          value: `${inAmount} ${inputToken.symbol} (${Output.formatDollar(inUsdValue)})`,
        },
        { label: "Buy", value: outputToken.symbol },
        {
          label: "Trigger",
          value: this.describeTrigger(result, triggerToken.symbol),
        },
        { label: "Slippage", value: this.describeSlippage(result) },
        {
          label: "Expires",
          value: new Date(expiresAt).toLocaleString(),
        },
        ...(order ? [{ label: "Tx Signature", value: order.txSignature }] : []),
      ],
    });
  }

  private static async list(
    state: "active" | "past",
    opts: ListOpts
  ): Promise<void> {
    const { limit, offset } = this.parsePagination(opts);
    const mint = opts.token
      ? (await DatapiClient.resolveToken(opts.token)).id
      : undefined;

    if (opts.v1) {
      const address = await this.resolveV1Address(opts);
      const { orders, total } = await TriggerClient.getV1TriggerOrders({
        user: address,
        state,
        mint,
        offset,
        limit,
      });
      const tokens = await OrderTokens.load(
        orders.flatMap((o) => [o.inputMint, o.outputMint])
      );
      this.printList(
        orders.map((o) => this.formatV1Order(o, tokens)),
        total,
        offset,
        tokens
      );
      return;
    }

    if (opts.address) {
      throw new Error(
        "--address requires --v1: V2 orders can only be read by signing in with a key (--key)."
      );
    }
    const signer = await Signer.load(opts.key ?? Config.load().activeKey);
    const res = await TriggerClient.getPriceOrders(signer, {
      state,
      limit,
      offset,
      mint,
    });
    const tokens = await OrderTokens.load(
      res.orders.flatMap((o) => [o.inputMint, o.outputMint, o.triggerMint])
    );
    this.printList(
      res.orders.map((o) => this.formatOrder(o, tokens)),
      res.pagination.total,
      offset,
      tokens
    );
  }

  private static printList(
    orders: LimitOrderView[],
    total: number,
    offset: number,
    tokens: OrderTokens
  ): void {
    const next =
      offset + orders.length < total ? offset + orders.length : undefined;

    if (Output.isJson()) {
      Output.json({
        count: total,
        orders,
        ...(next !== undefined && { next }),
      });
      return;
    }

    Output.table({
      type: "horizontal",
      headers: {
        orderId: "Order ID",
        intent: "Intent",
        state: "State",
        sell: "Sell",
        buy: "Buy",
        trigger: "Trigger",
        filled: "Filled",
        expiresAt: "Expires",
      },
      rows: orders.map((o) => ({
        orderId: o.orderId,
        intent: o.intent ?? chalk.gray("v1"),
        state: o.state,
        sell: `${o.inAmount ?? "?"} ${tokens.symbol(o.inputToken.id)}`,
        buy:
          o.outAmount !== null
            ? `${o.outAmount} ${tokens.symbol(o.outputToken.id)}`
            : tokens.symbol(o.outputToken.id),
        trigger: this.describeTrigger(
          o,
          o.triggerToken ? tokens.symbol(o.triggerToken.id) : ""
        ),
        filled:
          o.fillPct !== null ? `${o.fillPct.toFixed(0)}%` : chalk.gray("—"),
        expiresAt: o.expiresAt
          ? new Date(o.expiresAt).toLocaleString()
          : chalk.gray("—"),
      })),
    });
    if (next) {
      console.log("\nNext offset:", next);
    }
  }

  private static async set(opts: {
    order: string;
    price?: string;
    tp?: string;
    sl?: string;
    trailing?: string;
    mcap?: boolean;
    slippage?: string;
    key?: string;
  }): Promise<void> {
    const slippageBps = this.parseSlippage(opts.slippage);
    const signer = await Signer.load(opts.key ?? Config.load().activeKey);
    const order = await TriggerClient.getPriceOrder(signer, opts.order);
    const isTrailing = order.trailingBps != null;
    const allowed: Record<string, boolean> = {
      "--price": order.orderType !== "oco" && !isTrailing,
      "--tp": order.orderType !== "single",
      "--sl": order.orderType !== "single",
      "--trailing": isTrailing,
    };
    for (const [flag, value] of [
      ["--price", opts.price],
      ["--tp", opts.tp],
      ["--sl", opts.sl],
      ["--trailing", opts.trailing],
    ] as const) {
      if (value !== undefined && !allowed[flag]) {
        throw new Error(
          `${flag} cannot be changed on a ${isTrailing ? "trailing-stop" : order.orderType} order.`
        );
      }
    }

    const triggerToken = await DatapiClient.resolveToken(order.triggerMint);
    const target = (
      value: string | undefined,
      optionName: string,
      referencePriceUsd: number | undefined
    ) =>
      value === undefined
        ? undefined
        : resolveTargetPrice(value, {
            optionName,
            referencePriceUsd,
            circSupply: triggerToken.circSupply,
            mcap: Boolean(opts.mcap),
          });
    const triggerPriceUsd = target(
      opts.price,
      "--price",
      triggerToken.usdPrice
    );
    const exitReferenceUsd =
      order.orderType === "otoco"
        ? (triggerPriceUsd ?? order.triggerPriceUsd ?? undefined)
        : triggerToken.usdPrice;
    let trailingBps: number | undefined;
    if (opts.trailing !== undefined) {
      trailingBps = buildPriceOrderParams({
        intent: "trailing-stop",
        triggerMint: order.triggerMint,
        marketPriceUsd: triggerToken.usdPrice,
        trailingPct: Number(opts.trailing),
      }).trailingBps;
    }

    const patch: PriceOrderPatch = {
      orderType: order.orderType,
      ...(triggerPriceUsd !== undefined && { triggerPriceUsd }),
      ...(trailingBps !== undefined && { trailingBps }),
      ...(opts.tp !== undefined && {
        tpPriceUsd: target(opts.tp, "--tp", exitReferenceUsd),
      }),
      ...(opts.sl !== undefined && {
        slPriceUsd: target(opts.sl, "--sl", exitReferenceUsd),
      }),
      ...(slippageBps !== undefined &&
        (order.orderType === "oco"
          ? { tpSlippageBps: slippageBps, slSlippageBps: slippageBps }
          : order.orderType === "otoco"
            ? {
                slippageBps,
                ...(order.tpPriceUsd != null && { tpSlippageBps: slippageBps }),
                ...(order.slPriceUsd != null && { slSlippageBps: slippageBps }),
              }
            : { slippageBps })),
    };
    if (Object.keys(patch).length === 1) {
      throw new Error(
        "Provide at least one of --price, --tp, --sl, --trailing or --slippage."
      );
    }

    if (!Config.dryRun) {
      await TriggerClient.patchPriceOrder(signer, order.id, patch);
    }

    const { orderType, ...updates } = patch;
    if (Output.isJson()) {
      Output.json({
        ...(Config.dryRun && { dryRun: true }),
        orderId: order.id,
        orderType,
        ...updates,
      });
      return;
    }

    if (Config.dryRun) {
      console.log(Output.DRY_RUN_LABEL);
    }
    const labels: Record<string, string> = {
      triggerPriceUsd: "Trigger Price",
      trailingBps: "Trailing",
      tpPriceUsd: "Take Profit",
      slPriceUsd: "Stop Loss",
      slippageBps: "Slippage",
      tpSlippageBps: "TP Slippage",
      slSlippageBps: "SL Slippage",
    };
    Output.table({
      type: "vertical",
      rows: [
        { label: "Order ID", value: order.id },
        ...Object.entries(updates).map(([key, value]) => ({
          label: labels[key] ?? key,
          value: key.endsWith("Bps")
            ? `${Number(value) / 100}%`
            : Output.formatDollar(Number(value)),
        })),
      ],
    });
  }

  private static async close(opts: {
    order: string;
    v1?: boolean;
    key?: string;
  }): Promise<void> {
    const signer = await Signer.load(opts.key ?? Config.load().activeKey);
    if (opts.v1) {
      await this.closeV1(signer, opts.order);
      return;
    }
    if (opts.order === "all") {
      throw new Error(
        "--order all is only supported with --v1. Cancel V2 orders one at a time."
      );
    }

    const order = await TriggerClient.getPriceOrder(signer, opts.order);
    const tokens = await OrderTokens.load([order.inputMint]);
    const remainingInAmount = tokens.uiAmount(
      order.inputMint,
      order.remainingInputAmount
    );

    // Requesting the cancel transaction already moves the order to
    // ready_to_cancel server-side, which stops it from filling, so a dry run
    // must not request it.
    let signature: string | null = null;
    if (!Config.dryRun) {
      const cancel = await TriggerClient.cancelOrder(signer, "price", order.id);
      const signedTx = await signer.signTransaction(
        cancel.transaction as Base64EncodedBytes
      );
      const res = await TriggerClient.confirmCancelOrder(
        signer,
        "price",
        order.id,
        { signedTransaction: signedTx, cancelRequestId: cancel.requestId }
      );
      signature = res.txSignature;
    }

    if (Output.isJson()) {
      Output.json({
        ...(Config.dryRun && { dryRun: true }),
        orderId: order.id,
        state: order.orderState,
        inputToken: tokens.ref(order.inputMint),
        remainingInAmount,
        signature,
        ...(Config.dryRun && { transaction: null }),
      });
      return;
    }

    if (Config.dryRun) {
      console.log(Output.DRY_RUN_LABEL);
      console.log(DRY_RUN_CANCEL_NOTE);
    }
    Output.table({
      type: "vertical",
      rows: [
        { label: "Order ID", value: order.id },
        { label: "State", value: order.orderState },
        {
          label: "Withdraw",
          value: `${remainingInAmount ?? "?"} ${tokens.symbol(order.inputMint)}`,
        },
        ...(signature ? [{ label: "Tx Signature", value: signature }] : []),
      ],
    });
  }

  private static async closeV1(signer: Signer, orderId: string): Promise<void> {
    let orderIds = [orderId];
    if (orderId === "all") {
      const { orders } = await TriggerClient.getV1TriggerOrders({
        user: signer.address,
        state: "active",
        offset: 0,
        limit: 1000,
      });
      if (orders.length === 0) {
        throw new Error("No open V1 limit orders to cancel.");
      }
      orderIds = orders.map((o) => o.orderKey);
    }

    const { transactions, requestId } = await TriggerClient.postV1CancelOrders({
      maker: signer.address,
      orders: orderIds,
    });

    const signatures: string[] = [];
    if (!Config.dryRun) {
      for (const tx of transactions) {
        const signedTx = await signer.signTransaction(tx as Base64EncodedBytes);
        const res = await TriggerClient.postV1Execute({
          signedTransaction: signedTx,
          requestId,
        });
        if (res.status === "Failed") {
          const landed = signatures.length
            ? ` Already landed: ${signatures.join(", ")}.`
            : "";
          throw new Error(
            `Cancel transaction failed: ${res.error ?? `code ${res.code}`} (signature ${res.signature ?? Signer.signatureOf(signedTx)}).${landed}`
          );
        }
        signatures.push(res.signature ?? Signer.signatureOf(signedTx));
      }
    }

    if (Output.isJson()) {
      Output.json({
        ...(Config.dryRun && { dryRun: true }),
        orderIds,
        signatures: Config.dryRun ? null : signatures,
        ...(Config.dryRun && { transactions }),
      });
      return;
    }

    if (Config.dryRun) {
      console.log(Output.DRY_RUN_LABEL);
    }
    Output.table({
      type: "vertical",
      rows: [
        { label: "Orders", value: orderIds.join("\n") },
        { label: "Transactions", value: String(transactions.length) },
        ...signatures.map((sig, i) => ({
          label:
            signatures.length === 1 ? "Tx Signature" : `Tx Signature ${i + 1}`,
          value: sig,
        })),
      ],
    });
  }

  private static formatParams(params: PriceOrderParams): OrderParamsView {
    return {
      triggerCondition: params.triggerCondition ?? null,
      triggerPriceUsd: params.triggerPriceUsd ?? null,
      trailingBps: params.trailingBps ?? null,
      tpPriceUsd: params.tpPriceUsd ?? null,
      slPriceUsd: params.slPriceUsd ?? null,
      slippageBps: params.slippageBps ?? null,
      tpSlippageBps: params.tpSlippageBps ?? null,
      slSlippageBps: params.slSlippageBps ?? null,
    };
  }

  private static formatOrder(
    o: PriceOrder,
    tokens: OrderTokens
  ): LimitOrderView {
    return {
      orderId: o.id,
      intent: this.inferIntent(o),
      orderType: o.orderType,
      state: o.orderState,
      inputToken: tokens.ref(o.inputMint),
      outputToken: tokens.ref(o.outputMint),
      triggerToken: tokens.ref(o.triggerMint),
      inAmount: tokens.uiAmount(o.inputMint, o.initialInputAmount),
      remainingInAmount: tokens.uiAmount(o.inputMint, o.remainingInputAmount),
      outAmount: tokens.uiAmount(
        o.outputMint,
        o.outputAmount ?? o.tpOutputAmount ?? o.slOutputAmount
      ),
      ...this.formatParams({
        orderType: o.orderType,
        triggerMint: o.triggerMint,
        triggerCondition: o.triggerCondition,
        triggerPriceUsd: o.triggerPriceUsd ?? undefined,
        trailingBps: o.trailingBps ?? undefined,
        tpPriceUsd: o.tpPriceUsd ?? undefined,
        slPriceUsd: o.slPriceUsd ?? undefined,
        slippageBps: o.slippageBps ?? undefined,
        tpSlippageBps: o.tpSlippageBps ?? undefined,
        slSlippageBps: o.slSlippageBps ?? undefined,
      }),
      fillPct: o.fillPercent != null ? o.fillPercent * 100 : null,
      expiresAt: this.toIso(o.expiresAt),
      createdAt: this.toIso(o.createdAt),
      updatedAt: this.toIso(o.updatedAt),
    };
  }

  private static formatV1Order(
    o: V1TriggerOrder,
    tokens: OrderTokens
  ): LimitOrderView {
    const making = Number(o.makingAmount);
    const remaining = Number(o.remainingMakingAmount);
    return {
      orderId: o.orderKey,
      intent: null,
      orderType: "v1",
      state: o.status.toLowerCase(),
      inputToken: tokens.ref(o.inputMint),
      outputToken: tokens.ref(o.outputMint),
      triggerToken: null,
      inAmount: o.makingAmount,
      remainingInAmount: o.remainingMakingAmount,
      outAmount: o.takingAmount,
      triggerCondition: null,
      triggerPriceUsd: null,
      trailingBps: null,
      tpPriceUsd: null,
      slPriceUsd: null,
      slippageBps: null,
      tpSlippageBps: null,
      slSlippageBps: null,
      fillPct: making > 0 ? ((making - remaining) / making) * 100 : null,
      expiresAt: o.expiredAt ? new Date(o.expiredAt).toISOString() : null,
      createdAt: new Date(o.createdAt).toISOString(),
      updatedAt: null,
    };
  }

  private static inferIntent(o: PriceOrder): LimitIntent {
    if (o.orderType !== "single") {
      return o.orderType;
    }
    if (o.trailingBps != null) {
      return "trailing-stop";
    }
    const sell = o.triggerMint === o.inputMint;
    if (o.triggerCondition === "above") {
      return sell ? "take-profit" : "buy-pump";
    }
    return sell ? "stop-loss" : "buy-dip";
  }

  private static describeTrigger(o: OrderParamsView, symbol: string): string {
    const parts: string[] = [];
    if (o.trailingBps !== null) {
      parts.push(`${symbol} trails ${o.trailingBps / 100}%`);
    } else if (o.triggerPriceUsd !== null) {
      parts.push(
        `${symbol} ${o.triggerCondition ?? ""} ${Output.formatDollar(o.triggerPriceUsd)}`
      );
    }
    const exits = [
      o.tpPriceUsd !== null ? `TP ${Output.formatDollar(o.tpPriceUsd)}` : null,
      o.slPriceUsd !== null ? `SL ${Output.formatDollar(o.slPriceUsd)}` : null,
    ].filter(Boolean);
    if (exits.length > 0) {
      parts.push(
        `${parts.length > 0 ? "then " : `${symbol} `}${exits.join(" / ")}`
      );
    }
    return parts.length > 0 ? parts.join(" ") : chalk.gray("—");
  }

  private static describeSlippage(
    o: OrderParamsView & { orderType: string }
  ): string {
    const fmt = (bps: number | null) =>
      bps === null ? "auto" : `${bps / 100}%`;
    const parts: string[] = [];
    if (o.orderType !== "oco") {
      parts.push(fmt(o.slippageBps));
    }
    if (o.tpPriceUsd !== null) {
      parts.push(`TP ${fmt(o.tpSlippageBps)}`);
    }
    if (o.slPriceUsd !== null) {
      parts.push(`SL ${fmt(o.slSlippageBps)}`);
    }
    return parts.join(", ");
  }

  private static async resolveV1Address(opts: ListOpts): Promise<string> {
    if (opts.address && opts.key) {
      throw new Error("Only one of --address or --key can be provided.");
    }
    return (
      opts.address ??
      (await Signer.loadAddress(opts.key ?? Config.load().activeKey))
    );
  }

  public static parsePagination(opts: { limit: string; offset: string }): {
    limit: number;
    offset: number;
  } {
    const limit = Number(opts.limit);
    const offset = Number(opts.offset);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("--limit must be an integer between 1 and 100.");
    }
    if (!Number.isInteger(offset) || offset < 0) {
      throw new Error("--offset must be a non-negative integer.");
    }
    return { limit, offset };
  }

  private static parseSlippage(value: string | undefined): number | undefined {
    if (value === undefined) {
      return undefined;
    }
    const bps = Number(value);
    if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
      throw new Error(
        "--slippage must be an integer between 0 and 10000 (bps)."
      );
    }
    return bps;
  }

  // The API returns epoch milliseconds; 0 means no expiry.
  private static toIso(ms: number | null | undefined): string | null {
    return ms ? new Date(ms).toISOString() : null;
  }
}
