import { ClientConfig } from "./ClientConfig.ts";

const EXECUTE_TIMEOUT_MS = 90_000;

export type CraftInviteResponse = {
  inviteSignerAddress: string;
  mint: string;
  amount: string;
  tokenDecimals: number;
  tokenUsdRate: number | null;
  feeLamports: number;
  feeUsdAmount: number | null;
  transaction: string | null;
  requestId: string;
  expireAt: string | null;
  code: number;
  error: string | null;
  gasless: boolean;
};

export type CraftInviteTxResponse = {
  transaction: string | null;
  requestId: string;
  mint?: string;
  amount?: string;
  tokenDecimals?: number;
  feeLamports?: number;
  gasless?: boolean;
  error?: string | null;
};

export type ExecuteInviteResponse = {
  signature?: string | null;
  status: "pending" | "confirmed" | "failed" | "Success" | "Failed";
  code?: number;
  error?: string;
};

export type InviteInfo = {
  invite_signer: string;
  invite_pda: string;
  sender: string;
  receiver: string | null;
  expiry: string;
  amount: string;
  creation_tx: string;
  creation_time: string;
  deletion_tx: string | null;
  deletion_time: string | null;
  action: string | null;
  mint: string | null;
  confirmed: number | null;
};

export type InviteSummary = {
  inviteInfoAddress: string;
  mint: string;
  amount: string;
  tokenDecimals: number;
  tokenUsdRate?: number | null;
  expireAt: string;
  error?: string;
};

export type InviteListResponse = {
  invites: InviteInfo[];
  hasMoreData: boolean;
};

export class InviteClient {
  static readonly #ky = ClientConfig.ky.extend({
    prefixUrl: `${ClientConfig.host}/ultra/v1/invite`,
  });

  public static async craftInvite(req: {
    senderAddress: string;
    inviteSignerAddress: string;
    amount: string;
    mint: string;
  }): Promise<CraftInviteResponse> {
    return this.#ky
      .get("craft-invite", { searchParams: req, throwHttpErrors: false })
      .json();
  }

  public static async craftClaim(req: {
    receiverAddress: string;
    inviteSignerAddress: string;
  }): Promise<CraftInviteTxResponse> {
    return this.#ky
      .get("craft-claim", { searchParams: req, throwHttpErrors: false })
      .json();
  }

  public static async craftClawback(req: {
    senderAddress: string;
    inviteInfoAddress: string;
  }): Promise<CraftInviteTxResponse> {
    return this.#ky
      .get("craft-clawback", { searchParams: req, throwHttpErrors: false })
      .json();
  }

  public static async execute(req: {
    signedTransaction: string;
    requestId: string;
  }): Promise<ExecuteInviteResponse> {
    // The API co-signs, broadcasts and waits for confirmation before replying.
    return this.#ky
      .post("execute", { json: req, timeout: EXECUTE_TIMEOUT_MS })
      .json();
  }

  /** Returns null when the invite does not exist (the API answers 200 with an error). */
  public static async getInfo(
    inviteSignerAddress: string
  ): Promise<InviteSummary | null> {
    const res = await this.#ky
      .get("get-invite-info", { searchParams: { inviteSignerAddress } })
      .json<InviteSummary>();
    return res.error ? null : res;
  }

  public static async getPending(req: {
    address: string;
    page: number;
    pageSize: number;
  }): Promise<InviteListResponse> {
    return this.#ky.get("pending", { searchParams: req }).json();
  }

  public static async getHistory(req: {
    address: string;
    page: number;
    pageSize: number;
  }): Promise<InviteListResponse> {
    return this.#ky.get("history", { searchParams: req }).json();
  }
}
