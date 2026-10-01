import { isAddress, type Base64EncodedBytes } from "@solana/kit";
import type { Command } from "commander";

import {
  StakeClient,
  type StakeAccount,
  type StakeCraftResponse,
} from "../clients/StakeClient.ts";
import { Asset } from "../lib/Asset.ts";
import { Config } from "../lib/Config.ts";
import { NumberConverter } from "../lib/NumberConverter.ts";
import { Output } from "../lib/Output.ts";
import { Signer } from "../lib/Signer.ts";
import { Swap } from "../lib/Swap.ts";

const JUPSOL_MINT = "jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v";
const SOL_DECIMALS = Asset.SOL.decimals;
// jup.ag/stake shows the validator APY as a range up to this many points higher.
const APY_RANGE_UPPER_OFFSET_PCT = 2;

type ActionRow = { label: string; value: string };

export class StakeCommand {
  public static register(program: Command): void {
    const stake = program
      .command("stake")
      .description("Native SOL staking, JupSOL and stake account management");

    stake
      .command("info")
      .description("Jupiter validator APY and JupSOL pool stats")
      .action(() => this.info());
    stake
      .command("accounts")
      .description("List stake accounts with their state and allowed actions")
      .option("--key <name>", "Key to use (overrides active key)")
      .option("--address <address>", "Wallet address to look up")
      .action((opts) => this.accounts(opts));
    stake
      .command("rewards")
      .description("Staking rewards history of a stake account")
      .requiredOption("--stake-account <address>", "Stake account address")
      .option("--limit <n>", "Max number of epochs", "10")
      .option("--before-epoch <epoch>", "Pagination cursor from a prior call")
      .action((opts) => this.rewards(opts));

    const native = stake
      .command("native")
      .description("Stake SOL natively with the Jupiter validator");
    native
      .command("deposit")
      .description("Stake SOL into a new stake account")
      .option("--amount <n>", "SOL amount")
      .option("--raw-amount <n>", "Amount in lamports")
      .option("--key <name>", "Key to use for signing")
      .action((opts) => this.nativeDeposit(opts));
    for (const [name, description] of [
      ["deactivate", "Unstake: deactivate a stake account"],
      ["reactivate", "Re-delegate a deactivating stake account"],
      ["withdraw", "Withdraw an inactive stake account to SOL"],
    ] as const) {
      native
        .command(name)
        .description(description)
        .requiredOption("--stake-account <address>", "Stake account address")
        .option("--key <name>", "Key to use for signing")
        .action((opts) => this.accountAction(name, opts));
    }
    native
      .command("split")
      .description("Split SOL off a stake account into a new one")
      .requiredOption("--stake-account <address>", "Stake account to split")
      .option("--amount <n>", "SOL amount to move into the new account")
      .option("--raw-amount <n>", "Amount in lamports")
      .option("--key <name>", "Key to use for signing")
      .action((opts) => this.split(opts));
    native
      .command("merge")
      .description("Merge stake accounts into one")
      .requiredOption(
        "--stake-account <address>",
        "Destination stake account (kept)"
      )
      .requiredOption(
        "--sources <addresses>",
        "Comma-separated stake accounts merged into the destination"
      )
      .option("--key <name>", "Key to use for signing")
      .action((opts) => this.merge(opts));
    native
      .command("convert")
      .description("Convert a Jupiter-validator stake account to JupSOL")
      .requiredOption("--stake-account <address>", "Stake account address")
      .option("--amount <n>", "SOL amount to convert (default: all)")
      .option("--raw-amount <n>", "Amount in lamports")
      .option("--key <name>", "Key to use for signing")
      .action((opts) => this.convert(opts));

    const jupsol = stake
      .command("jupsol")
      .description("Liquid staking with JupSOL");
    jupsol
      .command("deposit")
      .description("Stake SOL for JupSOL")
      .option("--amount <n>", "SOL amount")
      .option("--raw-amount <n>", "Amount in lamports")
      .option("--key <name>", "Key to use for signing")
      .action((opts) => this.jupsolDeposit(opts));
    jupsol
      .command("withdraw")
      .description("Unstake JupSOL into a native stake account")
      .option("--amount <n>", "JupSOL amount")
      .option("--raw-amount <n>", "Amount in JupSOL base units")
      .option(
        "--mode <mode>",
        "'native' (instant, stake account at the Jupiter validator) or 'delayed' (stake account at --validator)",
        "native"
      )
      .option(
        "--validator <vote-account>",
        "Validator vote account for --mode delayed (default: Jupiter)"
      )
      .option("--key <name>", "Key to use for signing")
      .action((opts) => this.jupsolWithdraw(opts));
  }

  private static async info(): Promise<void> {
    const [validator, pool] = await Promise.all([
      StakeClient.getValidator(),
      StakeClient.getPool(),
    ]);
    const solPerJupsol =
      Number(BigInt(pool.totalLamports)) / Number(BigInt(pool.poolTokenSupply));
    const apyPct = validator.apy === null ? null : validator.apy * 100;
    const fee = pool.stakeWithdrawalFee;
    const result = {
      validator: {
        voteAccount: validator.voteAccount,
        apyPct,
        maxApyPct: apyPct === null ? null : apyPct + APY_RANGE_UPPER_OFFSET_PCT,
        commissionPct: validator.commission,
        activatedStake: this.sol(validator.activatedStakeLamports),
        delinquent: validator.delinquent ?? null,
      },
      jupsol: {
        mint: JUPSOL_MINT,
        pool: pool.address,
        solPerJupsol,
        totalStaked: this.sol(pool.totalLamports),
        instantUnstakeCapacity: this.sol(pool.instantUnstakeCapacityLamports),
        withdrawalFeePct:
          Number(fee.denominator) === 0
            ? 0
            : (Number(fee.numerator) / Number(fee.denominator)) * 100,
        minimumDelegation: this.sol(pool.minimumDelegation),
      },
    };

    if (Output.isJson()) {
      Output.json(result);
      return;
    }
    Output.table({
      type: "vertical",
      rows: [
        { label: "Validator", value: validator.voteAccount },
        {
          label: "APY",
          value:
            apyPct === null
              ? "\u2014"
              : `${apyPct.toFixed(2)}% - ${(apyPct + APY_RANGE_UPPER_OFFSET_PCT).toFixed(2)}%`,
        },
        { label: "Commission", value: `${validator.commission}%` },
        {
          label: "Total Staked",
          value: `${this.fmt(result.validator.activatedStake)} SOL`,
        },
        { label: "JupSOL Rate", value: `${solPerJupsol.toFixed(6)} SOL` },
        {
          label: "Instant Unstake Capacity",
          value: `${this.fmt(result.jupsol.instantUnstakeCapacity)} SOL`,
        },
        {
          label: "Delayed Unstake Fee",
          value: `${result.jupsol.withdrawalFeePct}%`,
        },
        {
          label: "Minimum Stake",
          value: `${result.jupsol.minimumDelegation} SOL`,
        },
      ],
    });
  }

  private static async accounts(opts: {
    key?: string;
    address?: string;
  }): Promise<void> {
    if (opts.address && opts.key) {
      throw new Error("Only one of --address or --key can be provided.");
    }
    const address =
      opts.address ??
      (await Signer.loadAddress(opts.key ?? Config.load().activeKey));
    const res = await StakeClient.getAccounts(address);
    const accounts = res.accounts.map((a) => this.formatAccount(a));

    if (Output.isJson()) {
      Output.json({
        epoch: Number(res.epoch),
        minimumDelegation: this.sol(res.minimumDelegation),
        accounts,
      });
      return;
    }
    if (accounts.length === 0) {
      console.log("No stake accounts.");
      return;
    }
    Output.table({
      type: "horizontal",
      headers: {
        stakeAccount: "Stake Account",
        status: "Status",
        balance: "Balance",
        validator: "Validator",
        actions: "Actions",
      },
      rows: accounts.map((a) => ({
        stakeAccount: a.stakeAccount,
        status: a.status,
        balance: `${this.fmt(a.balance)} SOL`,
        validator: a.validatorName ?? a.voteAccount ?? "\u2014",
        actions: [
          a.canDeactivate && "deactivate",
          a.canReactivate && "reactivate",
          a.canWithdraw && "withdraw",
          a.canSplit && "split",
          a.mergeableWith.length > 0 && "merge",
          a.canConvert && "convert",
        ]
          .filter(Boolean)
          .join(", "),
      })),
    });
  }

  private static formatAccount(a: StakeAccount) {
    return {
      stakeAccount: a.address,
      status: a.status,
      balance: this.sol(
        (BigInt(a.activeLamports) + BigInt(a.inactiveLamports)).toString()
      ),
      activeStake: this.sol(a.activeLamports),
      inactiveStake: this.sol(a.inactiveLamports),
      voteAccount: a.voter,
      validatorName: a.validator.name,
      isJupiterValidator: a.isJupiterValidator,
      activationEpoch: a.activationEpoch ? Number(a.activationEpoch) : null,
      deactivationEpoch: a.deactivationEpoch
        ? Number(a.deactivationEpoch)
        : null,
      canDeactivate: a.capabilities.canDeactivate,
      canReactivate: a.capabilities.canReactivate,
      canWithdraw: a.capabilities.canWithdraw,
      canSplit: a.capabilities.canSplit,
      maxSplit: a.capabilities.maxSplitLamports
        ? this.sol(a.capabilities.maxSplitLamports)
        : null,
      canConvert: a.capabilities.canDepositToPool,
      mergeableWith: a.capabilities.mergeableWith,
    };
  }

  private static async rewards(opts: {
    stakeAccount: string;
    limit: string;
    beforeEpoch?: string;
  }): Promise<void> {
    this.assertAddress(opts.stakeAccount, "--stake-account");
    const limit = Number(opts.limit);
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error("--limit must be a positive integer.");
    }
    const page = await StakeClient.getRewards({
      stakeAccount: opts.stakeAccount,
      limit,
      beforeEpoch: opts.beforeEpoch,
    });
    const rewards = page.rewards.map((r) => ({
      epoch: Number(r.epoch),
      amount: this.sol(r.amountLamports),
      date: r.date,
    }));

    if (Output.isJson()) {
      Output.json({ rewards, next: page.nextBeforeEpoch });
      return;
    }
    Output.table({
      type: "horizontal",
      headers: { epoch: "Epoch", amount: "Reward", date: "Date" },
      rows: rewards.map((r) => ({
        epoch: r.epoch,
        amount: `${r.amount} SOL`,
        date: r.date ? new Date(r.date).toLocaleString() : "\u2014",
      })),
    });
    if (page.nextBeforeEpoch) {
      console.log("\nNext --before-epoch:", page.nextBeforeEpoch);
    }
  }

  private static async nativeDeposit(opts: {
    amount?: string;
    rawAmount?: string;
    key?: string;
  }): Promise<void> {
    const lamports = this.lamports(opts);
    const signer = await this.signer(opts.key);
    const craft = await StakeClient.craft("craft-stake", {
      walletAddress: signer.address,
      amountLamports: lamports,
    });
    await this.runCraft(signer, craft, {
      stakeAccount: craft.meta.stakeAccount ?? null,
      amount: this.sol(lamports),
      rentLamports: Number(craft.meta.rentLamports ?? 0),
    });
  }

  private static async accountAction(
    action: "deactivate" | "reactivate" | "withdraw",
    opts: { stakeAccount: string; key?: string }
  ): Promise<void> {
    this.assertAddress(opts.stakeAccount, "--stake-account");
    const signer = await this.signer(opts.key);
    const craft = await StakeClient.craft(`craft-${action}`, {
      walletAddress: signer.address,
      stakeAccount: opts.stakeAccount,
    });
    await this.runCraft(signer, craft, { stakeAccount: opts.stakeAccount });
  }

  private static async split(opts: {
    stakeAccount: string;
    amount?: string;
    rawAmount?: string;
    key?: string;
  }): Promise<void> {
    this.assertAddress(opts.stakeAccount, "--stake-account");
    const lamports = this.lamports(opts);
    const signer = await this.signer(opts.key);
    const craft = await StakeClient.craft("craft-split", {
      walletAddress: signer.address,
      stakeAccount: opts.stakeAccount,
      amountLamports: lamports,
    });
    await this.runCraft(signer, craft, {
      stakeAccount: opts.stakeAccount,
      newStakeAccount: craft.meta.newStakeAccount ?? null,
      amount: this.sol(lamports),
    });
  }

  private static async merge(opts: {
    stakeAccount: string;
    sources: string;
    key?: string;
  }): Promise<void> {
    this.assertAddress(opts.stakeAccount, "--stake-account");
    const sources = opts.sources
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (sources.length === 0) {
      throw new Error("--sources needs at least one stake account.");
    }
    sources.forEach((s) => this.assertAddress(s, "--sources"));
    if (sources.includes(opts.stakeAccount)) {
      throw new Error("--sources cannot include the destination account.");
    }
    const signer = await this.signer(opts.key);
    const craft = await StakeClient.craft("craft-merge-many", {
      walletAddress: signer.address,
      destination: opts.stakeAccount,
      sources: sources.join(","),
    });
    await this.runCraft(signer, craft, {
      stakeAccount: opts.stakeAccount,
      mergedStakeAccounts: sources,
    });
  }

  private static async convert(opts: {
    stakeAccount: string;
    amount?: string;
    rawAmount?: string;
    key?: string;
  }): Promise<void> {
    this.assertAddress(opts.stakeAccount, "--stake-account");
    const lamports =
      opts.amount || opts.rawAmount ? this.lamports(opts) : undefined;
    const signer = await this.signer(opts.key);
    const craft = await StakeClient.craft("craft-deposit-pool", {
      walletAddress: signer.address,
      stakeAccount: opts.stakeAccount,
      ...(lamports && { amountLamports: lamports }),
    });
    await this.runCraft(signer, craft, {
      stakeAccount: opts.stakeAccount,
      amount: lamports ? this.sol(lamports) : null,
      outAmount: craft.meta.poolTokensOut
        ? this.sol(craft.meta.poolTokensOut)
        : null,
    });
  }

  private static async jupsolDeposit(opts: {
    amount?: string;
    rawAmount?: string;
    key?: string;
  }): Promise<void> {
    const lamports = this.lamports(opts);
    const signer = await this.signer(opts.key);
    const order = await StakeClient.getLiquidOrder({
      taker: signer.address,
      amount: lamports,
      inputToken: Asset.SOL.id,
      outputToken: JUPSOL_MINT,
    });
    if (!order.tx) {
      throw new Error("No transaction returned for this JupSOL order.");
    }
    const details = {
      amount: this.sol(order.inpAmt),
      outAmount: this.sol(order.outAmt),
    };
    let signature: string | null = null;
    if (!Config.dryRun) {
      const signedTx = await signer.signTransaction(
        order.tx as Base64EncodedBytes
      );
      signature = (
        await StakeClient.executeLiquid({ signedTx, orderResponse: order })
      ).signature;
    }
    this.printAction(
      signer.address,
      "jupsol-deposit",
      details,
      signature,
      order.tx
    );
  }

  private static async jupsolWithdraw(opts: {
    amount?: string;
    rawAmount?: string;
    mode: string;
    validator?: string;
    key?: string;
  }): Promise<void> {
    if (opts.mode !== "native" && opts.mode !== "delayed") {
      throw new Error("--mode must be 'native' or 'delayed'.");
    }
    if (opts.validator && opts.mode !== "delayed") {
      throw new Error("--validator only applies to --mode delayed.");
    }
    if (opts.validator) {
      this.assertAddress(opts.validator, "--validator");
    }
    const amount = this.lamports(opts);
    const signer = await this.signer(opts.key);

    if (opts.mode === "native") {
      const craft = await StakeClient.craft("craft-withdraw-pool", {
        walletAddress: signer.address,
        poolTokenAmount: amount,
      });
      await this.runCraft(signer, craft, {
        amount: this.sol(amount),
        newStakeAccount: craft.meta.newStakeAccount ?? null,
        outAmount: craft.meta.receiveLamports
          ? this.sol(craft.meta.receiveLamports)
          : null,
      });
      return;
    }

    const order = await StakeClient.getDelayedUnstakeOrder({
      taker: signer.address,
      amount,
      inputToken: JUPSOL_MINT,
      outputValidator: opts.validator,
    });
    if (!order.tx) {
      throw new Error("No transaction returned for this unstake order.");
    }
    const details = {
      amount: this.sol(order.inpAmt),
      outAmount: this.sol(order.outAmt.amtStaked),
      voteAccount: order.out,
    };
    let signature: string | null = null;
    if (!Config.dryRun) {
      const signedTx = await signer.signTransaction(
        order.tx as Base64EncodedBytes
      );
      signature = (await StakeClient.executeDelayedUnstake({ signedTx }))
        .signature;
    }
    this.printAction(
      signer.address,
      "jupsol-delayed-unstake",
      details,
      signature,
      order.tx
    );
  }

  private static async runCraft(
    signer: Signer,
    craft: StakeCraftResponse,
    details: Record<string, unknown>
  ): Promise<void> {
    let signature: string | null = null;
    if (!Config.dryRun) {
      const signedTransaction = await signer.signTransaction(
        craft.transaction as Base64EncodedBytes
      );
      const result = await StakeClient.execute({
        signedTransaction,
        requestId: craft.requestId,
        lastValidBlockHeight: craft.lastValidBlockHeight,
      });
      if (result.status !== "Success") {
        throw new Error(result.error ?? "Stake transaction failed.");
      }
      signature = result.signature ?? null;
    }
    this.printAction(
      signer.address,
      craft.kind,
      details,
      signature,
      craft.transaction
    );
  }

  private static printAction(
    wallet: string,
    action: string,
    details: Record<string, unknown>,
    signature: string | null,
    transaction: string
  ): void {
    if (Output.isJson()) {
      Output.json({
        ...(Config.dryRun && { dryRun: true }),
        action,
        wallet,
        ...details,
        signature,
        ...(Config.dryRun && { transaction }),
      });
      return;
    }

    if (Config.dryRun) {
      console.log(Output.DRY_RUN_LABEL);
    }
    const jupsolIn = ["withdraw-pool", "jupsol-delayed-unstake"];
    const jupsolOut = ["deposit-pool", "jupsol-deposit"];
    const units: Record<string, string> = {
      amount: jupsolIn.includes(action) ? " JupSOL" : " SOL",
      outAmount: jupsolOut.includes(action) ? " JupSOL" : " SOL (staked)",
      rentLamports: " SOL",
    };
    const labels: Record<string, string> = {
      stakeAccount: "Stake Account",
      newStakeAccount: "New Stake Account",
      mergedStakeAccounts: "Merged Accounts",
      amount: "Amount",
      outAmount: "Receive",
      voteAccount: "Validator",
      rentLamports: "Rent",
    };
    const rows: ActionRow[] = [
      { label: "Action", value: action },
      { label: "Wallet", value: wallet },
    ];
    for (const [key, value] of Object.entries(details)) {
      if (value === null || value === undefined || !labels[key]) {
        continue;
      }
      const text = Array.isArray(value)
        ? value.join("\n")
        : key === "rentLamports"
          ? this.sol(String(value))
          : String(value);
      rows.push({ label: labels[key]!, value: `${text}${units[key] ?? ""}` });
    }
    if (signature) {
      rows.push({ label: "Tx Signature", value: signature });
    }
    Output.table({ type: "vertical", rows });
  }

  private static async signer(key?: string): Promise<Signer> {
    return Signer.load(key ?? Config.load().activeKey);
  }

  private static lamports(opts: { amount?: string; rawAmount?: string }) {
    Swap.validateAmountOpts(opts);
    const lamports =
      opts.rawAmount ??
      NumberConverter.toChainAmount(opts.amount!, SOL_DECIMALS);
    if (!/^\d+$/.test(lamports) || BigInt(lamports) <= 0n) {
      throw new Error("Amount must be a positive number.");
    }
    return lamports;
  }

  private static assertAddress(value: string, option: string): void {
    if (!isAddress(value)) {
      throw new Error(`Invalid address for ${option}: ${value}`);
    }
  }

  private static sol(lamports: string): string {
    return NumberConverter.fromChainAmount(lamports, SOL_DECIMALS);
  }

  private static fmt(sol: string): string {
    return Number(sol).toLocaleString("en-US", { maximumFractionDigits: 4 });
  }
}
