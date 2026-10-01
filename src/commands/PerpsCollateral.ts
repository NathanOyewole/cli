import {
  PerpsClient,
  type IncreasePositionQuote,
  type Position,
} from "../clients/PerpsClient.ts";
import { resolveAsset } from "../lib/Asset.ts";
import { Config } from "../lib/Config.ts";
import { NumberConverter } from "../lib/NumberConverter.ts";
import { Output } from "../lib/Output.ts";
import { PerpsTx } from "../lib/PerpsTx.ts";
import type { Signer } from "../lib/Signer.ts";

type Result = {
  action: "add-collateral" | "remove-collateral";
  positionPubkey: string;
  collateralUsd: number;
  collateralDeltaUsd: number;
  depositUsd?: number;
  leverage: number;
  liquidationPriceUsd: number;
  received: string | null;
  feeUsd: number;
  signature: string | null;
  transaction?: string;
};

// Collateral edits reuse increase/decrease with a zero size delta, the same
// requests the web's "Edit Collateral" form sends.
export class PerpsCollateral {
  public static async add(
    signer: Signer,
    position: Position,
    opts: { amount: string; input?: string; slippage: string }
  ): Promise<void> {
    const inputToken = (opts.input ?? position.collateralToken).toUpperCase();
    const input = resolveAsset(inputToken);
    const inputTokenAmount = NumberConverter.toChainAmount(
      opts.amount,
      input.decimals
    );
    const limits = await PerpsClient.getCollateralLimits(
      input.id,
      position.positionPubkey
    );
    this.assertWithin(
      BigInt(inputTokenAmount),
      BigInt(limits.minCollateralDepositTokenAmount),
      BigInt(limits.maxCollateralDepositTokenAmount),
      (raw) =>
        `${NumberConverter.fromChainAmount(raw, input.decimals)} ${inputToken}`,
      "deposit"
    );

    const res = await PerpsClient.postIncreasePosition({
      asset: position.asset,
      inputToken,
      inputTokenAmount,
      side: position.side,
      maxSlippageBps: opts.slippage,
      sizeUsdDelta: "0",
      walletAddress: signer.address,
    });
    const result = await PerpsTx.signAndExecute(
      signer,
      "increase-position",
      res.serializedTxBase64
    );
    this.print({
      action: "add-collateral",
      positionPubkey: position.positionPubkey,
      collateralUsd: NumberConverter.fromMicroUsd(
        res.quote.positionCollateralUsd
      ),
      ...this.depositSummary(position, res.quote),
      leverage: Number(res.quote.leverage),
      liquidationPriceUsd: NumberConverter.fromMicroUsd(
        res.quote.liquidationPriceUsd
      ),
      received: null,
      signature: result.txid,
      ...(Config.dryRun && { transaction: res.serializedTxBase64 }),
    });
  }

  public static async remove(
    signer: Signer,
    position: Position,
    opts: { usd: string; receive?: string; slippage: string }
  ): Promise<void> {
    const receiveToken = (
      opts.receive ?? position.collateralToken
    ).toUpperCase();
    const receive = resolveAsset(receiveToken);
    const collateralUsdDelta = NumberConverter.toMicroUsd(opts.usd);
    const limits = await PerpsClient.getCollateralLimits(
      receive.id,
      position.positionPubkey
    );
    this.assertWithin(
      BigInt(collateralUsdDelta),
      BigInt(limits.minCollateralWithdrawalUsd),
      BigInt(limits.maxCollateralWithdrawalUsd),
      (raw) => `$${NumberConverter.fromMicroUsd(raw.toString())}`,
      "withdrawal"
    );

    const res = await PerpsClient.postDecreasePosition({
      positionPubkey: position.positionPubkey,
      receiveToken,
      collateralUsdDelta,
      sizeUsdDelta: "0",
      maxSlippageBps: opts.slippage,
    });
    const result = await PerpsTx.signAndExecute(
      signer,
      "decrease-position",
      res.serializedTxBase64
    );
    const received = NumberConverter.fromChainAmount(
      res.quote.transferAmountToken,
      receive.decimals
    );
    this.print({
      action: "remove-collateral",
      positionPubkey: position.positionPubkey,
      collateralUsd: NumberConverter.fromMicroUsd(
        res.quote.positionCollateralUsd
      ),
      collateralDeltaUsd: -NumberConverter.fromMicroUsd(
        res.quote.collateralUsdDelta
      ),
      leverage: Number(res.quote.leverage),
      liquidationPriceUsd: NumberConverter.fromMicroUsd(
        res.quote.liquidationPriceUsd
      ),
      received: `${received} ${receiveToken}`,
      feeUsd: NumberConverter.fromMicroUsd(res.quote.totalFeeUsd),
      signature: result.txid,
      ...(Config.dryRun && { transaction: res.serializedTxBase64 }),
    });
  }

  // Accrued borrow fees are settled out of a deposit, so the collateral grows
  // by less than the amount deposited.
  public static depositSummary(
    position: Pick<Position, "collateralUsd">,
    quote: Pick<
      IncreasePositionQuote,
      | "positionCollateralUsd"
      | "collateralUsdDelta"
      | "outstandingBorrowFeeUsd"
      | "openFeeUsd"
    >
  ): { collateralDeltaUsd: number; depositUsd: number; feeUsd: number } {
    return {
      collateralDeltaUsd: NumberConverter.fromMicroUsd(
        (
          BigInt(quote.positionCollateralUsd) - BigInt(position.collateralUsd)
        ).toString()
      ),
      depositUsd: NumberConverter.fromMicroUsd(quote.collateralUsdDelta),
      feeUsd: NumberConverter.fromMicroUsd(
        (
          BigInt(quote.outstandingBorrowFeeUsd) + BigInt(quote.openFeeUsd)
        ).toString()
      ),
    };
  }

  private static assertWithin(
    value: bigint,
    min: bigint,
    max: bigint,
    format: (raw: bigint) => string,
    label: string
  ): void {
    if (value < min || value > max) {
      throw new Error(
        `Collateral ${label} must be between ${format(min)} and ${format(max)} for this position.`
      );
    }
  }

  private static print(r: Result): void {
    if (Output.isJson()) {
      Output.json({ ...(Config.dryRun && { dryRun: true }), ...r });
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
            r.action === "add-collateral"
              ? "Add Collateral"
              : "Remove Collateral",
        },
        { label: "Position", value: r.positionPubkey },
        ...(r.depositUsd !== undefined
          ? [{ label: "Deposit", value: Output.formatDollar(r.depositUsd) }]
          : []),
        {
          label: "Collateral Change",
          value: Output.formatDollarChange(r.collateralDeltaUsd),
        },
        {
          label: "New Collateral",
          value: Output.formatDollar(r.collateralUsd),
        },
        { label: "New Leverage", value: `${r.leverage}x` },
        {
          label: "Liq. Price",
          value: Output.formatDollar(r.liquidationPriceUsd),
        },
        ...(r.received ? [{ label: "Received", value: r.received }] : []),
        { label: "Fees", value: Output.formatDollar(r.feeUsd) },
        ...(r.signature ? [{ label: "Tx Signature", value: r.signature }] : []),
      ],
    });
  }
}
