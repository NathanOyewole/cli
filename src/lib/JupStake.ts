import {
  address,
  createSolanaRpc,
  getAddressEncoder,
  getProgramDerivedAddress,
} from "@solana/kit";

import { Rpc } from "./Rpc.ts";

const LOCKED_VOTER = address("voTpe3tHQ7AjQHMapgSue2HJFAh2cGsdokqN3XqmVSj");
const GOVERNANCE_BASE = address("bJ1TRoFo2P6UHVwqdiipp6Qhp2HaaHpLowZ5LHet8Gm");

// Escrow layout (locked_voter IDL): 8-byte discriminator, locker, owner, bump,
// tokens, amount u64, escrowStartedAt i64, escrowEndsAt i64, voteDelegate,
// isMaxLock bool, ...
const AMOUNT_OFFSET = 8 + 32 + 32 + 1 + 32;
const IS_MAX_LOCK_OFFSET = AMOUNT_OFFSET + 8 + 8 + 8 + 32;

// Only max-locked JUP counts as active stake, matching the web's
// GovernanceClient.getActiveJupStake.
export function decodeActiveStake(data: Uint8Array): bigint {
  if (data.length <= IS_MAX_LOCK_OFFSET || data[IS_MAX_LOCK_OFFSET] !== 1) {
    return 0n;
  }
  return new DataView(
    data.buffer,
    data.byteOffset,
    data.byteLength
  ).getBigUint64(AMOUNT_OFFSET, true);
}

export class JupStake {
  public static readonly DECIMALS = 6;

  public static async activeStake(walletAddress: string): Promise<bigint> {
    const encoder = getAddressEncoder();
    const [locker] = await getProgramDerivedAddress({
      programAddress: LOCKED_VOTER,
      seeds: ["Locker", encoder.encode(GOVERNANCE_BASE)],
    });
    const [escrow] = await getProgramDerivedAddress({
      programAddress: LOCKED_VOTER,
      seeds: [
        "Escrow",
        encoder.encode(locker),
        encoder.encode(address(walletAddress)),
      ],
    });
    const { value } = await createSolanaRpc(Rpc.url)
      .getAccountInfo(escrow, { encoding: "base64" })
      .send();
    if (!value) {
      return 0n;
    }
    return decodeActiveStake(Buffer.from(value.data[0], "base64"));
  }
}
