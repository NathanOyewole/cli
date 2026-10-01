import type { Base64EncodedBytes } from "@solana/kit";
import chalk from "chalk";
import type { Command } from "commander";

import {
  JtxPerpsClient,
  type JtxMarket,
  type JtxOrderHistory,
  type JtxSide,
} from "../clients/JtxPerpsClient.ts";
import { Config } from "../lib/Config.ts";
import {
  assertWithinLimits,
  protectedPrice,
  randomClientOrderId,
  sizeOpenOrder,
  snapDown,
} from "../lib/JtxOrder.ts";
import { JupStake } from "../lib/JupStake.ts";
import { NumberConverter } from "../lib/NumberConverter.ts";
import { Output } from "../lib/Output.ts";
import { PerpsTx } from "../lib/PerpsTx.ts";
import { Signer } from "../lib/Signer.ts";

// The jtx API also lists these, but the web routes them to the JLP pool.
const JLP_POOL_MARKETS = new Set(["SOL", "BTC", "ETH"]);
const MIN_OPEN_COLLATERAL_USD = 10;
const MIN_DEPOSIT_USD = 5;
const BETA_MIN_STAKE = 69n * 10n ** BigInt(JupStake.DECIMALS);
const CONFIRM_TIMEOUT_MS = 20_000;

const toSide = (side: JtxSide) => (side === "Bid" ? "long" : "short");
const num = (v: string | number | null | undefined) =>
  v === null || v === undefined || v === "" ? null : Number(v);

type AddressOpts = { key?: string; address?: string };

export class PerpsJtxCommand {
  public static register(perps: Command): void {
    const jtx = perps
      .command("jtx")
      .description(
        "Orderbook (JTX) perps markets: JUP, HYPE, ZEC, SPCX, SNDK, SKHYNIX and more. USDC collateral, isolated per market"
      );
    jtx
      .command("markets")
      .description("List JTX markets with prices, funding, and limits")
      .action(() => this.markets());
    jtx
      .command("orderbook")
      .description("Show the order book for a market")
      .requiredOption("--asset <asset>", "Market symbol, e.g. JUP")
      .option("--depth <n>", "Price levels per side", "10")
      .action((opts) => this.orderbook(opts));
    jtx
      .command("positions")
      .description("View positions, open orders, and per-market balances")
      .option("--key <name>", "Key to use (overrides active key)")
      .option("--address <address>", "Wallet address to look up")
      .action((opts) => this.positions(opts));
    jtx
      .command("history")
      .description("View order history, fills, or funding payments")
      .option("--key <name>", "Key to use (overrides active key)")
      .option("--address <address>", "Wallet address to look up")
      .option("--type <type>", "orders, trades, or funding", "orders")
      .option("--asset <asset>", "Filter by market symbol")
      .option("--limit <n>", "Max number of results", "20")
      .action((opts) => this.history(opts));
    jtx
      .command("open")
      .description("Open or increase a position with a market or limit order")
      .requiredOption("--asset <asset>", "Market symbol, e.g. JUP")
      .requiredOption("--side <side>", "Direction (long, short, buy, sell)")
      .requiredOption("--amount <usdc>", "USDC collateral to commit")
      .option("--leverage <number>", "Leverage multiplier")
      .option("--size <usd>", "Position size in USD (instead of --leverage)")
      .option("--limit <price>", "Limit price (omit for a market order)")
      .option("--key <name>", "Key to use for signing")
      .action((opts) => this.open(opts));
    jtx
      .command("close")
      .description("Close a position (fully or partly) or cancel an order")
      .option("--asset <asset>", "Market of the position to close")
      .option("--size <usd>", "USD size to close (omit to close fully)")
      .option("--limit <price>", "Close with a limit order at this price")
      .option("--order <id>", "Order ID (or client order ID) to cancel")
      .option("--key <name>", "Key to use for signing")
      .action((opts) => this.close(opts));
    jtx
      .command("set")
      .description("Add or remove USDC collateral in a market's account")
      .requiredOption("--asset <asset>", "Market symbol, e.g. JUP")
      .option("--add-collateral <usdc>", "USDC to deposit")
      .option("--remove-collateral <usdc>", "USDC to withdraw")
      .option("--key <name>", "Key to use for signing")
      .action((opts) => this.set(opts));
  }

  private static async market(asset: string): Promise<JtxMarket> {
    const symbol = asset.toUpperCase();
    const markets = await JtxPerpsClient.getMarkets();
    const market = markets.find((m) => m.symbol === symbol);
    if (!market || JLP_POOL_MARKETS.has(symbol)) {
      const available = markets
        .filter((m) => !JLP_POOL_MARKETS.has(m.symbol))
        .map((m) => m.symbol)
        .join(", ");
      throw new Error(
        JLP_POOL_MARKETS.has(symbol)
          ? `${symbol} trades on the JLP pool: use 'jup perps open --asset ${symbol}'.`
          : `Unknown JTX market: ${asset}. Available: ${available}.`
      );
    }
    return market;
  }

  private static async markets(): Promise<void> {
    const [markets, health] = await Promise.all([
      JtxPerpsClient.getMarkets(),
      JtxPerpsClient.getHealth(),
    ]);
    const jtx = markets.filter((m) => !JLP_POOL_MARKETS.has(m.symbol));
    const funding = await Promise.all(
      jtx.map((m) => JtxPerpsClient.getFundingRate(m.symbol))
    );
    const rows = jtx.map((m, i) => {
      const depth = health.market_health.find((h) => h.symbol === m.symbol);
      return {
        asset: m.symbol,
        priceUsd: m.markPrice,
        changePct24h: Number(m.priceChangePercent24h.toFixed(2)),
        highUsd24h: m.high24h,
        lowUsd24h: m.low24h,
        volumeUsd24h: Number(m.volume24h.toFixed(2)),
        openInterestUsd: Number(m.openInterest.toFixed(2)),
        maxLeverage:
          m.maxLeverage ?? Math.floor(10_000 / m.initialMarginRatioBps),
        takerFeePct: m.takerFeeBps / 100,
        makerFeePct: m.makerFeeBps / 100,
        fundingRatePctPerHour: Number((funding[i]!.rateBps1h / 100).toFixed(6)),
        nextFundingTime: new Date(
          funding[i]!.nextFundingCollectionTime * 1000
        ).toISOString(),
        marketOrders:
          health.trading_available && depth?.depth_status === "normal",
      };
    });

    if (Output.isJson()) {
      Output.json(rows);
      return;
    }
    if (!health.trading_available) {
      console.log(chalk.yellow("Trading is temporarily unavailable."));
    }
    Output.table({
      type: "horizontal",
      headers: {
        asset: "Asset",
        price: "Price",
        change: "24h Change",
        volume: "24h Volume",
        oi: "Open Interest",
        leverage: "Max Lev.",
        funding: "Funding /hr",
        fees: "Taker / Maker",
      },
      rows: rows.map((r) => ({
        asset: r.marketOrders
          ? r.asset
          : `${r.asset} ${chalk.yellow("(limit only)")}`,
        price: Output.formatDollar(r.priceUsd),
        change: Output.formatPercentageChange(r.changePct24h),
        volume: Output.formatDollar(r.volumeUsd24h, { decimals: 0 }),
        oi: Output.formatDollar(r.openInterestUsd, { decimals: 0 }),
        leverage: `${r.maxLeverage}x`,
        funding: `${r.fundingRatePctPerHour}%`,
        fees: `${r.takerFeePct}% / ${r.makerFeePct}%`,
      })),
    });
  }

  private static async orderbook(opts: {
    asset: string;
    depth: string;
  }): Promise<void> {
    const market = await this.market(opts.asset);
    const depth = Number(opts.depth);
    if (!Number.isInteger(depth) || depth < 1 || depth > 25) {
      throw new Error("--depth must be an integer from 1 to 25.");
    }
    const book = await JtxPerpsClient.getOrderbook(market.symbol, depth);
    const level = ([priceUsd, size]: [number, number]) => ({ priceUsd, size });
    const result = {
      asset: market.symbol,
      markPriceUsd: market.markPrice,
      bids: book.bids.slice(0, depth).map(level),
      asks: book.asks.slice(0, depth).map(level),
    };

    if (Output.isJson()) {
      Output.json(result);
      return;
    }
    Output.table({
      type: "horizontal",
      headers: {
        bidSize: "Bid Size",
        bid: "Bid",
        ask: "Ask",
        askSize: "Ask Size",
      },
      rows: Array.from(
        { length: Math.max(result.bids.length, result.asks.length) },
        (_, i) => ({
          bidSize: result.bids[i]?.size ?? "",
          bid: result.bids[i] ? chalk.green(result.bids[i]!.priceUsd) : "",
          ask: result.asks[i] ? chalk.red(result.asks[i]!.priceUsd) : "",
          askSize: result.asks[i]?.size ?? "",
        })
      ),
    });
  }

  private static async positions(opts: AddressOpts): Promise<void> {
    const wallet = await PerpsTx.resolveAddress(opts);
    const account = await JtxPerpsClient.getTradingAccountPubkey(wallet);
    const [positions, orders, accounts] = await Promise.all([
      JtxPerpsClient.getPositions(account),
      JtxPerpsClient.getOpenOrders(account),
      JtxPerpsClient.getTradingAccounts(wallet),
    ]);
    const result = {
      positions: positions.map((p) => {
        const size = Number(p.size);
        const markPriceUsd = Number(p.markPrice);
        return {
          asset: p.symbol,
          side: toSide(p.side),
          size,
          sizeUsd: Number((size * markPriceUsd).toFixed(6)),
          entryPriceUsd: Number(p.avgEntryPrice),
          markPriceUsd,
          collateralUsd: num(p.collateral),
          liquidationPriceUsd: num(p.liquidationPrice),
          pnlUsd: num(p.unrealizedPnl),
          pnlPct: num(p.unrealizedPnlPercent),
          fundingAccruedUsd: Number(p.fundingAccrued),
        };
      }),
      orders: orders.map((o) => ({
        orderId: o.orderId,
        clientOrderId: o.clientOrderId ?? null,
        asset: o.symbol,
        side: toSide(o.side),
        priceUsd: Number(o.price),
        size: Number(o.initialSize),
        remainingSize: Number(o.remainingSize),
        reduceOnly: o.reduceOnly,
        collateralUsd: num(o.collateral),
      })),
      accounts: accounts.accounts
        .filter((a) => a.market)
        .map((a) => ({
          asset: a.market!,
          freeBalanceUsd: Number(a.data.freeBalance),
          accountValueUsd: Number(Number(a.data.accountValue).toFixed(6)),
          leverage: Number(Number(a.data.crossAccountLeverage).toFixed(2)),
        })),
    };

    if (Output.isJson()) {
      Output.json(result);
      return;
    }
    if (result.positions.length === 0) {
      console.log("No open JTX positions.");
    }
    for (const p of result.positions) {
      const sideColor = p.side === "long" ? chalk.green.bold : chalk.red.bold;
      Output.table({
        type: "vertical",
        rows: [
          { label: "Market", value: sideColor(`${p.asset} ${p.side}`) },
          {
            label: "Size",
            value: `${p.size} ${p.asset} (${Output.formatDollar(p.sizeUsd)})`,
          },
          { label: "Entry Price", value: Output.formatDollar(p.entryPriceUsd) },
          { label: "Mark Price", value: Output.formatDollar(p.markPriceUsd) },
          {
            label: "PnL",
            value: `${Output.formatDollarChange(p.pnlUsd ?? undefined)} (${Output.formatPercentageChange(p.pnlPct ?? undefined)})`,
          },
          {
            label: "Collateral",
            value: Output.formatDollar(p.collateralUsd ?? undefined),
          },
          {
            label: "Liq. Price",
            value: Output.formatDollar(p.liquidationPriceUsd ?? undefined),
          },
        ],
      });
    }
    if (result.orders.length > 0) {
      console.log("\nOpen Orders:");
      Output.table({
        type: "horizontal",
        headers: {
          asset: "Asset",
          side: "Side",
          price: "Price",
          size: "Remaining",
          reduceOnly: "Reduce Only",
          orderId: "Order",
        },
        rows: result.orders.map((o) => ({
          asset: o.asset,
          side: o.side,
          price: Output.formatDollar(o.priceUsd),
          size: `${o.remainingSize} / ${o.size}`,
          reduceOnly: o.reduceOnly ? "yes" : "no",
          orderId: o.orderId,
        })),
      });
    }
    if (result.accounts.length > 0) {
      console.log("\nMarket Accounts (USDC):");
      Output.table({
        type: "horizontal",
        headers: { asset: "Market", free: "Free", value: "Account Value" },
        rows: result.accounts.map((a) => ({
          asset: a.asset,
          free: Output.formatDollar(a.freeBalanceUsd, { decimals: 2 }),
          value: Output.formatDollar(a.accountValueUsd, { decimals: 2 }),
        })),
      });
    }
  }

  private static async history(
    opts: AddressOpts & { type: string; asset?: string; limit: string }
  ): Promise<void> {
    const limit = Number(opts.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error("--limit must be an integer from 1 to 100.");
    }
    const wallet = await PerpsTx.resolveAddress(opts);
    const account = await JtxPerpsClient.getTradingAccountPubkey(wallet);
    const symbol = opts.asset?.toUpperCase();

    if (opts.type === "orders") {
      const orders = await JtxPerpsClient.getOrderHistory(account, {
        symbol,
        limit,
      });
      const rows = orders.map((o) => ({
        time: new Date(o.createdAt * 1000).toISOString(),
        orderId: o.orderId,
        asset: o.symbol,
        side: toSide(o.side),
        type: o.orderType,
        reduceOnly: o.reduceOnly,
        priceUsd: Number(o.price),
        size: Number(o.originalSize),
        filledSize: Number(o.filledSize),
        pnlUsd: num(o.realizedPnl),
        status: o.status,
        signature: o.originTxId ?? null,
      }));
      return this.printHistory("orders", rows, {
        time: "Time",
        asset: "Asset",
        side: "Side",
        type: "Type",
        priceUsd: "Price",
        filled: "Filled",
        pnlUsd: "PnL",
        status: "Status",
      });
    }
    if (opts.type === "trades") {
      const trades = await JtxPerpsClient.getTrades(account, symbol);
      const rows = trades.slice(0, limit).map((t) => ({
        time: new Date(t.time * 1000).toISOString(),
        asset: t.symbol,
        side: toSide(t.side),
        priceUsd: Number(t.price),
        size: Number(t.size),
        feeUsd: Number(t.fee),
        pnlUsd: num(t.realizedPnl),
        signature: t.txid,
      }));
      return this.printHistory("trades", rows, {
        time: "Time",
        asset: "Asset",
        side: "Side",
        priceUsd: "Price",
        size: "Size",
        feeUsd: "Fee",
        pnlUsd: "PnL",
      });
    }
    if (opts.type === "funding") {
      const entries = await JtxPerpsClient.getFundingHistory(account, limit);
      const rows = entries
        .filter((e) => !symbol || e.symbol === symbol)
        .map((e) => ({
          time: new Date(e.timestamp * 1000).toISOString(),
          asset: e.symbol,
          side: e.side ? toSide(e.side) : null,
          size: num(e.size),
          fundingUsd: e.funding,
          fundingRatePct: e.fundingRate ? Number(e.fundingRate) * 100 : null,
          signature: e.signature,
        }));
      return this.printHistory("funding", rows, {
        time: "Time",
        asset: "Asset",
        side: "Side",
        size: "Size",
        fundingUsd: "Funding",
      });
    }
    throw new Error("--type must be orders, trades, or funding.");
  }

  private static printHistory(
    key: string,
    rows: Record<string, unknown>[],
    headers: Record<string, string>
  ): void {
    if (Output.isJson()) {
      Output.json({ [key]: rows });
      return;
    }
    if (rows.length === 0) {
      console.log(`No ${key} history found.`);
      return;
    }
    Output.table({
      type: "horizontal",
      headers,
      rows: rows.map((r) => ({
        ...r,
        time: new Date(r.time as string).toLocaleString(),
        priceUsd:
          typeof r.priceUsd === "number" ? Output.formatDollar(r.priceUsd) : "",
        filled: `${r.filledSize} / ${r.size}`,
        feeUsd:
          typeof r.feeUsd === "number"
            ? Output.formatDollar(r.feeUsd, { decimals: 4 })
            : "",
        pnlUsd:
          typeof r.pnlUsd === "number"
            ? Output.formatDollarChange(r.pnlUsd)
            : chalk.gray("—"),
        fundingUsd:
          typeof r.fundingUsd === "number"
            ? Output.formatDollarChange(r.fundingUsd)
            : "",
      })),
    });
  }

  private static async assertTradable(
    market: JtxMarket,
    isMarketOrder: boolean
  ): Promise<void> {
    const health = await JtxPerpsClient.getHealth();
    if (!health.trading_available) {
      throw new Error(
        "JTX trading is temporarily unavailable. Try again later."
      );
    }
    const depth = health.market_health.find((h) => h.symbol === market.symbol);
    if (isMarketOrder && depth?.depth_status !== "normal") {
      throw new Error(
        `${market.symbol} order book is ${depth?.depth_status ?? "unavailable"}: only limit orders (--limit) are accepted right now.`
      );
    }
  }

  // Opening JTX positions is a private beta gated on max-locked staked JUP.
  // The web enforces this client-side; the API still builds the transaction.
  private static async assertBetaAccess(wallet: string): Promise<void> {
    const stake = await JupStake.activeStake(wallet);
    if (stake < BETA_MIN_STAKE) {
      throw new Error(
        `JTX markets are in private beta: opening positions needs at least 69 JUP staked with max lock (https://vote.jup.ag). This wallet has ${NumberConverter.fromChainAmount(stake, JupStake.DECIMALS)} JUP max-locked.`
      );
    }
  }

  private static async submit(
    signer: Signer,
    transaction: string
  ): Promise<string | null> {
    if (Config.dryRun) {
      return null;
    }
    const signed = await signer.signTransaction(
      transaction as Base64EncodedBytes
    );
    const res = await JtxPerpsClient.postExecute(signed);
    if (res.status === "Success" && res.code === 0) {
      return res.signature ?? null;
    }
    if (res.code === -2) {
      throw new Error(`Submission failed: ${res.error ?? "rejected"}`);
    }
    throw new Error(
      `Submission outcome unknown (${res.error ?? `code ${res.code}`})${res.signature ? `, tx ${res.signature}` : ""}. Check 'jup perps jtx positions' before retrying.`
    );
  }

  // Fills happen on the JTX side after the intent lands, so poll the order
  // history for the client order ID instead of the Solana tx.
  private static async waitForOrder(
    wallet: string,
    symbol: string,
    clientOrderId: string
  ): Promise<JtxOrderHistory | null> {
    const account = await JtxPerpsClient.getTradingAccountPubkey(wallet);
    const startTime = Math.floor(Date.now() / 1000) - 60;
    const deadline = Date.now() + CONFIRM_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const orders = await JtxPerpsClient.getOrderHistory(account, {
        symbol,
        limit: 50,
        startTime,
      }).catch(() => []);
      const order = orders.find((o) => o.clientOrderId === clientOrderId);
      if (order) {
        return order;
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    return null;
  }

  private static async placeOrder(
    signer: Signer,
    order: Parameters<typeof JtxPerpsClient.postCreateOrder>[0],
    summary: Record<string, unknown>
  ): Promise<void> {
    const { transaction } = await JtxPerpsClient.postCreateOrder(order);
    const signature = await this.submit(signer, transaction);
    const filled = signature
      ? await this.waitForOrder(
          signer.address,
          order.symbol,
          order.clientOrderId
        )
      : null;
    const result = {
      ...(Config.dryRun && { dryRun: true }),
      ...summary,
      clientOrderId: order.clientOrderId,
      orderId: filled?.orderId ?? null,
      status: Config.dryRun ? null : (filled?.status ?? "submitted"),
      filledSize: filled ? Number(filled.filledSize) : null,
      signature,
      ...(Config.dryRun && { transaction }),
    };

    if (Output.isJson()) {
      Output.json(result);
      return;
    }
    if (Config.dryRun) {
      console.log(Output.DRY_RUN_LABEL);
    }
    const labels: Record<string, string> = {
      action: "Action",
      asset: "Market",
      side: "Side",
      size: "Size",
      sizeUsd: "Size (USD)",
      priceUsd: "Price Limit",
      collateralUsd: "Collateral",
      leverage: "Leverage",
      status: "Status",
      filledSize: "Filled",
      orderId: "Order",
      signature: "Tx Signature",
    };
    Output.table({
      type: "vertical",
      rows: Object.entries(labels)
        .filter(([key]) => result[key as keyof typeof result] != null)
        .map(([key, label]) => {
          const value = result[key as keyof typeof result];
          return {
            label,
            value: key.endsWith("Usd")
              ? Output.formatDollar(value as number)
              : key === "leverage"
                ? `${value}x`
                : String(value),
          };
        }),
    });
  }

  private static async open(opts: {
    asset: string;
    side: string;
    amount: string;
    leverage?: string;
    size?: string;
    limit?: string;
    key?: string;
  }): Promise<void> {
    if (!opts.leverage === !opts.size) {
      throw new Error("Provide exactly one of --leverage or --size.");
    }
    const collateralUsd = Number(opts.amount);
    if (!(collateralUsd >= MIN_OPEN_COLLATERAL_USD)) {
      throw new Error(
        `--amount must be at least ${MIN_OPEN_COLLATERAL_USD} USDC.`
      );
    }
    const side = PerpsTx.normalizeSide(opts.side);
    const jtxSide: JtxSide = side === "long" ? "Bid" : "Ask";
    const market = await this.market(opts.asset);
    const limitPrice = opts.limit ? Number(opts.limit) : undefined;
    const leverage = opts.leverage
      ? Number(opts.leverage)
      : Number(opts.size) / collateralUsd;
    const sizing = sizeOpenOrder({
      market,
      markPrice: market.markPrice,
      side: jtxSide,
      collateralUsd,
      leverage,
      limitPrice,
    });

    const signer = await Signer.load(opts.key ?? Config.load().activeKey);
    await this.assertTradable(market, limitPrice === undefined);
    await this.assertBetaAccess(signer.address);

    await this.placeOrder(
      signer,
      {
        user: signer.address,
        symbol: market.symbol,
        side: jtxSide,
        orderType: limitPrice === undefined ? "market" : "limit",
        price: sizing.price,
        quantity: sizing.quantity,
        collateralAmount: Number(NumberConverter.toChainAmount(opts.amount, 6)),
        reduceOnly: false,
        timeInForce:
          limitPrice === undefined ? "ImmediateOrCancel" : "GoodTilCanceled",
        clientOrderId: randomClientOrderId(),
      },
      {
        action: limitPrice === undefined ? "market-order" : "limit-order",
        asset: market.symbol,
        side,
        size: sizing.quantity,
        sizeUsd: sizing.sizeUsd,
        collateralUsd,
        leverage: Number((sizing.sizeUsd / collateralUsd).toFixed(2)),
        priceUsd: sizing.price,
      }
    );
  }

  private static async close(opts: {
    asset?: string;
    size?: string;
    limit?: string;
    order?: string;
    key?: string;
  }): Promise<void> {
    if (!opts.asset === !opts.order) {
      throw new Error("Provide exactly one of --asset or --order.");
    }
    const signer = await Signer.load(opts.key ?? Config.load().activeKey);
    const account = await JtxPerpsClient.getTradingAccountPubkey(
      signer.address
    );

    if (opts.order) {
      const orders = await JtxPerpsClient.getOpenOrders(account);
      const order = orders.find(
        (o) => o.orderId === opts.order || o.clientOrderId === opts.order
      );
      if (!order?.clientOrderId) {
        throw new Error(`Open order not found: ${opts.order}`);
      }
      const { transaction } = await JtxPerpsClient.postCancelOrder({
        user: signer.address,
        symbol: order.symbol,
        clientOrderId: order.clientOrderId,
        orderId: order.orderId,
      });
      const signature = await this.submit(signer, transaction);
      if (Output.isJson()) {
        Output.json({
          ...(Config.dryRun && { dryRun: true }),
          action: "cancel-order",
          orderId: order.orderId,
          asset: order.symbol,
          signature,
          ...(Config.dryRun && { transaction }),
        });
      } else if (Config.dryRun) {
        console.log(`${Output.DRY_RUN_LABEL} Order would be cancelled`);
      } else {
        console.log(`Order cancelled (tx: ${signature})`);
      }
      return;
    }

    const market = await this.market(opts.asset!);
    const position = (await JtxPerpsClient.getPositions(account)).find(
      (p) => p.symbol === market.symbol
    );
    if (!position) {
      throw new Error(`No open ${market.symbol} position.`);
    }
    const positionSize = Number(position.size);
    const closeSide: JtxSide = position.side === "Bid" ? "Ask" : "Bid";
    const limitPrice = opts.limit ? Number(opts.limit) : undefined;
    const requested = opts.size
      ? snapDown(Number(opts.size) / market.markPrice, market.stepSize)
      : positionSize;
    const isEntire = requested >= positionSize;
    const quantity = isEntire ? positionSize : requested;
    const price =
      limitPrice !== undefined
        ? snapDown(limitPrice, market.tickSize)
        : protectedPrice(
            closeSide === "Ask" ? market.bestBid : market.bestAsk,
            closeSide,
            market.tickSize
          );
    const sizeUsd = Number((quantity * market.markPrice).toFixed(6));
    // A full close may leave a remainder below the minimum, so only partial
    // closes are checked against order limits, as in the web.
    if (!isEntire) {
      assertWithinLimits(
        market,
        limitPrice !== undefined,
        "close",
        quantity,
        sizeUsd
      );
    }
    await this.assertTradable(market, limitPrice === undefined);

    await this.placeOrder(
      signer,
      {
        user: signer.address,
        symbol: market.symbol,
        side: closeSide,
        orderType: limitPrice === undefined ? "market" : "limit",
        price,
        quantity,
        collateralAmount: 0,
        reduceOnly: true,
        timeInForce:
          limitPrice !== undefined
            ? "GoodTilCanceled"
            : isEntire
              ? "FillOrKill"
              : "ImmediateOrCancel",
        clientOrderId: randomClientOrderId(),
      },
      {
        action: isEntire ? "close-position" : "decrease-position",
        asset: market.symbol,
        side: toSide(position.side),
        size: quantity,
        sizeUsd,
        priceUsd: price,
      }
    );
  }

  private static async set(opts: {
    asset: string;
    addCollateral?: string;
    removeCollateral?: string;
    key?: string;
  }): Promise<void> {
    if (!opts.addCollateral === !opts.removeCollateral) {
      throw new Error(
        "Provide exactly one of --add-collateral or --remove-collateral."
      );
    }
    const market = await this.market(opts.asset);
    const signer = await Signer.load(opts.key ?? Config.load().activeKey);
    const kind = opts.addCollateral ? "deposit" : "withdraw";
    const usd = Number(opts.addCollateral ?? opts.removeCollateral);

    if (kind === "deposit" && !(usd >= MIN_DEPOSIT_USD)) {
      throw new Error(`Deposits must be at least ${MIN_DEPOSIT_USD} USDC.`);
    }
    if (kind === "withdraw") {
      const { accounts } = await JtxPerpsClient.getTradingAccounts(
        signer.address
      );
      const free = Number(
        accounts.find((a) => a.market === market.symbol)?.data.freeBalance ?? 0
      );
      const max = Math.floor(Math.min(free * 0.95, free - 0.01) * 100) / 100;
      if (!(usd > 0) || usd > max) {
        throw new Error(
          `You can withdraw up to ${Math.max(max, 0)} USDC from the ${market.symbol} account right now.`
        );
      }
    }

    const amount = Number(NumberConverter.toChainAmount(String(usd), 6));
    const { transaction } = await JtxPerpsClient.postCollateral(kind, {
      user: signer.address,
      symbol: market.symbol,
      amount,
    });
    const signature = await this.submit(signer, transaction);
    const result = {
      ...(Config.dryRun && { dryRun: true }),
      action: kind === "deposit" ? "add-collateral" : "remove-collateral",
      asset: market.symbol,
      amountUsd: usd,
      signature,
      ...(Config.dryRun && { transaction }),
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
        {
          label: "Action",
          value: kind === "deposit" ? "Add Collateral" : "Remove Collateral",
        },
        { label: "Market", value: market.symbol },
        { label: "Amount", value: `${usd} USDC` },
        ...(signature ? [{ label: "Tx Signature", value: signature }] : []),
      ],
    });
  }
}
