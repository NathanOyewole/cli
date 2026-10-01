import { ClientConfig } from "./ClientConfig.ts";

export type MarketBrief = {
  generatedAt: string;
  overview: {
    macro: {
      summaryShort: string;
      summaryFull: string;
      sources?: string[] | undefined;
    };
  };
  sectors: {
    category: string;
    summaryShort: string;
    summaryFull: string;
    tokens: { mint: string; symbol: string }[];
  }[];
};

export class ContentClient {
  static readonly #ky = ClientConfig.ky.extend({
    prefixUrl: "https://content-api.jup.ag",
  });

  public static async getLatestBrief(): Promise<MarketBrief | null> {
    const res = await this.#ky
      .get("v1/briefs", { searchParams: { limit: 1 } })
      .json<{ data: { briefs: MarketBrief[] } }>();
    return res.data.briefs[0] ?? null;
  }
}
