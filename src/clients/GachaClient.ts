import { HTTPError } from "ky";

import { ClientConfig } from "./ClientConfig.ts";

export type Rarity = "common" | "uncommon" | "rare" | "epic";

export type Machine = {
  code: string;
  name: string;
  priceNumber: number;
  evNumber: number;
  odds: Partial<Record<Rarity, number>>;
  stock: Partial<Record<Rarity, number>>;
  tierRanges?: Partial<Record<Rarity, { start: number; end: number }>>;
  contains: number;
  instantBuybackNumber?: number;
  metadata?: {
    public?: boolean;
    menuCategory?: string;
    menuOrder?: number;
    turboMode?: boolean;
  };
};

export type NftAttribute = { trait_type: string; value: string };

export type TcgNft = {
  id: string;
  name: string;
  rarity?: string;
  grade?: string;
  value?: string;
  estimatedValue?: string;
  attributes?: NftAttribute[] | null;
};

export type Winner = {
  wallet: string;
  machineCode: string;
  nftId: string;
  nftName: string;
  rarity: string;
  value: string;
  openedAt: string;
};

export type PullRecord = {
  id: number;
  memo: string;
  spin_txn_created_at: string;
  spin_cost: number;
  spin_status: string;
  spin_txn_signature: string | null;
  send_nft_address: string | null;
  send_nft_roll: number | null;
  buyback_refund_amount: string | number | null;
  buyback_transaction_signature: string | null;
  hashlist_metadata?: {
    content?: { metadata?: { name?: string } };
  } | null;
};

export type VrfVerification = {
  valid?: boolean;
  memo?: string;
  proof?: string;
  publicKey?: string;
  actualRoll?: number;
  calculatedRoll?: number;
  rollMatches?: boolean;
  wallet?: string;
  prizeWallet?: string;
  nftAddress?: string;
  nftMetadata?: { content?: { metadata?: { name?: string } } };
  transactionSignature?: string;
  turboMode?: boolean;
  algorithm?: string;
  vrfMode?: string;
};

export type LeaderboardSeason = {
  season: number;
  startAt: string;
  endAt: string;
  state: "pending" | "ongoing" | "completed";
  rewards?: {
    minVolumeUsd: number;
    prizeBands: {
      fromRank: number;
      toRank: number;
      rewardPacks: number;
      packType: string;
    }[];
  };
};

export type LeaderboardPrize = { packType: string; rewardPacks: number };

export type LeaderboardEntry = {
  rank: number;
  wallet: string;
  volumeUsd: number;
  prize: LeaderboardPrize | null;
};

export type OpenPackResult = {
  memo?: string;
  result:
    | {
        type: "card";
        transactionSignature?: string;
        nft: TcgNft;
      }
    | { type: "turbo-mode-buyback"; amount: string; nft?: TcgNft };
};

export type MarketplaceCard = {
  id: string;
  itemName: string;
  nftAddress: string;
  category?: string | null;
  year?: number | string | null;
  grade?: string | null;
  gradingCompany?: string | null;
  gradingID?: string | null;
  insuredValue?: string | number | null;
  burnId?: string | null;
  frontImage?: string | null;
  backImage?: string | null;
  set?: string | null;
  listing?: {
    price: number;
    currency?: string;
    createdAt?: string;
    marketplace?: string;
  } | null;
  owner?: { name?: string | null; wallet?: string | null } | null;
};

export type BrowseResponse = {
  findTotal?: number;
  total?: number;
  totalPages?: number;
  insuredValueSum?: string;
  filterNFtCard: MarketplaceCard[];
};

export type BrowseParams = {
  page: number;
  step: number;
  search?: string;
  listPriceMin?: number;
  listPriceMax?: number;
  genericGradeMin?: number;
  genericGradeMax?: number;
  categories?: string;
  gradingCompany?: string;
  orderBy?: string;
};

export type CardActivity = {
  action?: string;
  priceInfo?: {
    splPrice?: { rawAmount?: string; decimals?: number };
  } | null;
  createdAt?: number;
  card?: MarketplaceCard;
  from?: { wallet?: string | null } | null;
  to?: { wallet?: string | null } | null;
  transactionUrl?: string;
};

export type ShippingAddress = {
  id: string;
  fullName?: string;
  country?: string;
  city?: string;
  state?: string;
  isDefault?: boolean;
};

export type Shipment = {
  id: string;
  customId?: string | null;
  status?: string;
  numberOfCards?: number;
  deliveryCompany?: string | null;
  trackingIds?: string[] | null;
  trackingUrls?: string[] | null;
  totalCost?: number | string | null;
  createdAt?: string;
};

export type ShippingEstimate = {
  price?: number;
  insurancePrice?: number;
  feesPrice?: number;
  shippingPrice?: number;
  total?: number;
  numberOfCards?: number;
};

export type ShippingPrepare = {
  outboundShipmentId: string;
  transactions: string[];
  totalCost?: number;
};

const tcgKy = ClientConfig.ky.extend({
  prefixUrl: "https://tcgapi.jup.ag/v1",
  timeout: 60_000,
});

// jup.ag forwards these to Collector Crypt with its own key, so the user's
// Jupiter API key must not ride along.
const proxyKy = ClientConfig.ky.extend({
  prefixUrl: "https://jup.ag/api/gacha",
  timeout: 60_000,
  headers: { "x-api-key": undefined },
});

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

export class GachaClient {
  public static async getMachines(): Promise<Machine[]> {
    const res = await tcgKy.get("machines").json<{ machines: Machine[] }>();
    return res.machines;
  }

  public static async getMachineCards(
    code: string,
    params: { page: number; limit: number }
  ): Promise<TcgNft[]> {
    const res = await tcgKy
      .get(`machines/${encodeURIComponent(code)}/nfts`, {
        searchParams: params,
      })
      .json<{ nfts: TcgNft[] }>();
    return res.nfts;
  }

  public static async getWinners(params: {
    count: number;
    packType?: string;
    epic?: boolean;
  }): Promise<Winner[]> {
    const res = await tcgKy
      .get("winners", {
        searchParams: {
          count: params.count,
          ...(params.packType && { packType: params.packType }),
          ...(params.epic && { epic: "true" }),
        },
      })
      .json<{ data?: Winner[] }>();
    return res.data ?? [];
  }

  public static async getPulls(
    wallet: string,
    count: number
  ): Promise<PullRecord[]> {
    const res = await tcgKy
      .get("user-stats", {
        searchParams: { wallet, data: "linkedAll", count, show: "all" },
      })
      .json<{ data?: { linkedAll?: PullRecord[] } }>();
    return res.data?.linkedAll ?? [];
  }

  public static async getUnopenedPacks(
    wallet: string
  ): Promise<Record<string, number>> {
    const res = await tcgKy
      .get("packs/purchased", { searchParams: { wallet } })
      .json<{ packs?: Record<string, number> }>();
    return res.packs ?? {};
  }

  public static async verifyVrf(memo: string): Promise<VrfVerification> {
    return tcgKy.get("vrf/verify", { searchParams: { memo } }).json();
  }

  public static async getBuybackOffer(
    wallet: string,
    nft: string
  ): Promise<{ available?: boolean; amount?: string }> {
    return tcgKy.get("buyback", { searchParams: { wallet, nft } }).json();
  }

  public static async getLeaderboardSeasons(): Promise<LeaderboardSeason[]> {
    const res = await tcgKy
      .get("rewards/leaderboard/seasons")
      .json<{ seasons: LeaderboardSeason[] }>();
    return res.seasons;
  }

  public static async getLeaderboard(params: {
    season: number;
    limit: number;
  }): Promise<LeaderboardEntry[]> {
    const res = await tcgKy
      .get("rewards/leaderboard", { searchParams: params })
      .json<{ entries: LeaderboardEntry[] }>();
    return res.entries;
  }

  public static async getLeaderboardEntry(params: {
    wallet: string;
    season: number;
  }): Promise<{ entry: LeaderboardEntry | null; claimState: string }> {
    return tcgKy.get("rewards/leaderboard/me", { searchParams: params }).json();
  }

  public static async generatePack(body: {
    playerAddress: string;
    packType: string;
    turbo?: boolean;
  }): Promise<{ memo: string; transaction: string }> {
    const res = await tcgKy.post("packs/generate", { json: body }).json<{
      transactions?: { memo: string; transaction: string }[];
      memo?: string;
      transaction?: string;
    }>();
    const tx = res.transactions?.[0];
    const memo = tx?.memo ?? res.memo;
    const transaction = tx?.transaction ?? res.transaction;
    if (!memo || !transaction) {
      throw new Error("Gacha API returned no pack transaction.");
    }
    return { memo, transaction };
  }

  public static async submitPack(
    signedTransaction: string
  ): Promise<{ signature?: string }> {
    return tcgKy.post("packs/submit", { json: { signedTransaction } }).json();
  }

  public static async openPack(memo: string): Promise<OpenPackResult> {
    return tcgKy.post("packs/open", { json: { memo } }).json();
  }

  public static async generateGiftedPackChallenge(body: {
    publicKey: string;
    packType: string;
  }): Promise<{ nonce: string; messageToSign: string }> {
    return tcgKy.post("packs/purchased/generate", { json: body }).json();
  }

  public static async useGiftedPack(body: {
    publicKey: string;
    packType: string;
    nonce: string;
    turbo?: boolean;
    signedMessage: string;
    signature: string;
  }): Promise<{ memo: string; packsRemaining?: number }> {
    return tcgKy.post("packs/purchased/use", { json: body }).json();
  }

  public static async generateBuyback(body: {
    playerAddress: string;
    nftAddress: string;
  }): Promise<{ transaction: string; refundAmount?: string }> {
    const res = await tcgKy.post("buyback/generate", { json: body }).json<{
      transaction?: { transaction?: string };
      serializedTransaction?: string;
      refundAmount?: string;
    }>();
    const transaction =
      res.serializedTransaction ?? res.transaction?.transaction;
    if (!transaction) {
      throw new Error("Gacha API returned no buyback transaction.");
    }
    return { transaction, refundAmount: res.refundAmount };
  }

  public static async submitBuyback(
    signedTransaction: string
  ): Promise<{ signature?: string }> {
    return tcgKy.post("buyback/submit", { json: { signedTransaction } }).json();
  }

  public static async generateGift(body: {
    sender: string;
    receiver: string;
    packType: string;
    count: number;
  }): Promise<{
    transaction: string;
    giftId?: string | number;
    totalCost?: string | number;
  }> {
    const res = await tcgKy.post("gifts/generate", { json: body }).json<{
      transaction: { transaction: string };
      giftId?: string | number;
      totalCost?: string | number;
    }>();
    return {
      transaction: res.transaction.transaction,
      giftId: res.giftId,
      totalCost: res.totalCost,
    };
  }

  public static async browse(params: BrowseParams): Promise<BrowseResponse> {
    const searchParams = Object.fromEntries(
      Object.entries(params).filter(([, v]) => v !== undefined)
    ) as Record<string, string | number>;
    return proxyKy.get("marketplace/browse", { searchParams }).json();
  }

  public static async getOwnedCards(
    wallet: string,
    page: number
  ): Promise<BrowseResponse> {
    try {
      return await proxyKy
        .get("marketplace/owned", {
          searchParams: { wallet, page, step: 100, orderBy: "dateDesc" },
        })
        .json();
    } catch (err) {
      // Collector Crypt 404s wallets it has never seen.
      if (err instanceof HTTPError && err.response.status === 404) {
        return { filterNFtCard: [], totalPages: 0 };
      }
      throw err;
    }
  }

  public static async getCard(mint: string): Promise<MarketplaceCard> {
    return proxyKy
      .get("marketplace/card", { searchParams: { nftAddress: mint } })
      .json();
  }

  public static async getCardActivity(wallet: string): Promise<CardActivity[]> {
    return proxyKy
      .get("marketplace/card-activity", { searchParams: { wallet } })
      .json();
  }

  public static async buildMarketplaceTx(
    action: "buy" | "list" | "cancel-listing" | "update-listing",
    body: Record<string, unknown>
  ): Promise<string> {
    return proxyKy.post(`marketplace/${action}`, { json: body }).text();
  }

  public static async broadcast(body: {
    wallet: string;
    signedTransaction: string;
    nftAddress?: string;
  }): Promise<{ success?: boolean; signature?: string; message?: string }> {
    return proxyKy.post("marketplace/broadcast", { json: body }).json();
  }

  public static async getShippingNonce(body: {
    wallet: string;
    partnerAppId: string;
    domain: string;
    uri: string;
  }): Promise<{ message: string }> {
    return proxyKy.post("shipping/auth/nonce", { json: body }).json();
  }

  public static async verifyShippingSignIn(body: {
    message: string;
    signature: string;
  }): Promise<{ accessToken: string }> {
    return proxyKy.post("shipping/auth/verify", { json: body }).json();
  }

  public static async getShippingAddresses(
    token: string
  ): Promise<ShippingAddress[]> {
    return proxyKy
      .get("shipping/shipping-address", { headers: bearer(token) })
      .json();
  }

  public static async getShipments(token: string): Promise<unknown> {
    return proxyKy
      .get("shipping/outbound-shipment", { headers: bearer(token) })
      .json();
  }

  public static async getShipment(
    id: string,
    token: string
  ): Promise<Shipment> {
    return proxyKy
      .get(`shipping/outbound-shipment/${encodeURIComponent(id)}`, {
        headers: bearer(token),
      })
      .json();
  }

  public static async estimateShipping(
    body: { nftAddresses: string[]; shippingAddressId: string },
    token: string
  ): Promise<ShippingEstimate> {
    return proxyKy
      .post("shipping/redeem/estimate", { json: body, headers: bearer(token) })
      .json();
  }

  public static async prepareShipping(
    body: {
      nftAddresses: string[];
      shippingAddressId: string;
      insurance?: boolean;
    },
    token: string
  ): Promise<ShippingPrepare> {
    return proxyKy
      .post("shipping/redeem/prepare", { json: body, headers: bearer(token) })
      .json();
  }

  public static async submitShipping(
    outboundShipmentId: string,
    transactions: string[],
    token: string
  ): Promise<{ id: string; status?: string }> {
    return proxyKy
      .post(`shipping/burn/${encodeURIComponent(outboundShipmentId)}`, {
        json: { transactions },
        headers: bearer(token),
      })
      .json();
  }
}
