import { createHash } from "node:crypto";

import { address, getAddressEncoder } from "@solana/kit";
import { describe, expect, test } from "bun:test";

import {
  DeltaNeutralVault,
  decodeBundle,
  decodeUserBundle,
} from "./DeltaNeutralVault.ts";

const anchorDiscriminator = (preimage: string) => [
  ...createHash("sha256").update(preimage).digest().subarray(0, 8),
];
const USER = address("3u8EiHGiXNghRseuoAcFXtStmbyenJmdLAFgVyMq8Q6A");
const USDC = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const TREASURY = address("7FKKyhhh3rjeCqYmaeB2xx3L9jcVn2p2LZqyFsXAeAW4");

describe("decodeUserBundle", () => {
  test("reads shares, pending amounts, and fees at IDL offsets", () => {
    const data = new Uint8Array(8 + 168 + 264);
    data.set(anchorDiscriminator("account:UserBundleAccount"));
    const view = new DataView(data.buffer);
    view.setBigUint64(48, 50_008_364n, true); // shares
    view.setBigUint64(64, 11_000_000n, true); // pendingDeposit
    view.setBigUint64(72, 2_000_000n, true); // pendingShares
    view.setBigInt64(96, 1_791_075_065n, true); // withdrawalAvailableTimestamp
    view.setBigUint64(152, 50_000_000n, true); // netDeposits (i128 low)
    view.setBigUint64(168, 64_668n, true); // totalFeeCharged
    expect(decodeUserBundle(data)).toEqual({
      shares: 50_008_364n,
      pendingDeposit: 11_000_000n,
      pendingShares: 2_000_000n,
      withdrawalAvailableTimestamp: 1_791_075_065n,
      hwmPerShare: 0n,
      netDeposits: 50_000_000n,
      totalFeeCharged: 64_668n,
    });
  });

  test("rejects other account types", () => {
    expect(() => decodeUserBundle(new Uint8Array(440))).toThrow(
      "not a user account"
    );
  });
});

describe("decodeBundle", () => {
  test("walks past the receivers vec to the asset fields", () => {
    const data = new Uint8Array(1205);
    data.set(anchorDiscriminator("account:Bundle"));
    const view = new DataView(data.buffer);
    data.set(getAddressEncoder().encode(TREASURY), 104);
    view.setUint32(136, 1, true); // one allocated receiver
    let o = 140 + 32;
    view.setBigUint64(o, 996_295_371n, true); // bundleUnderlyingBalance
    view.setBigUint64(o + 8, 50_000_000_000_000n, true);
    view.setBigUint64(o + 16, 10_000_000n, true);
    o += 24 + 8 + 16 + 16 + 4 + 24;
    view.setBigUint64(o, 13_695_413_341n, true); // totalShares low
    o += 16 + 8;
    data.set(getAddressEncoder().encode(USDC), o);
    data[o + 32] = 6;
    expect(decodeBundle(data)).toEqual({
      treasuryAccount: TREASURY,
      bundleUnderlyingBalance: 996_295_371n,
      maxDepositAmount: 50_000_000_000_000n,
      minDepositAmount: 10_000_000n,
      totalShares: 13_695_413_341n,
      assetAddress: USDC,
      assetDecimals: 6,
    });
  });
});

describe("instructions", () => {
  test("requestWithdrawal encodes shares as u128 after the discriminator", async () => {
    const ix = await DeltaNeutralVault.withdrawInstruction(USER, 25_004_182n);
    expect([...ix.data!]).toEqual([
      ...anchorDiscriminator("global:request_withdrawal"),
      0x96,
      0x88,
      0x7d,
      0x01,
      ...Array<number>(12).fill(0),
    ]);
    expect(ix.accounts?.length).toBe(8);
  });

  test("deposit initializes the user account only when missing", async () => {
    const bundle = {
      treasuryAccount: TREASURY,
      bundleUnderlyingBalance: 0n,
      maxDepositAmount: 0n,
      minDepositAmount: 0n,
      totalShares: 0n,
      assetAddress: USDC,
      assetDecimals: 6,
    };
    const fresh = await DeltaNeutralVault.depositInstructions(
      USER,
      bundle,
      11_000_000n,
      false
    );
    expect(fresh.map((ix) => [...ix.data!.subarray(0, 8)])).toEqual([
      anchorDiscriminator("global:initialize_bundle_depositor"),
      anchorDiscriminator("global:request_deposit"),
    ]);
    expect([...fresh[1]!.data!.subarray(8)]).toEqual([
      0xc0, 0xd8, 0xa7, 0, 0, 0, 0, 0,
    ]);
    const existing = await DeltaNeutralVault.depositInstructions(
      USER,
      bundle,
      11_000_000n,
      true
    );
    expect(existing.length).toBe(1);
  });
});
