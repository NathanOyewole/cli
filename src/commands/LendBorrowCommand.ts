import type { Command } from "commander";
import type { Instruction } from "@solana/kit";

import {
  FluidClient,
  type Nft,
  type Vault,
  type VaultSide,
} from "../clients/FluidClient.ts";
import { LendClient, type LendMarket } from "../clients/LendClient.ts";
import { Config } from "../lib/Config.ts";
import { LendMath } from "../lib/LendMath.ts";
import { LendOptions } from "../lib/LendOptions.ts";
import { LendTx } from "../lib/LendTx.ts";
import { NumberConverter } from "../lib/NumberConverter.ts";
import { Output } from "../lib/Output.ts";
import { Signer } from "../lib/Signer.ts";

// Operate treats i128::MIN as "the whole balance" for withdraw and repay.
export const MAX_SENTINEL = "-170141183460469231731687303715884105728";
const OPERATE_COMPUTE_UNITS = 500_000;
// Interest accrued between building and landing a full repay; the jup.ag UI
// budgets an hour of borrow APY on top of the debt.
const FULL_REPAY_SETTLE_MINUTES = 60;

type MarketOpts = { market: LendMarket };
type WalletOpts = { key?: string; address?: string };
type OperateOpts = MarketOpts & {
  key?: string;
  vault?: string;
  position?: string;
  deposit?: string;
  withdraw?: string;
  borrow?: string;
  repay?: string;
};

export class LendBorrowCommand {
  public static register(lend: Command): void {
    const borrow = lend
      .command("borrow")
      .description("Borrow against collateral in Jupiter Lend vaults");

    borrow
      .command("vaults")
      .description("List borrow vaults with rates and limits")
      .addOption(LendOptions.market())
      .option("--multiply", "Only vaults that support Multiply")
      .option("--smart", "Only smart (DEX) vaults")
      .action((opts) => this.vaults(opts));
    borrow
      .command("vault")
      .description("View one vault's parameters, limits and oracle price")
      .requiredOption("--vault <id>", "Vault ID")
      .addOption(LendOptions.market())
      .action((opts) => this.vault(opts));
    borrow
      .command("positions")
      .description("View borrow positions with health, LTV and PnL")
      .addOption(LendOptions.market())
      .option("--key <name>", "Key to use (overrides active key)")
      .option("--address <address>", "Wallet address to look up")
      .option("--vault <id>", "Only positions in this vault")
      .option("--position <id>", "Only this position")
      .action((opts) => this.positions(opts));
    borrow
      .command("history")
      .description(
        "View a position's deposit, borrow, repay and withdraw history"
      )
      .requiredOption("--position <id>", "Position ID")
      .option("--vault <id>", "Vault ID (looked up from the wallet if omitted)")
      .addOption(LendOptions.market())
      .option("--key <name>", "Key to use (overrides active key)")
      .option("--address <address>", "Position owner")
      .option("--page <n>", "Page number (10 entries per page)", "1")
      .action((opts) => this.history(opts));
    borrow
      .command("liquidations")
      .description("View a position's liquidation events")
      .requiredOption("--position <id>", "Position ID")
      .option("--vault <id>", "Vault ID (looked up from the wallet if omitted)")
      .addOption(LendOptions.market())
      .option("--key <name>", "Key to use (overrides active key)")
      .option("--address <address>", "Position owner")
      .option("--page <n>", "Page number (10 entries per page)", "1")
      .action((opts) => this.liquidations(opts));

    borrow
      .command("open")
      .description("Open a position: deposit collateral and optionally borrow")
      .requiredOption("--vault <id>", "Vault ID")
      .requiredOption("--collateral <n>", "Collateral to deposit")
      .option("--borrow <n>", "Amount to borrow")
      .addOption(LendOptions.market())
      .option("--key <name>", "Key to use for signing")
      .action((opts) =>
        this.operate(
          { ...opts, position: "0", deposit: opts.collateral },
          "open"
        )
      );
    borrow
      .command("deposit")
      .description("Add collateral to a position")
      .requiredOption("--position <id>", "Position ID")
      .requiredOption("--amount <n>", "Collateral to deposit")
      .option("--vault <id>", "Vault ID (looked up from the wallet if omitted)")
      .addOption(LendOptions.market())
      .option("--key <name>", "Key to use for signing")
      .action((opts) =>
        this.operate({ ...opts, deposit: opts.amount }, "deposit")
      );
    borrow
      .command("withdraw")
      .description("Withdraw collateral (all of it when --amount is omitted)")
      .requiredOption("--position <id>", "Position ID")
      .option("--amount <n>", "Collateral to withdraw")
      .option("--vault <id>", "Vault ID (looked up from the wallet if omitted)")
      .addOption(LendOptions.market())
      .option("--key <name>", "Key to use for signing")
      .action((opts) =>
        this.operate({ ...opts, withdraw: opts.amount ?? "max" }, "withdraw")
      );
    borrow
      .command("borrow")
      .description("Borrow more against a position")
      .requiredOption("--position <id>", "Position ID")
      .requiredOption("--amount <n>", "Amount to borrow")
      .option("--vault <id>", "Vault ID (looked up from the wallet if omitted)")
      .addOption(LendOptions.market())
      .option("--key <name>", "Key to use for signing")
      .action((opts) =>
        this.operate({ ...opts, borrow: opts.amount }, "borrow")
      );
    borrow
      .command("repay")
      .description("Repay debt (all of it when --amount is omitted)")
      .requiredOption("--position <id>", "Position ID")
      .option("--amount <n>", "Amount to repay")
      .option("--vault <id>", "Vault ID (looked up from the wallet if omitted)")
      .addOption(LendOptions.market())
      .option("--key <name>", "Key to use for signing")
      .action((opts) =>
        this.operate({ ...opts, repay: opts.amount ?? "max" }, "repay")
      );
    borrow
      .command("operate")
      .description(
        "Combine collateral and debt changes in one transaction (e.g. deposit and borrow, or repay and withdraw)"
      )
      .requiredOption("--position <id>", "Position ID")
      .option("--deposit <n>", "Collateral to deposit")
      .option("--withdraw <n>", "Collateral to withdraw, or 'max'")
      .option("--borrow <n>", "Amount to borrow")
      .option("--repay <n>", "Amount to repay, or 'max'")
      .option("--vault <id>", "Vault ID (looked up from the wallet if omitted)")
      .addOption(LendOptions.market())
      .option("--key <name>", "Key to use for signing")
      .action((opts) => this.operate(opts, "operate"));
    borrow
      .command("close")
      .description("Repay all debt and withdraw all collateral")
      .requiredOption("--position <id>", "Position ID")
      .option("--vault <id>", "Vault ID (looked up from the wallet if omitted)")
      .addOption(LendOptions.market())
      .option("--key <name>", "Key to use for signing")
      .action((opts) =>
        this.operate({ ...opts, repay: "max", withdraw: "max" }, "close")
      );
  }

  public static vaultSummary(vault: Vault) {
    const supplyPrice = Number(vault.supplyToken.token0.price);
    const borrowPrice = Number(vault.borrowToken.token0.price);
    const smartSupply = LendMath.isSmart(vault.supplyToken);
    const smartBorrow = LendMath.isSmart(vault.borrowToken);
    const amount = (raw: string, side: VaultSide) =>
      Number(raw) / 10 ** LendMath.sideDecimals(side);
    return {
      vaultId: vault.id,
      collateral: this.sideInfo(vault.supplyToken),
      debt: this.sideInfo(vault.borrowToken),
      type: smartSupply || smartBorrow ? "smart" : "normal",
      ...LendMath.vaultApys(vault),
      maxLtvPct: Number(vault.collateralFactor) / 10,
      liquidationLtvPct: Number(vault.liquidationThreshold) / 10,
      liquidationPenaltyPct: Number(vault.liquidationPenalty) / 100,
      maxMultiplier: LendMath.maxMultiplier(vault),
      multiply: vault.metadata.multiply.enabled,
      totalSupplyUsd: smartSupply
        ? null
        : amount(vault.totalSupply, vault.supplyToken) * supplyPrice,
      totalBorrowUsd: smartBorrow
        ? null
        : amount(vault.totalBorrow, vault.borrowToken) * borrowPrice,
      borrowableUsd: smartBorrow
        ? null
        : amount(vault.borrowable, vault.borrowToken) * borrowPrice,
      positions: vault.totalPositions,
    };
  }

  public static async resolveNft(
    market: LendMarket,
    owner: string,
    position: string,
    vault?: string
  ): Promise<Nft> {
    const positionId = LendOptions.positiveInt("--position", position);
    if (vault) {
      return FluidClient.getNft(
        market,
        LendOptions.positiveInt("--vault", vault),
        positionId
      );
    }
    const matches = (await FluidClient.getUserNfts(market, owner)).filter(
      (n) => n.id === positionId
    );
    if (matches.length === 0) {
      throw new Error(
        `Position ${positionId} not found for ${owner} in the ${market} market. Pass --vault if another wallet owns it.`
      );
    }
    if (matches.length > 1) {
      throw new Error(
        `Position ${positionId} exists in vaults ${matches.map((m) => m.vaultId).join(", ")}. Pass --vault.`
      );
    }
    return matches[0]!;
  }

  private static async vaults(
    opts: MarketOpts & { multiply?: boolean; smart?: boolean }
  ): Promise<void> {
    let vaults = (await FluidClient.getVaults(opts.market)).map((v) =>
      this.vaultSummary(v)
    );
    if (opts.multiply) {
      vaults = vaults.filter((v) => v.multiply);
    }
    if (opts.smart) {
      vaults = vaults.filter((v) => v.type === "smart");
    }

    if (Output.isJson()) {
      Output.json({ vaults });
      return;
    }

    Output.table({
      type: "horizontal",
      headers: {
        id: "Vault",
        pair: "Collateral / Debt",
        supply: "Supply APY",
        borrow: "Borrow APY",
        ltv: "Max LTV",
        mult: "Max Multiplier",
        borrowable: "Borrowable",
      },
      rows: vaults.map((v) => ({
        id: v.vaultId,
        pair: `${v.collateral.symbol} / ${v.debt.symbol}`,
        supply: Output.formatPercentageChange(v.supplyApyPct),
        borrow: Output.formatPercentageChange(v.borrowApyPct),
        ltv: `${v.maxLtvPct}%`,
        mult: `${v.maxMultiplier}x`,
        borrowable: Output.formatDollar(v.borrowableUsd ?? undefined),
      })),
    });
  }

  private static async vault(opts: MarketOpts & { vault: string }) {
    const vault = await FluidClient.getVault(
      opts.market,
      LendOptions.positiveInt("--vault", opts.vault)
    );
    const summary = this.vaultSummary(vault);
    const detail = {
      ...summary,
      address: vault.address,
      oraclePrice:
        vault.oraclePrice === null ? null : Number(vault.oraclePrice) / 1e15,
      borrowFeePct: Number(vault.borrowFee) / 100,
      minimumBorrow:
        Number(vault.minimumBorrowing) /
        10 ** LendMath.sideDecimals(vault.borrowToken),
      pegged: vault.metadata.pegged,
      strategy: vault.metadata.maxLeverage,
    };

    if (Output.isJson()) {
      Output.json(detail);
      return;
    }

    Output.table({
      type: "vertical",
      rows: [
        { label: "Vault", value: `${detail.vaultId} (${detail.type})` },
        {
          label: "Collateral / Debt",
          value: `${detail.collateral.symbol} / ${detail.debt.symbol}`,
        },
        {
          label: "Oracle Price",
          value:
            detail.oraclePrice === null
              ? "—"
              : `${detail.oraclePrice} ${detail.debt.symbol} per ${detail.collateral.symbol}`,
        },
        {
          label: "Supply APY",
          value: Output.formatPercentageChange(detail.supplyApyPct),
        },
        {
          label: "Borrow APY",
          value: Output.formatPercentageChange(detail.borrowApyPct),
        },
        { label: "Max LTV", value: `${detail.maxLtvPct}%` },
        { label: "Liquidation LTV", value: `${detail.liquidationLtvPct}%` },
        {
          label: "Liquidation Penalty",
          value: `${detail.liquidationPenaltyPct}%`,
        },
        { label: "Max Multiplier", value: `${detail.maxMultiplier}x` },
        {
          label: "Total Supply",
          value: Output.formatDollar(detail.totalSupplyUsd ?? undefined),
        },
        {
          label: "Total Borrow",
          value: Output.formatDollar(detail.totalBorrowUsd ?? undefined),
        },
        {
          label: "Borrowable",
          value: Output.formatDollar(detail.borrowableUsd ?? undefined),
        },
        {
          label: "Min Borrow",
          value: `${detail.minimumBorrow} ${detail.debt.symbol}`,
        },
        { label: "Positions", value: String(detail.positions) },
      ],
    });
  }

  private static async positions(
    opts: MarketOpts & WalletOpts & { vault?: string; position?: string }
  ): Promise<void> {
    const address = await LendOptions.resolveAddress(opts);
    let nfts = await FluidClient.getUserNfts(opts.market, address);
    if (opts.vault) {
      const vaultId = LendOptions.positiveInt("--vault", opts.vault);
      nfts = nfts.filter((n) => n.vaultId === vaultId);
    }
    if (opts.position) {
      const positionId = LendOptions.positiveInt("--position", opts.position);
      nfts = nfts.filter((n) => n.id === positionId);
    }
    const pnls = await Promise.all(
      nfts.map((n) =>
        FluidClient.getNftPnl(opts.market, n.vaultId, n.id).catch(() => null)
      )
    );
    const positions = nfts.map((nft, i) => this.positionView(nft, pnls[i]!));

    if (Output.isJson()) {
      Output.json({ positions });
      return;
    }
    if (positions.length === 0) {
      console.log("No borrow positions found.");
      return;
    }

    Output.table({
      type: "horizontal",
      headers: {
        id: "Position",
        vault: "Vault",
        collateral: "Collateral",
        debt: "Debt",
        ltv: "LTV",
        liq: "Liq. Price",
        status: "Health",
        pnl: "PnL",
      },
      rows: positions.map((p) => ({
        id: p.positionId,
        vault: p.vaultId,
        collateral: `${this.formatAmount(p.collateral.amount)} ${p.collateral.token.symbol} (${Output.formatDollar(p.collateral.amountUsd ?? undefined)})`,
        debt: `${this.formatAmount(p.debt.amount)} ${p.debt.token.symbol} (${Output.formatDollar(p.debt.amountUsd ?? undefined)})`,
        ltv: `${p.ltvPct}% / ${p.liquidationLtvPct}%`,
        liq:
          p.liquidationPrice === null
            ? "—"
            : `${this.formatAmount(p.liquidationPrice)} ${p.debt.token.symbol}`,
        status: p.healthStatus,
        pnl: Output.formatDollarChange(p.pnlUsd ?? undefined),
      })),
    });
  }

  private static positionView(
    nft: Nft,
    pnl: {
      amount: string | number | null;
      percentage: string | number | null;
    } | null
  ) {
    const { vault } = nft;
    const { collateral, debt } = LendMath.positionAmounts(nft);
    const health = LendMath.health(vault, collateral, debt, nft.isLiquidated);
    const smartSupply = LendMath.isSmart(vault.supplyToken);
    const smartBorrow = LendMath.isSmart(vault.borrowToken);
    const collateralUsd = smartSupply
      ? null
      : collateral * Number(vault.supplyToken.token0.price);
    const debtUsd = smartBorrow
      ? null
      : debt * Number(vault.borrowToken.token0.price);
    const { supplyApyPct, borrowApyPct } = LendMath.vaultApys(vault);
    const netValueUsd =
      collateralUsd === null || debtUsd === null
        ? null
        : collateralUsd - debtUsd;
    const pnlUsd =
      pnl?.amount == null || smartBorrow
        ? null
        : (Number(pnl.amount) / 10 ** vault.borrowToken.token0.decimals) *
          Number(vault.borrowToken.token0.price);
    return {
      positionId: nft.id,
      vaultId: nft.vaultId,
      positionAddress: nft.address,
      collateral: {
        token: this.sideInfo(vault.supplyToken),
        amount: collateral,
        amountUsd: collateralUsd,
      },
      debt: {
        token: this.sideInfo(vault.borrowToken),
        amount: debt,
        amountUsd: debtUsd,
      },
      netValueUsd,
      ltvPct: health.ltvPct,
      maxLtvPct: health.maxLtvPct,
      liquidationLtvPct: health.liquidationLtvPct,
      liquidationPrice: health.liquidationPrice,
      healthStatus: health.status,
      multiplier: health.multiplier,
      supplyApyPct,
      borrowApyPct,
      netApyPct:
        netValueUsd && collateralUsd !== null && debtUsd !== null
          ? Math.round(
              ((collateralUsd * supplyApyPct - debtUsd * borrowApyPct) /
                netValueUsd) *
                100
            ) / 100
          : null,
      pnlUsd,
      pnlPct: pnl?.percentage == null ? null : Number(pnl.percentage) / 100,
      strategy: nft.config?.maxLeverage === true,
    };
  }

  private static async history(
    opts: MarketOpts &
      WalletOpts & { position: string; vault?: string; page: string }
  ): Promise<void> {
    const nft = await this.resolveNft(
      opts.market,
      opts.vault ? "" : await LendOptions.resolveAddress(opts),
      opts.position,
      opts.vault
    );
    const page = Math.max(1, LendOptions.positiveInt("--page", opts.page));
    const res = await FluidClient.getNftHistory(
      opts.market,
      nft.vaultId,
      nft.id,
      page
    );
    const supply = nft.vault.supplyToken;
    const borrow = nft.vault.borrowToken;
    const history = res.data.map((a) => ({
      time: a.createdAt,
      type: a.type,
      collateralChange: this.actionAmount(a.token0Collateral, supply),
      collateralChangeUsd: this.nullableNumber(a.token0CollateralUsd),
      debtChange: this.actionAmount(a.token0Debt, borrow),
      debtChangeUsd: this.nullableNumber(a.token0DebtUsd),
      status: a.status,
      signature: a.signature,
    }));
    const next = page < res.meta.lastPage ? page + 1 : undefined;

    if (Output.isJson()) {
      Output.json({
        vaultId: nft.vaultId,
        positionId: nft.id,
        count: res.meta.total,
        history,
        next,
      });
      return;
    }

    Output.table({
      type: "horizontal",
      headers: {
        time: "Time",
        type: "Type",
        collateral: `Collateral (${this.sideInfo(supply).symbol})`,
        debt: `Debt (${this.sideInfo(borrow).symbol})`,
        signature: "Tx Signature",
      },
      rows: history.map((h) => ({
        time: new Date(h.time).toLocaleString(),
        type: h.type,
        collateral: h.collateralChange
          ? this.formatAmount(h.collateralChange)
          : "—",
        debt: h.debtChange ? this.formatAmount(h.debtChange) : "—",
        signature: h.signature,
      })),
    });
    if (next) {
      console.log(`Page ${page} of ${res.meta.lastPage}. Next: --page ${next}`);
    }
  }

  private static async liquidations(
    opts: MarketOpts &
      WalletOpts & { position: string; vault?: string; page: string }
  ): Promise<void> {
    const nft = await this.resolveNft(
      opts.market,
      opts.vault ? "" : await LendOptions.resolveAddress(opts),
      opts.position,
      opts.vault
    );
    const page = Math.max(1, LendOptions.positiveInt("--page", opts.page));
    const res = await FluidClient.getNftLiquidations(
      opts.market,
      nft.vaultId,
      nft.id,
      page
    );
    const liquidations = res.data.map((l) => ({
      time: l.createdAt,
      collateralAmount: this.actionAmount(
        l.collateralAmount,
        nft.vault.supplyToken
      ),
      debtAmount: this.actionAmount(l.debtAmount, nft.vault.borrowToken),
      oraclePrice:
        l.liquidateOraclePrice === null
          ? null
          : Number(l.liquidateOraclePrice) / 1e15,
      signature: l.txnSig,
    }));
    const next = page < res.meta.lastPage ? page + 1 : undefined;

    if (Output.isJson()) {
      Output.json({
        vaultId: nft.vaultId,
        positionId: nft.id,
        count: res.meta.total,
        liquidations,
        next,
      });
      return;
    }
    if (liquidations.length === 0) {
      console.log(`Position ${nft.id} has not been liquidated.`);
      return;
    }
    Output.table({
      type: "horizontal",
      headers: {
        time: "Time",
        collateral: "Collateral Seized",
        debt: "Debt Repaid",
        signature: "Tx Signature",
      },
      rows: liquidations.map((l) => ({
        time: new Date(l.time).toLocaleString(),
        collateral: this.formatAmount(l.collateralAmount ?? 0),
        debt: this.formatAmount(l.debtAmount ?? 0),
        signature: l.signature,
      })),
    });
  }

  private static async operate(opts: OperateOpts, action: string) {
    if (opts.deposit && opts.withdraw) {
      throw new Error("Only one of --deposit or --withdraw can be provided.");
    }
    if (opts.borrow && opts.repay) {
      throw new Error("Only one of --borrow or --repay can be provided.");
    }
    if (!opts.deposit && !opts.withdraw && !opts.borrow && !opts.repay) {
      throw new Error(
        "Provide at least one of --deposit, --withdraw, --borrow or --repay."
      );
    }
    for (const [flag, value] of [
      ["--deposit", opts.deposit],
      ["--borrow", opts.borrow],
    ] as const) {
      if (value === "max") {
        throw new Error(`${flag} does not accept 'max'.`);
      }
    }

    const signer = await Signer.load(opts.key ?? Config.load().activeKey);
    const isOpen = opts.position === "0";
    let vault: Vault;
    let nft: Nft | null = null;
    if (isOpen) {
      vault = await FluidClient.getVault(
        opts.market,
        LendOptions.positiveInt("--vault", opts.vault!)
      );
    } else {
      nft = await this.resolveNft(
        opts.market,
        signer.address,
        opts.position!,
        opts.vault
      );
      vault = nft.vault;
    }
    if (vault.type !== 1) {
      throw new Error(
        `Vault ${vault.id} is a smart (DEX) vault. The CLI only supports normal vaults; smart vaults need the @jup-ag/lend smart-vault SDK, which is not bundled.`
      );
    }

    const supply = vault.supplyToken.token0;
    const debt = vault.borrowToken.token0;
    const current = nft
      ? LendMath.positionAmounts(nft)
      : { collateral: 0, debt: 0 };

    const toRaw = (value: string, decimals: number) =>
      BigInt(NumberConverter.toChainAmount(value, decimals));
    const colRaw = opts.deposit
      ? toRaw(opts.deposit, supply.decimals)
      : opts.withdraw && opts.withdraw !== "max"
        ? -toRaw(opts.withdraw, supply.decimals)
        : 0n;
    const debtRaw = opts.borrow
      ? toRaw(opts.borrow, debt.decimals)
      : opts.repay && opts.repay !== "max"
        ? -toRaw(opts.repay, debt.decimals)
        : 0n;
    const withdrawAll = opts.withdraw === "max";
    const repayAll = opts.repay === "max";

    const collateralChange = withdrawAll
      ? -current.collateral
      : Number(colRaw) / 10 ** supply.decimals;
    const debtChange = repayAll
      ? -current.debt
      : Number(debtRaw) / 10 ** debt.decimals;
    const after = {
      collateral: Math.max(0, current.collateral + collateralChange),
      debt: Math.max(0, current.debt + debtChange),
    };
    const health = LendMath.health(vault, after.collateral, after.debt);
    this.validate({ vault, current, after, health, colRaw, debtRaw, repayAll });

    const [{ nftId, instructions, addressLookupTableAddresses }, programs] =
      await Promise.all([
        LendClient.postOperateInstructions({
          signer: signer.address,
          vaultId: vault.id,
          positionId: nft?.id ?? 0,
          colAmount: withdrawAll ? MAX_SENTINEL : colRaw.toString(),
          debtAmount: repayAll ? MAX_SENTINEL : debtRaw.toString(),
          market: opts.market,
        }),
        LendTx.tokenPrograms([supply.address, debt.address]),
      ]);

    const ixs: Instruction[] = [
      ...LendTx.computeBudget(OPERATE_COMPUTE_UNITS),
      await LendTx.createAta(
        signer.address,
        supply.address,
        programs.get(supply.address)!
      ),
    ];
    if (debt.address !== supply.address) {
      ixs.push(
        await LendTx.createAta(
          signer.address,
          debt.address,
          programs.get(debt.address)!
        )
      );
    }
    const wsolProgram = programs.get(LendTx.WSOL_MINT)!;
    if (supply.address === LendTx.WSOL_MINT && colRaw > 0n) {
      ixs.push(...(await LendTx.wrapSol(signer.address, colRaw, wsolProgram)));
    }
    if (debt.address === LendTx.WSOL_MINT && (debtRaw < 0n || repayAll)) {
      const lamports = repayAll
        ? this.fullRepayLamports(nft!, vault)
        : -debtRaw + 1n;
      ixs.push(
        ...(await LendTx.wrapSol(signer.address, lamports, wsolProgram))
      );
    }
    ixs.push(...instructions.map(LendTx.fromApi));
    if (
      supply.address === LendTx.WSOL_MINT ||
      debt.address === LendTx.WSOL_MINT
    ) {
      ixs.push(await LendTx.unwrapSol(signer.address, wsolProgram));
    }
    const transaction = await LendTx.compile(
      signer.address,
      ixs,
      addressLookupTableAddresses
    );

    const result = {
      action,
      vaultId: vault.id,
      positionId: nftId,
      collateral: {
        token: this.sideInfo(vault.supplyToken),
        change: collateralChange,
        amount: after.collateral,
      },
      debt: {
        token: this.sideInfo(vault.borrowToken),
        change: debtChange,
        amount: after.debt,
      },
      ltvPct: health.ltvPct,
      maxLtvPct: health.maxLtvPct,
      liquidationLtvPct: health.liquidationLtvPct,
      liquidationPrice: health.liquidationPrice,
      healthStatus: after.debt > 0 ? health.status : null,
    };

    if (Config.dryRun) {
      if (Output.isJson()) {
        Output.json({ dryRun: true, ...result, signature: null, transaction });
        return;
      }
      console.log(Output.DRY_RUN_LABEL);
      this.printOperate(result, null);
      return;
    }

    const signature = await LendTx.signAndSend(signer, transaction);
    if (Output.isJson()) {
      Output.json({ ...result, signature });
      return;
    }
    this.printOperate(result, signature);
  }

  private static validate(p: {
    vault: Vault;
    current: { collateral: number; debt: number };
    after: { collateral: number; debt: number };
    health: { ltvPct: number; maxLtvPct: number };
    colRaw: bigint;
    debtRaw: bigint;
    repayAll: boolean;
  }): void {
    const { vault, current, after, health } = p;
    if (-p.colRaw > BigInt(vault.withdrawable)) {
      throw new Error(
        `Withdrawal exceeds the vault's currently withdrawable liquidity.`
      );
    }
    if (p.debtRaw > BigInt(vault.borrowable)) {
      throw new Error(
        `Borrow exceeds the vault's currently borrowable liquidity.`
      );
    }
    if (
      p.colRaw < 0n &&
      Number(-p.colRaw) / 10 ** vault.supplyToken.token0.decimals >
        current.collateral
    ) {
      throw new Error(
        `Position only has ${current.collateral} ${vault.supplyToken.token0.symbol} collateral. Omit --amount to withdraw all.`
      );
    }
    if (
      p.debtRaw < 0n &&
      Number(-p.debtRaw) / 10 ** vault.borrowToken.token0.decimals >
        current.debt
    ) {
      throw new Error(
        `Position only owes ${current.debt} ${vault.borrowToken.token0.symbol}. Omit --amount to repay all.`
      );
    }
    const increasesRisk = p.debtRaw > 0n || p.colRaw < 0n;
    if (increasesRisk && after.debt > 0 && health.ltvPct > health.maxLtvPct) {
      throw new Error(
        `Resulting LTV ${health.ltvPct >= 100 ? "of 100% or more" : `${health.ltvPct}%`} exceeds the vault's max LTV of ${health.maxLtvPct}%.`
      );
    }
    const minBorrow =
      Number(vault.minimumBorrowing) / 10 ** vault.borrowToken.token0.decimals;
    if (p.debtRaw > 0n && after.debt < minBorrow) {
      throw new Error(
        `Minimum borrow for this vault is ${minBorrow} ${vault.borrowToken.token0.symbol}.`
      );
    }
  }

  private static fullRepayLamports(nft: Nft, vault: Vault): bigint {
    const owed = BigInt(nft.borrow) + BigInt(nft.dustBorrow ?? 0);
    const { borrowApyPct } = LendMath.vaultApys(vault);
    const interest =
      (Number(owed) * (borrowApyPct / 100) * FULL_REPAY_SETTLE_MINUTES) /
      (365 * 24 * 60);
    return owed + BigInt(Math.ceil(interest)) + 10_000n;
  }

  public static printOperate(
    r: {
      action: string;
      vaultId: number;
      positionId: number;
      collateral: { token: { symbol: string }; change: number; amount: number };
      debt: { token: { symbol: string }; change: number; amount: number };
      ltvPct: number;
      liquidationLtvPct: number;
      liquidationPrice: number | null;
      healthStatus: string | null;
      leverage?: number;
    },
    signature: string | null
  ): void {
    const signed = (n: number) => `${n > 0 ? "+" : ""}${this.formatAmount(n)}`;
    Output.table({
      type: "vertical",
      rows: [
        { label: "Position", value: `${r.positionId} (vault ${r.vaultId})` },
        {
          label: "Collateral",
          value: `${this.formatAmount(r.collateral.amount)} ${r.collateral.token.symbol} (${signed(r.collateral.change)})`,
        },
        {
          label: "Debt",
          value: `${this.formatAmount(r.debt.amount)} ${r.debt.token.symbol} (${signed(r.debt.change)})`,
        },
        {
          label: "LTV",
          value: `${r.ltvPct}% (liquidation at ${r.liquidationLtvPct}%)`,
        },
        {
          label: "Liq. Price",
          value:
            r.liquidationPrice === null
              ? "—"
              : `${this.formatAmount(r.liquidationPrice)} ${r.debt.token.symbol} per ${r.collateral.token.symbol}`,
        },
        ...(r.leverage === undefined
          ? []
          : [{ label: "Leverage", value: `${r.leverage}x` }]),
        { label: "Health", value: r.healthStatus ?? "—" },
        ...(signature ? [{ label: "Tx Signature", value: signature }] : []),
      ],
    });
  }

  public static sideInfo(side: VaultSide) {
    if (side.token1) {
      return {
        id: `${side.token0.address},${side.token1.address}`,
        symbol: `${side.token0.symbol}-${side.token1.symbol}`,
        decimals: 9,
      };
    }
    return {
      id: side.token0.address,
      symbol: side.token0.symbol,
      decimals: side.token0.decimals,
    };
  }

  private static actionAmount(raw: string | null, side: VaultSide) {
    if (raw === null) {
      return null;
    }
    return Number(raw) / 10 ** side.token0.decimals;
  }

  private static nullableNumber(value: string | null): number | null {
    return value === null ? null : Number(value);
  }

  private static formatAmount(n: number): string {
    return n.toLocaleString("en-US", { maximumFractionDigits: 6 });
  }
}
