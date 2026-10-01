import { ClientConfig } from "./ClientConfig.ts";

export type StakeAccountStatus =
  | "Active"
  | "Activating"
  | "Deactivating"
  | "Inactive";

export type StakeAccount = {
  address: string;
  lamports: string;
  status: StakeAccountStatus;
  activeLamports: string;
  inactiveLamports: string;
  delegatedLamports: string;
  voter: string | null;
  activationEpoch: string | null;
  deactivationEpoch: string | null;
  rentExemptReserve: string;
  isJupiterValidator: boolean;
  validator: { name: string | null; image: string | null };
  capabilities: {
    canDeactivate: boolean;
    canReactivate: boolean;
    canWithdraw: boolean;
    canSplit: boolean;
    maxSplitLamports: string | null;
    canDepositToPool: boolean;
    mergeableWith: string[];
  };
};

export type StakeAccountsResponse = {
  epoch: string;
  minimumDelegation: string;
  stakeRentExemptLamports: string;
  accounts: StakeAccount[];
};

export type StakePool = {
  address: string;
  totalLamports: string;
  poolTokenSupply: string;
  stakeWithdrawalFee: { numerator: string; denominator: string };
  instantUnstakeCapacityLamports: string;
  minimumDelegation: string;
};

export type StakeValidator = {
  voteAccount: string;
  activatedStakeLamports: string;
  commission: number;
  delinquent?: boolean;
  apy: number | null;
};

export type StakeRewardsPage = {
  rewards: {
    epoch: string;
    amountLamports: string;
    effectiveSlot: string;
    date: string | null;
  }[];
  nextBeforeEpoch: string | null;
};

export type StakeCraftResponse = {
  requestId: string;
  transaction: string;
  lastValidBlockHeight: string;
  kind: string;
  meta: Record<string, string>;
};

export type StakeExecuteResponse = {
  status: "Success" | "Failed";
  signature?: string;
  code: number;
  error?: string;
};

export type LiquidFee = { code: string; amount: string; mint: string };

export type LiquidOrder = {
  inp: string;
  out: string;
  inpAmt: string;
  outAmt: string;
  swapSrcData: { swapSrc: string; data: { fees: LiquidFee[] } };
  tx: string;
};

export type DelayedUnstakeOrder = Omit<LiquidOrder, "outAmt"> & {
  outAmt: { amtStaked: string; amtUnstaked: string };
};

export type LiquidExecuteResponse = { signature: string; status: string };

export class StakeClient {
  // The stake API is only served on api.jup.ag (lite-api returns 404), with or
  // without an API key.
  static readonly #ky = ClientConfig.ky.extend({
    prefixUrl: "https://api.jup.ag/stake/v1",
    timeout: 100_000,
  });

  public static async getAccounts(
    walletAddress: string
  ): Promise<StakeAccountsResponse> {
    return this.#ky.get("accounts", { searchParams: { walletAddress } }).json();
  }

  public static async getPool(): Promise<StakePool> {
    return this.#ky.get("pool").json();
  }

  public static async getValidator(): Promise<StakeValidator> {
    return this.#ky.get("validator").json();
  }

  public static async getRewards(params: {
    stakeAccount: string;
    limit: number;
    beforeEpoch?: string | undefined;
  }): Promise<StakeRewardsPage> {
    const searchParams: Record<string, string | number> = {
      stakeAccount: params.stakeAccount,
      limit: params.limit,
    };
    if (params.beforeEpoch) {
      searchParams.beforeEpoch = params.beforeEpoch;
    }
    return this.#ky.get("rewards", { searchParams }).json();
  }

  public static async craft(
    endpoint:
      | "craft-stake"
      | "craft-deactivate"
      | "craft-reactivate"
      | "craft-withdraw"
      | "craft-split"
      | "craft-merge-many"
      | "craft-deposit-pool"
      | "craft-withdraw-pool",
    params: Record<string, string>
  ): Promise<StakeCraftResponse> {
    return this.#ky.get(endpoint, { searchParams: params }).json();
  }

  public static async execute(req: {
    signedTransaction: string;
    requestId: string;
    lastValidBlockHeight: string;
  }): Promise<StakeExecuteResponse> {
    return this.#ky
      .post("execute", { json: req, throwHttpErrors: false })
      .json();
  }

  public static async getLiquidOrder(params: {
    taker: string;
    amount: string;
    inputToken: string;
    outputToken: string;
  }): Promise<LiquidOrder> {
    return this.#ky.get("liquid/order", { searchParams: params }).json();
  }

  public static async executeLiquid(req: {
    signedTx: string;
    orderResponse: LiquidOrder;
  }): Promise<LiquidExecuteResponse> {
    return this.#ky.post("liquid/execute", { json: req }).json();
  }

  public static async getDelayedUnstakeOrder(params: {
    taker: string;
    amount: string;
    inputToken: string;
    outputValidator?: string | undefined;
  }): Promise<DelayedUnstakeOrder> {
    const searchParams: Record<string, string> = {
      taker: params.taker,
      amount: params.amount,
      inputToken: params.inputToken,
    };
    if (params.outputValidator) {
      searchParams.outputValidator = params.outputValidator;
    }
    return this.#ky.get("delayed-unstake/order", { searchParams }).json();
  }

  public static async executeDelayedUnstake(req: {
    signedTx: string;
  }): Promise<LiquidExecuteResponse> {
    return this.#ky.post("delayed-unstake/execute", { json: req }).json();
  }
}
