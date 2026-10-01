import type { Base64EncodedBytes } from "@solana/kit";

import {
  DatapiClient,
  type ShieldWarning,
  type Token,
} from "../clients/DatapiClient.ts";
import {
  UltraClient,
  type GetOrderResponse,
  type PostExecuteResponse,
  type SwapSettings,
} from "../clients/UltraClient.ts";
import { Config } from "./Config.ts";
import { NumberConverter } from "./NumberConverter.ts";
import type { Signer } from "./Signer.ts";

export type SwapResult = {
  signer: Signer;
  order: GetOrderResponse;
  result: PostExecuteResponse | null;
  inputToken: Token;
  outputToken: Token;
  inAmount: string;
  outAmount: string;
  networkFeeLamports: number;
};

export type SwapSettingsOpts = {
  exactOut?: boolean;
  priorityFee?: string;
  jitoTip?: string;
  feeType?: string;
  useWsol?: boolean;
  excludeDexes?: string;
  excludeRouters?: string;
};

export type TokenWarning = ShieldWarning & {
  token: { id: string; symbol: string; decimals: number };
};

const MIN_JITO_TIP_LAMPORTS = 1000;
const ROUTERS = ["metis", "jupiterz", "hashflow", "dflow"];

export class Swap {
  public static validateAmountOpts(opts: {
    amount?: string;
    rawAmount?: string;
  }): void {
    if (!opts.amount && !opts.rawAmount) {
      throw new Error("Either --amount or --raw-amount must be provided.");
    }
    if (opts.amount && opts.rawAmount) {
      throw new Error("Only one of --amount or --raw-amount can be provided.");
    }
  }

  public static async execute(opts: {
    signer: Signer;
    inputToken: Token;
    outputToken: Token;
    amount?: string;
    rawAmount?: string;
    slippageBps?: string;
    settings?: SwapSettings;
  }): Promise<SwapResult> {
    const { signer, inputToken, outputToken } = opts;
    const inputMultiplier = this.getScaledUiMultiplier(inputToken);
    const outputMultiplier = this.getScaledUiMultiplier(outputToken);

    const order = await UltraClient.getOrder({
      ...opts.settings,
      inputMint: inputToken.id,
      outputMint: outputToken.id,
      amount: this.toOrderAmount(opts),
      taker: signer.address,
      slippageBps: opts.slippageBps,
    });

    if (order.error) {
      throw new Error(order.errorMessage ?? order.error);
    }
    if (!order.transaction) {
      throw new Error("No valid routes found.");
    }

    let networkFeeLamports = 0;
    if (
      order.prioritizationFeePayer === signer.address &&
      order.prioritizationFeeLamports
    ) {
      networkFeeLamports = order.prioritizationFeeLamports;
    }
    if (order.rentFeePayer === signer.address && order.rentFeeLamports) {
      networkFeeLamports += order.rentFeeLamports;
    }
    if (
      order.signatureFeePayer === signer.address &&
      order.signatureFeeLamports
    ) {
      networkFeeLamports += order.signatureFeeLamports;
    }

    if (Config.dryRun) {
      const inAmount = NumberConverter.fromChainAmount(
        order.inAmount,
        inputToken.decimals,
        inputMultiplier
      );
      const outAmount = NumberConverter.fromChainAmount(
        order.outAmount,
        outputToken.decimals,
        outputMultiplier
      );
      return {
        signer,
        order,
        result: null,
        inputToken,
        outputToken,
        inAmount,
        outAmount,
        networkFeeLamports,
      };
    }

    const signedTx = await signer.signTransaction(
      order.transaction as Base64EncodedBytes
    );
    const result = await UltraClient.postExecute({
      requestId: order.requestId,
      signedTransaction: signedTx,
    });

    const inAmount = NumberConverter.fromChainAmount(
      result.inputAmountResult,
      inputToken.decimals,
      inputMultiplier
    );
    const outAmount = NumberConverter.fromChainAmount(
      result.outputAmountResult,
      outputToken.decimals,
      outputMultiplier
    );

    return {
      signer,
      order,
      result,
      inputToken,
      outputToken,
      inAmount,
      outAmount,
      networkFeeLamports,
    };
  }

  // In ExactOut mode the amount denominates the output token.
  public static toOrderAmount(opts: {
    inputToken: Token;
    outputToken: Token;
    amount?: string | undefined;
    rawAmount?: string | undefined;
    settings?: SwapSettings | undefined;
  }): string {
    if (opts.rawAmount) {
      return opts.rawAmount;
    }
    const token =
      opts.settings?.swapMode === "ExactOut"
        ? opts.outputToken
        : opts.inputToken;
    return NumberConverter.toChainAmount(
      opts.amount!,
      token.decimals,
      this.getScaledUiMultiplier(token)
    );
  }

  public static parseSettings(opts: SwapSettingsOpts): SwapSettings {
    const lamports = (value: string | undefined, flag: string, min = 0) => {
      if (value === undefined) {
        return undefined;
      }
      const n = Number(value);
      if (!Number.isInteger(n) || n < min) {
        throw new Error(
          `${flag} must be an integer of at least ${min} lamports.`
        );
      }
      return String(n);
    };
    const list = (value: string | undefined) =>
      value
        ?.split(",")
        .map((v) => v.trim())
        .filter(Boolean)
        .join(",") || undefined;

    let broadcastFeeType: SwapSettings["broadcastFeeType"];
    if (opts.feeType !== undefined) {
      if (opts.feeType !== "max-cap" && opts.feeType !== "exact-fee") {
        throw new Error("--fee-type must be max-cap or exact-fee.");
      }
      broadcastFeeType = opts.feeType === "max-cap" ? "maxCap" : "exactFee";
    }
    const excludeRouters = list(opts.excludeRouters);
    const unknownRouter = excludeRouters
      ?.split(",")
      .find((r) => !ROUTERS.includes(r));
    if (unknownRouter) {
      throw new Error(
        `Unknown router "${unknownRouter}" in --exclude-routers. Must be one of: ${ROUTERS.join(", ")}.`
      );
    }

    const settings: SwapSettings = {
      swapMode: opts.exactOut ? "ExactOut" : undefined,
      priorityFeeLamports: lamports(opts.priorityFee, "--priority-fee"),
      jitoTipLamports: lamports(
        opts.jitoTip,
        "--jito-tip",
        MIN_JITO_TIP_LAMPORTS
      ),
      broadcastFeeType,
      useWsol: opts.useWsol || undefined,
      excludeDexes: list(opts.excludeDexes),
      excludeRouters,
    };
    return Object.fromEntries(
      Object.entries(settings).filter(([, v]) => v !== undefined)
    );
  }

  // Shield warnings are advisory, so a failed lookup never blocks a swap.
  public static async getTokenWarnings(
    tokens: Token[]
  ): Promise<TokenWarning[] | null> {
    try {
      const warnings = await DatapiClient.getShieldWarnings(
        tokens.map((t) => t.id)
      );
      return tokens.flatMap((t) =>
        (warnings[t.id] ?? []).map((w) => ({
          token: { id: t.id, symbol: t.symbol, decimals: t.decimals },
          type: w.type,
          severity: w.severity,
          message: w.message,
        }))
      );
    } catch {
      return null;
    }
  }

  public static getScaledUiMultiplier(token: Token): number | undefined {
    if (!token.scaledUiConfig) {
      return undefined;
    }
    const isNewMultiplierActive =
      new Date() >= new Date(token.scaledUiConfig.newMultiplierEffectiveAt);
    return isNewMultiplierActive
      ? token.scaledUiConfig.newMultiplier
      : token.scaledUiConfig.multiplier;
  }
}
