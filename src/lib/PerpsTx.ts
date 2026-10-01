import {
  getBase64Encoder,
  getSignatureFromTransaction,
  getTransactionDecoder,
  type Base64EncodedBytes,
} from "@solana/kit";
import { HTTPError } from "ky";

import { PerpsClient } from "../clients/PerpsClient.ts";
import { Config } from "./Config.ts";
import { NumberConverter } from "./NumberConverter.ts";
import { Rpc } from "./Rpc.ts";
import { Signer } from "./Signer.ts";

export class PerpsTx {
  public static async signAndExecute(
    signer: Signer,
    action: string,
    serializedTxBase64: string
  ): Promise<{ action: string; txid: string | null }> {
    if (Config.dryRun) {
      return { action, txid: null };
    }
    const signedTx = await signer.signTransaction(
      serializedTxBase64 as Base64EncodedBytes
    );
    const { txid } = await this.submit(signedTx, "jup perps positions", () =>
      PerpsClient.postExecute({ action, serializedTxBase64: signedTx })
    );
    // The execute endpoint returns once the keeper co-signs and sends; the
    // web still waits for the transaction to land and checks its error.
    await Rpc.confirm(txid);
    return { action, txid };
  }

  // Sends a signed transaction through an execute endpoint. When the request
  // times out or the server fails, the transaction may still have been
  // broadcast, so the error carries its signature instead of inviting a retry.
  public static async submit<T>(
    signedTx: string,
    checkCommand: string,
    send: () => Promise<T>
  ): Promise<T> {
    try {
      return await send();
    } catch (err) {
      if (!this.isOutcomeUnknown(err)) {
        throw err;
      }
      throw this.outcomeUnknown(
        this.signatureOf(signedTx),
        checkCommand,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  public static outcomeUnknown(
    signature: string,
    checkCommand: string,
    cause: string
  ): Error {
    return new Error(
      `Outcome unknown: the transaction may have been submitted (signature ${signature}). Check '${checkCommand}' or the signature on an explorer before retrying. Cause: ${cause}`
    );
  }

  // Only a 4xx rejection proves the server never broadcast the transaction.
  public static isOutcomeUnknown(err: unknown): boolean {
    if (!(err instanceof HTTPError)) {
      return true;
    }
    const status = err.response.status;
    return status >= 500 || status === 408 || status === 429;
  }

  public static signatureOf(signedTx: string): string {
    return getSignatureFromTransaction(
      getTransactionDecoder().decode(getBase64Encoder().encode(signedTx))
    );
  }

  public static async signAndSend(
    signer: Signer,
    serializedTxBase64: string
  ): Promise<string | null> {
    if (Config.dryRun) {
      return null;
    }
    const signedTx = await signer.signTransaction(
      serializedTxBase64 as Base64EncodedBytes
    );
    return Rpc.sendAndConfirm(signedTx);
  }

  public static async resolveAddress(opts: {
    key?: string;
    address?: string;
  }): Promise<string> {
    if (opts.address && opts.key) {
      throw new Error("Only one of --address or --key can be provided.");
    }
    return (
      opts.address ??
      (await Signer.loadAddress(opts.key ?? Config.load().activeKey))
    );
  }

  // Partial TP/SL size in micro-USD. As in the web form, a size above the
  // position is rejected and one within 1% of it closes the whole size.
  public static partialTpslSize(
    sizeUsd: string,
    positionSizeMicroUsd: string
  ): string {
    const size = BigInt(NumberConverter.toMicroUsd(sizeUsd) || "0");
    const positionSize = BigInt(positionSizeMicroUsd);
    if (size === 0n) {
      throw new Error("--size must be at least $0.000001.");
    }
    if (size > positionSize) {
      throw new Error(
        `--size can't exceed the position size of $${NumberConverter.fromMicroUsd(positionSizeMicroUsd)}.`
      );
    }
    return size * 100n >= positionSize * 99n
      ? positionSize.toString()
      : size.toString();
  }

  public static normalizeSide(side: string): "long" | "short" {
    const s = side.toLowerCase();
    if (s === "buy" || s === "long") {
      return "long";
    }
    if (s === "sell" || s === "short") {
      return "short";
    }
    throw new Error("Invalid --side. Must be long, short, buy, or sell.");
  }
}
