import { isAddress } from "@solana/kit";

import { ClientConfig } from "./ClientConfig.ts";

export type SwapStats = {
  priceChange?: number | undefined;
  holderChange?: number | undefined;
  liquidityChange?: number | undefined;
  volumeChange?: number | undefined;
  buyVolume?: number | undefined;
  sellVolume?: number | undefined;
  buyOrganicVolume?: number | undefined;
  sellOrganicVolume?: number | undefined;
  numBuys?: number | undefined;
  numSells?: number | undefined;
  numTraders?: number | undefined;
  numOrganicBuyers?: number | undefined;
  numNetBuyers?: number | undefined;
};

export type Token = {
  id: string;
  name: string;
  symbol: string;
  icon?: string | undefined;
  decimals: number;
  twitter?: string | undefined;
  telegram?: string | undefined;
  website?: string | undefined;
  dev?: string | undefined;
  circSupply?: number | undefined;
  totalSupply?: number | undefined;
  tokenProgram: string;
  launchpad?: string | undefined;
  graduatedPool?: string | undefined;
  holderCount?: number | undefined;
  fdv?: number | undefined;
  mcap?: number | undefined;
  usdPrice?: number | undefined;
  liquidity?: number | undefined;
  stats5m?: SwapStats | undefined;
  stats1h?: SwapStats | undefined;
  stats6h?: SwapStats | undefined;
  stats24h?: SwapStats | undefined;
  firstPool?:
    | {
        id: string;
        createdAt: string;
      }
    | undefined;
  audit?:
    | {
        mintAuthorityDisabled: boolean | undefined;
        freezeAuthorityDisabled: boolean | undefined;
        topHoldersPercentage: number | undefined;
        lpBurnedPercentage: number | undefined;
        knownRugger: boolean | undefined;
        knownRuggerTopHolder: boolean | undefined;
        soulBound: boolean | undefined;
        permanentControlEnabled: boolean | undefined;
        highSingleOwnership: boolean | undefined;
        mutableFees: boolean | undefined;
      }
    | undefined;
  scaledUiConfig?:
    | {
        multiplier: number;
        newMultiplier: number;
        newMultiplierEffectiveAt: string;
        circSupplyPrescaled: number;
        totalSupplyPrescaled: number;
        usdPricePrescaled: number;
      }
    | undefined;
  organicScore: number;
  organicScoreLabel: "high" | "medium" | "low";
  ctLikes?: number | undefined;
  smartCtLikes?: number | undefined;
  isVerified?: boolean | undefined;
  cexes?: string[] | undefined;
  tags?: string[] | undefined;
  stockData?: { id: string } | undefined;
  apy?:
    | {
        jupEarn?: number | undefined;
      }
    | undefined;
};

type GetSearchTokensRequest = {
  query: string;
  filters?: string | undefined;
  limit?: string | undefined;
  sortBy?: string | undefined;
};

type GetSearchTokensResponse = Token[];

export type SpotTrade = {
  type: "buy" | "sell";
  usdVolume: number;
  profit: number;
  cost: number;
  txHash: string;
  assetId: string;
  blockTime: string;
  amount: number;
  price: number;
};

type GetSpotHistoryResponse = {
  userTrades: SpotTrade[];
  next: string | null;
};

export type DatapiAsset = Omit<Token, "audit" | "firstPool"> & {
  discord?: string | undefined;
  createdAt?: string | undefined;
  graduatedAt?: string | undefined;
  bondingCurve?: number | undefined;
  fees?: number | undefined;
  primaryTwitter?: { handle: string } | undefined;
  stats7d?: SwapStats | undefined;
  stats30d?: SwapStats | undefined;
  firstPool?:
    | { id: string; dex?: string | undefined; createdAt: string }
    | undefined;
  audit?:
    | {
        mintAuthorityDisabled?: boolean | undefined;
        freezeAuthorityDisabled?: boolean | undefined;
        topHoldersPercentage?: number | undefined;
        lpBurnedPercentage?: number | undefined;
        devBalancePercentage?: number | undefined;
        devMigrations?: number | undefined;
        sniperPct?: number | undefined;
        insiderPct?: number | undefined;
        botHoldersPercentage?: number | undefined;
        botHoldersCount?: number | undefined;
        iconReused?: boolean | undefined;
        impersonationAssetId?: string | undefined;
        bundlerStats?: { holdingPct?: number | undefined } | undefined;
      }
    | undefined;
};

export type SearchParams = Record<string, string | number | boolean>;

type TokenListResponse = {
  assets: DatapiAsset[];
  total?: number | undefined;
  next?: number | undefined;
};

export type GemsTab = "recent" | "aboutToGraduate" | "graduated";

type GemsResponse = Partial<Record<GemsTab, { assets: DatapiAsset[] }>>;

export type TopMover = {
  id: string;
  name: string;
  symbol: string;
  priceChange24h?: number | undefined;
};

export type HeatmapCategory = {
  category: string;
  description: string;
  mcap: number;
  dominancePct: number;
  mcapChange24h?: number | undefined;
  topMovers: TopMover[];
  assets: {
    id: string;
    symbol: string;
    volume: number;
    priceChange24h?: number | undefined;
  }[];
};

export type CategoryStats = {
  category: string;
  description: string;
  mcap: number;
  mcapChange1h?: number | undefined;
  mcapChange24h?: number | undefined;
  mcapChange7d?: number | undefined;
  volume24h?: number | undefined;
  netVolume24h?: number | undefined;
  topMovers: TopMover[];
};

export type LaunchpadPeriodStats = {
  newMarketShare: number;
  newVolume: number;
  newTraders: number;
  volume: number;
  traders: number;
  marketShare: number;
  runners: number;
  mints: number;
  graduates: number;
};

export type LaunchpadStats = {
  launchpad: string;
  stats1d: LaunchpadPeriodStats;
  stats7d: LaunchpadPeriodStats;
  stats30d: LaunchpadPeriodStats;
};

export type SmartMoneyWallet = {
  rank: number;
  walletId: string;
  pnlUsd: number;
  winRate: number;
  volumeUsd: number;
  txnCount: number;
  lastActiveAt: string;
  twitterUsername?: string | undefined;
};

export type SmartMoneyTrader = {
  walletId: string;
  twitterUsername?: string | undefined;
  categories: string[];
  volumeUsd: number;
  latestType: "buy" | "sell";
  latestAt: string;
  pnl7d: number;
  volume7d: number;
  winRate7d: number;
};

export type SmartMoneyCard = {
  assetId: string;
  latestType: "buy" | "sell";
  majorityType: "buy" | "sell";
  latestAt: string;
  distinctTraders: number;
  volumeUsd: number;
  pctSold: number;
  traders: SmartMoneyTrader[];
};

export type SmartMoneySummaryCard = {
  assetId: string;
  symbol?: string | undefined;
  traderCount: number;
  volumeUsd: number;
  latestAt: string;
  traders: SmartMoneyTrader[];
};

export type ShieldWarning = {
  type: string;
  message: string;
  severity: "info" | "warning" | "critical";
  source?: string | undefined;
};

export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type TokenTx = {
  timestamp: string;
  type: "buy" | "sell";
  usdPrice: number;
  usdVolume: number;
  nativeVolume: number;
  amount: number;
  traderAddress: string;
  txHash: string;
  poolId: string;
  isMev: boolean;
  holderTags?: string[] | undefined;
};

export type Holder = {
  address: string;
  amount: number;
  solBalanceDisplay: number;
  lastActiveTime?: string | undefined;
  tags?: { id: string; name: string }[] | undefined;
  holderTags?: string[] | undefined;
  addressInfo?: { fundingAddress?: string | undefined } | undefined;
};

export type HolderPnl = {
  realizedPnl: number;
  unrealizedPnl: number;
  totalPnl: number;
  totalPnlPercentage: number;
  totalBuys: number;
  totalSells: number;
  boughtAmount: number;
  boughtValue: number;
  soldAmount: number;
  soldValue: number;
};

type HoldersResponse = {
  holders: Holder[];
  holderPnl: Record<string, HolderPnl>;
  count?: number | undefined;
};

export type DevStats = {
  numCreatedInPast7Days: number;
  numCreated: number;
  numMigrated: number;
  lastTokenLaunchedDate?: string | undefined;
  topTokens: DatapiAsset[];
  solBalance: number;
};

export type Pool = {
  id: string;
  dex: string;
  type: string;
  quoteAsset: string;
  createdAt: string;
  liquidity?: number | undefined;
  volume24h?: number | undefined;
  baseAsset: { id: string; symbol: string };
};

export type StockRwa = {
  symbol: string;
  slug: string;
  name: string;
  type: string;
  sector?: string | undefined;
  exchange?: string | undefined;
  icon?: string | undefined;
  price?: number | undefined;
  priceChange24h?: number | undefined;
  mcap?: number | undefined;
  volumeUsd?: number | undefined;
  marketSession?: { state: string } | undefined;
  variants?: { mint: string; issuer: string }[] | undefined;
};

export type UserTrade = {
  type: "buy" | "sell";
  assetId: string;
  usdVolume: number;
  nativeVolume: number;
  amount: number;
  price: number;
  profit: number;
  blockTime: string;
  signerId: string;
  txHash: string;
};

export type AddressSummary = Record<
  string,
  { solBalance: number; lastActive?: string | undefined }
>;

export class DatapiClient {
  static readonly #ky = ClientConfig.ky.extend({
    prefixUrl: ClientConfig.host,
    throwHttpErrors: false,
  });
  static readonly #datapi = ClientConfig.ky.extend({
    prefixUrl: "https://datapi.jup.ag",
  });

  public static async getTokensSearch(
    req: GetSearchTokensRequest
  ): Promise<GetSearchTokensResponse> {
    return this.#ky.get("tokens/v2/search", { searchParams: req }).json();
  }

  public static async getSwapsByAddress(params: {
    address: string;
    assetId?: string;
    after?: string;
    before?: string;
    limit?: number;
    offset?: string;
  }): Promise<GetSpotHistoryResponse> {
    const searchParams: Record<string, string | number> = {
      addresses: params.address,
      includeCapitalSide: "true",
    };
    if (params.assetId) {
      searchParams.assetId = params.assetId;
    }
    if (params.after) {
      searchParams.fromTs = params.after;
    }
    if (params.before) {
      searchParams.toTs = params.before;
    }
    if (params.limit) {
      searchParams.limit = Math.min(params.limit, 30);
    }
    if (params.offset) {
      searchParams.offset = params.offset;
    }
    return this.#datapi.get("v1/txs/users", { searchParams }).json();
  }

  public static async getTokensByMints(mints: string[]): Promise<Token[]> {
    if (mints.length === 0) {
      return [];
    }
    const BATCH_SIZE = 100;
    const batches: string[][] = [];
    for (let i = 0; i < mints.length; i += BATCH_SIZE) {
      batches.push(mints.slice(i, i + BATCH_SIZE));
    }
    const resolved = await Promise.all(
      batches.map((batch) =>
        this.getTokensSearch({
          query: batch.join(","),
          limit: BATCH_SIZE.toString(),
        })
      )
    );
    return resolved.flat();
  }

  public static async resolveToken(input: string): Promise<Token> {
    const [token] = await this.getTokensSearch({
      query: input,
      limit: "1",
    });
    if (!token) {
      throw new Error(`Token not found: ${input}`);
    }
    return token;
  }

  public static async getAssets(mints: string[]): Promise<DatapiAsset[]> {
    const BATCH_SIZE = 50;
    const batches: string[][] = [];
    for (let i = 0; i < mints.length; i += BATCH_SIZE) {
      batches.push(mints.slice(i, i + BATCH_SIZE));
    }
    const resolved = await Promise.all(
      batches.map((batch) =>
        this.searchAssets({ query: batch.join(","), limit: BATCH_SIZE })
      )
    );
    return resolved.flat();
  }

  public static async searchAssets(
    params: SearchParams
  ): Promise<DatapiAsset[]> {
    return this.#datapi
      .get("v1/assets/search", { searchParams: params })
      .json();
  }

  public static async resolveAsset(input: string): Promise<DatapiAsset> {
    const [asset] = await this.searchAssets(
      isAddress(input)
        ? { query: input, filters: "exact_address" }
        : { query: input, limit: 1 }
    );
    if (!asset) {
      throw new Error(`Token not found: ${input}`);
    }
    return asset;
  }

  public static async getTokenList(
    category: string,
    interval: string,
    params: SearchParams
  ): Promise<TokenListResponse> {
    return this.#datapi
      .get(`v2/assets/${category}/${interval}`, { searchParams: params })
      .json();
  }

  public static async getGems(
    body: Partial<Record<GemsTab, Record<string, unknown>>>
  ): Promise<GemsResponse> {
    return this.#datapi.post("v1/assets/gems", { json: body }).json();
  }

  public static async getHeatmap(
    params: SearchParams
  ): Promise<{ timestamp: string; categories: HeatmapCategory[] }> {
    return this.#datapi
      .get("v1/assets/heatmap", { searchParams: params })
      .json();
  }

  public static async getCategoryStats(
    params: SearchParams
  ): Promise<{ categories: CategoryStats[] }> {
    return this.#datapi
      .get("v1/categories/stats", { searchParams: params })
      .json();
  }

  public static async getLaunchpadStats(): Promise<{
    launchpads: LaunchpadStats[];
  }> {
    return this.#datapi.get("v3/launchpads/stats").json();
  }

  public static async getSmartMoneyTop(
    params: SearchParams
  ): Promise<{ wallets: SmartMoneyWallet[] }> {
    return this.#datapi
      .get("smart-money/v1/top", { searchParams: params })
      .json();
  }

  public static async getSmartMoneyCards(
    params: SearchParams
  ): Promise<{ cards: SmartMoneyCard[] }> {
    return this.#datapi
      .get("smart-money/v1/cards", { searchParams: params })
      .json();
  }

  public static async getSmartMoneySummary(
    params: SearchParams
  ): Promise<{ cards: SmartMoneySummaryCard[] }> {
    return this.#datapi
      .get("smart-money/v1/summary", { searchParams: params })
      .json();
  }

  public static async getShieldWarnings(
    mints: string[]
  ): Promise<Record<string, ShieldWarning[]>> {
    const { warnings } = await this.#datapi
      .get("v1/shield", {
        searchParams: { mints: mints.join(","), isJupiter: true },
      })
      .json<{ warnings: Record<string, ShieldWarning[]> }>();
    return warnings;
  }

  public static async getCandles(
    mint: string,
    params: SearchParams
  ): Promise<{ candles: Candle[] }> {
    return this.#datapi
      .get(`v2/charts/${mint}`, { searchParams: params })
      .json();
  }

  public static async getNetVolume(
    mint: string,
    params: SearchParams
  ): Promise<{ data: { time: number; netVolume: number }[] }> {
    return this.#datapi
      .get(`v1/charts/net-volume/${mint}`, { searchParams: params })
      .json();
  }

  public static async getTokenTxs(
    mint: string,
    params: SearchParams
  ): Promise<{ txs: TokenTx[]; next?: string | undefined }> {
    return this.#datapi
      .get(`v1/txs/${mint}`, { searchParams: params, timeout: 30_000 })
      .json();
  }

  public static async getHolders(
    mint: string,
    params: SearchParams
  ): Promise<HoldersResponse> {
    return this.#datapi
      .get(`v1/holders/${mint}`, {
        searchParams: { includePnl: true, ...params },
      })
      .json();
  }

  public static async getTopTraders(
    params: SearchParams
  ): Promise<HoldersResponse> {
    return this.#datapi
      .get("v1/top-pnl-per-asset", { searchParams: params })
      .json();
  }

  public static async getDevStats(
    dev: string,
    params: SearchParams
  ): Promise<DevStats> {
    return this.#datapi
      .get(`v1/dev/stats/${dev}`, { searchParams: params })
      .json();
  }

  public static async getPools(mint: string): Promise<{ pools: Pool[] }> {
    return this.#datapi
      .get("v1/pools", { searchParams: { assetIds: mint } })
      .json();
  }

  public static async getDescription(
    mint: string
  ): Promise<{ description?: string | undefined }> {
    return this.#datapi.get(`v1/assets/${mint}/description`).json();
  }

  public static async getNarrative(
    mint: string
  ): Promise<{ narrative?: string | undefined; status: string }> {
    return this.#datapi.get(`v1/chaininsight/narrative/${mint}`).json();
  }

  public static async getStocks(
    params: SearchParams
  ): Promise<{ rwas: StockRwa[]; total: number; next?: number | undefined }> {
    return this.#datapi.get("v1/rwas", { searchParams: params }).json();
  }

  public static async getUserTrades(
    params: SearchParams
  ): Promise<{ userTrades: UserTrade[]; next?: string | undefined }> {
    return this.#datapi
      .get("v1/txs/users", { searchParams: params, timeout: 30_000 })
      .json();
  }

  public static async getAddressSummary(
    addresses: string[]
  ): Promise<AddressSummary> {
    if (addresses.length === 0) {
      return {};
    }
    return this.#datapi
      .get("v1/address-summary", {
        searchParams: { addresses: addresses.join(",") },
      })
      .json();
  }
}
