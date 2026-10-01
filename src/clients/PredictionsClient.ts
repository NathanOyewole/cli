import { HTTPError, type SearchParamsOption } from "ky";

import { ClientConfig } from "./ClientConfig.ts";

export type Provider = "kalshi" | "polymarket" | "gx" | "bisonfi";

export type EventMetadata = {
  eventId: string;
  title: string;
  subtitle: string;
  slug: string;
  series: string;
  closeTime: string;
  imageUrl: string;
  isLive: boolean;
};

export type MarketPricing = {
  buyYesPriceUsd: number | null;
  buyNoPriceUsd: number | null;
  sellYesPriceUsd: number | null;
  sellNoPriceUsd: number | null;
  volume: number;
};

export type Market = {
  provider?: Provider;
  marketId: string;
  title: string;
  status: "open" | "closed" | "cancelled";
  result: "yes" | "no" | "draw" | null;
  openTime: number;
  closeTime: number;
  isTeamMarket: boolean;
  rulesPrimary: string;
  rulesSecondary: string;
  resolveAt: number | null;
  marketResultPubkey: string | null;
  imageUrl: string | null;
  pricing?: MarketPricing;
  marketOptions?: { label: string; buyYes: boolean }[] | null;
  marketStatus?: "running" | "suspend";
  tradable?: boolean;
};

export type PredictionEvent = {
  eventId: string;
  isActive: boolean;
  isLive: boolean;
  category: string;
  subcategory: string;
  tags: string[];
  metadata: EventMetadata;
  markets: Market[];
  volumeUsd: string;
  volume24hr: string;
  closeCondition: string;
  beginAt: string | null;
  rulesPdf: string;
};

export type Pagination = {
  start: number;
  end: number;
  total: number;
  hasNext: boolean;
};

export type GetEventsResponse = {
  data: PredictionEvent[];
  pagination: Pagination;
};

export type PredictionPosition = {
  pubkey: string;
  ownerPubkey: string;
  marketId: string;
  isYes: boolean;
  contracts: string;
  contractsMicro: string;
  totalCostUsd: number;
  valueUsd: number;
  pnlUsd: number;
  pnlUsdPercent: number;
  claimable?: boolean;
  claimed: boolean;
  claimedUsd: number;
  sellPriceUsd?: string | null;
  openedAt: string;
  updatedAt: string;
  eventMetadata: { title: string };
  marketMetadata: {
    provider?: Provider;
    title: string;
    status: string;
    result: "yes" | "no" | null;
    openTime: number;
    closeTime: number;
  };
};

export type GetPositionsResponse = {
  data: PredictionPosition[];
  pagination: Pagination;
};

export type ExecutionContext = { type: string } & Record<string, unknown>;

/** Every server-built Predict transaction carries the context `/execute` expects back. */
export type ExecutableRequest = {
  transaction: string | null;
  jupiterSwapRequestId?: string | null;
  execution?: { endpoint: string; context: ExecutionContext };
};

export type OrderDetails = {
  orderPubkey: string;
  orderAtaPubkey: string;
  userPubkey: string;
  marketId: string;
  positionPubkey: string;
  isBuy: boolean;
  isYes: boolean;
  contracts: string;
  contractsMicro: string;
  newContracts: string;
  maxBuyPriceUsd: string | null;
  minSellPriceUsd: string | null;
  externalOrderId?: string;
  clientOrderId?: string;
  orderCostUsd: string;
  newAvgPriceUsd: string;
  newSizeUsd: string;
  newPayoutUsd: string;
  payoutUsd: string;
  estimatedProtocolFeeUsd: string;
  estimatedVenueFeeUsd: string;
  estimatedIntegratorFeeUsd: string;
  estimatedTotalFeeUsd: string;
  slippageBps?: number | null;
  maxSlippageBps?: number | null;
};

export type CreateOrderResponse = ExecutableRequest & {
  txMeta: { blockhash: string; lastValidBlockHeight: number } | null;
  externalOrderId?: string;
  clientOrderId?: string;
  order: OrderDetails;
  executionModel?: "atomic_swap";
  settlement?: "auto";
};

export type ExecuteResponse = {
  status: "Success" | "Failed";
  signature: string | null;
  error: string | null;
};

export type ClaimPositionResponse = ExecutableRequest & {
  transaction: string;
  position: {
    positionPubkey: string;
    marketId?: string;
    marketPubkey?: string;
    userPubkey: string;
    ownerPubkey?: string;
    isYes: boolean;
    contracts: string;
    payoutAmountUsd: string;
  };
};

export type CloseAllPositionsResponse = {
  data: (CreateOrderResponse | ClaimPositionResponse)[];
};

export type ClaimAllPositionsResponse = {
  data: ClaimPositionResponse[];
};

export type CancelOrderResponse = ExecutableRequest & {
  transaction: string;
  orderPubkey: string;
  cancelExpiresAtMs: number;
};

export type Ticket = {
  pubkey: string;
  marketId: string;
  stakeUsd: string;
  maxPayoutUsd: string;
  payoutUsd: string;
  status: string;
};

export type CreateTicketResponse = ExecutableRequest & {
  ticket: Ticket;
};

export type Order = {
  pubkey: string;
  ownerPubkey: string;
  marketId: string;
  position: string;
  orderType: "market" | "limit";
  status: "pending" | "filled" | "failed";
  isYes: boolean;
  isBuy: boolean;
  createdAt: number;
  contractsMicro: string;
  maxBuyPriceUsd: string | null;
  minSellPriceUsd: string | null;
  filledContractsMicro: string;
  avgFillPriceUsd: string;
  sizeUsd: string;
  externalOrderId?: string;
  clientOrderId?: string;
  eventMetadata: { title: string };
  marketMetadata: { title: string; marketId: string };
};

export type GetOrdersResponse = {
  data: Order[];
  pagination: Pagination;
};

export type HistoryEvent = {
  id: number;
  eventType: string;
  signature: string;
  slot: string;
  timestamp: number;
  orderPubkey: string;
  externalOrderId?: string;
  positionPubkey: string;
  marketId: string;
  ownerPubkey: string;
  keeperPubkey: string;
  isBuy: boolean;
  isYes: boolean;
  contracts: string;
  filledContracts: string;
  filledContractsMicro?: string;
  maxFillPriceUsd: string;
  avgFillPriceUsd: string;
  realizedPnl: string | null;
  payoutAmountUsd: string;
  marketMetadata: {
    title: string;
    status: string;
    result: string | null;
  };
  eventMetadata: {
    title: string;
    subtitle: string;
    slug: string;
    imageUrl: string;
    isLive: boolean;
  };
};

export type GetHistoryResponse = {
  data: HistoryEvent[];
  pagination: Pagination;
};

export type Subcategory = {
  subcategory: string;
  label: string;
  eventCount: number;
  children?: Subcategory[];
};

export type CategoriesResponse = {
  data: {
    category: string;
    eventCount: number;
    subcategories: Subcategory[];
  }[];
};

export type TagsResponse = {
  data: { label: string; tag: string; eventCount: number }[];
};

export type EventScore = {
  eventId: string;
  leagueAbbreviation: string | null;
  homeTeam: string | null;
  awayTeam: string | null;
  score: string | null;
  period: string | null;
  elapsed: string | null;
  status: string | null;
  live: boolean;
  ended: boolean;
} | null;

export type ForecastResponse = {
  forecast_history: {
    market_ticker: string;
    numerical_forecast: number;
    end_period_ts: number;
    period_interval: number;
  }[];
};

export type Trade = {
  id: string;
  eventId: string;
  ownerPubkey: string;
  action: "buy" | "sell";
  side: "yes" | "no";
  amountUsd: string;
  priceUsd: string;
  eventTitle: string;
  marketId: string;
  marketTitle: string;
  timestamp: number;
};

export type LeaderboardEntry = {
  ownerPubkey: string;
  realizedPnlUsd: string;
  totalVolumeUsd: string;
  predictionsCount: number;
  correctPredictions: number;
  wrongPredictions: number;
  winRatePct: string;
};

export type LeaderboardResponse = {
  data: LeaderboardEntry[];
  summary: Record<string, { totalVolumeUsd: string; predictionsCount: number }>;
};

export type ProfileResponse = {
  ownerPubkey: string;
  realizedPnlUsd: string;
  totalVolumeUsd: string;
  predictionsCount: string | number;
  correctPredictions: string | number;
  wrongPredictions: string | number;
  totalActiveContractsMicro?: string;
  totalActiveContracts: string;
  totalPositionsValueUsd: string;
};

export type PnlHistoryResponse = {
  ownerPubkey: string;
  interval: string;
  bucketSeconds: number;
  history: { timestamp: number; cumulativePnlUsd: string }[];
};

function compact(
  params: Record<string, string | number | boolean | undefined>
): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== "")
  ) as Record<string, string | number | boolean>;
}

/** Codes whose server message is too vague to act on. */
const ERROR_MESSAGES: Record<string, string> = {
  kalshi_buys_disabled:
    "Buying on Kalshi markets is currently disabled. Existing Kalshi positions can still be sold or claimed.",
  ticket_market_closed: "This Saba market is not accepting tickets right now.",
};

async function explainErrors<T>(request: Promise<T>): Promise<T> {
  try {
    return await request;
  } catch (err) {
    if (err instanceof HTTPError) {
      const body = (await err.response
        .clone()
        .json()
        .catch(() => null)) as { code?: string } | null;
      const message = body?.code ? ERROR_MESSAGES[body.code] : undefined;
      if (message) {
        throw new Error(message);
      }
    }
    throw err;
  }
}

export class PredictionsClient {
  static readonly #ky = ClientConfig.ky.extend({
    prefixUrl: `${ClientConfig.host}/prediction/v1`,
  });

  public static async searchEvents(params: {
    query: string;
    start?: number;
    end?: number;
  }): Promise<{ data: PredictionEvent[] }> {
    const searchParams: SearchParamsOption = compact({
      query: params.query,
      includeMarkets: true,
      start: params.start,
      end: params.end,
    });
    return this.#ky.get("events/search", { searchParams }).json();
  }

  public static async getEvent(eventId: string): Promise<PredictionEvent> {
    return this.#ky
      .get(`events/${eventId}`, { searchParams: { includeAllMarkets: true } })
      .json();
  }

  public static async getEventsBatch(
    eventIds: string[]
  ): Promise<{ data: PredictionEvent[] }> {
    return this.#ky
      .get("events/batch", {
        searchParams: {
          eventIds: eventIds.join(","),
          includeMarkets: true,
          includeAllMarkets: true,
        },
      })
      .json();
  }

  public static async getEvents(params: {
    filter?: string;
    sortBy?: string;
    sortDirection?: string;
    category?: string;
    subcategories?: string;
    tags?: string;
    start?: number;
    end?: number;
  }): Promise<GetEventsResponse> {
    return this.#ky
      .get("events", {
        searchParams: compact({ includeMarkets: true, ...params }),
      })
      .json();
  }

  public static async getSuggestedEvents(params: {
    category?: string;
    excludedEventId?: string;
    limit?: number;
  }): Promise<GetEventsResponse> {
    return this.#ky
      .get("events/suggested", { searchParams: compact(params) })
      .json();
  }

  public static async getTimedEvents(params: {
    category?: string;
    subcategory: string;
    tags: string;
    provider?: string;
  }): Promise<{ data: PredictionEvent[] }> {
    return this.#ky
      .get("events/crypto/timed", { searchParams: compact(params) })
      .json();
  }

  public static async getCategories(): Promise<CategoriesResponse> {
    return this.#ky.get("events/categories").json();
  }

  public static async getTags(category: string): Promise<TagsResponse> {
    return this.#ky
      .get("events/tags", {
        searchParams: { category, provider: "polymarket" },
      })
      .json();
  }

  public static async getEventScore(eventId: string): Promise<EventScore> {
    return this.#ky.get(`events/${eventId}/score`).json();
  }

  public static async getMarket(marketId: string): Promise<Market> {
    return this.#ky.get(`markets/${marketId}`).json();
  }

  public static async getForecast(marketId: string): Promise<ForecastResponse> {
    return this.#ky.get("forecast", { searchParams: { marketId } }).json();
  }

  public static async getTrades(): Promise<{ data: Trade[] }> {
    return this.#ky.get("trades").json();
  }

  public static async getPositions(
    ownerPubkey: string
  ): Promise<GetPositionsResponse> {
    return this.#ky.get("positions", { searchParams: { ownerPubkey } }).json();
  }

  public static async getPosition(
    positionPubkey: string
  ): Promise<PredictionPosition> {
    return this.#ky
      .get(`positions/${positionPubkey}`, {
        searchParams: { includePrices: true },
      })
      .json();
  }

  public static async postOrder(
    req: {
      orderType: "market" | "limit";
      ownerPubkey: string;
    } & (
      | {
          isBuy: true;
          marketId: string;
          isYes: boolean;
          depositAmount: string;
          depositMint: string;
          maxBuyPriceUsd?: string;
        }
      | { isBuy: false; positionPubkey: string; contractsMicro: string }
    )
  ): Promise<CreateOrderResponse> {
    return explainErrors(
      this.#ky
        .post("orders", {
          json: {
            ...req,
            skipSigning: true,
            ...(req.isBuy && { returnQuoteOnInsufficientFunds: true }),
          },
        })
        .json()
    );
  }

  public static async postTicket(req: {
    marketId: string;
    depositMint: string;
    stakeUsd: string;
    ownerPubkey: string;
  }): Promise<CreateTicketResponse> {
    return explainErrors(
      this.#ky.post("tickets", { json: { ...req, skipSigning: true } }).json()
    );
  }

  public static async getOrders(params: {
    ownerPubkey: string;
    start?: number;
    end?: number;
  }): Promise<GetOrdersResponse> {
    return this.#ky.get("orders", { searchParams: compact(params) }).json();
  }

  public static async cancelOrder(
    orderPubkey: string,
    userPubkey: string
  ): Promise<CancelOrderResponse> {
    return this.#ky
      .post("orders/cancel", { json: { userPubkey, orderPubkey } })
      .json();
  }

  public static async postExecute(req: {
    signedTransaction: string;
    context?: ExecutionContext;
    ownerPubkey?: string;
    jupiterSwapRequestId?: string;
  }): Promise<ExecuteResponse> {
    return this.#ky.post("execute", { json: req }).json();
  }

  public static async closePosition(
    positionPubkey: string,
    userPubkey: string,
    minSellPriceUsd: string
  ): Promise<CreateOrderResponse> {
    return this.#ky
      .delete(`positions/${positionPubkey}`, {
        json: { userPubkey, minSellPriceUsd },
      })
      .json();
  }

  public static async closeAllPositions(
    userPubkey: string
  ): Promise<CloseAllPositionsResponse> {
    return this.#ky
      .delete("positions", {
        json: { userPubkey, minSellPriceSlippageBps: 500 },
      })
      .json();
  }

  public static async getHistory(params: {
    ownerPubkey: string;
    start?: number;
    end?: number;
  }): Promise<GetHistoryResponse> {
    return this.#ky.get("history", { searchParams: compact(params) }).json();
  }

  public static async claimPosition(
    positionPubkey: string,
    userPubkey: string
  ): Promise<ClaimPositionResponse> {
    return this.#ky
      .post(`positions/${positionPubkey}/claim`, { json: { userPubkey } })
      .json();
  }

  public static async claimAllPositions(
    ownerPubkey: string
  ): Promise<ClaimAllPositionsResponse> {
    return this.#ky.post("positions/claim", { json: { ownerPubkey } }).json();
  }

  public static async getLeaderboard(params: {
    period: string;
    metric: string;
    limit: number;
  }): Promise<LeaderboardResponse> {
    return this.#ky.get("leaderboards", { searchParams: params }).json();
  }

  public static async getProfile(
    wallet: string,
    period: string
  ): Promise<ProfileResponse> {
    return this.#ky
      .get(`profiles/${wallet}`, { searchParams: { period } })
      .json();
  }

  public static async getUsernames(
    wallets: string[]
  ): Promise<{ data: Record<string, string | null> }> {
    if (wallets.length === 0) {
      return { data: {} };
    }
    return this.#ky
      .get("profiles/usernames", {
        searchParams: { wallets: wallets.join(",") },
      })
      .json();
  }

  public static async getPnlHistory(
    ownerPubkey: string,
    interval: string
  ): Promise<PnlHistoryResponse> {
    return this.#ky
      .get("profile/pnl-history", { searchParams: { ownerPubkey, interval } })
      .json();
  }
}
