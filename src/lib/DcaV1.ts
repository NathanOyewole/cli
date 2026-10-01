import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  findAssociatedTokenPda,
  getCloseAccountInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  AccountRole,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createSolanaRpc,
  createTransactionMessage,
  getAddressDecoder,
  getBase64Codec,
  getBase64EncodedWireTransaction,
  getProgramDerivedAddress,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Instruction,
} from "@solana/kit";
import { createHash } from "node:crypto";

import { Rpc } from "./Rpc.ts";

const DCA_PROGRAM = address("DCA265Vj8a9CEuX1eb1LWRnDT7uK6q1xMipnNyatn23M");
const SYSTEM_PROGRAM = address("11111111111111111111111111111111");
const NATIVE_MINT = address("So11111111111111111111111111111111111111112");
const CLOSE_DCA_DISCRIMINATOR = createHash("sha256")
  .update("global:close_dca")
  .digest()
  .subarray(0, 8);

// Mirrors @jup-ag/dca-sdk closeDCA: the program returns the remaining input and
// received output to the user's ATAs, then wrapped SOL ATAs are closed.
export class DcaV1 {
  public static async buildCloseTransaction(
    user: Address,
    dca: Address
  ): Promise<string> {
    const rpc = createSolanaRpc(Rpc.url);
    const { value: account } = await rpc
      .getAccountInfo(dca, { encoding: "base64" })
      .send();
    if (!account || account.owner !== DCA_PROGRAM) {
      throw new Error(`${dca} is not an open V1 recurring order.`);
    }
    const data = getBase64Codec().encode(account.data[0]);
    const decoder = getAddressDecoder();
    const owner = decoder.decode(data, 8);
    const inputMint = decoder.decode(data, 40);
    const outputMint = decoder.decode(data, 72);
    if (owner !== user) {
      throw new Error(`V1 recurring order ${dca} belongs to ${owner}.`);
    }

    const { value: mints } = await rpc
      .getMultipleAccounts([inputMint, outputMint], { encoding: "base64" })
      .send();
    if (mints.some((m) => m?.owner !== TOKEN_PROGRAM_ADDRESS)) {
      throw new Error(
        "Closing V1 recurring orders for Token-2022 mints is not supported. Close it at https://jup.ag/recurring instead."
      );
    }

    const ata = async (wallet: Address, mint: Address) =>
      (
        await findAssociatedTokenPda({
          owner: wallet,
          mint,
          tokenProgram: TOKEN_PROGRAM_ADDRESS,
        })
      )[0];
    const [inAta, outAta, userInAta, userOutAta, [eventAuthority]] =
      await Promise.all([
        ata(dca, inputMint),
        ata(dca, outputMint),
        ata(user, inputMint),
        ata(user, outputMint),
        getProgramDerivedAddress({
          programAddress: DCA_PROGRAM,
          seeds: ["__event_authority"],
        }),
      ]);

    const closeDca: Instruction = {
      programAddress: DCA_PROGRAM,
      accounts: [
        { address: user, role: AccountRole.WRITABLE_SIGNER },
        { address: dca, role: AccountRole.WRITABLE },
        { address: inputMint, role: AccountRole.READONLY },
        { address: outputMint, role: AccountRole.READONLY },
        { address: inAta, role: AccountRole.WRITABLE },
        { address: outAta, role: AccountRole.WRITABLE },
        { address: userInAta, role: AccountRole.WRITABLE },
        { address: userOutAta, role: AccountRole.WRITABLE },
        { address: SYSTEM_PROGRAM, role: AccountRole.READONLY },
        { address: TOKEN_PROGRAM_ADDRESS, role: AccountRole.READONLY },
        {
          address: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
          role: AccountRole.READONLY,
        },
        { address: eventAuthority, role: AccountRole.READONLY },
        { address: DCA_PROGRAM, role: AccountRole.READONLY },
      ],
      data: new Uint8Array(CLOSE_DCA_DISCRIMINATOR),
    };
    const unwrap = [
      ...(inputMint === NATIVE_MINT ? [userInAta] : []),
      ...(outputMint === NATIVE_MINT ? [userOutAta] : []),
    ].map((account) =>
      getCloseAccountInstruction({ account, destination: user, owner: user })
    );

    const { value: blockhash } = await rpc.getLatestBlockhash().send();
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayer(user, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
      (m) => appendTransactionMessageInstructions([closeDca, ...unwrap], m)
    );
    return getBase64EncodedWireTransaction(compileTransaction(message));
  }
}
