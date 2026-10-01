import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  compressTransactionMessageUsingAddressLookupTables,
  createNoopSigner,
  createSolanaRpc,
  createTransactionMessage,
  fetchAddressesForLookupTables,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  getU32Encoder,
  getU64Encoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Base64EncodedBytes,
  type Instruction,
} from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";
import {
  findAssociatedTokenPda,
  getCloseAccountInstruction,
  getCreateAssociatedTokenIdempotentInstruction,
  getSyncNativeInstruction,
} from "@solana-program/token";

import { Rpc } from "./Rpc.ts";
import type { Signer } from "./Signer.ts";

export type ApiInstruction = {
  programId: string;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: string;
};

const COMPUTE_BUDGET_PROGRAM = address(
  "ComputeBudget111111111111111111111111111111"
);

// Matches the jup.ag lend UI's fixed priority fee.
const PRIORITY_MICRO_LAMPORTS = 100_000n;

export class LendTx {
  public static readonly WSOL_MINT =
    "So11111111111111111111111111111111111111112";

  public static fromApi(ix: ApiInstruction): Instruction {
    return {
      programAddress: address(ix.programId),
      accounts: ix.accounts.map((a) => ({
        address: address(a.pubkey),
        role: a.isSigner
          ? a.isWritable
            ? AccountRole.WRITABLE_SIGNER
            : AccountRole.READONLY_SIGNER
          : a.isWritable
            ? AccountRole.WRITABLE
            : AccountRole.READONLY,
      })),
      data: getBase64Encoder().encode(ix.data),
    };
  }

  public static computeBudget(units: number): Instruction[] {
    const limit = new Uint8Array(5);
    limit[0] = 2;
    limit.set(getU32Encoder().encode(units), 1);
    const price = new Uint8Array(9);
    price[0] = 3;
    price.set(getU64Encoder().encode(PRIORITY_MICRO_LAMPORTS), 1);
    return [
      { programAddress: COMPUTE_BUDGET_PROGRAM, data: limit },
      { programAddress: COMPUTE_BUDGET_PROGRAM, data: price },
    ];
  }

  public static async tokenPrograms(
    mints: string[]
  ): Promise<Map<string, Address>> {
    const rpc = createSolanaRpc(Rpc.url);
    const unique = [...new Set(mints)];
    const { value } = await rpc
      .getMultipleAccounts(unique.map(address), {
        encoding: "base64",
        dataSlice: { offset: 0, length: 0 },
      })
      .send();
    return new Map(
      unique.map((mint, i) => {
        const account = value[i];
        if (!account) {
          throw new Error(`Mint ${mint} not found on chain.`);
        }
        return [mint, account.owner];
      })
    );
  }

  public static async createAta(
    owner: string,
    mint: string,
    tokenProgram: Address
  ): Promise<Instruction> {
    const [ata] = await findAssociatedTokenPda({
      owner: address(owner),
      mint: address(mint),
      tokenProgram,
    });
    return getCreateAssociatedTokenIdempotentInstruction({
      payer: createNoopSigner(address(owner)),
      ata,
      owner: address(owner),
      mint: address(mint),
      tokenProgram,
    });
  }

  public static async wrapSol(
    owner: string,
    lamports: bigint,
    tokenProgram: Address
  ): Promise<Instruction[]> {
    const [ata] = await findAssociatedTokenPda({
      owner: address(owner),
      mint: address(this.WSOL_MINT),
      tokenProgram,
    });
    return [
      getTransferSolInstruction({
        source: createNoopSigner(address(owner)),
        destination: ata,
        amount: lamports,
      }),
      getSyncNativeInstruction({ account: ata }),
    ];
  }

  public static async unwrapSol(
    owner: string,
    tokenProgram: Address
  ): Promise<Instruction> {
    const [ata] = await findAssociatedTokenPda({
      owner: address(owner),
      mint: address(this.WSOL_MINT),
      tokenProgram,
    });
    return getCloseAccountInstruction({
      account: ata,
      destination: address(owner),
      owner: createNoopSigner(address(owner)),
    });
  }

  public static async compile(
    payer: string,
    instructions: Instruction[],
    lookupTables: string[] = []
  ): Promise<string> {
    const rpc = createSolanaRpc(Rpc.url);
    const [{ value: blockhash }, tables] = await Promise.all([
      rpc.getLatestBlockhash().send(),
      lookupTables.length > 0
        ? fetchAddressesForLookupTables(lookupTables.map(address), rpc)
        : Promise.resolve({}),
    ]);
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayer(address(payer), m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
      (m) => appendTransactionMessageInstructions(instructions, m),
      (m) => compressTransactionMessageUsingAddressLookupTables(m, tables)
    );
    return getBase64EncodedWireTransaction(compileTransaction(message));
  }

  // Solana's packet size and per-transaction account lock limits.
  public static fits(transaction: string): boolean {
    const bytes = getBase64Encoder().encode(transaction);
    if (bytes.length > 1232) {
      return false;
    }
    const message = getCompiledTransactionMessageDecoder().decode(
      getTransactionDecoder().decode(bytes).messageBytes
    );
    const lookups =
      "addressTableLookups" in message
        ? (message.addressTableLookups ?? []).reduce(
            (n, l) => n + l.readonlyIndexes.length + l.writableIndexes.length,
            0
          )
        : 0;
    return message.staticAccounts.length + lookups <= 64;
  }

  public static async signAndSend(
    signer: Signer,
    transaction: string
  ): Promise<string> {
    const signed = await signer.signTransaction(
      transaction as Base64EncodedBytes
    );
    return Rpc.sendAndConfirm(signed);
  }
}
