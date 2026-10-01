import { describe, expect, test } from "bun:test";

import { decodeActiveStake } from "./JupStake.ts";

function escrow(amount: bigint, isMaxLock: boolean): Uint8Array {
  const data = new Uint8Array(8 + 32 + 32 + 1 + 32 + 8 + 8 + 8 + 32 + 1 + 64);
  new DataView(data.buffer).setBigUint64(105, amount, true);
  data[161] = isMaxLock ? 1 : 0;
  return data;
}

describe("decodeActiveStake", () => {
  test("counts max-locked stake", () => {
    expect(decodeActiveStake(escrow(69_885_634n, true))).toBe(69_885_634n);
  });

  test("ignores stake that is not max-locked", () => {
    expect(decodeActiveStake(escrow(900_000_000n, false))).toBe(0n);
  });

  test("treats truncated data as no stake", () => {
    expect(decodeActiveStake(new Uint8Array(100))).toBe(0n);
  });
});
