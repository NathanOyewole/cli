import type { ApiInstruction } from "../lib/LendTx.ts";
import { ClientConfig } from "./ClientConfig.ts";

export const LEND_MARKETS = ["main", "ethena"] as const;
export type LendMarket = (typeof LEND_MARKETS)[number];

export type EarnAction = "deposit" | "withdraw" | "mint" | "redeem";

export type LendAsset = {
  address: string;
  chain_id: string;
  name: string;
  symbol: string;
  decimals: number;
  logo_url: string;
  price: string;
  coingecko_id: string;
};

export type LiquiditySupplyData = {
  modeWithInterest: boolean;
  supply: string;
  withdrawalLimit: string;
  lastUpdateTimestamp: string;
  expandPercent: string;
  expandDuration: string;
  baseWithdrawalLimit: string;
  withdrawableUntilLimit: string;
  withdrawable: string;
};

export type LendToken = {
  id: number;
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  assetAddress: string;
  asset: LendAsset;
  totalAssets: string;
  totalSupply: string;
  convertToShares: string;
  convertToAssets: string;
  rewardsRate: string;
  supplyRate: string;
  totalRate: string;
  rebalanceDifference: string;
  liquiditySupplyData: LiquiditySupplyData;
};

export type LendPosition = {
  token: LendToken;
  ownerAddress: string;
  shares: string;
  underlyingAssets: string;
  underlyingBalance: string;
  allowance: string;
};

export type LendEarning = {
  address: string;
  ownerAddress: string;
  earnings: number | string;
  slot: number;
};

export class LendClient {
  static readonly #ky = ClientConfig.ky.extend({
    prefixUrl: `${ClientConfig.host}/lend/v1`,
    // The POST builders only return instructions, so retrying them is safe.
    retry: { limit: 2, methods: ["get", "post"] },
  });

  public static async getTokens(market: LendMarket): Promise<LendToken[]> {
    return this.#ky.get("earn/tokens", { searchParams: { market } }).json();
  }

  public static async getPositions(
    users: string,
    market: LendMarket
  ): Promise<LendPosition[]> {
    return this.#ky
      .get("earn/positions", { searchParams: { users, market } })
      .json();
  }

  public static async getEarnings(req: {
    user: string;
    positions: string;
    market: LendMarket;
  }): Promise<LendEarning[]> {
    // The API splits `positions` on a literal comma, which searchParams would encode.
    return this.#ky
      .get(
        `earn/earnings?user=${req.user}&positions=${req.positions}&market=${req.market}`
      )
      .json();
  }

  public static async postEarnInstructions(
    action: EarnAction,
    req: {
      asset: string;
      signer: string;
      market: LendMarket;
    } & ({ amount: string } | { shares: string })
  ): Promise<{ instructions: ApiInstruction[] }> {
    return this.#ky.post(`earn/${action}-instructions`, { json: req }).json();
  }

  public static async postOperateInstructions(req: {
    signer: string;
    vaultId: number;
    positionId: number;
    colAmount: string;
    debtAmount: string;
    market: LendMarket;
  }): Promise<{
    nftId: number;
    instructions: ApiInstruction[];
    addressLookupTableAddresses: string[];
  }> {
    return this.#ky.post("borrow/operate-instructions", { json: req }).json();
  }
}
