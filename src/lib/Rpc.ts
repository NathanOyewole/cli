import {
  createSolanaRpc,
  type Base64EncodedWireTransaction,
  type Signature,
} from "@solana/kit";

import { Config } from "./Config.ts";

export class Rpc {
  public static readonly DEFAULT_URL = "https://api.mainnet-beta.solana.com";

  public static get url(): string {
    return Config.load().rpcUrl ?? this.DEFAULT_URL;
  }

  public static async sendAndConfirm(
    signedTx: Base64EncodedWireTransaction,
    timeoutMs = 60_000
  ): Promise<Signature> {
    const rpc = createSolanaRpc(this.url);
    const signature = await rpc
      .sendTransaction(signedTx, {
        encoding: "base64",
        preflightCommitment: "confirmed",
      })
      .send();

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const { value } = await rpc.getSignatureStatuses([signature]).send();
      const status = value[0];
      if (status?.err) {
        throw new Error(
          `Transaction ${signature} failed: ${JSON.stringify(status.err, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`
        );
      }
      if (
        status?.confirmationStatus === "confirmed" ||
        status?.confirmationStatus === "finalized"
      ) {
        return signature;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error(
      `Transaction ${signature} was sent but not confirmed within ${timeoutMs / 1000}s. Check it on an explorer before retrying.`
    );
  }
}
