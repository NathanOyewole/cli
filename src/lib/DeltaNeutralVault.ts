import { findAssociatedTokenPda } from "@solana-program/token";
import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createSolanaRpc,
  createTransactionMessage,
  getAddressDecoder,
  getAddressEncoder,
  getBase64EncodedWireTransaction,
  getProgramDerivedAddress,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Instruction,
} from "@solana/kit";

import { Rpc } from "./Rpc.ts";

// Neutral Trade "ntbundle" program and the JLP Delta Neutral vault the web
// app uses. Layouts and discriminators come from the program's Anchor IDL
// (apps/jupiter-ui/.../PerpsJLPDeltaNeutral/data/program/idl.ts).
const PROGRAM = address("BUNDeH5A4c47bcEoAjBhN3sCjLgYnRsmt9ibMztqVkC9");
export const VAULT = address("GiNbTRuRqvVGEEQGZKMjmwX84LrsbqfzVVNtWYbcZPCY");
export const VAULT_ID = 69;

const TOKEN_PROGRAM = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const SYSTEM_PROGRAM = address("11111111111111111111111111111111");
const RENT_SYSVAR = address("SysvarRent111111111111111111111111111111111");

// sha256("global:<snake_case_name>")[0..8]
const IX = {
  initializeBundleDepositor: [126, 6, 242, 36, 22, 209, 35, 2],
  requestDeposit: [243, 202, 197, 215, 135, 97, 213, 109],
  requestWithdrawal: [251, 85, 121, 205, 56, 201, 12, 177],
};
// sha256("account:<Name>")[0..8]
const ACCOUNT = {
  bundle: [15, 82, 167, 230, 37, 214, 82, 80],
  oracleData: [26, 131, 25, 110, 6, 141, 10, 37],
  userBundleAccount: [32, 181, 106, 26, 67, 130, 185, 241],
};

export type Bundle = {
  treasuryAccount: Address;
  bundleUnderlyingBalance: bigint;
  maxDepositAmount: bigint;
  minDepositAmount: bigint;
  totalShares: bigint;
  assetAddress: Address;
  assetDecimals: number;
};

export type UserBundle = {
  shares: bigint;
  pendingDeposit: bigint;
  pendingShares: bigint;
  withdrawalAvailableTimestamp: bigint;
  hwmPerShare: bigint;
  netDeposits: bigint;
  totalFeeCharged: bigint;
};

class Reader {
  #offset: number;
  readonly #view: DataView;

  constructor(
    readonly data: Uint8Array,
    discriminator: number[],
    name: string
  ) {
    if (discriminator.some((b, i) => data[i] !== b)) {
      throw new Error(`Account is not a ${name}`);
    }
    this.#view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    this.#offset = 8;
  }

  skip(bytes: number): this {
    this.#offset += bytes;
    return this;
  }
  u8(): number {
    return this.#view.getUint8(this.#offset++);
  }
  u32(): number {
    const v = this.#view.getUint32(this.#offset, true);
    this.#offset += 4;
    return v;
  }
  u64(): bigint {
    const v = this.#view.getBigUint64(this.#offset, true);
    this.#offset += 8;
    return v;
  }
  u128(): bigint {
    return this.u64() + (this.u64() << 64n);
  }
  i128(): bigint {
    return BigInt.asIntN(128, this.u128());
  }
  address(): Address {
    const v = getAddressDecoder().decode(
      this.data.subarray(this.#offset, this.#offset + 32)
    );
    this.#offset += 32;
    return v;
  }
}

export function decodeBundle(data: Uint8Array): Bundle {
  const r = new Reader(data, ACCOUNT.bundle, "bundle").skip(32 + 32 + 32);
  const treasuryAccount = r.address();
  r.skip(r.u32() * 32);
  const bundleUnderlyingBalance = r.u64();
  const maxDepositAmount = r.u64();
  const minDepositAmount = r.u64();
  // withdrawalDelay, 4 fee fields, managerPfeeShares, currentAllocationBps,
  // oracleBuffer, oracleUpdateTimeLimit, oracleMaxAge
  r.skip(8 + 4 * 4 + 16 + 4 + 8 + 8 + 8);
  const totalShares = r.u128();
  r.skip(8);
  const assetAddress = r.address();
  const assetDecimals = r.u8();
  return {
    treasuryAccount,
    bundleUnderlyingBalance,
    maxDepositAmount,
    minDepositAmount,
    totalShares,
    assetAddress,
    assetDecimals,
  };
}

export function decodeOracleExternalEquity(data: Uint8Array): bigint {
  return new Reader(data, ACCOUNT.oracleData, "oracleData").u64();
}

export function decodeUserBundle(data: Uint8Array): UserBundle {
  const r = new Reader(data, ACCOUNT.userBundleAccount, "user account").skip(
    32 + 8
  );
  const shares = r.u128();
  const pendingDeposit = r.u64();
  const pendingShares = r.u128();
  r.skip(8);
  const withdrawalAvailableTimestamp = r.u64();
  r.skip(8 + 16);
  const hwmPerShare = r.u128();
  r.skip(8);
  const netDeposits = r.i128();
  const totalFeeCharged = r.u64();
  return {
    shares,
    pendingDeposit,
    pendingShares,
    withdrawalAvailableTimestamp,
    hwmPerShare,
    netDeposits,
    totalFeeCharged,
  };
}

function u64Le(value: bigint, bytes: 8 | 16): Uint8Array {
  const out = new Uint8Array(bytes);
  const view = new DataView(out.buffer);
  view.setBigUint64(0, value & 0xffff_ffff_ffff_ffffn, true);
  if (bytes === 16) {
    view.setBigUint64(8, value >> 64n, true);
  }
  return out;
}

const ixData = (discriminator: number[], arg?: Uint8Array) =>
  Uint8Array.from([...discriminator, ...(arg ?? [])]);

async function pda(seed: string, ...keys: Address[]): Promise<Address> {
  const encoder = getAddressEncoder();
  const [result] = await getProgramDerivedAddress({
    programAddress: PROGRAM,
    seeds: [seed, ...keys.map((k) => encoder.encode(k))],
  });
  return result;
}

export const userAccountAddress = (user: Address) =>
  pda("USER_BUNDLE", user, VAULT);

export class DeltaNeutralVault {
  static async #fetch(account: Address): Promise<Uint8Array | null> {
    const { value } = await createSolanaRpc(Rpc.url)
      .getAccountInfo(account, { encoding: "base64" })
      .send();
    return value ? Buffer.from(value.data[0], "base64") : null;
  }

  // TVL and price per share computed like the web's getVaultAccount:
  // on-chain balance plus the oracle's external equity, over total shares.
  public static async getState(): Promise<{
    bundle: Bundle;
    tvl: number;
    pps: number;
  }> {
    const [bundleData, oracleData] = await Promise.all([
      this.#fetch(VAULT),
      this.#fetch(await pda("ORACLE", VAULT)),
    ]);
    if (!bundleData || !oracleData) {
      throw new Error("Delta neutral vault account not found.");
    }
    const bundle = decodeBundle(bundleData);
    const scale = 10 ** bundle.assetDecimals;
    const tvl =
      Number(
        bundle.bundleUnderlyingBalance + decodeOracleExternalEquity(oracleData)
      ) / scale;
    const shares = Number(bundle.totalShares) / scale;
    return { bundle, tvl, pps: shares === 0 ? 1 : tvl / shares };
  }

  public static async getUser(user: Address): Promise<UserBundle | null> {
    const data = await this.#fetch(await userAccountAddress(user));
    return data ? decodeUserBundle(data) : null;
  }

  public static async depositInstructions(
    user: Address,
    bundle: Bundle,
    amount: bigint,
    hasUserAccount: boolean
  ): Promise<Instruction[]> {
    const userAccount = await userAccountAddress(user);
    const pendingAuthority = await pda("PENDING_BUNDLE_ASSET_AUTHORITY", VAULT);
    const [userTokenAccount] = await findAssociatedTokenPda({
      mint: bundle.assetAddress,
      owner: user,
      tokenProgram: TOKEN_PROGRAM,
    });
    const [pendingTokenAccount] = await findAssociatedTokenPda({
      mint: bundle.assetAddress,
      owner: pendingAuthority,
      tokenProgram: TOKEN_PROGRAM,
    });
    const w = AccountRole.WRITABLE;
    const ws = AccountRole.WRITABLE_SIGNER;
    const r = AccountRole.READONLY;
    const instructions: Instruction[] = [];
    if (!hasUserAccount) {
      instructions.push({
        programAddress: PROGRAM,
        accounts: [
          { address: user, role: ws },
          { address: user, role: ws },
          { address: SYSTEM_PROGRAM, role: r },
          { address: VAULT, role: w },
          { address: userAccount, role: w },
        ],
        data: ixData(IX.initializeBundleDepositor),
      });
    }
    instructions.push({
      programAddress: PROGRAM,
      accounts: [
        { address: user, role: ws },
        { address: userTokenAccount, role: w },
        { address: pendingTokenAccount, role: w },
        { address: bundle.treasuryAccount, role: w },
        { address: userAccount, role: w },
        { address: bundle.assetAddress, role: w },
        { address: await pda("ORACLE", VAULT), role: w },
        { address: await pda("BUNDLE_TEMP_DATA", VAULT), role: w },
        { address: VAULT, role: w },
        { address: pendingAuthority, role: w },
        { address: TOKEN_PROGRAM, role: r },
        { address: SYSTEM_PROGRAM, role: r },
      ],
      data: ixData(IX.requestDeposit, u64Le(amount, 8)),
    });
    return instructions;
  }

  public static async withdrawInstruction(
    user: Address,
    shares: bigint
  ): Promise<Instruction> {
    const w = AccountRole.WRITABLE;
    const r = AccountRole.READONLY;
    return {
      programAddress: PROGRAM,
      accounts: [
        { address: user, role: AccountRole.WRITABLE_SIGNER },
        { address: await userAccountAddress(user), role: w },
        { address: VAULT, role: w },
        { address: await pda("ORACLE", VAULT), role: w },
        { address: await pda("BUNDLE_TEMP_DATA", VAULT), role: w },
        { address: TOKEN_PROGRAM, role: r },
        { address: SYSTEM_PROGRAM, role: r },
        { address: RENT_SYSVAR, role: r },
      ],
      data: ixData(IX.requestWithdrawal, u64Le(shares, 16)),
    };
  }

  // Unsigned v0 transaction, base64, with a fresh blockhash.
  public static async buildTransaction(
    feePayer: Address,
    instructions: Instruction[]
  ): Promise<string> {
    const { value: blockhash } = await createSolanaRpc(Rpc.url)
      .getLatestBlockhash()
      .send();
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayer(feePayer, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
      (m) => appendTransactionMessageInstructions(instructions, m)
    );
    return getBase64EncodedWireTransaction(compileTransaction(message));
  }
}
