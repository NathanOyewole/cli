import type { Command } from "commander";
import type { Address, Instruction } from "@solana/kit";

import { FluidClient, type Nft, type Vault } from "../clients/FluidClient.ts";
import { LendClient, type LendMarket } from "../clients/LendClient.ts";
import { SwapV1Client, type SwapV1Quote } from "../clients/SwapV1Client.ts";
import { Config } from "../lib/Config.ts";
import { LendFlashloan } from "../lib/LendFlashloan.ts";
import { LendMath } from "../lib/LendMath.ts";
import { LendOptions } from "../lib/LendOptions.ts";
import { LendSmart } from "../lib/LendSmart.ts";
import { LendTx } from "../lib/LendTx.ts";
import { NumberConverter } from "../lib/NumberConverter.ts";
import { Output } from "../lib/Output.ts";
import { Signer } from "../lib/Signer.ts";
import { LendBorrowCommand, MAX_SENTINEL } from "./LendBorrowCommand.ts";
import { LendSmartMultiply } from "./LendSmartMultiply.ts";

const MULTIPLY_COMPUTE_UNITS = 1_000_000;
const DEFAULT_SWAP_SLIPPAGE_BPS = "10";
const SLIPPAGE_HELP =
  "Max slippage in basis points: the swap's (default 10), or on a smart vault the DEX deposit or withdrawal's (default twice the pool fee, else 2)";
// Route size ladder from the jup.ag UI: try big routes first, shrink until the
// flashloan + swap + operate transaction fits.
const MAX_ACCOUNTS_LADDER = [64, 40, 32, 28, 20];
// Vaults whose pairs have no direct route (jup.ag INDIRECT_ROUTE list).
const INDIRECT_ROUTE_VAULTS: Record<LendMarket, number[]> = {
  main: [68, 69],
  ethena: [5],
};
// Extra debt covered on a full close so interest accrued while the
// transaction lands is still repaid (jup.ag FULL_CLOSE_DEBT_PAD).
const FULL_CLOSE_DEBT_PAD = 0.001;

type Opts = {
  market: LendMarket;
  key?: string;
  slippage?: string;
};

type Plan = {
  flashMint: string;
  flashRaw: bigint;
  swapIn: string;
  swapOut: string;
  colRaw: (quote: SwapV1Quote) => string;
  debtRaw: (quote: SwapV1Quote) => string;
  wrapSupplyRaw: bigint;
};

export class LendMultiplyCommand {
  public static register(lend: Command): void {
    const multiply = lend
      .command("multiply")
      .description(
        "Leveraged positions built with a flashloan and swap in one transaction"
      );
    multiply
      .command("vaults")
      .description("List vaults that support Multiply")
      .addOption(LendOptions.market())
      .action((opts) => this.vaults(opts));
    multiply
      .command("open")
      .description("Open a leveraged position from collateral")
      .requiredOption("--vault <id>", "Vault ID")
      .requiredOption(
        "--amount <n>",
        "Collateral to deposit as margin (smart vaults: in the debt token, deposited into its pair)"
      )
      .requiredOption("--leverage <x>", "Target leverage, e.g. 3")
      .option("--slippage <bps>", SLIPPAGE_HELP)
      .addOption(LendOptions.market())
      .option("--key <name>", "Key to use for signing")
      .action((opts) => this.open(opts));
    multiply
      .command("set")
      .description("Change a position's leverage (up or down)")
      .requiredOption("--position <id>", "Position ID")
      .requiredOption("--leverage <x>", "Target leverage, e.g. 2")
      .option("--vault <id>", "Vault ID (looked up from the wallet if omitted)")
      .option("--slippage <bps>", SLIPPAGE_HELP)
      .addOption(LendOptions.market())
      .option("--key <name>", "Key to use for signing")
      .action((opts) => this.set(opts));
    multiply
      .command("close")
      .description(
        "Unwind a position: sell collateral to repay all debt, withdraw the rest"
      )
      .requiredOption("--position <id>", "Position ID")
      .option("--vault <id>", "Vault ID (looked up from the wallet if omitted)")
      .option("--slippage <bps>", SLIPPAGE_HELP)
      .addOption(LendOptions.market())
      .option("--key <name>", "Key to use for signing")
      .action((opts) => this.close(opts));
  }

  private static async vaults(opts: { market: LendMarket }): Promise<void> {
    const vaults = (await FluidClient.getVaults(opts.market))
      .filter((v) => v.metadata.multiply.enabled)
      .map((v) => {
        const s = LendBorrowCommand.vaultSummary(v);
        const m = s.maxMultiplier;
        return {
          ...s,
          maxApyPct:
            Math.round((s.supplyApyPct * m - s.borrowApyPct * (m - 1)) * 100) /
            100,
          supported: v.type === 1 || LendSmart.multiplyCtx(v) !== null,
        };
      });

    if (Output.isJson()) {
      Output.json({ vaults });
      return;
    }
    Output.table({
      type: "horizontal",
      headers: {
        id: "Vault",
        pair: "Collateral / Debt",
        mult: "Max Leverage",
        apy: "Max APY",
        tvl: "TVL",
      },
      rows: vaults.map((v) => ({
        id: `${v.vaultId}${v.supported ? "" : " (smart)"}`,
        pair: `${v.collateral.symbol} / ${v.debt.symbol}`,
        mult: `${v.maxMultiplier}x`,
        apy: Output.formatPercentageChange(v.maxApyPct),
        tvl: Output.formatDollar(v.totalSupplyUsd ?? undefined),
      })),
    });
  }

  private static async open(
    opts: Opts & { vault: string; amount: string; leverage: string }
  ): Promise<void> {
    const vault = await FluidClient.getVault(
      opts.market,
      LendOptions.positiveInt("--vault", opts.vault)
    );
    this.assertSupported(vault);
    const leverage = this.parseLeverage(opts.leverage, vault);
    if (vault.type !== 1) {
      const signer = await Signer.load(opts.key ?? Config.load().activeKey);
      return LendSmartMultiply.open({
        opts,
        vault,
        signer,
        amount: opts.amount,
        leverage,
      });
    }
    const price = this.oraclePrice(vault);
    const supply = vault.supplyToken.token0;
    const debt = vault.borrowToken.token0;
    const marginRaw = BigInt(
      NumberConverter.toChainAmount(opts.amount, supply.decimals)
    );
    const borrowRaw = this.toRaw(
      (leverage - 1) * price * Number(opts.amount),
      debt.decimals
    );

    await this.execute({
      opts,
      vault,
      nft: null,
      action: "open",
      leverage,
      plan: {
        flashMint: debt.address,
        flashRaw: borrowRaw,
        swapIn: debt.address,
        swapOut: supply.address,
        colRaw: (q) => (BigInt(q.otherAmountThreshold) + marginRaw).toString(),
        debtRaw: () => borrowRaw.toString(),
        wrapSupplyRaw: marginRaw,
      },
    });
  }

  private static async set(
    opts: Opts & { position: string; vault?: string; leverage: string }
  ): Promise<void> {
    const signer = await Signer.load(opts.key ?? Config.load().activeKey);
    const nft = await LendBorrowCommand.resolveNft(
      opts.market,
      signer.address,
      opts.position,
      opts.vault
    );
    const vault = nft.vault;
    this.assertSupported(vault);
    const leverage = this.parseLeverage(opts.leverage, vault);
    if (leverage === 1) {
      return this.close(opts);
    }
    if (vault.type !== 1) {
      return LendSmartMultiply.set({ opts, nft, signer, leverage });
    }
    const price = this.oraclePrice(vault);
    const { collateral, debt } = LendMath.positionAmounts(nft);
    const equity = collateral - debt / price;
    if (equity <= 0) {
      throw new Error("Position has no equity to lever.");
    }
    const targetDebt = (leverage - 1) * equity * price;
    const supply = vault.supplyToken.token0;
    const debtToken = vault.borrowToken.token0;

    if (targetDebt > debt) {
      const borrowRaw = this.toRaw(targetDebt - debt, debtToken.decimals);
      await this.execute({
        opts,
        vault,
        nft,
        action: "leverage",
        leverage,
        plan: {
          flashMint: debtToken.address,
          flashRaw: borrowRaw,
          swapIn: debtToken.address,
          swapOut: supply.address,
          colRaw: (q) => q.otherAmountThreshold,
          debtRaw: () => borrowRaw.toString(),
          wrapSupplyRaw: 0n,
        },
      });
      return;
    }

    const slippage = this.slippageBps(opts.slippage) / 1e4;
    const withdrawRaw = this.toRaw(
      (debt - targetDebt) / price / (1 - slippage),
      supply.decimals
    );
    await this.execute({
      opts,
      vault,
      nft,
      action: "deleverage",
      leverage,
      plan: {
        flashMint: supply.address,
        flashRaw: withdrawRaw,
        swapIn: supply.address,
        swapOut: debtToken.address,
        colRaw: () => (-withdrawRaw).toString(),
        debtRaw: (q) => (-BigInt(q.otherAmountThreshold)).toString(),
        wrapSupplyRaw: 0n,
      },
    });
  }

  private static async close(
    opts: Opts & { position: string; vault?: string }
  ): Promise<void> {
    const signer = await Signer.load(opts.key ?? Config.load().activeKey);
    const nft = await LendBorrowCommand.resolveNft(
      opts.market,
      signer.address,
      opts.position,
      opts.vault
    );
    const vault = nft.vault;
    this.assertSupported(vault);
    if (vault.type !== 1) {
      return LendSmartMultiply.close({ opts, nft, signer });
    }
    const price = this.oraclePrice(vault);
    const { collateral, debt } = LendMath.positionAmounts(nft);
    const supply = vault.supplyToken.token0;
    if (debt === 0) {
      throw new Error(
        "Position has no debt. Use `jup lend borrow withdraw` to withdraw the collateral."
      );
    }
    const slippage = this.slippageBps(opts.slippage) / 1e4;
    const sell = (debt * (1 + FULL_CLOSE_DEBT_PAD)) / price / (1 - slippage);
    if (sell > collateral) {
      throw new Error(
        "Collateral is not enough to repay the debt through a swap. Repay some debt with `jup lend borrow repay` first."
      );
    }
    const withdrawRaw = this.toRaw(sell, supply.decimals);
    await this.execute({
      opts,
      vault,
      nft,
      action: "close",
      leverage: 1,
      plan: {
        flashMint: supply.address,
        flashRaw: withdrawRaw,
        swapIn: supply.address,
        swapOut: vault.borrowToken.token0.address,
        colRaw: () => MAX_SENTINEL,
        debtRaw: () => MAX_SENTINEL,
        wrapSupplyRaw: 0n,
      },
    });
  }

  private static async execute(p: {
    opts: Opts;
    vault: Vault;
    nft: Nft | null;
    action: string;
    leverage: number;
    plan: Plan;
  }): Promise<void> {
    const { opts, vault, nft, plan } = p;
    const signer = await Signer.load(opts.key ?? Config.load().activeKey);
    const supply = vault.supplyToken.token0;
    const debt = vault.borrowToken.token0;
    const slippageBps = this.slippageBps(opts.slippage);

    const [programs, flashPositions] = await Promise.all([
      LendTx.tokenPrograms([supply.address, debt.address]),
      FluidClient.getFlashloanPositions(opts.market),
    ]);
    const flashAvailable = flashPositions.find(
      (f) => f.asset === plan.flashMint
    );
    if (!flashAvailable || BigInt(flashAvailable.borrowable) < plan.flashRaw) {
      throw new Error(
        "Not enough flashloan liquidity for this size right now. Try a smaller amount or leverage."
      );
    }
    const flashParams = {
      signer: signer.address,
      mint: plan.flashMint,
      amount: plan.flashRaw,
      tokenProgram: programs.get(plan.flashMint)!,
      market: opts.market,
    };
    const [flashBorrow, flashPayback] = await Promise.all([
      LendFlashloan.borrowIx(flashParams),
      LendFlashloan.paybackIx(flashParams),
    ]);
    const hasSol =
      supply.address === LendTx.WSOL_MINT || debt.address === LendTx.WSOL_MINT;
    const wsolProgram = programs.get(LendTx.WSOL_MINT) as Address;

    let built: {
      transaction: string;
      quote: SwapV1Quote;
      nftId: number;
    } | null = null;
    for (const maxAccounts of MAX_ACCOUNTS_LADDER) {
      const quote = await SwapV1Client.getQuote({
        inputMint: plan.swapIn,
        outputMint: plan.swapOut,
        amount: plan.flashRaw.toString(),
        slippageBps,
        maxAccounts,
        onlyDirectRoutes: !INDIRECT_ROUTE_VAULTS[opts.market].includes(
          vault.id
        ),
      });
      const [swap, operate] = await Promise.all([
        SwapV1Client.postSwapInstructions({
          quoteResponse: quote,
          userPublicKey: signer.address,
        }),
        LendClient.postOperateInstructions({
          signer: signer.address,
          vaultId: vault.id,
          positionId: nft?.id ?? 0,
          colAmount: plan.colRaw(quote),
          debtAmount: plan.debtRaw(quote),
          market: opts.market,
        }),
      ]);

      const ixs: Instruction[] = [
        ...LendTx.computeBudget(MULTIPLY_COMPUTE_UNITS),
        await LendTx.createAta(
          signer.address,
          supply.address,
          programs.get(supply.address)!
        ),
        await LendTx.createAta(
          signer.address,
          debt.address,
          programs.get(debt.address)!
        ),
        flashBorrow,
        LendTx.fromApi(swap.swapInstruction),
      ];
      if (supply.address === LendTx.WSOL_MINT && plan.wrapSupplyRaw > 0n) {
        ixs.push(
          ...(await LendTx.wrapSol(
            signer.address,
            plan.wrapSupplyRaw,
            wsolProgram
          ))
        );
      }
      ixs.push(...operate.instructions.map(LendTx.fromApi), flashPayback);
      if (hasSol) {
        ixs.push(await LendTx.unwrapSol(signer.address, wsolProgram));
      }

      try {
        const transaction = await LendTx.compile(signer.address, ixs, [
          ...operate.addressLookupTableAddresses,
          ...swap.addressLookupTableAddresses,
        ]);
        if (LendTx.fits(transaction)) {
          built = { transaction, quote, nftId: operate.nftId };
          break;
        }
      } catch {
        // Too large to serialize; retry with a smaller route.
      }
    }
    if (!built) {
      // Minting the position NFT adds accounts; jup.ag then opens the
      // position first and levers it in a second transaction.
      throw new Error(
        nft
          ? "Could not fit the flashloan, swap and operate into one transaction. Try a different --slippage or retry shortly."
          : `This vault's route is too large to open and lever in one transaction. Open it first with \`jup lend borrow open --vault ${vault.id} --collateral <amount>\`, then run \`jup lend multiply set --position <id> --leverage <x>\`.`
      );
    }

    const { quote, transaction } = built;
    const current = nft
      ? LendMath.positionAmounts(nft)
      : { collateral: 0, debt: 0 };
    const human = (raw: string, decimals: number) =>
      Number(NumberConverter.fromChainAmount(BigInt(raw).toString(), decimals));
    const colRaw = plan.colRaw(quote);
    const debtRaw = plan.debtRaw(quote);
    const collateralChange =
      colRaw === MAX_SENTINEL
        ? -current.collateral
        : (colRaw.startsWith("-") ? -1 : 1) *
          human(colRaw.replace("-", ""), supply.decimals);
    const debtChange =
      debtRaw === MAX_SENTINEL
        ? -current.debt
        : (debtRaw.startsWith("-") ? -1 : 1) *
          human(debtRaw.replace("-", ""), debt.decimals);
    const after = {
      collateral: Math.max(0, current.collateral + collateralChange),
      debt: Math.max(0, current.debt + debtChange),
    };
    const health = LendMath.health(vault, after.collateral, after.debt);
    const result = {
      action: p.action,
      vaultId: vault.id,
      positionId: built.nftId,
      leverage: health.multiplier,
      collateral: {
        token: LendBorrowCommand.sideInfo(vault.supplyToken),
        change: collateralChange,
        amount: after.collateral,
      },
      debt: {
        token: LendBorrowCommand.sideInfo(vault.borrowToken),
        change: debtChange,
        amount: after.debt,
      },
      ltvPct: health.ltvPct,
      maxLtvPct: health.maxLtvPct,
      liquidationLtvPct: health.liquidationLtvPct,
      liquidationPrice: health.liquidationPrice,
      healthStatus: after.debt > 0 ? health.status : null,
      swap: {
        inputMint: plan.swapIn,
        outputMint: plan.swapOut,
        inAmount: quote.inAmount,
        minOutAmount: quote.otherAmountThreshold,
        route: quote.routePlan.map((r) => r.swapInfo.label).join(" > "),
        slippageBps,
      },
    };

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

  private static assertSupported(vault: Vault): void {
    if (!vault.metadata.multiply.enabled) {
      throw new Error(`Vault ${vault.id} does not support Multiply.`);
    }
    if (vault.type !== 1) {
      LendSmartMultiply.ctx(vault);
    }
  }

  private static parseLeverage(value: string, vault: Vault): number {
    const leverage = Number(value);
    const max = LendMath.maxMultiplier(vault);
    if (!(leverage >= 1) || leverage > max) {
      throw new Error(`--leverage must be between 1 and ${max}.`);
    }
    return leverage;
  }

  private static oraclePrice(vault: Vault): number {
    if (vault.oraclePrice === null) {
      throw new Error(`Vault ${vault.id} has no oracle price right now.`);
    }
    return Number(vault.oraclePrice) / 1e15;
  }

  private static slippageBps(value = DEFAULT_SWAP_SLIPPAGE_BPS): number {
    const bps = Number(value);
    if (!Number.isInteger(bps) || bps <= 0 || bps > 1000) {
      throw new Error("--slippage must be an integer between 1 and 1000.");
    }
    return bps;
  }

  private static toRaw(amount: number, decimals: number): bigint {
    return BigInt(
      NumberConverter.toChainAmount(amount.toFixed(decimals), decimals)
    );
  }
}
