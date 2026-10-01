import type { Instruction } from "@solana/kit";

import type { Nft, Vault, VaultSide } from "../clients/FluidClient.ts";
import type { LendMarket } from "../clients/LendClient.ts";
import { Config } from "../lib/Config.ts";
import { DexMathError } from "../lib/DexMath.ts";
import { LendDexOperate, type DexLegInput } from "../lib/LendDexOperate.ts";
import { LendMath } from "../lib/LendMath.ts";
import { LendSmart, type SmartSideCtx } from "../lib/LendSmart.ts";
import { LendTx } from "../lib/LendTx.ts";
import { NumberConverter } from "../lib/NumberConverter.ts";
import { Output } from "../lib/Output.ts";
import type { Signer } from "../lib/Signer.ts";
import { LendBorrowCommand } from "./LendBorrowCommand.ts";

// DEX_OPERATE_COMPUTE_UNITS in @jup-ag/lend/borrow.
export const DEX_OPERATE_COMPUTE_UNITS = 1_400_000;
const SHARE_DECIMALS = 9;

export type SmartOperateOpts = {
  market: LendMarket;
  deposit?: string;
  deposit1?: string;
  withdraw?: string;
  withdraw1?: string;
  borrow?: string;
  borrow1?: string;
  repay?: string;
  repay1?: string;
  slippage?: string;
};

export type LegView = {
  token: { id: string; symbol: string; decimals: number };
  change: number;
};

type SideMove = {
  input: DexLegInput | null;
  // Signed change in protocol units: DEX shares on a smart side, tokens on a
  // normal one (raw, at the side's decimals).
  unitsDelta: bigint;
  // Signed per-token amounts the wallet moves (raw), one per leg.
  legs: bigint[];
  full: boolean;
};

export class LendSmartOperate {
  public static slippageOption(): [string, string] {
    return [
      "--slippage <bps>",
      "Max DEX slippage in basis points for smart (pair) sides (default: twice the pool fee, else 2)",
    ];
  }

  public static async operate(p: {
    opts: SmartOperateOpts;
    action: string;
    vault: Vault;
    nft: Nft | null;
    signer: Signer;
  }): Promise<void> {
    const { opts, vault, nft, signer } = p;
    const colCtx = LendSmart.colCtx(vault);
    const debtCtx = LendSmart.debtCtx(vault);
    if (
      (LendMath.isSmart(vault.supplyToken) && !colCtx) ||
      (LendMath.isSmart(vault.borrowToken) && !debtCtx)
    ) {
      throw new Error(`DEX data is unavailable for vault ${vault.id}.`);
    }
    for (const [flag, value, smart] of [
      ["--deposit1/--collateral1", opts.deposit1, colCtx],
      ["--withdraw1", opts.withdraw1, colCtx],
      ["--borrow1", opts.borrow1, debtCtx],
      ["--repay1", opts.repay1, debtCtx],
    ] as const) {
      if (value !== undefined && !smart) {
        throw new Error(
          `${flag} only applies to a smart (token pair) side; this side of vault ${vault.id} is a single token.`
        );
      }
      if (value === "max") {
        throw new Error(
          `${flag} does not accept 'max'. Omit the amounts to exit the whole side.`
        );
      }
    }
    if (
      (opts.withdraw === "max" && opts.withdraw1) ||
      (opts.repay === "max" && opts.repay1)
    ) {
      throw new Error(
        "'max' exits the whole side; it cannot be combined with a second-token amount."
      );
    }

    const slippageBps = this.slippageBps(opts.slippage, colCtx, debtCtx);
    // A smart debt side holds DEX shares; a normal one owes its dust too.
    const current = {
      col: BigInt(nft?.supply ?? 0),
      debt:
        BigInt(nft?.borrow ?? 0) +
        (debtCtx ? 0n : BigInt(nft?.dustBorrow ?? 0)),
    };
    const withdrawMax = opts.withdraw === "max";
    const repayMax = opts.repay === "max" && current.debt > 0n;
    if (
      opts.repay === "max" &&
      !repayMax &&
      !opts.deposit &&
      !opts.deposit1 &&
      !opts.withdraw &&
      !opts.withdraw1 &&
      !opts.borrow &&
      !opts.borrow1
    ) {
      throw new Error("Position has no debt to repay.");
    }
    const perfect = withdrawMax || repayMax;

    const col = this.side({
      ctx: colCtx,
      side: vault.supplyToken,
      add: [opts.deposit, opts.deposit1],
      remove: withdrawMax ? null : [opts.withdraw, opts.withdraw1],
      full: withdrawMax,
      shares: current.col,
      kind: "collateral",
      perfect,
      slippageBps,
    });
    const debt = this.side({
      ctx: debtCtx,
      side: vault.borrowToken,
      add: [opts.borrow, opts.borrow1],
      remove: opts.repay === "max" ? null : [opts.repay, opts.repay1],
      full: repayMax,
      shares: current.debt,
      kind: "debt",
      perfect,
      slippageBps,
    });
    if (!col.input && !debt.input) {
      throw new Error("Nothing to do.");
    }

    const decimals = (side: VaultSide) =>
      LendMath.isSmart(side) ? SHARE_DECIMALS : side.token0.decimals;
    const human = (raw: bigint, d: number) =>
      Number(
        NumberConverter.fromChainAmount((raw < 0n ? -raw : raw).toString(), d)
      ) * (raw < 0n ? -1 : 1);
    const colDecimals = decimals(vault.supplyToken);
    const debtDecimals = decimals(vault.borrowToken);
    const before = {
      collateral: human(current.col, colDecimals),
      debt: human(current.debt, debtDecimals),
    };
    const change = {
      collateral: col.full
        ? -before.collateral
        : human(col.unitsDelta, colDecimals),
      debt: debt.full ? -before.debt : human(debt.unitsDelta, debtDecimals),
    };
    const after = {
      collateral: Math.max(0, before.collateral + change.collateral),
      debt: Math.max(0, before.debt + change.debt),
    };
    const health = LendMath.health(vault, after.collateral, after.debt);
    this.validate({ vault, col, debt, current, after, health, colCtx });

    const programs = await LendTx.tokenPrograms([LendTx.WSOL_MINT]);
    const wsolProgram = programs.get(LendTx.WSOL_MINT)!;
    const sideTokens = (side: VaultSide) =>
      side.token1 ? [side.token0, side.token1] : [side.token0];
    const nativeLeg = (
      side: VaultSide,
      legs: bigint[],
      wantPositive: boolean
    ) =>
      sideTokens(side).reduce((sum, t, i) => {
        const amount = legs[i] ?? 0n;
        return t.address === LendTx.WSOL_MINT &&
          (wantPositive ? amount > 0n : amount < 0n)
          ? sum + (wantPositive ? amount : -amount)
          : sum;
      }, 0n);
    const wrap: Instruction[] = [];
    const deposited = nativeLeg(vault.supplyToken, col.legs, true);
    const repaid = nativeLeg(vault.borrowToken, debt.legs, false);
    for (const [lamports, pad] of [
      [deposited, 1n],
      [repaid, debt.full ? 1000n : 1n],
    ] as const) {
      if (lamports > 0n) {
        wrap.push(
          await LendTx.createAta(signer.address, LendTx.WSOL_MINT, wsolProgram),
          ...(await LendTx.wrapSol(
            signer.address,
            this.withSlippage(lamports, slippageBps) + pad,
            wsolProgram
          ))
        );
      }
    }
    const unwrap =
      nativeLeg(vault.borrowToken, debt.legs, true) > 0n ||
      nativeLeg(vault.supplyToken, col.legs, false) > 0n ||
      (col.full &&
        sideTokens(vault.supplyToken).some(
          (t) => t.address === LendTx.WSOL_MINT
        ));

    const operate = await LendDexOperate.build({
      vaultId: vault.id,
      positionId: nft?.id ?? 0,
      signer: signer.address,
      market: opts.market,
      perfect,
      col: col.input
        ? {
            action: col.unitsDelta > 0n ? "supply" : "withdraw",
            input: col.input,
          }
        : null,
      debt: debt.input
        ? {
            action: debt.unitsDelta > 0n ? "borrow" : "payback",
            input: debt.input,
          }
        : null,
    });
    const transaction = await LendTx.compile(
      signer.address,
      [
        ...LendTx.computeBudget(DEX_OPERATE_COMPUTE_UNITS),
        ...wrap,
        ...operate.instructions,
        ...(unwrap
          ? [await LendTx.unwrapSol(signer.address, wsolProgram)]
          : []),
      ],
      operate.lookupTables
    );

    const legViews = (
      side: VaultSide,
      legs: bigint[]
    ): LegView[] | undefined =>
      side.token1
        ? sideTokens(side).map((t, i) => ({
            token: { id: t.address, symbol: t.symbol, decimals: t.decimals },
            change: human(legs[i] ?? 0n, t.decimals),
          }))
        : undefined;
    const result = {
      action: p.action,
      vaultId: vault.id,
      positionId: operate.nftId,
      collateral: {
        token: LendBorrowCommand.sideInfo(vault.supplyToken),
        change: change.collateral,
        amount: after.collateral,
        ...(vault.supplyToken.token1
          ? { legs: legViews(vault.supplyToken, col.legs) }
          : {}),
      },
      debt: {
        token: LendBorrowCommand.sideInfo(vault.borrowToken),
        change: change.debt,
        amount: after.debt,
        ...(vault.borrowToken.token1
          ? { legs: legViews(vault.borrowToken, debt.legs) }
          : {}),
      },
      ltvPct: health.ltvPct,
      maxLtvPct: health.maxLtvPct,
      liquidationLtvPct: health.liquidationLtvPct,
      liquidationPrice: health.liquidationPrice,
      healthStatus: after.debt > 0 ? health.status : null,
      slippageBps,
    };
    await this.submit(signer, transaction, result);
  }

  public static async submit<
    T extends Parameters<typeof LendBorrowCommand.printOperate>[0],
  >(signer: Signer, transaction: string, result: T): Promise<void> {
    if (Config.dryRun) {
      if (Output.isJson()) {
        Output.json({ dryRun: true, ...result, signature: null, transaction });
        return;
      }
      console.log(Output.DRY_RUN_LABEL);
      LendBorrowCommand.printOperate(result, null);
      return;
    }
    const signature = await LendTx.signAndSend(signer, transaction);
    if (Output.isJson()) {
      Output.json({ ...result, signature });
      return;
    }
    LendBorrowCommand.printOperate(result, signature);
  }

  public static slippageBps(
    value: string | undefined,
    ...ctxs: (SmartSideCtx | null)[]
  ): number {
    if (value === undefined) {
      return LendSmart.defaultSlippageBps(...ctxs);
    }
    const bps = Number(value);
    if (!(bps > 0) || bps > 1000) {
      throw new Error("--slippage must be between 0 and 1000 basis points.");
    }
    return bps;
  }

  public static withSlippage(amount: bigint, slippageBps: number): bigint {
    const scale = 1_000_000n;
    const factor = scale + BigInt(Math.round(slippageBps * 100));
    return (amount * factor + scale / 2n) / scale;
  }

  public static toRaw(value: string, decimals: number, flag: string): bigint {
    if (!(Number(value) > 0)) {
      throw new Error(`${flag} must be a positive number.`);
    }
    return BigInt(NumberConverter.toChainAmount(value, decimals));
  }

  // One side's leg input, following useSmart{DepositAndBorrow,RepayAndWithdraw}
  // Mutation: variable (imperfect) amounts with a share bound, a proportional
  // perfect max for a full exit, and plain token amounts on a normal side.
  private static side(p: {
    ctx: SmartSideCtx | null;
    side: VaultSide;
    add: [string | undefined, string | undefined];
    remove: [string | undefined, string | undefined] | null;
    full: boolean;
    shares: bigint;
    kind: "collateral" | "debt";
    perfect: boolean;
    slippageBps: number;
  }): SideMove {
    const [addAction, removeAction] =
      p.kind === "collateral"
        ? (["deposit", "withdraw"] as const)
        : (["borrow", "payback"] as const);
    const flags =
      p.kind === "collateral"
        ? ["--deposit", "--deposit1", "--withdraw", "--withdraw1"]
        : ["--borrow", "--borrow1", "--repay", "--repay1"];
    const parse = (
      values: [string | undefined, string | undefined],
      offset: number
    ) => {
      const decimals = [p.side.token0.decimals, p.side.token1?.decimals ?? 0];
      return values.map((v, i) =>
        v === undefined ? 0n : this.toRaw(v, decimals[i]!, flags[offset + i]!)
      ) as [bigint, bigint];
    };
    const added = parse(p.add, 0);
    const removed = p.remove
      ? parse(p.remove, 2)
      : ([0n, 0n] as [bigint, bigint]);
    const adding = added[0] > 0n || added[1] > 0n;
    const removing = removed[0] > 0n || removed[1] > 0n || p.full;
    if (adding && removing) {
      throw new Error(
        p.kind === "collateral"
          ? "Only one of --deposit or --withdraw can be provided."
          : "Only one of --borrow or --repay can be provided."
      );
    }
    if (!adding && !removing) {
      return { input: null, unitsDelta: 0n, legs: [], full: false };
    }
    const sign = adding ? 1n : -1n;
    const amounts = adding ? added : removed;

    if (!p.ctx) {
      if (p.full) {
        return {
          input: { max: true },
          unitsDelta: -p.shares,
          legs: [-p.shares],
          full: true,
        };
      }
      return {
        input: { amount: amounts[0] },
        unitsDelta: sign * amounts[0],
        legs: [sign * amounts[0]],
        full: false,
      };
    }

    if (p.full) {
      const action = removeAction;
      const estimate = this.quote(() =>
        LendSmart.perfectMax(action, p.ctx!, p.shares, p.slippageBps)
      );
      return {
        input: this.quote(() =>
          LendSmart.perfectMaxInput(action, p.ctx!, p.shares, p.slippageBps)
        ),
        unitsDelta: -p.shares,
        legs: [-estimate.token0Amt, -estimate.token1Amt],
        full: true,
      };
    }
    if (p.perfect) {
      throw new Error(
        "A full exit cannot be combined with a partial amount on a smart (pair) side in one transaction. Run them separately."
      );
    }
    const input = this.quote(() =>
      LendSmart.variableInput(
        adding ? addAction : removeAction,
        p.ctx!,
        amounts[0],
        amounts[1],
        p.slippageBps
      )
    );
    return {
      input,
      unitsDelta: sign * input.shares,
      legs: [sign * amounts[0], sign * amounts[1]],
      full: false,
    };
  }

  public static quote<T>(fn: () => T): T {
    try {
      return fn();
    } catch (err) {
      if (err instanceof DexMathError) {
        throw new Error(
          `The DEX pool cannot settle this amount (${err.message}). Try a different amount.`
        );
      }
      throw err;
    }
  }

  private static validate(p: {
    vault: Vault;
    col: SideMove;
    debt: SideMove;
    current: { col: bigint; debt: bigint };
    after: { collateral: number; debt: number };
    health: { ltvPct: number; maxLtvPct: number };
    colCtx: SmartSideCtx | null;
  }): void {
    const { vault, col, debt, current, after, health } = p;
    if (!col.full && -col.unitsDelta > current.col) {
      throw new Error(
        "Withdrawal exceeds the position's collateral. Omit the amounts to withdraw everything."
      );
    }
    if (!debt.full && -debt.unitsDelta > current.debt) {
      throw new Error(
        "Repayment exceeds the position's debt. Omit the amounts to repay everything."
      );
    }
    const normalCol = !vault.supplyToken.token1;
    const normalDebt = !vault.borrowToken.token1;
    if (
      normalCol &&
      !col.full &&
      -col.unitsDelta > BigInt(vault.withdrawable)
    ) {
      throw new Error(
        "Withdrawal exceeds the vault's currently withdrawable liquidity."
      );
    }
    if (normalDebt && debt.unitsDelta > BigInt(vault.borrowable)) {
      throw new Error(
        "Borrow exceeds the vault's currently borrowable liquidity."
      );
    }
    if (p.colCtx && col.unitsDelta > 0n) {
      const maxShares = BigInt(p.colCtx.dex.maxShares);
      if (maxShares > 0n && p.colCtx.totalShares + col.unitsDelta > maxShares) {
        throw new Error("The DEX pool's supply cap would be exceeded.");
      }
    }
    const increasesRisk = debt.unitsDelta > 0n || col.unitsDelta < 0n;
    if (increasesRisk && after.debt > 0 && health.ltvPct > health.maxLtvPct) {
      throw new Error(
        `Resulting LTV ${health.ltvPct >= 100 ? "of 100% or more" : `${health.ltvPct}%`} exceeds the vault's max LTV of ${health.maxLtvPct}%.`
      );
    }
    if (normalDebt && debt.unitsDelta > 0n) {
      const minBorrow =
        Number(vault.minimumBorrowing) /
        10 ** vault.borrowToken.token0.decimals;
      if (after.debt < minBorrow) {
        throw new Error(
          `Minimum borrow for this vault is ${minBorrow} ${vault.borrowToken.token0.symbol}.`
        );
      }
    }
  }
}
