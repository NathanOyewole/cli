import type { Base64EncodedBytes } from "@solana/kit";
import { address } from "@solana/kit";
import type { Command } from "commander";

import { NeutralTradeClient } from "../clients/NeutralTradeClient.ts";
import { Config } from "../lib/Config.ts";
import {
  DeltaNeutralVault,
  VAULT,
  VAULT_ID,
  type UserBundle,
} from "../lib/DeltaNeutralVault.ts";
import { NumberConverter } from "../lib/NumberConverter.ts";
import { Output } from "../lib/Output.ts";
import { PerpsTx } from "../lib/PerpsTx.ts";
import { Rpc } from "../lib/Rpc.ts";
import { Signer } from "../lib/Signer.ts";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

// Same math as the web's calculateUserBalances.
function userBalances(user: UserBundle, decimals: number, pps: number) {
  const scale = 10 ** decimals;
  const shares = Number(user.shares) / scale;
  const balanceUsd = shares * pps;
  const netDepositsUsd = Number(user.netDeposits) / scale;
  const round = (n: number) => Number(n.toFixed(6));
  return {
    shares,
    balanceUsd: round(balanceUsd),
    pendingDepositUsd: round(Number(user.pendingDeposit) / scale),
    pendingWithdrawalUsd: round((Number(user.pendingShares) * pps) / scale),
    netDepositsUsd: round(netDepositsUsd),
    earningsUsd: round(balanceUsd - netDepositsUsd),
    feesPaidUsd: round(Number(user.totalFeeCharged) / scale),
    withdrawalAvailableAt:
      user.withdrawalAvailableTimestamp > 0n
        ? new Date(
            Number(user.withdrawalAvailableTimestamp) * 1000
          ).toISOString()
        : null,
  };
}

export class PerpsDeltaNeutralCommand {
  public static register(perps: Command): void {
    const dn = perps
      .command("delta-neutral")
      .description(
        "JLP Delta Neutral vault (Neutral Trade): earn JLP yield with price exposure hedged, in USDC"
      );
    dn.command("info")
      .description("Show vault APY, TVL, share price, limits, and allocations")
      .action(() => this.info());
    dn.command("history")
      .description("Show daily TVL and share price snapshots")
      .option("--days <n>", "Days of history (or 'all')", "30")
      .action((opts) => this.history(opts));
    dn.command("positions")
      .description("View your vault balance, pending requests, and earnings")
      .option("--key <name>", "Key to use (overrides active key)")
      .option("--address <address>", "Wallet address to look up")
      .action((opts) => this.positions(opts));
    dn.command("deposit")
      .description("Request a USDC deposit (processed daily at 07:00 UTC)")
      .requiredOption("--amount <usdc>", "USDC to deposit")
      .option("--key <name>", "Key to use for signing")
      .action((opts) => this.deposit(opts));
    dn.command("withdraw")
      .description("Request a withdrawal (paid out after the redeem lock)")
      .requiredOption("--amount <usdc>", "USD value to withdraw, or 'max'")
      .option("--key <name>", "Key to use for signing")
      .action((opts) => this.withdraw(opts));
  }

  private static async info(): Promise<void> {
    const [config, metrics, state] = await Promise.all([
      NeutralTradeClient.getConfig(VAULT_ID),
      NeutralTradeClient.getMetrics(VAULT_ID),
      DeltaNeutralVault.load(),
    ]);
    const scale = 10 ** state.bundle.assetDecimals;
    const [hour, minute] = config.processTime;
    const info = {
      vaultId: config.vaultId,
      name: config.name,
      vaultAddress: config.vaultAddress,
      depositToken: config.depositToken,
      apyPct: Number(metrics.apyAfterFees.toFixed(2)),
      aprPct: Number(metrics.aprAfterFees.toFixed(2)),
      tvlUsd: Number(state.tvl.toFixed(2)),
      tvlCapUsd: config.tvlCap,
      sharePriceUsd: Number(state.pps.toFixed(6)),
      roiPct: metrics.roi,
      roiSince: metrics.roiSince,
      maxDrawdownPct: metrics.maxDrawdown,
      sharpeRatio: metrics.sharpeRatio,
      minDepositUsd: Number(state.bundle.minDepositAmount) / scale,
      minWithdrawUsd: config.minWithdrawAmount,
      depositLockHours: config.depositLock / HOUR_MS,
      redeemLockHours: config.redeemLock / HOUR_MS,
      processTimeUtc: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
      allocations: metrics.allocations.map((a) => ({
        name: a.name,
        ratioPct: Number((a.ratio * 100).toFixed(2)),
        tvlUsd: Number(a.tvl.toFixed(2)),
      })),
    };

    if (Output.isJson()) {
      Output.json(info);
      return;
    }
    Output.table({
      type: "vertical",
      rows: [
        { label: "Vault", value: `${info.name} (${info.vaultAddress})` },
        { label: "APY (after fees)", value: `${info.apyPct}%` },
        {
          label: "TVL",
          value: `${Output.formatDollar(info.tvlUsd, { decimals: 2 })} / ${Output.formatDollar(info.tvlCapUsd, { decimals: 0 })} cap`,
        },
        { label: "Share Price", value: `$${info.sharePriceUsd}` },
        {
          label: "Max Drawdown",
          value:
            info.maxDrawdownPct === null
              ? "—"
              : `${info.maxDrawdownPct.toFixed(2)}%`,
        },
        {
          label: "Deposit",
          value: `min ${info.minDepositUsd} ${info.depositToken}, locked ${info.depositLockHours}h`,
        },
        {
          label: "Withdraw",
          value: `min ${info.minWithdrawUsd} ${info.depositToken}, paid after ${info.redeemLockHours}h`,
        },
        { label: "Processing", value: `daily at ${info.processTimeUtc} UTC` },
      ],
    });
  }

  private static async history(opts: { days: string }): Promise<void> {
    let startDate: string | undefined;
    if (opts.days !== "all") {
      const days = Number(opts.days);
      if (!Number.isInteger(days) || days < 1) {
        throw new Error("--days must be a positive integer or 'all'.");
      }
      startDate = new Date(Date.now() - days * DAY_MS)
        .toISOString()
        .slice(0, 10);
    }
    const snapshots = (
      await NeutralTradeClient.getSnapshots(VAULT_ID, startDate)
    ).map((s) => ({
      date: s.date.slice(0, 10),
      tvlUsd: s.tvl === null ? null : Number(s.tvl.toFixed(2)),
      sharePriceUsd: Number(s.pps.toFixed(6)),
    }));

    if (Output.isJson()) {
      Output.json({ snapshots });
      return;
    }
    Output.table({
      type: "horizontal",
      headers: { date: "Date", tvl: "TVL", pps: "Share Price" },
      rows: snapshots.map((s) => ({
        date: s.date,
        tvl: Output.formatDollar(s.tvlUsd ?? undefined, { decimals: 2 }),
        pps: `$${s.sharePriceUsd}`,
      })),
    });
  }

  private static async positions(opts: {
    key?: string;
    address?: string;
  }): Promise<void> {
    const wallet = await PerpsTx.resolveAddress(opts);
    const state = await DeltaNeutralVault.load(address(wallet));
    const position =
      state.user &&
      userBalances(state.user, state.bundle.assetDecimals, state.pps);

    if (Output.isJson()) {
      Output.json({ position: position ?? null });
      return;
    }
    if (!position) {
      console.log("No delta neutral vault position.");
      return;
    }
    Output.table({
      type: "vertical",
      rows: [
        { label: "Balance", value: Output.formatDollar(position.balanceUsd) },
        { label: "Shares", value: String(position.shares) },
        {
          label: "Earnings",
          value: Output.formatDollarChange(position.earningsUsd),
        },
        {
          label: "Pending Deposit",
          value: Output.formatDollar(position.pendingDepositUsd),
        },
        {
          label: "Pending Withdrawal",
          value: Output.formatDollar(position.pendingWithdrawalUsd),
        },
        {
          label: "Withdrawal Available",
          value: position.withdrawalAvailableAt ?? "—",
        },
        {
          label: "Fees Paid",
          value: Output.formatDollar(position.feesPaidUsd),
        },
      ],
    });
  }

  private static async deposit(opts: {
    amount: string;
    key?: string;
  }): Promise<void> {
    const signer = await Signer.load(opts.key ?? Config.load().activeKey);
    const user = address(signer.address);
    const [state, config] = await Promise.all([
      DeltaNeutralVault.load(user),
      NeutralTradeClient.getConfig(VAULT_ID),
    ]);
    const { bundle } = state;
    const amount = BigInt(
      NumberConverter.toChainAmount(opts.amount, bundle.assetDecimals)
    );
    if (amount < bundle.minDepositAmount) {
      throw new Error(
        `Minimum deposit is ${NumberConverter.fromChainAmount(bundle.minDepositAmount, bundle.assetDecimals)} ${config.depositToken}.`
      );
    }
    if (state.tvl + Number(opts.amount) > config.tvlCap) {
      throw new Error(
        `Deposit would exceed the vault's ${config.tvlCap} ${config.depositToken} TVL cap.`
      );
    }
    const transaction = await DeltaNeutralVault.buildTransaction(
      user,
      await DeltaNeutralVault.depositInstructions(
        user,
        bundle,
        amount,
        state.user !== null
      )
    );
    await this.submit(signer, transaction, {
      action: "deposit-request",
      amountUsd: Number(opts.amount),
      note: `Pending until the next daily processing at ${String(config.processTime[0]).padStart(2, "0")}:00 UTC; locked for ${config.depositLock / HOUR_MS}h after.`,
    });
  }

  private static async withdraw(opts: {
    amount: string;
    key?: string;
  }): Promise<void> {
    const signer = await Signer.load(opts.key ?? Config.load().activeKey);
    const user = address(signer.address);
    const [state, config] = await Promise.all([
      DeltaNeutralVault.load(user),
      NeutralTradeClient.getConfig(VAULT_ID),
    ]);
    const existing = state.user;
    if (!existing || existing.shares === 0n) {
      throw new Error("No delta neutral vault balance to withdraw.");
    }
    const decimals = state.bundle.assetDecimals;
    const balanceUsd = (Number(existing.shares) * state.pps) / 10 ** decimals;
    const all = opts.amount === "max" || Number(opts.amount) >= balanceUsd;
    if (!all && !(Number(opts.amount) >= config.minWithdrawAmount)) {
      throw new Error(
        `Minimum withdrawal is ${config.minWithdrawAmount} ${config.depositToken} (or use --amount max).`
      );
    }
    // Partial withdrawals convert USD to shares at the current share price.
    const shares = all
      ? existing.shares
      : BigInt(Math.floor((Number(opts.amount) * 10 ** decimals) / state.pps));
    const transaction = await DeltaNeutralVault.buildTransaction(user, [
      await DeltaNeutralVault.withdrawInstruction(user, shares),
    ]);
    await this.submit(signer, transaction, {
      action: "withdraw-request",
      amountUsd: Number((all ? balanceUsd : Number(opts.amount)).toFixed(6)),
      shares: Number(shares) / 10 ** decimals,
      note: `Paid out in ${config.depositToken} after the ${config.redeemLock / HOUR_MS}h redeem lock and the next daily processing.`,
    });
  }

  private static async submit(
    signer: Signer,
    transaction: string,
    summary: Record<string, string | number>
  ): Promise<void> {
    const signature = Config.dryRun
      ? null
      : await Rpc.sendAndConfirm(
          await signer.signTransaction(transaction as Base64EncodedBytes)
        );
    if (Output.isJson()) {
      Output.json({
        ...(Config.dryRun && { dryRun: true }),
        ...summary,
        vaultAddress: VAULT,
        signature,
        ...(Config.dryRun && { transaction }),
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
          value:
            summary.action === "deposit-request"
              ? "Deposit Request"
              : "Withdrawal Request",
        },
        {
          label: "Amount",
          value: Output.formatDollar(summary.amountUsd as number),
        },
        { label: "Note", value: String(summary.note) },
        ...(signature ? [{ label: "Tx Signature", value: signature }] : []),
      ],
    });
  }
}
