import { ClientConfig } from "./ClientConfig.ts";
import type { TxMetadata } from "./PerpsClient.ts";

export type JlpCustody = {
  pubkey: string;
  symbol: string;
  name: string;
  mint: string;
  aumUsd: string;
  aumTokenAmount: string;
  aumTokenAmountFormatted: string;
  currentWeightagePct: string;
  targetWeightagePct: string;
  utilizationPct: string;
};

export type JlpInfoResponse = {
  aumUsd: string;
  aumLimitUsd: string;
  jlpPriceUsd: string;
  jlpTotalSupply: string;
  jlpAprPct: string;
  jlpApyPct: string;
  jlpAprLastUpdatedTimestamp: string;
  custodies: JlpCustody[];
};

export type JlpMintResponse = {
  mintFeeBps: string;
  mintFeePercent: string;
  mintTokenAmount: string;
  serializedTxBase64: string | null;
  txMetadata: TxMetadata;
};

export type JlpBurnResponse = {
  burnFeeBps: string;
  burnFeePercent: string;
  burnFeeTokenAmount: string;
  receiveToken: string;
  receiveTokenAmount: string;
  receiveTokenMint: string;
  serializedTxBase64: string | null;
  txMetadata: TxMetadata;
};

export type LoanInfoResponse = {
  currentJlpPriceUsd: string;
  borrowTokenMint: string;
  availableLiquidityUsd: string;
  totalSupplyUsd: string;
  utilizationRatePercentage: string;
  borrowApr: string;
  liquidationMarginPercentage: string;
  liquidationPenaltyPercentage: string;
  maxLtvPercentage: string;
};

export type LoanPosition = {
  positionPubkey: string;
  collateralTokenAmount: string;
  collateralUsd: string;
  borrowSizeTokenAmount: string;
  borrowSizeUsd: string;
  maxBorrowTokenAmount: string;
  maxRepayTokenAmount: string;
  maxWithdrawTokenAmount: string;
  ltvPercentage: string;
  liquidationPriceUsd: string;
};

export type LoanPositionsResponse = {
  count: number;
  dataList: LoanPosition[];
};

export type LoanHistoryResponse = {
  count: number;
  dataList: {
    txHash: string;
    transactionType:
      | "DepositCollateral"
      | "WithdrawCollateral"
      | "Borrow"
      | "Repay"
      | "Liquidation";
    walletAddress: string;
    borrowPositionPubkey: string;
    createdTime: number;
    tokenAmount: string;
    tokenMint: string;
  }[];
};

export type LoanChangeResponse = {
  positionPubkey: string;
  collateralTokenAmount: string;
  borrowSizeTokenAmount: string;
  ltvPercentage: string;
  liquidationPriceUsd: string;
  // Repay-withdraw only: the most JLP withdrawable once this repay applies.
  maxWithdrawTokenAmountBeforeWithdraw?: string;
  serializedTxBase64: string | null;
  txMetadata: TxMetadata | null;
};

export class JlpClient {
  static readonly #ky = ClientConfig.ky.extend({
    prefixUrl: "https://perps-api.jup.ag/v2",
  });

  public static async getInfo(): Promise<JlpInfoResponse> {
    return this.#ky.get("jlp-info").json();
  }

  public static async postMint(req: {
    walletAddress: string;
    depositToken: string;
    depositTokenAmount: string;
  }): Promise<JlpMintResponse> {
    return this.#ky.post("jlp/mint", { json: req }).json();
  }

  public static async postBurn(req: {
    walletAddress: string;
    burnTokenAmount: string;
    receiveToken: string;
  }): Promise<JlpBurnResponse> {
    return this.#ky.post("jlp/burn", { json: req }).json();
  }

  public static async getLoanInfo(): Promise<LoanInfoResponse> {
    return this.#ky.get("loans/info").json();
  }

  public static async getLoanPositions(
    walletAddress: string
  ): Promise<LoanPositionsResponse> {
    return this.#ky
      .get("loans/positions", { searchParams: { walletAddress } })
      .json();
  }

  public static async getLoanHistory(params: {
    walletAddress: string;
    start: number;
    end: number;
  }): Promise<LoanHistoryResponse> {
    return this.#ky.get("loans/history", { searchParams: params }).json();
  }

  public static async postDepositBorrow(req: {
    walletAddress: string;
    depositTokenAmount: string;
    borrowTokenAmount: string;
  }): Promise<LoanChangeResponse> {
    return this.#ky.post("loans/deposit-borrow", { json: req }).json();
  }

  public static async postRepayWithdraw(req: {
    walletAddress: string;
    repayTokenAmount: string;
    withdrawTokenAmount: string;
  }): Promise<LoanChangeResponse> {
    return this.#ky.post("loans/repay-withdraw", { json: req }).json();
  }
}
