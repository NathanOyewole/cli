import {
  createKeyPairSignerFromPrivateKeyBytes,
  getAddressEncoder,
  getBase58Decoder,
  getBase58Encoder,
  getBase64EncodedWireTransaction,
  getProgramDerivedAddress,
  getTransactionDecoder,
  partiallySignTransactionWithSigners,
  type Address,
  type Base64EncodedWireTransaction,
  type KeyPairSigner,
} from "@solana/kit";
import { createHash } from "node:crypto";

const INVITE_PROGRAM_ID =
  "inv1tEtSwRMtM44tbvJGNiTxMvDfPVnX9StyqXfDfks" as Address;

/**
 * A gift (invite) code, compatible with jup.ag/gift links. The code is the
 * only secret: the invite signer keypair is derived from sha256("invite:" + code).
 */
export class InviteCode {
  public static readonly LENGTH = 20;

  private constructor(public readonly code: string) {}

  public static generate(): InviteCode {
    const secret = crypto.getRandomValues(new Uint8Array(64));
    return new InviteCode(
      getBase58Decoder().decode(secret).slice(0, this.LENGTH)
    );
  }

  public static parse(input: string): InviteCode {
    const code = input.trim().replace(/^.*#code=/, "");
    if (code.length < this.LENGTH) {
      throw new Error(
        `Invalid gift code: must be at least ${this.LENGTH} characters.`
      );
    }
    try {
      getBase58Encoder().encode(code);
    } catch {
      throw new Error("Invalid gift code: not a base58 string.");
    }
    return new InviteCode(code);
  }

  public get link(): string {
    return `https://jup.ag/gift#code=${this.code}`;
  }

  public seed(): Uint8Array {
    return new Uint8Array(
      createHash("sha256").update(`invite:${this.code}`).digest()
    );
  }

  public signer(): Promise<KeyPairSigner> {
    return createKeyPairSignerFromPrivateKeyBytes(this.seed());
  }

  public static async invitePda(inviteSigner: Address): Promise<Address> {
    const [pda] = await getProgramDerivedAddress({
      programAddress: INVITE_PROGRAM_ID,
      seeds: ["invite", getAddressEncoder().encode(inviteSigner)],
    });
    return pda;
  }

  public async sign(
    transaction: string
  ): Promise<Base64EncodedWireTransaction> {
    const tx = getTransactionDecoder().decode(
      new Uint8Array(Buffer.from(transaction, "base64"))
    );
    const signed = await partiallySignTransactionWithSigners(
      [await this.signer()],
      tx
    );
    return getBase64EncodedWireTransaction(signed);
  }
}
