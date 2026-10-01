import type { Command } from "commander";

import {
  JlpClient,
  type LoanChangeResponse,
  type LoanPosition,
} from "../clients/JlpClient.ts";
import { Asset } from "../lib/Asset.ts";
import { Config } from "../lib/Config.ts";
import { NumberConverter } from "../lib/NumberConverter.ts";
import { Output } from "../lib/Output.ts";
import { PerpsTx } from "../lib/PerpsTx.ts";
import { Signer } from "../lib/Signer.ts";
import { JLP } from "./PerpsJlpCommand.ts";

const USDC_DECIMALS = Asset.USDC.decimals;

function formatPosition(p: LoanPosition) {
  return {
    positionPubkey: p.positionPubkey,
    collateralAmount: Number(
      NumberConverter.fromChainAmount(p.collateralTokenAmount, JLP.decimals)
    ),
    collateralUsd: NumberConverter.fromMicroUsd(p.collateralUsd),
    debtAmount: Number(
      NumberConverter.fromChainAmount(p.borrowSizeTokenAmount, USDC_DECIMALS)
    ),
    ltvPct: Number(p.ltvPercentage),
    liquidationPriceUsd: NumberConverter.fromMicroUsd(p.liquidationPriceUsd),
    maxBorrowAmount: Number(
      NumberConverter.fromChainAmount(p.maxBorrowTokenAmount, USDC_DECIMALS)
    ),
    maxRepayAmount: Number(
      NumberConverter.fromChainAmount(p.maxRepayTokenAmount, USDC_DECIMALS)
    ),
    maxWithdrawAmount: Number(
      NumberConverter.fromChainAmount(p.maxWithdrawTokenAmount, JLP.decimals)
    ),
  };
}

export class PerpsLoansCommand {
  public static register(perps: Command): void {
    const loans = perps
      .command("loans")
      .description("Borrow USDC against JLP collateral");
    loans
      .command("info")
      .description("Show borrow APR, liquidity, and LTV limits")
      .action(() => this.info());
    loans
      .command("positions")
      .description("View your JLP loan")
      .option("--key <name>", "Key to use (overrides active key)")
      .option("--address <address>", "Wallet address to look up")
      .action((opts) => this.positions(opts));
    loans
      .command("history")
      .description("View past deposits, borrows, repayments, and liquidations")
      .option("--key <name>", "Key to use (overrides active key)")
      .option("--address <address>", "Wallet address to look up")
      .option("--limit <n>", "Max number of results", "20")
      .action((opts) => this.history(opts));
    loans
      .command("borrow")
      .description("Deposit JLP collateral and/or borrow USDC")
      .option("--deposit <jlp>", "JLP collateral to deposit")
      .option("--amount <usdc>", "USDC to borrow")
      .option("--key <name>", "Key to use for signing")
      .action((opts) => this.borrow(opts));
    loans
      .command("repay")
      .description("Repay USDC and/or withdraw JLP collateral")
      .option("--amount <usdc>", "USDC to repay, or 'max' for the full debt")
      .option(
        "--withdraw <jlp>",
        "JLP collateral to withdraw, or 'max' for the most allowed"
      )
      .option("--key <name>", "Key to use for signing")
      .action((opts) => this.repay(opts));
  }

  private static async info(): Promise<void> {
    const res = await JlpClient.getLoanInfo();
    const info = {
      jlpPriceUsd: NumberConverter.fromMicroUsd(res.currentJlpPriceUsd),
      borrowAprPct: Number(res.borrowApr),
      availableLiquidityUsd: NumberConverter.fromMicroUsd(
        res.availableLiquidityUsd
      ),
      totalSupplyUsd: NumberConverter.fromMicroUsd(res.totalSupplyUsd),
      utilizationPct: Number(res.utilizationRatePercentage),
      maxLtvPct: Number(res.maxLtvPercentage),
      liquidationLtvPct: Number(res.liquidationMarginPercentage),
      liquidationPenaltyPct: Number(res.liquidationPenaltyPercentage),
    };

    if (Output.isJson()) {
      Output.json(info);
      return;
    }
    Output.table({
      type: "vertical",
      rows: [
        { label: "JLP Price", value: Output.formatDollar(info.jlpPriceUsd) },
        { label: "Borrow APR", value: `${info.borrowAprPct}%` },
        {
          label: "Available USDC",
          value: Output.formatDollar(info.availableLiquidityUsd, {
            decimals: 0,
          }),
        },
        { label: "Utilization", value: `${info.utilizationPct}%` },
        { label: "Max LTV", value: `${info.maxLtvPct}%` },
        { label: "Liquidation LTV", value: `${info.liquidationLtvPct}%` },
        {
          label: "Liquidation Penalty",
          value: `${info.liquidationPenaltyPct}%`,
        },
      ],
    });
  }

  private static async positions(opts: {
    key?: string;
    address?: string;
  }): Promise<void> {
    const address = await PerpsTx.resolveAddress(opts);
    const res = await JlpClient.getLoanPositions(address);
    const positions = res.dataList.map(formatPosition);

    if (Output.isJson()) {
      Output.json({ positions });
      return;
    }
    if (positions.length === 0) {
      console.log("No JLP loan.");
      return;
    }
    for (const p of positions) {
      Output.table({
        type: "vertical",
        rows: [
          { label: "Position", value: p.positionPubkey },
          {
            label: "Collateral",
            value: `${p.collateralAmount} JLP (${Output.formatDollar(p.collateralUsd)})`,
          },
          { label: "Debt", value: `${p.debtAmount} USDC` },
          { label: "LTV", value: `${p.ltvPct}%` },
          {
            label: "Liq. JLP Price",
            value: Output.formatDollar(p.liquidationPriceUsd),
          },
          { label: "Can Borrow", value: `${p.maxBorrowAmount} USDC` },
          { label: "Can Withdraw", value: `${p.maxWithdrawAmount} JLP` },
        ],
      });
    }
  }

  private static async history(opts: {
    key?: string;
    address?: string;
    limit: string;
  }): Promise<void> {
    const limit = Number(opts.limit);
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error("--limit must be a positive integer.");
    }
    const address = await PerpsTx.resolveAddress(opts);
    const res = await JlpClient.getLoanHistory({
      walletAddress: address,
      start: 0,
      end: limit,
    });
    const history = res.dataList.map((h) => {
      const isJlp = h.tokenMint === JLP.id;
      return {
        time: new Date(h.createdTime * 1000).toISOString(),
        type: h.transactionType,
        amount: Number(
          NumberConverter.fromChainAmount(
            h.tokenAmount,
            isJlp ? JLP.decimals : USDC_DECIMALS
          )
        ),
        token: isJlp ? "JLP" : "USDC",
        signature: h.txHash,
      };
    });

    if (Output.isJson()) {
      Output.json({ count: res.count, history });
      return;
    }
    if (history.length === 0) {
      console.log("No loan history found.");
      return;
    }
    Output.table({
      type: "horizontal",
      headers: {
        time: "Time",
        type: "Type",
        amount: "Amount",
        signature: "Tx Signature",
      },
      rows: history.map((h) => ({
        time: new Date(h.time).toLocaleString(),
        type: h.type,
        amount: `${h.amount} ${h.token}`,
        signature: h.signature,
      })),
    });
  }

  private static async borrow(opts: {
    deposit?: string;
    amount?: string;
    key?: string;
  }): Promise<void> {
    if (!opts.deposit && !opts.amount) {
      throw new Error("Provide --deposit, --amount, or both.");
    }
    const signer = await Signer.load(opts.key ?? Config.load().activeKey);
    const res = await JlpClient.postDepositBorrow({
      walletAddress: signer.address,
      depositTokenAmount: opts.deposit
        ? NumberConverter.toChainAmount(opts.deposit, JLP.decimals)
        : "0",
      borrowTokenAmount: opts.amount
        ? NumberConverter.toChainAmount(opts.amount, USDC_DECIMALS)
        : "0",
    });
    await this.submit(signer, res, {
      action: "loan-borrow",
      depositedAmount: opts.deposit ?? null,
      borrowedAmount: opts.amount ?? null,
    });
  }

  private static async repay(opts: {
    amount?: string;
    withdraw?: string;
    key?: string;
  }): Promise<void> {
    if (!opts.amount && !opts.withdraw) {
      throw new Error("Provide --amount, --withdraw, or both.");
    }
    const signer = await Signer.load(opts.key ?? Config.load().activeKey);
    const needsPosition = opts.amount === "max" || opts.withdraw === "max";
    const position = needsPosition
      ? (await JlpClient.getLoanPositions(signer.address)).dataList[0]
      : undefined;
    if (needsPosition && !position) {
      throw new Error("No JLP loan found for this wallet.");
    }

    const repay =
      opts.amount === "max"
        ? position!.maxRepayTokenAmount
        : opts.amount
          ? NumberConverter.toChainAmount(opts.amount, USDC_DECIMALS)
          : "0";
    const withdraw =
      opts.withdraw === "max"
        ? position!.maxWithdrawTokenAmount
        : opts.withdraw
          ? NumberConverter.toChainAmount(opts.withdraw, JLP.decimals)
          : "0";
    const res = await JlpClient.postRepayWithdraw({
      walletAddress: signer.address,
      repayTokenAmount: repay,
      withdrawTokenAmount: withdraw,
    });
    await this.submit(signer, res, {
      action: "loan-repay",
      repaidAmount:
        repay === "0"
          ? null
          : NumberConverter.fromChainAmount(repay, USDC_DECIMALS),
      withdrawnAmount:
        withdraw === "0"
          ? null
          : NumberConverter.fromChainAmount(withdraw, JLP.decimals),
    });
  }

  private static async submit(
    signer: Signer,
    res: LoanChangeResponse,
    change: Record<string, string | null>
  ): Promise<void> {
    if (!res.serializedTxBase64) {
      throw new Error("API returned no transaction for this loan change.");
    }
    const signature = await PerpsTx.signAndSend(signer, res.serializedTxBase64);
    const after = {
      positionPubkey: res.positionPubkey,
      collateralAmount: Number(
        NumberConverter.fromChainAmount(res.collateralTokenAmount, JLP.decimals)
      ),
      debtAmount: Number(
        NumberConverter.fromChainAmount(
          res.borrowSizeTokenAmount,
          USDC_DECIMALS
        )
      ),
      ltvPct: Number(res.ltvPercentage),
      liquidationPriceUsd: NumberConverter.fromMicroUsd(
        res.liquidationPriceUsd
      ),
    };

    if (Output.isJson()) {
      Output.json({
        ...(Config.dryRun && { dryRun: true }),
        ...change,
        ...after,
        signature,
        ...(Config.dryRun && { transaction: res.serializedTxBase64 }),
      });
      return;
    }

    if (Config.dryRun) {
      console.log(Output.DRY_RUN_LABEL);
    }
    const labels: Record<string, [string, string]> = {
      depositedAmount: ["Deposit", "JLP"],
      borrowedAmount: ["Borrow", "USDC"],
      repaidAmount: ["Repay", "USDC"],
      withdrawnAmount: ["Withdraw", "JLP"],
    };
    Output.table({
      type: "vertical",
      rows: [
        ...Object.entries(change)
          .filter(([k, v]) => labels[k] && v !== null)
          .map(([k, v]) => ({
            label: labels[k]![0],
            value: `${v} ${labels[k]![1]}`,
          })),
        { label: "Collateral After", value: `${after.collateralAmount} JLP` },
        { label: "Debt After", value: `${after.debtAmount} USDC` },
        { label: "LTV After", value: `${after.ltvPct}%` },
        {
          label: "Liq. JLP Price",
          value: Output.formatDollar(after.liquidationPriceUsd),
        },
        ...(signature ? [{ label: "Tx Signature", value: signature }] : []),
      ],
    });
  }
}
