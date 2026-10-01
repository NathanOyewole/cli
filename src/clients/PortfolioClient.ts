import { HTTPError } from "ky";

import { Config } from "../lib/Config.ts";
import type {
  RawPortfolioElement,
  TokenInfoMap,
} from "../lib/PortfolioPositions.ts";
import { ClientConfig } from "./ClientConfig.ts";

export type PositionsResult = {
  coverage: "all-platforms" | "jupiter-platforms";
  elements: RawPortfolioElement[];
  tokenInfo: TokenInfoMap;
  failedFetchers: string[];
};

type V1PositionsResponse = {
  elements: RawPortfolioElement[];
  fetcherReports: { id: string; status: string }[];
  tokenInfo?: { solana?: TokenInfoMap };
};

type V2PositionsResponse = {
  fetcherResults: {
    id: string;
    status: string;
    elements?: RawPortfolioElement[];
  }[];
};

export type StakedJupResponse = {
  stakedAmount: number;
  unstaking: { amount: number; until: number }[];
};

export type AirdropItem = {
  isEligible: boolean;
  isClaimed: boolean;
  address: string;
  amount: number;
  label: string;
  price: number | null;
  value: number | null;
  status: string;
};

export type Airdrop = {
  id: string;
  name?: string | null;
  emitterName: string;
  claimLink: string | null;
  claimStart: number | null;
  claimEnd: number | null;
  status: string;
  owner: string;
  value: number | null;
  items: AirdropItem[];
};

export type AirdropCheckerResult = {
  owner: string;
  airdrops: Airdrop[];
};

export type PnlStats = {
  totalPnl: number;
  totalRealisedPnl: number;
  totalUnrealisedPnl: number;
  totalPercentage: number;
  winRate: number;
  totalBuys: number;
  totalSells: number;
  totalBoughtVolume: number;
  totalSoldVolume: number;
  netWorth?: number;
};

export type PnlStatsResponse = Record<
  string,
  { stats: Record<string, PnlStats> }
>;

export type PnlPosition = {
  assetId: string;
  balance: number;
  balanceValue: number;
  averageCost: number;
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  totalPnlPercentage: number;
  lastActiveTime: string;
};

export type PnlPositionsResponse = Record<
  string,
  { tokenPositions: PnlPosition[] }
>;

export class PortfolioClient {
  // The Portfolio API lives only on api.jup.ag. v1 (Jupiter platforms) is
  // public; v2 (all platforms) needs a key with Portfolio v2 access.
  static readonly #ky = ClientConfig.ky.extend({
    prefixUrl: "https://api.jup.ag/portfolio",
    timeout: 120_000,
  });
  static readonly #datapi = ClientConfig.ky.extend({
    prefixUrl: "https://datapi.jup.ag/v1",
  });

  public static async getPositions(address: string): Promise<PositionsResult> {
    if (Config.load().apiKey) {
      try {
        return await this.getPositionsV2(address);
      } catch (err) {
        if (!this.isAccessDenied(err)) {
          throw err;
        }
      }
    }
    const res = await this.withBackoff(() =>
      this.#ky.get(`v1/positions/${address}`).json<V1PositionsResponse>()
    );
    return {
      coverage: "jupiter-platforms",
      elements: res.elements,
      tokenInfo: res.tokenInfo?.solana ?? {},
      failedFetchers: res.fetcherReports
        .filter((r) => r.status !== "succeeded" && r.status !== "success")
        .map((r) => r.id),
    };
  }

  private static async getPositionsV2(
    address: string
  ): Promise<PositionsResult> {
    const res = await this.#ky
      .get(`v2/positions/${address}`, { searchParams: { unpriced: false } })
      .json<V2PositionsResponse>();
    return {
      coverage: "all-platforms",
      elements: res.fetcherResults.flatMap((r) => r.elements ?? []),
      tokenInfo: {},
      failedFetchers: res.fetcherResults
        .filter((r) => r.status !== "success")
        .map((r) => r.id),
    };
  }

  public static async getStakedJup(
    address: string
  ): Promise<StakedJupResponse> {
    return this.withBackoff(() =>
      this.#ky.get(`v1/staked-jup/${address}`).json<StakedJupResponse>()
    );
  }

  public static async getAirdrops(
    addresses: string[]
  ): Promise<AirdropCheckerResult[]> {
    try {
      return await this.#ky
        .post("v2/airdrop-checker/fetch", {
          json: { addresses, addressSystem: "solana" },
        })
        .json();
    } catch (err) {
      if (this.isAccessDenied(err)) {
        throw new Error(
          "The airdrop checker needs a Jupiter API key with Portfolio v2 access. Set one with `jup config set --api-key <key>`."
        );
      }
      throw err;
    }
  }

  public static async getPnlStats(address: string): Promise<PnlStatsResponse> {
    return this.#datapi.get("pnl-stats", { searchParams: { address } }).json();
  }

  public static async getPnlPositions(
    address: string
  ): Promise<PnlPositionsResponse> {
    return this.#datapi
      .get("pnl-positions", {
        searchParams: { address, filter: "activePosition" },
      })
      .json();
  }

  // Keyless api.jup.ag allows only a few requests per window, and a wallet
  // group needs more, so wait the window out instead of failing.
  private static async withBackoff<T>(request: () => Promise<T>): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await request();
      } catch (err) {
        const rateLimited =
          err instanceof Error && /rate limited/i.test(err.message);
        if (!rateLimited || attempt >= 4) {
          throw err;
        }
        await new Promise((resolve) => setTimeout(resolve, 3000 * attempt));
      }
    }
  }

  private static isAccessDenied(err: unknown): boolean {
    return (
      err instanceof HTTPError &&
      (err.response.status === 401 || err.response.status === 403)
    );
  }
}
