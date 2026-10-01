import { ClientConfig } from "./ClientConfig.ts";

export type ArcadeAsset = "BTC" | "SOL";

export type ArcadeConfig = {
  assets: ArcadeAsset[];
  roundDurationSeconds: number;
  betCutoffSeconds: number;
  feeBps: number;
  paused: boolean;
  limits: {
    minimum: string;
    maximumPerEntry: string;
    maximumPerWallet: string;
    maximumPool: string;
  };
};

export type ArcadeRound = {
  id: string;
  address: string;
  asset: ArcadeAsset;
  openTs: number;
  closeTs: number;
  status?: string;
  outcome: "UNRESOLVED" | "UP" | "DOWN" | "VOID" | null;
  upPool: string;
  downPool: string;
  openPrice: string | null;
  closePrice: string | null;
};

export type ArcadePosition = {
  address: string;
  roundAddress: string;
  owner: string;
  upAmount: string;
  downAmount: string;
  upPayout: string;
  downPayout: string;
} | null;

export type ArcadeHistoryEntry = {
  roundAddress: string;
  asset: ArcadeAsset;
  openTs: number;
  outcome: string | null;
  upAmount: string;
  downAmount: string;
  upPayout: string;
  downPayout: string;
  realizedPnlUsd?: string;
};

export type ArcadeStats = {
  walletAddress: string;
  totalRounds: number;
  realizedPnlUsd: string;
  wins: number;
  losses: number;
  voided: number;
};

export type ArcadeBetRequest = {
  asset: ArcadeAsset;
  side: "UP" | "DOWN";
  amount: string;
  openTs: number;
  transaction: string;
};

export class PredictionsArcadeClient {
  static readonly #ky = ClientConfig.ky.extend({
    prefixUrl: `${ClientConfig.host}/prediction/v1/play`,
  });

  public static async getConfig(): Promise<ArcadeConfig> {
    return this.#ky.get("config").json();
  }

  public static async getRounds(
    asset: ArcadeAsset
  ): Promise<{ serverTime: number; data: ArcadeRound[] }> {
    return this.#ky.get("rounds", { searchParams: { asset } }).json();
  }

  public static async getPosition(
    asset: ArcadeAsset,
    openTs: number,
    wallet: string
  ): Promise<ArcadePosition> {
    return this.#ky.get(`rounds/${asset}/${openTs}/positions/${wallet}`).json();
  }

  public static async getHistory(
    wallet: string,
    start: number,
    end: number
  ): Promise<{
    data: ArcadeHistoryEntry[];
    pagination: { end: number; total: number; hasNext: boolean };
  }> {
    return this.#ky
      .get(`history/${wallet}`, { searchParams: { start, end } })
      .json();
  }

  public static async getStats(wallet: string): Promise<ArcadeStats> {
    return this.#ky.get(`stats/${wallet}`).json();
  }

  public static async prepareBet(req: {
    asset: ArcadeAsset;
    walletAddress: string;
    side: "UP" | "DOWN";
    amount: string;
  }): Promise<ArcadeBetRequest> {
    return this.#ky.post("bets/prepare", { json: req }).json();
  }
}
