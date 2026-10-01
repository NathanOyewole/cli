import {
  getBase58Encoder,
  getPublicKeyFromAddress,
  verifySignature,
  type Address,
  type SignatureBytes,
} from "@solana/kit";
import { describe, expect, test } from "bun:test";

import { PredictionsAuth } from "./PredictionsAuth.ts";
import { Signer } from "./Signer.ts";

const WALLET = "GuP8ysGU8Y3sT6uzTZrU1SuqHFvqtNazStFzMXaur6dc";
const TIMESTAMP = Date.UTC(2026, 9, 1, 12, 30, 0);

describe("message templates", () => {
  test("clan action lists details between the action and wallet", () => {
    expect(
      PredictionsAuth.clanMessage(
        "Request to join clan",
        { Clan: "Arcaders", ClanId: "3cfb1fe7" },
        WALLET,
        TIMESTAMP
      )
    ).toBe(
      "Jupiter Prediction Market Clans\n" +
        "Action: Request to join clan\n" +
        "Clan: Arcaders\n" +
        "ClanId: 3cfb1fe7\n" +
        `Wallet: ${WALLET}\n` +
        "Timestamp: 2026-10-01T12:30:00.000Z"
    );
  });

  test("clan action without details", () => {
    expect(
      PredictionsAuth.clanMessage(
        "View received clan invitations",
        {},
        WALLET,
        TIMESTAMP
      )
    ).toBe(
      "Jupiter Prediction Market Clans\n" +
        "Action: View received clan invitations\n" +
        `Wallet: ${WALLET}\n` +
        "Timestamp: 2026-10-01T12:30:00.000Z"
    );
  });

  test("username", () => {
    expect(PredictionsAuth.usernameMessage(WALLET, "arcader", TIMESTAMP)).toBe(
      "Set Jupiter prediction-market username\n" +
        `Wallet: ${WALLET}\n` +
        "Username: arcader\n" +
        "Timestamp: 2026-10-01T12:30:00.000Z"
    );
  });

  test("comment session", () => {
    expect(
      PredictionsAuth.commentSessionMessage(
        WALLET,
        "Sess1",
        "Nonce1",
        TIMESTAMP
      )
    ).toBe(
      "Authorize Jupiter prediction-market comments\n" +
        `Wallet: ${WALLET}\n` +
        "Session: Sess1\n" +
        "Nonce: Nonce1\n" +
        "Expires: 2026-10-01T12:30:00.000Z"
    );
  });

  test("comment payload keeps the server's key order", () => {
    expect(
      PredictionsAuth.commentPayload({
        text: "gm",
        nonce: "N",
        timestamp: 1,
        parentCommentId: null,
        tags: ["1m"],
        subcategory: "arcade",
        sessionPublicKey: "S",
      })
    ).toBe(
      '{"kind":"Jupiter prediction-market comment","sessionPublicKey":"S","subcategory":"arcade","tags":["1m"],"parentCommentId":null,"timestamp":1,"nonce":"N","text":"gm"}'
    );
  });

  test("comment like payload", () => {
    expect(
      PredictionsAuth.commentLikePayload({
        sessionPublicKey: "S",
        commentId: "c1",
        timestamp: 1,
        nonce: "N",
        liked: false,
      })
    ).toBe(
      '{"kind":"Jupiter prediction-market comment-like","sessionPublicKey":"S","commentId":"c1","timestamp":1,"nonce":"N","liked":false}'
    );
  });

  test("clan chat read payload", () => {
    expect(
      PredictionsAuth.clanChatReadPayload({
        sessionPublicKey: "S",
        clanId: "AB-12",
        sort: "newest",
        cursor: null,
        limit: 5,
        timestamp: 1,
        nonce: "N",
      })
    ).toBe(
      '{"kind":"Jupiter prediction-market clan-comment-read","sessionPublicKey":"S","threadKey":"clan::ab-12","clanId":"AB-12","sort":"newest","cursor":null,"limit":5,"timestamp":1,"nonce":"N"}'
    );
  });
});

describe("signing", () => {
  test("wallet signature is base64 over the UTF-8 message", async () => {
    const signer = await Signer.generate();
    const { message, signature } = await PredictionsAuth.signWithWallet(
      signer,
      "hello"
    );

    expect(message).toBe("aGVsbG8=");
    const publicKey = await getPublicKeyFromAddress(signer.address as Address);
    expect(
      await verifySignature(
        publicKey,
        new Uint8Array(Buffer.from(signature, "base64")) as SignatureBytes,
        new TextEncoder().encode("hello")
      )
    ).toBe(true);
  });

  test("session signature is base58 and verifies against the session key", async () => {
    const { stored, message } = await PredictionsAuth.newCommentSession(WALLET);
    const session = await PredictionsAuth.toCommentSession(stored);
    const signature = await PredictionsAuth.signWithSession(session, "payload");

    expect(message).toContain(`Session: ${session.sessionPublicKey}`);
    const publicKey = await getPublicKeyFromAddress(
      session.sessionPublicKey as Address
    );
    expect(
      await verifySignature(
        publicKey,
        getBase58Encoder().encode(signature) as SignatureBytes,
        new TextEncoder().encode("payload")
      )
    ).toBe(true);
  });
});

describe("comment session cache", () => {
  test("a session is reused until a minute before it expires", () => {
    const now = Date.UTC(2026, 9, 1, 12, 0, 0);
    expect(
      PredictionsAuth.isSessionUsable({ expiresAt: now + 61_000 }, now)
    ).toBe(true);
    expect(
      PredictionsAuth.isSessionUsable({ expiresAt: now + 60_000 }, now)
    ).toBe(false);
  });
});
