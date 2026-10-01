import type { Base64EncodedBytes } from "@solana/kit";

import { PerpsClient } from "../clients/PerpsClient.ts";
import { Config } from "./Config.ts";
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
    const { txid } = await PerpsClient.postExecute({
      action,
      serializedTxBase64: signedTx,
    });
    // The execute endpoint returns once the keeper co-signs and sends; the
    // web still waits for the transaction to land and checks its error.
    await Rpc.confirm(txid);
    return { action, txid };
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
