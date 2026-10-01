import {
  AccountRole,
  address,
  getAddressEncoder,
  getProgramDerivedAddress,
  getU64Encoder,
  type Address,
  type Instruction,
} from "@solana/kit";
import { findAssociatedTokenPda } from "@solana-program/token";

import type { LendMarket } from "../clients/LendClient.ts";

// Program IDs and seeds from @jup-ag/lend (flashloan module), built with kit to
// avoid bundling the SDK's anchor + web3.js dependencies.
const PROGRAMS: Record<LendMarket, { flashloan: string; liquidity: string }> = {
  main: {
    flashloan: "jupgfSgfuAXv4B6R2Uxu85Z1qdzgju79s6MfZekN6XS",
    liquidity: "jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC",
  },
  ethena: {
    flashloan: "jupKxkab7RTnQJ6wXStXg6WY4rcReV3maiUNwByciFF",
    liquidity: "jup6QF1sNDGpkkcu6F4qaFHcRBmnSS1VgyB4uFbBvNS",
  },
};

const DISCRIMINATORS = {
  borrow: [103, 19, 78, 24, 240, 9, 135, 63],
  payback: [213, 47, 153, 137, 84, 243, 94, 232],
};

const ASSOCIATED_TOKEN_PROGRAM = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const SYSTEM_PROGRAM = "11111111111111111111111111111111";
const INSTRUCTIONS_SYSVAR = "Sysvar1nstructions1111111111111111111111111";

export class LendFlashloan {
  public static async borrowIx(p: FlashloanParams): Promise<Instruction> {
    return this.build("borrow", p);
  }

  public static async paybackIx(p: FlashloanParams): Promise<Instruction> {
    return this.build("payback", p);
  }

  private static async build(
    kind: keyof typeof DISCRIMINATORS,
    p: FlashloanParams
  ): Promise<Instruction> {
    const { flashloan, liquidity: liquidityProgram } = PROGRAMS[p.market];
    const enc = getAddressEncoder();
    const mint = address(p.mint);
    const pda = async (program: string, seeds: (string | Uint8Array)[]) =>
      (
        await getProgramDerivedAddress({
          programAddress: address(program),
          seeds,
        })
      )[0];

    const admin = await pda(flashloan, ["flashloan_admin"]);
    const mintSeed = new Uint8Array(enc.encode(mint));
    const liquidity = await pda(liquidityProgram, ["liquidity"]);
    const [signerAta] = await findAssociatedTokenPda({
      owner: address(p.signer),
      mint,
      tokenProgram: p.tokenProgram,
    });
    const [vault] = await findAssociatedTokenPda({
      owner: liquidity,
      mint,
      tokenProgram: p.tokenProgram,
    });

    const data = new Uint8Array(16);
    data.set(DISCRIMINATORS[kind]);
    data.set(getU64Encoder().encode(p.amount), 8);

    const w = AccountRole.WRITABLE;
    const r = AccountRole.READONLY;
    return {
      programAddress: address(flashloan),
      accounts: [
        { address: address(p.signer), role: AccountRole.WRITABLE_SIGNER },
        { address: admin, role: w },
        { address: signerAta, role: w },
        { address: mint, role: r },
        {
          address: await pda(liquidityProgram, ["reserve", mintSeed]),
          role: w,
        },
        {
          address: await pda(liquidityProgram, [
            "user_borrow_position",
            mintSeed,
            new Uint8Array(enc.encode(admin)),
          ]),
          role: w,
        },
        {
          address: await pda(liquidityProgram, ["rate_model", mintSeed]),
          role: r,
        },
        { address: vault, role: w },
        { address: liquidity, role: r },
        { address: address(liquidityProgram), role: r },
        { address: p.tokenProgram, role: r },
        { address: address(ASSOCIATED_TOKEN_PROGRAM), role: r },
        { address: address(SYSTEM_PROGRAM), role: r },
        { address: address(INSTRUCTIONS_SYSVAR), role: r },
      ],
      data,
    };
  }
}

type FlashloanParams = {
  signer: string;
  mint: string;
  amount: bigint;
  tokenProgram: Address;
  market: LendMarket;
};
