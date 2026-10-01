import {
  createKeyPairFromPrivateKeyBytes,
  getAddressFromPublicKey,
  getBase58Decoder,
  signBytes,
} from "@solana/kit";

import type { Signer } from "./Signer.ts";

export type WalletSignature = {
  wallet: string;
  message: string;
  signature: string;
  timestamp: number;
};

export type CommentSession = {
  sessionPublicKey: string;
  nonce: string;
  privateKey: CryptoKey;
};

const SESSION_TTL_MS = 86_400_000;

/**
 * Predict's off-chain social actions (clans, usernames, comments) are
 * authorized by wallet-signed UTF-8 messages instead of a login token. The
 * message templates must match the server byte for byte.
 */
export class PredictionsAuth {
  public static clanMessage(
    action: string,
    details: Record<string, string>,
    wallet: string,
    timestamp: number
  ): string {
    return [
      "Jupiter Prediction Market Clans",
      `Action: ${action}`,
      ...Object.entries(details).map(([label, value]) => `${label}: ${value}`),
      `Wallet: ${wallet}`,
      `Timestamp: ${new Date(timestamp).toISOString()}`,
    ].join("\n");
  }

  public static usernameMessage(
    wallet: string,
    username: string,
    timestamp: number
  ): string {
    return [
      "Set Jupiter prediction-market username",
      `Wallet: ${wallet}`,
      `Username: ${username}`,
      `Timestamp: ${new Date(timestamp).toISOString()}`,
    ].join("\n");
  }

  public static commentSessionMessage(
    wallet: string,
    sessionPublicKey: string,
    nonce: string,
    expiresAt: number
  ): string {
    return [
      "Authorize Jupiter prediction-market comments",
      `Wallet: ${wallet}`,
      `Session: ${sessionPublicKey}`,
      `Nonce: ${nonce}`,
      `Expires: ${new Date(expiresAt).toISOString()}`,
    ].join("\n");
  }

  /** Key order is part of the signed payload, so build it explicitly. */
  public static commentPayload(p: {
    sessionPublicKey: string;
    subcategory: string;
    tags: string[];
    parentCommentId: string | null;
    timestamp: number;
    nonce: string;
    text: string;
  }): string {
    return JSON.stringify({
      kind: "Jupiter prediction-market comment",
      sessionPublicKey: p.sessionPublicKey,
      subcategory: p.subcategory,
      tags: p.tags,
      parentCommentId: p.parentCommentId,
      timestamp: p.timestamp,
      nonce: p.nonce,
      text: p.text,
    });
  }

  public static commentLikePayload(p: {
    sessionPublicKey: string;
    commentId: string;
    timestamp: number;
    nonce: string;
    liked: boolean;
  }): string {
    return JSON.stringify({
      kind: "Jupiter prediction-market comment-like",
      sessionPublicKey: p.sessionPublicKey,
      commentId: p.commentId,
      timestamp: p.timestamp,
      nonce: p.nonce,
      liked: p.liked,
    });
  }

  public static commentDeletePayload(p: {
    sessionPublicKey: string;
    commentId: string;
    timestamp: number;
    nonce: string;
  }): string {
    return JSON.stringify({
      kind: "Jupiter prediction-market comment-delete",
      sessionPublicKey: p.sessionPublicKey,
      commentId: p.commentId,
      timestamp: p.timestamp,
      nonce: p.nonce,
    });
  }

  public static clanChatReadPayload(p: {
    sessionPublicKey: string;
    clanId: string;
    sort: string;
    cursor: string | null;
    limit: number;
    timestamp: number;
    nonce: string;
  }): string {
    return JSON.stringify({
      kind: "Jupiter prediction-market clan-comment-read",
      sessionPublicKey: p.sessionPublicKey,
      threadKey: `clan::${p.clanId.toLowerCase()}`,
      clanId: p.clanId,
      sort: p.sort,
      cursor: p.cursor,
      limit: p.limit,
      timestamp: p.timestamp,
      nonce: p.nonce,
    });
  }

  public static async signWithWallet(
    signer: Signer,
    message: string
  ): Promise<{ message: string; signature: string }> {
    const signature = await signer.signMessage(message);
    return {
      message: Buffer.from(message, "utf-8").toString("base64"),
      signature: Buffer.from(signature).toString("base64"),
    };
  }

  public static async signClanAction(
    signer: Signer,
    action: string,
    details: Record<string, string>
  ): Promise<WalletSignature> {
    const timestamp = Date.now();
    const text = this.clanMessage(action, details, signer.address, timestamp);
    return {
      wallet: signer.address,
      timestamp,
      ...(await this.signWithWallet(signer, text)),
    };
  }

  /**
   * Comments are signed by an ephemeral session key that the wallet authorizes
   * once, so each comment doesn't need a wallet signature.
   */
  public static async newCommentSession(wallet: string): Promise<{
    session: CommentSession;
    expiresAt: number;
    message: string;
  }> {
    const seed = crypto.getRandomValues(new Uint8Array(32));
    const { privateKey, publicKey } =
      await createKeyPairFromPrivateKeyBytes(seed);
    const sessionPublicKey = await getAddressFromPublicKey(publicKey);
    const nonce = getBase58Decoder().decode(
      crypto.getRandomValues(new Uint8Array(16))
    );
    const expiresAt = Date.now() + SESSION_TTL_MS;
    return {
      session: { sessionPublicKey, nonce, privateKey },
      expiresAt,
      message: this.commentSessionMessage(
        wallet,
        sessionPublicKey,
        nonce,
        expiresAt
      ),
    };
  }

  public static async signWithSession(
    session: CommentSession,
    payload: string
  ): Promise<string> {
    const signature = await signBytes(
      session.privateKey,
      new TextEncoder().encode(payload)
    );
    return getBase58Decoder().decode(signature);
  }
}
