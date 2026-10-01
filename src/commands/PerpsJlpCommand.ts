import type { Command } from "commander";

import { JlpClient } from "../clients/JlpClient.ts";
import { Asset } from "../lib/Asset.ts";
import { Config } from "../lib/Config.ts";
import { NumberConverter } from "../lib/NumberConverter.ts";
import { Output } from "../lib/Output.ts";
import { PerpsTx } from "../lib/PerpsTx.ts";
import { Signer } from "../lib/Signer.ts";

export const JLP = {
  id: "27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4",
  decimals: 6,
} as const;

// Pool tokens accepted by /jlp/mint and /jlp/burn, keyed by the CLI name;
// `apiSymbol` is the custody symbol the API expects.
const POOL_TOKENS: Record<string, { apiSymbol: string; decimals: number }> = {
  SOL: { apiSymbol: "SOL", decimals: Asset.SOL.decimals },
  ETH: { apiSymbol: "ETH", decimals: Asset.ETH.decimals },
  BTC: { apiSymbol: "WBTC", decimals: Asset.BTC.decimals },
  USDC: { apiSymbol: "USDC", decimals: Asset.USDC.decimals },
  JUPUSD: { apiSymbol: "JUPUSD", decimals: 6 },
};

function resolvePoolToken(name: string) {
  const key = name.toUpperCase() === "WBTC" ? "BTC" : name.toUpperCase();
  const token = POOL_TOKENS[key];
  if (!token) {
    throw new Error(
      `Unsupported token: ${name}. Use one of ${Object.keys(POOL_TOKENS).join(", ")}.`
    );
  }
  return { name: key, ...token };
}

export class PerpsJlpCommand {
  public static register(perps: Command): void {
    const jlp = perps
      .command("jlp")
      .description("JLP liquidity pool: earn trading fees by minting JLP");
    jlp
      .command("info")
      .description("Show JLP price, APR/APY, pool size, and token weights")
      .action(() => this.info());
    jlp
      .command("mint")
      .alias("buy")
      .description("Mint JLP by depositing a pool token")
      .requiredOption("--amount <number>", "Input token amount")
      .option("--input <token>", "Pool token to deposit", "USDC")
      .option("--key <name>", "Key to use for signing")
      .action((opts) => this.mint(opts));
    jlp
      .command("burn")
      .alias("sell")
      .description("Burn JLP and receive a pool token")
      .requiredOption("--amount <number>", "JLP amount to burn")
      .option("--receive <token>", "Pool token to receive", "USDC")
      .option("--key <name>", "Key to use for signing")
      .action((opts) => this.burn(opts));
  }

  private static async info(): Promise<void> {
    const res = await JlpClient.getInfo();
    const custodies = res.custodies
      .filter((c) => Number(c.targetWeightagePct) > 0)
      .map((c) => ({
        asset: c.symbol,
        mint: c.mint,
        amount: Number(c.aumTokenAmountFormatted),
        valueUsd: NumberConverter.fromMicroUsd(c.aumUsd),
        weightPct: Number(c.currentWeightagePct),
        targetWeightPct: Number(c.targetWeightagePct),
        utilizationPct: Number(c.utilizationPct),
      }));
    const info = {
      priceUsd: NumberConverter.fromMicroUsd(res.jlpPriceUsd),
      aprPct: Number(res.jlpAprPct),
      apyPct: Number(res.jlpApyPct),
      aumUsd: NumberConverter.fromMicroUsd(res.aumUsd),
      aumLimitUsd: NumberConverter.fromMicroUsd(res.aumLimitUsd),
      totalSupply: Number(
        NumberConverter.fromChainAmount(res.jlpTotalSupply, JLP.decimals)
      ),
      aprUpdatedAt: new Date(
        Number(res.jlpAprLastUpdatedTimestamp) * 1000
      ).toISOString(),
      custodies,
    };

    if (Output.isJson()) {
      Output.json(info);
      return;
    }

    Output.table({
      type: "vertical",
      rows: [
        { label: "JLP Price", value: Output.formatDollar(info.priceUsd) },
        { label: "APR", value: `${info.aprPct}%` },
        { label: "APY", value: `${info.apyPct}%` },
        {
          label: "AUM",
          value: `${Output.formatDollar(info.aumUsd, { decimals: 0 })} / ${Output.formatDollar(info.aumLimitUsd, { decimals: 0 })} limit`,
        },
        {
          label: "Total Supply",
          value: `${info.totalSupply.toLocaleString("en-US")} JLP`,
        },
      ],
    });
    Output.table({
      type: "horizontal",
      headers: {
        asset: "Asset",
        amount: "Amount",
        valueUsd: "Value",
        weight: "Weight / Target",
        utilizationPct: "Utilization",
      },
      rows: custodies.map((c) => ({
        asset: c.asset,
        amount: c.amount.toLocaleString("en-US"),
        valueUsd: Output.formatDollar(c.valueUsd, { decimals: 0 }),
        weight: `${c.weightPct}% / ${c.targetWeightPct}%`,
        utilizationPct: `${c.utilizationPct}%`,
      })),
    });
  }

  private static async mint(opts: {
    amount: string;
    input: string;
    key?: string;
  }): Promise<void> {
    const token = resolvePoolToken(opts.input);
    const signer = await Signer.load(opts.key ?? Config.load().activeKey);
    const res = await JlpClient.postMint({
      walletAddress: signer.address,
      depositToken: token.apiSymbol,
      depositTokenAmount: NumberConverter.toChainAmount(
        opts.amount,
        token.decimals
      ),
    });
    if (!res.serializedTxBase64) {
      throw new Error("API returned no transaction for JLP mint.");
    }
    const signature = await PerpsTx.signAndSend(signer, res.serializedTxBase64);
    const jlpAmount = Number(
      NumberConverter.fromChainAmount(res.mintTokenAmount, JLP.decimals)
    );

    if (Output.isJson()) {
      Output.json({
        ...(Config.dryRun && { dryRun: true }),
        action: "mint-jlp",
        input: token.name,
        inputAmount: opts.amount,
        jlpAmount,
        feePct: Number(res.mintFeePercent),
        signature,
        ...(Config.dryRun && { transaction: res.serializedTxBase64 }),
      });
      return;
    }

    if (Config.dryRun) {
      console.log(Output.DRY_RUN_LABEL);
    }
    Output.table({
      type: "vertical",
      rows: [
        { label: "Action", value: "Mint JLP" },
        { label: "Deposit", value: `${opts.amount} ${token.name}` },
        { label: "Receive", value: `${jlpAmount} JLP` },
        { label: "Fee", value: `${res.mintFeePercent}%` },
        ...(signature ? [{ label: "Tx Signature", value: signature }] : []),
      ],
    });
  }

  private static async burn(opts: {
    amount: string;
    receive: string;
    key?: string;
  }): Promise<void> {
    const token = resolvePoolToken(opts.receive);
    const signer = await Signer.load(opts.key ?? Config.load().activeKey);
    const res = await JlpClient.postBurn({
      walletAddress: signer.address,
      burnTokenAmount: NumberConverter.toChainAmount(opts.amount, JLP.decimals),
      receiveToken: token.apiSymbol,
    });
    if (!res.serializedTxBase64) {
      throw new Error("API returned no transaction for JLP burn.");
    }
    const signature = await PerpsTx.signAndSend(signer, res.serializedTxBase64);
    const receivedAmount = Number(
      NumberConverter.fromChainAmount(res.receiveTokenAmount, token.decimals)
    );

    if (Output.isJson()) {
      Output.json({
        ...(Config.dryRun && { dryRun: true }),
        action: "burn-jlp",
        jlpAmount: opts.amount,
        receive: token.name,
        receivedAmount,
        feePct: Number(res.burnFeePercent),
        signature,
        ...(Config.dryRun && { transaction: res.serializedTxBase64 }),
      });
      return;
    }

    if (Config.dryRun) {
      console.log(Output.DRY_RUN_LABEL);
    }
    Output.table({
      type: "vertical",
      rows: [
        { label: "Action", value: "Burn JLP" },
        { label: "Burn", value: `${opts.amount} JLP` },
        { label: "Receive", value: `${receivedAmount} ${token.name}` },
        { label: "Fee", value: `${res.burnFeePercent}%` },
        ...(signature ? [{ label: "Tx Signature", value: signature }] : []),
      ],
    });
  }
}
