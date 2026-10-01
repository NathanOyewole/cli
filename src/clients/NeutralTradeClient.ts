import { ClientConfig } from "./ClientConfig.ts";

export type VaultConfig = {
  vaultId: number;
  name: string;
  vaultAddress: string;
  depositToken: string;
  tvlCap: number;
  minWithdrawAmount: number;
  depositLock: number;
  redeemLock: number;
  processTime: [number, number];
  enabled: boolean;
};

export type VaultMetrics = {
  apr: number;
  apy: number;
  aprAfterFees: number;
  apyAfterFees: number;
  sharpeRatio: number | null;
  currentTVLUSD: number;
  maxDrawdown: number | null;
  roi: number | null;
  roiSince: string | null;
  sharePrice: number;
  allocations: { name: string; ratio: number; tvl: number }[];
};

export type VaultSnapshot = {
  date: string;
  tvl: number | null;
  pps: number;
  shares: number;
};

// Jupiter's proxy of the Neutral Trade vault API, as used by the web app.
export class NeutralTradeClient {
  static readonly #ky = ClientConfig.ky.extend({
    prefixUrl: "https://perps-api.jup.ag/v1/neutral-trade",
  });

  public static async getConfig(vaultId: number): Promise<VaultConfig> {
    const res: { data: VaultConfig } = await this.#ky
      .get(`vault/${vaultId}/config`)
      .json();
    return res.data;
  }

  public static async getMetrics(vaultId: number): Promise<VaultMetrics> {
    const res: { data: VaultMetrics } = await this.#ky
      .get(`vault/${vaultId}/metrics`)
      .json();
    return res.data;
  }

  public static async getSnapshots(
    vaultId: number,
    startDate?: string
  ): Promise<VaultSnapshot[]> {
    const res: { data: { snapshots: VaultSnapshot[] } } = await this.#ky
      .get(`vault/${vaultId}/snapshots`, {
        searchParams: startDate ? { startDate } : {},
      })
      .json();
    return res.data.snapshots;
  }
}
