import { describe, expect, test } from "bun:test";
import { HTTPError, type NormalizedOptions } from "ky";

import { PerpsTx } from "./PerpsTx.ts";

const httpError = (status: number) =>
  new HTTPError(
    new Response(null, { status }),
    new Request("https://perps-api.jup.ag/v2/transaction/execute"),
    {} as NormalizedOptions
  );

// One signature of 64 0x01 bytes over a legacy message with one account.
const SIGNED_TX = Buffer.concat([
  Buffer.from([1]),
  Buffer.alloc(64, 1),
  Buffer.from([1, 0, 0, 1]),
  Buffer.alloc(32, 2),
  Buffer.alloc(32, 3),
  Buffer.from([0]),
]).toString("base64");
const SIGNATURE =
  "2AXDGYSE4f2sz7tvMMzyHvUfcoJmxudvdhBcmiUSo6ijwfYmfZYsKRxboQMPh3R4kUhXRVdtSXFXMheka4Rc4P2";

describe("PerpsTx.isOutcomeUnknown", () => {
  test("only a definite 4xx rejection is a known failure", () => {
    expect(PerpsTx.isOutcomeUnknown(httpError(400))).toBe(false);
    expect(PerpsTx.isOutcomeUnknown(httpError(422))).toBe(false);
    expect(PerpsTx.isOutcomeUnknown(httpError(408))).toBe(true);
    expect(PerpsTx.isOutcomeUnknown(httpError(429))).toBe(true);
    expect(PerpsTx.isOutcomeUnknown(httpError(500))).toBe(true);
    expect(PerpsTx.isOutcomeUnknown(httpError(504))).toBe(true);
    expect(PerpsTx.isOutcomeUnknown(new Error("Request timed out"))).toBe(true);
  });
});

describe("PerpsTx.submit", () => {
  test("names the signature when the outcome is unknown", async () => {
    expect(PerpsTx.signatureOf(SIGNED_TX)).toBe(SIGNATURE);
    await expect(
      PerpsTx.submit(SIGNED_TX, "jup perps positions", () =>
        Promise.reject(httpError(503))
      )
    ).rejects.toThrow(
      `Outcome unknown: the transaction may have been submitted (signature ${SIGNATURE}). Check 'jup perps positions'`
    );
  });

  test("passes a definite rejection through", async () => {
    await expect(
      PerpsTx.submit(SIGNED_TX, "jup perps positions", () =>
        Promise.reject(httpError(400))
      )
    ).rejects.toThrow("Request failed with status code 400");
  });
});
