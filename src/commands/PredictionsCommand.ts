import chalk from "chalk";
import type { Command } from "commander";

import {
  PredictionsClient,
  type CreateOrderResponse,
  type PredictionEvent,
  type PredictionPosition,
  type Provider,
} from "../clients/PredictionsClient.ts";
import { resolveWalletAsset } from "../lib/Asset.ts";
import { Config } from "../lib/Config.ts";
import { NumberConverter } from "../lib/NumberConverter.ts";
import { Output } from "../lib/Output.ts";
import {
  PredictionsExecution,
  type OrderFill,
} from "../lib/PredictionsExecution.ts";
import { PredictionsFormat } from "../lib/PredictionsFormat.ts";
import { Signer } from "../lib/Signer.ts";
import { PredictionsAccountCommand } from "./PredictionsAccountCommand.ts";
import { PredictionsArcadeCommand } from "./PredictionsArcadeCommand.ts";
import { PredictionsCommunityCommand } from "./PredictionsCommunityCommand.ts";
import { PredictionsDiscoveryCommand } from "./PredictionsDiscoveryCommand.ts";

const MICRO = 1_000_000;
const SELL_PRICE_BUFFER_MICRO = 20_000;
const MIN_SELL_PRICE_MICRO = 10_000;
/** Resting limit orders rarely fill at once, so don't hold the command for the full market-order wait. */
const LIMIT_FILL_TIMEOUT_MS = 15_000;

/** Smallest partial-sell step per venue, in micro-contracts (Saba can't be sold early). */
const PARTIAL_SELL_STEP_MICRO: Record<Provider, number | null> = {
  kalshi: MICRO,
  polymarket: 10_000,
  bisonfi: 1,
  gx: null,
};

export class PredictionsCommand {
  public static register(program: Command): void {
    const predictions = program
      .command("predictions")
      .description("Prediction markets");
    predictions
      .command("events")
      .description("Browse prediction events")
      .option(
        "--id <eventId>",
        "Look up events by ID (comma-separated for several)"
      )
      .option("--search <query>", "Search events by title")
      .option("--filter <filter>", "Filter: new, live, trending")
      .option(
        "--sort <sort>",
        "Sort by: volume, volume24h, recent",
        "volume24h"
      )
      .option(
        "--category <category>",
        "Category: all, crypto, sports, politics, esports, culture, economics, tech",
        "all"
      )
      .option(
        "--subcategory <list>",
        "Comma-separated subcategories (see predictions categories)"
      )
      .option(
        "--tags <list>",
        "Comma-separated tags (see predictions categories)"
      )
      .option("--offset <n>", "Pagination offset", "0")
      .option("--limit <n>", "Max results", "10")
      .action((opts) => this.events(opts));
    predictions
      .command("positions")
      .description("View open prediction positions")
      .option("--position <pubkey>", "Look up a single position by pubkey")
      .option("--key <name>", "Key to use (overrides active key)")
      .option("--address <address>", "Wallet address to look up")
      .action((opts) => this.positions(opts));
    predictions
      .command("open")
      .description("Open a prediction position (market or limit buy)")
      .requiredOption(
        "--market <marketId>",
        "Market ID from predictions events"
      )
      .requiredOption("--side <side>", "Side: yes, no, y, n")
      .requiredOption(
        "--amount <number>",
        "Input token amount (human-readable)"
      )
      .option("--input <token>", "Input token (symbol or mint)", "USDC")
      .option(
        "--limit <price>",
        "Limit buy at this max price per contract in USD, e.g. 0.42 (Polymarket markets)"
      )
      .option(
        "--slippage <bps>",
        "Accept a quoted slippage up to this many bps (required when the quote is 5% or more)"
      )
      .option("--key <name>", "Key to use for signing")
      .action((opts) => this.open(opts));
    predictions
      .command("close")
      .description(
        "Sell (fully or partially) or claim a position, or cancel a limit order"
      )
      .option("--position <pubkey>", "Position pubkey to close, or 'all'")
      .option(
        "--contracts <n>",
        "Sell only this many contracts (partial close)"
      )
      .option("--order <pubkey>", "Limit order to cancel")
      .option(
        "--slippage <bps>",
        "Accept a quoted slippage up to this many bps (required when the quote is 5% or more)"
      )
      .option("--key <name>", "Key to use for signing")
      .action((opts) => this.close(opts));
    predictions
      .command("history")
      .description("View prediction trading history")
      .option("--key <name>", "Key to use (overrides active key)")
      .option("--address <address>", "Wallet address to look up")
      .option("--limit <n>", "Max results", "10")
      .option("--offset <n>", "Pagination offset", "0")
      .action((opts) => this.history(opts));

    PredictionsDiscoveryCommand.register(predictions);
    PredictionsAccountCommand.register(predictions);
    PredictionsArcadeCommand.register(predictions);
    PredictionsCommunityCommand.register(predictions);
  }

  private static async events(opts: {
    id?: string;
    search?: string;
    filter?: string;
    sort: string;
    category: string;
    subcategory?: string;
    tags?: string;
    offset: string;
    limit: string;
  }): Promise<void> {
    const hasListingOpts =
      opts.filter ||
      opts.sort !== "volume24h" ||
      opts.category !== "all" ||
      opts.subcategory ||
      opts.tags ||
      opts.offset !== "0";
    if (opts.id && (opts.search || hasListingOpts)) {
      throw new Error(
        "--id cannot be combined with --search, --filter, --sort, --category, --subcategory, --tags, or --offset."
      );
    }
    if (opts.search && hasListingOpts) {
      throw new Error(
        "--search cannot be combined with --filter, --sort, --category, --subcategory, --tags, or --offset."
      );
    }

    let data: PredictionEvent[];
    let hasNext = false;
    let nextOffset: number | undefined;

    if (opts.id) {
      const ids = opts.id
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
      data =
        ids.length === 1
          ? [await PredictionsClient.getEvent(ids[0]!)]
          : (await PredictionsClient.getEventsBatch(ids)).data;
    } else if (opts.search) {
      const { start, end } = PredictionsFormat.parsePagination(opts);
      const res = await PredictionsClient.searchEvents({
        query: opts.search,
        start,
        end,
      });
      data = res.data;
    } else {
      const { start, end } = PredictionsFormat.parsePagination(opts);
      const { sortBy, sortDirection } = this.normalizeEventSort(opts.sort);
      const res = await PredictionsClient.getEvents({
        filter: opts.filter,
        sortBy,
        sortDirection,
        category: opts.category,
        subcategories: opts.subcategory,
        tags: opts.tags,
        start,
        end,
      });
      data = res.data;
      hasNext = res.pagination.hasNext;
      nextOffset = res.pagination.end;
    }

    const events = data.map((e) => PredictionsFormat.toEventJson(e));

    if (Output.isJson()) {
      const json: Record<string, unknown> = { events };
      if (hasNext) {
        json.next = nextOffset;
      }
      Output.json(json);
      return;
    }

    PredictionsFormat.printEvents(events);
    if (hasNext) {
      console.log("Next offset:", nextOffset);
    }
  }

  private static normalizeEventSort(sort: string): {
    sortBy: string;
    sortDirection?: string;
  } {
    switch (sort) {
      case "volume":
        return { sortBy: "volume" };
      case "volume24h":
        return { sortBy: "volume24hr" };
      case "recent":
        return { sortBy: "beginAt", sortDirection: "desc" };
      default:
        throw new Error(
          "Invalid --sort. Must be one of: volume, volume24h, recent."
        );
    }
  }

  public static normalizeSide(side: string): "yes" | "no" {
    const s = side.toLowerCase();
    if (s === "yes" || s === "y") {
      return "yes";
    }
    if (s === "no" || s === "n") {
      return "no";
    }
    throw new Error("Invalid --side. Must be yes, no, y, or n.");
  }

  private static async positions(opts: {
    position?: string;
    key?: string;
    address?: string;
  }): Promise<void> {
    if (opts.position && (opts.key || opts.address)) {
      throw new Error("--position cannot be combined with --key or --address.");
    }

    let data;
    if (opts.position) {
      const p = await PredictionsClient.getPosition(opts.position);
      data = [p];
    } else {
      const address = await PredictionsFormat.resolveAddress(opts);
      const res = await PredictionsClient.getPositions(address);
      data = res.data;
    }

    const positions = data.map((p) => ({
      positionPubkey: p.pubkey,
      event: p.eventMetadata.title,
      market: p.marketMetadata.title,
      side: p.isYes ? "yes" : "no",
      contracts: PredictionsFormat.contracts(p.contractsMicro, p.contracts),
      costUsd: NumberConverter.fromMicroUsd(p.totalCostUsd),
      valueUsd: NumberConverter.fromMicroUsd(p.valueUsd ?? 0),
      pnlUsd: NumberConverter.fromMicroUsd(p.pnlUsd ?? 0),
      pnlPct: p.pnlUsdPercent,
      startsAt: new Date(p.marketMetadata.openTime * 1000).toISOString(),
      endsAt: new Date(p.marketMetadata.closeTime * 1000).toISOString(),
      claimable: this.isClaimable(p),
    }));

    if (Output.isJson()) {
      Output.json({ count: positions.length, positions });
      return;
    }

    if (positions.length === 0) {
      console.log("No open positions.");
      return;
    }

    Output.table({
      type: "horizontal",
      headers: {
        event: "Event",
        market: "Market",
        dates: "Starts / Ends",
        side: "Side",
        costUsd: "Cost",
        valueUsd: "Value",
        pnl: "PnL",
        claimable: "Claimable",
        positionPubkey: "Position",
      },
      maxWidths: {
        event: 36,
      },
      rows: positions.map((p) => ({
        event: p.event,
        market: p.market,
        dates:
          PredictionsFormat.formatDate(p.startsAt) +
          "\n" +
          PredictionsFormat.formatDate(p.endsAt),
        side: PredictionsFormat.formatSide(p.side),
        costUsd: Output.formatDollar(p.costUsd),
        valueUsd: Output.formatDollar(p.valueUsd),
        pnl: `${Output.formatDollarChange(p.pnlUsd)} (${Output.formatPercentageChange(p.pnlPct)})`,
        claimable: Output.formatBoolean(p.claimable),
        positionPubkey: p.positionPubkey,
      })),
    });
  }

  private static async open(opts: {
    market: string;
    side: string;
    amount: string;
    input: string;
    limit?: string;
    slippage?: string;
    key?: string;
  }): Promise<void> {
    const side = this.normalizeSide(opts.side);
    const isYes = side === "yes";
    const acceptedSlippageBps = PredictionsExecution.parseSlippageBps(
      opts.slippage
    );
    const signer = await Signer.load(opts.key ?? Config.load().activeKey);
    const market = await PredictionsClient.getMarket(opts.market);
    const provider = market.provider ?? "kalshi";

    if (opts.limit !== undefined && provider !== "polymarket") {
      throw new Error("Limit orders are only supported on Polymarket markets.");
    }
    if (provider === "bisonfi" && opts.input.toUpperCase() !== "USDC") {
      throw new Error("This market only accepts USDC (--input USDC).");
    }
    if (market.marketStatus === "suspend") {
      throw new Error("This market is suspended. Try again later.");
    }
    if (market.tradable === false) {
      throw new Error("Trading on this market is not open yet.");
    }

    const token = await resolveWalletAsset(signer.address, opts.input);
    const depositAmount = NumberConverter.toChainAmount(
      opts.amount,
      token.decimals
    );

    if (provider === "gx") {
      if (!isYes) {
        throw new Error("Saba markets only support --side yes.");
      }
      await this.openTicket(signer, opts.market, token.id, depositAmount);
      return;
    }

    const limitPriceMicro =
      opts.limit !== undefined ? this.parseLimitPrice(opts.limit) : undefined;
    const res = await PredictionsClient.postOrder({
      orderType: limitPriceMicro ? "limit" : "market",
      isBuy: true,
      ownerPubkey: signer.address,
      marketId: opts.market,
      isYes,
      depositAmount,
      depositMint: token.id,
      ...(limitPriceMicro && { maxBuyPriceUsd: limitPriceMicro }),
    });

    const { order } = res;
    PredictionsExecution.assertSlippageAccepted(order, acceptedSlippageBps);
    const result = await PredictionsExecution.signAndExecute(signer, res, {
      ownerPubkey: order.userPubkey,
    });
    const fill = await this.trackFill(res, signer.address, {
      isLimit: !!limitPriceMicro,
    });
    const error = PredictionsExecution.fillError(
      fill,
      order.orderPubkey,
      result.signature
    );

    const contracts = NumberConverter.fromMicroUsd(order.contractsMicro);
    const costUsd = NumberConverter.fromMicroUsd(order.orderCostUsd);
    const feeUsd = NumberConverter.fromMicroUsd(order.estimatedTotalFeeUsd);
    const positionAvgPriceUsd = NumberConverter.fromMicroUsd(
      order.newAvgPriceUsd
    );
    const positionPayoutUsd = NumberConverter.fromMicroUsd(order.newPayoutUsd);
    const limitPriceUsd = limitPriceMicro
      ? NumberConverter.fromMicroUsd(limitPriceMicro)
      : null;
    const maxBuyPriceUsd = PredictionsFormat.microOrNull(order.maxBuyPriceUsd);
    const slippageBps = order.slippageBps ?? null;

    if (Output.isJson()) {
      Output.json({
        ...(error && { error }),
        ...(Config.dryRun && { dryRun: true }),
        action: "open",
        marketId: opts.market,
        side,
        orderType: limitPriceMicro ? "limit" : "market",
        limitPriceUsd,
        contracts,
        costUsd,
        feeUsd,
        maxBuyPriceUsd,
        slippageBps,
        maxSlippageBps: order.maxSlippageBps ?? null,
        positionAvgPriceUsd,
        positionPayoutUsd,
        positionPubkey: order.positionPubkey,
        orderPubkey: order.orderPubkey,
        ...fill,
        signature: result.signature,
        ...(Config.dryRun && { transaction: res.transaction }),
      });
      PredictionsFormat.failOn(error);
      return;
    }

    if (Config.dryRun) {
      console.log(Output.DRY_RUN_LABEL);
    }
    Output.table({
      type: "vertical",
      rows: [
        {
          label: "Action",
          value: limitPriceMicro ? "Open Position (Limit)" : "Open Position",
        },
        { label: "Market", value: opts.market },
        { label: "Side", value: side },
        ...(limitPriceUsd
          ? [
              {
                label: "Limit Price",
                value: Output.formatDollar(limitPriceUsd),
              },
            ]
          : []),
        { label: "Contracts", value: String(contracts) },
        { label: "Cost", value: Output.formatDollar(costUsd) },
        { label: "Fee", value: Output.formatDollar(feeUsd) },
        ...this.priceLimitRows("Max Buy Price", maxBuyPriceUsd, slippageBps),
        {
          label: "Position Avg Price",
          value: Output.formatDollar(positionAvgPriceUsd),
        },
        {
          label: "Position Payout",
          value: Output.formatDollar(positionPayoutUsd),
        },
        { label: "Position", value: order.positionPubkey },
        ...this.fillRows(fill),
        ...(!Config.dryRun
          ? [{ label: "Tx Signature", value: result.signature ?? "" }]
          : []),
      ],
    });
    PredictionsFormat.failOn(error);
  }

  private static priceLimitRows(
    label: string,
    priceUsd: number | null,
    slippageBps: number | null
  ): { label: string; value: string }[] {
    return [
      ...(priceUsd !== null
        ? [{ label, value: Output.formatDollar(priceUsd, { decimals: 3 }) }]
        : []),
      ...(slippageBps !== null
        ? [{ label: "Est. Slippage", value: `${slippageBps / 100}%` }]
        : []),
    ];
  }

  private static async openTicket(
    signer: Signer,
    marketId: string,
    depositMint: string,
    stakeAmount: string
  ): Promise<void> {
    const res = await PredictionsClient.postTicket({
      marketId,
      depositMint,
      stakeUsd: stakeAmount,
      ownerPubkey: signer.address,
    });
    const result = await PredictionsExecution.signAndExecute(signer, res);
    const costUsd = NumberConverter.fromMicroUsd(res.ticket.stakeUsd);
    const positionPayoutUsd = NumberConverter.fromMicroUsd(
      res.ticket.maxPayoutUsd
    );

    if (Output.isJson()) {
      Output.json({
        ...(Config.dryRun && { dryRun: true }),
        action: "open",
        marketId,
        side: "yes",
        orderType: "ticket",
        costUsd,
        positionPayoutUsd,
        ticketPubkey: res.ticket.pubkey,
        ticketStatus: res.ticket.status,
        signature: result.signature,
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
        { label: "Action", value: "Open Ticket" },
        { label: "Market", value: marketId },
        { label: "Stake", value: Output.formatDollar(costUsd) },
        { label: "Max Payout", value: Output.formatDollar(positionPayoutUsd) },
        { label: "Ticket", value: res.ticket.pubkey },
        ...(!Config.dryRun
          ? [{ label: "Tx Signature", value: result.signature ?? "" }]
          : []),
      ],
    });
  }

  public static parseLimitPrice(input: string): string {
    const price = Number(input);
    if (!Number.isFinite(price) || price <= 0 || price >= 1) {
      throw new Error(
        "--limit must be a price per contract between 0 and 1 USD, e.g. 0.42."
      );
    }
    return NumberConverter.toMicroUsd(input);
  }

  /**
   * Execute success means the order was placed, not filled. A keeper matches
   * orders, so wait for the real fill state; a marketable limit order can fill
   * at once, so it gets a short wait. Atomic-swap venues settle in the tx.
   */
  private static async trackFill(
    res: CreateOrderResponse,
    ownerPubkey: string,
    opts: { isLimit: boolean }
  ): Promise<OrderFill> {
    const contracts = NumberConverter.fromMicroUsd(res.order.contractsMicro);
    if (Config.dryRun) {
      return {
        orderStatus: null,
        filledContracts: null,
        avgFillPriceUsd: null,
      };
    }
    if (res.executionModel === "atomic_swap") {
      return {
        orderStatus: "filled",
        filledContracts: contracts,
        avgFillPriceUsd: null,
      };
    }
    return PredictionsExecution.waitForFill(
      {
        ownerPubkey,
        orderPubkey: res.order.orderPubkey,
        orderId:
          res.clientOrderId ??
          res.order.clientOrderId ??
          res.externalOrderId ??
          res.order.externalOrderId ??
          null,
      },
      opts.isLimit ? LIMIT_FILL_TIMEOUT_MS : undefined
    );
  }

  private static fillRows(fill: OrderFill): { label: string; value: string }[] {
    if (!fill.orderStatus) {
      return [];
    }
    const color =
      fill.orderStatus === "filled"
        ? chalk.green
        : fill.orderStatus === "failed"
          ? chalk.red
          : chalk.yellow;
    return [
      { label: "Order Status", value: color(fill.orderStatus) },
      ...(fill.avgFillPriceUsd
        ? [
            {
              label: "Avg Fill Price",
              value: Output.formatDollar(fill.avgFillPriceUsd),
            },
          ]
        : []),
    ];
  }

  private static async history(opts: {
    key?: string;
    address?: string;
    limit: string;
    offset: string;
  }): Promise<void> {
    const { start, end } = PredictionsFormat.parsePagination(opts);
    const address = await PredictionsFormat.resolveAddress(opts);

    const res = await PredictionsClient.getHistory({
      ownerPubkey: address,
      start,
      end,
    });

    const history = res.data.map((h) => ({
      time: new Date(h.timestamp * 1000).toISOString(),
      event: h.eventMetadata.title,
      market: h.marketMetadata.title,
      type: h.eventType,
      side: h.isYes ? "yes" : "no",
      action: h.isBuy ? "buy" : "sell",
      contracts: PredictionsFormat.contracts(
        h.filledContractsMicro,
        h.filledContracts
      ),
      avgPriceUsd: NumberConverter.fromMicroUsd(h.avgFillPriceUsd),
      pnlUsd: h.realizedPnl
        ? NumberConverter.fromMicroUsd(h.realizedPnl)
        : null,
      payoutUsd: NumberConverter.fromMicroUsd(h.payoutAmountUsd),
      positionPubkey: h.positionPubkey,
      signature: h.signature,
    }));

    if (Output.isJson()) {
      const json: Record<string, unknown> = { count: history.length, history };
      if (res.pagination.hasNext) {
        json.next = res.pagination.end;
      }
      Output.json(json);
      return;
    }

    if (history.length === 0) {
      console.log("No history found.");
      return;
    }

    Output.table({
      type: "horizontal",
      headers: {
        time: "Time",
        event: "Event / Market",
        side: "Side",
        action: "Action",
        avgPrice: "Avg Price",
        pnl: "PnL",
        signature: "Tx Signature",
      },
      rows: history.map((h) => ({
        time: PredictionsFormat.formatDate(h.time),
        event: h.event + chalk.gray("\n└─► ") + h.market,
        side: PredictionsFormat.formatSide(h.side),
        action: h.action,
        avgPrice: Output.formatDollar(h.avgPriceUsd),
        pnl: h.pnlUsd ? Output.formatDollarChange(h.pnlUsd) : chalk.gray("—"),
        signature: h.signature,
      })),
    });

    if (res.pagination.hasNext) {
      console.log("\nNext offset:", res.pagination.end);
    }
  }

  public static isClaimable(p: {
    claimable?: boolean;
    claimed: boolean;
    isYes: boolean;
    marketMetadata: { result: "yes" | "no" | null };
  }): boolean {
    if (p.claimable !== undefined) {
      return p.claimable;
    }
    return (
      !p.claimed &&
      p.marketMetadata.result !== null &&
      p.marketMetadata.result === (p.isYes ? "yes" : "no")
    );
  }

  /** Floors a partial sell to the venue's contract step; "0" when unsupported. */
  public static snapContractsMicro(
    contractsMicro: bigint,
    provider: Provider
  ): string {
    const step = PARTIAL_SELL_STEP_MICRO[provider];
    if (!step) {
      return "0";
    }
    return ((contractsMicro / BigInt(step)) * BigInt(step)).toString();
  }

  /**
   * The floor jup.ag asks for: $0.02 under the bid, at least $0.01. The server
   * may widen it on-chain; the order's `minSellPriceUsd` is the real floor.
   */
  public static minSellPriceMicro(exitPriceMicro: string): string {
    return String(
      Math.max(
        Number(exitPriceMicro) - SELL_PRICE_BUFFER_MICRO,
        MIN_SELL_PRICE_MICRO
      )
    );
  }

  private static async close(opts: {
    position?: string;
    contracts?: string;
    order?: string;
    slippage?: string;
    key?: string;
  }): Promise<void> {
    if (!opts.position === !opts.order) {
      throw new Error("Provide exactly one of --position or --order.");
    }
    if (opts.contracts && (opts.order || opts.position === "all")) {
      throw new Error("--contracts can only be used with a single --position.");
    }
    const acceptedSlippageBps = PredictionsExecution.parseSlippageBps(
      opts.slippage
    );
    const signer = await Signer.load(opts.key ?? Config.load().activeKey);

    if (opts.order) {
      await this.cancelOrder(signer, opts.order);
      return;
    }
    if (opts.position === "all") {
      await this.closeAll(signer);
      return;
    }

    const position = await PredictionsClient.getPosition(opts.position!);
    if (this.isClaimable(position)) {
      if (opts.contracts) {
        throw new Error(
          "Resolved positions are claimed in full; drop --contracts."
        );
      }
      await this.claim(signer, position);
      return;
    }
    await this.sell(signer, position, opts.contracts, acceptedSlippageBps);
  }

  private static async cancelOrder(
    signer: Signer,
    orderPubkey: string
  ): Promise<void> {
    const res = await PredictionsClient.cancelOrder(
      orderPubkey,
      signer.address
    );
    const result = await PredictionsExecution.signAndExecute(signer, res);

    if (Output.isJson()) {
      Output.json({
        ...(Config.dryRun && { dryRun: true }),
        action: "cancel",
        orderPubkey,
        signature: result.signature,
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
        { label: "Action", value: "Cancel Limit Order" },
        { label: "Order", value: orderPubkey },
        ...(!Config.dryRun
          ? [{ label: "Tx Signature", value: result.signature ?? "" }]
          : []),
      ],
    });
  }

  /**
   * Sells and claims every position one by one. Each item lands on its own, so
   * a failure part-way reports what already went through, then exits non-zero.
   */
  private static async closeAll(signer: Signer): Promise<void> {
    const res = await PredictionsClient.closeAllPositions(signer.address);
    if (res.data.length === 0) {
      throw new Error("No open positions to close.");
    }
    if (Config.dryRun && !Output.isJson()) {
      console.log(Output.DRY_RUN_LABEL);
    }

    const total = res.data.length;
    const { done, failed } = await PredictionsExecution.runInOrder(
      res.data,
      async (item, index) => {
        const isClaim = "position" in item;
        const { signature } = await PredictionsExecution.signAndExecute(
          signer,
          item,
          isClaim ? {} : { ownerPubkey: item.order.userPubkey }
        );
        const positionPubkey = isClaim
          ? item.position.positionPubkey
          : item.order.positionPubkey;
        PredictionsFormat.printProgress(
          index,
          total,
          `${isClaim ? "claim" : "close"} ${positionPubkey}`,
          signature
        );
        return { item, positionPubkey, signature };
      }
    );

    const results = [];
    let fillError: string | null = null;
    for (const { item, positionPubkey, signature } of done) {
      if ("position" in item) {
        results.push({
          action: "claim",
          positionPubkey,
          signature,
          ...(Config.dryRun && { transaction: item.transaction }),
        });
        continue;
      }
      const fill = await this.trackFill(item, signer.address, {
        isLimit: false,
      });
      fillError ??= PredictionsExecution.fillError(
        fill,
        item.order.orderPubkey,
        signature
      );
      results.push({
        action: "close",
        positionPubkey,
        orderPubkey: item.order.orderPubkey,
        ...fill,
        signature,
        ...(Config.dryRun && { transaction: item.transaction }),
      });
    }

    const failedItem = failed && {
      action: "position" in failed.item ? "claim" : "close",
      positionPubkey:
        "position" in failed.item
          ? failed.item.position.positionPubkey
          : failed.item.order.positionPubkey,
      error: failed.error,
    };
    const error = failedItem
      ? PredictionsExecution.batchError(
          {
            label: `${failedItem.action} ${failedItem.positionPubkey}`,
            error: failedItem.error,
          },
          done.length,
          total
        )
      : fillError;

    if (Output.isJson()) {
      Output.json({
        ...(error && { error }),
        ...(Config.dryRun && { dryRun: true }),
        action: "close-all",
        results,
        ...(failedItem && { failed: failedItem }),
      });
      PredictionsFormat.failOn(error);
      return;
    }

    if (results.length > 0) {
      Output.table({
        type: "horizontal",
        headers: {
          action: "Action",
          positionPubkey: "Position",
          ...(!Config.dryRun && {
            orderStatus: "Order Status",
            signature: "Tx Signature",
          }),
        },
        rows: results.map((r) => ({
          ...r,
          orderStatus: "orderStatus" in r ? (r.orderStatus ?? "") : "",
        })),
      });
    }
    PredictionsFormat.failOn(error);
  }

  private static async claim(
    signer: Signer,
    position: PredictionPosition
  ): Promise<void> {
    const res = await PredictionsClient.claimPosition(
      position.pubkey,
      signer.address
    );
    const result = await PredictionsExecution.signAndExecute(signer, res);

    const contracts = PredictionsFormat.contracts(
      res.position.contractsMicro,
      res.position.contracts
    );
    const payoutUsd = NumberConverter.fromMicroUsd(
      res.position.payoutAmountUsd
    );
    const side = position.isYes ? "yes" : "no";

    if (Output.isJson()) {
      Output.json({
        ...(Config.dryRun && { dryRun: true }),
        action: "claim",
        event: position.eventMetadata.title,
        market: position.marketMetadata.title,
        side,
        positionPubkey: position.pubkey,
        contracts,
        payoutUsd,
        signature: result.signature,
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
        { label: "Action", value: "Claim Position" },
        { label: "Event", value: position.eventMetadata.title },
        { label: "Market", value: position.marketMetadata.title },
        { label: "Side", value: PredictionsFormat.formatSide(side) },
        { label: "Payout", value: Output.formatDollar(payoutUsd) },
        { label: "Position", value: position.pubkey },
        ...(!Config.dryRun
          ? [{ label: "Tx Signature", value: result.signature ?? "" }]
          : []),
      ],
    });
  }

  private static async sell(
    signer: Signer,
    position: PredictionPosition,
    contractsInput: string | undefined,
    acceptedSlippageBps: number | undefined
  ): Promise<void> {
    const provider = position.marketMetadata.provider ?? "kalshi";
    if (provider === "gx") {
      throw new Error(
        "Saba positions can't be sold before the market resolves."
      );
    }
    const exitPrice = position.sellPriceUsd;
    if (!exitPrice || exitPrice === "0") {
      throw new Error("No bid to sell into right now. Try again later.");
    }
    const heldMicro = BigInt(position.contractsMicro);
    let sellMicro = heldMicro;
    if (contractsInput !== undefined) {
      const requested = Number(contractsInput);
      if (!Number.isFinite(requested) || requested <= 0) {
        throw new Error("--contracts must be a positive number.");
      }
      const requestedMicro = BigInt(
        NumberConverter.toChainAmount(contractsInput, 6)
      );
      sellMicro =
        requestedMicro >= heldMicro
          ? heldMicro
          : BigInt(this.snapContractsMicro(requestedMicro, provider));
      if (sellMicro === 0n) {
        throw new Error(
          "--contracts is below the smallest sellable amount for this market."
        );
      }
    }
    const isFullClose = sellMicro === heldMicro;

    const res = isFullClose
      ? await PredictionsClient.closePosition(
          position.pubkey,
          signer.address,
          this.minSellPriceMicro(exitPrice)
        )
      : await PredictionsClient.postOrder({
          orderType: "market",
          isBuy: false,
          ownerPubkey: signer.address,
          positionPubkey: position.pubkey,
          contractsMicro: sellMicro.toString(),
        });

    const { order } = res;
    const proceedsMicro = this.sellValueMicroUsd(sellMicro, exitPrice);
    PredictionsExecution.assertSlippageAccepted(
      order,
      acceptedSlippageBps,
      proceedsMicro
    );
    const result = await PredictionsExecution.signAndExecute(signer, res, {
      ownerPubkey: order.userPubkey,
    });
    const fill = await this.trackFill(res, signer.address, { isLimit: false });
    const error = PredictionsExecution.fillError(
      fill,
      order.orderPubkey,
      result.signature
    );

    const contracts = NumberConverter.fromMicroUsd(order.contractsMicro);
    const costUsd = NumberConverter.fromMicroUsd(order.orderCostUsd);
    const feeUsd = NumberConverter.fromMicroUsd(order.estimatedTotalFeeUsd);
    const sellPriceUsd = NumberConverter.fromMicroUsd(exitPrice);
    const proceedsUsd = NumberConverter.fromMicroUsd(proceedsMicro.toString());
    const minSellPriceUsd = PredictionsFormat.microOrNull(
      order.minSellPriceUsd
    );
    const slippageBps = order.slippageBps ?? null;
    const side = position.isYes ? "yes" : "no";

    if (Output.isJson()) {
      Output.json({
        ...(error && { error }),
        ...(Config.dryRun && { dryRun: true }),
        action: "close",
        event: position.eventMetadata.title,
        market: position.marketMetadata.title,
        side,
        positionPubkey: position.pubkey,
        partial: !isFullClose,
        contracts,
        costUsd,
        feeUsd,
        sellPriceUsd,
        proceedsUsd,
        minSellPriceUsd,
        slippageBps,
        maxSlippageBps: order.maxSlippageBps ?? null,
        orderPubkey: order.orderPubkey,
        ...fill,
        signature: result.signature,
        ...(Config.dryRun && { transaction: res.transaction }),
      });
      PredictionsFormat.failOn(error);
      return;
    }

    if (Config.dryRun) {
      console.log(Output.DRY_RUN_LABEL);
    }
    Output.table({
      type: "vertical",
      rows: [
        {
          label: "Action",
          value: isFullClose ? "Close Position" : "Partially Close Position",
        },
        { label: "Event", value: position.eventMetadata.title },
        { label: "Market", value: position.marketMetadata.title },
        { label: "Side", value: PredictionsFormat.formatSide(side) },
        { label: "Contracts", value: String(contracts) },
        {
          label: "Sell Price",
          value: Output.formatDollar(sellPriceUsd, { decimals: 3 }),
        },
        { label: "Est. Proceeds", value: Output.formatDollar(proceedsUsd) },
        { label: "Fee", value: Output.formatDollar(feeUsd) },
        ...this.priceLimitRows("Min Sell Price", minSellPriceUsd, slippageBps),
        { label: "Position", value: position.pubkey },
        ...this.fillRows(fill),
        ...(!Config.dryRun
          ? [{ label: "Tx Signature", value: result.signature ?? "" }]
          : []),
      ],
    });
    PredictionsFormat.failOn(error);
  }

  /** What a sell is worth at the current bid, in micro-USD (the web's close amount). */
  public static sellValueMicroUsd(
    contractsMicro: bigint,
    priceMicro: string
  ): bigint {
    return (contractsMicro * BigInt(priceMicro)) / BigInt(MICRO);
  }
}
