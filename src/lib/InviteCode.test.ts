import { describe, expect, test } from "bun:test";

import { InviteCode } from "./InviteCode.ts";

describe("InviteCode", () => {
  // Expected values computed with @solana/web3.js Keypair.fromSeed and
  // PublicKey.findProgramAddressSync, as the jup.ag web app does.
  test("derives the invite signer and PDA like jup.ag", async () => {
    const code = InviteCode.parse("abcdefghijkmnopqrstu");
    const signer = await code.signer();
    expect(String(signer.address)).toBe(
      "GyhMJB785UZuN5azp9XC7LzZiEsHrRVH9efCs8nJJ9Q5"
    );
    expect(String(await InviteCode.invitePda(signer.address))).toBe(
      "DGrSeuqMBqLS8mqb3VoBtpk2KX689tcTsqdx2kNwEDrn"
    );
  });

  test("accepts a full gift link", () => {
    expect(
      InviteCode.parse("https://jup.ag/gift#code=abcdefghijkmnopqrstu").code
    ).toBe("abcdefghijkmnopqrstu");
  });

  test("rejects short or non-base58 codes", () => {
    expect(() => InviteCode.parse("abc")).toThrow(/at least 20/);
    expect(() => InviteCode.parse("0OIlabcdefghijkmnopq")).toThrow(/base58/);
  });

  test("generates 20-character codes with a jup.ag link", () => {
    const code = InviteCode.generate();
    expect(code.code).toHaveLength(20);
    expect(code.link).toBe(`https://jup.ag/gift#code=${code.code}`);
  });
});
