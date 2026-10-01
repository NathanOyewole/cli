import {
  createKeyPairFromPrivateKeyBytes,
  getAddressFromPublicKey,
  getBase58Decoder,
  getBase58Encoder,
  signBytes,
} from "@solana/kit";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import { Config } from "./Config.ts";
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

/** The web app's localStorage shape: the base58 seed is the session key. */
export type StoredCommentSession = {
  walletAddress: string;
  sessionPublicKey: string;
  sessionSecret: string;
  nonce: string;
  expiresAt: number;
};

const SESSION_TTL_MS = 86_400_000;
/** Don't start a request on a session that could expire mid-flight. */
const SESSION_EXPIRY_MARGIN_MS = 60_000;

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
   * once, so each comment doesn't need a wallet signature. Like jup.ag, the
   * key is kept for its 24h lifetime instead of re-authorizing every call.
   */
  public static async newCommentSession(wallet: string): Promise<{
    stored: StoredCommentSession;
    message: string;
  }> {
    const sessionSecret = getBase58Decoder().decode(
      crypto.getRandomValues(new Uint8Array(32))
    );
    const { publicKey } = await this.keyPairFromSecret(sessionSecret);
    const sessionPublicKey = await getAddressFromPublicKey(publicKey);
    const nonce = getBase58Decoder().decode(
      crypto.getRandomValues(new Uint8Array(16))
    );
    const expiresAt = Date.now() + SESSION_TTL_MS;
    return {
      stored: {
        walletAddress: wallet,
        sessionPublicKey,
        sessionSecret,
        nonce,
        expiresAt,
      },
      message: this.commentSessionMessage(
        wallet,
        sessionPublicKey,
        nonce,
        expiresAt
      ),
    };
  }

  public static async toCommentSession(
    stored: StoredCommentSession
  ): Promise<CommentSession> {
    const { privateKey } = await this.keyPairFromSecret(stored.sessionSecret);
    return {
      sessionPublicKey: stored.sessionPublicKey,
      nonce: stored.nonce,
      privateKey,
    };
  }

  public static isSessionUsable(
    stored: Pick<StoredCommentSession, "expiresAt">,
    now: number
  ): boolean {
    return stored.expiresAt - SESSION_EXPIRY_MARGIN_MS > now;
  }

  public static loadCommentSession(
    wallet: string
  ): StoredCommentSession | null {
    const path = this.sessionPath(wallet);
    if (!existsSync(path)) {
      return null;
    }
    try {
      const stored = JSON.parse(
        readFileSync(path, "utf-8")
      ) as StoredCommentSession;
      return stored.walletAddress === wallet &&
        stored.sessionSecret &&
        this.isSessionUsable(stored, Date.now())
        ? stored
        : null;
    } catch {
      return null;
    }
  }

  public static saveCommentSession(stored: StoredCommentSession): void {
    const path = this.sessionPath(stored.walletAddress);
    mkdirSync(join(Config.CONFIG_DIR, "auth"), {
      recursive: true,
      mode: 0o700,
    });
    writeFileSync(path, JSON.stringify(stored), { mode: 0o600 });
    chmodSync(path, 0o600);
  }

  public static clearCommentSession(wallet: string): void {
    rmSync(this.sessionPath(wallet), { force: true });
  }

  private static sessionPath(wallet: string): string {
    return join(Config.CONFIG_DIR, "auth", `predict-comments-${wallet}.json`);
  }

  private static keyPairFromSecret(secret: string): Promise<CryptoKeyPair> {
    return createKeyPairFromPrivateKeyBytes(
      new Uint8Array(getBase58Encoder().encode(secret))
    );
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
