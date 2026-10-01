import { Config } from "../lib/Config.ts";
import { ClientConfig } from "./ClientConfig.ts";

export type IntelDescription =
  | {
      status: "found";
      description: string;
      citations: string[];
      updatedAt: string;
    }
  | { status: "none" | "pending" }
  | {
      status: "copycat";
      verifiedOriginal: { mint: string; symbol: string; name: string };
    };

export type IntelNewsItem =
  | {
      type: "tweet";
      author: string;
      text: string;
      url: string;
      publishedAt: string;
    }
  | {
      type: "article";
      publisher: string;
      title: string;
      excerpt: string;
      url: string;
      publishedAt: string;
    };

export type IntelNewsSummary =
  | { status: "found"; summary: string; updatedAt: string }
  | { status: "none" | "pending" };

export class IntelClient {
  static readonly #ky = ClientConfig.ky.extend({
    prefixUrl: "https://api.jup.ag/intel",
  });

  public static hasApiKey(): boolean {
    return Boolean(Config.load().apiKey);
  }

  public static assertApiKey(): void {
    if (!this.hasApiKey()) {
      throw new Error(
        "Jupiter Intel (AI description and news) requires an API key. Get one at https://portal.jup.ag and run `jup config set --api-key <key>`."
      );
    }
  }

  public static async getDescription(mint: string): Promise<IntelDescription> {
    this.assertApiKey();
    return this.#ky.get(`token/${mint}/description`).json();
  }

  public static async getNewsSummary(mint: string): Promise<IntelNewsSummary> {
    this.assertApiKey();
    return this.#ky.get(`token/${mint}/news`).json();
  }

  public static async getNewsItems(
    mint: string,
    limit: number
  ): Promise<IntelNewsItem[]> {
    this.assertApiKey();
    const res = await this.#ky
      .get(`token/${mint}/news/items`, { searchParams: { limit } })
      .json<{ items?: IntelNewsItem[] }>();
    return res.items ?? [];
  }
}
