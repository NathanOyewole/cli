import type { Instruction } from "@solana/kit";

import { FluidClient, type Nft, type Vault } from "../clients/FluidClient.ts";
import type { LendMarket } from "../clients/LendClient.ts";
import { LendDexOperate, type DexLegInput } from "../lib/LendDexOperate.ts";
import { LendFlashloan } from "../lib/LendFlashloan.ts";
import { LendMath } from "../lib/LendMath.ts";
import { LendSmart, type SmartMultiplyCtx } from "../lib/LendSmart.ts";
import { LendTx } from "../lib/LendTx.ts";
import type { Signer } from "../lib/Signer.ts";
import { LendBorrowCommand } from "./LendBorrowCommand.ts";
import {
  DEX_OPERATE_COMPUTE_UNITS,
  LendSmartOperate,
} from "./LendSmartOperate.ts";

const ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const SHARE_DECIMALS = 9;
const SHARE_SCALE = 10n ** 9n;
const ORACLE_SCALE = 10n ** 15n;
const LEVERAGE_SCALE = 1_000_000n;

type Opts = { market: LendMarket; slippage?: string };

type Move = {
  action: string;
  flashRaw: bigint;
  perfect: boolean;
  col: { action: "supply" | "withdraw"; input: DexLegInput };
  debt: { action: "borrow" | "payback"; input: DexLegInput };
  // Signed DEX share change of the collateral and raw debt-token change.
  sharesDelta: bigint;
  debtDelta: bigint;
  // Signed raw pair-token amounts the collateral leg moves.
  legs: bigint[];
  marginRaw: bigint;
};

// Swap-free Smart Multiply (jup.ag useSmartLeverageMutation /
// useSmartDeleverageMutation): on a smart-collateral vault whose debt token is
// one of the pair tokens, a flashloan of the debt token is deposited one-sided
// into the pair (or withdrawn one-sided to repay), so no aggregator swap is
// needed.
export class LendSmartMultiply {
  public static ctx(vault: Vault): SmartMultiplyCtx {
    const ctx = LendSmart.multiplyCtx(vault);
    if (!ctx) {
      throw new Error(
        `Vault ${vault.id} is a smart vault whose debt token is not one of its collateral pair tokens, so it has no swap-free Multiply.`
      );
    }
    return ctx;
  }

  public static async open(p: {
    opts: Opts;
    vault: Vault;
    signer: Signer;
    amount: string;
    leverage: number;
  }): Promise<void> {
    const ctx = this.ctx(p.vault);
    const marginRaw = LendSmartOperate.toRaw(
      p.amount,
      ctx.marginToken.decimals,
      "--amount"
    );
    const slippageBps = this.slippageBps(p.opts, ctx);
    const move = this.leverUp({
      vault: p.vault,
      ctx,
      shares: 0n,
      debt: 0n,
      marginRaw,
      leverage: p.leverage,
      slippageBps,
      action: "open",
    });
    await this.execute({ ...p, nft: null, ctx, slippageBps, move });
  }

  public static async set(p: {
    opts: Opts;
    nft: Nft;
    signer: Signer;
    leverage: number;
  }): Promise<void> {
    const vault = p.nft.vault;
    const ctx = this.ctx(vault);
    const slippageBps = this.slippageBps(p.opts, ctx);
    const { shares, debt } = this.position(p.nft);
    const oracle = this.oraclePrice(vault);
    const decimals = vault.borrowToken.token0.decimals;
    const collateral =
      (shares * oracle * 10n ** BigInt(decimals)) /
      (SHARE_SCALE * ORACLE_SCALE);
    const equity = collateral - debt;
    if (equity <= 0n) {
      throw new Error("Position has no equity to lever.");
    }
    const m = BigInt(Math.round(p.leverage * Number(LEVERAGE_SCALE)));
    const targetDebt = ((m - LEVERAGE_SCALE) * equity) / LEVERAGE_SCALE;
    const common = { opts: p.opts, vault, nft: p.nft, signer: p.signer, ctx };

    if (targetDebt > debt) {
      const move = this.leverUp({
        vault,
        ctx,
        shares,
        debt,
        marginRaw: 0n,
        leverage: p.leverage,
        slippageBps,
        action: "leverage",
      });
      await this.execute({ ...common, slippageBps, move });
      return;
    }
    const repay = debt - targetDebt;
    if (repay <= 0n) {
      throw new Error("Position is already at this leverage.");
    }
    if (repay >= debt) {
      return this.close({ opts: p.opts, nft: p.nft, signer: p.signer });
    }
    const leg = this.legAmounts(ctx, repay);
    const input = LendSmartOperate.quote(() =>
      LendSmart.variableInput(
        "withdraw",
        ctx.colCtx,
        leg[0],
        leg[1],
        slippageBps
      )
    );
    if (input.shares > shares) {
      throw new Error("Withdrawal exceeds the position's collateral.");
    }
    await this.execute({
      ...common,
      slippageBps,
      move: {
        action: "deleverage",
        flashRaw: repay,
        perfect: false,
        col: { action: "withdraw", input },
        debt: { action: "payback", input: { amount: repay } },
        sharesDelta: -input.shares,
        debtDelta: -repay,
        legs: leg.map((a) => -a),
        marginRaw: 0n,
      },
    });
  }

  // Repays all debt with a flashloan of the debt token, withdrawing just
  // enough collateral in that token (padded for interest and slippage) to pay
  // it back. As on jup.ag, the rest of the collateral stays in the position.
  public static async close(p: {
    opts: Opts;
    nft: Nft;
    signer: Signer;
  }): Promise<void> {
    const vault = p.nft.vault;
    const ctx = this.ctx(vault);
    const slippageBps = this.slippageBps(p.opts, ctx);
    const { shares, debt } = this.position(p.nft);
    if (debt === 0n) {
      throw new Error(
        "Position has no debt. Use `jup lend borrow withdraw` to withdraw the collateral."
      );
    }
    const withdraw = BigInt(
      Math.ceil(Number(debt) * LendSmart.fullRepayBuffer(slippageBps))
    );
    const input = LendSmartOperate.quote(() =>
      LendSmart.oneTokenExactInput(
        "withdraw",
        ctx.colCtx,
        withdraw,
        ctx.marginLeg,
        slippageBps
      )
    );
    const burned = input.shares!;
    if (burned > shares) {
      throw new Error(
        "Collateral is not enough to repay the debt. Repay some debt with `jup lend borrow repay` first."
      );
    }
    await this.execute({
      opts: p.opts,
      vault,
      nft: p.nft,
      signer: p.signer,
      ctx,
      slippageBps,
      move: {
        action: "close",
        flashRaw: withdraw,
        perfect: true,
        col: { action: "withdraw", input },
        debt: { action: "payback", input: { max: true } },
        sharesDelta: -burned,
        debtDelta: -debt,
        legs: this.legAmounts(ctx, withdraw).map((a) => -a),
        marginRaw: 0n,
      },
    });
  }

  private static leverUp(p: {
    vault: Vault;
    ctx: SmartMultiplyCtx;
    shares: bigint;
    debt: bigint;
    marginRaw: bigint;
    leverage: number;
    slippageBps: number;
    action: string;
  }): Move {
    const flash = LendSmart.multiplyFlashloan({
      ctx: p.ctx,
      oraclePrice: this.oraclePrice(p.vault),
      positionShares: p.shares,
      debt: p.debt,
      debtDecimals: p.vault.borrowToken.token0.decimals,
      margin: p.marginRaw,
      multiplier: p.leverage,
    });
    if (flash <= 0n) {
      throw new Error(
        "Nothing to leverage: the target leverage needs no extra debt."
      );
    }
    const leg = this.legAmounts(p.ctx, p.marginRaw + flash);
    const input = LendSmartOperate.quote(() =>
      LendSmart.variableInput(
        "deposit",
        p.ctx.colCtx,
        leg[0],
        leg[1],
        p.slippageBps
      )
    );
    return {
      action: p.action,
      flashRaw: flash,
      perfect: false,
      col: { action: "supply", input },
      debt: { action: "borrow", input: { amount: flash } },
      sharesDelta: input.shares,
      debtDelta: flash,
      legs: leg,
      marginRaw: p.marginRaw,
    };
  }

  private static async execute(p: {
    opts: Opts;
    vault: Vault;
    nft: Nft | null;
    signer: Signer;
    ctx: SmartMultiplyCtx;
    slippageBps: number;
    move: Move;
  }): Promise<void> {
    const { opts, vault, nft, signer, ctx, move } = p;
    const debtMint = vault.borrowToken.token0.address;
    const current = nft ? this.position(nft) : { shares: 0n, debt: 0n };
    this.validate({ vault, ctx, current, move });

    const [programs, flashPositions] = await Promise.all([
      LendTx.tokenPrograms([debtMint, LendTx.WSOL_MINT]),
      FluidClient.getFlashloanPositions(opts.market),
    ]);
    const flashAvailable = flashPositions.find((f) => f.asset === debtMint);
    if (!flashAvailable || BigInt(flashAvailable.borrowable) < move.flashRaw) {
      throw new Error(
        "Not enough flashloan liquidity for this size right now. Try a smaller amount or leverage."
      );
    }
    const flashParams = {
      signer: signer.address,
      mint: debtMint,
      amount: move.flashRaw,
      tokenProgram: programs.get(debtMint)!,
      market: opts.market,
    };
    const [flashBorrow, flashPayback, operate] = await Promise.all([
      LendFlashloan.borrowIx(flashParams),
      LendFlashloan.paybackIx(flashParams),
      LendDexOperate.build({
        vaultId: vault.id,
        positionId: nft?.id ?? 0,
        signer: signer.address,
        market: opts.market,
        perfect: move.perfect,
        col: move.col,
        debt: move.debt,
      }),
    ]);
    const wsolProgram = programs.get(LendTx.WSOL_MINT)!;
    const isAta = (ix: Instruction) =>
      ix.programAddress === ASSOCIATED_TOKEN_PROGRAM;
    const wrap =
      debtMint === LendTx.WSOL_MINT && move.marginRaw > 0n
        ? await LendTx.wrapSol(signer.address, move.marginRaw, wsolProgram)
        : [];
    const transaction = await LendTx.compile(
      signer.address,
      [
        ...LendTx.computeBudget(DEX_OPERATE_COMPUTE_UNITS),
        ...operate.instructions.filter(isAta),
        ...wrap,
        flashBorrow,
        ...operate.instructions.filter((ix) => !isAta(ix)),
        flashPayback,
        ...(debtMint === LendTx.WSOL_MINT
          ? [await LendTx.unwrapSol(signer.address, wsolProgram)]
          : []),
      ],
      operate.lookupTables
    );
    if (!LendTx.fits(transaction)) {
      throw new Error(
        nft
          ? "The flashloan and smart-vault operate do not fit in one transaction."
          : `Opening and levering this vault does not fit in one transaction. Open it first with \`jup lend borrow open --vault ${vault.id} --collateral1 <amount>\`, then run \`jup lend multiply set --position <id> --leverage <x>\`.`
      );
    }

    const debtDecimals = vault.borrowToken.token0.decimals;
    const before = {
      collateral: LendSmartOperate.human(current.shares, SHARE_DECIMALS),
      debt: LendSmartOperate.human(current.debt, debtDecimals),
    };
    const change = {
      collateral: LendSmartOperate.human(move.sharesDelta, SHARE_DECIMALS),
      debt: LendSmartOperate.human(move.debtDelta, debtDecimals),
    };
    const after = {
      collateral: Math.max(0, before.collateral + change.collateral),
      debt: Math.max(0, before.debt + change.debt),
    };
    const health = LendMath.health(vault, after.collateral, after.debt);
    await LendSmartOperate.submit(signer, transaction, {
      action: move.action,
      vaultId: vault.id,
      positionId: operate.nftId,
      leverage: health.multiplier,
      collateral: {
        token: LendBorrowCommand.sideInfo(vault.supplyToken),
        change: change.collateral,
        amount: after.collateral,
        legs: LendSmartOperate.legViews(vault.supplyToken, move.legs),
      },
      debt: {
        token: LendBorrowCommand.sideInfo(vault.borrowToken),
        change: change.debt,
        amount: after.debt,
      },
      ltvPct: health.ltvPct,
      maxLtvPct: health.maxLtvPct,
      liquidationLtvPct: health.liquidationLtvPct,
      liquidationPrice: health.liquidationPrice,
      healthStatus: after.debt > 0 ? health.status : null,
      swap: null,
      slippageBps: p.slippageBps,
    });
  }

  private static validate(p: {
    vault: Vault;
    ctx: SmartMultiplyCtx;
    current: { shares: bigint; debt: bigint };
    move: Move;
  }): void {
    const { vault, ctx, move } = p;
    if (move.debtDelta > 0n && move.debtDelta > BigInt(vault.borrowable)) {
      throw new Error(
        "Borrow exceeds the vault's currently borrowable liquidity."
      );
    }
    const maxShares = BigInt(ctx.colCtx.dex.maxShares);
    if (
      move.sharesDelta > 0n &&
      maxShares > 0n &&
      ctx.colCtx.totalShares + move.sharesDelta > maxShares
    ) {
      throw new Error("The DEX pool's supply cap would be exceeded.");
    }
    const debtAfter = p.current.debt + move.debtDelta;
    if (move.debtDelta > 0n && debtAfter < BigInt(vault.minimumBorrowing)) {
      const decimals = vault.borrowToken.token0.decimals;
      throw new Error(
        `Minimum borrow for this vault is ${LendSmartOperate.human(BigInt(vault.minimumBorrowing), decimals)} ${vault.borrowToken.token0.symbol}.`
      );
    }
  }

  private static position(nft: Nft): { shares: bigint; debt: bigint } {
    return {
      shares: BigInt(nft.supply),
      debt: BigInt(nft.borrow) + BigInt(nft.dustBorrow ?? 0),
    };
  }

  private static legAmounts(
    ctx: SmartMultiplyCtx,
    amount: bigint
  ): [bigint, bigint] {
    return ctx.marginLeg === 0 ? [amount, 0n] : [0n, amount];
  }

  private static oraclePrice(vault: Vault): bigint {
    if (vault.oraclePrice === null) {
      throw new Error(`Vault ${vault.id} has no oracle price right now.`);
    }
    return BigInt(vault.oraclePrice);
  }

  private static slippageBps(opts: Opts, ctx: SmartMultiplyCtx): number {
    return LendSmartOperate.slippageBps(opts.slippage, ctx.colCtx);
  }
}
