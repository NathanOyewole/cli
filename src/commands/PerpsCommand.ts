import { writeFileSync } from "node:fs";

import chalk from "chalk";
import type { Command } from "commander";
import { HTTPError } from "ky";

import { PerpsClient } from "../clients/PerpsClient.ts";
import { Asset, resolveAsset } from "../lib/Asset.ts";
import { Config } from "../lib/Config.ts";
import { NumberConverter } from "../lib/NumberConverter.ts";
import { Output } from "../lib/Output.ts";
import { PerpsTx } from "../lib/PerpsTx.ts";
import { Signer } from "../lib/Signer.ts";
import { PerpsCollateral } from "./PerpsCollateral.ts";
import { PerpsDeltaNeutralCommand } from "./PerpsDeltaNeutralCommand.ts";
import { PerpsJlpCommand } from "./PerpsJlpCommand.ts";
import { PerpsJtxCommand } from "./PerpsJtxCommand.ts";
import { PerpsLeaderboardCommand } from "./PerpsLeaderboardCommand.ts";
import { PerpsLoansCommand } from "./PerpsLoansCommand.ts";

export class PerpsCommand {
  public static register(program: Command): void {
    const perps = program
      .command("perps")
      .description("Perpetual futures trading");
    perps
      .command("positions")
      .description("View open positions and pending limit orders")
      .option("--key <name>", "Key to use (overrides active key)")
      .option("--address <address>", "Wallet address to look up")
      .action((opts) => this.positions(opts));
    perps
      .command("markets")
      .description(
        "List JLP-pool markets with prices, fees, borrow rates, and liquidity"
      )
      .action(() => this.markets());
    perps
      .command("open")
      .description("Open a new position via market or limit order")
      .requiredOption("--asset <asset>", "Market to trade (SOL, BTC, ETH)")
      .requiredOption("--side <side>", "Direction (long, short, buy, sell)")
      .requiredOption(
        "--amount <number>",
        "Input token amount (human-readable)"
      )
      .option("--size <usd>", "Position size in USD")
      .option("--input <token>", "Input token (SOL, BTC, ETH, USDC)", "SOL")
      .option("--leverage <number>", "Leverage multiplier")
      .option("--limit <price>", "Trigger price for limit order")
      .option("--tp <price>", "Take-profit trigger price")
      .option("--sl <price>", "Stop-loss trigger price")
      .option("--slippage <bps>", "Max slippage in basis points", "200")
      .option("--key <name>", "Key to use for signing")
      .action((opts) => this.open(opts));
    perps
      .command("set")
      .description(
        "Update TP/SL, position collateral, or limit order trigger price"
      )
      .option("--position <pubkey>", "Position to update")
      .option("--order <pubkey>", "Limit order to update")
      .option("--tp <price>", "Take-profit trigger price")
      .option("--sl <price>", "Stop-loss trigger price")
      .option(
        "--size <usd>",
        "Create a partial TP/SL that closes this USD size instead of the whole position"
      )
      .option(
        "--add-collateral <amount>",
        "Deposit collateral (in --input token units) without changing size"
      )
      .option(
        "--remove-collateral <usd>",
        "Withdraw this USD value of collateral without changing size"
      )
      .option(
        "--input <token>",
        "Token to deposit with --add-collateral (defaults to position's collateral)"
      )
      .option(
        "--receive <token>",
        "Token to receive with --remove-collateral (defaults to position's collateral)"
      )
      .option("--slippage <bps>", "Max slippage in basis points", "200")
      .option("--limit <price>", "New trigger price for limit order")
      .option("--key <name>", "Key to use for signing")
      .action((opts) => this.set(opts));
    perps
      .command("close")
      .description("Close a position, cancel a limit order, or cancel TP/SL")
      .option("--position <pubkey>", "Position to close (or 'all')")
      .option(
        "--order <pubkey>",
        "Limit order to cancel (or 'expired' to close all expired orders)"
      )
      .option("--tpsl <pubkey>", "TP/SL order to cancel")
      .option("--size <usd>", "USD amount to reduce (partial close)")
      .option(
        "--receive <token>",
        "Token to receive (defaults to position's collateral)"
      )
      .option("--slippage <bps>", "Max slippage in basis points", "200")
      .option("--key <name>", "Key to use for signing")
      .action((opts) => this.close(opts));
    perps
      .command("history")
      .description("View past trading activity")
      .option("--key <name>", "Key to use (overrides active key)")
      .option("--address <address>", "Wallet address to look up")
      .option("--asset <asset>", "Filter by asset (SOL, BTC, ETH)")
      .option("--side <side>", "Filter by side (long, short)")
      .option("--action <action>", "Filter by action (Increase, Decrease)")
      .option("--after <date>", "Show trades after this date or UNIX timestamp")
      .option(
        "--before <date>",
        "Show trades before this date or UNIX timestamp"
      )
      .option("--limit <n>", "Max number of results", "20")
      .option(
        "--export <file>",
        "Write the wallet's full trade history to a CSV file instead"
      )
      .action((opts) => this.history(opts));
    PerpsJlpCommand.register(perps);
    PerpsLoansCommand.register(perps);
    PerpsLeaderboardCommand.register(perps);
    PerpsJtxCommand.register(perps);
    PerpsDeltaNeutralCommand.register(perps);
  }

  private static async positions(opts: {
    key?: string;
    address?: string;
  }): Promise<void> {
    if (opts.address && opts.key) {
      throw new Error("Only one of --address or --key can be provided.");
    }

    const address =
      opts.address ??
      (await Signer.loadAddress(opts.key ?? Config.load().activeKey));

    const [positionsRes, ordersRes] = await Promise.all([
      PerpsClient.getPositions(address),
      PerpsClient.getLimitOrders(address),
    ]);

    const mintToName = new Map<string, string>(
      Object.entries(Asset).map(([name, a]) => [a.id, name])
    );

    if (Output.isJson()) {
      Output.json({
        positions: positionsRes.dataList.map((p) => ({
          positionPubkey: p.positionPubkey,
          asset: p.asset,
          side: p.side,
          leverage: Number(p.leverage),
          sizeUsd: NumberConverter.fromMicroUsd(p.sizeUsd),
          entryPriceUsd: NumberConverter.fromMicroUsd(p.entryPriceUsd),
          markPriceUsd: NumberConverter.fromMicroUsd(p.markPriceUsd),
          pnlPct: Number(p.pnlAfterFeesPct),
          liquidationPriceUsd: NumberConverter.fromMicroUsd(
            p.liquidationPriceUsd
          ),
          tpsl: p.tpslRequests.map((t) => ({
            pubkey: t.positionRequestPubkey,
            type: t.requestType,
            triggerPriceUsd: t.triggerPriceUsd
              ? NumberConverter.fromMicroUsd(t.triggerPriceUsd)
              : null,
          })),
        })),
        limitOrders: ordersRes.dataList.map((o) => ({
          orderPubkey: o.positionRequestPubkey,
          asset: mintToName.get(o.marketMint) ?? o.marketMint,
          side: o.side,
          sizeUsd: NumberConverter.fromMicroUsd(o.sizeUsdDelta),
          triggerPriceUsd: o.triggerPrice
            ? NumberConverter.fromMicroUsd(o.triggerPrice)
            : null,
        })),
      });
      return;
    }

    // Positions tables
    if (positionsRes.dataList.length > 0) {
      for (const p of positionsRes.dataList) {
        const tp = p.tpslRequests.find((t) => t.requestType === "tp");
        const sl = p.tpslRequests.find((t) => t.requestType === "sl");
        const sideColor = p.side === "long" ? chalk.green.bold : chalk.red.bold;
        const rows: { label: string; value: string }[] = [
          {
            label: "Type",
            value: `${sideColor(`${p.asset} ${Number(p.leverage).toFixed(1)}x ${p.side}`)} ${chalk.gray(`(${p.positionPubkey})`)}`,
          },
          {
            label: "Size",
            value: Output.formatDollar(NumberConverter.fromMicroUsd(p.sizeUsd)),
          },
          {
            label: "Entry Price",
            value: Output.formatDollar(
              NumberConverter.fromMicroUsd(p.entryPriceUsd)
            ),
          },
          {
            label: "Mark Price",
            value: Output.formatDollar(
              NumberConverter.fromMicroUsd(p.markPriceUsd)
            ),
          },
          {
            label: "PnL",
            value: Output.formatPercentageChange(Number(p.pnlAfterFeesPct)),
          },
          {
            label: "Liq. Price",
            value: Output.formatDollar(
              NumberConverter.fromMicroUsd(p.liquidationPriceUsd)
            ),
          },
          {
            label: "TP",
            value: tp
              ? `${Output.formatDollar(tp.triggerPriceUsd ? NumberConverter.fromMicroUsd(tp.triggerPriceUsd) : undefined)} ${chalk.gray(`(${tp.positionRequestPubkey})`)}`
              : Output.formatDollar(undefined),
          },
          {
            label: "SL",
            value: sl
              ? `${Output.formatDollar(sl.triggerPriceUsd ? NumberConverter.fromMicroUsd(sl.triggerPriceUsd) : undefined)} ${chalk.gray(`(${sl.positionRequestPubkey})`)}`
              : Output.formatDollar(undefined),
          },
        ];

        Output.table({ type: "vertical", rows });
      }
    } else {
      console.log("\nNo open positions.");
    }

    // Limit orders table
    if (ordersRes.dataList.length > 0) {
      console.log("\nPending Limit Orders:");
      Output.table({
        type: "horizontal",
        headers: {
          asset: "Asset",
          side: "Side",
          size: "Size",
          trigger: "Trigger Price",
          pubkey: "Order",
        },
        rows: ordersRes.dataList.map((o) => ({
          asset:
            mintToName.get(o.marketMint) ?? o.marketMint.slice(0, 8) + "...",
          side: o.side,
          size: Output.formatDollar(
            NumberConverter.fromMicroUsd(o.sizeUsdDelta)
          ),
          trigger: Output.formatDollar(
            o.triggerPrice
              ? NumberConverter.fromMicroUsd(o.triggerPrice)
              : undefined
          ),
          pubkey: o.positionRequestPubkey,
        })),
      });
    } else {
      console.log("\nNo pending limit orders.");
    }
  }

  private static async markets(): Promise<void> {
    const markets = await PerpsClient.getMarkets();
    const pools = await Promise.all(
      markets.map((m) => PerpsClient.getPoolInfo(resolveAsset(m.asset).id))
    );

    const formatted = markets.map((r, i) => {
      const pool = pools[i]!;
      return {
        asset: r.asset,
        priceUsd: Number(r.price),
        changePct24h: Number(r.priceChange24H),
        highUsd24h: Number(r.priceHigh24H),
        lowUsd24h: Number(r.priceLow24H),
        volumeUsd24h: Number(r.volume),
        openFeePct: Number(pool.openFeePercent),
        maxPriceImpactFeePct: Number(pool.maxPriceImpactFeePercent),
        longBorrowRatePctPerHour: Number(pool.longBorrowRatePercent),
        shortBorrowRatePctPerHour: Number(pool.shortBorrowRatePercent),
        longAvailableLiquidityUsd: Number(pool.longAvailableLiquidity),
        shortAvailableLiquidityUsd: Number(pool.shortAvailableLiquidity),
        longUtilizationPct: Number(pool.longUtilizationPercent),
        shortUtilizationPct: Number(pool.shortUtilizationPercent),
      };
    });

    if (Output.isJson()) {
      Output.json(formatted);
      return;
    }

    Output.table({
      type: "horizontal",
      headers: {
        asset: "Asset",
        priceUsd: "Price",
        changePct24h: "24h Change",
        volumeUsd24h: "24h Volume",
        openFee: "Open Fee",
        borrow: "Borrow /hr (L/S)",
        liquidity: "Available Liq. (L/S)",
        utilization: "Utilization (L/S)",
      },
      rows: formatted.map((r) => ({
        asset: r.asset,
        priceUsd: Output.formatDollar(r.priceUsd),
        changePct24h: Output.formatPercentageChange(r.changePct24h),
        volumeUsd24h: Output.formatDollar(r.volumeUsd24h, { decimals: 0 }),
        openFee: `${r.openFeePct}%`,
        borrow: `${r.longBorrowRatePctPerHour}% / ${r.shortBorrowRatePctPerHour}%`,
        liquidity: `${Output.formatDollar(r.longAvailableLiquidityUsd, { decimals: 0 })} / ${Output.formatDollar(r.shortAvailableLiquidityUsd, { decimals: 0 })}`,
        utilization: `${r.longUtilizationPct}% / ${r.shortUtilizationPct}%`,
      })),
    });
  }

  private static async open(opts: {
    asset: string;
    side: string;
    amount: string;
    size?: string;
    input: string;
    leverage?: string;
    limit?: string;
    tp?: string;
    sl?: string;
    slippage: string;
    key?: string;
  }): Promise<void> {
    // Validation
    if (!opts.leverage && !opts.size) {
      throw new Error("Either --leverage or --size is required.");
    }
    if (opts.leverage && opts.size) {
      throw new Error("Only one of --leverage or --size can be provided.");
    }
    if (opts.limit && (opts.tp || opts.sl)) {
      throw new Error(
        "--limit cannot be combined with --tp or --sl. Use 'perps set' after the limit order fills."
      );
    }

    const side = PerpsTx.normalizeSide(opts.side);
    const asset = opts.asset.toUpperCase();
    if (!["SOL", "BTC", "ETH"].includes(asset)) {
      throw new Error(
        `${asset} is not a JLP-pool market (SOL, BTC, ETH). Orderbook markets such as JUP, HYPE, and ZEC trade with 'jup perps jtx open --asset ${asset} ...'.`
      );
    }
    const inputToken = opts.input.toUpperCase();
    const signer = await Signer.load(opts.key ?? Config.load().activeKey);

    // Build size params
    const inputDecimals = resolveAsset(inputToken).decimals;
    const inputTokenAmount = NumberConverter.toChainAmount(
      opts.amount,
      inputDecimals
    );
    const sizeUsdDelta = opts.size
      ? NumberConverter.toMicroUsd(opts.size)
      : undefined;

    if (opts.limit) {
      // Limit order
      const triggerPrice = NumberConverter.toMicroUsd(opts.limit);
      const res = await PerpsClient.postLimitOrder({
        asset,
        inputToken,
        inputTokenAmount,
        side,
        triggerPrice,
        leverage: opts.leverage,
        sizeUsdDelta,
        walletAddress: signer.address,
      });
      if (!res.serializedTxBase64) {
        throw new Error("API returned no transaction for limit order.");
      }

      const result = await PerpsTx.signAndExecute(
        signer,
        "create-limit-order",
        res.serializedTxBase64
      );

      if (Output.isJson()) {
        Output.json({
          ...(Config.dryRun && { dryRun: true }),
          type: "limit-order",
          positionPubkey: res.positionPubkey,
          asset,
          side,
          triggerPriceUsd: Number(opts.limit),
          sizeUsd: NumberConverter.fromMicroUsd(res.quote.sizeUsdDelta),
          leverage: Number(res.quote.leverage),
          signature: result.txid,
          ...(Config.dryRun && {
            transaction: res.serializedTxBase64,
          }),
        });
        return;
      }

      if (Config.dryRun) {
        console.log(Output.DRY_RUN_LABEL);
      }
      Output.table({
        type: "vertical",
        rows: [
          { label: "Type", value: "Limit Order" },
          { label: "Asset", value: asset },
          { label: "Side", value: side },
          {
            label: "Trigger Price",
            value: Output.formatDollar(Number(opts.limit)),
          },
          {
            label: "Size",
            value: Output.formatDollar(
              NumberConverter.fromMicroUsd(res.quote.sizeUsdDelta)
            ),
          },
          { label: "Leverage", value: `${res.quote.leverage}x` },
          ...(!Config.dryRun
            ? [{ label: "Tx Signature", value: result.txid! }]
            : []),
        ],
      });
    } else {
      // Market order
      const tpsl: {
        receiveToken: string;
        triggerPrice: string;
        requestType: string;
      }[] = [];
      if (opts.tp) {
        tpsl.push({
          receiveToken: inputToken,
          triggerPrice: NumberConverter.toMicroUsd(opts.tp),
          requestType: "tp",
        });
      }
      if (opts.sl) {
        tpsl.push({
          receiveToken: inputToken,
          triggerPrice: NumberConverter.toMicroUsd(opts.sl),
          requestType: "sl",
        });
      }

      const res = await PerpsClient.postIncreasePosition({
        asset,
        inputToken,
        inputTokenAmount,
        side,
        maxSlippageBps: opts.slippage,
        leverage: opts.leverage,
        sizeUsdDelta,
        walletAddress: signer.address,
        tpsl: tpsl.length > 0 ? tpsl : undefined,
      });
      // On an existing position the deposit first settles accrued borrow
      // fees; when it can't cover them the server quotes no size increase.
      if (BigInt(res.quote.sizeUsdDelta) === 0n) {
        const feesDue = Output.formatDollar(
          NumberConverter.fromMicroUsd(res.quote.outstandingBorrowFeeUsd)
        );
        throw new Error(
          `This order would not increase the position: the ${Output.formatDollar(NumberConverter.fromMicroUsd(res.quote.collateralUsdDelta))} deposit is used up by the ${feesDue} of borrow fees due. Increase --amount, or use 'jup perps set --position ${res.positionPubkey} --add-collateral' to only add collateral.`
        );
      }

      const result = await PerpsTx.signAndExecute(
        signer,
        "increase-position",
        res.serializedTxBase64
      );

      if (Output.isJson()) {
        Output.json({
          ...(Config.dryRun && { dryRun: true }),
          type: "market-order",
          positionPubkey: res.positionPubkey,
          asset,
          side,
          entryPriceUsd: NumberConverter.fromMicroUsd(
            res.quote.averagePriceUsd
          ),
          sizeUsd: NumberConverter.fromMicroUsd(res.quote.sizeUsdDelta),
          leverage: Number(res.quote.leverage),
          liquidationPriceUsd: NumberConverter.fromMicroUsd(
            res.quote.liquidationPriceUsd
          ),
          openFeeUsd: NumberConverter.fromMicroUsd(res.quote.openFeeUsd),
          signature: result.txid,
          ...(Config.dryRun && {
            transaction: res.serializedTxBase64,
          }),
        });
        return;
      }

      if (Config.dryRun) {
        console.log(Output.DRY_RUN_LABEL);
      }
      Output.table({
        type: "vertical",
        rows: [
          { label: "Type", value: "Market Order" },
          { label: "Asset", value: asset },
          { label: "Side", value: side },
          {
            label: "Entry Price",
            value: Output.formatDollar(
              NumberConverter.fromMicroUsd(res.quote.averagePriceUsd)
            ),
          },
          {
            label: "Size",
            value: Output.formatDollar(
              NumberConverter.fromMicroUsd(res.quote.sizeUsdDelta)
            ),
          },
          { label: "Leverage", value: `${res.quote.leverage}x` },
          {
            label: "Liq. Price",
            value: Output.formatDollar(
              NumberConverter.fromMicroUsd(res.quote.liquidationPriceUsd)
            ),
          },
          {
            label: "Open Fee",
            value: Output.formatDollar(
              NumberConverter.fromMicroUsd(res.quote.openFeeUsd)
            ),
          },
          ...(!Config.dryRun
            ? [{ label: "Tx Signature", value: result.txid! }]
            : []),
        ],
      });
    }
  }

  private static async set(opts: {
    position?: string;
    order?: string;
    tp?: string;
    sl?: string;
    size?: string;
    addCollateral?: string;
    removeCollateral?: string;
    input?: string;
    receive?: string;
    slippage: string;
    limit?: string;
    key?: string;
  }): Promise<void> {
    // Validation
    if (!opts.position && !opts.order) {
      throw new Error("Either --position or --order is required.");
    }
    if (opts.position && opts.order) {
      throw new Error("Only one of --position or --order can be provided.");
    }
    const isCollateralChange = Boolean(
      opts.addCollateral || opts.removeCollateral
    );
    if (opts.addCollateral && opts.removeCollateral) {
      throw new Error(
        "Only one of --add-collateral or --remove-collateral can be provided."
      );
    }
    if (isCollateralChange && (opts.tp || opts.sl || opts.order)) {
      throw new Error(
        "--add-collateral/--remove-collateral cannot be combined with --tp, --sl, or --order."
      );
    }
    if (opts.position && !isCollateralChange && !opts.tp && !opts.sl) {
      throw new Error(
        "--position requires --tp, --sl, --add-collateral, or --remove-collateral."
      );
    }
    if (opts.size && !opts.tp && !opts.sl) {
      throw new Error("--size requires --tp or --sl (partial TP/SL).");
    }
    if (opts.order && !opts.limit) {
      throw new Error("--order requires --limit.");
    }

    const signer = await Signer.load(opts.key ?? Config.load().activeKey);

    if (opts.order) {
      // Update limit order trigger price
      const res = await PerpsClient.patchLimitOrder({
        positionRequestPubkey: opts.order,
        triggerPrice: NumberConverter.toMicroUsd(opts.limit!),
      });
      if (!res.serializedTxBase64) {
        throw new Error("API returned no transaction for limit order update.");
      }

      const result = await PerpsTx.signAndExecute(
        signer,
        "update-limit-order",
        res.serializedTxBase64
      );

      if (Output.isJson()) {
        Output.json({
          ...(Config.dryRun && { dryRun: true }),
          action: "update-limit-order",
          triggerPriceUsd: Number(opts.limit),
          signature: result.txid,
          ...(Config.dryRun && {
            transaction: res.serializedTxBase64,
          }),
        });
        return;
      }

      if (Config.dryRun) {
        console.log(Output.DRY_RUN_LABEL);
      }
      Output.table({
        type: "vertical",
        rows: [
          { label: "Action", value: "Update Limit Order" },
          {
            label: "New Trigger Price",
            value: Output.formatDollar(Number(opts.limit)),
          },
          ...(!Config.dryRun
            ? [{ label: "Tx Signature", value: result.txid! }]
            : []),
        ],
      });
      return;
    }

    const positionsRes = await PerpsClient.getPositions(signer.address);
    const position = positionsRes.dataList.find(
      (p) => p.positionPubkey === opts.position
    );
    if (!position) {
      throw new Error(`Position not found: ${opts.position}`);
    }

    if (opts.addCollateral) {
      return PerpsCollateral.add(signer, position, {
        amount: opts.addCollateral,
        input: opts.input,
        slippage: opts.slippage,
      });
    }
    if (opts.removeCollateral) {
      return PerpsCollateral.remove(signer, position, {
        usd: opts.removeCollateral,
        receive: opts.receive,
        slippage: opts.slippage,
      });
    }

    const results: {
      type: string;
      action: string;
      triggerPriceUsd: number;
      sizeUsd: number | null;
      signature: string | null;
      transaction?: string;
    }[] = [];

    for (const [type, price] of [
      ["tp", opts.tp],
      ["sl", opts.sl],
    ] as const) {
      if (!price) {
        continue;
      }

      // Partial TP/SLs stack, so --size always creates a new one; without it
      // the single whole-position TP/SL is updated in place.
      const existing = opts.size
        ? undefined
        : position.tpslRequests.find(
            (t) => t.requestType === type && t.entirePosition
          );

      if (existing) {
        // Update existing
        const res = await PerpsClient.patchTpsl({
          positionRequestPubkey: existing.positionRequestPubkey,
          triggerPrice: NumberConverter.toMicroUsd(price),
        });
        const result = await PerpsTx.signAndExecute(
          signer,
          "update-tpsl",
          res.serializedTxBase64
        );
        results.push({
          type,
          action: "updated",
          triggerPriceUsd: Number(price),
          sizeUsd: null,
          signature: result.txid,
          ...(Config.dryRun && {
            transaction: res.serializedTxBase64,
          }),
        });
      } else {
        // Create new
        const res = await PerpsClient.postTpsl({
          walletAddress: signer.address,
          positionPubkey: opts.position!,
          tpsl: [
            {
              receiveToken: position.collateralToken,
              triggerPrice: NumberConverter.toMicroUsd(price),
              requestType: type,
              entirePosition: !opts.size,
              sizeUsdDelta: opts.size
                ? NumberConverter.toMicroUsd(opts.size)
                : undefined,
            },
          ],
        }).catch(this.explainTpslLimit);
        const result = await PerpsTx.signAndExecute(
          signer,
          "create-tpsl",
          res.serializedTxBase64
        );
        results.push({
          type,
          action: "created",
          triggerPriceUsd: Number(price),
          sizeUsd: opts.size ? Number(opts.size) : null,
          signature: result.txid,
          ...(Config.dryRun && {
            transaction: res.serializedTxBase64,
          }),
        });
      }
    }

    if (Output.isJson()) {
      Output.json({
        ...(Config.dryRun && { dryRun: true }),
        action: "set-tpsl",
        updates: results,
      });
      return;
    }

    if (Config.dryRun) {
      console.log(Output.DRY_RUN_LABEL);
    }
    for (const r of results) {
      const size = r.sizeUsd ? ` for $${r.sizeUsd} of size` : "";
      const tx = Config.dryRun ? "" : ` (tx: ${r.signature})`;
      console.log(
        `${r.type.toUpperCase()} ${r.action} at $${r.triggerPriceUsd}${size}${tx}`
      );
    }
  }

  private static async explainTpslLimit(err: unknown): Promise<never> {
    if (err instanceof HTTPError) {
      const body = (await err.response
        .clone()
        .json()
        .catch(() => undefined)) as
        | { code?: string; metadata?: { maxTpslRequests?: number } }
        | undefined;
      if (body?.code === "maximum_tpsl_requests_exceeded") {
        throw new Error(
          `This position already has the maximum of ${body.metadata?.maxTpslRequests ?? "allowed"} TP/SL orders. Cancel one with 'jup perps close --tpsl <pubkey>' first.`
        );
      }
    }
    throw err;
  }

  private static async close(opts: {
    position?: string;
    order?: string;
    tpsl?: string;
    size?: string;
    receive?: string;
    slippage: string;
    key?: string;
  }): Promise<void> {
    // Validation
    const targets = [opts.position, opts.order, opts.tpsl].filter(Boolean);
    if (targets.length === 0) {
      throw new Error("One of --position, --order, or --tpsl is required.");
    }
    if (targets.length > 1) {
      throw new Error(
        "Only one of --position, --order, or --tpsl can be provided."
      );
    }

    const signer = await Signer.load(opts.key ?? Config.load().activeKey);

    if (opts.order === "expired") {
      return this.closeExpiredOrders(signer);
    }

    if (opts.order) {
      // Cancel limit order
      const res = await PerpsClient.deleteLimitOrder(opts.order);
      const result = await PerpsTx.signAndExecute(
        signer,
        "cancel-limit-order",
        res.serializedTxBase64
      );

      if (Output.isJson()) {
        Output.json({
          ...(Config.dryRun && { dryRun: true }),
          action: "cancel-limit-order",
          signature: result.txid,
          ...(Config.dryRun && {
            transaction: res.serializedTxBase64,
          }),
        });
        return;
      }

      if (Config.dryRun) {
        console.log(`${Output.DRY_RUN_LABEL} Limit order would be cancelled`);
      } else {
        console.log(`Limit order cancelled (tx: ${result.txid})`);
      }
      return;
    }

    if (opts.tpsl) {
      // Cancel TP/SL
      const res = await PerpsClient.deleteTpsl(opts.tpsl);
      const result = await PerpsTx.signAndExecute(
        signer,
        "cancel-tpsl",
        res.serializedTxBase64
      );

      if (Output.isJson()) {
        Output.json({
          ...(Config.dryRun && { dryRun: true }),
          action: "cancel-tpsl",
          signature: result.txid,
          ...(Config.dryRun && {
            transaction: res.serializedTxBase64,
          }),
        });
        return;
      }

      if (Config.dryRun) {
        console.log(`${Output.DRY_RUN_LABEL} TP/SL would be cancelled`);
      } else {
        console.log(`TP/SL cancelled (tx: ${result.txid})`);
      }
      return;
    }

    // Close position(s)
    if (opts.position === "all") {
      // Close all positions
      const res = await PerpsClient.postCloseAll(signer.address);

      if (res.serializedTxs.length === 0) {
        throw new Error("No open positions to close.");
      }

      if (Config.dryRun) {
        if (Output.isJson()) {
          Output.json({
            dryRun: true,
            action: "close-all",
            signatures: null,
            transactions: res.serializedTxs.map((tx) => tx.serializedTxBase64),
          });
          return;
        }

        console.log(
          `${Output.DRY_RUN_LABEL} Would close ${res.serializedTxs.length} position${res.serializedTxs.length !== 1 ? "s" : ""}`
        );
        return;
      }

      const sigs: string[] = [];
      for (const tx of res.serializedTxs) {
        const result = await PerpsTx.signAndExecute(
          signer,
          "decrease-position",
          tx.serializedTxBase64
        );
        sigs.push(result.txid!);
      }

      if (Output.isJson()) {
        Output.json({ action: "close-all", signatures: sigs });
        return;
      }

      Output.table({
        type: "horizontal",
        headers: { signature: "Tx Signature" },
        rows: sigs.map((s) => ({ signature: s })),
      });
      return;
    }

    // Close single position (full or partial)
    let receiveToken = opts.receive?.toUpperCase();
    if (!receiveToken) {
      const positionsRes = await PerpsClient.getPositions(signer.address);
      const position = positionsRes.dataList.find(
        (p) => p.positionPubkey === opts.position
      );
      if (!position) {
        throw new Error(`Position not found: ${opts.position}`);
      }
      receiveToken = position.collateralToken;
    }

    const entirePosition = !opts.size;
    const res = await PerpsClient.postDecreasePosition({
      positionPubkey: opts.position!,
      receiveToken,
      sizeUsdDelta: opts.size
        ? NumberConverter.toMicroUsd(opts.size)
        : undefined,
      entirePosition: entirePosition || undefined,
      maxSlippageBps: opts.slippage,
    });

    const result = await PerpsTx.signAndExecute(
      signer,
      "decrease-position",
      res.serializedTxBase64
    );

    const receiveDecimals = resolveAsset(receiveToken).decimals;
    const receivedAmount = NumberConverter.fromChainAmount(
      res.quote.transferAmountToken,
      receiveDecimals
    );

    if (Output.isJson()) {
      Output.json({
        ...(Config.dryRun && { dryRun: true }),
        action: entirePosition ? "close-position" : "decrease-position",
        positionPubkey: res.positionPubkey,
        sizeReducedUsd: NumberConverter.fromMicroUsd(res.quote.sizeUsdDelta),
        pnlUsd: NumberConverter.fromMicroUsd(res.quote.pnlAfterFeesUsd),
        pnlPct: Number(res.quote.pnlAfterFeesPercent),
        received: `${receivedAmount} ${receiveToken}`,
        receivedUsd: NumberConverter.fromMicroUsd(res.quote.transferAmountUsd),
        feesUsd: NumberConverter.fromMicroUsd(res.quote.totalFeeUsd),
        signature: result.txid,
        ...(Config.dryRun && {
          transaction: res.serializedTxBase64,
        }),
      });
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
          value: entirePosition ? "Close Position" : "Decrease Position",
        },
        {
          label: "Size Reduced",
          value: Output.formatDollar(
            NumberConverter.fromMicroUsd(res.quote.sizeUsdDelta)
          ),
        },
        {
          label: "PnL",
          value: `${Output.formatDollar(NumberConverter.fromMicroUsd(res.quote.pnlAfterFeesUsd))} (${Output.formatPercentageChange(Number(res.quote.pnlAfterFeesPercent))})`,
        },
        {
          label: "Received",
          value: `${receivedAmount} ${receiveToken} (${Output.formatDollar(NumberConverter.fromMicroUsd(res.quote.transferAmountUsd))})`,
        },
        {
          label: "Fees",
          value: Output.formatDollar(
            NumberConverter.fromMicroUsd(res.quote.totalFeeUsd)
          ),
        },
        ...(!Config.dryRun
          ? [{ label: "Tx Signature", value: result.txid! }]
          : []),
      ],
    });
  }

  // Expired limit orders are closed by the user, not a keeper: the server
  // pre-builds one tx per order and they go straight to RPC.
  private static async closeExpiredOrders(signer: Signer): Promise<void> {
    const res = await PerpsClient.getExpiredOrders(signer.address);
    const orders = res.serializedTxs.map((tx) => tx.positionRequestPubkey);
    const signatures: string[] = [];
    for (const tx of Config.dryRun ? [] : res.serializedTxs) {
      signatures.push(
        (await PerpsTx.signAndSend(signer, tx.serializedTxBase64))!
      );
    }

    if (Output.isJson()) {
      Output.json({
        ...(Config.dryRun && { dryRun: true }),
        action: "close-expired-orders",
        orders,
        signatures: Config.dryRun ? null : signatures,
        ...(Config.dryRun && {
          transactions: res.serializedTxs.map((tx) => tx.serializedTxBase64),
        }),
      });
      return;
    }

    if (orders.length === 0) {
      console.log("No expired limit orders.");
      return;
    }
    if (Config.dryRun) {
      console.log(
        `${Output.DRY_RUN_LABEL} Would close ${orders.length} expired limit order${orders.length !== 1 ? "s" : ""}`
      );
      return;
    }
    Output.table({
      type: "horizontal",
      headers: { order: "Order", signature: "Tx Signature" },
      rows: orders.map((order, i) => ({ order, signature: signatures[i] })),
    });
  }

  private static parseTimestamp(value: string): string {
    if (/^\d+$/.test(value)) {
      return value;
    }
    const ms = new Date(value).getTime();
    if (isNaN(ms)) {
      throw new Error(`Invalid date: ${value}`);
    }
    return String(Math.floor(ms / 1000));
  }

  private static async history(opts: {
    key?: string;
    address?: string;
    asset?: string;
    side?: string;
    action?: string;
    after?: string;
    before?: string;
    limit: string;
    export?: string;
  }): Promise<void> {
    if (opts.address && opts.key) {
      throw new Error("Only one of --address or --key can be provided.");
    }

    const limit = Number(opts.limit);
    if (isNaN(limit) || limit < 1) {
      throw new Error("--limit must be a positive number.");
    }
    if (
      opts.action &&
      opts.action !== "Increase" &&
      opts.action !== "Decrease"
    ) {
      throw new Error("--action must be 'Increase' or 'Decrease'.");
    }
    if (opts.side && opts.side !== "long" && opts.side !== "short") {
      throw new Error("--side must be 'long' or 'short'.");
    }

    const address =
      opts.address ??
      (await Signer.loadAddress(opts.key ?? Config.load().activeKey));
    const mint = opts.asset ? resolveAsset(opts.asset).id : undefined;

    if (opts.export) {
      const csv = await PerpsClient.exportTrades(address);
      writeFileSync(opts.export, csv);
      const trades = csv.trim().split("\n").length - 1;
      if (Output.isJson()) {
        Output.json({ path: opts.export, trades });
      } else {
        console.log(`Exported ${trades} trades to ${opts.export}`);
      }
      return;
    }

    const res = await PerpsClient.getTrades({
      walletAddress: address,
      action: opts.action,
      mint,
      side: opts.side,
      start: 0,
      end: limit,
      createdAtAfter: opts.after ? this.parseTimestamp(opts.after) : undefined,
      createdAtBefore: opts.before
        ? this.parseTimestamp(opts.before)
        : undefined,
    });

    const mintToName = new Map<string, string>(
      Object.entries(Asset).map(([name, a]) => [a.id, name])
    );
    if (Output.isJson()) {
      Output.json({
        count: res.count,
        trades: res.dataList.map((t) => ({
          time: new Date(t.createdTime * 1000).toISOString(),
          asset: mintToName.get(t.mint) ?? t.mint,
          side: t.side,
          action: t.action,
          sizeUsd: Number(t.size),
          priceUsd: Number(t.price),
          pnlUsd: t.pnl ? Number(t.pnl) : null,
          pnlPct: t.pnlPercentage ? Number(t.pnlPercentage) : null,
          feeUsd: Number(t.fee),
          signature: t.txHash,
        })),
      });
      return;
    }

    if (res.dataList.length === 0) {
      console.log("\nNo trade history found.");
      return;
    }

    Output.table({
      type: "horizontal",
      headers: {
        time: "Time",
        asset: "Asset",
        side: "Side",
        action: "Action",
        size: "Size",
        price: "Price",
        pnl: "PnL",
        fee: "Fee",
        txHash: "Tx Signature",
      },
      rows: res.dataList.map((t) => {
        const sideColor = t.side === "long" ? chalk.green.bold : chalk.red.bold;
        return {
          time: new Date(t.createdTime * 1000).toLocaleString(),
          asset: mintToName.get(t.mint) ?? t.mint.slice(0, 8) + "...",
          side: sideColor(t.side),
          action: t.action,
          size: Output.formatDollar(Number(t.size), { decimals: 2 }),
          price: Output.formatDollar(Number(t.price), { decimals: 2 }),
          pnl:
            t.pnl && t.pnlPercentage
              ? `${Output.formatDollarChange(Number(t.pnl))} (${Output.formatPercentageChange(Number(t.pnlPercentage))})`
              : chalk.gray("\u2014"),
          fee: Output.formatDollar(Number(t.fee), { decimals: 2 }),
          txHash: t.txHash,
        };
      }),
    });

    if (res.count > limit) {
      console.log(
        `\nShowing ${res.dataList.length} of ${res.count} trades. Use --limit to see more.`
      );
    }
  }
}
