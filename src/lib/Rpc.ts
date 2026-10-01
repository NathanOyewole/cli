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
    const signature = await createSolanaRpc(this.url)
      .sendTransaction(signedTx, {
        encoding: "base64",
        preflightCommitment: "confirmed",
      })
      .send();
    await this.confirm(signature, timeoutMs);
    return signature;
  }

  public static async confirm(
    signature: string,
    timeoutMs = 60_000
  ): Promise<void> {
    const rpc = createSolanaRpc(this.url);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      // A flaky status read must not fail a transaction that may have landed.
      const status = await rpc
        .getSignatureStatuses([signature as Signature])
        .send()
        .then(({ value }) => value[0])
        .catch(() => undefined);
      if (status?.err) {
        throw new Error(
          `Transaction ${signature} failed: ${JSON.stringify(status.err, (_k, v) => (typeof v === "bigint" ? v.toString() : v))}`
        );
      }
      if (
        status?.confirmationStatus === "confirmed" ||
        status?.confirmationStatus === "finalized"
      ) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error(
      `Transaction ${signature} was sent but not confirmed within ${timeoutMs / 1000}s. Check it on an explorer before retrying.`
    );
  }
}
